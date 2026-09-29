// ============================================================================
// dashboards.js · helpers para Dashboards Globales (fase 8)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[dashboards.js] Falta supabase-client.js');

  window.dashboardsApi = {
    formatMoney(n) {
      if (n === null || n === undefined) return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
    },
    formatPct(n) {
      if (n === null || n === undefined) return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      return num.toFixed(1) + '%';
    },
    formatDias(n) {
      if (n === null || n === undefined || Number(n) === 0) return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      return Math.round(num) + ' días';
    },
    formatNum(n) {
      if (n === null || n === undefined) return '0';
      const num = Number(n);
      if (!Number.isFinite(num)) return '0';
      return new Intl.NumberFormat('en-US').format(num);
    },
    formatSemana(d) {
      if (!d) return '-';
      try {
        const f = new Date(d);
        return f.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      } catch (_) { return '-'; }
    },
    deltaPct(actual, anterior) {
      const a = Number(actual);
      const b = Number(anterior);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) {
        return a > 0 ? '+∞' : '0';
      }
      const pct = ((a - b) / b) * 100;
      const signo = pct >= 0 ? '+' : '';
      return signo + pct.toFixed(0) + '%';
    },

    async kpisGlobales() {
      const { data, error } = await window.db.rpc('dashboard_kpis_globales');
      if (error) throw error;
      return data || {};
    },

    async cohortes() {
      // Fix: la vista expone `cohorte_inicio`, no `fecha_inicio`.
      const { data, error } = await window.db
        .from('vw_dashboard_cohortes')
        .select('*')
        .order('cohorte_inicio', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },

    async segmentos() {
      const { data, error } = await window.db
        .from('vw_dashboard_segmento')
        .select('*')
        .order('n_clientes', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async timeTo() {
      // maybeSingle: con la vista vacía, .single() lanza PGRST116.
      const { data, error } = await window.db
        .from('vw_dashboard_time_to')
        .select('*')
        .maybeSingle();
      if (error) throw error;
      return data || {};
    },

    async mentores() {
      const { data, error } = await window.db
        .from('vw_dashboard_mentor')
        .select('*');
      if (error) throw error;
      return data || [];
    },

    async velocidadSemanal() {
      const { data, error } = await window.db
        .from('vw_dashboard_velocidad_semanal')
        .select('*');
      if (error) throw error;
      return data || [];
    },
  };
})();
