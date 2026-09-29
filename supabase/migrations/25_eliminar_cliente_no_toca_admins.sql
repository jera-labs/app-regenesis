-- ============================================================================
-- MIGRACIÓN 25: eliminar_cliente_completo NO toca auth.users si es admin
--
-- Fix de bug: la versión anterior borraba auth.users por email sin verificar
-- si ese mismo email estaba en usuarios_admin. Si un admin tenía doble rol
-- (lead + admin), borrar el lead también lo dejaba sin login al panel.
--
-- Cambio: antes de DELETE FROM auth.users, verifica si el email está en
-- usuarios_admin. Si está → preserva el auth.users (solo borra el lead).
-- ============================================================================

CREATE OR REPLACE FUNCTION eliminar_cliente_completo(p_lead_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
  IF NOT EXISTS (SELECT 1 FROM usuarios_admin WHERE email = v_admin_email) THEN
    RAISE EXCEPTION 'Solo administradores pueden eliminar clientes (caller: %)', v_admin_email;
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
$$;

COMMENT ON FUNCTION eliminar_cliente_completo(UUID) IS
  'Elimina un cliente y sus datos relacionados. Si el email del lead pertenece a un admin (doble rol), preserva su entrada en auth.users.';
