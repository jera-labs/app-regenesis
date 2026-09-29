-- ============================================================================
-- Migración 46: CRM Core expandido · columnas en leads
--
-- Agrega campos del informe Bluehackers adaptados a Neurohackers:
-- - Vehículo, nicho, promesa, arquetipo del cliente.
-- - Fechas operativas del programa (activación, fin contractual, primera venta, etc).
-- - Churn tracking (cuándo y por qué se fue).
-- - Cohortes (segmentación).
-- - Contadores operativos (sesiones realizadas, próxima sesión).
--
-- DURACIÓN PROGRAMA DEFAULT: 70 días (10 semanas Re-Génesis) en vez de 120 del
-- informe. Es configurable vía config_automatizaciones.dias_programa_default
-- (migración 47).
--
-- INDEPENDENCIA: 100% aditivo. Solo ADD COLUMN IF NOT EXISTS. No toca columnas
-- existentes, no toca leads.estado, no toca triggers, no toca crons. Si esta
-- migración falla, nada se rompe.
-- ============================================================================

BEGIN;

ALTER TABLE leads
  -- Vehículo y posicionamiento del negocio del cliente
  ADD COLUMN IF NOT EXISTS vehiculo_negocio text,
  ADD COLUMN IF NOT EXISTS nicho_mercado text,
  ADD COLUMN IF NOT EXISTS promesa_transformacion text,
  ADD COLUMN IF NOT EXISTS precio_oferta_principal_usd numeric(12,2),
  ADD COLUMN IF NOT EXISTS ltv_oferta_principal_usd numeric(12,2),
  ADD COLUMN IF NOT EXISTS segmento_arquetipo text,

  -- Cohorte (FK a tabla cohortes que se crea en migración 47)
  ADD COLUMN IF NOT EXISTS cohorte_id uuid,

  -- Fechas operativas del programa
  ADD COLUMN IF NOT EXISTS fecha_activacion_programa date,
  ADD COLUMN IF NOT EXISTS duracion_contractual_dias integer DEFAULT 70,
  ADD COLUMN IF NOT EXISTS fecha_fin_contractual date,
  ADD COLUMN IF NOT EXISTS monto_total_programa_usd numeric(12,2),

  -- Hitos del cliente con Neurohackers
  ADD COLUMN IF NOT EXISTS launched_at timestamptz,
  ADD COLUMN IF NOT EXISTS primera_venta_at timestamptz,
  ADD COLUMN IF NOT EXISTS caso_exito_at timestamptz,

  -- Churn (cuándo y por qué se fue)
  ADD COLUMN IF NOT EXISTS churn_at timestamptz,
  ADD COLUMN IF NOT EXISTS churn_motivo text,
  ADD COLUMN IF NOT EXISTS churn_categoria text,

  -- Contadores de sesiones 1:1 (se llenan en fase 6)
  ADD COLUMN IF NOT EXISTS proxima_sesion_at timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_sesion_at timestamptz,
  ADD COLUMN IF NOT EXISTS sesiones_realizadas integer DEFAULT 0;

-- Índices para queries comunes (admin filtra mucho por estos)
CREATE INDEX IF NOT EXISTS leads_cohorte_id_idx ON leads(cohorte_id);
CREATE INDEX IF NOT EXISTS leads_segmento_arquetipo_idx ON leads(segmento_arquetipo) WHERE segmento_arquetipo IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_churn_at_idx ON leads(churn_at) WHERE churn_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_fecha_activacion_programa_idx ON leads(fecha_activacion_programa) WHERE fecha_activacion_programa IS NOT NULL;

-- Comentarios para que el equipo entienda cada campo
COMMENT ON COLUMN leads.vehiculo_negocio IS 'Vehículo del negocio del cliente (coaching, infoproducto, servicio, agencia, SaaS, etc.)';
COMMENT ON COLUMN leads.nicho_mercado IS 'Nicho/mercado específico del cliente (ej. founders SaaS B2B, coaches de salud)';
COMMENT ON COLUMN leads.promesa_transformacion IS 'Transformación tangible que el cliente ofrece (ej. 20% más conversión en 30 días)';
COMMENT ON COLUMN leads.precio_oferta_principal_usd IS 'Precio que el cliente cobra por su oferta principal (no lo que nos paga a nosotros)';
COMMENT ON COLUMN leads.ltv_oferta_principal_usd IS 'LTV estimado de un cliente del cliente (precio + upsells + recurrencia)';
COMMENT ON COLUMN leads.segmento_arquetipo IS 'Arquetipo Neurohackers: Explorador / Constructor / Escalador / Consolidador';
COMMENT ON COLUMN leads.cohorte_id IS 'FK a cohortes (Mayo-2026, Black-Friday, etc.). NULL para clientes pre-cohortes.';
COMMENT ON COLUMN leads.fecha_activacion_programa IS 'Día que el cliente arrancó el programa (después de calentamiento). Trigger en fase 9 lo setea automático al pasar a activo.';
COMMENT ON COLUMN leads.duracion_contractual_dias IS 'Días de programa. Default 70 (10 semanas Re-Génesis). Configurable por cohorte en el futuro.';
COMMENT ON COLUMN leads.fecha_fin_contractual IS 'fecha_activacion_programa + duracion_contractual_dias. Calculada en trigger fase 9.';
COMMENT ON COLUMN leads.monto_total_programa_usd IS 'Lo que el cliente nos paga en total (incluye cuotas). Snapshot inmutable.';
COMMENT ON COLUMN leads.launched_at IS 'Cuando el cliente lanza su oferta validada al mercado (KPI velocidad time-to-launch)';
COMMENT ON COLUMN leads.primera_venta_at IS 'Cuando el cliente registra su primera venta dentro del programa (KPI time-to-first-sale)';
COMMENT ON COLUMN leads.caso_exito_at IS 'Cuando el cliente alcanza el umbral de caso de éxito. Trigger lo setea desde liquidación de hitos.';
COMMENT ON COLUMN leads.churn_at IS 'Timestamp de salida del programa. Obligatorio cuando lead_estado_comercial pasa a estado terminal (fase 2).';
COMMENT ON COLUMN leads.churn_motivo IS 'Razón libre que el admin escribe al churnear';
COMMENT ON COLUMN leads.churn_categoria IS 'Categoría enum: financiero, salud, socio, insatisfaccion, cambio_prioridades, otro. Lista configurable en config_automatizaciones.';
COMMENT ON COLUMN leads.proxima_sesion_at IS 'Cuándo es la próxima sesión 1:1. Trigger en fase 6 lo actualiza.';
COMMENT ON COLUMN leads.ultima_sesion_at IS 'Cuándo fue la última sesión 1:1 registrada.';
COMMENT ON COLUMN leads.sesiones_realizadas IS 'Contador atómico. Trigger en fase 6 incrementa al aprobar QC. Alcanzar 16 dispara etiqueta "desvincular".';

COMMIT;
