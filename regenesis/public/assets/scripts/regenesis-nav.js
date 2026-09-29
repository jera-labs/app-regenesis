/* ============================================================
   Sidebar Re-Génesis (estilo plataforma, comportamiento SPA + cross-page).

   - En index.html (la SPA): items con `screen` interceptan y delegan al
     handler que client-app.js ya tiene en .app-header [data-screen-link].
   - En páginas standalone (reunion-resultados.html, etc.): items con `screen`
     navegan a `index.html#<screen>`, y al cargar index.html ese hash
     dispara la screen correcta.
   - Items externos (CRM, Skool, Plataforma) son <a href>.
   ============================================================ */

(function () {
  // Escape antes de interpolar datos del usuario (nombre/email) en innerHTML.
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const SECTIONS = [
    {
      title: null,
      items: [
        { id: 'dashboard',  icon: '◌', label: 'Inicio',      screen: 'dashboard' },
        { id: 'diario',     icon: '✎', label: 'Mi diario',   screen: 'diario' },
        { id: 'calendario', icon: '▣', label: 'Calendario',  screen: 'calendario' },
        { id: 'progreso',   icon: '◆', label: 'Mi progreso', screen: 'progreso' },
        { id: 'libro',      icon: '◰', label: 'Mi libro',    screen: 'libro' },
      ],
    },
    {
      title: 'Espacio',
      items: [
        // Href absoluto: sidebar es persistente, paths relativos acumularían
        // subdirs cuando el wrapper se mantiene entre navegaciones.
        { id: 'testimonios', icon: '◇', label: 'Mi reunión con Frank', href: '/reunion-resultados.html' },
      ],
    },
    {
      title: 'Externos',
      items: [
        { id: 'crm',   icon: '⚙', label: 'CRM',   href: 'https://app.livelucky.io/', external: true },
        { id: 'skool', icon: '⊕', label: 'Skool', href: 'https://www.skool.com/neurohackers', external: true },
      ],
    },
  ];

  const PLATAFORMA_URL = 'https://plataforma.neurohackers.cloud/';

  // ¿Estamos en index.html (la SPA con sus screens) o en una página standalone?
  // Check robusto: la SPA tiene #screen-dashboard, ninguna otra página lo tiene.
  function esIndexSPA() {
    return !!document.getElementById('screen-dashboard');
  }

  // Idempotente: cada vez que el sidebar se monta (primera vez o tras Turbo),
  // re-registra handlers SPA si estamos en index.html. Listener flag para no
  // duplicar event listeners globales (hashchange).
  let _hashListenerAttached = false;
  function attachIndexHandlersIfNeeded() {
    if (!esIndexSPA()) return;

    document.querySelectorAll('#sidebar [data-screen-link]').forEach((a) => {
      if (a.__rgWired) return;
      a.__rgWired = true;
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const screen = a.dataset.screenLink;
        const oldBtn = document.querySelector(`.app-header [data-screen-link="${screen}"]`);
        if (oldBtn) oldBtn.click();
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('show');
      });
    });

    // Dispara la screen del hash inicial (#diario, #progreso, etc).
    // PROBLEMA: si client-app.js no ha pintado .app-header aún (puede pasar
    // tras Turbo:load mientras client-app.js sigue rehidratando estado),
    // el querySelector retorna null. Polling con timeout duro hasta 2s.
    const initialHash = (window.location.hash || '').replace(/^#/, '');
    if (initialHash) {
      let intentos = 0;
      const tryClick = () => {
        const btn = document.querySelector(`.app-header [data-screen-link="${initialHash}"]`);
        if (btn) {
          btn.click();
        } else if (intentos++ < 20) {
          setTimeout(tryClick, 100);
        }
      };
      tryClick();
    }

    if (!_hashListenerAttached) {
      _hashListenerAttached = true;
      window.addEventListener('hashchange', () => {
        const h = (window.location.hash || '').replace(/^#/, '');
        if (!h) return;
        const btn = document.querySelector(`.app-header [data-screen-link="${h}"]`);
        if (btn) btn.click();
      });

      // Sincronizar .active del sidebar cuando client-app.js cambia screen
      const sync = () => {
        const activa = document.querySelector('.screen.active');
        if (!activa) return;
        const screenName = activa.id.replace(/^screen-/, '');
        document.querySelectorAll('#sidebar .side-item[data-screen-link]').forEach((x) => {
          x.classList.toggle('active', x.dataset.screenLink === screenName);
        });
      };
      new MutationObserver(sync).observe(document.body, {
        attributes: true, subtree: true, attributeFilter: ['class'],
      });
      sync();
    }
  }

  // Calcula qué item del sidebar debería estar activo. Prioridad:
  // 1. Hash de la URL (#diario, #progreso) cuando estamos en index.html.
  // 2. data-active del slot (lo que la página declaró).
  // 3. 'dashboard' como default.
  function calcularActive(slot) {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (esIndexSPA() && hash) return hash;
    return slot?.dataset?.active || 'dashboard';
  }

  // Si Turbo persistió #sidebar-wrapper entre navegaciones, no re-pintar:
  // solo actualizar el item activo y limpiar el slot.
  function actualizarActive(slot) {
    const active = calcularActive(slot);
    document.querySelectorAll('#sidebar .side-item').forEach((x) => {
      x.classList.toggle('active', x.dataset.navId === active);
    });
    slot?.remove();
  }

  function pintar() {
    const slot = document.querySelector('[data-rg-nav]');
    if (!slot) return;

    // Si ya hay sidebar (preservado por Turbo data-turbo-permanent), solo
    // actualizar active y salir.
    // El wrapper siempre existe en el HTML servido. Si tiene contenido,
    // Turbo lo persistió entre navegaciones — solo update active.
    const _w = document.getElementById('sidebar-wrapper');
    if (_w && _w.children.length > 0) {
      actualizarActive(slot);
      attachIndexHandlersIfNeeded();
      return;
    }

    const active = slot.dataset.active || 'dashboard';
    const enIndex = esIndexSPA();

    let sectionsHtml = '';
    SECTIONS.forEach((sec) => {
      sectionsHtml += '<div class="side-section">';
      if (sec.title) sectionsHtml += `<div class="side-section-title">${sec.title}</div>`;
      sec.items.forEach((it) => {
        const cls = it.id === active ? 'side-item active' : 'side-item';
        if (it.screen) {
          // En index.html → solo hash (SPA interno). Fuera → URL absoluta con hash.
          const href = enIndex ? `#${it.screen}` : `/index.html#${it.screen}`;
          sectionsHtml += `
            <a href="${href}" class="${cls}" data-screen-link="${it.screen}" data-nav-id="${it.id}">
              <span class="side-item-icon">${it.icon}</span>
              <span class="side-item-label">${it.label}</span>
            </a>`;
        } else {
          const target = it.external ? ' target="_blank" rel="noopener"' : '';
          const ext = it.external ? '<span class="side-item-ext">↗</span>' : '';
          sectionsHtml += `
            <a href="${it.href}" class="${cls}" data-nav-id="${it.id}"${target}>
              <span class="side-item-icon">${it.icon}</span>
              <span class="side-item-label">${it.label}</span>
              ${ext}
            </a>`;
        }
      });
      sectionsHtml += '</div>';
    });

    const switcherHTML = `
      <a href="${PLATAFORMA_URL}" class="side-switcher side-switcher-admin" title="Volver a la plataforma">
        <span class="side-switcher-icon">⬢</span>
        <span class="side-switcher-text">
          <strong>Volver a Plataforma</strong>
          <small>Tu sistema todo-en-uno</small>
        </span>
      </a>`;

    const userName = document.querySelector('[data-user-name]')?.textContent?.trim() || 'Yo';
    const sessionEmail = window.__currentUserEmail || '';
    const ini = (() => {
      const n = (userName || sessionEmail || 'Yo').trim();
      const p = n.split(/[\s@]/).filter(Boolean);
      if (p.length >= 2 && p[0][0]) return (p[0][0] + p[1][0]).toUpperCase();
      return n.slice(0, 2).toUpperCase();
    })();

    // Contenido INTERIOR del wrapper. El wrapper #sidebar-wrapper ya está
    // en el HTML servido con data-turbo-permanent.
    const innerHtml = `
      <button class="topbar-burger" id="nav-burger" aria-label="Abrir menú">≡</button>

      <aside class="sidebar" id="sidebar">
        <a href="${enIndex ? '#dashboard' : '/index.html'}" class="sidebar-brand">
          <div class="brand-logo">R</div>
          <span>Re-Génesis</span>
        </a>
        <div class="side-modo-pill">
          <span class="side-modo-dot" style="background: var(--accent);"></span>
          <span>Tu proceso</span>
        </div>
        <nav class="sidebar-nav">
          ${sectionsHtml}
          ${switcherHTML}
        </nav>
        <div class="sidebar-foot">
          <div class="user-pill">
            <span class="user-avatar">${esc(ini)}</span>
            <span class="user-pill-text" title="${esc(sessionEmail)}">${esc(userName)}</span>
          </div>
          <a href="#" class="sidebar-logout" id="rg-logout">Salir</a>
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

    // Mobile menu
    document.getElementById('nav-burger').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-overlay').classList.add('show');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebar-overlay').classList.remove('show');
    });

    // Wire-up del comportamiento SPA solo si estamos en index.html
    if (enIndex) attachIndexHandlersIfNeeded();

    // Logout
    document.getElementById('rg-logout').addEventListener('click', async (e) => {
      e.preventDefault();
      const oldLogout = document.querySelector('[data-action="logout"]');
      if (oldLogout) { oldLogout.click(); return; }
      if (window.db) await window.db.auth.signOut();
      window.location.href = '/index.html';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pintar);
  } else {
    pintar();
  }

  // Turbo dispara 'turbo:load' después de cada navegación same-document.
  document.addEventListener('turbo:load', pintar);

  // popstate (back/forward del browser) puede no disparar turbo:load si
  // Turbo restaura del cache. Forzar sync del active basado en URL nueva.
  window.addEventListener('popstate', () => {
    const slot = document.querySelector('[data-rg-nav]');
    if (slot) actualizarActive(slot);
    else {
      // Si el slot ya fue removido, derivar active desde URL
      const fakeSlot = { dataset: { active: 'dashboard' } };
      actualizarActive(fakeSlot);
    }
  });

  document.addEventListener('turbo:before-render', () => window.scrollTo(0, 0));
})();
