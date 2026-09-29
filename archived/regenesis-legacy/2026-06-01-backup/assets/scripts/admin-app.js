// ============================================
// Re-Génesis — Admin App
// ============================================
// Lógica del panel administrativo:
//   - Login (solo entran usuarios en usuarios_admin)
//   - Dashboard con KPIs reales
//   - Lista de clientes con drawer detalle (timeline)
//   - Editor inline de los 144 mensajes
//   - Editor de los 7 días de calentamiento
//   - Vista mínima de calendario y configuración
//
// Depende de: window.db, window.utils.

(function () {
  'use strict';

  const { escapeHtml, showToast, formatearFechaCorta, tiempoRelativo,
    MESES_CORTOS, DIAS_LARGOS } = window.utils;

  let adminActual = null;
  let temasCache = [];
  let clientesCache = [];

  // =====================================
  // Init
  // =====================================
  async function init() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.querySelectorAll('[data-logout]').forEach(b =>
      b.addEventListener('click', handleLogout));
    document.querySelectorAll('[data-page-link]').forEach(b => {
      b.addEventListener('click', e => {
        e.preventDefault();
        mostrarPagina(b.dataset.pageLink);
      });
    });

    document.getElementById('drawer-close')?.addEventListener('click', cerrarDrawer);
    document.getElementById('drawer-overlay')?.addEventListener('click', cerrarDrawer);
    document.getElementById('forgot-link')?.addEventListener('click', handleForgotPassword);

    document.getElementById('clientes-search')?.addEventListener('input',
      e => filtrarClientes(e.target.value));
    document.getElementById('clientes-estado-filter')?.addEventListener('change', cargarClientes);
    document.getElementById('mensajes-tema-filter')?.addEventListener('change', cargarMensajes);
    document.getElementById('mensajes-modalidad-filter')?.addEventListener('change', cargarMensajes);

    // Modal sesión (CRUD calendario)
    document.getElementById('btn-nueva-sesion')?.addEventListener('click', () => abrirModalSesion(null));
    document.getElementById('modal-sesion-close')?.addEventListener('click', cerrarModalSesion);
    document.getElementById('modal-sesion-cancel')?.addEventListener('click', cerrarModalSesion);
    document.getElementById('form-sesion')?.addEventListener('submit', guardarSesion);
    document.getElementById('btn-eliminar-sesion')?.addEventListener('click', eliminarSesion);
    document.getElementById('modal-sesion')?.addEventListener('click', e => {
      if (e.target.id === 'modal-sesion') cerrarModalSesion();
    });

    document.getElementById('btn-cron-ejecutar')?.addEventListener('click', ejecutarCronManual);
    document.getElementById('set-password-form')?.addEventListener('submit', handleSetPassword);

    // Modal edición de cliente
    document.getElementById('modal-cliente-close')?.addEventListener('click', cerrarModalCliente);
    document.getElementById('modal-cliente-cancel')?.addEventListener('click', cerrarModalCliente);
    document.getElementById('form-cliente')?.addEventListener('submit', guardarCliente);
    document.getElementById('modal-cliente')?.addEventListener('click', e => {
      if (e.target.id === 'modal-cliente') cerrarModalCliente();
    });

    // Modal cambiar contraseña
    document.getElementById('btn-admin-cambiar-password')?.addEventListener('click', abrirModalPassword);
    document.getElementById('modal-password-close')?.addEventListener('click', cerrarModalPassword);
    document.getElementById('modal-password-cancel')?.addEventListener('click', cerrarModalPassword);
    document.getElementById('form-password')?.addEventListener('submit', handleCambiarPassword);
    document.getElementById('modal-password')?.addEventListener('click', e => {
      if (e.target.id === 'modal-password') cerrarModalPassword();
    });

    // Si llegamos aquí desde un email de recovery (o invite), el hash trae los
    // tokens. Supabase los procesa solo, pero antes de continuar mostramos la
    // pantalla "Establece tu contraseña".
    const tipoFlow = leerTipoFlowDesdeHash();
    if (tipoFlow === 'invite' || tipoFlow === 'recovery') {
      mostrarSetPassword(tipoFlow);
      return;
    }

    await detectarSesion();
  }

  function leerTipoFlowDesdeHash() {
    if (!window.location.hash) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    return params.get('type');
  }

  function mostrarSetPassword(tipo) {
    const ctx = document.getElementById('set-password-context');
    if (ctx) {
      ctx.textContent = tipo === 'invite'
        ? 'Tu cuenta admin está lista. Define una contraseña para entrar al panel.'
        : 'Define una nueva contraseña para tu cuenta admin.';
    }
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-shell').classList.remove('active');
    document.getElementById('screen-set-password').classList.add('active');
    setTimeout(() => document.getElementById('set-password-input')?.focus(), 50);
  }

  async function handleSetPassword(e) {
    e.preventDefault();
    const password = document.getElementById('set-password-input').value;
    const confirm = document.getElementById('set-password-confirm').value;
    if (password.length < 8) {
      showToast('La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }
    if (password !== confirm) {
      showToast('Las contraseñas no coinciden.', 'error');
      return;
    }

    const btn = document.getElementById('set-password-submit');
    btn.disabled = true;
    btn.textContent = 'Estableciendo…';

    try {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;

      history.replaceState(null, '', window.location.pathname);
      showToast('Contraseña establecida. Bienvenido.', 'success');

      document.getElementById('screen-set-password').classList.remove('active');
      await detectarSesion();
    } catch (err) {
      console.error('[Re-Génesis Admin] setPassword:', err);
      showToast('No pudimos guardar la contraseña: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Confirmar y entrar';
    }
  }

  async function detectarSesion() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      mostrarLogin();
      return;
    }
    await rutearAdmin(session.user.email);
  }

  async function rutearAdmin(email) {
    const { data: admin } = await db
      .from('usuarios_admin')
      .select('*')
      .eq('email', email)
      .eq('activo', true)
      .maybeSingle();

    if (!admin) {
      // No es admin (o no está activo): vuelve al cliente.
      showToast('Esta cuenta no es administrador. Te redirigimos.', 'error');
      window.location.href = '/regenesis/index.html';
      return;
    }

    adminActual = admin;
    pintarAdmin();
    await cargarTemasCache();
    mostrarShell();
    await cargarDashboard();
    mostrarPagina('dashboard');
  }

  function pintarAdmin() {
    document.querySelectorAll('[data-admin-name]')
      .forEach(el => el.textContent = adminActual.nombre);
    document.querySelectorAll('[data-admin-initial]')
      .forEach(el => el.textContent = (adminActual.nombre || '?').charAt(0).toUpperCase());
  }

  async function cargarTemasCache() {
    const { data } = await db.from('temas').select('*').order('orden');
    temasCache = data || [];
    pintarSelectorTemas();
  }

  function pintarSelectorTemas() {
    const sel = document.getElementById('mensajes-tema-filter');
    if (!sel) return;
    while (sel.options.length > 0) sel.remove(0);

    const optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = 'Selecciona una semana…';
    sel.appendChild(optDefault);

    const optCal = document.createElement('option');
    optCal.value = 'calentamiento';
    optCal.textContent = 'Sala de espera (7 días previos)';
    sel.appendChild(optCal);

    const optSep = document.createElement('option');
    optSep.value = '';
    optSep.disabled = true;
    optSep.textContent = '──────────';
    sel.appendChild(optSep);

    temasCache.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `Tema ${String(t.orden).padStart(2, '0')} · ${t.nombre}`;
      sel.appendChild(opt);
    });
  }

  // =====================================
  // Login / logout
  // =====================================
  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await rutearAdmin(email);
    } catch (err) {
      console.error('[Re-Génesis Admin] Login error:', err);
      showToast('Email o contraseña incorrectos.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar al panel';
    }
  }

  async function handleLogout() {
    await db.auth.signOut();
    adminActual = null;
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    mostrarLogin();
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    if (!email) {
      showToast('Escribe tu email primero.', 'error');
      return;
    }
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/admin.html',
    });
    if (error) {
      showToast('No pudimos enviar el correo: ' + error.message, 'error');
      return;
    }
    showToast('Si el email existe, recibirás un enlace para restablecer.', 'success');
  }

  // =====================================
  // Top-level screens y subpáginas
  // =====================================
  function mostrarLogin() {
    document.getElementById('screen-login').classList.add('active');
    document.getElementById('screen-shell').classList.remove('active');
  }

  function mostrarShell() {
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-shell').classList.add('active');
  }

  function mostrarPagina(name) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${name}`)?.classList.add('active');
    document.querySelectorAll('[data-page-link]').forEach(b => {
      b.classList.toggle('active', b.dataset.pageLink === name);
    });
    window.scrollTo(0, 0);

    if (name === 'clientes') cargarClientes();
    if (name === 'mensajes') cargarMensajes();
    if (name === 'calendario') cargarCalendario();
    if (name === 'testimonios') cargarTestimonios();
    if (name === 'config') cargarConfig();
    if (name === 'cron') cargarCron();
  }

  // =====================================
  // Testimonios — admin
  // =====================================
  async function cargarTestimonios() {
    const cont = document.getElementById('testimonios-list');
    const counter = document.getElementById('testimonios-count');
    cont.innerHTML = '<div class="empty-state-text" style="padding: var(--space-6);">Cargando…</div>';

    const { data, error } = await db.from('testimonios')
      .select('id, lead_id, momento, estado, recibido_at, aprobado_at, duracion_segundos, tema_orden_al_grabar, testimonio_video_path, comentarios_adicionales, permite_uso_marketing, permite_uso_nombre, leads:lead_id(nombre, email)')
      .order('recibido_at', { ascending: false, nullsFirst: false });

    if (error) {
      cont.innerHTML = `<div class="empty-state-text">Error: ${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data || !data.length) {
      counter.textContent = '0';
      cont.innerHTML = '<div class="empty-state-text" style="padding: var(--space-6);">Aún no hay testimonios grabados.</div>';
      return;
    }

    counter.textContent = String(data.length);

    const cards = await Promise.all(data.map(async t => {
      let videoUrl = '';
      if (t.testimonio_video_path) {
        const { data: signed } = await db.storage.from('testimonios')
          .createSignedUrl(t.testimonio_video_path, 3600);
        videoUrl = signed?.signedUrl || '';
      }
      const fechaTxt = t.recibido_at ? formatearFechaCorta(t.recibido_at) : '—';
      const duracionTxt = t.duracion_segundos
        ? `${Math.floor(t.duracion_segundos / 60)}:${String(t.duracion_segundos % 60).padStart(2,'0')}`
        : '—';
      const momentoTxt = t.momento === 'mitad_programa' ? 'Mitad del programa'
        : t.momento === 'final_programa' ? 'Cierre del programa'
        : 'Espontáneo';
      const estadoCls = t.estado === 'aprobado' ? 'badge-active'
        : t.estado === 'publicado' ? 'badge-active' : '';
      const lead = t.leads || {};

      return `
        <div class="testimonio-admin-card" data-test-id="${t.id}">
          ${videoUrl
            ? `<video src="${escapeHtml(videoUrl)}" controls preload="metadata"></video>`
            : '<div class="testimonio-video-placeholder">Sin video</div>'}
          <div class="testimonio-info">
            <div class="testimonio-info-name">${escapeHtml(lead.nombre || lead.email || '—')}</div>
            <div class="testimonio-info-meta">
              ${escapeHtml(momentoTxt)} · ${fechaTxt} · ${duracionTxt}
              · Tema ${t.tema_orden_al_grabar ?? '—'}
            </div>
            ${t.comentarios_adicionales
              ? `<div class="testimonio-comentarios">${escapeHtml(t.comentarios_adicionales)}</div>`
              : ''}
            <div class="testimonio-permisos">
              ${t.permite_uso_marketing ? '✓ marketing' : '✗ marketing'}
              · ${t.permite_uso_nombre ? '✓ nombre' : '✗ nombre'}
            </div>
            <div class="testimonio-actions">
              <span class="badge ${estadoCls}">${escapeHtml((t.estado || 'recibido').toUpperCase())}</span>
              ${t.estado !== 'aprobado' && t.estado !== 'publicado'
                ? `<button type="button" class="btn-secondary" data-aprobar="${t.id}">Aprobar</button>`
                : ''}
              ${t.estado === 'aprobado'
                ? `<button type="button" class="btn-secondary" data-publicar="${t.id}">Marcar publicado</button>`
                : ''}
              <button type="button" class="btn-ghost" data-rechazar="${t.id}">Rechazar</button>
            </div>
          </div>
        </div>
      `;
    }));

    cont.innerHTML = cards.join('');

    cont.querySelectorAll('[data-aprobar]').forEach(b => {
      b.addEventListener('click', () => actualizarTestimonio(b.dataset.aprobar, 'aprobado'));
    });
    cont.querySelectorAll('[data-publicar]').forEach(b => {
      b.addEventListener('click', () => actualizarTestimonio(b.dataset.publicar, 'publicado'));
    });
    cont.querySelectorAll('[data-rechazar]').forEach(b => {
      b.addEventListener('click', () => {
        if (confirm('¿Rechazar este testimonio? Volverá a estado pendiente y no se usará.')) {
          actualizarTestimonio(b.dataset.rechazar, 'pendiente');
        }
      });
    });
  }

  async function actualizarTestimonio(id, nuevoEstado) {
    const updates = { estado: nuevoEstado };
    if (nuevoEstado === 'aprobado') {
      updates.aprobado_at = new Date().toISOString();
      const { data: { session } } = await db.auth.getSession();
      if (session) {
        const { data: admin } = await db.from('usuarios_admin')
          .select('id').eq('email', session.user.email).maybeSingle();
        if (admin) updates.aprobado_por = admin.id;
      }
    }
    const { data, error } = await db.from('testimonios').update(updates).eq('id', id).select('id');
    if (error) {
      showToast('Error: ' + error.message, 'error');
      return;
    }
    if (!data || data.length === 0) {
      showToast('No se actualizó el testimonio (revisa permisos).', 'error');
      return;
    }
    showToast(`Testimonio ${nuevoEstado}.`, 'success');
    await cargarTestimonios();
  }

  // =====================================
  // Dashboard
  // =====================================
  async function cargarDashboard() {
    const sieteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();

    const [totalRes, activosRes, reflexionesRes, ultimasRes, sesionRes] = await Promise.all([
      db.from('leads').select('*', { count: 'exact', head: true }),
      db.from('leads').select('*', { count: 'exact', head: true }).eq('estado', 'activo'),
      db.from('journaling_respuestas')
        .select('*', { count: 'exact', head: true })
        .gte('respuesta_recibida_at', sieteDiasAtras),
      db.from('journaling_respuestas')
        .select('id, lead_id, pregunta_original, respuesta_cliente, respuesta_recibida_at, tema_orden, dia_relativo, leads:lead_id(nombre, email)')
        .order('respuesta_recibida_at', { ascending: false })
        .limit(5),
      db.from('sesiones_calendario')
        .select('*')
        .gte('fecha', new Date().toISOString().slice(0, 10))
        .eq('estado', 'programada')
        .order('fecha', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const totalClientes = totalRes.count || 0;
    const clientesActivos = activosRes.count || 0;
    const reflexionesSemana = reflexionesRes.count || 0;

    document.getElementById('kpi-clientes-activos').textContent = clientesActivos;
    document.getElementById('kpi-clientes-total').textContent =
      `de ${totalClientes} totales`;
    document.getElementById('kpi-reflexiones').textContent = reflexionesSemana;

    const adherencia = clientesActivos > 0
      ? Math.min(100, Math.round((reflexionesSemana / (clientesActivos * 7)) * 100))
      : 0;
    document.getElementById('kpi-adherencia').textContent = `${adherencia}%`;

    if (sesionRes.data) {
      const s = sesionRes.data;
      const f = new Date(s.fecha + 'T00:00:00');
      const diff = Math.max(0, Math.ceil((f - new Date()) / 86400000));
      document.getElementById('kpi-proxima-sesion').textContent =
        diff === 0 ? 'HOY' : diff === 1 ? 'MAÑANA' : `${diff}d`;
      document.getElementById('kpi-proxima-meta').textContent =
        `${DIAS_LARGOS[f.getDay()]} ${f.getDate()} ${MESES_CORTOS[f.getMonth()]} · ${(s.hora_inicio || '').slice(0, 5)}`;
    } else {
      document.getElementById('kpi-proxima-sesion').textContent = '—';
      document.getElementById('kpi-proxima-meta').textContent = 'Sin sesiones programadas';
    }

    pintarActividadReciente(ultimasRes.data || []);
  }

  function pintarActividadReciente(entradas) {
    const ul = document.getElementById('actividad-reciente');
    if (!ul) return;
    if (!entradas.length) {
      ul.innerHTML = `
        <li class="activity-item">
          <div class="empty-state-text">Aún no hay reflexiones registradas.</div>
        </li>`;
      return;
    }
    ul.innerHTML = entradas.map(e => {
      const lead = e.leads || {};
      const tema = temasCache.find(t => t.orden === e.tema_orden)?.nombre || '—';
      const snippet = (e.respuesta_cliente || '').slice(0, 180);
      const truncado = (e.respuesta_cliente || '').length > 180;
      return `
        <li class="activity-item">
          <div class="activity-row">
            <span class="activity-name">${escapeHtml(lead.nombre || lead.email || '—')}</span>
            <span class="activity-time">${tiempoRelativo(e.respuesta_recibida_at).toUpperCase()}</span>
          </div>
          <div class="activity-meta">${escapeHtml(tema)} · día ${e.dia_relativo || '—'}</div>
          <div class="activity-snippet">${escapeHtml(snippet)}${truncado ? '…' : ''}</div>
        </li>
      `;
    }).join('');
  }

  // =====================================
  // Clientes
  // =====================================
  async function cargarClientes() {
    const tbody = document.getElementById('clientes-tbody');
    if (!tbody) return;
    tbody.innerHTML = `
      <tr><td colspan="6" style="text-align: center; padding: var(--space-8);">
        <div class="spinner" style="margin: 0 auto;"></div>
      </td></tr>`;

    const estadoFiltro = document.getElementById('clientes-estado-filter')?.value || '';
    let query = db.from('leads').select('*').order('created_at', { ascending: false });
    if (estadoFiltro) query = query.eq('estado', estadoFiltro);

    const { data, error } = await query;
    if (error) {
      console.error(error);
      showToast('Error al cargar clientes', 'error');
      return;
    }
    clientesCache = data || [];
    pintarClientesTabla(clientesCache);
    document.getElementById('clientes-count').textContent =
      `${clientesCache.length} CLIENTE${clientesCache.length === 1 ? '' : 'S'}`;
  }

  function pintarClientesTabla(clientes) {
    const tbody = document.getElementById('clientes-tbody');
    if (!clientes.length) {
      tbody.innerHTML = `
        <tr><td colspan="6">
          <div class="empty-state">
            <div class="empty-state-icon">◌</div>
            <div class="empty-state-title">Sin clientes</div>
            <div class="empty-state-text">No hay clientes con este filtro.</div>
          </div>
        </td></tr>`;
      return;
    }

    tbody.innerHTML = clientes.map(c => {
      const tema = temasCache.find(t => t.orden === c.tema_actual_orden)?.nombre || '—';
      const estadoLabel = (c.estado || '').replace(/_/g, ' ');
      const badgeCls = c.estado === 'activo' ? 'badge badge-active' : 'badge';
      return `
        <tr data-cliente-id="${c.id}">
          <td>
            <div class="cell-name">${escapeHtml(c.nombre || '—')}</div>
            <div class="cell-email">${escapeHtml(c.email || '')}</div>
          </td>
          <td><span class="${badgeCls}">${escapeHtml(estadoLabel.toUpperCase())}</span></td>
          <td>${escapeHtml(tema)}</td>
          <td class="col-num">${c.semana_actual || '—'}/10</td>
          <td>${escapeHtml((c.cohorte || '').toUpperCase())}</td>
          <td class="col-num">${c.created_at ? formatearFechaCorta(c.created_at) : '—'}</td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('tr[data-cliente-id]').forEach(tr => {
      tr.addEventListener('click', () => abrirDrawerCliente(tr.dataset.clienteId));
    });
  }

  function filtrarClientes(query) {
    const q = (query || '').toLowerCase().trim();
    if (!q) {
      pintarClientesTabla(clientesCache);
      return;
    }
    const filtrados = clientesCache.filter(c =>
      (c.nombre || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.cohorte || '').toLowerCase().includes(q)
    );
    pintarClientesTabla(filtrados);
    document.getElementById('clientes-count').textContent =
      `${filtrados.length} DE ${clientesCache.length}`;
  }

  async function abrirDrawerCliente(id) {
    const cliente = clientesCache.find(c => c.id === id);
    if (!cliente) return;

    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawer-overlay');
    const body = document.getElementById('drawer-body');
    const title = document.getElementById('drawer-title');

    title.textContent = cliente.nombre || cliente.email;
    body.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    overlay.classList.add('visible');
    drawer.classList.add('visible');

    const progreso = calcularProgresoLead(cliente);

    const { data: reflexiones } = await db
      .from('journaling_respuestas')
      .select('*, ia_analisis(contenido_analisis, modelo_usado, tokens_input, tokens_output, costo_usd)')
      .eq('lead_id', cliente.id)
      .order('respuesta_recibida_at', { ascending: false })
      .limit(20);

    body.innerHTML = renderDrawerCliente(cliente, progreso, reflexiones || []);
    bindDrawerTabs(body);

    body.querySelector('[data-action-editar]')
      ?.addEventListener('click', () => abrirModalCliente(cliente));

    body.querySelector('[data-action-eliminar]')
      ?.addEventListener('click', () => confirmarEliminarCliente(cliente));

    body.querySelector('[data-action-copiar-link]')
      ?.addEventListener('click', async (e) => {
        const url = e.currentTarget.dataset.link;
        try {
          await navigator.clipboard.writeText(url);
          const original = e.currentTarget.textContent;
          e.currentTarget.textContent = 'Copiado ✓';
          showToast('Link copiado al portapapeles', 'success');
          setTimeout(() => { e.currentTarget.textContent = original; }, 2000);
        } catch (err) {
          console.error('clipboard error', err);
          showToast('No se pudo copiar — selecciona la URL y copia manual', 'error');
        }
      });
  }

  // Confirmación + ejecución de eliminación de cliente (con cascada en BD)
  async function confirmarEliminarCliente(cliente) {
    const nombre = cliente.nombre || cliente.email || cliente.id;
    const msg =
      `¿Eliminar a ${nombre}?\n\n` +
      `Esto borra:\n` +
      `  · Sus reflexiones y análisis\n` +
      `  · Sus interacciones y notificaciones\n` +
      `  · Sus testimonios y logros\n` +
      `  · Su cuenta de la plataforma (auth.users)\n` +
      `  · El registro del lead\n\n` +
      `Se conserva el webhook_log histórico (con lead_id = NULL) y un snapshot ` +
      `del cliente en cliente_eliminado_log.\n\n` +
      `NO se puede deshacer.`;

    if (!window.confirm(msg)) return;

    try {
      const { data, error } = await db.rpc('eliminar_cliente_completo', {
        p_lead_id: cliente.id,
      });

      if (error) {
        console.error('eliminar_cliente_completo error:', error);
        showToast('No se pudo eliminar: ' + (error.message || 'error desconocido'), 'error');
        return;
      }

      const resumen = data?.resumen || {};
      const total = Object.values(resumen).reduce((s, n) => s + (Number(n) || 0), 0);
      showToast(`${nombre} eliminado · ${total} filas limpiadas`, 'success');

      // Cerrar drawer y refrescar
      const drawer = document.getElementById('drawer');
      const overlay = document.getElementById('drawer-overlay');
      drawer?.classList.remove('visible');
      overlay?.classList.remove('visible');

      // Sacar de la cache local sin esperar reload completo
      clientesCache = clientesCache.filter(c => c.id !== cliente.id);
      pintarClientesTabla(clientesCache);
      const counter = document.getElementById('clientes-count');
      if (counter) counter.textContent =
        `${clientesCache.length} CLIENTE${clientesCache.length === 1 ? '' : 'S'}`;
    } catch (e) {
      console.error('confirmarEliminarCliente exception:', e);
      showToast('Error inesperado al eliminar', 'error');
    }
  }

  // -----------------------------------------------------
  // Helpers que replican el cálculo del cliente
  // -----------------------------------------------------
  function calcularProgresoLead(cliente) {
    const out = {
      enCalentamiento: false,
      enPrograma: false,
      diaCalentamiento: null,
      diasParaInicio: null,
      diaPrograma: null,
      diaEnTema: null,
      semana: null,
      temaOrden: null,
      temaNombre: null,
      completado: false,
    };

    if (cliente.estado === 'pagado_calentamiento' && cliente.fecha_inicio_calentamiento && cliente.fecha_inicio_programa) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const inicioProg = new Date(cliente.fecha_inicio_programa + 'T00:00:00');
      // ISODOW: 1=Lunes ... 7=Domingo. JS getDay() devuelve 0=Dom, lo convertimos.
      const diaSemana = hoy.getDay() === 0 ? 7 : hoy.getDay();
      out.enCalentamiento = true;
      out.diaCalentamiento = diaSemana;
      out.diasParaInicio = Math.ceil((inicioProg - hoy) / 86400000);
      return out;
    }

    if (cliente.fecha_inicio_programa) {
      const inicio = new Date(cliente.fecha_inicio_programa + 'T00:00:00');
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const dias = Math.floor((hoy - inicio) / 86400000);

      if (dias < 0) {
        out.enCalentamiento = true;
        out.diasParaInicio = -dias;
        return out;
      }
      if (dias >= 70) {
        out.completado = true;
        return out;
      }

      const semanaIdx = Math.floor(dias / 7);
      const diaEnSemana = (dias % 7) + 1;
      // tema_actual_orden ya viene del calendario_temas (set por el cron diario).
      // El cálculo por módulo desde primer_tema_orden divergía en los ciclos
      // comprimidos de Frank. Usamos el valor de BD directamente.
      const temaOrden = cliente.tema_actual_orden || cliente.primer_tema_orden || 1;
      const tema = temasCache.find(t => t.orden === temaOrden);

      out.enPrograma = true;
      out.diaPrograma = dias + 1;
      out.diaEnTema = diaEnSemana;
      out.semana = semanaIdx + 1;
      out.temaOrden = temaOrden;
      out.temaNombre = tema?.nombre || '—';
      out._temaId = tema?.id || null;
      return out;
    }

    return out;
  }

  // -----------------------------------------------------
  // Render del drawer con tabs
  // -----------------------------------------------------
  function renderDrawerCliente(cliente, progreso, reflexiones) {
    const puedeVerComo = !!cliente.fecha_inicio_programa;
    const tabs = `
      <div class="drawer-tabs" role="tablist">
        <button type="button" class="drawer-tab active" data-tab="resumen" role="tab">Resumen</button>
        <button type="button" class="drawer-tab" data-tab="reflexiones" role="tab">
          Reflexiones <span class="drawer-tab-count">${reflexiones.length}</span>
        </button>
        <div class="drawer-tab-actions">
          <button type="button" class="drawer-tab-action drawer-tab-action-edit" data-action-editar>
            Editar datos
          </button>
          ${puedeVerComo ? `
            <a class="drawer-tab-action" href="/regenesis/libro.html?lead_id=${encodeURIComponent(cliente.id)}" target="_blank" rel="noopener">Ver libro ↗</a>
            <a class="drawer-tab-action" href="/regenesis/index.html?view_as=${encodeURIComponent(cliente.id)}" target="_blank" rel="noopener">Ver como cliente ↗</a>
          ` : ''}
          <button type="button" class="drawer-tab-action drawer-tab-action-danger" data-action-eliminar>
            Eliminar
          </button>
        </div>
      </div>`;

    return tabs +
      `<div class="drawer-tab-panel active" data-panel="resumen">${renderTabResumen(cliente, progreso)}</div>` +
      `<div class="drawer-tab-panel" data-panel="reflexiones">${renderTabReflexiones(reflexiones)}</div>`;
  }

  function bindDrawerTabs(root) {
    root.querySelectorAll('.drawer-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        root.querySelectorAll('.drawer-tab').forEach(b =>
          b.classList.toggle('active', b.dataset.tab === target));
        root.querySelectorAll('.drawer-tab-panel').forEach(p =>
          p.classList.toggle('active', p.dataset.panel === target));
      });
    });
  }

  function renderTabResumen(cliente, progreso) {
    const completados = (cliente.temas_completados || []).length;
    const ubicacionPrograma = progreso.enCalentamiento
      ? `Sala de espera · día ${progreso.diaCalentamiento ?? '—'} (faltan ${progreso.diasParaInicio ?? '—'})`
      : progreso.enPrograma
        ? `${progreso.temaNombre} · día ${progreso.diaEnTema}/7 (semana ${progreso.semana}/10)`
        : progreso.completado
          ? 'Programa completado'
          : '—';

    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Datos del cliente</div>
        <div class="detail-grid">
          <div class="detail-row"><div class="detail-label">Email</div>
            <div class="detail-value">${escapeHtml(cliente.email || '—')}</div></div>
          <div class="detail-row"><div class="detail-label">Teléfono</div>
            <div class="detail-value">${escapeHtml(cliente.telefono || '—')}</div></div>
          <div class="detail-row"><div class="detail-label">Cohorte</div>
            <div class="detail-value">${escapeHtml((cliente.cohorte || '—').toUpperCase())}</div></div>
          <div class="detail-row"><div class="detail-label">País / Ciudad</div>
            <div class="detail-value">${escapeHtml([cliente.pais, cliente.ciudad].filter(Boolean).join(' · ') || '—')}</div></div>
          <div class="detail-row"><div class="detail-label">GHL Contact ID</div>
            <div class="detail-value">${cliente.ghl_contact_id ? `<code style="font-size:11px;">${escapeHtml(cliente.ghl_contact_id)}</code>` : '—'}</div></div>
        </div>
      </div>

      ${renderSeccionPago(cliente)}

      ${renderSeccionContratos(cliente)}

      <div class="drawer-section">
        <div class="drawer-section-title">Programa</div>
        <div class="detail-grid">
          <div class="detail-row"><div class="detail-label">Estado</div>
            <div class="detail-value">${escapeHtml((cliente.estado || '—').replace(/_/g, ' ').toUpperCase())}</div></div>
          <div class="detail-row"><div class="detail-label">Inicio programa</div>
            <div class="detail-value">${cliente.fecha_inicio_programa || '—'}</div></div>
          <div class="detail-row"><div class="detail-label">Posición actual</div>
            <div class="detail-value">${escapeHtml(ubicacionPrograma)}</div></div>
          <div class="detail-row"><div class="detail-label">Temas completados</div>
            <div class="detail-value">${completados}/10</div></div>
        </div>
      </div>`;
  }

  function renderSeccionPago(cliente) {
    const modalidadDisplay = cliente.modalidad
      ? `<span class="estado-pill estado-ok">${escapeHtml(cliente.modalidad)}</span>`
      : '<span class="estado-pill estado-pendiente">SIN DEFINIR</span>';

    const cuotasDisplay = cliente.cuotas_elegidas != null
      ? `<span class="estado-pill estado-ok">${cliente.cuotas_elegidas}${cliente.cuotas_elegidas === 1 ? ' cuota (pago único)' : ' cuotas'}</span>`
      : '<span class="estado-pill estado-pendiente">SIN DEFINIR</span>';

    const fechaPago = cliente.fecha_pago
      ? new Date(cliente.fecha_pago).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
      : '—';
    const precio = cliente.precio_pagado != null
      ? `$${Number(cliente.precio_pagado).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
      : '—';

    return `
      <div class="drawer-section">
        <div class="drawer-section-title">Pago y modalidad</div>
        <div class="detail-grid">
          <div class="detail-row"><div class="detail-label">Fecha pago</div>
            <div class="detail-value">${escapeHtml(fechaPago)}</div></div>
          <div class="detail-row"><div class="detail-label">Precio pagado</div>
            <div class="detail-value">${escapeHtml(precio)}</div></div>
          <div class="detail-row"><div class="detail-label">Modalidad</div>
            <div class="detail-value">${modalidadDisplay}</div></div>
          <div class="detail-row"><div class="detail-label">Cuotas elegidas</div>
            <div class="detail-value">${cuotasDisplay}</div></div>
        </div>
      </div>`;
  }

  function renderSeccionContratos(cliente) {
    const filas = [
      { key: 'servicio', label: 'Contrato de Servicio',     fechaCol: 'contrato_servicio_firmado_at', requerido: true },
      { key: 'waiver',   label: 'Waiver / Liability',       fechaCol: 'contrato_waiver_firmado_at',   requerido: true },
      { key: 'media',    label: 'Media Release',            fechaCol: 'contrato_media_firmado_at',    requerido: true },
    ];

    const items = filas.map(f => {
      const fecha = cliente[f.fechaCol];
      const firmado = !!fecha;
      const icono = firmado
        ? '<span class="contrato-icon contrato-firmado">✓</span>'
        : (f.requerido
            ? '<span class="contrato-icon contrato-pendiente">○</span>'
            : '<span class="contrato-icon contrato-opcional">−</span>');
      const meta = firmado
        ? `Firmado · ${new Date(fecha).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}`
        : (f.requerido ? 'Pendiente' : 'No aplica');
      return `
        <div class="contrato-row ${firmado ? 'is-firmado' : (f.requerido ? 'is-pendiente' : 'is-opcional')}">
          ${icono}
          <div class="contrato-body">
            <div class="contrato-label">${escapeHtml(f.label)}</div>
            <div class="contrato-meta">${escapeHtml(meta)}</div>
          </div>
        </div>`;
    }).join('');

    const obligatoriosFaltantes = filas
      .filter(f => f.requerido && !cliente[f.fechaCol])
      .length;
    const todosObligatorios = obligatoriosFaltantes === 0;
    const tieneGid = !!cliente.ghl_contact_id;

    const accionesHtml = (() => {
      if (!tieneGid) {
        return '<div class="contrato-warn">⚠ Sin <code>ghl_contact_id</code>, no se puede generar link de bienvenida automático.</div>';
      }
      if (todosObligatorios) {
        return '<div class="contrato-ok">Todos los contratos obligatorios firmados.</div>';
      }
      const url = `https://neurohackers.cloud/bienvenida.html?gid=${encodeURIComponent(cliente.ghl_contact_id)}`;
      return `
        <div class="contrato-acciones">
          <div class="contrato-link-preview"><code>${escapeHtml(url)}</code></div>
          <button type="button" class="btn-primary btn-small"
            data-action-copiar-link
            data-link="${escapeHtml(url)}">
            Copiar link de bienvenida
          </button>
          <a class="btn-secondary btn-small" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
            Abrir en nueva pestaña ↗
          </a>
        </div>`;
    })();

    return `
      <div class="drawer-section">
        <div class="drawer-section-title">
          Contratos
          ${todosObligatorios
            ? '<span class="estado-pill estado-ok">COMPLETO</span>'
            : `<span class="estado-pill estado-pendiente">FALTAN ${obligatoriosFaltantes}</span>`}
        </div>
        <div class="contrato-list">${items}</div>
        ${accionesHtml}
      </div>`;
  }

  function renderTabReflexiones(reflexiones) {
    if (!reflexiones.length) {
      return `<div class="drawer-section"><div class="empty-state-text">Sin reflexiones todavía.</div></div>`;
    }
    return `
      <div class="drawer-section">
        <div class="drawer-section-title">${reflexiones.length} reflexión(es) · más reciente arriba</div>
        <div class="timeline">
          ${reflexiones.map(r => {
            const temaR = temasCache.find(t => t.orden === r.tema_orden)?.nombre
              || (r.es_calentamiento ? 'Calentamiento' : '—');
            const analisis = (r.ia_analisis && r.ia_analisis[0]) || null;
            return `
              <div class="timeline-entry">
                <div class="timeline-entry-header">
                  <span>${escapeHtml(temaR)} · día ${r.dia_relativo || '—'}${r.editado ? ' · editado' : ''}</span>
                  <span>${tiempoRelativo(r.respuesta_recibida_at).toUpperCase()}</span>
                </div>
                <div class="timeline-prompt">${escapeHtml(r.pregunta_original || '')}</div>
                <div class="timeline-response">${escapeHtml(r.respuesta_cliente || '')}</div>
                ${r.pregunta_personaje ? `
                  <div class="timeline-analisis">
                    <div class="timeline-analisis-label">Pregunta para el personaje</div>
                    <div class="timeline-analisis-body">${escapeHtml(r.pregunta_personaje)}</div>
                  </div>` : ''}
                ${r.respuesta_personaje ? `
                  <div class="timeline-response" style="border-left-color: var(--accent-bright);">
                    <div class="timeline-analisis-label">Respuesta del personaje${r.respuesta_personaje_editada ? ' · editada' : ''}</div>
                    ${escapeHtml(r.respuesta_personaje)}
                  </div>` : ''}
                ${r.cierre_ia ? `
                  <div class="timeline-analisis">
                    <div class="timeline-analisis-label">Cierre del día (consejo)</div>
                    <div class="timeline-analisis-body">${escapeHtml(r.cierre_ia)}</div>
                  </div>` : ''}
                ${analisis && !r.pregunta_personaje ? `
                  <div class="timeline-analisis">
                    <div class="timeline-analisis-label">Análisis · ${escapeHtml(analisis.modelo_usado || 'modelo')}</div>
                    <div class="timeline-analisis-body">${escapeHtml(analisis.contenido_analisis || '')}</div>
                  </div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }


  function cerrarDrawer() {
    document.getElementById('drawer').classList.remove('visible');
    document.getElementById('drawer-overlay').classList.remove('visible');
  }

  // =====================================
  // Mensajes (vista por semana / día)
  // =====================================
  const TIPO_LABELS = {
    journaling: 'Pregunta diaria',
    sesion_aviso_previo: 'Aviso del día anterior',
    sesion_calentamiento: 'Activación pre-sesión',
    sesion_nutricion: 'Recomendación nutricional',
    sesion_recordatorio: 'Recordatorio (2h antes)',
    skool_modulo: 'Módulo de Skool',
  };

  const DIA_NOMBRE_CORTO = {
    1: 'LUN', 2: 'MAR', 3: 'MIÉ', 4: 'JUE',
    5: 'VIE', 6: 'SÁB', 7: 'DOM',
  };

  const DIA_NOMBRE_LARGO = {
    1: 'LUNES', 2: 'MARTES', 3: 'MIÉRCOLES', 4: 'JUEVES',
    5: 'VIERNES', 6: 'SÁBADO', 7: 'DOMINGO',
  };

  const MODALIDAD_LABELS = {
    presencial: 'PRESENCIAL',
    virtual: 'VIRTUAL',
    ambas: 'AMBAS',
  };

  function sessionTagFor(dia, modalidad) {
    if (dia === 2 && modalidad === 'presencial') return 'SESIÓN PRESENCIAL · 18:45 · FRANK';
    if (dia === 3 && modalidad === 'virtual')    return 'SESIÓN VIRTUAL · 19:00 · FRANK';
    if (dia === 4) return 'SESIÓN GRUPAL · 19:00 · TATIANA';
    return null;
  }

  async function cargarMensajes() {
    const cont = document.getElementById('mensajes-list');
    if (!cont) return;

    const temaFilter = document.getElementById('mensajes-tema-filter')?.value || '';
    const modalidadSel = document.getElementById('mensajes-modalidad-filter');
    const modalidadFilter = modalidadSel?.value || 'presencial';

    // Si selecciona "Sala de espera", el filtro de modalidad no aplica.
    if (modalidadSel) modalidadSel.disabled = (temaFilter === 'calentamiento');

    if (!temaFilter) {
      document.getElementById('mensajes-count').textContent = '— MENSAJES';
      cont.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">≡</div>
          <div class="empty-state-title">Selecciona una semana</div>
          <div class="empty-state-text">
            Elige "Sala de espera" o uno de los 10 temas arriba para ver y editar
            los mensajes que se envían cada día.
          </div>
        </div>`;
      return;
    }

    cont.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    if (temaFilter === 'calentamiento') {
      await pintarSalaDeEspera(cont);
      return;
    }

    await pintarSemanaDeTema(cont, Number(temaFilter), modalidadFilter);
  }

  // ---- Tema 1..10: agrupado por día (1..7) ----
  async function pintarSemanaDeTema(cont, temaId, modalidad) {
    const { data, error } = await db.from('mensajes')
      .select('*, temas:tema_id(orden, nombre)')
      .eq('tema_id', temaId)
      .in('modalidad', [modalidad, 'ambas'])
      .order('dia_relativo')
      .order('modalidad')
      .order('tipo');

    if (error) {
      console.error(error);
      showToast('Error al cargar mensajes', 'error');
      return;
    }

    document.getElementById('mensajes-count').textContent =
      `${data.length} MENSAJE${data.length === 1 ? '' : 'S'}`;

    const porDia = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    data.forEach(m => {
      if (porDia[m.dia_relativo]) porDia[m.dia_relativo].push(m);
    });

    cont.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(dia => {
      const mensajes = porDia[dia];
      const sessionTag = sessionTagFor(dia, modalidad);
      return `
        <section class="day-section" data-dia="${dia}">
          <div class="day-section-header">
            <div class="day-section-id">
              <span class="day-section-day-num">D${dia}</span>
              <span class="day-section-day-name">${DIA_NOMBRE_LARGO[dia]}</span>
            </div>
            ${sessionTag ? `<span class="day-section-tag">${sessionTag}</span>` : ''}
            <span class="day-section-count">${mensajes.length} mensaje${mensajes.length === 1 ? '' : 's'}</span>
          </div>
          ${mensajes.length === 0
            ? `<div class="day-section-empty">Sin mensajes para este día.</div>`
            : `<div class="day-section-messages">
                ${mensajes.map(renderMessageEditor).join('')}
              </div>`
          }
        </section>
      `;
    }).join('');

    bindMessageEditors(cont);
  }

  function renderMessageEditor(m) {
    const modalidad = m.modalidad || 'ambas';
    const badgeCls = modalidad === 'presencial' ? 'badge badge-active' : 'badge';
    return `
      <div class="message-editor" data-mensaje-id="${m.id}" data-modalidad="${modalidad}">
        <div class="message-editor-meta">
          <span class="message-editor-tipo">${escapeHtml(TIPO_LABELS[m.tipo] || m.tipo)}</span>
          <span class="${badgeCls}" style="margin-top: 4px; font-size: 9px; align-self: flex-start;">
            ${escapeHtml(MODALIDAD_LABELS[modalidad] || modalidad.toUpperCase())}
          </span>
        </div>
        <textarea data-content rows="3">${escapeHtml(m.contenido || '')}</textarea>
        <div class="message-editor-actions">
          <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
          <span class="message-editor-status" data-status>SIN CAMBIOS</span>
        </div>
      </div>
    `;
  }

  function bindMessageEditors(cont) {
    cont.querySelectorAll('.message-editor[data-mensaje-id]').forEach(editor => {
      const id = editor.dataset.mensajeId;
      const textarea = editor.querySelector('[data-content]');
      const btn = editor.querySelector('[data-save]');
      const status = editor.querySelector('[data-status]');
      let original = textarea.value;

      textarea.addEventListener('input', () => {
        const dirty = textarea.value !== original;
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      });

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const { error } = await db.from('mensajes')
          .update({ contenido: textarea.value, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          showToast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        original = textarea.value;
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        showToast('Mensaje guardado', 'success');
      });
    });
  }

  // ---- Sala de espera: 7 días en cards (mensajes_calentamiento) ----
  async function pintarSalaDeEspera(cont) {
    const { data, error } = await db
      .from('mensajes_calentamiento')
      .select('*')
      .order('dia_calentamiento');

    if (error) {
      showToast('Error al cargar sala de espera', 'error');
      return;
    }

    document.getElementById('mensajes-count').textContent =
      `${(data || []).length} DÍA${(data || []).length === 1 ? '' : 'S'}`;

    cont.innerHTML = `
      <p class="empty-state-text" style="text-align: left; max-width: none; margin-bottom: var(--space-6);">
        Cuando un cliente paga un día que <strong>no es lunes</strong>, recibe estos contenidos
        cada día hasta el siguiente lunes (cuando arranca su tema 1).
      </p>
      <div class="calentamiento-grid">
        ${(data || []).map(c => `
          <div class="calentamiento-card" data-cal-id="${c.id}">
            <div class="calentamiento-card-header">
              <span class="calentamiento-card-day">DÍA ${c.dia_calentamiento}</span>
              <span class="calentamiento-card-tag">SALA DE ESPERA</span>
            </div>
            <div class="calentamiento-field">
              <label>Pregunta del día</label>
              <textarea data-field="pregunta_dia" rows="2">${escapeHtml(c.pregunta_dia || '')}</textarea>
            </div>
            <div class="calentamiento-field">
              <label>Introducción</label>
              <textarea data-field="introduccion" rows="3">${escapeHtml(c.introduccion || '')}</textarea>
            </div>
            <div class="calentamiento-field">
              <label>Ejercicio práctico</label>
              <textarea data-field="ejercicio_practico" rows="2">${escapeHtml(c.ejercicio_practico || '')}</textarea>
            </div>
            <div class="calentamiento-card-actions">
              <span class="message-editor-status" data-status>SIN CAMBIOS</span>
              <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    bindCalentamientoEditors(cont);
  }

  function bindCalentamientoEditors(cont) {
    cont.querySelectorAll('.calentamiento-card').forEach(card => {
      const id = card.dataset.calId;
      const fields = card.querySelectorAll('[data-field]');
      const btn = card.querySelector('[data-save]');
      const status = card.querySelector('[data-status]');
      const originals = {};
      fields.forEach(f => originals[f.dataset.field] = f.value);

      fields.forEach(f => f.addEventListener('input', () => {
        const dirty = Array.from(fields).some(x => x.value !== originals[x.dataset.field]);
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      }));

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const updates = { updated_at: new Date().toISOString() };
        fields.forEach(f => updates[f.dataset.field] = f.value);
        const { error } = await db.from('mensajes_calentamiento').update(updates).eq('id', id);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          showToast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        fields.forEach(f => originals[f.dataset.field] = f.value);
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        showToast('Día guardado', 'success');
      });
    });
  }

  // =====================================
  // Calendario (CRUD)
  // =====================================
  async function cargarCalendario() {
    const cont = document.getElementById('calendario-list');
    if (!cont) return;
    cont.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    const { data } = await db.from('sesiones_calendario')
      .select('*')
      .order('fecha')
      .order('hora_inicio')
      .limit(120);

    document.getElementById('calendario-count').textContent =
      `${(data || []).length} SESIÓN${(data || []).length === 1 ? '' : 'ES'}`;

    if (!data || !data.length) {
      cont.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">◰</div>
          <div class="empty-state-title">Sin sesiones programadas</div>
          <div class="empty-state-text">
            Click en "+ Nueva sesión" para agregar la primera.
          </div>
        </div>`;
      return;
    }

    const tipoLabel = {
      presencial: 'Presencial',
      virtual: 'Virtual',
      tatiana_grupal: 'Grupal · Tatiana',
      especial: 'Especial',
    };

    cont.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Tipo</th>
              <th>Facilitador</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(s => `
              <tr data-sesion-id="${s.id}">
                <td>${formatearFechaCorta(s.fecha)}</td>
                <td class="col-num">${(s.hora_inicio || '').slice(0, 5)}</td>
                <td>${escapeHtml(tipoLabel[s.tipo_sesion] || s.tipo_sesion)}</td>
                <td>${escapeHtml(s.facilitador || '—')}</td>
                <td><span class="badge ${s.estado === 'cancelada' ? 'badge-error' : ''}">${escapeHtml((s.estado || '').toUpperCase())}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    cont.querySelectorAll('tr[data-sesion-id]').forEach(tr => {
      tr.addEventListener('click', () => {
        const sesion = data.find(s => s.id === tr.dataset.sesionId);
        if (sesion) abrirModalSesion(sesion);
      });
    });
  }

  // =====================================
  // Configuración (edición inline)
  // =====================================
  async function cargarConfig() {
    const cont = document.getElementById('config-list');
    if (!cont) return;
    cont.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    const { data } = await db.from('configuracion_sistema').select('*').order('clave');

    cont.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Clave</th>
              <th style="width: 220px;">Valor</th>
              <th>Descripción</th>
              <th style="width: 160px;"></th>
            </tr>
          </thead>
          <tbody>
            ${(data || []).map(c => `
              <tr data-config-clave="${escapeHtml(c.clave)}" style="cursor: default;">
                <td class="mono" style="font-size: 12px;">${escapeHtml(c.clave)}</td>
                <td>
                  <input type="text" class="search-input config-input"
                         data-original="${escapeHtml(c.valor || '')}"
                         value="${escapeHtml(c.valor || '')}"
                         style="padding: 6px 10px; font-size: 13px; min-width: 0;">
                </td>
                <td style="color: var(--text-muted); font-size: 13px;">
                  ${escapeHtml(c.descripcion || '')}
                </td>
                <td>
                  <div class="message-editor-actions">
                    <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
                    <span class="message-editor-status" data-status>SIN CAMBIOS</span>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    cont.querySelectorAll('tr[data-config-clave]').forEach(tr => {
      const clave = tr.dataset.configClave;
      const input = tr.querySelector('.config-input');
      const btn = tr.querySelector('[data-save]');
      const status = tr.querySelector('[data-status]');
      let original = input.dataset.original;

      input.addEventListener('input', () => {
        const dirty = input.value !== original;
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      });

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const { error } = await db
          .from('configuracion_sistema')
          .update({ valor: input.value, updated_at: new Date().toISOString() })
          .eq('clave', clave);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          showToast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        original = input.value;
        input.dataset.original = input.value;
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        showToast('Configuración guardada', 'success');
      });
    });
  }

  // =====================================
  // Modal sesión (CRUD calendario)
  // =====================================
  function abrirModalSesion(sesion) {
    const modal = document.getElementById('modal-sesion');
    const form = document.getElementById('form-sesion');
    const title = document.getElementById('modal-sesion-title');
    const btnEliminar = document.getElementById('btn-eliminar-sesion');

    if (sesion) {
      title.textContent = 'Editar sesión';
      form.dataset.sesionId = sesion.id;
      btnEliminar.classList.remove('hidden');
      document.getElementById('sesion-fecha').value = sesion.fecha || '';
      document.getElementById('sesion-hora-inicio').value = (sesion.hora_inicio || '').slice(0, 5);
      document.getElementById('sesion-hora-fin').value = (sesion.hora_fin || '').slice(0, 5);
      document.getElementById('sesion-tipo').value = sesion.tipo_sesion || 'presencial';
      document.getElementById('sesion-facilitador').value = sesion.facilitador || '';
      document.getElementById('sesion-ubicacion').value = sesion.ubicacion_o_link || '';
      document.getElementById('sesion-estado').value = sesion.estado || 'programada';
      document.getElementById('sesion-notas').value = sesion.notas || '';
    } else {
      title.textContent = 'Nueva sesión';
      delete form.dataset.sesionId;
      btnEliminar.classList.add('hidden');
      form.reset();
      document.getElementById('sesion-tipo').value = 'presencial';
      document.getElementById('sesion-estado').value = 'programada';
    }

    modal.classList.add('visible');
  }

  function cerrarModalSesion() {
    document.getElementById('modal-sesion').classList.remove('visible');
  }

  async function guardarSesion(e) {
    e.preventDefault();
    const form = document.getElementById('form-sesion');
    const sesionId = form.dataset.sesionId;
    const btn = document.getElementById('btn-guardar-sesion');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const payload = {
      fecha: document.getElementById('sesion-fecha').value,
      hora_inicio: document.getElementById('sesion-hora-inicio').value,
      hora_fin: document.getElementById('sesion-hora-fin').value || null,
      tipo_sesion: document.getElementById('sesion-tipo').value,
      facilitador: document.getElementById('sesion-facilitador').value || null,
      ubicacion_o_link: document.getElementById('sesion-ubicacion').value || null,
      estado: document.getElementById('sesion-estado').value,
      notas: document.getElementById('sesion-notas').value || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (sesionId) {
      ({ error } = await db.from('sesiones_calendario').update(payload).eq('id', sesionId));
    } else {
      ({ error } = await db.from('sesiones_calendario').insert(payload));
    }

    btn.disabled = false;
    btn.textContent = 'Guardar';

    if (error) {
      showToast('No se pudo guardar: ' + error.message, 'error');
      return;
    }

    showToast(sesionId ? 'Sesión actualizada' : 'Sesión creada', 'success');
    cerrarModalSesion();
    cargarCalendario();
  }

  async function eliminarSesion() {
    const form = document.getElementById('form-sesion');
    const sesionId = form.dataset.sesionId;
    if (!sesionId) return;
    if (!confirm('¿Eliminar esta sesión? No se puede deshacer.')) return;

    const { error } = await db.from('sesiones_calendario').delete().eq('id', sesionId);
    if (error) {
      showToast('No se pudo eliminar: ' + error.message, 'error');
      return;
    }
    showToast('Sesión eliminada', 'success');
    cerrarModalSesion();
    cargarCalendario();
  }

  // =====================================
  // Cron & Webhooks
  // =====================================
  async function cargarCron() {
    pintarUrlWebhook();
    await Promise.all([cargarCronJobs(), cargarCronLogs(), cargarWebhookLogs()]);
  }

  function pintarUrlWebhook() {
    const el = document.getElementById('webhook-url-display');
    if (!el) return;
    const base = window.REGENESIS_CONFIG.SUPABASE_URL.replace(/\/$/, '');
    el.textContent = `${base}/functions/v1/webhook-ghl`;
  }

  async function cargarCronJobs() {
    const tbody = document.getElementById('cron-job-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Cargando…</td></tr>`;

    const { data, error } = await db.rpc('admin_cron_jobs');
    if (error) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No se pudo leer cron.job: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">No hay jobs programados.</td></tr>`;
      return;
    }
    tbody.innerHTML = data.map(j => `
      <tr>
        <td><strong>${escapeHtml(j.jobname)}</strong></td>
        <td><code>${escapeHtml(j.schedule)}</code></td>
        <td><code style="font-size: 11px;">${escapeHtml(j.command.trim())}</code></td>
        <td>${j.active
          ? `<span class="badge badge-active">Activo</span>`
          : `<span class="badge">Inactivo</span>`}</td>
      </tr>
    `).join('');
  }

  async function cargarCronLogs() {
    const tbody = document.getElementById('cron-log-tbody');
    const counter = document.getElementById('cron-log-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Cargando…</td></tr>`;

    const { data, error } = await db
      .from('cron_log')
      .select('*')
      .order('ejecutado_at', { ascending: false })
      .limit(20);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (counter) counter.textContent = `${data.length} REGISTROS`;
    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Aún no hay ejecuciones. La primera será mañana 07:00 Eastern (Orlando), o ahora si pulsas "Ejecutar ahora".</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      const ok = !row.error;
      const resumen = row.error
        ? `<span class="err">${escapeHtml(row.error.slice(0, 80))}</span>`
        : resumirCronResultado(row.resultado);
      return `
        <tr>
          <td>${escapeHtml(formatearFechaCorta(row.ejecutado_at))} · ${tiempoRelativo(row.ejecutado_at)}</td>
          <td>${ok ? `<span class="badge badge-active">OK</span>` : `<span class="badge" style="background: var(--error); color: white;">ERROR</span>`}</td>
          <td>${row.duracion_ms ? `${row.duracion_ms} ms` : '—'}</td>
          <td>${resumen}</td>
        </tr>`;
    }).join('');
  }

  function resumirCronResultado(resultado) {
    if (!resultado || typeof resultado !== 'object') return '—';
    const partes = [];
    if (resultado.leads_activados_hoy !== undefined) partes.push(`activados: ${resultado.leads_activados_hoy}`);
    if (resultado.leads_revisados !== undefined) partes.push(`revisados: ${resultado.leads_revisados}`);
    if (resultado.leads_completados_hoy !== undefined) partes.push(`completados: ${resultado.leads_completados_hoy}`);
    if (resultado.notificaciones_encoladas !== undefined) partes.push(`notifs: ${resultado.notificaciones_encoladas}`);
    if (resultado.leads_avanzados !== undefined) partes.push(`avanzados: ${resultado.leads_avanzados}`);
    if (partes.length === 0) {
      return `<code style="font-size: 11px;">${escapeHtml(JSON.stringify(resultado).slice(0, 100))}</code>`;
    }
    return partes.join(' · ');
  }

  async function cargarWebhookLogs() {
    const tbody = document.getElementById('webhook-log-tbody');
    const counter = document.getElementById('webhook-log-count');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Cargando…</td></tr>`;

    const { data, error } = await db
      .from('webhook_log')
      .select('*, leads:lead_id(email, nombre)')
      .eq('fuente', 'ghl')
      .order('recibido_at', { ascending: false })
      .limit(20);

    if (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${escapeHtml(error.message)}</td></tr>`;
      return;
    }
    if (counter) counter.textContent = `${data.length} EVENTOS`;
    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Aún no llega nada de GHL. Configura el webhook en GHL apuntando a la URL de arriba.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      const ok = row.http_status >= 200 && row.http_status < 300;
      const lead = row.leads;
      const detalle = row.error
        ? `<span class="err" style="font-size: 12px;">${escapeHtml(row.error)}</span>`
        : `<span style="font-size: 12px;">${escapeHtml(row.resultado || '—')}</span>`;
      return `
        <tr>
          <td>${escapeHtml(formatearFechaCorta(row.recibido_at))}<br><span class="text-muted" style="font-size: 11px;">${tiempoRelativo(row.recibido_at)}</span></td>
          <td>${ok
            ? `<span class="badge badge-active">${row.http_status}</span>`
            : `<span class="badge" style="background: var(--error); color: white;">${row.http_status || '—'}</span>`}</td>
          <td>${detalle}</td>
          <td>${lead?.nombre ? escapeHtml(lead.nombre) : '<span class="text-muted">—</span>'}</td>
          <td><code style="font-size: 11px;">${lead?.email ? escapeHtml(lead.email) : '—'}</code></td>
        </tr>`;
    }).join('');
  }

  async function ejecutarCronManual() {
    const btn = document.getElementById('btn-cron-ejecutar');
    if (!btn) return;
    if (!confirm('Esto activa pagos pendientes que ya alcanzaron su fecha de inicio, marca completados al día 70 y encola las notificaciones del día. Es idempotente: si ya se ejecutó hoy, no duplica nada. ¿Continuar?')) return;

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Ejecutando…';
    try {
      const { error } = await db.rpc('ejecutar_cron_diario');
      if (error) throw error;
      showToast('Cron ejecutado. Revisa el log abajo.', 'success');
      await cargarCronLogs();
    } catch (err) {
      console.error('[Cron] error:', err);
      showToast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ============================================
  // Modal edición de cliente
  // ============================================
  let clienteEditandoId = null;

  function abrirModalCliente(cliente) {
    clienteEditandoId = cliente.id;
    document.getElementById('cli-nombre').value = cliente.nombre || '';
    document.getElementById('cli-telefono').value = cliente.telefono || '';
    document.getElementById('cli-cohorte').value = cliente.cohorte || '';
    document.getElementById('cli-modalidad').value = cliente.modalidad || 'presencial';
    document.getElementById('cli-cuotas').value = cliente.cuotas_elegidas != null ? String(cliente.cuotas_elegidas) : '';
    document.getElementById('cli-estado').value = cliente.estado || 'lead';
    document.getElementById('cli-fecha-inicio').value = cliente.fecha_inicio_programa || '';
    document.getElementById('cli-notas').value = cliente.notas_internas || '';

    document.getElementById('modal-cliente-title').textContent =
      `Editar · ${cliente.nombre || cliente.email}`;
    document.getElementById('modal-cliente').classList.add('visible');
    setTimeout(() => document.getElementById('cli-nombre')?.focus(), 50);
  }

  function cerrarModalCliente() {
    document.getElementById('modal-cliente').classList.remove('visible');
    clienteEditandoId = null;
  }

  async function guardarCliente(e) {
    e.preventDefault();
    if (!clienteEditandoId) return;

    const updates = {
      nombre: document.getElementById('cli-nombre').value.trim(),
      telefono: document.getElementById('cli-telefono').value.trim() || null,
      cohorte: document.getElementById('cli-cohorte').value.trim() || null,
      modalidad: document.getElementById('cli-modalidad').value,
      cuotas_elegidas: document.getElementById('cli-cuotas').value
        ? Number(document.getElementById('cli-cuotas').value)
        : null,
      estado: document.getElementById('cli-estado').value,
      fecha_inicio_programa: document.getElementById('cli-fecha-inicio').value || null,
      notas_internas: document.getElementById('cli-notas').value.trim() || null,
    };

    if (!updates.nombre) {
      showToast('El nombre es requerido.', 'error');
      return;
    }

    const btn = document.getElementById('btn-guardar-cliente');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      // Si la fecha de inicio cambió, recalcular fecha_fin_estimada
      if (updates.fecha_inicio_programa) {
        const fin = new Date(updates.fecha_inicio_programa + 'T00:00:00');
        fin.setDate(fin.getDate() + 70);
        updates.fecha_fin_estimada = fin.toISOString().slice(0, 10);
      }

      const { data, error } = await db.from('leads')
        .update(updates)
        .eq('id', clienteEditandoId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se actualizó el cliente. Verifica que tienes permisos.');
      }

      showToast('Cambios guardados', 'success');
      cerrarModalCliente();
      cerrarDrawer();
      await cargarClientes();
    } catch (err) {
      console.error('[Re-Génesis Admin] guardarCliente:', err);
      showToast('Error al guardar: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    }
  }

  // ============================================
  // Modal cambiar contraseña (admin)
  // ============================================
  function abrirModalPassword() {
    document.getElementById('pwd-nuevo').value = '';
    document.getElementById('pwd-confirma').value = '';
    document.getElementById('modal-password').classList.add('visible');
    setTimeout(() => document.getElementById('pwd-nuevo')?.focus(), 50);
  }

  function cerrarModalPassword() {
    document.getElementById('modal-password').classList.remove('visible');
  }

  async function handleCambiarPassword(e) {
    e.preventDefault();
    const nueva = document.getElementById('pwd-nuevo').value;
    const conf = document.getElementById('pwd-confirma').value;
    if (nueva.length < 8) {
      showToast('La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }
    if (nueva !== conf) {
      showToast('Las contraseñas no coinciden.', 'error');
      return;
    }
    const btn = document.getElementById('btn-guardar-password');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const { error } = await db.auth.updateUser({ password: nueva });
      if (error) throw error;
      showToast('Contraseña actualizada.', 'success');
      cerrarModalPassword();
    } catch (err) {
      console.error('[Re-Génesis Admin] cambiarPassword:', err);
      showToast('No se pudo cambiar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
