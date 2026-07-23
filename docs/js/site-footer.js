// Injects a small, unobtrusive copyright strip at the bottom of every page.
// Fixed-position and low-height so it never disrupts existing sidebar/app
// layouts (dashboards, quiz sessions, etc.) — it just sits quietly in the
// corner rather than pushing content around.
(function () {
  function mount() {
    if (document.getElementById('peerloomCopyrightFooter')) return;
    var el = document.createElement('div');
    el.id = 'peerloomCopyrightFooter';
    el.textContent = '\u00A9 ' + new Date().getFullYear() + ' Peerloom Technologies Limited. All rights reserved.';
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.bottom = '6px';
    el.style.transform = 'translateX(-50%)';
    el.style.zIndex = '2147483000';
    el.style.textAlign = 'center';
    el.style.fontSize = '11px';
    el.style.lineHeight = '16px';
    el.style.padding = '3px 10px';
    el.style.borderRadius = '999px';
    el.style.pointerEvents = 'none';
    el.style.color = 'rgba(51, 65, 85, 0.85)';
    el.style.background = 'rgba(255, 255, 255, 0.65)';
    el.style.backdropFilter = 'blur(6px)';
    el.style.webkitBackdropFilter = 'blur(6px)';
    el.style.whiteSpace = 'nowrap';
    el.style.fontFamily = 'inherit';
    el.style.letterSpacing = '0.01em';
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();