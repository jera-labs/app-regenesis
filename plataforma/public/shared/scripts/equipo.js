// ============================================================================
// equipo.js · helpers para gestión de equipo, roles funcionales y asignaciones
//
// Roles de permiso:  admin | moderador | lector
// Roles funcionales: closer | mentor_gerencia | mentor_marketing | ... (dinámico)
// ============================================================================

(function () {
  window.equipoApi = {

    // --- Miembros del equipo (usuarios_admin) ---

    async listarMiembros() {
      const { data, error } = await window.db
        .from('usuarios_admin')
        .select('id, email, nombre, rol, activo, ultimo_login, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async crearMiembro({ email, nombre, rol }) {
      // Insertar fila en usuarios_admin (RLS exige que quien llame sea admin)
      const { data, error } = await window.db
        .from('usuarios_admin')
        .insert({ email: email.toLowerCase().trim(), nombre, rol, activo: true })
        .select().single();
      if (error) throw error;
      return data;
    },

    async actualizarMiembro(id, cambios) {
      const allowed = ['nombre','rol','activo'];
      const payload = {};
      for (const k of allowed) if (cambios[k] !== undefined) payload[k] = cambios[k];
      const { data, error } = await window.db
        .from('usuarios_admin').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async desactivarMiembro(id) {
      return this.actualizarMiembro(id, { activo: false });
    },

    // --- Roles funcionales dinámicos ---

    async listarRolesFuncionales() {
      const fetcher = async () => {
        const { data, error } = await window.db
          .from('roles_funcionales')
          .select('*').eq('activo', true).order('nombre', { ascending: true });
        if (error) throw error;
        return data || [];
      };
      // 1h TTL: catálogo casi inmutable.
      if (window.neuroCache) {
        return window.neuroCache.get('roles_funcionales_activos', fetcher, { ttlMs: 60 * 60 * 1000 });
      }
      return fetcher();
    },

    async crearRolFuncional({ slug, nombre, descripcion, color, icono, url }) {
      const payload = {
        slug: slug.toLowerCase().trim().replace(/\s+/g, '_'),
        nombre: nombre.trim(),
        descripcion: descripcion || null,
        color: color || '#86868B',
        icono: icono || '◇',
        url: url || null,
      };
      const { data, error } = await window.db
        .from('roles_funcionales').insert(payload).select().single();
      if (error) throw error;
      return data;
    },

    async actualizarRolFuncional(id, { nombre, descripcion, color, icono, url, slug }) {
      const updates = {};
      if (nombre !== undefined)      updates.nombre      = nombre.trim();
      if (descripcion !== undefined) updates.descripcion = descripcion || null;
      if (color !== undefined)       updates.color       = color;
      if (icono !== undefined)       updates.icono       = icono;
      if (url !== undefined)         updates.url         = url || null;
      if (slug !== undefined)        updates.slug        = slug.toLowerCase().trim().replace(/\s+/g, '_');
      const { data, error } = await window.db
        .from('roles_funcionales').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    async desactivarRolFuncional(id) {
      const { data, error } = await window.db
        .from('roles_funcionales').update({ activo: false }).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },

    // --- Asignaciones ---

    async asignacionesDelLead(leadId) {
      const { data, error } = await window.db
        .from('lead_asignaciones')
        .select(`
          id, asignado_at, notas,
          usuario_admin:usuario_admin_id (id, email, nombre, rol, activo),
          rol_funcional:rol_funcional_id (id, slug, nombre, color, icono),
          asignado_por_user:asignado_por (id, email, nombre)
        `)
        .eq('lead_id', leadId)
        .order('asignado_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },

    async leadsDelMiembro(usuarioAdminId) {
      // Devuelve los lead_ids únicos a los que está asignado este miembro
      const { data, error } = await window.db
        .from('lead_asignaciones')
        .select('lead_id, rol_funcional:rol_funcional_id (slug, nombre)')
        .eq('usuario_admin_id', usuarioAdminId);
      if (error) throw error;
      return data || [];
    },

    async asignacionesDelMiembro(usuarioAdminId) {
      // Lista completa de asignaciones del miembro con el nombre del cliente y el rol funcional
      const { data, error } = await window.db
        .from('lead_asignaciones')
        .select(`
          id, asignado_at, notas,
          lead:lead_id (id, email, nombre),
          rol_funcional:rol_funcional_id (slug, nombre, color, icono)
        `)
        .eq('usuario_admin_id', usuarioAdminId)
        .order('asignado_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async crearAsignacion({ lead_id, usuario_admin_id, rol_funcional_id, asignado_por, notas }) {
      const { data, error } = await window.db
        .from('lead_asignaciones')
        .insert({ lead_id, usuario_admin_id, rol_funcional_id, asignado_por, notas: notas || null })
        .select().single();
      if (error) throw error;
      return data;
    },

    async eliminarAsignacion(id) {
      const { error } = await window.db
        .from('lead_asignaciones').delete().eq('id', id);
      if (error) throw error;
    },

    // --- Helper: ¿soy admin? ---
    // Reusa el cache de auth.js (window.neuroResolverAdmin) para no consultar
    // usuarios_admin en cada navegación. Cache por sesión, keyed por email.

    async miRol() {
      const { data: { session } } = await window.db.auth.getSession();
      if (!session) return null;
      if (typeof window.neuroResolverAdmin === 'function') {
        return await window.neuroResolverAdmin(session.user.email);
      }
      // Fallback si auth.js no cargó (no debería pasar)
      const { data } = await window.db
        .from('usuarios_admin')
        .select('id, email, nombre, rol')
        .eq('email', session.user.email)
        .eq('activo', true)
        .maybeSingle();
      return data || null;
    },

    // --- Historial de cambios ---

    async historialDelLead(leadId, limit = 50) {
      const { data, error } = await window.db
        .from('historial_cambios')
        .select(`id, tabla, accion, valor_anterior, valor_nuevo, modificado_at,
                 modificado_por_email, modificado_por_user:modificado_por (nombre)`)
        .eq('lead_id', leadId)
        .order('modificado_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
    },

    // Helper: extraer un diff legible entre valor_anterior y valor_nuevo
    extraerDiff(cambio) {
      if (cambio.accion === 'INSERT') {
        return [{ campo: '(creación)', anterior: null, nuevo: 'fila creada' }];
      }
      if (cambio.accion === 'DELETE') {
        return [{ campo: '(borrado)', anterior: 'fila existía', nuevo: null }];
      }
      const anterior = cambio.valor_anterior || {};
      const nuevo = cambio.valor_nuevo || {};
      const diffs = [];
      const keys = new Set([...Object.keys(anterior), ...Object.keys(nuevo)]);
      for (const k of keys) {
        if (k === 'updated_at' || k === 'ultima_actualizacion_at') continue;
        const a = anterior[k], n = nuevo[k];
        if (JSON.stringify(a) !== JSON.stringify(n)) {
          diffs.push({ campo: k, anterior: a, nuevo: n });
        }
      }
      return diffs;
    },
  };
})();
