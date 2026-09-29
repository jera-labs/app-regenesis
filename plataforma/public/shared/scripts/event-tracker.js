// ============================================================================
// event-tracker.js · captura de eventos del cliente/admin para /admin/seguimiento.html
//
// API:
//   window.trackEvent(tipo, opts?)   // fire-and-forget, no awaitable
//     opts = { accion, pagina, canal, contenido, metadata }
//   window.trackLogin(origen, opts?) // idempotente por TTL de 30 min
//
// Auto-tracking:
// - 'turbo:load' → trackEvent('navegacion', {accion: 'cargo_pagina'})
// - auth SIGNED_IN → trackLogin('signed_in')
// - sesión ya hot al cargar → trackLogin('session_hot')
//
// Diseño:
// - Fire-and-forget: no bloquea UI ni rompe la app si la BD falla.
// - Buffer de hasta 50 eventos para encolar mientras la sesión Supabase carga.
// - Dedup login por sessionStorage (30 min TTL).
// ============================================================================

(function () {
  const QUEUE = [];
  // 500 eventos: suficiente para sesión completa antes de que la sesión Supabase
  // se hidrate. Antes era 50 con FIFO: los primeros (los más útiles para debug)
  // se descartaban. Ahora hacemos tail-drop con warning.
  const MAX_QUEUE = 500;
  let warnedFull = false;
  const LOGIN_KEY = 'neuro_last_tracked_login_at';
  const LOGIN_TTL_MS = 30 * 60 * 1000;

  let sesionLista = false;
  let drainTimer = null;

  async function _send(evt) {
    if (!window.db) return;
    try {
      const { error } = await window.db.rpc('track_evento', {
        p_tipo: evt.tipo,
        p_accion: evt.accion || null,
        p_pagina: evt.pagina || null,
        p_canal: evt.canal || 'app',
        p_contenido: evt.contenido || null,
        p_metadata: evt.metadata || {},
      });
      if (error) console.warn('[event-tracker]', error.message);
    } catch (e) {
      console.warn('[event-tracker]', e?.message || e);
    }
  }

  async function _drain() {
    while (QUEUE.length > 0) {
      const evt = QUEUE.shift();
      await _send(evt);
    }
  }

  function _enqueue(evt) {
    if (QUEUE.length >= MAX_QUEUE) {
      // Tail-drop: descarta el evento NUEVO (no el viejo). Los primeros
      // eventos suelen ser los más útiles para entender el flow del usuario.
      if (!warnedFull) {
        console.warn(`[event-tracker] queue llena (${MAX_QUEUE}), descartando nuevos eventos hasta que la sesión esté lista`);
        warnedFull = true;
      }
      return;
    }
    QUEUE.push(evt);
    if (sesionLista && !drainTimer) {
      drainTimer = setTimeout(() => { drainTimer = null; _drain(); }, 50);
    }
  }

  window.trackEvent = function (tipo, opts) {
    _enqueue({
      tipo: String(tipo || 'evento'),
      accion: opts?.accion,
      pagina: opts?.pagina || (typeof location !== 'undefined' ? location.pathname : null),
      canal: opts?.canal || 'app',
      contenido: opts?.contenido,
      metadata: opts?.metadata || {},
    });
  };

  window.trackLogin = function (origen, opts) {
    try {
      const ultimo = sessionStorage.getItem(LOGIN_KEY);
      if (ultimo && (Date.now() - parseInt(ultimo, 10)) < LOGIN_TTL_MS) return;
      sessionStorage.setItem(LOGIN_KEY, String(Date.now()));
    } catch (_) {}

    if (!window.db) return;
    (async () => {
      try {
        const { error } = await window.db.rpc('track_login', {
          p_user_agent: navigator?.userAgent?.slice(0, 200) || null,
          p_origen: origen || 'login',
          p_metadata: opts?.metadata || {},
        });
        if (error) console.warn('[event-tracker] login', error.message);
      } catch (e) {
        console.warn('[event-tracker] login', e?.message || e);
      }
    })();
  };

  function _bindAuthListener() {
    if (!window.db?.auth) { setTimeout(_bindAuthListener, 100); return; }
    // Guard: una sola suscripción a onAuthStateChange aunque el script se
    // re-ejecute en visitas Turbo.
    if (window.__authTrackWired) return;
    window.__authTrackWired = true;

    window.db.auth.getSession().then(({ data }) => {
      if (data?.session) {
        sesionLista = true;
        _drain();
        window.trackLogin('session_hot');
      }
    });

    window.db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        sesionLista = true;
        _drain();
        window.trackLogin('signed_in');
      } else if (event === 'TOKEN_REFRESHED') {
        sesionLista = true;
      } else if (event === 'SIGNED_OUT') {
        sesionLista = false;
        try { sessionStorage.removeItem(LOGIN_KEY); } catch (_) {}
      }
    });
  }
  _bindAuthListener();

  // Guard: si el script se re-ejecuta (visita Turbo), no apilar otro listener
  // o cada navegación registraría eventos 'navegacion' duplicados.
  if (typeof document !== 'undefined' && !window.__navTrackWired) {
    window.__navTrackWired = true;
    document.addEventListener('turbo:load', () => {
      window.trackEvent('navegacion', {
        accion: 'cargo_pagina',
        pagina: location.pathname,
        metadata: { titulo: document.title?.slice(0, 100) },
      });
    });
  }

})();
