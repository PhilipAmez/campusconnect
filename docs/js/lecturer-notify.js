// js/lecturer-notify.js
// A single reusable notice/confirm modal for the lecturer dashboard,
// replacing native alert()/confirm() (which render as an ugly,
// unstyled "localhost:3000 says" browser dialog).

let overlay = null;
let card = null;
let iconEl = null;
let titleEl = null;
let messageEl = null;
let actionsEl = null;
let activeResolve = null;

const ICONS = {
  success: { glyph: 'fa-circle-check', className: 'notify-success' },
  error: { glyph: 'fa-circle-exclamation', className: 'notify-error' },
  info: { glyph: 'fa-circle-info', className: 'notify-info' },
  confirm: { glyph: 'fa-triangle-exclamation', className: 'notify-confirm' }
};

function ensureModal() {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.className = 'lecturer-notify-overlay';
  // Inline fallback for the properties that matter most (position, centering,
  // blur, stacking). If the stylesheet with .lecturer-notify-overlay hasn't
  // loaded (stale cache, wrong file deployed, etc.), this still renders as a
  // proper centered, blurred modal instead of an unstyled div dropped at the
  // bottom of the page. The stylesheet's rules for this class take precedence
  // when present since they're more specific / loaded later in the cascade,
  // but these inline values are the safe minimum.
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
    background: rgba(15, 23, 42, 0.5);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    opacity: 0; pointer-events: none;
    transition: opacity 220ms ease;
  `;
  overlay.innerHTML = `
    <div class="lecturer-notify-card" role="alertdialog" aria-modal="true" style="
      width:100%; max-width:380px; text-align:center; border-radius:24px;
      padding:28px 26px; background:rgba(255,255,255,0.94);
      box-shadow:0 20px 60px rgba(15,23,42,0.25);
      transform: translateY(14px) scale(0.97);
      transition: transform 260ms cubic-bezier(0.4,0,0.2,1);
    ">
      <div class="notify-icon"><i class="fa-solid"></i></div>
      <h3 class="notify-title" style="margin:0 0 8px; font-size:1.1rem;"></h3>
      <p class="notify-message" style="margin:0 0 22px; line-height:1.6; font-size:0.92rem;"></p>
      <div class="notify-actions" style="display:flex; gap:10px;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  card = overlay.querySelector('.lecturer-notify-card');
  iconEl = overlay.querySelector('.notify-icon');
  titleEl = overlay.querySelector('.notify-title');
  messageEl = overlay.querySelector('.notify-message');
  actionsEl = overlay.querySelector('.notify-actions');

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('active')) dismiss(false);
  });
}

function dismiss(result) {
  overlay.classList.remove('active');
  overlay.style.opacity = '0';
  overlay.style.pointerEvents = 'none';
  if (card) card.style.transform = 'translateY(14px) scale(0.97)';
  if (activeResolve) {
    const resolve = activeResolve;
    activeResolve = null;
    resolve(result);
  }
}

function open({ type = 'info', title, message, confirmText = 'OK', cancelText = null, danger = false }) {
  ensureModal();

  const icon = ICONS[type] || ICONS.info;
  iconEl.className = `notify-icon ${icon.className}`;
  iconEl.querySelector('i').className = `fa-solid ${icon.glyph}`;
  titleEl.textContent = title;
  messageEl.textContent = message;

  actionsEl.innerHTML = cancelText
    ? `
      <button type="button" class="secondary-btn" data-notify="cancel">${cancelText}</button>
      <button type="button" class="${danger ? 'secondary-btn danger' : 'primary-btn'}" data-notify="confirm">${confirmText}</button>
    `
    : `<button type="button" class="primary-btn" data-notify="confirm">${confirmText}</button>`;

  return new Promise((resolve) => {
    activeResolve = resolve;
    actionsEl.querySelector('[data-notify="confirm"]')?.addEventListener('click', () => dismiss(true));
    actionsEl.querySelector('[data-notify="cancel"]')?.addEventListener('click', () => dismiss(false));
    overlay.classList.add('active');
    overlay.style.opacity = '1';
    overlay.style.pointerEvents = 'auto';
    if (card) card.style.transform = 'translateY(0) scale(1)';
    actionsEl.querySelector('[data-notify="confirm"]')?.focus();
  });
}

/** Info/success/error notice with a single OK button. */
export function showLecturerNotice(title, message, type = 'info') {
  return open({ type, title, message, confirmText: 'OK' });
}

/** Confirm dialog; resolves true if confirmed, false if cancelled/dismissed. */
export function showLecturerConfirm(title, message, { confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return open({ type: 'confirm', title, message, confirmText, cancelText, danger });
}