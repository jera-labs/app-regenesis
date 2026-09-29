// ============================================================================
// tracker.js · helpers para Tracker del Cliente (fase 5)
// Cubre: KPIs (definiciones + asignaciones + diario), roadmap, módulos,
// tareas, facturación mensual.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[tracker.js] Falta supabase-client.js');

  window.trackerApi = {

    // ===== KPIs =====
    async listarKpiDefiniciones(soloActivos = true) {
      const fetcher = async () => {
        let q = window.db.from('tracker_kpi_definiciones').select('*').order('orden').order('nombre');
        if (soloActivos) q = q.eq('activo', true);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get(soloActivos ? 'tracker_kpi_defs_activos' : 'tracker_kpi_defs_todos', fetcher);
      }
      return fetcher();
    },

    async crearKpiDefinicion({ slug, nombre, descripcion, tipo, unidad, fase_aplica, target_default, target_unidad, color, icono, orden, visible_cliente }) {
      const s = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!s) throw new Error('Slug requerido');
      if (!nombre?.trim()) throw new Error('Nombre requerido');
      const payload = {
        slug: s, nombre: nombre.trim(),
        descripcion: descripcion || null,
        tipo: tipo || 'predictivo',
        unidad: unidad || 'cantidad',
        fase_aplica: Array.isArray(fase_aplica) ? fase_aplica : null,
        target_default: target_default || null,
        target_unidad: target_unidad || null,
        color: color || '#D4AF37',
        icono: icono || '◆',
        orden: orden || 0,
        visible_cliente: visible_cliente !== false,
      };
      const { data, error } = await window.db.from('tracker_kpi_definiciones').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarKpiDefinicion(id, cambios) {
      const allowed = ['nombre','descripcion','tipo','unidad','fase_aplica','target_default','target_unidad','color','icono','orden','visible_cliente','activo'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('tracker_kpi_definiciones').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async listarKpiAsignaciones(leadId) {
      const { data, error } = await window.db
        .from('tracker_kpi_asignaciones').select('*').eq('lead_id', leadId).eq('activo', true);
      if (error) throw error;
      return data || [];
    },

    // Target efectivo: target personalizado del lead, o target_default del catálogo
    targetEfectivo(kpiDef, asignacion) {
      return asignacion?.target_personalizado ?? kpiDef.target_default ?? null;
    },

    // ===== KPI DIARIO =====
    async listarKpiDiario(leadId, { desde, hasta, kpi_id } = {}) {
      let q = window.db.from('tracker_kpi_diario').select('*').eq('lead_id', leadId);
      if (desde) q = q.gte('fecha', desde);
      if (hasta) q = q.lte('fecha', hasta);
      if (kpi_id) q = q.eq('kpi_id', kpi_id);
      const { data, error } = await q.order('fecha', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async registrarKpiDia({ lead_id, kpi_id, fecha, valor, notas }) {
      const payload = {
        lead_id, kpi_id,
        fecha: fecha || new Date().toISOString().slice(0, 10),
        valor: Number(valor) || 0,
        notas: notas || null,
      };
      // Upsert por unique (lead, kpi, fecha)
      const { data, error } = await window.db.from('tracker_kpi_diario')
        .upsert(payload, { onConflict: 'lead_id,kpi_id,fecha' })
        .select().single();
      if (error) throw error;
      return data;
    },

    // ===== ROADMAP =====
    async listarCheckpointsPlantilla(soloActivos = true) {
      let q = window.db.from('tracker_roadmap_plantilla').select('*').order('orden');
      if (soloActivos) q = q.eq('activo', true);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async crearCheckpoint({ slug, nombre, descripcion, fase, orden, criterio_legible, bloqueante, visible_cliente }) {
      const s = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!s) throw new Error('Slug requerido');
      if (!nombre?.trim()) throw new Error('Nombre requerido');
      const payload = {
        slug: s, nombre: nombre.trim(),
        descripcion: descripcion || null,
        fase: fase || null,
        orden: orden || 0,
        criterio_legible: criterio_legible || null,
        bloqueante: !!bloqueante,
        visible_cliente: visible_cliente !== false,
      };
      const { data, error } = await window.db.from('tracker_roadmap_plantilla').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarCheckpoint(id, cambios) {
      const allowed = ['nombre','descripcion','fase','orden','criterio_legible','bloqueante','visible_cliente','activo'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('tracker_roadmap_plantilla').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async listarCheckpointsLead(leadId) {
      const { data, error } = await window.db
        .from('cliente_roadmap_checkpoints')
        .select('*, alcanzado_por_user:alcanzado_por (nombre, email)')
        .eq('lead_id', leadId);
      if (error) throw error;
      return data || [];
    },

    async marcarCheckpoint({ lead_id, checkpoint_id, evidencia_url, evidencia_notas }) {
      const { data, error } = await window.db
        .from('cliente_roadmap_checkpoints')
        .upsert({
          lead_id, checkpoint_id,
          alcanzado_at: new Date().toISOString(),
          evidencia_url: evidencia_url || null,
          evidencia_notas: evidencia_notas || null,
        }, { onConflict: 'lead_id,checkpoint_id' })
        .select().single();
      if (error) throw error;
      return data;
    },

    async desmarcarCheckpoint(leadId, checkpointId) {
      const { error } = await window.db.from('cliente_roadmap_checkpoints')
        .update({ alcanzado_at: null, alcanzado_por: null, evidencia_url: null, evidencia_notas: null, celebrado_at: null })
        .eq('lead_id', leadId).eq('checkpoint_id', checkpointId);
      if (error) throw error;
    },

    // ===== MÓDULOS =====
    async listarModulos(soloActivos = true) {
      let q = window.db.from('tracker_modulos_programa').select('*').order('orden');
      if (soloActivos) q = q.eq('activo', true);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async crearModulo({ slug, nombre, descripcion, recurso_url, recurso_tipo, duracion_minutos, fase_aplica, orden, visible_cliente }) {
      const s = (slug || '').toLowerCase().trim().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
      if (!s) throw new Error('Slug requerido');
      const payload = {
        slug: s, nombre: nombre.trim(),
        descripcion: descripcion || null,
        recurso_url: recurso_url || null,
        recurso_tipo: recurso_tipo || null,
        duracion_minutos: duracion_minutos || null,
        fase_aplica: fase_aplica || null,
        orden: orden || 0,
        visible_cliente: visible_cliente !== false,
      };
      const { data, error } = await window.db.from('tracker_modulos_programa').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async progresoModulos(leadId) {
      const { data, error } = await window.db
        .from('cliente_modulos_progreso').select('*').eq('lead_id', leadId);
      if (error) throw error;
      return data || [];
    },

    async marcarModulo({ lead_id, modulo_id, accion }) {
      const ahora = new Date().toISOString();
      const campo = accion === 'visto' ? 'visto_at' : accion === 'implementado' ? 'implementado_at' : 'validado_at';
      const payload = { lead_id, modulo_id, [campo]: ahora };
      const { data, error } = await window.db
        .from('cliente_modulos_progreso')
        .upsert(payload, { onConflict: 'lead_id,modulo_id' })
        .select().single();
      if (error) throw error;
      return data;
    },

    // ===== TAREAS =====
    async listarTareas(leadId, { estado } = {}) {
      let q = window.db.from('cliente_tareas')
        .select('*, asignada_por_user:asignada_por (nombre, email)')
        .eq('lead_id', leadId);
      if (estado) q = q.eq('estado', estado);
      const { data, error } = await q.order('fecha_limite', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async crearTarea({ lead_id, titulo, detalle, prioridad, esfuerzo_min, fecha_limite, semana_del_programa, origen, origen_ref_id }) {
      if (!titulo?.trim()) throw new Error('Título requerido');
      const payload = {
        lead_id,
        titulo: titulo.trim(),
        detalle: detalle || null,
        prioridad: prioridad || 'media',
        esfuerzo_min: esfuerzo_min || null,
        fecha_limite: fecha_limite || null,
        semana_del_programa: semana_del_programa || null,
        origen: origen || 'mentor_manual',
        origen_ref_id: origen_ref_id || null,
      };
      const { data, error } = await window.db.from('cliente_tareas').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarTarea(id, cambios) {
      const allowed = ['titulo','detalle','prioridad','esfuerzo_min','fecha_limite','estado','notas_completada'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('cliente_tareas').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async eliminarTarea(id) {
      const { error } = await window.db.from('cliente_tareas').delete().eq('id', id);
      if (error) throw error;
    },

    // ===== FACTURACIÓN MENSUAL =====
    async listarFacturacion(leadId) {
      const { data, error } = await window.db
        .from('cliente_facturacion_mensual').select('*')
        .eq('lead_id', leadId).order('mes', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    // Única definición (antes había una segunda versión posicional más abajo
    // que pisaba a esta y rompía el caller del tracker). Va por RPC para
    // mantener la lógica de negocio del lado del servidor.
    async registrarFacturacionMes({ lead_id, mes, ingreso_usd, clientes_nuevos, upsells, es_snapshot_inicial, notas }) {
      const { data, error } = await window.db.rpc('registrar_facturacion_mes', {
        p_lead_id: lead_id,
        p_mes: mes,
        p_ingreso_usd: Number(ingreso_usd) || 0,
        p_clientes_nuevos: clientes_nuevos === '' || clientes_nuevos == null ? null : Number(clientes_nuevos),
        p_upsells: upsells === '' || upsells == null ? null : Number(upsells),
        p_es_snapshot_inicial: !!es_snapshot_inicial,
        p_notas: notas || null,
      });
      if (error) throw error;
      return data;
    },

    // ===== HELPERS =====
    formatValor(valor, kpiDef) {
      if (valor === null || valor === undefined) return '-';
      if (kpiDef?.unidad === 'usd' || kpiDef?.target_unidad?.includes('USD')) {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(valor));
      }
      return new Intl.NumberFormat('es-ES').format(Number(valor));
    },

    formatFecha(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
      catch (_) { return '-'; }
    },

    formatMes(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); }
      catch (_) { return '-'; }
    },

    prioridadBadge(p) {
      const m = {
        alta: { bg: '#FEE2E2', fg: '#991B1B', label: 'Alta' },
        media: { bg: '#FEF3C7', fg: '#92400E', label: 'Media' },
        baja: { bg: '#E5E7EB', fg: '#374151', label: 'Baja' },
      }[p] || { bg: '#E5E7EB', fg: '#374151', label: p };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    estadoTareaBadge(e) {
      const m = {
        pendiente: { bg: '#FEF3C7', fg: '#92400E', label: 'Pendiente' },
        en_progreso: { bg: '#DBEAFE', fg: '#1E40AF', label: 'En progreso' },
        completada: { bg: '#D1FAE5', fg: '#065F46', label: 'Completada' },
        descartada: { bg: '#F3F4F6', fg: '#6B7280', label: 'Descartada' },
      }[e] || { bg: '#E5E7EB', fg: '#374151', label: e };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    // ============================================================
    // Dashboard del cliente (Fase 5) — UNA llamada → todo
    // ============================================================
    async dashboardCliente(leadId) {
      const { data, error } = await window.db.rpc('tracker_dashboard_cliente', { p_lead_id: leadId });
      if (error) throw error;
      return data || {};
    },

    async registrarKpiDiario(leadId, kpiId, valor, { fecha = null, notas = null } = {}) {
      const { data, error } = await window.db.rpc('registrar_kpi_diario', {
        p_lead_id: leadId, p_kpi_id: kpiId, p_valor: Number(valor),
        p_fecha: fecha || new Date().toISOString().slice(0, 10),
        p_notas: notas,
      });
      if (error) throw error;
      return data;
    },

    async completarTarea(tareaId, notas = null) {
      const { data, error } = await window.db.rpc('completar_tarea_cliente', {
        p_tarea_id: tareaId, p_notas: notas,
      });
      if (error) throw error;
      return data;
    },

    async marcarModuloEstado(leadId, moduloId, estado) {
      // estado: visto | implementado | validado
      const { data, error } = await window.db.rpc('marcar_modulo_estado', {
        p_lead_id: leadId, p_modulo_id: moduloId, p_estado: estado,
      });
      if (error) throw error;
      return data;
    },

  };
})();
