// ============================================================================
// estados.js · helpers para estados comerciales, transiciones y etiquetas (fase 2)
//
// Cubre:
// - Lectura del estado vigente + historial timeline.
// - Transiciones permitidas según rol + side effects via RPC atómico.
// - Catálogo de transiciones (lectura) + CRUD admin pleno.
// - Etiquetas: catálogo + aplicar/quitar a un lead.
//
// Asume window.db cargado.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[estados.js] Falta supabase-client.js');

  const ESTADO_LABEL = {
    onboarding_pendiente:       'Onboarding',
    activo:                     'Activo',
    activo_cuota_impaga:        'Cuota impaga',
    extension:                  'Extensión',
    renovacion_paga:            'Renovación pagada',
    caso_exito:                 'Caso de éxito',
    pausa:                      'Pausa',
    reembolso_solicitado:       'Reembolso pedido',
    reembolso_efectuado:        'Reembolso efectuado',
    inactivo:                   'Inactivo',
    cancela_impago:             'Cancela impago',
    fin_de_plazo:               'Fin de plazo',
    fin_caso_exito_con_upsell:  'Cerrado · con upsell',
    fin_caso_exito_sin_upsell:  'Cerrado · sin upsell',
  };

  const ESTADO_COLOR = {
    onboarding_pendiente:       { bg: '#FEF3C7', fg: '#92400E' },
    activo:                     { bg: '#D1FAE5', fg: '#065F46' },
    activo_cuota_impaga:        { bg: '#FEE2E2', fg: '#991B1B' },
    extension:                  { bg: '#DBEAFE', fg: '#1E40AF' },
    renovacion_paga:            { bg: '#D1FAE5', fg: '#065F46' },
    caso_exito:                 { bg: '#FEF3C7', fg: '#92400E' },
    pausa:                      { bg: '#E5E7EB', fg: '#374151' },
    reembolso_solicitado:       { bg: '#FEE2E2', fg: '#991B1B' },
    reembolso_efectuado:        { bg: '#F3F4F6', fg: '#6B7280' },
    inactivo:                   { bg: '#F3F4F6', fg: '#6B7280' },
    cancela_impago:             { bg: '#FEE2E2', fg: '#991B1B' },
    fin_de_plazo:               { bg: '#E5E7EB', fg: '#374151' },
    fin_caso_exito_con_upsell:  { bg: '#FEF3C7', fg: '#92400E' },
    fin_caso_exito_sin_upsell:  { bg: '#F3F4F6', fg: '#6B7280' },
  };

  // Grupos para pipeline kanban
  const PIPELINE_GRUPOS = [
    { id: 'onboarding', label: 'Onboarding',     estados: ['onboarding_pendiente'] },
    { id: 'activos',    label: 'Activos',        estados: ['activo','extension','renovacion_paga'] },
    { id: 'riesgo',     label: 'En riesgo',      estados: ['activo_cuota_impaga','pausa','reembolso_solicitado'] },
    { id: 'exito',      label: 'Caso de éxito',  estados: ['caso_exito'] },
    { id: 'cerrados',   label: 'Cerrados',       estados: ['fin_de_plazo','fin_caso_exito_con_upsell','fin_caso_exito_sin_upsell','reembolso_efectuado','cancela_impago','inactivo'] },
  ];

  window.estadosApi = {
    ESTADO_LABEL,
    ESTADO_COLOR,
    PIPELINE_GRUPOS,

    label(slug) { return ESTADO_LABEL[slug] || slug; },
    color(slug) { return ESTADO_COLOR[slug] || { bg: '#E5E7EB', fg: '#374151' }; },
    grupoDe(slug) {
      const g = PIPELINE_GRUPOS.find(g => g.estados.includes(slug));
      return g ? g.id : 'otros';
    },

    // ===== Estado vigente del lead =====
    async obtenerEstadoVigente(leadId) {
      const { data, error } = await window.db
        .from('lead_estado_comercial')
        .select('*, cambiado_por_user:cambiado_por (nombre, email)')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async obtenerHistorial(leadId, limit = 50) {
      const { data, error } = await window.db
        .from('lead_estado_historial')
        .select('*, cambiado_por_user:cambiado_por (nombre, email)')
        .eq('lead_id', leadId)
        .order('cambiado_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },

    // ===== Catálogo de transiciones =====
    // Cache TTL 1h: cambian muy poco (matriz declarativa con seed).
    async listarTransicionesDesde(estadoDesde) {
      const fetcher = async () => {
        const { data, error } = await window.db
          .from('catalogo_transiciones_estado')
          .select('*')
          .eq('estado_desde', estadoDesde)
          .eq('activa', true)
          .order('orden_display');
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get('transiciones_full_desde_' + estadoDesde, fetcher, { ttlMs: 60 * 60 * 1000 });
      }
      return fetcher();
    },

    async listarTodasTransiciones() {
      const fetcher = async () => {
        const { data, error } = await window.db
          .from('catalogo_transiciones_estado')
          .select('*')
          .order('estado_desde')
          .order('orden_display');
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get('transiciones_todas', fetcher, { ttlMs: 60 * 60 * 1000 });
      }
      return fetcher();
    },

    // ===== Aplicar transición (atomic via RPC) =====
    async aplicarTransicion(leadId, estadoHacia, { motivo, categoria_churn, sub_estado, notas } = {}) {
      const { data, error } = await window.db.rpc('aplicar_transicion_estado', {
        p_lead_id: leadId,
        p_estado_hacia: estadoHacia,
        p_motivo: motivo || null,
        p_categoria_churn: categoria_churn || null,
        p_sub_estado: sub_estado || null,
        p_notas: notas || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Transición rechazada');
      return data;
    },

    async puedeCambiar(leadId, estadoHacia) {
      const { data, error } = await window.db.rpc('puede_cambiar_estado', {
        p_lead_id: leadId,
        p_estado_hacia: estadoHacia,
      });
      if (error) throw error;
      return data;
    },

    // ===== ETIQUETAS =====
    async listarEtiquetasCatalogo(soloActivas = true) {
      const fetcher = async () => {
        let q = window.db.from('etiquetas_catalogo').select('*').order('orden').order('nombre');
        if (soloActivas) q = q.eq('activa', true);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get(soloActivas ? 'etiquetas_activas' : 'etiquetas_todas', fetcher);
      }
      return fetcher();
    },

    async crearEtiqueta({ slug, nombre, descripcion, categoria, color, icono, visible_cliente, exclusividad_grupo, evento_disparador, orden }) {
      const s = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!s) throw new Error('Slug inválido');
      const payload = {
        slug: s,
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        categoria: categoria || 'general',
        color: color || '#86868B',
        icono: icono || '◇',
        visible_cliente: !!visible_cliente,
        exclusividad_grupo: exclusividad_grupo || null,
        evento_disparador: evento_disparador || null,
        orden: orden || 0,
      };
      const { data, error } = await window.db.from('etiquetas_catalogo').insert(payload).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('etiquetas');
      return data;
    },

    async actualizarEtiqueta(id, cambios) {
      const allowed = ['nombre','descripcion','categoria','color','icono','visible_cliente','exclusividad_grupo','evento_disparador','orden','activa'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('etiquetas_catalogo').update(payload).eq('id', id).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('etiquetas');
      return data;
    },

    async etiquetasDeLead(leadId) {
      const { data, error } = await window.db
        .from('lead_etiquetas')
        .select('*, etiqueta:etiqueta_id (id, slug, nombre, color, icono, categoria, visible_cliente, exclusividad_grupo)')
        .eq('lead_id', leadId);
      if (error) throw error;
      return data || [];
    },

    async aplicarEtiqueta(leadId, etiquetaId, { notas, vence_at } = {}) {
      // Si la etiqueta tiene exclusividad_grupo, quitar otras del mismo grupo antes.
      // Los errores intermedios se propagan: si fallan, NO seguimos insertando
      // (se violaría la exclusividad en silencio).
      const { data: et, error: errEt } = await window.db.from('etiquetas_catalogo').select('exclusividad_grupo').eq('id', etiquetaId).single();
      if (errEt) throw errEt;
      if (et?.exclusividad_grupo) {
        const { data: mismas, error: errMismas } = await window.db
          .from('etiquetas_catalogo').select('id')
          .eq('exclusividad_grupo', et.exclusividad_grupo).neq('id', etiquetaId);
        if (errMismas) throw errMismas;
        if (mismas?.length) {
          const { error: errDel } = await window.db.from('lead_etiquetas')
            .delete().eq('lead_id', leadId).in('etiqueta_id', mismas.map(x => x.id));
          if (errDel) throw errDel;
        }
      }
      const { data, error } = await window.db
        .from('lead_etiquetas')
        .insert({ lead_id: leadId, etiqueta_id: etiquetaId, notas: notas || null, vence_at: vence_at || null })
        .select().single();
      if (error) throw error;
      return data;
    },

    async quitarEtiqueta(leadId, etiquetaId) {
      const { error } = await window.db.from('lead_etiquetas')
        .delete().eq('lead_id', leadId).eq('etiqueta_id', etiquetaId);
      if (error) throw error;
    },

    // ===== Helpers para pintar badges =====
    badgeEstado(slug) {
      const c = this.color(slug);
      return `<span class="badge" style="background: ${c.bg}; color: ${c.fg};">${this.label(slug)}</span>`;
    },

    badgeEtiqueta(et) {
      return `<span class="badge" style="background: ${et.color}1A; color: ${et.color}; border: 1px solid ${et.color}40;">${et.icono || '◇'} ${window.utils?.escapeHtml ? window.utils.escapeHtml(et.nombre) : et.nombre}</span>`;
    },
  };
})();
