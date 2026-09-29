// EDGE FUNCTION: admin-acceso-cliente v2
// Permite a admins y moderadores generar:
//   - magic link de acceso (entrar como cliente sin saber su password)
//   - link de reset de password (que el cliente cambie su clave)
// El solicitante DEBE estar en usuarios_admin con rol 'admin' o 'moderador'.
// El link generado NO se envía por email, se devuelve en la respuesta para que
// el operador lo comparta manualmente (WhatsApp, llamada, etc.).
// v2: la auditoría en webhook_log usaba columnas inexistentes (origen/status)
//     y fallaba en silencio; ahora usa fuente/resultado y loguea el error.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function srk(): string {
  return Deno.env.get('LEGACY_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Falta header Authorization' }),
        { status: 200, headers: cors() });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const sbAdmin = createClient(SUPABASE_URL, srk(), { auth: { persistSession: false } });

    // 1) Identificar al solicitante via JWT
    const sbUser = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ ok: false, error: 'JWT inválido o expirado' }),
        { status: 200, headers: cors() });
    }

    // 2) Verificar que el solicitante es admin o moderador
    const { data: solicitante } = await sbAdmin
      .from('usuarios_admin')
      .select('email, nombre, rol, activo')
      .eq('email', user.email)
      .eq('activo', true)
      .maybeSingle();

    if (!solicitante || !['admin', 'moderador'].includes(solicitante.rol)) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Solo admins y moderadores pueden generar enlaces de acceso de clientes.',
      }), { status: 200, headers: cors() });
    }

    // 3) Leer body
    const { lead_id, action, redirect_to } = await req.json().catch(() => ({}));
    if (!lead_id || !action) {
      return new Response(JSON.stringify({ ok: false, error: 'falta lead_id o action' }),
        { status: 200, headers: cors() });
    }
    if (!['magiclink', 'recovery'].includes(action)) {
      return new Response(JSON.stringify({ ok: false, error: 'action debe ser magiclink o recovery' }),
        { status: 200, headers: cors() });
    }

    // 4) Buscar el lead
    const { data: lead } = await sbAdmin
      .from('leads')
      .select('id, email, nombre')
      .eq('id', lead_id)
      .maybeSingle();
    if (!lead || !lead.email) {
      return new Response(JSON.stringify({ ok: false, error: 'Lead no encontrado o sin email' }),
        { status: 200, headers: cors() });
    }

    // 5) Generar link via Supabase Admin API
    const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
      type: action === 'magiclink' ? 'magiclink' : 'recovery',
      email: lead.email,
      options: {
        redirectTo: redirect_to || 'https://plataforma.neurohackers.cloud/',
      },
    });

    if (linkErr || !linkData?.properties?.action_link) {
      return new Response(JSON.stringify({
        ok: false,
        error: linkErr?.message || 'No se pudo generar el link',
      }), { status: 200, headers: cors() });
    }

    // 6) Auditar la acción. OJO: webhook_log usa columnas `fuente` y
    // `resultado` (migración 12). La versión anterior insertaba `origen` y
    // `status` (inexistentes) y el insert fallaba EN SILENCIO: la acción más
    // sensible de la plataforma quedaba sin rastro de auditoría.
    const { error: audErr } = await sbAdmin.from('webhook_log').insert({
      fuente: 'admin-acceso-cliente',
      payload: {
        solicitante_email: solicitante.email,
        solicitante_rol: solicitante.rol,
        lead_id: lead.id,
        lead_email: lead.email,
        action,
      },
      resultado: 'ok',
      lead_id: lead.id,
    });
    if (audErr) {
      // No bloqueamos la operación, pero el fallo de auditoría queda en logs.
      console.error('[admin-acceso-cliente] auditoría no escrita:', audErr.message);
    }

    return new Response(JSON.stringify({
      ok: true,
      mensaje: action === 'magiclink'
        ? `Magic link generado para ${lead.email}. Vencerá en 1 hora. Compártelo solo con quien debe acceder.`
        : `Link de reset de contraseña generado para ${lead.email}. Vencerá en 1 hora. Compártelo para que cambie su clave.`,
      action_link: linkData.properties.action_link,
      lead_email: lead.email,
      lead_nombre: lead.nombre,
      solicitante: solicitante.nombre,
    }), { status: 200, headers: cors() });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Excepción en edge function: ${String((e as Error).message)}`,
    }), { status: 200, headers: cors() });
  }
});
