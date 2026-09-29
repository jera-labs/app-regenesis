// EDGE FUNCTION: generar-script-venta v1
// Genera un script de discovery call de 30min personalizado al DNA del cliente
// (voz, ICP, palabras_si/no, diferenciador) y al producto seleccionado.
// Output: JSON estructurado con 5 secciones (apertura, descubrimiento, presentacion,
// precio, cierre). Se guarda en scripts_venta.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-5';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function srk(): string {
  return Deno.env.get('LEGACY_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
}

function buildPrompt(ctx: {
  lead: any; esencia: any; negocio: any; diagnostico: any; producto: any;
  productosOtros: any[]; notasRegeneracion: string | null;
}): string {
  const e = ctx.esencia || {};
  const n = ctx.negocio || {};
  const d = ctx.diagnostico || {};
  const p = ctx.producto || {};

  const palabrasSi = Array.isArray(e.palabras_si) ? e.palabras_si.join(', ') : '';
  const palabrasNo = Array.isArray(e.palabras_no) ? e.palabras_no.join(', ') : '';
  const valores = Array.isArray(e.valores) ? e.valores.join(', ') : '';

  const notaExtra = ctx.notasRegeneracion
    ? `\n\nNOTA DE REGENERACION del usuario:\n${ctx.notasRegeneracion}\n(Toma esto en cuenta y ajusta el script.)`
    : '';

  return `Eres un coach senior de ventas para consultores y coaches high-ticket. Tu trabajo es generar un script de DISCOVERY CALL de 25-30 minutos personalizado.

NO uses lenguaje genérico de "coaching gringo": nada de "transforma tu vida", "unleash your potential", "mindset shift". Habla como adulto que cierra negocios.

# CLIENTE QUE USARA ESTE SCRIPT
- Nombre: ${ctx.lead?.nombre || ''}
- Negocio: ${n.nombre_negocio || ''} (${n.modelo_negocio || ''})
- Diferenciador: ${e.diferenciador || n.ventaja_injusta || '(no especificado)'}
- Promesa de marca: ${e.mision_promesa || '(no especificada)'}
- Valores: ${valores || '(no especificados)'}

# VOZ DEL CLIENTE (RESPETALA ESTRICTAMENTE)
- Tono general: ${e.tono_estilo || 'directo'}
- Cómo habla: ${e.tono_voz || '(no especificado)'}
- Palabras que SI usa: ${palabrasSi || '(libres)'}
- Palabras PROHIBIDAS (nunca usar): ${palabrasNo || '(ninguna específica, evita coachspeak)'}
- Referentes: ${e.referencias || '(no especificados)'}

# A QUIEN LE VENDE (ICP)
- ICP marca: ${e.icp_marca || '(no especificado)'}
- ICP de este producto: ${p.icp || '(usa ICP de marca)'}
- Problema principal del cliente final: ${e.problema_principal || '(no especificado)'}
- Códigos corruptos del cliente final (creencias limitantes): ${d.codigos_corruptos_actuales || '(no especificados)'}
- Miedo principal del prospect al escalar: ${d.miedo_principal_al_escalar || '(no especificado)'}

# PRODUCTO QUE VENDERA EN ESTA LLAMADA
- Nombre: ${p.nombre || ''}
- Tipo: ${p.tipo || ''}
- Promesa específica: ${p.promesa || ''}
- Precio: ${p.precio ? `${p.precio} ${p.moneda || 'USD'}` : '(definir en llamada)'}
- Siguiente escalón sugerido al cerrar: ${p.siguiente_escalon || '(no especificado)'}

# CONTEXTO COMERCIAL
- Su precio promedio actual: ${n.valor_promedio_compra_usd ? `$${n.valor_promedio_compra_usd}` : '(no especificado)'}
- LTV cliente: ${n.ltv_cliente_usd ? `$${n.ltv_cliente_usd}` : '(no especificado)'}
- Casos de éxito públicos: ${n.tiene_casos_exito ? 'Sí' : 'No (no inventes; presenta caso si lo tiene)'}
${notaExtra}

# OUTPUT
Devuelve SOLO un objeto JSON valido (sin markdown, sin comentarios), con esta estructura EXACTA:

{
  "apertura": "<texto de 30-45 segundos para abrir la llamada SIN small talk genérico. Va directo al motivo. Usa la voz del cliente.>",
  "descubrimiento": [
    {
      "orden": 1,
      "pregunta": "<la pregunta a hacer literal>",
      "objetivo": "<en 1 linea, qué información extraes con esto>",
      "follow_up": "<si responde X, profundizar con esto>"
    },
    ...
  ],
  "presentacion": {
    "puente": "<como pasar de descubrimiento a propuesta sin que se sienta forzado, 1-2 oraciones>",
    "propuesta": "<la propuesta concreta del producto, sin features, hablando del resultado>",
    "prueba_social": "<una linea sobre caso o prueba; si no tiene casos, dile que mencione experiencia o garantía en lugar de inventar>"
  },
  "precio": {
    "como_decirlo": "<exactamente cómo se dice el precio, sin pausa apologética. 1-2 oraciones>",
    "objecion_caro": "<respuesta a 'está caro' en la voz del cliente, sin defender, sin descuento>",
    "objecion_pensarlo": "<respuesta a 'lo voy a pensar' que cierra el espacio, sin presionar>",
    "objecion_socio": "<respuesta a 'tengo que hablarlo con mi socio/pareja' que valida y pone next step>"
  },
  "cierre": {
    "directo": "<cierre directo: '¿Quieres empezar la próxima semana?' tono, adaptado a su voz>",
    "asumido": "<cierre asumido tipo Sandler: '¿Te paso la liga de pago ahora?' adaptado>"
  },
  "notas_para_el_cliente": "<2-3 bullets cortos con tips específicos: silencios, ritmo, qué evitar diciendo. Máximo 80 palabras total.>"
}

REGLAS:
- 5 preguntas en descubrimiento, ni más ni menos
- NO uses las palabras prohibidas en NINGUNA parte del output
- La voz se siente personal, no template
- Cada pregunta de descubrimiento debe poder responderse en <60s
- El precio se menciona con confianza, sin "es una inversión"
- Sin emojis
- Devuelve SOLO el JSON, nada antes ni después`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ ok: false, error: 'Falta Authorization' }), { status: 200, headers: cors() });
    }

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    if (!ANTHROPIC_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' }), { status: 200, headers: cors() });
    }

    const { lead_id, producto_id, notas_regeneracion } = await req.json().catch(() => ({}));
    if (!lead_id) {
      return new Response(JSON.stringify({ ok: false, error: 'falta lead_id' }), { status: 200, headers: cors() });
    }

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const sb = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const sbAdmin = createClient(SUPABASE_URL, srk(), { auth: { persistSession: false } });

    // Verificar permisos (el cliente solo puede generar para sí mismo; admin/moderador puede para cualquier lead)
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: 'JWT inválido' }), { status: 200, headers: cors() });
    }

    const { data: lead } = await sbAdmin.from('leads')
      .select('id, nombre, email').eq('id', lead_id).maybeSingle();
    if (!lead) {
      return new Response(JSON.stringify({ ok: false, error: 'Lead no encontrado' }), { status: 200, headers: cors() });
    }

    const esCliente = user.email === lead.email;
    const { data: esAdmin } = await sbAdmin.from('usuarios_admin')
      .select('rol').eq('email', user.email).eq('activo', true).maybeSingle();
    if (!esCliente && !esAdmin) {
      return new Response(JSON.stringify({ ok: false, error: 'Sin permisos para este lead' }), { status: 200, headers: cors() });
    }

    // Cargar DNA + producto
    const [esR, negR, diagR, prodR, otrosProdR] = await Promise.all([
      sbAdmin.from('cliente_esencia').select('*').eq('lead_id', lead_id).maybeSingle(),
      sbAdmin.from('cliente_negocio').select('*').eq('lead_id', lead_id).maybeSingle(),
      sbAdmin.from('cliente_diagnostico').select('*').eq('lead_id', lead_id).maybeSingle(),
      producto_id
        ? sbAdmin.from('productos').select('*').eq('id', producto_id).eq('lead_id', lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sbAdmin.from('productos').select('nombre, tipo, promesa, precio, moneda')
        .eq('lead_id', lead_id).eq('estado', 'activo'),
    ]);

    if (producto_id && !prodR.data) {
      return new Response(JSON.stringify({ ok: false, error: 'Producto no encontrado' }), { status: 200, headers: cors() });
    }

    if (!prodR.data) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Falta producto_id. Selecciona un producto antes de generar el script.',
      }), { status: 200, headers: cors() });
    }

    const prompt = buildPrompt({
      lead, esencia: esR.data, negocio: negR.data, diagnostico: diagR.data,
      producto: prodR.data, productosOtros: otrosProdR.data || [],
      notasRegeneracion: notas_regeneracion || null,
    });

    // Llamar Claude
    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return new Response(JSON.stringify({
        ok: false,
        error: `Claude rechazó: HTTP ${claudeRes.status}: ${errText.slice(0, 300)}`,
      }), { status: 200, headers: cors() });
    }

    const claudeJson = await claudeRes.json();
    const textContent = claudeJson.content?.[0]?.text || '';

    // Limpiar markdown si vino
    const cleaned = textContent.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    let estructura: any;
    try {
      estructura = JSON.parse(cleaned);
    } catch (parseErr) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Claude devolvió JSON inválido. Reintenta.',
        raw: cleaned.slice(0, 500),
      }), { status: 200, headers: cors() });
    }

    // Validar estructura mínima
    const camposRequeridos = ['apertura', 'descubrimiento', 'presentacion', 'precio', 'cierre'];
    const faltantes = camposRequeridos.filter(k => !estructura[k]);
    if (faltantes.length) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Output incompleto, faltan: ${faltantes.join(', ')}`,
        estructura,
      }), { status: 200, headers: cors() });
    }

    // Guardar
    const { data: saved, error: saveErr } = await sbAdmin.from('scripts_venta').insert({
      lead_id,
      producto_id,
      estructura,
      modelo_usado: MODEL,
      tokens_input: claudeJson.usage?.input_tokens || null,
      tokens_output: claudeJson.usage?.output_tokens || null,
      notas_regeneracion: notas_regeneracion || null,
    }).select('id, generado_at').single();

    if (saveErr) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Generado pero no se pudo guardar: ${saveErr.message}`,
        estructura,
      }), { status: 200, headers: cors() });
    }

    return new Response(JSON.stringify({
      ok: true,
      mensaje: 'Script de discovery generado',
      script_id: saved.id,
      generado_at: saved.generado_at,
      estructura,
      producto: { id: prodR.data.id, nombre: prodR.data.nombre },
      tokens: {
        input: claudeJson.usage?.input_tokens || 0,
        output: claudeJson.usage?.output_tokens || 0,
      },
    }), { status: 200, headers: cors() });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: `Excepción: ${String((e as Error).message)}`,
    }), { status: 200, headers: cors() });
  }
});
