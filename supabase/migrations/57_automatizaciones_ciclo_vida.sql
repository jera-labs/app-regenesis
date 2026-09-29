-- ============================================================================
-- Migración 57: Automatizaciones ciclo de vida + NPS (Fase 9)
--
-- ARQUITECTURA:
-- - Supabase decide CUÁNDO y A QUIÉN. GHL envía (workflows con WhatsApp/email).
-- - notificaciones_pendientes ya existe: la reutilizamos como cola.
-- - reglas_automatizacion: catálogo declarativo de cada tipo de recordatorio,
--   editable desde admin sin tocar código. Cada regla apunta a un workflowId
--   de GHL configurado por Frank.
-- - detectar_eventos_automatizacion(): función diaria que escanea condiciones
--   y encola eventos respetando deduplicación (no enviar 2 veces lo mismo).
-- - cron diario corre la función. Edge function 'procesar-cola-automatizaciones'
--   (en cron cada 15 min) toma los pendientes y los dispara contra GHL API.
--
-- NPS MENSUAL:
-- - nps_respuestas: una fila por encuesta enviada. La encuesta misma se hace
--   en GHL con su feature de surveys; al recibir respuesta GHL llama a
--   webhook-nps que persiste el score.
--
-- INDEPENDENCIA: 100% aditivo. Si todo esto falla, nada del resto se rompe.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. notificaciones_pendientes: ampliar para soporte GHL
-- ============================================================================
ALTER TABLE notificaciones_pendientes
  ADD COLUMN IF NOT EXISTS regla_slug text,
  ADD COLUMN IF NOT EXISTS ghl_workflow_id text,
  ADD COLUMN IF NOT EXISTS dedupe_key text;

-- Índice para deduplicación
CREATE UNIQUE INDEX IF NOT EXISTS notif_dedupe_unique
  ON notificaciones_pendientes (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- Índice para procesamiento eficiente
CREATE INDEX IF NOT EXISTS notif_cola_pendientes
  ON notificaciones_pendientes (estado, programada_para)
  WHERE estado = 'pendiente';

-- ============================================================================
-- 2. reglas_automatizacion: catálogo declarativo de reglas
-- ============================================================================
CREATE TABLE IF NOT EXISTS reglas_automatizacion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  nombre      text NOT NULL,
  descripcion text,
  evento      text NOT NULL,        -- cuota_proxima, cuota_atrasada, sin_sesion, fin_programa, nps_mensual, dia_programa
  parametros  jsonb DEFAULT '{}',   -- p.ej. {"dias_offset": -3} para cuota_proxima T-3
  canal       text NOT NULL DEFAULT 'ghl_workflow',  -- ghl_workflow | ghl_conversations | log
  ghl_workflow_id text,             -- ID del workflow en GHL
  template_texto  text,             -- Opcional: texto base si canal=ghl_conversations
  activa      boolean NOT NULL DEFAULT true,
  ventana_horario_inicio time,      -- p.ej. '08:00' para no enviar de madrugada
  ventana_horario_fin    time,      -- p.ej. '21:00'
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reglas_activas_idx
  ON reglas_automatizacion (evento, activa) WHERE activa = true;

ALTER TABLE reglas_automatizacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY reglas_admin_all ON reglas_automatizacion
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true))
  WITH CHECK (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true AND rol = 'admin'));

CREATE POLICY reglas_service_role ON reglas_automatizacion
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed: las 8 reglas iniciales
INSERT INTO reglas_automatizacion (slug, nombre, descripcion, evento, parametros, activa) VALUES
  ('cuota_proxima_3d',     'Cuota próxima · 3 días',  'Recordatorio suave 3 días antes',          'cuota_proxima',  '{"dias_offset": -3}', false),
  ('cuota_proxima_1d',     'Cuota próxima · 1 día',   'Recordatorio 1 día antes',                 'cuota_proxima',  '{"dias_offset": -1}', false),
  ('cuota_atrasada_1d',    'Cuota atrasada · 1 día',  'Primer aviso de cobranza',                 'cuota_atrasada', '{"dias_offset": 1}',  false),
  ('cuota_atrasada_3d',    'Cuota atrasada · 3 días', 'Segundo aviso, más insistente',            'cuota_atrasada', '{"dias_offset": 3}',  false),
  ('cuota_atrasada_7d',    'Cuota atrasada · 7 días', 'Escalación al equipo + cliente',           'cuota_atrasada', '{"dias_offset": 7}',  false),
  ('sin_sesion_7d',        'Sin sesión · 7 días',     'Check-in si lleva 7+ días sin sesión 1:1', 'sin_sesion',     '{"dias_min": 7}',     false),
  ('fin_programa_5d',      'Fin programa · 5 días',   'Aviso de cierre + invitación a renovar',   'fin_programa',   '{"dias_offset": -5}', false),
  ('nps_mensual',          'NPS mensual',             'Encuesta de satisfacción cada 30 días',    'nps_mensual',    '{"dias_intervalo": 30}', false)
ON CONFLICT (slug) DO NOTHING;

COMMENT ON TABLE reglas_automatizacion IS
  'Catálogo de reglas de recordatorio. Cada regla apunta a un workflow GHL. Frank activa/desactiva desde admin.';


-- ============================================================================
-- 3. nps_respuestas: encuestas NPS recibidas
-- ============================================================================
CREATE TABLE IF NOT EXISTS nps_respuestas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  mentor_id     uuid REFERENCES usuarios_admin(id) ON DELETE SET NULL,
  score         integer NOT NULL CHECK (score BETWEEN 0 AND 10),
  categoria     text GENERATED ALWAYS AS (
    CASE
      WHEN score >= 9 THEN 'promotor'
      WHEN score >= 7 THEN 'pasivo'
      ELSE 'detractor'
    END
  ) STORED,
  comentario    text,
  fecha         date NOT NULL DEFAULT (fecha_hoy()),
  origen        text DEFAULT 'ghl_survey',  -- ghl_survey | manual | api
  metadata      jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS nps_lead_idx ON nps_respuestas (lead_id, fecha DESC);
CREATE INDEX IF NOT EXISTS nps_mentor_idx ON nps_respuestas (mentor_id, fecha DESC) WHERE mentor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS nps_fecha_idx ON nps_respuestas (fecha DESC);

ALTER TABLE nps_respuestas ENABLE ROW LEVEL SECURITY;

CREATE POLICY nps_admin_select ON nps_respuestas
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM usuarios_admin WHERE email = auth.jwt() ->> 'email' AND activo = true));

CREATE POLICY nps_service_role ON nps_respuestas
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================================================
-- 4. detectar_eventos_automatizacion()
-- ============================================================================
CREATE OR REPLACE FUNCTION detectar_eventos_automatizacion()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  encolados int := 0;
  saltados int := 0;
  hoy_d date := fecha_hoy();
  dedupe text;
BEGIN
  -- ===========================================================
  -- A) CUOTA PRÓXIMA (T-3, T-1) y CUOTA ATRASADA (T+1, T+3, T+7)
  -- ===========================================================
  FOR r IN
    SELECT
      reg.slug, reg.evento, reg.ghl_workflow_id, reg.parametros, reg.canal,
      p.id AS pago_id, p.lead_id, p.numero_cuota, p.monto_usd, p.fecha_programada,
      l.ghl_contact_id, l.nombre AS lead_nombre,
      (reg.parametros->>'dias_offset')::int AS offset_dias,
      (hoy_d - p.fecha_programada) AS dias_diff
    FROM reglas_automatizacion reg
    JOIN pagos p ON p.estado = 'pendiente'
    JOIN leads l ON l.id = p.lead_id
    WHERE reg.activa = true
      AND reg.evento IN ('cuota_proxima','cuota_atrasada')
      AND l.ghl_contact_id IS NOT NULL
      AND (
        (reg.evento = 'cuota_proxima'  AND p.fecha_programada - hoy_d = -((reg.parametros->>'dias_offset')::int))
        OR
        (reg.evento = 'cuota_atrasada' AND hoy_d - p.fecha_programada = ((reg.parametros->>'dias_offset')::int))
      )
  LOOP
    dedupe := r.slug || ':' || r.pago_id::text;
    BEGIN
      INSERT INTO notificaciones_pendientes
        (lead_id, tipo, canal, estado, metadata, regla_slug, ghl_workflow_id, dedupe_key, programada_para)
      VALUES (
        r.lead_id, r.evento, r.canal, 'pendiente',
        jsonb_build_object(
          'ghl_contact_id', r.ghl_contact_id,
          'lead_nombre', r.lead_nombre,
          'pago_id', r.pago_id,
          'numero_cuota', r.numero_cuota,
          'monto_usd', r.monto_usd,
          'fecha_programada', r.fecha_programada,
          'dias_diff', r.dias_diff
        ),
        r.slug, r.ghl_workflow_id, dedupe, now()
      );
      encolados := encolados + 1;
    EXCEPTION WHEN unique_violation THEN
      saltados := saltados + 1;
    END;
  END LOOP;

  -- ===========================================================
  -- B) SIN SESIÓN (>= N días desde la última sesión 1:1)
  -- ===========================================================
  FOR r IN
    SELECT
      reg.slug, reg.evento, reg.ghl_workflow_id, reg.canal,
      l.id AS lead_id, l.ghl_contact_id, l.nombre AS lead_nombre,
      l.ultima_sesion_at,
      (reg.parametros->>'dias_min')::int AS dias_min
    FROM reglas_automatizacion reg
    JOIN leads l ON l.id IS NOT NULL
    JOIN lead_estado_comercial lec ON lec.lead_id = l.id
    WHERE reg.activa = true
      AND reg.evento = 'sin_sesion'
      AND lec.estado IN ('activo','extension','renovacion_paga')
      AND l.ghl_contact_id IS NOT NULL
      AND (
        l.ultima_sesion_at IS NULL
        OR (now() - l.ultima_sesion_at) >= make_interval(days => (reg.parametros->>'dias_min')::int)
      )
  LOOP
    dedupe := r.slug || ':' || r.lead_id::text || ':' || to_char(hoy_d, 'YYYY-IW');  -- una por semana
    BEGIN
      INSERT INTO notificaciones_pendientes
        (lead_id, tipo, canal, estado, metadata, regla_slug, ghl_workflow_id, dedupe_key, programada_para)
      VALUES (
        r.lead_id, r.evento, r.canal, 'pendiente',
        jsonb_build_object(
          'ghl_contact_id', r.ghl_contact_id,
          'lead_nombre', r.lead_nombre,
          'ultima_sesion_at', r.ultima_sesion_at,
          'dias_min', r.dias_min
        ),
        r.slug, r.ghl_workflow_id, dedupe, now()
      );
      encolados := encolados + 1;
    EXCEPTION WHEN unique_violation THEN
      saltados := saltados + 1;
    END;
  END LOOP;

  -- ===========================================================
  -- C) FIN DE PROGRAMA PRÓXIMO
  -- ===========================================================
  FOR r IN
    SELECT
      reg.slug, reg.evento, reg.ghl_workflow_id, reg.canal,
      l.id AS lead_id, l.ghl_contact_id, l.nombre AS lead_nombre,
      l.fecha_fin_contractual,
      (reg.parametros->>'dias_offset')::int AS offset_dias
    FROM reglas_automatizacion reg
    JOIN leads l ON l.fecha_fin_contractual IS NOT NULL
    WHERE reg.activa = true
      AND reg.evento = 'fin_programa'
      AND l.ghl_contact_id IS NOT NULL
      AND l.churn_at IS NULL
      AND l.fecha_fin_contractual - hoy_d = -((reg.parametros->>'dias_offset')::int)
  LOOP
    dedupe := r.slug || ':' || r.lead_id::text;
    BEGIN
      INSERT INTO notificaciones_pendientes
        (lead_id, tipo, canal, estado, metadata, regla_slug, ghl_workflow_id, dedupe_key, programada_para)
      VALUES (
        r.lead_id, r.evento, r.canal, 'pendiente',
        jsonb_build_object(
          'ghl_contact_id', r.ghl_contact_id,
          'lead_nombre', r.lead_nombre,
          'fecha_fin_contractual', r.fecha_fin_contractual
        ),
        r.slug, r.ghl_workflow_id, dedupe, now()
      );
      encolados := encolados + 1;
    EXCEPTION WHEN unique_violation THEN
      saltados := saltados + 1;
    END;
  END LOOP;

  -- ===========================================================
  -- D) NPS MENSUAL (clientes activos sin encuesta en los últimos N días)
  -- ===========================================================
  FOR r IN
    SELECT
      reg.slug, reg.evento, reg.ghl_workflow_id, reg.canal,
      l.id AS lead_id, l.ghl_contact_id, l.nombre AS lead_nombre,
      (reg.parametros->>'dias_intervalo')::int AS intervalo,
      (SELECT MAX(fecha) FROM nps_respuestas n WHERE n.lead_id = l.id) AS ultimo_nps
    FROM reglas_automatizacion reg
    JOIN leads l ON l.id IS NOT NULL
    JOIN lead_estado_comercial lec ON lec.lead_id = l.id
    WHERE reg.activa = true
      AND reg.evento = 'nps_mensual'
      AND lec.estado IN ('activo','extension','renovacion_paga')
      AND l.ghl_contact_id IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM nps_respuestas n WHERE n.lead_id = l.id)
        OR (hoy_d - (SELECT MAX(fecha) FROM nps_respuestas n WHERE n.lead_id = l.id))
            >= ((reg.parametros->>'dias_intervalo')::int)
      )
  LOOP
    dedupe := r.slug || ':' || r.lead_id::text || ':' || to_char(hoy_d, 'YYYY-MM');  -- uno por mes
    BEGIN
      INSERT INTO notificaciones_pendientes
        (lead_id, tipo, canal, estado, metadata, regla_slug, ghl_workflow_id, dedupe_key, programada_para)
      VALUES (
        r.lead_id, r.evento, r.canal, 'pendiente',
        jsonb_build_object(
          'ghl_contact_id', r.ghl_contact_id,
          'lead_nombre', r.lead_nombre,
          'ultimo_nps', r.ultimo_nps
        ),
        r.slug, r.ghl_workflow_id, dedupe, now()
      );
      encolados := encolados + 1;
    EXCEPTION WHEN unique_violation THEN
      saltados := saltados + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object('encolados', encolados, 'duplicados_saltados', saltados, 'ejecutado_at', now());
END;
$$;

COMMENT ON FUNCTION detectar_eventos_automatizacion IS
  'Escanea condiciones (cuotas, sesiones, fin programa, NPS) y encola en notificaciones_pendientes con dedupe.';


-- ============================================================================
-- 5. KPIs para dashboard NPS
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_nps AS
WITH ult_90 AS (
  SELECT * FROM nps_respuestas WHERE fecha >= fecha_hoy() - 90
)
SELECT
  COUNT(*)                                            AS respuestas_90d,
  COUNT(*) FILTER (WHERE categoria = 'promotor')      AS promotores,
  COUNT(*) FILTER (WHERE categoria = 'pasivo')        AS pasivos,
  COUNT(*) FILTER (WHERE categoria = 'detractor')     AS detractores,
  CASE WHEN COUNT(*) > 0
    THEN ROUND(100.0 * (COUNT(*) FILTER (WHERE categoria = 'promotor') - COUNT(*) FILTER (WHERE categoria = 'detractor')) / COUNT(*), 1)
    ELSE NULL END                                     AS nps_score,
  COALESCE(ROUND(AVG(score), 2), 0)                   AS score_promedio
FROM ult_90;

COMMENT ON VIEW vw_dashboard_nps IS
  'NPS de los últimos 90 días: # respuestas, promotores, pasivos, detractores, NPS score (-100 a +100).';

ALTER VIEW vw_dashboard_nps SET (security_invoker = false);
GRANT SELECT ON vw_dashboard_nps TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- 6. Conectar al cron diario existente: que llame también a detectar_eventos
-- ============================================================================
-- La función cron_diario_completo() ya existe. Solo extendemos su efecto
-- agregando una llamada a detectar_eventos_automatizacion() dentro de ella.
-- Si la función no existe (entornos viejos), no falla la migración.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'cron_diario_completo' AND n.nspname = 'public'
  ) THEN
    -- Wrapper: corre el original + detección de eventos
    CREATE OR REPLACE FUNCTION cron_diario_con_automatizaciones()
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $body$
    DECLARE
      original_result jsonb;
      eventos_result jsonb;
    BEGIN
      SELECT cron_diario_completo() INTO original_result;
      SELECT detectar_eventos_automatizacion() INTO eventos_result;
      RETURN jsonb_build_object(
        'original', original_result,
        'automatizaciones', eventos_result
      );
    END;
    $body$;
  END IF;
END $$;


COMMIT;
