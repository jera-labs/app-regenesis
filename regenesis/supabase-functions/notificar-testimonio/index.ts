// ============================================================================
// notificar-testimonio
// ----------------------------------------------------------------------------
// Cuando llega un testimonio nuevo (trigger SQL), envía notificación a Frank
// via Telegram. Body: { testimonio_id }
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET
// ============================================================================

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
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  if (res.status === 204) return null;
  return res.json();
}

async function telegram(text: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    console.warn('Telegram no configurado, skip notificación');
    return { skipped: true };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
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
    const id = body.testimonio_id;
    if (!id) {
      return new Response(JSON.stringify({ error: 'falta testimonio_id' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Leer testimonio + lead
    const rows: any[] = await sb(
      `/testimonios?id=eq.${id}&select=id,momento,calificacion,recomendaria,testimonio_escrito,testimonio_video_path,duracion_segundos,tema_orden_al_grabar,lead:lead_id (nombre, email)`
    );
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: false, error: 'testimonio no encontrado' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }
    const t = rows[0];

    const MOMENTO_LABEL: Record<string,string> = {
      mitad_programa: '🎯 Mitad del programa',
      final_programa: '🏁 Final del programa',
      espontaneo: '✨ Espontáneo',
    };
    const momento = MOMENTO_LABEL[t.momento] || t.momento;
    const nombre = t.lead?.nombre || t.lead?.email || 'Cliente';
    const stars = '⭐'.repeat(t.calificacion || 0);
    const tipo = t.testimonio_video_path ? '🎥 Video' : (t.testimonio_escrito ? '📝 Texto' : 'sin contenido');
    const duracion = t.duracion_segundos ? `${Math.round(t.duracion_segundos)}s` : '';

    const linkAdmin = `https://plataforma.neurohackers.cloud/admin/cliente.html?id=${rows[0].lead_id || ''}`;

    const msg = [
      `<b>💎 Nuevo testimonio recibido</b>`,
      ``,
      `<b>${nombre}</b>`,
      `${momento}`,
      `${tipo} ${duracion}`,
      stars ? `Calificación: ${stars}` : '',
      t.recomendaria !== null ? `Recomienda: ${t.recomendaria ? 'Sí ✓' : 'No ✗'}` : '',
      ``,
      t.testimonio_escrito ? `<i>"${(t.testimonio_escrito || '').slice(0, 200)}${t.testimonio_escrito.length > 200 ? '...' : ''}"</i>` : '',
      ``,
      `👉 <a href="${linkAdmin}">Ver y aprobar</a>`,
    ].filter(Boolean).join('\n');

    const tgRes = await telegram(msg);

    return new Response(JSON.stringify({ ok: true, telegram: tgRes }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
