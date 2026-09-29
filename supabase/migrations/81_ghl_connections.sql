-- ============================================================================
-- Migración 81: ghl_connections (tokens OAuth de GHL por agente)
--
-- Aplicada en vivo vía Management API el 2026-06-29.
--
-- Parte de F2 del SaaS de agentes. Tabla AISLADA: SOLO service_role la lee/escribe
-- (el agente nunca ve su token). El panel solo lee un booleano en `agentes`.
-- Los tokens se refrescan con el refresh_token (resolverTokenGHL en la edge fn).
-- ============================================================================

CREATE TABLE IF NOT EXISTS ghl_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES agentes(id) ON DELETE CASCADE UNIQUE,
  ghl_location_id text NOT NULL,
  ghl_company_id text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text,
  token_type text NOT NULL DEFAULT 'Bearer',
  installed_by text,                       -- email del agente que conectó
  estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo','revocado','error_refresh')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Flag visible para el panel (sin exponer tokens): el agente lo lee vía su RLS self.
ALTER TABLE agentes ADD COLUMN IF NOT EXISTS ghl_oauth_conectado boolean NOT NULL DEFAULT false;

-- Trigger updated_at (mismo patrón que agentes).
CREATE OR REPLACE FUNCTION ghl_connections_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS ghl_connections_touch_trg ON ghl_connections;
CREATE TRIGGER ghl_connections_touch_trg
BEFORE UPDATE ON ghl_connections
FOR EACH ROW EXECUTE FUNCTION ghl_connections_touch_updated_at();

-- RLS: SOLO service_role. Ninguna policy para authenticated/anon => invisible.
ALTER TABLE ghl_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ghl_conn_service_all ON ghl_connections;
CREATE POLICY ghl_conn_service_all ON ghl_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE ghl_connections IS 'Tokens OAuth de GHL por agente. SOLO service_role. El panel lee agentes.ghl_oauth_conectado.';

NOTIFY pgrst, 'reload schema';
