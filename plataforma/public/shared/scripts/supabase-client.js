// ============================================
// Cliente Supabase compartido (Neurohackers Platform)
// ============================================
// Expone `window.db`. NO renombrar a `supabase`.
//
// Tras la migración de Re-Génesis a /regenesis/* en plataforma, ya NO usamos
// cookies compartidas cross-domain. Todo vive en plataforma.neurohackers.cloud
// con localStorage normal. Hacemos migración inversa (cookie → localStorage)
// para usuarios que tienen sesión guardada de los intentos anteriores.
//
// Orden obligatorio en cada HTML:
//   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   2. <script src="shared/scripts/config.js"></script>
//   3. <script src="shared/scripts/supabase-client.js"></script>

(function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    throw new Error('[Neurohackers] Falta @supabase/supabase-js@2 antes de supabase-client.js');
  }
  if (typeof window.NEURO_CONFIG === 'undefined') {
    throw new Error('[Neurohackers] Falta config.js antes de supabase-client.js');
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.NEURO_CONFIG;
  const STORAGE_KEY = 'neurohackers-auth';

  // ============================================================
  // Migración inversa: si hay sesión en alguno de los storages viejos
  // (cookie compartida `.neurohackers.cloud` o storageKey legacy),
  // muévela a localStorage.neurohackers-auth y limpia el resto.
  // Así NO se pierde sesión al refactorizar.
  // ============================================================
  try {
    if (!localStorage.getItem(STORAGE_KEY)) {
      // 1) cookie compartida nueva (neurohackers-sb-auth) → localStorage
      let val = readCookieAndAssemble('neurohackers-sb-auth');
      // 2) fallback: storageKey legacy de Supabase (cuando Re-Génesis usaba el default)
      if (!val) val = localStorage.getItem('sb-eqyaddcidkywmedwscpu-auth-token');
      if (val) {
        localStorage.setItem(STORAGE_KEY, val);
        // Limpiar cookies compartidas (entera + posibles chunks)
        clearSharedCookie('neurohackers-sb-auth');
        try { localStorage.removeItem('sb-eqyaddcidkywmedwscpu-auth-token'); } catch {}
        console.info('[Neurohackers] sesión migrada a localStorage local');
      }
    }
  } catch (e) {
    console.warn('[Neurohackers] migración inversa falló:', e?.message);
  }

  function readCookieAndAssemble(name) {
    const cookies = {};
    (document.cookie || '').split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i < 0) return;
      cookies[p.slice(0, i).trim()] = p.slice(i + 1);
    });
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

  function clearSharedCookie(name) {
    const base = 'Path=/; Domain=.neurohackers.cloud; SameSite=Lax; Secure; Max-Age=0';
    document.cookie = `${name}=; ${base}`;
    for (let i = 0; i < 20; i++) document.cookie = `${name}.${i}=; ${base}`;
  }

  window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: STORAGE_KEY,
    },
  });
})();
