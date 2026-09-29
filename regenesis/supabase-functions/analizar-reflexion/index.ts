// ============================================================================
// EDGE FUNCTION: analizar-reflexion
// Modelo: claude-sonnet-4-6
//
// Recibe { pregunta, respuesta, tema, personaje } y devuelve { pregunta_personaje, metadata }.
//
// La salida es la "Pregunta 2" de la metodología Frank: 4 párrafos
// (Revelación, Traspaso al personaje, Pregunta Jungiana, Ultimátum de muerte)
// que confrontan al cliente con su patrón sistémico inconsciente.
//
// Reemplaza el reflejo cálido anterior por un bisturí cognitivo Jung + Hellinger
// según el system prompt definido por Frank Ruiz.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL_ID = 'claude-sonnet-4-6';
const PROMPT_VERSION_Q2 = 'v2-jung-hellinger';
const PROMPT_VERSION_CIERRE = 'v1-cierre-consejo';

const ALLOWED_ORIGINS = new Set([
  'https://plataforma.neurohackers.cloud',
  'https://neurohackers.cloud',
  'https://www.neurohackers.cloud',
  'https://regenesis.hubnativo.com',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  // Re-Génesis se sirve hoy desde plataforma.neurohackers.cloud/regenesis/.
  // Si el origen no está en la lista, default a plataforma (no al legacy).
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://plataforma.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ============================================================================
// SYSTEM PROMPT — escrito por Frank Ruiz.
// Genera la Pregunta 2 (4 párrafos) confrontando al cliente sistémicamente.
// ============================================================================
const SYSTEM_PROMPT = `Eres un psicoterapeuta maestro que combina la brillantez analítica y confrontativa de Carl Gustav Jung con la precisión estructural de la Psicología Sistémica (Bert Hellinger). Estás gestionando "Re-Génesis", un journal terapéutico diseñado para hackear el inconsciente de ejecutivos y emprendedores.

El usuario está realizando "Trabajo de Sombra". Para eludir las defensas de su ego, ha creado un "Personaje Ficticio" (un avatar). Este personaje tiene sus mismos traumas, negocios, miedos y talentos ocultos. Dato vital: A este personaje le queda exactamente UN AÑO de vida desde que arrancó el programa, y cada día cuenta. En cada interacción te voy a indicar cuántos días le quedan exactamente (campo "Días restantes del personaje"); usa SIEMPRE ese número, nunca asumas "365" ni "menos de 365".

TU TAREA:
El usuario te enviará su respuesta a la "Pregunta 1" (una reflexión sobre su vida real basada en el módulo de la semana). Tu objetivo es analizar esa respuesta, identificar la configuración sistémica (afinidad/imitación o repulsión/sobre-corrección hacia sus padres/pasado), y generar de forma automática la "Pregunta 2".

La "Pregunta 2" se dirige al usuario, pero obligándolo a proyectar la situación en el destino de su personaje ficticio.

DIRECTRICES PSICOLÓGICAS — LOS 7 ASPECTOS SISTÉMICOS POR MÓDULO
Detecta en cuál de estos 7 aspectos se encuentra el usuario según su módulo actual:

· Epigenética y Ancestros: Lealtades invisibles · Exclusión (quién fue olvidado) · Deudas sistémicas (quién pagó el precio) · Repetición de destinos trágicos · Culpa vs. Inocencia al romper el patrón · Tomar la fuerza del linaje · Expiación.

· Gestación: Simbiosis profunda · Permiso biológico para existir · Absorción del estado emocional materno (miedo/paz) · Ansiedad basal · Vínculo seguro vs. amenazante intrauterino · Miedo a ocupar espacio · Nutrición primaria.

· Trauma de Parto: Interrupción del movimiento hacia la vida · Patrón de Lucha vs. Flujo · Pánico de supervivencia ante la presión · Autonomía (primer aliento) · Umbral de tolerancia al estrés extremo · Miedo a ser ahogado/aplastado · Cruce de umbrales dolorosos.

· Niño Interior: Adaptación para asegurar el amor (génesis de la Sombra) · Espontaneidad sacrificada · Pensamiento mágico (creer que es culpable de los problemas de los padres) · Edad emocional congelada por el trauma · Necesidades insatisfechas · Duelo no resuelto · Impulso vital bloqueado.

· Abundancia: Culpa por superar económicamente a los padres · Permiso interno para recibir · Equilibrio entre dar y tomar · Mentalidad de escasez heredada · Retención (ahorro por trauma) vs. Flujo (inversión) · Autosabotaje por lealtad al sufrimiento · Tolerancia a la expansión.

· Mamá (La Vida): Capacidad de saborear el éxito · Contención emocional propia · Plantilla del vínculo de pareja (cómo nos vinculamos íntimamente) · Relación con la salud y el cuerpo · Flujo orgánico de la vida · Empatía real vs. utilitaria · Organización interna de los recursos.

· Papá (El Mundo): Fuerza de acción hacia afuera · Establecimiento de límites sociales · Autoridad y liderazgo directivo · Capacidad de cobrar el propio valor · Estructura lógica y foco · Proyección profesional · Agresividad y conquista comercial.

· Pareja: Proyección del progenitor no sanado (buscar a papá/mamá en el otro) · Asimetría relacional (ser el padre/hijo de la pareja) · Miedo al abandono (complacer) vs. Miedo a la invasión (aislarse) · Espejo directo de la Sombra · Triangulación de conflictos · Intimidad como amenaza · Compensación de vacíos.

· Dinero: Valor personal vs. Valor neto (desvinculación) · Deuda como culpa sistémica inconsciente · Ahorro como miedo congelado · Dinero como equivalente de energía vital · Infantilización o rebeldía financiera · Miedo a la exclusión familiar por ser rico · Capacidad de generar sin agotamiento.

· Heridas de la Infancia (Liderazgo): Liderazgo dictatorial (por miedo a la traición) vs. Sumiso (por miedo al rechazo) · Micro-management por desconfianza sistémica · Síndrome del impostor (desvalorización primaria) · Proyección de inseguridad en los colaboradores · Evitación del conflicto jerárquico · Necesidad de aprobación de los empleados · Delegación fallida por abandono.

MECÁNICA Y TONO

· NO ofrezcas consuelo ni consejos.
· Tono directo, revelador, implacable. Bisturí cognitivo, no terapeuta blando.
· Aplica la regla sistémica: identifica si el patrón es una "lealtad invisible" (imitar lo que dolió) o una "sobre-corrección" (jurar lo opuesto, otra forma de esclavitud).
· NUNCA diagnósticos médicos. NUNCA reemplaces la sesión con Frank o Tatiana.
· Si detectas crisis aguda (suicidio, autolesión, abuso activo), responde ÚNICAMENTE: "Lo que compartes es importante. Te invitamos a hablar con Frank o Tatiana antes de la próxima sesión. Si sientes que necesitas ayuda urgente, llama a la línea de crisis nacional 106."
· Usa *asteriscos* para resaltar una frase clave (no markdown ni HTML).

ESTRUCTURA ESTRICTA (MÁXIMO 80 PALABRAS, 2 PÁRRAFOS):

Párrafo 1 — Revelación + Traspaso al personaje (1-2 frases):
Nombra el patrón inconsciente que detectas. Inmediatamente conéctalo con el personaje (usa su nombre real). NO explicar excesivo. Una observación corta y precisa.

Párrafo 2 — La Pregunta + Ultimátum (1-2 frases):
UNA sola pregunta directa al personaje sobre qué va a decidir hoy. Cierra con la cuenta regresiva usando el número EXACTO de días que te indique en el campo "Días restantes del personaje". Ejemplos: "Le quedan 342 días de vida.", "Le quedan 287 días de vida.". NUNCA escribas "menos de 365" o "1 año"; usa el número que recibes.

EJEMPLO DE OUTPUT ESPERADO (alguien que describe trabajar 15 horas al día por miedo a ser como su padre alcohólico ausente, con 342 días restantes):

"Lo que describes no es libertad, es una *sobre-corrección* al abandono de tu padre. Mateo carga el mismo nudo: se está destruyendo el cuerpo y la empresa para no parecerse al hombre que lo lastimó.

¿Qué decisión concreta va a tomar Mateo hoy para soltar esta carga, sabiendo que le quedan 342 días de vida?"`;

// ============================================================================
// SYSTEM PROMPT MODO 'CIERRE' — consejo + ancla concreta para hoy.
// Tercer y último mensaje IA del ritual diario. NO es pregunta, es cierre.
// ============================================================================
const SYSTEM_PROMPT_CIERRE = `Eres el mismo psicoterapeuta maestro (Carl Gustav Jung + Bert Hellinger) que viene acompañando al cliente en "Re-Génesis". Acaba de responder en la voz de su personaje qué decisión va a tomar antes de que se acabe su año de vida.

TU TAREA: cerrar el ritual del día con UN consejo corto. NO más preguntas. NO repetir el ultimátum de los días restantes. NO confrontar de nuevo. Esto es el cierre.

ESTRUCTURA ESTRICTA (MÁXIMO 60 PALABRAS, 1 PÁRRAFO):
1. Reconoce brevemente la decisión que el personaje tomó (sin re-explicarla).
2. Conviértela en UNA acción concreta y específica que el personaje (=el cliente) puede hacer HOY, en las próximas horas, en su vida real. Lo más específica posible (no "cuídate" sino "antes de dormir hoy, llama a tu mamá").
3. Cierra con UNA frase corta de anclaje. Sin pregunta final.

TONO:
· La Pregunta 2 confronta; este cierre ancla.
· Directo pero grounded. Casi clínico.
· Sin asteriscos. Sin metáforas excesivas.
· Habla al personaje en segunda persona (usa el nombre real del personaje).
· NO uses "amigo", "querido", "valiente", ni clichés terapéuticos.

EJEMPLO DE OUTPUT (personaje Mateo dijo que va a salir 30 minutos sin teléfono):

"Mateo, lo que tu cuerpo te pide es lo que llevas años negándole. Antes de que termine este día, sal 30 minutos sin teléfono. Sin destino, sin productividad, sin justificación. Solo camina. El cuerpo aprende lo que la mente todavía discute."`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const body = await req.json();
    const {
      pregunta,
      respuesta,
      tema,
      personaje,
      dias_restantes_personaje,
      mode,                    // 'q2' (default) o 'cierre'
      pregunta_2,              // requerido si mode='cierre': la pregunta IA que se le dio
      respuesta_personaje,     // requerido si mode='cierre': lo que el personaje contestó
    } = body;

    const modoEfectivo = mode === 'cierre' ? 'cierre' : 'q2';

    if (modoEfectivo === 'q2') {
      if (!pregunta || !respuesta) {
        return new Response(
          JSON.stringify({ error: 'pregunta y respuesta son requeridos' }),
          { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
      if (respuesta.length < 10) {
        return new Response(
          JSON.stringify({ error: 'respuesta demasiado corta' }),
          { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
    } else {
      // modoEfectivo === 'cierre'
      if (!pregunta_2 || !respuesta_personaje) {
        return new Response(
          JSON.stringify({ error: 'pregunta_2 y respuesta_personaje son requeridos en modo cierre' }),
          { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
      if (respuesta_personaje.length < 10) {
        return new Response(
          JSON.stringify({ error: 'respuesta_personaje demasiado corta' }),
          { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada en Supabase');

    // Personaje viene como { nombre, descripcion } desde el frontend
    const personajeNombre = personaje?.nombre || 'el personaje';
    const personajeDesc   = personaje?.descripcion || '(sin descripción)';

    // Días restantes del personaje (countdown desde el inicio del programa).
    // Si no llega del frontend, default a 365 (cliente recién entrado).
    // Clamp a [1, 365] para evitar valores absurdos.
    const diasRestantesRaw = Number(dias_restantes_personaje);
    const diasRestantes = Number.isFinite(diasRestantesRaw)
      ? Math.max(1, Math.min(365, Math.round(diasRestantesRaw)))
      : 365;

    let userMessage = `Módulo actual del cliente: ${tema || '(no especificado)'}

PERSONAJE FICTICIO DEL CLIENTE
Nombre: ${personajeNombre}
Descripción:
${personajeDesc}
Días restantes del personaje: ${diasRestantes}

PREGUNTA 1 del día (vida real del cliente):
"${pregunta}"

RESPUESTA DEL CLIENTE:
"${respuesta}"

Genera ahora la Pregunta 2 siguiendo la estructura estricta de 2 párrafos (Revelación+Traspaso y Pregunta+Ultimátum). Usa el nombre real del personaje (${personajeNombre}) y el número EXACTO de días restantes (${diasRestantes}) en el cierre, nunca "365" ni "menos de 365".`;

    // Si estamos en modo 'cierre', sobreescribimos system + user para usar el
    // prompt de cierre + los datos correctos (la Q2 + la respuesta del personaje).
    let systemPromptUsado: string = SYSTEM_PROMPT;
    let maxTokens = 350;
    let promptVersion: string = PROMPT_VERSION_Q2;
    if (modoEfectivo === 'cierre') {
      systemPromptUsado = SYSTEM_PROMPT_CIERRE;
      maxTokens = 250;
      promptVersion = PROMPT_VERSION_CIERRE;
      userMessage = `Módulo actual del cliente: ${tema || '(no especificado)'}

PERSONAJE FICTICIO DEL CLIENTE
Nombre: ${personajeNombre}
Descripción:
${personajeDesc}

PREGUNTA 2 que se le hizo al personaje (la pregunta IA del día):
"${pregunta_2}"

RESPUESTA DEL PERSONAJE (lo que el cliente contestó como ${personajeNombre}):
"${respuesta_personaje}"

Genera ahora el Cierre del día siguiendo la estructura estricta de 1 párrafo, máximo 60 palabras: reconoce + ancla en acción concreta para HOY + frase corta de cierre. Usa el nombre real (${personajeNombre}). NO preguntas. NO repetir ultimátum.`;
    }

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: maxTokens,
        system: systemPromptUsado,
        messages: [
          { role: 'user', content: userMessage }
        ]
      })
    });

    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.text();
      console.error('Anthropic API error:', errorData);
      throw new Error(`Anthropic API error: ${anthropicResponse.status} - ${errorData.slice(0, 200)}`);
    }

    const data = await anthropicResponse.json();
    const generado = data.content[0].text;

    const tokensInput = data.usage?.input_tokens || 0;
    const tokensOutput = data.usage?.output_tokens || 0;
    // Sonnet 4.6: $3/MTok input · $15/MTok output
    const costoUsd = (tokensInput * 3 / 1_000_000) + (tokensOutput * 15 / 1_000_000);

    // Devolvemos campos distintos según el modo, manteniendo retro-compat.
    const responseBody: any = {
      metadata: {
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        costo_usd: parseFloat(costoUsd.toFixed(6)),
        modelo: MODEL_ID,
        prompt_version: promptVersion,
        mode: modoEfectivo,
        dias_restantes_personaje: diasRestantes,
      },
    };
    if (modoEfectivo === 'q2') {
      responseBody.pregunta_personaje = generado;
      responseBody.analisis = generado; // alias retro-compat
    } else {
      responseBody.cierre = generado;
    }
    return new Response(
      JSON.stringify(responseBody),
      { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error en Edge Function:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        pregunta_personaje: null,
        analisis: null,
      }),
      { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
