/* ============================================================
   Sidebar dual + switcher entre Panel Admin y Panel Cliente.

   Comportamiento:
   - Si la URL actual contiene /admin/  → sidebar de Operación
   - Si la URL es cualquier otra        → sidebar de Cliente
   - Si el usuario es admin+lead, aparece un switcher visible
     para alternar entre ambos paneles (como GHL Agency/SubAccount)
   - Si el usuario es solo admin (sin lead): solo ve panel admin
   - Si el usuario es solo cliente: solo ve panel cliente

   Atributos del slot:
     data-active="hoy|perfil|marca|admin|admin-equipo|..."
     data-base="./" o "../" o "../../"

   IDEMPOTENCIA + TURBO:
   - El primer load pinta el sidebar dentro de #sidebar-wrapper (permanente).
   - En navegaciones siguientes (Turbo Drive mantiene el wrapper), solo
     re-marcamos el item activo según el data-active de la nueva página.
   ============================================================ */

(function () {
  // Escape local: nav.js se carga en páginas que no siempre traen utils.js,
  // así que no dependemos de window.utils.escapeHtml. Todo dato de BD/sesión
  // (nombre del lead, email) DEBE pasar por aquí antes de ir a innerHTML.
  function esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // IMPORTANTE: TODOS los href de items locales usan paths ABSOLUTOS desde
  // root (/admin/..., /modules/...). El sidebar es persistente (data-turbo-
  // permanent) entre navegaciones, y si los hrefs fueran relativos, el browser
  // los resolvería relativo a la URL ACTUAL → al navegar a /modules/perfil/
  // y luego clicar "Tracker" con href="modules/tracker/index.html", terminaría
  // en /modules/perfil/modules/tracker/index.html (path acumulado).
  const CLIENTE_SECTIONS = [
    {
      title: null,
      items: [
        { id: 'hoy',          icon: '◌', label: 'Hoy',                  href: '/index.html' },
        { id: 'tracker',      icon: '◆', label: 'Tracker',              href: '/modules/tracker/index.html' },
        { id: 'perfil',       icon: '◉', label: 'Mi perfil',            href: '/modules/perfil/index.html' },
        { id: 'dna',          icon: '◇', label: 'Mi DNA',               href: '/modules/dna/index.html' },
        { id: 'marca',        icon: '▦', label: 'P.A.C.T.O',            href: '/modules/marca-oferta/index.html' },
        { id: 'herramientas', icon: '⚙', label: 'Herramientas',         href: '/modules/herramientas/index.html' },
      ],
    },
    {
      // Migración página por página. Lo que ya está migrado vive bajo /regenesis/
      // en este mismo dominio (un solo login). Calendario, Progreso, Libro y
      // Reunión siguen en el sitio legacy hasta que se migren.
      title: 'Re-Génesis',
      items: [
        { id: 'rg-hoy',         icon: '◉', label: 'Inicio',              href: '/regenesis/index.html' },
        { id: 'rg-diario',      icon: '✎', label: 'Mi diario',           href: '/regenesis/diario.html' },
        { id: 'rg-calendario',  icon: '▣', label: 'Calendario',          href: '/regenesis/calendario.html' },
        { id: 'rg-progreso',    icon: '◆', label: 'Mi progreso',         href: '/regenesis/progreso.html' },
        { id: 'rg-libro',       icon: '◰', label: 'Mi libro',            href: '/regenesis/libro.html' },
        { id: 'rg-reunion',     icon: '◇', label: 'Mi reunión con Frank',href: '/regenesis/reunion.html' },
      ],
    },
    {
      title: 'Externos',
      items: [
        { id: 'skool', icon: '⊕', label: 'Skool', href: 'https://www.skool.com/neurohackers', external: true },
        { id: 'crm',   icon: '⚙', label: 'CRM',   href: 'https://app.livelucky.io/', external: true },
      ],
    },
    {
      title: 'Recursos',
      items: [
        { id: 'equipo',  icon: '▲', label: 'El equipo',  href: '/mas.html#equipo' },
        { id: 'biblio',  icon: '◰', label: 'Biblioteca', href: '/mas.html#recursos' },
      ],
    },
  ];

  const ADMIN_SECTIONS = [
    {
      title: null,
      items: [
        { id: 'admin',           icon: '⬢', label: 'Clientes',      href: '/admin/index.html' },
        { id: 'admin-dashboards',icon: '▥', label: 'Dashboards',    href: '/admin/dashboards.html' },
        { id: 'admin-pipeline',  icon: '◧', label: 'Pipeline',      href: '/admin/pipeline.html' },
        { id: 'admin-seguimiento',icon: '◰', label: 'Seguimiento',  href: '/admin/seguimiento.html' },
        { id: 'admin-sesiones',  icon: '☏', label: 'Sesiones 1:1',  href: '/admin/sesiones.html' },
        { id: 'admin-finanzas',  icon: '$', label: 'Finanzas',      href: '/admin/finanzas.html' },
        { id: 'admin-comisiones',icon: '◊', label: 'Comisiones',    href: '/admin/comisiones.html' },
        { id: 'admin-enlaces',   icon: '⧉', label: 'Enlaces',       href: '/admin/enlaces.html' },
        { id: 'admin-equipo',    icon: '▲', label: 'Equipo',        href: '/admin/equipo.html', onlyAdmin: true },
      ],
    },
    {
      title: 'Re-Génesis',
      items: [
        { id: 'admin-regenesis-inicio',     icon: '▦', label: 'Inicio Re-Génesis',   href: '/admin/regenesis/inicio.html', onlyAdmin: true },
        { id: 'admin-calendario',           icon: '▣', label: 'Calendario sesiones', href: '/admin/calendario.html', onlyAdmin: true },
        { id: 'admin-mensajes',             icon: '✉', label: 'Mensajes (144)',      href: '/admin/regenesis/mensajes.html', onlyAdmin: true },
        { id: 'admin-regenesis-testimonios',icon: '◈', label: 'Testimonios',         href: '/admin/regenesis/testimonios.html', onlyAdmin: true },
        { id: 'admin-regenesis-config',     icon: '⚙', label: 'Configuración RG',    href: '/admin/regenesis/configuracion.html', onlyAdmin: true },
        { id: 'admin-regenesis-cron',       icon: '∼', label: 'Cron & Webhooks',     href: '/admin/regenesis/cron.html', onlyAdmin: true },
      ],
    },
    {
      title: 'Configuración',
      items: [
        { id: 'admin-automatizaciones', icon: '◐', label: 'Automatizaciones', href: '/admin/automatizaciones.html', onlyAdmin: true },
        { id: 'admin-cohortes',         icon: '◰', label: 'Cohortes',         href: '/admin/cohortes.html', onlyAdmin: true },
        { id: 'admin-catalogos',        icon: '≡', label: 'Catálogos',        href: '/admin/catalogos.html', onlyAdmin: true },
        { id: 'admin-tracker-config',   icon: '◆', label: 'Tracker config',   href: '/admin/tracker-config.html', onlyAdmin: true },
        { id: 'admin-config',           icon: '⚙', label: 'Configuración',    href: '/admin/configuracion.html', onlyAdmin: true },
        { id: 'admin-sistema',          icon: '⌬', label: 'Sistema',           href: '/admin/sistema.html', onlyAdmin: true },
      ],
    },
    {
      title: 'Mi sesión',
      items: [
        { id: 'admin-cuenta', icon: '◉', label: 'Mi cuenta', href: '/admin/cuenta.html' },
      ],
    },
  ];

  function detectarContexto(slot) {
    // 1) data-context en el slot tiene prioridad (fuerza admin/cliente)
    const slotEl = slot || document.querySelector('[data-nav]');
    const forced = slotEl?.dataset?.context;
    if (forced === 'admin' || forced === 'cliente') return forced;
    // 2) Fallback: detectar por URL. Páginas bajo /admin/ son del panel admin.
    return window.location.pathname.includes('/admin/') ? 'admin' : 'cliente';
  }

  function marcarActivo(activeId) {
    document.querySelectorAll('.side-item').forEach((a) => {
      const isAct = a.dataset.navId === activeId;
      a.classList.toggle('active', isAct);
    });
  }

  // Detecta si la pestaña actual está en modo "Ver como cliente" (impersonación).
  // Fuente de verdad: la URL (?view_as=X). Si llega por URL, lo persistimos en
  // sessionStorage para que sobreviva navegaciones que pierdan el query string.
  // sessionStorage es per-pestaña: una pestaña sin view_as nunca lo recoge.
  function viewAsActual() {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('view_as');
      if (fromUrl) {
        sessionStorage.setItem('regenesis_view_as', fromUrl);
        return fromUrl;
      }
      return sessionStorage.getItem('regenesis_view_as');
    } catch (_) { return null; }
  }

  // Toma un href absoluto local (ej. '/modules/perfil/index.html') y le anexa
  // ?view_as=X para que la siguiente página también respete la impersonación.
  // No toca URLs externas (http://...) ni hashes (#...).
  function anexarViewAs(href, vid) {
    if (!vid || !href) return href;
    if (/^(https?:)?\/\//i.test(href)) return href; // externo
    if (href.startsWith('#')) return href;
    const [path, hash] = href.split('#');
    const sep = path.includes('?') ? '&' : '?';
    return path + sep + 'view_as=' + encodeURIComponent(vid) + (hash ? '#' + hash : '');
  }

  async function pintarPorPrimeraVez(slot, base, active) {
    const contexto = detectarContexto(slot);
    const vid = viewAsActual();

    // Detectar rol del usuario actual + módulos activos del lead
    let rol = null, sessionEmail = null, leadNombre = null, leadId = null, esLead = false, leadServicio = 'regenesis';
    let gatingServicio = 'regenesis';
    let modulosActivos = new Set();
    try {
      if (window.db) {
        const { data: { session } } = await window.db.auth.getSession();
        if (session) {
          sessionEmail = session.user.email;
          // Reusar cache de auth.js (sessionStorage por email) en vez de golpear
          // usuarios_admin cada navegación. Era el cuello de botella del sidebar.
          const adm = typeof window.neuroResolverAdmin === 'function'
            ? await window.neuroResolverAdmin(sessionEmail)
            : (await window.db.from('usuarios_admin').select('email, rol').eq('email', sessionEmail).eq('activo', true).maybeSingle()).data;
          rol = adm?.rol || null;
          const { data: lead } = await window.db
            .from('leads').select('id, nombre, servicio').eq('email', sessionEmail).maybeSingle();
          esLead = !!lead;
          leadId = lead?.id || null;
          leadNombre = lead?.nombre || null;
          leadServicio = lead?.servicio || 'regenesis';

          // Servicio para el gating. Normalmente es el del propio lead. Pero si
          // un admin está impersonando (?view_as=X) en la cara cliente, usamos el
          // servicio del cliente impersonado para reproducir SU experiencia real
          // (un cliente Terapia ve los módulos de negocio bloqueados). Así el admin
          // puede revisar con "Ver como cliente" que el gating funciona de verdad.
          gatingServicio = leadServicio;
          let gatingActivo = (contexto !== 'admin' && !rol); // cliente real (no admin)
          if (vid && contexto !== 'admin') {
            try {
              const { data: imp } = await window.db
                .from('leads').select('servicio').eq('id', vid).maybeSingle();
              if (imp) { gatingServicio = imp.servicio || 'regenesis'; gatingActivo = true; }
            } catch (_) {}
          }

          // Gating de acceso Terapia: solo la sección /regenesis/. Si entra por URL
          // directa a un módulo de negocio (o al hub /index.html), lo mandamos a su
          // inicio Re-Génesis, preservando la impersonación (?view_as) si la hay.
          if (gatingActivo && gatingServicio === 'terapia') {
            const p = location.pathname;
            if (/^\/modules\//.test(p) || p === '/index.html' || p === '/' || p === '/mas.html') {
              location.replace(vid ? '/regenesis/index.html?view_as=' + encodeURIComponent(vid) : '/regenesis/index.html');
              return;
            }
          }

          // Sistema de módulos por cliente (modulos_catalogo + modulos_cliente)
          // fue retirado con la integración GHL/Studio el 2026-06-01 (migración 70).
          // El sidebar ya no necesita filtrar por requireModulo; cualquier item
          // con esa propiedad simplemente no se filtra (siempre se muestra).
        }
      }
    } catch (_) {}
    const isAdmin = !!rol;
    const isFullAdmin = rol === 'admin';
    window.__navIsAdmin = isAdmin;
    window.__navRol = rol;
    window.__navEsLead = esLead;

    const iniciales = (() => {
      const n = (leadNombre || sessionEmail || 'Yo').trim();
      const parts = n.split(/[\s@]/).filter(Boolean);
      if (parts.length >= 2 && parts[0][0]) return (parts[0][0] + parts[1][0]).toUpperCase();
      return n.slice(0, 2).toUpperCase();
    })();

    let SECTIONS;
    let modoLabel;
    let switcherHTML = '';

    if (contexto === 'admin') {
      SECTIONS = ADMIN_SECTIONS;
      modoLabel = rol === 'admin' ? 'Operación' : rol === 'moderador' ? 'Moderación' : 'Lectura';
      if (esLead) {
        // data-turbo="false" porque cambiar de contexto admin→cliente requiere
        // que el cliente tenga sus propios scripts (client-app.js, etc.).
        switcherHTML = `
          <a href="/index.html" class="side-switcher" data-turbo="false" title="Ir a tu panel como cliente">
            <span class="side-switcher-icon">↻</span>
            <span class="side-switcher-text">
              <strong>Cambiar a Mi panel</strong>
              <small>Ver la plataforma como cliente</small>
            </span>
          </a>`;
      }
    } else {
      // Terapia ve ÚNICAMENTE la sección Re-Génesis. Se ocultan módulos de negocio
      // (Tracker, Mi perfil, DNA, P.A.C.T.O, Herramientas), Externos (Skool/CRM) y
      // también Recursos (El equipo, Biblioteca). Acceso 100% al programa terapéutico.
      SECTIONS = (gatingServicio === 'terapia')
        ? CLIENTE_SECTIONS.filter(s => s.title === 'Re-Génesis')
        : CLIENTE_SECTIONS;
      modoLabel = 'Mi panel';
      if (isAdmin) {
        switcherHTML = `
          <a href="/admin/index.html" class="side-switcher side-switcher-admin" data-turbo="false" title="Ir al panel de operación">
            <span class="side-switcher-icon">⬢</span>
            <span class="side-switcher-text">
              <strong>Volver al panel admin</strong>
              <small>${rol === 'admin' ? 'Gestiona equipo y clientes' : 'Tus clientes asignados'}</small>
            </span>
          </a>`;
      }
    }

    const renderItem = (it, activeFlag) => {
      if (it.onlyAdmin && !isFullAdmin) return '';
      if (it.requireModulo && !modulosActivos.has(it.requireModulo)) return '';
      // it.href ya viene en formato correcto: absoluto local (/admin/...) o
      // URL completa externa. NO concatenar base aquí.
      let attrs = '';
      let ext = '';
      let href = it.href;
      if (it.external) {
        attrs = ' target="_blank" rel="noopener" data-turbo="false"';
        ext = '<span class="side-item-ext">↗</span>';
      } else if (it.cross) {
        attrs = ' data-turbo="false"';
        ext = '<span class="side-item-ext">→</span>';
      } else if (contexto === 'admin') {
        // Turbo Drive deduplica <script src=...> entre navegaciones. Si la
        // página actual NO carga productos.js/perfil.js/admin-gate.js y la
        // siguiente sí los necesita, Turbo no los inyecta y rompe (errores
        // como "window.requireAdmin is not a function"). Cada página admin
        // tiene su propio set de shared scripts; navegamos con full reload.
        attrs = ' data-turbo="false"';
      } else if (vid && !it.external && !it.cross) {
        // Modo "Ver como cliente" activo: propagar ?view_as=X en cada link
        // del sidebar. Turbo Drive sigue activo (no data-turbo="false") para
        // evitar pestañeo del sidebar entre navegaciones. El script inline de
        // cada HTML re-ejecuta requireAuth() después de turbo:load, así que la
        // impersonación se aplica limpia en cada página.
        href = anexarViewAs(it.href, vid);
      }
      const cls = activeFlag ? 'side-item active' : 'side-item';
      return `
        <a href="${href}" class="${cls}" data-nav-id="${it.id}"${attrs}>
          <span class="side-item-icon">${it.icon}</span>
          <span class="side-item-label">${it.label}</span>
          ${ext}
        </a>`;
    };

    let sectionsHtml = '';
    SECTIONS.forEach((sec) => {
      // Renderiza items primero. Si ninguno produce HTML (todo filtrado por
      // requireModulo/onlyAdmin), oculta la sección completa.
      const itemsHtml = sec.items.map((it) => renderItem(it, it.id === active)).join('');
      if (!itemsHtml.trim()) return;
      sectionsHtml += '<div class="side-section">';
      if (sec.title) sectionsHtml += `<div class="side-section-title">${sec.title}</div>`;
      sectionsHtml += itemsHtml;
      sectionsHtml += '</div>';
    });

    const brandHref = contexto === 'admin' ? '/admin/index.html' : '/index.html';
    const modoColor = contexto === 'admin' ? '#1D1D1F' : 'var(--text-muted)';

    // Contenido INTERIOR del wrapper. El wrapper #sidebar-wrapper YA está en
    // el HTML servido con data-turbo-permanent, así que Turbo lo preserva
    // entre navegaciones same-origin. Solo rellenamos su innerHTML.
    const innerHtml = `
      <button class="topbar-burger" id="nav-burger" aria-label="Abrir menú">≡</button>

      <aside class="sidebar ${contexto === 'admin' ? 'sidebar-admin-mode' : ''}" id="sidebar">
        <a href="${brandHref}" class="sidebar-brand" data-turbo="false">
          <div class="brand-logo">N</div>
          <span>Neurohackers</span>
        </a>
        <div class="side-modo-pill" style="color: ${modoColor};">
          <span class="side-modo-dot" style="background: ${contexto === 'admin' ? '#1D1D1F' : 'var(--accent)'};"></span>
          <span>${modoLabel}</span>
        </div>
        <nav class="sidebar-nav">
          ${sectionsHtml}
          ${switcherHTML}
        </nav>
        <div class="sidebar-foot">
          <div class="user-pill">
            <span class="user-avatar">${esc(iniciales)}</span>
            <span class="user-pill-text" title="${esc(sessionEmail || '')}">${esc(leadNombre || (sessionEmail || 'Cliente').split('@')[0])}</span>
          </div>
          <a href="#" class="sidebar-logout" id="nav-logout" data-turbo="false">Salir</a>
        </div>
      </aside>

      <div class="sidebar-overlay" id="sidebar-overlay"></div>
    `;

    const wrapper = document.getElementById('sidebar-wrapper');
    if (wrapper) {
      wrapper.innerHTML = innerHtml;
      slot.remove();
    } else {
      // Fallback: HTML viejo sin wrapper persistente (no debería pasar tras migración)
      slot.outerHTML = `<div id="sidebar-wrapper" data-turbo-permanent>${innerHtml}</div>`;
    }
    document.body.classList.add('with-sidebar');
    if (contexto === 'admin') document.body.classList.add('admin-mode');

    // Guardar HTML del sidebar en localStorage para que el siguiente full
    // reload (data-turbo="false" en items admin) pinte INMEDIATAMENTE sin
    // esperar a nav.js. Inline preload script en cada HTML lee este cache.
    try {
      // Bumpea la version del cache key cuando agregues/quites items del sidebar
      // (también hay que reemplazar en TODOS los preload inline de cada HTML).
      // Guardamos UNA sola key (sin variante por active). El preload pinta la
      // versión genérica; nav.js corrige el item activo en milisegundos.
      // Sin esto, acumulábamos ~30 entradas × 5KB en 6 meses de uso.
      localStorage.setItem(`nav-cache-${contexto}-v4`, innerHtml);
      // Limpiar variantes por-active de versiones anteriores (v1/v2 + cualquier
      // -v3-<active> que quedó de la version vieja del cache strategy).
      try {
        const prefix = `nav-cache-${contexto}`;
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(prefix) && k !== `${prefix}-v4`) {
            localStorage.removeItem(k);
          }
        });
      } catch (_) {}
    } catch (_) { /* quota / safari private mode */ }

    cablearListenersSidebar();
  }

  // Engancha los listeners del sidebar (burger, overlay, logout). Es idempotente:
  // marca el sidebar con data-wired="1" para no duplicar handlers.
  //
  // CRÍTICO: las páginas admin tienen un script preload inline que pinta el
  // sidebar desde localStorage ANTES de que nav.js cargue. Cuando init() corre,
  // ve sidebar "ya pintado" y NO entra a pintarPorPrimeraVez → los listeners
  // nunca se registraban → el botón "Salir" quedaba muerto. Ahora init() llama
  // cablearListenersSidebar() también en el path de cache.
  function cablearListenersSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar.dataset.wired === '1') return;
    const burger  = document.getElementById('nav-burger');
    const overlay = document.getElementById('sidebar-overlay');
    const logout  = document.getElementById('nav-logout');
    if (burger) burger.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay?.classList.add('show');
    });
    if (overlay) overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
    if (logout) logout.addEventListener('click', async (e) => {
      e.preventDefault();
      // Preferir window.signOut (auth.js): limpia también nav-cache-* para que
      // el próximo login no pinte el sidebar del usuario anterior.
      if (typeof window.signOut === 'function' && window.db) {
        try { await window.signOut(); return; } catch (_) {}
      }
      try { sessionStorage.removeItem('regenesis_view_as'); } catch (_) {}
      try { sessionStorage.removeItem('neuro_admin_cache_v1'); } catch (_) {}
      try {
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('nav-cache-')) localStorage.removeItem(k);
        });
      } catch (_) {}
      if (window.db) {
        try { await window.db.auth.signOut(); } catch (_) {}
      } else {
        // Página sin supabase-client (no debería pasar): matar la sesión
        // persistida a mano para que login.html no rebote de vuelta.
        try { localStorage.removeItem('neurohackers-auth'); } catch (_) {}
      }
      window.location.href = '/login.html';
    });
    sidebar.dataset.wired = '1';
  }

  // Banner amarillo "ADMIN — Estás viendo la cara cliente con tu cuenta".
  // Aparece en TODAS las páginas de cliente (Hoy, Perfil, DNA, P.A.C.T.O,
  // Herramientas, Re-Génesis/*) cuando el usuario logueado es admin activo.
  // Idempotente: si ya existe el elemento, no duplica. Si la página tiene su
  // propio #admin-banner (como /regenesis/index.html), no se inyecta el de nav.
  async function asegurarBannerAdminCliente(contexto) {
    if (contexto !== 'cliente') return;
    // Check síncrono atómico: si ya existe el banner (o un placeholder), salir.
    // En /regenesis/index.html el HTML ya trae #admin-banner inline (de la versión
    // vieja con client-app.js manejando el banner). Si existe, no duplicamos.
    // En reunion.html, libro.html, etc., #admin-banner NO existe y nav.js inyecta.
    if (document.getElementById('admin-banner-nav') || document.getElementById('admin-banner')) return;
    if (!window.db) return;
    // PLACEHOLDER SÍNCRONO bloquea race-condition entre DOMContentLoaded + turbo:load
    const b = document.createElement('div');
    b.id = 'admin-banner-nav';
    b.setAttribute('data-turbo-permanent', '');
    b.style.display = 'none';
    document.body.insertBefore(b, document.body.firstChild);

    try {
      const { data: { session } } = await window.db.auth.getSession();
      if (!session?.user?.email) { b.remove(); return; }
      // Reusar cache de auth.js (evita query repetida en CADA navegación)
      const admin = window.neuroResolverAdmin
        ? await window.neuroResolverAdmin(session.user.email)
        : null;
      if (!admin) { b.remove(); return; }

      // Detectar modo: ¿está impersonando con view_as?
      let viewAsId = null;
      try { viewAsId = sessionStorage.getItem('regenesis_view_as'); } catch (_) {}

      if (viewAsId) {
        // Banner negro de impersonación. Trae el nombre del lead visto.
        const { data: leadVisto } = await window.db
          .from('leads').select('nombre, email').eq('id', viewAsId).maybeSingle();
        if (!leadVisto) {
          // view_as roto, limpiar
          try { sessionStorage.removeItem('regenesis_view_as'); } catch (_) {}
          b.remove();
          return;
        }
        b.style.cssText = [
          'background: #1D1D1F','color: #FFF','padding: 10px var(--space-5, 20px)',
          'display: flex','align-items: center','gap: 12px',
          'font-size: 14px','font-weight: 500','position: sticky','top: 0','z-index: 50',
          'border-bottom: 1px solid rgba(255,255,255,0.1)',
        ].join(';');
        const nombreVisto = (leadVisto.nombre || leadVisto.email || 'un cliente');
        b.innerHTML = `
          <span style="background: #D4AF37; color: #1D1D1F; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 11px; letter-spacing: 1.5px;">VISTA ADMIN</span>
          <span><strong>${esc(admin.nombre || session.user.email)}</strong> está viendo la sesión de <strong>${esc(nombreVisto)}</strong>. Modo lectura.</span>
          <a href="#" id="banner-salir-vista" style="color: #D4AF37; font-weight: 600; text-decoration: none; margin-left: auto;">Salir de la vista ✕</a>`;
        document.getElementById('banner-salir-vista')?.addEventListener('click', (e) => {
          e.preventDefault();
          try { sessionStorage.removeItem('regenesis_view_as'); } catch (_) {}
          window.close();
          setTimeout(() => { window.location.href = '/admin/index.html'; }, 100);
        });
      } else {
        // Banner amarillo: admin viendo SU PROPIA cara cliente
        b.style.cssText = [
          'background: #1D1D1F','color: #FFF','padding: 10px var(--space-5, 20px)',
          'display: flex','align-items: center','gap: 12px',
          'font-size: 14px','font-weight: 500','position: sticky','top: 0','z-index: 50',
          'border-bottom: 1px solid rgba(255,255,255,0.1)',
        ].join(';');
        b.innerHTML = `
          <span style="background: #D4AF37; color: #1D1D1F; padding: 4px 10px; border-radius: 999px; font-weight: 700; font-size: 11px; letter-spacing: 1.5px;">ADMIN</span>
          <span>Estás viendo la cara cliente con tu cuenta.
            <a href="/admin/index.html" data-turbo="false" style="color: #D4AF37; font-weight: 600; text-decoration: none; margin-left: 4px;">Ir al panel admin →</a></span>`;
      }
    } catch (e) {
      console.warn('[nav.js] aseguraBannerAdminCliente:', e?.message);
      b.remove();
    }
  }

  async function init() {
    const slot = document.querySelector('[data-nav]');
    if (!slot) return;

    const active = slot.dataset.active || '';
    const base = slot.dataset.base || './';

    // El wrapper siempre existe en el HTML servido. Lo que cambia es si tiene
    // contenido (Turbo lo persistió entre navegaciones) o está vacío (primera
    // carga / hard reload).
    const wrapper = document.getElementById('sidebar-wrapper');
    const yaPintado = wrapper && wrapper.children.length > 0;

    if (yaPintado) {
      const contextoActual = detectarContexto();
      const sidebarEsAdmin = document.getElementById('sidebar')?.classList.contains('sidebar-admin-mode');
      const contextoCambio = (contextoActual === 'admin') !== !!sidebarEsAdmin;

      if (contextoCambio) {
        // El usuario cambió cliente <-> admin: repintar shell completo
        wrapper.innerHTML = '';
        await pintarPorPrimeraVez(slot, base, active);
      } else {
        marcarActivo(active);
        slot.remove();
        document.getElementById('sidebar')?.classList.remove('open');
        document.getElementById('sidebar-overlay')?.classList.remove('show');
        // CRÍTICO: si el sidebar viene del preload localStorage, sus listeners
        // (Salir, burger, overlay) NO están registrados. Cablearlos ahora.
        cablearListenersSidebar();
      }
      // En el path de cache (Turbo persistente), pintarPorPrimeraVez no corre.
      // Asegura el banner aquí también.
      asegurarBannerAdminCliente(detectarContexto(slot));
      return;
    }

    await pintarPorPrimeraVez(slot, base, active);
    asegurarBannerAdminCliente(detectarContexto());
  }

  // Auto-limpieza: si el usuario entró al panel admin (/admin/*), borra el
  // view_as. Eso garantiza que cuando vuelva a la cara cliente (/index.html,
  // /modules/*), no quede impersonando al cliente de una sesión anterior.
  function limpiarViewAsSiEnAdmin() {
    if (window.location.pathname.startsWith('/admin/')) {
      try { sessionStorage.removeItem('regenesis_view_as'); } catch (_) {}
    }
  }

  // Interceptor global de clicks en <a>: cuando hay view_as activo, propaga
  // ?view_as=X a CUALQUIER link interno que apunte a la cara cliente. Esto
  // captura links del contenido (no solo del sidebar) — botones "Editar",
  // "Volver a Hoy", crumbs, etc.
  // Reglas:
  //   - solo links absolutos /... (no externos, no hash)
  //   - destino debe ser una ruta de cliente (no /admin/*)
  //   - opt-out con data-no-viewas en el <a>
  //   - links que abren en _blank: SÍ propagan (para abrir otras pestañas en
  //     modo cliente impersonado).
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return; // solo click izquierdo
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // user holding modifier
    const a = e.target.closest('a');
    if (!a) return;
    if (a.hasAttribute('data-no-viewas')) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (!href.startsWith('/')) return;          // externo, hash, relativo
    if (href.startsWith('//')) return;          // protocol-relative
    if (href.startsWith('/admin/')) return;     // navegar al admin = salir del modo cliente
    if (href.includes('view_as=')) return;      // ya lo trae
    let vid = null;
    try {
      vid = new URLSearchParams(window.location.search).get('view_as')
         || sessionStorage.getItem('regenesis_view_as');
    } catch (_) {}
    if (!vid) return;
    // Reescribir el href con view_as. Dejamos que Turbo Drive maneje la
    // navegación normal (sin data-turbo="false") para evitar pestañeo del
    // sidebar. El script inline de cada HTML re-ejecuta requireAuth.
    const [path, hash] = href.split('#');
    const sep = path.includes('?') ? '&' : '?';
    a.setAttribute('href', path + sep + 'view_as=' + encodeURIComponent(vid) + (hash ? '#' + hash : ''));
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { limpiarViewAsSiEnAdmin(); init(); });
  } else {
    limpiarViewAsSiEnAdmin();
    init();
  }

  // Turbo dispara 'turbo:load' después de cada navegación same-document.
  document.addEventListener('turbo:load', () => { limpiarViewAsSiEnAdmin(); init(); });

  // popstate (back/forward) - asegura que el active se sincronice incluso
  // si Turbo restaura del cache sin re-disparar turbo:load.
  window.addEventListener('popstate', () => {
    const slot = document.querySelector('[data-nav]');
    if (slot) marcarActivo(slot.dataset.active || '');
  });

  // Scroll al top en cada navegación nueva (no en restauración del back).
  document.addEventListener('turbo:before-render', () => {
    window.scrollTo(0, 0);
  });
})();
