-- ============================================================================
-- Migración 58: Cron pg_cron para procesar-cola-automatizaciones cada 15 min
--
-- DISEÑO:
-- - app_secrets guarda secrets sensibles que pg_cron necesita (CRON_SECRET).
--   Tabla privada, solo service_role la lee.
-- - Función procesar_cola_via_http() llama a la Edge Function vía pg_net.
-- - Job 'procesar-cola-automatizaciones' corre cada 15 min.
-- - Loguea cada invocación en cron_log para debugging.
--
-- INDEPENDENCIA: si la edge function falla, el cron sigue corriendo y
-- guarda el error en cron_log para auditoría.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- Solo service_role lee/escribe
DROP POLICY IF EXISTS app_secrets_service ON app_secrets;
CREATE POLICY app_secrets_service ON app_secrets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO app_secrets (key, value)
VALUES ('cron_secret', '')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Función wrapper que llama a la Edge Function y loguea el resultado
CREATE OR REPLACE FUNCTION procesar_cola_via_http()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
  v_resultado jsonb;
BEGIN
  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';
  IF v_secret IS NULL THEN
    INSERT INTO cron_log (job_name, ejecutado_at, exito, detalle)
    VALUES ('procesar-cola-automatizaciones', now(), false,
            jsonb_build_object('error', 'cron_secret no configurado en app_secrets'));
    RETURN jsonb_build_object('ok', false, 'error', 'cron_secret no configurado');
  END IF;

  SELECT net.http_post(
    url := 'https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/procesar-cola-automatizaciones',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Function-Secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  v_resultado := jsonb_build_object('ok', true, 'request_id', v_request_id, 'invocado_at', now());

  INSERT INTO cron_log (job_name, ejecutado_at, exito, detalle)
  VALUES ('procesar-cola-automatizaciones', now(), true, v_resultado);

  RETURN v_resultado;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO cron_log (job_name, ejecutado_at, exito, detalle)
  VALUES ('procesar-cola-automatizaciones', now(), false,
          jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE));
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION procesar_cola_via_http IS
  'Invoca la edge function procesar-cola-automatizaciones vía pg_net con X-Function-Secret. Loguea en cron_log.';

-- Eliminar job previo (idempotencia)
DO $$ BEGIN
  PERFORM cron.unschedule('procesar-cola-automatizaciones');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Schedule: cada 15 min
SELECT cron.schedule(
  'procesar-cola-automatizaciones',
  '*/15 * * * *',
  'SELECT procesar_cola_via_http();'
);

COMMIT;
