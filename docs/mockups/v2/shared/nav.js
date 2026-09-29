// ==========================================================
// Header común para todos los mockups v2.
// Uso: <div data-nav data-active="hub"></div> + <script src="../shared/nav.js"></script>
// Soporta atributo `data-base` para ajustar paths relativos
// cuando la página está en una subcarpeta.
// ==========================================================

(function () {
  const modules = [
    { id: 'hub',           label: 'Hub',           href: 'hub.html' },
    { id: 'ruta',          label: 'Tu ruta',       href: 'modules/ruta.html' },
    { id: 'success-board', label: 'Hoy',           href: 'modules/success-board.html' },
    { id: 'sales',         label: 'Ventas',        href: 'modules/sales-tracker.html' },
    { id: 'equipo',        label: 'Equipo',        href: 'modules/equipo.html' },
    { id: 'crm',           label: 'CRM',           href: 'modules/ghl-actions.html' },
  ];

  function pintarNav(host) {
    const active = host.dataset.active || 'hub';
    const base = host.dataset.base || '';
    const user = host.dataset.user || 'Alexander González';
    const initials = user.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

    host.innerHTML = `
      <header class="app-header">
        <div class="app-header-inner">
          <a href="${base}hub.html" class="brand">
            <div class="brand-logo">N</div>
            <div class="brand-name">
              <span class="brand-name-main">Neurohackers</span>
              <span class="brand-name-sub">Plataforma</span>
            </div>
          </a>
          <nav class="nav-modules">
            ${modules.map(m => `
              <a href="${base}${m.href}" class="nav-module ${m.id === active ? 'active' : ''}">
                ${m.label}
              </a>
            `).join('')}
          </nav>
          <div class="header-right">
            <div class="header-search">
              <span>⌕</span>
              <span>Buscar acción, recurso...</span>
            </div>
            <button class="header-icon-btn header-icon-btn-badge" aria-label="Notificaciones">◌</button>
            <div class="user-pill">
              <div class="user-avatar">${initials}</div>
              <span>${user.split(' ')[0]}</span>
            </div>
          </div>
        </div>
      </header>
    `;
  }

  document.querySelectorAll('[data-nav]').forEach(pintarNav);
})();

// ==========================================================
// Preview navigator (botón flotante para Frank navegue
// rápidamente entre todas las pantallas del mockup)
// ==========================================================

(function () {
  const screens = [
    { id: 'index',         label: 'Inicio',        href: 'index.html' },
    { id: 'login',         label: 'Login',         href: 'login.html' },
    { id: 'onboarding',    label: 'Onboarding',    href: 'onboarding.html' },
    { id: 'assessment',    label: 'Assessment',    href: 'assessment.html' },
    { id: 'hub',           label: 'Hub',           href: 'hub.html' },
    { id: 'ruta',          label: 'Tu ruta',       href: 'modules/ruta.html' },
    { id: 'success-board', label: 'Hoy',           href: 'modules/success-board.html' },
    { id: 'sales',         label: 'Ventas',        href: 'modules/sales-tracker.html' },
    { id: 'sales-lab',     label: 'Sales Lab',     href: 'modules/sales-lab.html' },
    { id: 'gerencia',      label: 'Gerencia',      href: 'modules/gerencia.html' },
    { id: 'marketing',     label: 'Marketing',     href: 'modules/marketing.html' },
    { id: 'tech',          label: 'Tech',          href: 'modules/tech.html' },
    { id: 'regenesis',     label: 'Re-Génesis',    href: 'modules/regenesis.html' },
    { id: 'skool',         label: 'Academia',      href: 'modules/skool.html' },
    { id: 'crm',           label: 'CRM',           href: 'modules/ghl-actions.html' },
    { id: 'admin',         label: 'Admin',         href: 'admin/admin.html' },
  ];

  const host = document.querySelector('[data-preview-nav]');
  if (!host) return;
  const active = host.dataset.active || '';
  const base = host.dataset.base || '';

  const nav = document.createElement('div');
  nav.className = 'preview-nav';
  nav.innerHTML = screens.map(s => `
    <a href="${base}${s.href}" class="${s.id === active ? 'active' : ''}">${s.label}</a>
  `).join('');
  document.body.appendChild(nav);
})();
