-- ============================================================================
-- Migración 70: retirar integración GHL Brand Board / Content AI
-- Proyecto: Plataforma
-- Fecha: 2026-06-01
--
-- Contexto: la API pública de GHL no expone el endpoint de Brand Board
-- (devuelve 401 "token not authorized for this scope"), así que la
-- sincronización automática DNA → Brand Panel queda imposible con el PIT
-- de agencia. Decisión: el cliente trabaja directo en su sub-account GHL,
-- la plataforma se enfoca en otras capas (DNA, Marca y oferta, Tracker).
--
-- Limpia:
-- 1. Columnas leads.ghl_sub_location_*, ghl_brand_synced_at
-- 2. Trigger _leads_enforce_ghl_admin_only (ya no aplica)
-- 3. Tabla contenido_generado (Studio archivado)
-- 4. Tablas modulos_cliente + modulos_catalogo (feature flags Studio)
-- 5. Función cliente_tiene_modulo si existe
-- ============================================================================

-- 1) Trigger y función de protección admin-only sobre columnas ghl_*
DROP TRIGGER IF EXISTS _leads_enforce_ghl_admin_only ON leads;
DROP FUNCTION IF EXISTS leads_enforce_ghl_admin_only();

-- 2) Columnas ghl_sub_* en leads
ALTER TABLE leads DROP COLUMN IF EXISTS ghl_sub_location_id;
ALTER TABLE leads DROP COLUMN IF EXISTS ghl_sub_location_url;
ALTER TABLE leads DROP COLUMN IF EXISTS ghl_brand_synced_at;

-- 3) Tabla de contenido generado (Studio archivado)
DROP TABLE IF EXISTS contenido_generado CASCADE;

-- 4) Tablas de feature flags por módulo (Studio archivado)
DROP TABLE IF EXISTS modulos_cliente CASCADE;
DROP TABLE IF EXISTS modulos_catalogo CASCADE;

-- 5) Función helper de módulos (si quedó)
DROP FUNCTION IF EXISTS cliente_tiene_modulo(uuid, text);
