// ============================================================================
// jobs.js · cliente de la cola asíncrona (Fase 3 optimización)
//
// Uso:
//   const job = await jobsApi.encolar('recalcular_salud_todos', {});
//   const final = await jobsApi.esperar(job.id, (r) => console.log(r.estado));
//   // o sin esperar:
//   jobsApi.estado(job.id).then(r => ...);
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[jobs.js] Falta supabase-client.js');

  window.jobsApi = {

    // === Encolar (devuelve { id, dedupe_key } ó el job existente si dedup) ===
    async encolar(tipo, parametros = {}, leadId = null, opts = {}) {
      const dedupeWindow = opts.dedupeWindowMin ?? 5;
      const { data, error } = await window.db.rpc('encolar_job', {
        p_tipo: tipo,
        p_parametros: parametros || {},
        p_lead_id: leadId,
        p_dedupe_window_min: dedupeWindow,
      });
      if (error) throw error;
      return { id: data };
    },

    async estado(jobId) {
      const { data, error } = await window.db
        .from('cola_jobs')
        .select('id, tipo, estado, resultado, intentos, ultimo_error, encolado_at, iniciado_at, completado_at')
        .eq('id', jobId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /**
     * Polling hasta que termine. Llama onUpdate(estadoActual) cada tick.
     * Devuelve el estado final.
     */
    async esperar(jobId, onUpdate, opts = {}) {
      const intervalMs = opts.intervalMs ?? 2000;
      const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
      const start = Date.now();
      while (true) {
        const r = await this.estado(jobId);
        try { onUpdate?.(r); } catch (_) {}
        if (!r) return null;
        if (r.estado === 'completado' || r.estado === 'fallido' || r.estado === 'expirado') return r;
        if (Date.now() - start > timeoutMs) {
          return { ...r, timeout: true };
        }
        await new Promise(res => setTimeout(res, intervalMs));
      }
    },

    /**
     * Helper para encolar y mostrar toast/feedback simple sin polling.
     * Útil para "fire and forget" desde un botón.
     */
    async encolarYNotificar(tipo, parametros = {}, leadId = null, mensaje = 'Procesando en background…') {
      const j = await this.encolar(tipo, parametros, leadId);
      if (typeof window.mostrarToast === 'function') window.mostrarToast(mensaje);
      return j;
    },

    // === Listado para vista admin (jobs recientes) ===
    async listarRecientes({ tipo, estado, limit = 50 } = {}) {
      let q = window.db
        .from('cola_jobs')
        .select('id, tipo, lead_id, estado, intentos, encolado_at, completado_at, ultimo_error')
        .order('encolado_at', { ascending: false })
        .limit(limit);
      if (tipo) q = q.eq('tipo', tipo);
      if (estado) q = q.eq('estado', estado);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  };
})();
