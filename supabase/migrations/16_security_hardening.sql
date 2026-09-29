-- ============================================================================
-- 16_security_hardening.sql
-- Hardening de seguridad después de la auditoría con get_advisors:
--
-- 1. Cliente NO puede modificar su propio lead vía REST. Solo el admin
--    (via es_admin_activo) y el service_role (webhook-ghl) escriben en leads.
--    El cliente solo LEE su propio registro. Si quiere cambiar preferencias,
--    se hará vía RPC controlado.
--
-- 2. Funciones SECURITY DEFINER ya no son ejecutables por el rol `anon`.
--    Solo `authenticated`. (Las llamadas las hace el cliente o admin con JWT.)
--
-- 3. Se fija search_path = public, pg_temp en TODAS las funciones que tocan
--    tablas. Mitiga search_path hijacking attacks.
--
-- 4. La función rls_auto_enable() era de setup inicial; revocamos ejecución
--    a authenticated y anon.
-- ============================================================================

-- 1. Quitar políticas peligrosas del cliente sobre leads
DROP POLICY IF EXISTS "Lead puede crearse" ON public.leads;
DROP POLICY IF EXISTS "Lead puede actualizar su registro" ON public.leads;

-- 2. REVOKE de funciones SECURITY DEFINER al rol anon
REVOKE EXECUTE ON FUNCTION public.es_admin_activo() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_cron_jobs() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ejecutar_cron_diario() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;

-- 3. Fijar search_path en funciones para hardening
ALTER FUNCTION public.update_updated_at_column() SET search_path = public, pg_temp;
ALTER FUNCTION public.calcular_tema_actual_semana() SET search_path = public, pg_temp;
ALTER FUNCTION public.calcular_primer_tema_para_lead(date) SET search_path = public, pg_temp;
ALTER FUNCTION public.procesar_nuevo_cliente(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.tipo_sesion_de_hoy(uuid, date) SET search_path = public, pg_temp;
ALTER FUNCTION public.cron_diario_completo() SET search_path = public, pg_temp;
ALTER FUNCTION public.avanzar_lead_diario(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.encolar_notificaciones_diarias() SET search_path = public, pg_temp;
ALTER FUNCTION public.es_admin_activo() SET search_path = public, pg_temp;

-- 4. Validación admin en ejecutar_cron_diario (defensa en profundidad)
CREATE OR REPLACE FUNCTION public.ejecutar_cron_diario()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inicio TIMESTAMPTZ;
  v_resultado jsonb;
  v_error TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios_admin
    WHERE email = (auth.jwt() ->> 'email') AND activo = true
  ) THEN
    RAISE EXCEPTION 'no autorizado: solo admins pueden ejecutar el cron manualmente';
  END IF;

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
