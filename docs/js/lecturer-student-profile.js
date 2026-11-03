import { supabase } from './supabaseClient.js';

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
    .select('id, title, status')
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

  // Which of this lecturer's published quizzes were actually assigned to
  // this student (via a course group they're in), so the "Quiz performance"
  // list can show a clear "Not attempted" row for those — instead of just
  // silently omitting them, which left the lecturer unable to tell "never
  // attempted" apart from "I just haven't looked at this student yet".
  let assignedNotAttempted = [];
  const publishedQuizIds = (quizzes || []).filter((q) => q.status === 'published').map((q) => q.id);
  if (publishedQuizIds.length) {
    const { data: memberGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', studentId);
    const studentGroupIds = new Set((memberGroups || []).map((g) => g.group_id));

    if (studentGroupIds.size) {
      const { data: links } = await supabase
        .from('quiz_groups')
        .select('quiz_id, group_id')
        .in('quiz_id', publishedQuizIds);
      const attemptedQuizIds = new Set(attempts.map((a) => a.quiz_id));
      const assignedQuizIds = new Set(
        (links || [])
          .filter((l) => studentGroupIds.has(l.group_id))
          .map((l) => l.quiz_id)
      );
      assignedNotAttempted = [...assignedQuizIds]
        .filter((qid) => !attemptedQuizIds.has(qid))
        .map((qid) => ({ quiz_id: qid, status: 'not_attempted' }));
    }
  }

  const graded = attempts.filter((a) => a.status === 'graded' && a.score != null && a.max_score);
  const avgPct = graded.length ? graded.reduce((s, a) => s + (a.score / a.max_score) * 100, 0) / graded.length : null;

  const indexNumber = attempts.find((a) => a.index_number)?.index_number || null;
  const level = attempts.find((a) => a.level)?.level || profile?.level || profile?.custom_level || null;

  const recentActivity = attempts.slice(0, 5).map((a) => ({
    label: `${a.status === 'graded' ? 'Graded' : 'Submitted'}: ${quizById[a.quiz_id]?.title || 'Quiz'}`,
    at: a.submitted_at
  }));

  // What "Quiz performance" actually renders: real attempts (graded or
  // awaiting grading) plus a "Not attempted" row for every quiz this
  // student was assigned but never started — sorted so attempts (most
  // recent first) lead and not-attempted rows trail.
  const performanceRows = [...attempts, ...assignedNotAttempted];

  return { profile, quizById, attempts, performanceRows, graded, avgPct, indexNumber, level, recentActivity };
}

function renderStatCard(value, label) {
  return `<div class="stat-card"><p class="value">${value}</p><p class="label">${label}</p></div>`;
}

function renderBody(data) {
  const { attempts, performanceRows, graded, avgPct, recentActivity } = data;

  const quizRows = performanceRows.length
    ? performanceRows.slice(0, 8).map((a) => {
        const isNotAttempted = a.status === 'not_attempted';
        const badgeClass = a.status === 'graded' ? 'badge-success' : isNotAttempted ? 'badge-muted' : '';
        const badgeLabel = a.status === 'graded'
          ? `${a.score ?? 0}/${a.max_score ?? '—'}`
          : isNotAttempted ? 'Not attempted' : 'Not graded yet';
        return `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(data.quizById[a.quiz_id]?.title || 'Untitled quiz')}</strong>
            <small>${isNotAttempted ? 'Assigned — no submission yet' : formatDateTime(a.submitted_at)}</small>
          </div>
          <span class="badge-pill ${badgeClass}">${badgeLabel}</span>
        </div>
      `;
      }).join('')
    : `<div class="list-item"><div><strong>No quiz activity yet</strong><small>Nothing submitted to your quizzes so far</small></div></div>`;

  const activityRows = recentActivity.length
    ? recentActivity.map((item) => `
        <div class="list-item">
          <div><strong>${escapeHtml(item.label)}</strong><small>${timeAgo(item.at)}</small></div>
        </div>
      `).join('')
    : `<div class="list-item"><div><strong>No recent activity</strong></div></div>`;

  return `
    <div class="stats-grid stats-grid-2 student-profile-stats">
      ${renderStatCard(attempts.length, 'Quizzes attempted')}
      ${renderStatCard(avgPct != null ? Math.round(avgPct) + '%' : '—', 'Average score')}
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