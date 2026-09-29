-- ============================================================================
-- Migración 41: Sistema de roles + asignación de clientes + versionado
--
-- 3 conceptos clave:
--   1. ROLES DE PERMISO (admin | moderador | lector): qué puede hacer técnicamente
--   2. ROLES FUNCIONALES (dinámico, admin los crea): qué función cumple con el cliente
--      (closer, mentor_gerencia, mentor_marketing, etc.)
--   3. ASIGNACIÓN: qué clientes ve cada miembro. Solo admins ven todo.
--      Moderadores y lectores solo ven sus asignados (modelo "Assigned User" de GHL).
--
-- + Versionado: cada UPDATE a tablas críticas queda en historial_cambios
--   para auditoría y posibilidad de rollback futuro.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Extender rol de usuarios_admin: admin | moderador | lector
-- ----------------------------------------------------------------------------
ALTER TABLE usuarios_admin DROP CONSTRAINT IF EXISTS usuarios_admin_rol_check;
ALTER TABLE usuarios_admin ADD CONSTRAINT usuarios_admin_rol_check
  CHECK (rol IN ('admin','moderador','lector'));

-- ----------------------------------------------------------------------------
-- 2. roles_funcionales (dinámico, admin puede agregar más)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles_funcionales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  color text DEFAULT '#86868B',
  icono text,
  activo boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES usuarios_admin(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles_funcionales (slug, nombre, descripcion, color, icono) VALUES
  ('closer',           'Closer',              'Cierra ventas, sigue prospectos hasta la firma',                  '#D4AF37', '◈'),
  ('mentor_gerencia',  'Mentor de Gerencia',  'Guía al cliente en estructura, operaciones y delegación',         '#248A3D', '▦'),
  ('mentor_marketing', 'Mentor de Marketing', 'Guía al cliente en marca, posicionamiento y contenido',           '#0066CC', '≡'),
  ('mentor_ventas',    'Mentor de Ventas',    'Coachea cierre, objeciones y procesos de venta',                  '#B25000', '◌'),
  ('coach_general',    'Coach General',       'Acompañamiento integral durante el programa',                     '#8E6F12', '◇'),
  ('mentor_finanzas',  'Mentor de Finanzas',  'Apoya en pricing, P&L, proyecciones y rentabilidad',              '#5856D6', '$')
ON CONFLICT (slug) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. lead_asignaciones (muchos a muchos con rol funcional)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  usuario_admin_id uuid NOT NULL REFERENCES usuarios_admin(id) ON DELETE CASCADE,
  rol_funcional_id uuid NOT NULL REFERENCES roles_funcionales(id) ON DELETE RESTRICT,
  asignado_at timestamptz NOT NULL DEFAULT now(),
  asignado_por uuid REFERENCES usuarios_admin(id),
  notas text,
  UNIQUE (lead_id, usuario_admin_id, rol_funcional_id)
);

CREATE INDEX IF NOT EXISTS lead_asignaciones_lead_idx ON lead_asignaciones(lead_id);
CREATE INDEX IF NOT EXISTS lead_asignaciones_admin_idx ON lead_asignaciones(usuario_admin_id);

-- ----------------------------------------------------------------------------
-- 4. historial_cambios (versionado)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_cambios (
  id bigserial PRIMARY KEY,
  tabla text NOT NULL,
  registro_id uuid,
  lead_id uuid,
  accion text NOT NULL CHECK (accion IN ('UPDATE','INSERT','DELETE')),
  valor_anterior jsonb,
  valor_nuevo jsonb,
  modificado_por uuid REFERENCES usuarios_admin(id),
  modificado_por_email text,
  modificado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS historial_lead_at_idx ON historial_cambios(lead_id, modificado_at DESC);
CREATE INDEX IF NOT EXISTS historial_tabla_idx ON historial_cambios(tabla, modificado_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Helper functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mi_admin_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM usuarios_admin
  WHERE email = (auth.jwt() ->> 'email') AND activo = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION mi_rol_admin()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rol FROM usuarios_admin
  WHERE email = (auth.jwt() ->> 'email') AND activo = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION tengo_acceso_a_lead(p_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    mi_rol_admin() = 'admin'
    OR EXISTS (
      SELECT 1 FROM lead_asignaciones
      WHERE lead_id = p_lead_id AND usuario_admin_id = mi_admin_id()
    );
$$;

-- ----------------------------------------------------------------------------
-- 6. Trigger genérico de versionado
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trigger_historial_cambios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead_id uuid;
  v_admin_id uuid;
  v_email text;
  v_anterior jsonb;
  v_nuevo jsonb;
BEGIN
  v_email := auth.jwt() ->> 'email';
  v_admin_id := (SELECT id FROM usuarios_admin WHERE email = v_email);

  -- Sólo loggear cuando un admin/moderador hace el cambio. Los webhooks y el cron
  -- usan service_role y no tienen JWT con email, no llenan historial (eso es bueno).
  IF v_admin_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Determinar lead_id según la tabla
  IF TG_TABLE_NAME = 'leads' THEN
    v_lead_id := COALESCE(NEW.id, OLD.id);
  ELSE
    -- Todas las otras tablas tienen columna lead_id
    EXECUTE format('SELECT ($1).%I', 'lead_id') USING COALESCE(NEW, OLD) INTO v_lead_id;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_anterior := to_jsonb(OLD);
    v_nuevo := to_jsonb(NEW);
    -- Solo log si realmente hubo cambios (no es trigger noop)
    IF v_anterior = v_nuevo THEN RETURN NEW; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_anterior := NULL;
    v_nuevo := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_anterior := to_jsonb(OLD);
    v_nuevo := NULL;
  END IF;

  INSERT INTO historial_cambios (
    tabla, registro_id, lead_id, accion,
    valor_anterior, valor_nuevo,
    modificado_por, modificado_por_email
  ) VALUES (
    TG_TABLE_NAME,
    COALESCE((NEW).id, (OLD).id),
    v_lead_id,
    TG_OP,
    v_anterior,
    v_nuevo,
    v_admin_id, v_email
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Aplicar trigger en tablas críticas (NO en webhook_log ni cron_log para no recursar)
DROP TRIGGER IF EXISTS hist_leads ON leads;
CREATE TRIGGER hist_leads AFTER INSERT OR UPDATE OR DELETE ON leads
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

DROP TRIGGER IF EXISTS hist_cliente_esencia ON cliente_esencia;
CREATE TRIGGER hist_cliente_esencia AFTER INSERT OR UPDATE OR DELETE ON cliente_esencia
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

DROP TRIGGER IF EXISTS hist_cliente_negocio ON cliente_negocio;
CREATE TRIGGER hist_cliente_negocio AFTER INSERT OR UPDATE OR DELETE ON cliente_negocio
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

DROP TRIGGER IF EXISTS hist_cliente_diagnostico ON cliente_diagnostico;
CREATE TRIGGER hist_cliente_diagnostico AFTER INSERT OR UPDATE OR DELETE ON cliente_diagnostico
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

DROP TRIGGER IF EXISTS hist_productos ON productos;
CREATE TRIGGER hist_productos AFTER INSERT OR UPDATE OR DELETE ON productos
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

DROP TRIGGER IF EXISTS hist_lead_asignaciones ON lead_asignaciones;
CREATE TRIGGER hist_lead_asignaciones AFTER INSERT OR UPDATE OR DELETE ON lead_asignaciones
  FOR EACH ROW EXECUTE FUNCTION trigger_historial_cambios();

-- ----------------------------------------------------------------------------
-- 7. RLS en tablas nuevas
-- ----------------------------------------------------------------------------
ALTER TABLE roles_funcionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_cambios ENABLE ROW LEVEL SECURITY;

-- roles_funcionales: cualquier admin/moderador/lector lee. Solo admin escribe.
DROP POLICY IF EXISTS rf_read ON roles_funcionales;
CREATE POLICY rf_read ON roles_funcionales FOR SELECT TO authenticated
  USING (mi_rol_admin() IS NOT NULL);

DROP POLICY IF EXISTS rf_admin_write ON roles_funcionales;
CREATE POLICY rf_admin_write ON roles_funcionales FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS rf_service ON roles_funcionales;
CREATE POLICY rf_service ON roles_funcionales FOR ALL TO service_role USING (true) WITH CHECK (true);

-- lead_asignaciones: admin todo. Moderador/lector ven solo las que les conciernen.
DROP POLICY IF EXISTS la_admin_all ON lead_asignaciones;
CREATE POLICY la_admin_all ON lead_asignaciones FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS la_mod_lector_select ON lead_asignaciones;
CREATE POLICY la_mod_lector_select ON lead_asignaciones FOR SELECT TO authenticated
  USING (
    mi_rol_admin() IN ('moderador','lector')
    AND (usuario_admin_id = mi_admin_id() OR lead_id IN (
      SELECT lead_id FROM lead_asignaciones WHERE usuario_admin_id = mi_admin_id()
    ))
  );

DROP POLICY IF EXISTS la_service ON lead_asignaciones;
CREATE POLICY la_service ON lead_asignaciones FOR ALL TO service_role USING (true) WITH CHECK (true);

-- historial_cambios: solo admin y moderador (asignado al lead) leen
DROP POLICY IF EXISTS hist_admin_read ON historial_cambios;
CREATE POLICY hist_admin_read ON historial_cambios FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS hist_mod_read ON historial_cambios;
CREATE POLICY hist_mod_read ON historial_cambios FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'moderador'
    AND lead_id IS NOT NULL
    AND tengo_acceso_a_lead(lead_id)
  );

DROP POLICY IF EXISTS hist_service ON historial_cambios;
CREATE POLICY hist_service ON historial_cambios FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

COMMENT ON TABLE roles_funcionales IS 'Roles funcionales dinámicos (closer, mentor_X, etc). Admin puede agregar más. Separados de rol de permiso (admin/moderador/lector).';
COMMENT ON TABLE lead_asignaciones IS 'Modelo Assigned User: qué miembros del equipo están asignados a qué clientes con qué función. Admin ve todos los clientes, los demás solo sus asignados.';
COMMENT ON TABLE historial_cambios IS 'Auditoría/versionado: cada UPDATE/INSERT/DELETE en tablas críticas hecho por un admin se loguea aquí. Cron y webhooks no llenan (no tienen JWT con email).';
COMMENT ON FUNCTION tengo_acceso_a_lead IS 'true si el usuario actual es admin OR si tiene una asignación al lead. Se usa en RLS de leads y todas las tablas que cuelgan de leads.';
