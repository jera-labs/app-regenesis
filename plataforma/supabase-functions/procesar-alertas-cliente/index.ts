// ============================================================================
// procesar-alertas-cliente
// Llamado por pg_cron cada 15 min (después de evaluar_alertas_todos).
// Toma alertas abiertas sin notificar, y envía push a Telegram al admin asignado
// (o al admin global TELEGRAM_CHAT_ID si no hay mentor asignado).
//
// Headers requeridos:
//   x-cron-secret: <CRON_SECRET>  (validado contra vault)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const TG_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TG_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-cron-secret, content-type",
};

const SEV_EMOJI: Record<string, string> = {
  info: "ℹ️",
  warn: "⚠️",
  alerta: "🚨",
  critica: "🔥",
};

async function sendTelegram(chatId: string, text: string) {
  if (!TG_BOT_TOKEN || !chatId) return { ok: false, reason: "Missing TG token/chat" };
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = await res.json();
  return { ok: res.ok, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const secret = req.headers.get("x-cron-secret") || "";
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-cliente": "procesar-alertas-cliente" } },
  });

  // 1. Re-evaluar (idempotente)
  const { error: evalErr } = await db.rpc("evaluar_alertas_todos");
  if (evalErr) {
    return new Response(JSON.stringify({ error: "eval_failed", detail: evalErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Buscar alertas abiertas sin notificar (severidad >= warn)
  const { data: alertas, error: aErr } = await db
    .from("cliente_alertas")
    .select("id, lead_id, regla_slug, severidad, mensaje, contexto, creada_at, lead:lead_id (nombre, email, modalidad)")
    .eq("estado", "abierta")
    .is("notificada_at", null)
    .in("severidad", ["warn", "alerta", "critica"])
    .order("creada_at", { ascending: true })
    .limit(50);

  if (aErr) {
    return new Response(JSON.stringify({ error: "query_failed", detail: aErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let enviadas = 0, falladas = 0;
  const detalles: any[] = [];

  for (const a of alertas || []) {
    const lead = (a as any).lead;
    const emoji = SEV_EMOJI[a.severidad] || "•";
    const text =
      `${emoji} <b>Alerta ${a.severidad}</b>\n` +
      `<b>${(lead?.nombre || "—")}</b> (${lead?.email || "—"})\n` +
      `${a.mensaje}\n` +
      `<i>regla: ${a.regla_slug}</i>\n` +
      `\nAbrir: https://plataforma.neurohackers.cloud/admin/seguimiento.html?lead_id=${a.lead_id}`;

    // Por ahora enviamos al TG_CHAT_ID global. En el futuro: lookup del mentor
    // asignado vía lead_asignaciones y usuario_admin.telegram_chat_id.
    const tg = await sendTelegram(TG_CHAT_ID, text);
    if (tg.ok) {
      enviadas++;
      await db.from("cliente_alertas")
        .update({ notificada_at: new Date().toISOString(), notificacion_canal: "telegram" })
        .eq("id", a.id);
    } else {
      falladas++;
      console.error("[procesar-alertas] send failed", a.id, tg);
    }
    detalles.push({ id: a.id, regla: a.regla_slug, lead: lead?.nombre, ok: tg.ok });
  }

  return new Response(JSON.stringify({
    ok: true,
    total: (alertas || []).length,
    enviadas,
    falladas,
    detalles: detalles.slice(0, 10),
    timestamp: new Date().toISOString(),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
