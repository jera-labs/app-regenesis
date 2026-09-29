// ============================================
// Re-Génesis Admin · Testimonios
// ============================================
// Lista de testimonios en video grabados por clientes. Admin puede aprobar,
// marcar como publicado o rechazar. Solo los aprobados se usan en marketing.
//
// Depende de: window.db, window.requireAdmin, window.utils.

(function () {
  'use strict';

  function _deps() {
    const u = window.utils || {};
    return {
      escapeHtml: u.escapeHtml || ((s) => s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))),
      toast: u.toast || ((m) => console.log('[toast]', m)),
      formatearFechaCorta: u.formatearFechaCorta || ((d) => d ? new Date(d).toLocaleDateString('es-CO') : '—'),
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
      console.error('[RG/Admin/Testimonios] requireAdmin no cargó.');
      return;
    }
    const auth = await window.requireAdmin();
    if (!auth || !auth.session) return;

    await cargarTestimonios();
    document.body.classList.add('regenesis-ready');
  }

  async function cargarTestimonios() {
    const { escapeHtml, toast, formatearFechaCorta } = _deps();
    const cont = document.getElementById('testimonios-list');
    const counter = document.getElementById('testimonios-count');
    if (!cont) return;
    cont.innerHTML = '<div class="empty-state-text" style="padding: var(--space-6);">Cargando...</div>';

    const { data, error } = await window.db.from('testimonios')
      .select('id, lead_id, momento, estado, recibido_at, aprobado_at, duracion_segundos, tema_orden_al_grabar, testimonio_video_path, comentarios_adicionales, permite_uso_marketing, permite_uso_nombre, leads:lead_id(nombre, email)')
      .order('recibido_at', { ascending: false, nullsFirst: false });

    if (error) {
      cont.innerHTML = `<div class="empty-state-text">Error: ${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data || !data.length) {
      if (counter) counter.textContent = '0';
      cont.innerHTML = '<div class="empty-state-text" style="padding: var(--space-6);">Aún no hay testimonios grabados.</div>';
      return;
    }

    if (counter) counter.textContent = String(data.length);

    const cards = await Promise.all(data.map(async t => {
      let videoUrl = '';
      if (t.testimonio_video_path) {
        const { data: signed } = await window.db.storage.from('testimonios')
          .createSignedUrl(t.testimonio_video_path, 3600);
        videoUrl = signed?.signedUrl || '';
      }
      const fechaTxt = t.recibido_at ? formatearFechaCorta(t.recibido_at) : '—';
      const duracionTxt = t.duracion_segundos
        ? `${Math.floor(t.duracion_segundos / 60)}:${String(t.duracion_segundos % 60).padStart(2,'0')}`
        : '—';
      const momentoTxt = t.momento === 'mitad_programa' ? 'Mitad del programa'
        : t.momento === 'final_programa' ? 'Cierre del programa'
        : 'Espontáneo';
      const estadoCls = (t.estado === 'aprobado' || t.estado === 'publicado') ? 'badge-active' : '';
      const lead = t.leads || {};

      return `
        <div class="testimonio-admin-card" data-test-id="${t.id}">
          ${videoUrl
            ? `<video src="${escapeHtml(videoUrl)}" controls preload="metadata"></video>`
            : '<div class="testimonio-video-placeholder">Sin video</div>'}
          <div class="testimonio-info">
            <div class="testimonio-info-name">${escapeHtml(lead.nombre || lead.email || '—')}</div>
            <div class="testimonio-info-meta">
              ${escapeHtml(momentoTxt)} · ${fechaTxt} · ${duracionTxt}
              · Tema ${t.tema_orden_al_grabar ?? '—'}
            </div>
            ${t.comentarios_adicionales
              ? `<div class="testimonio-comentarios">${escapeHtml(t.comentarios_adicionales)}</div>`
              : ''}
            <div class="testimonio-permisos">
              ${t.permite_uso_marketing ? '✓ marketing' : '✗ marketing'}
              · ${t.permite_uso_nombre ? '✓ nombre' : '✗ nombre'}
            </div>
            <div class="testimonio-actions">
              <span class="badge ${estadoCls}">${escapeHtml((t.estado || 'recibido').toUpperCase())}</span>
              ${t.estado !== 'aprobado' && t.estado !== 'publicado'
                ? `<button type="button" class="btn-secondary" data-aprobar="${t.id}">Aprobar</button>`
                : ''}
              ${t.estado === 'aprobado'
                ? `<button type="button" class="btn-secondary" data-publicar="${t.id}">Marcar publicado</button>`
                : ''}
              <button type="button" class="btn-ghost" data-rechazar="${t.id}">Rechazar</button>
            </div>
          </div>
        </div>`;
    }));

    cont.innerHTML = cards.join('');

    cont.querySelectorAll('[data-aprobar]').forEach(b => {
      b.addEventListener('click', () => actualizarTestimonio(b.dataset.aprobar, 'aprobado'));
    });
    cont.querySelectorAll('[data-publicar]').forEach(b => {
      b.addEventListener('click', () => actualizarTestimonio(b.dataset.publicar, 'publicado'));
    });
    cont.querySelectorAll('[data-rechazar]').forEach(b => {
      b.addEventListener('click', () => {
        if (confirm('¿Rechazar este testimonio? Volverá a estado pendiente y no se usará.')) {
          actualizarTestimonio(b.dataset.rechazar, 'pendiente');
        }
      });
    });
  }

  async function actualizarTestimonio(id, nuevoEstado) {
    const { toast } = _deps();
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'aprobado') {
      updates.aprobado_at = new Date().toISOString();
      const { data: { session } } = await window.db.auth.getSession();
      if (session) {
        const { data: admin } = await window.db.from('usuarios_admin')
          .select('id').eq('email', session.user.email).maybeSingle();
        if (admin) updates.aprobado_por = admin.id;
      }
    }
    const { data, error } = await window.db.from('testimonios').update(updates).eq('id', id).select('id');
    if (error) { toast('Error: ' + error.message, 'error'); return; }
    if (!data || data.length === 0) {
      toast('No se actualizó el testimonio (revisa permisos).', 'error');
      return;
    }
    toast(`Testimonio ${nuevoEstado}.`, 'success');
    await cargarTestimonios();
  }

  window.regenesisAdminTestimoniosInit = init;
})();
