// Small toast utility used to replace native alert() with styled toasts
export function installToasts() {
  if (window.__toasts_installed) return;
  window.__toasts_installed = true;

  // inject styles
  const style = document.createElement('style');
  style.textContent = `
  .cc-toast-container { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 99999; }
  .cc-toast { min-width: 240px; max-width: 420px; padding: 10px 14px; border-radius: 10px; color: #fff; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; box-shadow: 0 6px 18px rgba(0,0,0,0.25); opacity: 0; transform: translateY(8px) scale(0.98); transition: opacity 160ms ease, transform 200ms cubic-bezier(.2,.9,.3,1); }
  .cc-toast.show { opacity: 1; transform: translateY(0) scale(1); }
  .cc-toast.info { background: linear-gradient(180deg,#2b6cb0,#2c5282); }
  .cc-toast.success { background: linear-gradient(180deg,#16a34a,#15803d); }
  .cc-toast.warn { background: linear-gradient(180deg,#f59e0b,#d97706); }
  .cc-toast.error { background: linear-gradient(180deg,#ef4444,#dc2626); }
  .cc-toast .cc-close { float: right; margin-left: 8px; cursor: pointer; opacity: 0.9; }
  `;
  document.head.appendChild(style);

  // container
  const container = document.createElement('div');
  container.className = 'cc-toast-container';
  document.body.appendChild(container);
  window.__cc_toast_container = container;

  window.toast = function (msg, opts = {}) {
    const { type = 'info', timeout = 4000 } = opts;
    const el = document.createElement('div');
    el.className = `cc-toast ${type}`;
    el.innerHTML = `<span>${String(msg)}</span><span class="cc-close" role="button" aria-label="close">&times;</span>`;
    const close = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 220);
    };
    el.querySelector('.cc-close').addEventListener('click', close);
    window.__cc_toast_container.appendChild(el);
    // trigger show
    requestAnimationFrame(() => el.classList.add('show'));
    if (timeout > 0) setTimeout(close, timeout);
    return el;
  };

  // replace native alert
  window.alert = function (msg) { window.toast(msg, { type: 'info', timeout: 4000 }); };
}

// auto-install if loaded as module
if (typeof window !== 'undefined') {
  // wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installToasts);
  } else {
    installToasts();
  }
}
