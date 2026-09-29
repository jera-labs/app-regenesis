-- ============================================================================
-- MIGRACIÓN 22 — Calendario fijo de temas + renombrar temas a metodología actual
--
-- Cambios:
-- 1. Renombrar 6 temas para alinearlos con el calendario que entregó Frank:
--    - Nacimiento → Parto
--    - La Madre → Mamá
--    - El Padre → Papá
--    - La Pareja → Pareja
--    - El Dinero → Dinero
--    - Integración → Heridas de la Infancia
--    "Epigenética" se mantiene con ese nombre pero conceptualmente representa
--    a "Ancestros" en el calendario (decisión de Frank).
--
-- 2. Crear tabla calendario_temas con (fecha_lunes, tema_orden) — fuente de
--    verdad de qué tema toca cada lunes. Reemplaza el cálculo por módulo
--    desde fecha ancla.
--
-- 3. Cargar 87 lunes desde el Excel "calendario Terapias 26-27.xlsx"
--    (4 mayo 2026 → 27 diciembre 2027). El Excel original usaba MARTES como
--    referencia (día de la sesión presencial); aquí se almacena el LUNES de
--    cada semana, que es el día que arranca el ciclo del cliente.
--
-- 4. RLS: SELECT abierto a authenticated, ALL solo a admins.
--
-- Mapeo de nombres del Excel a tema_orden:
--   ANCESTROS              → orden 1  (id=1, "Epigenética")
--   GESTACION              → orden 2
--   PARTO                  → orden 3  (antes "Nacimiento")
--   NIÑO INTERIOR          → orden 4
--   ABUNDANCIA             → orden 5
--   MAMA                   → orden 6  (antes "La Madre")
--   PAPÁ                   → orden 7  (antes "El Padre")
--   PAREJA                 → orden 8  (antes "La Pareja")
--   DINERO                 → orden 9  (antes "El Dinero")
--   HERIDAS DE LA INFANCIA → orden 10 (antes "Integración")
-- ============================================================================

-- 1. Renombrar 6 temas (no destructivo, mantiene FK con mensajes/interacciones)
UPDATE temas SET nombre = 'Parto'                  WHERE id = 3;
UPDATE temas SET nombre = 'Mamá'                   WHERE id = 5;
UPDATE temas SET nombre = 'Papá'                   WHERE id = 6;
UPDATE temas SET nombre = 'Pareja'                 WHERE id = 8;
UPDATE temas SET nombre = 'Dinero'                 WHERE id = 7;
UPDATE temas SET nombre = 'Heridas de la Infancia' WHERE id = 10;

-- 2. Crear tabla calendario_temas
CREATE TABLE IF NOT EXISTS public.calendario_temas (
  fecha_lunes DATE PRIMARY KEY,
  tema_orden  SMALLINT NOT NULL CHECK (tema_orden BETWEEN 1 AND 10),
  notas       TEXT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.calendario_temas IS
  'Calendario fijo de qué tema toca cada lunes. Fuente única de verdad para asignar tema_actual_orden a clientes activos. Cargado desde el Excel de Frank "calendario Terapias 26-27.xlsx".';

COMMENT ON COLUMN public.calendario_temas.fecha_lunes IS
  'Lunes que arranca la semana (ISODOW=1).';

COMMENT ON COLUMN public.calendario_temas.tema_orden IS
  'Tema que aplica para esa semana (1=Epigenética/Ancestros, 2=Gestación, ...).';

-- 3. Insertar 87 lunes del calendario 2026-2027
INSERT INTO public.calendario_temas (fecha_lunes, tema_orden) VALUES
  ('2026-05-04'::date, 2), ('2026-05-11'::date, 3), ('2026-05-18'::date, 4),
  ('2026-05-25'::date, 9), ('2026-06-01'::date, 6), ('2026-06-08'::date, 7),
  ('2026-06-15'::date, 8), ('2026-06-22'::date, 5), ('2026-06-29'::date, 10),
  ('2026-07-06'::date, 1), ('2026-07-13'::date, 2), ('2026-07-20'::date, 3),
  ('2026-07-27'::date, 4), ('2026-08-03'::date, 9), ('2026-08-10'::date, 6),
  ('2026-08-17'::date, 7), ('2026-08-24'::date, 8), ('2026-08-31'::date, 5),
  ('2026-09-07'::date, 10), ('2026-09-14'::date, 1), ('2026-09-21'::date, 2),
  ('2026-09-28'::date, 3), ('2026-10-05'::date, 4), ('2026-10-12'::date, 9),
  ('2026-10-19'::date, 6), ('2026-10-26'::date, 7), ('2026-11-02'::date, 8),
  ('2026-11-09'::date, 5), ('2026-11-16'::date, 10), ('2026-11-23'::date, 1),
  ('2026-11-30'::date, 2), ('2026-12-07'::date, 3), ('2026-12-14'::date, 4),
  ('2026-12-21'::date, 9), ('2026-12-28'::date, 6), ('2027-01-04'::date, 1),
  ('2027-01-11'::date, 2), ('2027-01-18'::date, 3), ('2027-01-25'::date, 4),
  ('2027-02-01'::date, 9), ('2027-02-08'::date, 6), ('2027-02-15'::date, 7),
  ('2027-02-22'::date, 8), ('2027-03-01'::date, 5), ('2027-03-08'::date, 10),
  ('2027-03-15'::date, 1), ('2027-03-22'::date, 2), ('2027-03-29'::date, 3),
  ('2027-04-05'::date, 4), ('2027-04-12'::date, 9), ('2027-04-19'::date, 6),
  ('2027-04-26'::date, 1), ('2027-05-03'::date, 2), ('2027-05-10'::date, 3),
  ('2027-05-17'::date, 4), ('2027-05-24'::date, 9), ('2027-05-31'::date, 6),
  ('2027-06-07'::date, 7), ('2027-06-14'::date, 8), ('2027-06-21'::date, 5),
  ('2027-06-28'::date, 10), ('2027-07-05'::date, 1), ('2027-07-12'::date, 2),
  ('2027-07-19'::date, 3), ('2027-07-26'::date, 4), ('2027-08-02'::date, 9),
  ('2027-08-09'::date, 6), ('2027-08-16'::date, 1), ('2027-08-23'::date, 2),
  ('2027-08-30'::date, 3), ('2027-09-06'::date, 4), ('2027-09-13'::date, 9),
  ('2027-09-20'::date, 6), ('2027-09-27'::date, 7), ('2027-10-04'::date, 8),
  ('2027-10-11'::date, 5), ('2027-10-18'::date, 10), ('2027-10-25'::date, 1),
  ('2027-11-01'::date, 2), ('2027-11-08'::date, 3), ('2027-11-15'::date, 4),
  ('2027-11-22'::date, 9), ('2027-11-29'::date, 6), ('2027-12-06'::date, 1),
  ('2027-12-13'::date, 2), ('2027-12-20'::date, 3), ('2027-12-27'::date, 4)
ON CONFLICT (fecha_lunes) DO UPDATE SET tema_orden = EXCLUDED.tema_orden;

-- 4. RLS para calendario_temas
ALTER TABLE public.calendario_temas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calendario_authenticated_select" ON public.calendario_temas;
CREATE POLICY "calendario_authenticated_select" ON public.calendario_temas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "calendario_admin_all" ON public.calendario_temas;
CREATE POLICY "calendario_admin_all" ON public.calendario_temas
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.usuarios_admin
      WHERE email = auth.jwt() ->> 'email' AND activo = true
    )
  );
