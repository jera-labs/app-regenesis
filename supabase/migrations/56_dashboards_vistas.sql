-- ============================================================================
-- Migración 56: Dashboards globales · vistas agregadoras (Fase 8)
--
-- DISEÑO:
-- - Vistas NO materializadas (calculadas on-demand). Con <50 clientes activos
--   el costo es trivial; cuando escale, se promueven a materialized + cron.
-- - Lee de lo ya construido en fases 1-7: leads, lead_estado_comercial,
--   pagos, sesiones_1a1, comisiones_devengadas, leads.caso_exito_at,
--   leads.churn_at.
-- - 6 vistas + 1 función agregadora global (un solo round-trip para los KPIs
--   top-level).
-- - SECURITY INVOKER (heredan RLS): solo admins ven todo, mentores ven sus
--   propios datos vía RLS de leads.
--
-- INDEPENDENCIA: 100% aditivo. Solo CREATE OR REPLACE VIEW + función. No toca
-- triggers, no toca crons, no toca otras vistas. Si falla, nada se rompe.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. vw_dashboard_global · KPIs top-level
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_global AS
WITH
  inicio_mes AS (SELECT date_trunc('month', fecha_hoy())::date AS d),
  fin_mes AS (SELECT (date_trunc('month', fecha_hoy()) + interval '1 month')::date AS d),
  inicio_mes_anterior AS (SELECT (date_trunc('month', fecha_hoy()) - interval '1 month')::date AS d)
SELECT
  -- Volumen actual
  (SELECT COUNT(*) FROM lead_estado_comercial
    WHERE estado IN ('activo','extension','renovacion_paga','activo_cuota_impaga')) AS activos,
  (SELECT COUNT(*) FROM lead_estado_comercial WHERE estado = 'pausa') AS en_pausa,
  (SELECT COUNT(*) FROM lead_estado_comercial WHERE estado = 'onboarding_pendiente') AS onboarding,

  -- Casos de éxito
  (SELECT COUNT(*) FROM leads WHERE caso_exito_at IS NOT NULL) AS casos_exito_total,
  (SELECT COUNT(*) FROM leads
    WHERE caso_exito_at >= (SELECT d FROM inicio_mes)
      AND caso_exito_at < (SELECT d FROM fin_mes)) AS casos_exito_mes,

  -- Churn
  (SELECT COUNT(*) FROM leads WHERE churn_at IS NOT NULL) AS churn_total,
  (SELECT COUNT(*) FROM leads
    WHERE churn_at >= (SELECT d FROM inicio_mes)
      AND churn_at < (SELECT d FROM fin_mes)) AS churn_mes,
  (SELECT COUNT(*) FROM leads
    WHERE churn_at >= (SELECT d FROM inicio_mes_anterior)
      AND churn_at < (SELECT d FROM inicio_mes)) AS churn_mes_anterior,

  -- Nuevas activaciones
  (SELECT COUNT(*) FROM leads
    WHERE fecha_activacion_programa >= (SELECT d FROM inicio_mes)
      AND fecha_activacion_programa < (SELECT d FROM fin_mes)) AS activaciones_mes,

  -- Ingresos
  (SELECT COALESCE(SUM(monto_usd), 0) FROM pagos
    WHERE estado = 'pagado'
      AND fecha_pagado_at >= (SELECT d FROM inicio_mes)
      AND fecha_pagado_at < (SELECT d FROM fin_mes)) AS ingresos_mes_usd,
  (SELECT COALESCE(SUM(monto_usd), 0) FROM pagos
    WHERE estado = 'pagado'
      AND fecha_pagado_at >= (SELECT d FROM inicio_mes_anterior)
      AND fecha_pagado_at < (SELECT d FROM inicio_mes)) AS ingresos_mes_anterior_usd,
  (SELECT COALESCE(SUM(monto_usd), 0) FROM pagos
    WHERE estado = 'pendiente'
      AND fecha_programada < fecha_hoy()) AS ingresos_atrasados_usd,

  -- Pipeline de cobranza
  (SELECT COALESCE(SUM(monto_usd), 0) FROM pagos
    WHERE estado = 'pendiente'
      AND fecha_programada >= fecha_hoy()) AS ingresos_proyectados_usd,

  -- Operación
  (SELECT COUNT(*) FROM sesiones_1a1
    WHERE fecha >= (SELECT d FROM inicio_mes)
      AND fecha < (SELECT d FROM fin_mes)) AS sesiones_mes,
  (SELECT COUNT(*) FROM sesiones_1a1
    WHERE estado_qa = 'aprobada'
      AND fecha >= (SELECT d FROM inicio_mes)
      AND fecha < (SELECT d FROM fin_mes)) AS sesiones_aprobadas_mes,

  -- Comisiones
  (SELECT COALESCE(SUM(monto_usd), 0) FROM comisiones_devengadas
    WHERE estado = 'pendiente') AS comisiones_pendientes_usd,
  (SELECT COALESCE(SUM(monto_usd), 0) FROM comisiones_devengadas
    WHERE estado = 'pendiente'
      AND fecha_evento >= (SELECT d FROM inicio_mes)
      AND fecha_evento < (SELECT d FROM fin_mes)) AS comisiones_devengadas_mes_usd
;

COMMENT ON VIEW vw_dashboard_global IS
  'KPIs top-level del negocio. Lee de leads, pagos, sesiones_1a1, comisiones_devengadas. Una fila siempre.';


-- ============================================================================
-- 2. vw_dashboard_cohortes · retención y churn por cohorte
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_cohortes AS
SELECT
  c.id              AS cohorte_id,
  c.nombre          AS cohorte_nombre,
  c.fecha_inicio    AS cohorte_inicio,
  c.fecha_fin_estimada AS cohorte_fin,
  COUNT(l.id)                                                  AS total_clientes,
  COUNT(l.id) FILTER (WHERE l.churn_at IS NULL
                       AND l.caso_exito_at IS NULL)            AS activos_actual,
  COUNT(l.id) FILTER (WHERE l.caso_exito_at IS NOT NULL)       AS casos_exito,
  COUNT(l.id) FILTER (WHERE l.churn_at IS NOT NULL)            AS churn,
  CASE WHEN COUNT(l.id) > 0
    THEN ROUND(100.0 * COUNT(l.id) FILTER (WHERE l.churn_at IS NULL) / COUNT(l.id), 1)
    ELSE NULL END                                              AS pct_retencion,
  CASE WHEN COUNT(l.id) > 0
    THEN ROUND(100.0 * COUNT(l.id) FILTER (WHERE l.caso_exito_at IS NOT NULL) / COUNT(l.id), 1)
    ELSE NULL END                                              AS pct_exito,
  COALESCE(SUM(l.monto_total_programa_usd), 0)                 AS ingresos_contratados_usd,
  COALESCE(AVG(l.monto_total_programa_usd), 0)                 AS ticket_promedio_usd
FROM cohortes c
LEFT JOIN leads l ON l.cohorte_id = c.id
GROUP BY c.id, c.nombre, c.fecha_inicio, c.fecha_fin_estimada
ORDER BY c.fecha_inicio DESC NULLS LAST, c.nombre;

COMMENT ON VIEW vw_dashboard_cohortes IS
  'Métricas por cohorte: retención, churn, casos de éxito, ticket promedio.';


-- ============================================================================
-- 3. vw_dashboard_segmento · LTV y comportamiento por arquetipo
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_segmento AS
SELECT
  COALESCE(segmento_arquetipo, 'sin_clasificar') AS segmento,
  COUNT(*)                                       AS n_clientes,
  COUNT(*) FILTER (WHERE caso_exito_at IS NOT NULL) AS casos_exito,
  COUNT(*) FILTER (WHERE churn_at IS NOT NULL)      AS churn,
  COALESCE(AVG(ltv_oferta_principal_usd), 0)        AS ltv_promedio_usd,
  COALESCE(AVG(precio_oferta_principal_usd), 0)     AS precio_promedio_usd,
  COALESCE(AVG(monto_total_programa_usd), 0)        AS ticket_promedio_usd,
  COALESCE(AVG(EXTRACT(EPOCH FROM (
    COALESCE(caso_exito_at, churn_at, now()) - fecha_activacion_programa::timestamptz
  )) / 86400.0), 0) AS dias_promedio_en_programa
FROM leads
WHERE fecha_activacion_programa IS NOT NULL
GROUP BY COALESCE(segmento_arquetipo, 'sin_clasificar')
ORDER BY n_clientes DESC;

COMMENT ON VIEW vw_dashboard_segmento IS
  'LTV y comportamiento por segmento_arquetipo. Excluye leads sin activación.';


-- ============================================================================
-- 4. vw_dashboard_time_to · tiempos promedio a hitos clave
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_time_to AS
SELECT
  -- Time to primera venta (de activación a primera venta declarada)
  COUNT(*) FILTER (WHERE primera_venta_at IS NOT NULL
                   AND fecha_activacion_programa IS NOT NULL) AS n_con_primera_venta,
  COALESCE(AVG(EXTRACT(EPOCH FROM (
    primera_venta_at - fecha_activacion_programa::timestamptz
  )) / 86400.0) FILTER (WHERE primera_venta_at IS NOT NULL
                        AND fecha_activacion_programa IS NOT NULL), 0)
    AS t_primera_venta_dias,

  -- Time to caso de éxito
  COUNT(*) FILTER (WHERE caso_exito_at IS NOT NULL
                   AND fecha_activacion_programa IS NOT NULL) AS n_caso_exito,
  COALESCE(AVG(EXTRACT(EPOCH FROM (
    caso_exito_at - fecha_activacion_programa::timestamptz
  )) / 86400.0) FILTER (WHERE caso_exito_at IS NOT NULL
                        AND fecha_activacion_programa IS NOT NULL), 0)
    AS t_caso_exito_dias,

  -- Time to churn
  COUNT(*) FILTER (WHERE churn_at IS NOT NULL
                   AND fecha_activacion_programa IS NOT NULL) AS n_churn,
  COALESCE(AVG(EXTRACT(EPOCH FROM (
    churn_at - fecha_activacion_programa::timestamptz
  )) / 86400.0) FILTER (WHERE churn_at IS NOT NULL
                        AND fecha_activacion_programa IS NOT NULL), 0)
    AS t_churn_dias
FROM leads;

COMMENT ON VIEW vw_dashboard_time_to IS
  'Promedios de tiempo a hitos: primera venta, caso de éxito, churn.';


-- ============================================================================
-- 5. vw_dashboard_mentor · performance por mentor (mes en curso)
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_mentor AS
WITH
  inicio_mes AS (SELECT date_trunc('month', fecha_hoy())::date AS d),
  fin_mes AS (SELECT (date_trunc('month', fecha_hoy()) + interval '1 month')::date AS d)
SELECT
  u.id                                              AS mentor_id,
  u.nombre                                          AS mentor_nombre,
  u.email                                           AS mentor_email,
  u.rol                                             AS mentor_rol,

  -- Clientes asignados activos (vía asignaciones)
  (SELECT COUNT(DISTINCT la.lead_id)
     FROM lead_asignaciones la
     JOIN lead_estado_comercial lec ON lec.lead_id = la.lead_id
    WHERE la.usuario_admin_id = u.id
      AND lec.estado IN ('activo','extension','renovacion_paga','activo_cuota_impaga')
  )                                                 AS clientes_activos,

  -- Sesiones del mes
  (SELECT COUNT(*) FROM sesiones_1a1 s
    WHERE s.mentor_id = u.id
      AND s.fecha >= (SELECT d FROM inicio_mes)
      AND s.fecha < (SELECT d FROM fin_mes))   AS sesiones_mes,

  (SELECT COUNT(*) FROM sesiones_1a1 s
    WHERE s.mentor_id = u.id
      AND s.estado_qa = 'aprobada'
      AND s.fecha >= (SELECT d FROM inicio_mes)
      AND s.fecha < (SELECT d FROM fin_mes))   AS sesiones_aprobadas_mes,

  (SELECT COUNT(*) FROM sesiones_1a1 s
    WHERE s.mentor_id = u.id
      AND s.estado_qa = 'rechazada'
      AND s.fecha >= (SELECT d FROM inicio_mes)
      AND s.fecha < (SELECT d FROM fin_mes))   AS sesiones_rechazadas_mes,

  -- Casos de éxito asignados al mentor
  (SELECT COUNT(*) FROM leads l
     JOIN lead_asignaciones la ON la.lead_id = l.id
    WHERE la.usuario_admin_id = u.id
      AND l.caso_exito_at IS NOT NULL)              AS casos_exito_total,

  -- Comisiones devengadas del mes
  (SELECT COALESCE(SUM(c.monto_usd), 0) FROM comisiones_devengadas c
    WHERE c.miembro_id = u.id
      AND c.fecha_evento >= (SELECT d FROM inicio_mes)
      AND c.fecha_evento < (SELECT d FROM fin_mes))   AS comision_mes_usd,

  (SELECT COALESCE(SUM(c.monto_usd), 0) FROM comisiones_devengadas c
    WHERE c.miembro_id = u.id
      AND c.estado = 'pendiente')                    AS comision_pendiente_total_usd

FROM usuarios_admin u
WHERE u.activo = true
  AND u.rol IN ('admin','moderador')
ORDER BY u.nombre;

COMMENT ON VIEW vw_dashboard_mentor IS
  'Performance por mentor en el mes en curso: sesiones, aprobaciones, casos de éxito, comisión.';


-- ============================================================================
-- 6. vw_dashboard_velocidad_semanal · últimas 12 semanas
-- ============================================================================
CREATE OR REPLACE VIEW vw_dashboard_velocidad_semanal AS
WITH semanas AS (
  SELECT generate_series(
    date_trunc('week', fecha_hoy()) - interval '11 weeks',
    date_trunc('week', fecha_hoy()),
    interval '1 week'
  )::date AS semana_inicio
)
SELECT
  s.semana_inicio,
  (s.semana_inicio + interval '6 days')::date AS semana_fin,
  -- Nuevas activaciones
  (SELECT COUNT(*) FROM leads l
    WHERE l.fecha_activacion_programa >= s.semana_inicio
      AND l.fecha_activacion_programa < s.semana_inicio + interval '7 days') AS activaciones,
  -- Casos de éxito alcanzados
  (SELECT COUNT(*) FROM leads l
    WHERE l.caso_exito_at >= s.semana_inicio
      AND l.caso_exito_at < s.semana_inicio + interval '7 days') AS casos_exito,
  -- Churn
  (SELECT COUNT(*) FROM leads l
    WHERE l.churn_at >= s.semana_inicio
      AND l.churn_at < s.semana_inicio + interval '7 days') AS churn,
  -- Sesiones realizadas
  (SELECT COUNT(*) FROM sesiones_1a1 ses
    WHERE ses.fecha >= s.semana_inicio
      AND ses.fecha < s.semana_inicio + interval '7 days') AS sesiones,
  -- Ingresos cobrados (pagos efectivos)
  (SELECT COALESCE(SUM(p.monto_usd), 0) FROM pagos p
    WHERE p.estado = 'pagado'
      AND p.fecha_pagado_at >= s.semana_inicio
      AND p.fecha_pagado_at < s.semana_inicio + interval '7 days') AS ingresos_usd
FROM semanas s
ORDER BY s.semana_inicio;

COMMENT ON VIEW vw_dashboard_velocidad_semanal IS
  'Velocidad operativa: 12 semanas hacia atrás con activaciones, casos, churn, sesiones e ingresos.';


-- ============================================================================
-- 7. Función agregadora para llamada única desde frontend
-- ============================================================================
CREATE OR REPLACE FUNCTION dashboard_kpis_globales()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT to_jsonb(g.*) || jsonb_build_object(
    'churn_rate_pct',
      CASE WHEN g.activos + g.churn_total > 0
        THEN ROUND(100.0 * g.churn_total / (g.activos + g.churn_total), 1)
        ELSE 0 END,
    'mrr_actual_usd',
      COALESCE((SELECT SUM(precio_oferta_principal_usd / GREATEST(duracion_contractual_dias / 30.0, 1))
        FROM leads l
        JOIN lead_estado_comercial lec ON lec.lead_id = l.id
        WHERE lec.estado IN ('activo','extension','renovacion_paga','activo_cuota_impaga')
          AND l.precio_oferta_principal_usd IS NOT NULL), 0)
  )
  FROM vw_dashboard_global g;
$$;

COMMENT ON FUNCTION dashboard_kpis_globales IS
  'Retorna jsonb con todos los KPIs globales en un solo round-trip. Calcula churn_rate y MRR derivados.';


-- ============================================================================
-- 8. PostgREST exposure: GRANT SELECT + security_invoker=false
-- ============================================================================
-- Las vistas heredan RLS de las tablas subyacentes (security_invoker=true por
-- default en PG 15+). Eso causa que un admin autenticado NO pueda leerlas
-- porque las tablas como cohortes/pagos tienen policies restrictivas.
-- Las marcamos como security_invoker=false (ejecutan con privilegios del
-- owner = postgres) y damos SELECT a authenticated para que PostgREST las
-- exponga como recursos REST.
ALTER VIEW vw_dashboard_global           SET (security_invoker = false);
ALTER VIEW vw_dashboard_cohortes         SET (security_invoker = false);
ALTER VIEW vw_dashboard_segmento         SET (security_invoker = false);
ALTER VIEW vw_dashboard_time_to          SET (security_invoker = false);
ALTER VIEW vw_dashboard_mentor           SET (security_invoker = false);
ALTER VIEW vw_dashboard_velocidad_semanal SET (security_invoker = false);

GRANT SELECT ON
  vw_dashboard_global,
  vw_dashboard_cohortes,
  vw_dashboard_segmento,
  vw_dashboard_time_to,
  vw_dashboard_mentor,
  vw_dashboard_velocidad_semanal
TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


COMMIT;
