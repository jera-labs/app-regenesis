-- ============================================================================
-- Migración 49: Backfill de fechas CRM desde columnas Re-Génesis existentes
--
-- La migración 46 agregó fecha_activacion_programa, fecha_fin_contractual,
-- duracion_contractual_dias y monto_total_programa_usd, pero NO migró los
-- datos que ya existían en fecha_inicio_programa, fecha_fin_estimada, etc.
--
-- Esta migración copia los datos donde tiene sentido. NO sobrescribe valores
-- que ya estén seteados (las columnas nuevas siguen siendo source of truth
-- a futuro; esto es solo backfill inicial).
-- ============================================================================

BEGIN;

-- 1) Activación: cuando hay fecha_inicio_programa la usamos. Si no, fecha_pago.
UPDATE leads
SET fecha_activacion_programa = COALESCE(
      fecha_activacion_programa,
      fecha_inicio_programa,
      fecha_pago::date
    )
WHERE fecha_activacion_programa IS NULL
  AND (fecha_inicio_programa IS NOT NULL OR fecha_pago IS NOT NULL)
  AND estado IN ('activo','pagado_calentamiento','completado');

-- 2) Fin contractual: si ya tenemos fecha_fin_estimada, la usamos. Si no,
--    calculamos desde fecha_activacion + duracion_contractual_dias (70 default).
UPDATE leads
SET fecha_fin_contractual = COALESCE(
      fecha_fin_contractual,
      fecha_fin_estimada,
      (fecha_activacion_programa + COALESCE(duracion_contractual_dias, 70) * INTERVAL '1 day')::date
    )
WHERE fecha_fin_contractual IS NULL
  AND fecha_activacion_programa IS NOT NULL;

-- 3) Duración contractual: si tenemos las dos fechas, derivamos la duración
--    real (puede ser distinta a 70 si Frank cambió el plazo).
UPDATE leads
SET duracion_contractual_dias = GREATEST(
      1,
      (fecha_fin_contractual - fecha_activacion_programa)::integer
    )
WHERE fecha_activacion_programa IS NOT NULL
  AND fecha_fin_contractual IS NOT NULL
  AND duracion_contractual_dias = 70;

-- 4) precio_pagado existe en leads pero NO es monto_total_programa.
--    Lo dejamos al admin para que lo llene manual desde tab CRM.

-- 5) sesiones_realizadas: arranca en 0 por DEFAULT. La fase 6 lo actualizará
--    con el contador real cuando se registren las sesiones 1:1.

COMMIT;

-- Reporte post-migración (solo informativo en logs Supabase)
DO $$
DECLARE
  v_activacion_count integer;
  v_fin_count integer;
BEGIN
  SELECT count(*) INTO v_activacion_count FROM leads WHERE fecha_activacion_programa IS NOT NULL;
  SELECT count(*) INTO v_fin_count FROM leads WHERE fecha_fin_contractual IS NOT NULL;
  RAISE NOTICE 'Backfill 49: % leads con fecha_activacion, % con fecha_fin_contractual', v_activacion_count, v_fin_count;
END $$;
