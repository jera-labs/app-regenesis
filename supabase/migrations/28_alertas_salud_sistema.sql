-- ============================================================================
-- MIGRACIÓN 28: Alertas de salud del sistema
--
-- Objetivo: detectar automáticamente problemas como
--   - cron que dejó de correr
--   - webhooks fallando (>=500)
--   - clientes activos sin tema asignado (estado inconsistente)
--   - leads que pagaron hace >48h sin firmar ningún contrato
--
-- Aprendizaje: el cron falló silencioso 16 días por un check de admin
-- que rechazaba pg_cron sin JWT (ver migración 26). Nadie se enteró
-- hasta que un cliente reportó. Esta capa de monitoreo evita repetirlo.
-- ============================================================================

-- ---------- Tabla de alertas (auditoría histórica) ----------
CREATE TABLE IF NOT EXISTS alertas_log (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'cron_stale',
    'webhook_errors',
    'lead_sin_tema',
    'lead_sin_contratos',
    'edge_function_error',
    'manual'
  )),
  severidad TEXT NOT NULL CHECK (severidad IN ('info', 'warning', 'critical')),
  mensaje TEXT NOT NULL,
  detalle JSONB,
  resuelto_at TIMESTAMPTZ,
  notificacion_enviada_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alertas_log_tipo_unresolved
  ON alertas_log (tipo) WHERE resuelto_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alertas_log_created_desc
  ON alertas_log (created_at DESC);

ALTER TABLE alertas_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alertas_log_admin_all ON alertas_log;
CREATE POLICY alertas_log_admin_all ON alertas_log
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM usuarios_admin
            WHERE email = (auth.jwt() ->> 'email') AND activo = true)
  );

DROP POLICY IF EXISTS alertas_log_service ON alertas_log;
CREATE POLICY alertas_log_service ON alertas_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE alertas_log IS
  'Histórico de alertas de salud del sistema. Cada chequeo (verificar_salud_sistema) inserta filas aquí cuando detecta anomalías. La resolución es manual: poner resuelto_at = NOW().';

-- ---------- Función de chequeo ----------
CREATE OR REPLACE FUNCTION verificar_salud_sistema()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alertas JSONB := '[]'::JSONB;
  v_count INT;
  v_last_cron TIMESTAMPTZ;
  v_horas_desde_cron INT;
  v_now TIMESTAMPTZ := NOW();
  v_inicio TIMESTAMPTZ := clock_timestamp();
BEGIN
  -- ============================================================
  -- 1. CRON STALE: último cron exitoso > 26h atrás
  -- ============================================================
  SELECT MAX(ejecutado_at) INTO v_last_cron
  FROM cron_log
  WHERE error IS NULL
    AND job_name LIKE '%cron_diario%';

  IF v_last_cron IS NULL OR v_now - v_last_cron > INTERVAL '26 hours' THEN
    v_horas_desde_cron := COALESCE(
      EXTRACT(EPOCH FROM (v_now - v_last_cron))::INT / 3600,
      999
    );
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'cron_stale',
      'severidad', 'critical',
      'mensaje', format('El cron diario no corre exitoso desde hace %s horas. Última corrida OK: %s',
                        v_horas_desde_cron,
                        COALESCE(v_last_cron::TEXT, 'NUNCA')),
      'detalle', jsonb_build_object(
        'ultima_corrida_ok', v_last_cron,
        'horas_desde_ultima_corrida', v_horas_desde_cron
      )
    );
  END IF;

  -- ============================================================
  -- 2. WEBHOOKS CON ERROR: >=3 con http_status>=500 en últimas 24h
  -- ============================================================
  SELECT COUNT(*) INTO v_count
  FROM webhook_log
  WHERE http_status >= 500
    AND recibido_at >= v_now - INTERVAL '24 hours';

  IF v_count >= 3 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'webhook_errors',
      'severidad', 'warning',
      'mensaje', format('%s webhooks de GHL fallaron con status >=500 en las últimas 24h. Posible problema en webhook-ghl o webhook-firma.', v_count),
      'detalle', jsonb_build_object('errores_24h', v_count)
    );
  END IF;

  -- ============================================================
  -- 3. LEADS ACTIVOS SIN TEMA: estado=activo pero tema_actual_orden IS NULL
  --    (puede pasar si avanzar_lead_diario falla para ese lead)
  -- ============================================================
  SELECT COUNT(*) INTO v_count
  FROM leads
  WHERE estado = 'activo'
    AND tema_actual_orden IS NULL
    AND fecha_inicio_programa IS NOT NULL
    AND fecha_inicio_programa <= fecha_hoy();

  IF v_count > 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'lead_sin_tema',
      'severidad', 'warning',
      'mensaje', format('%s clientes activos sin tema_actual_orden asignado. Estado inconsistente.', v_count),
      'detalle', jsonb_build_object(
        'count', v_count,
        'leads', (
          SELECT jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'email', email))
          FROM leads
          WHERE estado = 'activo' AND tema_actual_orden IS NULL
            AND fecha_inicio_programa <= fecha_hoy()
        )
      )
    );
  END IF;

  -- ============================================================
  -- 4. LEADS QUE PAGARON HACE >48h SIN FIRMAR NINGÚN CONTRATO
  --    Bandera para que Frank haga seguimiento manual.
  -- ============================================================
  SELECT COUNT(*) INTO v_count
  FROM leads
  WHERE estado IN ('pagado_calentamiento', 'activo')
    AND fecha_pago IS NOT NULL
    AND fecha_pago < v_now - INTERVAL '48 hours'
    AND contrato_servicio_firmado_at IS NULL
    AND contrato_waiver_firmado_at IS NULL
    AND contrato_media_firmado_at IS NULL
    AND email NOT LIKE 'cliente.%@neurohackers.top'
    AND email != 'frank.demo@neurohackers.top';

  IF v_count > 0 THEN
    v_alertas := v_alertas || jsonb_build_object(
      'tipo', 'lead_sin_contratos',
      'severidad', 'info',
      'mensaje', format('%s clientes pagaron hace más de 48h pero no han firmado ningún contrato. Envíales el link de bienvenida.', v_count),
      'detalle', jsonb_build_object(
        'count', v_count,
        'leads', (
          SELECT jsonb_agg(jsonb_build_object(
            'id', id, 'nombre', nombre, 'email', email,
            'ghl_contact_id', ghl_contact_id,
            'horas_desde_pago', EXTRACT(EPOCH FROM (v_now - fecha_pago))::INT / 3600
          ))
          FROM leads
          WHERE estado IN ('pagado_calentamiento', 'activo')
            AND fecha_pago < v_now - INTERVAL '48 hours'
            AND contrato_servicio_firmado_at IS NULL
            AND contrato_waiver_firmado_at IS NULL
            AND contrato_media_firmado_at IS NULL
            AND email NOT LIKE 'cliente.%@neurohackers.top'
            AND email != 'frank.demo@neurohackers.top'
        )
      )
    );
  END IF;

  -- ============================================================
  -- Insertar las alertas detectadas en alertas_log
  -- (solo nuevas — evitamos duplicar la misma alerta del mismo tipo si
  -- ya hay una sin resolver de hace <12h)
  -- ============================================================
  IF jsonb_array_length(v_alertas) > 0 THEN
    INSERT INTO alertas_log (tipo, severidad, mensaje, detalle)
    SELECT
      a.value ->> 'tipo',
      a.value ->> 'severidad',
      a.value ->> 'mensaje',
      a.value -> 'detalle'
    FROM jsonb_array_elements(v_alertas) a
    WHERE NOT EXISTS (
      SELECT 1 FROM alertas_log
      WHERE tipo = (a.value ->> 'tipo')
        AND resuelto_at IS NULL
        AND created_at > v_now - INTERVAL '12 hours'
    );
  END IF;

  RETURN jsonb_build_object(
    'fecha', fecha_hoy(),
    'now', v_now,
    'alertas_detectadas', jsonb_array_length(v_alertas),
    'alertas', v_alertas,
    'duracion_ms', EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_inicio))::INT
  );
END;
$$;

REVOKE ALL ON FUNCTION verificar_salud_sistema() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION verificar_salud_sistema() TO authenticated, service_role;

COMMENT ON FUNCTION verificar_salud_sistema() IS
  'Chequea condiciones de error del sistema y registra alertas. Diseñada para ser invocada por pg_cron o Edge Function. Permite ejecución sin JWT (cron) o con JWT admin.';

-- ---------- Helper: marcar alerta como resuelta ----------
CREATE OR REPLACE FUNCTION resolver_alerta(p_alerta_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_email TEXT;
  v_actualizado INT;
BEGIN
  v_admin_email := (auth.jwt() ->> 'email');
  IF v_admin_email IS NULL THEN
    RAISE EXCEPTION 'Sesión sin email en JWT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios_admin WHERE email = v_admin_email AND activo = true) THEN
    RAISE EXCEPTION 'Solo administradores pueden resolver alertas';
  END IF;

  UPDATE alertas_log
    SET resuelto_at = NOW()
    WHERE id = p_alerta_id AND resuelto_at IS NULL;
  GET DIAGNOSTICS v_actualizado = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'actualizado', v_actualizado);
END;
$$;

GRANT EXECUTE ON FUNCTION resolver_alerta(BIGINT) TO authenticated;
