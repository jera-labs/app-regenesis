// ============================================
// Neurohackers Platform — Config del frontend
// ============================================
// Solo claves PÚBLICAS. service_role NUNCA aquí.
// Misma config que Re-Génesis (compartimos Supabase).

window.NEURO_CONFIG = {
  SUPABASE_URL: 'https://eqyaddcidkywmedwscpu.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeWFkZGNpZGt5d21lZHdzY3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNTkyNjgsImV4cCI6MjA5MjgzNTI2OH0.EOSX_A5rSn6tOHDZPrbNg5jcveyJQ8yDZxOQhQ6jMJI',

  // Edge Functions
  EDGE_AUDITAR_PRODUCTO: 'https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/auditar-producto',

  // URLs internas
  LOGIN_URL: 'login.html',
  HOME_URL: 'index.html',
  REGENESIS_URL: 'https://neurohackers.cloud/',
};
