-- ============================================================================
-- MIGRACIÓN 26: Fix de `ejecutar_cron_diario` para permitir ejecución de pg_cron
--
-- Bug encontrado 2026-05-18: la versión anterior rechazaba cualquier ejecución
-- que no tuviera un JWT con email de admin. Eso rompió las corridas automáticas
-- de pg_cron (que corren como rol `postgres` sin JWT) desde 2026-05-03.
-- Resultado: 16 días sin activar leads ni encolar notificaciones.
--
-- Fix:
--   - Si NO hay JWT (auth.jwt() devuelve NULL) → corrida automática, permitir.
--   - Si HAY JWT → debe pertenecer a un admin en usuarios_admin.
--
-- Esto preserva la seguridad para llamadas manuales desde la app y deja
-- pasar al cron real.
-- ============================================================================

CREATE OR REPLACE FUNCTION ejecutar_cron_diario()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_email TEXT;
  v_resultado JSONB;
  v_inicio TIMESTAMPTZ := clock_timestamp();
BEGIN
  v_caller_email := (auth.jwt() ->> 'email');

  -- Si hay JWT, debe ser admin. Si no hay JWT (pg_cron, service_role
  -- ejecutando directamente desde postgres), permitir.
  IF v_caller_email IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM usuarios_admin WHERE email = v_caller_email AND activo = true) THEN
      RAISE EXCEPTION 'no autorizado: solo admins pueden ejecutar el cron manualmente (caller: %)', v_caller_email;
    END IF;
  END IF;

  -- Ejecutar el cron real
  v_resultado := cron_diario_completo();

  -- Guardar en cron_log (solo nuestro wrapper, el interno también escribe)
  INSERT INTO cron_log (job_name, resultado, duracion_ms)
  VALUES (
    'ejecutar_cron_diario',
    v_resultado || jsonb_build_object('invocado_por',
      COALESCE(v_caller_email, 'pg_cron_automatico')),
    EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_inicio))::INT
  );

  RETURN v_resultado;
EXCEPTION WHEN OTHERS THEN
  -- Registrar el error y re-lanzarlo
  INSERT INTO cron_log (job_name, error, duracion_ms)
  VALUES (
    'ejecutar_cron_diario',
    SQLERRM,
    EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_inicio))::INT
  );
  RAISE;
END;
$$;

COMMENT ON FUNCTION ejecutar_cron_diario() IS
  'Wrapper de cron_diario_completo. Si hay JWT, requiere admin. Si no hay JWT (pg_cron), permite ejecutar. Loggea cada corrida en cron_log con quien la invocó.';
