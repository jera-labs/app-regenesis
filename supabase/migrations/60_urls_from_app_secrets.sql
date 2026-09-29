-- Migración 60: URLs de Edge Functions ya no hardcoded
-- Lee desde app_secrets.functions_url para que cambiar de proyecto sea trivial.

BEGIN;

-- procesar_cola_via_http (de migración 58)
CREATE OR REPLACE FUNCTION procesar_cola_via_http()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_request_id bigint;
  v_resultado jsonb;
  v_inicio timestamptz := clock_timestamp();
BEGIN
  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';
  SELECT value INTO v_url FROM app_secrets WHERE key = 'functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    INSERT INTO cron_log (job_name, ejecutado_at, resultado, error, duracion_ms)
    VALUES ('procesar-cola-automatizaciones', now(),
            jsonb_build_object('ok', false),
            'cron_secret o functions_url no configurados en app_secrets',
            EXTRACT(MILLISECOND FROM clock_timestamp() - v_inicio)::int);
    RETURN jsonb_build_object('ok', false, 'error', 'secrets/url faltantes');
  END IF;

  SELECT net.http_post(
    url := v_url || '/procesar-cola-automatizaciones',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Function-Secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) INTO v_request_id;

  v_resultado := jsonb_build_object('ok', true, 'request_id', v_request_id, 'invocado_at', now());

  INSERT INTO cron_log (job_name, ejecutado_at, resultado, duracion_ms)
  VALUES ('procesar-cola-automatizaciones', now(), v_resultado,
          EXTRACT(MILLISECOND FROM clock_timestamp() - v_inicio)::int);

  RETURN v_resultado;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO cron_log (job_name, ejecutado_at, resultado, error, duracion_ms)
  VALUES ('procesar-cola-automatizaciones', now(),
          jsonb_build_object('ok', false), SQLERRM,
          EXTRACT(MILLISECOND FROM clock_timestamp() - v_inicio)::int);
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- sync_lead_ghl_async (de migración 59)
CREATE OR REPLACE FUNCTION sync_lead_ghl_async(p_lead_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_secret text;
  v_url text;
  v_request_id bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead_id AND ghl_contact_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';
  SELECT value INTO v_url FROM app_secrets WHERE key = 'functions_url';

  IF v_secret IS NULL OR v_url IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := v_url || '/sync-lead-ghl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Function-Secret', v_secret
    ),
    body := jsonb_build_object('lead_id', p_lead_id),
    timeout_milliseconds := 15000
  ) INTO v_request_id;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMIT;
