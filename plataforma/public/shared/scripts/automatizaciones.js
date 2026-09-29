// ============================================================================
// automatizaciones.js · helpers para automatizaciones de ciclo de vida (fase 9)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[automatizaciones.js] Falta supabase-client.js');

  const EVENTO_LABEL = {
    cuota_proxima:  { label: 'Cuota próxima',   icon: '⏰', color: '#1E40AF' },
    cuota_atrasada: { label: 'Cuota atrasada',  icon: '⚠', color: '#991B1B' },
    sin_sesion:     { label: 'Sin sesión',      icon: '◌', color: '#92400E' },
    fin_programa:   { label: 'Fin programa',    icon: '◆', color: '#065F46' },
    nps_mensual:    { label: 'NPS mensual',     icon: '★', color: '#6D28D9' },
    dia_programa:   { label: 'Día programa',    icon: '◊', color: '#374151' },
  };
  const ESTADO_BADGE = {
    pendiente: { bg: '#FEF3C7', fg: '#92400E', label: 'Pendiente' },
    enviada:   { bg: '#D1FAE5', fg: '#065F46', label: 'Enviada' },
    fallida:   { bg: '#FEE2E2', fg: '#991B1B', label: 'Fallida' },
  };

  window.autoApi = {
    EVENTO_LABEL, ESTADO_BADGE,

    formatFecha(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
      catch (_) { return '-'; }
    },

    badgeEvento(slug) {
      const m = EVENTO_LABEL[slug] || { label: slug, icon: '·', color: '#6B7280' };
      return `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; background: ${m.color}15; color: ${m.color}; font-size: 11px; font-weight: 600;">
        <span>${m.icon}</span>${m.label}
      </span>`;
    },
    badgeEstado(slug) {
      const m = ESTADO_BADGE[slug] || { bg: '#E5E7EB', fg: '#374151', label: slug };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    async listarReglas() {
      const { data, error } = await window.db
        .from('reglas_automatizacion')
        .select('*')
        .order('evento')
        .order('slug');
      if (error) throw error;
      return data || [];
    },

    async actualizarRegla(id, patch) {
      const { data, error } = await window.db
        .from('reglas_automatizacion')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async listarCola({ estado, limit = 50 } = {}) {
      let q = window.db.from('notificaciones_pendientes')
        .select('id, lead_id, tipo, regla_slug, estado, programada_para, enviada_at, intentos, ultimo_error, metadata, lead:lead_id (nombre, email)')
        .order('programada_para', { ascending: false })
        .limit(limit);
      if (estado) q = q.eq('estado', estado);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async detectarAhora() {
      const { data, error } = await window.db.rpc('detectar_eventos_automatizacion');
      if (error) throw error;
      return data;
    },

    async procesarColaAhora() {
      // Fix: window.SUPABASE_URL no existe; la config real vive en NEURO_CONFIG.
      // Auth: usar el JWT del admin logueado (no pedir CRON_SECRET por prompt).
      const url = `${window.NEURO_CONFIG.SUPABASE_URL}/functions/v1/procesar-cola-automatizaciones`;
      const { data: { session } } = await window.db.auth.getSession();
      if (!session) throw new Error('Sin sesión activa');
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.NEURO_CONFIG.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t}`);
      }
      return res.json();
    },

    async nps() {
      // maybeSingle() en vez de single(): la vista puede no tener filas si
      // no hay respuestas NPS recientes. single() throw PGRST116; maybeSingle()
      // retorna null sin error.
      const { data, error } = await window.db
        .from('vw_dashboard_nps')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data || {};
    },

    // Reinicia una notificación fallida: vuelve a estado='pendiente',
    // reset intentos a 0. El próximo cron la procesa.
    async reintentar(id) {
      const { data, error } = await window.db.from('notificaciones_pendientes')
        .update({ estado: 'pendiente', intentos: 0, ultimo_error: null })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Cancela una notificación (admin no quiere enviarla)
    async cancelar(id) {
      const { data, error } = await window.db.from('notificaciones_pendientes')
        .update({ estado: 'cancelada', ultimo_error: 'cancelada manualmente por admin' })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
})();
