/* ============================================================
   Modal compartido para editar una pieza de contenido_generado.
   Lo usan instagram/linkedin/facebook (y cualquier otra red futura).

   Uso:
     await window.openEditarPiezaModal(pieza, async (patch) => {
       await window.studioContenidoApi.actualizar(pieza.id, patch);
     });

   `pieza` debe traer al menos: id, titulo, hook, cuerpo, cta, hashtags (array).
   El modal devuelve el patch ya validado al callback.
   ============================================================ */
(function () {
  if (window.openEditarPiezaModal) return;

  // Inyectar estilos una vez
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .epm-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      padding: 16px; z-index: 9999;
      animation: epm-fade 200ms ease-out;
    }
    @keyframes epm-fade { from { opacity: 0; } to { opacity: 1; } }
    .epm-dialog {
      background: var(--surface, #fff); border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      max-width: 720px; width: 100%; max-height: 92vh;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .epm-header {
      padding: 16px 20px; border-bottom: 1px solid var(--border-soft);
      display: flex; align-items: center; justify-content: space-between;
    }
    .epm-header h3 { margin: 0; font-size: 16px; font-weight: 600; }
    .epm-close {
      background: transparent; border: none; cursor: pointer;
      font-size: 22px; line-height: 1; color: var(--text-muted, #888);
      padding: 4px 8px; border-radius: 6px;
    }
    .epm-close:hover { background: var(--surface-2, #f5f5f7); color: var(--text, #000); }
    .epm-body { padding: 20px; overflow-y: auto; flex: 1; }
    .epm-field { margin-bottom: 14px; }
    .epm-label {
      display: block; font-family: var(--font-mono, monospace);
      font-size: 10px; color: var(--text-muted, #888);
      text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;
    }
    .epm-input, .epm-textarea {
      width: 100%; padding: 8px 12px; border: 1px solid var(--border, #ddd);
      border-radius: 6px; font-size: 13px; font-family: inherit;
      background: white; color: var(--text, #000);
    }
    .epm-textarea { resize: vertical; min-height: 90px; line-height: 1.5; }
    .epm-textarea.large { min-height: 200px; }
    .epm-hint { font-size: 11px; color: var(--text-muted, #888); margin-top: 3px; }
    .epm-footer {
      padding: 12px 20px; border-top: 1px solid var(--border-soft);
      display: flex; gap: 8px; justify-content: flex-end;
    }
    .epm-error {
      background: #FEE2E2; color: #991B1B; border-radius: 6px;
      padding: 10px 12px; font-size: 12px; margin-bottom: 12px;
    }
    .epm-error.hidden { display: none; }
  `;
  document.head.appendChild(styleEl);

  function esc(s) {
    return (window.utils?.escapeHtml || ((x) => String(x ?? '')))(s);
  }

  window.openEditarPiezaModal = function (pieza, onSave) {
    return new Promise((resolve) => {
      const hashtagsStr = Array.isArray(pieza.hashtags)
        ? pieza.hashtags.map(h => h.startsWith('#') ? h : '#' + h).join(' ')
        : (pieza.hashtags || '');

      const root = document.createElement('div');
      root.className = 'epm-backdrop';
      root.innerHTML = `
        <div class="epm-dialog" role="dialog" aria-modal="true" aria-labelledby="epm-title">
          <div class="epm-header">
            <h3 id="epm-title">Editar pieza</h3>
            <button type="button" class="epm-close" aria-label="Cerrar">×</button>
          </div>
          <div class="epm-body">
            <div class="epm-error hidden" id="epm-err"></div>

            <div class="epm-field">
              <label class="epm-label">Título interno (opcional, no se publica)</label>
              <input type="text" class="epm-input" id="epm-titulo" value="${esc(pieza.titulo || '')}">
            </div>

            <div class="epm-field">
              <label class="epm-label">Hook (primera línea)</label>
              <textarea class="epm-textarea" id="epm-hook" rows="2">${esc(pieza.hook || '')}</textarea>
              <div class="epm-hint">Lo que para el scroll. Idealmente 1-2 líneas, máximo 200 caracteres.</div>
            </div>

            <div class="epm-field">
              <label class="epm-label">Cuerpo completo</label>
              <textarea class="epm-textarea large" id="epm-cuerpo">${esc(pieza.cuerpo || '')}</textarea>
              <div class="epm-hint">Texto completo de la pieza, listo para copiar y pegar.</div>
            </div>

            <div class="epm-field">
              <label class="epm-label">CTA</label>
              <input type="text" class="epm-input" id="epm-cta" value="${esc(pieza.cta || '')}">
              <div class="epm-hint">La llamada a la acción específica (no debe ser "agenda una llamada" genérico).</div>
            </div>

            <div class="epm-field">
              <label class="epm-label">Hashtags (separados por espacio)</label>
              <input type="text" class="epm-input" id="epm-hashtags" value="${esc(hashtagsStr)}">
              <div class="epm-hint">El símbolo # es opcional. Ej: "marketing seo b2b" → ["marketing","seo","b2b"].</div>
            </div>
          </div>
          <div class="epm-footer">
            <button type="button" class="btn btn-secondary" id="epm-cancel">Cancelar</button>
            <button type="button" class="btn btn-accent" id="epm-save">Guardar cambios</button>
          </div>
        </div>`;
      document.body.appendChild(root);

      const close = (result) => {
        root.remove();
        resolve(result);
      };

      root.querySelector('.epm-close').addEventListener('click', () => close(null));
      root.querySelector('#epm-cancel').addEventListener('click', () => close(null));
      root.addEventListener('click', (e) => { if (e.target === root) close(null); });
      document.addEventListener('keydown', function onEsc(ev) {
        if (ev.key === 'Escape') { document.removeEventListener('keydown', onEsc); close(null); }
      });

      // Focus hook on open
      setTimeout(() => root.querySelector('#epm-hook').focus(), 50);

      root.querySelector('#epm-save').addEventListener('click', async () => {
        const titulo  = root.querySelector('#epm-titulo').value.trim();
        const hook    = root.querySelector('#epm-hook').value.trim();
        const cuerpo  = root.querySelector('#epm-cuerpo').value.trim();
        const cta     = root.querySelector('#epm-cta').value.trim();
        const rawTags = root.querySelector('#epm-hashtags').value.trim();

        if (!cuerpo) {
          const err = root.querySelector('#epm-err');
          err.textContent = 'El cuerpo no puede estar vacío.';
          err.classList.remove('hidden');
          return;
        }

        const hashtags = rawTags
          ? rawTags.split(/\s+/).map(t => t.replace(/^#+/, '')).filter(Boolean)
          : [];

        const patch = {
          titulo: titulo || null,
          hook: hook || null,
          cuerpo,
          cta: cta || null,
          hashtags,
          updated_at: new Date().toISOString(),
        };

        const btn = root.querySelector('#epm-save');
        btn.disabled = true; btn.textContent = 'Guardando...';
        try {
          await onSave(patch);
          window.utils?.toast?.('Pieza actualizada', 'success');
          close(patch);
        } catch (e) {
          const err = root.querySelector('#epm-err');
          err.textContent = 'Error: ' + (e?.message || String(e));
          err.classList.remove('hidden');
          btn.disabled = false; btn.textContent = 'Guardar cambios';
        }
      });
    });
  };
})();
