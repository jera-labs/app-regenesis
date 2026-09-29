// ============================================================================
// EDGE FUNCTION: bienvenida-estado
// Endpoint público (sin JWT) que la página /bienvenida.html consulta para
// saber el estado del cliente: nombre, qué firmó, qué falta.
//
// Identifica al lead por ?gid=<ghl_contact_id> (más opaco que email en URL).
// Cuando los 3 contratos obligatorios están firmados (servicio + waiver +
// media), genera un magic link al vuelo para que el cliente entre directo
// al dashboard sin volver a su email.
//
// Lo que se expone es deliberadamente mínimo: nombre, email, paso actual.
// Nada de diario, reflexiones, datos sensibles, etc.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Migración 2026-05-18: el dominio canónico pasa a ser neurohackers.cloud.
// Mantenemos regenesis.hubnativo.com aquí durante el período de transición por
// si quedan magic links o redirects viejos en circulación; lo retiramos cuando
// confirmemos que ya nadie llega por ahí.
const ALLOWED_ORIGINS = new Set([
  'https://plataforma.neurohackers.cloud',
  'https://neurohackers.cloud',
  'https://www.neurohackers.cloud',
  'https://regenesis.hubnativo.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  // Bienvenida se sirve hoy desde plataforma.neurohackers.cloud/regenesis/.
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://plataforma.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  try {
    const url = new URL(req.url);
    const gid = url.searchParams.get('gid');
    const email = url.searchParams.get('email');

    if (!gid && !email) {
      return new Response(
        JSON.stringify({ error: 'falta gid o email en query' }),
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Rate limit por IP para mitigar enumeration de ghl_contact_id.
    // Headers de Supabase Edge Runtime: cf-connecting-ip, x-real-ip, x-forwarded-for.
    const ip = req.headers.get('cf-connecting-ip')
      || req.headers.get('x-real-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || 'unknown';

    const { data: rl } = await admin.rpc('bienvenida_chequear_rate_limit', { p_ip: ip });
    if (rl?.bloqueado) {
      return new Response(
        JSON.stringify({ error: rl.mensaje || 'rate limited' }),
        { status: 429, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    // Cleanup de logs >24h (idempotente, barato)
    try { await admin.rpc('bienvenida_cleanup_logs'); } catch (_) {}

    const query = admin
      .from('leads')
      .select(`id, ghl_contact_id, email, nombre, estado, fecha_pago, modalidad,
               contrato_servicio_firmado_at, contrato_servicio_url,
               contrato_waiver_firmado_at,   contrato_waiver_url,
               contrato_media_firmado_at,    contrato_media_url`)
      .limit(1);

    const { data, error } = gid
      ? await query.eq('ghl_contact_id', gid).maybeSingle()
      : await query.eq('email', email).maybeSingle();

    // Log el intento (con o sin match) para alimentar rate limit
    try {
      await admin.rpc('bienvenida_log_lookup', {
        p_ip: ip, p_gid: gid, p_email: email, p_match: !!data,
      });
    } catch (_) {}

    if (error) throw error;
    if (!data) {
      return new Response(
        JSON.stringify({ error: 'cliente no encontrado · si acabas de pagar, espera 30 segundos' }),
        { status: 404, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    const servicio = !!data.contrato_servicio_firmado_at;
    const waiver   = !!data.contrato_waiver_firmado_at;
    const media    = !!data.contrato_media_firmado_at;
    const todosObligatorios = servicio && waiver && media;

    // Paso actual: el primer obligatorio que falte. Si todos están firmados
    // → 'completado' y se genera magic link.
    let pasoActual: 'servicio' | 'waiver' | 'media' | 'completado';
    if (!servicio)      pasoActual = 'servicio';
    else if (!waiver)   pasoActual = 'waiver';
    else if (!media)    pasoActual = 'media';
    else                pasoActual = 'completado';

    let magicLinkUrl: string | null = null;
    if (todosObligatorios) {
      try {
        // Generamos type=recovery (no magiclink) para que client-app.js detecte
        // el hash type=recovery y muestre la pantalla "Define tu contraseña".
        // Esto garantiza que TODO cliente que pasa por bienvenida.html sale con
        // su contraseña personalizada lista; antes el magic link los entraba
        // directo al dashboard sin password y quedaban dependiendo del magic
        // link para futuras sesiones.
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: data.email,
        });
        if (!linkErr && linkData?.properties?.action_link) {
          magicLinkUrl = linkData.properties.action_link;
        }
      } catch (e) {
        console.error('generateLink error:', e);
      }
    }

    return new Response(
      JSON.stringify({
        lead_id: data.id,
        nombre: data.nombre,
        email: data.email,
        estado: data.estado,
        modalidad: data.modalidad,
        fecha_pago: data.fecha_pago,
        contratos: {
          servicio_firmado: servicio,
          servicio_firmado_at: data.contrato_servicio_firmado_at,
          waiver_firmado: waiver,
          waiver_firmado_at: data.contrato_waiver_firmado_at,
          media_firmado: media,
          media_firmado_at: data.contrato_media_firmado_at,
        },
        paso_actual: pasoActual,
        todos_firmados: todosObligatorios,
        // Backwards compat para clientes legacy del frontend
        ambos_firmados: todosObligatorios,
        magic_link: magicLinkUrl,
      }),
      { status: 200, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('bienvenida-estado error:', msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
