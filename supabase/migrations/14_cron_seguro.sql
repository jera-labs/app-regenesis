-- ============================================================================
-- 14_cron_seguro.sql
-- Refactor del cron diario para que NO mute campos cacheados de leads.
-- El cálculo de tema_actual_orden, dia_actual_en_tema y semana_actual se hace
-- on-the-fly desde fecha_inicio_programa (en frontend con recalcularProgreso(),
-- y en SQL acá donde haga falta).
--
-- Lo que el cron sí debe hacer:
--   1. Activar leads en pagado_calentamiento cuya fecha_inicio_programa llegó
--   2. Solicitar testimonio_mitad cuando un lead activo llega a día 35
--   3. Solicitar testimonio_final y marcar 'completado' al día 70
--   4. Encolar notificaciones del día (pregunta + sesión si aplica)
--
-- Idempotente: ejecutarlo múltiples veces el mismo día no duplica notificaciones.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.avanzar_lead_diario(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead RECORD;
  v_dias INTEGER;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;

  IF v_lead.estado != 'activo' OR v_lead.fecha_inicio_programa IS NULL THEN
    RETURN;
  END IF;

  v_dias := CURRENT_DATE - v_lead.fecha_inicio_programa;

  -- Día 35 — final tema 5 (Abundancia, según el orden 1..10): testimonio mitad
  IF v_dias >= 35 AND v_lead.testimonio_mitad_solicitado_at IS NULL THEN
    INSERT INTO notificaciones_pendientes (lead_id, tipo, canal, programada_para)
    VALUES (p_lead_id, 'solicitud_testimonio_mitad', 'plataforma', NOW() + INTERVAL '1 day');

    UPDATE leads SET testimonio_mitad_solicitado_at = NOW()
    WHERE id = p_lead_id;
  END IF;

  -- Día 70+ — programa completado
  IF v_dias >= 70 THEN
    UPDATE leads SET estado = 'completado', updated_at = NOW()
    WHERE id = p_lead_id AND estado = 'activo';

    IF v_lead.testimonio_final_solicitado_at IS NULL THEN
      INSERT INTO notificaciones_pendientes (lead_id, tipo, canal, programada_para)
      VALUES (p_lead_id, 'solicitud_testimonio_final', 'plataforma', NOW() + INTERVAL '1 day');

      UPDATE leads SET testimonio_final_solicitado_at = NOW()
      WHERE id = p_lead_id;
    END IF;

    INSERT INTO interacciones (lead_id, tipo, canal, direccion, ocurrio_at)
    VALUES (p_lead_id, 'programa_completado', 'plataforma', 'interno', NOW());
  END IF;
END;
$$;


CREATE OR REPLACE FUNCTION public.encolar_notificaciones_diarias()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead RECORD;
  v_tipo_sesion TEXT;
  v_count INTEGER := 0;
  v_hoy DATE := CURRENT_DATE;
  v_dias INTEGER;
  v_tema_orden INTEGER;
  v_dia_en_tema INTEGER;
BEGIN
  FOR v_lead IN
    SELECT * FROM leads
    WHERE estado = 'activo' AND fecha_inicio_programa IS NOT NULL
  LOOP
    v_dias := v_hoy - v_lead.fecha_inicio_programa;

    -- Solo encolamos si está dentro del programa (días 0..69)
    CONTINUE WHEN v_dias < 0 OR v_dias >= 70;

    v_tema_orden := ((COALESCE(v_lead.primer_tema_orden, 1) - 1 + (v_dias / 7)) % 10) + 1;
    v_dia_en_tema := (v_dias % 7) + 1;

    -- Pregunta del día (idempotente: si ya existe para hoy, no duplica)
    IF NOT EXISTS (
      SELECT 1 FROM notificaciones_pendientes
      WHERE lead_id = v_lead.id
        AND tipo = 'pregunta_dia'
        AND DATE(programada_para) = v_hoy
    ) THEN
      INSERT INTO notificaciones_pendientes (
        lead_id, tipo, canal, programada_para, metadata
      ) VALUES (
        v_lead.id, 'pregunta_dia', 'plataforma',
        v_hoy + INTERVAL '6 hours',
        jsonb_build_object('tema_orden', v_tema_orden, 'dia_relativo', v_dia_en_tema)
      );
      v_count := v_count + 1;
    END IF;

    -- Sesión del día si aplica
    v_tipo_sesion := tipo_sesion_de_hoy(v_lead.id);
    IF v_tipo_sesion IS NOT NULL AND v_tipo_sesion <> '' THEN
      IF NOT EXISTS (
        SELECT 1 FROM notificaciones_pendientes
        WHERE lead_id = v_lead.id
          AND tipo = 'recordatorio_sesion_' || v_tipo_sesion
          AND DATE(programada_para) = v_hoy
      ) THEN
        INSERT INTO notificaciones_pendientes (
          lead_id, tipo, canal, programada_para
        ) VALUES (
          v_lead.id, 'recordatorio_sesion_' || v_tipo_sesion, 'whatsapp',
          v_hoy + INTERVAL '9 hours'
        );
        v_count := v_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;


CREATE OR REPLACE FUNCTION public.cron_diario_completo()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead RECORD;
  v_activados INTEGER := 0;
  v_revisados INTEGER := 0;
  v_completados_hoy INTEGER := 0;
  v_notificaciones INTEGER := 0;
BEGIN
  -- 1. Activar clientes en calentamiento que ya cruzaron su fecha de inicio.
  --    Esto reemplaza el filtro "solo lunes" del antiguo cron — ahora cualquier
  --    día funciona si la fecha de inicio individual lo amerita.
  WITH activados AS (
    UPDATE leads SET estado = 'activo', updated_at = NOW()
    WHERE estado = 'pagado_calentamiento'
      AND fecha_inicio_programa IS NOT NULL
      AND fecha_inicio_programa <= CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_activados FROM activados;

  -- 2. Para cada lead activo, revisar testimonios y completados.
  FOR v_lead IN SELECT id FROM leads WHERE estado = 'activo' LOOP
    PERFORM avanzar_lead_diario(v_lead.id);
    v_revisados := v_revisados + 1;
  END LOOP;

  SELECT COUNT(*) INTO v_completados_hoy
  FROM leads
  WHERE estado = 'completado' AND DATE(updated_at) = CURRENT_DATE;

  -- 3. Encolar notificaciones del día (idempotente).
  v_notificaciones := encolar_notificaciones_diarias();

  RETURN jsonb_build_object(
    'fecha', CURRENT_DATE,
    'leads_activados_hoy', v_activados,
    'leads_revisados', v_revisados,
    'leads_completados_hoy', v_completados_hoy,
    'notificaciones_encoladas', v_notificaciones
  );
END;
$$;
