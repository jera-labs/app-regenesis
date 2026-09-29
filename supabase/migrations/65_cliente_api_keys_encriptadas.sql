-- ============================================================================
-- Migración 65 — encriptación de cliente_api_keys con pgcrypto + Supabase Vault.
--
-- Las API keys ya no se guardan en plaintext. Se cifran con AES-256 via
-- pgp_sym_encrypt usando una master key generada en Vault. La key NO se puede
-- recuperar después de guardar; solo las edge functions (vía resolve_api_key
-- SECURITY DEFINER) pueden desencriptarla en runtime.
--
-- UX: se conserva *_key_last4 para que el cliente identifique cuál key tiene.
-- ============================================================================

-- 1. Crear master key en Vault si no existe (256 bits aleatorios, base64)
DO $$
DECLARE v_existing uuid;
BEGIN
  SELECT id INTO v_existing FROM vault.secrets WHERE name = 'cak_master_key' LIMIT 1;
  IF v_existing IS NULL THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'cak_master_key',
      'Master key for cliente_api_keys column encryption (AES-256 via pgp_sym_encrypt)'
    );
  END IF;
END $$;

-- 2. Helper privado para leer la master key (SECURITY DEFINER; sin grants públicos)
CREATE OR REPLACE FUNCTION public._cak_master_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vault, public, pg_temp
AS $$
DECLARE v text;
BEGIN
  SELECT decrypted_secret INTO v FROM vault.decrypted_secrets WHERE name = 'cak_master_key' LIMIT 1;
  IF v IS NULL THEN RAISE EXCEPTION 'cak_master_key missing in vault'; END IF;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public._cak_master_key() FROM PUBLIC, authenticated, anon;

-- 3. Columnas cifradas + last4 (para que la UI muestre algo identificable)
ALTER TABLE public.cliente_api_keys
  ADD COLUMN IF NOT EXISTS anthropic_key_enc bytea,
  ADD COLUMN IF NOT EXISTS openai_key_enc    bytea,
  ADD COLUMN IF NOT EXISTS anthropic_key_last4 text,
  ADD COLUMN IF NOT EXISTS openai_key_last4    text;

-- 4. Trigger BEFORE INSERT/UPDATE: cifra valores plaintext entrantes, los limpia, y guarda last4.
--    Preserva el cifrado existente si el cliente solo cambia los toggles.
CREATE OR REPLACE FUNCTION public._cak_encrypt_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE k text;
BEGIN
  k := public._cak_master_key();

  IF NEW.anthropic_key IS NOT NULL AND length(trim(NEW.anthropic_key)) > 0 THEN
    NEW.anthropic_key_enc   := extensions.pgp_sym_encrypt(NEW.anthropic_key, k);
    NEW.anthropic_key_last4 := right(NEW.anthropic_key, 4);
    NEW.anthropic_key       := NULL;
  ELSIF TG_OP = 'UPDATE' AND NEW.anthropic_key IS NULL AND NEW.anthropic_key_enc IS NULL AND OLD.anthropic_key_enc IS NOT NULL THEN
    NEW.anthropic_key_enc   := OLD.anthropic_key_enc;
    NEW.anthropic_key_last4 := OLD.anthropic_key_last4;
  END IF;

  IF NEW.openai_key IS NOT NULL AND length(trim(NEW.openai_key)) > 0 THEN
    NEW.openai_key_enc   := extensions.pgp_sym_encrypt(NEW.openai_key, k);
    NEW.openai_key_last4 := right(NEW.openai_key, 4);
    NEW.openai_key       := NULL;
  ELSIF TG_OP = 'UPDATE' AND NEW.openai_key IS NULL AND NEW.openai_key_enc IS NULL AND OLD.openai_key_enc IS NOT NULL THEN
    NEW.openai_key_enc   := OLD.openai_key_enc;
    NEW.openai_key_last4 := OLD.openai_key_last4;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cak_encrypt ON public.cliente_api_keys;
CREATE TRIGGER trg_cak_encrypt
BEFORE INSERT OR UPDATE ON public.cliente_api_keys
FOR EACH ROW EXECUTE FUNCTION public._cak_encrypt_keys();

-- 5. Backfill plaintext residual (no debería haber, idempotente igual)
UPDATE public.cliente_api_keys SET anthropic_key = anthropic_key WHERE anthropic_key IS NOT NULL;
UPDATE public.cliente_api_keys SET openai_key    = openai_key    WHERE openai_key    IS NOT NULL;

-- 6. resolve_api_key: desencripta antes de devolver
CREATE OR REPLACE FUNCTION public.resolve_api_key(p_lead_id uuid, p_provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.cliente_api_keys%ROWTYPE;
  v_usar_plataforma boolean;
  v_enc bytea;
  v_key text;
  v_master text;
BEGIN
  SELECT * INTO v_row FROM public.cliente_api_keys WHERE lead_id = p_lead_id;
  IF v_row.lead_id IS NULL THEN
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  IF p_provider = 'anthropic' THEN
    v_usar_plataforma := COALESCE(v_row.usar_plataforma_anthropic, true);
    v_enc := v_row.anthropic_key_enc;
  ELSIF p_provider = 'openai' THEN
    v_usar_plataforma := COALESCE(v_row.usar_plataforma_openai, true);
    v_enc := v_row.openai_key_enc;
  ELSE
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  IF v_usar_plataforma THEN
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  IF v_enc IS NULL THEN
    RETURN jsonb_build_object(
      'use_platform', false, 'key', null,
      'error', format('Configura tu API key de %s en /studio/configuracion/', p_provider)
    );
  END IF;

  BEGIN
    v_master := public._cak_master_key();
    v_key := extensions.pgp_sym_decrypt(v_enc, v_master);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('use_platform', false, 'key', null, 'error', 'Error al desencriptar key. Contacta al admin.');
  END;

  IF v_key IS NULL OR length(trim(v_key)) = 0 THEN
    RETURN jsonb_build_object('use_platform', false, 'key', null, 'error', 'Key vacía tras desencriptar.');
  END IF;

  RETURN jsonb_build_object('use_platform', false, 'key', v_key);
END $$;

GRANT EXECUTE ON FUNCTION public.resolve_api_key(uuid, text) TO authenticated, service_role;

COMMENT ON COLUMN public.cliente_api_keys.anthropic_key IS 'Solo write-only: el trigger lo cifra y deja NULL. Nunca se lee.';
COMMENT ON COLUMN public.cliente_api_keys.openai_key    IS 'Solo write-only: el trigger lo cifra y deja NULL. Nunca se lee.';
COMMENT ON COLUMN public.cliente_api_keys.anthropic_key_enc IS 'Anthropic key cifrada (pgp_sym_encrypt AES-256 con cak_master_key del Vault).';
COMMENT ON COLUMN public.cliente_api_keys.openai_key_enc    IS 'OpenAI key cifrada (pgp_sym_encrypt AES-256 con cak_master_key del Vault).';
COMMENT ON COLUMN public.cliente_api_keys.anthropic_key_last4 IS 'Últimos 4 caracteres en plaintext, para identificar la key en la UI.';
COMMENT ON COLUMN public.cliente_api_keys.openai_key_last4    IS 'Últimos 4 caracteres en plaintext, para identificar la key en la UI.';
