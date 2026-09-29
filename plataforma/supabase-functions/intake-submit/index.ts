// ============================================================================
// EDGE FUNCTION: intake-submit
//
// Recibe el envío del FORMULARIO PÚBLICO de seguros (insurance.neurohackers.cloud)
// y lo aterriza en la sub-cuenta GHL del agente correspondiente.
//
// Flujo:
//   1. Anti-spam: honeypot + validación mínima + rate-limit por IP (hash).
//   2. Resuelve slug -> agente (service_role). El browser solo manda un `slug`
//      opaco; el ghl_location_id y el PIT se resuelven server-side -> nadie puede
//      escribir a una sub-cuenta arbitraria.
//   3. Upsert del contacto en la sub-cuenta GHL del agente (PIT de AGENCIA) con
//      campos estándar + tags + custom fields (si existen/mapean).
//   4. Crea una NOTA con TODO el intake (entrega garantizada y legible al CRM,
//      aunque la sub-cuenta no tenga custom fields configurados).
//   5. Espeja el envío en `intake_submissions` (estado sincronizado|error_ghl).
//
// PÚBLICA: verify_jwt = false. El gate de seguridad es slug + honeypot + rate-limit.
// Secretos: GHL_PIT_AGENCY (PIT de agencia, escribe en cualquier sub-cuenta).
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_BASE = 'https://services.leadconnectorhq.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const RATE_LIMIT_MAX = 5;        // máx envíos
const RATE_LIMIT_MIN = 10;       // por ventana de minutos por IP

const ALLOWED_ORIGINS = new Set([
  'https://insurance.neurohackers.cloud',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://insurance.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Headers para la API oficial de GHL (User-Agent evita el 403 de Cloudflare).
function ghlHeaders(pit: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${pit}`,
    'Version': '2021-07-28',
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': UA,
  };
}

// Normaliza un nombre/fieldKey de custom field para emparejar con nuestras claves seguro_*.
function normKey(s: string): string {
  return String(s || '').toLowerCase().replace(/^contact\./, '').replace(/[^a-z0-9]/g, '');
}

const GHL_TOKEN_URL = 'https://services.leadconnectorhq.com/oauth/token';

// Resuelve el token de GHL del agente con prioridad: OAuth (ghl_connections, con
// auto-refresh) -> PIT del agente -> PIT de agencia (fallback de lectura).
// Si el refresh falla, marca la conexión error_refresh y cae al PIT.
async function resolverTokenGHL(supabase: any, agente: any): Promise<string> {
  const pitFallback = (agente.ghl_pit || Deno.env.get('GHL_PIT_AGENCY') || '');

  const { data: conn } = await supabase
    .from('ghl_connections')
    .select('id, access_token, refresh_token, expires_at')
    .eq('agente_id', agente.id)
    .eq('estado', 'activo')
    .maybeSingle();
  if (!conn) return pitFallback;

  // token aún válido (margen de 60s)
  if (new Date(conn.expires_at).getTime() > Date.now() + 60_000) return conn.access_token;

  const clientId = Deno.env.get('GHL_OAUTH_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GHL_OAUTH_CLIENT_SECRET') || '';
  if (!clientId || !clientSecret) return conn.access_token || pitFallback;

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      user_type: 'Location',
    });
    const r = await fetch(GHL_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body,
    });
    if (!r.ok) throw new Error(`refresh ${r.status}`);
    const t = await r.json();
    const expiresAt = new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString();
    await supabase.from('ghl_connections').update({
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? conn.refresh_token,
      expires_at: expiresAt,
    }).eq('id', conn.id);
    return t.access_token;
  } catch (e) {
    console.error('GHL refresh fallo, cae a PIT:', e);
    await supabase.from('ghl_connections').update({ estado: 'error_refresh' }).eq('id', conn.id);
    return pitFallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const PIT_FALLBACK = Deno.env.get('GHL_PIT_AGENCY') || '';   // agencia: solo lectura (fallback)
  if (!SUPABASE_URL || !SERVICE_KEY) return json(req, { error: 'server_misconfig' }, 500);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let payload: any;
  try { payload = await req.json(); } catch { return json(req, { error: 'bad_json' }, 400); }

  // --- 1) Anti-spam: honeypot (campo oculto `website`) ---
  if (payload?.website) return json(req, { ok: true });   // bot: 200 silencioso, no inserta

  const slug = String(payload?.slug || '').trim().toLowerCase();
  const contacto = payload?.contacto || {};
  const nombre = String(contacto.nombre || '').trim();
  const email = String(contacto.email || '').trim();
  const telefono = String(contacto.telefono || '').trim();
  const tipo = String(payload?.tipo_seguro || '').trim();
  const consentimiento = payload?.consentimiento === true;

  // --- validación mínima ---
  if (!slug) return json(req, { error: 'slug_requerido' }, 400);
  if (!nombre || (!email && !telefono) || !tipo) return json(req, { error: 'campos_minimos' }, 400);
  if (!consentimiento) return json(req, { error: 'consentimiento_requerido' }, 400);
  if (JSON.stringify(payload).length > 20000) return json(req, { error: 'payload_grande' }, 413);

  // --- rate-limit por IP ---
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'desconocida';
  const ipHash = await sha256(ip);
  const desde = new Date(Date.now() - RATE_LIMIT_MIN * 60_000).toISOString();
  const { count: recientes } = await supabase
    .from('intake_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('created_at', desde);
  if ((recientes ?? 0) >= RATE_LIMIT_MAX) return json(req, { error: 'demasiados_envios' }, 429);

  // --- 2) slug -> agente (la location y el PIT NUNCA tocan el browser) ---
  const { data: agente } = await supabase
    .from('agentes')
    .select('id, ghl_location_id, activo, ghl_cf_map, ghl_pit')
    .eq('slug', slug)
    .maybeSingle();
  if (!agente || !agente.activo) return json(req, { error: 'agente_no_encontrado' }, 404);

  const locationId = agente.ghl_location_id;
  // Token GHL: OAuth (con auto-refresh) -> PIT del agente -> PIT de agencia.
  const pit = await resolverTokenGHL(supabase, agente);

  // --- arma el resumen legible (nota) y los datos a guardar ---
  const det = payload?.detalles || {};
  const cob = payload?.cobertura || {};
  const tipoLabel: Record<string, string> = {
    auto: 'Auto', hogar: 'Hogar', vida: 'Vida', salud: 'Salud', comercial: 'Comercial',
  };
  const lineas: string[] = [];
  lineas.push(`SOLICITUD DE SEGURO — ${tipoLabel[tipo] || tipo}`);
  lineas.push('');
  lineas.push('CONTACTO');
  lineas.push(`• Nombre: ${nombre}`);
  if (telefono) lineas.push(`• Teléfono/WhatsApp: ${telefono}`);
  if (email) lineas.push(`• Email: ${email}`);
  if (contacto.ciudad) lineas.push(`• Ciudad: ${contacto.ciudad}`);
  if (contacto.codigo_postal) lineas.push(`• Código postal: ${contacto.codigo_postal}`);
  if (contacto.horario) lineas.push(`• Mejor horario para contactar: ${contacto.horario}`);
  if (Object.keys(det).length) {
    lineas.push('');
    lineas.push(`DETALLES (${tipoLabel[tipo] || tipo})`);
    for (const [k, v] of Object.entries(det)) {
      if (v === '' || v === null || v === undefined) continue;
      lineas.push(`• ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  if (Object.keys(cob).length) {
    lineas.push('');
    lineas.push('COBERTURA ACTUAL');
    for (const [k, v] of Object.entries(cob)) {
      if (v === '' || v === null || v === undefined) continue;
      lineas.push(`• ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
  }
  lineas.push('');
  lineas.push('Consentimiento de comunicación: SÍ');
  lineas.push('Origen: insurance.neurohackers.cloud');
  const notaBody = lineas.join('\n');

  // separa nombre en first/last
  const parts = nombre.split(/\s+/);
  const firstName = parts.shift() || nombre;
  const lastName = parts.join(' ');

  // --- guarda el espejo PRIMERO (no perder el lead aunque GHL falle) ---
  const { data: subRow, error: subErr } = await supabase
    .from('intake_submissions')
    .insert({
      agente_id: agente.id,
      nombre_contacto: nombre,
      email_contacto: email || null,
      telefono_contacto: telefono || null,
      tipo_seguro: tipo,
      datos: { contacto, tipo_seguro: tipo, detalles: det, cobertura: cob, consentimiento: true },
      ip_hash: ipHash,
      estado: 'recibido',
    })
    .select('id')
    .single();
  if (subErr) {
    console.error('insert intake_submissions error:', subErr);
    return json(req, { error: 'db_error' }, 500);
  }

  // --- 3) custom fields: usa el cache; si vacío, resuelve y cachea (best-effort) ---
  const OUR_KEYS = ['seguro_tipo', 'seguro_aseguradora_actual', 'seguro_vencimiento', 'seguro_prima_actual'];
  let cfMap: Record<string, string> = agente.ghl_cf_map || {};
  try {
    if (!cfMap || Object.keys(cfMap).length === 0) {
      const r = await fetch(`${GHL_BASE}/locations/${locationId}/customFields`, { headers: ghlHeaders(pit) });
      if (r.ok) {
        const list = (await r.json())?.customFields || [];
        const resolved: Record<string, string> = {};
        for (const key of OUR_KEYS) {
          const want = normKey(key);
          const hit = list.find((f: any) => normKey(f.fieldKey || '') === want || normKey(f.name || '') === want);
          if (hit?.id) resolved[key] = hit.id;
        }
        if (Object.keys(resolved).length) {
          cfMap = resolved;
          await supabase.from('agentes').update({ ghl_cf_map: resolved }).eq('id', agente.id);
        }
      }
    }
  } catch (e) {
    console.error('cf resolve error (no fatal):', e);
  }

  const customFields: Array<{ id: string; value: string }> = [];
  const cfVals: Record<string, string> = {
    seguro_tipo: tipoLabel[tipo] || tipo,
    seguro_aseguradora_actual: String(cob.aseguradora || ''),
    seguro_vencimiento: String(cob.vencimiento || ''),
    seguro_prima_actual: String(cob.prima || ''),
  };
  for (const [k, id] of Object.entries(cfMap)) {
    const val = cfVals[k];
    if (id && val) customFields.push({ id, value: val });
  }

  // --- upsert del contacto en la sub-cuenta GHL del agente ---
  let ghlContactId: string | null = null;
  let estado = 'error_ghl';
  let errorDetalle: string | null = null;
  try {
    const body: any = {
      locationId,
      firstName,
      lastName,
      name: nombre,
      source: 'Formulario de seguros',
      tags: ['intake-seguros', `tipo:${tipo}`],
    };
    if (email) body.email = email;
    if (telefono) body.phone = telefono;
    if (contacto.ciudad) body.city = String(contacto.ciudad);
    if (contacto.codigo_postal) body.postalCode = String(contacto.codigo_postal);
    if (customFields.length) body.customFields = customFields;

    const up = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: 'POST', headers: ghlHeaders(pit), body: JSON.stringify(body),
    });
    const upData = await up.json().catch(() => ({}));
    if (!up.ok) throw new Error(`upsert ${up.status}: ${JSON.stringify(upData).slice(0, 200)}`);
    ghlContactId = upData?.contact?.id || upData?.id || null;

    // --- 4) nota con TODO el intake (entrega garantizada) ---
    if (ghlContactId) {
      const nr = await fetch(`${GHL_BASE}/contacts/${ghlContactId}/notes`, {
        method: 'POST', headers: ghlHeaders(pit), body: JSON.stringify({ body: notaBody }),
      });
      if (!nr.ok) console.error('nota GHL fallo (no fatal):', nr.status, (await nr.text()).slice(0, 150));
    }
    estado = ghlContactId ? 'sincronizado' : 'error_ghl';
    if (!ghlContactId) errorDetalle = 'upsert sin contact id';
  } catch (e) {
    errorDetalle = e instanceof Error ? e.message : String(e);
    console.error('GHL upsert error:', errorDetalle);
  }

  // --- 5) actualizar el espejo con el resultado ---
  await supabase.from('intake_submissions')
    .update({ estado, ghl_contact_id: ghlContactId, error_detalle: errorDetalle })
    .eq('id', subRow.id);

  // Al asegurado siempre se le responde OK si guardamos el lead (no exponer fallos internos).
  return json(req, { ok: true });
});
