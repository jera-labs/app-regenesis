/* ============================================================
   Helper de contenido del Studio.
   - listar(): trae contenido_generado del lead, filtrable.
   - generar(): llama a edge function generar-contenido (existente, plataforma).
   - generarImagen(): llama a edge function generar-imagen-dalle (nueva, studio).
   - actualizar(): edita estado/cuerpo/etc.
   - eliminar().
   ============================================================ */

(function () {
  if (!window.db) throw new Error('[studio-contenido.js] Falta supabase-client.js');

  const FORMATO_LABEL = {
    post_linkedin:    'Post LinkedIn',
    post_instagram:   'Post Instagram',
    carrusel_ig:      'Carrusel IG',
    reel:             'Reel',
    story:            'Story',
    tweet:            'Tweet',
    email:            'Email',
    post_facebook:    'Post Facebook',
    articulo_blog:    'Artículo',
  };

  const ESTADO_BADGE = {
    borrador:   { bg: '#FEF3C7', fg: '#92400E', label: 'Borrador' },
    aprobado:   { bg: '#D1FAE5', fg: '#065F46', label: 'Aprobado' },
    programado: { bg: '#DBEAFE', fg: '#1E40AF', label: 'Programado' },
    publicado:  { bg: '#E0E7FF', fg: '#3730A3', label: 'Publicado' },
    descartado: { bg: '#F3F4F6', fg: '#6B7280', label: 'Descartado' },
    editando:   { bg: '#FFEDD5', fg: '#9A3412', label: 'Editando' },
  };

  window.studioContenidoApi = {
    FORMATO_LABEL, ESTADO_BADGE,

    badgeEstado(slug) {
      const m = ESTADO_BADGE[slug] || { bg: '#E5E7EB', fg: '#374151', label: slug };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    async listarProductos(leadId) {
      const { data, error } = await window.db.from('productos')
        .select('id, nombre, tipo, precio, descripcion, promesa, icp')
        .eq('lead_id', leadId)
        .eq('estado', 'activo')
        .order('nombre');
      if (error) throw error;
      return data || [];
    },

    async listarContenido({ leadId, canal, formato, estado, limit = 50 } = {}) {
      let q = window.db.from('contenido_generado')
        .select('*, producto:producto_id (nombre, tipo)')
        .order('generado_at', { ascending: false })
        .limit(limit);
      if (leadId)  q = q.eq('lead_id', leadId);
      if (canal)   q = q.eq('canal', canal);
      if (formato) q = q.eq('formato', formato);
      if (estado)  q = q.eq('estado', estado);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async generarContenido({ producto_id, tipos, foco }) {
      const cfg = window.NEURO_CONFIG || {};
      const url = `${cfg.SUPABASE_URL}/functions/v1/generar-contenido`;
      const { data: { session } } = await window.db.auth.getSession();
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || cfg.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ producto_id, tipos, foco, from_studio: true }),
      });
      if (!res.ok) {
        const t = await res.text();
        // 412 = bloqueo por falta de API key del cliente
        let msg = `HTTP ${res.status}: ${t.slice(0, 200)}`;
        try {
          const j = JSON.parse(t);
          if (j?.requiere_configurar_key) {
            msg = j.error || 'Debes configurar tu API key de Anthropic en /studio/configuracion/';
            const err = new Error(msg);
            err.requiere_configurar_key = true;
            throw err;
          }
        } catch (parseErr) { if (parseErr.requiere_configurar_key) throw parseErr; }
        throw new Error(msg);
      }
      return res.json();
    },

    async generarImagen(contenido_id, prompt_custom, opts = {}) {
      const cfg = window.NEURO_CONFIG || {};
      const url = `${cfg.SUPABASE_URL}/functions/v1/generar-imagen-dalle`;
      const { data: { session } } = await window.db.auth.getSession();
      const body = { contenido_id, prompt: prompt_custom || undefined };
      if (opts.size) body.size = opts.size;
      if (opts.quality) body.quality = opts.quality;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || cfg.SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        let msg = `HTTP ${res.status}: ${t.slice(0, 200)}`;
        try {
          const j = JSON.parse(t);
          if (j?.requiere_configurar_key) {
            msg = j.error || 'Debes configurar tu API key de OpenAI en /studio/configuracion/';
            const err = new Error(msg);
            err.requiere_configurar_key = true;
            throw err;
          }
        } catch (parseErr) { if (parseErr.requiere_configurar_key) throw parseErr; }
        throw new Error(msg);
      }
      return res.json();
    },

    // Tamaño recomendado por canal (los que gpt-image-2 soporta nativamente).
    sizeRecomendado(canal) {
      if (canal === 'instagram') return '1024x1024';  // square 1:1 (ideal IG feed)
      if (canal === 'linkedin')  return '1536x1024';  // landscape 3:2 (cerca del 1.91:1 nativo LinkedIn)
      if (canal === 'facebook')  return '1536x1024';  // landscape 3:2 (cerca del 1.91:1 nativo FB)
      if (canal === 'tiktok')    return '1024x1536';  // portrait 2:3 (vertical)
      return '1024x1024';
    },

    async actualizar(id, patch) {
      const { data, error } = await window.db.from('contenido_generado')
        .update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async eliminar(id) {
      const { error } = await window.db.from('contenido_generado').delete().eq('id', id);
      if (error) throw error;
    },

    async metricas(leadId) {
      const { data, error } = await window.db.from('contenido_generado')
        .select('estado, canal')
        .eq('lead_id', leadId);
      if (error) throw error;
      const m = { total: data.length, borrador: 0, aprobado: 0, programado: 0, publicado: 0, por_canal: {} };
      (data || []).forEach((r) => {
        m[r.estado] = (m[r.estado] || 0) + 1;
        m.por_canal[r.canal] = (m.por_canal[r.canal] || 0) + 1;
      });
      return m;
    },
  };
})();
