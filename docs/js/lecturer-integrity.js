import { supabase } from './supabaseClient.js';
import { openStudentProfile } from './lecturer-student-profile.js';

const SEVERITY = {
  text_selection: 'low',
  tab_switch: 'medium',
  window_blur: 'medium',
  context_menu: 'low',
  copy: 'high',
  paste: 'high',
  fullscreen_exit: 'high',
  fullscreen_return: 'low'
};

const EVENT_LABELS = {
  text_selection: 'Text Selection',
  tab_switch: 'Tab Switch',
  window_blur: 'Window Blur',
  context_menu: 'Right-Click Menu',
  copy: 'Copy',
  paste: 'Paste',
  fullscreen_exit: 'Left Fullscreen',
  fullscreen_return: 'Returned to Fullscreen'
};

const EVENT_ICONS = {
  text_selection: 'fa-text-width',
  tab_switch: 'fa-arrow-right-arrow-left',
  window_blur: 'fa-eye-slash',
  context_menu: 'fa-computer-mouse',
  copy: 'fa-copy',
  paste: 'fa-paste',
  fullscreen_exit: 'fa-compress',
  fullscreen_return: 'fa-expand'
};

let state = {
  profile: null,
  quizzes: [],
  events: [],
  quizFilter: 'all',
  severityFilter: 'all',
  search: ''
};

let timelineOverlay = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

async function loadData(profile) {
  const { data: quizzes, error: quizzesError } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('creator_id', profile.id)
    .eq('is_deleted', false);
  if (quizzesError) console.error('Failed to load quizzes for integrity log:', quizzesError);

  state.quizzes = quizzes || [];
  const quizIds = state.quizzes.map((q) => q.id);
  const quizById = Object.fromEntries(state.quizzes.map((q) => [q.id, q]));

  if (!quizIds.length) {
    state.events = [];
    return;
  }

  const { data: events, error: eventsError } = await supabase
    .from('quiz_proctor_events')
    .select('*')
    .in('quiz_id', quizIds)
    .order('occurred_at', { ascending: false })
    .limit(500);

  if (eventsError) {
    console.error('Failed to load integrity events (check the proctor events table name):', eventsError);
    state.events = [];
    return;
  }

  const attemptIds = [...new Set((events || []).map((e) => e.attempt_id).filter(Boolean))];
  let attemptById = {};
  if (attemptIds.length) {
    const { data: attempts } = await supabase
      .from('quiz_attempts')
      .select('id, student_id, full_name, index_number, group_id')
      .in('id', attemptIds);
    attemptById = Object.fromEntries((attempts || []).map((a) => [a.id, a]));
  }

  state.events = (events || []).map((e) => ({
    ...e,
    __quiz: quizById[e.quiz_id],
    __attempt: attemptById[e.attempt_id],
    __severity: SEVERITY[e.event_type] || 'low'
  }));
}

function getFilteredEvents() {
  let list = [...state.events];
  if (state.quizFilter !== 'all') list = list.filter((e) => e.quiz_id === state.quizFilter);
  if (state.search.trim()) {
    const term = state.search.trim().toLowerCase();
    list = list.filter((e) =>
      (e.__attempt?.full_name || '').toLowerCase().includes(term) ||
      (e.__attempt?.index_number || '').toLowerCase().includes(term)
    );
  }
  return list;
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };

// One card per student attempt, not one card per event — a student who
// switched tabs 9 times used to fill the log with 9 near-identical rows.
// Here every event for that attempt is rolled into a single card with a
// total count and a breakdown, and the severity filter now narrows down
// to attempts that have at least one event at that severity.
function getGroupedAttempts() {
  const filtered = getFilteredEvents();
  const groups = new Map();
  filtered.forEach((e) => {
    const key = e.attempt_id || `no-attempt-${e.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        attemptId: e.attempt_id,
        attempt: e.__attempt,
        quiz: e.__quiz,
        events: [],
        counts: { high: 0, medium: 0, low: 0 },
        highestSeverity: 'low',
        latest: e.occurred_at
      });
    }
    const group = groups.get(key);
    group.events.push(e);
    group.counts[e.__severity] = (group.counts[e.__severity] || 0) + 1;
    if (SEVERITY_RANK[e.__severity] > SEVERITY_RANK[group.highestSeverity]) group.highestSeverity = e.__severity;
    if (new Date(e.occurred_at) > new Date(group.latest)) group.latest = e.occurred_at;
  });

  let list = [...groups.values()];
  if (state.severityFilter !== 'all') {
    list = list.filter((g) => g.counts[state.severityFilter] > 0);
  }
  return list.sort((a, b) => new Date(b.latest) - new Date(a.latest));
}

function renderSeverityCounts() {
  const counts = { high: 0, medium: 0, low: 0 };
  state.events.forEach((e) => { counts[e.__severity] = (counts[e.__severity] || 0) + 1; });
  return counts;
}

function renderAttemptCard(group) {
  const { attempt, quiz, events, counts, highestSeverity, latest } = group;
  const breakdown = ['high', 'medium', 'low']
    .filter((sev) => counts[sev] > 0)
    .map((sev) => `<span class="badge-pill severity-badge-${sev}">${counts[sev]} ${sev}</span>`)
    .join('');
  return `
    <button class="integrity-row severity-${highestSeverity}" data-attempt-id="${group.attemptId}" data-action="open-attempt" type="button">
      <div class="integrity-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
      <div class="integrity-main">
        <strong class="clickable-student" data-action="profile" data-student-id="${attempt?.student_id || ''}">${escapeHtml(attempt?.full_name || 'Unknown student')}</strong>
        <small>${escapeHtml(attempt?.index_number || '')} · ${escapeHtml(quiz?.title || 'Untitled quiz')}</small>
      </div>
      <div class="integrity-event integrity-breakdown">${breakdown}</div>
      <div class="integrity-count">${events.length} action${events.length === 1 ? '' : 's'}</div>
      <div class="integrity-time">${formatDateTime(latest)}</div>
      <span class="subtle-action"><i class="fa-solid fa-clock-rotate-left"></i> View all</span>
    </button>
  `;
}

function renderList(container) {
  const listEl = container.querySelector('#integrityList');
  if (!listEl) return;
  const grouped = getGroupedAttempts();

  if (!grouped.length) {
    listEl.innerHTML = `
      <div class="empty-state-card">
        <i class="fa-solid fa-shield-halved"></i>
        <h4>No integrity events</h4>
        <p>${state.events.length ? 'Nothing matches this filter.' : "Nothing's been flagged yet — events appear here as students take your quizzes."}</p>
      </div>`;
    return;
  }

  listEl.innerHTML = grouped.map(renderAttemptCard).join('');

  listEl.querySelectorAll('[data-action="open-attempt"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      // Don't open the modal when the click was on the student's name —
      // that link should go straight to their profile instead.
      if (e.target.closest('[data-action="profile"]')) return;
      openTimelineOverlay(btn.dataset.attemptId);
    });
  });

  listEl.querySelectorAll('[data-action="profile"]').forEach((el) => {
    if (el.dataset.studentId) el.addEventListener('click', (e) => {
      e.stopPropagation();
      openStudentProfile(el.dataset.studentId, state.profile);
    });
  });
}

function renderShell() {
  const counts = renderSeverityCounts();
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-shield-halved"></i> Academic integrity</div>
        <h3>Integrity event log</h3>
        <p>Every tab switch, copy, paste, and fullscreen exit logged silently during a quiz attempt, in one place.</p>
      </div>
      <div class="glass-card">
        <h4>Severity breakdown</h4>
        <div class="stats-grid stats-grid-3">
          <div class="stat-card"><p class="value severity-text-high">${counts.high || 0}</p><p class="label">High</p></div>
          <div class="stat-card"><p class="value severity-text-medium">${counts.medium || 0}</p><p class="label">Medium</p></div>
          <div class="stat-card"><p class="value severity-text-low">${counts.low || 0}</p><p class="label">Low</p></div>
        </div>
      </div>
    </section>

    <section class="glass-card">
      <div class="filter-row">
        <div class="field-group flex field-group-search">
          <span>Search</span>
          <input type="text" class="quiz-input" id="integritySearch" placeholder="Student name or index number&hellip;" value="${escapeHtml(state.search)}" />
        </div>
        <div class="field-group flex">
          <span>Quiz</span>
          <select class="quiz-input" id="integrityQuizSelect">
            <option value="all">All quizzes</option>
            ${state.quizzes.map((q) => `<option value="${q.id}" ${state.quizFilter === q.id ? 'selected' : ''}>${escapeHtml(q.title || 'Untitled quiz')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="preview-tabs" id="severityTabs">
        <button class="preview-tab ${state.severityFilter === 'all' ? 'active' : ''}" data-severity="all">All</button>
        <button class="preview-tab ${state.severityFilter === 'high' ? 'active' : ''}" data-severity="high">High</button>
        <button class="preview-tab ${state.severityFilter === 'medium' ? 'active' : ''}" data-severity="medium">Medium</button>
        <button class="preview-tab ${state.severityFilter === 'low' ? 'active' : ''}" data-severity="low">Low</button>
      </div>
      <div class="integrity-list" id="integrityList"></div>
    </section>
  `;
}

function wireShell(container) {
  container.querySelector('#integritySearch')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    renderList(container);
  });
  container.querySelector('#integrityQuizSelect')?.addEventListener('change', (e) => {
    state.quizFilter = e.target.value;
    renderList(container);
  });
  container.querySelectorAll('#severityTabs .preview-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.severityFilter = tab.dataset.severity;
      container.querySelectorAll('#severityTabs .preview-tab').forEach((t) => t.classList.toggle('active', t === tab));
      renderList(container);
    });
  });
}

/* ============================================================
   Full timeline overlay
   ============================================================ */

function ensureTimelineOverlay() {
  if (timelineOverlay) return timelineOverlay;
  timelineOverlay = document.createElement('div');
  timelineOverlay.className = 'grading-overlay';
  timelineOverlay.innerHTML = `
    <div class="grading-card">
      <div class="grading-card-header">
        <div>
          <h3 id="timelineStudentName">Student</h3>
          <p class="grading-meta" id="timelineMeta"></p>
        </div>
        <button class="topbar-btn" id="timelineCloseBtn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="grading-body" id="timelineBody"></div>
    </div>
  `;
  document.body.appendChild(timelineOverlay);
  timelineOverlay.addEventListener('click', (e) => { if (e.target === timelineOverlay) closeTimelineOverlay(); });
  timelineOverlay.querySelector('#timelineCloseBtn').addEventListener('click', closeTimelineOverlay);
  return timelineOverlay;
}

function closeTimelineOverlay() {
  if (timelineOverlay) timelineOverlay.classList.remove('visible');
}

function openTimelineOverlay(attemptId) {
  const events = state.events
    .filter((e) => e.attempt_id === attemptId)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  if (!events.length) return;

  const overlay = ensureTimelineOverlay();
  const first = events[0];
  overlay.querySelector('#timelineStudentName').innerHTML = `<span class="clickable-student" id="timelineStudentLink">${first.__attempt?.full_name || 'Unknown student'}</span>`;
  overlay.querySelector('#timelineStudentLink')?.addEventListener('click', () => {
    if (first.__attempt?.student_id) openStudentProfile(first.__attempt.student_id, state.profile);
  });
  overlay.querySelector('#timelineMeta').textContent = `${first.__quiz?.title || 'Untitled quiz'} · ${events.length} event${events.length === 1 ? '' : 's'}`;

  overlay.querySelector('#timelineBody').innerHTML = `
    <div class="timeline-list">
      ${events.map((e) => `
        <div class="timeline-item severity-${e.__severity}">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <strong>${EVENT_LABELS[e.event_type] || e.event_type}</strong>
            <span>${formatDateTime(e.occurred_at)}${e.question_number ? ` · Question ${e.question_number}` : ''}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  overlay.classList.add('visible');
}

/* ============================================================
   Entry point
   ============================================================ */

async function renderIntegritySection(container, profile) {
  if (!container) return;
  state.profile = profile;

  container.innerHTML = `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-shield-halved"></i> Academic integrity</div>
        <h3>Loading integrity log&hellip;</h3>
      </div>
    </section>
  `;

  try {
    await loadData(profile);
  } catch (err) {
    console.error('Failed to load integrity log:', err);
  }

  if (!container.isConnected) return;
  container.innerHTML = renderShell();
  wireShell(container);
  renderList(container);
}

export { renderIntegritySection };