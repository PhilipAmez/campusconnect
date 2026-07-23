import { supabase } from './supabaseClient.js';
import { showLecturerNotice, showLecturerConfirm } from './lecturer-notify.js';
import { loadMyGroups } from './lecturer-groups.js';
import { notifyGroupMembers } from './student-notify.js';

let state = {
  profile: null,
  groups: [],
  resources: [],
  selectedFile: null
};

const CATEGORY_OPTIONS = ['Lecture Notes', 'Assignment', 'Reading', 'Reference', 'Announcement', 'Other'];

const FILE_TYPE_META = {
  pdf: { label: 'PDF', icon: 'fa-file-pdf' },
  word: { label: 'Word', icon: 'fa-file-word' },
  powerpoint: { label: 'PowerPoint', icon: 'fa-file-powerpoint' },
  image: { label: 'Image', icon: 'fa-file-image' },
  zip: { label: 'ZIP', icon: 'fa-file-zipper' },
  audio: { label: 'Audio', icon: 'fa-file-audio' },
  video: { label: 'Video', icon: 'fa-file-video' }
};

const LINK_TYPE_META = {
  google_drive: { label: 'Google Drive', icon: 'fa-brands fa-google-drive' },
  onedrive: { label: 'OneDrive', icon: 'fa-brands fa-microsoft' },
  github: { label: 'GitHub', icon: 'fa-brands fa-github' },
  youtube_playlist: { label: 'YouTube Playlist', icon: 'fa-brands fa-youtube' },
  website: { label: 'Website', icon: 'fa-solid fa-globe' },
  external_link: { label: 'External Link', icon: 'fa-solid fa-link' }
};

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

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function detectFileType(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['ppt', 'pptx'].includes(ext)) return 'powerpoint';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (['zip', 'rar', '7z'].includes(ext)) return 'zip';
  if (['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'webm', 'avi'].includes(ext)) return 'video';
  return 'zip';
}

function detectLinkType(url) {
  const u = url.toLowerCase();
  if (u.includes('drive.google.com')) return 'google_drive';
  if (u.includes('onedrive.live.com') || u.includes('1drv.ms')) return 'onedrive';
  if (u.includes('github.com')) return 'github';
  if (u.includes('youtube.com/playlist') || u.includes('youtu.be') || u.includes('youtube.com')) return 'youtube_playlist';
  if (u.startsWith('http')) return 'website';
  return 'external_link';
}

function typeMeta(resourceType) {
  return FILE_TYPE_META[resourceType] || LINK_TYPE_META[resourceType] || { label: resourceType, icon: 'fa-solid fa-file' };
}

/* ============================================================
   Data
   ============================================================ */

async function loadData(profile) {
  state.groups = await loadMyGroups(profile);
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false });
  if (error) console.error('Failed to load resources:', error);
  state.resources = data || [];
}

/* ============================================================
   Composer
   ============================================================ */

function renderComposer(editing) {
  const r = editing || {};
  const groupOptions = state.groups.map((g) =>
    `<option value="${g.id}" ${r.group_id === g.id ? 'selected' : ''}>${escapeHtml(g.name)}${g.course_code ? ` (${escapeHtml(g.course_code)})` : ''}</option>`
  ).join('');

  const sourceMode = editing ? (editing.external_url ? 'link' : 'upload') : 'upload';

  return `
    <section class="glass-card" id="resourceComposer">
      <div class="section-header">
        <h4>${editing ? 'Edit resource' : 'New resource'}</h4>
        <p>Published resources post instantly as a card in the target group's chat, and appear in that group's Resources tab.</p>
      </div>

      <div class="field-grid">
        <div class="field-group full">
          <span>Title</span>
          <input type="text" class="quiz-input" id="resTitle" placeholder="e.g. Week 6 Slides" value="${escapeHtml(r.title || '')}" />
        </div>
        <div class="field-group full">
          <span>Description</span>
          <textarea class="quiz-input" id="resDescription" rows="3" placeholder="What is this resource for?">${escapeHtml(r.description || '')}</textarea>
        </div>
        <div class="field-group">
          <span>Category</span>
          <select class="quiz-input" id="resCategory">
            ${CATEGORY_OPTIONS.map((c) => `<option value="${c}" ${r.category === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <span>Week (optional)</span>
          <input type="number" min="1" class="quiz-input" id="resWeek" value="${r.week ?? ''}" />
        </div>
        <div class="field-group full">
          <span>Topic (optional)</span>
          <input type="text" class="quiz-input" id="resTopic" placeholder="e.g. Database Systems" value="${escapeHtml(r.topic || '')}" />
        </div>
        <div class="field-group">
          <span>Target Group</span>
          <select class="quiz-input" id="resGroup">
            <option value="">Select a group&hellip;</option>
            ${groupOptions}
          </select>
        </div>
        <div class="field-group">
          <span>Visibility</span>
          <select class="quiz-input" id="resVisibility">
            <option value="group" ${(r.visibility || 'group') === 'group' ? 'selected' : ''}>Group Only</option>
            <option value="public" ${r.visibility === 'public' ? 'selected' : ''}>Public</option>
          </select>
        </div>
        <div class="field-group">
          <span>Download Permission</span>
          <select class="quiz-input" id="resDownloadPermission">
            <option value="allowed" ${(r.download_permission || 'allowed') === 'allowed' ? 'selected' : ''}>Allow Download</option>
            <option value="view_only" ${r.download_permission === 'view_only' ? 'selected' : ''}>View Only</option>
          </select>
        </div>

        <div class="field-group full">
          <span>Source</span>
          <div class="preview-tabs" id="resSourceTabs">
            <button type="button" class="preview-tab ${sourceMode === 'upload' ? 'active' : ''}" data-mode="upload">Upload File</button>
            <button type="button" class="preview-tab ${sourceMode === 'link' ? 'active' : ''}" data-mode="link">External Link</button>
          </div>
        </div>

        <div class="field-group full" id="resUploadField" style="${sourceMode === 'upload' ? '' : 'display:none;'}">
          <span>File</span>
          <input type="file" class="quiz-input" id="resFileInput" accept=".pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip,.rar,.mp3,.wav,.m4a,.mp4,.mov,.webm" />
          <small id="resFileHint">${editing?.file_name ? `Current file: ${escapeHtml(editing.file_name)} (${formatFileSize(editing.file_size_bytes)})` : 'PDF, Word, PowerPoint, images, ZIP, audio, or video'}</small>
        </div>
        <div class="field-group full" id="resLinkField" style="${sourceMode === 'link' ? '' : 'display:none;'}">
          <span>URL</span>
          <input type="url" class="quiz-input" id="resExternalUrl" placeholder="https://&hellip;" value="${escapeHtml(r.external_url || '')}" />
          <small>Google Drive, OneDrive, GitHub, YouTube playlist, or any website link</small>
        </div>
      </div>

      <div class="quiz-inline-actions">
        ${editing ? '<button class="subtle-action" id="resCancelEditBtn">Cancel edit</button>' : ''}
        <button class="secondary-btn" id="resSaveDraftBtn">Save Draft</button>
        <button class="primary-btn" id="resPublishBtn"><i class="fa-solid fa-upload"></i> ${editing && editing.status === 'published' ? 'Save Changes' : 'Publish'}</button>
      </div>
    </section>
  `;
}

function renderList() {
  if (!state.resources.length) {
    return `
      <div class="empty-state-card">
        <i class="fa-solid fa-folder-open"></i>
        <h4>No resources yet</h4>
        <p>Upload a file or share a link above — it'll post to the group chat and show up in their Resources tab.</p>
      </div>`;
  }

  return `
    <div class="list-card">
      ${state.resources.map((r) => {
        const group = state.groups.find((g) => g.id === r.group_id);
        const meta = typeMeta(r.resource_type);
        return `
          <div class="list-item">
            <div>
              <strong><i class="${meta.icon}"></i> ${escapeHtml(r.title || 'Untitled')}</strong>
              <small>${escapeHtml(group?.name || 'Unknown group')} · ${meta.label}${r.file_size_bytes ? ` · ${formatFileSize(r.file_size_bytes)}` : ''} · ${formatDateTime(r.published_at || r.created_at)}</small>
            </div>
            <div class="quiz-inline-actions">
              <span class="badge-pill ${r.status === 'published' ? 'badge-success' : ''}">${r.status === 'published' ? 'Published' : 'Draft'}</span>
              <button class="subtle-action" data-action="edit" data-id="${r.id}"><i class="fa-solid fa-pen"></i></button>
              <button class="subtle-action danger" data-action="delete" data-id="${r.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderShell(editingId) {
  const editing = editingId ? state.resources.find((r) => r.id === editingId) : null;
  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-folder-open"></i> Resources</div>
        <h3>Share learning materials</h3>
        <p>Upload files or drop links — students get a rich resource card in chat and a browsable library per group.</p>
      </div>
    </section>
    ${renderComposer(editing)}
    <section class="glass-card">
      <div class="section-header compact"><h4>Your resources</h4></div>
      ${renderList()}
    </section>
  `;
}

function wireComposer(container, editingId) {
  const tabs = container.querySelectorAll('#resSourceTabs .preview-tab');
  const uploadField = container.querySelector('#resUploadField');
  const linkField = container.querySelector('#resLinkField');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      const mode = tab.dataset.mode;
      uploadField.style.display = mode === 'upload' ? '' : 'none';
      linkField.style.display = mode === 'link' ? '' : 'none';
    });
  });

  container.querySelector('#resFileInput')?.addEventListener('change', (e) => {
    state.selectedFile = e.target.files[0] || null;
  });

  container.querySelector('#resCancelEditBtn')?.addEventListener('click', () => rerender(container, null));
  container.querySelector('#resSaveDraftBtn')?.addEventListener('click', () => saveResource(container, editingId, { asDraft: true }));
  container.querySelector('#resPublishBtn')?.addEventListener('click', () => saveResource(container, editingId, { asDraft: false }));
}

function wireList(container) {
  container.querySelectorAll('[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => rerender(container, btn.dataset.id));
  });
  container.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => deleteResource(container, btn.dataset.id));
  });
}

function activeSourceMode(container) {
  return container.querySelector('#resSourceTabs .preview-tab.active')?.dataset.mode || 'upload';
}

async function uploadSelectedFile(groupId, file) {
  const ext = file.name.split('.').pop();
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = `group_files/${groupId}/resources/${fileName}`;

  const { error: uploadError } = await supabase.storage.from('group_files').upload(filePath, file, {
    cacheControl: '3600',
    upsert: false
  });
  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = supabase.storage.from('group_files').getPublicUrl(filePath);
  return { publicUrl, fileName: file.name, fileSize: file.size, resourceType: detectFileType(file) };
}

async function postResourceCardToChat(resource) {
  const senderName = state.profile.full_name || state.profile.username || 'Lecturer';
  const { error } = await supabase.from('group_messages').insert({
    group_id: resource.group_id,
    sender_id: state.profile.id,
    sender_name: senderName,
    content: resource.id,
    message_type: 'resource'
  });
  if (error) console.error('Resource saved, but posting the chat card failed:', error);
}

async function saveResource(container, editingId, { asDraft }) {
  const title = container.querySelector('#resTitle').value.trim();
  const description = container.querySelector('#resDescription').value.trim();
  const category = container.querySelector('#resCategory').value;
  const week = container.querySelector('#resWeek').value ? Number(container.querySelector('#resWeek').value) : null;
  const topic = container.querySelector('#resTopic').value.trim();
  const groupId = container.querySelector('#resGroup').value || null;
  const visibility = container.querySelector('#resVisibility').value;
  const downloadPermission = container.querySelector('#resDownloadPermission').value;
  const mode = activeSourceMode(container);
  const externalUrl = container.querySelector('#resExternalUrl').value.trim();

  if (!title) {
    showLecturerNotice('Missing title', 'Please give this resource a title.', 'error');
    return;
  }
  if (!asDraft && !groupId) {
    showLecturerNotice('Missing target group', 'Choose which group this resource should post to.', 'error');
    return;
  }
  if (mode === 'link' && !externalUrl && !asDraft) {
    showLecturerNotice('Missing link', 'Add a URL, or switch to Upload File.', 'error');
    return;
  }
  if (mode === 'upload' && !state.selectedFile && !editingId && !asDraft) {
    showLecturerNotice('Missing file', 'Choose a file to upload, or switch to External Link.', 'error');
    return;
  }

  const publishBtn = container.querySelector('#resPublishBtn');
  const draftBtn = container.querySelector('#resSaveDraftBtn');
  publishBtn.disabled = true;
  draftBtn.disabled = true;

  try {
    const payload = {
      title,
      description,
      category,
      week,
      topic,
      group_id: groupId,
      visibility,
      download_permission: downloadPermission,
      status: asDraft ? 'draft' : 'published',
      updated_at: new Date().toISOString()
    };

    if (mode === 'link') {
      if (externalUrl) {
        payload.external_url = externalUrl;
        payload.resource_type = detectLinkType(externalUrl);
        payload.file_url = null;
        payload.file_name = null;
        payload.file_size_bytes = null;
      }
    } else if (state.selectedFile) {
      const uploaded = await uploadSelectedFile(groupId || 'unassigned', state.selectedFile);
      payload.file_url = uploaded.publicUrl;
      payload.file_name = uploaded.fileName;
      payload.file_size_bytes = uploaded.fileSize;
      payload.resource_type = uploaded.resourceType;
      payload.external_url = null;
    }

    if (!asDraft) payload.published_at = new Date().toISOString();

    let savedResource;
    if (editingId) {
      const { data, error } = await supabase.from('resources').update(payload).eq('id', editingId).select().single();
      if (error) throw error;
      savedResource = data;
    } else {
      const { data, error } = await supabase.from('resources').insert({ ...payload, created_by: state.profile.id }).select().single();
      if (error) throw error;
      savedResource = data;
    }

    if (!asDraft && savedResource) {
      await postResourceCardToChat(savedResource);
      await notifyGroupMembers(supabase, {
        groupIds: groupId,
        type: 'new_resource',
        content: `New resource shared: "${savedResource.title}"`,
        postId: savedResource.id,
        origin: 'resource',
        senderId: state.profile.id
      });
    }

    state.selectedFile = null;
    showLecturerNotice(
      asDraft ? 'Draft saved' : 'Resource published',
      asDraft ? 'Your draft has been saved.' : 'Posted to the group chat and Resources tab.',
      'success'
    );

    await refresh(container, null);
  } catch (err) {
    console.error('Failed to save resource:', err);
    showLecturerNotice('Could not save', 'Something went wrong saving this resource. Please try again.', 'error');
  } finally {
    publishBtn.disabled = false;
    draftBtn.disabled = false;
  }
}

async function deleteResource(container, id) {
  const confirmed = await showLecturerConfirm('Delete resource?', 'This removes it from the Resources tab immediately (a chat card already posted will stay but link to a removed resource). This cannot be undone.', { confirmText: 'Delete', danger: true });
  if (!confirmed) return;

  try {
    const { error } = await supabase.from('resources').delete().eq('id', id);
    if (error) throw error;
    showLecturerNotice('Resource deleted', 'It has been removed.', 'success');
    await refresh(container, null);
  } catch (err) {
    console.error('Failed to delete resource:', err);
    showLecturerNotice('Could not delete', 'Something went wrong deleting this resource. Please try again.', 'error');
  }
}

function rerender(container, editingId) {
  state.selectedFile = null;
  container.innerHTML = renderShell(editingId);
  wireComposer(container, editingId);
  wireList(container);
}

async function refresh(container, editingId) {
  await loadData(state.profile);
  rerender(container, editingId);
}

async function renderResourcesSection(container, profile) {
  if (!container) return;
  state.profile = profile;

  container.innerHTML = `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-folder-open"></i> Resources</div>
        <h3>Loading resources&hellip;</h3>
      </div>
    </section>
  `;

  try {
    await loadData(profile);
  } catch (err) {
    console.error('Failed to load resources section:', err);
  }

  if (!container.isConnected) return;
  rerender(container, null);
}

export { renderResourcesSection };