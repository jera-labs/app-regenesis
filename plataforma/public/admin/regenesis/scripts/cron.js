// ============================================
// Re-Génesis Admin · Cron & Webhooks
// ============================================
// Auditoría: cron jobs programados, últimas ejecuciones del cron diario y
// webhooks GHL recibidos. Botón para ejecutar el cron manualmente.
//
// Depende de: window.db, window.requireAdmin, window.utils, window.NEURO_CONFIG.

(function () {
  'use strict';

  function _deps() {
    const u = window.utils || {};
    return {
      escapeHtml: u.escapeHtml || ((s) => s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))),
      toast: u.toast || ((m) => console.log('[toast]', m)),
      formatearFechaCorta: u.formatearFechaCorta || ((d) => d ? new Date(d).toLocaleDateString('es-CO') : '—'),
      tiempoRelativo: u.tiempoRelativo || ((d) => d ? new Date(d).toLocaleDateString('es-CO') : '—'),
    };
  }

  async function init() {
    document.querySelectorAll('[data-logout]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.signOut === 'function') return window.signOut();
        window.db.auth.signOut().then(() => { window.location.href = '/login.html'; });
      }));

    if (typeof window.requireAdmin !== 'function') {
      console.error('[RG/Admin/Cron] requireAdmin no cargó.');
      return;
    }
    const auth = await window.requireAdmin();
    if (!auth || !auth.session) return;

    document.getElementById('btn-cron-ejecutar')?.addEventListener('click', ejecutarCronManual);

    pintarUrlWebhook();
    await Promise.all([cargarCronJobs(), cargarCronLogs(), cargarWebhookLogs()]);

    document.body.classList.add('regenesis-ready');
  }

  function pintarUrlWebhook() {
    const el = document.getElementById('webhook-url-display');
    if (!el) return;
    const cfg = window.NEURO_CONFIG || {};
    const base = (cfg.SUPABASE_URL || '').replace(/\/$/, '');
    el.textContent = `${base}/functions/v1/webhook-ghl`;
  }

  async function cargarCronJobs() {
    const { escapeHtml } = _deps();
    const tbody = document.getElementById('cron-job-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Cargando...</td></tr>`;

    const { data, error } = await window.db.rpc('admin_cron_jobs');
    if (error) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No se pudo leer cron.job: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No hay jobs programados.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(j => `
      <tr>
        <td><strong>${escapeHtml(j.jobname)}</strong></td>
        <td><code>${escapeHtml(j.schedule)}</code></td>
        <td><code style="font-size: 11px;">${escapeHtml((j.command || '').trim())}</code></td>
        <td>${j.active
          ? `<span class="badge badge-active">Activo</span>`
          : `<span class="badge">Inactivo</span>`}</td>
      </tr>`).join('');
  }

  async function cargarCronLogs() {
    const { escapeHtml, formatearFechaCorta, tiempoRelativo } = _deps();
    const tbody = document.getElementById('cron-log-tbody');
    const counter = document.getElementById('cron-log-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Cargando...</td></tr>`;

    const { data, error } = await window.db
      .from('cron_log').select('*')
      .order('ejecutado_at', { ascending: false }).limit(20);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (counter) counter.textContent = `${rows.length} REGISTROS`;
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Aún no hay ejecuciones. La primera será mañana 07:00 Eastern (Orlando), o ahora si pulsas "Ejecutar ahora".</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const ok = !row.error;
      const resumen = row.error
        ? `<span class="err">${escapeHtml(row.error.slice(0, 80))}</span>`
        : resumirCronResultado(row.resultado, escapeHtml);
      return `
        <tr>
          <td>${escapeHtml(formatearFechaCorta(row.ejecutado_at))} · ${tiempoRelativo(row.ejecutado_at)}</td>
          <td>${ok ? `<span class="badge badge-active">OK</span>` : `<span class="badge" style="background: var(--error); color: white;">ERROR</span>`}</td>
          <td>${row.duracion_ms ? `${row.duracion_ms} ms` : '—'}</td>
          <td>${resumen}</td>
        </tr>`;
    }).join('');
  }

  function resumirCronResultado(resultado, escapeHtml) {
    if (!resultado || typeof resultado !== 'object') return '—';
    const partes = [];
    if (resultado.leads_activados_hoy !== undefined) partes.push(`activados: ${resultado.leads_activados_hoy}`);
    if (resultado.leads_revisados !== undefined)     partes.push(`revisados: ${resultado.leads_revisados}`);
    if (resultado.leads_completados_hoy !== undefined) partes.push(`completados: ${resultado.leads_completados_hoy}`);
    if (resultado.notificaciones_encoladas !== undefined) partes.push(`notifs: ${resultado.notificaciones_encoladas}`);
    if (resultado.leads_avanzados !== undefined)     partes.push(`avanzados: ${resultado.leads_avanzados}`);
    if (partes.length === 0) {
      return `<code style="font-size: 11px;">${escapeHtml(JSON.stringify(resultado).slice(0, 100))}</code>`;
    }
    return partes.join(' · ');
  }

  async function cargarWebhookLogs() {
    const { escapeHtml, formatearFechaCorta, tiempoRelativo } = _deps();
    const tbody = document.getElementById('webhook-log-tbody');
    const counter = document.getElementById('webhook-log-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Cargando...</td></tr>`;

    const { data, error } = await window.db
      .from('webhook_log')
      .select('*, leads:lead_id(email, nombre)')
      .eq('fuente', 'ghl')
      .order('recibido_at', { ascending: false })
      .limit(20);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    const rows = data || [];
    if (counter) counter.textContent = `${rows.length} EVENTOS`;
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aún no llega nada de GHL. Configura el webhook en GHL apuntando a la URL de arriba.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const ok = row.http_status >= 200 && row.http_status < 300;
      const lead = row.leads;
      const detalle = row.error
        ? `<span class="err" style="font-size: 12px;">${escapeHtml(row.error)}</span>`
        : `<span style="font-size: 12px;">${escapeHtml(row.resultado || '—')}</span>`;
      return `
        <tr>
          <td>${escapeHtml(formatearFechaCorta(row.recibido_at))}<br><span class="text-muted" style="font-size: 11px;">${tiempoRelativo(row.recibido_at)}</span></td>
          <td>${ok
            ? `<span class="badge badge-active">${row.http_status}</span>`
            : `<span class="badge" style="background: var(--error); color: white;">${row.http_status || '—'}</span>`}</td>
          <td>${detalle}</td>
          <td>${lead?.nombre ? escapeHtml(lead.nombre) : '<span class="text-muted">—</span>'}</td>
          <td><code style="font-size: 11px;">${lead?.email ? escapeHtml(lead.email) : '—'}</code></td>
        </tr>`;
    }).join('');
  }

  async function ejecutarCronManual() {
    const { toast } = _deps();
    const btn = document.getElementById('btn-cron-ejecutar');
    if (!btn) return;
    if (!confirm('Esto activa pagos pendientes que ya alcanzaron su fecha de inicio, marca completados al día 70 y encola las notificaciones del día. Es idempotente: si ya se ejecutó hoy, no duplica nada. ¿Continuar?')) return;

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Ejecutando...';
    try {
      const { error } = await window.db.rpc('ejecutar_cron_diario');
      if (error) throw error;
      toast('Cron ejecutado. Revisa el log abajo.', 'success');
      await cargarCronLogs();
    } catch (err) {
      console.error('[Cron] error:', err);
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  window.regenesisAdminCronInit = init;
})();
