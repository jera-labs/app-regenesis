-- ============================================================================
-- Migración 77 (Re-Génesis) — procesar_nuevo_cliente() idempotente
--
-- Aplicada en vivo vía Management API el 2026-06-19 (incidente de datos).
--
-- BUG: webhook-ghl llama a procesar_nuevo_cliente() en CADA pago. Para clientes
-- en cuotas, el pago de una cuota (o un webhook GHL re-disparado) re-ejecutaba el
-- onboarding y reseteaba al cliente a 'pagado_calentamiento', borrando
-- tema_actual_orden y sobrescribiendo sus fechas de programa con una fecha futura.
-- La plataforma oculta los módulos en calentamiento, así que el cliente "perdía"
-- acceso a todo. Afectó a Aixa Aviles, Alejandra Ceballos, Fabiana Garcia.
--
-- FIX (capa 1): si el lead YA está dentro del programa, registrar el pago y salir,
-- sin re-onboardear. El cron (cron_diario_completo) NO llama a esta función, así
-- que la activación legítima calentamiento->activo no se ve afectada.
-- Ver también la migración 78 (trigger de defensa a nivel de datos).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.procesar_nuevo_cliente(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- IDEMPOTENCIA: si el lead ya está en el programa (pago de cuota o webhook GHL
  -- re-disparado), registrar el pago pero NO re-onboardear.
  IF v_lead.estado IN ('activo','completado','pausa','caso_exito')
     OR v_lead.tema_actual_orden IS NOT NULL THEN
    INSERT INTO interacciones (lead_id, tipo, canal, direccion, ocurrio_at, metadata)
    VALUES (
      p_lead_id, 'pago', 'manual', 'inbound', NOW(),
      jsonb_build_object(
        'nota', 'pago adicional/cuota; onboarding omitido por idempotencia',
        'estado_actual', v_lead.estado,
        'tema_actual_orden', v_lead.tema_actual_orden
      )
    );
    RETURN;
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
          WHEN v_fecha_calentamiento = fecha_hoy() THEN NOW()
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
$function$;