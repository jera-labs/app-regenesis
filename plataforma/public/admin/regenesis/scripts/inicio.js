// ============================================
// Re-Génesis — Admin Dashboard (inicio)
// ============================================
// Script standalone para /regenesis/admin.html (página de inicio del admin).
// Solo carga KPIs + actividad reciente. Otras páginas del admin (clientes,
// mensajes, calendario, testimonios, config, cron) se migrarán una a una en
// scripts separados, evitando el bundle gigante de admin-app.js (1792 líneas).
//
// Depende de: window.db, window.requireAdmin, window.utils.

(function () {
  'use strict';

  // Resolver dependencias lazy (mismo patrón que client-app.js para evitar
  // bugs de orden de carga en navegaciones Turbo).
  function _deps() {
    const u = window.utils || {};
    return {
      escapeHtml: u.escapeHtml || ((s) => s == null ? '' : String(s)),
      tiempoRelativo: u.tiempoRelativo || ((d) => new Date(d).toLocaleDateString('es-CO')),
      MESES_CORTOS: u.MESES_CORTOS || ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],
      DIAS_LARGOS: u.DIAS_LARGOS || ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'],
    };
  }

  let adminActual = null;
  let temasCache = [];

  async function init() {
    const { escapeHtml, tiempoRelativo, MESES_CORTOS, DIAS_LARGOS } = _deps();

    document.querySelectorAll('[data-logout]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.signOut === 'function') return window.signOut();
        window.db.auth.signOut().then(() => { window.location.href = '/login.html'; });
      }));

    if (typeof window.requireAdmin !== 'function') {
      console.error('[Re-Génesis/Admin] requireAdmin no cargó.');
      return;
    }

    const auth = await window.requireAdmin();
    if (!auth || !auth.session) return;
    adminActual = auth.admin;

    // Pintar nombre del admin en el HTML
    const nombre = adminActual?.nombre || auth.session.user.email.split('@')[0];
    document.querySelectorAll('[data-admin-name]').forEach(el => el.textContent = nombre);

    // Cargar temas para mostrar nombres en actividad reciente
    const { data: temas } = await window.db.from('temas').select('id, nombre, orden').order('orden');
    temasCache = temas || [];

    await cargarKPIs(escapeHtml, tiempoRelativo, MESES_CORTOS, DIAS_LARGOS);

    document.body.classList.add('regenesis-ready');
  }

  async function cargarKPIs(escapeHtml, tiempoRelativo, MESES_CORTOS, DIAS_LARGOS) {
    const sieteDiasAtras = new Date(Date.now() - 7 * 86400000).toISOString();
    const hoyISO = new Date().toISOString().slice(0, 10);

    const [totalRes, activosRes, reflexionesRes, ultimasRes, sesionRes] = await Promise.all([
      window.db.from('leads').select('*', { count: 'exact', head: true }),
      window.db.from('leads').select('*', { count: 'exact', head: true }).eq('estado', 'activo'),
      window.db.from('journaling_respuestas')
        .select('*', { count: 'exact', head: true })
        .gte('respuesta_recibida_at', sieteDiasAtras),
      window.db.from('journaling_respuestas')
        .select('id, lead_id, pregunta_original, respuesta_cliente, respuesta_recibida_at, tema_orden, dia_relativo, leads:lead_id(nombre, email)')
        .order('respuesta_recibida_at', { ascending: false })
        .limit(5),
      window.db.from('sesiones_calendario')
        .select('*')
        .gte('fecha', hoyISO)
        .eq('estado', 'programada')
        .order('fecha', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    const totalClientes = totalRes.count || 0;
    const clientesActivos = activosRes.count || 0;
    const reflexionesSemana = reflexionesRes.count || 0;

    document.getElementById('kpi-clientes-activos').textContent = clientesActivos;
    document.getElementById('kpi-clientes-total').textContent = `de ${totalClientes} totales`;
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

    pintarActividadReciente(ultimasRes.data || [], escapeHtml, tiempoRelativo);
  }

  function pintarActividadReciente(entradas, escapeHtml, tiempoRelativo) {
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

  // Expone init para el bootstrap inline.
  window.regenesisAdminInicioInit = init;
})();
