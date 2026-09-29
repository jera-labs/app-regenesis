-- ============================================================================
-- Migración 51: Pagos + Cuotas + Snapshot financiero del deal (Fase 3)
--
-- DOS TABLAS NUEVAS:
-- 1) cliente_finanzas_programa: snapshot inmutable de la negociación del deal
--    con Neurohackers (monto total, modalidad de pago, cuotas pactadas, closer).
--    1:1 con leads. No se edita después de crearse (auditoría).
-- 2) pagos: calendario real de cobranza. Una fila por cuota proyectada
--    al firmar. Estado pendiente -> pagado / atrasado / perdonado / reembolsado.
--    También soporta upsells y extensiones como pagos tipo distinto.
--
-- FUNCIONES SECURITY DEFINER (atómicas):
-- - crear_calendario_cuotas(lead_id, monto_total, n_cuotas, fecha_primer_pago, frecuencia_dias)
-- - marcar_pago_pagado(pago_id, fecha_pagado, metodo, referencia)
-- - cancelar_cuotas_pendientes(lead_id, motivo, accion)
-- - marcar_pagos_atrasados()  (helper para cron futuro)
--
-- TRIGGER:
-- - AFTER UPDATE pagos: si cambia a 'pagado', recalcular leads.precio_pagado
--
-- INDEPENDENCIA: 100% aditivo. No toca webhooks Re-Génesis. No toca el cron
-- existente. Las edge functions de pagos se conectan a futuro (fase 3.5).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. cliente_finanzas_programa (snapshot inmutable del deal)
-- ============================================================================
CREATE TABLE IF NOT EXISTS cliente_finanzas_programa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid UNIQUE NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  monto_total_usd numeric(12,2) NOT NULL,
  moneda text DEFAULT 'USD',
  modalidad text NOT NULL,                       -- contado | cuotas_2 | cuotas_3 | cuotas_4 | cuotas_6 | cuotas_12 | custom
  cuotas_pactadas integer NOT NULL DEFAULT 1,
  monto_cuota_usd numeric(12,2),
  frecuencia_dias integer DEFAULT 30,
  descuento_aplicado_usd numeric(12,2) DEFAULT 0,
  motivo_descuento text,
  closer_id uuid REFERENCES usuarios_admin(id),
  metodo_pago_preferido text,                    -- stripe_ghl | wise | crypto | transferencia | efectivo | otro
  notas text,
  congelado boolean DEFAULT true,                -- una vez true, no se permite editar (excepto admin pleno)
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES usuarios_admin(id),
  CONSTRAINT cfp_monto_positivo CHECK (monto_total_usd > 0),
  CONSTRAINT cfp_cuotas_positivo CHECK (cuotas_pactadas > 0)
);

CREATE INDEX IF NOT EXISTS cfp_lead_id_idx ON cliente_finanzas_programa(lead_id);
CREATE INDEX IF NOT EXISTS cfp_closer_id_idx ON cliente_finanzas_programa(closer_id);

COMMENT ON TABLE cliente_finanzas_programa IS 'Snapshot inmutable del deal financiero con Neurohackers. 1:1 con lead. Una vez congelado no se edita.';

-- ============================================================================
-- 2. pagos (calendario real + ejecución)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pagos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  finanzas_id uuid REFERENCES cliente_finanzas_programa(id) ON DELETE SET NULL,
  numero_cuota integer,                          -- 1, 2, 3... NULL para upsells/extensiones
  tipo text NOT NULL DEFAULT 'cuota',            -- cuota | upsell | extension | ajuste
  monto_usd numeric(12,2) NOT NULL,
  fecha_programada date,
  estado text NOT NULL DEFAULT 'pendiente',      -- pendiente | pagado | atrasado | perdonado | reembolsado
  fecha_pagado_at timestamptz,
  metodo_pago text,
  referencia_externa text,                       -- invoice_id, transaction_id, etc.
  notas text,
  metadata jsonb DEFAULT '{}'::jsonb,
  registrado_por uuid REFERENCES usuarios_admin(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT pagos_monto_positivo CHECK (monto_usd > 0),
  CONSTRAINT pagos_estado_valido CHECK (estado IN ('pendiente','pagado','atrasado','perdonado','reembolsado')),
  CONSTRAINT pagos_tipo_valido CHECK (tipo IN ('cuota','upsell','extension','ajuste'))
);

CREATE INDEX IF NOT EXISTS pagos_lead_id_idx ON pagos(lead_id);
CREATE INDEX IF NOT EXISTS pagos_estado_idx ON pagos(estado);
CREATE INDEX IF NOT EXISTS pagos_fecha_programada_idx ON pagos(fecha_programada) WHERE estado = 'pendiente';

COMMENT ON TABLE pagos IS 'Calendario real de pagos del cliente. Una fila por cuota proyectada al firmar + upsells/ajustes/extensiones. Triggers actualizan leads.precio_pagado.';

-- ============================================================================
-- TRIGGER: sincronizar leads.precio_pagado con SUM(pagos pagados)
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_precio_pagado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lead_id uuid;
  v_total numeric;
BEGIN
  v_lead_id := COALESCE(NEW.lead_id, OLD.lead_id);
  SELECT COALESCE(SUM(monto_usd), 0) INTO v_total
  FROM pagos WHERE lead_id = v_lead_id AND estado = 'pagado';
  UPDATE leads SET precio_pagado = v_total WHERE id = v_lead_id;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS pagos_sync_precio ON pagos;
CREATE TRIGGER pagos_sync_precio
  AFTER INSERT OR UPDATE OF estado, monto_usd OR DELETE
  ON pagos FOR EACH ROW EXECUTE FUNCTION sync_precio_pagado();

-- ============================================================================
-- TRIGGER: touch updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS pagos_touch ON pagos;
CREATE TRIGGER pagos_touch BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- FUNCIÓN: crear_calendario_cuotas
-- ============================================================================
CREATE OR REPLACE FUNCTION crear_calendario_cuotas(
  p_lead_id uuid,
  p_monto_total_usd numeric,
  p_n_cuotas integer,
  p_fecha_primer_pago date,
  p_frecuencia_dias integer DEFAULT 30,
  p_modalidad text DEFAULT NULL,
  p_closer_id uuid DEFAULT NULL,
  p_metodo text DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
  v_finanzas_id uuid;
  v_monto_cuota numeric;
  v_modalidad text;
  v_i integer;
  v_fecha date;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true;
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
END $$;

COMMENT ON FUNCTION crear_calendario_cuotas IS 'Crea snapshot + N filas de pagos pendientes para un cliente. Idempotente: rechaza si ya existe finanzas.';

-- ============================================================================
-- FUNCIÓN: marcar_pago_pagado
-- ============================================================================
CREATE OR REPLACE FUNCTION marcar_pago_pagado(
  p_pago_id uuid,
  p_fecha_pagado timestamptz DEFAULT NULL,
  p_metodo text DEFAULT NULL,
  p_referencia text DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pago record;
  v_usuario_id uuid;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true;
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
END $$;

-- ============================================================================
-- FUNCIÓN: cancelar_cuotas_pendientes
-- ============================================================================
CREATE OR REPLACE FUNCTION cancelar_cuotas_pendientes(
  p_lead_id uuid,
  p_accion text,                                   -- 'perdonado' | 'reembolsado'
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_usuario_id uuid;
  v_count integer;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin';
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo admin pleno puede cancelar cuotas masivamente');
  END IF;

  IF p_accion NOT IN ('perdonado','reembolsado') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acción inválida');
  END IF;

  UPDATE pagos
    SET estado = p_accion,
        notas = COALESCE(notas || E'\n', '') || 'Cancelado: ' || COALESCE(p_motivo, '(sin motivo)') || ' [' || v_usuario_id::text || ']'
    WHERE lead_id = p_lead_id AND estado IN ('pendiente','atrasado');

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'cuotas_afectadas', v_count, 'accion', p_accion);
END $$;

-- ============================================================================
-- FUNCIÓN: marcar_pagos_atrasados (helper para cron futuro)
-- ============================================================================
CREATE OR REPLACE FUNCTION marcar_pagos_atrasados() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dias_gracia integer;
  v_count integer;
BEGIN
  SELECT COALESCE(dias_gracia_cuota_impaga, 7) INTO v_dias_gracia
    FROM config_automatizaciones WHERE id = 1;

  UPDATE pagos
    SET estado = 'atrasado'
    WHERE estado = 'pendiente'
      AND fecha_programada IS NOT NULL
      AND fecha_programada < (current_date - v_dias_gracia * INTERVAL '1 day')::date;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE cliente_finanzas_programa ENABLE ROW LEVEL SECURITY;
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;

-- cliente_finanzas_programa: cliente lee el suyo. Equipo asignado lee. Admin pleno todo.
DROP POLICY IF EXISTS cfp_cliente_select ON cliente_finanzas_programa;
CREATE POLICY cfp_cliente_select ON cliente_finanzas_programa FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS cfp_equipo_all ON cliente_finanzas_programa;
CREATE POLICY cfp_equipo_all ON cliente_finanzas_programa FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (mi_rol_admin() = 'admin');

-- pagos: cliente lee los suyos. Equipo asignado lee/escribe. Admin pleno todo.
DROP POLICY IF EXISTS pagos_cliente_select ON pagos;
CREATE POLICY pagos_cliente_select ON pagos FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS pagos_equipo_all ON pagos;
CREATE POLICY pagos_equipo_all ON pagos FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

COMMIT;
