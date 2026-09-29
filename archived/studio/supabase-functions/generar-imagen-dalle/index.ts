// ============================================================================
// EDGE FUNCTION: generar-imagen-dalle
// Genera una imagen DALL-E 3 para un contenido_generado existente.
//
// POST body: { contenido_id: uuid, prompt?: string, size?: '1024x1024'|'1792x1024'|'1024x1792' }
// Auth: JWT del usuario (cliente o admin). RLS controla acceso al contenido.
//
// Flujo:
// 1. Lee contenido + producto + esencia del cliente.
// 2. Si no se pasa prompt, lo genera desde hook + cuerpo + tono.
// 3. Llama a OpenAI Images API (dall-e-3).
// 4. Descarga la URL temporal, sube a Storage bucket contenido-imagenes.
// 5. Actualiza contenido_generado.imagen_*.
// 6. Retorna { url, prompt_usado, costo_usd }.
// ============================================================================

const OPENAI_URL = 'https://api.openai.com/v1/images/generations';
const BUCKET = 'contenido-imagenes';
const IMG_MODEL = 'gpt-image-2';

// Costos aproximados gpt-image-2 (USD por imagen) — quality determina precio:
const COSTOS = {
  '1024x1024_low':    0.011,
  '1024x1024_medium': 0.042,
  '1024x1024_high':   0.167,
  '1024x1536_low':    0.016,
  '1024x1536_medium': 0.063,
  '1024x1536_high':   0.250,
  '1536x1024_low':    0.016,
  '1536x1024_medium': 0.063,
  '1536x1024_high':   0.250,
};

async function sbRest(path: string, init: RequestInit = {}) {
  const url = `${Deno.env.get('SUPABASE_URL')}/rest/v1${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Supabase REST ${res.status}: ${t}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function sbStorageUpload(path: string, blob: Blob): Promise<string> {
  const url = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/${BUCKET}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!}`,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: blob,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Storage upload ${res.status}: ${t}`);
  }
  // URL pública (bucket público)
  return `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${BUCKET}/${path}`;
}

function buildPromptDefault(contenido: any, producto: any, esencia: any, lead: any): string {
  const tono = esencia?.tono_estilo || 'profesional';
  const valores = (esencia?.valores || []).slice(0, 3).join(', ') || 'autenticidad, claridad';
  const concepto = contenido.hook || contenido.titulo || (contenido.cuerpo || '').slice(0, 200);

  return [
    `Imagen profesional para post de redes sociales.`,
    `Marca: ${lead?.nombre || 'profesional independiente'}, estilo ${tono}.`,
    producto?.nombre ? `Producto: ${producto.nombre} (${producto.tipo || 'servicio'}).` : '',
    `Concepto del post: "${concepto}".`,
    `Adjetivos visuales: ${valores}, alta calidad, composición centrada.`,
    `Estilo: fotografía editorial moderna, iluminación suave, colores cálidos con acentos dorados.`,
    `IMPORTANTE: NO incluir texto, logos, marcas de agua, ni rostros reconocibles.`,
    `Formato cuadrado, listo para Instagram.`,
  ].filter(Boolean).join(' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type, x-function-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'OPENAI_API_KEY no configurada en secrets de Supabase. Pídele al admin que la agregue.',
    }), { status: 503, headers: cors });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { contenido_id, prompt: prompt_custom, size = '1024x1024', quality = 'medium' } = body;

    if (!contenido_id) {
      return new Response(JSON.stringify({ ok: false, error: 'falta contenido_id' }), {
        status: 400, headers: cors,
      });
    }

    // 1. Leer contenido + producto + esencia + lead
    const rows: any[] = await sbRest(
      `/contenido_generado?id=eq.${contenido_id}&select=id,lead_id,producto_id,formato,canal,titulo,hook,cuerpo,imagen_intentos,imagen_costo_usd`
    );
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: false, error: 'contenido no encontrado' }), {
        status: 404, headers: cors,
      });
    }
    const contenido = rows[0];

    // Rate limit suave: max 20 generaciones de imagen por contenido (evitar abuse)
    if ((contenido.imagen_intentos || 0) >= 20) {
      return new Response(JSON.stringify({
        ok: false, error: 'límite de generaciones para esta pieza (20). Crea otra o contacta al equipo.',
      }), { status: 429, headers: cors });
    }

    const [productoRes, esenciaRes, leadRes] = await Promise.all([
      contenido.producto_id
        ? sbRest(`/productos?id=eq.${contenido.producto_id}&select=nombre,tipo,promesa,icp,descripcion`)
        : Promise.resolve([]),
      sbRest(`/cliente_esencia?lead_id=eq.${contenido.lead_id}&select=tono_estilo,valores,palabras_si`),
      sbRest(`/leads?id=eq.${contenido.lead_id}&select=nombre,instagram_handle`),
    ]);
    const producto = (productoRes || [])[0];
    const esencia  = (esenciaRes || [])[0];
    const lead     = (leadRes || [])[0];

    // 2. Construir prompt si no viene custom
    const prompt = (prompt_custom && prompt_custom.trim())
      ? prompt_custom.trim()
      : buildPromptDefault(contenido, producto, esencia, lead);

    // 3. Llamar a OpenAI (response_format ya no se acepta; por default retorna url para dall-e-3)
    const openaiBody = {
      model: IMG_MODEL,
      prompt: prompt.slice(0, 4000),
      n: 1,
      size,
      quality,
    };
    const oaiRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiBody),
    });
    if (!oaiRes.ok) {
      const t = await oaiRes.text();
      return new Response(JSON.stringify({
        ok: false, error: `OpenAI ${oaiRes.status}: ${t.slice(0, 400)}`,
      }), { status: 502, headers: cors });
    }
    const oaiData = await oaiRes.json();
    const first = oaiData?.data?.[0];
    const tempUrl = first?.url;
    const b64 = first?.b64_json;
    let blob: Blob;
    if (tempUrl) {
      const imgRes = await fetch(tempUrl);
      if (!imgRes.ok) throw new Error(`Download imagen ${imgRes.status}`);
      blob = await imgRes.blob();
    } else if (b64) {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      blob = new Blob([bin], { type: 'image/png' });
    } else {
      return new Response(JSON.stringify({
        ok: false, error: 'OpenAI no retornó url ni b64_json',
      }), { status: 502, headers: cors });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${contenido.lead_id}/${contenido_id}/${timestamp}.png`;
    const publicUrl = await sbStorageUpload(path, blob);

    // 5. Calcular costo y actualizar BD
    const costoKey = `${size}_${quality}` as keyof typeof COSTOS;
    const costoNueva = COSTOS[costoKey] || 0.042;
    const costoAcum = Number(contenido.imagen_costo_usd || 0) + costoNueva;

    await sbRest(`/contenido_generado?id=eq.${contenido_id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        imagen_url: publicUrl,
        imagen_path: path,
        imagen_prompt: prompt,
        imagen_modelo: IMG_MODEL,
        imagen_size: size,
        imagen_generada_at: new Date().toISOString(),
        imagen_costo_usd: costoAcum,
        imagen_intentos: (contenido.imagen_intentos || 0) + 1,
      }),
    });

    return new Response(JSON.stringify({
      ok: true,
      url: publicUrl,
      path,
      prompt_usado: prompt,
      costo_usd_esta_imagen: costoNueva,
      costo_usd_total: costoAcum,
      intentos: (contenido.imagen_intentos || 0) + 1,
    }), { status: 200, headers: cors });

  } catch (e) {
    return new Response(JSON.stringify({
      ok: false, error: String((e as Error).message),
    }), { status: 500, headers: cors });
  }
});
