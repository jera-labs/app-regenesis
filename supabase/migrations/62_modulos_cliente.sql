-- ============================================================================
-- Migración 62: Feature flags / módulos por cliente
--
-- Sistema declarativo para controlar qué módulos ve cada cliente en su sidebar.
-- - `modulos_catalogo`: catálogo de todos los módulos (slug, nombre, parent,
--   default_activo). Los módulos en pruebas tienen default_activo=false.
-- - `modulos_cliente`: override por lead. Si NO existe row para (lead, slug),
--   se usa default_activo del catálogo. Si existe, gana lo de la fila.
-- - `cliente_tiene_modulo(lead_id, slug)`: helper SQL para usar desde JS y SQL.
--
-- PRIMER USO: ocultar el módulo Contenido (Instagram/LinkedIn/Facebook) a todos
-- los clientes excepto los que admin active manualmente.
--
-- INDEPENDENCIA: 100% aditivo. Si falla, nada se rompe (los módulos siguen
-- visibles tal cual están hoy en nav.js).
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS modulos_catalogo (
  slug text PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text,
  default_activo boolean NOT NULL DEFAULT true,
  parent_slug text REFERENCES modulos_catalogo(slug) ON DELETE SET NULL,
  orden int NOT NULL DEFAULT 100,
  icono text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS modulos_cliente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  modulo_slug text NOT NULL REFERENCES modulos_catalogo(slug) ON DELETE CASCADE,
  activo boolean NOT NULL DEFAULT false,
  activado_at timestamptz,
  activado_por uuid REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id, modulo_slug)
);

CREATE INDEX IF NOT EXISTS modulos_cliente_lead_idx ON modulos_cliente (lead_id);
CREATE INDEX IF NOT EXISTS modulos_cliente_activo_idx ON modulos_cliente (lead_id, activo) WHERE activo = true;

-- ============================================================================
-- Seed inicial del catálogo
-- ============================================================================
INSERT INTO modulos_catalogo (slug, nombre, descripcion, default_activo, parent_slug, orden, icono) VALUES
  ('tracker',             'Tracker',          'KPIs predictivos + roadmap + tareas',                true,  NULL,         10, '◆'),
  ('perfil',              'Mi perfil',        'Datos personales y de programa',                     true,  NULL,         20, '◉'),
  ('dna',                 'Mi DNA',           'Identidad, esencia, voz, valores',                   true,  NULL,         30, '◇'),
  ('marca',               'Marca y oferta',   'Productos del cliente con auditoría IA',             true,  NULL,         40, '▦'),
  ('herramientas',        'Herramientas',     'Caja de herramientas operativas',                    true,  NULL,         60, '⚙'),
  ('contenido',           'Contenido',        'Generador y editor de contenido para redes',         false, NULL,         50, '≡'),
  ('contenido-instagram', 'Instagram',        'Generador de posts/carruseles/reels para Instagram', false, 'contenido',  51, '◉'),
  ('contenido-linkedin',  'LinkedIn',         'Generador de posts y artículos para LinkedIn',       false, 'contenido',  52, '▦'),
  ('contenido-facebook',  'Facebook',         'Generador de posts para Facebook',                   false, 'contenido',  53, '◇')
ON CONFLICT (slug) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  parent_slug = EXCLUDED.parent_slug,
  orden = EXCLUDED.orden,
  icono = EXCLUDED.icono,
  updated_at = now();
  -- NO sobrescribir default_activo: respeta cambios admin posteriores.

-- ============================================================================
-- Función helper: ¿este cliente tiene este módulo activo?
-- ============================================================================
CREATE OR REPLACE FUNCTION cliente_tiene_modulo(p_lead_id uuid, p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT activo FROM modulos_cliente
     WHERE lead_id = p_lead_id AND modulo_slug = p_slug),
    (SELECT default_activo FROM modulos_catalogo WHERE slug = p_slug),
    false
  );
$$;

COMMENT ON FUNCTION cliente_tiene_modulo IS
  'Helper: retorna true si el cliente tiene el módulo activo. Usa override (modulos_cliente) si existe, sino default_activo del catálogo, sino false.';

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE modulos_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE modulos_cliente  ENABLE ROW LEVEL SECURITY;

-- Catálogo: lectura abierta para authenticated (todos lo pueden leer)
DROP POLICY IF EXISTS modulos_catalogo_select_all ON modulos_catalogo;
CREATE POLICY modulos_catalogo_select_all ON modulos_catalogo
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS modulos_catalogo_admin_write ON modulos_catalogo;
CREATE POLICY modulos_catalogo_admin_write ON modulos_catalogo
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

DROP POLICY IF EXISTS modulos_catalogo_service ON modulos_catalogo;
CREATE POLICY modulos_catalogo_service ON modulos_catalogo
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Cliente: lee SOLO sus propios overrides
DROP POLICY IF EXISTS modulos_cliente_select_own ON modulos_cliente;
CREATE POLICY modulos_cliente_select_own ON modulos_cliente
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM leads WHERE id = lead_id AND email = auth.jwt() ->> 'email')
    OR EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true)
  );

-- Admin: lee/escribe todos
DROP POLICY IF EXISTS modulos_cliente_admin_all ON modulos_cliente;
CREATE POLICY modulos_cliente_admin_all ON modulos_cliente
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

DROP POLICY IF EXISTS modulos_cliente_service ON modulos_cliente;
CREATE POLICY modulos_cliente_service ON modulos_cliente
  FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON modulos_catalogo TO authenticated, service_role;
GRANT SELECT ON modulos_cliente  TO authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON modulos_cliente TO authenticated, service_role;

-- ============================================================================
-- Trigger updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION _mc_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS modulos_cliente_updated_at ON modulos_cliente;
CREATE TRIGGER modulos_cliente_updated_at
  BEFORE UPDATE ON modulos_cliente
  FOR EACH ROW EXECUTE FUNCTION _mc_set_updated_at();

NOTIFY pgrst, 'reload schema';

COMMIT;
