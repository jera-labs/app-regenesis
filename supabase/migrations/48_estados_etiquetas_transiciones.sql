-- ============================================================================
-- Migración 48: Estados comerciales + Etiquetas + Máquina de transiciones
--
-- 4 tablas nuevas + 2 funciones SECURITY DEFINER + seed completo.
--
-- DISEÑO:
-- - lead_estado_comercial es la "fila viva" (1:1 con leads).
-- - lead_estado_historial es append-only para timeline.
-- - catalogo_transiciones_estado declara qué transiciones son legales y quién
--   las puede ejecutar. Cambiar reglas = editar tabla, no código.
-- - etiquetas_catalogo + lead_etiquetas: many-to-many. Catálogo configurable.
-- - aplicar_transicion_estado() es atómica: valida + escribe nuevo estado +
--   guarda historial + dispara side effects (churn_at, caso_exito_at,
--   fecha_activacion_programa, etc.) en una sola transacción.
--
-- INDEPENDENCIA: NO toca leads.estado (que sigue siendo el ciclo terapéutico
-- de Re-Génesis). Crea un eje paralelo "comercial" que el equipo usa para
-- pipeline y reportes.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. lead_estado_comercial · estado vigente (1:1)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_estado_comercial (
  lead_id uuid PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  estado text NOT NULL,
  sub_estado text,
  desde timestamptz NOT NULL DEFAULT now(),
  cambiado_por uuid REFERENCES usuarios_admin(id),
  motivo text,
  notas text,
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_estado_comercial_estado_idx ON lead_estado_comercial(estado);
CREATE INDEX IF NOT EXISTS lead_estado_comercial_desde_idx ON lead_estado_comercial(desde);

COMMENT ON TABLE lead_estado_comercial IS 'Estado comercial vigente del cliente (independiente de leads.estado terapéutico). 1:1 con leads.';

-- ============================================================================
-- 2. lead_estado_historial · append-only para timeline
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_estado_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  estado_desde text,
  estado_hacia text NOT NULL,
  sub_estado_hacia text,
  cambiado_por uuid REFERENCES usuarios_admin(id),
  cambiado_at timestamptz NOT NULL DEFAULT now(),
  motivo text,
  notas text,
  metadata jsonb DEFAULT '{}'::jsonb,
  origen text DEFAULT 'manual' -- manual | automatico | webhook
);

CREATE INDEX IF NOT EXISTS lead_estado_historial_lead_id_idx ON lead_estado_historial(lead_id, cambiado_at DESC);

COMMENT ON TABLE lead_estado_historial IS 'Línea de tiempo append-only de cambios de estado. Una fila por cada transición.';

-- ============================================================================
-- 3. catalogo_transiciones_estado · matriz declarativa de transiciones legales
-- ============================================================================
CREATE TABLE IF NOT EXISTS catalogo_transiciones_estado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estado_desde text NOT NULL,
  estado_hacia text NOT NULL,
  permitido_por_roles text[] NOT NULL DEFAULT ARRAY['admin']::text[],
  requiere_motivo boolean DEFAULT false,
  requiere_categoria_churn boolean DEFAULT false,
  side_effects jsonb DEFAULT '{}'::jsonb,
  activa boolean DEFAULT true,
  descripcion text,
  orden_display integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (estado_desde, estado_hacia)
);

CREATE INDEX IF NOT EXISTS catalogo_transiciones_desde_idx ON catalogo_transiciones_estado(estado_desde) WHERE activa = true;

COMMENT ON TABLE catalogo_transiciones_estado IS 'Matriz declarativa. side_effects.set_caso_exito_at=true marca fecha. side_effects.set_churn_at=true marca churn. side_effects.set_fecha_activacion=true.';

-- ============================================================================
-- 4. etiquetas_catalogo · catálogo configurable de etiquetas
-- ============================================================================
CREATE TABLE IF NOT EXISTS etiquetas_catalogo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  categoria text DEFAULT 'general',
  color text DEFAULT '#86868B',
  icono text DEFAULT '◇',
  visible_cliente boolean DEFAULT false,
  exclusividad_grupo text,
  evento_disparador text,
  activa boolean DEFAULT true,
  orden integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT etiquetas_slug_format CHECK (slug ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS etiquetas_catalogo_activa_idx ON etiquetas_catalogo(activa) WHERE activa = true;
CREATE INDEX IF NOT EXISTS etiquetas_catalogo_categoria_idx ON etiquetas_catalogo(categoria);

COMMENT ON TABLE etiquetas_catalogo IS 'Catálogo de etiquetas. exclusividad_grupo: si dos etiquetas del mismo grupo se aplican, la nueva reemplaza la anterior.';

-- ============================================================================
-- 5. lead_etiquetas · relacional many-to-many
-- ============================================================================
CREATE TABLE IF NOT EXISTS lead_etiquetas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  etiqueta_id uuid NOT NULL REFERENCES etiquetas_catalogo(id) ON DELETE CASCADE,
  aplicada_at timestamptz NOT NULL DEFAULT now(),
  aplicada_por uuid REFERENCES usuarios_admin(id),
  origen text DEFAULT 'manual',
  vence_at timestamptz,
  notas text,
  UNIQUE (lead_id, etiqueta_id)
);

CREATE INDEX IF NOT EXISTS lead_etiquetas_lead_id_idx ON lead_etiquetas(lead_id);
CREATE INDEX IF NOT EXISTS lead_etiquetas_etiqueta_id_idx ON lead_etiquetas(etiqueta_id);

COMMENT ON TABLE lead_etiquetas IS 'Etiquetas aplicadas a cada lead. UNIQUE evita duplicados. vence_at permite expiración automática.';

-- ============================================================================
-- FUNCIÓN · puede_cambiar_estado(lead_id, estado_hacia, usuario_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION puede_cambiar_estado(
  p_lead_id uuid,
  p_estado_hacia text,
  p_usuario_admin_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estado_actual text;
  v_transicion record;
  v_rol_usuario text;
BEGIN
  SELECT estado INTO v_estado_actual FROM lead_estado_comercial WHERE lead_id = p_lead_id;
  IF v_estado_actual IS NULL THEN
    v_estado_actual := 'onboarding_pendiente';
  END IF;

  IF v_estado_actual = p_estado_hacia THEN
    RETURN jsonb_build_object('puede', false, 'razon', 'Ya está en ese estado');
  END IF;

  SELECT * INTO v_transicion FROM catalogo_transiciones_estado
    WHERE estado_desde = v_estado_actual AND estado_hacia = p_estado_hacia AND activa = true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('puede', false, 'razon', 'Transición no permitida', 'desde', v_estado_actual, 'hacia', p_estado_hacia);
  END IF;

  IF p_usuario_admin_id IS NOT NULL THEN
    SELECT rol INTO v_rol_usuario FROM usuarios_admin WHERE id = p_usuario_admin_id AND activo = true;
  ELSE
    SELECT rol INTO v_rol_usuario FROM usuarios_admin
      WHERE email = auth.jwt() ->> 'email' AND activo = true;
  END IF;

  IF v_rol_usuario IS NULL THEN
    RETURN jsonb_build_object('puede', false, 'razon', 'Usuario no autorizado');
  END IF;

  IF NOT (v_rol_usuario = ANY(v_transicion.permitido_por_roles)) THEN
    RETURN jsonb_build_object('puede', false, 'razon', 'Tu rol (' || v_rol_usuario || ') no puede ejecutar esta transición', 'roles_permitidos', v_transicion.permitido_por_roles);
  END IF;

  RETURN jsonb_build_object(
    'puede', true,
    'desde', v_estado_actual,
    'hacia', p_estado_hacia,
    'requiere_motivo', v_transicion.requiere_motivo,
    'requiere_categoria_churn', v_transicion.requiere_categoria_churn,
    'side_effects', v_transicion.side_effects
  );
END $$;

COMMENT ON FUNCTION puede_cambiar_estado IS 'Verifica si una transición de estado es legal y si el usuario tiene rol para ejecutarla.';

-- ============================================================================
-- FUNCIÓN · aplicar_transicion_estado() · atómica
-- ============================================================================
CREATE OR REPLACE FUNCTION aplicar_transicion_estado(
  p_lead_id uuid,
  p_estado_hacia text,
  p_motivo text DEFAULT NULL,
  p_categoria_churn text DEFAULT NULL,
  p_sub_estado text DEFAULT NULL,
  p_notas text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_check jsonb;
  v_usuario_id uuid;
  v_estado_actual text;
  v_side_effects jsonb;
  v_now timestamptz := now();
  v_razones_validas jsonb;
BEGIN
  SELECT id INTO v_usuario_id FROM usuarios_admin
    WHERE email = auth.jwt() ->> 'email' AND activo = true;
  IF v_usuario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuario no autorizado');
  END IF;

  v_check := puede_cambiar_estado(p_lead_id, p_estado_hacia, v_usuario_id);
  IF NOT (v_check->>'puede')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', v_check->>'razon', 'detalle', v_check);
  END IF;

  IF (v_check->>'requiere_motivo')::boolean AND (p_motivo IS NULL OR length(trim(p_motivo)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta transición requiere un motivo');
  END IF;

  IF (v_check->>'requiere_categoria_churn')::boolean THEN
    SELECT razones_churn INTO v_razones_validas FROM config_automatizaciones WHERE id = 1;
    IF p_categoria_churn IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Esta transición requiere categoría de churn', 'opciones', v_razones_validas);
    END IF;
    IF NOT (v_razones_validas ? p_categoria_churn) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Categoría de churn inválida: ' || p_categoria_churn, 'opciones', v_razones_validas);
    END IF;
  END IF;

  v_estado_actual := v_check->>'desde';
  v_side_effects := v_check->'side_effects';

  INSERT INTO lead_estado_comercial (lead_id, estado, sub_estado, desde, cambiado_por, motivo, notas, updated_at)
  VALUES (p_lead_id, p_estado_hacia, p_sub_estado, v_now, v_usuario_id, p_motivo, p_notas, v_now)
  ON CONFLICT (lead_id) DO UPDATE
    SET estado = EXCLUDED.estado,
        sub_estado = EXCLUDED.sub_estado,
        desde = EXCLUDED.desde,
        cambiado_por = EXCLUDED.cambiado_por,
        motivo = EXCLUDED.motivo,
        notas = EXCLUDED.notas,
        updated_at = EXCLUDED.updated_at;

  INSERT INTO lead_estado_historial (lead_id, estado_desde, estado_hacia, sub_estado_hacia, cambiado_por, cambiado_at, motivo, notas, origen)
  VALUES (p_lead_id, v_estado_actual, p_estado_hacia, p_sub_estado, v_usuario_id, v_now, p_motivo, p_notas, 'manual');

  -- Side effects sobre leads (set_*)
  IF (v_side_effects->>'set_fecha_activacion')::boolean THEN
    UPDATE leads
      SET fecha_activacion_programa = COALESCE(fecha_activacion_programa, v_now::date),
          fecha_fin_contractual = COALESCE(fecha_fin_contractual,
                                           (v_now::date + COALESCE(duracion_contractual_dias, 70) * INTERVAL '1 day')::date)
      WHERE id = p_lead_id;
  END IF;

  IF (v_side_effects->>'set_launched_at')::boolean THEN
    UPDATE leads SET launched_at = COALESCE(launched_at, v_now) WHERE id = p_lead_id;
  END IF;

  IF (v_side_effects->>'set_caso_exito_at')::boolean THEN
    UPDATE leads SET caso_exito_at = COALESCE(caso_exito_at, v_now) WHERE id = p_lead_id;
  END IF;

  IF (v_side_effects->>'set_churn_at')::boolean THEN
    UPDATE leads
      SET churn_at = COALESCE(churn_at, v_now),
          churn_motivo = COALESCE(p_motivo, churn_motivo),
          churn_categoria = COALESCE(p_categoria_churn, churn_categoria)
      WHERE id = p_lead_id;
  END IF;

  IF (v_side_effects->>'reset_churn')::boolean THEN
    UPDATE leads SET churn_at = NULL, churn_motivo = NULL, churn_categoria = NULL WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'estado_desde', v_estado_actual,
    'estado_hacia', p_estado_hacia,
    'cambiado_at', v_now,
    'side_effects_aplicados', v_side_effects
  );
END $$;

COMMENT ON FUNCTION aplicar_transicion_estado IS 'Aplica una transición de estado de manera atómica con validación + side effects.';

-- ============================================================================
-- RLS
-- ============================================================================
ALTER TABLE lead_estado_comercial ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_estado_historial ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogo_transiciones_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE etiquetas_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_etiquetas ENABLE ROW LEVEL SECURITY;

-- lead_estado_comercial: equipo (admin/moderador/lector según asignación), cliente lee el suyo
DROP POLICY IF EXISTS lec_cliente_select ON lead_estado_comercial;
CREATE POLICY lec_cliente_select ON lead_estado_comercial FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS lec_equipo_all ON lead_estado_comercial;
CREATE POLICY lec_equipo_all ON lead_estado_comercial FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- lead_estado_historial: equipo SELECT, escritura solo vía función (service role bypassa RLS)
DROP POLICY IF EXISTS leh_equipo_select ON lead_estado_historial;
CREATE POLICY leh_equipo_select ON lead_estado_historial FOR SELECT TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  );

DROP POLICY IF EXISTS leh_cliente_select ON lead_estado_historial;
CREATE POLICY leh_cliente_select ON lead_estado_historial FOR SELECT TO authenticated
  USING (lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email'));

-- catalogo_transiciones_estado: lectura abierta, escritura admin pleno
DROP POLICY IF EXISTS cte_select ON catalogo_transiciones_estado;
CREATE POLICY cte_select ON catalogo_transiciones_estado FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cte_admin ON catalogo_transiciones_estado;
CREATE POLICY cte_admin ON catalogo_transiciones_estado FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- etiquetas_catalogo: lectura abierta, escritura admin pleno
DROP POLICY IF EXISTS ec_select ON etiquetas_catalogo;
CREATE POLICY ec_select ON etiquetas_catalogo FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS ec_admin ON etiquetas_catalogo;
CREATE POLICY ec_admin ON etiquetas_catalogo FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin') WITH CHECK (mi_rol_admin() = 'admin');

-- lead_etiquetas: cliente lee SOLO las visibles_cliente=true suyas; equipo ve todas las de sus asignados
DROP POLICY IF EXISTS le_cliente_select ON lead_etiquetas;
CREATE POLICY le_cliente_select ON lead_etiquetas FOR SELECT TO authenticated
  USING (
    lead_id IN (SELECT id FROM leads WHERE email = auth.jwt() ->> 'email')
    AND etiqueta_id IN (SELECT id FROM etiquetas_catalogo WHERE visible_cliente = true)
  );

DROP POLICY IF EXISTS le_equipo_all ON lead_etiquetas;
CREATE POLICY le_equipo_all ON lead_etiquetas FOR ALL TO authenticated
  USING (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() IN ('moderador','lector') AND lead_id IN (SELECT mis_leads_asignados()))
  )
  WITH CHECK (
    mi_rol_admin() = 'admin'
    OR (mi_rol_admin() = 'moderador' AND lead_id IN (SELECT mis_leads_asignados()))
  );

-- ============================================================================
-- TRIGGERS de auditoría updated_at
-- ============================================================================
DROP TRIGGER IF EXISTS lec_touch ON lead_estado_comercial;
CREATE TRIGGER lec_touch BEFORE UPDATE ON lead_estado_comercial
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS ec_touch ON etiquetas_catalogo;
CREATE TRIGGER ec_touch BEFORE UPDATE ON etiquetas_catalogo
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
-- SEED · 14 estados + 28 transiciones + 10 etiquetas
-- ============================================================================

-- Transiciones (matriz)
INSERT INTO catalogo_transiciones_estado (estado_desde, estado_hacia, permitido_por_roles, requiere_motivo, requiere_categoria_churn, side_effects, descripcion, orden_display) VALUES
-- Desde onboarding_pendiente
('onboarding_pendiente', 'activo',                ARRAY['admin','moderador'], false, false, '{"set_fecha_activacion": true}'::jsonb, 'Cliente arranca el programa formal', 1),
('onboarding_pendiente', 'pausa',                 ARRAY['admin'],             true,  false, '{}'::jsonb, 'Pausar antes de empezar (caso especial)', 2),
('onboarding_pendiente', 'reembolso_solicitado',  ARRAY['admin'],             true,  false, '{}'::jsonb, 'Cliente pide reembolso antes de empezar', 3),

-- Desde activo
('activo', 'activo_cuota_impaga',                 ARRAY['admin','moderador'], false, false, '{}'::jsonb, 'Detectada cuota vencida', 1),
('activo', 'caso_exito',                          ARRAY['admin'],             true,  false, '{"set_caso_exito_at": true}'::jsonb, 'Cumple promesa del programa', 2),
('activo', 'pausa',                               ARRAY['admin'],             true,  false, '{}'::jsonb, 'Pausa temporal (vacaciones, salud, etc.)', 3),
('activo', 'extension',                           ARRAY['admin'],             true,  false, '{}'::jsonb, 'Extender plazo del programa', 4),
('activo', 'fin_de_plazo',                        ARRAY['admin','moderador'], false, false, '{}'::jsonb, 'Cumplió contractual sin caso éxito', 5),
('activo', 'cancela_impago',                      ARRAY['admin'],             true,  true,  '{"set_churn_at": true}'::jsonb, 'Cliente cancela por no pagar', 6),
('activo', 'reembolso_solicitado',                ARRAY['admin'],             true,  false, '{}'::jsonb, 'Cliente pide reembolso', 7),
('activo', 'inactivo',                            ARRAY['admin'],             true,  true,  '{"set_churn_at": true}'::jsonb, 'Salida directa', 8),

-- Desde activo_cuota_impaga
('activo_cuota_impaga', 'activo',                 ARRAY['admin','moderador'], false, false, '{}'::jsonb, 'Cliente regulariza pago', 1),
('activo_cuota_impaga', 'cancela_impago',         ARRAY['admin'],             true,  true,  '{"set_churn_at": true}'::jsonb, 'No regulariza, se va', 2),
('activo_cuota_impaga', 'pausa',                  ARRAY['admin'],             true,  false, '{}'::jsonb, 'Acuerdo de pausa por dificultad financiera', 3),

-- Desde caso_exito
('caso_exito', 'fin_caso_exito_con_upsell',       ARRAY['admin'],             false, false, '{}'::jsonb, 'Termina y compra siguiente programa', 1),
('caso_exito', 'fin_caso_exito_sin_upsell',       ARRAY['admin'],             false, false, '{}'::jsonb, 'Termina sin renovar', 2),
('caso_exito', 'renovacion_paga',                 ARRAY['admin'],             false, false, '{}'::jsonb, 'Renueva el mismo programa', 3),

-- Desde extension
('extension', 'activo',                           ARRAY['admin'],             false, false, '{}'::jsonb, 'Retoma curso normal', 1),
('extension', 'fin_de_plazo',                     ARRAY['admin'],             false, false, '{}'::jsonb, 'Termina la extensión sin renovación', 2),
('extension', 'caso_exito',                       ARRAY['admin'],             true,  false, '{"set_caso_exito_at": true}'::jsonb, 'Logra durante extensión', 3),

-- Desde pausa
('pausa', 'activo',                               ARRAY['admin','moderador'], false, false, '{"reset_churn": true}'::jsonb, 'Retoma programa', 1),
('pausa', 'inactivo',                             ARRAY['admin'],             true,  true,  '{"set_churn_at": true}'::jsonb, 'No retoma, se va', 2),

-- Desde reembolso_solicitado
('reembolso_solicitado', 'reembolso_efectuado',   ARRAY['admin'],             false, true,  '{"set_churn_at": true}'::jsonb, 'Se ejecuta el reembolso', 1),
('reembolso_solicitado', 'activo',                ARRAY['admin'],             true,  false, '{"reset_churn": true}'::jsonb, 'Retira solicitud, sigue', 2),

-- Desde fin_de_plazo
('fin_de_plazo', 'renovacion_paga',               ARRAY['admin'],             false, false, '{"reset_churn": true}'::jsonb, 'Cliente renueva', 1),
('fin_de_plazo', 'inactivo',                      ARRAY['admin'],             false, false, '{"set_churn_at": true}'::jsonb, 'No renueva', 2),

-- Desde renovacion_paga
('renovacion_paga', 'activo',                     ARRAY['admin'],             false, false, '{}'::jsonb, 'Arranca el nuevo ciclo', 1),

-- Desde fin_caso_exito_con_upsell
('fin_caso_exito_con_upsell', 'activo',           ARRAY['admin'],             false, false, '{}'::jsonb, 'Arranca el siguiente programa', 1),

-- Desde fin_caso_exito_sin_upsell, cancela_impago, reembolso_efectuado, inactivo: terminales (no salen)
('inactivo', 'activo',                            ARRAY['admin'],             true,  false, '{"reset_churn": true}'::jsonb, 'Reactivación manual (caso especial)', 1)
ON CONFLICT (estado_desde, estado_hacia) DO NOTHING;

-- Etiquetas seed
INSERT INTO etiquetas_catalogo (slug, nombre, descripcion, categoria, color, icono, visible_cliente, exclusividad_grupo, evento_disparador, orden) VALUES
('referido',                'Referido',                'Vino por un cliente actual', 'origen',      '#34A853', '◈', false, NULL, NULL, 10),
('agendo_primera_llamada',  'Agendó primera llamada',  'Ya agendó su primera sesión 1:1', 'hito', '#D4AF37', '◐', false, NULL, NULL, 20),
('primera_venta',           'Primera venta',           'Registró su primera venta en programa', 'hito', '#34A853', '$', false, NULL, NULL, 30),
('post_exito_publicado',    'Post de éxito publicado', 'Compartió su resultado públicamente', 'marketing', '#1D1D1F', '◉', false, NULL, NULL, 40),
('potencial_caso_exito',    'Potencial caso de éxito', 'Va camino a cumplir promesa', 'oportunidad', '#D4AF37', '⭐', false, NULL, NULL, 50),
('referidor_exitoso',       'Referidor exitoso',       'Trajo al menos un cliente nuevo', 'oportunidad', '#34A853', '↗', false, NULL, NULL, 60),
('vip',                     'VIP',                     'Cliente prioritario', 'especial', '#D4AF37', '⭐', true,  NULL, NULL, 5),
('desvincular',             'Desvincular',             'Alcanzó tope de sesiones, evaluar salida', 'alerta', '#EF4444', '!', false, 'salud_cliente', NULL, 100),
('no_contactar',            'No contactar',            'No contactar por ahora', 'alerta', '#EF4444', '⊘', false, NULL, NULL, 110),
('riesgo_churn',            'Riesgo de churn',         'Señales de salida próxima', 'alerta', '#FF9500', '⚠', false, NULL, NULL, 90)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- BACKFILL · crear lead_estado_comercial para los leads existentes
-- ============================================================================
-- Mapeo desde leads.estado a estado comercial inicial
INSERT INTO lead_estado_comercial (lead_id, estado, desde, motivo, metadata)
SELECT
  id,
  CASE
    WHEN estado = 'activo' THEN 'activo'
    WHEN estado = 'pagado_calentamiento' THEN 'onboarding_pendiente'
    WHEN estado = 'pausa' THEN 'pausa'
    WHEN estado = 'completado' THEN 'fin_de_plazo'
    WHEN estado = 'reembolso' THEN 'reembolso_efectuado'
    WHEN estado = 'perdido' THEN 'inactivo'
    ELSE 'onboarding_pendiente'
  END,
  COALESCE(fecha_pago, created_at),
  'Backfill desde migración 48',
  jsonb_build_object('backfill', true, 'estado_terapeutico_origen', estado)
FROM leads
WHERE estado != 'perdido' OR estado IS NULL
ON CONFLICT (lead_id) DO NOTHING;

-- Mismos registros al historial (un solo evento inicial)
INSERT INTO lead_estado_historial (lead_id, estado_desde, estado_hacia, cambiado_at, motivo, origen, metadata)
SELECT
  lead_id,
  NULL,
  estado,
  desde,
  'Backfill desde migración 48',
  'automatico',
  jsonb_build_object('backfill', true)
FROM lead_estado_comercial
ON CONFLICT DO NOTHING;

COMMIT;
