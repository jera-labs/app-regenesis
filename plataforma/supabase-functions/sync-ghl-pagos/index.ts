// ============================================================================
// EDGE FUNCTION: sync-ghl-pagos (v14)
//
// Sincroniza pagos desde GoHighLevel hacia la tabla `pagos`. Idempotente y
// auto-sanador (converge al estado real de GHL en cada corrida).
//
// MODELO (failure-driven, validado contra datos reales):
//   - succeeded -> fila `pagado`.
//   - failed    -> fila `atrasado` SOLO si esta SIN resolver. Un fallo esta
//                  resuelto si el lead tiene un cobro `succeeded` con fecha
//                  >= la del fallo (reintento de tarjeta que luego paso).
//                  Los fallos resueltos entran como `perdonado` (no se adeudan,
//                  no cuentan como ingreso ni como vencido).
//   - Barrido por corrida: si el ultimo intento del lead fue `succeeded`,
//     cualquier `atrasado` viejo se marca `perdonado` y se saca de cobranza.
//     Si hay fallos sin resolver y es transicion nueva, se mete a cobranza.
//
// SEGURIDAD: el alta/baja automatica en el workflow de cobranza solo ocurre
// si COBRANZA_AUTO=on (o body.cobranza_auto). Default OFF: solo registra datos.
//
// NOTA: NO usa @supabase/supabase-js (deploy via Management API no soporta
// imports remotos). Requests directas a la REST API de Supabase.
// ============================================================================

const ALLOWED_ORIGINS = new Set([
  'https://plataforma.neurohackers.cloud',
  'https://neurohackers.cloud',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://plataforma.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

interface GhlTransaction {
  _id: string;
  contactId: string;
  contactEmail: string;
  contactName?: string;
  amount: number;
  currency: string;
  status: string;
  liveMode?: boolean;
  entityType?: string;
  entityId?: string;
  entitySourceName?: string;
  entitySourceId?: string;
  chargeId?: string;
  createdAt: string;
  updatedAt?: string;
}

async function ghlTransactions(contactId: string, apiKey: string, locationId: string): Promise<GhlTransaction[]> {
  const url = new URL(`${GHL_API_BASE}/payments/transactions`);
  url.searchParams.set('altId', locationId);
  url.searchParams.set('altType', 'location');
  url.searchParams.set('contactId', contactId);
  url.searchParams.set('limit', '100');

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': GHL_VERSION,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GHL ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json();
  return body?.data || [];
}

// Mete (POST) o saca (DELETE) un contacto de un workflow GHL.
// En DELETE, un 404 significa "no estaba en el workflow" -> no es error.
async function ghlSetWorkflow(method: 'POST' | 'DELETE', contactId: string, workflowId: string, apiKey: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}/workflow/${workflowId}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Version': GHL_VERSION,
      'Content-Type': 'application/json',
    },
    body: method === 'POST' ? JSON.stringify({}) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`GHL workflow ${method} ${res.status}: ${t.slice(0, 150)}`);
  }
  return { ok: res.ok, status: res.status };
}

// Mini-cliente REST para Supabase usando fetch nativo
function makeSb(url: string, key: string) {
  const base = url.replace(/\/$/, '');
  async function rest(path: string, opts: any = {}) {
    const headers: Record<string, string> = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    const res = await fetch(`${base}/rest/v1/${path}`, { ...opts, headers });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err: any = new Error(data?.message || data?.error_description || data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }
  return {
    select: (table: string, query: string = '*', filters: Record<string, string> = {}, prefer?: string) => {
      const params = new URLSearchParams();
      params.set('select', query);
      for (const [k, v] of Object.entries(filters)) params.set(k, v);
      const h: Record<string, string> = {};
      if (prefer) h['Prefer'] = prefer;
      return rest(`${table}?${params.toString()}`, { method: 'GET', headers: h });
    },
    insert: (table: string, row: any) => rest(table, {
      method: 'POST', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(row),
    }),
    update: (table: string, filters: Record<string, string>, patch: any) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) params.set(k, v);
      return rest(`${table}?${params.toString()}`, {
        method: 'PATCH', headers: { 'Prefer': 'return=representation' }, body: JSON.stringify(patch),
      });
    },
    authUser: async (token: string) => {
      const res = await fetch(`${base}/auth/v1/user`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return await res.json();
    },
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const ghlApiKey = Deno.env.get('GHL_API_KEY');
  const ghlLocationId = Deno.env.get('GHL_LOCATION_ID');

  if (!ghlApiKey || !ghlLocationId) {
    return new Response(JSON.stringify({ error: 'Faltan secrets GHL_API_KEY / GHL_LOCATION_ID' }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // BYPASS para cron / edge-to-edge: si llega x-cron-secret valido,
  // saltamos JWT + verificacion de admin. Permite cron horario via cola_jobs.
  const cronSecret = Deno.env.get('CRON_SECRET') || '';
  const receivedCronSecret = req.headers.get('x-cron-secret') || '';
  const esCron = !!cronSecret && receivedCronSecret === cronSecret;

  const sbAdmin = makeSb(supabaseUrl, serviceRole);

  if (!esCron) {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const sbAnon = makeSb(supabaseUrl, anonKey);
    const user = await sbAnon.authUser(token);
    if (!user?.email) {
      return new Response(JSON.stringify({ error: 'Token invalido' }), {
        status: 401, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    const adminRows = await sbAdmin.select('usuarios_admin', 'id,rol', {
      'email': `eq.${user.email}`,
      'activo': 'eq.true',
    });
    if (!adminRows || adminRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Solo admin/moderador puede sincronizar' }), {
        status: 403, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  }

  const body = await req.json().catch(() => ({}));
  const targetLeadId: string | null = body?.lead_id || null;
  const syncAll: boolean = !!body?.all;

  if (!targetLeadId && !syncAll) {
    return new Response(JSON.stringify({ error: 'Falta lead_id o all=true' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Flag de cobranza automatica: OFF por default. Activable via secret
  // COBRANZA_AUTO=on o por body { cobranza_auto: true } (pruebas puntuales).
  const cobranzaAuto = ((Deno.env.get('COBRANZA_AUTO') || '').toLowerCase() === 'on') || body?.cobranza_auto === true;

  // Workflow de cobranza: se lee de reglas_automatizacion (no se hardcodea).
  let cobranzaWfId: string | null = null;
  try {
    const reglas = await sbAdmin.select('reglas_automatizacion', 'ghl_workflow_id', {
      'evento': 'eq.cuota_atrasada',
      'ghl_workflow_id': 'not.is.null',
    });
    cobranzaWfId = reglas?.[0]?.ghl_workflow_id || null;
  } catch { /* si falla, cobranzaWfId queda null y solo se registran datos */ }

  // Cargar leads
  const filtros: Record<string, string> = { 'ghl_contact_id': 'not.is.null' };
  if (targetLeadId) filtros['id'] = `eq.${targetLeadId}`;
  else filtros['estado'] = 'neq.perdido';

  const leads = await sbAdmin.select('leads', 'id,ghl_contact_id,email,nombre,estado', filtros);

  if (!leads || leads.length === 0) {
    return new Response(JSON.stringify({
      ok: true,
      mensaje: targetLeadId ? 'El lead no tiene ghl_contact_id o no existe' : 'Sin leads para sincronizar',
      leads_procesados: 0,
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const reporte: any[] = [];
  let totalInsertados = 0;
  let totalYaExistentes = 0;
  let totalErrores = 0;
  let totalAtrasados = 0;
  let totalResueltos = 0;
  let totalCobranzaDetenida = 0;
  let totalCobranzaIniciada = 0;
  const statusesGlobal: Record<string, number> = {};

  for (const lead of leads) {
    const item: any = { lead_id: lead.id, email: lead.email, insertados: 0, ya_existentes: 0 };
    try {
      const txs = await ghlTransactions(lead.ghl_contact_id, ghlApiKey, ghlLocationId);

      // Diagnostico: tally de status
      const statusTally: Record<string, number> = {};
      for (const t of txs) {
        statusTally[t.status] = (statusTally[t.status] || 0) + 1;
        statusesGlobal[t.status] = (statusesGlobal[t.status] || 0) + 1;
      }
      item.statuses = statusTally;

      const succeeded = txs.filter(t => t.status === 'succeeded');
      const failed = txs.filter(t => t.status === 'failed');
      succeeded.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // Ultimo cobro exitoso (ISO comparable lexicograficamente).
      const latestSucceededAt = succeeded.length ? succeeded[succeeded.length - 1].createdAt : null;
      // Un fallo esta resuelto si hubo un succeeded en su fecha o despues.
      const estaResuelto = (ft: GhlTransaction) => latestSucceededAt != null && latestSucceededAt >= ft.createdAt;
      const fallosSinResolver = failed.filter(ft => !estaResuelto(ft));
      const debeEstarEnCobranza = fallosSinResolver.length > 0;

      // Pagos existentes (incluye estado para detectar atrasados abiertos)
      const pagosExistentes = await sbAdmin.select('pagos', 'id,referencia_externa,numero_cuota,estado', {
        'lead_id': `eq.${lead.id}`,
        'referencia_externa': 'not.is.null',
      });
      const refsExistentes = new Set((pagosExistentes || []).map((p: any) => p.referencia_externa));
      const teniaAtrasadoAbierto = (pagosExistentes || []).some((p: any) => p.estado === 'atrasado');

      // Finanzas snapshot
      const finanzasRows = await sbAdmin.select('cliente_finanzas_programa', 'id,cuotas_pactadas', {
        'lead_id': `eq.${lead.id}`,
      });
      const finanzas = finanzasRows?.[0] || null;

      let maxNumero = 0;
      for (const p of (pagosExistentes || [])) {
        if (p.numero_cuota && p.numero_cuota > maxNumero) maxNumero = p.numero_cuota;
      }
      let proximoNumero = maxNumero + 1;

      // ---- 1. succeeded -> pagado --------------------------------------------
      for (const tx of succeeded) {
        if (refsExistentes.has(tx._id)) {
          item.ya_existentes++;
          totalYaExistentes++;
          continue;
        }
        let tipo = 'cuota';
        let numeroCuota: number | null = proximoNumero;
        if (finanzas && proximoNumero > (finanzas.cuotas_pactadas || 1)) {
          tipo = 'upsell';
          numeroCuota = null;
        }
        try {
          await sbAdmin.insert('pagos', {
            lead_id: lead.id,
            finanzas_id: finanzas?.id || null,
            numero_cuota: numeroCuota,
            tipo,
            monto_usd: Number(tx.amount),
            fecha_programada: tx.createdAt ? tx.createdAt.slice(0, 10) : null,
            estado: 'pagado',
            fecha_pagado_at: tx.createdAt,
            metodo_pago: 'stripe_ghl',
            referencia_externa: tx._id,
            notas: tx.entitySourceName ? `Importado desde GHL: ${tx.entitySourceName}` : 'Importado desde GHL',
            metadata: {
              ghl_charge_id: tx.chargeId,
              ghl_entity_id: tx.entityId,
              ghl_entity_source_name: tx.entitySourceName,
              ghl_currency: tx.currency,
            },
          });
          item.insertados++;
          totalInsertados++;
          refsExistentes.add(tx._id);
          if (tipo === 'cuota') proximoNumero++;
        } catch (insErr: any) {
          item.errores = (item.errores || []).concat([insErr.message || String(insErr)]);
          totalErrores++;
        }
      }

      // ---- 2. failed -> atrasado (sin resolver) o perdonado (resuelto) -------
      for (const tx of failed) {
        if (refsExistentes.has(tx._id)) continue;
        const resuelto = estaResuelto(tx);
        const monto = Number(tx.amount);
        try {
          await sbAdmin.insert('pagos', {
            lead_id: lead.id,
            finanzas_id: finanzas?.id || null,
            numero_cuota: null,
            tipo: 'cuota',
            monto_usd: monto > 0 ? monto : 0.01, // CHECK monto_usd > 0
            fecha_programada: tx.createdAt ? tx.createdAt.slice(0, 10) : null,
            estado: resuelto ? 'perdonado' : 'atrasado',
            metodo_pago: 'stripe_ghl',
            referencia_externa: tx._id,
            notas: resuelto
              ? 'Cobro fallido en GHL resuelto por cobro posterior'
              : 'Cobro fallido en GHL (tarjeta rechazada)',
            metadata: {
              ghl_charge_id: tx.chargeId,
              ghl_status: tx.status,
              ghl_currency: tx.currency,
              origen: 'failed_charge',
              resuelto_al_importar: resuelto,
            },
          });
          if (resuelto) totalResueltos++; else { item.atrasados = (item.atrasados || 0) + 1; totalAtrasados++; }
          refsExistentes.add(tx._id);
        } catch (failErr: any) {
          item.errores = (item.errores || []).concat([`failed:${failErr.message || failErr}`]);
          totalErrores++;
        }
      }

      // ---- 3. Barrido de convergencia ---------------------------------------
      if (!debeEstarEnCobranza && teniaAtrasadoAbierto) {
        // Ultimo intento fue exitoso: sanar atrasados viejos + frenar cobranza.
        try {
          await sbAdmin.update('pagos',
            { 'lead_id': `eq.${lead.id}`, 'estado': 'eq.atrasado' },
            { estado: 'perdonado', updated_at: new Date().toISOString() });
          item.atrasados_sanados = true;
          if (cobranzaAuto && cobranzaWfId) {
            const r = await ghlSetWorkflow('DELETE', lead.ghl_contact_id, cobranzaWfId, ghlApiKey);
            item.cobranza_detenida = true;
            item.cobranza_delete_status = r.status;
            totalCobranzaDetenida++;
          }
        } catch (recErr: any) {
          item.errores = (item.errores || []).concat([`sanar:${recErr.message || recErr}`]);
          totalErrores++;
        }
      } else if (debeEstarEnCobranza && !teniaAtrasadoAbierto) {
        // Transicion nueva a vencido: meter a cobranza UNA vez (si flag ON).
        if (cobranzaAuto && cobranzaWfId) {
          try {
            await ghlSetWorkflow('POST', lead.ghl_contact_id, cobranzaWfId, ghlApiKey);
            item.cobranza_iniciada = true;
            totalCobranzaIniciada++;
          } catch (addErr: any) {
            item.errores = (item.errores || []).concat([`cobranza:${addErr.message || addErr}`]);
            totalErrores++;
          }
        }
      }

      if (succeeded.length === 0 && failed.length === 0) {
        item.mensaje = 'Sin transacciones succeeded/failed en GHL';
      }
      reporte.push(item);
    } catch (e: any) {
      item.error = e.message || String(e);
      totalErrores++;
      reporte.push(item);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    leads_procesados: leads.length,
    pagos_insertados: totalInsertados,
    pagos_ya_existentes: totalYaExistentes,
    atrasados_sin_resolver: totalAtrasados,
    fallos_resueltos: totalResueltos,
    cobranza_detenida: totalCobranzaDetenida,
    cobranza_iniciada: totalCobranzaIniciada,
    cobranza_auto: cobranzaAuto,
    cobranza_workflow_id: cobranzaWfId,
    statuses_vistos: statusesGlobal,
    errores: totalErrores,
    reporte,
  }), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
