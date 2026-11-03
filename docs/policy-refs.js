/*
 * Peerloom policy references — the single list of "which rule was breached"
 * choices used by the Command Centre (when a moderator warns / suspends /
 * bans / removes something) and by every page that shows that decision to
 * the person it affects (login screen, notifications, group banner).
 *
 * Only the KEY (e.g. "terms:harassment") is ever stored in the database.
 * The label, page and section id below are looked up here at display time,
 * so a stored value can never inject text or markup into a page, and an
 * unknown / outdated key simply renders nothing.
 *
 * IMPORTANT: each `id` must match an element id on the target page
 * (terms.html / privacy.html). If the Terms or Privacy Policy is rewritten,
 * keep these ids on the equivalent section — or update the id here — so
 * existing notices keep pointing at the right rule.
 */
(function () {
  'use strict';

  var PAGES = {
    'terms.html': 'Terms of Service',
    'privacy.html': 'Privacy Policy'
  };

  var REFS = {
    'terms:impersonation':        { page: 'terms.html',   id: 'aup-impersonation',        label: 'Impersonation or misrepresenting your role or affiliation' },
    'terms:harassment':           { page: 'terms.html',   id: 'aup-harassment',           label: 'Harassing, abusive, unlawful or rights-infringing content' },
    'terms:unauthorized-access':  { page: 'terms.html',   id: 'aup-unauthorized-access',  label: 'Unauthorized access to accounts, groups or quiz data' },
    'terms:platform-interference':{ page: 'terms.html',   id: 'aup-interference',         label: 'Interfering with the platform (scripts, bots, bypassing security)' },
    'terms:spam-malware':         { page: 'terms.html',   id: 'aup-spam-malware',         label: 'Malware, spam or unsolicited commercial content' },
    'terms:academic-integrity':   { page: 'terms.html',   id: 'quizzes',                  label: 'Quizzes & academic integrity' },
    'terms:content-rights':       { page: 'terms.html',   id: 'content',                  label: 'Content & ownership (rights to what you upload)' },
    'terms:group-conduct':        { page: 'terms.html',   id: 'groups',                   label: 'Groups & lecturer responsibilities' },
    'terms:eligibility':          { page: 'terms.html',   id: 'eligibility',              label: 'Eligibility & accounts (accurate information)' },
    'terms:other':                { page: 'terms.html',   id: 'termination',              label: 'Other violation of the Terms (see Suspension & termination)' },
    'privacy:age-requirements':   { page: 'privacy.html', id: 'children',                 label: 'Age requirements' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function get(key) {
    return Object.prototype.hasOwnProperty.call(REFS, key) ? REFS[key] : null;
  }

  // terms.html?breach=<key>#<section id> — policy-highlight.js reads this on
  // the destination page, scrolls to the section and pulses it.
  function url(key) {
    var r = get(key);
    if (!r) return null;
    return r.page + '?breach=' + encodeURIComponent(key) + '#' + r.id;
  }

  function list() {
    return Object.keys(REFS).map(function (k) {
      return { key: k, page: REFS[k].page, pageName: PAGES[REFS[k].page], label: REFS[k].label };
    });
  }

  // Ready-to-insert HTML for "which rule this was about", or '' if the key is
  // missing/unknown. Uses inline styles so it works on any page unchanged.
  function noticeHtml(key) {
    var r = get(key);
    if (!r) return '';
    return '<div class="pl-rule-notice" style="margin-top:8px;padding:8px 10px;border-radius:10px;' +
      'background:rgba(124,58,237,0.10);border:1px solid rgba(124,58,237,0.35);font-size:0.85em;line-height:1.45;text-align:left;">' +
      '<div><span style="opacity:.75;">Rule referenced (' + esc(PAGES[r.page]) + '):</span> <strong>' + esc(r.label) + '</strong></div>' +
      '<a href="' + esc(url(key)) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-weight:700;text-decoration:underline;">' +
      'Read this rule in the ' + esc(PAGES[r.page]) + ' &rarr;</a></div>';
  }

  window.PeerloomPolicy = { get: get, url: url, list: list, noticeHtml: noticeHtml, pageName: function (p) { return PAGES[p] || p; } };
})();