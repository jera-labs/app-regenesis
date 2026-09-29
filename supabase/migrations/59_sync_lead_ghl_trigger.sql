-- ============================================================================
-- Migración 59: Trigger AFTER UPDATE en leads que sincroniza con GHL custom fields
--
-- Cuándo dispara:
-- - Cambio en tema_actual_orden (cron diario lo cambia al avanzar semana)
-- - Cambio en fecha_activacion_programa
-- - Cambio en fecha_fin_contractual
-- - Cambio en duracion_contractual_dias
--
-- Cómo funciona:
-- - Trigger llama a sync_lead_ghl_async(lead_id) que despacha vía pg_net a
--   la edge function sync-lead-ghl con X-Function-Secret.
-- - Es fire-and-forget: no bloquea el UPDATE de leads.
-- - Si la edge function falla, el trigger no falla (catch silencioso) para
--   no romper updates legítimos.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION sync_lead_ghl_async(p_lead_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, net
AS $$
DECLARE
  v_secret text;
  v_request_id bigint;
BEGIN
  -- Solo si el lead tiene ghl_contact_id; sino skip
  IF NOT EXISTS (SELECT 1 FROM leads WHERE id = p_lead_id AND ghl_contact_id IS NOT NULL) THEN
    RETURN NULL;
  END IF;

  SELECT value INTO v_secret FROM app_secrets WHERE key = 'cron_secret';
  IF v_secret IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := 'https://eqyaddcidkywmedwscpu.supabase.co/functions/v1/sync-lead-ghl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Function-Secret', v_secret
    ),
    body := jsonb_build_object('lead_id', p_lead_id),
    timeout_milliseconds := 15000
  ) INTO v_request_id;

  RETURN v_request_id;
EXCEPTION WHEN OTHERS THEN
  -- Fire-and-forget: no propagar errores al trigger
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION sync_lead_ghl_async IS
  'Despacha sincronización del lead a GHL custom fields. Fire-and-forget vía pg_net.';


-- Trigger function: detecta cambios relevantes y dispara
CREATE OR REPLACE FUNCTION trigger_sync_lead_ghl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Solo si cambió algún campo relevante o si es INSERT con activación
  IF TG_OP = 'INSERT' THEN
    IF NEW.ghl_contact_id IS NOT NULL AND NEW.fecha_activacion_programa IS NOT NULL THEN
      PERFORM sync_lead_ghl_async(NEW.id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: solo si cambió algún campo relevante
  IF (NEW.tema_actual_orden        IS DISTINCT FROM OLD.tema_actual_orden)
     OR (NEW.fecha_activacion_programa IS DISTINCT FROM OLD.fecha_activacion_programa)
     OR (NEW.fecha_fin_contractual     IS DISTINCT FROM OLD.fecha_fin_contractual)
     OR (NEW.duracion_contractual_dias IS DISTINCT FROM OLD.duracion_contractual_dias)
     OR (NEW.ghl_contact_id            IS DISTINCT FROM OLD.ghl_contact_id)
  THEN
    PERFORM sync_lead_ghl_async(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_sync_ghl_trigger ON leads;
CREATE TRIGGER leads_sync_ghl_trigger
AFTER INSERT OR UPDATE ON leads
FOR EACH ROW EXECUTE FUNCTION trigger_sync_lead_ghl();

COMMENT ON TRIGGER leads_sync_ghl_trigger ON leads IS
  'Sincroniza el lead a GHL custom fields cuando cambia tema, fechas, duración o ghl_contact_id.';

COMMIT;
