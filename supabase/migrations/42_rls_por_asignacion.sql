-- ============================================================================
-- Migración 42: Reescribir RLS de tablas críticas para respetar
--   admin (todo) | moderador (sólo asignados + editar) | lector (sólo asignados, sólo leer)
--
-- Tablas afectadas:
--   - leads
--   - cliente_esencia
--   - cliente_negocio
--   - cliente_diagnostico
--   - productos
--   - contenido_generado
--
-- Política base: el cliente final sigue accediendo solo a SU propia data
--   (policies *_cliente_* sin cambios).
-- Lo nuevo: las policies admin se dividen entre admin, moderador, lector.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- LEADS
-- ----------------------------------------------------------------------------
-- Quitar policy admin viejo (catch-all) si existe; añadir 3 nuevos por rol
DROP POLICY IF EXISTS leads_admin ON leads;
DROP POLICY IF EXISTS leads_admin_all ON leads;

CREATE POLICY leads_admin_all ON leads FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY leads_mod_select_asignados ON leads FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(id));

CREATE POLICY leads_mod_update_asignados ON leads FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(id));

CREATE POLICY leads_lector_select_asignados ON leads FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(id));

-- ----------------------------------------------------------------------------
-- CLIENTE_ESENCIA
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS cliente_esencia_admin_all ON cliente_esencia;

CREATE POLICY ce_admin_all ON cliente_esencia FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY ce_mod_select ON cliente_esencia FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY ce_mod_update ON cliente_esencia FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY ce_lector_select ON cliente_esencia FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- ----------------------------------------------------------------------------
-- CLIENTE_NEGOCIO
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS cn_admin_all ON cliente_negocio;

CREATE POLICY cn_admin_all_v2 ON cliente_negocio FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY cn_mod_select ON cliente_negocio FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cn_mod_update ON cliente_negocio FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cn_lector_select ON cliente_negocio FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- ----------------------------------------------------------------------------
-- CLIENTE_DIAGNOSTICO
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS cd_admin_all ON cliente_diagnostico;

CREATE POLICY cd_admin_all_v2 ON cliente_diagnostico FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY cd_mod_select ON cliente_diagnostico FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cd_mod_update ON cliente_diagnostico FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cd_lector_select ON cliente_diagnostico FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- ----------------------------------------------------------------------------
-- PRODUCTOS
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS productos_admin_all ON productos;

CREATE POLICY productos_admin_all_v2 ON productos FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY productos_mod_select ON productos FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY productos_mod_update ON productos FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY productos_lector_select ON productos FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- ----------------------------------------------------------------------------
-- CONTENIDO_GENERADO
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS cg_admin_all ON contenido_generado;

CREATE POLICY cg_admin_all_v2 ON contenido_generado FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY cg_mod_select ON contenido_generado FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cg_mod_update ON contenido_generado FOR UPDATE TO authenticated
  USING (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id))
  WITH CHECK (mi_rol_admin() = 'moderador' AND tengo_acceso_a_lead(lead_id));

CREATE POLICY cg_lector_select ON contenido_generado FOR SELECT TO authenticated
  USING (mi_rol_admin() = 'lector' AND tengo_acceso_a_lead(lead_id));

-- ----------------------------------------------------------------------------
-- CLIENTE_ONBOARDING (tracking de avance del perfil)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS co_admin_all ON cliente_onboarding;

CREATE POLICY co_admin_all_v2 ON cliente_onboarding FOR ALL TO authenticated
  USING (mi_rol_admin() = 'admin')
  WITH CHECK (mi_rol_admin() = 'admin');

CREATE POLICY co_mod_lector_select ON cliente_onboarding FOR SELECT TO authenticated
  USING (mi_rol_admin() IN ('moderador','lector') AND tengo_acceso_a_lead(lead_id));

COMMIT;
