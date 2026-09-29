-- ============================================================================
-- Migración 53: Tracker del Cliente (Fase 5)
--
-- 7 tablas para el tracker donde el cliente trabaja todos los días:
--
-- 1) tracker_kpi_definiciones: catálogo configurable de KPIs por fase del programa.
--    Tipos: predictivo (acciones que controla) e histórico (resultados acumulados).
-- 2) tracker_kpi_asignaciones: override de target por cliente (mentor personaliza).
-- 3) tracker_kpi_diario: serie temporal por (lead, fecha, kpi). UNIQUE.
-- 4) tracker_roadmap_plantilla: catálogo de checkpoints del programa Neurohackers.
-- 5) cliente_roadmap_checkpoints: avance del cliente, con evidencia y celebración.
-- 6) tracker_modulos_programa: catálogo de módulos formativos (Skool/Drive/etc).
-- 7) cliente_modulos_progreso: visto / implementado / validado por cliente y módulo.
-- 8) cliente_tareas: cola unificada (polimórfica con `origen`).
-- 9) cliente_facturacion_mensual: serie temporal del ingreso mensual del NEGOCIO
--    del cliente (no lo que paga a Neurohackers). Para "% promesa cumplida".
--
-- SEED MÍNIMO: 5 KPIs default, 6 checkpoints default. Frank los amplía
-- desde admin/tracker-config.html.
--
-- INDEPENDENCIA: 100% aditivo.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. tracker_kpi_definiciones (catálogo)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tracker_kpi_definiciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  tipo text NOT NULL DEFAULT 'predictivo',
  unidad text DEFAULT 'cantidad',
  fase_aplica text[],
  target_default numeric(12,2),
  target_unidad text,
  color text DEFAULT '#D4AF37',
  icono text DEFAULT '◆',
  orden integer DEFAULT 0,
  activo boolean DEFAULT true,
  visible_cliente boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tkd_slug_format CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT tkd_tipo_valido CHECK (tipo IN ('predictivo','historico'))
);

CREATE INDEX IF NOT EXISTS tkd_activo_idx ON tracker_kpi_definiciones(activo, orden) WHERE activo = true;
COMMENT ON TABLE tracker_kpi_definiciones IS 'Catálogo configurable de KPIs. Frank crea/edita desde admin. Cada cliente puede tener override de target en tracker_kpi_asignaciones.';

-- ============================================================================
-- 2. tracker_kpi_asignaciones (override por cliente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tracker_kpi_asignaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL REFERENCES tracker_kpi_definiciones(id) ON DELETE CASCADE,
  target_personalizado numeric(12,2),
  activo boolean DEFAULT true,
  asignado_por uuid REFERENCES usuarios_admin(id),
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, kpi_id)
);

CREATE INDEX IF NOT EXISTS tka_lead_id_idx ON tracker_kpi_asignaciones(lead_id) WHERE activo = true;
COMMENT ON TABLE tracker_kpi_asignaciones IS 'Override de target por cliente. Si no existe fila, se usa target_default del catálogo.';

-- ============================================================================
-- 3. tracker_kpi_diario (registros)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tracker_kpi_diario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL REFERENCES tracker_kpi_definiciones(id) ON DELETE CASCADE,
  fecha date NOT NULL,
  valor numeric(12,2) NOT NULL DEFAULT 0,
  notas text,
  registrado_por uuid REFERENCES usuarios_admin(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, kpi_id, fecha)
);

CREATE INDEX IF NOT EXISTS tkd_lead_fecha_idx ON tracker_kpi_diario(lead_id, fecha DESC);
CREATE INDEX IF NOT EXISTS tkd_kpi_fecha_idx ON tracker_kpi_diario(kpi_id, fecha DESC);
COMMENT ON TABLE tracker_kpi_diario IS 'Registros diarios. UNIQUE (lead, kpi, fecha) garantiza un solo registro por día. Upsert para edición.';

-- ============================================================================
-- 4. tracker_roadmap_plantilla (catálogo de checkpoints)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tracker_roadmap_plantilla (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  fase text,
  orden integer DEFAULT 0,
  criterio_legible text,
  bloqueante boolean DEFAULT false,
  activo boolean DEFAULT true,
  visible_cliente boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT trp_slug_format CHECK (slug ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS trp_activo_idx ON tracker_roadmap_plantilla(activo, orden) WHERE activo = true;
COMMENT ON TABLE tracker_roadmap_plantilla IS 'Checkpoints del programa. Frank los configura. Bloqueante=true significa que los siguientes no aparecen hasta cumplir este.';

-- ============================================================================
-- 5. cliente_roadmap_checkpoints (avance del cliente)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_roadmap_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  checkpoint_id uuid NOT NULL REFERENCES tracker_roadmap_plantilla(id) ON DELETE CASCADE,
  alcanzado_at timestamptz,
  alcanzado_por uuid REFERENCES usuarios_admin(id),
  evidencia_url text,
  evidencia_notas text,
  celebrado_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS crc_lead_id_idx ON cliente_roadmap_checkpoints(lead_id);
COMMENT ON TABLE cliente_roadmap_checkpoints IS 'Avance del cliente sobre el roadmap. alcanzado_at NULL = pendiente. evidencia_url = link al post / screenshot / loom.';

-- ============================================================================
-- 6. tracker_modulos_programa (catálogo de módulos formativos)
-- ============================================================================
CREATE TABLE IF NOT EXISTS tracker_modulos_programa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  recurso_url text,
  recurso_tipo text,
  duracion_minutos integer,
  fase_aplica text,
  orden integer DEFAULT 0,
  activo boolean DEFAULT true,
  visible_cliente boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT tmp_slug_format CHECK (slug ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS tmp_activo_idx ON tracker_modulos_programa(activo, orden) WHERE activo = true;
COMMENT ON TABLE tracker_modulos_programa IS 'Catálogo de módulos formativos del programa. Diferente de los temas de Re-Génesis (temas).';

-- ============================================================================
-- 7. cliente_modulos_progreso
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_modulos_progreso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  modulo_id uuid NOT NULL REFERENCES tracker_modulos_programa(id) ON DELETE CASCADE,
  visto_at timestamptz,
  implementado_at timestamptz,
  validado_at timestamptz,
  validado_por uuid REFERENCES usuarios_admin(id),
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, modulo_id)
);

CREATE INDEX IF NOT EXISTS cmp_lead_id_idx ON cliente_modulos_progreso(lead_id);
COMMENT ON TABLE cliente_modulos_progreso IS 'Visto vs implementado vs validado por cliente. Validado_at lo setea un mentor en sesión.';

-- ============================================================================
-- 8. cliente_tareas (cola polimórfica unificada)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  origen text NOT NULL DEFAULT 'mentor_manual',
  origen_ref_id uuid,
  titulo text NOT NULL,
  detalle text,
  prioridad text DEFAULT 'media',
  esfuerzo_min integer,
  asignada_por uuid REFERENCES usuarios_admin(id),
  fecha_limite date,
  semana_del_programa integer,
  estado text NOT NULL DEFAULT 'pendiente',
  completada_at timestamptz,
  completada_por uuid REFERENCES usuarios_admin(id),
  notas_completada text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT ct_estado_valido CHECK (estado IN ('pendiente','en_progreso','completada','descartada')),
  CONSTRAINT ct_prioridad_valida CHECK (prioridad IN ('alta','media','baja')),
  CONSTRAINT ct_origen_valido CHECK (origen IN ('mentor_manual','sesion_1a1','auditoria_producto','checkpoint','sistema'))
);

CREATE INDEX IF NOT EXISTS ct_lead_estado_idx ON cliente_tareas(lead_id, estado);
CREATE INDEX IF NOT EXISTS ct_fecha_limite_idx ON cliente_tareas(fecha_limite) WHERE estado IN ('pendiente','en_progreso');
COMMENT ON TABLE cliente_tareas IS 'Cola unificada de tareas. Origen polimórfico: sesion_1a1 (mentor), auditoria_producto (sistema), checkpoint (sistema), mentor_manual.';

-- ============================================================================
-- 9. cliente_facturacion_mensual (serie temporal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_facturacion_mensual (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  mes date NOT NULL,
  ingreso_usd numeric(12,2) NOT NULL DEFAULT 0,
  clientes_nuevos integer DEFAULT 0,
  upsells integer DEFAULT 0,
  es_snapshot_inicial boolean DEFAULT false,
  notas text,
  registrado_por uuid REFERENCES usuarios_admin(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (lead_id, mes)
);

CREATE INDEX IF NOT EXISTS cfm_lead_mes_idx ON cliente_facturacion_mensual(lead_id, mes DESC);
COMMENT ON TABLE cliente_facturacion_mensual IS 'Ingreso mensual del NEGOCIO del cliente (no de Neurohackers). Serie para "% promesa cumplida". es_snapshot_inicial=true es el mes 0 (Punto A) y es inmutable.';

-- ============================================================================
-- RLS · cliente lee/escribe los suyos cuando aplica
-- ============================================================================
ALTER TABLE tracker_kpi_definiciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_kpi_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_kpi_diario ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_roadmap_plantilla ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_roadmap_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracker_modulos_programa ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_modulos_progreso ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_tareas ENABLE ROW LEVEL SECURITY;
ALTER TABLE cliente_facturacion_mensual ENABLE ROW LEVEL SECURITY;

-- Catálogos: lectura abierta a authenticated, escritura admin pleno
DROP POLICY IF EXISTS tkd_cat_select ON tracker_kpi_definiciones;
CREATE POLICY tkd_cat_select ON tracker_kpi_definiciones FOR SELECT TO authenticated USING (activo = true OR mi_rol_admin() = 'admin');
DROP POLICY IF EXISTS tkd_cat_admin ON tracker_kpi_definiciones;
CREATE POLICY tkd_cat_admin ON tracker_kpi_definiciones FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS trp_cat_select ON tracker_roadmap_plantilla;
CREATE POLICY trp_cat_select ON tracker_roadmap_plantilla FOR SELECT TO authenticated USING (activo = true OR mi_rol_admin() = 'admin');
DROP POLICY IF EXISTS trp_cat_admin ON tracker_roadmap_plantilla;
CREATE POLICY trp_cat_admin ON tracker_roadmap_plantilla FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS tmp_cat_select ON tracker_modulos_programa;
CREATE POLICY tmp_cat_select ON tracker_modulos_programa FOR SELECT TO authenticated USING (activo = true OR mi_rol_admin() = 'admin');
DROP POLICY IF EXISTS tmp_cat_admin ON tracker_modulos_programa;
CREATE POLICY tmp_cat_admin ON tracker_modulos_programa FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- Asignaciones, KPIs diarios, checkpoints, módulos, tareas, facturación:
-- cliente lee/escribe los suyos. Equipo asignado lee/escribe los suyos. Admin todo.

-- helper macro: lo aplico tabla por tabla
-- tracker_kpi_asignaciones
DROP POLICY IF EXISTS tka_cliente ON tracker_kpi_asignaciones;
CREATE POLICY tka_cliente ON tracker_kpi_asignaciones FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS tka_equipo ON tracker_kpi_asignaciones;
CREATE POLICY tka_equipo ON tracker_kpi_asignaciones FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- tracker_kpi_diario (cliente puede escribir los suyos)
DROP POLICY IF EXISTS tkd_cliente_select ON tracker_kpi_diario;
CREATE POLICY tkd_cliente_select ON tracker_kpi_diario FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS tkd_cliente_insert ON tracker_kpi_diario;
CREATE POLICY tkd_cliente_insert ON tracker_kpi_diario FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS tkd_cliente_update ON tracker_kpi_diario;
CREATE POLICY tkd_cliente_update ON tracker_kpi_diario FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS tkd_equipo ON tracker_kpi_diario;
CREATE POLICY tkd_equipo ON tracker_kpi_diario FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- cliente_roadmap_checkpoints (cliente solo lee)
DROP POLICY IF EXISTS crc_cliente ON cliente_roadmap_checkpoints;
CREATE POLICY crc_cliente ON cliente_roadmap_checkpoints FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS crc_equipo ON cliente_roadmap_checkpoints;
CREATE POLICY crc_equipo ON cliente_roadmap_checkpoints FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- cliente_modulos_progreso (cliente puede marcar visto/implementado)
DROP POLICY IF EXISTS cmp_cliente_select ON cliente_modulos_progreso;
CREATE POLICY cmp_cliente_select ON cliente_modulos_progreso FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS cmp_cliente_upsert ON cliente_modulos_progreso;
CREATE POLICY cmp_cliente_upsert ON cliente_modulos_progreso FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS cmp_cliente_update ON cliente_modulos_progreso;
CREATE POLICY cmp_cliente_update ON cliente_modulos_progreso FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS cmp_equipo ON cliente_modulos_progreso;
CREATE POLICY cmp_equipo ON cliente_modulos_progreso FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- cliente_tareas (cliente puede marcar completada, no crear)
DROP POLICY IF EXISTS ct_cliente_select ON cliente_tareas;
CREATE POLICY ct_cliente_select ON cliente_tareas FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS ct_cliente_update ON cliente_tareas;
CREATE POLICY ct_cliente_update ON cliente_tareas FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS ct_equipo ON cliente_tareas;
CREATE POLICY ct_equipo ON cliente_tareas FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- cliente_facturacion_mensual (cliente puede registrar y ver)
DROP POLICY IF EXISTS cfm_cliente_select ON cliente_facturacion_mensual;
CREATE POLICY cfm_cliente_select ON cliente_facturacion_mensual FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS cfm_cliente_insert ON cliente_facturacion_mensual;
CREATE POLICY cfm_cliente_insert ON cliente_facturacion_mensual FOR INSERT TO authenticated
  WITH CHECK (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));
DROP POLICY IF EXISTS cfm_cliente_update ON cliente_facturacion_mensual;
CREATE POLICY cfm_cliente_update ON cliente_facturacion_mensual FOR UPDATE TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email')
         AND NOT es_snapshot_inicial);
DROP POLICY IF EXISTS cfm_equipo ON cliente_facturacion_mensual;
CREATE POLICY cfm_equipo ON cliente_facturacion_mensual FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin' OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados())))
  WITH CHECK (mi_rol_admin() = 'admin' OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados())));

-- ============================================================================
-- Triggers touch updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS tkd_touch ON tracker_kpi_definiciones;
CREATE TRIGGER tkd_touch BEFORE UPDATE ON tracker_kpi_definiciones FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS tka_touch ON tracker_kpi_asignaciones;
CREATE TRIGGER tka_touch BEFORE UPDATE ON tracker_kpi_asignaciones FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS tkd2_touch ON tracker_kpi_diario;
CREATE TRIGGER tkd2_touch BEFORE UPDATE ON tracker_kpi_diario FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS trp_touch ON tracker_roadmap_plantilla;
CREATE TRIGGER trp_touch BEFORE UPDATE ON tracker_roadmap_plantilla FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS crc_touch ON cliente_roadmap_checkpoints;
CREATE TRIGGER crc_touch BEFORE UPDATE ON cliente_roadmap_checkpoints FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS tmp_touch ON tracker_modulos_programa;
CREATE TRIGGER tmp_touch BEFORE UPDATE ON tracker_modulos_programa FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS cmp_touch ON cliente_modulos_progreso;
CREATE TRIGGER cmp_touch BEFORE UPDATE ON cliente_modulos_progreso FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS ct_touch ON cliente_tareas;
CREATE TRIGGER ct_touch BEFORE UPDATE ON cliente_tareas FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS cfm_touch ON cliente_facturacion_mensual;
CREATE TRIGGER cfm_touch BEFORE UPDATE ON cliente_facturacion_mensual FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- Trigger: si una tarea pasa a 'completada' y no tiene completada_at, setearlo
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_tarea_completada() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.estado = 'completada' AND OLD.estado != 'completada' THEN
    NEW.completada_at = COALESCE(NEW.completada_at, now());
  ELSIF NEW.estado != 'completada' AND OLD.estado = 'completada' THEN
    NEW.completada_at = NULL;
    NEW.completada_por = NULL;
    NEW.notas_completada = NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ct_sync_completada ON cliente_tareas;
CREATE TRIGGER ct_sync_completada BEFORE UPDATE ON cliente_tareas
  FOR EACH ROW EXECUTE FUNCTION sync_tarea_completada();

-- ============================================================================
-- SEED: KPIs default (5), Checkpoints default (6), 0 módulos
-- ============================================================================
INSERT INTO tracker_kpi_definiciones (slug, nombre, descripcion, tipo, unidad, fase_aplica, target_default, target_unidad, icono, orden) VALUES
('mensajes_outbound', 'Mensajes outbound', 'Mensajes DM/email/WhatsApp iniciados a prospectos', 'predictivo', 'cantidad', ARRAY['lanzamiento','traccion','escala'], 30, '/día', '✉', 10),
('conversaciones_iniciadas', 'Conversaciones iniciadas', 'Prospectos que respondieron y arrancaron diálogo', 'predictivo', 'cantidad', ARRAY['lanzamiento','traccion','escala'], 5, '/día', '◐', 20),
('llamadas_agendadas', 'Llamadas agendadas', 'Citas concretas en agenda', 'predictivo', 'cantidad', ARRAY['traccion','escala'], 3, '/semana', '☏', 30),
('ventas_cerradas', 'Ventas cerradas', 'Ventas firmadas/pagadas en el período', 'historico', 'cantidad', ARRAY['traccion','escala','consolidacion'], 1, '/semana', '$', 40),
('monto_vendido_usd', 'Monto vendido', 'Dinero total cerrado en el período (USD)', 'historico', 'usd', ARRAY['traccion','escala','consolidacion'], 5000, 'USD/mes', '◈', 50)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tracker_roadmap_plantilla (slug, nombre, descripcion, fase, orden, criterio_legible, bloqueante) VALUES
('firma_contrato', 'Firma de contrato', 'Cliente firmó los 3 contratos (servicio, waiver, media)', 'onboarding', 10, 'Los 3 contratos firmados en GHL', true),
('arquetipo_definido', 'Arquetipo estratégico definido', 'Mentor clasificó al cliente en uno de los 4 arquetipos', 'onboarding', 20, 'cliente_arquetipo NOT NULL y arquetipo != no_clasificado', false),
('oferta_validada', 'Oferta validada', 'Producto/servicio principal con promesa clara y al menos 1 venta de prueba', 'lanzamiento', 30, 'launched_at NOT NULL y producto con salud_score >= 70', true),
('primera_venta', 'Primera venta', 'Primera venta al precio nuevo de la oferta validada', 'lanzamiento', 40, 'primera_venta_at NOT NULL', true),
('5k_mes', '$5K facturado en un mes', 'Mes con ingreso >= $5,000 USD', 'traccion', 50, 'cliente_facturacion_mensual.ingreso_usd >= 5000', false),
('10k_mes', '$10K facturado en un mes', 'Mes con ingreso >= $10,000 USD', 'escala', 60, 'cliente_facturacion_mensual.ingreso_usd >= 10000', false)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
