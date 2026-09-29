-- ============================================================================
-- Migración 45: Eliminar columnas huérfanas en `leads`
--
-- Razón: 11 columnas que están en la tabla pero NO se capturan en ningún form
-- actual (DNA, cuenta, productos, calculadoras) ni se llenan vía webhook GHL ni
-- sync-ghl-perfil. Verificado: 0/11 clientes activos tienen valor en estas
-- columnas. Tampoco aparecen referenciadas en migraciones, edge functions,
-- código JS/HTML.
--
-- Origen probable: legacy de la versión vieja de Re-Génesis (cuestionario
-- pre-pago) que nunca se migró al nuevo flow. Quedaron en la tabla sin uso.
--
-- Si en el futuro Frank pide alguno de estos datos, se agrega via:
-- 1) form en el DNA → migración INSERT column
-- 2) custom field en GHL del closer → workflow + sync-ghl-perfil
-- ============================================================================

BEGIN;

ALTER TABLE leads
  DROP COLUMN IF EXISTS profesion,
  DROP COLUMN IF EXISTS rango_ingresos,
  DROP COLUMN IF EXISTS estado_civil,
  DROP COLUMN IF EXISTS tiene_hijos,
  DROP COLUMN IF EXISTS edad_aproximada,
  DROP COLUMN IF EXISTS dolor_principal,
  DROP COLUMN IF EXISTS dolor_categoria,
  DROP COLUMN IF EXISTS motivacion_para_cambio,
  DROP COLUMN IF EXISTS expectativa_resultado,
  DROP COLUMN IF EXISTS intentos_previos,
  DROP COLUMN IF EXISTS pref_whatsapp;

COMMIT;

-- Quedan `pref_email` y `pref_plataforma` porque sí están llenos en 11/11
-- clientes activos (defaults true desde webhook-ghl) y representan el canal de
-- notificación. Si el día de mañana queremos eliminarlos, basta drop column
-- en una migración futura.
