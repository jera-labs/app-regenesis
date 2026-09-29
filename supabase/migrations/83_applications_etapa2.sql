-- ============================================================================
-- Migración 83: Etapa 2 — aplicación detallada (F5)
--
-- Aplicada en vivo vía Management API el 2026-06-30.
--
-- El cliente que YA COMPRÓ llena su aplicación (los ~142 custom fields de GHL)
-- en un portal de acceso restringido por token. Los campos se generan en vivo
-- desde los custom fields de la location GHL del agente; los VALORES (incl. PII:
-- SSN/salud) se escriben a GHL y NO se persisten en Supabase. Aquí solo estado.
-- ============================================================================

-- Enlace seguro por-contacto para abrir el portal de Etapa 2.
CREATE TABLE IF NOT EXISTS application_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  ghl_contact_id text NOT NULL,
  nombre_contacto text,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expira_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  usado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS application_links_agente_idx ON application_links(agente_id, created_at DESC);

-- Estado de cada aplicación (metadatos NO sensibles; los valores viven en GHL).
CREATE TABLE IF NOT EXISTS applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
  ghl_contact_id text NOT NULL,
  link_id uuid REFERENCES application_links(id) ON DELETE SET NULL,
  vertical text NOT NULL DEFAULT 'seguros',
  estado text NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','enviada','sincronizada','error_ghl')),
  campos_completados int NOT NULL DEFAULT 0,
  campos_total int NOT NULL DEFAULT 0,
  error_detalle text,
  completado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agente_id, ghl_contact_id)
);
CREATE INDEX IF NOT EXISTS applications_agente_idx ON applications(agente_id, created_at DESC);

CREATE OR REPLACE FUNCTION applications_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS applications_touch_trg ON applications;
CREATE TRIGGER applications_touch_trg BEFORE UPDATE ON applications
FOR EACH ROW EXECUTE FUNCTION applications_touch_updated_at();

-- RLS
-- application_links: el agente lee los suyos; superadmin; service_role todo.
-- El portal público valida el token server-side con service_role.
ALTER TABLE application_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS applinks_agente_select ON application_links;
CREATE POLICY applinks_agente_select ON application_links
  FOR SELECT TO authenticated
  USING (agente_id = mi_agente_id()
         OR auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));
DROP POLICY IF EXISTS applinks_service_all ON application_links;
CREATE POLICY applinks_service_all ON application_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- applications: el agente ve las suyas; superadmin todo; service_role todo.
ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS apps_agente_select ON applications;
CREATE POLICY apps_agente_select ON applications
  FOR SELECT TO authenticated
  USING (agente_id = mi_agente_id()
         OR auth.jwt() ->> 'email' IN (SELECT email FROM usuarios_admin));
DROP POLICY IF EXISTS apps_service_all ON applications;
CREATE POLICY apps_service_all ON applications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE application_links IS 'Enlaces seguros por-contacto para el portal de Etapa 2 (token expira/uso único).';
COMMENT ON TABLE applications IS 'Estado de la aplicación detallada (Etapa 2). Los valores (incl. PII) viven en GHL, no aquí.';

NOTIFY pgrst, 'reload schema';
