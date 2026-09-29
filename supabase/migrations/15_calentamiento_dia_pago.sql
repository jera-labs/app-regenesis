-- ============================================================================
-- 15_calentamiento_dia_pago.sql
-- Hace que el primer mensaje de calentamiento se encole para el día del pago
-- (antes empezaba al día siguiente y el cliente no recibía nada al pagar).
-- También ajusta a que la numeración del día de calentamiento coincida con
-- lo que el frontend muestra: fecha_pago = día 1.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.procesar_nuevo_cliente(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
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
    -- Pagó lunes: arranca directo en el programa.
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
    -- Pagó cualquier otro día: va a sala de espera.
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

    -- Encolar notificaciones de calentamiento desde el DÍA DE PAGO (día 1).
    -- Antes empezaba al día siguiente y el cliente no recibía welcome al pagar.
    v_dia_calentamiento := 1;
    v_fecha_calentamiento := v_lead.fecha_pago::DATE;

    WHILE v_fecha_calentamiento < v_fecha_inicio LOOP
      INSERT INTO notificaciones_pendientes (
        lead_id, tipo, canal, programada_para, metadata
      ) VALUES (
        p_lead_id,
        'mensaje_calentamiento',
        'plataforma',
        -- Si el día de pago es hoy, programa "ahora mismo" para el welcome
        -- inmediato. Para los siguientes días, a las 6am.
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
      'va_a_calentamiento', (v_dia_semana != 1)
    )
  );
END;
$$;
