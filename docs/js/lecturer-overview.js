import { supabase } from './supabaseClient.js';
import { renderQuizExperience } from './lecturer-quizzes.js';
import { renderGroupsSection } from './lecturer-groups.js';
import { renderSubmissionsSection } from './lecturer-submissions.js';
import { renderResultsSection } from './lecturer-results.js';
import { renderIntegritySection } from './lecturer-integrity.js';
import { renderAnnouncementsSection } from './lecturer-announcements.js';
import { renderResourcesSection } from './lecturer-resources.js';
import { renderSettingsSection } from './lecturer-settings.js';

function formatDateLabel(date) {
  return new Date(date).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric'
  });
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

async function loadOverviewStats(profile) {
  const empty = { groups: [], totalMembers: 0, quizzes: [], upcomingQuizzes: [], pendingReviews: 0, engagementPct: null, recentActivity: [] };
  if (!profile?.id) return empty;

  const { data: groups, error: groupsError } = await supabase
    .from('groups')
    .select('id, name, created_at')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false });
  if (groupsError) console.error('Failed to load lecturer groups for overview:', groupsError);

  const groupIds = (groups || []).map((g) => g.id);
  let memberCountByGroup = {};
  let totalMembers = 0;
  if (groupIds.length) {
    const { data: members, error: membersError } = await supabase
      .from('group_members')
      .select('group_id')
      .in('group_id', groupIds);
    if (membersError) console.error('Failed to load group members for overview:', membersError);
    (members || []).forEach((m) => {
      memberCountByGroup[m.group_id] = (memberCountByGroup[m.group_id] || 0) + 1;
    });
    totalMembers = (members || []).length;
  }

  const { data: quizzes, error: quizzesError } = await supabase
    .from('quizzes')
    .select('id, title, status, open_date, close_date, created_at, published_at')
    .eq('creator_id', profile.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (quizzesError) console.error('Failed to load lecturer quizzes for overview:', quizzesError);

  const now = new Date();
  const upcomingQuizzes = (quizzes || [])
    .filter((q) => q.status === 'published' && q.open_date && new Date(q.open_date) > now)
    .sort((a, b) => new Date(a.open_date) - new Date(b.open_date));

  const quizIds = (quizzes || []).map((q) => q.id);
  let pendingReviews = 0;
  let engagementPct = null;
  if (quizIds.length) {
    const { count, error: pendingError } = await supabase
      .from('quiz_attempts')
      .select('*', { count: 'exact', head: true })
      .in('quiz_id', quizIds)
      .eq('status', 'submitted');
    if (pendingError) console.error('Failed to load pending reviews for overview:', pendingError);
    pendingReviews = count || 0;

    if (totalMembers > 0) {
      const { data: attemptStudents, error: attemptsError } = await supabase
        .from('quiz_attempts')
        .select('student_id')
        .in('quiz_id', quizIds);
      if (attemptsError) console.error('Failed to load attempt students for overview:', attemptsError);
      const engaged = new Set((attemptStudents || []).map((a) => a.student_id)).size;
      engagementPct = Math.round((engaged / totalMembers) * 100);
    }
  }

  const recentActivity = [
    ...(groups || []).slice(0, 3).map((g) => ({ type: 'group', label: `Group created: ${g.name}`, at: g.created_at })),
    ...(quizzes || []).filter((q) => q.published_at).slice(0, 3).map((q) => ({ type: 'quiz', label: `Quiz published: ${q.title}`, at: q.published_at }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 4);

  return {
    groups: (groups || []).map((g) => ({ ...g, memberCount: memberCountByGroup[g.id] || 0 })),
    totalMembers,
    quizzes: quizzes || [],
    upcomingQuizzes,
    pendingReviews,
    engagementPct,
    recentActivity
  };
}

function renderOverview(profile, stats) {
  const name = profile?.full_name || profile?.username || 'Lecturer';
  const institution = profile?.institution || profile?.campus || profile?.custom_campus || 'Your institution';
  const department = profile?.department || 'Teaching & Learning';
  const verifiedBadge = profile?.verified
    ? '<i class="fa-solid fa-check verified-badge" title="Verified lecturer"></i>'
    : '';

  const { groups, totalMembers, upcomingQuizzes, pendingReviews, engagementPct, recentActivity } = stats;

  const groupsListHtml = groups.length
    ? groups.slice(0, 4).map((g) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(g.name)}</strong>
            <small>${g.memberCount} student${g.memberCount === 1 ? '' : 's'}</small>
          </div>
          <span class="badge-pill">${g.memberCount > 0 ? 'Active' : 'Empty'}</span>
        </div>`).join('')
    : `<div class="list-item"><div><strong>No course groups yet</strong><small>Create one from My Course Groups</small></div></div>`;

  const upcomingListHtml = upcomingQuizzes.length
    ? upcomingQuizzes.slice(0, 4).map((q) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(q.title || 'Untitled quiz')}</strong>
            <small>Opens ${formatDateLabel(q.open_date)}</small>
          </div>
          <span class="badge-pill">Scheduled</span>
        </div>`).join('')
    : `<div class="list-item"><div><strong>No upcoming quizzes</strong><small>Publish a quiz with a future open date to see it here</small></div></div>`;

  const activityListHtml = recentActivity.length
    ? recentActivity.map((item) => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(item.label)}</strong>
            <small>${timeAgo(item.at)}</small>
          </div>
          <span class="badge-pill">${item.type === 'quiz' ? 'Published' : 'Group'}</span>
        </div>`).join('')
    : `<div class="list-item"><div><strong>No activity yet</strong><small>Create a group or publish a quiz to see it here</small></div></div>`;

  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sparkles"></i> Faculty workspace</div>
        <h3>${escapeHtml(name)}'s Workspace${verifiedBadge}</h3>
        <p>Your teaching, pacing, and student feedback are orchestrated here with a calm, focused view of every important signal.</p>
        <div class="hero-meta">
          <span class="meta-chip"><i class="fa-regular fa-calendar"></i> Today • ${new Date().toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <span class="meta-chip"><i class="fa-solid fa-building-columns"></i> ${escapeHtml(institution)}</span>
          <span class="meta-chip"><i class="fa-solid fa-book-open"></i> ${escapeHtml(department)}</span>
        </div>
        <div class="hero-actions">
          <button class="primary-btn" data-goto-section="announcements"><i class="fa-solid fa-plus"></i> New announcement</button>
          <button class="secondary-btn" data-goto-section="submissions"><i class="fa-solid fa-file-lines"></i> Review submissions</button>
        </div>
      </div>
      <div class="glass-card">
        <h4>Today at a glance</h4>
        <div class="stats-grid stats-grid-compact">
          <div class="stat-card">
            <p class="value">${groups.length}</p>
            <p class="label">Active groups</p>
          </div>
          <div class="stat-card">
            <p class="value">${engagementPct != null ? engagementPct + '%' : '—'}</p>
            <p class="label">Engaged</p>
          </div>
          <div class="stat-card">
            <p class="value">${pendingReviews}</p>
            <p class="label">Pending reviews</p>
          </div>
          <div class="stat-card">
            <p class="value">${upcomingQuizzes.length}</p>
            <p class="label">Upcoming quizzes</p>
          </div>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="glass-card">
        <h4>Recent activity</h4>
        <div class="list-card">${activityListHtml}</div>
      </section>

      <section class="glass-card">
        <h4>Quick actions</h4>
        <div class="list-card">
          <div class="list-item clickable-row" data-goto-section="groups">
            <div>
              <strong>Open course groups</strong>
              <small>Manage teaching circles</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
          <div class="list-item clickable-row" data-goto-section="quiz-builder">
            <div>
              <strong>Build a quiz</strong>
              <small>Compose next assessment</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
          <div class="list-item clickable-row" data-goto-section="resources">
            <div>
              <strong>Share a resource</strong>
              <small>Drop in notes, slides, or readings</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="glass-card">
        <h4>My course groups</h4>
        <div class="list-card">${groupsListHtml}</div>
      </section>

      <section class="glass-card">
        <h4>Upcoming quizzes</h4>
        <div class="list-card">${upcomingListHtml}</div>
      </section>
    </div>
  `;
}

function renderOverviewSkeleton() {
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sparkles"></i> Faculty workspace</div>
        <h3>Loading your workspace&hellip;</h3>
      </div>
    </section>
  `;
}

function renderPlaceholder(section) {
  const sectionMap = {
    results: { title: 'Results', body: 'Track performance trends, grade snapshots, and student progress at a glance.' },
    integrity: { title: 'Integrity Logs', body: 'Inspect recent review flags, suspicious patterns, and moderation history.' },
    resources: { title: 'Resources', body: 'Share notes, slides, references, and supplemental materials with your groups.' },
    announcements: { title: 'Announcements', body: 'Compose updates for your classes, schedule reminders, and broadcast important notices.' },
    settings: { title: 'Settings', body: 'Tune your profile, teaching preferences, and notification defaults for your academic workflow.' }
  };

  const meta = sectionMap[section] || sectionMap.results;

  return `
    <section class="placeholder-card">
      <h3>${meta.title}</h3>
      <p>${meta.body}</p>
      <ul>
        <li>Glassmorphism layout preserved for a premium teaching experience.</li>
        <li>Built as an independent module so the student dashboard remains untouched.</li>
        <li>Ready for deeper workflow integrations in future phases.</li>
      </ul>
    </section>
  `;
}

function wireOverviewNavigation(container) {
  container.querySelectorAll('[data-goto-section]').forEach((el) => {
    el.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('lecturer-section-change', { detail: el.dataset.gotoSection }));
    });
  });
}

function renderSectionContent(container, section, profile) {
  if (!container) return;

  if (section === 'overview') {
    container.innerHTML = renderOverviewSkeleton();
    loadOverviewStats(profile).then((stats) => {
      // Guard against a section switch happening while the stats were loading.
      if (container.isConnected) {
        container.innerHTML = renderOverview(profile, stats);
        wireOverviewNavigation(container);
      }
    }).catch((err) => {
      console.error('Failed to load dashboard overview stats:', err);
      container.innerHTML = renderOverview(profile, { groups: [], totalMembers: 0, quizzes: [], upcomingQuizzes: [], pendingReviews: 0, engagementPct: null, recentActivity: [] });
      wireOverviewNavigation(container);
    });
    return;
  }

  if (['quiz-builder', 'published-quizzes', 'draft-quizzes'].includes(section)) {
    renderQuizExperience(container, section, profile, (nextSection) => {
      const event = new CustomEvent('lecturer-section-change', { detail: nextSection });
      window.dispatchEvent(event);
    });
    return;
  }

  if (section === 'groups') {
    renderGroupsSection(container, profile);
    return;
  }

  if (section === 'submissions') {
    renderSubmissionsSection(container, profile);
    return;
  }

  if (section === 'results') {
    renderResultsSection(container, profile);
    return;
  }

  if (section === 'integrity') {
    renderIntegritySection(container, profile);
    return;
  }

  if (section === 'announcements') {
    renderAnnouncementsSection(container, profile);
    return;
  }

  if (section === 'resources') {
    renderResourcesSection(container, profile);
    return;
  }

  if (section === 'settings') {
    renderSettingsSection(container, profile);
    return;
  }

  container.innerHTML = renderPlaceholder(section);
}

export { renderSectionContent };