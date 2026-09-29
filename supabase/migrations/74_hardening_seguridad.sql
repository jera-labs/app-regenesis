-- ============================================================
-- 74_hardening_seguridad.sql  ·  PLATAFORMA + RE-GÉNESIS
-- Correctivos de seguridad detectados en la auditoría 2026-06-09.
-- ⚠️ PREPARADA PERO NO APLICADA — requiere confirmación de Alex.
--
-- Contenido:
--   A. Índices únicos de journaling_respuestas: de parciales a completos.
--      Los parciales (WHERE mensaje_id IS NOT NULL) no son inferibles como
--      árbitro de ON CONFLICT vía PostgREST → todo .upsert() del frontend
--      fallaba con 42P10 desde el 2026-05-30. El frontend ya tiene un
--      workaround (upsert manual), esto arregla la causa raíz.
--   B. Vistas de dashboard: corrían como OWNER (security_invoker=false),
--      con GRANT a anon y authenticated → cualquiera con la anon key leía
--      ingresos, churn, MRR y comisiones por mentor. Se pasan a
--      security_invoker=true (la RLS del caller decide) y se revoca anon
--      y todo privilegio de escritura.
--   C. Materialized view vw_admin_kpis_vivos: las MV no soportan RLS y
--      tenía GRANT a anon → se revoca anon/authenticated (nada del
--      frontend la consulta; queda para service_role).
--   D. eliminar_cliente_completo(): el guard aceptaba CUALQUIER fila de
--      usuarios_admin (un rol 'lector' podía borrar clientes). Ahora exige
--      rol='admin' activo.
--   E. crear_calendario_cuotas() / marcar_pago_pagado(): exigen rol
--      admin o moderador (antes solo activo=true → lector podía mutar pagos).
--   F. resolver_alerta(): ídem, admin o moderador.
--   G. dashboard_kpis_globales(): revocar EXECUTE a anon/PUBLIC.
-- ============================================================

-- ─── A. Índices únicos completos para journaling_respuestas ───
-- Con NULLS DISTINCT (default), las filas con mensaje_id NULL nunca chocan
-- entre sí: el comportamiento es idéntico al índice parcial, pero ON CONFLICT
-- sí puede inferirlo.
DROP INDEX IF EXISTS journaling_respuestas_lead_mensaje_uniq;
CREATE UNIQUE INDEX journaling_respuestas_lead_mensaje_uniq
  ON public.journaling_respuestas (lead_id, mensaje_id);

DROP INDEX IF EXISTS journaling_respuestas_lead_calentamiento_uniq;
CREATE UNIQUE INDEX journaling_respuestas_lead_calentamiento_uniq
  ON public.journaling_respuestas (lead_id, mensaje_calentamiento_id);

-- ─── B. Vistas de dashboard: invoker + revocar anon + solo SELECT ───
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'vw_dashboard_global','vw_dashboard_cohortes','vw_dashboard_segmento',
    'vw_dashboard_time_to','vw_dashboard_mentor','vw_dashboard_velocidad_semanal',
    'vw_dashboard_nps','vw_dashboard_nps_mentor','leads_contratos_pendientes'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
               WHERE n.nspname='public' AND c.relname=v AND c.relkind='v') THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon', v);
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', v);
      -- authenticated conserva SELECT; con invoker=true la RLS de las tablas
      -- base decide qué ve cada quien (admins todo, clientes solo lo suyo).
    END IF;
  END LOOP;
END $$;

-- ─── C. Materialized view de KPIs: sin acceso anon/authenticated ───
REVOKE ALL ON public.vw_admin_kpis_vivos FROM anon, authenticated;

-- ─── D. eliminar_cliente_completo: solo admin pleno ───
-- (Cuerpo tomado de la definición VIVA en producción 2026-06-09; único cambio:
--  el guard exige rol='admin' AND activo=true.)
CREATE OR REPLACE FUNCTION public.eliminar_cliente_completo(p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_email TEXT;
  v_lead RECORD;
  v_resumen JSONB := '{}'::JSONB;
  v_count INT;
  v_es_admin BOOLEAN;
BEGIN
  v_admin_email := (auth.jwt() ->> 'email');
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Sesión sin email en JWT';
  END IF;
  -- HARDENING 74: antes bastaba con existir en usuarios_admin (un lector
  -- podía borrar clientes). Ahora solo admin pleno y activo.
  IF NOT EXISTS (
    SELECT 1 FROM usuarios_admin
    WHERE email = v_admin_email AND rol = 'admin' AND activo = true
  ) THEN
    RAISE EXCEPTION 'Solo admin pleno puede eliminar clientes (caller: %)', v_admin_email;
  END IF;

  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % no existe', p_lead_id;
  END IF;

  INSERT INTO cliente_eliminado_log (
    lead_id_original, email, nombre, estado_al_eliminar,
    cohorte, fecha_pago_original, precio_pagado_original,
    ghl_contact_id_original, datos_snapshot, eliminado_por
  ) VALUES (
    v_lead.id, v_lead.email, v_lead.nombre, v_lead.estado,
    v_lead.cohorte, v_lead.fecha_pago, v_lead.precio_pagado,
    v_lead.ghl_contact_id, to_jsonb(v_lead), v_admin_email
  );

  WITH del AS (DELETE FROM journaling_respuestas WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('journaling_respuestas', v_count);

  WITH del AS (DELETE FROM ia_analisis WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('ia_analisis', v_count);

  WITH del AS (DELETE FROM interacciones WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('interacciones', v_count);

  WITH del AS (DELETE FROM notificaciones_pendientes WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('notificaciones_pendientes', v_count);

  WITH del AS (DELETE FROM logros_cliente WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('logros_cliente', v_count);

  WITH del AS (DELETE FROM testimonios WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('testimonios', v_count);

  WITH del AS (DELETE FROM eventos_marketing WHERE lead_id = p_lead_id RETURNING 1)
    SELECT COUNT(*) INTO v_count FROM del;
  v_resumen := v_resumen || jsonb_build_object('eventos_marketing', v_count);

  WITH upd AS (
    UPDATE webhook_log SET lead_id = NULL WHERE lead_id = p_lead_id RETURNING 1
  )
    SELECT COUNT(*) INTO v_count FROM upd;
  v_resumen := v_resumen || jsonb_build_object('webhook_log_nulificados', v_count);

  -- FIX: no tocar auth.users si el email pertenece a un admin
  v_count := 0;
  v_es_admin := FALSE;
  IF v_lead.email IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM usuarios_admin WHERE email = v_lead.email)
      INTO v_es_admin;

    IF NOT v_es_admin THEN
      DELETE FROM auth.users WHERE email = v_lead.email;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;
  END IF;
  v_resumen := v_resumen || jsonb_build_object(
    'auth_users_borrados', v_count,
    'auth_users_preservado_por_ser_admin', v_es_admin
  );

  DELETE FROM leads WHERE id = p_lead_id;

  UPDATE cliente_eliminado_log
    SET resumen_cascada = v_resumen
    WHERE lead_id_original = p_lead_id
      AND eliminado_at = (
        SELECT MAX(eliminado_at) FROM cliente_eliminado_log WHERE lead_id_original = p_lead_id
      );

  RETURN jsonb_build_object(
    'ok', true,
    'lead_id', p_lead_id,
    'email_eliminado', v_lead.email,
    'nombre_eliminado', v_lead.nombre,
    'resumen', v_resumen
  );
END;
$function$;

-- ─── E. crear_calendario_cuotas: admin o moderador ───
-- (Cuerpo vivo de producción; único cambio: rol IN ('admin','moderador').)
CREATE OR REPLACE FUNCTION public.crear_calendario_cuotas(p_lead_id uuid, p_monto_total_usd numeric, p_n_cuotas integer, p_fecha_primer_pago date, p_frecuencia_dias integer DEFAULT 30, p_modalidad text DEFAULT NULL::text, p_closer_id uuid DEFAULT NULL::uuid, p_metodo text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_usuario_id uuid;
  v_finanzas_id uuid;
  v_monto_cuota numeric;
  v_modalidad text;
  v_i integer;
  v_fecha date;
BEGIN
  -- HARDENING 74: solo admin/moderador pueden crear cobranza (antes cualquier
  -- usuarios_admin activo, incluido rol 'lector').
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true
      AND rol IN ('admin','moderador');
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuario no autorizado');
  END IF;

  IF p_n_cuotas < 1 OR p_monto_total_usd <= 0 OR p_fecha_primer_pago IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Parámetros inválidos');
  END IF;

  -- ¿ya existen finanzas para este lead?
  SELECT id INTO v_finanzas_id FROM cliente_finanzas_programa WHERE lead_id = p_lead_id;
  IF v_finanzas_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este lead ya tiene calendario de pagos. Si necesitas modificarlo, edita pagos individualmente o pide ayuda a admin pleno.');
  END IF;

  v_monto_cuota := round(p_monto_total_usd / p_n_cuotas, 2);
  v_modalidad := COALESCE(p_modalidad,
    CASE WHEN p_n_cuotas = 1 THEN 'contado'
         WHEN p_n_cuotas <= 12 THEN 'cuotas_' || p_n_cuotas::text
         ELSE 'custom'
    END);

  -- Crear snapshot
  INSERT INTO cliente_finanzas_programa (
    lead_id, monto_total_usd, modalidad, cuotas_pactadas, monto_cuota_usd,
    frecuencia_dias, closer_id, metodo_pago_preferido, notas, congelado, created_by
  ) VALUES (
    p_lead_id, p_monto_total_usd, v_modalidad, p_n_cuotas, v_monto_cuota,
    p_frecuencia_dias, p_closer_id, p_metodo, p_notas, true, v_usuario_id
  ) RETURNING id INTO v_finanzas_id;

  -- Generar N filas de pagos pendientes
  v_fecha := p_fecha_primer_pago;
  FOR v_i IN 1..p_n_cuotas LOOP
    INSERT INTO pagos (
      lead_id, finanzas_id, numero_cuota, tipo, monto_usd, fecha_programada,
      estado, metodo_pago, registrado_por
    ) VALUES (
      p_lead_id, v_finanzas_id, v_i, 'cuota',
      CASE WHEN v_i = p_n_cuotas THEN p_monto_total_usd - (v_monto_cuota * (p_n_cuotas - 1))  -- ultima absorbe redondeo
           ELSE v_monto_cuota END,
      v_fecha, 'pendiente', p_metodo, v_usuario_id
    );
    v_fecha := v_fecha + (p_frecuencia_dias * INTERVAL '1 day');
  END LOOP;

  -- Sincronizar leads.monto_total_programa_usd si está NULL
  UPDATE leads
    SET monto_total_programa_usd = COALESCE(monto_total_programa_usd, p_monto_total_usd)
    WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'ok', true,
    'finanzas_id', v_finanzas_id,
    'cuotas_creadas', p_n_cuotas,
    'monto_cuota_usd', v_monto_cuota
  );
END $function$;

-- ─── E2. marcar_pago_pagado: admin o moderador ───
CREATE OR REPLACE FUNCTION public.marcar_pago_pagado(p_pago_id uuid, p_fecha_pagado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metodo text DEFAULT NULL::text, p_referencia text DEFAULT NULL::text, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pago record;
  v_usuario_id uuid;
BEGIN
  -- HARDENING 74: solo admin/moderador pueden registrar pagos.
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true
      AND rol IN ('admin','moderador');
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuario no autorizado');
  END IF;

  SELECT * INTO v_pago FROM pagos WHERE id = p_pago_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pago no encontrado');
  END IF;
  IF v_pago.estado = 'pagado' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este pago ya está marcado como pagado');
  END IF;
  IF v_pago.estado IN ('reembolsado','perdonado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No se puede marcar como pagado un pago ' || v_pago.estado);
  END IF;

  UPDATE pagos
    SET estado = 'pagado',
        fecha_pagado_at = COALESCE(p_fecha_pagado, now()),
        metodo_pago = COALESCE(p_metodo, metodo_pago),
        referencia_externa = COALESCE(p_referencia, referencia_externa),
        notas = COALESCE(p_notas, notas),
        registrado_por = v_usuario_id
    WHERE id = p_pago_id;

  RETURN jsonb_build_object('ok', true, 'pago_id', p_pago_id);
END $function$;

-- ─── F. resolver_alerta: admin o moderador ───
CREATE OR REPLACE FUNCTION public.resolver_alerta(p_alerta_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_admin_email TEXT;
  v_actualizado INT;
BEGIN
  v_admin_email := (auth.jwt() ->> 'email');
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Sesión sin email en JWT';
  END IF;
  -- HARDENING 74: lector no resuelve alertas.
  IF NOT EXISTS (
    SELECT 1 FROM usuarios_admin
    WHERE email = v_admin_email AND activo = true AND rol IN ('admin','moderador')
  ) THEN
    RAISE EXCEPTION 'Solo administradores o moderadores pueden resolver alertas';
  END IF;

  UPDATE alertas_log
    SET resuelto_at = NOW()
    WHERE id = p_alerta_id AND resuelto_at IS NULL;
  GET DIAGNOSTICS v_actualizado = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'actualizado', v_actualizado);
END;
$function$;

-- ─── G. dashboard_kpis_globales: sin EXECUTE para anon ───
REVOKE EXECUTE ON FUNCTION public.dashboard_kpis_globales() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_kpis_globales() TO authenticated, service_role;

-- ============================================================
-- POST-APLICACIÓN (manual):
--   1. Verificar que /admin/dashboards.html sigue cargando KPIs con un admin.
--   2. Verificar con la anon key que vw_dashboard_global devuelve 401/permission denied:
--      curl -s "https://eqyaddcidkywmedwscpu.supabase.co/rest/v1/vw_dashboard_global" \
--        -H "apikey: <ANON>" -H "Authorization: Bearer <ANON>"
--   3. Probar guardar una reflexión como cliente (upsert ya no es necesario,
--      pero el índice nuevo debe seguir bloqueando duplicados).
-- ============================================================
