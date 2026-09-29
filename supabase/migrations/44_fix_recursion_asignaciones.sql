-- ============================================================================
-- Migración 44: Fix recursión infinita en RLS de lead_asignaciones
--
-- Problema: la policy `la_mod_lector_select` hacía
--   `lead_id IN (SELECT lead_id FROM lead_asignaciones WHERE ...)`
-- que dispara la propia policy de lead_asignaciones → recursión.
--
-- Fix: helper SECURITY DEFINER que bypassea RLS al hacer el subquery,
-- y reescribir la policy para usarlo. Misma lógica, sin self-reference.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION mis_leads_asignados()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT lead_id FROM lead_asignaciones WHERE usuario_admin_id = mi_admin_id();
$$;

-- Reescribir policy del moderador/lector usando la función helper
DROP POLICY IF EXISTS la_mod_lector_select ON lead_asignaciones;
CREATE POLICY la_mod_lector_select ON lead_asignaciones FOR SELECT TO authenticated
  USING (
    mi_rol_admin() IN ('moderador','lector')
    AND (
      usuario_admin_id = mi_admin_id()
      OR lead_id IN (SELECT mis_leads_asignados())
    )
  );

COMMIT;

COMMENT ON FUNCTION mis_leads_asignados IS 'Devuelve los lead_ids a los que el usuario actual está asignado. SECURITY DEFINER bypasea RLS para evitar recursión cuando se usa en policies de lead_asignaciones.';
