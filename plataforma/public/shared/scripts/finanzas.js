// ============================================================================
// finanzas.js · helpers para Pagos + Snapshot financiero (fase 3)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[finanzas.js] Falta supabase-client.js');

  const ESTADO_LABEL = {
    pendiente: 'Pendiente',
    pagado: 'Pagado',
    atrasado: 'Atrasado',
    perdonado: 'Perdonado',
    reembolsado: 'Reembolsado',
  };
  const ESTADO_COLOR = {
    pendiente:   { bg: '#FEF3C7', fg: '#92400E' },
    pagado:      { bg: '#D1FAE5', fg: '#065F46' },
    atrasado:    { bg: '#FEE2E2', fg: '#991B1B' },
    perdonado:   { bg: '#E5E7EB', fg: '#374151' },
    reembolsado: { bg: '#F3F4F6', fg: '#6B7280' },
  };

  const MODALIDADES = [
    { slug: 'contado', label: 'Contado (1 pago)' },
    { slug: 'cuotas_2', label: '2 cuotas' },
    { slug: 'cuotas_3', label: '3 cuotas' },
    { slug: 'cuotas_4', label: '4 cuotas' },
    { slug: 'cuotas_6', label: '6 cuotas' },
    { slug: 'cuotas_12', label: '12 cuotas' },
    { slug: 'custom', label: 'Custom (otro n° de cuotas)' },
  ];

  const METODOS_PAGO = [
    'stripe_ghl', 'wise', 'crypto', 'transferencia', 'efectivo', 'paypal', 'otro',
  ];

  window.finanzasApi = {
    ESTADO_LABEL, ESTADO_COLOR, MODALIDADES, METODOS_PAGO,

    formatMoney(n, currency = 'USD') {
      if (n === null || n === undefined || n === '') return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(num);
    },

    formatFecha(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
      catch (_) { return '-'; }
    },

    badgeEstado(slug) {
      const c = ESTADO_COLOR[slug] || { bg: '#E5E7EB', fg: '#374151' };
      return `<span class="badge" style="background: ${c.bg}; color: ${c.fg};">${ESTADO_LABEL[slug] || slug}</span>`;
    },

    async obtenerFinanzas(leadId) {
      const { data, error } = await window.db
        .from('cliente_finanzas_programa')
        .select('*, closer:closer_id (nombre, email)')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async listarPagos(leadId) {
      const { data, error } = await window.db
        .from('pagos')
        .select('*, registrado_por_user:registrado_por (nombre, email)')
        .eq('lead_id', leadId)
        .order('numero_cuota', { nullsFirst: false })
        .order('fecha_programada');
      if (error) throw error;
      return data || [];
    },

    async crearCalendarioCuotas({ lead_id, monto_total, n_cuotas, fecha_primer_pago, frecuencia_dias, closer_id, metodo, notas, modalidad }) {
      const { data, error } = await window.db.rpc('crear_calendario_cuotas', {
        p_lead_id: lead_id,
        p_monto_total_usd: Number(monto_total),
        p_n_cuotas: Number(n_cuotas),
        p_fecha_primer_pago: fecha_primer_pago,
        p_frecuencia_dias: Number(frecuencia_dias) || 30,
        p_modalidad: modalidad || null,
        p_closer_id: closer_id || null,
        p_metodo: metodo || null,
        p_notas: notas || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo crear el calendario');
      return data;
    },

    async marcarPagado({ pago_id, fecha_pagado, metodo, referencia, notas }) {
      const { data, error } = await window.db.rpc('marcar_pago_pagado', {
        p_pago_id: pago_id,
        p_fecha_pagado: fecha_pagado || null,
        p_metodo: metodo || null,
        p_referencia: referencia || null,
        p_notas: notas || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo marcar como pagado');
      return data;
    },

    async cancelarCuotasPendientes({ lead_id, accion, motivo }) {
      const { data, error } = await window.db.rpc('cancelar_cuotas_pendientes', {
        p_lead_id: lead_id,
        p_accion: accion,
        p_motivo: motivo || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo cancelar');
      return data;
    },

    // Para upsells y ajustes manuales
    async agregarPago({ lead_id, tipo, monto_usd, fecha_programada, metodo, notas, estado }) {
      const payload = {
        lead_id,
        tipo: tipo || 'upsell',
        monto_usd: Number(monto_usd),
        fecha_programada: fecha_programada || null,
        metodo_pago: metodo || null,
        estado: estado || 'pendiente',
        notas: notas || null,
      };
      const { data, error } = await window.db.from('pagos').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarPago(id, cambios) {
      const allowed = ['monto_usd','fecha_programada','metodo_pago','referencia_externa','notas','estado'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('pagos').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async eliminarPago(id) {
      const { error } = await window.db.from('pagos').delete().eq('id', id);
      if (error) throw error;
    },

    // ===== Sync desde GHL =====
    async syncDesdeGHL({ lead_id, all } = {}) {
      const { data: { session } } = await window.db.auth.getSession();
      if (!session) throw new Error('Sin sesión');
      const res = await fetch(window.NEURO_CONFIG.SUPABASE_URL + '/functions/v1/sync-ghl-pagos', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': window.NEURO_CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(all ? { all: true } : { lead_id }),
      });
      // Leer como texto primero. Si GHL/Cloudflare devuelve 502 con HTML,
      // .json() throwa SyntaxError. Mejor: detectar res.ok ANTES y leer raw.
      const text = await res.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = { rawText: text.slice(0, 200) }; }
      if (!res.ok) {
        const msg = body?.error || body?.rawText || `HTTP ${res.status}`;
        throw new Error(`Sync GHL falló: ${msg}`);
      }
      return body;
    },

    // Agregados para la vista global de cobranza
    async listarPagosCobranza({ estado, fechaDesde, fechaHasta } = {}) {
      let q = window.db
        .from('pagos')
        .select('*, lead:lead_id (id, nombre, email, vehiculo_negocio, telefono)');
      if (estado) q = q.eq('estado', estado);
      if (fechaDesde) q = q.gte('fecha_programada', fechaDesde);
      if (fechaHasta) q = q.lte('fecha_programada', fechaHasta);
      const { data, error } = await q.order('fecha_programada');
      if (error) throw error;
      return data || [];
    },

    // Métricas filtradas a un rango (mes histórico).
    // inicioStr / finStr son fechas YYYY-MM-DD; los filtros se aplican como:
    //   cash recibido → fecha_pagado_at dentro del rango
    //   programados / atrasados / cash perdido → fecha_programada dentro del rango
    async metricasGlobalesRango({ inicioStr, finStr }) {
      const inicioISO = inicioStr + 'T00:00:00.000Z';
      const finISO = finStr + 'T00:00:00.000Z';

      const { data: pagados } = await window.db
        .from('pagos').select('monto_usd')
        .eq('estado', 'pagado')
        .gte('fecha_pagado_at', inicioISO)
        .lt('fecha_pagado_at', finISO);
      const cashMes = (pagados || []).reduce((s, p) => s + Number(p.monto_usd), 0);

      const { data: prog } = await window.db
        .from('pagos').select('monto_usd, estado')
        .gte('fecha_programada', inicioStr)
        .lt('fecha_programada', finStr);
      const rows = prog || [];
      const programados   = rows.reduce((s, p) => s + Number(p.monto_usd), 0);
      const atrasados     = rows.filter(p => p.estado === 'atrasado').reduce((s, p) => s + Number(p.monto_usd), 0);
      const cashPerdido   = rows.filter(p => p.estado === 'perdonado' || p.estado === 'reembolsado').reduce((s, p) => s + Number(p.monto_usd), 0);

      return {
        cashMesUSD: cashMes,
        proximosUSD: programados,
        atrasadosUSD: atrasados,
        cashPerdidoUSD: cashPerdido,
      };
    },

    async metricasGlobales() {
      // Cash recibido este mes
      const inicioMes = new Date();
      inicioMes.setDate(1);
      inicioMes.setHours(0, 0, 0, 0);
      const finMes = new Date(inicioMes);
      finMes.setMonth(finMes.getMonth() + 1);

      const { data: pagados } = await window.db
        .from('pagos').select('monto_usd, fecha_pagado_at')
        .eq('estado', 'pagado')
        .gte('fecha_pagado_at', inicioMes.toISOString())
        .lt('fecha_pagado_at', finMes.toISOString());
      const cashMes = (pagados || []).reduce((s, p) => s + Number(p.monto_usd), 0);

      // Pendientes próximos 7 días
      const hoy = new Date().toISOString().slice(0, 10);
      const en7 = new Date(); en7.setDate(en7.getDate() + 7);
      const en7str = en7.toISOString().slice(0, 10);
      const { data: prox7 } = await window.db
        .from('pagos').select('monto_usd')
        .eq('estado', 'pendiente')
        .gte('fecha_programada', hoy)
        .lte('fecha_programada', en7str);
      const proximos = (prox7 || []).reduce((s, p) => s + Number(p.monto_usd), 0);

      // Atrasados
      const { data: atras } = await window.db
        .from('pagos').select('monto_usd').eq('estado', 'atrasado');
      const atrasados = (atras || []).reduce((s, p) => s + Number(p.monto_usd), 0);

      // Cash perdido (perdonado + reembolsado, total histórico)
      const { data: perd } = await window.db
        .from('pagos').select('monto_usd, estado').in('estado', ['perdonado','reembolsado']);
      const cashPerdido = (perd || []).reduce((s, p) => s + Number(p.monto_usd), 0);

      return {
        cashMesUSD: cashMes,
        proximosUSD: proximos,
        atrasadosUSD: atrasados,
        cashPerdidoUSD: cashPerdido,
      };
    },
  };
})();
