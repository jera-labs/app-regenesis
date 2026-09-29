// ============================================
// Re-Génesis — Servicio IA (Edge Function)
// ============================================
// Wrapper de la Edge Function `analizar-reflexion`.
// Pasa el JWT del usuario logueado para que la función
// pueda registrar costos y autoría.

(function () {
  'use strict';

  async function analizarReflexion(pregunta, respuesta, tema, personaje, diasRestantesPersonaje) {
    return await callEdgeFunction({
      pregunta, respuesta, tema, personaje,
      dias_restantes_personaje: diasRestantesPersonaje,
      mode: 'q2',
    });
  }

  // Cierre del día: tercer y último mensaje IA del ritual diario. Recibe la
  // Pregunta 2 y la respuesta del personaje, devuelve un consejo + acción
  // concreta. NO es pregunta, es cierre. Máximo 60 palabras, 1 párrafo.
  async function generarCierre(temaNombre, personaje, preguntaQ2, respuestaPersonaje) {
    return await callEdgeFunction({
      tema: temaNombre,
      personaje,
      pregunta_2: preguntaQ2,
      respuesta_personaje: respuestaPersonaje,
      mode: 'cierre',
    });
  }

  async function callEdgeFunction(body) {
    // Soporta tanto NEURO_CONFIG (plataforma.neurohackers.cloud) como
    // REGENESIS_CONFIG (neurohackers.cloud legacy).
    const cfg = window.NEURO_CONFIG || window.REGENESIS_CONFIG || {};
    const supabaseUrl = cfg.SUPABASE_URL;
    const url = cfg.EDGE_FUNCTION_ANALIZAR
      || (supabaseUrl ? `${supabaseUrl}/functions/v1/analizar-reflexion` : '');
    const anonKey = cfg.SUPABASE_ANON_KEY;

    const sessionResp = await window.db.auth.getSession();
    const accessToken = sessionResp?.data?.session?.access_token;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken || anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      let detalle = '';
      try {
        const err = await response.json();
        detalle = err?.error || err?.message || '';
      } catch (_) { /* respuesta sin JSON */ }
      throw new Error(`Edge Function ${response.status}${detalle ? ' · ' + detalle : ''}`);
    }

    const data = await response.json();
    return {
      pregunta_personaje: data.pregunta_personaje || data.analisis || '',
      analisis: data.analisis || data.pregunta_personaje || '',
      cierre: data.cierre || '',
      metadata: data.metadata || {},
    };
  }

  window.iaService = { analizarReflexion, generarCierre };
})();
