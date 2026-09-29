// ============================================================================
// Gate de admin. Requiere usuario en `usuarios_admin`.
// Si es admin, devuelve { session, admin }.
// Si no, redirige al app del cliente o al login.
// ============================================================================

(function () {
  async function requireAdmin() {
    const { data: { session } } = await window.db.auth.getSession();
    if (!session) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `${window.rootBase()}login.html?next=${next}`;
      return null;
    }

    // Gate password temporal: admin con flag también pasa por cambio forzado.
    if (session.user?.user_metadata?.password_temporal === true) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Path absoluto desde la raíz del app/ (siempre /cambiar-password.html)
      window.location.href = `/cambiar-password.html?next=${next}`;
      return null;
    }

    // Reusa cache de auth.js (sessionStorage keyed por email).
    // Evita golpear usuarios_admin en cada navegación admin.
    const admin = typeof window.neuroResolverAdmin === 'function'
      ? await window.neuroResolverAdmin(session.user.email)
      : (await window.db
          .from('usuarios_admin')
          .select('id, email, nombre, rol, activo')
          .eq('email', session.user.email)
          .eq('activo', true)
          .maybeSingle()).data;

    if (!admin) {
      // No es admin. Mandarlo al home del cliente.
      window.location.href = `${window.rootBase()}index.html`;
      return null;
    }

    return { session, admin };
  }

  window.requireAdmin = requireAdmin;
})();
