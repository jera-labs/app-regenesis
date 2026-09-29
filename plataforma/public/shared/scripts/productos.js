// ============================================================================
// Productos · CRUD wrapper sobre Supabase + Edge Function de auditoría.
// Asume que `db` ya está disponible (supabase-client cargado primero).
// ============================================================================

(function () {
  window.productosApi = {
    async listarPorLead(leadId) {
      const { data, error } = await window.db
        .from('productos')
        .select('*')
        .eq('lead_id', leadId)
        .neq('estado', 'archivado')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async obtener(productoId) {
      const { data, error } = await window.db
        .from('productos')
        .select('*')
        .eq('id', productoId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async crear(leadId, datos) {
      const payload = {
        lead_id: leadId,
        nombre: datos.nombre,
        tipo: datos.tipo || null,
        precio: datos.precio !== '' && datos.precio !== null ? Number(datos.precio) : null,
        moneda: datos.moneda || 'USD',
        descripcion: datos.descripcion || null,
        promesa: datos.promesa || null,
        icp: datos.icp || null,
        entregables: datos.entregables || null,
        siguiente_escalon: datos.siguiente_escalon || null,
        estado: datos.estado || 'activo',
      };
      const { data, error } = await window.db
        .from('productos')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async actualizar(productoId, cambios) {
      const { data, error } = await window.db
        .from('productos')
        .update(cambios)
        .eq('id', productoId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async archivar(productoId) {
      return this.actualizar(productoId, { estado: 'archivado' });
    },

    async auditarConIA(producto, _contextoCliente = null) {
      const session = (await window.db.auth.getSession()).data.session;
      if (!session) throw new Error('Sin sesión');

      // Modo rich-context: la edge function lee el perfil completo (esencia +
      // negocio + diagnóstico) desde Supabase con el JWT del usuario.
      const res = await fetch(window.NEURO_CONFIG.EDGE_AUDITAR_PRODUCTO, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.NEURO_CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          producto_id: producto.id,
          lead_id: producto.lead_id,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Edge Function error ${res.status}: ${errText.slice(0, 200)}`);
      }

      const body = await res.json();
      if (!body.auditoria) {
        throw new Error(body.error || 'No recibimos el diagnóstico. Inténtalo de nuevo.');
      }

      // Guardar el resultado en la BD
      const actualizado = await this.actualizar(producto.id, {
        salud_score: body.auditoria.salud_score,
        auditoria_diagnostico: body.auditoria.diagnostico,
        auditoria_tareas: body.auditoria,
        auditoria_at: new Date().toISOString(),
        auditoria_modelo: body.metadata.modelo,
      });

      return { auditoria: body.auditoria, producto: actualizado, metadata: body.metadata };
    },
  };
})();
