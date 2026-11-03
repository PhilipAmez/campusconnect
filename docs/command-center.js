// ============================================================
// PEERLOOM COMMAND CENTER
// Everything here reads from the SAME Supabase project the
// student and lecturer dashboards use. No mock data anywhere —
// if a section has no real table behind it yet (Advertisements,
// Subscriptions, Support), it's shown locked in the HTML rather
// than faked here.
// ============================================================

import { supabase } from './js/supabaseClient.js';

// ---------- lecturer detection matches login.html's own logic ----------
// (is_lecturer boolean OR role/level/custom_level === 'lecturer' — the
// real app checks all four as fallbacks, so counts here have to match)
function isLecturerProfile(p) {
  return p.is_lecturer === true || p.role === 'lecturer' || p.level === 'lecturer' || p.custom_level === 'lecturer';
}
function institutionOf(p) { return (p.institution && p.institution.trim()) || 'Unspecified'; }
function campusOf(p) {
  if (p.custom_campus && p.custom_campus.trim()) return p.custom_campus.trim();
  // At signup, profiles.campus is set equal to profiles.institution by
  // default (only custom_campus is a genuinely distinct field) — so
  // falling back to profiles.campus unconditionally just duplicates the
  // institution name as a fake "campus". Only treat it as a real campus
  // when it's actually different from the institution.
  const inst = institutionOf(p);
  const camp = (p.campus && p.campus.trim()) || '';
  if (camp && camp !== inst) return camp;
  return 'Unspecified';
}
function isSuspended(p) { return p.account_status === 'suspended'; }
function isBanned(p) { return p.account_status === 'banned'; }
function isVerified(p) { return p.verified === true; }
function displayName(p) { return p.full_name || p.username || 'Unnamed user'; }
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || name[0].toUpperCase();
}
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
// STATE
// ============================================================
const state = {
  session: null,
  adminId: null,
  adminProfile: null,
  currentView: 'dashboard',
  profiles: [],       // full lean cache, kept in sync via realtime
  reports: [],
  groups: [],
  subscriptions: [],
  payments: [],
  groupMemberCounts: {}, // group_id -> count
  lecturerContentCounts: {}, // profile id -> { quizzes, resources, announcements }
  platformContentCounts: { quizzes: 0, resources: 0, announcements: 0 },
  superAdminIds: new Set(),
  charts: {},
  usersFilter: 'all',
  usersSearch: '',
  usersPage: 1,
  usersPageSize: 15,
  reportsFilter: 'pending',
  moderationEvents: [],
  moderationFilter: 'unseen',
  registrationsRange: 'daily',
  exportContext: null,
  pendingConfirm: null,
  // Polling fallback (see pollCommandCenterUpdates below) — tracks which
  // report/moderation-event/profile ids have already been shown to the
  // admin, whether realtime delivered them or a poll did, so neither path
  // ever double-toasts or double-plays a sound for the same row.
  knownReportIds: new Set(),
  knownModerationEventIds: new Set(),
  knownProfileIds: new Set(),
  pollTimer: null,
};

const PALETTE = ['#7c3aed', '#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#64748b', '#ec4899', '#06b6d4', '#a78bfa', '#14b8a6'];

// ============================================================
// BOOT + AUTH GUARD
// ============================================================
async function boot() {
  const bootText = document.getElementById('ccBootText');
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showDenied("You're not signed in. Sign in with your Peerloom account first, then come back to this page.");
      return;
    }
    state.session = session;
    state.adminId = session.user.id;

    bootText.textContent = 'Confirming super admin access…';
    const { data: adminRow, error: adminErr } = await supabase
      .from('super_admins')
      .select('id, email, full_name')
      .eq('id', session.user.id)
      .maybeSingle();

    if (adminErr || !adminRow) {
      showDenied();
      return;
    }

    bootText.textContent = 'Loading Peerloom data…';
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, full_name, username, profile_photo')
      .eq('id', session.user.id)
      .maybeSingle();
    state.adminProfile = profile || { full_name: adminRow.full_name || adminRow.email };

    await Promise.all([fetchAllProfiles(), fetchReports(), fetchGroups(), fetchSuperAdminIds()]);
    await fetchModerationEvents();
    await fetchLecturerContentCounts();
    await fetchPlatformContentCounts();
    await fetchSubscriptionsAndPayments();

    document.getElementById('ccBoot').style.display = 'none';
    document.getElementById('ccApp').classList.add('is-ready');
    initShell();
    renderAll();
    initRealtime();
    // Realtime (postgres_changes) depends on the Supabase project having
    // replication enabled for these tables — if it isn't, or the socket
    // drops without reconnecting, nothing above ever fires again and the
    // admin has to manually refresh. This 20s poll is the resilience layer
    // underneath it: same pattern already used for the student-facing
    // notification fallback in global-notifications.js.
    seedPollingWatermarks();
    startCommandCenterPolling();
    runHealthChecks();
  } catch (err) {
    console.error(err);
    bootText.textContent = 'Something went wrong loading the Command Center.';
  }
}

function showDenied(message) {
  document.getElementById('ccBoot').style.display = 'none';
  document.getElementById('ccDenied').style.display = 'flex';
  if (message) document.getElementById('ccDeniedMessage').textContent = message;
}

document.getElementById('ccDeniedBack')?.addEventListener('click', () => window.location.href = 'dashboard.html');
document.getElementById('ccDeniedSignOut')?.addEventListener('click', async () => {
  await supabase.auth.signOut();
  window.location.href = 'login.html?redirect=' + encodeURIComponent('command-center.html');
});

// ============================================================
// DATA FETCHING — paginated to go past Supabase's 1000-row cap
// ============================================================
async function fetchAllRows(table, select, applyFilters = q => q, orderCol = 'created_at') {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (orderCol) query = query.order(orderCol, { ascending: false });
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) { console.error(`fetchAllRows(${table})`, error); break; }
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function fetchAllProfiles() {
  state.profiles = await fetchAllRows(
    'profiles',
    'id, full_name, username, profile_photo, institution, campus, custom_campus, department, level, custom_level, role, is_lecturer, verified, account_status, suspended_reason, created_at, lecturer_free_started_at, lecturer_free_ends_at'
  );
}

async function fetchSubscriptionsAndPayments() {
  state.subscriptions = await fetchAllRows(
    'subscriptions',
    'id, user_id, plan, status, amount, currency, billing_interval, started_at, current_period_start, current_period_end, cancelled_at, provider, provider_customer_id, provider_subscription_id, created_at, updated_at'
  );
  const { data, error } = await supabase
    .from('payments')
    .select('id, user_id, subscription_id, amount, currency, status, provider, provider_reference, failure_reason, created_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) { console.error('fetchSubscriptionsAndPayments(payments)', error); state.payments = []; }
  else state.payments = data || [];
}

async function fetchModerationEvents() {
  const raw = await fetchAllRows('moderation_events',
    'id, content_type, content_id, group_id, user_id, category, severity, action_taken, snippet, seen_at, created_at');
  const byId = new Map(state.profiles.map(p => [p.id, p]));
  const groupsById = new Map(state.groups.map(g => [g.id, g]));
  state.moderationEvents = raw.map(e => ({
    ...e,
    userName: byId.get(e.user_id) ? displayName(byId.get(e.user_id)) : 'Unknown user',
    groupName: e.group_id ? (groupsById.get(e.group_id)?.name || 'Unknown group') : null,
  }));
}

async function fetchReports() {
  const raw = await fetchAllRows('reports', 'id, message_id, reported_user_id, reported_by, reason, status, created_at, group_id, post_id');
  const byId = new Map(state.profiles.map(p => [p.id, p]));

  // Post-type reports need the actual post content pulled in so the
  // Command Center can review it without leaving the page.
  const postIds = [...new Set(raw.map(r => r.post_id).filter(Boolean))];
  let postsById = new Map();
  if (postIds.length) {
    const { data: postsData } = await supabase
      .from('posts')
      .select('id, title, content, media_type, media_url, user_id, moderation_status')
      .in('id', postIds);
    postsById = new Map((postsData || []).map(p => [p.id, p]));
  }

  state.reports = raw.map(r => ({
    ...r,
    type: r.post_id ? 'post' : 'message',
    reportedUserName: byId.get(r.reported_user_id) ? displayName(byId.get(r.reported_user_id)) : 'Unknown user',
    reportedByName: byId.get(r.reported_by) ? displayName(byId.get(r.reported_by)) : 'Unknown user',
    post: r.post_id ? postsById.get(r.post_id) || null : null,
  }));
}

async function fetchGroups() {
  state.groups = await fetchAllRows('groups', 'id, name, course_code, description, created_by, institution, created_at, moderation_status, moderation_reason, moderation_at');
  const members = await fetchAllRows('group_members', 'group_id', q => q, null);
  state.groupMemberCounts = {};
  (members || []).forEach(m => {
    state.groupMemberCounts[m.group_id] = (state.groupMemberCounts[m.group_id] || 0) + 1;
  });
}

async function fetchSuperAdminIds() {
  const { data } = await supabase.from('super_admins').select('id');
  state.superAdminIds = new Set((data || []).map(a => a.id));
}

// Platform-wide totals for the dashboard stat grid. Uses Supabase's
// head-only exact count (no rows are actually fetched or transferred) rather
// than pulling every row client-side and counting them, per item #7's own
// "avoid loading huge datasets just to count them" requirement.
// Quizzes use is_deleted (soft delete); resources/announcements are hard
// deleted, so a plain row count already excludes anything removed.
async function fetchPlatformContentCounts() {
  const [quizzes, resources, announcements] = await Promise.all([
    supabase.from('quizzes').select('id', { count: 'exact', head: true }).eq('is_deleted', false),
    supabase.from('resources').select('id', { count: 'exact', head: true }),
    supabase.from('announcements').select('id', { count: 'exact', head: true }),
  ]);
  state.platformContentCounts = {
    quizzes: quizzes.count ?? 0,
    resources: resources.count ?? 0,
    announcements: announcements.count ?? 0,
  };
}

async function fetchLecturerContentCounts() {
  // A single malformed id (null/undefined/not-a-uuid) in this list turns the
  // request's `in.(...)` filter into invalid syntax and PostgREST rejects
  // the WHOLE query with a 400 — which is what silently broke this for
  // every lecturer, not just one. Filtering to real UUIDs first means one
  // bad profile row can't take the others down with it.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const lecturerIds = state.profiles.filter(isLecturerProfile).map(p => p.id).filter(id => UUID_RE.test(id));
  if (!lecturerIds.length) return;
  const counts = {};
  lecturerIds.forEach(id => counts[id] = { quizzes: 0, resources: 0, announcements: 0 });

  const [quizzes, resources, announcements] = await Promise.all([
    supabase.from('quizzes').select('creator_id').eq('is_deleted', false).in('creator_id', lecturerIds),
    supabase.from('resources').select('created_by').in('created_by', lecturerIds),
    supabase.from('announcements').select('created_by').in('created_by', lecturerIds),
  ]);
  if (quizzes.error) console.error('fetchLecturerContentCounts: quizzes query failed —', quizzes.error.message, quizzes.error.details || '');
  if (resources.error) console.error('fetchLecturerContentCounts: resources query failed —', resources.error.message, resources.error.details || '');
  if (announcements.error) console.error('fetchLecturerContentCounts: announcements query failed —', announcements.error.message, announcements.error.details || '');
  (quizzes.data || []).forEach(r => { if (counts[r.creator_id]) counts[r.creator_id].quizzes++; });
  (resources.data || []).forEach(r => { if (counts[r.created_by]) counts[r.created_by].resources++; });
  (announcements.data || []).forEach(r => { if (counts[r.created_by]) counts[r.created_by].announcements++; });
  state.lecturerContentCounts = counts;
}

// ============================================================
// REALTIME
// ============================================================
function initRealtime() {
  const channel = supabase.channel('command-center')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, handleProfileRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, handleReportRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'quizzes' }, handleContentCountRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resources' }, handleContentCountRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, handleContentCountRealtime)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'moderation_events' }, handleModerationRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriptions' }, handleSubscriptionRealtime)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, handlePaymentRealtime)
    .subscribe(status => {
      const dot = document.getElementById('ccLiveDot');
      if (dot) dot.style.background = status === 'SUBSCRIBED' ? 'var(--ok)' : 'var(--warn)';
    });
  state.realtimeChannel = channel;
}

// Any insert/delete/update on these three tables just re-runs the same
// cheap head-count query and repaints the three stat cards — simplest
// correct approach, and these are low-frequency tables compared to profiles.
let contentCountRefreshTimer = null;
function handleContentCountRealtime() {
  clearTimeout(contentCountRefreshTimer);
  contentCountRefreshTimer = setTimeout(async () => {
    await fetchPlatformContentCounts();
    renderDashboardStats();
  }, 400);
}

// Revenue/MRR/active-subscription-count/failed-payment stats are all
// computed from these two tables (see subscriptionsStatCardsConfig), but
// they weren't part of the realtime channel at all — so once real payments
// start flowing in, those stats would only ever update on the next poll or
// manual refresh instead of live. Same debounce pattern as the content
// counts above: both tables can fire in quick succession for one payment
// (a payment insert alongside its subscription's status update), so this
// coalesces bursts into a single re-fetch + re-render.
let subscriptionsRefreshTimer = null;
function handleSubscriptionRealtime() {
  clearTimeout(subscriptionsRefreshTimer);
  subscriptionsRefreshTimer = setTimeout(async () => {
    await fetchSubscriptionsAndPayments();
    renderSubscriptionsView();
  }, 400);
}

function handlePaymentRealtime() {
  handleSubscriptionRealtime();
}

// A brand-new flagged item is rare enough to just re-fetch and re-render
// immediately rather than debounce like the content counts above.
async function handleModerationRealtime(payload) {
  await fetchModerationEvents();
  renderModeration();
  renderModerationBadge();
  // Low severity is logged but deliberately doesn't badge or alert (see
  // renderModerationBadge) — matching that, it doesn't make noise either.
  // Realtime events are rare enough here that burst de-duplication across
  // the whole batch isn't needed the way the flood guard is for inserts.
  const severity = payload?.new?.severity;
  if (severity === 'medium' || severity === 'high') {
    window.ccPlaySound?.('moderation');
  }
  // fetchModerationEvents() above re-fetched the full list — mark every id
  // in it as already-shown so the polling fallback (pollCommandCenterUpdates)
  // doesn't re-toast/re-sound the one that just fired here over realtime.
  state.moderationEvents.forEach(e => state.knownModerationEventIds.add(e.id));
}

function handleProfileRealtime(payload) {  const idx = state.profiles.findIndex(p => p.id === (payload.new?.id || payload.old?.id));
  if (payload.eventType === 'INSERT') {
    state.profiles.unshift(payload.new);
    state.knownProfileIds.add(payload.new.id);
    toast(`New profile: ${displayName(payload.new)}`, 'info');
    pulseStat('ccStatTotalUsers');
    window.ccPlaySound?.('new_user');
  } else if (payload.eventType === 'UPDATE' && idx > -1) {
    state.profiles[idx] = { ...state.profiles[idx], ...payload.new };
  } else if (payload.eventType === 'DELETE' && idx > -1) {
    state.profiles.splice(idx, 1);
  }
  renderAll();
}

function handleReportRealtime(payload) {
  if (payload.eventType === 'INSERT') {
    const byId = new Map(state.profiles.map(p => [p.id, p]));
    state.reports.unshift({
      ...payload.new,
      reportedUserName: byId.get(payload.new.reported_user_id) ? displayName(byId.get(payload.new.reported_user_id)) : 'Unknown user',
      reportedByName: byId.get(payload.new.reported_by) ? displayName(byId.get(payload.new.reported_by)) : 'Unknown user',
    });
    state.knownReportIds.add(payload.new.id);
    toast('New report filed', 'info');
    window.ccPlaySound?.('report');
  } else {
    const idx = state.reports.findIndex(r => r.id === payload.new?.id);
    if (idx > -1) state.reports[idx] = { ...state.reports[idx], ...payload.new };
  }
  renderReports();
  renderReportsBadge();
}

function pulseStat(id) {
  const el = document.getElementById(id)?.closest('.cc-stat-card');
  if (!el) return;
  el.classList.remove('is-pulse');
  void el.offsetWidth;
  el.classList.add('is-pulse');
}

// ============================================================
// POLLING FALLBACK — resilience layer underneath realtime
// ============================================================
// Supabase realtime (postgres_changes) requires the project to have
// replication turned on for a table, and even when it's on, the socket can
// silently drop without reconnecting. When that happens the handlers above
// never fire again and the only symptom is "I have to refresh the page to
// see anything new." This re-fetches reports/moderation events/profiles on
// an interval and diffs them against ids already known (from a prior poll
// OR from realtime already having shown them), so a missed realtime event
// still surfaces — with the right toast and sound — without ever showing
// the same item twice.

// Called once after the initial boot-time fetch, before polling starts, so
// the rows already on screen at load time are never mistaken for "new".
function seedPollingWatermarks() {
  state.knownReportIds = new Set(state.reports.map(r => r.id));
  state.knownModerationEventIds = new Set(state.moderationEvents.map(e => e.id));
  state.knownProfileIds = new Set(state.profiles.map(p => p.id));
}

async function pollCommandCenterUpdates() {
  try {
    const reportsBefore = state.knownReportIds;
    const moderationBefore = state.knownModerationEventIds;
    const profilesBefore = state.knownProfileIds;

    // Profiles first — fetchReports()/fetchModerationEvents() both look up
    // display names from state.profiles, so it has to be current before
    // they run (same ordering boot() already uses). Subscriptions/payments
    // are refreshed here too as a backstop for initRealtime()'s
    // subscriptions/payments channels, same as every other table on this
    // dashboard — some projects don't have replication enabled for every
    // table, so realtime alone can't be the only path to a live stat.
    await fetchAllProfiles();
    await Promise.all([fetchReports(), fetchModerationEvents(), fetchSubscriptionsAndPayments()]);

    const newReports = state.reports.filter(r => !reportsBefore.has(r.id));
    const newModerationEvents = state.moderationEvents.filter(e => !moderationBefore.has(e.id));
    const newProfiles = state.profiles.filter(p => !profilesBefore.has(p.id));

    state.knownReportIds = new Set(state.reports.map(r => r.id));
    state.knownModerationEventIds = new Set(state.moderationEvents.map(e => e.id));
    state.knownProfileIds = new Set(state.profiles.map(p => p.id));

    if (!newReports.length && !newModerationEvents.length && !newProfiles.length) return;

    if (newReports.length) {
      toast(newReports.length === 1 ? 'New report filed' : `${newReports.length} new reports filed`, 'info');
      window.ccPlaySound?.('report');
    }
    if (newModerationEvents.length) {
      const alertWorthy = newModerationEvents.some(e => e.severity === 'medium' || e.severity === 'high');
      if (alertWorthy) window.ccPlaySound?.('moderation');
    }
    if (newProfiles.length) {
      newProfiles.forEach(p => toast(`New profile: ${displayName(p)}`, 'info'));
      pulseStat('ccStatTotalUsers');
      window.ccPlaySound?.('new_user');
    }

    renderAll();
  } catch (err) {
    // A poll failing (network blip, etc.) shouldn't ever throw out of the
    // interval — it just tries again in 20s.
    console.error('Command Center polling fallback failed:', err);
  }
}

const COMMAND_CENTER_POLL_INTERVAL_MS = 20000;
function startCommandCenterPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollCommandCenterUpdates, COMMAND_CENTER_POLL_INTERVAL_MS);
}

// ============================================================
// SHELL — nav, sidebar, topbar, theme
// ============================================================
function initShell() {
  document.getElementById('ccUserName').textContent = displayName(state.adminProfile);
  const av = document.getElementById('ccUserAvatar');
  if (state.adminProfile.profile_photo) {
    av.style.backgroundImage = `url(${state.adminProfile.profile_photo})`;
    av.style.backgroundSize = 'cover'; av.textContent = '';
  } else {
    av.textContent = initials(displayName(state.adminProfile));
  }

  // nav
  document.querySelectorAll('.cc-nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.locked === 'true') { switchView(btn.dataset.view); return; }
      switchView(btn.dataset.view);
      closeMobileSidebar();
    });
  });
  document.querySelectorAll('[data-goto-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.gotoView));
  });

  // sidebar collapse (desktop)
  document.getElementById('ccCollapseBtn').addEventListener('click', () => {
    document.getElementById('ccApp').classList.toggle('sidebar-collapsed');
    localStorage.setItem('cc_sidebar_collapsed', document.getElementById('ccApp').classList.contains('sidebar-collapsed'));
  });
  if (localStorage.getItem('cc_sidebar_collapsed') === 'true') {
    document.getElementById('ccApp').classList.add('sidebar-collapsed');
  }

  // mobile hamburger
  const hamburger = document.getElementById('ccHamburger');
  hamburger.addEventListener('click', () => {
    const app = document.getElementById('ccApp');
    const open = app.classList.toggle('sidebar-open');
    hamburger.setAttribute('aria-expanded', open);
  });
  document.getElementById('ccSidebarBackdrop').addEventListener('click', closeMobileSidebar);

  // logout
  document.getElementById('ccLogoutBtn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'login.html';
  });

  // theme
  initTheme();

  // clock
  updateClock();
  setInterval(updateClock, 1000);

  // notifications panel
  document.getElementById('ccNotifBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('ccNotifPanel').classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('ccNotifPanel');
    if (panel.classList.contains('open') && !panel.contains(e.target)) panel.classList.remove('open');
  });

  // command palette
  initCommandPalette();

  // ripple feedback — delegated so it also covers buttons rendered later
  // (table row actions, dynamically built lists, etc.)
  initRippleEffect();

  // modals: generic close
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.cc-modal-backdrop').classList.remove('open'));
  });
  document.querySelectorAll('.cc-modal-backdrop').forEach(bd => {
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
  });

  // users filters/search
  document.querySelectorAll('[data-users-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-users-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.usersFilter = btn.dataset.usersFilter;
      state.usersPage = 1;
      renderUsersTable();
    });
  });
  document.getElementById('ccUsersSearch').addEventListener('input', (e) => {
    state.usersSearch = e.target.value.trim().toLowerCase();
    state.usersPage = 1;
    renderUsersTable();
  });
  document.getElementById('ccLecturersSearch').addEventListener('input', renderLecturersTable);
  document.getElementById('ccStudentsSearch').addEventListener('input', renderStudentsTable);
  document.getElementById('ccGroupsSearch').addEventListener('input', renderGroupsTable);

  // reports filters
  document.querySelectorAll('[data-reports-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-reports-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.reportsFilter = btn.dataset.reportsFilter;
      renderReports();
    });
  });

  // moderation filters
  document.querySelectorAll('[data-moderation-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-moderation-filter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.moderationFilter = btn.dataset.moderationFilter;
      renderModeration();
    });
  });

  // registrations range
  document.querySelectorAll('[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.registrationsRange = btn.dataset.range;
      renderGrowthChart();
    });
  });

  // exports
  document.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => openExportModal(btn.dataset.export));
  });
  document.getElementById('ccExportAnalyticsBtn').addEventListener('click', () => openExportModal('analytics'));
  document.querySelectorAll('[data-export-format]').forEach(btn => {
    btn.addEventListener('click', () => runExport(btn.dataset.exportFormat));
  });

  // settings
  initSettingsPanel();

  // system health recheck
  document.getElementById('ccRecheckHealthBtn').addEventListener('click', runHealthChecks);

  // confirm modal action button is wired per-use in confirmAction()

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    }
    if (e.key === 'Escape') {
      closePalette();
      document.querySelectorAll('.cc-modal-backdrop.open').forEach(m => m.classList.remove('open'));
    }
  });
}

function closeMobileSidebar() {
  document.getElementById('ccApp').classList.remove('sidebar-open');
  document.getElementById('ccHamburger').setAttribute('aria-expanded', 'false');
}

function switchView(view) {
  if (view === state.currentView) return;
  const current = document.querySelector('.cc-view.active');
  const next = document.querySelector(`.cc-view[data-view="${view}"]`);
  if (!next || next === current) return;

  state.currentView = view;
  document.querySelectorAll('.cc-nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));

  if (current) {
    current.classList.remove('active');
    current.classList.add('cc-leaving');
    current.addEventListener('animationend', function onLeave() {
      current.classList.remove('cc-leaving');
      current.removeEventListener('animationend', onLeave);
    }, { once: true });
  }

  next.classList.add('active', 'cc-entering');
  next.addEventListener('animationend', function onEnter() {
    next.classList.remove('cc-entering');
    next.removeEventListener('animationend', onEnter);
  }, { once: true });

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function updateClock() {
  const now = new Date();
  document.getElementById('ccClockTime').textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('ccClockDate').textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const todayEl = document.getElementById('ccTodayDate');
  if (todayEl) todayEl.textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ============================================================
// THEME
// ============================================================
function initTheme() {
  const saved = localStorage.getItem('cc_theme') || 'system';
  applyTheme(saved);
  document.querySelectorAll('[data-theme-opt]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeOpt === saved);
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-theme-opt]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme(btn.dataset.themeOpt);
      localStorage.setItem('cc_theme', btn.dataset.themeOpt);
    });
  });
  document.getElementById('ccThemeToggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-cc-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(current);
    localStorage.setItem('cc_theme', current);
    document.querySelectorAll('[data-theme-opt]').forEach(b => b.classList.toggle('active', b.dataset.themeOpt === current));
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('cc_theme') || 'system') === 'system') applyTheme('system');
  });
}
function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-cc-theme', dark ? 'dark' : 'light');
  const icon = document.querySelector('#ccThemeToggle i');
  if (icon) icon.className = dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  refreshChartTheme();
}

// ============================================================
// RENDER ORCHESTRATION
// ============================================================
function renderAll() {
  renderWelcome();
  renderDashboardStats();
  renderRecentTable();
  renderDashboardCharts();
  renderAnalyticsCharts();
  renderUsersTable();
  renderLecturersTable();
  renderStudentsTable();
  renderInstitutions();
  renderCampuses();
  renderGroupsTable();
  renderReports();
  renderReportsBadge();
  renderModeration();
  renderModerationBadge();
  renderActivityFeed();
  renderNotifDropdown();
  renderSubscriptionsView();
}

function renderWelcome() {
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const first = (displayName(state.adminProfile) || '').split(' ')[0];
  document.getElementById('ccWelcomeText').textContent = `${greeting}, ${first}`;
}

// ============================================================
// DASHBOARD
// ============================================================
const countAnimState = {}; // stat id -> { current, raf }
function animateCount(id, toValue) {
  const el = document.getElementById(id);
  if (!el) return;
  const prev = countAnimState[id];
  const fromValue = prev ? prev.current : 0;
  if (prev?.raf) cancelAnimationFrame(prev.raf);
  if (fromValue === toValue) { el.textContent = toValue.toLocaleString(); countAnimState[id] = { current: toValue, raf: null }; return; }

  const startTime = performance.now();
  const duration = 800;
  const entry = { current: fromValue, raf: null };
  countAnimState[id] = entry;

  function tick(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic — quick start, gentle settle
    const value = Math.round(fromValue + (toValue - fromValue) * eased);
    el.textContent = value.toLocaleString();
    entry.current = value;
    if (t < 1) {
      entry.raf = requestAnimationFrame(tick);
    } else {
      el.textContent = toValue.toLocaleString();
      entry.current = toValue;
    }
  }
  entry.raf = requestAnimationFrame(tick);
}

function statCardsConfig() {
  const profiles = state.profiles;
  const total = profiles.length;
  const lecturers = profiles.filter(isLecturerProfile).length;
  const students = total - lecturers;
  const institutions = new Set(profiles.map(institutionOf)).size;
  const campuses = new Set(profiles.map(campusOf)).size;
  const verified = profiles.filter(isVerified).length;
  const recent7d = profiles.filter(p => p.created_at && (Date.now() - new Date(p.created_at)) < 7 * 86400000).length;

  return [
    { id: 'ccStatTotalUsers', label: 'Total users', value: total, icon: 'fa-users', color: '#7c3aed', trend: `+${recent7d} this week` },
    { id: 'ccStatStudents', label: 'Students', value: students, icon: 'fa-user-graduate', color: '#3b82f6' },
    { id: 'ccStatLecturers', label: 'Lecturers', value: lecturers, icon: 'fa-chalkboard-user', color: '#ec4899' },
    { id: 'ccStatInstitutions', label: 'Institutions', value: institutions, icon: 'fa-building-columns', color: '#f59e0b' },
    { id: 'ccStatCampuses', label: 'Campuses', value: campuses, icon: 'fa-map-location-dot', color: '#10b981' },
    { id: 'ccStatVerified', label: 'Verified users', value: verified, icon: 'fa-circle-check', color: '#06b6d4', sub: total ? `${Math.round(verified / total * 100)}% of all users` : null },
    { id: 'ccStatOnline', label: 'Online now', value: null, icon: 'fa-tower-broadcast', color: '#64748b', notTracked: true },
    { id: 'ccStatRecent', label: 'Joined this week', value: recent7d, icon: 'fa-user-plus', color: '#a78bfa' },
    { id: 'ccStatQuizzes', label: 'Quizzes', value: state.platformContentCounts.quizzes, icon: 'fa-list-check', color: '#8b5cf6' },
    { id: 'ccStatAnnouncements', label: 'Announcements', value: state.platformContentCounts.announcements, icon: 'fa-bullhorn', color: '#f97316' },
    { id: 'ccStatResources', label: 'Resources', value: state.platformContentCounts.resources, icon: 'fa-folder-open', color: '#22c55e' },
  ];
}

function renderDashboardStats() {
  const cards = statCardsConfig();
  const grid = document.getElementById('ccStatGrid');

  // Build the card structure once — after that, only the numbers inside
  // update (with a live count-up), so realtime updates never tear down
  // and rebuild the whole grid (which would kill hover state and make
  // every card flicker even when only one value actually changed).
  if (grid.children.length !== cards.length) {
    grid.innerHTML = cards.map(c => `
      <div class="cc-stat-card" data-stat-card="${c.id}">
        <div class="cc-stat-top">
          <div class="cc-stat-icn" style="background:${c.color}1f; color:${c.color};"><i class="fa-solid ${c.icon}"></i></div>
          ${c.trend ? `<span class="cc-stat-trend up" data-stat-trend="${c.id}"><i class="fa-solid fa-arrow-trend-up"></i> ${c.trend}</span>` : ''}
        </div>
        <div class="cc-stat-value" id="${c.id}">${c.notTracked ? '—' : '0'}</div>
        <div class="cc-stat-label">${c.label}${c.notTracked ? ' <span style="opacity:.7;">(not tracked yet)</span>' : ''}</div>
        ${c.sub ? `<div style="font-size:0.72rem;color:var(--ink-mute);margin-top:4px;" data-stat-sub="${c.id}">${c.sub}</div>` : ''}
      </div>
    `).join('');
  }

  cards.forEach(c => {
    if (c.notTracked) return;
    const isFirstPaint = !countAnimState[c.id];
    animateCount(c.id, c.value);
    if (!isFirstPaint) pulseStat(c.id); // only pulse on genuine live changes, not initial load
    const trendEl = document.querySelector(`[data-stat-trend="${c.id}"]`);
    if (trendEl && c.trend) trendEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> ${c.trend}`;
    const subEl = document.querySelector(`[data-stat-sub="${c.id}"]`);
    if (subEl && c.sub) subEl.textContent = c.sub;
  });
}

function renderRecentTable() {
  const recent = [...state.profiles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);
  const tbody = document.querySelector('#ccRecentTable tbody');
  tbody.innerHTML = recent.map(p => `
    <tr>
      <td>${userCell(p)}</td>
      <td>${roleBadge(p)}</td>
      <td>${escapeHtml(institutionOf(p))}</td>
      <td>${timeAgo(p.created_at)}</td>
    </tr>
  `).join('') || emptyRow(4);
}

function userCell(p) {
  const photo = p.profile_photo
    ? `<img class="cc-avatar" src="${escapeHtml(p.profile_photo)}" alt="">`
    : `<div class="cc-avatar">${initials(displayName(p))}</div>`;
  return `<div class="cc-cell-user">${photo}<div><strong>${escapeHtml(displayName(p))}</strong><span>@${escapeHtml(p.username || 'unknown')}</span></div></div>`;
}
function roleBadge(p) {
  if (state.superAdminIds?.has(p.id)) return `<span class="cc-badge cc-badge-superadmin"><i class="fa-solid fa-shield-halved"></i> Super Admin</span>`;
  return isLecturerProfile(p) ? `<span class="cc-badge cc-badge-info">Lecturer</span>` : `<span class="cc-badge cc-badge-mute">Student</span>`;
}
function verifiedBadge(p) {
  return isVerified(p) ? `<span class="cc-badge cc-badge-ok"><i class="fa-solid fa-check"></i> Verified</span>` : `<span class="cc-badge cc-badge-mute">Unverified</span>`;
}
function statusBadge(p) {
  if (isBanned(p)) return `<span class="cc-badge cc-badge-danger">Banned</span>`;
  if (isSuspended(p)) return `<span class="cc-badge cc-badge-danger">Suspended</span>`;
  return `<span class="cc-badge cc-badge-ok">Active</span>`;
}
function emptyRow(colspan) {
  return `<tr><td colspan="${colspan}" style="text-align:center; color:var(--ink-mute); padding:30px;">No data yet</td></tr>`;
}

// ============================================================
// CHART THEME (Chart.js — themed to not look like default output)
// ============================================================
function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--ink-mute').trim() || '#8b84a3';
}
function chartGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || 'rgba(0,0,0,0.08)';
}
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// Vertical gradient fill for bars — solid at the top, fading toward the
// baseline — instead of a flat single color. Mirrors the treatment the
// line chart already had, so bars don't look flat by comparison.
function barGradient(canvasCtx, chartArea, hex) {
  if (!chartArea) return hex;
  const g = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, hexToRgba(hex, 0.95));
  g.addColorStop(1, hexToRgba(hex, 0.55));
  return g;
}
function horizontalBarGradient(canvasCtx, chartArea, hex) {
  if (!chartArea) return hex;
  const g = canvasCtx.createLinearGradient(chartArea.left, 0, chartArea.right, 0);
  g.addColorStop(0, hexToRgba(hex, 0.55));
  g.addColorStop(1, hexToRgba(hex, 0.95));
  return g;
}

// Registered once — draws the total in the center of any doughnut chart
// that sets `plugins.centerText`, so it reads as a real dashboard number
// rather than just a decorative ring.
const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart) {
    const opts = chart.config.options.plugins?.centerText;
    if (!opts) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '800 22px Inter, sans-serif';
    ctx.fillStyle = chartTextColor() === '' ? '#16132a' : getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    ctx.fillText(opts.value, cx, cy - 9);
    ctx.font = '600 10.5px Inter, sans-serif';
    ctx.fillStyle = chartTextColor();
    ctx.fillText(opts.label, cx, cy + 12);
    ctx.restore();
  },
};
if (window.Chart) Chart.register(centerTextPlugin);

function baseChartOptions(extra = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    // Staggered per-bar/point entrance instead of the whole dataset
    // appearing in one flat animation — reads as considerably livelier.
    animation: {
      duration: 820, easing: 'easeOutQuint',
      delay: (ctx) => ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 55 : 0,
    },
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff',
        titleColor: chartTextColor(), bodyColor: chartTextColor(),
        borderColor: chartGridColor(), borderWidth: 1, padding: 10, cornerRadius: 10,
        displayColors: true, boxPadding: 4,
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: chartTextColor(), font: { family: 'Inter', size: 11 } }, border: { display: false } },
      y: { grid: { color: chartGridColor(), drawTicks: false }, ticks: { color: chartTextColor(), font: { family: 'Inter', size: 11 } }, border: { display: false }, beginAtZero: true },
    },
    ...extra,
  };
}
function makeChart(canvasId, config) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, config);
  return state.charts[canvasId];
}
function refreshChartTheme() {
  if (document.getElementById('ccApp').classList.contains('is-ready')) {
    renderDashboardCharts();
    renderAnalyticsCharts();
  }
}

function renderDashboardCharts() {
  // last 14 days registrations, bar
  const days = [];
  const counts = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    days.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    const next = new Date(d); next.setDate(next.getDate() + 1);
    counts.push(state.profiles.filter(p => p.created_at && new Date(p.created_at) >= d && new Date(p.created_at) < next).length);
  }
  makeChart('chartRegistrations14', {
    type: 'bar',
    data: {
      labels: days, datasets: [{
        data: counts, borderRadius: 6, maxBarThickness: 22,
        backgroundColor: (ctx) => barGradient(ctx.chart.ctx, ctx.chart.chartArea, '#7c3aed'),
        hoverBackgroundColor: '#7c3aed',
      }],
    },
    options: baseChartOptions(),
  });

  // role split donut, with the total shown in the center
  const lecturers = state.profiles.filter(isLecturerProfile).length;
  const students = state.profiles.length - lecturers;
  makeChart('chartRoleSplitMini', {
    type: 'doughnut',
    data: { labels: ['Students', 'Lecturers'], datasets: [{ data: [students, lecturers], backgroundColor: ['#3b82f6', '#ec4899'], borderWidth: 0, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      animation: { duration: 900, easing: 'easeOutQuint', animateRotate: true, animateScale: true },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTextColor(), font: { family: 'Inter', size: 11 }, usePointStyle: true, boxWidth: 8 } },
        centerText: { value: (students + lecturers).toLocaleString(), label: 'total users' },
      },
    },
  });
}

function renderGrowthChart() {
  const range = state.registrationsRange;
  const label = document.getElementById('ccRegRangeLabel');
  let labels = [], counts = [];
  if (range === 'daily') {
    label.textContent = 'Daily, last 30 days';
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
      counts.push(state.profiles.filter(p => p.created_at && new Date(p.created_at) >= d && new Date(p.created_at) < next).length);
    }
  } else if (range === 'weekly') {
    label.textContent = 'Weekly, last 12 weeks';
    for (let i = 11; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i * 7); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      labels.push(`Wk of ${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`);
      counts.push(state.profiles.filter(p => p.created_at && new Date(p.created_at) >= start && new Date(p.created_at) < end).length);
    }
  } else {
    label.textContent = 'Monthly, last 12 months';
    for (let i = 11; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i, 1); d.setHours(0, 0, 0, 0);
      const next = new Date(d); next.setMonth(next.getMonth() + 1);
      labels.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
      counts.push(state.profiles.filter(p => p.created_at && new Date(p.created_at) >= d && new Date(p.created_at) < next).length);
    }
  }
  makeChart('chartGrowth', {
    type: 'line',
    data: {
      labels, datasets: [{
        data: counts, borderColor: '#7c3aed', borderWidth: 2.5, tension: 0.35, pointRadius: 0, pointHoverRadius: 5,
        fill: true,
        backgroundColor: (ctx) => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, ctx.chart.height);
          g.addColorStop(0, 'rgba(124,58,237,0.22)'); g.addColorStop(1, 'rgba(124,58,237,0)');
          return g;
        },
      }],
    },
    options: baseChartOptions(),
  });
}

function topN(map, n) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function renderAnalyticsCharts() {
  renderGrowthChart();

  // verification donut, with the verification rate shown in the center
  const verified = state.profiles.filter(isVerified).length;
  const unverified = state.profiles.length - verified;
  const total = verified + unverified;
  makeChart('chartVerification', {
    type: 'doughnut',
    data: { labels: ['Verified', 'Unverified'], datasets: [{ data: [verified, unverified], backgroundColor: ['#10b981', '#e5e2f5'], borderWidth: 0, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '72%',
      animation: { duration: 900, easing: 'easeOutQuint', animateRotate: true, animateScale: true },
      plugins: {
        legend: { position: 'bottom', labels: { color: chartTextColor(), usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 11 } } },
        centerText: { value: total ? `${Math.round(verified / total * 100)}%` : '0%', label: 'verified' },
      },
    },
  });

  // role distribution
  const lecturers = state.profiles.filter(isLecturerProfile).length;
  const students = state.profiles.length - lecturers;
  makeChart('chartRoles', {
    type: 'bar',
    data: {
      labels: ['Students', 'Lecturers'], datasets: [{
        data: [students, lecturers], borderRadius: 8, maxBarThickness: 40,
        backgroundColor: (ctx) => {
          const colors = ['#3b82f6', '#ec4899'];
          return horizontalBarGradient(ctx.chart.ctx, ctx.chart.chartArea, colors[ctx.dataIndex] || '#7c3aed');
        },
      }],
    },
    options: { ...baseChartOptions(), indexAxis: 'y' },
  });

  // top institutions
  const instMap = {};
  state.profiles.forEach(p => { const k = institutionOf(p); instMap[k] = (instMap[k] || 0) + 1; });
  const instTop = topN(instMap, 7);
  makeChart('chartInstitutions', {
    type: 'bar',
    data: {
      labels: instTop.map(([k]) => k.length > 18 ? k.slice(0, 16) + '…' : k),
      datasets: [{
        data: instTop.map(([, v]) => v), borderRadius: 6, maxBarThickness: 22,
        backgroundColor: (ctx) => horizontalBarGradient(ctx.chart.ctx, ctx.chart.chartArea, PALETTE[ctx.dataIndex % PALETTE.length]),
      }],
    },
    options: { ...baseChartOptions(), indexAxis: 'y', plugins: { ...baseChartOptions().plugins, legend: { display: false } } },
  });

  // top campuses
  const campMap = {};
  state.profiles.forEach(p => { const k = campusOf(p); campMap[k] = (campMap[k] || 0) + 1; });
  const campTop = topN(campMap, 7);
  const reversedPalette = PALETTE.slice().reverse();
  makeChart('chartCampuses', {
    type: 'bar',
    data: {
      labels: campTop.map(([k]) => k.length > 18 ? k.slice(0, 16) + '…' : k),
      datasets: [{
        data: campTop.map(([, v]) => v), borderRadius: 6, maxBarThickness: 22,
        backgroundColor: (ctx) => horizontalBarGradient(ctx.chart.ctx, ctx.chart.chartArea, reversedPalette[ctx.dataIndex % reversedPalette.length]),
      }],
    },
    options: { ...baseChartOptions(), indexAxis: 'y' },
  });
}

// ============================================================
// USERS TABLE
// ============================================================
function filteredUsers() {
  let list = state.profiles;
  const f = state.usersFilter;
  if (f === 'student') list = list.filter(p => !isLecturerProfile(p));
  else if (f === 'lecturer') list = list.filter(isLecturerProfile);
  else if (f === 'verified') list = list.filter(isVerified);
  else if (f === 'unverified') list = list.filter(p => !isVerified(p));
  else if (f === 'suspended') list = list.filter(isSuspended);
  else if (f === 'banned') list = list.filter(isBanned);

  if (state.usersSearch) {
    const q = state.usersSearch;
    list = list.filter(p =>
      (p.full_name || '').toLowerCase().includes(q) ||
      (p.username || '').toLowerCase().includes(q) ||
      (p.department || '').toLowerCase().includes(q)
    );
  }
  return list;
}

function renderUsersTable() {
  const list = filteredUsers();
  document.getElementById('ccUsersCountLabel').textContent = `${state.profiles.length.toLocaleString()} profiles total`;
  document.getElementById('ccUsersFootCount').textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}`;

  const pageSize = state.usersPageSize;
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  state.usersPage = Math.min(state.usersPage, totalPages);
  const start = (state.usersPage - 1) * pageSize;
  const pageItems = list.slice(start, start + pageSize);

  const tbody = document.querySelector('#ccUsersTable tbody');
  tbody.innerHTML = pageItems.map(p => `
    <tr>
      <td>${userCell(p)}</td>
      <td>${roleBadge(p)}</td>
      <td>${escapeHtml(campusOf(p))}</td>
      <td>${verifiedBadge(p)}</td>
      <td>${statusBadge(p)}</td>
      <td>${formatDate(p.created_at)}</td>
      <td><div class="cc-row-actions">
        <button class="cc-btn cc-btn-ghost cc-btn-icon" data-user-view="${p.id}" title="View"><i class="fa-solid fa-eye"></i></button>
      </div></td>
    </tr>
  `).join('') || emptyRow(7);

  tbody.querySelectorAll('[data-user-view]').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(btn.dataset.userView));
  });

  const pager = document.getElementById('ccUsersPagination');
  pager.innerHTML = '';
  if (totalPages > 1) {
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > 7 && i > 2 && i < totalPages - 1 && Math.abs(i - state.usersPage) > 1) {
        if (i === 3 || i === totalPages - 2) pager.insertAdjacentHTML('beforeend', `<span style="padding:4px 6px; color:var(--ink-mute);">…</span>`);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'cc-btn cc-btn-sm ' + (i === state.usersPage ? 'cc-btn-primary' : 'cc-btn-ghost');
      b.textContent = i;
      b.addEventListener('click', () => { state.usersPage = i; renderUsersTable(); });
      pager.appendChild(b);
    }
  }
}

// ============================================================
// LECTURERS TABLE
// ============================================================
function renderLecturersTable() {
  const q = (document.getElementById('ccLecturersSearch').value || '').toLowerCase();
  let list = state.profiles.filter(isLecturerProfile);
  document.getElementById('ccLecturersCountLabel').textContent = `${list.length.toLocaleString()} lecturers`;
  if (q) list = list.filter(p => (p.full_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q));

  const tbody = document.querySelector('#ccLecturersTable tbody');
  tbody.innerHTML = list.map(p => {
    const c = state.lecturerContentCounts[p.id] || { quizzes: 0, resources: 0, announcements: 0 };
    return `<tr>
      <td>${userCell(p)}</td>
      <td>${escapeHtml(institutionOf(p))}</td>
      <td>${escapeHtml(campusOf(p))}</td>
      <td>${escapeHtml(p.department || '—')}</td>
      <td class="mono">${c.quizzes}</td>
      <td class="mono">${c.resources}</td>
      <td class="mono">${c.announcements}</td>
      <td>${verifiedBadge(p)}</td>
    </tr>`;
  }).join('') || emptyRow(8);
  document.getElementById('ccLecturersFootCount').textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}`;
}

// ============================================================
// STUDENTS TABLE
// ============================================================
function renderStudentsTable() {
  const q = (document.getElementById('ccStudentsSearch').value || '').toLowerCase();
  let list = state.profiles.filter(p => !isLecturerProfile(p));
  document.getElementById('ccStudentsCountLabel').textContent = `${list.length.toLocaleString()} students`;
  if (q) list = list.filter(p => (p.full_name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q));

  const tbody = document.querySelector('#ccStudentsTable tbody');
  tbody.innerHTML = list.slice(0, 500).map(p => `
    <tr>
      <td>${userCell(p)}</td>
      <td>${escapeHtml(institutionOf(p))}</td>
      <td>${escapeHtml(campusOf(p))}</td>
      <td>${escapeHtml(p.department || '—')}</td>
      <td>${escapeHtml(p.custom_level || p.level || '—')}</td>
      <td>${verifiedBadge(p)}</td>
      <td>${statusBadge(p)}</td>
    </tr>
  `).join('') || emptyRow(7);
  document.getElementById('ccStudentsFootCount').textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}${list.length > 500 ? ' — showing first 500, use search to narrow down' : ''}`;
}

// ============================================================
// INSTITUTIONS
// ============================================================
function renderInstitutions() {
  const map = {};
  state.profiles.forEach(p => {
    const k = institutionOf(p);
    if (!map[k]) map[k] = { name: k, students: 0, lecturers: 0, verified: 0, campuses: new Set() };
    if (isLecturerProfile(p)) map[k].lecturers++; else map[k].students++;
    if (isVerified(p)) map[k].verified++;
    map[k].campuses.add(campusOf(p));
  });
  const list = Object.values(map).sort((a, b) => (b.students + b.lecturers) - (a.students + a.lecturers));
  document.getElementById('ccInstitutionsCountLabel').textContent = `${list.length} institution${list.length === 1 ? '' : 's'}, built automatically from profile data`;

  const grid = document.getElementById('ccInstitutionsGrid');
  grid.innerHTML = list.map(inst => `
    <div class="cc-stat-card">
      <div class="cc-stat-top">
        <div class="cc-stat-icn" style="background:#7c3aed1f; color:#7c3aed;"><i class="fa-solid fa-building-columns"></i></div>
      </div>
      <div class="cc-stat-value" style="font-size:1.1rem; line-height:1.3;">${escapeHtml(inst.name)}</div>
      <div style="display:flex; gap:14px; margin-top:12px; flex-wrap:wrap;">
        <div><div style="font-size:1.05rem; font-weight:800;">${inst.students + inst.lecturers}</div><div style="font-size:0.7rem; color:var(--ink-mute);">Users</div></div>
        <div><div style="font-size:1.05rem; font-weight:800;">${inst.students}</div><div style="font-size:0.7rem; color:var(--ink-mute);">Students</div></div>
        <div><div style="font-size:1.05rem; font-weight:800;">${inst.lecturers}</div><div style="font-size:0.7rem; color:var(--ink-mute);">Lecturers</div></div>
        <div><div style="font-size:1.05rem; font-weight:800;">${inst.campuses.size}</div><div style="font-size:0.7rem; color:var(--ink-mute);">Campuses</div></div>
      </div>
    </div>
  `).join('') || `<div class="cc-empty"><i class="fa-solid fa-building-columns"></i><h4>No institutions yet</h4><p>They'll appear here automatically as profiles fill in an institution.</p></div>`;
}

// ============================================================
// CAMPUSES (grouped under institution)
// ============================================================
function renderCampuses() {
  const byInst = {};
  state.profiles.forEach(p => {
    const inst = institutionOf(p);
    const camp = campusOf(p);
    byInst[inst] = byInst[inst] || {};
    if (!byInst[inst][camp]) byInst[inst][camp] = { name: camp, students: 0, lecturers: 0 };
    if (isLecturerProfile(p)) byInst[inst][camp].lecturers++; else byInst[inst][camp].students++;
  });

  let totalCampuses = 0;
  const container = document.getElementById('ccCampusesByInstitution');
  const blocks = Object.entries(byInst).sort((a, b) => Object.keys(b[1]).length - Object.keys(a[1]).length).map(([inst, camps]) => {
    const campList = Object.values(camps).sort((a, b) => (b.students + b.lecturers) - (a.students + a.lecturers));
    totalCampuses += campList.length;
    return `
      <div class="cc-panel" style="margin-bottom:16px;">
        <div class="cc-panel-head"><h3><i class="fa-solid fa-building-columns" style="color:var(--violet-600); margin-right:8px;"></i>${escapeHtml(inst)}</h3><p>${campList.length} campus${campList.length === 1 ? '' : 'es'}</p></div>
        <div class="cc-stat-grid" style="margin-bottom:0;">
          ${campList.map(c => `
            <div class="cc-stat-card" style="box-shadow:none; border:1px solid var(--border);">
              <div class="cc-stat-label" style="font-weight:700; color:var(--ink); margin-bottom:8px;">${escapeHtml(c.name)}</div>
              <div style="display:flex; gap:14px;">
                <div><div style="font-weight:800;">${c.students}</div><div style="font-size:0.68rem; color:var(--ink-mute);">Students</div></div>
                <div><div style="font-weight:800;">${c.lecturers}</div><div style="font-size:0.68rem; color:var(--ink-mute);">Lecturers</div></div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }).join('');

  document.getElementById('ccCampusesCountLabel').textContent = `${totalCampuses} campus${totalCampuses === 1 ? '' : 'es'} across ${Object.keys(byInst).length} institutions`;
  container.innerHTML = blocks || `<div class="cc-empty"><i class="fa-solid fa-map-location-dot"></i><h4>No campuses yet</h4></div>`;
}

// ============================================================
// GROUPS
// ============================================================
function handleGroupAction(action, groupId) {
  const g = state.groups.find(x => x.id === groupId);
  if (!g) return;
  const previousStatus = g.moderation_status || 'active';

  if (action === 'reinstate') {
    confirmAction({
      title: 'Reinstate this group?', body: `${g.name} will be fully active again — messaging and joining both resume immediately.`, icon: 'fa-circle-check', danger: false,
      run: async () => {
        await setGroupModeration(groupId, { moderation_status: 'active', moderation_reason: null });
        await logModeration('group_reinstate', 'group', groupId, null, previousStatus, 'active');
        if (g.created_by) await notifyUser(g.created_by, 'group_reinstated', `Your group "${g.name}" has been reinstated and is fully active again.`, null);
      },
    });
    return;
  }

  if (action === 'warn') {
    reasonAction({
      title: `Warn "${g.name}"?`, icon: 'fa-triangle-exclamation',
      subtitle: "The group stays active, but its creator gets a direct warning notification with this reason.",
      label: 'Reason for the warning',
      run: async (reason, policyRef) => {
        await setGroupModeration(groupId, { moderation_status: 'warned', moderation_reason: reason, moderation_at: new Date().toISOString(), moderated_by: state.adminId, moderation_policy_ref: policyRef });
        await logModeration('group_warn', 'group', groupId, reason, previousStatus, 'warned', policyRef);
        if (g.created_by) await notifyUser(g.created_by, 'group_warning', `Your group "${g.name}" received a warning: ${reason}`, null, policyRef);
      },
    });
    return;
  }

  if (action === 'suspend') {
    reasonAction({
      title: `Suspend "${g.name}"?`, icon: 'fa-ban',
      subtitle: "Members will see this group is suspended, new messages and new members are blocked platform-wide (not just hidden in this UI). Its creator gets this reason as a notification.",
      label: 'Reason for suspension',
      run: async (reason, policyRef) => {
        await setGroupModeration(groupId, { moderation_status: 'suspended', moderation_reason: reason, moderation_at: new Date().toISOString(), moderated_by: state.adminId, moderation_policy_ref: policyRef });
        await logModeration('group_suspend', 'group', groupId, reason, previousStatus, 'suspended', policyRef);
        if (g.created_by) await notifyUser(g.created_by, 'group_suspended', `Your group "${g.name}" was suspended: ${reason}`, null, policyRef);
      },
    });
  }
}

// Every moderation action is written to moderation_log via this one RPC
// (log_moderation_event, security-fixes-5-moderation.sql). The function
// itself re-checks that the caller is a super admin and is the only way to
// write a row, so the audit trail can't be forged or hand-edited even from
// this same admin panel.
async function logModeration(actionType, targetType, targetId, reason, previousState, newState, policyRef) {
  const { error } = await supabase.rpc('log_moderation_event', {
    p_action_type: actionType, p_target_type: targetType, p_target_id: targetId,
    p_reason: reason || null, p_previous_state: previousState || null, p_new_state: newState || null,
    p_policy_ref: policyRef || null,
  });
  if (error) console.warn('Could not write moderation log entry:', error.message);
}

async function setGroupModeration(groupId, fields) {
  const { error } = await supabase.from('groups').update(fields).eq('id', groupId);
  if (error) { toast('Could not update group — ' + error.message, 'err'); return; }
  const idx = state.groups.findIndex(g => g.id === groupId);
  if (idx > -1) state.groups[idx] = { ...state.groups[idx], ...fields };
  renderGroupsTable();
  toast('Group updated', 'ok');
}

function groupStatusBadge(g) {
  const status = g.moderation_status || 'active';
  if (status === 'suspended') return `<span class="cc-badge cc-badge-danger">Suspended</span>`;
  if (status === 'warned') return `<span class="cc-badge cc-badge-warn">Warned</span>`;
  return `<span class="cc-badge cc-badge-ok">Active</span>`;
}

function renderGroupsTable() {
  const q = (document.getElementById('ccGroupsSearch').value || '').toLowerCase();
  let list = state.groups;
  if (q) list = list.filter(g => (g.name || '').toLowerCase().includes(q) || (g.course_code || '').toLowerCase().includes(q));
  document.getElementById('ccGroupsCountLabel').textContent = `${state.groups.length.toLocaleString()} groups across Peerloom`;

  const tbody = document.querySelector('#ccGroupsTable tbody');
  tbody.innerHTML = list.map(g => `
    <tr>
      <td><strong>${escapeHtml(g.name || 'Untitled group')}</strong></td>
      <td>${escapeHtml(g.course_code || '—')}</td>
      <td>${escapeHtml(g.institution || '—')}</td>
      <td class="mono">${state.groupMemberCounts[g.id] || 0}</td>
      <td>${groupStatusBadge(g)}</td>
      <td>${formatDate(g.created_at)}</td>
      <td><div class="cc-row-actions">
        ${g.moderation_status === 'suspended'
          ? `<button class="cc-btn cc-btn-soft cc-btn-sm" data-group-action="reinstate" data-group-id="${g.id}">Reinstate</button>`
          : `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-group-action="warn" data-group-id="${g.id}">Warn</button>
             <button class="cc-btn cc-btn-danger cc-btn-sm" data-group-action="suspend" data-group-id="${g.id}">Suspend</button>`}
      </div></td>
    </tr>
  `).join('') || emptyRow(7);

  tbody.querySelectorAll('[data-group-action]').forEach(btn => {
    btn.addEventListener('click', () => handleGroupAction(btn.dataset.groupAction, btn.dataset.groupId));
  });
  document.getElementById('ccGroupsFootCount').textContent = `${list.length.toLocaleString()} result${list.length === 1 ? '' : 's'}`;
}

// ============================================================
// REPORTS (moderation queue)
// ============================================================
function isReportPending(r) { return !r.status || r.status === 'pending'; }

function renderReports() {
  let list = state.reports;
  if (state.reportsFilter === 'pending') list = list.filter(isReportPending);
  else if (state.reportsFilter === 'resolved') list = list.filter(r => !isReportPending(r));

  const tbody = document.querySelector('#ccReportsTable tbody');
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.type === 'post'
        ? '<span class="cc-badge cc-badge-info"><i class="fa-solid fa-clapperboard"></i> Skrolz post</span>'
        : '<span class="cc-badge cc-badge-mute"><i class="fa-solid fa-message"></i> Chat message</span>'}</td>
      <td>${escapeHtml(r.reason || 'No reason given')}</td>
      <td>${escapeHtml(r.reportedUserName)}</td>
      <td>${escapeHtml(r.reportedByName)}</td>
      <td>${timeAgo(r.created_at)}</td>
      <td>${isReportPending(r) ? '<span class="cc-badge cc-badge-warn">Pending</span>' : '<span class="cc-badge cc-badge-ok">Resolved</span>'}</td>
      <td><div class="cc-row-actions">
        ${r.type === 'post' && r.post ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-view-post="${r.id}">View</button>` : ''}
        ${isReportPending(r) ? `<button class="cc-btn cc-btn-soft cc-btn-sm" data-resolve-report="${r.id}">Resolve</button>` : ''}
      </div></td>
    </tr>
  `).join('') || `<tr><td colspan="7"><div class="cc-empty"><i class="fa-solid fa-flag"></i><h4>Nothing here</h4><p>${state.reportsFilter === 'pending' ? 'No pending reports right now — the queue is clear.' : 'No reports match this filter.'}</p></div></td></tr>`;

  tbody.querySelectorAll('[data-resolve-report]').forEach(btn => {
    btn.addEventListener('click', () => resolveReport(btn.dataset.resolveReport));
  });
  tbody.querySelectorAll('[data-view-post]').forEach(btn => {
    btn.addEventListener('click', () => openPostPreview(btn.dataset.viewPost));
  });
}

function renderReportsBadge() {
  const pending = state.reports.filter(isReportPending).length;
  const badge = document.getElementById('ccReportsBadge');
  badge.style.display = pending ? 'inline-flex' : 'none';
  badge.textContent = pending;
}

function severityBadge(sev) {
  if (sev === 'high') return '<span class="cc-badge cc-badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> High</span>';
  if (sev === 'medium') return '<span class="cc-badge cc-badge-warn">Medium</span>';
  return '<span class="cc-badge cc-badge-mute">Low</span>';
}

function recommendedAction(severity) {
  if (severity === 'high') return 'Suspend or ban';
  if (severity === 'medium') return 'Warn';
  return 'Monitor';
}

function renderModeration() {
  let list = state.moderationEvents;
  if (state.moderationFilter === 'unseen') list = list.filter(e => !e.seen_at);
  else if (state.moderationFilter === 'high') list = list.filter(e => e.severity === 'high');

  const tbody = document.querySelector('#ccModerationTable tbody');
  tbody.innerHTML = list.map(e => {
    const icon = e.content_type === 'message' ? 'fa-comment' : e.content_type === 'post' ? 'fa-clapperboard' : 'fa-comment-dots';
    const groupActions = e.group_id ? `
        <button class="cc-btn cc-btn-ghost cc-btn-sm" data-warn-event-group="${e.group_id}">Warn group</button>
        <button class="cc-btn cc-btn-ghost cc-btn-sm" data-suspend-event-group="${e.group_id}">Suspend group</button>
        <a class="cc-btn cc-btn-ghost cc-btn-sm" href="chatroom.html?group=${encodeURIComponent(e.group_id)}" target="_blank" rel="noopener">Open chat</a>` : '';
    return `
    <tr>
      <td>${severityBadge(e.severity)}</td>
      <td>${escapeHtml(e.category)}</td>
      <td>${escapeHtml(e.userName)}</td>
      <td><i class="fa-solid ${icon}"></i> ${e.group_id ? escapeHtml(e.groupName) : escapeHtml(e.content_type)}</td>
      <td style="max-width:260px; white-space:normal;">${escapeHtml(e.snippet)}</td>
      <td>${e.action_taken === 'hidden' ? '<span class="cc-badge cc-badge-danger">Hidden</span>' : '<span class="cc-badge cc-badge-mute">Allowed, logged</span>'}<div style="font-size:0.7rem; color:var(--ink-mute); margin-top:4px;">Recommended: ${recommendedAction(e.severity)}</div></td>
      <td>${timeAgo(e.created_at)}</td>
      <td><div class="cc-row-actions">
        ${!e.seen_at ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-ack-event="${e.id}">Mark reviewed</button>` : ''}
        <button class="cc-btn cc-btn-soft cc-btn-sm" data-review-user="${e.user_id}">Review user</button>${groupActions}
      </div></td>
    </tr>
  `;
  }).join('') || `<tr><td colspan="8"><div class="cc-empty"><i class="fa-solid fa-shield-halved"></i><h4>Nothing here</h4><p>${state.moderationFilter === 'unseen' ? 'No flagged content waiting for review.' : 'No matching events.'}</p></div></td></tr>`;

  tbody.querySelectorAll('[data-ack-event]').forEach(btn => {
    btn.addEventListener('click', () => acknowledgeModerationEvent(btn.dataset.ackEvent));
  });
  tbody.querySelectorAll('[data-review-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = state.profiles.find(x => x.id === btn.dataset.reviewUser);
      if (p) openUserModal(p.id);
    });
  });
  tbody.querySelectorAll('[data-warn-event-group]').forEach(btn => {
    btn.addEventListener('click', () => handleGroupAction('warn', btn.dataset.warnEventGroup));
  });
  tbody.querySelectorAll('[data-suspend-event-group]').forEach(btn => {
    btn.addEventListener('click', () => handleGroupAction('suspend', btn.dataset.suspendEventGroup));
  });

  document.getElementById('ccModerationFootCount').textContent = `${list.length} event${list.length === 1 ? '' : 's'}`;
}

function renderModerationBadge() {
  const unseen = state.moderationEvents.filter(e => !e.seen_at && (e.severity === 'high' || e.severity === 'medium')).length;
  const badge = document.getElementById('ccModerationBadge');
  badge.style.display = unseen ? 'inline-flex' : 'none';
  badge.textContent = unseen;
}

async function acknowledgeModerationEvent(id) {
  const { error } = await supabase.rpc('acknowledge_moderation_event', { p_id: id });
  if (error) { toast('Could not mark reviewed — ' + error.message, 'err'); return; }
  const e = state.moderationEvents.find(x => x.id === id);
  if (e) e.seen_at = new Date().toISOString();
  renderModeration();
  renderModerationBadge();
}

async function resolveReport(id) {
  const { error } = await supabase.from('reports').update({ status: 'resolved' }).eq('id', id);
  if (error) { toast('Could not resolve report — ' + error.message, 'err'); return; }
  const r = state.reports.find(x => x.id === id);
  if (r) r.status = 'resolved';
  renderReports(); renderReportsBadge();
  toast('Report marked resolved', 'ok');
}

function openPostPreview(reportId) {
  const r = state.reports.find(x => x.id === reportId);
  if (!r || !r.post) return;
  const author = state.profiles.find(p => p.id === r.post.user_id);
  const body = document.getElementById('ccPostPreviewBody');

  const mediaHtml = r.post.media_url
    ? (r.post.media_type === 'video'
        ? `<video src="${r.post.media_url}" controls style="width:100%; border-radius:12px; max-height:360px; background:#000;"></video>`
        : `<img src="${r.post.media_url}" style="width:100%; border-radius:12px; max-height:360px; object-fit:cover;">`)
    : '';

  const statusLabel = { active: 'Active', warned: 'Warned', removed: 'Removed' }[r.post.moderation_status] || 'Active';
  const statusBadgeClass = r.post.moderation_status === 'removed' ? 'cc-badge-danger' : r.post.moderation_status === 'warned' ? 'cc-badge-warn' : 'cc-badge-ok';

  body.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
      <div style="display:flex; align-items:center; gap:10px;">
        ${author ? userCell(author) : '<span style="color:var(--ink-mute);">Unknown author</span>'}
      </div>
      <span class="cc-badge ${statusBadgeClass}">${statusLabel}</span>
    </div>
    ${r.post.title ? `<h4 style="margin:0 0 8px;">${escapeHtml(r.post.title)}</h4>` : ''}
    ${mediaHtml}
    ${r.post.content ? `<p style="margin:12px 0 0; font-size:0.88rem; color:var(--text);">${escapeHtml(r.post.content)}</p>` : ''}
    <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border);">
      <div style="font-size:0.72rem; color:var(--ink-mute); margin-bottom:6px;">REPORTED FOR</div>
      <div style="font-size:0.88rem;">${escapeHtml(r.reason || 'No reason given')}</div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:20px;">
      <button class="cc-btn cc-btn-ghost cc-btn-sm" data-post-action="warn">Warn author</button>
      ${r.post.moderation_status !== 'removed' ? `<button class="cc-btn cc-btn-danger cc-btn-sm" data-post-action="remove">Remove post</button>` : `<button class="cc-btn cc-btn-soft cc-btn-sm" data-post-action="restore">Restore post</button>`}
      ${isReportPending(r) ? `<button class="cc-btn cc-btn-soft cc-btn-sm" data-post-action="resolve">Mark report resolved</button>` : ''}
    </div>
  `;

  body.querySelectorAll('[data-post-action]').forEach(btn => {
    btn.addEventListener('click', () => handlePostAction(btn.dataset.postAction, r));
  });
  openModal('ccPostPreviewBackdrop');
}

function handlePostAction(action, r) {
  if (action === 'resolve') { resolveReport(r.id); closeModal('ccPostPreviewBackdrop'); return; }

  if (action === 'restore') {
    closeModal('ccPostPreviewBackdrop');
    confirmAction({
      title: 'Restore this post?', body: 'It will become visible in Skrolz again.', icon: 'fa-eye', danger: false,
      run: () => setPostModeration(r.post.id, { moderation_status: 'active', moderation_reason: null }),
    });
    return;
  }

  if (action === 'remove') {
    closeModal('ccPostPreviewBackdrop');
    reasonAction({
      title: 'Remove this post?', icon: 'fa-trash',
      subtitle: 'The post is hidden from Skrolz immediately. The author sees this reason as a notification.',
      label: 'Reason for removal',
      run: async (reason, policyRef) => {
        await setPostModeration(r.post.id, { moderation_status: 'removed', moderation_reason: reason, moderation_at: new Date().toISOString(), moderated_by: state.adminId, moderation_policy_ref: policyRef });
        await logModeration('content_remove', 'post', r.post.id, reason, r.post.moderation_status || 'active', 'removed', policyRef);
        await notifyUser(r.post.user_id, 'content_removed', `Your post was removed: ${reason}`, r.post.id, policyRef);
      },
    });
    return;
  }

  if (action === 'warn') {
    closeModal('ccPostPreviewBackdrop');
    reasonAction({
      title: 'Warn the post author?', icon: 'fa-triangle-exclamation',
      subtitle: 'The post stays visible, but the author gets a direct warning notification with this reason.',
      label: 'Reason for the warning',
      run: async (reason, policyRef) => {
        await setPostModeration(r.post.id, { moderation_status: 'warned', moderation_reason: reason, moderation_at: new Date().toISOString(), moderated_by: state.adminId, moderation_policy_ref: policyRef });
        await logModeration('content_warn', 'post', r.post.id, reason, r.post.moderation_status || 'active', 'warned', policyRef);
        await notifyUser(r.post.user_id, 'content_warning', `You received a warning about a post: ${reason}`, r.post.id, policyRef);
      },
    });
  }
}

async function setPostModeration(postId, fields) {
  const { error } = await supabase.from('posts').update(fields).eq('id', postId);
  if (error) { toast('Could not update post — ' + error.message, 'err'); return; }
  state.reports.forEach(r => { if (r.post?.id === postId) r.post = { ...r.post, ...fields }; });
  renderReports();
  toast('Post updated', 'ok');
}

async function notifyUser(userId, type, content, postId, policyRef) {
  // Supabase's .insert() does NOT throw on a database-level failure (RLS
  // rejection, a column that doesn't exist yet, a constraint violation) —
  // it resolves normally with { data, error }. A try/catch alone silently
  // missed every one of those, which is why a failed warning could vanish
  // completely with zero indication anything went wrong, for either the
  // admin or the person who should have been warned. Checking { error }
  // explicitly, and surfacing it, is the actual fix.
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: userId, sender_id: state.adminId, type, content, post_id: postId || null, origin: 'command_center',
      policy_ref: policyRef || null,
    });
    if (error) {
      console.error('notifyUser: notification insert failed —', error.message, error.details || '', error.hint || '');
      toast('That action saved, but the notification to the user failed to send: ' + error.message, 'err');
      return false;
    }
    return true;
  } catch (err) {
    console.error('notifyUser: unexpected error —', err);
    toast('That action saved, but the notification to the user failed to send.', 'err');
    return false;
  }
}

// ============================================================
// ACTIVITY FEED (real events, not a mock notifications table)
// ============================================================
function buildActivityFeed(limit) {
  const events = [];
  state.profiles.forEach(p => events.push({ type: 'signup', at: p.created_at, profile: p }));
  state.reports.forEach(r => events.push({ type: 'report', at: r.created_at, report: r }));
  state.profiles.filter(isSuspended).forEach(p => events.push({ type: 'suspended', at: p.suspended_at || p.created_at, profile: p }));
  return events.filter(e => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}
function activityRowHtml(e) {
  const icons = { signup: ['fa-user-plus', '#7c3aed'], report: ['fa-flag', '#f59e0b'], suspended: ['fa-ban', '#ef4444'] };
  const [icon, color] = icons[e.type];
  let text = '';
  if (e.type === 'signup') text = `<strong>${escapeHtml(displayName(e.profile))}</strong> joined Peerloom`;
  if (e.type === 'report') text = `New report: <strong>${escapeHtml(e.report.reason || 'flagged content')}</strong>`;
  if (e.type === 'suspended') text = `<strong>${escapeHtml(displayName(e.profile))}</strong> was suspended`;
  return `<div class="cc-notif-item">
    <div class="cc-notif-icn" style="background:${color}1f; color:${color};"><i class="fa-solid ${icon}"></i></div>
    <div><div>${text}</div><div class="cc-notif-time">${timeAgo(e.at)}</div></div>
  </div>`;
}
function renderNotifDropdown() {
  const events = buildActivityFeed(8);
  document.getElementById('ccNotifList').innerHTML = events.map(activityRowHtml).join('') || `<div class="cc-empty" style="padding:30px 16px;"><p>No activity yet</p></div>`;
  document.getElementById('ccNotifCount').textContent = `${events.length} recent`;
  document.getElementById('ccNotifDot').style.display = events.length ? 'block' : 'none';
}
function renderActivityFeed() {
  const events = buildActivityFeed(60);
  document.getElementById('ccActivityFeedFull').innerHTML = events.map(activityRowHtml).join('') || `<div class="cc-empty"><i class="fa-solid fa-bell"></i><h4>No activity yet</h4></div>`;
}

// ============================================================
// USER MODAL + ACTIONS
// ============================================================
function openUserModal(id) {
  const p = state.profiles.find(x => x.id === id);
  if (!p) return;
  const body = document.getElementById('ccUserModalBody');
  const photo = p.profile_photo ? `<img class="cc-avatar" style="width:56px;height:56px;font-size:1.2rem;" src="${p.profile_photo}">` : `<div class="cc-avatar" style="width:56px;height:56px;font-size:1.2rem;">${initials(displayName(p))}</div>`;
  body.innerHTML = `
    <div style="display:flex; gap:14px; align-items:center; margin-bottom:20px;">
      ${photo}
      <div>
        <div style="font-weight:800; font-size:1.05rem;">${escapeHtml(displayName(p))}</div>
        <div style="color:var(--ink-mute); font-size:0.84rem;">@${escapeHtml(p.username || 'unknown')}</div>
        <div style="display:flex; gap:6px; margin-top:6px;">${roleBadge(p)}${verifiedBadge(p)}${statusBadge(p)}</div>
      </div>
    </div>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:0.84rem; margin-bottom:22px;">
      <div><div style="color:var(--ink-mute); font-size:0.72rem;">Campus</div><div>${escapeHtml(campusOf(p))}</div></div>
      <div><div style="color:var(--ink-mute); font-size:0.72rem;">Department</div><div>${escapeHtml(p.department || '—')}</div></div>
      <div><div style="color:var(--ink-mute); font-size:0.72rem;">Level</div><div>${escapeHtml(p.custom_level || p.level || '—')}</div></div>
      <div><div style="color:var(--ink-mute); font-size:0.72rem;">Joined</div><div>${formatDate(p.created_at)}</div></div>
      <div><div style="color:var(--ink-mute); font-size:0.72rem;">User ID</div><div class="mono" style="font-size:0.72rem;">${p.id}</div></div>
    </div>
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      ${isVerified(p) ? btn('Unverify', 'cc-btn-ghost', 'unverify') : btn('Verify', 'cc-btn-soft', 'verify')}
      ${isLecturerProfile(p) ? btn('Demote to student', 'cc-btn-ghost', 'demote') : btn('Promote to lecturer', 'cc-btn-ghost', 'promote')}
      ${btn('Warn', 'cc-btn-ghost', 'warn')}
      ${isSuspended(p) ? btn('Unsuspend', 'cc-btn-soft', 'unsuspend') : btn('Suspend', 'cc-btn-ghost', 'suspend')}
      ${isBanned(p) ? btn('Unban', 'cc-btn-soft', 'unban') : btn('Ban', 'cc-btn-danger', 'ban')}
      ${btn('Delete profile', 'cc-btn-danger', 'delete')}
    </div>
    <p style="font-size:0.72rem; color:var(--ink-mute); margin-top:14px;">Deleting removes their Peerloom profile data. It does not remove their login credential — that requires Supabase's admin API with a service-role key, outside this client-side tool.</p>
  `;
  body.querySelectorAll('[data-user-action]').forEach(b => {
    b.addEventListener('click', () => handleUserAction(b.dataset.userAction, p));
  });
  openModal('ccUserModalBackdrop');

  function btn(label, cls, action) {
    return `<button class="cc-btn ${cls} cc-btn-sm" data-user-action="${action}">${label}</button>`;
  }
}

function handleUserAction(action, p) {
  const prevStatus = p.account_status || 'active';

  if (action === 'suspend') {
    closeModal('ccUserModalBackdrop');
    reasonAction({
      title: `Suspend ${displayName(p)}?`,
      subtitle: "They'll see this exact reason on a branded suspension screen the next time they try to log in, and every new post/message/quiz-attempt/join is blocked platform-wide, not just here.",
      label: 'Reason for suspension',
      icon: 'fa-ban',
      run: async (reason, policyRef) => {
        const ok = await setProfileField(p.id, { account_status: 'suspended', suspended_at: new Date().toISOString(), suspended_reason: reason, suspended_policy_ref: policyRef });
        await logModeration('user_suspend', 'user', p.id, reason, prevStatus, 'suspended', policyRef);
        if (ok) await revokeUserSessions(p.id);
      },
    });
    return;
  }

  if (action === 'ban') {
    closeModal('ccUserModalBackdrop');
    reasonAction({
      title: `Ban ${displayName(p)}?`,
      subtitle: "Ban is for serious/repeated violations. Same enforcement as suspension (blocked platform-wide, blocked from logging in), kept as a separate status so it's clearly distinguishable in reports and the audit log.",
      label: 'Reason for the ban',
      icon: 'fa-gavel',
      run: async (reason, policyRef) => {
        const ok = await setProfileField(p.id, { account_status: 'banned', suspended_at: new Date().toISOString(), suspended_reason: reason, suspended_policy_ref: policyRef });
        await logModeration('user_ban', 'user', p.id, reason, prevStatus, 'banned', policyRef);
        if (ok) await revokeUserSessions(p.id);
      },
    });
    return;
  }

  if (action === 'warn') {
    closeModal('ccUserModalBackdrop');
    reasonAction({
      title: `Warn ${displayName(p)}?`,
      subtitle: "Their account stays fully active. They get a direct notification with this reason.",
      label: 'Reason for the warning',
      icon: 'fa-triangle-exclamation',
      run: async (reason, policyRef) => {
        await logModeration('user_warn', 'user', p.id, reason, prevStatus, prevStatus, policyRef);
        // Warning a user changes no column on their profile — unlike
        // suspend/ban/unsuspend (which call setProfileField and always show
        // a toast either way) there was previously NO toast at all here, on
        // success or failure, for either the admin or (if the insert
        // silently failed) the person being warned. notifyUser() now
        // actually reports whether it worked, so this can too.
        const ok = await notifyUser(p.id, 'account_warning', `You received a warning from Peerloom moderation: ${reason}`, null, policyRef);
        if (ok) toast('Warning sent', 'ok');
      },
    });
    return;
  }

  const map = {
    verify: { title: 'Verify this user?', body: `${displayName(p)} will get a verified badge across Peerloom.`, icon: 'fa-circle-check', danger: false, run: () => setProfileField(p.id, { verified: true }) },
    unverify: { title: 'Remove verification?', body: `${displayName(p)} will lose their verified badge.`, icon: 'fa-circle-xmark', danger: true, run: () => setProfileField(p.id, { verified: false }) },
    promote: { title: 'Promote to lecturer?', body: `${displayName(p)} will get lecturer access across Peerloom.`, icon: 'fa-arrow-up', danger: false, run: () => setProfileField(p.id, { role: 'lecturer', is_lecturer: true }) },
    demote: { title: 'Demote to student?', body: `${displayName(p)} will lose lecturer access.`, icon: 'fa-arrow-down', danger: true, run: () => setProfileField(p.id, { role: 'student', is_lecturer: false }) },
    unsuspend: { title: 'Unsuspend this account?', body: `${displayName(p)} will regain full access immediately.`, icon: 'fa-circle-check', danger: false, run: async () => { await setProfileField(p.id, { account_status: 'active', suspended_at: null, suspended_reason: null }); await logModeration('user_unsuspend', 'user', p.id, null, prevStatus, 'active'); } },
    unban: { title: 'Unban this account?', body: `${displayName(p)} will regain full access immediately.`, icon: 'fa-circle-check', danger: false, run: async () => { await setProfileField(p.id, { account_status: 'active', suspended_at: null, suspended_reason: null }); await logModeration('user_unban', 'user', p.id, null, prevStatus, 'active'); } },

  }[action];
  if (action === 'delete') {
    closeModal('ccUserModalBackdrop');
    reasonAction({
      title: `Delete ${displayName(p)}'s profile?`, icon: 'fa-trash',
      subtitle: "This permanently removes their profile data from Peerloom and can't be undone. They'll see this reason, linked to the rule, the next time they try to sign in.",
      label: 'Reason for deletion',
      run: (reason, policyRef) => deleteProfile(p.id, reason, policyRef),
    });
    return;
  }

  if (!map) return;
  closeModal('ccUserModalBackdrop');
  confirmAction(map);
}

async function setProfileField(id, fields) {
  const { error } = await supabase.from('profiles').update(fields).eq('id', id);
  if (error) { toast('Update failed — ' + error.message, 'err'); return false; }
  const idx = state.profiles.findIndex(p => p.id === id);
  if (idx > -1) state.profiles[idx] = { ...state.profiles[idx], ...fields };
  renderAll();
  toast('Updated', 'ok');
  return true;
}

// Forces an already-logged-in user out of every session they currently hold
// (every device, every open tab). Without this, suspending/banning someone
// only blocks their NEXT sign-in and blocks new writes (enforced in
// security-fixes-5-moderation.sql) — a session they already had stays
// usable for reads, and keeps renewing itself, until this runs. Needs the
// service-role key, so it's a server-side Edge Function
// (admin-revoke-sessions), never done from here directly. A failure here is
// reported but doesn't undo the suspend/ban that already succeeded — the
// account_status change and the write-blocking trigger are still in effect
// either way, this only closes the "already had a session open" gap.
async function revokeUserSessions(userId) {
  try {
    const { error } = await supabase.functions.invoke('admin-revoke-sessions', {
      body: { user_id: userId },
    });
    if (error) {
      console.error('revokeUserSessions: admin-revoke-sessions failed —', error.message);
      toast('Account suspended/banned, but an existing session could not be forced out: ' + error.message, 'err');
      return false;
    }
    return true;
  } catch (err) {
    console.error('revokeUserSessions: unexpected error —', err);
    toast('Account suspended/banned, but forcing out an existing session failed unexpectedly.', 'err');
    return false;
  }
}
// Goes through admin_delete_profile (security-fixes-6-policy-refs.sql) rather
// than a plain table delete: that function does the delete, the audit-log
// row, and the account_notices row the person sees at their next sign-in
// attempt, all in one transaction, and re-checks the caller is a super admin
// itself rather than trusting this being an admin-only screen.
async function deleteProfile(id, reason, policyRef) {
  const { error } = await supabase.rpc('admin_delete_profile', {
    p_user_id: id, p_reason: reason, p_policy_ref: policyRef || null,
  });
  if (error) { toast('Delete failed — ' + error.message, 'err'); return; }
  state.profiles = state.profiles.filter(p => p.id !== id);
  renderAll();
  toast('Profile deleted', 'ok');
}

// ============================================================
// CONFIRM MODAL
// ============================================================
function confirmAction({ title, body, icon, danger, run }) {
  document.getElementById('ccConfirmTitle').textContent = title;
  document.getElementById('ccConfirmBody').textContent = body;
  const iconEl = document.getElementById('ccConfirmIcon');
  iconEl.innerHTML = `<i class="fa-solid ${icon}"></i>`;
  iconEl.style.background = danger ? 'var(--danger-soft)' : 'var(--ok-soft)';
  iconEl.style.color = danger ? 'var(--danger)' : 'var(--ok)';
  const actionBtn = document.getElementById('ccConfirmActionBtn');
  actionBtn.className = 'cc-btn ' + (danger ? 'cc-btn-danger' : 'cc-btn-primary');
  const newBtn = actionBtn.cloneNode(true);
  actionBtn.parentNode.replaceChild(newBtn, actionBtn);
  newBtn.addEventListener('click', async () => {
    newBtn.disabled = true;
    await run();
    newBtn.disabled = false;
    closeModal('ccConfirmModalBackdrop');
  });
  openModal('ccConfirmModalBackdrop');
}

// Same idea as confirmAction, but for anything where the reason typed in
// is itself part of the action — warnings and suspensions, where the
// affected person (or group) actually sees this text. Requires a
// non-empty reason before it'll run.
// Prefers the shared docs/js/policy-refs.js (keeps this list and the
// Terms/Privacy pages' section ids in sync automatically), but never
// depends on it loading successfully — EMBEDDED_POLICY_REGISTRY below is a
// duplicate of the same list kept directly in this file, so the "Rule
// breached" dropdown works even if that external script 404s or is slow.
// If you add a rule, add it in BOTH places (js/policy-refs.js AND here).
const EMBEDDED_POLICY_REGISTRY = [
  { key: 'terms:impersonation',         page: 'terms.html',   pageName: 'Terms of Service', label: 'Impersonation or misrepresenting your role or affiliation' },
  { key: 'terms:harassment',            page: 'terms.html',   pageName: 'Terms of Service', label: 'Harassing, abusive, unlawful or rights-infringing content' },
  { key: 'terms:unauthorized-access',   page: 'terms.html',   pageName: 'Terms of Service', label: 'Unauthorized access to accounts, groups or quiz data' },
  { key: 'terms:platform-interference', page: 'terms.html',   pageName: 'Terms of Service', label: 'Interfering with the platform (scripts, bots, bypassing security)' },
  { key: 'terms:spam-malware',          page: 'terms.html',   pageName: 'Terms of Service', label: 'Malware, spam or unsolicited commercial content' },
  { key: 'terms:academic-integrity',    page: 'terms.html',   pageName: 'Terms of Service', label: 'Quizzes & academic integrity' },
  { key: 'terms:content-rights',        page: 'terms.html',   pageName: 'Terms of Service', label: 'Content & ownership (rights to what you upload)' },
  { key: 'terms:group-conduct',         page: 'terms.html',   pageName: 'Terms of Service', label: 'Groups & lecturer responsibilities' },
  { key: 'terms:eligibility',           page: 'terms.html',   pageName: 'Terms of Service', label: 'Eligibility & accounts (accurate information)' },
  { key: 'terms:other',                 page: 'terms.html',   pageName: 'Terms of Service', label: 'Other violation of the Terms (see Suspension & termination)' },
  { key: 'privacy:age-requirements',    page: 'privacy.html', pageName: 'Privacy Policy',    label: 'Age requirements' },
];

function ccPolicyRegistry() {
  try {
    if (window.PeerloomPolicy) {
      const list = window.PeerloomPolicy.list();
      if (Array.isArray(list) && list.length) return list;
    }
  } catch (e) { console.warn('js/policy-refs.js did not load correctly, using the built-in rule list instead.', e); }
  return EMBEDDED_POLICY_REGISTRY;
}
function reasonAction({ title, subtitle, label, placeholder, icon, run, policyRequired = true }) {
  document.getElementById('ccReasonTitle').textContent = title;
  document.getElementById('ccReasonSubtitle').textContent = subtitle || 'This message is shown directly to them — be specific about what was breached.';
  document.getElementById('ccReasonLabel').textContent = label || 'Reason';
  const input = document.getElementById('ccReasonInput');
  input.value = '';

  const policyField = document.getElementById('ccReasonPolicyField');
  const policySelect = document.getElementById('ccReasonPolicy');
  // Not gated to "build once": if the source list wasn't ready on an earlier
  // open for any reason, this retries every time instead of staying broken
  // for the rest of the session. ccPolicyRegistry() always returns something
  // (falls back to a copy embedded right here if js/policy-refs.js failed to
  // load), so this should never leave the dropdown silently empty again.
  if (policySelect.options.length <= 1) {
    const registry = ccPolicyRegistry();
    let currentPage = '';
    registry.forEach(r => {
      if (r.pageName !== currentPage) {
        const group = document.createElement('optgroup');
        group.label = r.pageName;
        policySelect.appendChild(group);
        currentPage = r.pageName;
      }
      const opt = document.createElement('option');
      opt.value = r.key;
      opt.textContent = r.label;
      policySelect.lastElementChild.appendChild(opt);
    });
    if (registry.length === 0) {
      console.error('Command Centre: no policy rules available for the "Rule breached" dropdown.');
    }
  }
  policySelect.value = '';
  policyField.style.display = policyRequired ? '' : 'none';
  input.placeholder = placeholder || 'e.g. This content is unrelated to academic use, which breaches our Terms of Service (Acceptable Use).';
  const iconEl = document.getElementById('ccReasonIcon');
  iconEl.innerHTML = `<i class="fa-solid ${icon || 'fa-triangle-exclamation'}"></i>`;
  iconEl.style.background = 'var(--danger-soft)';
  iconEl.style.color = 'var(--danger)';
  const errEl = document.getElementById('ccReasonError');
  errEl.style.display = 'none';

  const actionBtn = document.getElementById('ccReasonConfirmBtn');
  const newBtn = actionBtn.cloneNode(true);
  actionBtn.parentNode.replaceChild(newBtn, actionBtn);
  newBtn.addEventListener('click', async () => {
    const reason = input.value.trim();
    const policyRef = policySelect.value || null;
    if (!reason) {
      errEl.textContent = 'A reason is required — this is what gets shown to them.';
      errEl.style.display = 'block';
      return;
    }
    if (policyRequired && !policyRef) {
      errEl.textContent = 'Select which rule this is about — it becomes a highlighted link they can open.';
      errEl.style.display = 'block';
      return;
    }
    newBtn.disabled = true;
    await run(reason, policyRef);
    newBtn.disabled = false;
    closeModal('ccReasonModalBackdrop');
  });
  openModal('ccReasonModalBackdrop');
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ============================================================
// RIPPLE — shared tactile click feedback across every control
// ============================================================
const RIPPLE_TARGETS = '.cc-btn, .cc-nav-item, .cc-filter-pill, .cc-icon-btn, .cc-theme-opt, .cc-hamburger, .cc-collapse-btn';
function initRippleEffect() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  document.addEventListener('pointerdown', (e) => {
    const target = e.target.closest(RIPPLE_TARGETS);
    if (!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.5;
    const ripple = document.createElement('span');
    ripple.className = 'cc-ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${(e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2}px`;
    ripple.style.top = `${(e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2}px`;
    target.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}

// ============================================================
// COMMAND PALETTE
// ============================================================
function initCommandPalette() {
  document.getElementById('ccSearchTrigger').addEventListener('click', openPalette);
  document.getElementById('ccPaletteBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'ccPaletteBackdrop') closePalette();
  });
  document.getElementById('ccPaletteInput').addEventListener('input', (e) => renderPaletteResults(e.target.value));
}
function openPalette() {
  document.getElementById('ccPaletteBackdrop').classList.add('open');
  const input = document.getElementById('ccPaletteInput');
  input.value = ''; input.focus();
  renderPaletteResults('');
}
function closePalette() { document.getElementById('ccPaletteBackdrop').classList.remove('open'); }

const VIEW_LABELS = {
  dashboard: 'Dashboard', analytics: 'Analytics', users: 'Users', lecturers: 'Lecturers', students: 'Students',
  institutions: 'Institutions', campuses: 'Campuses', groups: 'Groups', reports: 'Reports', notifications: 'Notifications',
  'system-health': 'System Health', settings: 'Settings',
};

function renderPaletteResults(q) {
  const results = document.getElementById('ccPaletteResults');
  const query = q.trim().toLowerCase();
  let items = [];

  if (!query) {
    items = Object.entries(VIEW_LABELS).map(([view, label]) => ({ icon: 'fa-arrow-right', label: `Go to ${label}`, hint: 'Section', action: () => { switchView(view); closePalette(); } }));
  } else {
    Object.entries(VIEW_LABELS).forEach(([view, label]) => {
      if (label.toLowerCase().includes(query)) items.push({ icon: 'fa-arrow-right', label: `Go to ${label}`, hint: 'Section', action: () => { switchView(view); closePalette(); } });
    });
    state.profiles.filter(p => (p.full_name || '').toLowerCase().includes(query) || (p.username || '').toLowerCase().includes(query)).slice(0, 8).forEach(p => {
      items.push({ icon: 'fa-user', label: displayName(p), hint: p.username ? '@' + p.username : 'User', action: () => { switchView('users'); closePalette(); setTimeout(() => openUserModal(p.id), 200); } });
    });
    const insts = new Set(state.profiles.map(institutionOf));
    [...insts].filter(i => i.toLowerCase().includes(query)).slice(0, 5).forEach(i => {
      items.push({ icon: 'fa-building-columns', label: i, hint: 'Institution', action: () => { switchView('institutions'); closePalette(); } });
    });
  }

  results.innerHTML = items.length ? items.map((it, i) => `
    <div class="cc-palette-item" data-idx="${i}"><i class="fa-solid ${it.icon}"></i><span>${escapeHtml(it.label)}</span><span class="cc-palette-hint">${escapeHtml(it.hint)}</span></div>
  `).join('') : `<div class="cc-palette-empty">No matches</div>`;

  results.querySelectorAll('.cc-palette-item').forEach((el, i) => el.addEventListener('click', () => items[i].action()));
}

// ============================================================
// SYSTEM HEALTH — real checks against the real project
// ============================================================
async function runHealthChecks() {
  const checks = [
    { name: 'Database', icon: 'fa-database', run: healthDatabase },
    { name: 'Authentication', icon: 'fa-key', run: healthAuth },
    { name: 'Storage', icon: 'fa-box-archive', run: healthStorage },
    { name: 'Realtime', icon: 'fa-satellite-dish', run: healthRealtime },
  ];
  const grid = document.getElementById('ccHealthGrid');
  grid.innerHTML = checks.map(c => healthCardHtml(c.name, c.icon, 'pending', 'Checking…', '')).join('');

  for (const c of checks) {
    const result = await c.run();
    const card = grid.querySelector(`[data-health="${c.name}"]`);
    if (card) card.outerHTML = healthCardHtml(c.name, c.icon, result.status, result.message, result.latency);
  }
}
function healthCardHtml(name, icon, status, message, latency) {
  return `<div class="cc-health-card" data-health="${name}">
    <div class="cc-health-top">
      <div class="cc-stat-icn" style="width:32px;height:32px;font-size:0.85rem; background:#7c3aed1f; color:#7c3aed;"><i class="fa-solid ${icon}"></i></div>
      <span class="cc-health-dot ${status}"></span>
    </div>
    <div class="cc-health-name">${name}</div>
    <div class="cc-health-status">${message}</div>
    ${latency ? `<div class="cc-health-latency">${latency}</div>` : ''}
  </div>`;
}
async function healthDatabase() {
  const t0 = performance.now();
  const { error } = await supabase.from('profiles').select('id', { count: 'exact', head: true });
  const ms = Math.round(performance.now() - t0);
  return error ? { status: 'err', message: 'Query failed', latency: error.message } : { status: 'ok', message: 'Responding normally', latency: `${ms}ms round-trip` };
}
async function healthAuth() {
  const t0 = performance.now();
  const { data, error } = await supabase.auth.getSession();
  const ms = Math.round(performance.now() - t0);
  return error || !data.session ? { status: 'warn', message: 'No active session', latency: '' } : { status: 'ok', message: 'Session valid', latency: `${ms}ms` };
}
async function healthStorage() {
  const t0 = performance.now();
  const { error } = await supabase.storage.listBuckets();
  const ms = Math.round(performance.now() - t0);
  return error ? { status: 'warn', message: 'Could not list buckets', latency: error.message } : { status: 'ok', message: 'Reachable', latency: `${ms}ms` };
}
async function healthRealtime() {
  return new Promise(resolve => {
    const status = state.realtimeChannel?.state;
    if (status === 'joined') resolve({ status: 'ok', message: 'Subscribed', latency: '' });
    else resolve({ status: 'warn', message: status || 'Not connected yet', latency: '' });
  });
}

// ============================================================
// SETTINGS
// ============================================================
function initSettingsPanel() {
  const anim = document.getElementById('ccAnimToggle');
  anim.checked = localStorage.getItem('cc_animations') !== 'off';
  document.body.classList.toggle('cc-no-animations', !anim.checked);
  anim.addEventListener('change', () => {
    localStorage.setItem('cc_animations', anim.checked ? 'on' : 'off');
    document.body.classList.toggle('cc-no-animations', !anim.checked);
  });

  const sound = document.getElementById('ccSoundToggle');
  sound.checked = localStorage.getItem('cc_sound') === 'on';
  sound.addEventListener('change', () => localStorage.setItem('cc_sound', sound.checked ? 'on' : 'off'));

  document.getElementById('ccAddAdminBtn').addEventListener('click', () => {
    document.getElementById('ccAddAdminInput').value = '';
    document.getElementById('ccAddAdminError').style.display = 'none';
    openModal('ccAddAdminBackdrop');
  });
  document.getElementById('ccAddAdminConfirm').addEventListener('click', addAdmin);

  renderAdminsList();
}

async function renderAdminsList() {
  const { data, error } = await supabase.from('super_admins').select('id, email, full_name, created_at').order('created_at', { ascending: true });
  const list = document.getElementById('ccAdminsList');
  if (error) { list.innerHTML = `<p style="color:var(--danger); font-size:0.84rem;">Couldn't load admins.</p>`; return; }
  list.innerHTML = (data || []).map(a => {
    const isMe = a.id === state.adminId;
    return `<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border);">
      <div><div style="font-weight:700; font-size:0.86rem;">${escapeHtml(a.full_name || a.email)}${isMe ? ' <span style="color:var(--ink-mute); font-weight:500;">(you)</span>' : ''}</div><div style="font-size:0.74rem; color:var(--ink-mute);">Added ${formatDate(a.created_at)}</div></div>
      ${isMe ? '' : `<button class="cc-btn cc-btn-ghost cc-btn-icon" data-remove-admin="${a.id}" title="Remove"><i class="fa-solid fa-user-minus"></i></button>`}
    </div>`;
  }).join('') || `<p style="font-size:0.84rem; color:var(--ink-mute);">No admins found.</p>`;

  list.querySelectorAll('[data-remove-admin]').forEach(btn => {
    btn.addEventListener('click', () => confirmAction({
      title: 'Remove admin access?', body: 'They will immediately lose access to the Command Center.', icon: 'fa-user-minus', danger: true,
      run: async () => {
        const { error } = await supabase.from('super_admins').delete().eq('id', btn.dataset.removeAdmin);
        if (error) { toast('Could not remove — ' + error.message, 'err'); return; }
        state.superAdminIds.delete(btn.dataset.removeAdmin);
        toast('Admin access removed', 'ok');
        renderAdminsList();
        renderAll();
      },
    }));
  });
}

async function addAdmin() {
  const input = document.getElementById('ccAddAdminInput');
  const errEl = document.getElementById('ccAddAdminError');
  const username = input.value.trim().replace(/^@/, '');
  errEl.style.display = 'none';
  if (!username) { errEl.textContent = 'Enter a username.'; errEl.style.display = 'block'; return; }

  const { data: found, error } = await supabase.from('profiles').select('id, full_name, username').eq('username', username).maybeSingle();
  if (error || !found) { errEl.textContent = "Couldn't find a Peerloom account with that username."; errEl.style.display = 'block'; return; }

  const { error: insertErr } = await supabase.from('super_admins').insert({ id: found.id, email: found.username, full_name: found.full_name, granted_by: state.adminId });
  if (insertErr) { errEl.textContent = insertErr.message.includes('duplicate') ? 'They already have access.' : insertErr.message; errEl.style.display = 'block'; return; }

  closeModal('ccAddAdminBackdrop');
  state.superAdminIds.add(found.id);
  toast(`${found.full_name || found.username} now has Command Center access`, 'ok');
  renderAdminsList();
  renderAll();
}

// ============================================================
// TOASTS
// ============================================================
function toast(message, type = 'info') {
  const icons = { ok: 'fa-circle-check', err: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `cc-toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  document.getElementById('ccToastStack').appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 280); }, 3800);
}

// ============================================================
// SUBSCRIPTIONS & PAYMENTS (membership revenue)
// ============================================================
function subscriptionsStatCardsConfig() {
  const subs = state.subscriptions;
  const payments = state.payments;
  const paidActive = subs.filter(s => s.status === 'ACTIVE_PAID');
  // A lecturer's free year is never a row in `subscriptions` — it's tracked
  // directly on their profile (lecturer_free_started_at/ends_at, set at
  // lecturer signup). Reading it from `subscriptions` always returned 0
  // once there were zero paid-plan rows, even with real lecturers actively
  // on their free year. Count it from profiles instead, the same source
  // every other lecturer-facing stat in this file already uses.
  const now = Date.now();
  const freeYearActive = state.profiles.filter(p =>
    isLecturerProfile(p) && p.lecturer_free_ends_at && new Date(p.lecturer_free_ends_at).getTime() > now
  );
  const totalRevenue = payments.filter(p => p.status === 'SUCCESS').reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const mrr = paidActive.reduce((sum, s) => {
    const amt = Number(s.amount || 0);
    return sum + (s.billing_interval === 'yearly' ? amt / 12 : amt);
  }, 0);
  const failedRecent = payments.filter(p => p.status === 'FAILED' && p.created_at && (Date.now() - new Date(p.created_at)) < 30 * 86400000).length;

  return [
    { id: 'ccStatTotalRevenue', label: 'Total revenue (all time)', value: `GHS ${totalRevenue.toFixed(2)}`, icon: 'fa-sack-dollar', color: '#10b981' },
    { id: 'ccStatMRR', label: 'Monthly recurring revenue', value: `GHS ${mrr.toFixed(2)}`, icon: 'fa-chart-line', color: '#7c3aed' },
    { id: 'ccStatActiveSubs', label: 'Active paid subscriptions', value: paidActive.length, icon: 'fa-credit-card', color: '#3b82f6' },
    { id: 'ccStatFreeYearSubs', label: 'Lecturers on free year', value: freeYearActive.length, icon: 'fa-chalkboard-user', color: '#ec4899' },
    { id: 'ccStatFailedPayments', label: 'Failed payments (30d)', value: failedRecent, icon: 'fa-triangle-exclamation', color: '#ef4444' },
  ];
}

function renderSubscriptionsStats() {
  const grid = document.getElementById('ccSubsStatGrid');
  if (!grid) return;
  const cards = subscriptionsStatCardsConfig();
  grid.innerHTML = cards.map(c => `
    <div class="cc-stat-card" data-stat-card="${c.id}">
      <div class="cc-stat-top">
        <div class="cc-stat-icn" style="background:${c.color}1f; color:${c.color};"><i class="fa-solid ${c.icon}"></i></div>
      </div>
      <div class="cc-stat-value">${c.value}</div>
      <div class="cc-stat-label">${c.label}</div>
    </div>
  `).join('');
}

function subscriptionStatusBadge(status) {
  if (status === 'ACTIVE_PAID') return `<span class="cc-badge cc-badge-ok">Active (paid)</span>`;
  if (status === 'LECTURER_FREE_YEAR') return `<span class="cc-badge cc-badge-info">Free year</span>`;
  if (status === 'PENDING') return `<span class="cc-badge cc-badge-warn">Pending</span>`;
  if (status === 'PAYMENT_FAILED') return `<span class="cc-badge cc-badge-danger">Payment failed</span>`;
  if (status === 'EXPIRED') return `<span class="cc-badge cc-badge-mute">Expired</span>`;
  if (status === 'CANCELLED') return `<span class="cc-badge cc-badge-mute">Cancelled</span>`;
  return `<span class="cc-badge cc-badge-mute">${escapeHtml(status || '—')}</span>`;
}

function renderSubscriptionsTable() {
  const tbody = document.querySelector('#ccSubscriptionsTable tbody');
  if (!tbody) return;
  const byId = new Map(state.profiles.map(p => [p.id, p]));
  const live = state.subscriptions
    .filter(s => s.status === 'ACTIVE_PAID' || s.status === 'LECTURER_FREE_YEAR' || s.status === 'PAYMENT_FAILED' || s.status === 'PENDING')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (!live.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--ink-mute); padding:24px;">No subscriptions yet — Peerloom's payment provider isn't live, so this is genuinely empty, not a placeholder.</td></tr>`;
    return;
  }

  tbody.innerHTML = live.map(s => {
    const p = byId.get(s.user_id);
    const canCancel = s.status === 'ACTIVE_PAID';
    return `
      <tr>
        <td>${p ? userCell(p) : escapeHtml(s.user_id)}</td>
        <td>${escapeHtml(s.plan || '—')}</td>
        <td>${s.billing_interval ? (s.billing_interval === 'yearly' ? 'Yearly' : 'Monthly') : '—'}</td>
        <td>${subscriptionStatusBadge(s.status)}</td>
        <td>${formatDate(s.current_period_end)}</td>
        <td>${canCancel ? `<button class="cc-btn cc-btn-ghost cc-btn-sm" data-cancel-sub="${s.id}">Cancel</button>` : ''}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-cancel-sub]').forEach(btn => {
    btn.addEventListener('click', () => handleCancelSubscription(btn.dataset.cancelSub));
  });
}

function renderPaymentsTable() {
  const tbody = document.querySelector('#ccPaymentsTable tbody');
  if (!tbody) return;
  const byId = new Map(state.profiles.map(p => [p.id, p]));
  if (!state.payments.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--ink-mute); padding:24px;">No payments recorded yet — Peerloom's payment provider isn't live, so this is genuinely empty, not a placeholder.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.payments.slice(0, 50).map(p => {
    const user = byId.get(p.user_id);
    const statusClass = p.status === 'SUCCESS' ? 'cc-badge-ok' : p.status === 'FAILED' ? 'cc-badge-danger' : 'cc-badge-warn';
    return `
      <tr>
        <td>${user ? userCell(user) : escapeHtml(p.user_id)}</td>
        <td>${escapeHtml(p.currency || 'GHS')} ${Number(p.amount || 0).toFixed(2)}</td>
        <td><span class="cc-badge ${statusClass}">${escapeHtml(p.status)}</span></td>
        <td>${formatDate(p.created_at)}</td>
      </tr>
    `;
  }).join('');
}

function handleCancelSubscription(subId) {
  const sub = state.subscriptions.find(s => s.id === subId);
  if (!sub) return;
  const p = state.profiles.find(pp => pp.id === sub.user_id);
  confirmAction({
    title: `Cancel ${displayName(p || { full_name: 'this user' })}'s subscription?`,
    body: 'This immediately marks the subscription CANCELLED. It does not delete any payment history, and does not issue a refund.',
    icon: 'fa-ban',
    danger: true,
    run: async () => {
      const { error } = await supabase
        .from('subscriptions')
        .update({ status: 'CANCELLED', cancelled_at: new Date().toISOString() })
        .eq('id', subId);
      if (error) { toast('Failed to cancel subscription — ' + error.message, 'err'); return; }
      sub.status = 'CANCELLED';
      sub.cancelled_at = new Date().toISOString();
      toast('Subscription cancelled', 'ok');
      renderSubscriptionsView();
    },
  });
}

function renderSubscriptionsView() {
  renderSubscriptionsStats();
  renderSubscriptionsTable();
  renderPaymentsTable();
}

// ============================================================
// EXPORTS — branded PDF, Excel, CSV
// ============================================================
const EXPORT_CONFIG = {
  users: { title: 'All Users', cols: ['Name', 'Username', 'Role', 'Campus', 'Verified', 'Status', 'Joined'], rows: () => filteredUsers().map(p => [displayName(p), '@' + (p.username || ''), isLecturerProfile(p) ? 'Lecturer' : 'Student', campusOf(p), isVerified(p) ? 'Yes' : 'No', isBanned(p) ? 'Banned' : isSuspended(p) ? 'Suspended' : 'Active', formatDate(p.created_at)]) },
  lecturers: { title: 'Lecturers', cols: ['Name', 'Institution', 'Campus', 'Department', 'Quizzes', 'Resources', 'Announcements', 'Verified'], rows: () => state.profiles.filter(isLecturerProfile).map(p => { const c = state.lecturerContentCounts[p.id] || { quizzes: 0, resources: 0, announcements: 0 }; return [displayName(p), institutionOf(p), campusOf(p), p.department || '—', c.quizzes, c.resources, c.announcements, isVerified(p) ? 'Yes' : 'No']; }) },
  students: { title: 'Students', cols: ['Name', 'Institution', 'Campus', 'Department', 'Level', 'Verified', 'Status'], rows: () => state.profiles.filter(p => !isLecturerProfile(p)).map(p => [displayName(p), institutionOf(p), campusOf(p), p.department || '—', p.custom_level || p.level || '—', isVerified(p) ? 'Yes' : 'No', isSuspended(p) ? 'Suspended' : 'Active']) },
  institutions: { title: 'Institutions', cols: ['Institution', 'Students', 'Lecturers', 'Campuses'], rows: () => { const m = {}; state.profiles.forEach(p => { const k = institutionOf(p); m[k] = m[k] || { s: 0, l: 0, c: new Set() }; isLecturerProfile(p) ? m[k].l++ : m[k].s++; m[k].c.add(campusOf(p)); }); return Object.entries(m).map(([k, v]) => [k, v.s, v.l, v.c.size]); } },
  campuses: { title: 'Campuses', cols: ['Campus', 'Institution', 'Students', 'Lecturers'], rows: () => { const m = {}; state.profiles.forEach(p => { const k = campusOf(p) + '|' + institutionOf(p); m[k] = m[k] || { camp: campusOf(p), inst: institutionOf(p), s: 0, l: 0 }; isLecturerProfile(p) ? m[k].l++ : m[k].s++; }); return Object.values(m).map(v => [v.camp, v.inst, v.s, v.l]); } },
  groups: { title: 'Groups', cols: ['Group', 'Course code', 'Institution', 'Members', 'Created'], rows: () => state.groups.map(g => [g.name || '—', g.course_code || '—', g.institution || '—', state.groupMemberCounts[g.id] || 0, formatDate(g.created_at)]) },
  moderation: { title: 'Moderation events', cols: ['Severity', 'Category', 'User', 'Where', 'Excerpt', 'Action taken', 'When'], rows: () => state.moderationEvents.map(e => [e.severity, e.category, e.userName, e.group_id ? `Group: ${e.groupName}` : e.content_type, e.snippet, e.action_taken, formatDate(e.created_at)]) },
  reports: { title: 'Reports', cols: ['Reason', 'Reported user', 'Reported by', 'Status', 'Filed'], rows: () => state.reports.map(r => [r.reason || '—', r.reportedUserName, r.reportedByName, isReportPending(r) ? 'Pending' : 'Resolved', formatDate(r.created_at)]) },
  analytics: { title: 'Analytics Summary', cols: ['Metric', 'Value'], rows: () => { const l = state.profiles.filter(isLecturerProfile).length; const v = state.profiles.filter(isVerified).length; return [['Total users', state.profiles.length], ['Students', state.profiles.length - l], ['Lecturers', l], ['Institutions', new Set(state.profiles.map(institutionOf)).size], ['Campuses', new Set(state.profiles.map(campusOf)).size], ['Verified users', v], ['Verification rate', state.profiles.length ? Math.round(v / state.profiles.length * 100) + '%' : '0%']]; } },
  payments: { title: 'Payments', cols: ['User', 'Amount', 'Currency', 'Status', 'Provider', 'Date'], rows: () => { const byId = new Map(state.profiles.map(p => [p.id, p])); return state.payments.map(p => { const u = byId.get(p.user_id); return [u ? displayName(u) : p.user_id, Number(p.amount || 0).toFixed(2), p.currency || 'GHS', p.status, p.provider || '—', formatDate(p.created_at)]; }); } },
};

function openExportModal(kind) {
  state.exportContext = kind;
  document.getElementById('ccExportModalDesc').textContent = `Export "${EXPORT_CONFIG[kind]?.title || kind}" as:`;
  openModal('ccExportModalBackdrop');
}

async function runExport(format) {
  const kind = state.exportContext;
  const cfg = EXPORT_CONFIG[kind];
  if (!cfg) return;
  closeModal('ccExportModalBackdrop');
  const rows = cfg.rows();
  try {
    if (format === 'csv') exportCSV(cfg.title, cfg.cols, rows);
    else if (format === 'excel') exportExcel(cfg.title, cfg.cols, rows);
    else await exportPDF(cfg.title, cfg.cols, rows);
    toast(`Exported ${cfg.title} as ${format.toUpperCase()}`, 'ok');
  } catch (err) {
    console.error(err);
    toast('Export failed — ' + err.message, 'err');
  }
}

function exportCSV(title, cols, rows) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `${slug(title)}.csv`);
}

function exportExcel(title, cols, rows) {
  const ws = XLSX.utils.aoa_to_sheet([cols, ...rows]);
  ws['!cols'] = cols.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, `${slug(title)}.xlsx`);
}

let _logoDataUrl = null;
async function loadLogoDataUrl() {
  if (_logoDataUrl) return _logoDataUrl;
  try {
    const res = await fetch('logo.png');
    const blob = await res.blob();
    _logoDataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    _logoDataUrl = null; // cover still renders fine without it
  }
  return _logoDataUrl;
}

async function exportPDF(title, cols, rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // ---- Branded cover page ----
  // Manually interpolated gradient (violet → blue) built from thin rects —
  // avoids relying on jsPDF's GState/opacity API, which isn't consistent
  // enough across versions to trust without a real browser to test in.
  const coverH = 300;
  const bands = 60;
  const c1 = [46, 16, 101];   // violet-900
  const c2 = [59, 130, 246];  // blue-500
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    doc.setFillColor(r, g, b);
    doc.rect((pageW / bands) * i, 0, pageW / bands + 1, coverH, 'F');
  }

  const logo = await loadLogoDataUrl();
  if (logo) {
    try { doc.addImage(logo, 'PNG', 48, 46, 40, 40); } catch { /* non-fatal — cover still works without it */ }
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22);
  doc.text('Peerloom', logo ? 98 : 48, 72);
  doc.setFontSize(12); doc.setFont('helvetica', 'normal');
  doc.text('Command Center', logo ? 98 : 48, 90);

  doc.setFontSize(20); doc.setFont('helvetica', 'bold');
  doc.text(title, 48, 210);
  doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(230, 225, 250);
  doc.text(`Generated ${new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}`, 48, 232);
  doc.text(`Prepared by ${displayName(state.adminProfile)}`, 48, 248);

  doc.setTextColor(220, 215, 245); doc.setFontSize(9);
  doc.text('Copyright © Peerloom Technologies', 48, 285);

  // ---- Table ----
  doc.autoTable({
    startY: 330,
    head: [cols],
    body: rows.map(r => r.map(c => String(c ?? ''))),
    margin: { left: 40, right: 40 },
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 6, textColor: [30, 24, 50] },
    headStyles: { fillColor: [124, 58, 237], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [247, 245, 253] },
    didDrawPage: (data) => {
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(8); doc.setTextColor(150, 145, 165);
      doc.text('Copyright © Peerloom Technologies', 40, pageHeight - 20);
      doc.text(`Page ${doc.internal.getNumberOfPages()}`, pageW - 70, pageHeight - 20);
    },
  });

  doc.save(`${slug(title)}.pdf`);
}

function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
boot();