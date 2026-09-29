// ============================================================================
// EDGE FUNCTION: webhook-ghl  (v17, 2026-06-12)
// Recibe POST de GoHighLevel cuando un contacto paga el programa.
// Valida secret en header X-Webhook-Secret, inserta el lead, llama a
// procesar_nuevo_cliente() y devuelve { lead_id, estado }.
//
// v14: normaliza modalidad a lowercase y la valida contra el check constraint
//      ('presencial' | 'virtual'). Antes, si GHL mandaba "Presencial" con
//      mayúscula el webhook devolvía 500 y el lead no se creaba. Ahora se
//      normaliza; valores inválidos quedan en NULL y el admin los completa.
// v15: re-deploy con verify_jwt=false (GHL no tiene JWT, autentica por shared
//      secret X-Webhook-Secret). La v24 deploy automáticamente lo puso en true.
// v16: lee también el custom field cuotas_elegidas_terapia (servicio "Terapia
//      Re-Génesis", que entra al MISMO programa de 70 días que Re-Génesis).
//      Growth Re-Génesis NO pasa por este webhook (no accede a la plataforma
//      terapéutica), por eso su campo no se lee aquí a propósito.
// v17: persiste leads.servicio (regenesis|terapia|growth|crm). Explícito por
//      custom field 'servicio'/'servicio_programa'; si no viene pero el closer
//      marcó cuotas de Terapia, se infiere 'terapia'. Default 'regenesis'.
//      Habilita el gating de plataforma (nav.js solo muestra Re-Génesis a terapia).
//
// verify_jwt = false (GHL no tiene JWT). La autenticación es por shared secret.
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
    try { return JSON.stringify(e); } catch { return '[unserializable error]'; }
  }
  return String(e);
}

// Normaliza modalidad a 'presencial' | 'virtual'. Cualquier otra cosa → null.
// El check constraint leads_modalidad_check NO acepta strings con mayúsculas
// ni alias como 'pago_unico'. Si llega algo raro, dejamos NULL y el admin
// lo completa manualmente desde CRM.
function normalizarModalidad(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().trim();
  if (s === 'presencial' || s === 'presential') return 'presencial';
  if (s === 'virtual' || s === 'online' || s === 'remoto') return 'virtual';
  return null;
}

function parseCuotas(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (s.includes('único') || s.includes('unico') ||
      s.includes('1 cuota') || s.includes('1 pago')) return 1;
  const match = s.match(/(\d+)\s*(cuotas|cuota|pagos|pago)/);
  if (match) {
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function nombreCompleto(payload: any): string | null {
  const directo = pick(payload, 'nombre', 'name', 'full_name', 'fullName',
    'contact.fullName', 'contact.full_name', 'contact.name');
  if (directo) return String(directo).trim();
  const first = pick(payload, 'firstName', 'first_name', 'contact.firstName', 'contact.first_name');
  const last = pick(payload, 'lastName', 'last_name', 'contact.lastName', 'contact.last_name');
  if (first || last) return [first, last].filter(Boolean).join(' ').trim();
  return null;
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
      .insert({ fuente: 'ghl', payload })
      .select('id')
      .single();
    logId = ins.data?.id ?? null;

    if (!expectedSecret) {
      throw new Error('GHL_WEBHOOK_SECRET no está configurado en Supabase Edge Function Secrets');
    }
    const givenSecret = req.headers.get('x-webhook-secret') || pick(payload, 'webhook_secret');
    if (givenSecret !== expectedSecret) {
      httpStatus = 401;
      throw new Error('secret inválido o ausente');
    }

    const email = pick(payload, 'email', 'contact.email');
    const nombre = nombreCompleto(payload);
    if (!email) {
      httpStatus = 400;
      throw new Error('email es requerido');
    }
    if (!nombre) {
      httpStatus = 400;
      throw new Error('nombre o firstName/lastName es requerido');
    }

    const ghlContactId = pick(payload,
      'ghl_contact_id', 'contact_id', 'contact.id', 'contactId', 'id',
      'customData.ghl_contact_id', 'payment.customer.id');
    const telefono = pick(payload,
      'telefono', 'phone', 'contact.phone',
      'customData.phone', 'payment.customer.phone');
    const pais = pick(payload,
      'pais', 'country', 'contact.country',
      'customData.country', 'location.country', 'payment.customer.country');
    const ciudad = pick(payload,
      'ciudad', 'city', 'contact.city',
      'customData.city', 'location.city');
    const fuente = pick(payload, 'fuente', 'source', 'contact.source', 'contact_source');
    const utmSource = pick(payload, 'utm_source', 'utmSource', 'attribution.utmSource', 'customData.utm_source');
    const utmMedium = pick(payload, 'utm_medium', 'utmMedium', 'attribution.utmMedium', 'customData.utm_medium');
    const utmCampaign = pick(payload, 'utm_campaign', 'utmCampaign', 'attribution.utmCampaign', 'customData.utm_campaign');
    const utmTerm = pick(payload, 'utm_term', 'utmTerm', 'customData.utm_term');
    const utmContent = pick(payload, 'utm_content', 'utmContent', 'customData.utm_content');
    const fechaPagoRaw = pick(payload,
      'fecha_pago', 'paidAt',
      'payment.paidAt', 'payment.created_at', 'payment.createdAt',
      'customData.fecha_pago');
    const precioPagado = pick(payload,
      'precio_pagado', 'amount',
      'payment.amount', 'payment.total_amount', 'payment.totalAmount',
      'customData.precio_pagado');

    // ⚠️ Normalización defensiva — ver v14 changelog arriba.
    const modalidadRaw = pick(payload,
      'modalidad', 'modalidad_programa',
      'customData.modalidad', 'customData.modalidad_programa');
    const modalidad = normalizarModalidad(modalidadRaw);

    // v16: aceptamos cuotas_elegidas (Re-Génesis) y cuotas_elegidas_terapia
    // (Terapia Re-Génesis). Ambos servicios comparten el mismo programa de
    // 70 días, así que el lead se trata igual. Growth NO entra por aquí.
    const cuotasRaw = pick(payload,
      'cuotas_elegidas', 'cuotas', 'cuotas_elegidas_terapia',
      'customData.cuotas_elegidas', 'customData.cuotas', 'customData.cuotas_elegidas_terapia');
    const cuotasElegidas = parseCuotas(cuotasRaw);
    const cohorte = pick(payload, 'cohorte', 'customData.cohorte');

    // v17: servicio del cliente (regenesis | terapia | growth | crm). Explícito por
    // custom field 'servicio'/'servicio_programa'; si no viene pero el closer usó el
    // custom field de cuotas de Terapia, se infiere 'terapia'. Default 'regenesis'.
    const servicioRaw = pick(payload, 'servicio', 'servicio_programa',
      'customData.servicio', 'customData.servicio_programa');
    const esTerapiaPorCuotas = !!pick(payload, 'cuotas_elegidas_terapia', 'customData.cuotas_elegidas_terapia');
    const serviciosValidos = ['regenesis', 'terapia', 'growth', 'crm'];
    const servicio = serviciosValidos.includes(String(servicioRaw || '').toLowerCase())
      ? String(servicioRaw).toLowerCase()
      : (esTerapiaPorCuotas ? 'terapia' : 'regenesis');

    const r1 = await admin.from('leads').select('id, estado').eq('email', email).maybeSingle();
    const existing = { data: r1.data };

    const fuentesValidas = ['redes', 'evento', 'referido', 'directo', 'organico', 'pago'];
    const recibidoComoPagoEarly = !!pick(payload, 'fecha_pago', 'paidAt',
      'payment.paidAt', 'payment.created_at', 'payment.createdAt',
      'customData.fecha_pago', 'precio_pagado', 'amount',
      'payment.amount', 'payment.total_amount');
    const fuenteLimpia = (fuente && fuentesValidas.includes(String(fuente).toLowerCase()))
      ? String(fuente).toLowerCase()
      : (recibidoComoPagoEarly ? 'pago' : 'directo');

    let leadRow: any;
    const updates: Record<string, any> = {
      nombre,
      telefono,
      pais,
      ciudad,
      fuente: fuenteLimpia,
      fuente_detalle: 'webhook',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_term: utmTerm,
      utm_content: utmContent,
      ghl_contact_id: ghlContactId ? String(ghlContactId) : null,
      modalidad,
      cuotas_elegidas: Number.isFinite(cuotasElegidas) ? cuotasElegidas : null,
      cohorte,
      servicio,
    };

    for (const k of Object.keys(updates)) {
      if (updates[k] === null || updates[k] === undefined) delete updates[k];
    }

    const recibidoComoPago = !!fechaPagoRaw || !!precioPagado;

    if (existing.data?.id) {
      const upd = await admin
        .from('leads')
        .update({
          ...updates,
          ...(recibidoComoPago ? {
            estado: 'pagado_calentamiento',
            fecha_pago: fechaPagoRaw ? new Date(fechaPagoRaw).toISOString() : new Date().toISOString(),
            precio_pagado: precioPagado ? Number(precioPagado) : null,
          } : {}),
        })
        .eq('id', existing.data.id)
        .select('id')
        .single();
      if (upd.error) throw upd.error;
      leadRow = upd.data;
      resultado = recibidoComoPago ? 'lead_actualizado_y_marcado_pagado' : 'lead_actualizado';
    } else {
      const ins = await admin
        .from('leads')
        .insert({
          email,
          ...updates,
          estado: recibidoComoPago ? 'pagado_calentamiento' : 'lead',
          ...(recibidoComoPago ? {
            fecha_pago: fechaPagoRaw ? new Date(fechaPagoRaw).toISOString() : new Date().toISOString(),
            precio_pagado: precioPagado ? Number(precioPagado) : null,
          } : {}),
        })
        .select('id')
        .single();
      if (ins.error) throw ins.error;
      leadRow = ins.data;
      resultado = recibidoComoPago ? 'lead_creado_y_marcado_pagado' : 'lead_creado';
    }

    leadId = leadRow.id;

    if (recibidoComoPago) {
      const rpc = await admin.rpc('procesar_nuevo_cliente', { p_lead_id: leadId });
      if (rpc.error) throw rpc.error;
    }

    let invitacion = '';
    if (recibidoComoPago) {
      try {
        const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { nombre, lead_id: leadId, fuente: 'ghl' },
        });
        if (invErr) {
          const msg = (invErr.message || '').toLowerCase();
          if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
            invitacion = ' · ya_tenia_cuenta';
          } else {
            invitacion = ' · invite_fallo: ' + invErr.message;
            console.error('inviteUserByEmail error:', invErr);
          }
        } else {
          invitacion = ' · invitacion_enviada';
        }
      } catch (e) {
        console.error('inviteUserByEmail exception:', e);
        invitacion = ' · invite_excepcion';
      }
    }
    if (invitacion) resultado = (resultado || '') + invitacion;

    return new Response(
      JSON.stringify({ ok: true, lead_id: leadId, resultado }),
      { status: httpStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    errorMsg = errToStr(err);
    console.error('[webhook-ghl] error:', err);
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
