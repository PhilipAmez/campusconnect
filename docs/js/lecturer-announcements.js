import { supabase } from './supabaseClient.js';
import { showLecturerNotice, showLecturerConfirm } from './lecturer-notify.js';
import { loadMyGroups } from './lecturer-groups.js';
import { notifyGroupMembers } from './student-notify.js';

let state = {
  profile: null,
  groups: [],
  announcements: []
};

let activeContainer = null;

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

function toDatetimeLocalValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadge(a) {
  const now = new Date();
  if (a.status === 'draft') return '<span class="badge-pill">Draft</span>';
  if (a.status === 'scheduled') return '<span class="badge-pill badge-warning">Scheduled</span>';
  if (a.expires_at && new Date(a.expires_at) < now) return '<span class="badge-pill">Expired</span>';
  if (a.status === 'published') return '<span class="badge-pill badge-success">Published</span>';
  return `<span class="badge-pill">${escapeHtml(a.status)}</span>`;
}

const IMPORTANCE_LABELS = { normal: 'Normal', important: 'Important', urgent: 'Urgent' };

/* ============================================================
   Data
   ============================================================ */

async function loadData(profile) {
  state.groups = await loadMyGroups(profile);

  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false });

  if (error) console.error('Failed to load announcements:', error);
  state.announcements = data || [];
}

/* ============================================================
   Composer
   ============================================================ */

function renderComposer(editing) {
  const a = editing || {};
  const groupOptions = state.groups.map((g) =>
    `<option value="${g.id}" ${a.group_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}${g.course_code ? ` (${escapeHtml(g.course_code)})` : ''}</option>`
  ).join('');

  return `
    <section class="glass-card" id="announcementComposer">
      <div class="section-header">
        <h4>${editing ? 'Edit announcement' : 'New announcement'}</h4>
        <p>Published announcements appear instantly as a pinned card in the target group's chat.</p>
      </div>

      <div class="field-grid">
        <div class="field-group full">
          <span>Announcement Title</span>
          <input type="text" class="quiz-input" id="annTitle" placeholder="e.g. Mid-Semester Exam" value="${escapeHtml(a.title || '')}" />
        </div>
        <div class="field-group full">
          <span>Announcement Body</span>
          <textarea class="quiz-input" id="annBody" rows="4" placeholder="Write the announcement&hellip;">${escapeHtml(a.message || '')}</textarea>
        </div>
        <div class="field-group">
          <span>Target Group</span>
          <select class="quiz-input" id="annGroup">
            <option value="">Select a group&hellip;</option>
            ${groupOptions}
          </select>
        </div>
        <div class="field-group">
          <span>Importance</span>
          <select class="quiz-input" id="annImportance">
            ${Object.entries(IMPORTANCE_LABELS).map(([val, label]) => `<option value="${val}" ${(a.importance || 'normal') === val ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <span>Publish</span>
          <select class="quiz-input" id="annPublishMode">
            <option value="now" ${!a.scheduled_at ? 'selected' : ''}>Publish Now</option>
            <option value="schedule" ${a.scheduled_at ? 'selected' : ''}>Schedule</option>
          </select>
        </div>
        <div class="field-group" id="annScheduleField" style="${a.scheduled_at ? '' : 'display:none;'}">
          <span>Scheduled for</span>
          <input type="datetime-local" class="quiz-input" id="annScheduledAt" value="${toDatetimeLocalValue(a.scheduled_at)}" />
        </div>
        <div class="field-group">
          <span>Expiry Date (optional)</span>
          <input type="datetime-local" class="quiz-input" id="annExpiresAt" value="${toDatetimeLocalValue(a.expires_at)}" />
        </div>
        <div class="field-group flex">
          <label><input type="checkbox" id="annAllowComments" ${a.allow_comments !== false ? 'checked' : ''} /> Allow Comments</label>
        </div>
        <div class="field-group flex">
          <label><input type="checkbox" id="annAllowReactions" ${a.allow_reactions !== false ? 'checked' : ''} /> Allow Reactions</label>
        </div>
        <div class="field-group flex">
          <label><input type="checkbox" id="annPinned" ${a.pinned !== false ? 'checked' : ''} /> Pin Announcement</label>
        </div>
      </div>

      <div class="quiz-inline-actions">
        ${editing ? '<button class="subtle-action" id="annCancelEditBtn">Cancel edit</button>' : ''}
        <button class="secondary-btn" id="annSaveDraftBtn">Save Draft</button>
        <button class="primary-btn" id="annPublishBtn"><i class="fa-solid fa-bullhorn"></i> ${editing && a.status === 'published' ? 'Save Changes' : 'Publish'}</button>
      </div>
    </section>
  `;
}

function renderList() {
  if (!state.announcements.length) {
    return `
      <div class="empty-state-card">
        <i class="fa-solid fa-bullhorn"></i>
        <h4>No announcements yet</h4>
        <p>Create your first announcement above — it'll show up as a pinned card in the group chat.</p>
      </div>`;
  }

  return `
    <div class="list-card" id="announcementListCard">
      ${state.announcements.map((a) => {
        const group = state.groups.find((g) => g.id === a.group_id);
        return `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(a.title || 'Untitled')}</strong>
              <small>${escapeHtml(group?.name || 'Unknown group')} · ${IMPORTANCE_LABELS[a.importance] || 'Normal'} · ${formatDateTime(a.published_at || a.created_at)}</small>
            </div>
            <div class="quiz-inline-actions">
              ${statusBadge(a)}
              <button class="subtle-action" data-action="edit" data-id="${a.id}"><i class="fa-solid fa-pen"></i></button>
              <button class="subtle-action danger" data-action="delete" data-id="${a.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderShell(editingId) {
  const editing = editingId ? state.announcements.find((a) => a.id === editingId) : null;
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-bullhorn"></i> Announcements</div>
        <h3>Reach your groups instantly</h3>
        <p>Announcements post as a pinned, highly visible system card at the top of the group's chat — not as an ordinary message.</p>
      </div>
    </section>
    ${renderComposer(editing)}
    <section class="glass-card">
      <div class="section-header compact"><h4>Your announcements</h4></div>
      ${renderList()}
    </section>
  `;
}

function wireComposer(container, editingId) {
  const publishModeSelect = container.querySelector('#annPublishMode');
  const scheduleField = container.querySelector('#annScheduleField');
  publishModeSelect?.addEventListener('change', () => {
    scheduleField.style.display = publishModeSelect.value === 'schedule' ? '' : 'none';
  });

  container.querySelector('#annCancelEditBtn')?.addEventListener('click', () => rerender(container, null));

  container.querySelector('#annSaveDraftBtn')?.addEventListener('click', () => saveAnnouncement(container, editingId, { asDraft: true }));
  container.querySelector('#annPublishBtn')?.addEventListener('click', () => saveAnnouncement(container, editingId, { asDraft: false }));
}

function wireList(container) {
  container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => rerender(container, btn.dataset.id));
  });
  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteAnnouncement(container, btn.dataset.id));
  });
}

function readComposerValues(container) {
  return {
    title: container.querySelector('#annTitle').value.trim(),
    message: container.querySelector('#annBody').value.trim(),
    group_id: container.querySelector('#annGroup').value || null,
    importance: container.querySelector('#annImportance').value,
    publishMode: container.querySelector('#annPublishMode').value,
    scheduled_at: container.querySelector('#annScheduledAt').value || null,
    expires_at: container.querySelector('#annExpiresAt').value || null,
    allow_comments: container.querySelector('#annAllowComments').checked,
    allow_reactions: container.querySelector('#annAllowReactions').checked,
    pinned: container.querySelector('#annPinned').checked
  };
}

async function saveAnnouncement(container, editingId, { asDraft }) {
  const values = readComposerValues(container);

  if (!values.title || !values.message) {
    showLecturerNotice('Missing details', 'Please add a title and a body for the announcement.', 'error');
    return;
  }
  if (!asDraft && !values.group_id) {
    showLecturerNotice('Missing target group', 'Choose which group this announcement should post to.', 'error');
    return;
  }

  const now = new Date().toISOString();
  const isScheduled = !asDraft && values.publishMode === 'schedule' && values.scheduled_at;

  const payload = {
    title: values.title,
    message: values.message,
    group_id: values.group_id,
    importance: values.importance,
    allow_comments: values.allow_comments,
    allow_reactions: values.allow_reactions,
    pinned: values.pinned,
    expires_at: values.expires_at ? new Date(values.expires_at).toISOString() : null,
    scheduled_at: isScheduled ? new Date(values.scheduled_at).toISOString() : null,
    status: asDraft ? 'draft' : (isScheduled ? 'scheduled' : 'published'),
    is_active: !asDraft,
    updated_at: now,
    type: 'system_announcement',
    priority: values.importance === 'urgent' ? 3 : values.importance === 'important' ? 2 : 1
  };
  if (!asDraft && !isScheduled) payload.published_at = now;

  try {
    let savedResult;
    if (editingId) {
      const { error } = await supabase.from('announcements').update(payload).eq('id', editingId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('announcements').insert({ ...payload, created_by: state.profile.id, created_at: now }).select().single();
      if (error) throw error;
      savedResult = data;
    }

    if (!asDraft && !isScheduled && values.group_id) {
      await notifyGroupMembers(supabase, {
        groupIds: values.group_id,
        type: 'new_announcement',
        content: `New announcement: "${values.title}"`,
        postId: savedResult?.id || editingId,
        origin: 'announcement',
        senderId: state.profile.id
      });
    }

    showLecturerNotice(
      asDraft ? 'Draft saved' : isScheduled ? 'Announcement scheduled' : 'Announcement published',
      asDraft ? 'Your draft has been saved.' : isScheduled ? 'It will go live at the scheduled time.' : 'Students in the target group can see it now.',
      'success'
    );

    await refresh(container, null);
  } catch (err) {
    console.error('Failed to save announcement:', err);
    showLecturerNotice('Could not save', 'Something went wrong saving this announcement. Please try again.', 'error');
  }
}

async function deleteAnnouncement(container, id) {
  const confirmed = await showLecturerConfirm('Delete announcement?', 'This removes it from the group chat immediately. This cannot be undone.', { confirmText: 'Delete', danger: true });
  if (!confirmed) return;

  try {
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) throw error;
    showLecturerNotice('Announcement deleted', 'It has been removed.', 'success');
    await refresh(container, null);
  } catch (err) {
    console.error('Failed to delete announcement:', err);
    showLecturerNotice('Could not delete', 'Something went wrong deleting this announcement. Please try again.', 'error');
  }
}

function rerender(container, editingId) {
  container.innerHTML = renderShell(editingId);
  wireComposer(container, editingId);
  wireList(container);
}

async function refresh(container, editingId) {
  await loadData(state.profile);
  rerender(container, editingId);
}

async function renderAnnouncementsSection(container, profile) {
  if (!container) return;
  activeContainer = container;
  state.profile = profile;

  container.innerHTML = `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-bullhorn"></i> Announcements</div>
        <h3>Loading announcements&hellip;</h3>
      </div>
    </section>
  `;

  try {
    await loadData(profile);
  } catch (err) {
    console.error('Failed to load announcements section:', err);
  }

  if (!container.isConnected) return;
  rerender(container, null);
}

export { renderAnnouncementsSection };