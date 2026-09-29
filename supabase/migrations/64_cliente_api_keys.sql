-- ============================================================================
-- Migración 64 — API keys por cliente para Studio (generación de contenido).
--
-- Cada cliente puede:
--   1. Heredar las keys de la plataforma (default: sí, gratis para él).
--   2. Apagar el uso de la plataforma → debe pegar la suya.
--
-- Solo aplica al Studio (generar-contenido + generar-imagen-dalle).
-- Las demás funciones IA (auditar-producto, etc.) siguen usando keys de plataforma.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cliente_api_keys (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  anthropic_key text,
  openai_key text,
  -- TRUE = usar keys de plataforma (default). FALSE = el cliente paga con la suya.
  -- Si FALSE y key vacía → bloqueo con mensaje claro.
  usar_plataforma_anthropic boolean NOT NULL DEFAULT true,
  usar_plataforma_openai boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cliente_api_keys ENABLE ROW LEVEL SECURITY;

-- Service role total
CREATE POLICY cak_service ON public.cliente_api_keys FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- Admin lee/escribe todas
CREATE POLICY cak_admin_all ON public.cliente_api_keys FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.usuarios_admin WHERE email = (auth.jwt() ->> 'email') AND activo = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.usuarios_admin WHERE email = (auth.jwt() ->> 'email') AND activo = true));

-- Cliente lee/escribe lo suyo
CREATE POLICY cak_cliente_own ON public.cliente_api_keys FOR ALL
TO authenticated
USING (lead_id IN (SELECT id FROM public.leads WHERE email = (auth.jwt() ->> 'email')))
WITH CHECK (lead_id IN (SELECT id FROM public.leads WHERE email = (auth.jwt() ->> 'email')));

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_cliente_api_keys()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_api_keys_updated_at ON public.cliente_api_keys;
CREATE TRIGGER trg_cliente_api_keys_updated_at
BEFORE UPDATE ON public.cliente_api_keys
FOR EACH ROW EXECUTE FUNCTION public.touch_cliente_api_keys();

-- ============================================================================
-- resolve_api_key: la edge function la llama (SECURITY DEFINER lee
-- la tabla y devuelve qué key usar para el lead+provider).
--
-- Output jsonb:
--   { use_platform: true }                          → usar key del env
--   { use_platform: false, key: 'sk-...' }          → usar key del cliente
--   { use_platform: false, key: null, error: '...' } → bloqueado, falta key
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_api_key(p_lead_id uuid, p_provider text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.cliente_api_keys%ROWTYPE;
  v_usar_plataforma boolean;
  v_key text;
BEGIN
  SELECT * INTO v_row FROM public.cliente_api_keys WHERE lead_id = p_lead_id;

  IF p_provider = 'anthropic' THEN
    v_usar_plataforma := COALESCE(v_row.usar_plataforma_anthropic, true);
    v_key := v_row.anthropic_key;
  ELSIF p_provider = 'openai' THEN
    v_usar_plataforma := COALESCE(v_row.usar_plataforma_openai, true);
    v_key := v_row.openai_key;
  ELSE
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  -- No tiene fila → usa plataforma por default
  IF v_row.lead_id IS NULL THEN
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  IF v_usar_plataforma THEN
    RETURN jsonb_build_object('use_platform', true);
  END IF;

  -- Quiere usar su propia key, debe estar seteada
  IF v_key IS NULL OR length(trim(v_key)) = 0 THEN
    RETURN jsonb_build_object(
      'use_platform', false,
      'key', null,
      'error', format('Tu cuenta debe configurar la API key de %s antes de generar contenido. Ve a /studio/configuracion/', p_provider)
    );
  END IF;

  RETURN jsonb_build_object('use_platform', false, 'key', v_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_api_key(uuid, text) TO authenticated, service_role;

COMMENT ON TABLE public.cliente_api_keys IS 'Studio: API keys por cliente para Anthropic y OpenAI. Si usar_plataforma_* = false y key vacía, las edge functions bloquean.';

-- ============================================================================
-- Trackeo de "quién pagó" cada generación, para reportes de costo.
--   true  → la plataforma pagó (key de env). Admin lo ve en reportes.
--   false → el cliente pagó con su key. Solo el cliente lo ve.
-- ============================================================================
ALTER TABLE public.contenido_generado
  ADD COLUMN IF NOT EXISTS costo_a_plataforma_anthropic boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS costo_a_plataforma_openai    boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.contenido_generado.costo_a_plataforma_anthropic IS 'true=key plataforma pagó, false=cliente pagó con su key. Para reportes de costo.';
COMMENT ON COLUMN public.contenido_generado.costo_a_plataforma_openai IS 'true=key plataforma pagó, false=cliente pagó con su key. Para reportes de costo.';
