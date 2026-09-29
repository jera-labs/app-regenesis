-- ============================================================================
-- Migración 61: Trigger AFTER INSERT en testimonios que notifica a Frank
-- via Telegram (edge function notificar-testimonio).
-- Fire-and-forget: si falla, no rompe el INSERT del testimonio.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION notificar_testimonio_async(p_testimonio_id uuid)
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
  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';
  SELECT value INTO v_url    FROM app_secrets WHERE key = 'functions_url';
  IF v_secret IS NULL OR v_url IS NULL THEN RETURN NULL; END IF;

  SELECT net.http_post(
    url := v_url || '/notificar-testimonio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Function-Secret', v_secret
    ),
    body := jsonb_build_object('testimonio_id', p_testimonio_id),
    timeout_milliseconds := 10000
  ) INTO v_request_id;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_notificar_testimonio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo cuando se recibe contenido real (testimonio escrito o video subido)
  IF TG_OP = 'INSERT' THEN
    IF NEW.testimonio_escrito IS NOT NULL OR NEW.testimonio_video_path IS NOT NULL THEN
      PERFORM notificar_testimonio_async(NEW.id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Si pasaron de "solicitado" (sin contenido) a "recibido" (con contenido)
    IF (OLD.testimonio_video_path IS NULL AND NEW.testimonio_video_path IS NOT NULL)
       OR (OLD.testimonio_escrito IS NULL AND NEW.testimonio_escrito IS NOT NULL) THEN
      PERFORM notificar_testimonio_async(NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS testimonio_notificar_trigger ON testimonios;
CREATE TRIGGER testimonio_notificar_trigger
AFTER INSERT OR UPDATE ON testimonios
FOR EACH ROW EXECUTE FUNCTION trigger_notificar_testimonio();

COMMIT;
