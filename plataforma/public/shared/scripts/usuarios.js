// ============================================================================
// usuarios.js · creación manual de usuarios por admin pleno
//
// Llama a la edge function admin-crear-usuario y muestra UI:
//   - modal con dropdown tipo (cliente/admin/moderador/lector)
//   - si tipo=cliente, pide modalidad + estado + cohorte + cuotas + monto
//   - al éxito, muestra password generado + URL login con botón copiar
//
// API:
//   window.usuariosApi.abrirModal()
//   window.usuariosApi.crearUsuario(payload)  -> server-side helper
// ============================================================================
(function () {
  if (typeof window.db === 'undefined') {
    console.warn('[usuarios.js] db no disponible');
    return;
  }

  const BASE = (window.NEURO_CONFIG && window.NEURO_CONFIG.SUPABASE_URL) || window.SUPABASE_URL || '';
  const FN_URL = `${BASE}/functions/v1/admin-crear-usuario`;

  function esc(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function toast(msg, tipo) {
    if (window.utils?.toast) return window.utils.toast(msg, tipo);
    if (window.showToast) return window.showToast(msg, tipo);
    alert(msg);
  }

  async function crearUsuario(payload) {
    const { data: { session } } = await window.db.auth.getSession();
    if (!session) throw new Error('Sin sesión');
    const r = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + session.access_token,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || data.error) {
      throw new Error(data.detail || data.error || ('HTTP ' + r.status));
    }
    return data;
  }

  function injectStyles() {
    if (document.getElementById('usuarios-styles')) return;
    const s = document.createElement('style');
    s.id = 'usuarios-styles';
    s.textContent = `
      .uc-bd { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1001; display: flex; align-items: center; justify-content: center; padding: 16px; }
      .uc-modal { background: var(--surface, #fff); border-radius: 14px; max-width: 560px; width: 100%; max-height: 92vh; overflow-y: auto; box-shadow: 0 12px 32px rgba(0,0,0,0.25); }
      .uc-head { padding: 18px 22px; border-bottom: 1px solid var(--border-soft, #e5e5ea); display: flex; justify-content: space-between; align-items: center; }
      .uc-head h2 { font-size: 16px; font-weight: 600; margin: 0; }
      .uc-x { background: transparent; border: 0; cursor: pointer; font-size: 18px; color: var(--text-muted, #86868b); }
      .uc-body { padding: 18px 22px; }
      .uc-field { margin-bottom: 14px; }
      .uc-field label { display: block; font-size: 11px; font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted, #86868b); margin-bottom: 6px; font-weight: 600; }
      .uc-field input, .uc-field select { width: 100%; padding: 10px 12px; border: 1px solid var(--border, #d2d2d7); border-radius: 8px; font-size: 14px; font-family: inherit; }
      .uc-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .uc-foot { padding: 14px 22px; border-top: 1px solid var(--border-soft, #e5e5ea); display: flex; gap: 8px; justify-content: flex-end; }
      .uc-btn { padding: 10px 18px; border-radius: 999px; border: 1px solid var(--border, #d2d2d7); background: transparent; cursor: pointer; font-size: 13px; font-weight: 500; }
      .uc-btn.primary { background: var(--text, #1D1D1F); color: var(--surface, #fff); border-color: var(--text, #1D1D1F); }
      .uc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .uc-success { padding: 16px; background: #ECFDF5; border: 1px solid #A7F3D0; border-radius: 10px; margin-bottom: 14px; }
      .uc-cred { display: flex; align-items: center; gap: 8px; background: var(--surface-2, #fafafa); padding: 10px 12px; border-radius: 6px; font-family: var(--font-mono, monospace); font-size: 13px; margin-top: 6px; }
      .uc-cred strong { flex: 1; user-select: all; word-break: break-all; }
      .uc-cred button { padding: 4px 10px; font-size: 11px; border: 1px solid var(--border, #d2d2d7); background: var(--surface, #fff); border-radius: 6px; cursor: pointer; }
      .uc-help { font-size: 11.5px; color: var(--text-muted, #86868b); margin-top: 4px; }
    `;
    document.head.appendChild(s);
  }

  function abrirModal() {
    injectStyles();
    const bd = document.createElement('div');
    bd.className = 'uc-bd';
    bd.innerHTML = `
      <div class="uc-modal">
        <div class="uc-head">
          <h2>Crear usuario manualmente</h2>
          <button class="uc-x" data-close>✕</button>
        </div>
        <div class="uc-body" id="uc-body-content">
          <div class="uc-field">
            <label>Tipo de usuario *</label>
            <select id="uc-tipo">
              <option value="cliente">Cliente (lead activo en Re-Génesis)</option>
              <option value="moderador">Moderador (equipo, lectura + ediciones limitadas)</option>
              <option value="lector">Lector (solo lectura, mentor)</option>
              <option value="admin">Admin pleno</option>
            </select>
          </div>
          <div class="uc-row">
            <div class="uc-field">
              <label>Nombre completo *</label>
              <input id="uc-nombre" type="text" placeholder="Juan Pérez">
            </div>
            <div class="uc-field">
              <label>Email *</label>
              <input id="uc-email" type="email" placeholder="juan@correo.com">
            </div>
          </div>
          <div class="uc-field">
            <label>Password (opcional)</label>
            <input id="uc-password" type="text" placeholder="Dejar vacío para autogenerar">
            <div class="uc-help">Si se deja vacío, se genera una password aleatoria legible (NeuroXxxxxx26!).</div>
          </div>

          <!-- Solo cliente -->
          <div id="uc-cliente-extra">
            <div class="uc-row">
              <div class="uc-field">
                <label>Modalidad *</label>
                <select id="uc-modalidad">
                  <option value="virtual">Virtual (sesión miércoles)</option>
                  <option value="presencial">Presencial (sesión martes)</option>
                </select>
              </div>
              <div class="uc-field">
                <label>Estado inicial *</label>
                <select id="uc-estado">
                  <option value="pagado_calentamiento">Sala de espera (arranca el lunes)</option>
                  <option value="activo">Activo (entra al programa hoy)</option>
                  <option value="lead">Lead (no ha pagado)</option>
                  <option value="prospecto_cierre">Prospecto en cierre</option>
                  <option value="pausa">Pausa</option>
                </select>
              </div>
            </div>
            <div class="uc-row">
              <div class="uc-field">
                <label>Cohorte</label>
                <select id="uc-cohorte"><option value="">(actual)</option></select>
              </div>
              <div class="uc-field">
                <label>Cuotas / monto total USD</label>
                <div style="display: flex; gap: 6px;">
                  <input id="uc-cuotas" type="number" min="1" value="1" style="flex: 0 0 80px;">
                  <input id="uc-monto" type="number" min="0" step="0.01" placeholder="0">
                </div>
              </div>
            </div>
            <div class="uc-field">
              <label>Notas internas</label>
              <input id="uc-notas" type="text" placeholder="Ej: pago por intercambio, referido de X, etc.">
            </div>
          </div>
        </div>
        <div class="uc-foot">
          <button class="uc-btn" data-close>Cancelar</button>
          <button class="uc-btn primary" id="uc-submit">Crear usuario</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    // Cargar cohortes (best-effort)
    window.db.from('cohortes').select('id, nombre').order('created_at', { ascending: false }).then(({ data }) => {
      const sel = bd.querySelector('#uc-cohorte');
      (data || []).forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.nombre;
        sel.appendChild(o);
      });
    });

    const tipoSel = bd.querySelector('#uc-tipo');
    const clienteExtra = bd.querySelector('#uc-cliente-extra');
    function refreshTipo() {
      clienteExtra.style.display = (tipoSel.value === 'cliente') ? '' : 'none';
    }
    tipoSel.addEventListener('change', refreshTipo);
    refreshTipo();

    // Si ya se creó el usuario, CUALQUIER forma de cerrar (✕, botón, backdrop)
    // dispara usuario:creado para que la página refresque su lista. No se
    // dispara al crear porque el admin necesita copiar las credenciales antes
    // del reload.
    let usuarioCreado = null;
    function cerrar() {
      bd.remove();
      if (usuarioCreado) {
        document.dispatchEvent(new CustomEvent('usuario:creado', { detail: usuarioCreado }));
      }
    }
    bd.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', cerrar));
    bd.addEventListener('click', (e) => { if (e.target === bd) cerrar(); });

    bd.querySelector('#uc-submit').addEventListener('click', async (e) => {
      const tipo = tipoSel.value;
      const nombre = bd.querySelector('#uc-nombre').value.trim();
      const email = bd.querySelector('#uc-email').value.trim().toLowerCase();
      const password = bd.querySelector('#uc-password').value.trim() || null;
      if (!nombre || !email) return toast('Nombre y email requeridos', 'error');

      const payload = { tipo, nombre, email };
      if (password) payload.password = password;

      if (tipo === 'cliente') {
        payload.modalidad = bd.querySelector('#uc-modalidad').value;
        payload.estado = bd.querySelector('#uc-estado').value;
        payload.cohorte_id = bd.querySelector('#uc-cohorte').value || null;
        payload.cuotas_elegidas = Number(bd.querySelector('#uc-cuotas').value) || 1;
        payload.monto_total_programa_usd = Number(bd.querySelector('#uc-monto').value) || 0;
        const notas = bd.querySelector('#uc-notas').value.trim();
        if (notas) payload.notas_internas = notas;
      }

      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const r = await crearUsuario(payload);
        usuarioCreado = r;
        // Mostrar éxito + credenciales
        const body = bd.querySelector('#uc-body-content');
        body.innerHTML = `
          <div class="uc-success">
            <div style="font-weight: 600; margin-bottom: 4px;">✓ Usuario ${esc(r.tipo)} creado</div>
            <div style="font-size: 13px; color: var(--text-muted, #86868b);">${esc(r.nombre)} · ${esc(r.email)}</div>
          </div>
          <div style="font-size: 11px; font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted, #86868b);">URL de login</div>
          <div class="uc-cred">
            <strong>${esc(r.url_login)}</strong>
            <button data-copy="${esc(r.url_login)}">copiar</button>
          </div>
          <div style="font-size: 11px; font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted, #86868b); margin-top: 12px;">Email</div>
          <div class="uc-cred">
            <strong>${esc(r.email)}</strong>
            <button data-copy="${esc(r.email)}">copiar</button>
          </div>
          <div style="font-size: 11px; font-family: var(--font-mono, monospace); text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted, #86868b); margin-top: 12px;">Password ${r.password_generado ? '(autogenerada)' : '(la que pusiste)'}</div>
          <div class="uc-cred">
            <strong>${esc(r.password)}</strong>
            <button data-copy="${esc(r.password)}">copiar</button>
          </div>
          <div class="uc-help" style="margin-top: 14px;">
            Estado: auth ${esc(r.auth_user)}${r.lead ? ' · lead ' + esc(r.lead) : ''}${r.usuario_admin ? ' · usuario_admin ' + esc(r.usuario_admin) : ''}.
            Comparte estas credenciales por canal seguro (NO email plano).
          </div>`;
        bd.querySelector('.uc-foot').innerHTML = `
          <button class="uc-btn" data-close>Cerrar</button>
          <button class="uc-btn primary" id="uc-copiar-todo">Copiar credenciales</button>`;
        bd.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
          navigator.clipboard?.writeText(b.dataset.copy);
          b.textContent = '✓';
          setTimeout(() => b.textContent = 'copiar', 1500);
        }));
        bd.querySelector('#uc-copiar-todo').addEventListener('click', () => {
          const txt = `URL: ${r.url_login}\nEmail: ${r.email}\nPassword: ${r.password}`;
          navigator.clipboard?.writeText(txt);
          toast('Credenciales copiadas al portapapeles', 'success');
        });
        // El botón "Cerrar" nuevo del footer necesita su listener (cerrar()
        // ya dispara usuario:creado vía el flag usuarioCreado). El ✕ del
        // header conserva el suyo del wiring inicial.
        bd.querySelector('.uc-foot [data-close]')?.addEventListener('click', cerrar);
      } catch (err) {
        toast('No se pudo crear: ' + (err.message || err), 'error', 6000);
        btn.disabled = false;
        btn.textContent = 'Crear usuario';
      }
    });
  }

  window.usuariosApi = { abrirModal, crearUsuario };
})();
