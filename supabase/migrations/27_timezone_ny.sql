-- ============================================================================
-- MIGRACIÓN 27: Cron y cálculos de fecha usan timezone America/New_York
--
-- Bug: las funciones usaban CURRENT_DATE que devuelve la fecha en UTC (timezone
-- del DB). Con cron a las 11:00 UTC = 06:00 NY funcionaba la corrida normal,
-- pero cualquier ejecución después de medianoche UTC (~20:00 NY) avanzaba un
-- día a los clientes.
--
-- Fix: helper fecha_hoy() retorna la fecha actual en America/New_York (Frank
-- está en Orlando, FL). Cada función reemplaza CURRENT_DATE por fecha_hoy().
-- ============================================================================

CREATE OR REPLACE FUNCTION fecha_hoy()
RETURNS DATE
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT (NOW() AT TIME ZONE 'America/New_York')::date;
$$;

COMMENT ON FUNCTION fecha_hoy() IS
  'Fecha actual en zona horaria America/New_York (Orlando/Eastern Time). Usar siempre en lugar de CURRENT_DATE para que el día del programa se calcule consistentemente con la hora local del coach Frank.';


-- ---- avanzar_lead_diario (2 reemplazos) ----
CREATE OR REPLACE FUNCTION public.avanzar_lead_diario(p_lead_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  v_dias := fecha_hoy() - v_lead.fecha_inicio_programa;

  -- Programa completado al día 70
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

  -- Calcular semana_actual (1..10) y dia_en_tema (1..7)
  v_semana := (v_dias / 7) + 1;
  v_dia_en_tema := (v_dias % 7) + 1;

  -- Tema que toca HOY según calendario_temas
  v_tema_hoy := tema_para_fecha(fecha_hoy());
  v_tema_anterior := v_lead.tema_actual_orden;

  -- Si el calendario no tiene entrada para esta semana, mantener el tema anterior
  -- (caso edge: calendario no cargado para una fecha futura).
  IF v_tema_hoy IS NULL THEN
    v_tema_hoy := v_tema_anterior;
  END IF;

  -- Si el tema cambió (cliente arrancó nueva semana) y el anterior no estaba
  -- en temas_completados, agregarlo. Esto preserva el historial real de qué
  -- temas vivió el cliente, incluso si el calendario los duplica.
  v_completados := COALESCE(v_lead.temas_completados, ARRAY[]::INTEGER[]);
  IF v_tema_anterior IS NOT NULL
     AND v_tema_anterior != v_tema_hoy
     AND NOT (v_tema_anterior = ANY(v_completados)) THEN
    v_completados := array_append(v_completados, v_tema_anterior::INTEGER);
  END IF;

  -- Sincronizar estado del lead
  UPDATE leads SET
    tema_actual_orden = v_tema_hoy,
    semana_actual = v_semana,
    dia_actual_en_tema = v_dia_en_tema,
    temas_completados = v_completados,
    updated_at = NOW()
  WHERE id = p_lead_id;

  -- Día 35 — testimonio mitad
  IF v_dias >= 35 AND v_lead.testimonio_mitad_solicitado_at IS NULL THEN
    INSERT INTO notificaciones_pendientes (lead_id, tipo, canal, programada_para)
    VALUES (p_lead_id, 'solicitud_testimonio_mitad', 'plataforma', NOW() + INTERVAL '1 day');
    UPDATE leads SET testimonio_mitad_solicitado_at = NOW() WHERE id = p_lead_id;
  END IF;
END;
$function$;

-- ---- calcular_tema_actual_semana (1 reemplazos) ----
CREATE OR REPLACE FUNCTION public.calcular_tema_actual_semana()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$

DECLARE

  fecha_ancla DATE;

  hoy DATE := fecha_hoy();

  inicio_semana_ancla DATE;

  inicio_semana_hoy DATE;

  semanas_diff INTEGER;

  orden_tema INTEGER;

BEGIN

  -- Obtener fecha ancla de configuración

  SELECT valor::DATE INTO fecha_ancla 

  FROM configuracion_sistema 

  WHERE clave = 'fecha_ancla_programa';

  

  -- Calcular el lunes de la semana ancla y de la semana actual

  inicio_semana_ancla := date_trunc('week', fecha_ancla)::DATE;

  inicio_semana_hoy := date_trunc('week', hoy)::DATE;

  

  -- Diferencia en semanas

  semanas_diff := (inicio_semana_hoy - inicio_semana_ancla) / 7;

  

  -- Módulo-10 + 1 (para mapear 0-9 a 1-10)

  orden_tema := (semanas_diff % 10) + 1;

  

  -- Asegurar que sea positivo (por si fecha_ancla está en futuro)

  IF orden_tema <= 0 THEN

    orden_tema := orden_tema + 10;

  END IF;

  

  RETURN orden_tema;

END;

$function$;

-- ---- cron_diario_completo (3 reemplazos) ----
CREATE OR REPLACE FUNCTION public.cron_diario_completo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      AND fecha_inicio_programa <= fecha_hoy()
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
  WHERE estado = 'completado' AND DATE(updated_at) = fecha_hoy();

  -- 3. Encolar notificaciones del día (idempotente).
  v_notificaciones := encolar_notificaciones_diarias();

  RETURN jsonb_build_object(
    'fecha', fecha_hoy(),
    'leads_activados_hoy', v_activados,
    'leads_revisados', v_revisados,
    'leads_completados_hoy', v_completados_hoy,
    'notificaciones_encoladas', v_notificaciones
  );
END;
$function$;

-- ---- encolar_notificaciones_diarias (1 reemplazos) ----
CREATE OR REPLACE FUNCTION public.encolar_notificaciones_diarias()
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_lead RECORD;
  v_tipo_sesion TEXT;
  v_count INTEGER := 0;
  v_hoy DATE := fecha_hoy();
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
$function$;

-- ---- procesar_nuevo_cliente (1 reemplazos) ----
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

  v_dia_semana := EXTRACT(ISODOW FROM v_lead.fecha_pago::DATE);

  IF v_dia_semana = 1 THEN
    -- Lunes: arranca directo en el programa.
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
    -- Cualquier otro día: calentamiento hasta el siguiente lunes.
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

    -- Encolar mensajes de calentamiento desde el día de pago hasta domingo
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
