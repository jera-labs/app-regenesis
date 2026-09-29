// Helpers compartidos
(function () {
  // Aliases globales para no romper código que asume window.escapeHtml / window.showToast.
  // Sin estos, dashboards.html y automatizaciones.html crashean al renderizar.
  window.escapeHtml = function (s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  window.showToast = function (msg, type = 'info', durationMs = 3500) {
    if (window.utils?.toast) return window.utils.toast(msg, type, durationMs);
    // Fallback ultra simple si utils aún no cargó
    console.log('[toast]', type, msg);
  };

  window.utils = {
    MESES_UPPER: ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],
    escapeHtml(s) {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    toast(msg, type = 'info', durationMs = 3500) {
      const t = document.createElement('div');
      t.className = `toast toast-${type}`;
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      setTimeout(() => {
        t.classList.remove('show');
        setTimeout(() => t.remove(), 250);
      }, durationMs);
    },

    // Modal de confirmación no-bloqueante (reemplazo de window.confirm).
    // Retorna Promise<boolean>. Cierra al click en overlay (cancel) o ESC.
    confirmAsync(mensaje, { okText = 'Confirmar', cancelText = 'Cancelar', danger = false } = {}) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;animation:fadeIn 0.15s ease-out;';

        const box = document.createElement('div');
        box.style.cssText = 'background:var(--surface,#fff);border-radius:12px;padding:20px 22px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,0.2);';

        const txt = document.createElement('div');
        txt.style.cssText = 'font-size:14px;line-height:1.5;color:var(--text,#111);margin-bottom:18px;white-space:pre-wrap;';
        txt.textContent = mensaje;
        box.appendChild(txt);

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-ghost btn-sm';
        cancel.textContent = cancelText;
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = danger ? 'btn btn-error btn-sm' : 'btn btn-accent btn-sm';
        ok.textContent = okText;

        const close = (val) => {
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          resolve(val);
        };
        const onKey = (e) => {
          if (e.key === 'Escape') close(false);
          if (e.key === 'Enter') close(true);
        };
        document.addEventListener('keydown', onKey);
        cancel.addEventListener('click', () => close(false));
        ok.addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });

        row.appendChild(cancel);
        row.appendChild(ok);
        box.appendChild(row);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        setTimeout(() => ok.focus(), 50);
      });
    },

    // Reemplazo de window.alert con la misma UX visual del modal de confirm.
    alertAsync(mensaje, { okText = 'OK' } = {}) {
      return this.confirmAsync(mensaje, { okText, cancelText: okText });
    },
    formatMoney(n, currency = 'USD') {
      if (n === null || n === undefined) return '-';
      const num = Number(n);
      if (!Number.isFinite(num)) return '-';
      const sym = currency === 'USD' ? '$' : (currency + ' ');
      return sym + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    },
    tipoLabel(tipo) {
      const map = {
        servicio_high_ticket: 'Servicio · Alto Ticket',
        servicio_medio: 'Servicio · Ticket Medio',
        servicio_bajo: 'Servicio · Bajo Ticket',
        digital: 'Producto Digital',
        fisico: 'Producto Físico',
        membresia: 'Membresía',
        otro: 'Otro',
      };
      return map[tipo] || tipo || '-';
    },
    iconoTipo(tipo) {
      const map = {
        servicio_high_ticket: '▦',
        servicio_medio: '◈',
        servicio_bajo: '◌',
        digital: '◰',
        fisico: '◇',
        membresia: '∼',
        otro: '○',
      };
      return map[tipo] || '◈';
    },
    saludLabel(score) {
      if (score === null || score === undefined) return { texto: 'Sin auditar', color: 'muted' };
      const s = Number(score);
      if (s >= 90) return { texto: 'Listo para escalar', color: 'success' };
      if (s >= 70) return { texto: 'Viable, ajuste menor', color: 'success' };
      if (s >= 50) return { texto: 'Necesita ajustes', color: 'warning' };
      if (s >= 30) return { texto: 'Reformular', color: 'warning' };
      return { texto: 'Empaquetar como MVP', color: 'error' };
    },
    qs(key) {
      return new URLSearchParams(window.location.search).get(key);
    },
  };
})();
