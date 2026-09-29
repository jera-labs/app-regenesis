// Helpers compartidos
(function () {
  window.utils = {
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
