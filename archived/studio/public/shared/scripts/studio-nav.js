/* ============================================================
   Sidebar del Studio (independiente).
   Reusa las clases visuales de styles.css de plataforma pero NO toca
   nav.js de plataforma. El studio vive en /studio/* y este es su menú.

   Características:
   - Detecta si el usuario es admin (lee usuarios_admin) → muestra link Admin.
   - Detecta los módulos activos del lead (modulos_cliente / modulos_catalogo)
     → muestra Instagram/LinkedIn/Facebook según activos.
   - Si el cliente NO tiene NINGÚN módulo de contenido activo → muestra
     mensaje 'Sin módulos activos. Pídele al equipo que te active uno.'
   - Sidebar persistente con data-turbo-permanent.
   - Hrefs ABSOLUTOS bajo /studio/ para evitar bug de acumulación.
   ============================================================ */

(function () {
  const STUDIO_BASE = '/studio';
  const PLATAFORMA_URL = 'https://plataforma.neurohackers.cloud/';
  const REGENESIS_URL  = 'https://neurohackers.cloud/';

  // Mapeo de módulos del catálogo → entradas del sidebar.
  const REDES_ITEMS = [
    { slug: 'contenido-instagram', icon: '◉', label: 'Instagram', href: STUDIO_BASE + '/modules/instagram/index.html' },
    { slug: 'contenido-linkedin',  icon: '▦', label: 'LinkedIn',  href: STUDIO_BASE + '/modules/linkedin/index.html' },
    { slug: 'contenido-facebook',  icon: '◇', label: 'Facebook',  href: STUDIO_BASE + '/modules/facebook/index.html' },
  ];

  // Cache de módulos activos para no consultar Supabase en cada render
  let _modulosCache = null;
  async function modulosActivosDelLead(leadId) {
    if (_modulosCache !== null) return _modulosCache;
    if (!leadId || !window.db) return new Set();
    const [{ data: catalog }, { data: overrides }] = await Promise.all([
      window.db.from('modulos_catalogo').select('slug, default_activo'),
      window.db.from('modulos_cliente').select('modulo_slug, activo').eq('lead_id', leadId),
    ]);
    const overrideMap = new Map((overrides || []).map((o) => [o.modulo_slug, o.activo]));
    const activos = new Set();
    (catalog || []).forEach((m) => {
      const val = overrideMap.has(m.slug) ? overrideMap.get(m.slug) : m.default_activo;
      if (val) activos.add(m.slug);
    });
    _modulosCache = activos;
    return activos;
  }

  async function pintarPorPrimeraVez(slot, active) {
    let rol = null, sessionEmail = null, leadId = null, leadNombre = null, esLead = false;
    try {
      if (window.db) {
        const { data: { session } } = await window.db.auth.getSession();
        if (session) {
          sessionEmail = session.user.email;
          const { data: adm } = await window.db
            .from('usuarios_admin').select('email, rol').eq('email', sessionEmail).eq('activo', true).maybeSingle();
          rol = adm?.rol || null;
          const { data: lead } = await window.db
            .from('leads').select('id, nombre').eq('email', sessionEmail).maybeSingle();
          esLead = !!lead;
          leadId = lead?.id || null;
          leadNombre = lead?.nombre || null;
        }
      }
    } catch (_) {}
    const isAdmin = !!rol;
    const isFullAdmin = rol === 'admin';
    window.__studioIsAdmin = isAdmin;
    window.__studioLeadId  = leadId;

    const iniciales = (() => {
      const n = (leadNombre || sessionEmail || 'Yo').trim();
      const p = n.split(/[\s@]/).filter(Boolean);
      if (p.length >= 2 && p[0][0]) return (p[0][0] + p[1][0]).toUpperCase();
      return n.slice(0, 2).toUpperCase();
    })();

    // ¿Qué items de "Generar contenido" mostrar al lead?
    const activos = esLead ? await modulosActivosDelLead(leadId) : new Set(['contenido-instagram','contenido-linkedin','contenido-facebook']);
    const redesVisibles = REDES_ITEMS.filter((it) => activos.has(it.slug));

    // Detectar si algún ítem del grupo "Generar" está activo (para abrirlo por default)
    const generarActive = ['contenido-instagram','contenido-linkedin','contenido-facebook'].includes(active);

    let redesHtml = '';
    if (redesVisibles.length === 0) {
      redesHtml = `<div class="side-empty" style="padding: 8px 14px; font-size: 12px; color: var(--text-muted);">Sin redes activas.${isAdmin ? '' : ' Pide al equipo que te active una.'}</div>`;
    } else {
      redesVisibles.forEach((it) => {
        const cls = it.slug === active ? 'side-item side-sub-item active' : 'side-item side-sub-item';
        redesHtml += `
          <a href="${it.href}" class="${cls}" data-nav-id="${it.slug}">
            <span class="side-item-icon">${it.icon}</span>
            <span class="side-item-label">${it.label}</span>
          </a>`;
      });
    }

    // Wrapper colapsable (details/summary nativo → cero JS extra, accesible)
    const redesGroupHtml = `
      <details class="side-group" ${generarActive ? 'open' : ''}>
        <summary class="side-group-summary">
          <span class="side-item-icon">⚡</span>
          <span class="side-item-label">Generar contenido</span>
          <span class="side-group-caret">▾</span>
        </summary>
        <div class="side-group-items">
          ${redesHtml}
        </div>
      </details>`;

    // Sección admin si aplica
    let adminSection = '';
    if (isFullAdmin) {
      adminSection = `
        <div class="side-section">
          <div class="side-section-title">Admin</div>
          <a href="${STUDIO_BASE}/admin/index.html" class="side-item ${active === 'admin-studio' ? 'active' : ''}" data-nav-id="admin-studio">
            <span class="side-item-icon">⬢</span>
            <span class="side-item-label">Activar módulos por cliente</span>
          </a>
        </div>`;
    }

    const switcherHtml = `
      <a href="${PLATAFORMA_URL}" class="side-switcher side-switcher-admin" title="Volver a la plataforma" data-turbo="false">
        <span class="side-switcher-icon">⬢</span>
        <span class="side-switcher-text">
          <strong>Volver a Plataforma</strong>
          <small>Tu sistema todo-en-uno</small>
        </span>
      </a>`;

    const cuentaActive = ['configuracion', 'mi-uso'].includes(active);

    const configItem = `
          <a href="${STUDIO_BASE}/configuracion/index.html" class="side-item side-sub-item ${active === 'configuracion' ? 'active' : ''}" data-nav-id="configuracion">
            <span class="side-item-icon">⚙</span>
            <span class="side-item-label">API keys</span>
          </a>`;

    const usoItem = `
          <a href="${STUDIO_BASE}/admin/uso.html#${esLead ? 'cliente' : 'todos'}" class="side-item side-sub-item ${active === 'mi-uso' ? 'active' : ''}" data-nav-id="mi-uso">
            <span class="side-item-icon">$</span>
            <span class="side-item-label">${esLead && !isFullAdmin ? 'Mi consumo' : 'Costo / Uso'}</span>
          </a>`;

    const cuentaGroupHtml = `
      <details class="side-group" ${cuentaActive ? 'open' : ''}>
        <summary class="side-group-summary">
          <span class="side-item-icon">⚙</span>
          <span class="side-item-label">Ajustes</span>
          <span class="side-group-caret">▾</span>
        </summary>
        <div class="side-group-items">
          ${configItem}
          ${esLead || isFullAdmin ? usoItem : ''}
        </div>
      </details>`;

    const innerHtml = `
      <button class="topbar-burger" id="nav-burger" aria-label="Abrir menú">≡</button>

      <aside class="sidebar" id="sidebar">
        <a href="${STUDIO_BASE}/index.html" class="sidebar-brand">
          <div class="brand-logo">S</div>
          <span>Studio</span>
        </a>
        <div class="side-modo-pill">
          <span class="side-modo-dot" style="background: var(--accent);"></span>
          <span>Contenido</span>
        </div>
        <nav class="sidebar-nav">
          <div class="side-section">
            <a href="${STUDIO_BASE}/index.html" class="side-item ${active === 'hoy' ? 'active' : ''}" data-nav-id="hoy">
              <span class="side-item-icon">◌</span>
              <span class="side-item-label">Inicio</span>
            </a>
            ${redesGroupHtml}
            ${cuentaGroupHtml}
          </div>
          ${adminSection}
          ${switcherHtml}
        </nav>
        <div class="sidebar-foot">
          <div class="user-pill">
            <span class="user-avatar">${iniciales}</span>
            <span class="user-pill-text" title="${sessionEmail || ''}">${leadNombre || (sessionEmail || 'Cliente').split('@')[0]}</span>
          </div>
          <a href="#" class="sidebar-logout" id="studio-logout" data-turbo="false">Salir</a>
        </div>
      </aside>

      <div class="sidebar-overlay" id="sidebar-overlay"></div>
    `;

    const wrapper = document.getElementById('sidebar-wrapper');
    if (wrapper) {
      wrapper.innerHTML = innerHtml;
      slot.remove();
    } else {
      slot.outerHTML = `<div id="sidebar-wrapper" data-turbo-permanent>${innerHtml}</div>`;
    }
    document.body.classList.add('with-sidebar');

    document.getElementById('nav-burger')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-overlay').classList.add('show');
    });
    document.getElementById('sidebar-overlay')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });
    document.getElementById('studio-logout')?.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.db) await window.db.auth.signOut();
      window.location.href = PLATAFORMA_URL + 'login.html';
    });
  }

  function marcarActivo(slot) {
    const active = slot.dataset.active || '';
    document.querySelectorAll('#sidebar .side-item').forEach((a) => {
      a.classList.toggle('active', a.dataset.navId === active);
    });
    slot.remove();
  }

  async function init() {
    const slot = document.querySelector('[data-studio-nav]');
    if (!slot) {
      // En páginas como editor que NO tienen slot, el sidebar debe quedar oculto.
      // No tocar la clase del body para no romper el layout del editor.
      return;
    }

    // Si llegamos a una página con slot (instagram, admin, etc.), el sidebar
    // debe estar visible. Aseguramos la clase del body — pudo haberse perdido
    // al venir del editor (que la quita con padding-left:0 + display:none).
    document.body.classList.add('with-sidebar');

    const wrapper = document.getElementById('sidebar-wrapper');
    if (wrapper && wrapper.children.length > 0) {
      marcarActivo(slot);
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebar-overlay')?.classList.remove('show');
      return;
    }

    await pintarPorPrimeraVez(slot, slot.dataset.active || '');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  document.addEventListener('turbo:load', init);
  // turbo:render se dispara también en restauraciones (back/forward), donde
  // turbo:load NO se dispara. Ese era el caso de la barra que desaparecía al
  // hacer history.back() desde el editor.
  document.addEventListener('turbo:render', init);
  window.addEventListener('popstate', () => {
    const slot = document.querySelector('[data-studio-nav]');
    if (slot) {
      document.body.classList.add('with-sidebar');
      marcarActivo(slot);
    }
  });
  document.addEventListener('turbo:before-render', () => window.scrollTo(0, 0));
})();
