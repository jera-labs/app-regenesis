// ============================================
// Re-Génesis — Cliente Supabase compartido
// ============================================
// Expone `window.db`. NO renombrar a `supabase`.
//
// Login compartido entre neurohackers.cloud y plataforma.neurohackers.cloud
// vía cookies con Domain=.neurohackers.cloud. Login en uno = logueado en el otro.
// AMBOS dominios deben usar este mismo bloque (mismo storageKey y mismo storage).
//
// Orden obligatorio en cada HTML:
//   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   2. <script src="assets/scripts/config.js"></script>
//   3. <script src="assets/scripts/supabase-client.js"></script>

(function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    throw new Error('[Re-Génesis] Falta @supabase/supabase-js@2 antes de supabase-client.js');
  }
  if (typeof window.REGENESIS_CONFIG === 'undefined') {
    throw new Error('[Re-Génesis] Falta config.js antes de supabase-client.js');
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.REGENESIS_CONFIG;

  if (!SUPABASE_URL || SUPABASE_ANON_KEY === 'REPLACE_WITH_ANON_KEY') {
    console.warn('[Re-Génesis] config.js todavía tiene el placeholder de la anon key.');
  }

  // ----------- Custom storage: cookies con Domain=.neurohackers.cloud -----------
  // Las cookies tienen límite ~4KB por entrada, así que partimos en chunks de 3500.
  // Lectura: cookie entera, luego chunks .0, .1, ... y fallback a localStorage legacy.
  const COOKIE_DOMAIN = '.neurohackers.cloud';
  const COOKIE_OPTS_BASE = `Path=/; Domain=${COOKIE_DOMAIN}; SameSite=Lax; Secure`;
  const CHUNK_SIZE = 3500;
  const MAX_AGE_DAYS = 30;

  function parseCookies() {
    const out = {};
    (document.cookie || '').split(';').forEach(part => {
      const i = part.indexOf('=');
      if (i < 0) return;
      out[part.slice(0, i).trim()] = part.slice(i + 1);
    });
    return out;
  }

  function readCookie(name) {
    const cookies = parseCookies();
    if (cookies[name] != null) {
      try { return decodeURIComponent(cookies[name]); } catch { return cookies[name]; }
    }
    let acc = '', i = 0, found = false;
    while (cookies[`${name}.${i}`] != null) {
      try { acc += decodeURIComponent(cookies[`${name}.${i}`]); }
      catch { acc += cookies[`${name}.${i}`]; }
      i++; found = true;
    }
    return found ? acc : null;
  }

  function clearCookie(name) {
    document.cookie = `${name}=; ${COOKIE_OPTS_BASE}; Max-Age=0`;
    let i = 0;
    const cookies = parseCookies();
    while (cookies[`${name}.${i}`] != null) {
      document.cookie = `${name}.${i}=; ${COOKIE_OPTS_BASE}; Max-Age=0`;
      i++;
    }
  }

  function writeCookie(name, value) {
    clearCookie(name);
    const encoded = encodeURIComponent(value);
    const maxAge = `Max-Age=${MAX_AGE_DAYS * 86400}`;
    if (encoded.length <= CHUNK_SIZE) {
      document.cookie = `${name}=${encoded}; ${COOKIE_OPTS_BASE}; ${maxAge}`;
      return;
    }
    let i = 0;
    for (let off = 0; off < encoded.length; off += CHUNK_SIZE, i++) {
      document.cookie = `${name}.${i}=${encoded.slice(off, off + CHUNK_SIZE)}; ${COOKIE_OPTS_BASE}; ${maxAge}`;
    }
  }

  const sharedCookieStorage = {
    getItem(key) {
      const c = readCookie(key);
      if (c != null) return c;
      try { return localStorage.getItem(key); } catch { return null; }
    },
    setItem(key, value) {
      writeCookie(key, value);
      try { localStorage.removeItem(key); } catch {}
    },
    removeItem(key) {
      clearCookie(key);
      try { localStorage.removeItem(key); } catch {}
    },
  };

  // Migración suave: si todavía tienes una sesión en localStorage con el storageKey
  // anterior (cuando cada dominio guardaba aparte), la movemos a la cookie compartida
  // para que NO tengas que volver a iniciar sesión tras este cambio.
  const NEW_KEY = 'neurohackers-sb-auth';
  const LEGACY_KEYS = ['neurohackers-auth', 'sb-eqyaddcidkywmedwscpu-auth-token'];
  try {
    if (!readCookie(NEW_KEY)) {
      for (const old of LEGACY_KEYS) {
        const v = localStorage.getItem(old);
        if (v) {
          writeCookie(NEW_KEY, v);
          localStorage.removeItem(old);
          console.info('[Re-Génesis] sesión migrada a cookie compartida desde', old);
          break;
        }
      }
    }
  } catch (e) { console.warn('[Re-Génesis] migración suave falló:', e?.message); }

  window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: sharedCookieStorage,
      storageKey: 'neurohackers-sb-auth', // mismo nombre en plataforma y neurohackers.cloud
    },
  });
})();
