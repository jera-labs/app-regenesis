-- ============================================================================
-- Migración 73 — Índices compuestos + vista materializada KPI para escalar
-- a cientos/miles de leads sin degradación.
--
-- Aplicada vía MCP Supabase apply_migration el 2026-06-03.
-- Plan de escalabilidad Fase 1 (Indexing) — ver C:\Users\andre\.claude\plans\rosy-sprouting-seal.md
--
-- Estrategia: solo índices NUEVOS que no estén ya cubiertos por la migración
-- 72 (FK indexes) ni por PKs/UNIQUEs. Cada índice tiene un caso de uso
-- documentado en código.
--
-- NO usamos CREATE INDEX CONCURRENTLY porque con 12 leads el lock es <1ms.
-- Cuando lleguemos a 100K filas, cualquier índice nuevo deberá CONCURRENTLY.
-- ============================================================================

-- Hot path /admin/index.html : SELECT … FROM leads WHERE estado != 'perdido' ORDER BY fecha_pago DESC.
-- Hoy hace Seq Scan + Sort (3ms con 12 filas, 1-3s con 1K filas sin índice).
CREATE INDEX IF NOT EXISTS idx_leads_estado_fecha_pago
  ON leads(estado, fecha_pago DESC NULLS LAST)
  WHERE estado != 'perdido';

-- Filtro chip "Caso éxito" en admin/index.html
CREATE INDEX IF NOT EXISTS idx_leads_caso_exito_at
  ON leads(caso_exito_at) WHERE caso_exito_at IS NOT NULL;

-- /admin/finanzas.html tabs: SELECT FROM pagos WHERE lead_id=? AND estado=? ORDER BY fecha_programada
CREATE INDEX IF NOT EXISTS idx_pagos_lead_estado_fecha
  ON pagos(lead_id, estado, fecha_programada DESC);

-- KPI "cash del mes" (finanzas.metricasGlobalesRango): WHERE estado='pagado' AND fecha_pagado_at>=...
CREATE INDEX IF NOT EXISTS idx_pagos_estado_pagado_at
  ON pagos(estado, fecha_pagado_at)
  WHERE estado = 'pagado';

-- Catálogo etiquetas (dropdowns): SELECT WHERE activa=true ORDER BY orden
-- (existe etiquetas_catalogo_activa_idx pero solo en activa, no en (activa, orden))
CREATE INDEX IF NOT EXISTS idx_etiquetas_catalogo_activa_orden
  ON etiquetas_catalogo(activa, orden) WHERE activa = true;

-- QC sesiones por mentor + estado (s1a1_mentor_idx existe pero sin estado_qa)
CREATE INDEX IF NOT EXISTS idx_s1a1_mentor_estado_fecha
  ON sesiones_1a1(mentor_id, estado_qa, fecha DESC);

-- /admin/index.html KPI productos: WHERE lead_id=? AND estado != 'archivado'
CREATE INDEX IF NOT EXISTS idx_productos_lead_estado
  ON productos(lead_id, estado) WHERE estado != 'archivado';

-- ============================================================================
-- Vista materializada: KPIs admin (clientes activos, churn, cash mes, etc.)
-- Reemplaza queries que cuentan/suman sobre todas las filas con RLS, que con
-- volumen alto pueden ser lentas. La vista se refresca cada 5 min vía cron.
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS vw_admin_kpis_vivos AS
SELECT
  count(*) FILTER (WHERE l.estado NOT IN ('perdido','churn')) AS clientes_activos,
  count(*) FILTER (WHERE l.churn_at IS NOT NULL) AS churn_total,
  count(*) FILTER (WHERE l.caso_exito_at IS NOT NULL) AS casos_exito,
  count(p.id) FILTER (WHERE p.estado='atrasado') AS pagos_atrasados,
  coalesce(sum(p.monto_usd) FILTER (
    WHERE p.estado='pagado'
      AND p.fecha_pagado_at >= date_trunc('month', fecha_hoy())::timestamptz
  ), 0)::numeric AS cash_mes_usd,
  coalesce(sum(p.monto_usd) FILTER (
    WHERE p.estado='pagado'
      AND p.fecha_pagado_at >= (date_trunc('month', fecha_hoy()) - interval '1 month')::timestamptz
      AND p.fecha_pagado_at < date_trunc('month', fecha_hoy())::timestamptz
  ), 0)::numeric AS cash_mes_anterior_usd,
  now() AS calculado_at
FROM leads l
LEFT JOIN pagos p ON p.lead_id = l.id;

-- Índice único requerido para REFRESH MATERIALIZED VIEW CONCURRENTLY.
-- Usamos una expresión constante porque la vista siempre tiene 1 fila.
CREATE UNIQUE INDEX IF NOT EXISTS idx_vw_admin_kpis_vivos_singleton
  ON vw_admin_kpis_vivos ((1));

-- Permisos para que authenticated pueda leer (admin + clientes con RLS abajo)
GRANT SELECT ON vw_admin_kpis_vivos TO authenticated, anon;

-- ============================================================================
-- Cron para refrescar la vista cada 5 minutos.
-- Usamos REFRESH CONCURRENTLY para no bloquear lecturas durante el refresh.
-- ============================================================================
SELECT cron.schedule(
  'refresh-kpis-vivos',
  '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY vw_admin_kpis_vivos$$
);

-- Primer refresh inmediato para que la vista no quede vacía
REFRESH MATERIALIZED VIEW vw_admin_kpis_vivos;

COMMENT ON MATERIALIZED VIEW vw_admin_kpis_vivos IS
  'KPIs globales del admin precalculados. Refrescada cada 5 min por cron refresh-kpis-vivos. Frontend la consulta como single-row select (<5ms) en vez de hacer 4 count/sum sobre todas las filas con RLS.';
