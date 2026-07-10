import { supabase } from './supabaseClient.js';
import { renderQuizExperience } from './lecturer-quizzes.js';
import { renderGroupsSection, loadMyGroups } from './lecturer-groups.js';

function getInstitutionLabel(profile) {
  return (profile?.institution || profile?.campus || profile?.custom_campus || '').trim();
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateLabel(date) {
  return new Date(date).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric'
  });
}

function timeAgo(dateString) {
  if (!dateString) return 'Recently';
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

async function loadOverviewData(profile) {
  const institution = getInstitutionLabel(profile);
  const [groups, publishedQuizzes, draftQuizzes, recentQuizzes] = await Promise.all([
    profile?.id ? loadMyGroups(profile) : Promise.resolve([]),
    institution
      ? supabase.from('quizzes').select('id, title, close_date').eq('institution', institution).eq('status', 'published').eq('is_deleted', false)
      : Promise.resolve({ data: [] }),
    institution
      ? supabase.from('quizzes').select('id', { count: 'exact', head: true }).eq('institution', institution).eq('status', 'draft').eq('is_deleted', false)
      : Promise.resolve({ count: 0 }),
    institution
      ? supabase.from('quizzes').select('id, title, status, updated_at').eq('institution', institution).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(3)
      : Promise.resolve({ data: [] })
  ]);

  const publishedList = publishedQuizzes?.data || [];
  const now = Date.now();
  const upcoming = publishedList
    .filter((quiz) => quiz.close_date && new Date(quiz.close_date).getTime() > now)
    .sort((a, b) => new Date(a.close_date) - new Date(b.close_date))
    .slice(0, 3);

  return {
    groups: groups || [],
    publishedCount: publishedList.length,
    draftCount: draftQuizzes?.count || 0,
    upcomingQuizzes: upcoming,
    recentQuizzes: recentQuizzes?.data || []
  };
}

function renderOverviewSkeleton() {
  return `
    <section class="hero-card fade-in">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Faculty workspace</div>
        <h3>Loading your workspace&hellip;</h3>
        <div class="skeleton-line" style="width:70%; margin-top:10px;"></div>
        <div class="skeleton-line" style="width:50%; margin-top:8px;"></div>
      </div>
      <div class="glass-card">
        <div class="skeleton-line" style="height:96px;"></div>
      </div>
    </section>
  `;
}

function renderOverview(profile, data, onSectionChange) {
  const name = profile?.full_name || profile?.username || 'Lecturer';
  const institution = getInstitutionLabel(profile) || 'Your institution';
  const department = profile?.department || 'Teaching & Learning';
  const verifiedBadge = profile?.verified
    ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified lecturer" aria-label="Verified lecturer"></i>'
    : '';
  const lecturerBadge = profile?.lecturer_badge
    ? '<span class="lecturer-badge" role="img" title="Premium lecturer" aria-label="Premium lecturer badge"><i class="fa-solid fa-check"></i></span>'
    : '';

  const groups = data.groups || [];
  const upcomingQuizzes = data.upcomingQuizzes || [];
  const recentQuizzes = data.recentQuizzes || [];

  return `
    <section class="hero-card fade-in">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sparkles" aria-hidden="true"></i> Faculty workspace</div>
        <h3><span class="name-with-badges">Welcome back, ${escapeHtml(name)}${verifiedBadge}${lecturerBadge}</span></h3>
        <p>Your teaching, pacing, and course groups are orchestrated here with a calm, focused view of every important signal.</p>
        <div class="hero-meta">
          <span class="meta-chip"><i class="fa-regular fa-calendar" aria-hidden="true"></i> Today • ${new Date().toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <span class="meta-chip"><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ${escapeHtml(institution)}</span>
          <span class="meta-chip"><i class="fa-solid fa-book-open" aria-hidden="true"></i> ${escapeHtml(department)}</span>
        </div>
        <div class="hero-actions">
          <button class="primary-btn" data-action="go-quiz-builder"><i class="fa-solid fa-plus" aria-hidden="true"></i> Build a quiz</button>
          <button class="secondary-btn" data-action="go-groups"><i class="fa-solid fa-users" aria-hidden="true"></i> Course groups</button>
        </div>
      </div>
      <div class="glass-card">
        <h4>Today at a glance</h4>
        <div class="stats-grid">
          <div class="stat-card">
            <p class="value">${groups.length}</p>
            <p class="label">Active groups</p>
          </div>
          <div class="stat-card">
            <p class="value">${data.publishedCount}</p>
            <p class="label">Published quizzes</p>
          </div>
          <div class="stat-card">
            <p class="value">${data.draftCount}</p>
            <p class="label">Drafts in progress</p>
          </div>
          <div class="stat-card">
            <p class="value">${upcomingQuizzes.length}</p>
            <p class="label">Closing soon</p>
          </div>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="glass-card">
        <h4>Recent activity</h4>
        <div class="list-card">
          ${recentQuizzes.length ? recentQuizzes.map((quiz) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(quiz.title || 'Untitled quiz')}</strong>
                <small>Updated ${timeAgo(quiz.updated_at)}</small>
              </div>
              <span class="badge-pill">${quiz.status === 'published' ? 'Published' : 'Draft'}</span>
            </div>
          `).join('') : '<p class="empty-state">No quiz activity yet. Once you save or publish a quiz, it will show up here.</p>'}
        </div>
      </section>

      <section class="glass-card">
        <h4>Quick actions</h4>
        <div class="list-card">
          <button class="list-item" type="button" data-action="go-groups" style="width:100%; border:0; background:transparent; text-align:left; cursor:pointer;">
            <div>
              <strong>Open course groups</strong>
              <small>Manage teaching circles</small>
            </div>
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
          <button class="list-item" type="button" data-action="go-quiz-builder" style="width:100%; border:0; background:transparent; text-align:left; cursor:pointer;">
            <div>
              <strong>Build a quiz</strong>
              <small>Compose next assessment</small>
            </div>
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
          <button class="list-item" type="button" data-action="go-drafts" style="width:100%; border:0; background:transparent; text-align:left; cursor:pointer;">
            <div>
              <strong>Review your drafts</strong>
              <small>Pick up where you left off</small>
            </div>
            <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
          </button>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="glass-card">
        <h4>My course groups</h4>
        <div class="list-card">
          ${groups.length ? groups.slice(0, 4).map((group) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(group.name || 'Untitled group')}</strong>
                <small>${group.member_count ?? 0} students • ${escapeHtml(group.course_code || 'No course code')}</small>
              </div>
              <span class="badge-pill">${group.is_public ? 'Public' : 'Private'}</span>
            </div>
          `).join('') : '<p class="empty-state">You have not created any course groups yet.</p>'}
        </div>
      </section>

      <section class="glass-card">
        <h4>Upcoming quizzes</h4>
        <div class="list-card">
          ${upcomingQuizzes.length ? upcomingQuizzes.map((quiz) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(quiz.title || 'Untitled quiz')}</strong>
                <small>Closes ${formatDateLabel(quiz.close_date)}</small>
              </div>
              <span class="badge-pill">Open</span>
            </div>
          `).join('') : '<p class="empty-state">No published quizzes have a closing date coming up.</p>'}
        </div>
      </section>
    </div>
  `;
}

function bindOverviewEvents(container, onSectionChange) {
  container.querySelectorAll('[data-action="go-groups"]').forEach((el) => el.addEventListener('click', () => onSectionChange('groups')));
  container.querySelectorAll('[data-action="go-quiz-builder"]').forEach((el) => el.addEventListener('click', () => onSectionChange('quiz-builder')));
  container.querySelectorAll('[data-action="go-drafts"]').forEach((el) => el.addEventListener('click', () => onSectionChange('draft-quizzes')));
}

const SECTION_CONTENT = {
  results: {
    title: 'Results',
    icon: 'fa-chart-line',
    body: 'A results dashboard needs a record of student quiz attempts to summarize. That data is not part of the current schema (only quizzes, quiz_questions, and quiz_groups exist), so live grade analytics cannot be shown here yet.',
    facts: (quizzes) => [
      `${quizzes.publishedCount} quiz${quizzes.publishedCount === 1 ? '' : 'zes'} currently published to your groups.`,
      `${quizzes.draftCount} draft${quizzes.draftCount === 1 ? '' : 's'} awaiting completion.`,
      'Once quiz attempts are tracked, this view can chart scores, completion rates, and pacing per group.'
    ]
  },
  integrity: {
    title: 'Integrity Logs',
    icon: 'fa-shield-halved',
    body: 'Integrity flags are generated from student quiz attempts, which are not yet tracked in the database. Below are the safeguards already configured on your published assessments.',
    facts: (quizzes) => [
      `${quizzes.publishedCount} published quiz${quizzes.publishedCount === 1 ? '' : 'zes'} currently enforcing attempt limits.`,
      'Enable an attempts table to surface flagged submissions, retake patterns, and timing anomalies here.'
    ]
  },
  resources: {
    title: 'Resources',
    icon: 'fa-folder-open',
    body: 'Sharing notes, slides, and readings requires a resources table, which does not exist in the current schema yet. Ask your team to add one and this workspace can host uploads, links, and per-group visibility controls.',
    facts: () => [
      'Course groups and quizzes are already wired up and ready to attach resources to once the table exists.'
    ]
  },
  announcements: {
    title: 'Announcements',
    icon: 'fa-bullhorn',
    body: 'Composing and broadcasting announcements needs a dedicated table to store messages and delivery status. That table is not part of the current schema, so announcements cannot be saved yet.',
    facts: () => [
      'Your course groups are already available as recipients once announcements can be persisted.'
    ]
  }
};

function renderInfoSection(section, overviewData) {
  const meta = SECTION_CONTENT[section] || SECTION_CONTENT.results;
  const facts = meta.facts(overviewData);

  return `
    <section class="glass-card fade-in">
      <div class="section-header">
        <div>
          <h3><i class="fa-solid ${meta.icon}" aria-hidden="true"></i> ${meta.title}</h3>
          <p>${meta.body}</p>
        </div>
      </div>
      <ul class="tips-list">
        ${facts.map((fact) => `<li>${fact}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderSettings(profile) {
  const notificationPrefs = profile?.notification_preferences || {};

  return `
    <section class="quiz-shell fade-in">
      <div class="glass-card quiz-section">
        <div class="section-header">
          <div>
            <h3>Settings</h3>
            <p>Update how your name, contact details, and notifications appear across the platform.</p>
          </div>
          <span class="unsaved-indicator saved" data-role="settings-indicator" aria-live="polite"><span class="dot"></span> Up to date</span>
        </div>

        <div class="field-grid">
          <label class="field-group full">
            <span>Bio</span>
            <textarea class="quiz-input" rows="3" data-field="bio" placeholder="Tell students a little about yourself">${escapeHtml(profile?.bio || '')}</textarea>
          </label>
          <label class="field-group">
            <span>Contact email</span>
            <input class="quiz-input" type="text" data-field="contact" value="${escapeHtml(profile?.contact || '')}" placeholder="you@institution.edu">
          </label>
          <label class="field-group">
            <span>Phone</span>
            <input class="quiz-input" type="text" data-field="phone" value="${escapeHtml(profile?.phone || '')}" placeholder="Optional">
          </label>
          <label class="field-group">
            <span>Department</span>
            <input class="quiz-input" type="text" data-field="department" value="${escapeHtml(profile?.department || '')}">
          </label>
          <label class="field-group full">
            <span>Institution</span>
            <input class="quiz-input" type="text" data-field="institution" value="${escapeHtml(getInstitutionLabel(profile))}" placeholder="e.g. University of Ghana">
            <small style="color:var(--muted); font-size:0.78rem;">Used to match your quizzes to your school. ${profile?.institution ? '' : `Pre-filled from your signup school (${escapeHtml(profile?.campus || profile?.custom_campus || '')}) — save to confirm it.`}</small>
          </label>
          <label class="field-group">
            <span>Profile visibility</span>
            <select class="quiz-input" data-field="privacy">
              <option value="public" ${profile?.privacy === 'public' ? 'selected' : ''}>Public</option>
              <option value="institution" ${profile?.privacy === 'institution' || !profile?.privacy ? 'selected' : ''}>Institution only</option>
              <option value="private" ${profile?.privacy === 'private' ? 'selected' : ''}>Private</option>
            </select>
          </label>
        </div>

        <div class="section-header compact" style="margin-top:6px;">
          <div>
            <h4>Profile display</h4>
            <p>Choose what shows on your public lecturer profile.</p>
          </div>
        </div>
        <div class="quiz-inline-actions">
          <label class="inline-toggle">
            <input type="checkbox" data-field="show_full_name" ${profile?.show_full_name !== false ? 'checked' : ''}>
            <span>Show full name</span>
          </label>
          <label class="inline-toggle">
            <input type="checkbox" data-field="show_academic_info" ${profile?.show_academic_info !== false ? 'checked' : ''}>
            <span>Show academic info</span>
          </label>
          <label class="inline-toggle">
            <input type="checkbox" data-field="show_groups_count" ${profile?.show_groups_count !== false ? 'checked' : ''}>
            <span>Show groups count</span>
          </label>
        </div>

        <div class="section-header compact" style="margin-top:6px;">
          <div>
            <h4>Notifications</h4>
            <p>Control which updates you receive.</p>
          </div>
        </div>
        <div class="quiz-inline-actions">
          <label class="inline-toggle">
            <input type="checkbox" data-notif="email" ${notificationPrefs.email !== false ? 'checked' : ''}>
            <span>Email notifications</span>
          </label>
          <label class="inline-toggle">
            <input type="checkbox" data-notif="push" ${notificationPrefs.push !== false ? 'checked' : ''}>
            <span>Push notifications</span>
          </label>
        </div>

        <div class="hero-actions" style="margin-top:14px;">
          <button class="primary-btn" data-action="save-settings" aria-label="Save settings"><i class="fa-solid fa-floppy-disk" aria-hidden="true"></i> Save settings</button>
        </div>
      </div>
    </section>
  `;
}

function bindSettingsEvents(container, profile) {
  const section = container.querySelector('.quiz-shell');
  const indicator = container.querySelector('[data-role="settings-indicator"]');
  const markDirty = () => {
    if (!indicator) return;
    indicator.classList.remove('saved');
    indicator.innerHTML = '<span class="dot"></span> Unsaved changes';
  };

  container.querySelectorAll('[data-field], [data-notif]').forEach((field) => {
    const eventName = field.tagName === 'SELECT' || field.type === 'checkbox' ? 'change' : 'input';
    field.addEventListener(eventName, markDirty);
  });

  const saveButton = container.querySelector('[data-action="save-settings"]');
  if (!saveButton) return;

  saveButton.addEventListener('click', async () => {
    if (!profile?.id) {
      alert('Your session could not be verified. Please refresh and sign in again.');
      return;
    }

    const getValue = (field) => container.querySelector(`[data-field="${field}"]`)?.value ?? null;
    const getChecked = (field) => container.querySelector(`[data-field="${field}"]`)?.checked ?? true;
    const getNotif = (key) => container.querySelector(`[data-notif="${key}"]`)?.checked ?? true;

    const payload = {
      bio: getValue('bio'),
      contact: getValue('contact'),
      phone: getValue('phone'),
      department: getValue('department'),
      institution: getValue('institution'),
      privacy: getValue('privacy'),
      show_full_name: getChecked('show_full_name'),
      show_academic_info: getChecked('show_academic_info'),
      show_groups_count: getChecked('show_groups_count'),
      notification_preferences: {
        ...(profile.notification_preferences || {}),
        email: getNotif('email'),
        push: getNotif('push')
      }
    };

    saveButton.classList.add('is-loading');
    saveButton.disabled = true;
    try {
      const { error } = await supabase.from('profiles').update(payload).eq('id', profile.id);
      if (error) throw error;
      Object.assign(profile, payload);
      if (indicator) {
        indicator.classList.add('saved');
        indicator.innerHTML = `<span class="dot"></span> Saved at ${new Date().toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}`;
      }
      saveButton.classList.add('is-success');
      setTimeout(() => saveButton.classList.remove('is-success'), 550);
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Could not save your settings right now. Please try again.');
    } finally {
      saveButton.classList.remove('is-loading');
      saveButton.disabled = false;
    }
  });
}

async function renderSectionContent(container, section, profile) {
  if (!container) return;

  if (section === 'overview') {
    container.innerHTML = renderOverviewSkeleton();
    const data = await loadOverviewData(profile);
    container.innerHTML = renderOverview(profile, data, (nextSection) => {
      const event = new CustomEvent('lecturer-section-change', { detail: nextSection });
      window.dispatchEvent(event);
    });
    bindOverviewEvents(container, (nextSection) => {
      const event = new CustomEvent('lecturer-section-change', { detail: nextSection });
      window.dispatchEvent(event);
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

  if (section === 'settings') {
    container.innerHTML = renderSettings(profile);
    bindSettingsEvents(container, profile);
    return;
  }

  const overviewData = await loadOverviewData(profile);
  container.innerHTML = renderInfoSection(section, overviewData);
}

export { renderSectionContent };