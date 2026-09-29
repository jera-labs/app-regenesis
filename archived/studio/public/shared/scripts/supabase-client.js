// ============================================
// Cliente Supabase compartido (Neurohackers Platform)
// ============================================
// Expone `window.db`. NO renombrar a `supabase`.
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

  window.db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'neurohackers-auth', // distinto al de Re-Génesis para sesiones independientes
    },
  });
})();
