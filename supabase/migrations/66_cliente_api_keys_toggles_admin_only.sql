-- ============================================================================
-- Migración 66 — Seguridad: solo admin puede cambiar usar_plataforma_* en
-- cliente_api_keys.
--
-- Antes: el cliente podía editar su propio row (RLS permite), incluyendo los
-- toggles que deciden quién paga el consumo (plataforma vs su propia key).
-- Eso le daba al cliente poder de "encender" el cobro a Neurohackers a su
-- antojo o desactivarlo aunque el admin lo hubiera decidido distinto.
--
-- Ahora: trigger BEFORE INSERT/UPDATE valida que solo un admin pueda alterar
-- esos toggles. El cliente sigue pudiendo pegar/borrar sus API keys, pero
-- no decide quién paga.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._cak_enforce_toggles_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text;
  v_is_admin boolean;
  v_changed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.usar_plataforma_anthropic IS DISTINCT FROM true
       OR NEW.usar_plataforma_openai IS DISTINCT FROM true THEN
      v_changed := true;
    END IF;
  ELSE
    IF NEW.usar_plataforma_anthropic IS DISTINCT FROM OLD.usar_plataforma_anthropic
       OR NEW.usar_plataforma_openai IS DISTINCT FROM OLD.usar_plataforma_openai THEN
      v_changed := true;
    END IF;
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  v_email := auth.jwt() ->> 'email';
  IF v_email IS NULL THEN RETURN NEW; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.usuarios_admin
    WHERE email = v_email AND activo = true AND rol = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Solo un admin puede decidir quién paga el consumo (usar_plataforma_anthropic / usar_plataforma_openai). El cliente solo puede pegar o borrar sus API keys.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cak_toggles_admin ON public.cliente_api_keys;
CREATE TRIGGER trg_cak_toggles_admin
BEFORE INSERT OR UPDATE ON public.cliente_api_keys
FOR EACH ROW EXECUTE FUNCTION public._cak_enforce_toggles_admin_only();
