// ============================================
// Re-Génesis — Cliente Supabase compartido
// ============================================
//
// Expone la constante global `db` para todo el frontend.
// NO renombrar a `supabase` — colisiona con window.supabase
// (la librería oficial), y rompe los scripts subsecuentes.
//
// Orden de carga obligatorio en cada HTML:
//   1. <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   2. <script src="/regenesis/assets/scripts/config.js"></script>
//   3. <script src="/regenesis/assets/scripts/supabase-client.js"></script>

(function initSupabaseClient() {
  if (typeof window.supabase === 'undefined') {
    throw new Error(
      '[Re-Génesis] Falta @supabase/supabase-js@2. ' +
      'Cárgalo desde el CDN antes de supabase-client.js.'
    );
  }

  if (typeof window.REGENESIS_CONFIG === 'undefined') {
    throw new Error(
      '[Re-Génesis] Falta config.js. ' +
      'Cárgalo antes de supabase-client.js.'
    );
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.REGENESIS_CONFIG;

  if (!SUPABASE_URL || SUPABASE_ANON_KEY === 'REPLACE_WITH_ANON_KEY') {
    console.warn(
      '[Re-Génesis] config.js todavía tiene el placeholder de la anon key. ' +
      'Reemplázalo con la clave real antes de usar la app.'
    );
  }

  window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Compartido con plataforma para login único bajo plataforma.neurohackers.cloud
      // (cuando Re-Génesis vivía en neurohackers.cloud independiente, no se seteaba)
      storageKey: 'neurohackers-auth',
    },
  });
})();
