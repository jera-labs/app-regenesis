// ============================================================================
// EDGE FUNCTION: monitor-health
//
// Llama a `verificar_salud_sistema()` y, si hay alertas, envía un POST a la
// URL configurada en el secret `ALERT_WEBHOOK_URL`. Si el secret no está
// configurado, solo se registran las alertas en la tabla alertas_log
// (la verificación sigue siendo útil, solo no se notifica externamente).
//
// Pensado para ser invocado por pg_cron una vez al día. También se puede
// llamar manualmente desde admin para hacer un "health check ahora".
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  'https://neurohackers.cloud',
  'https://www.neurohackers.cloud',
  'https://regenesis.hubnativo.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function escapeHtml(s: any): string {
  // Telegram HTML solo permite ciertos tags; escapar todo lo demás
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const alertWebhookUrl = Deno.env.get('ALERT_WEBHOOK_URL'); // opcional
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  try {
    // 1. Chequeo de salud
    const { data: salud, error: rpcErr } = await admin.rpc('verificar_salud_sistema');
    if (rpcErr) throw rpcErr;

    const alertas = (salud as any)?.alertas || [];
    const alertasDetectadas = alertas.length;
    let notificacionEnviada = false;
    let webhookError: string | null = null;
    let canalUsado: string | null = null;

    const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const tgChatId = Deno.env.get('TELEGRAM_CHAT_ID');

    // 2. Si hay alertas, enviar notificación. Preferimos Telegram si está
    //    configurado (formato HTML rico), si no, webhook genérico.
    if (alertasDetectadas > 0) {
      const severidadMax = alertas.reduce((max: string, a: any) => {
        if (a.severidad === 'critical') return 'critical';
        if (a.severidad === 'warning' && max !== 'critical') return 'warning';
        return max;
      }, 'info');

      if (tgToken && tgChatId) {
        // ----- TELEGRAM (preferido) -----
        try {
          const icon = severidadMax === 'critical' ? '🚨'
                     : severidadMax === 'warning'  ? '⚠️'
                     : 'ℹ️';

          const partes: string[] = [];
          partes.push(`${icon} <b>Re-Génesis — ${alertasDetectadas} ${alertasDetectadas === 1 ? 'alerta' : 'alertas'}</b>`);
          partes.push('');
          for (const a of alertas) {
            const sevIcon = a.severidad === 'critical' ? '🔴'
                          : a.severidad === 'warning'  ? '🟠'
                          : '🔵';
            partes.push(`${sevIcon} <b>${escapeHtml(a.tipo)}</b>`);
            partes.push(escapeHtml(a.mensaje));

            // Si trae lista de leads, mostrarlos compactos
            const leads = a.detalle?.leads;
            if (Array.isArray(leads) && leads.length > 0) {
              for (const l of leads.slice(0, 8)) {
                const meta = l.horas_desde_pago != null
                  ? ` (${l.horas_desde_pago}h)`
                  : '';
                partes.push(`  • ${escapeHtml(l.nombre || '?')} — ${escapeHtml(l.email || '?')}${meta}`);
              }
              if (leads.length > 8) {
                partes.push(`  … y ${leads.length - 8} más`);
              }
            }
            partes.push('');
          }
          partes.push(`<a href="https://neurohackers.cloud/admin.html">Abrir admin</a>`);

          const text = partes.join('\n');

          const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: tgChatId,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: true,
            }),
          });

          if (r.ok) {
            notificacionEnviada = true;
            canalUsado = 'telegram';
          } else {
            webhookError = `Telegram HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`;
          }
        } catch (e) {
          webhookError = `telegram exception: ${e instanceof Error ? e.message : String(e)}`;
        }
      } else if (alertWebhookUrl) {
        // ----- WEBHOOK GENÉRICO (fallback) -----
        try {
          const payload = {
            proyecto: 'Re-Génesis',
            ambiente: 'production',
            fecha: (salud as any).fecha,
            timestamp: (salud as any).now,
            total_alertas: alertasDetectadas,
            severidad_max: severidadMax,
            alertas: alertas.map((a: any) => ({
              tipo: a.tipo,
              severidad: a.severidad,
              mensaje: a.mensaje,
              detalle: a.detalle,
            })),
            enlaces: { admin: 'https://neurohackers.cloud/admin.html' },
          };

          const r = await fetch(alertWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (r.ok) {
            notificacionEnviada = true;
            canalUsado = 'webhook';
          } else {
            webhookError = `Webhook HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
          }
        } catch (e) {
          webhookError = e instanceof Error ? e.message : String(e);
        }
      }

      if (notificacionEnviada) {
        await admin
          .from('alertas_log')
          .update({ notificacion_enviada_at: new Date().toISOString() })
          .is('notificacion_enviada_at', null)
          .gte('created_at', new Date(Date.now() - 60_000).toISOString());
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      alertas_detectadas: alertasDetectadas,
      notificacion_enviada: notificacionEnviada,
      canal: canalUsado,
      telegram_configurado: !!(tgToken && tgChatId),
      webhook_configurado: !!alertWebhookUrl,
      error: webhookError,
      detalle: salud,
    }), {
      status: 200,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('monitor-health error:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  }
});
