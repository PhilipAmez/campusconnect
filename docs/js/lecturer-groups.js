import { supabase } from './supabaseClient.js';
import { showLecturerNotice } from './lecturer-notify.js';
import { openStudentProfile } from './lecturer-student-profile.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateLabel(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadMyGroups(profile) {
  if (!profile?.id) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, description, course_code, is_public, is_frozen, member_count, invite_code, cover_photo, created_at')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load course groups:', error);
    return [];
  }
  return data || [];
}

function renderCreateGroupModal() {
  return `
    <div class="modal-overlay" id="lecturerCreateGroupModal">
      <div class="modal-content glass-card">
        <div class="modal-header">
          <h3 class="modal-title">Create Course Group</h3>
          <button type="button" class="modal-close" id="lecturerCloseGroupModal" aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
        <form class="modal-form" id="lecturerCreateGroupForm">
          <div class="field-group full">
            <label class="form-label" for="lecturerGroupName">Group Name</label>
            <input type="text" class="quiz-input" id="lecturerGroupName" placeholder="e.g. Web Development 300" required>
          </div>
          <div class="field-group full">
            <label class="form-label" for="lecturerGroupCourse">Course Code</label>
            <input type="text" class="quiz-input" id="lecturerGroupCourse" placeholder="e.g. CSC 305" required>
          </div>
          <div class="field-group full">
            <label class="form-label" for="lecturerGroupDescription">Description</label>
            <textarea class="quiz-input" id="lecturerGroupDescription" rows="3" placeholder="What's this group about?"></textarea>
          </div>
          <div class="field-group full">
            <label class="form-label" for="lecturerGroupPrivacy">Visibility</label>
            <select class="quiz-input" id="lecturerGroupPrivacy">
              <option value="public" selected>Public — suggested to students at your institution</option>
              <option value="private">Private — join by invite only</option>
            </select>
          </div>
          <p class="modal-hint">Public groups appear under Suggested Groups for students at ${'{{INSTITUTION}}'}, so they can join in one tap.</p>
          <div class="field-group full" style="display:flex; gap:10px; margin-top:6px;">
            <button type="button" class="secondary-btn" id="lecturerCancelGroup" style="flex:1;">Cancel</button>
            <button type="submit" class="primary-btn" id="lecturerSubmitGroup" style="flex:1;">
              <i class="fa-solid fa-plus"></i> Create Group
            </button>
          </div>
        </form>
      </div>
    </div>
  `;
}


function renderLoadingSkeleton() {
  return `
    <section class="quiz-shell">
      <div class="hero-card glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-users"></i> Course groups</div>
          <h3>My Course Groups</h3>
          <p>Loading the teaching circles you manage&hellip;</p>
        </div>
      </div>
      <div class="quiz-list-grid">
        ${[1, 2].map(() => `<div class="empty-state-card">Loading&hellip;</div>`).join('')}
      </div>
    </section>
  `;
}

function renderGroupCard(group) {
  const visibilityBadge = group.is_public
    ? '<span class="badge-pill">Public</span>'
    : '<span class="badge-pill soft">Private</span>';
  const frozenBadge = group.is_frozen
    ? '<span class="badge-pill" style="background:rgba(185,28,28,0.12); color:#b91c1c;">Frozen</span>'
    : '';

  return `
    <article class="quiz-card glass-card" data-group-id="${group.id}">
      <div class="quiz-card-head">
        <div>
          <h4>${escapeHtml(group.name || 'Untitled group')}</h4>
          <p>${escapeHtml(group.description || 'No description yet.')}</p>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${visibilityBadge}${frozenBadge}</div>
      </div>
      <div class="quiz-card-meta">
        <span><i class="fa-solid fa-book"></i> ${escapeHtml(group.course_code || 'No course code')}</span>
        <span><i class="fa-solid fa-user-group"></i> ${group.member_count ?? 0} members</span>
        <span><i class="fa-regular fa-calendar"></i> ${formatDateLabel(group.created_at)}</span>
      </div>
      <div class="quiz-card-actions">
        ${group.invite_code ? `<button class="secondary-btn small" data-action="copy-invite" data-code="${escapeHtml(group.invite_code)}"><i class="fa-solid fa-copy"></i> Invite code</button>` : ''}
        <button class="secondary-btn small" data-action="view-roster" data-group-id="${group.id}" data-group-name="${escapeHtml(group.name || 'Group')}"><i class="fa-solid fa-user-group"></i> Roster</button>
      </div>
    </article>
  `;
}

function bindGroupEvents(container, profile) {
  container.querySelectorAll('[data-action="copy-invite"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.code;
      try {
        await navigator.clipboard.writeText(code);
        const original = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => { button.innerHTML = original; }, 1400);
      } catch (error) {
        console.error('Could not copy invite code:', error);
      }
    });
  });

  container.querySelectorAll('[data-action="view-roster"]').forEach((button) => {
    button.addEventListener('click', () => openRosterOverlay(button.dataset.groupId, button.dataset.groupName, profile));
  });
}

let rosterOverlay = null;

function ensureRosterOverlay() {
  if (rosterOverlay) return rosterOverlay;
  rosterOverlay = document.createElement('div');
  rosterOverlay.className = 'grading-overlay';
  rosterOverlay.innerHTML = `
    <div class="grading-card">
      <div class="grading-card-header">
        <div>
          <h3 id="rosterGroupName">Roster</h3>
          <p class="grading-meta" id="rosterMeta"></p>
        </div>
        <button class="topbar-btn" id="rosterCloseBtn" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="grading-body" id="rosterBody"></div>
    </div>
  `;
  document.body.appendChild(rosterOverlay);
  rosterOverlay.addEventListener('click', (e) => { if (e.target === rosterOverlay) rosterOverlay.classList.remove('visible'); });
  rosterOverlay.querySelector('#rosterCloseBtn').addEventListener('click', () => rosterOverlay.classList.remove('visible'));
  return rosterOverlay;
}

async function openRosterOverlay(groupId, groupName, profile) {
  const overlay = ensureRosterOverlay();
  overlay.classList.add('visible');
  overlay.querySelector('#rosterGroupName').textContent = groupName || 'Roster';
  overlay.querySelector('#rosterBody').innerHTML = '<p class="empty-inline">Loading roster&hellip;</p>';

  const { data: members, error } = await supabase
    .from('group_members')
    .select('user_id, role, joined_at')
    .eq('group_id', groupId);

  if (error) {
    console.error('Failed to load group roster:', error);
    overlay.querySelector('#rosterBody').innerHTML = '<p class="empty-inline">Could not load the roster. Please try again.</p>';
    return;
  }

  const userIds = (members || []).map((m) => m.user_id);
  let profilesById = {};
  if (userIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, profile_photo, level, custom_level, verified, lecturer_badge')
      .in('id', userIds);
    profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
  }

  overlay.querySelector('#rosterMeta').textContent = `${(members || []).length} member${(members || []).length === 1 ? '' : 's'}`;

  if (!members?.length) {
    overlay.querySelector('#rosterBody').innerHTML = '<div class="empty-state-card"><i class="fa-solid fa-user-group"></i><h4>No members yet</h4><p>Share the invite code to get students in.</p></div>';
    return;
  }

  overlay.querySelector('#rosterBody').innerHTML = `
    <div class="list-card">
      ${members.map((m) => {
        const p = profilesById[m.user_id];
        return `
          <div class="list-item clickable-student" data-action="open-profile" data-student-id="${m.user_id}">
            <div>
              <strong>${escapeHtml(p?.full_name || 'Unnamed student')}${p?.verified || p?.lecturer_badge ? ' <i class="fa-solid fa-circle-check verified-badge"></i>' : ''}</strong>
              <small>${escapeHtml(p?.level || p?.custom_level || 'No level on file')}</small>
            </div>
            <span class="badge-pill">${escapeHtml(m.role || 'member')}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;

  overlay.querySelectorAll('[data-action="open-profile"]').forEach((row) => {
    row.addEventListener('click', () => openStudentProfile(row.dataset.studentId, profile));
  });
}

function bindCreateGroupModal(container, profile) {
  const modal = container.querySelector('#lecturerCreateGroupModal');
  const openBtn = container.querySelector('#lecturerAddGroupBtn');
  const closeBtn = container.querySelector('#lecturerCloseGroupModal');
  const cancelBtn = container.querySelector('#lecturerCancelGroup');
  const form = container.querySelector('#lecturerCreateGroupForm');
  if (!modal || !openBtn || !form) return;

  const open = () => modal.classList.add('active');
  const close = () => { modal.classList.remove('active'); form.reset(); };

  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  cancelBtn?.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = container.querySelector('#lecturerSubmitGroup');
    const name = container.querySelector('#lecturerGroupName').value.trim();
    const course = container.querySelector('#lecturerGroupCourse').value.trim();
    const description = container.querySelector('#lecturerGroupDescription').value.trim();
    const isPublic = container.querySelector('#lecturerGroupPrivacy').value === 'public';

    if (!name || !course) return;

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating...';

    const result = await createCourseGroup({ name, course, description, isPublic, profile });

    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Create Group';

    if (!result.ok) {
      showLecturerNotice(
        'Could not create group',
        result.message?.toLowerCase().includes('row-level security')
          ? "Your account isn't recognized as a lecturer by the database yet, so it blocked the write. Try logging out and back in."
          : (result.message || 'Something went wrong. Please try again.'),
        'error'
      );
      return;
    }

    close();
    await renderGroupsSection(container, profile);
    showLecturerNotice('Group created', `"${result.group.name}" is live and visible to students at ${profile?.institution || 'your institution'}.`, 'success');
  });
}

async function createCourseGroup({ name, course, description, isPublic, profile }) {
  if (!profile?.id) return { ok: false, message: 'Missing profile — please refresh and try again.' };

  // Same insert shape used by the student-facing "Create Group" flow (active-groups.html),
  // so lecturer-created groups behave identically for discovery, joining, and RLS.
  let { data: newGroup, error } = await supabase
    .from('groups')
    .insert({
      name,
      course_code: course,
      description: description || null,
      created_by: profile.id,
      is_public: isPublic,
      institution: profile.institution || null
    })
    .select()
    .single();

  if (error) {
    // Institution column may not exist on some deployments; retry without it.
    const fallback = await supabase
      .from('groups')
      .insert({
        name,
        course_code: course,
        description: description || null,
        created_by: profile.id,
        is_public: isPublic
      })
      .select()
      .single();
    newGroup = fallback.data;
    error = fallback.error;
  }

  if (error || !newGroup) {
    console.error('Failed to create course group:', error);
    return { ok: false, message: error?.message };
  }

  const { error: memberError } = await supabase
    .from('group_members')
    .insert({
      group_id: newGroup.id,
      user_id: profile.id,
      role: 'admin',
      joined_at: new Date().toISOString()
    });

  if (memberError) {
    console.error('Group created but failed to add lecturer as admin member:', memberError);
  }

  return { ok: true, group: newGroup };
}

async function renderGroupsSection(container, profile) {
  if (!container) return;

  container.innerHTML = renderLoadingSkeleton();

  const groups = await loadMyGroups(profile);

  container.innerHTML = `
    <section class="quiz-shell">
      <div class="hero-card glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-users"></i> Course groups</div>
          <h3>My Course Groups</h3>
          <p>Manage the teaching circles you've created${profile?.institution ? ` at ${escapeHtml(profile.institution)}` : ''}. These are also the groups you can publish quizzes to.</p>
          <div class="hero-actions">
            <button type="button" class="primary-btn" id="lecturerAddGroupBtn">
              <i class="fa-solid fa-plus"></i> Add Group
            </button>
          </div>
        </div>
      </div>
      ${groups.length
        ? `<div class="quiz-list-grid">${groups.map(renderGroupCard).join('')}</div>`
        : `<div class="empty-state-card">You haven't created any course groups yet. Tap "Add Group" above to create one — it'll immediately be visible to your students as a Suggested Group.</div>`}
    </section>
    ${renderCreateGroupModal().replace('{{INSTITUTION}}', escapeHtml(profile?.institution || 'your institution'))}
  `;

  bindGroupEvents(container, profile);
  bindCreateGroupModal(container, profile);
}

export { renderGroupsSection, loadMyGroups };