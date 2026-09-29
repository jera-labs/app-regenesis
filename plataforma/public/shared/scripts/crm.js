// ============================================================================
// crm.js · helpers para el CRM core expandido (fase 1)
//
// Cubre:
// - Cohortes (CRUD, listar)
// - Enlaces operativos por cliente (CRUD)
// - Arquetipo del cliente (upsert + lectura)
// - Configuración del sistema (singleton)
// - Datos CRM en leads (vehículo, nicho, promesa, churn, etc.)
//
// Todo asume que window.db ya está cargado.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') {
    throw new Error('[crm.js] Falta supabase-client.js antes que crm.js');
  }

  const TIPOS_ENLACE_SUGERIDOS = [
    { slug: 'vsl', label: 'VSL · Sales letter' },
    { slug: 'grabacion_venta', label: 'Grabación de la llamada de cierre' },
    { slug: 'contrato', label: 'Contrato firmado' },
    { slug: 'drive', label: 'Google Drive del cliente' },
    { slug: 'calendar', label: 'Calendario de sesiones' },
    { slug: 'skool', label: 'Skool del cliente' },
    { slug: 'loom', label: 'Loom de bienvenida' },
    { slug: 'otro', label: 'Otro' },
  ];

  const ARQUETIPOS = [
    { slug: 'explorador', label: 'Explorador', desc: 'Aún define oferta, busca claridad de mercado y posicionamiento.' },
    { slug: 'constructor', label: 'Constructor', desc: 'Oferta validada, primer cliente cerrado, falta sistema y volumen.' },
    { slug: 'escalador', label: 'Escalador', desc: 'Cierre constante, busca volumen, equipo y multiplicar tráfico.' },
    { slug: 'consolidador', label: 'Consolidador', desc: 'Negocio sólido, optimiza márgenes, sucesión, marca personal.' },
    { slug: 'no_clasificado', label: 'No clasificado', desc: 'Aún no se determina.' },
  ];

  const VEHICULOS_SUGERIDOS = [
    'Coaching 1:1',
    'Coaching grupal',
    'Infoproducto / curso',
    'Servicio hecho-para-ti (DFY)',
    'Servicio mentoría',
    'Agencia',
    'SaaS',
    'E-commerce',
    'Membresía',
    'Eventos / talleres',
    'Otro',
  ];

  window.crmApi = {
    TIPOS_ENLACE_SUGERIDOS,
    ARQUETIPOS,
    VEHICULOS_SUGERIDOS,

    // ===== CONFIG SINGLETON =====
    async cargarConfig() {
      const { data, error } = await window.db
        .from('config_automatizaciones')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async guardarConfig(cambios) {
      const allowed = [
        'dias_programa_default','semanas_programa_default','umbral_caso_exito_usd',
        'sesiones_para_desvincular','dias_gracia_cuota_impaga',
        'nps_intervalo_dias','nps_umbral_promotor','nps_umbral_riesgo',
        'semaforo_dias_sin_login_amarillo','semaforo_dias_sin_login_rojo',
        'comision_por_sesion_usd','comision_caso_exito_pct','comision_referido_pct',
        'comision_upsell_pct','comisiones_activas','razones_churn',
        'qc_sla_horas','qc_auto_aprobar_horas','tracker_semanas_alerta_engagement',
        'moneda_funcional','metadata',
      ];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db
        .from('config_automatizaciones')
        .update(payload).eq('id', 1).select().single();
      if (error) throw error;
      return data;
    },

    // ===== COHORTES =====
    async listarCohortes(soloActivas = false) {
      const fetcher = async () => {
        let q = window.db.from('cohortes').select('*').order('fecha_inicio', { ascending: false });
        if (soloActivas) q = q.eq('activa', true);
        const { data, error } = await q;
        if (error) throw error;
        return data || [];
      };
      if (window.neuroCache) {
        return window.neuroCache.get(soloActivas ? 'cohortes_activas' : 'cohortes_todas', fetcher);
      }
      return fetcher();
    },

    async crearCohorte({ slug, nombre, descripcion, fecha_inicio, fecha_fin_estimada, duracion_dias, cupo_maximo }) {
      const payload = {
        slug: slug.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, ''),
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        fecha_inicio: fecha_inicio || null,
        fecha_fin_estimada: fecha_fin_estimada || null,
        duracion_dias: duracion_dias || 70,
        cupo_maximo: cupo_maximo || null,
        activa: true,
      };
      const { data, error } = await window.db.from('cohortes').insert(payload).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('cohortes');
      return data;
    },

    async actualizarCohorte(id, cambios) {
      const allowed = ['nombre','descripcion','fecha_inicio','fecha_fin_estimada','duracion_dias','cupo_maximo','activa'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('cohortes').update(payload).eq('id', id).select().single();
      if (error) throw error;
      window.neuroCache?.invalidatePrefix('cohortes');
      return data;
    },

    // ===== ENLACES =====
    async listarEnlaces(leadId) {
      const { data, error } = await window.db
        .from('cliente_enlaces')
        .select('*, creado_por_user:creado_por (nombre, email)')
        .eq('lead_id', leadId)
        .order('orden', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async crearEnlace({ lead_id, tipo, etiqueta, url, notas }) {
      const u = (url || '').trim();
      if (!u.match(/^https?:\/\//)) throw new Error('La URL debe empezar con http:// o https://');
      const payload = {
        lead_id,
        tipo: (tipo || 'otro').trim().toLowerCase(),
        etiqueta: etiqueta?.trim() || null,
        url: u,
        notas: notas?.trim() || null,
      };
      const { data, error } = await window.db.from('cliente_enlaces').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarEnlace(id, cambios) {
      const allowed = ['tipo','etiqueta','url','notas','orden'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db.from('cliente_enlaces').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async eliminarEnlace(id) {
      const { error } = await window.db.from('cliente_enlaces').delete().eq('id', id);
      if (error) throw error;
    },

    // ===== ARQUETIPO =====
    async obtenerArquetipo(leadId) {
      const { data, error } = await window.db
        .from('cliente_arquetipo')
        .select('*, determinado_por_user:determinado_por (nombre, email)')
        .eq('lead_id', leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async upsertArquetipo(leadId, { arquetipo, sub_arquetipo, razon }) {
      const validos = ARQUETIPOS.map(a => a.slug);
      if (!validos.includes(arquetipo)) throw new Error('Arquetipo inválido: ' + arquetipo);
      const payload = {
        lead_id: leadId,
        arquetipo,
        sub_arquetipo: sub_arquetipo?.trim() || null,
        razon: razon?.trim() || null,
      };
      const { data, error } = await window.db
        .from('cliente_arquetipo')
        .upsert(payload, { onConflict: 'lead_id' })
        .select().single();
      if (error) throw error;
      return data;
    },

    // ===== DATOS CRM en LEAD =====
    async actualizarDatosCRM(leadId, datos) {
      const allowed = [
        'vehiculo_negocio','nicho_mercado','promesa_transformacion',
        'precio_oferta_principal_usd','ltv_oferta_principal_usd',
        'cohorte_id','duracion_contractual_dias','monto_total_programa_usd',
        'fecha_activacion_programa','fecha_fin_contractual',
        'launched_at','primera_venta_at','caso_exito_at',
        'churn_at','churn_motivo','churn_categoria',
        'proxima_sesion_at','ultima_sesion_at','sesiones_realizadas',
      ];
      const payload = {};
      for (const k of allowed) {
        if (datos[k] !== undefined) {
          const v = datos[k];
          payload[k] = (v === '' || v === null) ? null : v;
        }
      }
      // Auto-calcular fecha_fin_contractual si activan y dan duración.
      // Aritmética 100% UTC: mezclar new Date('YYYY-MM-DD') (UTC) con
      // setDate (local) corre un día al cruzar cambios de horario.
      if (payload.fecha_activacion_programa && payload.duracion_contractual_dias) {
        const d = new Date(payload.fecha_activacion_programa + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + Number(payload.duracion_contractual_dias));
        payload.fecha_fin_contractual = d.toISOString().slice(0, 10);
      }
      const { data, error } = await window.db
        .from('leads').update(payload).eq('id', leadId).select().single();
      if (error) throw error;
      return data;
    },

    // ===== HELPERS DE DISPLAY =====
    formatMoney(amount, currency = 'USD') {
      if (amount === null || amount === undefined || amount === '') return '-';
      const n = Number(amount);
      if (!Number.isFinite(n)) return '-';
      const fmt = new Intl.NumberFormat('en-US', {
        style: 'currency', currency, maximumFractionDigits: 0,
      });
      return fmt.format(n);
    },

    formatFecha(iso) {
      if (!iso) return '-';
      try {
        return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
      } catch (_) { return '-'; }
    },

    arquetipoColor(slug) {
      return {
        explorador: '#86868B',
        constructor: '#D4AF37',
        escalador: '#248A3D',
        consolidador: '#1D1D1F',
        no_clasificado: '#C6C6C8',
      }[slug] || '#86868B';
    },
  };
})();
