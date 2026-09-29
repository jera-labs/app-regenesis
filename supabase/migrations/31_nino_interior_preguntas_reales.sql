-- ============================================================================
-- MIGRACIÓN 31: Niño Interior — 7 preguntas reales (sin gate de personaje)
--
-- Contexto: la migración 29 dejó el Día 1 de Niño Interior como un placeholder
-- de creación de personaje. Eso funcionó como gate inicial, pero ahora el gate
-- vive en el frontend (client-app.js) como verificación global previa a cualquier
-- pregunta, no atado a tema/día. Por eso podemos devolver las 7 preguntas reales
-- de Niño Interior con la nueva lente: identificar patrones, hacer visible el
-- sistema de creencias, y nombrar los resultados que esos patrones generan en
-- la vida adulta del cliente hoy.
--
-- Esto también prepara el camino para los demás 9 temas: cada uno tendrá sus
-- 7 preguntas completas, sin perder ninguna como placeholder.
-- ============================================================================

-- Día 1 — La energía del niño (recordar + ver dónde sigue / dónde se apagó)
UPDATE mensajes
  SET contenido = $$Hoy nos asomamos al niño que fuiste. Antes de los 7 años había una versión tuya completa: sin máscaras, sin estrategia, sin necesidad de demostrar nada. Recuerda un momento concreto donde te sentiste pleno, libre, vivo. Cuéntamelo en detalle: dónde estabas, con quién, qué hacías, qué sentías en el cuerpo. Y mira hoy: ¿cuándo fue la última vez que sentiste algo similar en tu vida adulta? ¿Qué te lo está bloqueando?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 1;

-- Día 2 — La energía perdida y lo que te cuesta hoy
UPDATE mensajes
  SET contenido = $$Antes de los 7 años algo te encendía: un juego, un lugar, una sensación donde el tiempo desaparecía. ¿Qué era? Ahora mírate hoy: ¿en qué actividades de tu vida adulta sigues sintiendo esa misma chispa, y en cuáles ya no la encuentras? Lo que se apagó no se apagó solo. ¿Qué precio te está cobrando hoy en tu trabajo, tu cuerpo o tus relaciones?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 2;

-- Día 3 — Lo que callaste entonces, lo que sigues callando
UPDATE mensajes
  SET contenido = $$Hubo un momento en tu infancia donde algo dentro tuyo decidió guardarse: alguien se rió, te corrigieron, te enseñaron que "eso no se hace". ¿Cuál fue tu primera "callada"? Y la pregunta clave: hoy, en tu vida adulta, ¿qué sigues callando por esa misma razón? Identifica situaciones concretas de las últimas semanas donde te callaste cuando algo dentro tuyo quería hablar (en reuniones, con tu pareja, con tu equipo, con tu familia).$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 3;

-- Día 4 — Lo que pediste, la historia que te contaste, cómo decides hoy
UPDATE mensajes
  SET contenido = $$De niño pediste algo y no llegó: quizás presencia, quizás abrazos, quizás permiso para llorar, quizás que te escucharan sin corregirte. ¿Qué fue? Cuando lo que pides no llega, el niño se inventa una historia para sobrevivir: "no merezco", "no es seguro pedir", "tengo que arreglármelas solo", "si lloro me rechazan". ¿Cuál fue la tuya? Y ahora mírate hoy: ¿en qué decisiones recientes (laborales, familiares, financieras) sigues operando desde esa misma creencia?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 4;

-- Día 5 — Las situaciones donde el niño toma el volante hoy
UPDATE mensajes
  SET contenido = $$Hay momentos hoy donde tu reacción es más vieja que tú: un comentario te tumba, una crítica te paraliza, una pelea te enmudece, un cliente te activa fuera de proporción. Identifica 2 o 3 situaciones recientes (últimas 4 semanas) donde notaste que el niño tomó el volante. ¿Qué tienen en común esas situaciones? Ese común es el botón que sigue prendido, y es el que está dictando resultados en tu vida adulta sin que te des cuenta.$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 5;

-- Día 6 — El permiso que sigues negándote
UPDATE mensajes
  SET contenido = $$Hay algo que harías como adulto si te dieras permiso: jugar, bailar, descansar sin culpa, equivocarte sin castigarte, parar de producir un día completo, pedir ayuda. ¿Qué es? Detrás de cada "no me lo permito" hay una creencia heredada de la infancia. Nómbrala: ¿qué te dijeron, directa o indirectamente, que hoy te sigue justificando ese "no se puede"? Y el resultado: ¿qué te está costando, en tu cuerpo o en tu vida, vivir desde esa prohibición?$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 6;

-- Día 7 — Las tres frases y el pacto observable
UPDATE mensajes
  SET contenido = $$Imagina al niño que fuiste sentado frente a ti. Tiene la edad que tenía cuando algo se apagó. Dile tres frases que necesita escuchar, dichas con la voz que tú ya tienes hoy. Después escribe el pacto, pero esta vez concreto: ¿qué vas a permitirte hacer esta semana que antes no te permitías? ¿En qué situación específica vas a hablar cuando antes te callabas? Un cambio observable, en los próximos 7 días, que el niño y el adulto puedan ver pasar.$$,
      updated_at = NOW()
  WHERE tema_id = 4 AND tipo = 'journaling' AND dia_relativo = 7;

-- Verificación
SELECT dia_relativo, LEFT(contenido, 100) AS preview
  FROM mensajes
  WHERE tema_id = 4 AND tipo = 'journaling'
  ORDER BY dia_relativo;
