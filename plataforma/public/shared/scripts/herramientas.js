// ============================================================================
// Herramientas accionables: las 4 calculadoras del módulo Plan.
//
// Inspiradas en los frameworks BlueHackers + cuestionario PACTO de Frank, pero
// reescritas con la voz Neurohackers, conectadas al perfil del cliente y con
// outputs guardados en `plan_calculado` para usar en otras IA.
// ============================================================================

(function () {
  // ====================================================================
  // CALCULADORA 1 · MI META (Matemática del éxito)
  //
  // Dado meta mensual + precio promedio + conversión, calcula:
  //   - clientes/mes necesarios
  //   - bookings/mes (a una conversión X)
  //   - mensajes outbound/mes (a un % de respuesta)
  //   - inversión recomendada en ads
  //   - lo mismo dividido por día/semana
  // ====================================================================
  function calcMiMeta({ metaMensual, precioPromedio, conversionBookingPct, conversionAdsPct, cpaAds, respuestaMensajePct }) {
    metaMensual         = Number(metaMensual)         || 0;
    precioPromedio      = Number(precioPromedio)      || 1;
    conversionBookingPct = Number(conversionBookingPct) || 20;  // % de bookings que cierran
    conversionAdsPct     = Number(conversionAdsPct)    || 2;    // % de visitas ads que agendan
    cpaAds               = Number(cpaAds)              || 100;  // costo por booking via ads
    respuestaMensajePct  = Number(respuestaMensajePct) || 10;   // % de mensajes outbound que responden

    if (precioPromedio <= 0) return null;

    const clientesNecesarios = Math.ceil(metaMensual / precioPromedio);
    const bookingsNecesarios = Math.ceil(clientesNecesarios / (conversionBookingPct / 100));
    const inversionAds = bookingsNecesarios * cpaAds;
    const mensajesOutbound = Math.ceil(bookingsNecesarios / (respuestaMensajePct / 100));

    return {
      clientesNecesarios,
      bookingsNecesarios,
      bookingsPorDia: Math.ceil(bookingsNecesarios / 30),
      bookingsPorSemana: Math.ceil(bookingsNecesarios / 4),
      inversionAds,
      inversionAdsPorDia: Math.ceil(inversionAds / 30),
      mensajesOutbound,
      mensajesPorDia: Math.ceil(mensajesOutbound / 30),
      ingresoAnual: metaMensual * 12,
    };
  }

  // ====================================================================
  // CALCULADORA 2 · MI PRECIO (3 modos)
  //
  // Modo 1: Valor percibido (transformación × certeza ÷ ROI cliente)
  // Modo 2: Costos + margen
  // Modo 3: Embudo (basado en métricas de adquisición)
  // ====================================================================
  function calcMiPrecio({
    valorTransformacion, tasaExito, roiCliente,        // modo 1
    costoServicio, margenDeseado,                       // modo 2
    inversionAds, cpl, asistenciaPct, cierrePct,       // modo 3
  }) {
    const r = {};

    // Modo 1: Valor percibido
    if (valorTransformacion && roiCliente) {
      const valorPercibido = (Number(valorTransformacion) || 0) * ((Number(tasaExito) || 30) / 100);
      r.precioPorValor = Math.round(valorPercibido / (Number(roiCliente) || 10));
      r.valorPercibido = Math.round(valorPercibido);
    }

    // Modo 2: Costos + margen
    if (costoServicio && margenDeseado) {
      const c = Number(costoServicio) || 0;
      const m = Number(margenDeseado) || 70;
      r.precioPorCosto = Math.round(c / (1 - m / 100));
    }

    // Modo 3: Embudo
    const i = Number(inversionAds) || 0;
    const cplN = Number(cpl) || 1;
    const a = Number(asistenciaPct) || 30;
    const ci = Number(cierrePct) || 20;
    if (i > 0 && cplN > 0) {
      const leads = Math.floor(i / cplN);
      const asistentes = Math.floor(leads * (a / 100));
      const clientes = Math.floor(asistentes * (ci / 100));
      r.embudoLeads = leads;
      r.embudoAsistentes = asistentes;
      r.embudoClientes = clientes;
      r.embudoCostoPorCliente = clientes ? Math.round(i / clientes) : null;
    }
    return r;
  }

  // ====================================================================
  // CALCULADORA 4 · SALUD 360 (auditoría rápida)
  //
  // 4 pilares × 10 preguntas booleanas = score 0-100 por pilar
  // ====================================================================
  const PILARES_SALUD = [
    { id: 'identidad', nombre: 'Identidad y visión', preguntas: [
      'Tengo una visión clara de mi negocio a 12 meses',
      'Mi propósito y valores están escritos y los uso',
      'Conozco mi diferenciador real vs competencia',
      'Dedico tiempo cada semana a estrategia (no solo operativa)',
      'Tengo objetivos claros para este trimestre',
      'Reviso semanalmente qué puedo delegar',
      'Trabajo activamente mi productividad y la del equipo',
      'Tengo agenda definida de reuniones clave',
      'Conozco mi "por qué" que me hace saltar de la cama',
      'Mi visión es atractiva para mi equipo (si lo tengo)',
    ]},
    { id: 'marketing', nombre: 'Marketing y atracción', preguntas: [
      'Atraigo prospectos de forma consistente y predecible',
      'Tengo claro mi avatar / cliente ideal',
      'Mi promesa es tangible y medible',
      'Tengo presencia activa en al menos 1 canal orgánico',
      'Tengo casos de éxito documentados y los uso en marketing',
      'Mi web/perfiles comunican claro lo que hago',
      'Tengo testimonios recolectados sistemáticamente',
      'Sé exactamente cuántos prospectos genero al mes',
      'Tengo un sistema para que clientes me refieran',
      'Mi posicionamiento es claro vs competencia',
    ]},
    { id: 'ventas', nombre: 'Ventas y conversión', preguntas: [
      'Tengo un proceso de ventas documentado',
      'Conozco las objeciones comunes y cómo responderlas',
      'Tengo un guion de ventas que uso',
      'Tengo un sistema de seguimiento de prospectos (CRM)',
      'Mi tasa de cierre es predecible (sé % aproximado)',
      'Mi precio está alineado al valor que entrego',
      'Tengo tickets/escalones de precio (no solo uno)',
      'Cuando cierro, hago upsell o cross-sell',
      'Tengo garantía y/o razón para actuar ya',
      'Tengo bonos o extras que hacen mi oferta irresistible',
    ]},
    { id: 'servicio', nombre: 'Servicio y operaciones', preguntas: [
      'Tengo un proceso claro de entrega de servicio',
      'Mido el éxito de mis clientes (% que logra promesa)',
      'Obtengo casos de éxito de forma consistente',
      'Obtengo referidos sistemáticamente de clientes felices',
      'Mis sistemas de marketing/ventas/servicio están documentados',
      'Tengo dashboard con mis KPIs clave',
      'Conozco mi costo de adquisición de cliente (CAC)',
      'Conozco mi LTV (valor de por vida del cliente)',
      'Sé exactamente cuánto puedo pagar por un cliente rentablemente',
      'Mi negocio puede operar sin mí al menos 1 semana',
    ]},
  ];

  function calcSalud360(respuestas) {
    // respuestas = { 'identidad-0': true, ... }
    const pilares = {};
    PILARES_SALUD.forEach(pilar => {
      let yes = 0;
      pilar.preguntas.forEach((_, i) => {
        if (respuestas[`${pilar.id}-${i}`]) yes++;
      });
      pilares[pilar.id] = {
        nombre: pilar.nombre,
        score: Math.round((yes / pilar.preguntas.length) * 100),
        respondidas: yes,
        total: pilar.preguntas.length,
      };
    });
    const scores = Object.values(pilares).map(p => p.score);
    return {
      pilares,
      global: Math.round(scores.reduce((s, n) => s + n, 0) / scores.length),
      pilarMasDebil: Object.entries(pilares).sort((a, b) => a[1].score - b[1].score)[0],
      pilarMasFuerte: Object.entries(pilares).sort((a, b) => b[1].score - a[1].score)[0],
    };
  }

  // ====================================================================
  // API público
  // ====================================================================
  window.herramientasApi = {
    PILARES_SALUD,

    calcMiMeta, calcMiPrecio, calcSalud360,

    async cargarPlanes(leadId) {
      const { data, error } = await window.db
        .from('plan_calculado').select('*').eq('lead_id', leadId);
      if (error) throw error;
      const byTipo = {};
      (data || []).forEach(p => { byTipo[p.tipo] = p; });
      return byTipo;
    },

    async guardarPlan(leadId, tipo, inputs, outputs, notas = null) {
      const payload = {
        lead_id: leadId, tipo, inputs, outputs, notas,
        calculado_at: new Date().toISOString(),
      };
      const { data, error } = await window.db
        .from('plan_calculado')
        .upsert(payload, { onConflict: 'lead_id,tipo' })
        .select().single();
      if (error) throw error;
      return data;
    },

    formatMoney(n) {
      if (n === null || n === undefined || !Number.isFinite(Number(n))) return '-';
      return '$' + Math.round(Number(n)).toLocaleString('en-US');
    },
  };
})();
