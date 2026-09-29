// ============================================================================
// nps.js · prompt NPS mensual no-bloqueante
//
// Cómo funciona:
// - Al cargar cualquier página del cliente, chequea si hay solicitud NPS
//   pendiente para este mes (nps_estado_cliente RPC).
// - Si pendiente Y no se mostró aún esta sesión: pintamos un banner inferior
//   con CTA "Responder". Click → abre modal con score 0-10 + textarea.
// - Si el cliente descarta el banner, marcamos `nps_dismissed_yyyy_mm` en
//   sessionStorage para no insistir esta sesión (vuelve a aparecer al refrescar).
//
// API expuesto:
//   window.npsApi.chequearYMostrar()   // llamado automático en turbo:load
//   window.npsApi.abrirModal()         // abrir manualmente desde un botón
//   window.npsApi.cerrar()             // cerrar banner+modal
// ============================================================================

(function () {
  if (typeof window.db === 'undefined') {
    console.warn('[nps] db no disponible aún');
    return;
  }

  const SESSION_DISMISS_KEY = () =>
    'nps_dismissed_' + new Date().toISOString().slice(0, 7);

  let estadoCache = null;
  let mostrado = false;

  // ============================================================
  // CSS injection
  // ============================================================
  function ensureStyles() {
    if (document.getElementById('nps-styles')) return;
    const s = document.createElement('style');
    s.id = 'nps-styles';
    s.textContent = `
      .nps-banner {
        position: fixed; bottom: 16px; right: 16px; max-width: 380px;
        background: var(--surface, #fff); border: 1px solid var(--border, #d2d2d7);
        border-radius: 12px; padding: 14px 16px; box-shadow: 0 4px 16px rgba(0,0,0,0.12);
        z-index: 998; display: flex; flex-direction: column; gap: 8px;
        animation: nps-slideup 0.25s ease-out;
      }
      .nps-banner-title { font-weight: 600; font-size: 14px; }
      .nps-banner-text { font-size: 12.5px; color: var(--text-muted, #86868B); line-height: 1.5; }
      .nps-banner-row { display: flex; gap: 8px; justify-content: flex-end; }
      @keyframes nps-slideup { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

      .nps-modal-bd {
        position: fixed; inset: 0; background: rgba(0,0,0,0.5);
        z-index: 1001; display: flex; align-items: center; justify-content: center;
        padding: 16px; animation: nps-fadein 0.15s ease-out;
      }
      @keyframes nps-fadein { from { opacity: 0; } to { opacity: 1; } }
      .nps-modal {
        background: var(--surface, #fff); border-radius: 14px; padding: 22px 24px;
        max-width: 480px; width: 100%; max-height: 90vh; overflow-y: auto;
        box-shadow: 0 12px 32px rgba(0,0,0,0.25);
      }
      .nps-modal h2 { font-size: 18px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
      .nps-modal p { font-size: 13.5px; color: var(--text-muted, #86868B); margin: 0 0 18px; line-height: 1.5; }
      .nps-scale {
        display: grid; grid-template-columns: repeat(11, 1fr); gap: 4px; margin-bottom: 8px;
      }
      .nps-scale button {
        padding: 10px 0; border: 1px solid var(--border, #d2d2d7); border-radius: 6px;
        background: var(--surface-2, #fafafa); cursor: pointer; font-weight: 600;
        font-size: 13px; transition: all 0.15s;
      }
      .nps-scale button:hover { background: var(--accent-soft, #f5e9b8); border-color: var(--accent, #d4af37); }
      .nps-scale button.selected {
        background: var(--accent, #d4af37); border-color: var(--accent-dark, #b8941f); color: #1D1D1F;
      }
      .nps-scale-labels { display: flex; justify-content: space-between; font-size: 10.5px;
        color: var(--text-muted, #86868B); font-family: var(--font-mono, monospace);
        text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 14px; }
      .nps-textarea {
        width: 100%; min-height: 80px; padding: 10px 12px; border: 1px solid var(--border, #d2d2d7);
        border-radius: 8px; font-family: inherit; font-size: 13px; resize: vertical;
        margin-bottom: 14px;
      }
      .nps-modal-foot { display: flex; gap: 8px; justify-content: flex-end; }
      .nps-modal-foot button {
        padding: 9px 16px; border-radius: 999px; border: 1px solid var(--border, #d2d2d7);
        background: transparent; cursor: pointer; font-size: 13px; font-weight: 500;
      }
      .nps-modal-foot button.primary {
        background: var(--text, #1D1D1F); color: var(--surface, #fff); border-color: var(--text, #1D1D1F);
      }
      .nps-modal-foot button:disabled { opacity: 0.5; cursor: not-allowed; }
      .nps-thank {
        text-align: center; padding: 24px 8px;
      }
      .nps-thank-icon { font-size: 42px; line-height: 1; margin-bottom: 10px; }
    `;
    document.head.appendChild(s);
  }

  // ============================================================
  // Banner inferior
  // ============================================================
  function mostrarBanner() {
    if (mostrado) return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY()) === '1') return;
    ensureStyles();
    mostrado = true;

    const b = document.createElement('div');
    b.className = 'nps-banner';
    b.innerHTML = `
      <div class="nps-banner-title">¿Cómo va tu mes con Neurohackers?</div>
      <div class="nps-banner-text">Solo 1 pregunta. Te toma 20 segundos. Tu respuesta nos ayuda a mejorar.</div>
      <div class="nps-banner-row">
        <button type="button" class="nps-skip" style="padding: 6px 10px; background: transparent; border: 1px solid var(--border, #d2d2d7); border-radius: 999px; font-size: 12px; cursor: pointer;">Más tarde</button>
        <button type="button" class="nps-go" style="padding: 6px 14px; background: var(--accent, #d4af37); color: #1D1D1F; border: 0; border-radius: 999px; font-size: 12px; font-weight: 600; cursor: pointer;">Responder</button>
      </div>`;
    document.body.appendChild(b);

    b.querySelector('.nps-skip').addEventListener('click', () => {
      sessionStorage.setItem(SESSION_DISMISS_KEY(), '1');
      b.remove();
    });
    b.querySelector('.nps-go').addEventListener('click', () => {
      b.remove();
      abrirModal();
    });
  }

  // ============================================================
  // Modal
  // ============================================================
  function abrirModal() {
    ensureStyles();
    const bd = document.createElement('div');
    bd.className = 'nps-modal-bd';
    bd.innerHTML = `
      <div class="nps-modal">
        <h2>¿Qué tan probable es que recomiendes Neurohackers a un amigo o colega?</h2>
        <p>Pinta el número que mejor refleja cómo te sientes hoy con el programa.</p>
        <div class="nps-scale" id="nps-scale">
          ${[0,1,2,3,4,5,6,7,8,9,10].map(n => `<button type="button" data-n="${n}">${n}</button>`).join('')}
        </div>
        <div class="nps-scale-labels">
          <span>NADA PROBABLE</span><span>SEGURO LO RECOMIENDO</span>
        </div>
        <textarea class="nps-textarea" id="nps-comentario" placeholder="¿Por qué? (opcional, pero nos ayuda mucho)"></textarea>
        <div class="nps-modal-foot">
          <button type="button" id="nps-cancel">Cancelar</button>
          <button type="button" class="primary" id="nps-send" disabled>Enviar</button>
        </div>
      </div>`;
    document.body.appendChild(bd);

    let scoreElegido = null;
    bd.querySelectorAll('.nps-scale button').forEach(btn => {
      btn.addEventListener('click', () => {
        bd.querySelectorAll('.nps-scale button').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        scoreElegido = parseInt(btn.dataset.n, 10);
        bd.querySelector('#nps-send').disabled = false;
      });
    });

    const cerrar = () => bd.remove();
    bd.querySelector('#nps-cancel').addEventListener('click', cerrar);
    bd.addEventListener('click', (e) => { if (e.target === bd) cerrar(); });

    bd.querySelector('#nps-send').addEventListener('click', async () => {
      const comentario = bd.querySelector('#nps-comentario').value.trim() || null;
      const sendBtn = bd.querySelector('#nps-send');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Enviando…';
      try {
        const { data, error } = await window.db.rpc('registrar_nps_cliente', {
          p_score: scoreElegido,
          p_comentario: comentario,
          p_mentor_id: null,
          p_origen: 'web_modal',
        });
        if (error) throw error;
        const cat = data?.categoria || '—';
        bd.querySelector('.nps-modal').innerHTML = `
          <div class="nps-thank">
            <div class="nps-thank-icon">${cat === 'promotor' ? '◆' : cat === 'pasivo' ? '◌' : '◐'}</div>
            <h2 style="margin-bottom: 8px;">¡Gracias por responder!</h2>
            <p style="margin-bottom: 20px;">Tu respuesta queda anónima para el resto del equipo. Frank y Alex la usan para mejorar el programa.</p>
            <button class="primary" id="nps-close-thank" style="padding: 9px 22px; border: 0; border-radius: 999px; background: var(--text, #1D1D1F); color: var(--surface, #fff); cursor: pointer;">Cerrar</button>
          </div>`;
        bd.querySelector('#nps-close-thank').addEventListener('click', cerrar);
        // Cache estado para que no vuelva a mostrar
        estadoCache = { pendiente: false };
      } catch (e) {
        console.error('[nps] error:', e);
        sendBtn.disabled = false;
        sendBtn.textContent = 'Enviar';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color: var(--error, #DC2626); font-size: 12px; margin-bottom: 8px;';
        errDiv.textContent = 'Error: ' + (e.message || e);
        sendBtn.parentNode.insertBefore(errDiv, sendBtn);
      }
    });
  }

  // ============================================================
  // Detección automática
  // ============================================================
  async function chequearYMostrar() {
    try {
      // Esperar sesión activa
      const { data: { session } } = await window.db.auth.getSession();
      if (!session) return;

      const { data, error } = await window.db.rpc('nps_estado_cliente');
      if (error) {
        console.warn('[nps] no se pudo chequear:', error.message);
        return;
      }
      estadoCache = data;
      if (data?.pendiente && data?.es_lead) {
        // Esperar 3s antes de mostrar para no saturar la primera impresión
        setTimeout(mostrarBanner, 3000);
      }
    } catch (e) {
      console.warn('[nps] chequear excepción:', e?.message || e);
    }
  }

  window.npsApi = {
    chequearYMostrar,
    abrirModal,
    cerrar() {
      document.querySelectorAll('.nps-banner, .nps-modal-bd').forEach(el => el.remove());
    },
    getEstado: () => estadoCache,
  };

  // Auto-disparar en turbo:load (también en primera carga si no hay turbo)
  if (typeof document !== 'undefined') {
    document.addEventListener('turbo:load', chequearYMostrar);
    if (document.readyState === 'complete') chequearYMostrar();
    else document.addEventListener('DOMContentLoaded', chequearYMostrar);
  }
})();
