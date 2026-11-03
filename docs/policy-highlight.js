/*
 * Destination side of a policy reference. When terms.html / privacy.html is
 * opened as  <page>?breach=<key>#<section id>  (see policy-refs.js), this
 * scrolls to that exact section or bullet, pulses it so it can't be missed,
 * and shows a small dismissible banner saying why the reader was sent here.
 * Pages opened without ?breach= are completely unaffected.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var key = params.get('breach');
  if (!key) return;

  var P = window.PeerloomPolicy;
  var ref = P && P.get(key);
  var targetId = (window.location.hash || '').replace(/^#/, '') || (ref && ref.id) || '';

  var style = document.createElement('style');
  style.textContent =
    '@keyframes policyPulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.55);background-color:rgba(124,58,237,.10)}' +
    '50%{box-shadow:0 0 0 12px rgba(124,58,237,0);background-color:rgba(124,58,237,.24)}}' +
    '.policy-breach-highlight{outline:3px solid #7c3aed;outline-offset:6px;border-radius:12px;' +
    'animation:policyPulse 1.4s ease-in-out infinite;scroll-margin-top:110px}' +
    '.policy-breach-highlight.policy-settled{animation:none;background-color:rgba(124,58,237,.14)}' +
    '@media (prefers-reduced-motion: reduce){.policy-breach-highlight{animation:none!important;background-color:rgba(124,58,237,.18)}}' +
    '#policyBreachBanner{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;max-width:min(680px,calc(100vw - 24px));' +
    'display:flex;gap:12px;align-items:center;padding:10px 14px;border-radius:14px;background:#1e1b2e;color:#fff;' +
    'font:600 14px/1.4 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35)}' +
    '#policyBreachBanner button{background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer}';
  document.head.appendChild(style);

  function banner(html) {
    var b = document.createElement('div');
    b.id = 'policyBreachBanner';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span>' + html + '</span>';
    var x = document.createElement('button');
    x.type = 'button';
    x.setAttribute('aria-label', 'Dismiss this message');
    x.textContent = 'Dismiss';
    x.addEventListener('click', function () {
      b.remove();
      var t = document.querySelector('.policy-breach-highlight');
      if (t) t.classList.remove('policy-breach-highlight', 'policy-settled');
    });
    b.appendChild(x);
    document.body.appendChild(b);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function run() {
    var target = targetId ? document.getElementById(targetId) : null;
    if (!ref || !target) {
      banner('You were sent here about a rule in our policies, but we couldn\u2019t locate the exact section. Please read the page carefully.');
      return;
    }

    // Sections fade in on scroll; make sure the target (and its section) is
    // already visible so the highlight isn't pulsing on something invisible.
    var reveal = target.closest('.reveal');
    if (reveal) reveal.classList.add('in-view');
    target.classList.add('policy-breach-highlight');
    banner('The rule referenced in your notice is highlighted below: <em>' + esc(ref.label) + '</em>');

    setTimeout(function () { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 250);
    // Pulse for ~12s to draw the eye, then stay softly highlighted until dismissed.
    setTimeout(function () { target.classList.add('policy-settled'); }, 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();