// ============================================================================
// pipeline.js · CRUD pipeline_columnas + helpers de drag-and-drop
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[pipeline.js] Falta supabase-client.js');

  window.pipelineApi = {

    async listarColumnas(soloActivas = false) {
      const fetcher = async () => {
        let q = window.db.from('pipeline_columnas').select('*').order('orden');
        if (soloActivas) q = q.eq('activa', true);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get(soloActivas ? 'pipeline_columnas_activas' : 'pipeline_columnas_todas', fetcher);
      }
      return fetcher();
    },

    async crearColumna({ slug, nombre, descripcion, estados, color, icono, orden }) {
      const s = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '');
      if (!s) throw new Error('Slug requerido');
      if (!nombre?.trim()) throw new Error('Nombre requerido');
      const payload = {
        slug: s,
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        estados: Array.isArray(estados) ? estados : [],
        color: color || '#86868B',
        icono: icono || null,
        orden: Number(orden) || 0,
      };
      const { data, error } = await window.db.from('pipeline_columnas').insert(payload).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('pipeline_columnas');
      return data;
    },

    async actualizarColumna(id, cambios) {
      const allowed = ['nombre','descripcion','estados','color','icono','orden','activa','visible_mentor'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('pipeline_columnas').update(payload).eq('id', id).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('pipeline_columnas');
      return data;
    },

    async eliminarColumna(id) {
      const { error } = await window.db.from('pipeline_columnas').delete().eq('id', id);
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('pipeline_columnas');
    },

    // Dada una columna destino, ¿qué transición específica aplicar para mover un cliente ahí?
    // Cached por estado_desde para no consultar transiciones repetidamente al pintar el board.
    async opcionesParaMover(leadId, columnaDestino, estadoActual) {
      const destinos = columnaDestino.estados || [];
      if (destinos.length === 0) return { error: 'Columna sin estados configurados' };

      const fetcher = async () => {
        const { data, error } = await window.db
          .from('catalogo_transiciones_estado')
          .select('estado_hacia, descripcion, requiere_motivo, requiere_categoria_churn')
          .eq('estado_desde', estadoActual)
          .eq('activa', true);
        if (error) throw error;
        return data || [];
      };

      const todasDesde = window.neuroCache
        ? await window.neuroCache.get('transiciones_desde_' + estadoActual, fetcher, { ttlMs: 60 * 60 * 1000 })
        : await fetcher();

      const transiciones = todasDesde.filter(t => destinos.includes(t.estado_hacia));
      if (transiciones.length === 0) {
        return { error: 'No hay transición permitida desde "' + estadoActual + '" hacia ningún estado de "' + columnaDestino.nombre + '"' };
      }
      return { opciones: transiciones };
    },
  };

  window.notasApi = {
    async listar(leadId) {
      const { data, error } = await window.db
        .from('cliente_notas')
        .select('*, autor:autor_id (nombre, email)')
        .eq('lead_id', leadId)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async crear({ lead_id, contenido, tipo, pinned }) {
      if (!contenido?.trim()) throw new Error('Contenido vacío');
      const { data: { session } } = await window.db.auth.getSession();
      const { data: admin } = await window.db
        .from('usuarios_admin').select('id').eq('email', session.user.email).maybeSingle();
      const payload = {
        lead_id,
        contenido: contenido.trim(),
        tipo: tipo || 'general',
        pinned: !!pinned,
        autor_id: admin?.id || null,
      };
      const { data, error } = await window.db.from('cliente_notas').insert(payload).select('*, autor:autor_id (nombre, email)').single();
      if (error) throw error;
      return data;
    },

    async actualizar(id, cambios) {
      const allowed = ['contenido','tipo','pinned'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('cliente_notas').update(payload).eq('id', id).select('*, autor:autor_id (nombre, email)').single();
      if (error) throw error;
      return data;
    },

    async eliminar(id) {
      const { error } = await window.db.from('cliente_notas').delete().eq('id', id);
      if (error) throw error;
    },

    iconoTipo(tipo) {
      return { general: '◇', llamada: '☏', alerta: '!', seguimiento: '◐', contexto: '◈' }[tipo] || '◇';
    },
    colorTipo(tipo) {
      return { general: '#86868B', llamada: '#3B82F6', alerta: '#EF4444', seguimiento: '#D4AF37', contexto: '#10B981' }[tipo] || '#86868B';
    },
  };
})();
