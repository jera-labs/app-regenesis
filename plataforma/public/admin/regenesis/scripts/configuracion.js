// ============================================
// Re-Génesis Admin · Configuración
// ============================================
// Editor de configuracion_sistema (clave/valor/descripcion). Parámetros
// globales del programa: zonas horarias, días, horarios, etc.
//
// Depende de: window.db, window.requireAdmin, window.utils.

(function () {
  'use strict';

  function _deps() {
    const u = window.utils || {};
    return {
      escapeHtml: u.escapeHtml || ((s) => s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))),
      toast: u.toast || ((m) => console.log('[toast]', m)),
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
      console.error('[RG/Admin/Config] requireAdmin no cargó.');
      return;
    }
    const auth = await window.requireAdmin();
    if (!auth || !auth.session) return;

    await cargarConfig();
    document.body.classList.add('regenesis-ready');
  }

  async function cargarConfig() {
    const { escapeHtml, toast } = _deps();
    const cont = document.getElementById('config-list');
    if (!cont) return;
    cont.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    const { data, error } = await window.db.from('configuracion_sistema').select('*').order('clave');
    if (error) {
      cont.innerHTML = `<div class="empty-state-text">Error: ${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data || !data.length) {
      cont.innerHTML = '<div class="empty-state-text" style="padding: var(--space-6);">Aún no hay parámetros configurados.</div>';
      return;
    }

    cont.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Clave</th>
              <th style="width: 220px;">Valor</th>
              <th>Descripción</th>
              <th style="width: 160px;"></th>
            </tr>
          </thead>
          <tbody>
            ${data.map(c => `
              <tr data-config-clave="${escapeHtml(c.clave)}" style="cursor: default;">
                <td class="mono" style="font-size: 12px;">${escapeHtml(c.clave)}</td>
                <td>
                  <input type="text" class="search-input config-input"
                         data-original="${escapeHtml(c.valor || '')}"
                         value="${escapeHtml(c.valor || '')}"
                         style="padding: 6px 10px; font-size: 13px; min-width: 0;">
                </td>
                <td style="color: var(--text-muted); font-size: 13px;">
                  ${escapeHtml(c.descripcion || '')}
                </td>
                <td>
                  <div class="message-editor-actions">
                    <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
                    <span class="message-editor-status" data-status>SIN CAMBIOS</span>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    cont.querySelectorAll('tr[data-config-clave]').forEach(tr => {
      const clave = tr.dataset.configClave;
      const input = tr.querySelector('.config-input');
      const btn = tr.querySelector('[data-save]');
      const status = tr.querySelector('[data-status]');
      let original = input.dataset.original;

      input.addEventListener('input', () => {
        const dirty = input.value !== original;
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      });

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const { error } = await window.db
          .from('configuracion_sistema')
          .update({ valor: input.value, updated_at: new Date().toISOString() })
          .eq('clave', clave);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          toast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        original = input.value;
        input.dataset.original = input.value;
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        toast('Configuración guardada', 'success');
      });
    });
  }

  window.regenesisAdminConfigInit = init;
})();
