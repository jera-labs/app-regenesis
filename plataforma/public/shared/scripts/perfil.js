// ============================================================================
// Perfil del cliente · 4 capas (datos personales, esencia, negocio, diagnóstico)
//
// Esta versión cubre TODOS los campos de las tablas Supabase, no un subset.
// Si agregás un campo nuevo a la tabla en una migración, lo agregás también
// a la lista correspondiente abajo.
// ============================================================================

(function () {
  // Campos para calcular completitud por capa
  const CAPA_1_FIELDS = [
    'nombre','telefono','pais','ciudad','fecha_nacimiento','documento_identidad',
    'direccion_personal','zona_horaria','instagram_handle','pais_nacimiento','persona_confianza'
  ];

  // cliente_esencia: 13 campos editables (los mismos que esencia.js considera en upsert)
  const CAPA_2_FIELDS = [
    'proposito','mision_promesa','historia_personal','diferenciador','valores',
    'icp_marca','problema_principal','tono_voz','tono_estilo',
    'palabras_si','palabras_no','referencias','canales_principales'
  ];

  // cliente_negocio: campos que cuentan para completitud (~22 críticos para IA)
  const CAPA_3_FIELDS = [
    'modelo_negocio','nombre_negocio','anos_experiencia','sitio_web','redes_sociales',
    'ingreso_ultimo_mes_usd','meta_facturacion_6m_usd','modelo_pricing',
    'horas_trabajo_semana','pct_tiempo_marketing_ventas','pct_tiempo_servicio',
    'clientes_activos','equipo_size','canales_trafico_activos',
    'competidores_principales','ventaja_injusta','tiene_casos_exito',
    'objetivos_principales','problemas_principales','intentos_si_funcionaron',
    'intentos_no_funcionaron','formaciones_previas',
  ];

  // cliente_diagnostico: ~24 críticos
  const CAPA_4_FIELDS = [
    'como_se_describe','referentes_admira','como_se_siente_hoy','como_quiere_sentirse',
    'como_le_gusta_que_lo_coacheen','como_toma_decisiones','ama_en_un_programa','odia_en_un_programa',
    'como_descubrio_neurohackers','tiempo_decision_pago','resistencia_antes_de_pagar',
    'epifania_por_que_pago','por_que_eligio_neurohackers','codigos_corruptos_actuales',
    'miedo_principal_al_escalar','techo_financiero_trauma','protocolos_soberania_actuales',
    'vision_negocio','el_por_que','una_cosa_si_exito','tres_objetivos_proximos',
    'por_que_quieres_esto','hablo_antes_de_pagar_con','esperaba_que_incluyera'
  ];

  // TODOS los campos editables de cliente_negocio (para guardado completo)
  const NEGOCIO_TEXT_FIELDS = [
    'modelo_negocio','nombre_negocio','tipo_entidad','sitio_web',
    'proxima_contratacion','herramienta_gestion','nombre_crm','ventaja_injusta',
    'problemas_principales','mayor_oportunidad_no_explotada','intentos_si_funcionaron',
    'intentos_no_funcionaron','formaciones_previas','decisiones_un_nuevo_ceo','modelo_pricing'
  ];
  const NEGOCIO_NUM_FIELDS = [
    'anos_experiencia','ingreso_ultimo_mes_usd','ingreso_promedio_3m_usd','ingreso_12m_usd',
    'meta_facturacion_6m_usd','valor_promedio_compra_usd','ltv_cliente_usd',
    'cac_costo_adquisicion_usd','deuda_actual_usd','horas_trabajo_semana',
    'pct_tiempo_marketing_ventas','pct_tiempo_servicio','pct_tiempo_operaciones',
    'pct_tiempo_estrategia','clientes_activos','conversion_estimada_pct','prospectos_mes',
    'equipo_size'
  ];
  const NEGOCIO_JSON_FIELDS = ['redes_sociales','canales_trafico_activos','competidores_principales','objetivos_principales'];
  const NEGOCIO_BOOL_FIELDS = ['usa_crm','tiene_casos_exito','tiene_testimonios_recolectados'];

  // TODOS los campos editables de cliente_diagnostico
  const DIAG_TEXT_FIELDS = [
    'como_se_describe','referentes_admira','familia_cercana','como_se_siente_hoy',
    'como_quiere_sentirse','como_le_gusta_que_lo_coacheen','como_toma_decisiones',
    'ama_en_un_programa','odia_en_un_programa','como_descubrio_neurohackers',
    'hablo_antes_de_pagar_con','investigaciones_previas','tiempo_decision_pago',
    'resistencia_antes_de_pagar','epifania_por_que_pago','por_que_eligio_neurohackers',
    'esperaba_que_incluyera','codigos_corruptos_actuales','miedo_principal_al_escalar',
    'techo_financiero_trauma','protocolos_soberania_actuales','vision_negocio',
    'el_por_que','una_cosa_si_exito','por_que_quieres_esto','objetivos_personales_negocio'
  ];
  const DIAG_JSON_FIELDS = ['tres_objetivos_proximos'];
  const DIAG_BOOL_FIELDS = [
    'prioriza_filtros_proyectos','objetivos_trimestre_atados_a_plan',
    'revisa_semanal_que_delegar','trabaja_productividad_equipo','tiene_agenda_reuniones'
  ];

  function calcCompletitud(obj, fields) {
    if (!obj) return 0;
    let llenos = 0;
    for (const f of fields) {
      const v = obj[f];
      if (v === null || v === undefined || v === '') continue;
      if (Array.isArray(v)) { if (v.length) llenos++; }
      else if (typeof v === 'object') { if (Object.keys(v).length) llenos++; }
      else if (typeof v === 'boolean') { if (v) llenos++; }
      else llenos++;
    }
    return Math.round((llenos / fields.length) * 100);
  }

  window.perfilApi = {
    async cargarPerfilCompleto(leadId, leadRow) {
      const [esencia, negocio, diagnostico, onboardingState] = await Promise.all([
        window.db.from('cliente_esencia').select('*').eq('lead_id', leadId).maybeSingle().then(r => r.data),
        window.db.from('cliente_negocio').select('*').eq('lead_id', leadId).maybeSingle().then(r => r.data),
        window.db.from('cliente_diagnostico').select('*').eq('lead_id', leadId).maybeSingle().then(r => r.data),
        window.db.from('cliente_onboarding').select('*').eq('lead_id', leadId).maybeSingle().then(r => r.data),
      ]);

      const score1 = calcCompletitud(leadRow, CAPA_1_FIELDS);
      // ANTES: leíamos esencia.completitud_score guardado, lo que podía
      // quedar desfasado si los datos se insertaron sin pasar por esenciaApi.upsert
      // (seeds, migraciones, ediciones por SQL). Ahora recalculamos siempre,
      // igual que las otras 3 capas.
      const score2 = calcCompletitud(esencia, CAPA_2_FIELDS);
      const score3 = calcCompletitud(negocio, CAPA_3_FIELDS);
      const score4 = calcCompletitud(diagnostico, CAPA_4_FIELDS);

      return {
        capas: {
          datos: { score: score1, data: leadRow },
          esencia: { score: score2, data: esencia },
          negocio: { score: score3, data: negocio },
          diagnostico: { score: score4, data: diagnostico },
        },
        score_global: Math.round((score1 + score2 + score3 + score4) / 4),
        onboarding: onboardingState,
      };
    },

    async sincronizarOnboarding(leadId, scores) {
      const now = new Date().toISOString();
      // Leer timestamps existentes para NO re-escribir capa_X_completada_at en
      // cada visita (se perdía el dato histórico de cuándo completó la capa).
      const { data: prev, error: errPrev } = await window.db
        .from('cliente_onboarding')
        .select('capa_1_completada_at, capa_2_completada_at, capa_3_completada_at, capa_4_completada_at')
        .eq('lead_id', leadId).maybeSingle();
      if (errPrev) throw errPrev;
      const payload = {
        lead_id: leadId,
        score_capa_1: scores.datos,
        score_capa_2: scores.esencia,
        score_capa_3: scores.negocio,
        score_capa_4: scores.diagnostico,
      };
      if (scores.datos >= 80 && !prev?.capa_1_completada_at) payload.capa_1_completada_at = now;
      if (scores.esencia >= 80 && !prev?.capa_2_completada_at) payload.capa_2_completada_at = now;
      if (scores.negocio >= 80 && !prev?.capa_3_completada_at) payload.capa_3_completada_at = now;
      if (scores.diagnostico >= 80 && !prev?.capa_4_completada_at) payload.capa_4_completada_at = now;
      const { data, error } = await window.db
        .from('cliente_onboarding')
        .upsert(payload, { onConflict: 'lead_id' })
        .select().single();
      if (error) throw error;
      return data;
    },

    async guardarDatosPersonales(leadId, datos) {
      const allowed = ['nombre','telefono','documento_identidad','direccion_personal',
                       'zona_horaria','persona_confianza','instagram_handle',
                       'pais_nacimiento','ciudad','fecha_nacimiento'];
      const payload = {};
      for (const k of allowed) {
        if (datos[k] !== undefined) payload[k] = datos[k] === '' ? null : datos[k];
      }
      const { data, error } = await window.db
        .from('leads').update(payload).eq('id', leadId).select().single();
      if (error) throw error;
      return data;
    },

    async guardarNegocio(leadId, datos) {
      const payload = { lead_id: leadId, ultima_actualizacion_at: new Date().toISOString() };

      for (const k of NEGOCIO_TEXT_FIELDS) {
        if (datos[k] !== undefined) payload[k] = (datos[k] || '').toString().trim() || null;
      }
      for (const k of NEGOCIO_NUM_FIELDS) {
        if (datos[k] === undefined) continue;
        // '' o null = el cliente vació el campo → persistir null (antes se
        // omitía la clave y el valor viejo quedaba congelado en BD).
        if (datos[k] === '' || datos[k] === null) {
          payload[k] = null;
        } else {
          const n = Number(datos[k]);
          payload[k] = Number.isFinite(n) ? n : null;
        }
      }
      for (const k of NEGOCIO_JSON_FIELDS) {
        if (datos[k] !== undefined) {
          if (Array.isArray(datos[k])) payload[k] = datos[k].length ? datos[k] : null;
          else if (datos[k] && typeof datos[k] === 'object') payload[k] = Object.keys(datos[k]).length ? datos[k] : null;
          else payload[k] = null;
        }
      }
      for (const k of NEGOCIO_BOOL_FIELDS) {
        if (datos[k] !== undefined) payload[k] = !!datos[k];
      }

      payload.completitud_score = calcCompletitud(payload, CAPA_3_FIELDS);

      const { data, error } = await window.db
        .from('cliente_negocio').upsert(payload, { onConflict: 'lead_id' }).select().single();
      if (error) throw error;
      return data;
    },

    async guardarDiagnostico(leadId, datos) {
      const payload = { lead_id: leadId, ultima_actualizacion_at: new Date().toISOString() };

      for (const k of DIAG_TEXT_FIELDS) {
        if (datos[k] !== undefined) payload[k] = (datos[k] || '').toString().trim() || null;
      }
      for (const k of DIAG_JSON_FIELDS) {
        if (datos[k] !== undefined) {
          payload[k] = (Array.isArray(datos[k]) && datos[k].length) ? datos[k] : null;
        }
      }
      for (const k of DIAG_BOOL_FIELDS) {
        if (datos[k] !== undefined) payload[k] = !!datos[k];
      }

      payload.completitud_score = calcCompletitud(payload, CAPA_4_FIELDS);

      const { data, error } = await window.db
        .from('cliente_diagnostico').upsert(payload, { onConflict: 'lead_id' }).select().single();
      if (error) throw error;
      return data;
    },
  };
})();
