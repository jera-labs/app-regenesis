// ============================================================================
// procesar-cola-automatizaciones
// ----------------------------------------------------------------------------
// Lee notificaciones_pendientes con estado='pendiente' y dispara workflows
// GHL para cada una. Diseñado para correr cada 15 min via cron.
//
// Flujo por notificación:
//   1. Actualizar custom values en GHL contact (monto, fecha, etc).
//   2. POST al workflow GHL para disparar el envío real.
//   3. Marcar enviada_at + estado='enviada'.
//   4. Si falla: incrementar intentos, guardar ultimo_error. Reintentar
//      hasta 3 veces. Tras 3 fallos, estado='fallida'.
//
// Headers requeridos para invocar manualmente:
//   X-Function-Secret: <CRON_SECRET>
//
// Secrets que necesita la Edge Function:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (built-in)
//   GHL_API_KEY    (token Bearer de la cuenta de Frank, scope contacts.write workflows.write)
//   GHL_LOCATION_ID
//   CRON_SECRET    (para validar invocaciones)
// ============================================================================

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const MAX_INTENTOS = 3;
const BATCH_SIZE = 25;

interface NotifRow {
  id: string;
  lead_id: string;
  tipo: string;
  regla_slug: string;
  ghl_workflow_id: string | null;
  intentos: number;
  metadata: Record<string, any>;
}

interface ReglaRow {
  slug: string;
  ghl_workflow_id: string | null;
  canal: string;
  template_texto: string | null;
}

// ----- Supabase REST helper (sin SDK para evitar imports remotos) -----------
async function sb(path: string, init: RequestInit = {}) {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase ${res.status}: ${t}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ----- GHL helpers ----------------------------------------------------------
async function ghlUpdateContactCustomFields(contactId: string, customFields: Record<string, any>) {
  const apiKey = Deno.env.get('GHL_API_KEY');
  if (!apiKey) throw new Error('GHL_API_KEY no configurado');
  const body = {
    customFields: Object.entries(customFields).map(([key, value]) => ({ key, field_value: String(value) })),
  };
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GHL contact update ${res.status}: ${t}`);
  }
}

async function ghlAddContactToWorkflow(contactId: string, workflowId: string) {
  const apiKey = Deno.env.get('GHL_API_KEY');
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/workflow/${workflowId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GHL workflow trigger ${res.status}: ${t}`);
  }
}

// ----- Mapeo de regla → custom fields a setear en GHL antes del workflow ----
function customFieldsParaRegla(regla_slug: string, metadata: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (metadata.monto_usd != null)       out.cuota_monto = String(metadata.monto_usd);
  if (metadata.fecha_programada)        out.cuota_fecha = String(metadata.fecha_programada);
  if (metadata.dias_diff != null)       out.dias_atraso = String(Math.abs(metadata.dias_diff));
  if (metadata.numero_cuota != null)    out.cuota_numero = String(metadata.numero_cuota);
  if (metadata.fecha_fin_contractual)   out.fin_programa_fecha = String(metadata.fecha_fin_contractual);
  return out;
}

// ----- Main -----------------------------------------------------------------
Deno.serve(async (req) => {
  // Autenticación: aceptar JWT de admin O X-Function-Secret (para cron)
  const secret = req.headers.get('X-Function-Secret');
  if (secret !== Deno.env.get('CRON_SECRET') && secret !== Deno.env.get('GHL_WEBHOOK_SECRET')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Leer pendientes
    const pendientes: NotifRow[] = await sb(
      `/notificaciones_pendientes?estado=eq.pendiente&intentos=lt.${MAX_INTENTOS}&order=programada_para.asc&limit=${BATCH_SIZE}`
    );

    if (!pendientes || pendientes.length === 0) {
      return new Response(JSON.stringify({ procesadas: 0, mensaje: 'cola vacía' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Cargar todas las reglas activas para resolver workflowId si no viene
    const reglas: ReglaRow[] = await sb(`/reglas_automatizacion?activa=eq.true&select=slug,ghl_workflow_id,canal,template_texto`);
    const reglaMap = new Map(reglas.map((r) => [r.slug, r]));

    const resultados: any[] = [];

    for (const n of pendientes) {
      try {
        // Skip notificaciones legacy sin regla_slug (anteriores a fase 9).
        // Las marcamos 'cancelada' directamente para sacarlas de la cola.
        if (!n.regla_slug) {
          await sb(`/notificaciones_pendientes?id=eq.${n.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'cancelada', ultimo_error: 'notificación legacy sin regla_slug (pre-fase-9), ignorada' }),
          });
          resultados.push({ id: n.id, ok: false, cancelada: true });
          continue;
        }

        const regla = reglaMap.get(n.regla_slug);
        if (!regla) {
          // Regla desactivada o eliminada. Marcar cancelada (no reintentar).
          await sb(`/notificaciones_pendientes?id=eq.${n.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ estado: 'cancelada', ultimo_error: `regla ${n.regla_slug} desactivada o eliminada` }),
          });
          resultados.push({ id: n.id, slug: n.regla_slug, ok: false, cancelada: true });
          continue;
        }
        const workflowId = n.ghl_workflow_id || regla.ghl_workflow_id;
        const ghlContactId = n.metadata?.ghl_contact_id;

        if (!ghlContactId) throw new Error('lead sin ghl_contact_id');
        if (!workflowId)   throw new Error(`regla ${n.regla_slug} sin ghl_workflow_id`);

        // a) Actualizar custom fields del contact
        const cf = customFieldsParaRegla(n.regla_slug, n.metadata || {});
        if (Object.keys(cf).length > 0) {
          await ghlUpdateContactCustomFields(ghlContactId, cf);
        }

        // b) Disparar workflow
        await ghlAddContactToWorkflow(ghlContactId, workflowId);

        // c) Marcar enviada
        await sb(`/notificaciones_pendientes?id=eq.${n.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ estado: 'enviada', enviada_at: new Date().toISOString() }),
        });

        resultados.push({ id: n.id, slug: n.regla_slug, ok: true });
      } catch (err) {
        const nuevoIntentos = (n.intentos || 0) + 1;
        const esFinal = nuevoIntentos >= MAX_INTENTOS;
        await sb(`/notificaciones_pendientes?id=eq.${n.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            intentos: nuevoIntentos,
            ultimo_error: String((err as Error).message).slice(0, 1000),
            estado: esFinal ? 'fallida' : 'pendiente',
          }),
        });
        resultados.push({ id: n.id, slug: n.regla_slug, ok: false, error: String(err) });
      }
    }

    return new Response(JSON.stringify({ procesadas: pendientes.length, resultados }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
