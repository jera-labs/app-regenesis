// ============================================
// Re-Génesis — Client App
// ============================================
// Lógica de la cara cliente: login, dashboard,
// envío de reflexiones y diario.
//
// Depende de: window.db, window.utils,
// window.iaService, window.REGENESIS_CONFIG.

(function () {
  'use strict';

  const { escapeHtml, showToast, tiempoRelativo, contarPalabras,
    MESES_LARGOS, MESES_UPPER, MESES_CORTOS, DIAS_LARGOS, DIAS_CORTOS } = window.utils;
  const { analizarReflexion, generarCierre } = window.iaService;

  let leadActual = null;
  let temaActual = null;
  let preguntaDelDia = null;
  let mensajeIdActual = null;
  let esAdminTambien = false;

  // Modo "ver como cliente" desde el panel admin: la app carga el dashboard
  // del lead indicado en ?view_as=<id> en modo lectura.
  const viewAsId = new URLSearchParams(window.location.search).get('view_as');
  let modoAdminViewing = false;

  // Estado de la reflexión del día actual.
  // Flujo: 'inicial' → 'respondido' (edición opcional) → 'cerrado'.
  let reflexionDelDia = null;
  let analisisDelDia = null;
  let estadoReflexion = 'inicial';

  // Cache del diario para soportar filtros sin re-fetch.
  let entradasDiarioCache = [];
  let temasMapDiarioCache = {};
  let filtroTemaActivo = null;

  // Cache de la tabla `temas` (los 10 temas con su nombre y orden).
  // Lo poblamos al primer login y lo usamos en abrirModalPerfil para mostrar
  // el nombre del tema actual del cliente. Sin esto, el código referenciaba
  // `temasCache` indefinido y lanzaba ReferenceError al abrir "Mi perfil".
  let temasCache = [];

  // ============================================
  // Auto-save de borradores
  // ============================================
  // Guardamos en localStorage el texto que el cliente está escribiendo, con
  // debounce 600ms. Se restaura al recargar SOLO si el textarea está vacío
  // (estado 'inicial'). Se limpia al hacer submit exitoso o al guardar la
  // respuesta del personaje exitosamente.
  function draftKey(tipo, mensajeIdRef) {
    if (!leadActual?.id || !mensajeIdRef) return null;
    return `rg_draft_${leadActual.id}_${tipo}_${mensajeIdRef}`;
  }

  function setupAutoSave(textareaId, tipo, getMensajeIdRef) {
    const ta = document.getElementById(textareaId);
    if (!ta || ta._autosaveWired) return;
    ta._autosaveWired = true;
    let timer = null;
    ta.addEventListener('input', () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          const key = draftKey(tipo, getMensajeIdRef());
          if (!key) return;
          const val = ta.value;
          if (val && val.trim().length > 5) {
            localStorage.setItem(key, val);
          } else {
            localStorage.removeItem(key);
          }
        } catch (_) {}
      }, 600);
    });
  }

  function restaurarBorrador(textareaId, tipo, mensajeIdRef) {
    const ta = document.getElementById(textareaId);
    if (!ta || ta.value || ta.readOnly) return;
    try {
      const key = draftKey(tipo, mensajeIdRef);
      if (!key) return;
      const guardado = localStorage.getItem(key);
      if (guardado && guardado.trim().length > 5) {
        ta.value = guardado;
        // Disparar el contador de palabras
        ta.dispatchEvent(new Event('input'));
        showToast('Recuperamos tu borrador de hoy.', 'success');
      }
    } catch (_) {}
  }

  function limpiarBorrador(tipo, mensajeIdRef) {
    try {
      const key = draftKey(tipo, mensajeIdRef);
      if (key) localStorage.removeItem(key);
    } catch (_) {}
  }

  // ============================================
  // Inicialización
  // ============================================
  async function init() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.querySelectorAll('[data-logout]').forEach(b =>
      b.addEventListener('click', handleLogout));
    document.getElementById('submit-reflexion').addEventListener('click', handleSubmitReflexion);
    document.getElementById('reflexion-textarea').addEventListener('input', actualizarContadorPalabras);
    document.querySelectorAll('[data-screen-link]').forEach(b => {
      b.addEventListener('click', e => {
        e.preventDefault();
        mostrarScreen(b.dataset.screenLink);
      });
    });
    document.getElementById('forgot-link')?.addEventListener('click', handleForgotPassword);
    document.getElementById('set-password-form')?.addEventListener('submit', handleSetPassword);

    inicializarMenuUsuario();

    // Si llegamos aquí desde un email de invite o recovery, el hash trae los
    // tokens. Supabase JS los procesa solo (detectSessionInUrl=true) y crea la
    // sesión, pero el `type=invite|recovery` queda en el hash hasta que lo
    // limpiemos. Aprovechamos ese fragmento para mostrar la pantalla de
    // "Establece tu contraseña" antes de continuar al dashboard.
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
      // tipo=invite (correo de invitación inicial) y tipo=recovery (vienen desde
      // bienvenida.html después de firmar acuerdos, o desde "olvidé mi contraseña").
      // Ambos llegan aquí porque el cliente todavía no ha definido password.
      ctx.textContent = tipo === 'invite'
        ? 'Tu cuenta está lista. Define una contraseña para entrar a tu plataforma.'
        : 'Define tu contraseña para entrar a tu plataforma. La vas a usar cada vez que abras Re-Génesis.';
    }
    mostrarScreen('set-password');
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

      // Limpiar el hash para que un refresh no te tire al mismo flow.
      history.replaceState(null, '', window.location.pathname);
      showToast('Contraseña establecida. Bienvenido.', 'success');

      // Continuar el flow normal — ya hay sesión activa.
      await detectarSesion();
    } catch (err) {
      console.error('[Re-Génesis] setPassword:', err);
      showToast('No pudimos guardar la contraseña: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Confirmar y entrar';
    }
  }

  function inicializarMenuUsuario() {
    document.querySelectorAll('[data-user-menu-trigger]').forEach(trigger => {
      trigger.addEventListener('click', e => {
        e.stopPropagation();
        const menu = trigger.querySelector('[data-user-menu]');
        const abierto = menu.classList.toggle('visible');
        menu.classList.toggle('hidden', !abierto);
        trigger.setAttribute('aria-expanded', String(abierto));

        // Cierra cualquier otro menú abierto
        document.querySelectorAll('[data-user-menu].visible').forEach(m => {
          if (m !== menu) {
            m.classList.remove('visible');
            m.classList.add('hidden');
            m.closest('[data-user-menu-trigger]')?.setAttribute('aria-expanded', 'false');
          }
        });
      });
    });

    // Click outside cierra
    document.addEventListener('click', () => {
      document.querySelectorAll('[data-user-menu].visible').forEach(m => {
        m.classList.remove('visible');
        m.classList.add('hidden');
        m.closest('[data-user-menu-trigger]')?.setAttribute('aria-expanded', 'false');
      });
    });

    // Acciones del menú
    document.querySelectorAll('[data-user-menu] [data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        // Cierro el menu antes de la acción
        btn.closest('[data-user-menu]')?.classList.remove('visible');
        btn.closest('[data-user-menu]')?.classList.add('hidden');
        if (action === 'logout') return handleLogout();
        if (action === 'exit-viewing') return salirDeLaVista();
        // 'mi-perfil' es el nuevo, 'cambiar-password' es el legacy (compat).
        if (action === 'mi-perfil' || action === 'cambiar-password') return abrirModalPerfil();
      });
    });

    // Modal Mi perfil (3 tabs: datos, programa, seguridad)
    document.getElementById('modal-perfil-close')?.addEventListener('click', cerrarModalPerfil);
    document.getElementById('modal-perfil-cancel')?.addEventListener('click', cerrarModalPerfil);
    document.getElementById('modal-password-cancel')?.addEventListener('click', cerrarModalPerfil);
    document.getElementById('form-perfil-datos')?.addEventListener('submit', handleGuardarPerfil);
    document.getElementById('form-password')?.addEventListener('submit', handleCambiarPassword);
    document.getElementById('modal-perfil')?.addEventListener('click', e => {
      if (e.target.id === 'modal-perfil') cerrarModalPerfil();
    });

    // Tabs del modal de perfil
    document.querySelectorAll('.perfil-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.perfilTab;
        document.querySelectorAll('.perfil-tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.perfil-panel').forEach(p => {
          p.classList.toggle('active', p.dataset.perfilPanel === target);
        });
      });
    });
  }

  function abrirModalPerfil() {
    console.log('[RG] abrirModalPerfil llamado', { modoAdminViewing, leadActualLoaded: !!leadActual, email: leadActual?.email });
    if (modoAdminViewing) {
      showToast('No puedes editar perfil en modo vista admin.', 'error');
      return;
    }
    if (!leadActual) {
      console.warn('[RG] abrirModalPerfil: leadActual es null, abriendo igual con fallback');
      // Fallback: abrimos el modal de todos modos para que el cliente pueda cambiar contraseña.
      // El tab de Datos personales queda vacío pero el de Seguridad funciona.
    }

    // Pre-llenar datos editables (con fallback vacío si no hay leadActual)
    document.getElementById('perfil-nombre').value   = leadActual?.nombre || '';
    document.getElementById('perfil-telefono').value = leadActual?.telefono || '';
    document.getElementById('perfil-pais').value     = leadActual?.pais || '';
    document.getElementById('perfil-ciudad').value   = leadActual?.ciudad || '';

    // Pre-llenar info read-only del programa
    document.getElementById('perfil-info-email').textContent =
      leadActual?.email || '—';
    const modalidadMap = { presencial: 'Presencial', virtual: 'Virtual', mixta: 'Mixta' };
    document.getElementById('perfil-info-modalidad').textContent =
      modalidadMap[leadActual?.modalidad] || (leadActual?.modalidad ? leadActual.modalidad : 'Por definir');
    document.getElementById('perfil-info-inicio').textContent =
      leadActual?.fecha_inicio_programa
        ? new Date(leadActual.fecha_inicio_programa + 'T00:00:00').toLocaleDateString('es-CO',
            { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : 'Por definir';

    const ordenActual = leadActual?.tema_actual_orden;
    if (ordenActual && temasCache && temasCache.length) {
      const tema = temasCache.find(t => t.orden === ordenActual);
      document.getElementById('perfil-info-tema').textContent = tema?.nombre || `Tema ${ordenActual}`;
    } else {
      document.getElementById('perfil-info-tema').textContent =
        leadActual?.estado === 'pagado_calentamiento' ? 'Sala de espera' : '—';
    }

    document.getElementById('perfil-info-semana').textContent =
      leadActual?.semana_actual && leadActual.semana_actual > 0
        ? `Semana ${leadActual.semana_actual} de 10`
        : 'Aún no inicia';

    // Reset password fields
    document.getElementById('pwd-nuevo').value = '';
    document.getElementById('pwd-confirma').value = '';

    // Activar tab default (datos personales)
    document.querySelectorAll('.perfil-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.perfilTab === 'datos'));
    document.querySelectorAll('.perfil-panel').forEach(p =>
      p.classList.toggle('active', p.dataset.perfilPanel === 'datos'));

    const modal = document.getElementById('modal-perfil');
    if (!modal) {
      console.error('[RG] modal-perfil NO existe en el DOM');
      showToast('Error: modal no encontrado en la página.', 'error');
      return;
    }
    modal.classList.add('visible');
    modal.classList.remove('hidden');
    console.log('[RG] modal-perfil abierto, clases:', modal.className);
    setTimeout(() => document.getElementById('perfil-nombre')?.focus(), 50);
  }

  function cerrarModalPerfil() {
    document.getElementById('modal-perfil').classList.remove('visible');
  }

  async function handleGuardarPerfil(e) {
    e.preventDefault();
    const nombre   = document.getElementById('perfil-nombre').value.trim();
    const telefono = document.getElementById('perfil-telefono').value.trim();
    const pais     = document.getElementById('perfil-pais').value.trim();
    const ciudad   = document.getElementById('perfil-ciudad').value.trim();

    if (!nombre) {
      showToast('El nombre no puede estar vacío.', 'error');
      return;
    }

    const btn = document.getElementById('btn-guardar-perfil');
    btn.disabled = true;
    const txtOriginal = btn.textContent;
    btn.textContent = 'Guardando…';

    try {
      const { data, error } = await db.rpc('actualizar_perfil_cliente', {
        p_nombre: nombre,
        p_telefono: telefono || null,
        p_pais: pais || null,
        p_ciudad: ciudad || null,
      });
      if (error) throw error;

      // Actualizar cache local del lead
      leadActual.nombre   = nombre;
      leadActual.telefono = telefono || null;
      leadActual.pais     = pais || null;
      leadActual.ciudad   = ciudad || null;

      // Refrescar UI que muestra el nombre (greeting, header)
      pintarUsuario();

      showToast('Perfil actualizado.', 'success');
      cerrarModalPerfil();
    } catch (err) {
      console.error('[Re-Génesis] guardarPerfil:', err);
      showToast('No pudimos guardar: ' + (err.message || 'error desconocido'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = txtOriginal;
    }
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
      cerrarModalPerfil();
    } catch (err) {
      console.error('[Re-Génesis] cambiarPassword:', err);
      showToast('No se pudo cambiar: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Guardar';
    }
  }

  function salirDeLaVista() {
    window.close();
    setTimeout(() => { window.location.href = 'admin.html'; }, 100);
  }

  async function detectarSesion() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      mostrarScreen('login');
      return;
    }
    // Si la sesión ya estaba cacheada y el flag must_change_password sigue activo,
    // también forzamos cambio antes de mostrar dashboard.
    if (session.user?.user_metadata?.must_change_password === true) {
      mostrarCambioObligatorio(session.user.email);
      return;
    }
    await rutearUsuario(session.user.email);
  }

  async function rutearUsuario(email) {
    const { data: admin, error: errAdmin } = await db
      .from('usuarios_admin')
      .select('id, nombre, activo')
      .eq('email', email)
      .eq('activo', true)
      .maybeSingle();

    esAdminTambien = !!admin;

    // Caso especial: admin viendo a otro cliente
    if (viewAsId) {
      if (!admin) {
        showToast('Solo administradores pueden usar la vista de cliente.', 'error');
        const url = new URL(window.location.href);
        url.searchParams.delete('view_as');
        window.location.replace(url.toString());
        return;
      }
      const { data: leadVisto, error } = await db
        .from('leads')
        .select('*')
        .eq('id', viewAsId)
        .maybeSingle();
      if (error || !leadVisto) {
        showToast('No encontramos al cliente solicitado.', 'error');
        window.location.href = 'admin.html';
        return;
      }
      leadActual = leadVisto;
      modoAdminViewing = true;
      await cargarDashboard();
      pintarBannerAdminViewing(admin.nombre);
      return;
    }

    const { data: lead, error: errLead } = await db
      .from('leads')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    // Error transitorio (red, 5xx) ≠ "no autorizado": NO deslogueamos a un
    // cliente legítimo por un fallo de query. Le pedimos reintentar.
    if (errLead || errAdmin) {
      console.error('[Re-Génesis] rutearUsuario error:', errLead || errAdmin);
      showToast('No pudimos cargar tu cuenta. Revisa tu conexión y recarga la página.', 'error');
      return;
    }

    if (lead) {
      leadActual = lead;

      // Gate de contratos: si el cliente todavía no ha firmado los 3 acuerdos
      // obligatorios (servicio + waiver + media), lo mandamos a /bienvenida.html
      // antes de que pueda usar la plataforma. El NDA es opcional, no bloquea.
      // Los admins (que también son leads, como Alex) saltan este gate.
      const faltaServicio = !lead.contrato_servicio_firmado_at;
      const faltaWaiver   = !lead.contrato_waiver_firmado_at;
      const faltaMedia    = !lead.contrato_media_firmado_at;
      const faltaAlguno = faltaServicio || faltaWaiver || faltaMedia;
      if (faltaAlguno && !esAdminTambien) {
        const gid = lead.ghl_contact_id || '';
        window.location.href = '/bienvenida.html'
          + (gid ? '?gid=' + encodeURIComponent(gid) : '?email=' + encodeURIComponent(email));
        return;
      }

      await cargarDashboard();
      pintarBannerAdmin();
      return;
    }

    if (admin) {
      // Admin sin lead — redirige al panel admin.
      window.location.href = 'admin.html';
      return;
    }

    showToast('Tu cuenta no está autorizada en la plataforma. Avisa a Frank.', 'error');
    await db.auth.signOut();
    mostrarScreen('login');
  }

  function pintarBannerAdminViewing(adminNombre) {
    const banner = document.getElementById('admin-viewing-banner');
    if (!banner) return;
    document.getElementById('admin-viewing-name').textContent = leadActual.nombre || leadActual.email;
    document.getElementById('admin-viewing-admin').textContent = adminNombre || 'admin';
    banner.classList.remove('hidden');
    document.body.classList.add('admin-viewing');

    // Bloquear escritura: textarea readonly, botón submit deshabilitado, sin atajos.
    const textarea = document.getElementById('reflexion-textarea');
    if (textarea) {
      textarea.readOnly = true;
      textarea.placeholder = 'Modo lectura — no puedes escribir como administrador.';
    }
    const submit = document.getElementById('submit-reflexion');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Modo lectura';
    }

    // Ocultamos el botón de logout: cerrar sesión aquí desconectaría la cuenta admin.
    document.querySelectorAll('[data-logout]').forEach(b => b.classList.add('hidden'));

    // En el menú de usuario, cambiamos "Cerrar sesión" por "Salir de la vista"
    document.querySelectorAll('[data-user-menu] [data-action="logout"]').forEach(b => b.classList.add('hidden'));
    document.querySelectorAll('[data-user-menu] [data-action="exit-viewing"]').forEach(b => b.classList.remove('hidden'));

    // Sublabel del avatar: en lugar del cohorte, mostramos "VISTA LECTURA"
    // para que sea evidente que la sesión no es del cliente.
    document.querySelectorAll('[data-user-cohort]').forEach(el => {
      el.textContent = 'VISTA LECTURA';
      el.classList.add('user-info-meta-viewing');
    });

    // Salir de la vista (botón del banner sticky)
    document.getElementById('admin-viewing-exit')?.addEventListener('click', e => {
      e.preventDefault();
      salirDeLaVista();
    });
  }

  function pintarBannerAdmin() {
    const banner = document.getElementById('admin-banner');
    if (!banner) return;
    banner.classList.toggle('hidden', !esAdminTambien);
  }

  // ============================================
  // Login / logout
  // ============================================
  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-submit');
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // Si el admin marcó must_change_password al setear la password manual,
      // forzamos el modal antes de entrar al dashboard.
      const debeCambiar = data?.user?.user_metadata?.must_change_password === true;
      if (debeCambiar) {
        mostrarCambioObligatorio(email);
        return; // NO continuar a rutearUsuario hasta que cambie la password
      }

      await rutearUsuario(email);
    } catch (err) {
      console.error('[Re-Génesis] Login error:', err);
      const msg = err?.message?.includes('Invalid')
        ? 'Email o contraseña incorrectos.'
        : 'No pudimos iniciar tu sesión. Intenta de nuevo.';
      showToast(msg, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  }

  // ============================================
  // Cambio obligatorio de contraseña (primer login)
  // ============================================
  function mostrarCambioObligatorio(email) {
    const modal = document.getElementById('modal-cambio-obligatorio');
    if (!modal) {
      console.warn('[Re-Génesis] modal-cambio-obligatorio no encontrado en DOM');
      return rutearUsuario(email); // fallback: deja pasar para no bloquear
    }
    document.getElementById('cambio-obligatorio-nuevo').value = '';
    document.getElementById('cambio-obligatorio-confirma').value = '';
    modal.classList.add('active');
    setTimeout(() => document.getElementById('cambio-obligatorio-nuevo')?.focus(), 100);

    // Listener idempotente: limpia previos y reattach
    const form = document.getElementById('form-cambio-obligatorio');
    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);
    newForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nueva = document.getElementById('cambio-obligatorio-nuevo').value;
      const conf  = document.getElementById('cambio-obligatorio-confirma').value;
      if (nueva.length < 8) { showToast('Mínimo 8 caracteres.', 'error'); return; }
      if (nueva !== conf)   { showToast('Las contraseñas no coinciden.', 'error'); return; }

      const btn = document.getElementById('btn-cambio-obligatorio');
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        // Cambiar password + limpiar el flag must_change_password en metadata
        const { error } = await db.auth.updateUser({
          password: nueva,
          data: { must_change_password: false },
        });
        if (error) throw error;

        modal.classList.remove('active');
        showToast('Contraseña creada. Bienvenido.', 'success');
        await rutearUsuario(email);
      } catch (err) {
        console.error('[Re-Génesis] cambio obligatorio:', err);
        showToast('No se pudo guardar: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Crear mi contraseña';
      }
    });
  }

  async function handleLogout() {
    await db.auth.signOut();
    leadActual = null;
    temaActual = null;
    preguntaDelDia = null;
    esAdminTambien = false;
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('login-admin-pending')?.classList.add('hidden');
    document.getElementById('login-email').value = '';
    document.getElementById('login-password').value = '';
    mostrarScreen('login');
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    if (!email) {
      showToast('Escribe tu email primero.', 'error');
      return;
    }
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) {
      showToast('No pudimos enviar el correo: ' + error.message, 'error');
      return;
    }
    showToast('Si el email existe, te enviaremos un enlace para restablecer tu contraseña.', 'success');
  }

  // ============================================
  // Pantallas
  // ============================================
  function mostrarScreen(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(`screen-${name}`);
    if (el) el.classList.add('active');
    document.querySelectorAll('[data-screen-link]').forEach(b => {
      b.classList.toggle('active', b.dataset.screenLink === name);
    });
    window.scrollTo(0, 0);
    if (name === 'diario' && leadActual) cargarDiario();
    if (name === 'calendario' && leadActual) cargarCalendarioCliente();
    if (name === 'progreso' && leadActual) cargarProgreso();
    if (name === 'libro' && leadActual) cargarMiLibro();
  }

  // ============================================
  // Dashboard
  // ============================================
  // Recalcula día / semana / tema en base a la fecha de inicio del cliente.
  // Sin esto, los valores de la BD se quedan "cacheados" hasta que el cron los
  // actualice; recalcular en frontend garantiza que el cliente siempre vea
  // el día correcto al abrir la app.
  // ============================================
  // PERSONAJE FICTICIO — gate de creación + tarjeta visible
  // ============================================

  function pintarCreacionPersonaje() {
    // Mostrar el bloque de creación y ocultar lo demás del dashboard que no aplica.
    // El panel "Tu activación" ya vive arriba del dashboard (no dentro del main-grid),
    // así que sigue visible aunque ocultemos el grid completo.
    const creacion = document.getElementById('personaje-creacion');
    if (!creacion) return;
    creacion.classList.remove('hidden');

    document.getElementById('personaje-card')?.classList.add('hidden');
    document.querySelector('#screen-dashboard .greeting-section')?.classList.add('hidden');
    document.querySelector('#screen-dashboard .main-grid')?.classList.add('hidden');
    document.querySelector('#screen-dashboard .testimonio-banner')?.classList.add('hidden');

    const btn = document.getElementById('btn-crear-personaje');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleCrearPersonaje);
    }
  }

  function pintarTarjetaPersonaje() {
    const card = document.getElementById('personaje-card');
    if (!card || !leadActual.personaje_nombre) return;
    card.classList.remove('hidden');
    document.getElementById('personaje-nombre-display').textContent =
      leadActual.personaje_nombre;

    // Tomar primera línea no vacía de la descripción para el meta visible
    const primeraLinea = (leadActual.personaje_descripcion || '')
      .split('\n').map(s => s.trim()).filter(Boolean)[0] || '';
    document.getElementById('personaje-meta-display').textContent =
      primeraLinea.length > 110 ? primeraLinea.slice(0, 107) + '…' : primeraLinea;

    // Asegurar que el resto del dashboard sea visible
    document.getElementById('personaje-creacion')?.classList.add('hidden');
    document.querySelector('#screen-dashboard .greeting-section')?.classList.remove('hidden');
    document.querySelector('#screen-dashboard .main-grid')?.classList.remove('hidden');

    const btnEdit = document.getElementById('btn-editar-personaje');
    if (btnEdit && !btnEdit._wired) {
      btnEdit._wired = true;
      btnEdit.addEventListener('click', abrirEdicionPersonaje);
    }
  }

  async function handleCrearPersonaje() {
    const nombreInput = document.getElementById('personaje-nombre-input');
    const descInput = document.getElementById('personaje-desc-input');
    const btn = document.getElementById('btn-crear-personaje');

    const nombre = nombreInput.value.trim();
    const descripcion = descInput.value.trim();

    if (!nombre) {
      showToast('Dale un nombre a tu personaje', 'error');
      nombreInput.focus();
      return;
    }
    if (descripcion.length < 60) {
      showToast('La descripción es muy corta. Cuéntanos más de quién es tu personaje.', 'error');
      descInput.focus();
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Creando…';

    try {
      // .select() para detectar RLS que bloquea silenciosamente sin error.
      const { data, error } = await db.from('leads').update({
        personaje_nombre: nombre,
        personaje_descripcion: descripcion,
        personaje_creado_at: new Date().toISOString(),
      }).eq('id', leadActual.id).select('id, personaje_nombre');

      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se guardó la fila. Si vuelve a pasar, avísale a Frank.');
      }

      // Actualizar el objeto local y re-renderizar dashboard
      leadActual.personaje_nombre = nombre;
      leadActual.personaje_descripcion = descripcion;
      leadActual.personaje_creado_at = new Date().toISOString();

      showToast(`${nombre} acaba de nacer. Tu camino empieza.`, 'success');
      try {
        await cargarDashboard();
      } catch (eDashboard) {
        console.error('cargarDashboard tras crear personaje:', eDashboard);
        // Si el dashboard falla por algún motivo, reactivamos el botón para que
        // el cliente pueda intentar refrescar o avisar.
        btn.disabled = false;
        btn.textContent = original;
        showToast('Personaje guardado, pero falló cargar el dashboard. Refresca la página.', 'error');
      }
    } catch (e) {
      console.error('handleCrearPersonaje error:', e);
      showToast('No se pudo crear el personaje: ' + (e?.message || 'error desconocido'), 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  function abrirEdicionPersonaje() {
    const overlay = document.getElementById('personaje-edit-overlay');
    if (!overlay) return;
    const inputNombre = document.getElementById('personaje-edit-nombre');
    const inputDesc   = document.getElementById('personaje-edit-desc');

    inputNombre.value = leadActual.personaje_nombre || '';
    inputDesc.value   = leadActual.personaje_descripcion || '';

    overlay.classList.add('visible');
    setTimeout(() => inputNombre.focus(), 50);

    if (!overlay._wired) {
      overlay._wired = true;
      document.getElementById('personaje-edit-close')?.addEventListener('click', cerrarEdicionPersonaje);
      document.getElementById('personaje-edit-cancel')?.addEventListener('click', cerrarEdicionPersonaje);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cerrarEdicionPersonaje();
      });
      document.getElementById('personaje-edit-save')?.addEventListener('click', guardarEdicionPersonaje);
    }
  }

  function cerrarEdicionPersonaje() {
    document.getElementById('personaje-edit-overlay')?.classList.remove('visible');
  }

  async function guardarEdicionPersonaje() {
    const nombre = document.getElementById('personaje-edit-nombre').value.trim();
    const descripcion = document.getElementById('personaje-edit-desc').value.trim();
    const btn = document.getElementById('personaje-edit-save');

    if (!nombre) {
      showToast('El nombre no puede estar vacío', 'error');
      document.getElementById('personaje-edit-nombre').focus();
      return;
    }
    if (descripcion.length < 60) {
      showToast('La descripción es muy corta. Tu personaje merece más detalle.', 'error');
      document.getElementById('personaje-edit-desc').focus();
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Guardando…';
    try {
      const { data, error } = await db.from('leads').update({
        personaje_nombre: nombre,
        personaje_descripcion: descripcion,
      }).eq('id', leadActual.id).select('id, personaje_nombre');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se guardó la fila. Si vuelve a pasar, avísale a Frank.');
      }

      leadActual.personaje_nombre = nombre;
      leadActual.personaje_descripcion = descripcion;
      pintarTarjetaPersonaje();
      cerrarEdicionPersonaje();
      showToast(`${nombre} actualizado`, 'success');
    } catch (e) {
      console.error('guardarEdicionPersonaje error:', e);
      showToast('No se pudo guardar. Intenta de nuevo.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ============================================
  // RESPUESTA DEL PERSONAJE — bloque después de Q2
  // ============================================
  let _journalingRowIdActivo = null;

  // Estado de la respuesta del personaje:
  //  'sin_responder' → textarea vacía, btn "Guardar respuesta del personaje"
  //  'respondido'    → guardada por primera vez, btn "Editar respuesta (última vez)"
  //  'editando'      → cliente reabrió, btn "Guardar cambios"
  //  'cerrado'       → ya usó su edición, textarea readonly, sin botón
  let _estadoRespuestaPersonaje = 'sin_responder';

  function mostrarBloqueRespuestaPersonaje(journalingRowId, respuestaPrevia, estado, respPersAt) {
    _journalingRowIdActivo = journalingRowId;
    _estadoRespuestaPersonaje = estado || 'sin_responder';

    const block = document.getElementById('personaje-respuesta-block');
    if (!block) return;
    block.classList.remove('hidden');

    const nombreEl = document.getElementById('personaje-respuesta-nombre');
    if (nombreEl) nombreEl.textContent = leadActual.personaje_nombre || 'tu personaje';

    // Título genérico — la pregunta concreta vive en la card "Pregunta para tu personaje".
    const tituloEl = document.getElementById('personaje-respuesta-title');
    if (tituloEl) tituloEl.textContent = '¿Qué decide tu personaje hoy?';

    const ta = document.getElementById('personaje-respuesta-textarea');
    if (ta && !ta._wired) {
      ta._wired = true;
      ta.addEventListener('input', () => {
        const palabras = ta.value.trim().split(/\s+/).filter(Boolean).length;
        document.getElementById('personaje-respuesta-count').textContent =
          `${palabras} PALABRA${palabras === 1 ? '' : 'S'}`;
      });
    }

    const btn = document.getElementById('btn-guardar-respuesta-personaje');
    if (btn && !btn._wired) {
      btn._wired = true;
      btn.addEventListener('click', handleGuardarRespuestaPersonaje);
    }

    // Pintar valor y contador iniciales
    if (ta) {
      ta.value = respuestaPrevia || '';
      const palabras = (respuestaPrevia || '').trim().split(/\s+/).filter(Boolean).length;
      document.getElementById('personaje-respuesta-count').textContent =
        `${palabras} PALABRA${palabras === 1 ? '' : 'S'}`;
    }

    aplicarEstadoPersonaje(_estadoRespuestaPersonaje);
  }

  function aplicarEstadoPersonaje(estado) {
    _estadoRespuestaPersonaje = estado;
    const ta = document.getElementById('personaje-respuesta-textarea');
    const btn = document.getElementById('btn-guardar-respuesta-personaje');
    const block = document.getElementById('personaje-respuesta-block');
    if (!ta || !btn || !block) return;

    block.classList.remove('is-guardada');

    if (estado === 'sin_responder') {
      ta.readOnly = false;
      ta.disabled = false;
      btn.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Guardar respuesta del personaje';
    } else if (estado === 'respondido') {
      ta.readOnly = true;
      ta.disabled = false;
      block.classList.add('is-guardada');
      btn.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Editar respuesta (última vez)';
    } else if (estado === 'editando') {
      ta.readOnly = false;
      ta.disabled = false;
      ta.focus();
      btn.style.display = '';
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
    } else if (estado === 'cerrado') {
      ta.readOnly = true;
      ta.disabled = false;
      block.classList.add('is-guardada');
      btn.style.display = 'none';
    }
  }

  async function handleGuardarRespuestaPersonaje() {
    // Si el botón está en estado "Editar (última vez)" → reabrimos para edición,
    // no se guarda nada aún. El siguiente click sí guarda y cierra.
    if (_estadoRespuestaPersonaje === 'respondido') {
      aplicarEstadoPersonaje('editando');
      return;
    }

    const ta = document.getElementById('personaje-respuesta-textarea');
    const btn = document.getElementById('btn-guardar-respuesta-personaje');
    const respuesta = ta.value.trim();

    if (!_journalingRowIdActivo) {
      showToast('Primero responde la Pregunta 1 del día', 'error');
      return;
    }
    if (respuesta.length < 20) {
      showToast('La respuesta es muy corta. Cuéntame qué decide tu personaje.', 'error');
      ta.focus();
      return;
    }

    const yaEditado = _estadoRespuestaPersonaje === 'editando';
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Guardando…';

    try {
      const updates = { respuesta_personaje: respuesta };
      if (!yaEditado) {
        updates.respuesta_personaje_at = new Date().toISOString();
      } else {
        updates.respuesta_personaje_editada = true;
      }

      // Usamos .select() para detectar si RLS bloquea silenciosamente.
      const { data, error } = await db.from('journaling_respuestas')
        .update(updates)
        .eq('id', _journalingRowIdActivo)
        .select('id, respuesta_personaje, respuesta_personaje_editada');
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error('No se actualizó ninguna fila. Posible bloqueo de permisos.');
      }

      showToast(
        yaEditado
          ? `Respuesta cerrada. Quedó en el diario de ${leadActual.personaje_nombre || 'tu personaje'}.`
          : `Respuesta de ${leadActual.personaje_nombre || 'tu personaje'} guardada`,
        'success'
      );

      aplicarEstadoPersonaje(yaEditado ? 'cerrado' : 'respondido');
      limpiarBorrador('q2', _journalingRowIdActivo);
      await pintarActivacion();

      // Disparar Cierre del día (tercer mensaje IA). Si el cliente edita
      // su respuesta, regeneramos el cierre con la versión nueva.
      generarYMostrarCierre(respuesta).catch(err => {
        console.error('cierre error:', err);
      });
    } catch (e) {
      console.error('respuesta_personaje error:', e);
      showToast('No se pudo guardar. Intenta de nuevo.', 'error');
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ============================================
  // Cierre del día (3er mensaje IA)
  // Llama a la Edge Function en modo 'cierre' con la Q2 + respuesta del
  // personaje, guarda el resultado en journaling_respuestas.cierre_ia
  // y lo renderiza en la tarjeta debajo del bloque de respuesta.
  // ============================================
  async function generarYMostrarCierre(respuestaPersonaje) {
    if (!_journalingRowIdActivo || !leadActual?.personaje_nombre) return;

    const block = document.getElementById('cierre-ia-block');
    const loadingEl = document.getElementById('cierre-ia-loading');
    const contentEl = document.getElementById('cierre-ia-content');
    if (!block || !contentEl) return;

    block.classList.remove('hidden');
    loadingEl?.classList.remove('hidden');
    contentEl.textContent = '';

    try {
      // Necesitamos la Q2 que la IA generó para esta reflexión. Vive en
      // journaling_respuestas.pregunta_personaje (canónico).
      const { data: row, error } = await db
        .from('journaling_respuestas')
        .select('pregunta_personaje')
        .eq('id', _journalingRowIdActivo)
        .maybeSingle();
      if (error) throw error;
      const preguntaQ2 = row?.pregunta_personaje;
      if (!preguntaQ2) {
        loadingEl?.classList.add('hidden');
        contentEl.textContent = 'No encontramos la pregunta para generar tu cierre. Si pasa de nuevo, avísale a Frank.';
        return;
      }

      const personajePayload = {
        nombre: leadActual.personaje_nombre,
        descripcion: leadActual.personaje_descripcion || '',
      };

      const { cierre } = await generarCierre(
        temaActual?.nombre || '',
        personajePayload,
        preguntaQ2,
        respuestaPersonaje
      );

      // Persistir en BD para que aparezca al refrescar y para incluirlo en el libro
      const { error: errCierre } = await db.from('journaling_respuestas')
        .update({ cierre_ia: cierre, cierre_ia_at: new Date().toISOString() })
        .eq('id', _journalingRowIdActivo);
      if (errCierre) {
        // El cliente lo ve en pantalla igual, pero sin persistir no entra al
        // libro. Lo registramos para no perderlo en silencio.
        console.error('[Re-Génesis] No se pudo persistir el cierre IA:', errCierre);
      }

      loadingEl?.classList.add('hidden');
      contentEl.textContent = cierre;
      block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      console.error('generarYMostrarCierre error:', err);
      loadingEl?.classList.add('hidden');
      contentEl.textContent = 'Algo falló generando el cierre. Intenta editar tu respuesta para reintentarlo.';
    }
  }

  // Sincroniza el tema y día actual desde Supabase (calendario_temas) en lugar
  // de calcularlo con módulo (que fallaba en los ciclos comprimidos de Frank).
  // Si falla la RPC (red, RLS), conserva los valores de la BD sin pisarlos.
  async function recalcularProgreso() {
    if (!leadActual?.id) return;
    try {
      const { data, error } = await db.rpc('cliente_dia_actual', { p_lead_id: leadActual.id });
      if (error || !data || data.error) return;
      if (Number.isFinite(data.tema_orden))    leadActual.tema_actual_orden = data.tema_orden;
      if (Number.isFinite(data.dia_en_tema))   leadActual.dia_actual_en_tema = data.dia_en_tema;
      if (Number.isFinite(data.semana_actual)) leadActual.semana_actual = data.semana_actual;
    } catch (e) {
      console.warn('[RG] cliente_dia_actual falló, usando valores de BD', e);
    }
  }

  async function cargarDashboard() {
    // Si el cliente completó los 70 días o su estado es 'completado',
    // mostramos pantalla de cierre en lugar del dashboard normal.
    if (estaCompletado()) {
      await pintarDashboardCierre();
      mostrarScreen('dashboard');
      return;
    }
    document.getElementById('dashboard-container')?.classList.remove('modo-cierre');

    // Si el cliente está en calentamiento (pagó pero el programa aún no empieza),
    // mostramos la vista especial de sala de espera con el contenido del día
    // de la semana correspondiente (mensajes_calentamiento.dia_calentamiento = ISODOW).
    if (estaEnCalentamiento()) {
      await pintarDashboardCalentamiento();
      mostrarScreen('dashboard');
      return;
    }

    await recalcularProgreso();
    pintarUsuario();
    pintarStatusBar();

    // Cargamos los 10 temas una sola vez por sesión.
    // Lo usa "Mi perfil" para mostrar el nombre del tema actual del cliente.
    if (!temasCache.length) {
      const { data: tt } = await db.from('temas').select('id, nombre, orden').order('orden');
      if (tt) temasCache = tt;
    }

    // GATE DEL PERSONAJE: si el cliente todavía no creó su personaje ficticio,
    // mostramos el formulario de creación en lugar de la reflexión del día.
    // No avanza a las preguntas del tema hasta crear el personaje. Esta es la
    // metodología de Frank — el journaling se hace desde la voz del "otro yo".
    if (!leadActual.personaje_creado_at) {
      pintarCreacionPersonaje();
      await pintarActivacion();
      await pintarAlertaProcrastinacion();
      mostrarScreen('dashboard');
      return;
    }
    pintarTarjetaPersonaje();

    const ordenTema = leadActual.tema_actual_orden || 1;
    const { data: tema, error: errTema } = await db
      .from('temas')
      .select('*')
      .eq('orden', ordenTema)
      .maybeSingle();
    temaActual = tema;
    if (errTema || !tema) {
      // Sin tema no podemos pintar el dashboard; antes esto era un TypeError
      // silencioso (tema.id) que dejaba la pantalla colgada en blanco.
      console.error('[Re-Génesis] No se pudo cargar el tema', ordenTema, errTema);
      showToast('No pudimos cargar tu tema de hoy. Recarga la página o avisa a Frank.', 'error');
      return;
    }

    const dia = leadActual.dia_actual_en_tema || 1;
    const { data: mensaje } = await db
      .from('mensajes')
      .select('*')
      .eq('tema_id', tema.id)
      .eq('tipo', 'journaling')
      .eq('dia_relativo', dia)
      .maybeSingle();

    if (mensaje) {
      preguntaDelDia = mensaje.contenido;
      mensajeIdActual = mensaje.id;
      document.getElementById('pregunta-dia').textContent = mensaje.contenido;
    } else {
      preguntaDelDia = null;
      mensajeIdActual = null;
      document.getElementById('pregunta-dia').textContent =
        'Aún no hay una pregunta configurada para este día.';
    }

    document.getElementById('tema-actual-nombre').textContent = (tema.nombre || '').toUpperCase();
    document.getElementById('tema-actual-numero').textContent = String(tema.orden).padStart(2, '0');
    document.getElementById('greeting-tema').textContent = tema.nombre;
    document.getElementById('greeting-semana').textContent = String(leadActual.semana_actual || 1);
    document.getElementById('greeting-dia').textContent = `${dia} de 7`;

    await pintarProgresoTemas();
    await pintarProximaSesion();
    await pintarStats();
    await pintarBannerTestimonio();
    await cargarReflexionDelDia();
    await pintarActivacion();
    await pintarAlertaProcrastinacion();

    mostrarScreen('dashboard');
  }

  // ============================================
  // Alertas de procrastinación
  // Evalúa triggers en orden de prioridad y muestra el primero que aplique.
  // El cliente puede cerrar con X; el dismiss persiste solo por hoy en
  // localStorage (al día siguiente vuelve a aparecer si sigue aplicando).
  // ============================================
  async function pintarAlertaProcrastinacion() {
    const banner = document.getElementById('alerta-procrastinacion');
    if (!banner || !leadActual) return;

    // Si ya cerró la alerta hoy, no mostramos nada
    const fechaHoy = new Date().toISOString().slice(0, 10);
    const dismissKey = `rg_alerta_proc_dismissed_${fechaHoy}`;
    if (localStorage.getItem(dismissKey)) {
      banner.classList.add('hidden');
      return;
    }

    let alerta = null;

    // Trigger 1 (alta prioridad): sin personaje + programa ya arrancó hace ≥1 día
    if (!leadActual.personaje_creado_at && leadActual.fecha_inicio_programa) {
      const inicio = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
      const dias = Math.floor((Date.now() - inicio.getTime()) / 86400000);
      if (dias >= 1) {
        alerta = {
          title: 'Tu personaje todavía no nace',
          text: `El programa arrancó hace ${dias} ${dias === 1 ? 'día' : 'días'}. Sin personaje no podemos empezar el trabajo. Crea el tuyo ahora, te toma 5 minutos.`,
        };
      }
    }

    // Trigger 2 (media prioridad): pregunta del día pendiente + son ≥6 PM ET
    // Solo aplica si ya tiene personaje
    if (!alerta && leadActual.personaje_creado_at) {
      // La tabla no tiene columna DATE: comparamos la fecha (en NY) de la
      // última respuesta real contra "hoy" en NY. Si la query falla, NO
      // mostramos la alerta (antes un error la disparaba en falso).
      const fmtNY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
      const hoyNY = fmtNY.format(new Date());
      const { data: ultResp, error: errUlt } = await db
        .from('journaling_respuestas')
        .select('respuesta_cliente, respuesta_recibida_at')
        .eq('lead_id', leadActual.id)
        .eq('es_calentamiento', false)
        .order('respuesta_recibida_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const fechaUltNY = ultResp?.respuesta_recibida_at
        ? fmtNY.format(new Date(ultResp.respuesta_recibida_at))
        : null;
      const sinResponder = !errUlt && fechaUltNY !== hoyNY;
      if (sinResponder) {
        // Hora actual en America/New_York en formato 24h.
        // Usamos Intl.DateTimeFormat para forzar h23 (00-23) y evitar el parseo
        // frágil de "06 PM" vs "18" que daba el toLocaleString.
        const horaStr = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(new Date());
        const horaET = parseInt(horaStr, 10);
        if (Number.isFinite(horaET) && horaET >= 18) {
          alerta = {
            title: 'Hoy aún no respondiste tu pregunta',
            text: 'Te queda poco para cerrar el día. 5 minutos antes de dormir es todo lo que necesitas.',
          };
        }
      }
    }

    if (!alerta) {
      banner.classList.add('hidden');
      return;
    }

    document.getElementById('alerta-proc-title').textContent = alerta.title;
    document.getElementById('alerta-proc-text').textContent  = alerta.text;
    banner.classList.remove('hidden');

    const btnDismiss = document.getElementById('alerta-proc-dismiss');
    if (btnDismiss && !btnDismiss._wired) {
      btnDismiss._wired = true;
      btnDismiss.addEventListener('click', () => {
        const fecha = new Date().toISOString().slice(0, 10);
        localStorage.setItem(`rg_alerta_proc_dismissed_${fecha}`, '1');
        document.getElementById('alerta-procrastinacion')?.classList.add('hidden');
      });
    }
  }

  // ============================================
  // Panel de activación (checklist auto-tick)
  // Lógica: chequeos estáticos (pago, contratos, personaje) + diarios
  // (pregunta del día, pregunta personaje). Oculta el panel cuando todo
  // está completo. Reabre cuando algo está pendiente.
  // ============================================
  async function pintarActivacion() { /* removido: ya no se muestra bloque Tu activación */ }

  // ============================================
  // Banner de invitación a testimonio
  // ============================================
  // Política: aparece cuando el cliente completó al menos el tema 1.
  // Si completó tema 5 y no tiene testimonio momento='mitad_programa' →
  //   banner insistente cada 7 días.
  // Si completó tema 10 y no tiene testimonio momento='final_programa' →
  //   banner insistente cada 7 días.
  // En cualquier otro caso (espontáneo): aparece, se puede postergar
  //   hasta 3 veces con cooldown de 7 días entre cada postergación.
  async function pintarBannerTestimonio() {
    const banner = document.getElementById('testimonio-banner');
    if (!banner) return;

    const ordenActual = leadActual.tema_actual_orden || 0;
    const completados = leadActual.temas_completados || [];

    if (ordenActual < 1 && !completados.length) {
      banner.classList.add('hidden');
      return;
    }

    const { data: tests } = await db.from('testimonios')
      .select('id, momento, estado')
      .eq('lead_id', leadActual.id);

    const tieneMitad = (tests || []).some(t => t.momento === 'mitad_programa');
    const tieneFinal = (tests || []).some(t => t.momento === 'final_programa');

    // Los milestones de testimonio son DESPUÉS de orden=5 (Abundancia) y de
    // orden=10 (Heridas de la Infancia). Buscamos los IDs reales para no asumir
    // que id === orden (no es el caso en la BD: id≠orden). Y SOLO disparamos
    // el milestone si el cliente realmente completó ese tema (en temas_completados);
    // nunca por "ordenActual > N" porque con el calendario fijo de Frank los
    // clientes pueden saltar ordenes y nunca pasar por orden 5 o 10.
    const { data: temasMilestone } = await db.from('temas')
      .select('id, orden')
      .in('orden', [5, 10]);
    const idMitad = (temasMilestone || []).find(t => t.orden === 5)?.id;
    const idFinal = (temasMilestone || []).find(t => t.orden === 10)?.id;
    const completoMitad = idMitad != null && completados.includes(idMitad);
    const completoFinal = idFinal != null && completados.includes(idFinal);

    let titulo = null;
    let eyebrow = 'ESPACIO DE ACOMPAÑAMIENTO';
    let modoMilestone = false;

    // Espontáneo: solo aparece DESPUÉS del 50% del programa (día 35 / 70).
    // Antes de eso el cliente está construyendo experiencia — pedir testimonio
    // muy temprano produce contenido vacío. Los milestones (orden=5 y orden=10)
    // sí ignoran este umbral porque son hitos reales del proceso.
    const semana = leadActual.semana_actual || 0;
    const dia    = leadActual.dia_actual_en_tema || 0;
    const diaGlobal = (semana - 1) * 7 + dia;
    const pasoMitadCamino = diaGlobal > 35;

    if (completoFinal && !tieneFinal) {
      titulo = 'Completaste el programa. Programa tu reunión de cierre con Frank.';
      eyebrow = 'TU REUNIÓN DE CIERRE';
      modoMilestone = true;
    } else if (completoMitad && !tieneMitad) {
      titulo = 'Llegaste a la mitad. Programa tu reunión de resultados con Frank.';
      eyebrow = 'MITAD DEL CAMINO';
      modoMilestone = true;
    } else if ((tests || []).length === 0 && pasoMitadCamino) {
      titulo = 'Programa tu reunión de resultados con Frank cuando lo sientas.';
    } else {
      banner.classList.add('hidden');
      return;
    }

    if (!modoMilestone) {
      const postergados = leadActual.testimonio_recordatorios_postergados || 0;
      const ultimo = leadActual.testimonio_ultimo_postergado_at
        ? new Date(leadActual.testimonio_ultimo_postergado_at)
        : null;

      if (postergados >= 3) {
        banner.classList.add('hidden');
        return;
      }
      if (ultimo) {
        const diasDesde = (Date.now() - ultimo.getTime()) / 86400000;
        const cooldown = postergados >= 2 ? 14 : 7;
        if (diasDesde < cooldown) {
          banner.classList.add('hidden');
          return;
        }
      }
    }

    document.getElementById('testimonio-banner-eyebrow').textContent = eyebrow;
    document.getElementById('testimonio-banner-title').textContent = titulo;
    banner.classList.remove('hidden');

    const skipBtn = document.getElementById('testimonio-banner-skip');
    if (skipBtn && !skipBtn._wired) {
      skipBtn._wired = true;
      skipBtn.addEventListener('click', postergarTestimonio);
    }
  }

  async function postergarTestimonio() {
    const banner = document.getElementById('testimonio-banner');
    banner?.classList.add('hidden');
    try {
      const nuevaCuenta = (leadActual.testimonio_recordatorios_postergados || 0) + 1;
      const { error } = await db.from('leads').update({
        testimonio_recordatorios_postergados: nuevaCuenta,
        testimonio_ultimo_postergado_at: new Date().toISOString(),
      }).eq('id', leadActual.id);
      if (error) throw error;
      leadActual.testimonio_recordatorios_postergados = nuevaCuenta;
      leadActual.testimonio_ultimo_postergado_at = new Date().toISOString();
    } catch (err) {
      console.error('No se pudo postergar:', err);
    }
  }

  function pintarUsuario() {
    const nombre = leadActual.nombre || leadActual.email.split('@')[0];
    document.querySelectorAll('[data-user-name]').forEach(el => el.textContent = nombre);
    document.querySelectorAll('[data-user-cohort]').forEach(el =>
      el.textContent = (leadActual.cohorte || '').toUpperCase());
    document.querySelectorAll('[data-user-initial]').forEach(el =>
      el.textContent = nombre.charAt(0).toUpperCase());
    document.getElementById('greeting-nombre').textContent = nombre;
  }

  function pintarStatusBar() {
    const hoy = new Date();
    document.getElementById('status-fecha').textContent =
      `${DIAS_CORTOS[hoy.getDay()]} · ${hoy.getDate()} ${MESES_CORTOS[hoy.getMonth()]} · ${hoy.getFullYear()}`;

    // Día global del programa = (semana - 1) * 7 + día_en_tema.
    // Usamos `semana_actual` en lugar de `tema_actual_orden` porque con el
    // calendario fijo de Frank el tema asignado a la semana N no siempre es
    // el N-ésimo del orden canónico (los clientes entran en cualquier tema).
    const semana = leadActual.semana_actual || 1;
    const dia = leadActual.dia_actual_en_tema || 1;
    const diaGlobal = (semana - 1) * 7 + dia;
    document.getElementById('status-progreso').textContent = `DÍA ${diaGlobal} / 70`;
  }

  async function pintarProgresoTemas() {
    const { data: temas } = await db.from('temas').select('*').order('orden');
    const ul = document.getElementById('progreso-temas');
    if (!temas) return;

    // temas_completados contiene IDs de temas (no orden). Solo se marca un
    // tema como ✓ si está realmente en ese array — NUNCA por su posición
    // relativa al actual, porque con el calendario fijo de Frank los clientes
    // entran en cualquier tema (no siempre en el 1) y pueden saltarse temas
    // en los ciclos comprimidos.
    const completados = leadActual.temas_completados || [];
    const ordenActual = leadActual.tema_actual_orden;

    ul.innerHTML = temas.map(t => {
      let cls = 'upcoming';
      if (completados.includes(t.id)) cls = 'completed';
      else if (t.orden === ordenActual) cls = 'current';
      const icon = cls === 'completed' ? '✓' : '';
      return `<li class="${cls}">
        <div class="status-icon">${icon}</div>
        <span>${escapeHtml(t.nombre)}</span>
        <span class="progress-num">${String(t.orden).padStart(2, '0')}</span>
      </li>`;
    }).join('');

    document.getElementById('progreso-counter').textContent =
      `${String(completados.length).padStart(2, '0')} / 10`;
  }

  // Renderiza HTML inline de "Próxima sesión" + "6 recomendaciones" para
  // embeber dentro de la sala de espera del calentamiento. Usa los mismos
  // estilos del dashboard normal pero adaptados al ancho del cierre.
  function pintarBloqueSesionYRecomendaciones(sesion, temaNombre) {
    const tipsHtml = `
      <div class="cal-prep-card">
        <div class="sidebar-header">
          <div class="sidebar-title">Antes de tu sesión</div>
          <div class="sidebar-meta">6 RECOMENDACIONES</div>
        </div>
        <ol class="prep-list">
          <li class="prep-item"><span class="prep-num">01</span><div class="prep-body">
            <div class="prep-title">Audífonos</div>
            <div class="prep-text">Tenemos sonido 8D para poder disfrutarlo. Los audífonos deben ser de diadema; evita peinados altos.</div>
          </div></li>
          <li class="prep-item"><span class="prep-num">02</span><div class="prep-body">
            <div class="prep-title">Acostad@</div>
            <div class="prep-text">Parte de la sesión va a ser un proceso terapéutico y de reprogramación.</div>
          </div></li>
          <li class="prep-item"><span class="prep-num">03</span><div class="prep-body">
            <div class="prep-title">Privado</div>
            <div class="prep-text">Es un lugar privado donde nadie te va a molestar. Es posible que llores o hagas ruidos.</div>
          </div></li>
          <li class="prep-item"><span class="prep-num">04</span><div class="prep-body">
            <div class="prep-title">Comida</div>
            <div class="prep-text">Debes tener el estómago "liviano". Te recomendamos no comer dos horas antes de la sesión.</div>
          </div></li>
          <li class="prep-item"><span class="prep-num">05</span><div class="prep-body">
            <div class="prep-title">Sonidos</div>
            <div class="prep-text">Puedes hacer algunos sonidos, quejidos, llantos o hasta gritos si tu proceso lo necesita. Es posible que sientas sensaciones en tu cuerpo.</div>
          </div></li>
          <li class="prep-item"><span class="prep-num">06</span><div class="prep-body">
            <div class="prep-title">Papel y bolígrafo cerca</div>
            <div class="prep-text">Vas a querer anotar lo que emerge. A veces llegan mensajes.</div>
          </div></li>
        </ol>
      </div>
    `;

    if (!sesion) {
      return `
        <div class="cal-bloque-sesion">
          ${tipsHtml}
        </div>
      `;
    }

    const f = new Date(sesion.fecha + 'T00:00:00');
    const diaNum = f.getDate();
    const mesCorto = MESES_CORTOS[f.getMonth()];
    const mesLargo = MESES_LARGOS[f.getMonth()];
    const diaSemanaNombre = DIAS_LARGOS[f.getDay()];
    const horaTxt = (sesion.hora_inicio || '').slice(0, 5);
    const modalidadMap = {
      presencial: 'Presencial',
      virtual: 'Virtual',
      tatiana_grupal: 'Grupal · Tatiana',
      especial: 'Especial',
    };
    const modalidadTxt = modalidadMap[sesion.tipo_sesion] || sesion.tipo_sesion || '—';

    return `
      <div class="cal-bloque-sesion">
        <div class="cal-sesion-card">
          <div class="sesion-eyebrow">TU PRIMERA SESIÓN</div>
          <div class="sesion-fecha-grande">
            <div class="sesion-dia-num">${diaNum}</div>
            <div class="sesion-dia-info">
              <div class="sesion-dia-mes">${escapeHtml(mesLargo)}</div>
              <div class="sesion-dia-semana">${escapeHtml(diaSemanaNombre)}</div>
            </div>
          </div>
          <div class="sesion-hora-bloque">
            <span class="sesion-hora-label">HORA</span>
            <span class="sesion-hora-valor">${escapeHtml(horaTxt || '—')}</span>
          </div>
          <ul class="sesion-detalles">
            ${temaNombre ? `<li><span>TEMA</span><strong>${escapeHtml(temaNombre)}</strong></li>` : ''}
            <li><span>MODALIDAD</span><strong>${escapeHtml(modalidadTxt)}</strong></li>
            <li><span>FACILITADOR</span><strong>${escapeHtml(sesion.facilitador || '—')}</strong></li>
          </ul>
        </div>
        ${tipsHtml}
      </div>
    `;
  }

  // Busca la próxima sesión a partir de una fecha mínima. Por default usa hoy,
  // pero durante calentamiento se llama con fecha_inicio_programa para que el
  // cliente vea su PRIMERA sesión real (no una intermedia anterior al programa).
  async function consultarProximaSesion(fechaMin = null) {
    const desde = fechaMin || new Date().toISOString().slice(0, 10);
    const { data } = await db
      .from('sesiones_calendario')
      .select('*')
      .gte('fecha', desde)
      .eq('estado', 'programada')
      .order('fecha', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data;
  }

  async function pintarProximaSesion() {
    const card = document.getElementById('proxima-sesion-card');
    const prepCard = document.getElementById('session-prep-card');
    // Las recomendaciones (6 tips) son fijas y aplican a cualquier sesión —
    // siempre las mostramos cuando el cliente está en el dashboard normal.
    prepCard?.classList.remove('hidden');

    const sesion = await consultarProximaSesion();
    if (!sesion) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');

    const f = new Date(sesion.fecha + 'T00:00:00');
    document.getElementById('sesion-dia-num').textContent = f.getDate();
    document.getElementById('sesion-mes-anio').textContent =
      `${MESES_UPPER[f.getMonth()]} · ${f.getFullYear()}`;
    document.getElementById('sesion-semana').textContent = DIAS_LARGOS[f.getDay()];
    document.getElementById('sesion-hora').textContent = (sesion.hora_inicio || '').slice(0, 5);

    const modalidadMap = {
      presencial: 'Presencial',
      virtual: 'Virtual',
      tatiana_grupal: 'Grupal · Tatiana',
      especial: 'Especial',
    };
    document.getElementById('sesion-modalidad').textContent =
      modalidadMap[sesion.tipo_sesion] || sesion.tipo_sesion || '—';
    document.getElementById('sesion-facilitador').textContent = sesion.facilitador || '—';

    const diff = Math.max(0, Math.ceil((f - new Date()) / 86400000));
    document.getElementById('sesion-eta').textContent =
      diff === 0 ? 'HOY' : diff === 1 ? 'MAÑANA' : `EN ${diff} DÍAS`;
  }

  async function pintarStats() {
    const { count } = await db
      .from('journaling_respuestas')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', leadActual.id);

    const total = count || 0;
    // Día global del programa (1..70). Usamos semana_actual (1..10), NO
    // tema_actual_orden, porque cuando el cliente cruza un salto del calendario
    // de Frank el tema_orden no es secuencial (puede ir de 6 a 1, etc.) y
    // calcular con (orden-1)*7 daba valores absurdos como 43 al día 1.
    const semana = leadActual.semana_actual || 1;
    const dia = leadActual.dia_actual_en_tema || 1;
    const diaGlobal = (semana - 1) * 7 + dia;
    const compromiso = diaGlobal > 0
      ? Math.min(100, Math.round((total / diaGlobal) * 100))
      : 0;

    document.getElementById('stat-reflexiones').textContent = total;
    document.getElementById('stat-compromiso').textContent = `${compromiso}%`;
    document.getElementById('stat-diario-count').textContent =
      `${total} ENTRADA${total === 1 ? '' : 'S'}`;
  }

  // ============================================
  // Reflexión del día (state machine)
  // ============================================
  // Estados:
  //   'inicial'    → caja abierta, sin reflexión enviada hoy.
  //   'respondido' → ya envió, caja bloqueada, puede editar 1 vez.
  //   'editando'   → desbloqueada para corregir, una sola vez.
  //   'cerrado'    → ya editó (o no editará), bloqueada permanente.

  async function cargarReflexionDelDia() {
    if (!mensajeIdActual || !leadActual) {
      reflexionDelDia = null;
      analisisDelDia = null;
      aplicarEstadoReflexion('inicial');
      return;
    }
    const { data, error } = await db
      .from('journaling_respuestas')
      .select('*, ia_analisis(*)')
      .eq('lead_id', leadActual.id)
      .eq('mensaje_id', mensajeIdActual)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      reflexionDelDia = null;
      analisisDelDia = null;
      aplicarEstadoReflexion('inicial');
      // Auto-save + recuperar borrador para hoy aunque no haya fila en BD
      setupAutoSave('reflexion-textarea', 'q1', () => mensajeIdActual);
      restaurarBorrador('reflexion-textarea', 'q1', mensajeIdActual);
      return;
    }

    reflexionDelDia = data;
    analisisDelDia = (Array.isArray(data.ia_analisis) ? data.ia_analisis[0] : data.ia_analisis) || null;
    aplicarEstadoReflexion(reflexionDelDia.editado ? 'cerrado' : 'respondido');

    // Si hay pregunta_personaje en la fila → mostrar bloque de respuesta del
    // personaje y restaurar su estado (sin_responder, respondido, cerrado).
    if (reflexionDelDia.pregunta_personaje) {
      const estadoPers = !reflexionDelDia.respuesta_personaje
        ? 'sin_responder'
        : (reflexionDelDia.respuesta_personaje_editada ? 'cerrado' : 'respondido');
      mostrarBloqueRespuestaPersonaje(
        reflexionDelDia.id,
        reflexionDelDia.respuesta_personaje || '',
        estadoPers,
        reflexionDelDia.respuesta_personaje_at
      );
    }

    // Auto-save + recuperación de borradores
    setupAutoSave('reflexion-textarea', 'q1', () => mensajeIdActual);
    setupAutoSave('personaje-respuesta-textarea', 'q2', () => _journalingRowIdActivo);
    // Restaurar borradores SOLO si no hay respuesta guardada todavía
    if (!reflexionDelDia.respuesta_cliente) {
      restaurarBorrador('reflexion-textarea', 'q1', mensajeIdActual);
    }
    if (reflexionDelDia.pregunta_personaje && !reflexionDelDia.respuesta_personaje) {
      restaurarBorrador('personaje-respuesta-textarea', 'q2', reflexionDelDia.id);
    }

    // Restaurar el Cierre del día si ya fue generado
    if (reflexionDelDia.cierre_ia) {
      const block = document.getElementById('cierre-ia-block');
      const loadingEl = document.getElementById('cierre-ia-loading');
      const contentEl = document.getElementById('cierre-ia-content');
      if (block && contentEl) {
        block.classList.remove('hidden');
        loadingEl?.classList.add('hidden');
        contentEl.textContent = reflexionDelDia.cierre_ia;
      }
    }
  }

  function aplicarEstadoReflexion(estado) {
    estadoReflexion = estado;
    const textarea = document.getElementById('reflexion-textarea');
    const btn = document.getElementById('submit-reflexion');
    const responseEl = document.getElementById('ia-response');
    const iaContent = document.getElementById('ia-content');

    // Mostrar / ocultar análisis IA si existe (los 2 párrafos completos:
    // revelación + pregunta — ambos visibles para el cliente).
    if (analisisDelDia?.contenido_analisis) {
      iaContent.innerHTML = formatearAnalisis(analisisDelDia.contenido_analisis);
      responseEl.classList.add('visible');
    } else {
      responseEl.classList.remove('visible');
    }

    if (estado === 'inicial') {
      textarea.value = '';
      textarea.readOnly = false;
      textarea.placeholder = 'Escribe libremente. Este espacio es solo tuyo. No hay respuestas correctas, solo verdades que se revelan al ponerlas en palabras.';
      btn.disabled = false;
      btn.textContent = 'Enviar reflexión';
      btn.style.display = '';
      // Reset también la tarjeta de Cierre cuando la reflexión vuelve al estado inicial
      document.getElementById('cierre-ia-block')?.classList.add('hidden');
      const cierreContent = document.getElementById('cierre-ia-content');
      if (cierreContent) cierreContent.textContent = '';
    } else if (estado === 'respondido') {
      textarea.value = reflexionDelDia.respuesta_cliente || '';
      textarea.readOnly = true;
      btn.disabled = false;
      btn.textContent = 'Editar respuesta (última vez)';
      btn.style.display = '';
    } else if (estado === 'editando') {
      textarea.readOnly = false;
      textarea.focus();
      btn.disabled = false;
      btn.textContent = 'Guardar cambios';
      btn.style.display = '';
    } else if (estado === 'cerrado') {
      textarea.value = reflexionDelDia.respuesta_cliente || '';
      textarea.readOnly = true;
      btn.style.display = 'none';
    }

    // En modo admin viewing forzamos lectura siempre — sobreescribe lo de arriba.
    if (modoAdminViewing) {
      textarea.readOnly = true;
      btn.disabled = true;
      btn.textContent = 'Modo lectura';
      btn.style.display = '';
    }

    actualizarContadorPalabras();
  }

  function actualizarContadorPalabras() {
    const t = document.getElementById('reflexion-textarea').value;
    const n = contarPalabras(t);
    document.getElementById('word-count').textContent =
      `${n} ${n === 1 ? 'PALABRA' : 'PALABRAS'}`;
  }

  // Upsert manual para journaling_respuestas: los índices únicos de la tabla
  // son PARCIALES (WHERE mensaje_id IS NOT NULL) y Postgres no los acepta como
  // árbitro de ON CONFLICT vía PostgREST → .upsert({onConflict}) falla SIEMPRE
  // con 42P10. Buscamos la fila existente y decidimos update vs insert.
  async function guardarRespuestaJournaling(payload, claves) {
    const { data: existente, error: errSel } = await db
      .from('journaling_respuestas')
      .select('id')
      .match(claves)
      .maybeSingle();
    if (errSel) throw errSel;
    if (existente) {
      const { data, error } = await db
        .from('journaling_respuestas')
        .update(payload)
        .eq('id', existente.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await db
      .from('journaling_respuestas')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function handleSubmitReflexion() {
    if (modoAdminViewing) return;

    // Si está respondido, este botón es "Editar". Solo tienes UNA edición;
    // confirmamos antes de abrirla para evitar doble-clicks accidentales.
    if (estadoReflexion === 'respondido') {
      const ok = window.confirm(
        '¿Editar tu reflexión? Solo tienes una oportunidad. Después de guardar quedará cerrada y no podrás cambiarla.'
      );
      if (!ok) return;
      aplicarEstadoReflexion('editando');
      return;
    }

    // Si está cerrado, no debería ni mostrarse, pero por seguridad:
    if (estadoReflexion === 'cerrado') return;

    // Estados 'inicial' o 'editando' → guardar.
    const respuesta = document.getElementById('reflexion-textarea').value.trim();
    if (respuesta.length < 10) {
      showToast('Tómate un momento para escribir con calma.', 'error');
      return;
    }
    if (!preguntaDelDia) {
      showToast('No hay pregunta configurada para hoy.', 'error');
      return;
    }

    const esEdicion = estadoReflexion === 'editando' && reflexionDelDia?.id;
    const btn = document.getElementById('submit-reflexion');
    const loading = document.getElementById('ia-loading');
    const responseEl = document.getElementById('ia-response');
    btn.disabled = true;
    btn.textContent = 'Procesando';
    loading.classList.add('visible');
    responseEl.classList.remove('visible');

    try {
      let row;
      if (esEdicion) {
        const { data, error } = await db
          .from('journaling_respuestas')
          .update({
            respuesta_cliente: respuesta,
            longitud_caracteres: respuesta.length,
            longitud_palabras: contarPalabras(respuesta),
            editado: true,
            respuesta_recibida_at: new Date().toISOString(),
          })
          .eq('id', reflexionDelDia.id)
          .select()
          .single();
        if (error) throw error;
        row = data;
      } else {
        // Upsert manual: si ya existe una fila para este lead+mensaje (porque
        // la IA falló antes y el cliente reintenta), la actualizamos. Sin esto
        // la unique index lanza 23505 y el cliente cree que falló todo.
        row = await guardarRespuestaJournaling({
          lead_id: leadActual.id,
          mensaje_id: mensajeIdActual,
          pregunta_original: preguntaDelDia,
          respuesta_cliente: respuesta,
          longitud_caracteres: respuesta.length,
          longitud_palabras: contarPalabras(respuesta),
          es_calentamiento: false,
          tema_orden: leadActual.tema_actual_orden,
          dia_relativo: leadActual.dia_actual_en_tema,
          canal_recibido: 'plataforma',
          canal_respondido: 'plataforma',
          editado: false,
          respuesta_recibida_at: new Date().toISOString(),
        }, { lead_id: leadActual.id, mensaje_id: mensajeIdActual });
      }
      reflexionDelDia = row;

      // Pasamos el personaje a la Edge Function para que genere la
      // Pregunta 2 dirigida al personaje del cliente.
      const personajePayload = leadActual.personaje_nombre ? {
        nombre: leadActual.personaje_nombre,
        descripcion: leadActual.personaje_descripcion || '',
      } : null;

      // Countdown del personaje: 365 días desde fecha_inicio_programa (o
      // fecha_pago como fallback). Clamp a [1, 365]. Esto es lo que la IA
      // usa para cerrar la Pregunta 2 con el ultimátum exacto.
      const baseDate = leadActual.fecha_inicio_programa || leadActual.fecha_pago;
      let diasRestantes = 365;
      if (baseDate) {
        const transcurridos = Math.floor((Date.now() - new Date(baseDate).getTime()) / 86400000);
        diasRestantes = Math.max(1, Math.min(365, 365 - transcurridos));
      }

      const { pregunta_personaje, analisis, metadata } = await analizarReflexion(
        preguntaDelDia,
        respuesta,
        temaActual.nombre,
        personajePayload,
        diasRestantes
      );

      // El contenido del análisis IA ES ahora la Pregunta 2 (4 párrafos).
      // Lo guardamos en ia_analisis (para metadata/costos) y en journaling_respuestas.pregunta_personaje
      // (para que el libro y otros agregados lean del lugar canónico).
      const contenidoFinal = pregunta_personaje || analisis;

      if (esEdicion && analisisDelDia?.id) {
        const { data, error: errAna } = await db
          .from('ia_analisis')
          .update({
            contenido_analisis: contenidoFinal,
            modelo_usado: metadata?.modelo || metadata?.model || null,
            tokens_input: metadata?.tokens_input ?? null,
            tokens_output: metadata?.tokens_output ?? null,
            costo_usd: metadata?.costo_usd ?? null,
            prompt_version: metadata?.prompt_version || null,
          })
          .eq('id', analisisDelDia.id)
          .select()
          .single();
        if (errAna) console.warn('[Re-Génesis] No se pudo actualizar análisis:', errAna);
        if (data) analisisDelDia = data;
      } else {
        const { data, error: errAna } = await db
          .from('ia_analisis')
          .insert({
            lead_id: leadActual.id,
            journaling_respuesta_id: row.id,
            contenido_analisis: contenidoFinal,
            modelo_usado: metadata?.modelo || metadata?.model || null,
            tokens_input: metadata?.tokens_input ?? null,
            tokens_output: metadata?.tokens_output ?? null,
            costo_usd: metadata?.costo_usd ?? null,
            prompt_version: metadata?.prompt_version || null,
          })
          .select()
          .single();
        if (errAna) console.warn('[Re-Génesis] No se pudo guardar análisis:', errAna);
        if (data) analisisDelDia = data;
      }

      // Guardar la pregunta_personaje también en journaling_respuestas
      // (es el "Q2" formal que vive con la respuesta Q1 del cliente).
      // Usamos .select() para confirmar que RLS no nos bloquea silenciosamente.
      try {
        const upd = await db.from('journaling_respuestas')
          .update({ pregunta_personaje: contenidoFinal })
          .eq('id', row.id)
          .select('id');
        if (upd.error) throw upd.error;
        if (!upd.data || upd.data.length === 0) {
          console.warn('[Re-Génesis] pregunta_personaje update afectó 0 filas (RLS?)');
        }
      } catch (e) {
        console.warn('[Re-Génesis] No se pudo guardar pregunta_personaje:', e);
      }

      // Mostramos el contenido completo de Claude (los 2 párrafos: revelación + pregunta)
      // en la card "Respuesta y Pregunta para tu personaje". El cliente ve ambos.
      document.getElementById('ia-content').innerHTML = formatearAnalisis(contenidoFinal);
      mostrarBloqueRespuestaPersonaje(row.id, null, 'sin_responder', '');
      loading.classList.remove('visible');
      responseEl.classList.add('visible');
      responseEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showToast(esEdicion ? 'Reflexión actualizada' : 'Reflexión guardada', 'success');
      limpiarBorrador('q1', mensajeIdActual);
      await pintarStats();
      await pintarActivacion();

      // Después de un envío inicial → 'respondido' (queda 1 edición).
      // Después de la edición → 'cerrado' (sin más cambios).
      aplicarEstadoReflexion(esEdicion ? 'cerrado' : 'respondido');
    } catch (err) {
      console.error('[Re-Génesis] Submit reflexión:', err);
      showToast(`Error: ${err.message || 'no se pudo procesar'}`, 'error');
      loading.classList.remove('visible');
      // Reabrir el botón para reintentar.
      btn.disabled = false;
      btn.textContent = esEdicion ? 'Guardar cambios' : 'Enviar reflexión';
    }
  }

  function formatearAnalisis(texto) {
    if (!texto) return '';
    const parrafos = texto.split(/\n\n+/).filter(p => p.trim());
    return parrafos.map(p => {
      let html = escapeHtml(p);
      html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
      html = html.replace(/\n/g, '<br>');
      return `<p>${html}</p>`;
    }).join('');
  }

  // ============================================
  // Diario — todos los días [1..día_actual]
  // ============================================
  // Lista cronológica de cada día del programa que el cliente ha alcanzado.
  // Días respondidos: muestran respuesta + análisis IA.
  // Días pendientes: muestran la pregunta y un textarea inline para responder.
  // Días futuros: NUNCA aparecen (no se puede adelantar).
  async function cargarDiario() {
    const lista = document.getElementById('entries-list');
    lista.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando diario</div>
      </div>`;

    if (!leadActual.fecha_inicio_programa) {
      lista.innerHTML = `<div class="full-loader"><div class="full-loader-text">Tu programa aún no inicia. Cuando arranque, aquí verás todas tus reflexiones día a día.</div></div>`;
      pintarStatsDiario([]);
      return;
    }

    const inicio = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.floor((hoy - inicio) / 86400000);

    if (dias < 0) {
      lista.innerHTML = `<div class="full-loader"><div class="full-loader-text">Tu programa empieza el ${leadActual.fecha_inicio_programa}. Aquí aparecerá tu diario el primer día.</div></div>`;
      pintarStatsDiario([]);
      return;
    }

    const diaActualPrograma = Math.min(dias + 1, 70);
    const primerTema = leadActual.primer_tema_orden || 1;
    const modalidad = leadActual.modalidad || 'presencial';

    const diasMeta = [];
    for (let d = 1; d <= diaActualPrograma; d++) {
      const semanaIdx = Math.floor((d - 1) / 7);
      const diaEnTema = ((d - 1) % 7) + 1;
      const temaOrden = ((primerTema - 1 + semanaIdx) % 10) + 1;
      diasMeta.push({ diaGlobal: d, semanaIdx, diaEnTema, temaOrden });
    }

    const ordenesUnicos = [...new Set(diasMeta.map(d => d.temaOrden))];

    const [temasRes, respuestasRes] = await Promise.all([
      db.from('temas').select('id, orden, nombre').in('orden', ordenesUnicos),
      db.from('journaling_respuestas')
        .select('*, ia_analisis(contenido_analisis)')
        .eq('lead_id', leadActual.id),
    ]);

    const temas = temasRes.data || [];
    const temasPorOrden = Object.fromEntries(temas.map(t => [t.orden, t]));
    const temasMap = Object.fromEntries(temas.map(t => [t.orden, t.nombre]));
    const temaIds = temas.map(t => t.id);

    // El journaling se guarda con modalidad='ambas' (la pregunta del día es la
    // misma para presencial y virtual; lo que varía son los avisos de sesión).
    // Aceptamos también la modalidad específica del lead por si en el futuro
    // Frank decide diferenciar.
    const { data: mensajes } = await db.from('mensajes')
      .select('id, tema_id, dia_relativo, contenido, modalidad')
      .in('tema_id', temaIds)
      .eq('tipo', 'journaling')
      .in('modalidad', ['ambas', modalidad])
      .eq('activo', true);

    const mensajePorClave = {};
    (mensajes || []).forEach(m => {
      mensajePorClave[`${m.tema_id}-${m.dia_relativo}`] = m;
    });

    const respuestaPorMensaje = {};
    (respuestasRes.data || []).forEach(r => {
      if (r.mensaje_id) respuestaPorMensaje[r.mensaje_id] = r;
    });

    const entradas = diasMeta.map(d => {
      const tema = temasPorOrden[d.temaOrden];
      const mensaje = tema ? mensajePorClave[`${tema.id}-${d.diaEnTema}`] : null;
      const respuesta = mensaje ? respuestaPorMensaje[mensaje.id] : null;
      const fecha = new Date(inicio.getTime() + (d.diaGlobal - 1) * 86400000);

      return {
        diaGlobal: d.diaGlobal,
        diaEnTema: d.diaEnTema,
        semana: d.semanaIdx + 1,
        temaOrden: d.temaOrden,
        temaNombre: temasMap[d.temaOrden] || '—',
        fecha,
        mensaje,
        respuesta,
        esHoy: d.diaGlobal === diaActualPrograma,
      };
    });

    // Más reciente arriba
    entradas.sort((a, b) => b.diaGlobal - a.diaGlobal);

    entradasDiarioCache = entradas;
    temasMapDiarioCache = temasMap;
    pintarFiltrosDiario(entradas, temasMap);
    pintarEntradasFiltradas();
  }

  function pintarFiltrosDiario(entradas, temasMap) {
    const bar = document.getElementById('filter-bar');
    if (!bar) return;
    const temasUnicos = [...new Set(entradas.map(e => e.temaOrden).filter(Boolean))]
      .sort((a, b) => a - b);
    bar.innerHTML = `
      <button type="button" class="filter-chip ${filtroTemaActivo === null ? 'active' : ''}" data-filtro="all">Todas</button>
      ${temasUnicos.map(orden => `
        <button type="button" class="filter-chip ${filtroTemaActivo === orden ? 'active' : ''}" data-filtro="${orden}">
          ${escapeHtml(temasMap[orden] || `Tema ${orden}`)}
        </button>
      `).join('')}
    `;
    bar.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        filtroTemaActivo = chip.dataset.filtro === 'all' ? null : Number(chip.dataset.filtro);
        bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        pintarEntradasFiltradas();
      });
    });
  }

  function pintarEntradasFiltradas() {
    const lista = document.getElementById('entries-list');
    let entradas = entradasDiarioCache;
    if (filtroTemaActivo !== null) {
      entradas = entradas.filter(e => e.temaOrden === filtroTemaActivo);
    }
    if (!entradas.length) {
      lista.innerHTML = `
        <div class="full-loader">
          <div class="full-loader-text">${entradasDiarioCache.length === 0 ? 'Aún no tienes reflexiones' : 'Sin reflexiones para este filtro'}</div>
        </div>`;
    } else {
      lista.innerHTML = entradas.map(pintarEntrada).join('');
      // Wire-up: contadores y submit de cada pendiente
      lista.querySelectorAll('[data-pendiente-form]').forEach(form => {
        const ta = form.querySelector('.entry-pendiente-textarea');
        const counter = form.querySelector('.entry-pendiente-count');
        ta?.addEventListener('input', () => {
          const n = contarPalabras(ta.value);
          counter.textContent = `${n} ${n === 1 ? 'PALABRA' : 'PALABRAS'}`;
        });
        form.querySelector('[data-responder-pendiente]')
          ?.addEventListener('click', () => responderPendiente(form));
      });
    }
    pintarStatsDiario(entradas);
  }

  function pintarStatsDiario() {
    const total = entradasDiarioCache.length;
    const respondidas = entradasDiarioCache.filter(e => e.respuesta).length;

    const totalPalabras = entradasDiarioCache
      .filter(e => e.respuesta)
      .reduce((acc, e) => acc + (e.respuesta.longitud_palabras
        || contarPalabras(e.respuesta.respuesta_cliente || '')), 0);

    const compromiso = total > 0 ? Math.round((respondidas / total) * 100) : 0;

    document.getElementById('diario-total-reflexiones').textContent = `${respondidas}/${total}`;
    document.getElementById('diario-total-palabras').textContent = totalPalabras.toLocaleString('es-CO');
    document.getElementById('diario-total-dias').textContent = total;
    document.getElementById('diario-compromiso').textContent = `${compromiso}%`;
    const visibles = filtroTemaActivo === null
      ? total
      : entradasDiarioCache.filter(e => e.temaOrden === filtroTemaActivo).length;
    document.getElementById('diario-count').textContent =
      `${visibles} ENTRADA${visibles === 1 ? '' : 'S'}`;
  }

  function pintarEntrada(e) {
    return e.respuesta ? pintarEntradaRespondida(e) : pintarEntradaPendiente(e);
  }

  function pintarEntradaRespondida(e) {
    const r = e.respuesta;
    const ia = Array.isArray(r.ia_analisis) ? r.ia_analisis[0] : r.ia_analisis;
    const analisis = ia?.contenido_analisis;
    const palabras = r.longitud_palabras || contarPalabras(r.respuesta_cliente);
    const fEntrega = new Date(r.respuesta_recibida_at || r.created_at);

    return `
      <article class="entry">
        <div class="entry-header">
          <div class="entry-date-block">
            <div class="entry-day">${e.diaGlobal}</div>
            <div class="entry-date-meta">
              <span class="entry-month">DÍA ${e.diaGlobal} DE 70 · SEMANA ${e.semana}</span>
              <span class="entry-weekday">${DIAS_LARGOS[fEntrega.getDay()]} · ${fEntrega.getDate()} ${MESES_CORTOS[fEntrega.getMonth()]}</span>
            </div>
          </div>
          <div class="entry-tags">
            <span class="badge badge-active">${escapeHtml(e.temaNombre.toUpperCase())}</span>
            ${e.esHoy ? `<span class="badge">HOY</span>` : ''}
            ${r.editado ? `<span class="badge">EDITADO</span>` : ''}
          </div>
        </div>

        <p class="entry-prompt-label">Pregunta del día</p>
        <p class="entry-prompt">${escapeHtml(r.pregunta_original || e.mensaje?.contenido || '')}</p>

        <p class="entry-response-label">Mi reflexión</p>
        <div class="entry-response">${escapeHtml(r.respuesta_cliente || '')}</div>

        ${analisis ? `
        <div class="entry-ia-section">
          <div class="entry-ia-label">Reflejo Re-Génesis</div>
          <div class="entry-ia-content">${formatearAnalisis(analisis)}</div>
        </div>
        ` : ''}

        <div class="entry-footer">
          <span>${tiempoRelativo(r.respuesta_recibida_at || r.created_at).toUpperCase()} · ${palabras} PALABRAS</span>
        </div>
      </article>`;
  }

  function pintarEntradaPendiente(e) {
    const fEstimada = e.fecha;
    const tieneMensaje = !!e.mensaje;
    return `
      <article class="entry entry-pendiente">
        <div class="entry-header">
          <div class="entry-date-block">
            <div class="entry-day">${e.diaGlobal}</div>
            <div class="entry-date-meta">
              <span class="entry-month">DÍA ${e.diaGlobal} DE 70 · SEMANA ${e.semana}</span>
              <span class="entry-weekday">${DIAS_LARGOS[fEstimada.getDay()]} · ${fEstimada.getDate()} ${MESES_CORTOS[fEstimada.getMonth()]}</span>
            </div>
          </div>
          <div class="entry-tags">
            <span class="badge badge-active">${escapeHtml(e.temaNombre.toUpperCase())}</span>
            ${e.esHoy
              ? `<span class="badge">HOY</span>`
              : `<span class="badge entry-badge-pendiente">PENDIENTE</span>`}
          </div>
        </div>

        <p class="entry-prompt-label">Pregunta del día</p>
        <p class="entry-prompt">${tieneMensaje
          ? escapeHtml(e.mensaje.contenido)
          : '<em style="color: var(--text-muted)">Sin pregunta configurada para este día.</em>'}</p>

        ${tieneMensaje ? `
          <div class="entry-pendiente-action"
               data-pendiente-form
               data-mensaje-id="${e.mensaje.id}"
               data-tema-orden="${e.temaOrden}"
               data-dia-relativo="${e.diaEnTema}">
            <textarea class="textarea entry-pendiente-textarea" rows="6"
              placeholder="Aún puedes responder esta pregunta. Tu reflexión se sumará a tu diario."></textarea>
            <div class="entry-pendiente-controls">
              <span class="entry-pendiente-count">0 PALABRAS</span>
              <button type="button" class="btn-primary" data-responder-pendiente>
                ${e.esHoy ? 'Responder hoy' : 'Responder esta pregunta'}
              </button>
            </div>
          </div>` : ''}
      </article>`;
  }

  async function responderPendiente(form) {
    if (modoAdminViewing) {
      showToast('Modo lectura — los administradores no pueden responder.', 'error');
      return;
    }
    const textarea = form.querySelector('.entry-pendiente-textarea');
    const respuesta = textarea.value.trim();
    if (respuesta.length < 10) {
      showToast('Tómate un momento para escribir con calma.', 'error');
      return;
    }

    const mensajeId = Number(form.dataset.mensajeId);
    const temaOrden = Number(form.dataset.temaOrden);
    const diaRelativo = Number(form.dataset.diaRelativo);
    const card = form.closest('.entry-pendiente');
    const pregunta = card.querySelector('.entry-prompt')?.textContent?.trim() || '';
    const btn = form.querySelector('[data-responder-pendiente]');

    btn.disabled = true;
    btn.textContent = 'Enviando…';

    try {
      // Upsert manual: respeta el UNIQUE (lead_id, mensaje_id). Si el cliente
      // ya respondió este mismo mensaje desde el dashboard (mismo día),
      // actualizamos en vez de chocar con 23505.
      const nueva = await guardarRespuestaJournaling({
        lead_id: leadActual.id,
        mensaje_id: mensajeId,
        pregunta_original: pregunta,
        respuesta_cliente: respuesta,
        longitud_palabras: contarPalabras(respuesta),
        longitud_caracteres: respuesta.length,
        tema_orden: temaOrden,
        dia_relativo: diaRelativo,
        canal_recibido: 'plataforma',
        canal_respondido: 'plataforma',
        respuesta_recibida_at: new Date().toISOString(),
      }, { lead_id: leadActual.id, mensaje_id: mensajeId });

      const temaNombre = temasMapDiarioCache[temaOrden] || '';
      const { analisis, metadata } = await analizarReflexion(pregunta, respuesta, temaNombre);

      if (analisis) {
        await db.from('ia_analisis').insert({
          journaling_respuesta_id: nueva.id,
          lead_id: leadActual.id,
          contenido_analisis: analisis,
          modelo_usado: metadata?.modelo,
          tokens_input: metadata?.tokens_input,
          tokens_output: metadata?.tokens_output,
          costo_usd: metadata?.costo_usd,
        });
        await db.from('journaling_respuestas')
          .update({ procesado_por_ia: true })
          .eq('id', nueva.id);
      }

      showToast('Respuesta guardada en tu diario.', 'success');
      cargarDiario();
    } catch (err) {
      console.error('[Re-Génesis] Pendiente:', err);
      showToast('No pudimos guardar: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Responder esta pregunta';
    }
  }

  // ============================================
  // Mi calendario (cliente)
  // ============================================
  // Sesiones globales filtradas por modalidad del lead:
  //   presencial → tipo_sesion='presencial' o 'tatiana_grupal' o 'especial'
  //   virtual    → tipo_sesion='virtual' o 'tatiana_grupal' o 'especial'
  async function cargarCalendarioCliente() {
    const modalidad = leadActual.modalidad || 'presencial';
    const tiposVisibles = modalidad === 'virtual'
      ? ['virtual', 'tatiana_grupal', 'especial']
      : ['presencial', 'tatiana_grupal', 'especial'];

    document.querySelectorAll('#screen-calendario .diario-eyebrow').forEach(el => {
      el.textContent = `AGENDA · ${modalidad.toUpperCase()}`;
    });

    const proximaWrap = document.getElementById('cal-proxima');
    const proximasList = document.getElementById('cal-proximas');
    const pasadasList = document.getElementById('cal-pasadas');
    proximaWrap.innerHTML = pintarLoader('Cargando agenda');
    proximasList.innerHTML = '';
    pasadasList.innerHTML = '';

    const hoyISO = new Date().toISOString().slice(0, 10);
    const [proximasRes, pasadasRes] = await Promise.all([
      db.from('sesiones_calendario')
        .select('*, temas:tema_id(nombre, orden)')
        .in('tipo_sesion', tiposVisibles)
        .gte('fecha', hoyISO)
        .neq('estado', 'cancelada')
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true })
        .limit(50),
      db.from('sesiones_calendario')
        .select('*, temas:tema_id(nombre, orden)')
        .in('tipo_sesion', tiposVisibles)
        .lt('fecha', hoyISO)
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: false })
        .limit(20),
    ]);

    const proximas = proximasRes.data || [];
    const pasadas = pasadasRes.data || [];

    if (proximas.length === 0) {
      proximaWrap.innerHTML = `<div class="cal-empty">No hay sesiones próximas programadas. Frank o Tatiana te avisarán por aquí.</div>`;
      document.getElementById('cal-proximas-count').textContent = '0 SESIONES';
      proximasList.innerHTML = '';
    } else {
      proximaWrap.innerHTML = pintarSesionHero(proximas[0]);
      const resto = proximas.slice(1);
      document.getElementById('cal-proximas-count').textContent =
        `${resto.length} ${resto.length === 1 ? 'SESIÓN' : 'SESIONES'}`;
      proximasList.innerHTML = resto.length
        ? resto.map(s => pintarSesionRow(s, false)).join('')
        : `<div class="cal-empty">Solo la próxima por ahora.</div>`;
    }

    document.getElementById('cal-pasadas-count').textContent =
      `${pasadas.length} ${pasadas.length === 1 ? 'SESIÓN' : 'SESIONES'}`;
    pasadasList.innerHTML = pasadas.length
      ? pasadas.map(s => pintarSesionRow(s, true)).join('')
      : `<div class="cal-empty">Aún no tienes sesiones anteriores.</div>`;
  }

  function pintarLoader(texto) {
    return `<div class="full-loader"><div class="spinner"></div><div class="full-loader-text">${escapeHtml(texto)}</div></div>`;
  }

  function pintarSesionHero(s) {
    const f = new Date(s.fecha + 'T00:00:00');
    const tema = s.temas?.nombre || '';
    const horaIni = (s.hora_inicio || '').slice(0, 5);
    const horaFin = (s.hora_fin || '').slice(0, 5);
    const tipoLabel = labelTipoSesion(s.tipo_sesion);
    const link = esEnlace(s.ubicacion_o_link)
      ? `<a class="cal-hero-link" href="${escapeHtml(s.ubicacion_o_link)}" target="_blank" rel="noopener">Abrir enlace ↗</a>`
      : (s.ubicacion_o_link ? `<div class="cal-hero-place">${escapeHtml(s.ubicacion_o_link)}</div>` : '');

    return `
      <div class="cal-hero">
        <div class="cal-hero-date">
          <div class="cal-hero-day-num">${f.getDate()}</div>
          <div class="cal-hero-day-meta">
            <span>${MESES_UPPER[f.getMonth()]} · ${f.getFullYear()}</span>
            <span>${DIAS_LARGOS[f.getDay()]}</span>
          </div>
        </div>
        <div class="cal-hero-body">
          <div class="cal-hero-eyebrow">${escapeHtml(tipoLabel.toUpperCase())} · ${horaIni}${horaFin ? ' – ' + horaFin : ''}</div>
          <div class="cal-hero-title">${escapeHtml(tema || tipoLabel)}</div>
          ${s.facilitador ? `<div class="cal-hero-facil">Con ${escapeHtml(s.facilitador)}</div>` : ''}
          ${link}
          ${s.notas ? `<div class="cal-hero-notas">${escapeHtml(s.notas)}</div>` : ''}
        </div>
      </div>`;
  }

  function pintarSesionRow(s, esPasada) {
    const f = new Date(s.fecha + 'T00:00:00');
    const tema = s.temas?.nombre || '';
    const tipoLabel = labelTipoSesion(s.tipo_sesion);
    const horaIni = (s.hora_inicio || '').slice(0, 5);
    const link = esEnlace(s.ubicacion_o_link)
      ? `<a href="${escapeHtml(s.ubicacion_o_link)}" target="_blank" rel="noopener">enlace ↗</a>`
      : (s.ubicacion_o_link ? escapeHtml(s.ubicacion_o_link) : '—');
    const estadoBadge = s.estado === 'cancelada'
      ? `<span class="badge cal-badge-cancel">CANCELADA</span>`
      : s.estado === 'reprogramada'
        ? `<span class="badge">REPROGRAMADA</span>`
        : '';

    return `
      <div class="cal-row ${esPasada ? 'cal-row-past' : ''}">
        <div class="cal-row-date">
          <div class="cal-row-day">${f.getDate()}</div>
          <div class="cal-row-mes">${MESES_CORTOS[f.getMonth()]}</div>
        </div>
        <div class="cal-row-body">
          <div class="cal-row-titulo">${escapeHtml(tema || tipoLabel)}</div>
          <div class="cal-row-meta">${escapeHtml(tipoLabel.toUpperCase())} · ${horaIni} · ${link} ${estadoBadge}</div>
        </div>
      </div>`;
  }

  function labelTipoSesion(tipo) {
    return ({
      presencial: 'Sesión presencial',
      virtual: 'Sesión virtual',
      tatiana_grupal: 'Grupal con Tatiana',
      especial: 'Sesión especial',
    })[tipo] || tipo;
  }

  function esEnlace(s) {
    return typeof s === 'string' && /^https?:\/\//i.test(s);
  }

  // ============================================
  // Mi progreso
  // ============================================
  async function cargarProgreso() {
    if (!leadActual.fecha_inicio_programa) {
      document.querySelector('#screen-progreso .app-container').innerHTML = `
        <div class="diario-hero">
          <div class="diario-eyebrow">ANALÍTICA PERSONAL</div>
          <h1 class="diario-title">Mi progreso.</h1>
        </div>
        <div class="cal-empty">Tu programa aún no inicia. Cuando arranque, aquí verás tu progreso.</div>`;
      return;
    }

    const inicio = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.max(0, Math.floor((hoy - inicio) / 86400000));
    const diaActual = Math.min(dias + 1, 70);
    const primerTema = leadActual.primer_tema_orden || 1;
    const completado = dias >= 70;

    // Cargar respuestas + temas
    const [respuestasRes, temasRes] = await Promise.all([
      db.from('journaling_respuestas')
        .select('id, mensaje_id, dia_relativo, tema_orden, longitud_palabras, respuesta_recibida_at, respuesta_cliente')
        .eq('lead_id', leadActual.id)
        .order('respuesta_recibida_at', { ascending: false }),
      db.from('temas').select('orden, nombre'),
    ]);
    const respuestas = respuestasRes.data || [];
    const temasMap = Object.fromEntries((temasRes.data || []).map(t => [t.orden, t.nombre]));

    // Stats
    const totalRespuestas = respuestas.length;
    const totalPalabras = respuestas.reduce((acc, r) =>
      acc + (r.longitud_palabras || contarPalabras(r.respuesta_cliente || '')), 0);
    const promedioPalabras = totalRespuestas > 0 ? Math.round(totalPalabras / totalRespuestas) : 0;
    const adherencia = diaActual > 0 ? Math.round((totalRespuestas / diaActual) * 100) : 0;
    const racha = calcularRacha(respuestas, inicio, hoy);

    const pctPrograma = Math.round((diaActual / 70) * 100);
    document.getElementById('prog-dias-programa').textContent = String(diaActual);
    document.getElementById('prog-dias-programa-sub').textContent =
      completado ? 'PROGRAMA COMPLETO' : `SEMANA ${Math.min(10, Math.ceil(diaActual / 7))} DE 10`;
    document.getElementById('prog-hero-bar-fill').style.width = `${pctPrograma}%`;
    document.getElementById('prog-hero-pct').textContent = `${pctPrograma}%`;
    document.getElementById('prog-racha').textContent = String(racha);
    document.getElementById('prog-reflexiones').textContent = `${totalRespuestas}/${diaActual}`;
    document.getElementById('prog-adherencia').textContent = `${adherencia}% DE COMPROMISO`;
    document.getElementById('prog-palabras').textContent = totalPalabras.toLocaleString('es-CO');
    document.getElementById('prog-palabras-prom').textContent =
      `${promedioPalabras} POR REFLEXIÓN`;

    // Adherencia por semana
    const semanas = [];
    for (let s = 0; s < 10; s++) {
      const inicioS = s * 7 + 1;
      const finS = (s + 1) * 7;
      const alcanzados = Math.max(0, Math.min(diaActual, finS) - inicioS + 1);
      const respondidos = respuestas.filter(r => {
        const dg = (r.tema_orden && r.dia_relativo)
          ? globalDayFromTemaDia(r.tema_orden, r.dia_relativo, primerTema)
          : null;
        return dg !== null && dg >= inicioS && dg <= finS;
      }).length;
      const temaOrdenSem = ((primerTema - 1 + s) % 10) + 1;
      semanas.push({
        idx: s + 1,
        alcanzados,
        respondidos,
        temaNombre: temasMap[temaOrdenSem] || '—',
        habilitada: alcanzados > 0,
      });
    }
    document.getElementById('prog-bars-semanas').innerHTML = semanas.map(w => {
      const pct = w.alcanzados > 0 ? Math.round((w.respondidos / w.alcanzados) * 100) : 0;
      return `
        <div class="prog-bar ${!w.habilitada ? 'prog-bar-disabled' : ''}">
          <div class="prog-bar-label">
            <span class="prog-bar-name">Semana ${w.idx} · ${escapeHtml(w.temaNombre)}</span>
            <span class="prog-bar-value">${w.respondidos}/${w.alcanzados || '—'}</span>
          </div>
          <div class="prog-bar-track">
            <div class="prog-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

    // Distribución por tema
    const porTema = {};
    respuestas.forEach(r => {
      if (r.tema_orden) porTema[r.tema_orden] = (porTema[r.tema_orden] || 0) + 1;
    });
    const maxTema = Math.max(1, ...Object.values(porTema));
    const ordenes = Array.from({ length: 10 }, (_, i) => ((primerTema - 1 + i) % 10) + 1);
    document.getElementById('prog-bars-temas').innerHTML = ordenes.map(orden => {
      const cant = porTema[orden] || 0;
      const pct = (cant / maxTema) * 100;
      return `
        <div class="prog-bar">
          <div class="prog-bar-label">
            <span class="prog-bar-name">${escapeHtml(temasMap[orden] || `Tema ${orden}`)}</span>
            <span class="prog-bar-value">${cant} reflexión${cant === 1 ? '' : 'es'}</span>
          </div>
          <div class="prog-bar-track">
            <div class="prog-bar-fill prog-bar-fill-tema" style="width: ${pct}%"></div>
          </div>
        </div>`;
    }).join('');

  }

  // ============================================
  // Mi libro (página propia)
  // ============================================
  async function cargarMiLibro() {
    const heroEl = document.getElementById('libro-hero');
    const capsEl = document.getElementById('libro-capitulos');
    if (!leadActual.fecha_inicio_programa) {
      heroEl.innerHTML = `
        <div class="libro-hero libro-hero-pre">
          <div class="libro-hero-eyebrow">LIBRO PENDIENTE</div>
          <h2 class="libro-hero-title">Tu libro empieza el día 1.</h2>
          <p class="libro-hero-sub">Aún no has comenzado el programa. Cuando inicies, esta página se llena con tu progreso real.</p>
        </div>`;
      capsEl.innerHTML = '';
      return;
    }

    const inicio = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.max(0, Math.floor((hoy - inicio) / 86400000));
    const diaActual = Math.min(dias + 1, 70);
    const completado = dias >= 70;
    const primerTema = leadActual.primer_tema_orden || 1;

    const [respuestasRes, temasRes] = await Promise.all([
      db.from('journaling_respuestas')
        .select('id, mensaje_id, dia_relativo, tema_orden, respuesta_recibida_at')
        .eq('lead_id', leadActual.id),
      db.from('temas').select('orden, nombre'),
    ]);
    const respuestas = respuestasRes.data || [];
    const temasMap = Object.fromEntries((temasRes.data || []).map(t => [t.orden, t.nombre]));

    const totalRespuestas = respuestas.length;
    const faltan = 70 - totalRespuestas;
    const pctRespuestas = Math.round((totalRespuestas / 70) * 100);

    // ==== HERO según estado ====
    const todoListo = completado && totalRespuestas >= 70;
    const ctaBoton = todoListo
      ? `<a class="libro-hero-cta libro-hero-cta-final" href="libro.html?lead_id=${leadActual.id}" target="_blank" rel="noopener">Descargar mi libro <span>↗</span></a>`
      : `<a class="libro-hero-cta" href="libro.html?lead_id=${leadActual.id}" target="_blank" rel="noopener">Vista previa del libro <span>↗</span></a>`;

    const eyebrow = todoListo ? 'LIBRO DISPONIBLE' : 'FUTURO ENTREGABLE';
    const titulo = todoListo
      ? 'Tu libro está listo.'
      : 'Tu libro de transformación.';
    const subtitulo = todoListo
      ? `70 días de reflexión, 70 reflejos de la metodología Re-Génesis. Lo más significativo de este proceso, ahora en un PDF que puedes guardar para siempre.`
      : `Al terminar tu programa de 10 semanas, recibirás automáticamente un PDF con todas tus reflexiones y los reflejos que la metodología Re-Génesis te entregó. Será el regalo más significativo de este proceso.`;

    heroEl.innerHTML = `
      <div class="libro-hero ${todoListo ? 'libro-hero-final' : ''}">
        <div class="libro-hero-content">
          <div class="libro-hero-eyebrow">${eyebrow}</div>
          <h2 class="libro-hero-title">${escapeHtml(titulo)}</h2>
          <p class="libro-hero-sub">${escapeHtml(subtitulo)}</p>

          <div class="libro-hero-stats">
            <div class="libro-hero-stat">
              <div class="libro-hero-stat-num">${totalRespuestas}<span class="libro-hero-stat-total">/70</span></div>
              <div class="libro-hero-stat-label">PÁGINAS ESCRITAS</div>
            </div>
            <div class="libro-hero-stat">
              <div class="libro-hero-stat-num">${pctRespuestas}<span class="libro-hero-stat-total">%</span></div>
              <div class="libro-hero-stat-label">DEL LIBRO</div>
            </div>
            <div class="libro-hero-stat">
              <div class="libro-hero-stat-num">${todoListo ? '✓' : faltan}</div>
              <div class="libro-hero-stat-label">${todoListo ? 'COMPLETO' : 'PÁGINAS POR ESCRIBIR'}</div>
            </div>
          </div>

          <div class="libro-hero-progress">
            <div class="libro-hero-progress-track">
              <div class="libro-hero-progress-fill" style="width: ${pctRespuestas}%"></div>
            </div>
          </div>
        </div>
        <div class="libro-hero-action">
          ${ctaBoton}
        </div>
      </div>`;

    // ==== Capítulos: 10 cards ====
    const respondidasPorTema = {};
    respuestas.forEach(r => {
      if (r.tema_orden) {
        respondidasPorTema[r.tema_orden] = (respondidasPorTema[r.tema_orden] || 0) + 1;
      }
    });

    const caps = [];
    for (let s = 0; s < 10; s++) {
      const temaOrden = ((primerTema - 1 + s) % 10) + 1;
      const temaNombre = temasMap[temaOrden] || `Tema ${temaOrden}`;
      const diaInicio = s * 7 + 1;
      const diaFin = (s + 1) * 7;
      const alcanzados = Math.max(0, Math.min(diaActual, diaFin) - diaInicio + 1);
      const respondidasCap = respondidasPorTema[temaOrden] || 0;
      const totalCap = 7;

      let estado;
      if (diaActual >= diaFin && respondidasCap >= totalCap) {
        estado = 'completo';
      } else if (alcanzados > 0) {
        estado = 'en-curso';
      } else {
        estado = 'futuro';
      }

      caps.push({ s: s + 1, temaOrden, temaNombre, diaInicio, diaFin, respondidasCap, totalCap, estado });
    }

    capsEl.innerHTML = caps.map(c => `
      <div class="libro-cap libro-cap-${c.estado}">
        <div class="libro-cap-num">${String(c.s).padStart(2, '0')}</div>
        <div class="libro-cap-body">
          <div class="libro-cap-titulo">${escapeHtml(c.temaNombre)}</div>
          <div class="libro-cap-meta">DÍAS ${c.diaInicio}–${c.diaFin}</div>
          <div class="libro-cap-progress">
            <div class="libro-cap-progress-track">
              <div class="libro-cap-progress-fill" style="width: ${(c.respondidasCap / c.totalCap) * 100}%"></div>
            </div>
            <div class="libro-cap-progress-meta">${c.respondidasCap}/${c.totalCap}</div>
          </div>
        </div>
        <div class="libro-cap-status">${
          c.estado === 'completo' ? '✓' :
          c.estado === 'en-curso' ? '·' : ''
        }</div>
      </div>`).join('');
  }

  function globalDayFromTemaDia(temaOrden, diaRelativo, primerTema) {
    // Inverso de: temaOrden = ((primerTema - 1 + semanaIdx) % 10) + 1
    // semanaIdx = (temaOrden - primerTema + 10) % 10
    const semanaIdx = ((temaOrden - primerTema) % 10 + 10) % 10;
    return semanaIdx * 7 + diaRelativo;
  }

  function calcularRacha(respuestas, inicio, hoy) {
    if (!respuestas.length) return 0;
    const diasConRespuesta = new Set();
    respuestas.forEach(r => {
      if (r.respuesta_recibida_at) {
        const d = new Date(r.respuesta_recibida_at);
        d.setHours(0, 0, 0, 0);
        diasConRespuesta.add(d.getTime());
      }
    });
    let racha = 0;
    for (let d = new Date(hoy); d >= inicio; d.setDate(d.getDate() - 1)) {
      if (diasConRespuesta.has(d.getTime())) {
        racha++;
      } else if (d.getTime() < hoy.getTime()) {
        // permitimos que hoy no tenga aún si la racha incluye hasta ayer
        break;
      }
    }
    return racha;
  }

  // ============================================
  // Estado completado · pantalla de cierre
  // ============================================
  function estaCompletado() {
    if (!leadActual) return false;
    if (leadActual.estado === 'completado' || leadActual.estado === 'finalizado') return true;
    if (!leadActual.fecha_inicio_programa) return false;
    const inicio = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const dias = Math.floor((hoy - inicio) / 86400000);
    return dias >= 70;
  }

  // ============================================
  // Estado calentamiento · pagó pero el programa aún no empieza
  // ============================================
  function estaEnCalentamiento() {
    if (!leadActual) return false;
    if (leadActual.estado !== 'pagado_calentamiento') return false;
    if (!leadActual.fecha_inicio_programa) return false;
    const inicioProg = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return hoy < inicioProg;
  }

  async function pintarDashboardCalentamiento() {
    pintarUsuario();
    document.getElementById('dashboard-container')?.classList.add('modo-calentamiento');

    // Durante calentamiento el cliente solo necesita la sala de espera.
    // Ocultamos diario/calendario/progreso/libro/testimonio del nav porque:
    //  - No tiene sesiones a las que asistir hasta semana 1.
    //  - No tiene tema en curso (tema_actual_orden = NULL).
    //  - El libro y el progreso solo tienen sentido cuando arranca el programa.
    // Cuando el cron lo active (estado='activo'), un refresh del navegador
    // recupera las pestañas porque ya no entra a esta rama.
    document.querySelectorAll('.app-nav button[data-screen-link]').forEach(b => {
      if (b.dataset.screenLink !== 'dashboard') b.style.display = 'none';
    });
    document.querySelectorAll('.app-nav .nav-link-external').forEach(a => {
      a.style.display = 'none';
    });

    // ISODOW: 1=Lunes ... 7=Domingo
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const diaSemana = hoy.getDay() === 0 ? 7 : hoy.getDay();
    const inicioProg = new Date(leadActual.fecha_inicio_programa + 'T00:00:00');
    const diasParaInicio = Math.ceil((inicioProg - hoy) / 86400000);

    // Mensaje del día desde mensajes_calentamiento (dia_calentamiento = ISODOW de hoy)
    const { data: mensaje } = await db
      .from('mensajes_calentamiento')
      .select('*')
      .eq('dia_calentamiento', diaSemana)
      .eq('activo', true)
      .maybeSingle();

    // Reflexión existente del día si la hay
    let respuestaCal = null, analisisCal = null;
    if (mensaje) {
      const { data } = await db
        .from('journaling_respuestas')
        .select('*, ia_analisis(contenido_analisis, modelo_usado)')
        .eq('lead_id', leadActual.id)
        .eq('mensaje_calentamiento_id', mensaje.id)
        .order('respuesta_recibida_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        respuestaCal = data;
        analisisCal = (Array.isArray(data.ia_analisis) ? data.ia_analisis[0] : data.ia_analisis) || null;
      }
    }

    const nombre = leadActual.nombre ? leadActual.nombre.split(' ')[0] : leadActual.email.split('@')[0];
    const nombreDiaSemana = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'][diaSemana];
    const fechaInicioFmt = inicioProg.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

    // Buscar la primera sesión real del cliente (>= fecha_inicio_programa, no >= hoy)
    // para que durante calentamiento vea su primera sesión completa, no una previa
    // de otro grupo. También averiguar el tema de esa semana del calendario.
    const sesion = await consultarProximaSesion(leadActual.fecha_inicio_programa);
    let temaSesion = null;
    if (sesion) {
      const { data: t } = await db.rpc('tema_para_fecha', { p_fecha: sesion.fecha });
      if (t) {
        const { data: temaInfo } = await db.from('temas').select('nombre').eq('orden', t).maybeSingle();
        temaSesion = temaInfo?.nombre || null;
      }
    }

    const wrap = document.getElementById('dashboard-cierre');
    wrap.classList.remove('hidden');
    wrap.innerHTML = `
      <div class="cierre-eyebrow">SALA DE ESPERA · DÍA ${diaSemana} DE 7</div>
      <h1 class="cierre-titulo">
        ${escapeHtml(nombre)}, <span class="cierre-titulo-mark">empezamos el lunes.</span>
      </h1>
      <p class="cierre-sub">
        Tu pago está confirmado y los contratos firmados. Mientras llega el ${escapeHtml(fechaInicioFmt)}, prepárate con el contenido del día.
        ${diasParaInicio > 0
          ? `Faltan <strong>${diasParaInicio} día${diasParaInicio === 1 ? '' : 's'}</strong> para arrancar el programa formal.`
          : 'El programa empieza mañana.'}
      </p>

      ${mensaje ? `
        <div class="cal-pregunta-card">
          <div class="cal-pregunta-eyebrow">CONTENIDO DEL ${nombreDiaSemana.toUpperCase()}</div>
          <h2 class="cal-pregunta-titulo">${escapeHtml(mensaje.pregunta_dia || '')}</h2>

          ${mensaje.introduccion ? `<p class="cal-pregunta-intro">${escapeHtml(mensaje.introduccion)}</p>` : ''}
          ${mensaje.ejercicio_practico ? `
            <div class="cal-pregunta-ejercicio">
              <span class="cal-pregunta-ejercicio-label">EJERCICIO</span>
              <p>${escapeHtml(mensaje.ejercicio_practico)}</p>
            </div>` : ''}

          ${respuestaCal ? `
            <div class="cal-respuesta">
              <div class="cal-respuesta-label">TU REFLEXIÓN</div>
              <div class="cal-respuesta-texto">${escapeHtml(respuestaCal.respuesta_cliente)}</div>
            </div>
            ${analisisCal ? `
              <div class="cal-analisis">
                <div class="cal-analisis-label">REFLEJO RE-GÉNESIS</div>
                <div class="cal-analisis-texto">${formatearAnalisis(analisisCal.contenido_analisis)}</div>
              </div>
            ` : ''}
          ` : `
            <div class="cal-form">
              <div class="cal-form-label">TU REFLEXIÓN</div>
              <textarea class="textarea cal-textarea" id="cal-textarea" rows="6"
                placeholder="Escribe libremente. Lo que llevas hoy es información valiosa para empezar el lunes."></textarea>
              <div class="cal-form-controls">
                <span class="cal-word-count" id="cal-word-count">0 PALABRAS</span>
                <button type="button" class="btn-primary" id="cal-submit">Enviar reflexión</button>
              </div>
            </div>
          `}
        </div>
      ` : `
        <div class="cal-empty-card">
          <span class="cal-empty-label">CONTENIDO PENDIENTE</span>
          <p>Frank aún no ha configurado el contenido del ${nombreDiaSemana}. Vuelve más tarde.</p>
        </div>
      `}

      ${pintarBloqueSesionYRecomendaciones(sesion, temaSesion)}

      <p class="cierre-firma">Re-Génesis · Frank y Tatiana — Neurohackers</p>
    `;

    // Wire del form si el cliente todavía no respondió
    if (mensaje && !respuestaCal) {
      const ta = document.getElementById('cal-textarea');
      const counter = document.getElementById('cal-word-count');
      ta?.addEventListener('input', () => {
        const n = contarPalabras(ta.value);
        counter.textContent = `${n} ${n === 1 ? 'PALABRA' : 'PALABRAS'}`;
      });
      document.getElementById('cal-submit')?.addEventListener('click', () => responderCalentamiento(mensaje));
    }
  }

  async function responderCalentamiento(mensaje) {
    if (modoAdminViewing) {
      showToast('Modo lectura — los administradores no pueden responder.', 'error');
      return;
    }
    const ta = document.getElementById('cal-textarea');
    const respuesta = ta.value.trim();
    if (respuesta.length < 10) {
      showToast('Tómate un momento para escribir con calma.', 'error');
      return;
    }
    const btn = document.getElementById('cal-submit');
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    try {
      // Upsert manual para no duplicar si el cliente reintenta.
      await guardarRespuestaJournaling({
        lead_id: leadActual.id,
        mensaje_calentamiento_id: mensaje.id,
        es_calentamiento: true,
        pregunta_original: mensaje.pregunta_dia,
        respuesta_cliente: respuesta,
        longitud_caracteres: respuesta.length,
        longitud_palabras: contarPalabras(respuesta),
        canal_recibido: 'plataforma',
        canal_respondido: 'plataforma',
        respuesta_recibida_at: new Date().toISOString(),
      }, { lead_id: leadActual.id, mensaje_calentamiento_id: mensaje.id });

      // NOTA: durante el calentamiento NO llamamos a la IA. El cliente todavía
      // no creó su personaje (el gate vive en el dashboard activo). Si
      // disparáramos el prompt Jung+Hellinger sin personaje, Claude respondería
      // con "el personaje" sin contexto, lo cual es confuso. El acompañamiento
      // IA arranca el primer día del programa formal.

      showToast('Reflexión guardada en tu diario de preparación.', 'success');
      pintarDashboardCalentamiento();
    } catch (err) {
      console.error('[Re-Génesis] calentamiento:', err);
      showToast('No pudimos guardar: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Enviar reflexión';
    }
  }

  async function pintarDashboardCierre() {
    pintarUsuario();
    document.getElementById('dashboard-container')?.classList.add('modo-cierre');

    const { data: respuestas } = await db.from('journaling_respuestas')
      .select('respuesta_cliente, longitud_palabras')
      .eq('lead_id', leadActual.id);

    const total = respuestas?.length || 0;
    const palabras = (respuestas || []).reduce((acc, r) =>
      acc + (r.longitud_palabras || contarPalabras(r.respuesta_cliente || '')), 0);

    document.getElementById('cierre-respondidas').textContent = `${total}/70`;
    document.getElementById('cierre-palabras').textContent = palabras.toLocaleString('es-CO');
    document.getElementById('cierre-libro-link').href =
      `libro.html?lead_id=${encodeURIComponent(leadActual.id)}`;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
