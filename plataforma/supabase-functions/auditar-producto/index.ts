// ============================================================================
// EDGE FUNCTION: auditar-producto (v2)
// Modelo: claude-sonnet-4-6
//
// Audita un producto del cliente usando TODO el contexto disponible:
//   - El producto en sí (nombre, precio, promesa, ICP, entregables)
//   - La esencia del cliente (voz, valores, palabras SÍ/NO, ICP marca)
//   - El estado de su negocio (facturación, modelo, equipo, competencia)
//   - Su diagnóstico Neurohackers (códigos corruptos, miedos, techo financiero)
//
// Modo de invocación:
//   POST con { producto_id, lead_id }  → lee todo de Supabase con JWT del user
//   POST con campos directos           → modo legacy (compatibilidad)
//
// Output: JSON estructurado con salud_score + diagnóstico + 3 tareas.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL_ID = 'claude-sonnet-4-6';
const PROMPT_VERSION = 'v2-auditoria-con-perfil-completo';

const ALLOWED_ORIGINS = new Set([
  'https://plataforma.neurohackers.cloud',
  'https://neurohackers.cloud',
  'https://www.neurohackers.cloud',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://plataforma.neurohackers.cloud';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const SYSTEM_PROMPT = `Eres consultor experto en marketing y ventas B2B con foco en consultores, asesores, agentes inmobiliarios, asesores de seguros y prestadores de servicios profesionales que facturan $0-$100K USD/mes.

Tu trabajo: auditar UN producto/servicio específico de un cliente del programa Neurohackers (meta: facturar $20K-$50K extra en 6 meses). El cliente ya te dio su esencia de marca, info de su negocio y su diagnóstico profundo. Úsalos todos.

REGLAS DURAS:
- Output SIEMPRE JSON válido. Sin texto antes ni después. Sin bloques markdown.
- Shape exacto:
  {
    "salud_score": <int 0-100>,
    "diagnostico": "<string, máx 320 caracteres, 2-3 frases>",
    "fortaleza": "<string, máx 140 caracteres>",
    "tareas": [
      {"titulo":"...", "detalle":"...", "prioridad":"alta|media|baja", "esfuerzo_min":<int>, "asistencia_ia":"completa|parcial|ninguna"}
    ]
  }
- EXACTAMENTE 3 tareas.

CONTEXTO QUE TE DAMOS Y CÓMO USARLO:
1. Producto a auditar: la pieza concreta.
2. Esencia del cliente (si está): adapta el tono del diagnóstico y de las tareas a su voz. Si lista "palabras_no", NUNCA las uses.
3. Negocio (si está): el salud_score y las tareas deben considerar el gap entre facturación actual y meta. Si está debajo de su meta, prioriza tareas de tráfico/cierre, no de optimización de embudo avanzada.
4. Diagnóstico (si está): si el cliente identificó códigos corruptos o miedos, una de las tareas puede mencionar suavemente esa raíz emocional ("este paso te confronta con tu patrón de X" sin volverse terapéutico).

CRITERIOS DE EVALUACIÓN:
1. Promesa tangible y medible
2. ICP definido por situación de negocio
3. Coherencia precio vs transformación entregada
4. Siguiente escalón claro
5. Entregables específicos
6. Match con la voz del cliente (si está su esencia)

PUNTUACIÓN:
- 90-100: listo para escalar
- 70-89: viable con un ajuste clave
- 50-69: tiene huesos pero la promesa o ICP están turbios
- 30-49: confuso, hay que reformular
- 0-29: no es producto todavía, empaquetar MVP

TONO DE TAREAS:
- Directas, accionables, en la voz del cliente cuando tienes su esencia.
- Si el producto es débil, una tarea = reformularlo, no maquillarlo.
- Si el cliente NO te dio esencia, usa un tono neutro profesional.

Ejemplo de output válido:
{"salud_score":78,"diagnostico":"Tu Auditoría Express tiene ICP claro y entregables específicos. El cuello de botella es la promesa: comunica el proceso, no el resultado medible.","fortaleza":"Entregables específicos y siguiente escalón coherente.","tareas":[{"titulo":"Reescribir el hero con ancla numérica","detalle":"Cambiar a 'Recupera 20-40% de conversiones perdidas en 30 días'.","prioridad":"alta","esfuerzo_min":15,"asistencia_ia":"completa"},{"titulo":"Capturar caso de éxito con número medible","detalle":"Pedir a Carlos M. testimonio con la cifra de leads recuperados.","prioridad":"media","esfuerzo_min":30,"asistencia_ia":"parcial"},{"titulo":"Llamar a los 5 leads sin respuesta","detalle":"Probabilidad alta de cierre si reactivas hoy.","prioridad":"alta","esfuerzo_min":45,"asistencia_ia":"ninguna"}]}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const body = await req.json();
    let { producto_id, lead_id, nombre, tipo, precio, moneda, descripcion, promesa, icp, entregables, siguiente_escalon } = body;

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const authHeader = req.headers.get('Authorization');

    let producto: any = null, esencia: any = null, negocio: any = null, diagnostico: any = null, lead: any = null;

    // Modo "rich context": si recibimos producto_id, leemos de la BD con el JWT del user
    if (producto_id && authHeader && SUPABASE_URL && ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });

      const { data: pData } = await supabase.from('productos').select('*').eq('id', producto_id).maybeSingle();
      if (pData) {
        producto = pData;
        lead_id = lead_id || pData.lead_id;
        nombre = nombre || pData.nombre;
        tipo = tipo || pData.tipo;
        precio = precio || pData.precio;
        moneda = moneda || pData.moneda;
        descripcion = descripcion || pData.descripcion;
        promesa = promesa || pData.promesa;
        icp = icp || pData.icp;
        entregables = entregables || pData.entregables;
        siguiente_escalon = siguiente_escalon || pData.siguiente_escalon;
      }

      if (lead_id) {
        const [leadR, esR, negR, diagR] = await Promise.all([
          supabase.from('leads').select('nombre,email,tema_actual_orden,semana_actual,modalidad,fecha_inicio_programa,estado').eq('id', lead_id).maybeSingle(),
          supabase.from('cliente_esencia').select('*').eq('lead_id', lead_id).maybeSingle(),
          supabase.from('cliente_negocio').select('*').eq('lead_id', lead_id).maybeSingle(),
          supabase.from('cliente_diagnostico').select('*').eq('lead_id', lead_id).maybeSingle(),
        ]);
        lead = leadR.data;
        esencia = esR.data;
        negocio = negR.data;
        diagnostico = diagR.data;
      }
    }

    if (!nombre) {
      return new Response(JSON.stringify({ error: 'nombre es requerido' }),
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

    // Construir el contexto rico
    let userMessage = `Audita el siguiente producto. Devuelve SOLO el JSON.

PRODUCTO
Nombre: ${nombre}
Tipo: ${tipo || '(no especificado)'}
Precio: ${precio ? `${precio} ${moneda || 'USD'}` : '(no especificado)'}
Descripción: ${descripcion || '(vacío)'}
Promesa: ${promesa || '(vacío)'}
ICP del producto: ${icp || '(vacío)'}
Entregables: ${entregables || '(vacío)'}
Siguiente escalón: ${siguiente_escalon || '(vacío)'}
`;

    if (esencia) {
      userMessage += `\nESENCIA DEL CLIENTE (úsala para el tono):
Propósito: ${esencia.proposito || '-'}
Promesa al mundo: ${esencia.mision_promesa || '-'}
Diferenciador: ${esencia.diferenciador || '-'}
Valores: ${Array.isArray(esencia.valores) ? esencia.valores.join(', ') : '-'}
ICP marca: ${esencia.icp_marca || '-'}
Problema principal que resuelve: ${esencia.problema_principal || '-'}
Estilo de voz: ${esencia.tono_estilo || '-'}
Descripción de voz: ${esencia.tono_voz || '-'}
Palabras SÍ usa: ${Array.isArray(esencia.palabras_si) ? esencia.palabras_si.join(', ') : '-'}
Palabras NO usa (NUNCA las uses en las tareas): ${Array.isArray(esencia.palabras_no) ? esencia.palabras_no.join(', ') : '-'}
Canales: ${Array.isArray(esencia.canales_principales) ? esencia.canales_principales.join(', ') : '-'}
`;
    }

    if (negocio) {
      const fact = negocio.ingreso_ultimo_mes_usd || negocio.ingreso_promedio_3m_usd;
      const meta = negocio.meta_facturacion_6m_usd;
      const gap = fact && meta ? (meta - fact) : null;
      userMessage += `\nNEGOCIO ACTUAL:
Modelo: ${negocio.modelo_negocio || '-'}
Años: ${negocio.anos_experiencia || '-'}
Modelo de venta: ${negocio.modelo_pricing || '-'}
Facturación último mes: ${fact ? '$' + Number(fact).toLocaleString() : '-'}
Meta 6 meses: ${meta ? '$' + Number(meta).toLocaleString() : '-'}
Gap mensual a cerrar: ${gap !== null ? '$' + Number(gap).toLocaleString() : '-'}
Clientes activos: ${negocio.clientes_activos ?? '-'}
Equipo: ${negocio.equipo_size ?? '-'}
Canales activos: ${Array.isArray(negocio.canales_trafico_activos) ? negocio.canales_trafico_activos.join(', ') : '-'}
Competidores: ${Array.isArray(negocio.competidores_principales) ? negocio.competidores_principales.join(', ') : '-'}
Ventaja injusta: ${negocio.ventaja_injusta || '-'}
Lo que SÍ funcionó: ${negocio.intentos_si_funcionaron || '-'}
Lo que NO funcionó: ${negocio.intentos_no_funcionaron || '-'}
Mayor oportunidad no explotada: ${negocio.mayor_oportunidad_no_explotada || '-'}
Tiene casos de éxito documentados: ${negocio.tiene_casos_exito ? 'sí' : 'no'}
% Tiempo en marketing/ventas: ${negocio.pct_tiempo_marketing_ventas ?? '-'}%
`;
    }

    if (diagnostico) {
      userMessage += `\nDIAGNÓSTICO PROFUNDO (úsalo sutilmente, no te vuelvas terapéutico):
Cómo se describe: ${diagnostico.como_se_describe || '-'}
Cómo le gusta que lo coacheen: ${diagnostico.como_le_gusta_que_lo_coacheen || '-'}
Códigos corruptos / autosabotaje: ${diagnostico.codigos_corruptos_actuales || '-'}
Miedo principal al escalar: ${diagnostico.miedo_principal_al_escalar || '-'}
Techo financiero / trauma: ${diagnostico.techo_financiero_trauma || '-'}
Visión: ${diagnostico.vision_negocio || '-'}
Su "por qué": ${diagnostico.el_por_que || '-'}
Una cosa importante si éxito: ${diagnostico.una_cosa_si_exito || '-'}
`;
    }

    if (lead) {
      userMessage += `\nFASE DEL PROGRAMA:
Estado: ${lead.estado || '-'}
Re-Génesis tema actual: ${lead.tema_actual_orden || '-'}
Semana del programa: ${lead.semana_actual || '-'}
`;
    }

    userMessage += `\nDevuelve SOLO el JSON con salud_score, diagnostico, fortaleza y exactamente 3 tareas. Sin markdown.`;

    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL_ID,
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      })
    });

    if (!anthropicResponse.ok) {
      const errorData = await anthropicResponse.text();
      throw new Error(`Anthropic API error: ${anthropicResponse.status} - ${errorData.slice(0, 200)}`);
    }

    const data = await anthropicResponse.json();
    const raw = data.content[0].text.trim();

    let auditoria: any = null;
    let parseError: string | null = null;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      auditoria = JSON.parse(cleaned);
    } catch (e) {
      parseError = e instanceof Error ? e.message : String(e);
    }

    if (!auditoria || typeof auditoria.salud_score !== 'number' || !Array.isArray(auditoria.tareas)) {
      return new Response(JSON.stringify({
        error: 'IA devolvió respuesta no parseable',
        raw_response: raw.slice(0, 600),
        parse_error: parseError,
      }), { status: 502, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    auditoria.salud_score = Math.max(0, Math.min(100, Math.round(auditoria.salud_score)));

    const tokensInput = data.usage?.input_tokens || 0;
    const tokensOutput = data.usage?.output_tokens || 0;
    const costoUsd = (tokensInput * 3 / 1_000_000) + (tokensOutput * 15 / 1_000_000);

    return new Response(JSON.stringify({
      auditoria,
      contexto_usado: {
        producto: !!producto,
        esencia: !!esencia,
        negocio: !!negocio,
        diagnostico: !!diagnostico,
        completitud_contexto: Math.round(
          ((esencia ? 25 : 0) + (negocio ? 30 : 0) + (diagnostico ? 25 : 0) + (producto ? 20 : 0))
        ),
      },
      metadata: {
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        costo_usd: parseFloat(costoUsd.toFixed(6)),
        modelo: MODEL_ID,
        prompt_version: PROMPT_VERSION,
      },
    }), { headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error en auditar-producto:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      auditoria: null,
    }), { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
