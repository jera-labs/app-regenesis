-- ============================================================================
-- 17_contratos_firma.sql
-- Columnas para rastrear las dos firmas requeridas antes de que el cliente
-- pueda entrar a la plataforma:
--   - Contrato de servicio (define alcance del programa)
--   - NDA / Acuerdo de confidencialidad
--
-- GHL es source of truth: cuando el cliente firma allá, dispara webhook que
-- actualiza estas columnas. La UI de bienvenida.html lee de aquí.
-- ============================================================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contrato_servicio_firmado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contrato_nda_firmado_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contrato_servicio_url TEXT,
  ADD COLUMN IF NOT EXISTS contrato_nda_url TEXT;

-- Vista helper para identificar leads con contratos pendientes
CREATE OR REPLACE VIEW public.leads_contratos_pendientes AS
SELECT
  id,
  email,
  nombre,
  estado,
  contrato_servicio_firmado_at,
  contrato_nda_firmado_at,
  CASE
    WHEN contrato_servicio_firmado_at IS NULL THEN 'servicio'
    WHEN contrato_nda_firmado_at IS NULL THEN 'nda'
    ELSE 'completado'
  END AS proxima_firma,
  fecha_pago
FROM public.leads
WHERE estado IN ('pagado_calentamiento', 'activo')
  AND (contrato_servicio_firmado_at IS NULL OR contrato_nda_firmado_at IS NULL);
