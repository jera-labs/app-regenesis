// Header ultra-minimal v3
(function () {
  function pintarHeader(host) {
    const base = host.dataset.base || '';
    const active = host.dataset.active || 'hub';
    const user = host.dataset.user || 'Alexander González';
    const initials = user.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

    host.innerHTML = `
      <header class="app-header">
        <div class="app-header-inner">
          <a href="${base}hub.html" class="brand">
            <div class="brand-logo">N</div>
            <span>Neurohackers</span>
          </a>
          <div class="header-right">
            <a href="${base}mas.html" class="header-mas ${active === 'mas' ? 'active' : ''}">
              Más <span style="font-size: 9px; opacity: 0.6;">▾</span>
            </a>
            <div class="user-pill">
              <div class="user-avatar">${initials}</div>
              <span>${user.split(' ')[0]}</span>
            </div>
          </div>
        </div>
      </header>
    `;
  }
  document.querySelectorAll('[data-nav]').forEach(pintarHeader);
})();

// Preview nav (botón flotante para Frank)
(function () {
  const screens = [
    { id: 'index',          label: 'Inicio',         href: 'index.html' },
    { id: 'assessment',     label: 'Assessment',     href: 'assessment.html' },
    { id: 'validacion',     label: 'Validar oferta', href: 'validacion-producto.html' },
    { id: 'hub',            label: 'Hub',            href: 'hub.html' },
    { id: 'regenesis',      label: 'Re-Génesis',     href: 'modules/regenesis-dia.html' },
    { id: 'ruta',           label: 'Ruta',           href: 'modules/ruta.html' },
    { id: 'mas',            label: 'Más',            href: 'mas.html' },
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
