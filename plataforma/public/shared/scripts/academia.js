// ============================================================================
// academia.js · helpers del módulo Academia (cursos en video + comunidad)
//
// MÓDULO AISLADO: este archivo solo lo cargan las páginas de /modules/academia/
// y /admin/academia.html. Si algo aquí falla, NO afecta al resto de la plataforma.
// Todo el tracking de video está envuelto en try/catch: un error de logging
// nunca interrumpe la reproducción.
//
// Núcleo: attachPlayer() instrumenta un <video> nativo y reporta a Supabase
// los segmentos realmente vistos (no solo la posición), vía el RPC
// academia_registrar_progreso (que fusiona server-side). Eventos discretos
// (play/pause/seek/ended/abandono) se guardan en academia_eventos_video.
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') throw new Error('[academia.js] Falta supabase-client.js');

  const BUCKET = 'academia';

  // Helper interno: trackEvent del event-tracker compartido, si existe (defensivo).
  function track(accion, metadata) {
    try { if (typeof window.trackEvent === 'function') window.trackEvent('video', { accion, ...metadata }); } catch (_) {}
  }

  window.academiaApi = {

    // ===== Catálogo (cliente) =====
    async listarCursos() {
      const { data, error } = await window.db
        .from('academia_cursos').select('*')
        .eq('visible_cliente', true)
        .order('orden');
      if (error) throw error;
      return data || [];
    },

    async obtenerCurso(slug) {
      const { data, error } = await window.db
        .from('academia_cursos').select('*').eq('slug', slug).maybeSingle();
      if (error) throw error;
      return data;
    },

    async listarLecciones(cursoId) {
      const { data, error } = await window.db
        .from('academia_lecciones').select('*').eq('curso_id', cursoId).order('orden');
      if (error) throw error;
      return data || [];
    },

    // Progreso del lead (todas sus filas). El UI mapea por leccion_id / curso_id.
    async progresoDelLead(leadId) {
      const { data, error } = await window.db
        .from('academia_progreso').select('*').eq('lead_id', leadId);
      if (error) throw error;
      return data || [];
    },

    // Signed URL on-demand para reproducir (patrón testimonios).
    async signedVideoUrl(path, segundos = 3600) {
      if (!path) return '';
      const { data, error } = await window.db.storage.from(BUCKET).createSignedUrl(path, segundos);
      if (error) throw error;
      return data?.signedUrl || '';
    },

    // ===== Escritura de progreso (cliente) =====
    // El cliente manda segmentos nuevos; el server fusiona y recalcula el pct.
    async registrarProgreso(leccionId, segmentos, ultimoSeg, duracionTotal, completar = false) {
      const { data, error } = await window.db.rpc('academia_registrar_progreso', {
        p_leccion_id: leccionId,
        p_segmentos: segmentos || [],
        p_ultimo_seg: Math.max(0, Math.floor(ultimoSeg || 0)),
        p_duracion_total: duracionTotal ? Math.floor(duracionTotal) : null,
        p_completar: !!completar,
      });
      if (error) throw error;
      return data;
    },

    async registrarEvento(leadId, leccionId, tipo, segundo, pct) {
      const { error } = await window.db.from('academia_eventos_video').insert({
        lead_id: leadId,
        leccion_id: leccionId,
        tipo,
        segundo: segundo != null ? Math.floor(segundo) : null,
        pct: pct != null ? Math.round(pct * 100) / 100 : null,
      });
      if (error) throw error;
    },

    // ===== Instrumentación del reproductor =====
    // videoEl: <video>; leccion: {id, duracion_seg}; leadId; opts:
    //   { ultimoSegundo (reanudar), onUpdate(progresoRow) }
    // Devuelve un objeto con detach() por si la página lo necesita.
    attachPlayer(videoEl, leccion, leadId, opts = {}) {
      const FLUSH_MS = 15000;       // sube progreso cada 15s de reproducción
      const COMPLETO_PCT = 90;      // espejo del umbral del RPC
      let pendingSegs = [];         // [[ini,fin], ...] desde el último flush
      let segStart = null;          // inicio del segmento abierto (si reproduciendo)
      let lastTime = 0;             // última posición conocida (para cierres por seek)
      let flushTimer = null;
      let detached = false;

      const dur = () => (videoEl.duration && isFinite(videoEl.duration)) ? videoEl.duration : (leccion.duracion_seg || 0);
      const pct = () => { const d = dur(); return d > 0 ? Math.min(100, (videoEl.currentTime / d) * 100) : null; };

      function openSeg() { if (segStart == null) segStart = videoEl.currentTime; }
      function closeSeg(endAt) {
        if (segStart == null) return;
        const end = (endAt != null ? endAt : videoEl.currentTime);
        if (end > segStart + 0.4) pendingSegs.push([Math.max(0, segStart), end]);
        segStart = null;
      }

      async function flush(completar) {
        try {
          const reanudar = Math.floor(videoEl.currentTime || 0);
          const segs = pendingSegs; pendingSegs = [];
          if (segs.length === 0 && !completar) {
            // aún así actualizamos ultimo_segundo de vez en cuando
            const row = await window.academiaApi.registrarProgreso(leccion.id, [], reanudar, dur(), false);
            if (typeof opts.onUpdate === 'function') opts.onUpdate(row);
            return;
          }
          const row = await window.academiaApi.registrarProgreso(leccion.id, segs, reanudar, dur(), !!completar);
          if (typeof opts.onUpdate === 'function') opts.onUpdate(row);
        } catch (e) { /* aislado: no romper la reproducción */ console.warn('[academia] flush', e?.message || e); }
      }

      async function evento(tipo) {
        try { await window.academiaApi.registrarEvento(leadId, leccion.id, tipo, videoEl.currentTime, pct()); } catch (_) {}
        track(tipo, { leccion_id: leccion.id, segundo: Math.floor(videoEl.currentTime || 0), pct: Math.round(pct() || 0) });
      }

      function startTimer() {
        stopTimer();
        flushTimer = setInterval(() => { if (!videoEl.paused) { closeSeg(); flush(false); openSeg(); } }, FLUSH_MS);
      }
      function stopTimer() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

      const onPlay   = () => { openSeg(); startTimer(); evento('play'); };
      const onPause  = () => { closeSeg(); stopTimer(); flush(false); evento('pause'); };
      const onTime   = () => { lastTime = videoEl.currentTime; };
      const onSeeking= () => { closeSeg(lastTime); evento('seek'); };
      const onSeeked = () => { if (!videoEl.paused) segStart = videoEl.currentTime; lastTime = videoEl.currentTime; };
      const onEnded  = () => { closeSeg(); stopTimer(); flush(true); evento('ended'); };
      const onHide   = () => { if (document.visibilityState === 'hidden') { closeSeg(); evento('abandono'); flush(false); } };
      const onPageHide = () => { closeSeg(); evento('abandono'); flush(false); };

      // Reanudar: al cargar metadata, saltar a ultimo_segundo (si tiene sentido).
      const onMeta = () => {
        try {
          const u = Math.floor(opts.ultimoSegundo || 0);
          if (u > 3 && dur() > 0 && u < dur() - 5) { videoEl.currentTime = u; evento('resume'); }
        } catch (_) {}
      };

      videoEl.addEventListener('play', onPlay);
      videoEl.addEventListener('pause', onPause);
      videoEl.addEventListener('timeupdate', onTime);
      videoEl.addEventListener('seeking', onSeeking);
      videoEl.addEventListener('seeked', onSeeked);
      videoEl.addEventListener('ended', onEnded);
      if (videoEl.readyState >= 1) onMeta(); else videoEl.addEventListener('loadedmetadata', onMeta, { once: true });
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onPageHide);

      return {
        detach() {
          if (detached) return; detached = true;
          stopTimer();
          try { closeSeg(); flush(false); } catch (_) {}
          videoEl.removeEventListener('play', onPlay);
          videoEl.removeEventListener('pause', onPause);
          videoEl.removeEventListener('timeupdate', onTime);
          videoEl.removeEventListener('seeking', onSeeking);
          videoEl.removeEventListener('seeked', onSeeked);
          videoEl.removeEventListener('ended', onEnded);
          document.removeEventListener('visibilitychange', onHide);
          window.removeEventListener('pagehide', onPageHide);
        }
      };
    },

    // ===== Admin: gestión de catálogo =====
    async adminListarCursos() {
      const { data, error } = await window.db.from('academia_cursos').select('*').order('orden');
      if (error) throw error; return data || [];
    },
    async crearCurso({ slug, nombre, descripcion, servicio_requerido, orden }) {
      const s = (slug || nombre || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data, error } = await window.db.from('academia_cursos')
        .insert({ slug: s, nombre: (nombre || '').trim(), descripcion: descripcion || null, servicio_requerido: servicio_requerido || null, orden: orden || 100 })
        .select().single();
      if (error) throw error; return data;
    },
    async crearLeccion({ curso_id, slug, nombre, orden, video_path, duracion_seg, descripcion }) {
      const s = (slug || nombre || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const { data, error } = await window.db.from('academia_lecciones')
        .insert({ curso_id, slug: s, nombre: (nombre || '').trim(), orden: orden || 100, video_path: video_path || null, duracion_seg: duracion_seg || null, descripcion: descripcion || null })
        .select().single();
      if (error) throw error; return data;
    },
    async subirVideo(file, cursoId, leccionId) {
      const path = `${cursoId}/${leccionId}.mp4`;
      const { error } = await window.db.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type || 'video/mp4' });
      if (error) throw error;
      return path;
    },

    // ===== Admin: analítica =====
    // Progreso agregado de una lección (todos los leads).
    async analiticaLeccion(leccionId) {
      const { data, error } = await window.db
        .from('academia_progreso').select('lead_id, pct_visto, completado_at, ultimo_segundo, max_segundo_alcanzado')
        .eq('leccion_id', leccionId);
      if (error) throw error; return data || [];
    },
    // Eventos de abandono de una lección → para el mapa de "dónde se caen".
    async abandonosLeccion(leccionId) {
      const { data, error } = await window.db
        .from('academia_eventos_video').select('segundo, ocurrio_at')
        .eq('leccion_id', leccionId).in('tipo', ['abandono', 'pause']);
      if (error) throw error; return data || [];
    },
  };
})();
