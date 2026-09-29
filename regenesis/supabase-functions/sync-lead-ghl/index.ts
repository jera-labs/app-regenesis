// ============================================================================
// sync-lead-ghl
// ----------------------------------------------------------------------------
// Recibe { lead_id } y sincroniza los campos relevantes del lead a custom
// fields del contacto en GHL.
//
// Campos sincronizados:
//   tema_actual           ← leads.tema_actual_orden
//   tema_nombre           ← temas.nombre (resuelto por orden)
//   dia_programa          ← días transcurridos desde fecha_activacion_programa
//   fecha_activacion      ← leads.fecha_activacion_programa
//   fecha_fin_programa    ← leads.fecha_fin_contractual
//   estado_programa       ← lead_estado_comercial.estado
//
// Autenticación: X-Function-Secret (CRON_SECRET o GHL_WEBHOOK_SECRET).
// ============================================================================

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

async function sb(path: string, init: RequestInit = {}) {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      'Content-Type': 'application/json',
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

async function ghlUpdateCustomFields(contactId: string, customFields: Record<string, any>) {
  const body = {
    customFields: Object.entries(customFields).map(([key, value]) => ({ key, field_value: value == null ? '' : String(value) })),
  };
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${Deno.env.get('GHL_API_KEY')}`,
      Version: GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GHL update ${res.status}: ${t}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  const secret = req.headers.get('X-Function-Secret');
  if (secret !== Deno.env.get('CRON_SECRET') && secret !== Deno.env.get('GHL_WEBHOOK_SECRET')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const lead_id = body.lead_id;
    if (!lead_id) {
      return new Response(JSON.stringify({ error: 'falta lead_id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Leer datos del lead
    const leads: any[] = await sb(
      `/leads?id=eq.${lead_id}&select=id,nombre,email,ghl_contact_id,tema_actual_orden,fecha_activacion_programa,fecha_fin_contractual,duracion_contractual_dias`
    );
    if (!leads.length) {
      return new Response(JSON.stringify({ error: 'lead no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const lead = leads[0];

    if (!lead.ghl_contact_id) {
      return new Response(JSON.stringify({ ok: false, mensaje: 'lead sin ghl_contact_id, skip' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Resolver nombre del tema actual
    let temaNombre = '';
    if (lead.tema_actual_orden != null) {
      const temas: any[] = await sb(`/temas?orden=eq.${lead.tema_actual_orden}&select=nombre&limit=1`);
      temaNombre = temas[0]?.nombre || '';
    }

    // 3. Resolver estado comercial
    let estado = '';
    const estados: any[] = await sb(
      `/lead_estado_comercial?lead_id=eq.${lead_id}&select=estado&limit=1`
    );
    estado = estados[0]?.estado || '';

    // 4. Calcular día del programa
    let diaPrograma: number | null = null;
    if (lead.fecha_activacion_programa) {
      const hoy = new Date();
      const inicio = new Date(lead.fecha_activacion_programa);
      diaPrograma = Math.floor((hoy.getTime() - inicio.getTime()) / 86400000) + 1;
      if (diaPrograma < 1) diaPrograma = null;
    }

    const customFields: Record<string, any> = {
      tema_actual: lead.tema_actual_orden ?? '',
      tema_nombre: temaNombre,
      dia_programa: diaPrograma ?? '',
      fecha_activacion: lead.fecha_activacion_programa ?? '',
      fecha_fin_programa: lead.fecha_fin_contractual ?? '',
      estado_programa: estado,
    };

    await ghlUpdateCustomFields(lead.ghl_contact_id, customFields);

    return new Response(JSON.stringify({ ok: true, lead_id, sincronizados: customFields }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
