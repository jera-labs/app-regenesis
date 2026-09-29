// ============================================================================
// EDGE FUNCTION: sync-ghl-perfil
//
// Importa los custom fields que el cliente ya respondió en el form GHL
// (workflow del closer) hacia las tablas de la plataforma:
//   - leads.instagram_handle, fuente_detalle
//   - cliente_negocio.modelo_negocio, ingreso_ultimo_mes_usd,
//     meta_facturacion_6m_usd, problemas_principales, intentos_no_funcionaron
//
// Idempotente: si el campo de la plataforma ya está lleno, NO lo sobrescribe
// (a menos que se pase `overwrite: true`).
//
// Solo admin puede invocarla (verify_jwt: true + check usuarios_admin).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROMPT_VERSION = 'v1-sync-ghl';

const ALLOWED_ORIGINS = new Set([
  'https://plataforma.neurohackers.cloud',
  'https://neurohackers.cloud',
  'https://www.neurohackers.cloud',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://plataforma.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Mapeo de IDs de GHL → campos de la plataforma (IDs completos de 20 chars)
const GHL_CF_MAP = {
  instagram_a: 'hx8kCgfuVi1nE0WrWE74',
  instagram_b: 'mB0VGp1JpGwsPwLMHGNo',
  a_que_se_dedica: 'nxbmHZVayrJkUCH8G3Bz',
  factura_actual: 'NVS8iQgaZn5BAJvdIInv',
  factura_meta_6m: 'pAUl1tlLPDIGFtI9azKY',
  bloqueos: 'nVDbp7O1V6GHC7Oj8LQ1',
  mecanismos_previos: 'fFweJy0NZIaw9xOA9RHV',
  origen_cliente: 'GVSuMMQLqQ0x8cREnUy1',
  area_bloqueada: 'tG2wj3k2MwxqKrV640uI',
};

function parseNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/[^\d.]/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function getCF(customFields: any[], id: string): any {
  const f = customFields?.find((x) => x.id === id);
  return f?.value;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const { lead_id, overwrite = false } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: 'lead_id requerido' }),
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const GHL_API_KEY = Deno.env.get('GHL_API_KEY');
    const authHeader = req.headers.get('Authorization');

    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) throw new Error('Supabase env vars missing');
    if (!GHL_API_KEY) throw new Error('GHL_API_KEY no configurada en Supabase');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization requerida' }),
        { status: 401, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // Cliente con JWT del user para verificar permisos
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    // Solo admin puede sincronizar (porque vamos a tocar datos de leads que pagaron)
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Sesión inválida' }),
        { status: 401, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }
    const { data: admin } = await userClient.from('usuarios_admin').select('email').eq('email', user.email).maybeSingle();
    if (!admin) {
      return new Response(JSON.stringify({ error: 'Solo admin puede sincronizar GHL' }),
        { status: 403, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // Cliente con service role para leer/escribir cualquier lead
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: lead } = await supabase.from('leads').select('id,email,nombre,ghl_contact_id,instagram_handle,fuente_detalle').eq('id', lead_id).maybeSingle();
    if (!lead) {
      return new Response(JSON.stringify({ error: 'Lead no encontrado' }),
        { status: 404, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }
    if (!lead.ghl_contact_id) {
      return new Response(JSON.stringify({ error: 'Lead sin ghl_contact_id' }),
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // Fetch contact GHL
    const ghlRes = await fetch(`https://services.leadconnectorhq.com/contacts/${lead.ghl_contact_id}`, {
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 Chrome/120',
      },
    });
    if (!ghlRes.ok) {
      const errText = await ghlRes.text();
      throw new Error(`GHL API ${ghlRes.status}: ${errText.slice(0, 200)}`);
    }
    const ghlData = await ghlRes.json();
    const contact = ghlData.contact || ghlData;
    const customFields = contact.customFields || [];

    // DEBUG mode
    const url = new URL(req.url);
    if (url.searchParams.get('debug') === '1') {
      return new Response(JSON.stringify({
        debug: true,
        ghl_status: ghlRes.status,
        ghl_response_keys: Object.keys(ghlData),
        contact_keys: Object.keys(contact),
        customFields_count: customFields.length,
        customFields_raw: customFields.slice(0, 5),
        ghl_api_key_present: !!GHL_API_KEY,
        ghl_api_key_prefix: GHL_API_KEY?.slice(0, 8),
      }, null, 2), { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    // Extraer valores
    const ig = getCF(customFields, GHL_CF_MAP.instagram_a) || getCF(customFields, GHL_CF_MAP.instagram_b);
    const dedica = getCF(customFields, GHL_CF_MAP.a_que_se_dedica);
    const facturaActual = parseNumber(getCF(customFields, GHL_CF_MAP.factura_actual));
    const meta6m = parseNumber(getCF(customFields, GHL_CF_MAP.factura_meta_6m));
    const bloqueos = getCF(customFields, GHL_CF_MAP.bloqueos);
    const mecanismosPrev = getCF(customFields, GHL_CF_MAP.mecanismos_previos);
    const origen = getCF(customFields, GHL_CF_MAP.origen_cliente);
    const areaBloqueada = getCF(customFields, GHL_CF_MAP.area_bloqueada);

    // Sync leads
    const leadUpdates: any = {};
    if (ig && (overwrite || !lead.instagram_handle)) leadUpdates.instagram_handle = String(ig).replace(/^@/, '');
    if (origen && (overwrite || !lead.fuente_detalle)) leadUpdates.fuente_detalle = String(origen);

    const sincronizados: string[] = [];

    if (Object.keys(leadUpdates).length) {
      await supabase.from('leads').update(leadUpdates).eq('id', lead_id);
      sincronizados.push(...Object.keys(leadUpdates).map(k => 'leads.' + k));
    }

    // Sync cliente_negocio
    const { data: negocioExistente } = await supabase.from('cliente_negocio').select('*').eq('lead_id', lead_id).maybeSingle();

    const negocioUpdates: any = {};
    if (dedica && (overwrite || !negocioExistente?.modelo_negocio)) negocioUpdates.modelo_negocio = String(dedica);
    if (facturaActual !== null && (overwrite || !negocioExistente?.ingreso_ultimo_mes_usd)) negocioUpdates.ingreso_ultimo_mes_usd = facturaActual;
    if (meta6m !== null && (overwrite || !negocioExistente?.meta_facturacion_6m_usd)) negocioUpdates.meta_facturacion_6m_usd = meta6m;

    const problemasTxt: string[] = [];
    if (Array.isArray(bloqueos) && bloqueos.length) problemasTxt.push('Bloqueos GHL: ' + bloqueos.join(', '));
    else if (typeof bloqueos === 'string' && bloqueos) problemasTxt.push('Bloqueos GHL: ' + bloqueos);
    if (areaBloqueada) {
      const v = Array.isArray(areaBloqueada) ? areaBloqueada.join(', ') : String(areaBloqueada);
      problemasTxt.push('Área más bloqueada: ' + v);
    }
    if (problemasTxt.length && (overwrite || !negocioExistente?.problemas_principales)) {
      negocioUpdates.problemas_principales = problemasTxt.join(' · ');
    }

    if (mecanismosPrev && (overwrite || !negocioExistente?.intentos_no_funcionaron)) {
      negocioUpdates.intentos_no_funcionaron = Array.isArray(mecanismosPrev) ? mecanismosPrev.join(', ') : String(mecanismosPrev);
    }

    if (Object.keys(negocioUpdates).length) {
      negocioUpdates.ultima_actualizacion_at = new Date().toISOString();
      const payload = { ...negocioUpdates, lead_id };
      await supabase.from('cliente_negocio').upsert(payload, { onConflict: 'lead_id' });
      sincronizados.push(...Object.keys(negocioUpdates).map(k => 'cliente_negocio.' + k));

      // Recalcular completitud_score
      const { data: negActual } = await supabase.from('cliente_negocio').select('*').eq('lead_id', lead_id).maybeSingle();
      if (negActual) {
        const FIELDS = ['modelo_negocio','nombre_negocio','anos_experiencia','sitio_web','redes_sociales',
          'ingreso_ultimo_mes_usd','meta_facturacion_6m_usd','modelo_pricing','horas_trabajo_semana',
          'pct_tiempo_marketing_ventas','pct_tiempo_servicio','clientes_activos','equipo_size',
          'canales_trafico_activos','competidores_principales','ventaja_injusta','tiene_casos_exito',
          'objetivos_principales','problemas_principales','intentos_si_funcionaron','intentos_no_funcionaron'];
        let n = 0;
        for (const f of FIELDS) {
          const v = (negActual as any)[f];
          if (v === null || v === undefined || v === '') continue;
          if (Array.isArray(v) && !v.length) continue;
          n++;
        }
        const score = Math.round((n / FIELDS.length) * 100);
        await supabase.from('cliente_negocio').update({ completitud_score: score }).eq('lead_id', lead_id);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      lead: { id: lead.id, email: lead.email, nombre: lead.nombre },
      sincronizados,
      ghl_contact_id: lead.ghl_contact_id,
      campos_disponibles_ghl: {
        instagram: !!ig,
        a_que_se_dedica: !!dedica,
        factura_actual: facturaActual,
        meta_6m: meta6m,
        bloqueos: Array.isArray(bloqueos) ? bloqueos.length : (bloqueos ? 1 : 0),
        mecanismos_previos: !!mecanismosPrev,
        origen: !!origen,
      },
      metadata: { prompt_version: PROMPT_VERSION },
    }), { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('sync-ghl-perfil error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }), { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
