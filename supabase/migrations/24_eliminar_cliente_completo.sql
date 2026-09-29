-- ============================================================================
-- MIGRACIÓN 24: Eliminar cliente completo + auditoría
--
-- Crea:
--   1. Tabla `cliente_eliminado_log` con snapshot de cada cliente eliminado.
--   2. Función `eliminar_cliente_completo(p_lead_id)` que limpia en cascada:
--      - journaling_respuestas, ia_analisis, interacciones,
--        notificaciones_pendientes, logros_cliente, testimonios,
--        eventos_marketing → DELETE
--      - webhook_log → SET lead_id = NULL (preserva el evento histórico)
--      - auth.users → DELETE por email
--      - leads → DELETE final
--      Antes de borrar, guarda snapshot completo en cliente_eliminado_log.
--
-- Política: solo authenticated con email en usuarios_admin puede invocarla
-- (chequeo interno SECURITY DEFINER + auth.jwt()).
-- ============================================================================

-- ---------------------------------------------------------------
-- 1. Tabla de auditoría
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cliente_eliminado_log (
  id BIGSERIAL PRIMARY KEY,
  lead_id_original UUID NOT NULL,
  email TEXT,
  nombre TEXT,
  estado_al_eliminar TEXT,
  cohorte TEXT,
  fecha_pago_original TIMESTAMPTZ,
  precio_pagado_original NUMERIC,
  ghl_contact_id_original TEXT,
  datos_snapshot JSONB NOT NULL,
  resumen_cascada JSONB,
  eliminado_por TEXT NOT NULL,
  eliminado_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cliente_eliminado_log_email
  ON cliente_eliminado_log (email);
CREATE INDEX IF NOT EXISTS idx_cliente_eliminado_log_eliminado_at
  ON cliente_eliminado_log (eliminado_at DESC);

ALTER TABLE cliente_eliminado_log ENABLE ROW LEVEL SECURITY;

-- Solo admins ven el log
DROP POLICY IF EXISTS cliente_eliminado_log_admin_select ON cliente_eliminado_log;
CREATE POLICY cliente_eliminado_log_admin_select ON cliente_eliminado_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM usuarios_admin
      WHERE email = (auth.jwt() ->> 'email')
    )
  );

-- Service role puede todo
DROP POLICY IF EXISTS cliente_eliminado_log_service_all ON cliente_eliminado_log;
CREATE POLICY cliente_eliminado_log_service_all ON cliente_eliminado_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------
-- 2. Función principal
-- ---------------------------------------------------------------
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
BEGIN
  -- 0. Solo admins
  v_admin_email := (auth.jwt() ->> 'email');
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Sesión sin email en JWT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios_admin WHERE email = v_admin_email) THEN
    RAISE EXCEPTION 'Solo administradores pueden eliminar clientes (caller: %)', v_admin_email;
  END IF;

  -- 1. Snapshot del lead
  SELECT * INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead % no existe', p_lead_id;
  END IF;

  -- 2. Guardar en log de auditoría (snapshot completo antes de tocar nada)
  INSERT INTO cliente_eliminado_log (
    lead_id_original, email, nombre, estado_al_eliminar,
    cohorte, fecha_pago_original, precio_pagado_original,
    ghl_contact_id_original, datos_snapshot, eliminado_por
  ) VALUES (
    v_lead.id, v_lead.email, v_lead.nombre, v_lead.estado,
    v_lead.cohorte, v_lead.fecha_pago, v_lead.precio_pagado,
    v_lead.ghl_contact_id, to_jsonb(v_lead), v_admin_email
  );

  -- 3. Limpieza en cascada (cada tabla con su contador en el resumen)
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

  -- 4. webhook_log: preservar (sólo nulificar el lead_id)
  WITH upd AS (
    UPDATE webhook_log SET lead_id = NULL WHERE lead_id = p_lead_id RETURNING 1
  )
    SELECT COUNT(*) INTO v_count FROM upd;
  v_resumen := v_resumen || jsonb_build_object('webhook_log_nulificados', v_count);

  -- 5. auth.users por email (si existe)
  v_count := 0;
  IF v_lead.email IS NOT NULL THEN
    DELETE FROM auth.users WHERE email = v_lead.email;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  v_resumen := v_resumen || jsonb_build_object('auth_users_borrados', v_count);

  -- 6. El lead
  DELETE FROM leads WHERE id = p_lead_id;

  -- 7. Update del log con el resumen
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

REVOKE ALL ON FUNCTION eliminar_cliente_completo(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION eliminar_cliente_completo(UUID) TO authenticated;

COMMENT ON FUNCTION eliminar_cliente_completo(UUID) IS
  'Elimina un cliente y todos sus datos relacionados. Solo admins. Conserva webhook_log con lead_id=NULL y guarda snapshot en cliente_eliminado_log.';

COMMENT ON TABLE cliente_eliminado_log IS
  'Audit log de clientes eliminados. Cada fila tiene snapshot JSONB completo del lead al momento de eliminar.';
