// ============================================================================
// seguimiento.js · timeline unificado + KPIs + acciones rápidas por cliente
// Fase A: usa solo data existente (10 fuentes), sin schema changes.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[seguimiento.js] Falta supabase-client.js');

  const ICON = {
    login: '↪', reflexion: '✎', ia: '◆', pago_ok: '$', pago_pendiente: '⏳', pago_atrasado: '!',
    estado: '⇄', sesion: '☏', nota: '✦', webhook: '⚡', etiqueta: '#', testimonio: '◈',
    notif: '✉', personaje: '◉', upsell: '↑', firma: '✓',
  };

  // Categorías para chips de filtro. Tabla → key (orden importa para mostrar chips).
  const CATEGORIAS = [
    { key: 'todos',      label: 'Todos' },
    { key: 'reflexion',  label: 'Reflexiones' },
    { key: 'ia',         label: 'Respuestas IA' },
    { key: 'pago',       label: 'Pagos' },
    { key: 'estado',     label: 'Estados' },
    { key: 'sesion',     label: 'Sesiones' },
    { key: 'nota',       label: 'Notas' },
    { key: 'notif',      label: 'Notif.' },
    { key: 'login',      label: 'Login' },
    { key: 'webhook',    label: 'Webhooks' },
    { key: 'etiqueta',   label: 'Etiquetas' },
    { key: 'testimonio', label: 'Testimonios' },
  ];

  let leadActual = null;
  let eventosCache = [];
  let filtroActivo = 'todos';
  let realtimeChannel = null;

  // ============================================================
  // INIT
  // ============================================================
  window.seguimientoInit = async function () {
    try { cablearUI(); } catch (e) { console.error('[seguimiento] cablearUI falló:', e); }
    await poblarSelectorClientes();

    // Si la URL trae ?lead_id=... auto-seleccionar
    try {
      const urlLead = new URLSearchParams(location.search).get('lead_id');
      if (urlLead) {
        const sel = document.getElementById('seg-select');
        if (sel) {
          sel.value = urlLead;
          if (sel.value) await seleccionarCliente(urlLead);
        }
      }
    } catch (e) { console.error('[seguimiento] auto-seleccionar falló:', e); }
  };

  // ============================================================
  // UI WIRING — cada listener envuelto para que un fallo no mate el resto
  // ============================================================
  function on(id, evt, handler) {
    const el = document.getElementById(id);
    if (!el) { console.warn(`[seguimiento] elemento #${id} no existe`); return; }
    el.addEventListener(evt, handler);
  }

  function cablearUI() {
    on('seg-select', 'change', (e) => {
      const id = e.target.value;
      const url = new URL(location.href);
      if (id) url.searchParams.set('lead_id', id);
      else url.searchParams.delete('lead_id');
      history.replaceState({}, '', url);
      if (id) seleccionarCliente(id);
      else mostrarVacio();
    });

    on('seg-nueva-nota-text', 'keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') guardarNuevaNota();
    });
    on('seg-nueva-nota-btn', 'click', guardarNuevaNota);

    on('seg-modal-cerrar', 'click', cerrarModal);
    on('seg-modal-backdrop', 'click', (e) => {
      if (e.target.id === 'seg-modal-backdrop') cerrarModal();
    });

    on('seg-act-reasignar', 'click', () => abrirModalReasignar());
    on('seg-act-etiqueta', 'click', () => abrirModalEtiqueta());
    on('seg-act-recordatorio', 'click', () => abrirModalRecordatorio());
  }

  function mostrarVacio() {
    document.getElementById('seg-vacio').style.display = '';
    document.getElementById('seg-contenido').style.display = 'none';
    leadActual = null;
  }

  // ============================================================
  // SELECTOR DE CLIENTES
  // ============================================================
  async function poblarSelectorClientes() {
    const sel = document.getElementById('seg-select');
    if (!sel) {
      console.error('[seguimiento] dropdown seg-select no encontrado en DOM');
      return;
    }
    try {
      // Pequeña espera para que la sesión Supabase esté hidratada
      const { data: { session } } = await window.db.auth.getSession();
      if (!session) {
        sel.innerHTML = '<option value="">Sin sesión — recarga la página</option>';
        console.error('[seguimiento] No hay sesión Supabase activa');
        return;
      }

      // Trae todos los leads visibles (RLS filtra según rol del usuario)
      const { data, error } = await window.db
        .from('leads')
        .select('id, nombre, email, estado')
        .neq('estado', 'perdido')
        .order('nombre');

      if (error) {
        sel.innerHTML = `<option value="">Error: ${escapeHtml(error.message || 'desconocido')}</option>`;
        console.error('[seguimiento] error cargando leads:', error);
        return;
      }
      if (!data || data.length === 0) {
        sel.innerHTML = '<option value="">Sin clientes accesibles (revisa permisos)</option>';
        console.warn('[seguimiento] data leads vacía');
        return;
      }

      sel.innerHTML = '<option value="">— Selecciona un cliente —</option>' +
        data.map(l => `<option value="${l.id}">${escapeHtml(l.nombre || l.email)} · ${escapeHtml(l.estado)}</option>`).join('');
    } catch (e) {
      sel.innerHTML = `<option value="">Excepción: ${escapeHtml(e.message || String(e))}</option>`;
      console.error('[seguimiento] excepción en poblarSelectorClientes:', e);
    }
  }

  // ============================================================
  // SELECCIONAR CLIENTE → carga todo
  // ============================================================
  async function seleccionarCliente(leadId) {
    document.getElementById('seg-vacio').style.display = 'none';
    document.getElementById('seg-contenido').style.display = '';

    // Loader en cada sección
    document.getElementById('seg-timeline').innerHTML = '<div class="seg-loader">Cargando timeline…</div>';
    document.getElementById('seg-proximas').innerHTML = '<div class="seg-loader" style="padding: var(--space-4);">Cargando…</div>';
    document.getElementById('seg-notas').innerHTML = '<div class="seg-loader" style="padding: var(--space-2);">Cargando…</div>';
    document.getElementById('seg-kpis').innerHTML = '';

    // Carga datos base del lead (incluye email para auth.users)
    const { data: lead, error: leadErr } = await window.db
      .from('leads').select('*').eq('id', leadId).maybeSingle();
    if (leadErr || !lead) { alert('No se pudo cargar el cliente'); mostrarVacio(); return; }
    leadActual = lead;

    document.getElementById('seg-act-ver-perfil').href = `/admin/cliente.html?lead=${leadId}`;

    // Cargar todo en paralelo
    await Promise.all([
      cargarTimeline(leadId, lead.email),
      cargarKPIs(leadId, lead),
      cargarProximas(leadId, lead),
      cargarNotas(leadId),
      cargarEtiquetas(leadId),
      cargarAlertas(leadId),
    ]);

    await activarRealtime(leadId);
  }

  // ============================================================
  // ALERTAS ACTIVAS
  // ============================================================
  async function cargarAlertas(leadId) {
    const { data, error } = await window.db
      .from('cliente_alertas')
      .select('id, regla_slug, severidad, mensaje, contexto, creada_at, estado')
      .eq('lead_id', leadId).eq('estado', 'abierta')
      .order('creada_at', { ascending: false });
    if (error) { console.error(error); return; }

    document.getElementById('seg-alertas-count').textContent = data?.length || 0;
    pintarAlertas(data || []);

    // KPI count en card titulo
    const card = document.getElementById('seg-card-alertas');
    if (card) {
      const max = Math.max(0, ...(data || []).map(a => ({ info: 1, warn: 2, alerta: 3, critica: 4 }[a.severidad] || 0)));
      const colores = { 0: 'transparent', 1: '#3B82F6', 2: '#F59E0B', 3: '#DC2626', 4: '#7F1D1D' };
      card.style.borderLeft = `3px solid ${colores[max]}`;
    }
  }

  function pintarAlertas(alertas) {
    const cont = document.getElementById('seg-alertas');
    if (!alertas.length) {
      cont.innerHTML = '<div style="text-align: center; padding: var(--space-3); color: var(--success); font-size: 12px;">✓ Sin alertas activas.</div>';
      return;
    }
    cont.innerHTML = alertas.map(a => {
      const dias = a.contexto?.dias_sin_login ? Math.floor(a.contexto.dias_sin_login) + 'd' : '';
      return `<div class="seg-alerta sev-${a.severidad}" data-alerta-id="${a.id}">
        <div class="seg-alerta-titulo">${escapeHtml(a.mensaje)}</div>
        <div class="seg-alerta-meta">${a.regla_slug} · hace ${tiempoRelativo(a.creada_at)}${dias ? ' · ' + dias : ''}</div>
        <div class="seg-alerta-acciones">
          <button class="seg-alerta-btn" data-act="resolver">✓ Resolver</button>
          <button class="seg-alerta-btn" data-act="silenciar">🔕 Silenciar 24h</button>
        </div>
      </div>`;
    }).join('');

    cont.querySelectorAll('.seg-alerta-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('[data-alerta-id]').dataset.alertaId;
        const act = btn.dataset.act;
        if (act === 'resolver') {
          await window.db.from('cliente_alertas')
            .update({ estado: 'resuelta', resuelta_at: new Date().toISOString() })
            .eq('id', id);
        } else if (act === 'silenciar') {
          await window.db.from('cliente_alertas')
            .update({ estado: 'silenciada', snooze_hasta: new Date(Date.now() + 24*3600*1000).toISOString() })
            .eq('id', id);
        }
        await cargarAlertas(leadActual.id);
      });
    });
  }

  // ============================================================
  // REALTIME — escucha cambios en vivo para el lead seleccionado
  // ============================================================
  async function activarRealtime(leadId) {
    // Esperar a que el canal anterior cierre completo (removeChannel es async).
    // Sin esto, eventos del cliente anterior siguen llegando 200ms y se procesan
    // contra leadActual que ya es otro → toasts y queries con id mezclado.
    if (realtimeChannel) {
      try { await window.db.removeChannel(realtimeChannel); } catch (_) {}
      realtimeChannel = null;
    }

    // Captura el leadId al momento del wiring. Si el admin cambia rápido,
    // los handlers comparan contra el lead actual antes de actuar.
    const leadIdAtBind = leadId;

    // Guarda: si el lead cambió mientras estaba el canal abierto, ignorar evento.
    const esLeadVigente = () => leadActual?.id === leadIdAtBind;

    realtimeChannel = window.db
      .channel('seguimiento-' + leadId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sesiones_app', filter: `lead_id=eq.${leadId}` },
        (payload) => {
          if (!esLeadVigente()) return;
          mostrarToast(`📥 ${leadActual?.nombre || 'Cliente'} entró a la plataforma`, 'accent');
          cargarTimeline(leadId, leadActual?.email);
          cargarKPIs(leadId, leadActual);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'interacciones', filter: `lead_id=eq.${leadId}` },
        (payload) => {
          if (!esLeadVigente()) return;
          const accion = payload.new?.accion || payload.new?.tipo;
          if (accion && accion !== 'navegacion') {
            mostrarToast(`◆ Nueva acción: ${accion}`);
          }
          cargarTimeline(leadId, leadActual?.email);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'journaling_respuestas', filter: `lead_id=eq.${leadId}` },
        (payload) => {
          if (!esLeadVigente()) return;
          mostrarToast(`✎ Nueva reflexión escrita`, 'accent');
          cargarTimeline(leadId, leadActual?.email);
          cargarKPIs(leadId, leadActual);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cliente_alertas', filter: `lead_id=eq.${leadId}` },
        (payload) => {
          if (!esLeadVigente()) return;
          mostrarToast(`⚠ Nueva alerta: ${payload.new?.mensaje || ''}`, 'accent');
          cargarAlertas(leadId);
        })
      .subscribe((status) => {
        const dot = document.getElementById('seg-realtime-dot');
        if (!dot) return;
        if (status === 'SUBSCRIBED') {
          dot.classList.remove('dot-off');
          dot.title = 'Realtime activo';
        } else {
          dot.classList.add('dot-off');
          dot.title = 'Realtime: ' + status;
        }
      });
  }

  function mostrarToast(msg, variant) {
    const t = document.getElementById('seg-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'seg-toast visible' + (variant ? ' ' + variant : '');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'seg-toast'; }, 5000);
  }

  function tiempoRelativo(ts) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'segundos';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  }

  // ============================================================
  // KPIS
  // ============================================================
  async function cargarKPIs(leadId, lead) {
    // Queries auxiliares en paralelo
    const [
      loginRpc,
      { data: reflexCount },
      { count: notifProx },
      { count: pagosAtras },
    ] = await Promise.all([
      window.db.rpc('get_login_info_admin', { p_email: lead.email }).then(r => r).catch(() => ({ data: null })),
      window.db.from('journaling_respuestas').select('id, created_at, longitud_palabras').eq('lead_id', leadId).order('created_at', { ascending: false }),
      window.db.from('notificaciones_pendientes').select('*', { count: 'exact', head: true }).eq('lead_id', leadId).eq('estado', 'pendiente'),
      window.db.from('pagos').select('*', { count: 'exact', head: true }).eq('lead_id', leadId).eq('estado', 'atrasado'),
    ]);
    const ultLogin = Array.isArray(loginRpc?.data) ? loginRpc.data[0] : null;

    const reflexiones = reflexCount || [];
    const totalRef = reflexiones.length;
    const totalPal = reflexiones.reduce((s, r) => s + (r.longitud_palabras || 0), 0);

    // Compromiso: reflexiones únicas en últimos 30 días / 30
    const hace30 = Date.now() - 30 * 24 * 3600 * 1000;
    const refRecientes = reflexiones.filter(r => new Date(r.created_at).getTime() > hace30);
    const diasUnicos = new Set(refRecientes.map(r => new Date(r.created_at).toDateString())).size;
    const compromiso = Math.round((diasUnicos / 30) * 100);

    // Último login: viene de auth.users vía vista segura. Fallback a "—"
    const ultLoginTs = ultLogin?.last_sign_in_at;
    const diasDesdeLogin = ultLoginTs ? Math.floor((Date.now() - new Date(ultLoginTs).getTime()) / (24 * 3600 * 1000)) : null;
    const loginLabel = diasDesdeLogin === null ? 'Nunca' : (diasDesdeLogin === 0 ? 'Hoy' : `Hace ${diasDesdeLogin}d`);
    const loginClass = diasDesdeLogin === null ? 'alerta' : (diasDesdeLogin > 7 ? 'alerta' : diasDesdeLogin > 3 ? 'warn' : 'ok');

    // Días en programa
    const diasEnPrograma = lead.fecha_activacion_programa
      ? Math.floor((Date.now() - new Date(lead.fecha_activacion_programa).getTime()) / (24 * 3600 * 1000))
      : null;

    const kpis = [
      { label: 'Último login',     num: loginLabel, sub: ultLoginTs ? fechaCorta(ultLoginTs) : '—', clase: loginClass },
      { label: 'Reflexiones',      num: totalRef,    sub: totalPal ? `${totalPal} pal.` : '—' },
      { label: 'Compromiso 30d',   num: `${compromiso}%`, sub: `${diasUnicos}/30 días`, clase: compromiso < 30 ? 'alerta' : compromiso < 60 ? 'warn' : 'ok' },
      { label: 'Día programa',     num: diasEnPrograma !== null ? diasEnPrograma : '—', sub: `de ${lead.duracion_contractual_dias || 70}` },
      { label: 'Notif. pendientes', num: notifProx || 0,  sub: 'próximos envíos', clase: (notifProx || 0) > 0 ? 'warn' : '' },
      { label: 'Pagos atrasados',  num: pagosAtras || 0, sub: 'cuotas vencidas', clase: (pagosAtras || 0) > 0 ? 'alerta' : 'ok' },
    ];

    document.getElementById('seg-kpis').innerHTML = kpis.map(k =>
      `<div class="seg-kpi ${k.clase || ''}">
        <div class="seg-kpi-label">${k.label}</div>
        <div class="seg-kpi-num">${k.num}</div>
        <div class="seg-kpi-sub">${k.sub}</div>
      </div>`
    ).join('');
  }

  // ============================================================
  // TIMELINE — fetch desde 10 fuentes y merge cronológico
  // ============================================================
  async function cargarTimeline(leadId, email) {
    const eventos = [];

    const [
      reflex, ia, pagos, estadoHist, sesiones, notasTL,
      webhooks, etiqs, testim, notifEnv, interacc
    ] = await Promise.all([
      window.db.from('journaling_respuestas')
        .select('id, created_at, pregunta_original, respuesta_cliente, longitud_palabras, es_calentamiento, tema_orden, respuesta_personaje, respuesta_personaje_at, cierre_ia, cierre_ia_at')
        .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50),
      window.db.from('ia_analisis')
        .select('id, created_at, contenido_analisis, pregunta_poderosa, modelo_usado, costo_usd')
        .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50),
      window.db.from('pagos')
        .select('id, numero_cuota, monto_usd, estado, fecha_programada, fecha_pagado_at, metodo_pago, tipo, updated_at, created_at')
        .eq('lead_id', leadId).order('updated_at', { ascending: false }).limit(50),
      window.db.from('lead_estado_historial')
        .select('id, estado_desde, estado_hacia, sub_estado_hacia, motivo, notas, cambiado_at, origen, cambiado_por_admin:cambiado_por (nombre)')
        .eq('lead_id', leadId).order('cambiado_at', { ascending: false }).limit(50),
      window.db.from('sesiones_1a1')
        .select('id, fecha, numero_sesion, modalidad, foco_accion, estado_qa, mentor:mentor_id (nombre)')
        .eq('lead_id', leadId).order('fecha', { ascending: false }).limit(30),
      window.db.from('cliente_notas')
        .select('id, contenido, tipo, created_at, autor:autor_id (nombre)')
        .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(30),
      window.db.from('webhook_log')
        .select('id, recibido_at, fuente, resultado, error')
        .eq('lead_id', leadId).order('recibido_at', { ascending: false }).limit(30),
      window.db.from('lead_etiquetas')
        .select('id, aplicada_at, etiqueta:etiqueta_id (nombre, color, icono), aplicada_por_admin:aplicada_por (nombre)')
        .eq('lead_id', leadId).order('aplicada_at', { ascending: false }).limit(30),
      window.db.from('testimonios')
        .select('id, momento, estado, recibido_at, aprobado_at, calificacion, created_at')
        .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(20),
      window.db.from('notificaciones_pendientes')
        .select('id, tipo, canal, estado, programada_para, enviada_at, contenido, regla_slug')
        .eq('lead_id', leadId).in('estado', ['enviada','fallida']).order('enviada_at', { ascending: false, nullsFirst: false }).limit(30),
      window.db.from('interacciones')
        .select('id, tipo, canal, direccion, contenido, metadata, ocurrio_at')
        .eq('lead_id', leadId).order('ocurrio_at', { ascending: false }).limit(50),
    ]);

    // Mapear cada fuente → evento normalizado
    (reflex.data || []).forEach(r => {
      const palabras = r.longitud_palabras || 0;
      const tipoLabel = r.es_calentamiento ? 'Reflexión de calentamiento' : `Reflexión tema ${r.tema_orden ?? '-'}`;
      eventos.push({
        when: r.created_at, cat: 'reflexion', icon: ICON.reflexion,
        titulo: tipoLabel,
        meta: `${palabras} palabras · pregunta: "${truncar(r.pregunta_original, 80)}"`,
        cuerpo: r.respuesta_cliente,
      });
      if (r.respuesta_personaje_at) {
        eventos.push({
          when: r.respuesta_personaje_at, cat: 'personaje', icon: ICON.personaje,
          titulo: 'Respuesta del personaje',
          meta: `Tema ${r.tema_orden ?? '-'}`,
          cuerpo: r.respuesta_personaje,
        });
      }
      if (r.cierre_ia_at) {
        eventos.push({
          when: r.cierre_ia_at, cat: 'ia', icon: ICON.ia,
          titulo: 'Cierre del día (IA)',
          meta: `Consejo + anclaje generado`,
          cuerpo: r.cierre_ia,
        });
      }
    });

    (ia.data || []).forEach(a => eventos.push({
      when: a.created_at, cat: 'ia', icon: ICON.ia,
      titulo: 'Análisis IA',
      meta: `${a.modelo_usado || 'claude'} · $${(a.costo_usd || 0).toFixed(4)}`,
      cuerpo: a.pregunta_poderosa ? `Pregunta: ${a.pregunta_poderosa}\n\n${truncar(a.contenido_analisis, 600)}` : truncar(a.contenido_analisis, 600),
    }));

    (pagos.data || []).forEach(p => {
      const esPagado = p.estado === 'pagado' && p.fecha_pagado_at;
      const when = esPagado ? p.fecha_pagado_at : (p.updated_at || p.created_at);
      const ico = esPagado ? ICON.pago_ok : (p.estado === 'atrasado' ? ICON.pago_atrasado : ICON.pago_pendiente);
      const titulo = esPagado
        ? `Pago recibido: $${p.monto_usd} (cuota ${p.numero_cuota || '-'})`
        : `Cuota ${p.numero_cuota || '-'}: $${p.monto_usd} · ${p.estado}`;
      eventos.push({
        when, cat: 'pago', icon: ico,
        titulo,
        meta: `${p.tipo || 'cuota'} · ${p.metodo_pago || 'sin método'} · prog: ${p.fecha_programada || '—'}`,
      });
    });

    (estadoHist.data || []).forEach(e => eventos.push({
      when: e.cambiado_at, cat: 'estado', icon: ICON.estado,
      titulo: `Estado: ${e.estado_desde || 'inicial'} → ${e.estado_hacia}${e.sub_estado_hacia ? ` (${e.sub_estado_hacia})` : ''}`,
      meta: `${e.origen || 'manual'}${e.cambiado_por_admin?.nombre ? ' · por ' + e.cambiado_por_admin.nombre : ''}${e.motivo ? ' · ' + e.motivo : ''}`,
      cuerpo: e.notas,
    }));

    (sesiones.data || []).forEach(s => eventos.push({
      when: s.fecha, cat: 'sesion', icon: ICON.sesion,
      titulo: `Sesión 1:1 #${s.numero_sesion || '-'} (${s.modalidad || 'sin modalidad'})`,
      meta: `Mentor: ${s.mentor?.nombre || '—'} · QC: ${s.estado_qa || 'pendiente'}`,
      cuerpo: s.foco_accion,
    }));

    (notasTL.data || []).forEach(n => eventos.push({
      when: n.created_at, cat: 'nota', icon: ICON.nota,
      titulo: `Nota del equipo (${n.tipo || 'general'})`,
      meta: `Por ${n.autor?.nombre || '—'}`,
      cuerpo: n.contenido,
    }));

    (webhooks.data || []).forEach(w => eventos.push({
      when: w.recibido_at, cat: 'webhook', icon: ICON.webhook,
      titulo: `Webhook ${w.fuente || ''} · ${w.resultado || '—'}`,
      meta: w.error ? `Error: ${truncar(w.error, 100)}` : 'OK',
    }));

    (etiqs.data || []).forEach(e => eventos.push({
      when: e.aplicada_at, cat: 'etiqueta', icon: e.etiqueta?.icono || ICON.etiqueta,
      titulo: `Etiqueta: ${e.etiqueta?.nombre || '—'}`,
      meta: e.aplicada_por_admin?.nombre ? `Aplicada por ${e.aplicada_por_admin.nombre}` : 'Aplicada',
    }));

    (testim.data || []).forEach(t => {
      if (t.recibido_at) eventos.push({
        when: t.recibido_at, cat: 'testimonio', icon: ICON.testimonio,
        titulo: `Testimonio recibido (${t.momento || 'espontáneo'})`,
        meta: `Calificación: ${t.calificacion || '—'}/10 · Estado: ${t.estado}`,
      });
      if (t.aprobado_at) eventos.push({
        when: t.aprobado_at, cat: 'testimonio', icon: '✓',
        titulo: `Testimonio aprobado`,
        meta: `${t.momento || 'espontáneo'}`,
      });
    });

    (notifEnv.data || []).forEach(n => eventos.push({
      when: n.enviada_at || n.programada_para, cat: 'notif', icon: ICON.notif,
      titulo: `${n.estado === 'enviada' ? '📤' : '⚠'} ${n.tipo} (${n.canal || '—'})`,
      meta: `Regla: ${n.regla_slug || 'manual'}`,
      cuerpo: truncar(n.contenido, 200),
    }));

    (interacc.data || []).forEach(i => {
      // Evita duplicar eventos que ya cubrimos arriba (pagos, etc)
      if (i.tipo === 'pago') return;
      eventos.push({
        when: i.ocurrio_at, cat: 'login', icon: ICON.login,
        titulo: `Interacción: ${i.tipo}`,
        meta: `${i.canal || '—'} · ${i.direccion || '—'}`,
        cuerpo: i.contenido || null,
      });
    });

    // Orden cronológico DESC + dedup blando
    eventos.sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime());
    eventosCache = eventos;

    pintarFiltros();
    pintarTimeline();
  }

  function pintarFiltros() {
    const counts = {};
    eventosCache.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
    counts.todos = eventosCache.length;

    const html = CATEGORIAS
      .filter(c => c.key === 'todos' || (counts[c.key] || 0) > 0)
      .map(c => `<button class="seg-chip ${filtroActivo === c.key ? 'active' : ''}" data-cat="${c.key}">${c.label}<span class="seg-chip-count">${counts[c.key] || 0}</span></button>`)
      .join('');
    const cont = document.getElementById('seg-filtros');
    cont.innerHTML = html;
    cont.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        filtroActivo = btn.dataset.cat;
        pintarFiltros();
        pintarTimeline();
      });
    });
  }

  function pintarTimeline() {
    const filtrados = filtroActivo === 'todos'
      ? eventosCache
      : eventosCache.filter(e => e.cat === filtroActivo);

    if (filtrados.length === 0) {
      document.getElementById('seg-timeline').innerHTML = '<div class="seg-loader" style="padding: var(--space-12); animation: none;">Sin eventos para este filtro.</div>';
      return;
    }

    const html = filtrados.slice(0, 200).map((e, idx) => {
      const cuerpo = e.cuerpo ? `<div class="seg-event-cuerpo" data-idx="${idx}">${escapeHtml(e.cuerpo)}</div>` : '';
      return `<div class="seg-event seg-event-cat-${e.cat}">
        <div class="seg-event-icon">${e.icon || '·'}</div>
        <div>
          <div class="seg-event-titulo">${escapeHtml(e.titulo)}</div>
          <div class="seg-event-meta">${escapeHtml(e.meta || '')}</div>
          ${cuerpo}
        </div>
        <div class="seg-event-time">
          <strong>${fechaCorta(e.when)}</strong><br>${horaCorta(e.when)}
        </div>
      </div>`;
    }).join('');

    const tl = document.getElementById('seg-timeline');
    tl.innerHTML = html;
    // Expand cuerpo on click
    tl.querySelectorAll('.seg-event-cuerpo').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('expandido'));
    });
  }

  // ============================================================
  // PRÓXIMAS ACCIONES (notif + pagos + sesiones futuras)
  // ============================================================
  async function cargarProximas(leadId, lead) {
    const ahora = new Date();
    const ahoraISO = ahora.toISOString();
    const en30 = new Date(ahora.getTime() + 30 * 24 * 3600 * 1000).toISOString();

    const [notif, pagos, sesionesProx] = await Promise.all([
      window.db.from('notificaciones_pendientes')
        .select('id, tipo, canal, programada_para, contenido, regla_slug')
        .eq('lead_id', leadId).eq('estado', 'pendiente')
        .order('programada_para').limit(20),
      window.db.from('pagos')
        .select('id, numero_cuota, monto_usd, fecha_programada, estado, tipo')
        .eq('lead_id', leadId).in('estado', ['pendiente','atrasado'])
        .order('fecha_programada').limit(10),
      window.db.from('sesiones_1a1')
        .select('id, fecha, numero_sesion, modalidad, proxima_sesion_at')
        .eq('lead_id', leadId).gte('fecha', ahoraISO)
        .order('fecha').limit(5),
    ]);

    const items = [];

    (notif.data || []).forEach(n => items.push({
      when: n.programada_para,
      tipo: 'notif',
      titulo: `${n.tipo} (${n.canal || '—'})`,
      meta: n.regla_slug ? `Regla ${n.regla_slug}` : 'Programada',
    }));

    (pagos.data || []).forEach(p => {
      const atrasado = p.estado === 'atrasado';
      items.push({
        when: p.fecha_programada,
        tipo: atrasado ? 'atrasado' : 'pago',
        titulo: `Cuota ${p.numero_cuota || '-'}: $${p.monto_usd}${atrasado ? ' (ATRASADO)' : ''}`,
        meta: `Prog. ${p.fecha_programada} · ${p.tipo || 'cuota'}`,
      });
    });

    (sesionesProx.data || []).forEach(s => items.push({
      when: s.fecha,
      tipo: 'sesion',
      titulo: `Sesión 1:1 #${s.numero_sesion || '-'}`,
      meta: `${s.modalidad || '—'} · ${fechaCorta(s.fecha)} ${horaCorta(s.fecha)}`,
    }));

    items.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());

    document.getElementById('seg-proximas-count').textContent = items.length;

    if (items.length === 0) {
      document.getElementById('seg-proximas').innerHTML = '<div style="text-align: center; padding: var(--space-4); color: var(--text-muted); font-size: 12px;">Sin acciones pendientes próximas.</div>';
      return;
    }

    document.getElementById('seg-proximas').innerHTML = items.slice(0, 15).map(i =>
      `<div class="seg-proxima ${i.tipo}">
        <div class="seg-proxima-titulo">${escapeHtml(i.titulo)}</div>
        <div class="seg-proxima-meta">${escapeHtml(i.meta)}</div>
      </div>`
    ).join('');
  }

  // ============================================================
  // NOTAS (CRUD inline)
  // ============================================================
  async function cargarNotas(leadId) {
    if (!window.notasApi?.listar) {
      document.getElementById('seg-notas').innerHTML = '<div style="font-size: 11px; color: var(--text-muted);">notasApi no disponible</div>';
      return;
    }
    try {
      const notas = await window.notasApi.listar(leadId);
      document.getElementById('seg-notas-count').textContent = notas.length;
      pintarNotas(notas);
    } catch (e) {
      console.error('[seguimiento] notas', e);
      document.getElementById('seg-notas').innerHTML = `<div style="font-size: 11px; color: var(--error);">Error cargando notas</div>`;
    }
  }

  function pintarNotas(notas) {
    if (!notas?.length) {
      document.getElementById('seg-notas').innerHTML = '<div style="text-align: center; padding: var(--space-3); color: var(--text-muted); font-size: 12px;">Sin notas todavía.</div>';
      return;
    }
    document.getElementById('seg-notas').innerHTML = notas.map(n =>
      `<div class="seg-nota ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">
        <div class="seg-nota-cuerpo">${escapeHtml(n.contenido)}</div>
        <div class="seg-nota-meta">
          <span>${escapeHtml(n.autor?.nombre || '—')} · ${fechaCorta(n.created_at)} · ${n.tipo}</span>
          <div class="seg-nota-acciones">
            <button class="seg-nota-btn" data-act="pin">${n.pinned ? '★' : '☆'}</button>
            <button class="seg-nota-btn" data-act="del">✕</button>
          </div>
        </div>
      </div>`
    ).join('');
    // Wire pin/delete
    document.querySelectorAll('.seg-nota .seg-nota-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const cont = e.target.closest('.seg-nota');
        const id = cont.dataset.id;
        const act = btn.dataset.act;
        if (act === 'pin') {
          await togglePinNota(id, !cont.classList.contains('pinned'));
        } else if (act === 'del') {
          const ok = await (window.utils?.confirmAsync ? window.utils.confirmAsync('¿Borrar esta nota?', { okText: 'Borrar', danger: true }) : Promise.resolve(confirm('¿Borrar esta nota?')));
          if (!ok) return;
          await eliminarNota(id);
        }
        await cargarNotas(leadActual.id);
      });
    });
  }

  async function guardarNuevaNota() {
    if (!leadActual) return;
    const text = document.getElementById('seg-nueva-nota-text').value.trim();
    if (!text) return;
    const tipo = document.getElementById('seg-nueva-nota-tipo').value;
    const pinned = document.getElementById('seg-nueva-nota-pin').checked;
    try {
      await window.notasApi.crear({ lead_id: leadActual.id, contenido: text, tipo, pinned });
      document.getElementById('seg-nueva-nota-text').value = '';
      document.getElementById('seg-nueva-nota-pin').checked = false;
      await cargarNotas(leadActual.id);
      await cargarTimeline(leadActual.id, leadActual.email); // refresh timeline
    } catch (e) {
      alert('No se pudo guardar la nota: ' + (e.message || e));
    }
  }

  async function togglePinNota(id, pinned) {
    const { error } = await window.db.from('cliente_notas').update({ pinned }).eq('id', id);
    if (error) {
      console.error('[seguimiento] togglePinNota:', error);
      alert('No se pudo actualizar: ' + (error.message || 'error desconocido'));
      throw error;
    }
  }
  async function eliminarNota(id) {
    const { error } = await window.db.from('cliente_notas').delete().eq('id', id);
    if (error) {
      console.error('[seguimiento] eliminarNota:', error);
      alert('No se pudo borrar: ' + (error.message || 'error desconocido'));
      throw error;
    }
  }

  // ============================================================
  // ETIQUETAS (chips inline + agregar)
  // ============================================================
  async function cargarEtiquetas(leadId) {
    const { data } = await window.db
      .from('lead_etiquetas')
      .select('id, etiqueta:etiqueta_id (id, nombre, color, icono)')
      .eq('lead_id', leadId);
    const cont = document.getElementById('seg-etiqs');
    if (!data?.length) { cont.innerHTML = '<span style="font-size: 11px; color: var(--text-muted);">Sin etiquetas</span>'; return; }
    cont.innerHTML = data.map(le => {
      const c = le.etiqueta?.color || '#86868B';
      return `<span class="seg-etiq" style="background: ${c}22; color: ${c}; border: 1px solid ${c}44;" data-le-id="${le.id}">
        ${le.etiqueta?.icono || ''} ${escapeHtml(le.etiqueta?.nombre || '')}
        <span class="seg-etiq-x" data-quitar>×</span>
      </span>`;
    }).join('');
    cont.querySelectorAll('[data-quitar]').forEach(x => {
      x.addEventListener('click', async (e) => {
        const id = e.target.closest('[data-le-id]').dataset.leId;
        const ok = await (window.utils?.confirmAsync ? window.utils.confirmAsync('¿Quitar etiqueta?', { okText: 'Quitar', danger: true }) : Promise.resolve(confirm('¿Quitar etiqueta?')));
        if (!ok) return;
        await window.db.from('lead_etiquetas').delete().eq('id', id);
        await cargarEtiquetas(leadId);
        await cargarTimeline(leadId, leadActual.email);
      });
    });
  }

  // ============================================================
  // MODAL HELPERS
  // ============================================================
  function abrirModal(titulo, bodyHtml, footHtml) {
    document.getElementById('seg-modal-titulo').textContent = titulo;
    document.getElementById('seg-modal-body').innerHTML = bodyHtml;
    document.getElementById('seg-modal-foot').innerHTML = footHtml;
    document.getElementById('seg-modal-backdrop').classList.add('visible');
  }
  function cerrarModal() {
    document.getElementById('seg-modal-backdrop').classList.remove('visible');
  }

  // === REASIGNAR MENTOR ===
  async function abrirModalReasignar() {
    if (!leadActual) return;
    const [asignActuales, equipo, rolesData] = await Promise.all([
      window.db.from('lead_asignaciones')
        .select('id, rol_funcional_id, usuario_admin_id, asignado_at, admin:usuario_admin_id (nombre), rol:rol_funcional_id (nombre, slug)')
        .eq('lead_id', leadActual.id),
      window.db.from('usuarios_admin').select('id, nombre, email, rol').eq('activo', true).order('nombre'),
      window.db.from('roles_funcionales').select('id, nombre, slug').order('nombre'),
    ]);

    const actuales = (asignActuales.data || []).map(a =>
      `<div style="padding: 6px 10px; background: var(--surface-2); border-radius: var(--radius-sm); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
        <span><strong>${escapeHtml(a.rol?.nombre || '—')}</strong>: ${escapeHtml(a.admin?.nombre || '—')}</span>
        <button class="btn btn-ghost btn-sm" data-quitar-asig="${a.id}" style="padding: 2px 8px; font-size: 11px;">Quitar</button>
      </div>`
    ).join('') || '<div style="font-size: 12px; color: var(--text-muted); padding: 6px;">Sin asignaciones.</div>';

    const body = `
      <div style="margin-bottom: var(--space-4);">
        <div style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Asignaciones actuales</div>
        ${actuales}
      </div>
      <div>
        <div style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Nueva asignación</div>
        <select id="seg-asig-rol" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px; margin-bottom: 6px;">
          <option value="">— Rol funcional —</option>
          ${(rolesData.data || []).map(r => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join('')}
        </select>
        <select id="seg-asig-user" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px;">
          <option value="">— Persona del equipo —</option>
          ${(equipo.data || []).map(u => `<option value="${u.id}">${escapeHtml(u.nombre)} (${u.rol})</option>`).join('')}
        </select>
      </div>`;
    const foot = `<button class="btn btn-ghost" id="seg-asig-cancel">Cancelar</button><button class="btn btn-accent" id="seg-asig-guardar">Asignar</button>`;

    abrirModal(`Asignaciones de ${leadActual.nombre}`, body, foot);

    document.getElementById('seg-asig-cancel').addEventListener('click', cerrarModal);
    document.getElementById('seg-asig-guardar').addEventListener('click', async () => {
      const rolId = document.getElementById('seg-asig-rol').value;
      const userId = document.getElementById('seg-asig-user').value;
      if (!rolId || !userId) { alert('Selecciona rol y persona.'); return; }
      const { error } = await window.db.from('lead_asignaciones').insert({
        lead_id: leadActual.id, rol_funcional_id: rolId, usuario_admin_id: userId,
      });
      if (error) { alert('Error: ' + error.message); return; }
      cerrarModal();
      await cargarTimeline(leadActual.id, leadActual.email);
    });
    document.querySelectorAll('[data-quitar-asig]').forEach(b => {
      b.addEventListener('click', async () => {
        const id = b.dataset.quitarAsig;
        await window.db.from('lead_asignaciones').delete().eq('id', id);
        cerrarModal();
        await abrirModalReasignar();
      });
    });
  }

  // === AGREGAR ETIQUETA ===
  async function abrirModalEtiqueta() {
    if (!leadActual) return;
    const { data: catalogo } = await window.db
      .from('etiquetas_catalogo').select('id, slug, nombre, color, icono').eq('activa', true).order('orden');

    const body = `
      <div style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px;">Etiqueta a agregar</div>
      <select id="seg-etiq-sel" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 13px;">
        <option value="">— Selecciona —</option>
        ${(catalogo || []).map(e => `<option value="${e.id}">${e.icono || ''} ${escapeHtml(e.nombre)}</option>`).join('')}
      </select>
      <p style="font-size: 11px; color: var(--text-muted); margin-top: var(--space-3);">Las etiquetas son visibles en el pipeline y en este timeline. Algunas tienen exclusividad: agregar una nueva reemplaza la anterior del mismo grupo.</p>`;
    const foot = `<button class="btn btn-ghost" id="seg-etiq-cancel">Cancelar</button><button class="btn btn-accent" id="seg-etiq-guardar">Agregar</button>`;
    abrirModal(`Agregar etiqueta a ${leadActual.nombre}`, body, foot);

    document.getElementById('seg-etiq-cancel').addEventListener('click', cerrarModal);
    document.getElementById('seg-etiq-guardar').addEventListener('click', async () => {
      const etiqId = document.getElementById('seg-etiq-sel').value;
      if (!etiqId) { alert('Selecciona una etiqueta.'); return; }
      const { error } = await window.db.from('lead_etiquetas').insert({ lead_id: leadActual.id, etiqueta_id: etiqId, origen: 'manual' });
      if (error) { alert('Error: ' + error.message); return; }
      cerrarModal();
      await cargarEtiquetas(leadActual.id);
      await cargarTimeline(leadActual.id, leadActual.email);
    });
  }

  // === CREAR RECORDATORIO (notificación manual pendiente) ===
  async function abrirModalRecordatorio() {
    if (!leadActual) return;
    const ahora = new Date();
    const enUnaHora = new Date(ahora.getTime() + 60 * 60 * 1000);
    const fechaDefault = enUnaHora.toISOString().slice(0, 16);

    // Fix: tipo y canal deben respetar CHECKs de notificaciones_pendientes.
    // tipo válido: notificacion_admin (la genérica para casos administrativos)
    // canal válido: email | whatsapp | sms | plataforma
    const body = `
      <div style="display: flex; flex-direction: column; gap: var(--space-3);">
        <div>
          <label style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted);">Tipo</label>
          <select id="seg-rec-tipo" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-top: 4px;">
            <option value="notificacion_admin">Recordatorio administrativo</option>
          </select>
        </div>
        <div>
          <label style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted);">Canal</label>
          <select id="seg-rec-canal" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-top: 4px;">
            <option value="plataforma">Panel admin (interno)</option>
            <option value="email">Email al cliente</option>
            <option value="whatsapp">WhatsApp al cliente</option>
            <option value="sms">SMS al cliente</option>
          </select>
        </div>
        <div>
          <label style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted);">Fecha y hora</label>
          <input type="datetime-local" id="seg-rec-fecha" value="${fechaDefault}" style="width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-top: 4px;">
        </div>
        <div>
          <label style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; color: var(--text-muted);">Contenido</label>
          <textarea id="seg-rec-contenido" style="width: 100%; min-height: 80px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); margin-top: 4px; font-family: inherit; font-size: 13px;" placeholder="Mensaje del recordatorio…"></textarea>
        </div>
      </div>`;
    const foot = `<button class="btn btn-ghost" id="seg-rec-cancel">Cancelar</button><button class="btn btn-accent" id="seg-rec-guardar">Programar</button>`;
    abrirModal(`Recordatorio para ${leadActual.nombre}`, body, foot);

    document.getElementById('seg-rec-cancel').addEventListener('click', cerrarModal);
    document.getElementById('seg-rec-guardar').addEventListener('click', async () => {
      const tipo = document.getElementById('seg-rec-tipo').value;
      const canal = document.getElementById('seg-rec-canal').value;
      const fecha = document.getElementById('seg-rec-fecha').value;
      const contenido = document.getElementById('seg-rec-contenido').value.trim();
      if (!contenido || !fecha) { alert('Completa fecha y contenido.'); return; }
      const { error } = await window.db.from('notificaciones_pendientes').insert({
        lead_id: leadActual.id, tipo, canal, contenido, programada_para: new Date(fecha).toISOString(),
        estado: 'pendiente', regla_slug: 'admin_manual',
      });
      if (error) { alert('Error: ' + error.message); return; }
      cerrarModal();
      await cargarProximas(leadActual.id, leadActual);
    });
  }

  // ============================================================
  // UTILS
  // ============================================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function truncar(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function fechaCorta(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }); }
    catch (_) { return '—'; }
  }
  function horaCorta(ts) {
    if (!ts) return '';
    try { return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }

})();
