-- ============================================================================
-- Migración 55: Comisiones + Nómina mensual (Fase 7)
--
-- DISEÑO PRAGMÁTICO:
-- - Los MONTOS / % viven en config_automatizaciones (comision_por_sesion_usd,
--   comision_caso_exito_pct, comision_referido_pct, comision_upsell_pct,
--   comisiones_activas). Frank los edita desde /admin/configuracion.html.
-- - Los EVENTOS comisionables se guardan en comisiones_devengadas (una fila
--   por evento) con UNIQUE para evitar doble cobro.
-- - La nómina mensual se cierra agrupando devengadas pendientes en
--   liquidaciones_mensuales.
--
-- TRIGGERS:
-- - Al APROBAR una sesión 1:1: genera comisión 'sesion_1a1' al mentor.
-- - Al setear caso_exito_at en lead (por primera vez): genera comisión
--   'caso_exito' al mentor principal asignado, con monto = precio_pagado * pct.
--
-- FALTA por ahora (manual o fase futura):
-- - Referidos (requiere capturar quién refirió: leads.referido_por_lead_id existe).
-- - Upsells (necesita capturar quién cerró el upsell).
-- - Disputas formales (por ahora se manejan con notas).
--
-- INDEPENDENCIA: 100% aditivo. Solo dispara si comisiones_activas=true.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. comisiones_devengadas
-- ============================================================================
CREATE TABLE IF NOT EXISTS comisiones_devengadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miembro_id uuid NOT NULL REFERENCES usuarios_admin(id) ON DELETE RESTRICT,
  tipo_evento text NOT NULL,
  referencia_id uuid,                                 -- id del evento (sesion_id, lead_id, etc.)
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  monto_usd numeric(12,2) NOT NULL,
  detalle text,
  estado text NOT NULL DEFAULT 'pendiente',           -- pendiente | liquidada | revertida | disputada
  fecha_evento timestamptz NOT NULL DEFAULT now(),
  liquidacion_id uuid,                                -- FK lazy a liquidaciones_mensuales
  notas_internas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT cd_tipo_valido CHECK (tipo_evento IN ('sesion_1a1','caso_exito','referido','upsell','ajuste_manual','bono')),
  CONSTRAINT cd_estado_valido CHECK (estado IN ('pendiente','liquidada','revertida','disputada')),
  CONSTRAINT cd_monto_positivo CHECK (monto_usd >= 0)
);

CREATE INDEX IF NOT EXISTS cd_miembro_idx ON comisiones_devengadas(miembro_id, estado);
CREATE INDEX IF NOT EXISTS cd_fecha_idx ON comisiones_devengadas(fecha_evento DESC);
CREATE INDEX IF NOT EXISTS cd_liquidacion_idx ON comisiones_devengadas(liquidacion_id) WHERE liquidacion_id IS NOT NULL;
-- UNIQUE parcial: evita generar 2 comisiones por el mismo evento al mismo miembro
CREATE UNIQUE INDEX IF NOT EXISTS cd_unique_evento ON comisiones_devengadas(miembro_id, tipo_evento, referencia_id)
  WHERE referencia_id IS NOT NULL AND estado != 'revertida';

COMMENT ON TABLE comisiones_devengadas IS 'Cada evento comisionable. UNIQUE parcial evita doble cobro por el mismo evento.';

-- ============================================================================
-- 2. liquidaciones_mensuales
-- ============================================================================
CREATE TABLE IF NOT EXISTS liquidaciones_mensuales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  miembro_id uuid NOT NULL REFERENCES usuarios_admin(id) ON DELETE RESTRICT,
  periodo_mes date NOT NULL,                          -- YYYY-MM-01
  total_usd numeric(12,2) NOT NULL DEFAULT 0,
  cantidad_eventos integer NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'borrador',            -- borrador | aprobada | pagada
  cerrada_at timestamptz,
  cerrada_por uuid REFERENCES usuarios_admin(id),
  pagada_at timestamptz,
  pagada_por uuid REFERENCES usuarios_admin(id),
  metodo_pago text,
  referencia_pago text,
  notas text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT lm_estado_valido CHECK (estado IN ('borrador','aprobada','pagada')),
  UNIQUE (miembro_id, periodo_mes)
);

CREATE INDEX IF NOT EXISTS lm_periodo_idx ON liquidaciones_mensuales(periodo_mes DESC);
CREATE INDEX IF NOT EXISTS lm_miembro_idx ON liquidaciones_mensuales(miembro_id, periodo_mes DESC);

COMMENT ON TABLE liquidaciones_mensuales IS 'Cabecera de nómina mensual por miembro. UNIQUE (miembro, mes). Cerrada captura el momento de cierre, pagada el pago real.';

ALTER TABLE comisiones_devengadas
  ADD CONSTRAINT cd_liquidacion_fk FOREIGN KEY (liquidacion_id) REFERENCES liquidaciones_mensuales(id) ON DELETE SET NULL;

-- ============================================================================
-- TRIGGER touch
-- ============================================================================
DROP TRIGGER IF EXISTS cd_touch ON comisiones_devengadas;
CREATE TRIGGER cd_touch BEFORE UPDATE ON comisiones_devengadas FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS lm_touch ON liquidaciones_mensuales;
CREATE TRIGGER lm_touch BEFORE UPDATE ON liquidaciones_mensuales FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- FUNCIÓN HELPER: mentor_principal_de_lead
-- ============================================================================
CREATE OR REPLACE FUNCTION mentor_principal_de_lead(p_lead_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_mentor_id uuid;
BEGIN
  -- Mentor con rol funcional cuyo slug empiece con 'mentor', o cualquier asignación si no hay mentor
  SELECT la.usuario_admin_id INTO v_mentor_id
  FROM lead_asignaciones la
  JOIN roles_funcionales rf ON rf.id = la.rol_funcional_id
  WHERE la.lead_id = p_lead_id AND rf.slug LIKE 'mentor%'
  ORDER BY la.asignado_at ASC
  LIMIT 1;

  IF v_mentor_id IS NULL THEN
    -- fallback: primer asignado del lead
    SELECT usuario_admin_id INTO v_mentor_id
    FROM lead_asignaciones WHERE lead_id = p_lead_id
    ORDER BY asignado_at ASC LIMIT 1;
  END IF;

  RETURN v_mentor_id;
END $$;

-- ============================================================================
-- TRIGGER: generar_comision_sesion (al aprobar sesión 1:1)
-- ============================================================================
CREATE OR REPLACE FUNCTION generar_comision_sesion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg record;
  v_monto numeric;
BEGIN
  -- Solo cuando estado_qa pasa a 'aprobada' (no estaba antes)
  IF NEW.estado_qa = 'aprobada' AND (OLD.estado_qa IS NULL OR OLD.estado_qa != 'aprobada') THEN
    SELECT * INTO v_cfg FROM config_automatizaciones WHERE id = 1;
    IF NOT COALESCE(v_cfg.comisiones_activas, false) THEN RETURN NEW; END IF;
    IF NEW.mentor_id IS NULL THEN RETURN NEW; END IF;
    v_monto := COALESCE(v_cfg.comision_por_sesion_usd, 22);
    IF v_monto <= 0 THEN RETURN NEW; END IF;

    INSERT INTO comisiones_devengadas (
      miembro_id, tipo_evento, referencia_id, lead_id, monto_usd, detalle, fecha_evento
    ) VALUES (
      NEW.mentor_id, 'sesion_1a1', NEW.id, NEW.lead_id, v_monto,
      'Sesión #' || NEW.numero_sesion || ' aprobada en QC', NEW.fecha
    ) ON CONFLICT DO NOTHING;

  -- Si reabren una sesión aprobada, revertir
  ELSIF OLD.estado_qa = 'aprobada' AND NEW.estado_qa != 'aprobada' THEN
    UPDATE comisiones_devengadas
      SET estado = 'revertida',
          notas_internas = COALESCE(notas_internas || E'\n', '') || 'Revertida porque la sesión volvió a ' || NEW.estado_qa
      WHERE tipo_evento = 'sesion_1a1' AND referencia_id = NEW.id
        AND estado IN ('pendiente','liquidada');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS s1a1_comision ON sesiones_1a1;
CREATE TRIGGER s1a1_comision AFTER UPDATE OF estado_qa ON sesiones_1a1
  FOR EACH ROW EXECUTE FUNCTION generar_comision_sesion();

-- ============================================================================
-- TRIGGER: generar_comision_caso_exito (al setear caso_exito_at en lead)
-- ============================================================================
CREATE OR REPLACE FUNCTION generar_comision_caso_exito() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg record;
  v_pct numeric;
  v_base numeric;
  v_monto numeric;
  v_mentor uuid;
BEGIN
  -- Solo cuando caso_exito_at pasa de NULL a algo
  IF NEW.caso_exito_at IS NOT NULL AND OLD.caso_exito_at IS NULL THEN
    SELECT * INTO v_cfg FROM config_automatizaciones WHERE id = 1;
    IF NOT COALESCE(v_cfg.comisiones_activas, false) THEN RETURN NEW; END IF;
    v_pct := COALESCE(v_cfg.comision_caso_exito_pct, 5);
    IF v_pct <= 0 THEN RETURN NEW; END IF;

    v_mentor := mentor_principal_de_lead(NEW.id);
    IF v_mentor IS NULL THEN RETURN NEW; END IF;

    v_base := COALESCE(NEW.precio_pagado, 0);
    IF v_base <= 0 THEN RETURN NEW; END IF;

    v_monto := round(v_base * v_pct / 100, 2);

    INSERT INTO comisiones_devengadas (
      miembro_id, tipo_evento, referencia_id, lead_id, monto_usd, detalle, fecha_evento
    ) VALUES (
      v_mentor, 'caso_exito', NEW.id, NEW.id, v_monto,
      v_pct || '% del precio pagado ($' || v_base || ') por caso de éxito', NEW.caso_exito_at
    ) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_comision_caso_exito ON leads;
CREATE TRIGGER leads_comision_caso_exito AFTER UPDATE OF caso_exito_at ON leads
  FOR EACH ROW EXECUTE FUNCTION generar_comision_caso_exito();

-- ============================================================================
-- FUNCIÓN: cerrar_mes_miembro
-- Agrupa devengadas pendientes del periodo en una liquidación.
-- ============================================================================
CREATE OR REPLACE FUNCTION cerrar_mes_miembro(
  p_miembro_id uuid,
  p_periodo_mes date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
  v_total numeric;
  v_count integer;
  v_liquidacion_id uuid;
  v_inicio date;
  v_fin date;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin';
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo admin pleno puede cerrar mes');
  END IF;

  v_inicio := date_trunc('month', p_periodo_mes)::date;
  v_fin := (v_inicio + INTERVAL '1 month')::date;

  -- Calcular total + count de devengadas pendientes en el periodo
  SELECT COALESCE(SUM(monto_usd), 0), COUNT(*)
    INTO v_total, v_count
  FROM comisiones_devengadas
  WHERE miembro_id = p_miembro_id
    AND estado = 'pendiente'
    AND fecha_evento >= v_inicio AND fecha_evento < v_fin;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sin comisiones pendientes en el período');
  END IF;

  -- Upsert liquidación (puede ser una que ya existía en borrador)
  INSERT INTO liquidaciones_mensuales (miembro_id, periodo_mes, total_usd, cantidad_eventos, estado, cerrada_at, cerrada_por)
  VALUES (p_miembro_id, v_inicio, v_total, v_count, 'aprobada', now(), v_usuario_id)
  ON CONFLICT (miembro_id, periodo_mes) DO UPDATE
    SET total_usd = EXCLUDED.total_usd,
        cantidad_eventos = EXCLUDED.cantidad_eventos,
        estado = 'aprobada',
        cerrada_at = EXCLUDED.cerrada_at,
        cerrada_por = EXCLUDED.cerrada_por
  RETURNING id INTO v_liquidacion_id;

  -- Marcar las devengadas como liquidadas + ligar a la liquidación
  UPDATE comisiones_devengadas
    SET estado = 'liquidada', liquidacion_id = v_liquidacion_id
  WHERE miembro_id = p_miembro_id
    AND estado = 'pendiente'
    AND fecha_evento >= v_inicio AND fecha_evento < v_fin;

  RETURN jsonb_build_object('ok', true, 'liquidacion_id', v_liquidacion_id, 'total_usd', v_total, 'cantidad', v_count);
END $$;

-- ============================================================================
-- FUNCIÓN: marcar_liquidacion_pagada
-- ============================================================================
CREATE OR REPLACE FUNCTION marcar_liquidacion_pagada(
  p_liquidacion_id uuid,
  p_metodo text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
  v_liq record;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin';
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo admin pleno');
  END IF;

  SELECT * INTO v_liq FROM liquidaciones_mensuales WHERE id = p_liquidacion_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'No encontrada'); END IF;
  IF v_liq.estado = 'pagada' THEN RETURN jsonb_build_object('ok', false, 'error', 'Ya estaba pagada'); END IF;
  IF v_liq.estado != 'aprobada' THEN RETURN jsonb_build_object('ok', false, 'error', 'Hay que aprobar/cerrar primero'); END IF;

  UPDATE liquidaciones_mensuales
    SET estado = 'pagada',
        pagada_at = now(),
        pagada_por = v_usuario_id,
        metodo_pago = COALESCE(p_metodo, metodo_pago),
        referencia_pago = COALESCE(p_referencia, referencia_pago),
        notas = COALESCE(p_notas, notas)
    WHERE id = p_liquidacion_id;

  RETURN jsonb_build_object('ok', true);
END $$;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE comisiones_devengadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidaciones_mensuales ENABLE ROW LEVEL SECURITY;

-- Cada miembro ve SOLO sus comisiones. Admin pleno ve todo.
DROP POLICY IF EXISTS cd_self_select ON comisiones_devengadas;
CREATE POLICY cd_self_select ON comisiones_devengadas FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR miembro_id IN (SELECT id FROM usuarios_admin WHERE email = auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS cd_admin_all ON comisiones_devengadas;
CREATE POLICY cd_admin_all ON comisiones_devengadas FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

DROP POLICY IF EXISTS lm_self_select ON liquidaciones_mensuales;
CREATE POLICY lm_self_select ON liquidaciones_mensuales FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR miembro_id IN (SELECT id FROM usuarios_admin WHERE email = auth.jwt() ->> 'email')
  );

DROP POLICY IF EXISTS lm_admin_all ON liquidaciones_mensuales;
CREATE POLICY lm_admin_all ON liquidaciones_mensuales FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- ============================================================================
-- BACKFILL: generar devengadas para sesiones ya aprobadas (si las hay)
-- ============================================================================
DO $$
DECLARE
  v_cfg record;
  v_count integer := 0;
  v_ses record;
BEGIN
  SELECT * INTO v_cfg FROM config_automatizaciones WHERE id = 1;
  IF NOT COALESCE(v_cfg.comisiones_activas, false) THEN
    RAISE NOTICE 'Migración 55: comisiones_activas=false, skipping backfill';
    RETURN;
  END IF;

  FOR v_ses IN
    SELECT id, mentor_id, lead_id, numero_sesion, fecha FROM sesiones_1a1
    WHERE estado_qa = 'aprobada' AND mentor_id IS NOT NULL
  LOOP
    INSERT INTO comisiones_devengadas (
      miembro_id, tipo_evento, referencia_id, lead_id, monto_usd, detalle, fecha_evento
    ) VALUES (
      v_ses.mentor_id, 'sesion_1a1', v_ses.id, v_ses.lead_id,
      COALESCE(v_cfg.comision_por_sesion_usd, 22),
      'Backfill · sesión #' || v_ses.numero_sesion, v_ses.fecha
    ) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END LOOP;
  RAISE NOTICE 'Migración 55: backfill listo';
END $$;

COMMIT;
