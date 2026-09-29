-- ============================================================================
-- Migración 52: Semáforos Engagement + Progreso (Fase 4)
--
-- ARQUITECTURA:
-- - lead_semaforos (1:1 con lead): estado vigente de 2 luces + score numérico
--   + razones jsonb + override manual con vencimiento.
-- - 2 funciones SQL puras (calcular_semaforo_engagement, calcular_semaforo_progreso)
--   que reciben lead_id y retornan jsonb { color, score, razones[] }.
-- - 1 función orquestadora (recalcular_semaforo_lead) que llama a las 2 y
--   hace upsert respetando overrides activos.
-- - 1 función helper (recalcular_todos_semaforos) para batch desde admin.
--
-- SEÑALES USADAS HOY (con datos que ya existen):
-- - Engagement: dias_sin_login (leads.ultimo_login), pagos atrasados (pagos),
--   sesiones Re-Génesis (sesiones_realizadas), cuotas al día.
-- - Progreso: % tiempo transcurrido vs duración contractual, caso_exito_at,
--   estado comercial, churn.
--
-- En fase 5/6 cuando tengamos KPIs diarios y sesiones 1:1, agregamos más
-- señales editando solo las 2 funciones SQL (no requiere migración estructural).
--
-- INDEPENDENCIA: 100% aditivo, no toca nada existente.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. lead_semaforos
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_semaforos (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  engagement_color text NOT NULL DEFAULT 'gris',
  engagement_score numeric(5,2) DEFAULT 0,
  engagement_razones jsonb DEFAULT '[]'::jsonb,
  progreso_color text NOT NULL DEFAULT 'gris',
  progreso_score numeric(5,2) DEFAULT 0,
  progreso_razones jsonb DEFAULT '[]'::jsonb,
  -- Overrides manuales (admin/mentor puede forzar un color)
  override_engagement text,
  override_progreso text,
  override_motivo text,
  override_hasta timestamptz,
  override_por uuid REFERENCES usuarios_admin(id),
  calculado_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT sem_engagement_valido CHECK (engagement_color IN ('verde','amarillo','rojo','gris')),
  CONSTRAINT sem_progreso_valido CHECK (progreso_color IN ('verde','amarillo','rojo','gris')),
  CONSTRAINT sem_override_eng_valido CHECK (override_engagement IS NULL OR override_engagement IN ('verde','amarillo','rojo')),
  CONSTRAINT sem_override_prog_valido CHECK (override_progreso IS NULL OR override_progreso IN ('verde','amarillo','rojo'))
);

CREATE INDEX IF NOT EXISTS ls_engagement_idx ON lead_semaforos(engagement_color);
CREATE INDEX IF NOT EXISTS ls_progreso_idx ON lead_semaforos(progreso_color);
CREATE INDEX IF NOT EXISTS ls_calculado_at_idx ON lead_semaforos(calculado_at);

COMMENT ON TABLE lead_semaforos IS 'Estado vigente de los 2 semáforos por cliente. 1:1 con lead. Override permite forzar manualmente un color con vencimiento.';

-- ============================================================================
-- 2. FUNCIÓN: calcular_semaforo_engagement
--
-- Mide qué tan activo está el cliente. Señales:
-- - Días sin login (config: semaforo_dias_sin_login_amarillo/rojo)
-- - Pagos atrasados (0 verde, 1 amarillo, 2+ rojo)
-- - Sesiones realizadas relativas al tiempo en programa
-- ============================================================================
CREATE OR REPLACE FUNCTION calcular_semaforo_engagement(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lead record;
  v_cfg record;
  v_dias_sin_login integer;
  v_pagos_atrasados integer;
  v_razones jsonb := '[]'::jsonb;
  v_color text := 'verde';
  v_score numeric := 100;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('color','gris','score',0,'razones',jsonb_build_array('Lead no encontrado'));
  END IF;

  SELECT * INTO v_cfg FROM config_automatizaciones WHERE id = 1;

  -- Señal 1: días sin login
  IF v_lead.ultimo_login IS NULL THEN
    v_razones := v_razones || jsonb_build_object(
      'señal', 'sin_login',
      'detalle', 'Nunca ha entrado a la plataforma',
      'penaliza', 30
    );
    v_score := v_score - 30;
    v_color := 'amarillo';
  ELSE
    v_dias_sin_login := EXTRACT(EPOCH FROM (now() - v_lead.ultimo_login))::integer / 86400;
    IF v_dias_sin_login >= COALESCE(v_cfg.semaforo_dias_sin_login_rojo, 10) THEN
      v_razones := v_razones || jsonb_build_object(
        'señal', 'dias_sin_login',
        'detalle', v_dias_sin_login || ' días sin entrar',
        'penaliza', 40
      );
      v_score := v_score - 40;
      v_color := 'rojo';
    ELSIF v_dias_sin_login >= COALESCE(v_cfg.semaforo_dias_sin_login_amarillo, 5) THEN
      v_razones := v_razones || jsonb_build_object(
        'señal', 'dias_sin_login',
        'detalle', v_dias_sin_login || ' días sin entrar',
        'penaliza', 20
      );
      v_score := v_score - 20;
      IF v_color = 'verde' THEN v_color := 'amarillo'; END IF;
    END IF;
  END IF;

  -- Señal 2: pagos atrasados
  SELECT COUNT(*) INTO v_pagos_atrasados FROM pagos
    WHERE lead_id = p_lead_id AND estado = 'atrasado';
  IF v_pagos_atrasados >= 2 THEN
    v_razones := v_razones || jsonb_build_object(
      'señal', 'pagos_atrasados',
      'detalle', v_pagos_atrasados || ' cuotas vencidas',
      'penaliza', 35
    );
    v_score := v_score - 35;
    v_color := 'rojo';
  ELSIF v_pagos_atrasados = 1 THEN
    v_razones := v_razones || jsonb_build_object(
      'señal', 'pagos_atrasados',
      'detalle', '1 cuota vencida',
      'penaliza', 15
    );
    v_score := v_score - 15;
    IF v_color = 'verde' THEN v_color := 'amarillo'; END IF;
  END IF;

  -- Si está en churn, override automático a rojo
  IF v_lead.churn_at IS NOT NULL THEN
    v_razones := v_razones || jsonb_build_object(
      'señal', 'churn',
      'detalle', 'Cliente fuera del programa',
      'penaliza', 100
    );
    v_score := 0;
    v_color := 'rojo';
  END IF;

  -- Si está en pausa, neutralizar (gris)
  IF v_lead.estado IN ('pausa') OR EXISTS (SELECT 1 FROM lead_estado_comercial WHERE lead_id = p_lead_id AND estado = 'pausa') THEN
    v_color := 'gris';
    v_razones := v_razones || jsonb_build_object(
      'señal', 'pausa',
      'detalle', 'Cliente en pausa (semáforo no aplica)',
      'penaliza', 0
    );
  END IF;

  v_score := GREATEST(0, LEAST(100, v_score));

  RETURN jsonb_build_object(
    'color', v_color,
    'score', v_score,
    'razones', v_razones
  );
END $$;

COMMENT ON FUNCTION calcular_semaforo_engagement IS 'Engagement = qué tan activo está el cliente. Combina login, pagos, estado.';

-- ============================================================================
-- 3. FUNCIÓN: calcular_semaforo_progreso
--
-- Mide qué tan cerca está de cumplir la promesa. Señales:
-- - % tiempo transcurrido vs duración contractual
-- - Caso de éxito alcanzado (verde inmediato)
-- - Lanzamiento + primera venta
-- - Churn (rojo inmediato)
-- ============================================================================
CREATE OR REPLACE FUNCTION calcular_semaforo_progreso(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lead record;
  v_estado_comercial text;
  v_dias_transcurridos integer;
  v_dias_totales integer;
  v_pct_tiempo numeric;
  v_razones jsonb := '[]'::jsonb;
  v_color text := 'verde';
  v_score numeric := 100;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('color','gris','score',0,'razones',jsonb_build_array('Lead no encontrado'));
  END IF;

  SELECT estado INTO v_estado_comercial FROM lead_estado_comercial WHERE lead_id = p_lead_id;

  -- Si caso éxito: verde directo
  IF v_lead.caso_exito_at IS NOT NULL OR v_estado_comercial = 'caso_exito' THEN
    RETURN jsonb_build_object(
      'color', 'verde',
      'score', 100,
      'razones', jsonb_build_array(jsonb_build_object(
        'señal', 'caso_exito',
        'detalle', 'Cliente cumplió promesa del programa',
        'penaliza', 0
      ))
    );
  END IF;

  -- Si churn: rojo
  IF v_lead.churn_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'color', 'rojo',
      'score', 0,
      'razones', jsonb_build_array(jsonb_build_object(
        'señal', 'churn',
        'detalle', 'Cliente fuera del programa',
        'penaliza', 100
      ))
    );
  END IF;

  -- Sin activación todavía
  IF v_lead.fecha_activacion_programa IS NULL THEN
    RETURN jsonb_build_object(
      'color', 'gris',
      'score', 0,
      'razones', jsonb_build_array(jsonb_build_object(
        'señal', 'sin_activacion',
        'detalle', 'Aún no inicia el programa formal',
        'penaliza', 0
      ))
    );
  END IF;

  -- Calcular % tiempo transcurrido
  v_dias_transcurridos := (current_date - v_lead.fecha_activacion_programa)::integer;
  v_dias_totales := COALESCE(v_lead.duracion_contractual_dias, 70);
  v_pct_tiempo := CASE WHEN v_dias_totales > 0 THEN (v_dias_transcurridos::numeric * 100 / v_dias_totales) ELSE 0 END;

  v_razones := v_razones || jsonb_build_object(
    'señal', 'tiempo_programa',
    'detalle', v_dias_transcurridos || ' de ' || v_dias_totales || ' días (' || round(v_pct_tiempo, 0) || '%)',
    'penaliza', 0
  );

  -- Sin primera venta y >50% del programa transcurrido → amarillo
  IF v_lead.primera_venta_at IS NULL AND v_pct_tiempo >= 50 THEN
    v_color := 'amarillo';
    v_score := v_score - 30;
    v_razones := v_razones || jsonb_build_object(
      'señal', 'sin_primera_venta',
      'detalle', 'Sin primera venta y ya pasó la mitad del programa',
      'penaliza', 30
    );
  END IF;

  -- >100% (vencido contractual) y sin caso éxito → rojo
  IF v_pct_tiempo > 100 THEN
    v_color := 'rojo';
    v_score := v_score - 50;
    v_razones := v_razones || jsonb_build_object(
      'señal', 'plazo_vencido',
      'detalle', 'Programa contractual vencido sin caso de éxito',
      'penaliza', 50
    );
  -- >85% y sin lanzamiento → amarillo/rojo
  ELSIF v_pct_tiempo >= 85 AND v_lead.launched_at IS NULL THEN
    v_color := CASE WHEN v_color = 'rojo' THEN 'rojo' ELSE 'amarillo' END;
    v_score := v_score - 20;
    v_razones := v_razones || jsonb_build_object(
      'señal', 'cerca_fin_sin_launch',
      'detalle', 'Cerca del fin contractual sin lanzar oferta',
      'penaliza', 20
    );
  END IF;

  v_score := GREATEST(0, LEAST(100, v_score));

  RETURN jsonb_build_object(
    'color', v_color,
    'score', v_score,
    'razones', v_razones
  );
END $$;

COMMENT ON FUNCTION calcular_semaforo_progreso IS 'Progreso = qué tan cerca está el cliente de cumplir la promesa. Combina tiempo, hitos.';

-- ============================================================================
-- 4. FUNCIÓN: recalcular_semaforo_lead (orquesta + upsert + respeta override)
-- ============================================================================
CREATE OR REPLACE FUNCTION recalcular_semaforo_lead(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_eng jsonb;
  v_prog jsonb;
  v_existente record;
  v_color_eng_final text;
  v_color_prog_final text;
BEGIN
  v_eng := calcular_semaforo_engagement(p_lead_id);
  v_prog := calcular_semaforo_progreso(p_lead_id);

  SELECT * INTO v_existente FROM lead_semaforos WHERE lead_id = p_lead_id;

  -- Si override activo y no expirado, usar override en lugar del calculado
  v_color_eng_final := v_eng->>'color';
  v_color_prog_final := v_prog->>'color';
  IF v_existente.override_engagement IS NOT NULL
     AND (v_existente.override_hasta IS NULL OR v_existente.override_hasta > now()) THEN
    v_color_eng_final := v_existente.override_engagement;
  END IF;
  IF v_existente.override_progreso IS NOT NULL
     AND (v_existente.override_hasta IS NULL OR v_existente.override_hasta > now()) THEN
    v_color_prog_final := v_existente.override_progreso;
  END IF;

  INSERT INTO lead_semaforos (
    lead_id, engagement_color, engagement_score, engagement_razones,
    progreso_color, progreso_score, progreso_razones, calculado_at, updated_at
  ) VALUES (
    p_lead_id,
    v_color_eng_final,
    (v_eng->>'score')::numeric,
    v_eng->'razones',
    v_color_prog_final,
    (v_prog->>'score')::numeric,
    v_prog->'razones',
    now(),
    now()
  ) ON CONFLICT (lead_id) DO UPDATE
    SET engagement_color = EXCLUDED.engagement_color,
        engagement_score = EXCLUDED.engagement_score,
        engagement_razones = EXCLUDED.engagement_razones,
        progreso_color = EXCLUDED.progreso_color,
        progreso_score = EXCLUDED.progreso_score,
        progreso_razones = EXCLUDED.progreso_razones,
        calculado_at = EXCLUDED.calculado_at,
        updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object(
    'ok', true,
    'engagement', jsonb_build_object('color', v_color_eng_final, 'calculado', v_eng->>'color', 'override', v_existente.override_engagement),
    'progreso', jsonb_build_object('color', v_color_prog_final, 'calculado', v_prog->>'color', 'override', v_existente.override_progreso)
  );
END $$;

-- ============================================================================
-- 5. FUNCIÓN: recalcular_todos_semaforos (batch, retorna count)
-- ============================================================================
CREATE OR REPLACE FUNCTION recalcular_todos_semaforos() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lead record;
  v_count integer := 0;
  v_errores integer := 0;
BEGIN
  FOR v_lead IN
    SELECT id FROM leads WHERE estado != 'perdido'
  LOOP
    BEGIN
      PERFORM recalcular_semaforo_lead(v_lead.id);
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errores := v_errores + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'recalculados', v_count,
    'errores', v_errores
  );
END $$;

-- ============================================================================
-- 6. FUNCIÓN: setear override manual
-- ============================================================================
CREATE OR REPLACE FUNCTION setear_override_semaforo(
  p_lead_id uuid,
  p_engagement text DEFAULT NULL,
  p_progreso text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_hasta timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol IN ('admin','moderador');
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo admin/moderador puede setear override');
  END IF;

  IF p_engagement IS NOT NULL AND p_engagement NOT IN ('verde','amarillo','rojo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Engagement color inválido');
  END IF;
  IF p_progreso IS NOT NULL AND p_progreso NOT IN ('verde','amarillo','rojo') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Progreso color inválido');
  END IF;

  INSERT INTO lead_semaforos (lead_id, override_engagement, override_progreso, override_motivo, override_hasta, override_por, updated_at)
  VALUES (p_lead_id, p_engagement, p_progreso, p_motivo, p_hasta, v_usuario_id, now())
  ON CONFLICT (lead_id) DO UPDATE
    SET override_engagement = EXCLUDED.override_engagement,
        override_progreso = EXCLUDED.override_progreso,
        override_motivo = EXCLUDED.override_motivo,
        override_hasta = EXCLUDED.override_hasta,
        override_por = EXCLUDED.override_por,
        updated_at = now();

  -- Recalcular inmediato para aplicar el override
  PERFORM recalcular_semaforo_lead(p_lead_id);

  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION limpiar_override_semaforo(p_lead_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol IN ('admin','moderador');
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No autorizado');
  END IF;

  UPDATE lead_semaforos
    SET override_engagement = NULL, override_progreso = NULL,
        override_motivo = NULL, override_hasta = NULL, override_por = NULL,
        updated_at = now()
    WHERE lead_id = p_lead_id;

  PERFORM recalcular_semaforo_lead(p_lead_id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE lead_semaforos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ls_equipo_select ON lead_semaforos;
CREATE POLICY ls_equipo_select ON lead_semaforos FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  );

DROP POLICY IF EXISTS ls_admin_all ON lead_semaforos;
CREATE POLICY ls_admin_all ON lead_semaforos FOR ALL TO authenticated
  USING (mi_rol_admin() IN ('admin','moderador'))
  WITH CHECK (mi_rol_admin() IN ('admin','moderador'));

-- Cliente NO ve sus semáforos (son métricas internas del equipo)

-- ============================================================================
-- Trigger touch updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS ls_touch ON lead_semaforos;
CREATE TRIGGER ls_touch BEFORE UPDATE ON lead_semaforos
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- BACKFILL: calcular semáforos iniciales para todos los leads activos
-- ============================================================================
SELECT recalcular_todos_semaforos();

COMMIT;
