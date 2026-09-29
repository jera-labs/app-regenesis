// ============================================================================
// cache.js · cache TTL en sessionStorage para catálogos casi inmutables
//
// Uso:
//   const cohortes = await neuroCache.get('cohortes',
//     () => db.from('cohortes').select('*').then(r => r.data),
//     { ttlMs: 5 * 60 * 1000 }    // opcional, default 5 min
//   );
//
//   neuroCache.invalidate('cohortes');           // al editar/crear
//   neuroCache.invalidatePrefix('etiquetas');    // borra todo lo de etiquetas
//   neuroCache.clear();                          // borra todo el cache
//
// Diseño:
// - Por sesión (no compartido entre pestañas). sessionStorage se borra al
//   cerrar pestaña/navegador, lo cual es exactamente lo que queremos:
//   cada sesión arranca con catálogos frescos.
// - Prefix 'nc:' en cada key para no chocar con otras cosas.
// - TTL granular: cada `get()` puede tener su propio TTL.
// - Fallback silencioso: si sessionStorage falla (Safari private mode, quota),
//   simplemente no cachea y devuelve el fetcher directo.
// ============================================================================

(function () {
  const PREFIX = 'nc:';
  const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutos

  function _read(key) {
    try {
      const raw = sessionStorage.getItem(PREFIX + key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (typeof obj?.expires !== 'number') return null;
      if (Date.now() >= obj.expires) return null;
      return obj.data;
    } catch (_) { return null; }
  }

  function _write(key, data, ttlMs) {
    try {
      sessionStorage.setItem(PREFIX + key, JSON.stringify({
        data,
        expires: Date.now() + ttlMs,
      }));
    } catch (_) { /* quota / private mode — ignore */ }
  }

  window.neuroCache = {
    /**
     * Obtiene un valor del cache, o lo calcula con `fetcher` y lo guarda.
     * @param {string} key  ej. "cohortes" | "etiquetas_activa"
     * @param {() => Promise<any>} fetcher  devuelve la data fresca
     * @param {{ttlMs?: number}} opts
     */
    async get(key, fetcher, opts = {}) {
      const cached = _read(key);
      if (cached !== null) return cached;
      const data = await fetcher();
      // Nunca cachear null/undefined ni strings vacíos: probablemente es un error.
      if (data !== null && data !== undefined && data !== '') {
        _write(key, data, opts.ttlMs || DEFAULT_TTL_MS);
      }
      return data;
    },

    invalidate(key) {
      try { sessionStorage.removeItem(PREFIX + key); } catch (_) {}
    },

    invalidatePrefix(prefix) {
      try {
        const target = PREFIX + prefix;
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(target)) toRemove.push(k);
        }
        toRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (_) {}
    },

    clear() {
      try {
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(PREFIX)) toRemove.push(k);
        }
        toRemove.forEach(k => sessionStorage.removeItem(k));
      } catch (_) {}
    },

    // === Debug helpers ===
    _list() {
      const result = {};
      try {
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(PREFIX)) {
            const v = JSON.parse(sessionStorage.getItem(k));
            result[k.slice(PREFIX.length)] = {
              expiresIn: Math.round((v.expires - Date.now()) / 1000) + 's',
              size: sessionStorage.getItem(k).length,
            };
          }
        }
      } catch (_) {}
      return result;
    },
  };
})();
