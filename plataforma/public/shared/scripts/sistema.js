// ============================================================================
// sistema.js · /admin/sistema.html — monitor de salud de la plataforma.
// Llama UNA RPC con todo el status + pinguea endpoints externos en paralelo.
// Auto-refresh cada 30 s. Solo admins activos.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[sistema.js] Falta supabase-client.js');

  const REFRESH_MS = 30 * 1000;

  // Endpoints externos a verificar (HEAD request, expect 200/30x)
  const EXTERNOS = [
    { id: 'plataforma',   nombre: 'plataforma.neurohackers.cloud',  url: 'https://plataforma.neurohackers.cloud/' },
    { id: 'regenesis',    nombre: 'neurohackers.cloud (legacy)',    url: 'https://neurohackers.cloud/',           expect301: true },
    { id: 'supabase',     nombre: 'Supabase Postgres',              url: 'https://eqyaddcidkywmedwscpu.supabase.co/rest/v1/' },
    { id: 'tunnel',       nombre: 'Cloudflare Tunnel',              url: 'https://plataforma.neurohackers.cloud/admin/index.html' },
    { id: 'anthropic',    nombre: 'Anthropic API status',           url: 'https://status.anthropic.com/api/v2/status.json',  esStatus: true },
    { id: 'cloudflare',   nombre: 'Cloudflare status',              url: 'https://www.cloudflarestatus.com/api/v2/status.json', esStatus: true },
    { id: 'supabase_st',  nombre: 'Supabase status',                url: 'https://status.supabase.com/api/v2/status.json',    esStatus: true },
    { id: 'ghl',          nombre: 'GoHighLevel status',             url: 'https://status.gohighlevel.com/api/v2/status.json', esStatus: true },
  ];

  let timerHandle = null;
  let cargando = false;

  // ============================================================
  // INIT
  // ============================================================
  // Limpiar listeners / timers de visitas anteriores para evitar leaks
  // si el usuario navega varias veces a /admin/sistema.html con turbo.
  let cleanupHandle = null;
  function cleanupPrevio() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (cleanupHandle) {
      document.removeEventListener('turbo:before-render', cleanupHandle);
      cleanupHandle = null;
    }
  }

  window.sistemaInit = async function () {
    // Si ya había una instancia activa de visitas anteriores, cerrarla
    cleanupPrevio();

    const btn = document.getElementById('sis-btn-refresh');
    if (btn) btn.addEventListener('click', refrescar);
    await refrescar();
    timerHandle = setInterval(refrescar, REFRESH_MS);

    cleanupHandle = () => cleanupPrevio();
    document.addEventListener('turbo:before-render', cleanupHandle, { once: true });
  };

  async function refrescar() {
    if (cargando) return;
    cargando = true;
    const btn = document.getElementById('sis-btn-refresh');
    btn?.classList.add('loading');
    try {
      const [statusRes, externos, historicoRes] = await Promise.all([
        window.db.rpc('admin_sistema_status'),
        pingExternos(),
        window.db.rpc('health_log_resumen_24h').catch(() => ({ data: {} })),
      ]);
      const s = statusRes?.data;
      if (s) pintarTodo(s, externos);
      else pintarError(statusRes?.error?.message || 'No se pudo leer status');
      pintarHistorico(historicoRes?.data || {});
      pintarTimestamp();
    } catch (e) {
      console.error('[sistema] refrescar', e);
      pintarError(e?.message || 'Error');
    } finally {
      cargando = false;
      btn?.classList.remove('loading');
    }
  }

  // ============================================================
  // HISTÓRICO 24h (de tabla health_log + cron cada 5 min)
  // ============================================================
  function pintarHistorico(data) {
    const cont = document.getElementById('sis-historico');
    if (!cont) return;
    const endpoints = Object.keys(data);
    if (endpoints.length === 0) {
      cont.innerHTML = '<div style="font-size: 12px; color: var(--text-muted); padding: var(--space-3); text-align: center;">Sin datos históricos aún. El cron health-check-periodico (cada 5 min) está poblando la tabla. Vuelve en 10-15 min.</div>';
      return;
    }
    const labels = {
      plataforma: 'plataforma.neurohackers.cloud',
      supabase_rest: 'Supabase Postgres REST',
      anthropic_status: 'Anthropic Claude API',
      supabase_status: 'Supabase status page',
      cloudflare_status: 'Cloudflare status page',
      ghl_status: 'GoHighLevel status page',
    };
    const filas = endpoints.sort().map(ep => {
      const d = data[ep] || {};
      const pct = d.ok_pct;
      const pctCls = pct >= 99 ? 'ok' : pct >= 95 ? 'warn' : 'err';
      return `<tr>
        <td><strong>${escapeHtml(labels[ep] || ep)}</strong><div style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">${ep}</div></td>
        <td><span class="sis-pill ${pctCls}">${pct ?? '—'}%</span></td>
        <td>${d.total_checks ?? 0}</td>
        <td>${d.fallos_recientes ?? 0}</td>
        <td><span style="font-family: var(--font-mono); font-size: 11px;">${d.avg_latencia_ms ?? '—'}ms</span></td>
        <td><span style="font-family: var(--font-mono); font-size: 11px;">${d.p95_latencia_ms ?? '—'}ms</span></td>
        <td><span style="font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted);">${tiempoRelativo(d.ultimo_check_at)}</span></td>
      </tr>`;
    }).join('');
    cont.innerHTML = `<table class="sis-tabla">
      <thead><tr>
        <th>Endpoint</th><th>Uptime 24h</th><th>Total checks</th><th>Fallos 1h</th>
        <th>Latencia avg</th><th>Latencia p95</th><th>Último check</th>
      </tr></thead>
      <tbody>${filas}</tbody>
    </table>`;
  }

  function pintarTimestamp() {
    const el = document.getElementById('sis-last-update');
    if (el) el.textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // Defensivo: si el DOM ya se reemplazó (turbo nav) y el interval dispara tarde,
  // los elementos pueden ser null. Cancelar el timer en ese caso.
  function pintarError(msg) {
    const txt = document.getElementById('sis-status-text');
    const dot = document.getElementById('sis-status-dot');
    if (!txt || !dot) {
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
      return;
    }
    txt.textContent = 'Error: ' + msg;
    dot.className = 'sis-dot err';
  }

  // ============================================================
  // PINTAR TODO
  // ============================================================
  function pintarTodo(s, externos) {
    pintarKPIs(s);
    pintarCrons(s.crons || []);
    pintarPagos(s.pagos || {});
    pintarCola(s.cola_jobs || {});
    pintarWebhooks(s.webhooks || {});
    pintarAlertas(s.alertas || {});
    pintarExternos(externos);
    pintarStatusGlobal(s, externos);
  }

  function pintarStatusGlobal(s, externos) {
    const problemas = [];
    const cronFail = (s.crons || []).filter(c => c.last_status === 'failed').length;
    if (cronFail > 0) problemas.push(`${cronFail} cron(s) fallaron`);
    if ((s.cola_jobs?.fallidos_24h || 0) > 0) problemas.push(`${s.cola_jobs.fallidos_24h} jobs fallaron 24h`);
    if ((s.pagos?.atrasados_count || 0) > 0) problemas.push(`${s.pagos.atrasados_count} pagos atrasados`);
    const extFail = externos.filter(e => !e.ok).length;
    if (extFail > 0) problemas.push(`${extFail} servicios externos con problema`);
    const matAge = s.matview?.edad_seg || 0;
    if (matAge > 600) problemas.push(`matview KPIs sin refrescar hace ${Math.round(matAge/60)} min`);

    const dot = document.getElementById('sis-status-dot');
    const txt = document.getElementById('sis-status-text');
    if (problemas.length === 0) {
      dot.className = 'sis-dot ok';
      txt.innerHTML = '<strong>Todo OK</strong> · sistema operativo';
    } else if (problemas.length <= 2) {
      dot.className = 'sis-dot warn';
      txt.innerHTML = `<strong>Atención</strong> · ${escapeHtml(problemas.join(', '))}`;
    } else {
      dot.className = 'sis-dot err';
      txt.innerHTML = `<strong>Problemas críticos</strong> · ${escapeHtml(problemas.join(', '))}`;
    }
  }

  // ============================================================
  // KPIs PRINCIPALES
  // ============================================================
  function pintarKPIs(s) {
    const m = s.matview || {};
    const leads = s.leads || {};
    const pagos = s.pagos || {};
    const cola = s.cola_jobs || {};
    const al = s.alertas || {};

    const kpis = [
      { label: 'Clientes activos', num: leads.activos ?? '—', sub: `${leads.total || 0} total · ${leads.calentamiento || 0} calent.`, clase: 'ok' },
      { label: 'Casos éxito',       num: leads.caso_exito ?? '—', sub: 'históricos', clase: 'ok' },
      { label: 'Cash este mes',     num: formatUSD(pagos.cash_mes_usd ?? 0), sub: `mes en curso`, clase: '' },
      { label: 'Pagos atrasados',   num: pagos.atrasados_count ?? 0, sub: formatUSD(pagos.atrasados_usd ?? 0), clase: (pagos.atrasados_count || 0) > 0 ? 'err' : 'ok' },
      { label: 'Alertas activas',   num: al.abiertas_total ?? 0, sub: 'sin resolver', clase: (al.abiertas_total || 0) > 5 ? 'warn' : 'ok' },
      { label: 'Jobs en cola',      num: (cola.pendientes || 0) + (cola.procesando || 0), sub: `${cola.fallidos_24h || 0} fallidos 24h`, clase: (cola.fallidos_24h || 0) > 0 ? 'warn' : 'ok' },
    ];

    document.getElementById('sis-kpis').innerHTML = kpis.map(k =>
      `<div class="sis-kpi ${k.clase}">
        <div class="sis-kpi-label">${k.label}</div>
        <div class="sis-kpi-num">${k.num}</div>
        <div class="sis-kpi-sub">${k.sub}</div>
      </div>`).join('');
  }

  // ============================================================
  // CRONS
  // ============================================================
  function pintarCrons(crons) {
    document.getElementById('sis-crons-meta').textContent = `${crons.length} jobs · ${crons.filter(c => c.last_status === 'succeeded').length} OK`;
    const filas = crons.map(c => {
      const status = c.last_status || 'pendiente';
      const pill = status === 'succeeded' ? 'ok' : status === 'failed' ? 'err' : 'dim';
      const dur = c.last_duration_sec ? `${Math.round(c.last_duration_sec * 1000)}ms` : '—';
      return `<tr>
        <td><strong>${escapeHtml(c.jobname)}</strong></td>
        <td><code>${escapeHtml(c.schedule)}</code></td>
        <td><span class="sis-pill ${pill}">${status}</span></td>
        <td>${tiempoRelativo(c.last_run)}</td>
        <td>${dur}</td>
        <td>${c.active ? '<span class="sis-pill ok">activo</span>' : '<span class="sis-pill dim">pausado</span>'}</td>
      </tr>`;
    }).join('');

    document.getElementById('sis-crons').innerHTML =
      `<table class="sis-tabla">
        <thead><tr><th>Job</th><th>Schedule</th><th>Estado</th><th>Última corrida</th><th>Duración</th><th>Activo</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>`;
  }

  // ============================================================
  // PAGOS
  // ============================================================
  function pintarPagos(p) {
    const meta = `${p.atrasados_count || 0} atrasados · ${p.proximos_7d_count || 0} próx. 7d`;
    document.getElementById('sis-pagos-meta').textContent = meta;

    const grid = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); margin-bottom: var(--space-3);">
        <div class="sis-item ${(p.atrasados_count || 0) > 0 ? 'err' : 'ok'}">
          <div class="sis-item-titulo">${formatUSD(p.atrasados_usd || 0)} atrasado</div>
          <div class="sis-item-meta">${p.atrasados_count || 0} cuota(s)</div>
        </div>
        <div class="sis-item warn">
          <div class="sis-item-titulo">${formatUSD(p.proximos_7d_usd || 0)} próx. 7 días</div>
          <div class="sis-item-meta">${p.proximos_7d_count || 0} cuota(s)</div>
        </div>
      </div>`;

    const proximas = (p.proximas_5 || []).map(x =>
      `<div class="sis-item ${x.estado === 'atrasado' ? 'err' : 'warn'}">
        <div class="sis-item-titulo">${escapeHtml(x.lead_nombre || '—')} · ${formatUSD(x.monto_usd)}</div>
        <div class="sis-item-meta">${x.fecha_programada} · ${escapeHtml(x.estado)}</div>
      </div>`).join('') || '<div style="font-size: 11.5px; color: var(--text-muted); padding: 6px 4px;">Sin cuotas próximas.</div>';

    document.getElementById('sis-pagos').innerHTML = grid +
      `<div style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-muted); margin-bottom: 6px;">Próximas 14 días</div>` +
      proximas;
  }

  // ============================================================
  // COLA DE JOBS
  // ============================================================
  function pintarCola(c) {
    const meta = `${c.pendientes || 0} pend · ${c.procesando || 0} proc · ${c.fallidos_24h || 0} fail`;
    document.getElementById('sis-cola-meta').textContent = meta;

    const summary = `
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: var(--space-3);">
        <div class="sis-item ok"><div class="sis-item-titulo">${c.completados_24h || 0}</div><div class="sis-item-meta">OK 24h</div></div>
        <div class="sis-item warn"><div class="sis-item-titulo">${c.pendientes || 0}</div><div class="sis-item-meta">Pend.</div></div>
        <div class="sis-item warn"><div class="sis-item-titulo">${c.procesando || 0}</div><div class="sis-item-meta">Proc.</div></div>
        <div class="sis-item ${(c.fallidos_24h || 0) > 0 ? 'err' : 'ok'}"><div class="sis-item-titulo">${c.fallidos_24h || 0}</div><div class="sis-item-meta">Fail 24h</div></div>
      </div>`;

    const fallidos = (c.ultimos_fallidos || []).map(f =>
      `<div class="sis-item err">
        <div class="sis-item-titulo">${escapeHtml(f.tipo)}</div>
        <div class="sis-item-meta">${tiempoRelativo(f.completado_at)}</div>
        <div class="sis-item-error">${escapeHtml(truncar(f.error, 200))}</div>
      </div>`).join('');

    document.getElementById('sis-cola').innerHTML = summary +
      (fallidos
        ? `<div style="font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--error); margin-bottom: 6px;">Últimos fallidos</div>` + fallidos
        : '<div style="font-size: 11.5px; color: var(--success); padding: 6px 4px;">✓ Sin fallos recientes</div>');
  }

  // ============================================================
  // WEBHOOKS
  // ============================================================
  function pintarWebhooks(w) {
    const meta = `${w.total_24h || 0} 24h · ${w.errores_24h || 0} con error`;
    document.getElementById('sis-webhooks-meta').textContent = meta;

    const ultimos = (w.ultimos || []).map(u => {
      const err = u.http_status >= 400 || u.error;
      return `<div class="sis-item ${err ? 'err' : 'ok'}">
        <div class="sis-item-titulo">${escapeHtml(u.fuente || '—')} · <span style="font-family: var(--font-mono); font-weight: 400;">HTTP ${u.http_status || '—'}</span></div>
        <div class="sis-item-meta">${tiempoRelativo(u.recibido_at)} · ${escapeHtml(u.resultado || '—')}</div>
        ${u.error ? `<div class="sis-item-error">${escapeHtml(truncar(u.error, 150))}</div>` : ''}
      </div>`;
    }).join('') || '<div style="font-size: 11.5px; color: var(--text-muted); padding: 6px 4px;">Sin webhooks recientes.</div>';

    document.getElementById('sis-webhooks').innerHTML = ultimos;
  }

  // ============================================================
  // ALERTAS
  // ============================================================
  function pintarAlertas(a) {
    const meta = `${a.abiertas_total || 0} abiertas`;
    document.getElementById('sis-alertas-meta').textContent = meta;

    const sevs = a.por_severidad || {};
    const sevList = [
      { key: 'critica', label: 'Críticas', clase: 'err',  color: '#7F1D1D' },
      { key: 'alerta',  label: 'Alertas',  clase: 'err',  color: '#DC2626' },
      { key: 'warn',    label: 'Warnings', clase: 'warn', color: '#F59E0B' },
      { key: 'info',    label: 'Info',     clase: 'ok',   color: '#3B82F6' },
    ];

    const grid = `<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">${
      sevList.map(s => {
        const c = sevs[s.key] || 0;
        return `<div class="sis-item ${c > 0 ? s.clase : 'ok'}">
          <div class="sis-item-titulo" style="color: ${c > 0 ? s.color : 'var(--text)'};">${c}</div>
          <div class="sis-item-meta">${s.label}</div>
        </div>`;
      }).join('')
    }</div>`;

    const sinAlertas = (a.abiertas_total || 0) === 0
      ? '<div style="font-size: 12px; color: var(--success); padding: 8px 4px; margin-top: var(--space-2);">✓ Sin alertas activas. Sistema saludable.</div>'
      : `<div style="font-size: 11.5px; color: var(--text-muted); padding: 6px 4px; margin-top: var(--space-2);">
          <a href="/admin/seguimiento.html" style="color: var(--text);">Ver detalle por cliente →</a>
        </div>`;

    document.getElementById('sis-alertas').innerHTML = grid + sinAlertas;
  }

  // ============================================================
  // EXTERNOS — ping a endpoints + parse status pages
  // ============================================================
  async function pingExternos() {
    const checks = EXTERNOS.map(async ext => {
      const t0 = performance.now();
      try {
        const res = await fetch(ext.url, {
          method: ext.esStatus ? 'GET' : 'HEAD',
          mode: ext.esStatus ? 'cors' : 'no-cors',
          cache: 'no-store',
          credentials: 'omit',
        });
        const t = Math.round(performance.now() - t0);

        // Status pages devuelven JSON con .status.indicator
        if (ext.esStatus) {
          try {
            const body = await res.json();
            const ind = body?.status?.indicator || 'none';
            const ok = ind === 'none' || ind === 'minor';
            return { ...ext, ok, ms: t, indicator: ind, descripcion: body?.status?.description || '—' };
          } catch (_) {
            return { ...ext, ok: false, ms: t, indicator: 'unknown' };
          }
        }

        // Para no-cors, res.status es 0 (opaque) pero la promesa sí resolvió → asumimos OK
        return { ...ext, ok: true, ms: t };
      } catch (e) {
        const t = Math.round(performance.now() - t0);
        return { ...ext, ok: false, ms: t, error: e?.message || 'fetch failed' };
      }
    });
    return Promise.all(checks);
  }

  function pintarExternos(externos) {
    const ITEMS = externos.map(e => {
      const pill = e.ok ? 'ok' : 'err';
      const meta = e.esStatus
        ? `<span class="sis-pill ${pill}">${e.indicator || (e.ok ? 'ok' : 'err')}</span>`
        : `<span class="sis-pill ${pill}">${e.ok ? 'reachable' : 'fail'}</span>`;
      return `<div class="sis-ext">
        ${meta}
        <div class="sis-ext-nombre">${escapeHtml(e.nombre)}</div>
        <div class="sis-ext-tiempo">${e.ms}ms</div>
      </div>`;
    }).join('');

    document.getElementById('sis-externos').innerHTML = `<div class="sis-ext-list">${ITEMS}</div>`;
  }

  // ============================================================
  // UTILS
  // ============================================================
  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function truncar(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }
  function formatUSD(n) {
    if (n === null || n === undefined) return '$0';
    const num = Number(n);
    if (!Number.isFinite(num)) return '$0';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
  }
  function tiempoRelativo(ts) {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return `hace ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `hace ${h}h`;
    const d = Math.floor(h / 24);
    return `hace ${d}d`;
  }
})();
