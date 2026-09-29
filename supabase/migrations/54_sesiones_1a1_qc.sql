-- ============================================================================
-- Migración 54: Sesiones 1:1 + Control de Calidad (Fase 6)
--
-- REEMPLAZA EL TYPEFORM: cada sesión del mentor con el cliente queda registrada
-- estructuradamente. Cada sesión va a bandeja QC para revisión del supervisor.
--
-- TABLAS:
-- 1) sesiones_1a1: bitácora estructurada con rapport, éxitos, cuello botella,
--    foco, validación de tareas, semáforos manuales, NPS percibido, próxima.
--    Auto-incrementa numero_sesion por lead. Estado_qa: pendiente_revision /
--    aprobada / intervencion_requerida.
-- 2) qc_log: append-only de cada acción de revisión.
--
-- TRIGGERS:
-- - auto_numero_sesion: asigna numero_sesion correlativo por lead al insertar.
-- - sync_lead_sesion_stats: al cambiar estado_qa a 'aprobada', actualiza
--   leads.sesiones_realizadas, ultima_sesion_at, proxima_sesion_at. Si alcanza
--   sesiones_para_desvincular (config), aplica etiqueta automáticamente.
--
-- INDEPENDENCIA: 100% aditivo. No toca sesiones_calendario de Re-Génesis.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. sesiones_1a1
-- ============================================================================
CREATE TABLE IF NOT EXISTS sesiones_1a1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  mentor_id uuid REFERENCES usuarios_admin(id),
  numero_sesion integer,
  fecha timestamptz NOT NULL DEFAULT now(),
  modalidad text DEFAULT 'zoom',
  duracion_min integer,
  -- Núcleo de la sesión
  rapport_notas text,
  exitos_logros text,
  cuello_botella text,
  foco_accion text,
  -- Validación de tareas previas
  tareas_cumplidas integer DEFAULT 0,
  tareas_pendientes integer DEFAULT 0,
  validacion_tareas jsonb DEFAULT '[]'::jsonb,
  -- Semáforos manuales (lectura del mentor)
  semaforo_engagement_manual text,
  semaforo_progreso_manual text,
  notas_semaforos text,
  -- NPS percibido por el mentor (lectura, no es la encuesta oficial)
  nps_score_percibido integer,
  nps_comentario text,
  -- Próxima sesión
  proxima_sesion_at timestamptz,
  -- Control de Calidad
  estado_qa text NOT NULL DEFAULT 'pendiente_revision',
  supervisor_id uuid REFERENCES usuarios_admin(id),
  revisado_at timestamptz,
  qc_notas text,
  qc_intervencion_requerida boolean DEFAULT false,
  -- Visibilidad al cliente
  resumen_visible_cliente text,
  -- Auditoría
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT s1a1_modalidad_valida CHECK (modalidad IN ('zoom','presencial','llamada','grupal')),
  CONSTRAINT s1a1_estado_qa_valido CHECK (estado_qa IN ('pendiente_revision','aprobada','intervencion_requerida')),
  CONSTRAINT s1a1_nps_valido CHECK (nps_score_percibido IS NULL OR nps_score_percibido BETWEEN 0 AND 10),
  CONSTRAINT s1a1_semaforo_eng CHECK (semaforo_engagement_manual IS NULL OR semaforo_engagement_manual IN ('verde','amarillo','rojo')),
  CONSTRAINT s1a1_semaforo_prog CHECK (semaforo_progreso_manual IS NULL OR semaforo_progreso_manual IN ('verde','amarillo','rojo')),
  UNIQUE (lead_id, numero_sesion)
);

CREATE INDEX IF NOT EXISTS s1a1_lead_id_idx ON sesiones_1a1(lead_id, fecha DESC);
CREATE INDEX IF NOT EXISTS s1a1_mentor_idx ON sesiones_1a1(mentor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS s1a1_estado_qa_idx ON sesiones_1a1(estado_qa);
CREATE INDEX IF NOT EXISTS s1a1_pendientes_idx ON sesiones_1a1(created_at) WHERE estado_qa = 'pendiente_revision';

COMMENT ON TABLE sesiones_1a1 IS 'Bitácora estructurada por sesión 1:1 mentor-cliente. Reemplaza Typeform externo. Cada sesión pasa por QC.';

-- ============================================================================
-- 2. qc_log (append-only)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qc_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sesion_id uuid NOT NULL REFERENCES sesiones_1a1(id) ON DELETE CASCADE,
  accion text NOT NULL,
  actor_id uuid REFERENCES usuarios_admin(id),
  comentario text,
  estado_anterior text,
  estado_nuevo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qcl_accion_valida CHECK (accion IN ('creada','editada','revisada','aprobada','rechazada','comentario','reabierta'))
);

CREATE INDEX IF NOT EXISTS qcl_sesion_idx ON qc_log(sesion_id, created_at DESC);

COMMENT ON TABLE qc_log IS 'Append-only de eventos de control de calidad por sesión. Para auditoría completa.';

-- ============================================================================
-- TRIGGER: auto_numero_sesion al insertar
-- ============================================================================
CREATE OR REPLACE FUNCTION auto_numero_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.numero_sesion IS NULL THEN
    SELECT COALESCE(MAX(numero_sesion), 0) + 1 INTO NEW.numero_sesion
    FROM sesiones_1a1 WHERE lead_id = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS s1a1_auto_numero ON sesiones_1a1;
CREATE TRIGGER s1a1_auto_numero BEFORE INSERT ON sesiones_1a1
  FOR EACH ROW EXECUTE FUNCTION auto_numero_sesion();

-- ============================================================================
-- TRIGGER: sync_lead_sesion_stats cuando aprueba QC
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_lead_sesion_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sesiones_count integer;
  v_ultima timestamptz;
  v_tope integer;
  v_etiqueta_id uuid;
  v_ya_tiene boolean;
BEGIN
  -- Solo cuando pasa a 'aprobada' (no estaba aprobada antes)
  IF NEW.estado_qa = 'aprobada' AND (OLD.estado_qa IS NULL OR OLD.estado_qa != 'aprobada') THEN
    SELECT count(*), MAX(fecha) INTO v_sesiones_count, v_ultima
      FROM sesiones_1a1 WHERE lead_id = NEW.lead_id AND estado_qa = 'aprobada';

    UPDATE leads
      SET sesiones_realizadas = v_sesiones_count,
          ultima_sesion_at = v_ultima,
          proxima_sesion_at = COALESCE(NEW.proxima_sesion_at, proxima_sesion_at)
      WHERE id = NEW.lead_id;

    -- ¿Alcanza tope de desvincular?
    SELECT COALESCE(sesiones_para_desvincular, 16) INTO v_tope
      FROM config_automatizaciones WHERE id = 1;

    IF v_sesiones_count >= v_tope THEN
      SELECT id INTO v_etiqueta_id FROM etiquetas_catalogo WHERE slug = 'desvincular' AND activa = true;
      IF v_etiqueta_id IS NOT NULL THEN
        SELECT EXISTS(SELECT 1 FROM lead_etiquetas WHERE lead_id = NEW.lead_id AND etiqueta_id = v_etiqueta_id) INTO v_ya_tiene;
        IF NOT v_ya_tiene THEN
          INSERT INTO lead_etiquetas (lead_id, etiqueta_id, origen, notas)
          VALUES (NEW.lead_id, v_etiqueta_id, 'automatico',
                  'Aplicada automáticamente al alcanzar ' || v_sesiones_count || ' sesiones (tope ' || v_tope || ')');
        END IF;
      END IF;
    END IF;

  -- Si pasa de aprobada a otro estado (rechazo posterior), recalcular
  ELSIF OLD.estado_qa = 'aprobada' AND NEW.estado_qa != 'aprobada' THEN
    SELECT count(*), MAX(fecha) INTO v_sesiones_count, v_ultima
      FROM sesiones_1a1 WHERE lead_id = NEW.lead_id AND estado_qa = 'aprobada';
    UPDATE leads SET sesiones_realizadas = v_sesiones_count, ultima_sesion_at = v_ultima
      WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS s1a1_sync_stats ON sesiones_1a1;
CREATE TRIGGER s1a1_sync_stats AFTER UPDATE OF estado_qa ON sesiones_1a1
  FOR EACH ROW EXECUTE FUNCTION sync_lead_sesion_stats();

-- ============================================================================
-- TRIGGER: log automático a qc_log
-- ============================================================================
CREATE OR REPLACE FUNCTION log_qc_evento() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
  v_accion text;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO qc_log (sesion_id, accion, actor_id, estado_nuevo)
    VALUES (NEW.id, 'creada', v_usuario_id, NEW.estado_qa);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.estado_qa != NEW.estado_qa THEN
      v_accion := CASE NEW.estado_qa
        WHEN 'aprobada' THEN 'aprobada'
        WHEN 'intervencion_requerida' THEN 'rechazada'
        WHEN 'pendiente_revision' THEN 'reabierta'
        ELSE 'revisada'
      END;
      INSERT INTO qc_log (sesion_id, accion, actor_id, comentario, estado_anterior, estado_nuevo)
      VALUES (NEW.id, v_accion, v_usuario_id, NEW.qc_notas, OLD.estado_qa, NEW.estado_qa);
    ELSIF OLD.qc_notas IS DISTINCT FROM NEW.qc_notas AND NEW.qc_notas IS NOT NULL THEN
      INSERT INTO qc_log (sesion_id, accion, actor_id, comentario, estado_anterior, estado_nuevo)
      VALUES (NEW.id, 'comentario', v_usuario_id, NEW.qc_notas, OLD.estado_qa, NEW.estado_qa);
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS s1a1_log_qc ON sesiones_1a1;
CREATE TRIGGER s1a1_log_qc AFTER INSERT OR UPDATE ON sesiones_1a1
  FOR EACH ROW EXECUTE FUNCTION log_qc_evento();

-- ============================================================================
-- TRIGGER touch updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS s1a1_touch ON sesiones_1a1;
CREATE TRIGGER s1a1_touch BEFORE UPDATE ON sesiones_1a1
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE sesiones_1a1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE qc_log ENABLE ROW LEVEL SECURITY;

-- sesiones_1a1: mentor (moderador asignado) lee/edita las suyas. Admin ve todo.
-- Cliente puede leer SOLO las aprobadas con resumen_visible_cliente.
DROP POLICY IF EXISTS s1a1_cliente_select ON sesiones_1a1;
CREATE POLICY s1a1_cliente_select ON sesiones_1a1 FOR SELECT TO authenticated
  USING (
    estado_qa = 'aprobada'
    AND lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS s1a1_equipo_all ON sesiones_1a1;
CREATE POLICY s1a1_equipo_all ON sesiones_1a1 FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- qc_log: solo equipo lee. No inserts manuales (los hace el trigger).
DROP POLICY IF EXISTS qcl_equipo_select ON qc_log;
CREATE POLICY qcl_equipo_select ON qc_log FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND sesion_id IN (
      SELECT id FROM sesiones_1a1 WHERE lead_id IN (SELECT mis_leads_asignados())
    ))
  );

COMMIT;
