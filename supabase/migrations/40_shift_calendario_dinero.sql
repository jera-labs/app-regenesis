-- ============================================================================
-- Migración 40: Shift +1 semana del calendario_temas a partir del 2026-06-01
--
-- Contexto: la semana del 2026-05-25 estaba marcada como Dinero en el
-- calendario, pero Frank quiere que Dinero empiece propiamente el lunes
-- 2026-06-01. Algunos clientes ya están en Dinero esta semana y no
-- queremos perder su avance, así que:
--
--   - 2026-05-25: queda como está (Dinero)
--   - 2026-06-01: se sobrescribe a Dinero (era Mamá)
--   - 2026-06-08 en adelante: cada lunes recibe el tema que tenía la
--     semana anterior (shift +1 semana hacia el futuro)
--   - 2028-01-03: se inserta un lunes nuevo con el tema que tenía
--     2027-12-27 (Niño Interior) para no perder cobertura del ciclo
--
-- La tabla calendario_temas_bak_20260529 queda como backup permanente
-- por si hay que rollback manual.
-- ============================================================================

BEGIN;

-- 1. Backup permanente (también queda como audit log de la operación)
DROP TABLE IF EXISTS calendario_temas_bak_20260529;
CREATE TABLE calendario_temas_bak_20260529 AS
SELECT *, now() AS backup_at FROM calendario_temas;

-- 2. Snapshot temporal para el shift (los valores ORIGINALES antes del UPDATE)
CREATE TEMP TABLE temp_cal_orig AS
SELECT fecha_lunes, tema_orden FROM calendario_temas;

-- 3. SHIFT: cada lunes >= 2026-06-08 recibe el tema_orden que tenía el lunes
--    7 días antes (en el snapshot original)
UPDATE calendario_temas ct
SET tema_orden = tc.tema_orden
FROM temp_cal_orig tc
WHERE ct.fecha_lunes >= '2026-06-08'
  AND tc.fecha_lunes = ct.fecha_lunes - INTERVAL '7 days';

-- 4. El lunes 2026-06-01 se sobrescribe al mismo tema que 2026-05-25 (Dinero)
UPDATE calendario_temas
SET tema_orden = (
  SELECT tema_orden FROM temp_cal_orig WHERE fecha_lunes = '2026-05-25'
)
WHERE fecha_lunes = '2026-06-01';

-- 5. Extender el calendario con un lunes nuevo (2028-01-03) que recibe
--    el tema que ORIGINALMENTE tenía 2027-12-27 (el último lunes que se
--    "perdió" del calendario al hacer el shift)
INSERT INTO calendario_temas (fecha_lunes, tema_orden, notas)
SELECT '2028-01-03'::date, tema_orden, 'Insertado en migración 40 para compensar shift +1 sem'
FROM temp_cal_orig
WHERE fecha_lunes = '2027-12-27'
ON CONFLICT (fecha_lunes) DO NOTHING;

COMMIT;

-- ============================================================================
-- Verificación (manual, después del COMMIT)
--
-- SELECT fecha_lunes, tema_orden FROM calendario_temas
-- WHERE fecha_lunes BETWEEN '2026-05-18' AND '2026-08-31'
-- ORDER BY fecha_lunes;
--
-- SELECT fecha_lunes, tema_orden FROM calendario_temas
-- ORDER BY fecha_lunes DESC LIMIT 5;
-- ============================================================================
