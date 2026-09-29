// ============================================================================
// EDGE FUNCTION: generar-contenido
// Modelo: claude-sonnet-4-6
//
// Genera N piezas de contenido para redes a partir de:
//   - producto_id: el producto del cliente
//   - tipos[]: array de formatos a generar (post_linkedin, carrusel_ig, reel, etc.)
//   - foco?: ángulo opcional ("caso de éxito", "objeción común", "ICP pain")
//
// Lee con el JWT del user: producto + esencia + negocio + diagnostico.
// Aplica estricto el tono de voz: usa palabras_si, evita palabras_no.
//
// Las piezas se devuelven; el frontend decide guardarlas en contenido_generado.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL_ID = 'claude-sonnet-4-6';
const PROMPT_VERSION = 'v1-gen-contenido';

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

const SYSTEM_PROMPT = `Eres copywriter senior especializado en marketing B2B para consultores, asesores, agentes inmobiliarios, asesores de seguros y servicios profesionales.

Tu trabajo: generar piezas de contenido para redes que VENDAN un producto específico del cliente, escritas COMO LO HARÍA EL CLIENTE (no como chatbot). El cliente te dio su producto, su esencia de voz, su negocio y su diagnóstico profundo. Úsalos todos.

REGLAS DURAS:
- Output SIEMPRE JSON válido. Sin markdown. Sin bloques.
- Shape exacto:
  {
    "piezas": [
      {
        "formato": "post_linkedin|post_instagram|carrusel_ig|reel|story|tweet|email",
        "canal": "linkedin|instagram|tiktok|twitter|email",
        "titulo": "<título interno corto para el cliente, no se publica>",
        "hook": "<primera línea, lo que para el scroll>",
        "cuerpo": "<el texto completo de la pieza, listo para copiar y pegar>",
        "cta": "<la llamada a la acción específica>",
        "hashtags": ["tag1","tag2",...],
        "slides": [{"titulo":"...","texto":"..."},...] // SOLO si formato=carrusel_ig (5-7 slides),
        "storyboard": [{"toma":1,"plano":"...","texto":"..."},...] // SOLO si formato=reel (4-7 tomas),
        "duracion_sugerida_seg": <int> // SOLO si reel
      }
    ]
  }

VOZ DEL CLIENTE:
- Si te dieron palabras_si, úsalas naturalmente. Si dieron palabras_no, NUNCA aparezcan.
- Si dieron tono_estilo, respétalo. "directo" = sin rodeos, sin coachspeak. "cercano" = "tú" y conversacional. "técnico" = datos y precisión.
- Si NO te dieron esencia, usa tono profesional neutro pero NUNCA escribas como ChatGPT genérico.

ANCLAJE EN EL PRODUCTO:
- Cada pieza debe estar específicamente conectada al producto. No marca abstracta.
- El CTA debe llevar al producto (no "agenda una llamada" genérico, sino "agenda tu Auditoría Express").
- Si el producto tiene caso de éxito, úsalo. Si tiene un ICP específico, nómbralo.

DIAGNÓSTICO Y PROFUNDIDAD:
- Si el cliente reveló un código corrupto o miedo (ej. "postergo cobrar más"), una de las piezas puede tener un ángulo de honestidad-vulnerabilidad ("Llevo 2 años cobrando lo mismo. Esto cambia hoy.")
- Si el cliente reveló una epifanía, esa puede ser un hook poderoso.
- NUNCA escribas terapéutico ni coachspeak. Las raíces profundas se VIVEN en el copy, no se anuncian.

REGLAS DE CADA FORMATO:
- post_linkedin: 600-1200 caracteres. Hook duro en línea 1. Sin emojis a menos que esencia lo permita. CTA suave al final.
- post_instagram: 300-800 caracteres. Hook visual. CTA directo. Si esencia permite emojis, máximo 2.
- carrusel_ig: 5-7 slides. Slide 1 = hook + promesa. Slide 2-N = insights numerados. Último slide = CTA + signature.
- reel: guion completo + storyboard. 30-60 segundos. Hook a los 2 segundos. Pattern interrupt en segundo 8. CTA en último segundo.
- tweet: 280 chars. Una idea. Un punch.
- email: subject + cuerpo. Personal, primera persona, sin "Estimado".

Las piezas deben ser PUBLICABLES TAL CUAL. El cliente debe poder copiar/pegar sin tocar nada.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) });
  }

  try {
    const body = await req.json();
    const { producto_id, tipos = ['post_linkedin', 'carrusel_ig', 'reel'], foco = null } = body;

    if (!producto_id) {
      return new Response(JSON.stringify({ error: 'producto_id requerido' }),
        { status: 400, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const authHeader = req.headers.get('Authorization');
    if (!SUPABASE_URL || !ANON_KEY || !authHeader) throw new Error('Missing auth context');

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: producto } = await supabase.from('productos').select('*').eq('id', producto_id).maybeSingle();
    if (!producto) {
      return new Response(JSON.stringify({ error: 'Producto no encontrado' }),
        { status: 404, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const [esR, negR, diagR, leadR] = await Promise.all([
      supabase.from('cliente_esencia').select('*').eq('lead_id', producto.lead_id).maybeSingle(),
      supabase.from('cliente_negocio').select('*').eq('lead_id', producto.lead_id).maybeSingle(),
      supabase.from('cliente_diagnostico').select('*').eq('lead_id', producto.lead_id).maybeSingle(),
      supabase.from('leads').select('nombre,instagram_handle').eq('id', producto.lead_id).maybeSingle(),
    ]);
    const esencia = esR.data, negocio = negR.data, diagnostico = diagR.data, lead = leadR.data;

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');

    let userMessage = `Genera ${tipos.length} pieza(s) de contenido. Tipos solicitados: ${tipos.join(', ')}.
${foco ? `Foco/ángulo específico: ${foco}` : ''}

PRODUCTO A PROMOVER
Nombre: ${producto.nombre}
Tipo: ${producto.tipo || '-'}
Precio: ${producto.precio ? `${producto.precio} ${producto.moneda || 'USD'}` : '-'}
Descripción: ${producto.descripcion || '-'}
Promesa: ${producto.promesa || '-'}
ICP del producto: ${producto.icp || '-'}
Entregables: ${producto.entregables || '-'}
Siguiente escalón: ${producto.siguiente_escalon || '-'}
`;

    if (esencia) {
      userMessage += `\nESENCIA DEL CLIENTE (úsala para hablar como él):
Propósito: ${esencia.proposito || '-'}
Promesa al mundo: ${esencia.mision_promesa || '-'}
Historia: ${esencia.historia_personal || '-'}
Diferenciador: ${esencia.diferenciador || '-'}
Valores: ${Array.isArray(esencia.valores) ? esencia.valores.join(', ') : '-'}
ICP marca: ${esencia.icp_marca || '-'}
Problema principal: ${esencia.problema_principal || '-'}
ESTILO DE VOZ: ${esencia.tono_estilo || '-'}
Descripción de su voz: ${esencia.tono_voz || '-'}
Palabras SÍ usa: ${Array.isArray(esencia.palabras_si) ? esencia.palabras_si.join(', ') : '-'}
PALABRAS PROHIBIDAS (NUNCA escribirlas): ${Array.isArray(esencia.palabras_no) ? esencia.palabras_no.join(', ') : '(ninguna marcada)'}
Referencias del cliente: ${esencia.referencias || '-'}
`;
    }

    if (negocio) {
      userMessage += `\nNEGOCIO ACTUAL:
Modelo: ${negocio.modelo_negocio || '-'}
Años: ${negocio.anos_experiencia || '-'}
Facturación reciente: ${negocio.ingreso_ultimo_mes_usd ? '$' + Number(negocio.ingreso_ultimo_mes_usd).toLocaleString() : '-'}
Meta 6m: ${negocio.meta_facturacion_6m_usd ? '$' + Number(negocio.meta_facturacion_6m_usd).toLocaleString() : '-'}
Canales activos: ${Array.isArray(negocio.canales_trafico_activos) ? negocio.canales_trafico_activos.join(', ') : '-'}
Competidores: ${Array.isArray(negocio.competidores_principales) ? negocio.competidores_principales.join(', ') : '-'}
Ventaja injusta: ${negocio.ventaja_injusta || '-'}
Casos de éxito disponibles: ${negocio.tiene_casos_exito ? 'sí (usar si encaja)' : 'no'}
Lo que SÍ funcionó: ${negocio.intentos_si_funcionaron || '-'}
Oportunidad no explotada: ${negocio.mayor_oportunidad_no_explotada || '-'}
`;
    }

    if (diagnostico) {
      userMessage += `\nDIAGNÓSTICO PROFUNDO (usa con sutileza, no anuncies):
Cómo se describe: ${diagnostico.como_se_describe || '-'}
Su "por qué": ${diagnostico.el_por_que || '-'}
Visión: ${diagnostico.vision_negocio || '-'}
Códigos corruptos identificados: ${diagnostico.codigos_corruptos_actuales || '-'}
Miedo al escalar: ${diagnostico.miedo_principal_al_escalar || '-'}
Techo financiero / trauma: ${diagnostico.techo_financiero_trauma || '-'}
Epifanía de pago: ${diagnostico.epifania_por_que_pago || '-'}
`;
    }

    if (lead) {
      userMessage += `\nCLIENTE: ${lead.nombre || '-'}${lead.instagram_handle ? ` (IG: @${lead.instagram_handle})` : ''}\n`;
    }

    userMessage += `\nGenera ahora el JSON. Cada pieza debe ser publicable tal cual. SIN markdown, SIN bloques de código.`;

    const max_tokens = tipos.length * 800 + 500;
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL_ID, max_tokens, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMessage }] }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      throw new Error(`Anthropic ${anthropicResponse.status}: ${errText.slice(0, 200)}`);
    }
    const data = await anthropicResponse.json();
    const raw = data.content[0].text.trim();

    let parsed: any = null, parseError: string | null = null;
    try {
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) { parseError = e instanceof Error ? e.message : String(e); }

    if (!parsed || !Array.isArray(parsed.piezas)) {
      return new Response(JSON.stringify({
        error: 'IA devolvió respuesta no parseable',
        raw_response: raw.slice(0, 800),
        parse_error: parseError,
      }), { status: 502, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
    }

    const tokensInput = data.usage?.input_tokens || 0;
    const tokensOutput = data.usage?.output_tokens || 0;
    const costoUsd = (tokensInput * 3 / 1_000_000) + (tokensOutput * 15 / 1_000_000);
    const ctxCompletitud = (esencia ? 30 : 0) + (negocio ? 30 : 0) + (diagnostico ? 25 : 0) + 15;

    return new Response(JSON.stringify({
      piezas: parsed.piezas,
      contexto_usado: {
        producto: true,
        esencia: !!esencia,
        negocio: !!negocio,
        diagnostico: !!diagnostico,
        completitud_contexto: ctxCompletitud,
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
    console.error('generar-contenido error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      piezas: null,
    }), { status: 500, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } });
  }
});
