// ============================================
// Re-Génesis — Configuración del frontend
// ============================================
//
// Solo claves PÚBLICAS. La service_role key y la
// ANTHROPIC_API_KEY NUNCA deben aparecer aquí.
//
// Cargar este archivo ANTES que supabase-client.js.

window.REGENESIS_CONFIG = {
  // Pública: identifica el proyecto.
  SUPABASE_URL: 'https://eqyaddcidkywmedwscpu.supabase.co',

  // Pública por diseño. La protección real de los datos vive en RLS.
  // Reemplaza el placeholder por la anon key real del proyecto.
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeWFkZGNpZGt5d21lZHdzY3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNTkyNjgsImV4cCI6MjA5MjgzNTI2OH0.EOSX_A5rSn6tOHDZPrbNg5jcveyJQ8yDZxOQhQ6jMJI',

  // Edge Function de análisis de reflexiones (Claude).
  EDGE_FUNCTION_ANALIZAR: 'https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/analizar-reflexion',
};
