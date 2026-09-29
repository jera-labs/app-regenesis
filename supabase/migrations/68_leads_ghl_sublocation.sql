-- ============================================================================
-- Migración 68 — Columnas GHL sub-location en leads para integración con
-- Social Planner / Brand Panel / Content AI de GHL Agency SaaS.
--
-- Cambio estratégico (2026-05-31): retiramos el módulo Studio interno (que
-- duplicaba funcionalidad de GHL) y delegamos generación + publicación al
-- Social Planner de GHL. La plataforma Neurohackers sigue siendo source of
-- truth del DNA (4 capas + productos) y empuja ese contexto al Brand Panel
-- de GHL via API.
--
-- Frank crea una sub-account por cliente en GHL Agency SaaS. La plataforma
-- guarda el ID + URL para:
--   1. Sync DNA → Brand Panel via API (edge function sync-dna-to-ghl-brand-panel)
--   2. Link directo "Abrir mi calendario en GHL" desde plataforma
-- ============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ghl_sub_location_id  text,
  ADD COLUMN IF NOT EXISTS ghl_sub_location_url text,
  ADD COLUMN IF NOT EXISTS ghl_brand_synced_at  timestamptz;

COMMENT ON COLUMN public.leads.ghl_sub_location_id  IS 'GHL Agency: sub-account/location ID del cliente. Lo crea Frank manualmente en GHL y se pega aquí.';
COMMENT ON COLUMN public.leads.ghl_sub_location_url IS 'URL completa del dashboard del cliente en GHL (whitelabel). Botón "Abrir calendario en GHL" en plataforma.';
COMMENT ON COLUMN public.leads.ghl_brand_synced_at  IS 'Última vez que el DNA del cliente se sincronizó al Brand Panel de GHL. NULL = nunca sincronizado.';
