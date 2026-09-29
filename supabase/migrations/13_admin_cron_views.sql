-- ============================================================================
-- 13_admin_cron_views.sql
-- Funciones SECURITY DEFINER para que el panel admin pueda leer cron.job
-- (el schema cron no está expuesto vía PostgREST por defecto).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_cron_jobs()
RETURNS TABLE(
  jobid bigint,
  jobname text,
  schedule text,
  command text,
  active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios_admin ua
    WHERE ua.email = (auth.jwt() ->> 'email') AND ua.activo = true
  ) THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;

  RETURN QUERY
  SELECT j.jobid, j.jobname, j.schedule, j.command, j.active
  FROM cron.job j
  WHERE j.jobname LIKE 'regenesis-%'
  ORDER BY j.jobid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_cron_jobs() TO authenticated;
