// ============================================================================
// comisiones.js · helpers para Comisiones + Nómina (fase 7)
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[comisiones.js] Falta supabase-client.js');

  const TIPO_LABEL = {
    sesion_1a1: 'Sesión 1:1',
    caso_exito: 'Caso de éxito',
    referido: 'Referido',
    upsell: 'Upsell',
    ajuste_manual: 'Ajuste manual',
    bono: 'Bono',
  };

  const ESTADO_COLOR = {
    pendiente:  { bg: '#FEF3C7', fg: '#92400E', label: 'Pendiente' },
    liquidada:  { bg: '#DBEAFE', fg: '#1E40AF', label: 'Liquidada' },
    revertida:  { bg: '#F3F4F6', fg: '#6B7280', label: 'Revertida' },
    disputada:  { bg: '#FEE2E2', fg: '#991B1B', label: 'Disputada' },
  };

  const LIQ_ESTADO_COLOR = {
    borrador: { bg: '#F3F4F6', fg: '#6B7280', label: 'Borrador' },
    aprobada: { bg: '#FEF3C7', fg: '#92400E', label: 'Aprobada' },
    pagada:   { bg: '#D1FAE5', fg: '#065F46', label: 'Pagada' },
  };

  window.comisionesApi = {
    TIPO_LABEL, ESTADO_COLOR, LIQ_ESTADO_COLOR,

    formatMoney(n) {
      if (n === null || n === undefined) return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
    },
    formatFecha(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); }
      catch (_) { return '-'; }
    },
    formatMes(d) {
      if (!d) return '-';
      try { return new Date(d).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); }
      catch (_) { return '-'; }
    },
    badgeEstado(slug) {
      const m = ESTADO_COLOR[slug] || { bg: '#E5E7EB', fg: '#374151', label: slug };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },
    badgeLiq(slug) {
      const m = LIQ_ESTADO_COLOR[slug] || { bg: '#E5E7EB', fg: '#374151', label: slug };
      return `<span class="badge" style="background: ${m.bg}; color: ${m.fg};">${m.label}</span>`;
    },

    async listarEventos({ miembro_id, mes, estado, tipo_evento } = {}) {
      let q = window.db.from('comisiones_devengadas')
        .select('*, miembro:miembro_id (nombre, email), lead:lead_id (nombre, email)');
      if (miembro_id) q = q.eq('miembro_id', miembro_id);
      if (estado) q = q.eq('estado', estado);
      if (tipo_evento) q = q.eq('tipo_evento', tipo_evento);
      if (mes) {
        const inicio = new Date(mes); inicio.setDate(1); inicio.setHours(0,0,0,0);
        const fin = new Date(inicio); fin.setMonth(fin.getMonth() + 1);
        q = q.gte('fecha_evento', inicio.toISOString()).lt('fecha_evento', fin.toISOString());
      }
      const { data, error } = await q.order('fecha_evento', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async listarLiquidaciones({ miembro_id, mes } = {}) {
      let q = window.db.from('liquidaciones_mensuales')
        .select('*, miembro:miembro_id (nombre, email), cerrada_por_user:cerrada_por (nombre), pagada_por_user:pagada_por (nombre)');
      if (miembro_id) q = q.eq('miembro_id', miembro_id);
      if (mes) q = q.eq('periodo_mes', mes);
      const { data, error } = await q.order('periodo_mes', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async cerrarMesMiembro(miembro_id, periodo_mes) {
      const { data, error } = await window.db.rpc('cerrar_mes_miembro', {
        p_miembro_id: miembro_id, p_periodo_mes: periodo_mes,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo cerrar el mes');
      return data;
    },

    async previsualizarMes(periodo_mes) {
      const { data, error } = await window.db.rpc('previsualizar_liquidaciones_mes', {
        p_mes: periodo_mes,
      });
      if (error) throw error;
      return data;
    },

    async generarLiquidacionesMes(periodo_mes) {
      const { data, error } = await window.db.rpc('generar_liquidaciones_mes', {
        p_mes: periodo_mes,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo generar el cierre masivo');
      return data;
    },

    async resumenPorMentor() {
      const { data, error } = await window.db.from('vw_comisiones_resumen_mentor')
        .select('*').order('total_pendiente_usd', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async marcarLiquidacionPagada(id, { metodo, referencia, notas } = {}) {
      const { data, error } = await window.db.rpc('marcar_liquidacion_pagada', {
        p_liquidacion_id: id, p_metodo: metodo || null, p_referencia: referencia || null, p_notas: notas || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'No se pudo marcar pagada');
      return data;
    },

    async ajusteManual({ miembro_id, monto_usd, detalle, lead_id, tipo_evento }) {
      const payload = {
        miembro_id,
        tipo_evento: tipo_evento || 'ajuste_manual',
        monto_usd: Number(monto_usd),
        detalle: detalle || null,
        lead_id: lead_id || null,
        fecha_evento: new Date().toISOString(),
      };
      const { data, error } = await window.db.from('comisiones_devengadas').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async revertirEvento(id, motivo) {
      const { data, error } = await window.db.from('comisiones_devengadas')
        .update({ estado: 'revertida', notas_internas: motivo || 'Revertida manualmente' })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    // Métricas para vista global
    async metricas() {
      const inicioMes = new Date(); inicioMes.setDate(1); inicioMes.setHours(0,0,0,0);
      const finMes = new Date(inicioMes); finMes.setMonth(finMes.getMonth() + 1);

      const [pend, mesLiq, mesPend] = await Promise.all([
        window.db.from('comisiones_devengadas').select('monto_usd').eq('estado', 'pendiente'),
        window.db.from('liquidaciones_mensuales').select('total_usd').eq('estado', 'pagada')
          .gte('periodo_mes', inicioMes.toISOString().slice(0, 10)).lt('periodo_mes', finMes.toISOString().slice(0, 10)),
        window.db.from('comisiones_devengadas').select('monto_usd').eq('estado', 'pendiente')
          .gte('fecha_evento', inicioMes.toISOString()).lt('fecha_evento', finMes.toISOString()),
      ]);

      return {
        pendientesUSD: (pend.data || []).reduce((s, x) => s + Number(x.monto_usd), 0),
        pagadasMesUSD: (mesLiq.data || []).reduce((s, x) => s + Number(x.total_usd), 0),
        devengadasMesUSD: (mesPend.data || []).reduce((s, x) => s + Number(x.monto_usd), 0),
      };
    },
  };
})();
