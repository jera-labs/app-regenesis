-- ============================================================================
-- 11_pg_cron_pg_net.sql
-- Activa pg_cron + pg_net y programa el job diario que avanza a todos los leads.
-- pg_cron usa UTC. 11:00 UTC = 06:00 Bogotá (zona America/Bogota, UTC-5 sin DST).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tabla de log para que el admin pueda ver qué hizo el cron cada día
-- (cron.job_run_details existe pero solo guarda status, no payload de retorno).
CREATE TABLE IF NOT EXISTS public.cron_log (
  id BIGSERIAL PRIMARY KEY,
  ejecutado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  job_name TEXT NOT NULL,
  resultado JSONB,
  error TEXT,
  duracion_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cron_log_ejecutado_at ON public.cron_log(ejecutado_at DESC);

-- Wrapper que ejecuta cron_diario_completo y guarda el resultado en cron_log
CREATE OR REPLACE FUNCTION public.ejecutar_cron_diario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inicio TIMESTAMPTZ;
  v_resultado jsonb;
  v_error TEXT;
BEGIN
  v_inicio := clock_timestamp();

  BEGIN
    v_resultado := public.cron_diario_completo();
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  INSERT INTO public.cron_log (job_name, resultado, error, duracion_ms)
  VALUES (
    'cron_diario_completo',
    v_resultado,
    v_error,
    EXTRACT(MILLISECONDS FROM clock_timestamp() - v_inicio)::int
  );

  RETURN coalesce(v_resultado, jsonb_build_object('error', v_error));
END;
$$;

-- Desprogramar cualquier versión anterior con el mismo nombre (idempotente)
DO $$
DECLARE
  v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'regenesis-diario';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

-- Programar diario a las 11:00 UTC (06:00 Bogotá)
SELECT cron.schedule(
  'regenesis-diario',
  '0 11 * * *',
  $cron$ SELECT public.ejecutar_cron_diario(); $cron$
);

-- RLS: los admins necesitan leer cron_log desde el panel
ALTER TABLE public.cron_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_lee_cron_log" ON public.cron_log;
CREATE POLICY "admin_lee_cron_log" ON public.cron_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.usuarios_admin ua
      WHERE ua.email = (auth.jwt() ->> 'email')
    )
  );

-- Permitir que el admin invoque el wrapper manualmente desde la app
GRANT EXECUTE ON FUNCTION public.ejecutar_cron_diario() TO authenticated;
