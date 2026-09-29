// ============================================================================
// Gate de autenticación para páginas privadas.
//
// Uso al inicio de un HTML privado (después de cargar config + supabase-client):
//   <script src="shared/scripts/auth.js"></script>
//   <script>
//     window.requireAuth().then(({session, lead}) => { /* render */ });
//   </script>
//
// Si no hay session, redirige a login.html?next=<ruta_actual>.
// Si hay session pero el email no está en `leads`, también redirige (es admin sin acceso al app del cliente).
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') {
    throw new Error('[Neurohackers/auth] Falta supabase-client.js antes de auth.js');
  }

  // Espera a que Supabase termine de hidratar la sesión desde localStorage.
  //
  // PROBLEMA: el SDK lee `localStorage.neurohackers-auth` de forma asíncrona
  // al iniciar. Si llamas getSession() antes de que termine, devuelve null
  // aunque la sesión exista en storage. Síntoma: primer load = "Hola, —" sin
  // datos; refresh = todo OK (el cliente Supabase ya estaba caliente).
  //
  // SOLUCIÓN: polling cada 80ms hasta que getSession() devuelva algo, o hasta
  // 5s. Como pre-check leemos localStorage directamente: si NO hay sesión
  // guardada, no esperamos y dejamos que requireAuth haga el redirect a login
  // inmediatamente.
  //
  // Esto es más robusto que esperar el evento INITIAL_SESSION porque ese
  // evento puede dispararse antes de que el listener esté listo (race con
  // nav.js que también llama getSession()).
  async function waitForInitialSession(maxWaitMs = 8000) {
    // Pre-check: ¿hay sesión guardada en storage?
    let storedRaw = null;
    try { storedRaw = localStorage.getItem('neurohackers-auth'); } catch (_) {}

    // Intento inmediato. Si la sesión está hot (caso refresh), resuelve ya.
    try {
      const { data } = await window.db.auth.getSession();
      if (data.session) return data.session;
    } catch (_) {}

    // No hay sesión hot, y tampoco hay sesión en storage → user no está logueado.
    if (!storedRaw) return null;

    // Hay sesión en storage pero SDK aún no la cargó (red lenta, refresh
    // automático en curso, etc.). Subscribirse a onAuthStateChange + poll
    // de respaldo. Resolvemos en el primer evento o cuando getSession()
    // devuelva algo. Sin esto, en 3G la página redirige a login con sesión
    // válida solo porque el SDK aún no terminó de refrescar el token.
    return await new Promise((resolve) => {
      let resolved = false;
      let unsubscribe = null;
      const done = (val) => {
        if (resolved) return;
        resolved = true;
        try { unsubscribe?.(); } catch (_) {}
        resolve(val);
      };
      const timeout = setTimeout(() => done(null), maxWaitMs);

      try {
        const sub = window.db.auth.onAuthStateChange((event, session) => {
          if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
            clearTimeout(timeout);
            done(session);
          }
        });
        unsubscribe = () => { try { sub?.data?.subscription?.unsubscribe(); } catch (_) {} };
      } catch (_) {}

      (async () => {
        const start = Date.now();
        while (!resolved && Date.now() - start < maxWaitMs) {
          await new Promise(r => setTimeout(r, 100));
          try {
            const { data } = await window.db.auth.getSession();
            if (data.session) { clearTimeout(timeout); done(data.session); return; }
          } catch (_) {}
        }
      })();
    });
  }

  // Cache de "es admin" en sessionStorage para evitar hacer la query de
  // usuarios_admin en CADA navegación (era el cuello de botella reportado:
  // banner duplicado + lentitud). Keyed por email para que un cambio de cuenta
  // en la misma pestaña no use el cache de la cuenta anterior.
  const ADMIN_CACHE_KEY = 'neuro_admin_cache_v1';
  function leerAdminCache(email) {
    try {
      const raw = sessionStorage.getItem(ADMIN_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj.email !== email) return null;
      return obj.admin; // { id, nombre, rol, activo } | false
    } catch (_) { return null; }
  }
  function escribirAdminCache(email, admin) {
    try { sessionStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({ email, admin: admin || false })); } catch (_) {}
  }
  async function resolverAdmin(email) {
    const cached = leerAdminCache(email);
    if (cached !== null) return cached || null;
    const { data } = await window.db
      .from('usuarios_admin').select('id, nombre, rol, activo')
      .eq('email', email).eq('activo', true).maybeSingle();
    escribirAdminCache(email, data || null);
    return data || null;
  }
  // Helper expuesto para que otros scripts (nav.js, etc.) reusen el mismo cache.
  window.neuroResolverAdmin = resolverAdmin;

  async function requireAuth(opts = {}) {
    const { allowAdmin = true, redirectIfNoLead = true } = opts;

    const session = await waitForInitialSession();

    if (!session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${rootBase()}login.html?next=${next}`;
      return null;
    }

    // Gate de password temporal: si el flag está activo, forzamos cambio
    // antes de dejar entrar a cualquier página protegida. Excepción: la
    // propia cambiar-password.html no debe rebotar a sí misma.
    const yaEnCambio = /\/cambiar-password\.html$/i.test(window.location.pathname);
    if (!yaEnCambio && session.user?.user_metadata?.password_temporal === true) {
      const nextUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${rootBase()}cambiar-password.html?next=${nextUrl}`;
      return null;
    }

    const email = session.user.email;

    // Resolver admin + lead propio en paralelo. Antes era secuencial.
    const [adminResult, leadResult] = await Promise.all([
      allowAdmin ? resolverAdmin(email) : Promise.resolve(null),
      window.db.from('leads').select('*').eq('email', email).maybeSingle(),
    ]);
    const admin = adminResult;
    const { data: leadPropio, error } = leadResult;
    if (error) console.error('[Neurohackers/auth] Error fetching lead:', error);

    // IMPERSONACIÓN: si el caller es admin Y hay un view_as activo, devolvemos
    // ese lead en lugar del lead propio. El view_as puede venir del URL (la
    // primera vez que el admin hace "Ver como cliente") o del sessionStorage
    // (al navegar internamente entre módulos). Si llega por URL, lo guardamos
    // en sessionStorage para que persista al moverse entre páginas.
    if (admin) {
      let viewAsId = null;
      try {
        const urlVal = new URLSearchParams(window.location.search).get('view_as');
        if (urlVal) {
          sessionStorage.setItem('regenesis_view_as', urlVal);
          viewAsId = urlVal;
        } else {
          viewAsId = sessionStorage.getItem('regenesis_view_as');
        }
      } catch (_) {}
      if (viewAsId) {
        const { data: leadImpersonado, error: errImp } = await window.db
          .from('leads').select('*').eq('id', viewAsId).maybeSingle();
        if (leadImpersonado) {
          return { session, lead: leadImpersonado, admin, viewAs: true };
        }
        // Solo limpiar si el lead realmente no existe. Un error transitorio
        // de red NO debe matar la impersonación activa.
        if (!errImp) {
          try { sessionStorage.removeItem('regenesis_view_as'); } catch (_) {}
        } else {
          console.error('[Neurohackers/auth] Error fetching lead impersonado:', errImp);
        }
      }
    }

    if (!leadPropio && redirectIfNoLead) {
      if (admin) {
        window.location.href = `${rootBase()}admin/index.html`;
        return null;
      }
      await window.db.auth.signOut();
      window.location.href = `${rootBase()}login.html?error=no-lead`;
      return null;
    }

    return { session, lead: leadPropio, admin, viewAs: false };
  }

  function rootBase() {
    // Calcula la ruta relativa al root del app/ según dónde esté la página actual.
    // index.html → ''
    // modules/marca-oferta/index.html → '../../'
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    // El último elemento es el archivo; cuenta cuántas carpetas hay desde /app/
    // Asumimos que el deploy es la raíz (plataforma.neurohackers.cloud/), así que las carpetas son depth.
    const depth = Math.max(0, parts.length - 1);
    return '../'.repeat(depth);
  }

  window.requireAuth = requireAuth;
  window.rootBase = rootBase;

  window.signOut = async function () {
    // Limpiar estado per-pestaña que podría contaminar la próxima sesión
    // (ej. regenesis_view_as queda con el lead impersonado de la sesión anterior
    // y al loguearse otra cuenta sigue viendo a ese cliente "mezclado").
    try {
      sessionStorage.removeItem('regenesis_view_as');
      sessionStorage.removeItem(ADMIN_CACHE_KEY);
    } catch (_) {}
    // Limpiar localStorage del sidebar cacheado para que el próximo login
    // NO pinte por un instante el nombre/iniciales del usuario anterior.
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('nav-cache-')) localStorage.removeItem(k);
      });
    } catch (_) {}
    await window.db.auth.signOut();
    window.location.href = `${rootBase()}login.html`;
  };
})();
