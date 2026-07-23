import { supabase } from './supabaseClient.js';

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

let overlay = null;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'grading-overlay';
  overlay.innerHTML = `
    <div class="grading-card student-profile-card">
      <div class="grading-card-header">
        <div class="student-profile-identity">
          <div class="student-profile-avatar" id="spAvatar"></div>
          <div>
            <h3 id="spName">Student</h3>
            <p class="grading-meta" id="spMeta"></p>
          </div>
        </div>
        <button class="topbar-btn" id="spCloseBtn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="grading-body" id="spBody"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#spCloseBtn').addEventListener('click', close);
  return overlay;
}

function close() {
  if (overlay) overlay.classList.remove('visible');
}

async function loadProfileData(studentId, lecturerId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, profile_photo, department, level, custom_level, campus, custom_campus, institution, verified, lecturer_badge, username')
    .eq('id', studentId)
    .maybeSingle();
  if (profileError) console.error('Failed to load student profile:', profileError);

  const { data: quizzes } = await supabase
    .from('quizzes')
    .select('id, title')
    .eq('creator_id', lecturerId)
    .eq('is_deleted', false);
  const quizById = Object.fromEntries((quizzes || []).map((q) => [q.id, q]));
  const quizIds = Object.keys(quizById);

  let attempts = [];
  if (quizIds.length) {
    const { data } = await supabase
      .from('quiz_attempts')
      .select('id, quiz_id, status, score, max_score, submitted_at, index_number, level')
      .eq('student_id', studentId)
      .in('quiz_id', quizIds)
      .order('submitted_at', { ascending: false });
    attempts = data || [];
  }

  const graded = attempts.filter((a) => a.status === 'graded' && a.score != null && a.max_score);
  const avgPct = graded.length ? graded.reduce((s, a) => s + (a.score / a.max_score) * 100, 0) / graded.length : null;

  const eventCounts = { high: 0, medium: 0, low: 0 };
  let integrityScore = null;
  if (attempts.length) {
    const attemptIds = attempts.map((a) => a.id);
    const { data: events } = await supabase
      .from('quiz_proctor_events')
      .select('event_type')
      .in('attempt_id', attemptIds);
    (events || []).forEach((e) => {
      const sev = SEVERITY[e.event_type] || 'low';
      eventCounts[sev] += 1;
    });
    const deduction = eventCounts.high * 8 + eventCounts.medium * 3 + eventCounts.low * 1;
    integrityScore = Math.max(0, 100 - deduction);
  }

  const indexNumber = attempts.find((a) => a.index_number)?.index_number || null;
  const level = attempts.find((a) => a.level)?.level || profile?.level || profile?.custom_level || null;

  const recentActivity = attempts.slice(0, 5).map((a) => ({
    label: `${a.status === 'graded' ? 'Graded' : 'Submitted'}: ${quizById[a.quiz_id]?.title || 'Quiz'}`,
    at: a.submitted_at
  }));

  return { profile, quizById, attempts, graded, avgPct, integrityScore, eventCounts, indexNumber, level, recentActivity };
}

function renderStatCard(value, label) {
  return `<div class="stat-card"><p class="value">${value}</p><p class="label">${label}</p></div>`;
}

function renderBody(data) {
  const { attempts, graded, avgPct, integrityScore, recentActivity } = data;

  const quizRows = attempts.length
    ? attempts.slice(0, 8).map((a) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(data.quizById[a.quiz_id]?.title || 'Untitled quiz')}</strong>
            <small>${formatDateTime(a.submitted_at)}</small>
          </div>
          <span class="badge-pill ${a.status === 'graded' ? 'badge-success' : ''}">${a.status === 'graded' ? `${a.score ?? 0}/${a.max_score ?? '—'}` : 'Ungraded'}</span>
        </div>
      `).join('')
    : `<div class="list-item"><div><strong>No quiz activity yet</strong><small>Nothing submitted to your quizzes so far</small></div></div>`;

  const activityRows = recentActivity.length
    ? recentActivity.map((item) => `
        <div class="list-item">
          <div><strong>${escapeHtml(item.label)}</strong><small>${timeAgo(item.at)}</small></div>
        </div>
      `).join('')
    : `<div class="list-item"><div><strong>No recent activity</strong></div></div>`;

  return `
    <div class="stats-grid student-profile-stats">
      ${renderStatCard(attempts.length, 'Quizzes attempted')}
      ${renderStatCard(avgPct != null ? Math.round(avgPct) + '%' : '—', 'Average score')}
      ${renderStatCard(integrityScore != null ? integrityScore : '—', 'Integrity score')}
      ${renderStatCard('—', 'Resources downloaded')}
    </div>

    <div class="grid-2">
      <section>
        <h4 class="student-profile-subhead">Quiz performance</h4>
        <div class="list-card">${quizRows}</div>
      </section>
      <section>
        <h4 class="student-profile-subhead">Recent activity</h4>
        <div class="list-card">${activityRows}</div>
      </section>
    </div>

    <p class="student-profile-note">
      <i class="fa-solid fa-circle-info"></i>
      Attendance tracking and resource-download tracking aren't wired up in PeerLoom yet — those show as "—" rather than made-up numbers.
      Integrity score is a simple heuristic (100 minus weighted deductions for logged events across this student's attempts on your quizzes), not an official metric.
    </p>
  `;
}

export async function openStudentProfile(studentId, lecturerProfile) {
  if (!studentId || !lecturerProfile?.id) return;
  const ov = ensureOverlay();
  ov.classList.add('visible');

  ov.querySelector('#spAvatar').innerHTML = '<i class="fa-solid fa-user"></i>';
  ov.querySelector('#spName').textContent = 'Loading…';
  ov.querySelector('#spMeta').textContent = '';
  ov.querySelector('#spBody').innerHTML = '<p class="empty-inline">Loading student profile&hellip;</p>';

  try {
    const data = await loadProfileData(studentId, lecturerProfile.id);
    const p = data.profile;

    const avatarEl = ov.querySelector('#spAvatar');
    if (p?.profile_photo) {
      avatarEl.innerHTML = `<img src="${escapeHtml(p.profile_photo)}" alt="${escapeHtml(p.full_name || 'Student')}" />`;
    } else {
      const initials = (p?.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
      avatarEl.innerHTML = `<span>${escapeHtml(initials || '?')}</span>`;
    }

    ov.querySelector('#spName').innerHTML = `${escapeHtml(p?.full_name || 'Unnamed student')}${p?.verified || p?.lecturer_badge ? ' <i class="fa-solid fa-circle-check verified-badge"></i>' : ''}`;

    const metaParts = [
      data.indexNumber ? `Index ${escapeHtml(data.indexNumber)}` : null,
      data.level ? escapeHtml(data.level) : null,
      p?.department ? escapeHtml(p.department) : null,
      (p?.campus || p?.custom_campus) ? escapeHtml(p.campus || p.custom_campus) : null,
      p?.institution ? escapeHtml(p.institution) : null
    ].filter(Boolean);
    ov.querySelector('#spMeta').textContent = metaParts.join(' · ') || 'No profile details on file';

    ov.querySelector('#spBody').innerHTML = renderBody(data);
  } catch (err) {
    console.error('Failed to load student profile:', err);
    ov.querySelector('#spBody').innerHTML = '<p class="empty-inline">Could not load this student\'s profile. Please try again.</p>';
  }
}