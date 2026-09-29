// ============================================================================
// sesiones.js · helpers para Sesiones 1:1 + QC (fase 6)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[sesiones.js] Falta supabase-client.js');

  const MODALIDADES = [
    { slug: 'zoom', label: 'Zoom' },
    { slug: 'presencial', label: 'Presencial' },
    { slug: 'llamada', label: 'Llamada' },
    { slug: 'grupal', label: 'Grupal' },
  ];

  const ESTADO_QA = {
    pendiente_revision: { bg: '#FEF3C7', fg: '#92400E', label: 'Pendiente QC' },
    aprobada: { bg: '#D1FAE5', fg: '#065F46', label: 'Aprobada' },
    intervencion_requerida: { bg: '#FEE2E2', fg: '#991B1B', label: 'Intervención' },
  };

  window.sesionesApi = {
    MODALIDADES, ESTADO_QA,

    badgeQA(estado) {
      const m = ESTADO_QA[estado] || { bg: '#E5E7EB', fg: '#374151', label: estado };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    formatFecha(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
      catch (_) { return '-'; }
    },

    formatFechaCorta(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
      catch (_) { return '-'; }
    },

    async listar({ lead_id, mentor_id, estado_qa, desde, hasta, limit = 200 } = {}) {
      let q = window.db.from('sesiones_1a1')
        .select('*, lead:lead_id (id, email, nombre, vehiculo_negocio), mentor:mentor_id (nombre, email), supervisor:supervisor_id (nombre, email)');
      if (lead_id) q = q.eq('lead_id', lead_id);
      if (mentor_id) q = q.eq('mentor_id', mentor_id);
      if (estado_qa) q = q.eq('estado_qa', estado_qa);
      if (desde) q = q.gte('fecha', desde);
      if (hasta) q = q.lte('fecha', hasta);
      const { data, error } = await q.order('fecha', { ascending: false }).limit(limit);
      if (error) throw error;
      return data || [];
    },

    async obtener(id) {
      const { data, error } = await window.db.from('sesiones_1a1')
        .select('*, lead:lead_id (id, email, nombre, vehiculo_negocio, sesiones_realizadas), mentor:mentor_id (nombre, email), supervisor:supervisor_id (nombre, email)')
        .eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    async historial(sesionId) {
      const { data, error } = await window.db.from('qc_log')
        .select('*, actor:actor_id (nombre, email)')
        .eq('sesion_id', sesionId).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async crear(payload) {
      // Obtener mentor_id del usuario actual (auto)
      const { data: { session } } = await window.db.auth.getSession();
      let mentor_id = null;
      if (session) {
        const { data: u } = await window.db.from('usuarios_admin').select('id').eq('email', session.user.email).maybeSingle();
        mentor_id = u?.id;
      }
      const row = {
        lead_id: payload.lead_id,
        mentor_id: payload.mentor_id || mentor_id,
        fecha: payload.fecha || new Date().toISOString(),
        modalidad: payload.modalidad || 'zoom',
        duracion_min: payload.duracion_min || null,
        rapport_notas: payload.rapport_notas || null,
        exitos_logros: payload.exitos_logros || null,
        cuello_botella: payload.cuello_botella || null,
        foco_accion: payload.foco_accion || null,
        tareas_cumplidas: payload.tareas_cumplidas || 0,
        tareas_pendientes: payload.tareas_pendientes || 0,
        validacion_tareas: payload.validacion_tareas || [],
        semaforo_engagement_manual: payload.semaforo_engagement_manual || null,
        semaforo_progreso_manual: payload.semaforo_progreso_manual || null,
        notas_semaforos: payload.notas_semaforos || null,
        nps_score_percibido: payload.nps_score_percibido ?? null,
        nps_comentario: payload.nps_comentario || null,
        proxima_sesion_at: payload.proxima_sesion_at || null,
        resumen_visible_cliente: payload.resumen_visible_cliente || null,
        estado_qa: 'pendiente_revision',
      };
      const { data, error } = await window.db.from('sesiones_1a1').insert(row).select().single();
      if (error) throw error;
      return data;
    },

    async actualizar(id, cambios) {
      const allowed = ['fecha','modalidad','duracion_min','rapport_notas','exitos_logros','cuello_botella','foco_accion','tareas_cumplidas','tareas_pendientes','validacion_tareas','semaforo_engagement_manual','semaforo_progreso_manual','notas_semaforos','nps_score_percibido','nps_comentario','proxima_sesion_at','resumen_visible_cliente'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('sesiones_1a1').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async aprobar(id, qc_notas) {
      const { data: { session } } = await window.db.auth.getSession();
      let supervisor_id = null;
      if (session) {
        const { data: u } = await window.db.from('usuarios_admin').select('id').eq('email', session.user.email).maybeSingle();
        supervisor_id = u?.id;
      }
      const { data, error } = await window.db.from('sesiones_1a1').update({
        estado_qa: 'aprobada',
        supervisor_id,
        revisado_at: new Date().toISOString(),
        qc_notas: qc_notas || null,
        qc_intervencion_requerida: false,
      }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async marcarIntervencion(id, qc_notas) {
      const { data: { session } } = await window.db.auth.getSession();
      let supervisor_id = null;
      if (session) {
        const { data: u } = await window.db.from('usuarios_admin').select('id').eq('email', session.user.email).maybeSingle();
        supervisor_id = u?.id;
      }
      if (!qc_notas?.trim()) throw new Error('Para marcar intervención requerida hay que escribir un motivo');
      const { data, error } = await window.db.from('sesiones_1a1').update({
        estado_qa: 'intervencion_requerida',
        supervisor_id,
        revisado_at: new Date().toISOString(),
        qc_notas,
        qc_intervencion_requerida: true,
      }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async reabrir(id) {
      const { data, error } = await window.db.from('sesiones_1a1').update({
        estado_qa: 'pendiente_revision',
        qc_intervencion_requerida: false,
      }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async eliminar(id) {
      const { error } = await window.db.from('sesiones_1a1').delete().eq('id', id);
      if (error) throw error;
    },

    async kpisGlobales() {
      const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
      const finMes = new Date(inicioMes); finMes.setMonth(finMes.getMonth() + 1);

      const [pendientes, aprobadasMes, intervencion, total] = await Promise.all([
        window.db.from('sesiones_1a1').select('id', { count: 'exact', head: true }).eq('estado_qa', 'pendiente_revision'),
        window.db.from('sesiones_1a1').select('id', { count: 'exact', head: true }).eq('estado_qa', 'aprobada').gte('fecha', inicioMes.toISOString()).lt('fecha', finMes.toISOString()),
        window.db.from('sesiones_1a1').select('id', { count: 'exact', head: true }).eq('estado_qa', 'intervencion_requerida'),
        window.db.from('sesiones_1a1').select('id', { count: 'exact', head: true }),
      ]);
      return {
        pendientes: pendientes.count || 0,
        aprobadasMes: aprobadasMes.count || 0,
        intervencion: intervencion.count || 0,
        total: total.count || 0,
      };
    },
  };
})();
