-- ============================================================================
-- MIGRACIÓN 30: Pregunta 2 (al personaje) + respuesta del personaje
--
-- Frank pidió que después de cada Q1 respondida, una IA (Jung + Hellinger)
-- analice la respuesta y genere una segunda pregunta dirigida al personaje
-- ficticio del cliente — 4 párrafos: Revelación, Traspaso, Pregunta Jungiana,
-- Ultimátum de Muerte.
--
-- Esta migración agrega las columnas para guardar Q2 y la respuesta del
-- cliente al personaje. Cada fila de journaling_respuestas queda con:
--   - pregunta_original + respuesta_cliente (Q1 ya existente)
--   - pregunta_personaje + respuesta_personaje (Q2 nueva)
-- ============================================================================

ALTER TABLE journaling_respuestas
  ADD COLUMN IF NOT EXISTS pregunta_personaje TEXT,
  ADD COLUMN IF NOT EXISTS respuesta_personaje TEXT,
  ADD COLUMN IF NOT EXISTS respuesta_personaje_at TIMESTAMPTZ;

COMMENT ON COLUMN journaling_respuestas.pregunta_personaje IS
  'Q2 — 4 párrafos generados por IA (system prompt de Frank: Jung + Hellinger) después de que el cliente respondió Q1. Estructura: Revelación, Traspaso al personaje, Pregunta Jungiana, Ultimátum de muerte.';

COMMENT ON COLUMN journaling_respuestas.respuesta_personaje IS
  'Respuesta del cliente a Q2 — escrita en la voz del personaje ficticio. Opcional, puede quedar NULL si el cliente no responde Q2 ese día.';

COMMENT ON COLUMN journaling_respuestas.respuesta_personaje_at IS
  'Timestamp de cuando el cliente envió la respuesta del personaje.';
