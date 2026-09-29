-- ============================================================================
-- Migración 69 — Seguridad: solo admin puede modificar leads.ghl_* del cliente.
--
-- La RLS de leads permite UPDATE al cliente sobre su propio row (policy "Lead
-- puede actualizar su propio registro"). Eso permitiría que el cliente cambie
-- su ghl_sub_location_id al de otro cliente y vea las URLs del otro. El
-- trigger bloquea explícitamente cambios a los campos ghl_*.
--
-- Service role bypass (lo usa la edge function sync-dna-to-ghl-brand-panel
-- para escribir ghl_brand_synced_at).
-- ============================================================================

CREATE OR REPLACE FUNCTION public._leads_enforce_ghl_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_is_admin boolean;
  v_cambio boolean := false;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;

  IF NEW.ghl_sub_location_id  IS DISTINCT FROM OLD.ghl_sub_location_id
     OR NEW.ghl_sub_location_url IS DISTINCT FROM OLD.ghl_sub_location_url
     OR NEW.ghl_contact_id      IS DISTINCT FROM OLD.ghl_contact_id THEN
    v_cambio := true;
  END IF;

  IF NOT v_cambio THEN RETURN NEW; END IF;

  v_email := auth.jwt() ->> 'email';
  IF v_email IS NULL THEN RETURN NEW; END IF;  -- service_role bypass

  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_admin
    WHERE email = v_email AND activo = true AND rol = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo un admin puede modificar la conexión GHL del cliente.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_leads_ghl_admin_only ON public.leads;
CREATE TRIGGER trg_leads_ghl_admin_only
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public._leads_enforce_ghl_admin_only();
