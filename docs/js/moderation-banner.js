/*
 * A persistent strip beneath the navbar, on every authenticated page,
 * telling someone they (or a group they admin) are currently warned,
 * suspended, or banned — with a link straight to the exact Terms/Privacy
 * rule they breached (via js/policy-refs.js). This is deliberately separate
 * from the one-off toast in global-notifications.js: the toast says
 * "something just happened"; this says "this is your current state" and
 * stays until that's actually true.
 *
 * Reuses existing data only — profiles.account_status, groups.moderation_
 * status, and the notifications table — nothing new is stored.
 */
import { supabase } from './supabaseClient.js';

(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Same duplicate-for-resilience approach as command-center.js's dropdown
  // fix: prefer the shared js/policy-refs.js (keeps section ids in sync
  // automatically with the Terms/Privacy pages), but never depend on it —
  // this is the second time a page lost its rule link because that script
  // didn't load, so it gets its own copy here too rather than a third
  // attempt at "make sure the external file loads."
  const EMBEDDED_POLICY_REGISTRY = {
    'terms:impersonation':         { page: 'terms.html',   id: 'aup-impersonation',       label: 'Impersonation or misrepresenting your role or affiliation' },
    'terms:harassment':            { page: 'terms.html',   id: 'aup-harassment',          label: 'Harassing, abusive, unlawful or rights-infringing content' },
    'terms:unauthorized-access':   { page: 'terms.html',   id: 'aup-unauthorized-access', label: 'Unauthorized access to accounts, groups or quiz data' },
    'terms:platform-interference': { page: 'terms.html',   id: 'aup-interference',        label: 'Interfering with the platform (scripts, bots, bypassing security)' },
    'terms:spam-malware':          { page: 'terms.html',   id: 'aup-spam-malware',        label: 'Malware, spam or unsolicited commercial content' },
    'terms:academic-integrity':    { page: 'terms.html',   id: 'quizzes',                 label: 'Quizzes & academic integrity' },
    'terms:content-rights':        { page: 'terms.html',   id: 'content',                 label: 'Content & ownership (rights to what you upload)' },
    'terms:group-conduct':         { page: 'terms.html',   id: 'groups',                  label: 'Groups & lecturer responsibilities' },
    'terms:eligibility':           { page: 'terms.html',   id: 'eligibility',             label: 'Eligibility & accounts (accurate information)' },
    'terms:other':                 { page: 'terms.html',   id: 'termination',             label: 'Other violation of the Terms (see Suspension & termination)' },
    'privacy:age-requirements':    { page: 'privacy.html', id: 'children',                label: 'Age requirements' },
  };
  const PAGE_NAMES = { 'terms.html': 'Terms of Service', 'privacy.html': 'Privacy Policy' };

  function ruleHtml(policyRef) {
    if (!policyRef) return '';
    try {
      if (window.PeerloomPolicy) {
        const html = window.PeerloomPolicy.noticeHtml(policyRef);
        if (html) return html;
      }
    } catch (e) { /* fall through to the embedded copy below */ }

    const r = EMBEDDED_POLICY_REGISTRY[policyRef];
    if (!r) return '';
    const pageName = PAGE_NAMES[r.page] || r.page;
    const url = `${r.page}?breach=${encodeURIComponent(policyRef)}#${r.id}`;
    return `<div style="margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(124,58,237,0.10);border:1px solid rgba(124,58,237,0.35);font-size:0.85em;line-height:1.45;text-align:left;">`
      + `<div><span style="opacity:.75;">Rule referenced (${esc(pageName)}):</span> <strong>${esc(r.label)}</strong></div>`
      + `<a href="${esc(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-weight:700;text-decoration:underline;">Read this rule in the ${esc(pageName)} &rarr;</a></div>`;
  }

  // The navbar on every page here is position:fixed — it's taken out of
  // normal document flow, so DOM order alone doesn't control where it
  // renders. Inserting the banner "right after <nav>" put it at the very
  // top of the page too, directly UNDER the fixed navbar (which has a
  // higher z-index), completely hidden behind it rather than pushed below
  // it. This makes the banner stack fixed as well, measures the navbar's
  // actual rendered height (varies per page/breakpoint, so this can't be a
  // hardcoded number), and pins itself right under it — recalculated on
  // load and on resize so it stays correct if the navbar wraps to a second
  // row on a narrow screen.
  let container = null;
  function positionContainer() {
    if (!container) return;
    const nav = document.querySelector('#navbar, .navbar, nav');
    const navHeight = nav ? nav.getBoundingClientRect().height : 0;
    container.style.top = navHeight + 'px';
  }

  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.id = 'moderationBannerStack';
    container.style.cssText = 'position:fixed; left:0; right:0; z-index:999; display:flex; flex-direction:column;';
    document.body.appendChild(container);
    positionContainer();
    window.addEventListener('resize', positionContainer);
    // The navbar's own height can change after load (e.g. a page-specific
    // script resizing it, fonts finishing loading) — a short delayed
    // re-check catches that without needing a full ResizeObserver.
    setTimeout(positionContainer, 300);
    return container;
  }

  function addBanner({ id, tone, icon, text, policyRef, dismissible, onDismiss }) {
    const root = ensureContainer();
    if (document.getElementById(id)) return; // don't stack duplicates on re-check
    const colors = {
      danger: { bg: 'rgba(220,38,38,0.12)', fg: '#dc2626', border: 'rgba(220,38,38,0.35)' },
      warn: { bg: 'rgba(255,149,0,0.12)', fg: '#c2730a', border: 'rgba(255,149,0,0.35)' },
    }[tone] || { bg: 'rgba(124,58,237,0.10)', fg: '#7c3aed', border: 'rgba(124,58,237,0.35)' };

    const bar = document.createElement('div');
    bar.id = id;
    bar.setAttribute('role', 'alert');
    bar.style.cssText = `display:flex; align-items:flex-start; gap:10px; padding:10px 18px; background:${colors.bg}; color:${colors.fg}; border-bottom:1px solid ${colors.border}; font-size:0.86rem; line-height:1.45;`;
    bar.innerHTML = `
      <i class="fas ${icon}" style="margin-top:2px;"></i>
      <div style="flex:1; min-width:0;">
        <div>${text}</div>
        ${ruleHtml(policyRef)}
      </div>
      ${dismissible ? '<button type="button" aria-label="Dismiss" style="background:none;border:0;color:inherit;opacity:0.7;cursor:pointer;font-size:1rem;line-height:1;padding:2px;">&times;</button>' : ''}
    `;
    if (dismissible) {
      bar.querySelector('button').addEventListener('click', async () => {
        bar.remove();
        if (onDismiss) await onDismiss();
      });
    }
    root.appendChild(bar);
  }

  async function checkOwnAccountStatus(userId) {
    const { data: p } = await supabase
      .from('profiles')
      .select('account_status, suspended_reason, suspended_policy_ref')
      .eq('id', userId)
      .maybeSingle();
    if (!p) return;
    if (p.account_status === 'suspended' || p.account_status === 'banned') {
      const isBan = p.account_status === 'banned';
      addBanner({
        id: 'mod-banner-self-status',
        tone: 'danger',
        icon: 'fa-ban',
        text: `<strong>Your account is currently ${isBan ? 'banned' : 'suspended'}.</strong> ${esc(p.suspended_reason || 'No reason was recorded.')}`,
        policyRef: p.suspended_policy_ref,
        dismissible: false,
      });
    }
  }

  async function checkAdminGroupsStatus(userId) {
    const { data: created, error: createdErr } = await supabase
      .from('groups')
      .select('id, name, moderation_status, moderation_reason, moderation_policy_ref')
      .eq('created_by', userId)
      .in('moderation_status', ['warned', 'suspended']);
    if (createdErr) console.warn('moderation-banner: could not check created groups —', createdErr.message);

    // Two flat queries, deliberately not an embedded groups!inner(...)
    // relationship select — that syntax is exactly what broke the group-
    // message notification lookup elsewhere in this app with a 400
    // (PostgREST couldn't resolve the relationship). Avoiding it here too
    // rather than risk the same failure a second time.
    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId)
      .in('role', ['admin', 'owner', 'lecturer']);
    if (memberErr) console.warn('moderation-banner: could not check group memberships —', memberErr.message);

    let adminOf = [];
    const memberGroupIds = (memberRows || []).map(r => r.group_id);
    if (memberGroupIds.length) {
      const { data: rows, error: groupsErr } = await supabase
        .from('groups')
        .select('id, name, moderation_status, moderation_reason, moderation_policy_ref')
        .in('id', memberGroupIds)
        .in('moderation_status', ['warned', 'suspended']);
      if (groupsErr) console.warn('moderation-banner: could not load group details —', groupsErr.message);
      adminOf = rows || [];
    }

    const seen = new Set();
    const groups = [];
    (created || []).forEach(g => { if (!seen.has(g.id)) { seen.add(g.id); groups.push(g); } });
    adminOf.forEach(g => { if (g && !seen.has(g.id)) { seen.add(g.id); groups.push(g); } });

    groups.forEach(g => {
      const isSuspended = g.moderation_status === 'suspended';
      addBanner({
        id: `mod-banner-group-${g.id}`,
        tone: isSuspended ? 'danger' : 'warn',
        icon: isSuspended ? 'fa-ban' : 'fa-triangle-exclamation',
        text: `<strong>"${esc(g.name)}" is currently ${isSuspended ? 'suspended' : 'warned'}.</strong> ${esc(g.moderation_reason || 'No reason was recorded.')}`,
        policyRef: g.moderation_policy_ref,
        dismissible: false,
      });
    });
  }

  const MODERATION_NOTICE_TYPES = ['account_warning', 'group_warning', 'group_suspended', 'content_warning', 'content_removed'];

  function renderNoticeBanner(n) {
    addBanner({
      id: `mod-banner-notice-${n.id}`,
      tone: n.type === 'content_removed' || n.type === 'group_suspended' ? 'danger' : 'warn',
      icon: 'fa-triangle-exclamation',
      text: esc(n.content || 'You have a moderation notice.'),
      policyRef: n.policy_ref,
      dismissible: true,
      onDismiss: async () => {
        await supabase.from('notifications').update({ seen_at: new Date().toISOString() }).eq('id', n.id);
      },
    });
  }

  async function checkUnseenModerationNotices(userId) {
    const { data: notices } = await supabase
      .from('notifications')
      .select('id, type, content, policy_ref, created_at')
      .eq('user_id', userId)
      .in('type', MODERATION_NOTICE_TYPES)
      .is('seen_at', null)
      .order('created_at', { ascending: false })
      .limit(5);

    (notices || []).forEach(renderNoticeBanner);
  }

  // This script previously only ever checked once, when the page first
  // loaded. A warning sent while someone was already sitting on a page (by
  // far the normal case — nobody reloads the instant an admin acts) would
  // never appear until their next navigation. The toast in
  // global-notifications.js already reacts live and already dispatches this
  // event for every notification it presents — listening for it here means
  // a moderation notice shows up as a banner immediately, not just the
  // once-per-load check above.
  document.addEventListener('new-notification', (e) => {
    const n = e.detail;
    if (n && MODERATION_NOTICE_TYPES.includes(n.type)) {
      renderNoticeBanner(n);
    }
  });

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Independent checks — one failing (e.g. a column not existing yet on an
    // older schema) shouldn't take the others down with it.
    await Promise.allSettled([
      checkOwnAccountStatus(user.id),
      checkAdminGroupsStatus(user.id),
      checkUnseenModerationNotices(user.id),
    ]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();