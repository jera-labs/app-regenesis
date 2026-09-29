-- ============================================================================
-- Migración 79: Intake de Seguros (SaaS para agentes de seguros)
--
-- Aplicada en vivo vía Management API el 2026-06-29.
--
-- SaaS de 3 niveles: superadmin (usuarios_admin) -> agente (tenant) -> asegurado
-- (anónimo, llena un formulario público). Los datos del form aterrizan en la
-- sub-cuenta GHL del agente (vía edge function `intake-submit` con service_role);
-- Supabase guarda el registro de agentes + un espejo de los envíos.
--
-- Independiente de Re-Génesis: tablas nuevas, no toca nada existente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tabla `agentes` (tenant): cada agente de seguros = nuestro cliente.
-- email = llave de RLS (mismo patrón que leads/cliente_esencia). Login Supabase Auth.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  email text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,                 -- identificador público en la URL del form (?a=<slug>)
  ghl_location_id text NOT NULL,             -- sub-cuenta GHL del agente (destino de los datos)
  ghl_pit text,                              -- PIT de la sub-cuenta del agente con scope de ESCRITURA de contactos
                                             -- (el PIT de agencia es solo lectura). Lo usa la edge fn intake-submit.
  branding jsonb NOT NULL DEFAULT '{}'::jsonb, -- logo/nombre/colores por agente (MVP: genérico)
  ghl_cf_map jsonb NOT NULL DEFAULT '{}'::jsonb, -- cache: nombre custom field -> id en esa location
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agentes_slug_formato_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$')
);

CREATE INDEX IF NOT EXISTS agentes_slug_idx ON agentes(slug) WHERE activo = true;

-- Trigger updated_at (patrón cliente_esencia: SECURITY DEFINER + search_path)
CREATE OR REPLACE FUNCTION agentes_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS agentes_touch_trg ON agentes;
CREATE TRIGGER agentes_touch_trg
BEFORE UPDATE ON agentes
FOR EACH ROW EXECUTE FUNCTION agentes_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Tabla `intake_submissions`: espejo de cada envío del formulario.
-- La inserción SOLO ocurre vía service_role (edge function). El agente la LEE.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intake_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  -- denormalizados para lista rápida en el panel
  nombre_contacto text,
  email_contacto text,
  telefono_contacto text,
  tipo_seguro text,
  -- payload completo del formulario
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- resultado de la sincronización a GHL
  ghl_contact_id text,
  estado text NOT NULL DEFAULT 'recibido'
    CHECK (estado IN ('recibido','sincronizado','error_ghl')),
  error_detalle text,
  ip_hash text,                              -- sha256(x-forwarded-for) para rate-limit anti-spam
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_submissions_agente_idx
  ON intake_submissions(agente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intake_submissions_iphash_idx
  ON intake_submissions(ip_hash, created_at DESC);

-- ============================================================================
-- RLS — patrón de las 4 policies de cliente_esencia, adaptado
-- ============================================================================
ALTER TABLE agentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;

-- ---- agentes: el agente ve/edita SU fila; superadmin todo; service_role todo ----
DROP POLICY IF EXISTS agentes_self_select ON agentes;
CREATE POLICY agentes_self_select ON agentes
  FOR SELECT TO authenticated
  USING (email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS agentes_self_update ON agentes;
CREATE POLICY agentes_self_update ON agentes
  FOR UPDATE TO authenticated
  USING (email = auth.jwt() ->> 'email')
  WITH CHECK (email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS agentes_admin_all ON agentes;
CREATE POLICY agentes_admin_all ON agentes
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS agentes_service_all ON agentes;
CREATE POLICY agentes_service_all ON agentes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---- intake_submissions: el agente ve SOLO las suyas; superadmin todo; service_role todo ----
-- (NO hay policy de INSERT para authenticated/anon: la inserción es solo service_role)
DROP POLICY IF EXISTS intake_agente_select ON intake_submissions;
CREATE POLICY intake_agente_select ON intake_submissions
  FOR SELECT TO authenticated
  USING (agente_id IN (SELECT id FROM agentes WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS intake_admin_all ON intake_submissions;
CREATE POLICY intake_admin_all ON intake_submissions
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin))
  WITH CHECK (auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));

DROP POLICY IF EXISTS intake_service_all ON intake_submissions;
CREATE POLICY intake_service_all ON intake_submissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- Vista pública: el form anónimo personaliza branding por slug SIN exponer
-- ghl_location_id. La vista (security definer por default) lee agentes saltando
-- RLS, pero solo proyecta columnas seguras.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS agentes_publicos;
CREATE VIEW agentes_publicos AS
  SELECT nombre, slug, branding FROM agentes WHERE activo = true;

GRANT SELECT ON agentes_publicos TO anon, authenticated;

COMMENT ON TABLE agentes IS 'Agentes de seguros (tenants del SaaS insurance.neurohackers.cloud). email=llave RLS, slug=URL pública del form, ghl_location_id=sub-cuenta destino.';
COMMENT ON TABLE intake_submissions IS 'Espejo de cada envío del formulario público. Inserta solo el service_role (edge fn intake-submit); el agente lee las suyas vía RLS.';

NOTIFY pgrst, 'reload schema';
