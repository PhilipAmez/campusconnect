// Adds a small, unobtrusive copyright line at the very end of each page.
//
// Earlier versions used position:fixed to keep it always on-screen — but a
// fixed element always paints in its own layer above normal page content
// no matter how low its z-index is, so it kept visually overlapping real
// UI (buttons, chat input, nav elements) across the app and was reported
// as distracting. This version is a plain, normal-flow element appended
// at the end of <body> — it only shows up if/when you actually scroll to
// the bottom of a page's content, exactly like an ordinary website
// footer, and never floats on top of anything.
(function () {
  function mount() {
    if (document.getElementById('peerloomCopyrightFooter')) return;

    var el = document.createElement('div');
    el.id = 'peerloomCopyrightFooter';
    el.textContent = '\u00A9 ' + new Date().getFullYear() + ' Peerloom Technologies Limited. All rights reserved.';
    el.style.textAlign = 'center';
    el.style.fontSize = '11px';
    el.style.lineHeight = '16px';
    el.style.padding = '14px 8px';
    el.style.color = 'rgba(100, 116, 139, 0.65)';
    el.style.background = 'transparent';
    el.style.fontFamily = 'inherit';
    el.style.letterSpacing = '0.01em';
    el.style.userSelect = 'none';
    document.body.appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();