/*
 * Shared accessibility helpers, loaded (deferred) on every page.
 * Deliberately small and additive: it never changes layout, only fills in
 * keyboard, motion and screen-reader behaviour the page CSS/markup lacks.
 */
(function () {
  'use strict';

  // 1. Motion + focus ring. :where() keeps specificity at zero for the element
  //    list, so any page that styles its own focus state still wins.
  var style = document.createElement('style');
  style.id = 'a11y-base';
  style.textContent =
    '@media (prefers-reduced-motion: reduce){' +
      '*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;' +
      'transition-duration:.01ms!important;scroll-behavior:auto!important}}' +
    ':where(a,button,input,select,textarea,summary,[role="button"],[tabindex]):focus-visible{' +
      'outline:2px solid #7c3aed;outline-offset:2px}';
  document.head.appendChild(style);

  // 2. Keyboard activation for non-<button> elements marked role="button"
  //    (the site uses many clickable <div>s). Enter and Space behave like click.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target;
    if (!el || el.getAttribute('role') !== 'button') return;
    if (/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    e.preventDefault();
    el.click();
  });

  // 3. Announce toasts to screen readers, including containers created later.
  function markLiveRegions(root) {
    var nodes = (root.querySelectorAll ? root.querySelectorAll('#toast-container, #toastContainer, .toast-container') : []);
    nodes.forEach(function (n) {
      if (!n.hasAttribute('role')) n.setAttribute('role', 'status');
      if (!n.hasAttribute('aria-live')) n.setAttribute('aria-live', 'polite');
    });
    if (root.matches && root.matches('#toast-container, #toastContainer, .toast-container')) {
      if (!root.hasAttribute('role')) root.setAttribute('role', 'status');
      if (!root.hasAttribute('aria-live')) root.setAttribute('aria-live', 'polite');
    }
  }

  // 4. Give dynamically built modals a dialog role and an accessible name.
  var uid = 0;
  function markDialogs(root) {
    var found = [];
    if (root.matches && root.matches('.modal-content')) found.push(root);
    if (root.querySelectorAll) root.querySelectorAll('.modal-content').forEach(function (n) { found.push(n); });
    found.forEach(function (dlg) {
      if (dlg.hasAttribute('role')) return;
      dlg.setAttribute('role', 'dialog');
      dlg.setAttribute('aria-modal', 'true');
      var title = dlg.querySelector('.modal-title');
      if (title) {
        if (!title.id) title.id = 'a11y-dlg-title-' + (++uid);
        dlg.setAttribute('aria-labelledby', title.id);
      }
    });
  }

  function scan(root) { markLiveRegions(root); markDialogs(root); }

  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();