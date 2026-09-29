/* ============================================================
   Auth gate del Studio.
   - Requiere sesión Supabase (compartida con plataforma).
   - Si no hay sesión → redirect a login de plataforma con next=/studio/...
   - Expone window.requireStudioAuth() y window.requireStudioAdmin().
   ============================================================ */

(function () {
  const PLATAFORMA_URL = 'https://plataforma.neurohackers.cloud/';

  async function requireStudioAuth() {
    const { data: { session } } = await window.db.auth.getSession();
    if (!session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${PLATAFORMA_URL}login.html?next=${next}`;
      return null;
    }
    // Identificar al usuario: puede ser admin, lead, o ambos
    const email = session.user.email;
    const [admRes, leadRes] = await Promise.all([
      window.db.from('usuarios_admin').select('email, nombre, rol').eq('email', email).eq('activo', true).maybeSingle(),
      window.db.from('leads').select('id, nombre, email').eq('email', email).maybeSingle(),
    ]);
    const admin = admRes.data || null;
    const lead  = leadRes.data || null;
    if (!admin && !lead) {
      // Usuario logueado pero sin acceso al studio
      document.body.innerHTML = `
        <div style="max-width: 480px; margin: 80px auto; padding: 32px; text-align: center; font-family: system-ui;">
          <h2>Sin acceso</h2>
          <p>Tu cuenta no está registrada como cliente ni administrador. Contacta al equipo de Neurohackers.</p>
          <p><a href="${PLATAFORMA_URL}login.html">Volver al login</a></p>
        </div>
      `;
      return null;
    }
    return { session, admin, lead };
  }

  async function requireStudioAdmin() {
    const auth = await requireStudioAuth();
    if (!auth) return null;
    if (!auth.admin || auth.admin.rol !== 'admin') {
      document.body.innerHTML = `
        <div style="max-width: 480px; margin: 80px auto; padding: 32px; text-align: center; font-family: system-ui;">
          <h2>Solo admin</h2>
          <p>Esta sección es solo para administradores.</p>
          <p><a href="/studio/index.html">Volver al inicio</a></p>
        </div>
      `;
      return null;
    }
    return auth;
  }

  // requireStudioModulo: gate por módulo (ej: 'contenido-instagram').
  // - Admin: bypass total.
  // - Cliente: el módulo debe estar activo en modulos_cliente, o si no hay
  //   override, debe tener default_activo=true en modulos_catalogo.
  // - Si NO está activo: pinta página de "Sin acceso" + link al dashboard
  //   y retorna null.
  async function requireStudioModulo(slug) {
    const auth = await requireStudioAuth();
    if (!auth) return null;
    // Admin bypass
    if (auth.admin && (auth.admin.rol === 'admin' || auth.admin.rol === 'moderador' || auth.admin.rol === 'lector')) {
      return auth;
    }
    // Cliente: necesita el módulo activo para su lead
    if (!auth.lead) {
      mostrarSinAcceso(slug, 'Tu cuenta no tiene perfil de cliente asociado.');
      return null;
    }
    let activo = false;
    try {
      const { data: override } = await window.db.from('modulos_cliente')
        .select('activo').eq('lead_id', auth.lead.id).eq('modulo_slug', slug).maybeSingle();
      if (override) {
        activo = !!override.activo;
      } else {
        const { data: cat } = await window.db.from('modulos_catalogo')
          .select('default_activo').eq('slug', slug).maybeSingle();
        activo = !!cat?.default_activo;
      }
    } catch (e) {
      console.error('[requireStudioModulo] error consultando módulo', slug, e);
    }
    if (!activo) {
      mostrarSinAcceso(slug, 'Este módulo todavía no está activo para tu cuenta. Pídele al equipo de Neurohackers que te lo habilite.');
      return null;
    }
    return auth;
  }

  function mostrarSinAcceso(slug, mensaje) {
    document.body.innerHTML = `
      <div style="max-width: 540px; margin: 80px auto; padding: 32px; text-align: center; font-family: system-ui, -apple-system, sans-serif;">
        <div style="font-size: 48px; margin-bottom: 12px;">🔒</div>
        <h2 style="margin: 0 0 12px; font-size: 22px;">Módulo no activado</h2>
        <p style="color: #6E6E73; line-height: 1.55; margin-bottom: 12px;">${mensaje}</p>
        <p style="font-family: monospace; font-size: 12px; color: #999; margin-bottom: 24px;">Módulo solicitado: <code>${slug}</code></p>
        <a href="/studio/index.html" style="display: inline-block; padding: 10px 18px; background: #D4AF37; color: #1D1D1F; border-radius: 8px; text-decoration: none; font-weight: 600;">Volver al inicio del Studio</a>
        <p style="margin-top: 20px;"><a href="https://plataforma.neurohackers.cloud/" style="color: #6E6E73; font-size: 13px;">o ir a la plataforma principal</a></p>
      </div>`;
  }

  window.requireStudioAuth = requireStudioAuth;
  window.requireStudioAdmin = requireStudioAdmin;
  window.requireStudioModulo = requireStudioModulo;
})();
