-- ============================================================================
-- MIGRACIÓN 29: Personaje ficticio + nuevas preguntas de Niño Interior
--
-- Cambios:
--   1. Agregar a `leads` los campos del personaje (nombre, descripción, fecha).
--   2. Reemplazar las 7 preguntas de journaling del tema Niño Interior (tema_id=4)
--      con la nueva versión alineada a la metodología de Frank (personaje ficticio,
--      trabajo de sombras, 1 año de vida).
--
-- La pregunta del Día 1 es marcador: el frontend la sustituye por el formulario
-- de creación del personaje. Si el cliente ya tiene personaje, se muestra
-- normalmente como pregunta del día.
-- ============================================================================

-- ---------- 1. Columnas de personaje en leads ----------
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS personaje_nombre TEXT,
  ADD COLUMN IF NOT EXISTS personaje_descripcion TEXT,
  ADD COLUMN IF NOT EXISTS personaje_creado_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.personaje_nombre IS
  'Nombre del personaje ficticio que el cliente crea en el Día 1 del programa. Métodologia Deena Metzger — "el otro yo" que carga las mismas piezas que el cliente.';
COMMENT ON COLUMN leads.personaje_descripcion IS
  'Descripción libre del personaje: edad, contexto, personalidad, miedos, secretos. Free-form text guiado por placeholder en UI.';
COMMENT ON COLUMN leads.personaje_creado_at IS
  'Timestamp de cuándo el cliente terminó de crear su personaje. Si NULL, el gate de creación bloquea las preguntas diarias en frontend.';

-- ---------- 2. Reemplazar las 7 preguntas journaling de Niño Interior ----------
-- tema_id=4 (Niño Interior), tipo='journaling', dia_relativo 1..7
UPDATE mensajes
  SET contenido = $$Hoy nace tu personaje. Vas a darle vida a alguien que no eres tú, pero que carga las mismas piezas que tú: tus miedos, tus dones, tus contradicciones. Dale un nombre, edad, dónde vive, a qué se dedica, cómo se ve. Cuenta los primeros párrafos de su historia.

Recuerda: tu personaje tiene un año de vida. Lo que descubra en estos 70 días son las decisiones que va a tomar antes de morir.$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 1;

UPDATE mensajes
  SET contenido = $$Cierra los ojos un momento. Piensa en ti antes de los 7 años. ¿Qué te encantaba hacer? ¿Qué te hacía reír sin razón? ¿Qué te ponía en estado de juego total, donde el tiempo desaparecía? Cuéntame ese juego, ese momento, ese lugar.$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 2;

UPDATE mensajes
  SET contenido = $$Hubo un momento en tu infancia en que algo se apagó. Tal vez alguien se rió de algo tuyo, tal vez te dijeron que pararas de saltar, tal vez un comentario te dejó marcado. ¿Cuál fue tu primera "callada", ese momento donde algo dentro tuyo decidió guardarse?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 3;

UPDATE mensajes
  SET contenido = $$De niño pediste algo. Quizás presencia, quizás abrazos, quizás permiso para llorar, quizás que te escucharan sin corregirte. ¿Qué fue eso que pediste —explícita o silenciosamente— que no llegó? ¿Y cómo aprendiste a vivir sin eso?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 4;

UPDATE mensajes
  SET contenido = $$Hoy, como adulto, hay momentos donde tu reacción es más vieja que tú. Un comentario te tira al piso, una pelea te enmudece, un desafío te paraliza. En ese momento, no estás reaccionando como adulto — está hablando el niño. ¿En qué situaciones notas que ese niño toma el volante?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 5;

UPDATE mensajes
  SET contenido = $$Hay algo que de adulto te encantaría hacer —jugar, bailar, dibujar, cantar, perderte un día sin agenda— y no te das permiso. ¿Qué es? ¿Por qué crees que el adulto que eres hoy considera que no se puede o no se debe?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 6;

UPDATE mensajes
  SET contenido = $$Imagina al niño que fuiste sentado frente a ti. Tiene la edad que tenía cuando algo se apagó. ¿Qué le dirías hoy, desde el adulto que eres? Tres frases que ese niño necesita escuchar, dichas por la voz que tú ya tienes. Después, escribe el pacto que haces con él para abrirle espacio en tu vida actual.$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 7;

-- Verificación (devuelve las 7 filas)
SELECT dia_relativo, LEFT(contenido, 80) AS preview
  FROM mensajes
  WHERE tema_id = 4 AND tipo = 'journaling'
  ORDER BY dia_relativo;
