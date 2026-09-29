-- ============================================================================
-- 18_calentamiento_dia_semana.sql
-- Cambia la numeración del día de calentamiento: ya no es "días desde el pago"
-- sino el ISODOW (1=Lun, 2=Mar, ..., 7=Dom) del día calendario.
--
-- Ejemplo: cliente paga el sábado → día_calentamiento = 6 (sábado).
-- Domingo siguiente → día 7. Lunes siguiente → arranca programa día 1.
--
-- Los placeholders de mensajes_calentamiento con dia_calentamiento 1..7
-- corresponden a lunes-domingo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.procesar_nuevo_cliente(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lead RECORD;
  v_dia_semana INTEGER;
  v_fecha_inicio DATE;
  v_primer_tema INTEGER;
  v_dia_calentamiento INTEGER;
  v_fecha_calentamiento DATE;
BEGIN
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead no encontrado: %', p_lead_id;
  END IF;

  v_dia_semana := EXTRACT(ISODOW FROM v_lead.fecha_pago::DATE);
  v_primer_tema := calcular_primer_tema_para_lead(v_lead.fecha_pago::DATE);

  IF v_dia_semana = 1 THEN
    v_fecha_inicio := v_lead.fecha_pago::DATE;
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

    -- Numeración por ISODOW: si paga sábado (6), día_calentamiento empieza en 6,
    -- sigue 7 (domingo) y al lunes arranca programa.
    v_dia_calentamiento := v_dia_semana;
    v_fecha_calentamiento := v_lead.fecha_pago::DATE;

    WHILE v_fecha_calentamiento < v_fecha_inicio LOOP
      INSERT INTO notificaciones_pendientes (
        lead_id, tipo, canal, programada_para, metadata
      ) VALUES (
        p_lead_id, 'mensaje_calentamiento', 'plataforma',
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
