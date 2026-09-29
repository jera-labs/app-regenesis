-- ============================================================================
-- Migración 47: Tablas nuevas del CRM Core
--
-- Crea:
-- - cohortes: catálogo de cohortes para segmentar (Mayo-2026, Black-Friday).
-- - cliente_enlaces: bolsa flexible de URLs operativas por cliente (VSL,
--   grabación cierre, contrato, Drive, etc.). Tipo libre, no enum, así Frank
--   agrega los que quiera.
-- - cliente_arquetipo: diagnóstico cualitativo del perfil estratégico del
--   cliente (Explorador / Constructor / Escalador / Consolidador).
-- - config_automatizaciones: singleton de parámetros del sistema (días
--   programa default, umbrales caso éxito, sesiones desvincular, razones
--   churn permitidas, % comisiones, montos por sesión, etc.). TODO es
--   configurable desde el admin sin tocar código.
--
-- INDEPENDENCIA: 100% aditivo. RLS independiente. Si esta migración falla, lo
-- existente (Re-Génesis, plataforma) sigue funcionando.
-- ============================================================================

BEGIN;

-- ============================================================================
-- COHORTES (catálogo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cohortes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  fecha_inicio date,
  fecha_fin_estimada date,
  duracion_dias integer DEFAULT 70,
  cupo_maximo integer,
  activa boolean DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cohortes_slug_format CHECK (slug ~ '^[a-z0-9_-]+$')
);

CREATE INDEX IF NOT EXISTS cohortes_activa_idx ON cohortes(activa) WHERE activa = true;

ALTER TABLE leads
  ADD CONSTRAINT leads_cohorte_id_fk FOREIGN KEY (cohorte_id) REFERENCES cohortes(id) ON DELETE SET NULL;

COMMENT ON TABLE cohortes IS 'Cohortes de clientes. Cada lead se asigna opcionalmente a una. Sirve para segmentar dashboards y reportes.';

-- ============================================================================
-- CLIENTE_ENLACES (URLs operativas flexibles)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_enlaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  etiqueta text,
  url text NOT NULL,
  orden integer DEFAULT 0,
  notas text,
  creado_por uuid REFERENCES usuarios_admin(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cliente_enlaces_url_format CHECK (url ~* '^https?://')
);

CREATE INDEX IF NOT EXISTS cliente_enlaces_lead_id_idx ON cliente_enlaces(lead_id);
CREATE INDEX IF NOT EXISTS cliente_enlaces_tipo_idx ON cliente_enlaces(tipo);

COMMENT ON TABLE cliente_enlaces IS 'Bolsa flexible de URLs por cliente. Tipos sugeridos: vsl, grabacion_venta, contrato, drive, calendar, skool, loom, otro. No es enum para que Frank pueda agregar tipos sin migración.';

-- ============================================================================
-- CLIENTE_ARQUETIPO (diagnóstico estratégico)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_arquetipo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid UNIQUE NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  arquetipo text NOT NULL,
  sub_arquetipo text,
  razon text,
  determinado_por uuid REFERENCES usuarios_admin(id),
  determinado_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cliente_arquetipo_valor CHECK (
    arquetipo IN ('explorador','constructor','escalador','consolidador','no_clasificado')
  )
);

CREATE INDEX IF NOT EXISTS cliente_arquetipo_arquetipo_idx ON cliente_arquetipo(arquetipo);

COMMENT ON TABLE cliente_arquetipo IS 'Diagnóstico cualitativo del perfil estratégico del cliente. Lo determina el admin/mentor en sesión inicial.';

-- ============================================================================
-- CONFIG_AUTOMATIZACIONES (singleton de parámetros del sistema)
-- ============================================================================
CREATE TABLE IF NOT EXISTS config_automatizaciones (
  id integer PRIMARY KEY DEFAULT 1,
  -- Programa
  dias_programa_default integer DEFAULT 70,
  semanas_programa_default integer DEFAULT 10,
  -- Caso de éxito
  umbral_caso_exito_usd numeric(12,2) DEFAULT 20000,
  -- Sesiones
  sesiones_para_desvincular integer DEFAULT 16,
  -- Cuotas
  dias_gracia_cuota_impaga integer DEFAULT 7,
  -- NPS
  nps_intervalo_dias integer DEFAULT 30,
  nps_umbral_promotor integer DEFAULT 9,
  nps_umbral_riesgo integer DEFAULT 7,
  -- Semáforos
  semaforo_dias_sin_login_amarillo integer DEFAULT 5,
  semaforo_dias_sin_login_rojo integer DEFAULT 10,
  -- Comisiones (DEFAULTS de muestra, Frank los cambia o desactiva)
  comision_por_sesion_usd numeric(10,2) DEFAULT 22.00,
  comision_caso_exito_pct numeric(5,2) DEFAULT 5.00,
  comision_referido_pct numeric(5,2) DEFAULT 10.00,
  comision_upsell_pct numeric(5,2) DEFAULT 10.00,
  comisiones_activas boolean DEFAULT false,
  -- Razones churn permitidas (enum suave)
  razones_churn jsonb DEFAULT '["financiero","salud","socio","insatisfaccion","cambio_prioridades","otro"]'::jsonb,
  -- QC
  qc_sla_horas integer DEFAULT 48,
  qc_auto_aprobar_horas integer,
  -- Tracker
  tracker_semanas_alerta_engagement integer DEFAULT 2,
  -- Misc
  moneda_funcional text DEFAULT 'USD',
  metadata jsonb DEFAULT '{}'::jsonb,
  -- Auditoría
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES usuarios_admin(id),
  CONSTRAINT config_singleton CHECK (id = 1)
);

-- Insert del singleton inicial (idempotente)
INSERT INTO config_automatizaciones (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE config_automatizaciones IS 'Singleton (id=1) con parámetros globales del sistema. Todo configurable desde admin sin tocar código. comisiones_activas=false por default: Frank decide cuándo activar el módulo de pagos al equipo.';

-- ============================================================================
-- RLS · independiente, no interfiere con lo existente
-- ============================================================================

ALTER TABLE cohortes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_enlaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_arquetipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_automatizaciones ENABLE ROW LEVEL SECURITY;

-- COHORTES: lectura abierta a authenticated, escritura solo admin
DROP POLICY IF EXISTS cohortes_select ON cohortes;
CREATE POLICY cohortes_select ON cohortes FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cohortes_admin_all ON cohortes;
CREATE POLICY cohortes_admin_all ON cohortes FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

-- CLIENTE_ENLACES: cliente lee solo los suyos, admin/moderador ven sus asignados, admin pleno ve todo
DROP POLICY IF EXISTS cliente_enlaces_cliente_select ON cliente_enlaces;
CREATE POLICY cliente_enlaces_cliente_select ON cliente_enlaces FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cliente_enlaces_equipo_all ON cliente_enlaces;
CREATE POLICY cliente_enlaces_equipo_all ON cliente_enlaces FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- CLIENTE_ARQUETIPO: mismas reglas
DROP POLICY IF EXISTS cliente_arquetipo_cliente_select ON cliente_arquetipo;
CREATE POLICY cliente_arquetipo_cliente_select ON cliente_arquetipo FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cliente_arquetipo_equipo_all ON cliente_arquetipo;
CREATE POLICY cliente_arquetipo_equipo_all ON cliente_arquetipo FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- CONFIG_AUTOMATIZACIONES: lectura para todo authenticated (el cliente puede ver, por ej, duración programa), escritura SOLO admin pleno
DROP POLICY IF EXISTS config_automatizaciones_select ON config_automatizaciones;
CREATE POLICY config_automatizaciones_select ON config_automatizaciones FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS config_automatizaciones_admin_update ON config_automatizaciones;
CREATE POLICY config_automatizaciones_admin_update ON config_automatizaciones FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

-- ============================================================================
-- TRIGGERS de auditoría (updated_at)
-- ============================================================================

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cohortes_touch ON cohortes;
CREATE TRIGGER cohortes_touch BEFORE UPDATE ON cohortes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS cliente_enlaces_touch ON cliente_enlaces;
CREATE TRIGGER cliente_enlaces_touch BEFORE UPDATE ON cliente_enlaces
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS cliente_arquetipo_touch ON cliente_arquetipo;
CREATE TRIGGER cliente_arquetipo_touch BEFORE UPDATE ON cliente_arquetipo
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS config_automatizaciones_touch ON config_automatizaciones;
CREATE TRIGGER config_automatizaciones_touch BEFORE UPDATE ON config_automatizaciones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- SEED · una cohorte inicial para clientes actuales
-- ============================================================================
INSERT INTO cohortes (slug, nombre, descripcion, fecha_inicio, activa)
VALUES ('legacy-2026', 'Legacy 2026', 'Clientes activos antes de la introducción de cohortes formales', '2026-01-01', true)
ON CONFLICT (slug) DO NOTHING;

-- Asignar la cohorte legacy a leads activos sin cohorte
UPDATE leads
SET cohorte_id = (SELECT id FROM cohortes WHERE slug = 'legacy-2026')
WHERE cohorte_id IS NULL
  AND estado IN ('activo','pagado_calentamiento');

COMMIT;
