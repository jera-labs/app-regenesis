-- ============================================================================
-- MIGRACIÓN 23 — Lógica de avance basada en calendario_temas
--
-- Reescribe 3 funciones para consumir la tabla calendario_temas en lugar de
-- calcular el tema con módulo desde fecha ancla:
--
--   1. tema_para_fecha(fecha)            — helper, dado un día devuelve el
--      tema_orden del lunes de ESA semana.
--   2. procesar_nuevo_cliente(p_lead_id) — consulta el calendario para
--      asignar tema_actual_orden al pagar lunes; mantiene NULL durante el
--      calentamiento (el cron lo asigna al activarlo).
--   3. avanzar_lead_diario(p_lead_id)    — cada vez que corre el cron diario,
--      sincroniza tema_actual_orden con el calendario del día actual del
--      cliente. Si el tema cambió, agrega el anterior a temas_completados.
--      Mantiene la lógica de milestones (testimonios, cierre).
--
-- Lógica de inicio según ISODOW:
--   Lunes (1)     → arranca ese mismo lunes (sin calentamiento).
--   Domingo (7)   → calentamiento de 1 día, arranca lunes siguiente.
--   Mar-Sáb (2-6) → calentamiento varios días, arranca lunes siguiente.
-- ============================================================================

-- 1. Helper: dado cualquier día, retorna el tema_orden del lunes de esa semana
CREATE OR REPLACE FUNCTION public.tema_para_fecha(p_fecha DATE)
RETURNS SMALLINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lunes DATE;
  v_orden SMALLINT;
BEGIN
  v_lunes := p_fecha - ((EXTRACT(ISODOW FROM p_fecha) - 1) || ' days')::INTERVAL;

  SELECT tema_orden INTO v_orden
  FROM public.calendario_temas
  WHERE fecha_lunes = v_lunes;

  RETURN v_orden;  -- NULL si no hay calendario para esa semana
END;
$$;

COMMENT ON FUNCTION public.tema_para_fecha(DATE) IS
  'Dado un día, retorna el tema_orden del lunes de esa semana según calendario_temas. NULL si no hay calendario cargado.';


-- 2. Reescribir procesar_nuevo_cliente
CREATE OR REPLACE FUNCTION public.procesar_nuevo_cliente(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_dia_semana INTEGER;
  v_fecha_inicio DATE;
  v_primer_tema SMALLINT;
  v_dia_calentamiento INTEGER;
  v_fecha_calentamiento DATE;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead no encontrado: %', p_lead_id;
  END IF;

  v_dia_semana := EXTRACT(ISODOW FROM v_lead.fecha_pago::DATE);

  IF v_dia_semana = 1 THEN
    v_fecha_inicio := v_lead.fecha_pago::DATE;
    v_primer_tema := tema_para_fecha(v_fecha_inicio);

    UPDATE leads SET
      estado = 'activo',
      fecha_inicio_programa = v_fecha_inicio,
      fecha_fin_estimada = v_fecha_inicio + INTERVAL '70 days',
      primer_tema_orden = v_primer_tema,
      tema_actual_orden = v_primer_tema,
      semana_actual = 1,
      dia_actual_en_tema = 1
    WHERE id = p_lead_id;

  ELSE
    v_fecha_inicio := v_lead.fecha_pago::DATE + ((8 - v_dia_semana) || ' days')::INTERVAL;
    v_primer_tema := tema_para_fecha(v_fecha_inicio);

    UPDATE leads SET
      estado = 'pagado_calentamiento',
      fecha_inicio_calentamiento = v_lead.fecha_pago::DATE,
      fecha_inicio_programa = v_fecha_inicio,
      fecha_fin_estimada = v_fecha_inicio + INTERVAL '70 days',
      primer_tema_orden = v_primer_tema,
      tema_actual_orden = NULL,
      semana_actual = 0,
      dia_actual_en_tema = 0
    WHERE id = p_lead_id;

    v_dia_calentamiento := v_dia_semana;
    v_fecha_calentamiento := v_lead.fecha_pago::DATE;

    WHILE v_fecha_calentamiento < v_fecha_inicio LOOP
      INSERT INTO notificaciones_pendientes (
        lead_id, tipo, canal, programada_para, metadata
      ) VALUES (
        p_lead_id,
        'mensaje_calentamiento',
        'plataforma',
        CASE
          WHEN v_fecha_calentamiento = CURRENT_DATE THEN NOW()
          ELSE v_fecha_calentamiento + INTERVAL '6 hours'
        END,
        jsonb_build_object('dia_calentamiento', v_dia_calentamiento)
      );
      v_dia_calentamiento := v_dia_calentamiento + 1;
      v_fecha_calentamiento := v_fecha_calentamiento + INTERVAL '1 day';
    END LOOP;
  END IF;

  INSERT INTO interacciones (lead_id, tipo, canal, direccion, ocurrio_at, metadata)
  VALUES (
    p_lead_id, 'pago', 'manual', 'inbound', NOW(),
    jsonb_build_object(
      'primer_tema', v_primer_tema,
      'fecha_inicio', v_fecha_inicio,
      'dia_semana_pago', v_dia_semana,
      'va_a_calentamiento', (v_dia_semana != 1)
    )
  );
END;
$$;


-- 3. Reescribir avanzar_lead_diario
CREATE OR REPLACE FUNCTION public.avanzar_lead_diario(p_lead_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_dias INTEGER;
  v_dia_en_tema INTEGER;
  v_semana INTEGER;
  v_tema_hoy SMALLINT;
  v_tema_anterior SMALLINT;
  v_completados INTEGER[];
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;

  IF v_lead.estado != 'activo' OR v_lead.fecha_inicio_programa IS NULL THEN
    RETURN;
  END IF;

  v_dias := CURRENT_DATE - v_lead.fecha_inicio_programa;

  IF v_dias >= 70 THEN
    UPDATE leads SET estado = 'completado', updated_at = NOW()
    WHERE id = p_lead_id AND estado = 'activo';

    IF v_lead.testimonio_final_solicitado_at IS NULL THEN
      INSERT INTO notificaciones_pendientes (lead_id, tipo, canal, programada_para)
      VALUES (p_lead_id, 'solicitud_testimonio_final', 'plataforma', NOW() + INTERVAL '1 day');
      UPDATE leads SET testimonio_final_solicitado_at = NOW() WHERE id = p_lead_id;
    END IF;

    INSERT INTO interacciones (lead_id, tipo, canal, direccion, ocurrio_at)
    VALUES (p_lead_id, 'programa_completado', 'plataforma', 'interno', NOW());

    RETURN;
  END IF;

  v_semana := (v_dias / 7) + 1;
  v_dia_en_tema := (v_dias % 7) + 1;

  v_tema_hoy := tema_para_fecha(CURRENT_DATE);
  v_tema_anterior := v_lead.tema_actual_orden;

  IF v_tema_hoy IS NULL THEN
    v_tema_hoy := v_tema_anterior;
  END IF;

  v_completados := COALESCE(v_lead.temas_completados, ARRAY[]::INTEGER[]);
  IF v_tema_anterior IS NOT NULL
     AND v_tema_anterior != v_tema_hoy
     AND NOT (v_tema_anterior = ANY(v_completados)) THEN
    v_completados := array_append(v_completados, v_tema_anterior::INTEGER);
  END IF;

  UPDATE leads SET
    tema_actual_orden = v_tema_hoy,
    semana_actual = v_semana,
    dia_actual_en_tema = v_dia_en_tema,
    temas_completados = v_completados,
    updated_at = NOW()
  WHERE id = p_lead_id;

  IF v_dias >= 35 AND v_lead.testimonio_mitad_solicitado_at IS NULL THEN
    INSERT INTO notificaciones_pendientes (lead_id, tipo, canal, programada_para)
    VALUES (p_lead_id, 'solicitud_testimonio_mitad', 'plataforma', NOW() + INTERVAL '1 day');
    UPDATE leads SET testimonio_mitad_solicitado_at = NOW() WHERE id = p_lead_id;
  END IF;
END;
$$;
