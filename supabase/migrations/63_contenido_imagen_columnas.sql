-- ============================================================================
-- Migración 63: Columnas de imagen en contenido_generado
--
-- Para soportar Studio: cada pieza de contenido puede tener una imagen IA
-- (DALL-E) asociada, editable en el canvas Polotno y descargable.
--
-- INDEPENDIENTE: 100% aditivo. Si Studio falla, contenido_generado sigue
-- funcionando como antes (las columnas viejas no se tocan).
-- ============================================================================

BEGIN;

ALTER TABLE contenido_generado
  ADD COLUMN IF NOT EXISTS imagen_url            text,
  ADD COLUMN IF NOT EXISTS imagen_path           text,
  ADD COLUMN IF NOT EXISTS imagen_prompt         text,
  ADD COLUMN IF NOT EXISTS imagen_modelo         text,
  ADD COLUMN IF NOT EXISTS imagen_size           text,
  ADD COLUMN IF NOT EXISTS imagen_generada_at    timestamptz,
  ADD COLUMN IF NOT EXISTS imagen_canvas_state   jsonb,
  ADD COLUMN IF NOT EXISTS imagen_costo_usd      numeric(8,4),
  ADD COLUMN IF NOT EXISTS imagen_intentos       integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN contenido_generado.imagen_url           IS 'URL pública (firmada o público) de la imagen en bucket contenido-imagenes';
COMMENT ON COLUMN contenido_generado.imagen_path          IS 'Path interno: {lead_id}/{contenido_id}/{timestamp}.png';
COMMENT ON COLUMN contenido_generado.imagen_prompt        IS 'Prompt enviado a DALL-E (editable por el cliente para regenerar)';
COMMENT ON COLUMN contenido_generado.imagen_modelo        IS 'dall-e-3 | otro modelo futuro';
COMMENT ON COLUMN contenido_generado.imagen_size          IS '1024x1024 | 1792x1024 | 1024x1792';
COMMENT ON COLUMN contenido_generado.imagen_canvas_state  IS 'Estado serializado del editor Polotno (para reabrir y seguir editando)';
COMMENT ON COLUMN contenido_generado.imagen_costo_usd     IS 'Costo total acumulado en imagen (suma de generaciones)';

COMMIT;
