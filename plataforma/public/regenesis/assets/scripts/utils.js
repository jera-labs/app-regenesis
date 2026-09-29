// ============================================
// Re-Génesis — Utilidades comunes
// ============================================
// Expone window.utils con helpers de DOM, fecha,
// texto y mensajes.

(function () {
  'use strict';

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(mensaje, tipo) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = mensaje;
    toast.className = 'toast visible' +
      (tipo === 'error' ? ' error' : tipo === 'success' ? ' success' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MESES_UPPER = MESES_LARGOS.map(m => m.toUpperCase());
  const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN',
    'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const DIAS_LARGOS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DIAS_CORTOS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

  function formatearFechaCorta(fecha) {
    // `new Date("2026-04-28")` se interpreta como UTC 00:00. En timezones
    // negativos (Bogotá -05, Eastern -04/-05) eso se ve como el día ANTERIOR
    // a las 19:00-20:00 hora local → las columnas DATE aparecían 1 día antes
    // en el render. Fix: strings YYYY-MM-DD se parsean como medianoche LOCAL.
    // Los timestamps con hora (T...) siguen el parser nativo.
    let d;
    if (fecha instanceof Date) {
      d = fecha;
    } else if (typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      const [year, month, day] = fecha.split('-').map(Number);
      d = new Date(year, month - 1, day);
    } else {
      d = new Date(fecha);
    }
    return `${DIAS_CORTOS[d.getDay()]} · ${d.getDate()} ${MESES_CORTOS[d.getMonth()]} · ${d.getFullYear()}`;
  }

  function tiempoRelativo(fechaIso) {
    const d = new Date(fechaIso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const dias = Math.floor(diff / 86400000);
    if (min < 1) return 'Hace un momento';
    if (min < 60) return `Hace ${min} min`;
    if (hrs < 24) return `Hace ${hrs} h`;
    if (dias === 1) return 'Ayer';
    if (dias < 7) return `Hace ${dias} días`;
    return formatearFechaCorta(d);
  }

  function contarPalabras(texto) {
    if (!texto) return 0;
    return texto.trim().split(/\s+/).filter(Boolean).length;
  }

  // EXTENDER window.utils en vez de sobrescribir. /shared/scripts/utils.js
  // de plataforma define formatMoney, tipoLabel, toast, etc. que nav.js y
  // otros scripts usan. Si sobrescribimos perdemos todo eso al navegar via
  // Turbo desde otras páginas de plataforma.
  const helpers = {
    escapeHtml,
    showToast,
    formatearFechaCorta,
    tiempoRelativo,
    contarPalabras,
    MESES_LARGOS,
    MESES_UPPER,
    MESES_CORTOS,
    DIAS_LARGOS,
    DIAS_CORTOS,
  };
  window.utils = Object.assign({}, window.utils || {}, helpers);
})();
