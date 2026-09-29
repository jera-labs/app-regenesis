// ============================================================================
// salud.js · helpers para semáforos (fase 4)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[salud.js] Falta supabase-client.js');

  const COLOR_MAP = {
    verde:    { bg: '#D1FAE5', fg: '#065F46', dot: '#10B981', label: 'Verde' },
    amarillo: { bg: '#FEF3C7', fg: '#92400E', dot: '#F59E0B', label: 'Amarillo' },
    rojo:     { bg: '#FEE2E2', fg: '#991B1B', dot: '#EF4444', label: 'Rojo' },
    gris:     { bg: '#F3F4F6', fg: '#6B7280', dot: '#9CA3AF', label: 'Gris' },
  };

  window.saludApi = {
    COLOR_MAP,

    colorMeta(slug) { return COLOR_MAP[slug] || COLOR_MAP.gris; },

    // Dot visual pequeño (para listas/cards)
    dot(slug, title = '') {
      const c = COLOR_MAP[slug] || COLOR_MAP.gris;
      return `<span title="${title}" style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${c.dot}; flex-shrink: 0;"></span>`;
    },

    // Dot grande para vista detalle
    luzGrande(slug) {
      const c = COLOR_MAP[slug] || COLOR_MAP.gris;
      return `<span style="display: inline-block; width: 24px; height: 24px; border-radius: 50%; background: ${c.dot}; box-shadow: 0 0 0 4px ${c.bg};"></span>`;
    },

    async obtenerSemaforo(leadId) {
      const { data, error } = await window.db
        .from('lead_semaforos')
        .select('*, override_por_user:override_por (nombre, email)')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async listarTodos() {
      const { data, error } = await window.db
        .from('lead_semaforos')
        .select('lead_id, engagement_color, progreso_color');
      if (error) throw error;
      return data || [];
    },

    async recalcularUno(leadId) {
      const { data, error } = await window.db.rpc('recalcular_semaforo_lead', { p_lead_id: leadId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo recalcular');
      return data;
    },

    async recalcularTodos() {
      const { data, error } = await window.db.rpc('recalcular_todos_semaforos');
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo recalcular');
      return data;
    },

    async setOverride({ lead_id, engagement, progreso, motivo, hasta }) {
      const { data, error } = await window.db.rpc('setear_override_semaforo', {
        p_lead_id: lead_id,
        p_engagement: engagement || null,
        p_progreso: progreso || null,
        p_motivo: motivo || null,
        p_hasta: hasta || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo setear override');
      return data;
    },

    async limpiarOverride(leadId) {
      const { data, error } = await window.db.rpc('limpiar_override_semaforo', { p_lead_id: leadId });
      if (error) throw error;
      return data;
    },

    // Indice por lead_id para uso en listas
    indexByLead(arr) {
      const idx = {};
      (arr || []).forEach(s => { idx[s.lead_id] = s; });
      return idx;
    },
  };
})();
