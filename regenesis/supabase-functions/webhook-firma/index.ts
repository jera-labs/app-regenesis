// ============================================================================
// EDGE FUNCTION: webhook-firma (v2)
// Recibe POST de GoHighLevel cuando un contacto firma uno de los 3 contratos.
//
// verify_jwt = false (GHL no tiene JWT). Auth por X-Webhook-Secret.
//
// Tipo de contrato se resuelve de forma DEFENSIVA en este orden:
//   1. customData.tipo_contrato        (lo que GHL realmente envía cuando lo configuras)
//   2. tipo_contrato top-level          (legacy)
//   3. tipo, document_type top-level
//   4. workflow.name regex              ("Contrato Waiver Firmado" → waiver)
//   5. tags agregados                   ("contrato_waiver_firmado" en la lista)
//
// Razón del v2: GHL bajo "Custom Webhook" mete los campos custom dentro de
// `customData`, no en el top level del payload. Esto rompió a Aixa el 2026-05-19.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function pick(payload: any, ...keys: string[]): any {
  for (const k of keys) {
    const parts = k.split('.');
    let v = payload;
    for (const p of parts) {
      if (v == null) break;
      v = v[p];
    }
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function errToStr(e: any): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const parts: string[] = [];
    if (e.message) parts.push(String(e.message));
    if (e.code) parts.push(`code=${e.code}`);
    if (e.details) parts.push(`details=${e.details}`);
    if (e.hint) parts.push(`hint=${e.hint}`);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(e); } catch { return '[unserializable]'; }
  }
  return String(e);
}

type TipoContrato = 'servicio' | 'waiver' | 'media';

const ALIASES: Record<string, TipoContrato> = {
  // Servicio
  'servicio': 'servicio',
  'service': 'servicio',
  'contrato_servicio': 'servicio',
  'contrato_servicio_firmado': 'servicio',
  'contrato': 'servicio',
  'prestacion_servicios': 'servicio',
  // Waiver
  'waiver': 'waiver',
  'liability': 'waiver',
  'liability_release': 'waiver',
  'contrato_waiver': 'waiver',
  'contrato_waiver_firmado': 'waiver',
  'exencion': 'waiver',
  'responsabilidad': 'waiver',
  // Media Release
  'media': 'media',
  'media_release': 'media',
  'contrato_media': 'media',
  'contrato_media_firmado': 'media',
  'imagen': 'media',
  'derechos_imagen': 'media',
};

const COLUMNAS: Record<TipoContrato, { firmadoAt: string; url: string }> = {
  servicio: { firmadoAt: 'contrato_servicio_firmado_at', url: 'contrato_servicio_url' },
  waiver:   { firmadoAt: 'contrato_waiver_firmado_at',   url: 'contrato_waiver_url' },
  media:    { firmadoAt: 'contrato_media_firmado_at',    url: 'contrato_media_url' },
};

const OBLIGATORIOS: TipoContrato[] = ['servicio', 'waiver', 'media'];

/**
 * Resuelve el tipo de contrato firmado a partir del payload, intentando
 * múltiples fuentes en orden de confiabilidad. Devuelve null si no puede.
 *
 * Sources:
 *   A. customData.tipo_contrato
 *   B. tipo_contrato (top-level legacy)
 *   C. tipo, document_type (top-level)
 *   D. workflow.name regex
 *   E. tags string (lista CSV o array) buscando `contrato_X_firmado`
 */
function resolverTipo(payload: any): { tipo: TipoContrato | null; via: string; raw: string } {
  // A. customData.tipo_contrato
  const a = pick(payload, 'customData.tipo_contrato');
  if (a) {
    const norm = String(a).toLowerCase().trim();
    if (ALIASES[norm]) return { tipo: ALIASES[norm], via: 'customData.tipo_contrato', raw: String(a) };
  }

  // B. top-level tipo_contrato
  const b = pick(payload, 'tipo_contrato');
  if (b) {
    const norm = String(b).toLowerCase().trim();
    if (ALIASES[norm]) return { tipo: ALIASES[norm], via: 'tipo_contrato', raw: String(b) };
  }

  // C. tipo / document_type top-level
  const c = pick(payload, 'tipo', 'document_type', 'documentType');
  if (c) {
    const norm = String(c).toLowerCase().trim();
    if (ALIASES[norm]) return { tipo: ALIASES[norm], via: 'tipo/document_type', raw: String(c) };
  }

  // D. workflow.name (GHL siempre lo manda en "Custom Webhook")
  const workflowName = (pick(payload, 'workflow.name', 'workflow_name') || '').toString().toLowerCase();
  if (workflowName) {
    if (workflowName.includes('waiver')) return { tipo: 'waiver', via: 'workflow.name', raw: workflowName };
    if (workflowName.includes('servicio') || workflowName.includes('service')) return { tipo: 'servicio', via: 'workflow.name', raw: workflowName };
    if (workflowName.includes('media')) return { tipo: 'media', via: 'workflow.name', raw: workflowName };
  }

  // E. tags (string CSV o array)
  let tags: string[] = [];
  const rawTags = pick(payload, 'tags', 'contact.tags');
  if (Array.isArray(rawTags)) tags = rawTags.map((t: any) => String(t).toLowerCase());
  else if (typeof rawTags === 'string') tags = rawTags.toLowerCase().split(',').map(s => s.trim());
  for (const t of tags) {
    if (ALIASES[t]) return { tipo: ALIASES[t], via: 'tags', raw: t };
  }

  return { tipo: null, via: 'none', raw: '' };
}

/**
 * Resuelve email de forma defensiva.
 */
function resolverEmail(payload: any): string | null {
  const e = pick(payload, 'email', 'contact.email', 'customData.email', 'contactEmail');
  return e ? String(e).toLowerCase().trim() : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const expectedSecret = Deno.env.get('GHL_WEBHOOK_SECRET');
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  let payload: any = null;
  let logId: number | null = null;
  let httpStatus = 200;
  let resultado: string | null = null;
  let errorMsg: string | null = null;
  let leadId: string | null = null;

  try {
    payload = await req.json().catch(() => ({}));

    const ins = await admin
      .from('webhook_log')
      .insert({ fuente: 'ghl_firma', payload })
      .select('id')
      .single();
    logId = ins.data?.id ?? null;

    if (!expectedSecret) throw new Error('GHL_WEBHOOK_SECRET no esta configurado');

    const givenSecret = req.headers.get('x-webhook-secret') || pick(payload, 'webhook_secret');
    if (givenSecret !== expectedSecret) {
      httpStatus = 401;
      throw new Error('secret invalido o ausente');
    }

    const email = resolverEmail(payload);
    if (!email) { httpStatus = 400; throw new Error('email es requerido'); }

    const { tipo, via, raw } = resolverTipo(payload);
    if (!tipo) {
      httpStatus = 400;
      throw new Error(
        `tipo_contrato no se pudo resolver. Intentado: customData.tipo_contrato, tipo_contrato, tipo, document_type, workflow.name, tags. ` +
        `Workflow: "${pick(payload, 'workflow.name') || '(sin)'}". ` +
        `Tags: "${pick(payload, 'tags') || '(sin)'}". ` +
        `customData: ${JSON.stringify(pick(payload, 'customData') || {})}`
      );
    }

    const documentoUrl = pick(payload, 'documento_url', 'document_url', 'url', 'customData.documento_url');

    const { data: lead, error: errLead } = await admin
      .from('leads')
      .select('id, contrato_servicio_firmado_at, contrato_waiver_firmado_at, contrato_media_firmado_at')
      .eq('email', email)
      .maybeSingle();

    if (errLead) throw errLead;
    if (!lead) {
      httpStatus = 404;
      throw new Error('no se encontro lead con email: ' + email);
    }
    leadId = lead.id;

    const colFirmadoAt = COLUMNAS[tipo].firmadoAt;
    const colUrl = COLUMNAS[tipo].url;
    const yaFirmado = (lead as Record<string, any>)[colFirmadoAt];

    if (yaFirmado) {
      resultado = `${tipo}_ya_estaba_firmado · via=${via}`;
      return new Response(
        JSON.stringify({ ok: true, lead_id: leadId, resultado, tipo, via, ya_firmado_at: yaFirmado }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const updates: Record<string, any> = {};
    updates[colFirmadoAt] = new Date().toISOString();
    if (documentoUrl) updates[colUrl] = documentoUrl;

    const { error: errUpd } = await admin
      .from('leads')
      .update(updates)
      .eq('id', leadId);
    if (errUpd) throw errUpd;

    resultado = `${tipo}_firmado · via=${via}`;

    // Determinar si los 3 obligatorios están firmados (incluyendo el actual)
    const firmadosAhora: Record<TipoContrato, boolean> = {
      servicio: !!lead.contrato_servicio_firmado_at,
      waiver:   !!lead.contrato_waiver_firmado_at,
      media:    !!lead.contrato_media_firmado_at,
    };
    firmadosAhora[tipo] = true;
    const todosObligatorios = OBLIGATORIOS.every(t => firmadosAhora[t]);

    if (todosObligatorios) {
      await admin.from('interacciones').insert({
        lead_id: leadId,
        tipo: 'todos_contratos_firmados',
        canal: 'ghl',
        direccion: 'inbound',
        ocurrio_at: new Date().toISOString(),
      });
      resultado += ' · todos_obligatorios_completos';
    }

    return new Response(
      JSON.stringify({
        ok: true,
        lead_id: leadId,
        resultado,
        tipo,
        via,
        raw_tipo_recibido: raw,
        firmados: firmadosAhora,
        todos_obligatorios_firmados: todosObligatorios,
      }),
      { status: httpStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    errorMsg = errToStr(err);
    console.error('[webhook-firma] error:', err);
    if (httpStatus === 200) httpStatus = 500;
    return new Response(
      JSON.stringify({ ok: false, error: errorMsg }),
      { status: httpStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } finally {
    if (logId !== null) {
      await admin.from('webhook_log').update({
        http_status: httpStatus,
        resultado,
        error: errorMsg,
        lead_id: leadId,
      }).eq('id', logId);
    }
  }
});
