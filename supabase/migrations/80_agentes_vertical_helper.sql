-- ============================================================================
-- Migración 80: Multi-vertical + helper mi_agente_id()
--
-- Aplicada en vivo vía Management API el 2026-06-29.
--
-- Parte del SaaS de agentes (app Next.js insurance-app). Aditivo, no rompe el
-- piloto Seguros Voraus.
--   - agentes.vertical: 'seguros' (default) | 'realtor'. Motor agnóstico.
--   - mi_agente_id(): SECURITY DEFINER, devuelve el id del agente del usuario
--     logueado por su email. Análogo a mi_admin_id() (mig 41). Evita subqueries
--     repetidas y recursión en RLS de tablas hijas (forms, applications, ...).
-- ============================================================================

ALTER TABLE agentes ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'seguros';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agentes_vertical_chk') THEN
    ALTER TABLE agentes ADD CONSTRAINT agentes_vertical_chk
      CHECK (vertical IN ('seguros','realtor'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION mi_agente_id()
RETURNS uuid LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT id FROM agentes WHERE email = auth.jwt() ->> 'email' LIMIT 1;
$$;

COMMENT ON FUNCTION mi_agente_id() IS 'Devuelve el id del agente del usuario logueado (por email del JWT). SECURITY DEFINER para usar en policies RLS de tablas hijas sin recursión.';

NOTIFY pgrst, 'reload schema';
