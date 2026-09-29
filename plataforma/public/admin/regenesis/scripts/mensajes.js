// ============================================
// Re-Génesis Admin · Mensajes (144 templates)
// ============================================
// Editor de los 144 mensajes del programa (10 temas × 7 días × varios tipos)
// + 7 mensajes de la "Sala de espera" (calentamiento previo al día 1).
//
// Filtros: dropdown de tema (incluye "Sala de espera") + dropdown de modalidad.
// Cada mensaje tiene su textarea con auto-detección de cambios y botón Guardar.
//
// Depende de: window.db, window.requireAdmin, window.utils.

(function () {
  'use strict';

  function _deps() {
    const u = window.utils || {};
    return {
      escapeHtml: u.escapeHtml || ((s) => s == null ? '' : String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]))),
      toast: u.toast || ((m) => console.log('[toast]', m)),
    };
  }

  const TIPO_LABELS = {
    journaling: 'Pregunta diaria',
    sesion_aviso_previo: 'Aviso del día anterior',
    sesion_calentamiento: 'Activación pre-sesión',
    sesion_nutricion: 'Recomendación nutricional',
    sesion_recordatorio: 'Recordatorio (2h antes)',
    skool_modulo: 'Módulo de Skool',
  };
  const DIA_NOMBRE_LARGO = {
    1: 'LUNES', 2: 'MARTES', 3: 'MIÉRCOLES', 4: 'JUEVES',
    5: 'VIERNES', 6: 'SÁBADO', 7: 'DOMINGO',
  };
  const MODALIDAD_LABELS = {
    presencial: 'PRESENCIAL',
    virtual: 'VIRTUAL',
    ambas: 'AMBAS',
  };
  function sessionTagFor(dia, modalidad) {
    if (dia === 2 && modalidad === 'presencial') return 'SESIÓN PRESENCIAL · 18:45 · FRANK';
    if (dia === 3 && modalidad === 'virtual')    return 'SESIÓN VIRTUAL · 19:00 · FRANK';
    if (dia === 4) return 'SESIÓN GRUPAL · 19:00 · TATIANA';
    return null;
  }

  let temasCache = [];

  async function init() {
    document.querySelectorAll('[data-logout]').forEach(b =>
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof window.signOut === 'function') return window.signOut();
        window.db.auth.signOut().then(() => { window.location.href = '/login.html'; });
      }));

    if (typeof window.requireAdmin !== 'function') {
      console.error('[RG/Admin/Mensajes] requireAdmin no cargó.');
      return;
    }
    const auth = await window.requireAdmin();
    if (!auth || !auth.session) return;

    // Cargar temas
    const { data: temas } = await window.db.from('temas').select('*').order('orden');
    temasCache = temas || [];
    pintarSelectorTemas();

    // Listeners
    document.getElementById('mensajes-tema-filter')?.addEventListener('change', cargarMensajes);
    document.getElementById('mensajes-modalidad-filter')?.addEventListener('change', cargarMensajes);

    document.body.classList.add('regenesis-ready');
  }

  function pintarSelectorTemas() {
    const sel = document.getElementById('mensajes-tema-filter');
    if (!sel) return;
    while (sel.options.length > 0) sel.remove(0);

    const optDefault = document.createElement('option');
    optDefault.value = '';
    optDefault.textContent = 'Selecciona una semana...';
    sel.appendChild(optDefault);

    const optCal = document.createElement('option');
    optCal.value = 'calentamiento';
    optCal.textContent = 'Sala de espera (7 días previos)';
    sel.appendChild(optCal);

    const optSep = document.createElement('option');
    optSep.value = '';
    optSep.disabled = true;
    optSep.textContent = '──────────';
    sel.appendChild(optSep);

    temasCache.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `Tema ${String(t.orden).padStart(2, '0')} · ${t.nombre}`;
      sel.appendChild(opt);
    });
  }

  async function cargarMensajes() {
    const cont = document.getElementById('mensajes-list');
    if (!cont) return;

    const temaFilter = document.getElementById('mensajes-tema-filter')?.value || '';
    const modalidadSel = document.getElementById('mensajes-modalidad-filter');
    const modalidadFilter = modalidadSel?.value || 'presencial';

    if (modalidadSel) modalidadSel.disabled = (temaFilter === 'calentamiento');

    if (!temaFilter) {
      document.getElementById('mensajes-count').textContent = '— MENSAJES';
      cont.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">≡</div>
          <div class="empty-state-title">Selecciona una semana</div>
          <div class="empty-state-text">
            Elige "Sala de espera" o uno de los 10 temas arriba para ver y editar
            los mensajes que se envían cada día.
          </div>
        </div>`;
      return;
    }

    cont.innerHTML = `
      <div class="full-loader">
        <div class="spinner"></div>
        <div class="full-loader-text">Cargando</div>
      </div>`;

    if (temaFilter === 'calentamiento') {
      await pintarSalaDeEspera(cont);
      return;
    }
    await pintarSemanaDeTema(cont, temaFilter, modalidadFilter);
  }

  async function pintarSemanaDeTema(cont, temaId, modalidad) {
    const { escapeHtml, toast } = _deps();
    const { data, error } = await window.db.from('mensajes')
      .select('*, temas:tema_id(orden, nombre)')
      .eq('tema_id', temaId)
      .in('modalidad', [modalidad, 'ambas'])
      .order('dia_relativo')
      .order('modalidad')
      .order('tipo');

    if (error) {
      console.error(error);
      toast('Error al cargar mensajes', 'error');
      return;
    }

    document.getElementById('mensajes-count').textContent =
      `${data.length} MENSAJE${data.length === 1 ? '' : 'S'}`;

    const porDia = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
    data.forEach(m => { if (porDia[m.dia_relativo]) porDia[m.dia_relativo].push(m); });

    cont.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(dia => {
      const mensajes = porDia[dia];
      const sessionTag = sessionTagFor(dia, modalidad);
      return `
        <section class="day-section" data-dia="${dia}">
          <div class="day-section-header">
            <div class="day-section-id">
              <span class="day-section-day-num">D${dia}</span>
              <span class="day-section-day-name">${DIA_NOMBRE_LARGO[dia]}</span>
            </div>
            ${sessionTag ? `<span class="day-section-tag">${sessionTag}</span>` : ''}
            <span class="day-section-count">${mensajes.length} mensaje${mensajes.length === 1 ? '' : 's'}</span>
          </div>
          ${mensajes.length === 0
            ? `<div class="day-section-empty">Sin mensajes para este día.</div>`
            : `<div class="day-section-messages">
                ${mensajes.map(renderMessageEditor).join('')}
              </div>`
          }
        </section>`;
    }).join('');

    bindMessageEditors(cont);
  }

  function renderMessageEditor(m) {
    const { escapeHtml } = _deps();
    const modalidad = m.modalidad || 'ambas';
    const badgeCls = modalidad === 'presencial' ? 'badge badge-active' : 'badge';
    return `
      <div class="message-editor" data-mensaje-id="${m.id}" data-modalidad="${modalidad}">
        <div class="message-editor-meta">
          <span class="message-editor-tipo">${escapeHtml(TIPO_LABELS[m.tipo] || m.tipo)}</span>
          <span class="${badgeCls}" style="margin-top: 4px; font-size: 9px; align-self: flex-start;">
            ${escapeHtml(MODALIDAD_LABELS[modalidad] || modalidad.toUpperCase())}
          </span>
        </div>
        <textarea data-content rows="3">${escapeHtml(m.contenido || '')}</textarea>
        <div class="message-editor-actions">
          <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
          <span class="message-editor-status" data-status>SIN CAMBIOS</span>
        </div>
      </div>`;
  }

  function bindMessageEditors(cont) {
    const { toast } = _deps();
    cont.querySelectorAll('.message-editor[data-mensaje-id]').forEach(editor => {
      const id = editor.dataset.mensajeId;
      const textarea = editor.querySelector('[data-content]');
      const btn = editor.querySelector('[data-save]');
      const status = editor.querySelector('[data-status]');
      let original = textarea.value;

      textarea.addEventListener('input', () => {
        const dirty = textarea.value !== original;
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      });

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const { error } = await window.db.from('mensajes')
          .update({ contenido: textarea.value, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          toast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        original = textarea.value;
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        toast('Mensaje guardado', 'success');
      });
    });
  }

  async function pintarSalaDeEspera(cont) {
    const { escapeHtml, toast } = _deps();
    const { data, error } = await window.db
      .from('mensajes_calentamiento')
      .select('*')
      .order('dia_calentamiento');

    if (error) {
      toast('Error al cargar sala de espera', 'error');
      return;
    }

    document.getElementById('mensajes-count').textContent =
      `${(data || []).length} DÍA${(data || []).length === 1 ? '' : 'S'}`;

    cont.innerHTML = `
      <p class="empty-state-text" style="text-align: left; max-width: none; margin-bottom: var(--space-6);">
        Cuando un cliente paga un día que <strong>no es lunes</strong>, recibe estos contenidos
        cada día hasta el siguiente lunes (cuando arranca su tema 1).
      </p>
      <div class="calentamiento-grid">
        ${(data || []).map(c => `
          <div class="calentamiento-card" data-cal-id="${c.id}">
            <div class="calentamiento-card-header">
              <span class="calentamiento-card-day">DÍA ${c.dia_calentamiento}</span>
              <span class="calentamiento-card-tag">SALA DE ESPERA</span>
            </div>
            <div class="calentamiento-field">
              <label>Pregunta del día</label>
              <textarea data-field="pregunta_dia" rows="2">${escapeHtml(c.pregunta_dia || '')}</textarea>
            </div>
            <div class="calentamiento-field">
              <label>Introducción</label>
              <textarea data-field="introduccion" rows="3">${escapeHtml(c.introduccion || '')}</textarea>
            </div>
            <div class="calentamiento-field">
              <label>Ejercicio práctico</label>
              <textarea data-field="ejercicio_practico" rows="2">${escapeHtml(c.ejercicio_practico || '')}</textarea>
            </div>
            <div class="calentamiento-card-actions">
              <span class="message-editor-status" data-status>SIN CAMBIOS</span>
              <button type="button" class="btn-save-mini" data-save disabled>Guardar</button>
            </div>
          </div>`).join('')}
      </div>`;

    bindCalentamientoEditors(cont);
  }

  function bindCalentamientoEditors(cont) {
    const { toast } = _deps();
    cont.querySelectorAll('.calentamiento-card').forEach(card => {
      const id = card.dataset.calId;
      const fields = card.querySelectorAll('[data-field]');
      const btn = card.querySelector('[data-save]');
      const status = card.querySelector('[data-status]');
      const originals = {};
      fields.forEach(f => originals[f.dataset.field] = f.value);

      fields.forEach(f => f.addEventListener('input', () => {
        const dirty = Array.from(fields).some(x => x.value !== originals[x.dataset.field]);
        btn.disabled = !dirty;
        status.textContent = dirty ? 'CAMBIOS SIN GUARDAR' : 'SIN CAMBIOS';
        status.className = 'message-editor-status' + (dirty ? ' dirty' : '');
      }));

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        status.textContent = 'GUARDANDO';
        status.className = 'message-editor-status';
        const updates = { updated_at: new Date().toISOString() };
        fields.forEach(f => updates[f.dataset.field] = f.value);
        const { error } = await window.db.from('mensajes_calentamiento').update(updates).eq('id', id);
        if (error) {
          status.textContent = 'ERROR';
          status.className = 'message-editor-status dirty';
          toast('No se pudo guardar: ' + error.message, 'error');
          btn.disabled = false;
          return;
        }
        fields.forEach(f => originals[f.dataset.field] = f.value);
        status.textContent = 'GUARDADO';
        status.className = 'message-editor-status saved';
        toast('Día guardado', 'success');
      });
    });
  }

  window.regenesisAdminMensajesInit = init;
})();
