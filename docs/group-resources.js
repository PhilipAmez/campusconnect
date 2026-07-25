// group-resources.js
// Student Resources Hub — Phase 5, Module 3
// Mirrors the structure of group-quizzes.js for consistency.

import { supabase } from './js/supabaseClient.js';
import { getCurrentUserContext } from './js/campusDiscovery.js';
import { initGlobalTheme } from './js/themeManager.js';

const params = new URLSearchParams(window.location.search);
const groupId = params.get('group');

let currentUser = null;
let groupInfo = null;
let allResources = [];
let bookmarkedIds = new Set();
let activeFilter = 'all';
let activeSort = 'newest';
let searchTerm = '';
let searchDebounce = null;

const els = {};

const DOCUMENT_TYPES = ['pdf', 'word', 'powerpoint', 'zip'];
const MEDIA_TYPES = ['image', 'audio', 'video'];
const LINK_TYPES = ['external_link', 'google_drive', 'onedrive', 'github', 'youtube_playlist', 'website'];

const TYPE_META = {
  pdf: { label: 'PDF', icon: 'fas fa-file-pdf' },
  word: { label: 'Word', icon: 'fas fa-file-word' },
  powerpoint: { label: 'PowerPoint', icon: 'fas fa-file-powerpoint' },
  image: { label: 'Image', icon: 'fas fa-file-image' },
  zip: { label: 'ZIP', icon: 'fas fa-file-archive' },
  audio: { label: 'Audio', icon: 'fas fa-file-audio' },
  video: { label: 'Video', icon: 'fas fa-file-video' },
  google_drive: { label: 'Google Drive', icon: 'fab fa-google-drive' },
  onedrive: { label: 'OneDrive', icon: 'fab fa-microsoft' },
  github: { label: 'GitHub', icon: 'fab fa-github' },
  youtube_playlist: { label: 'YouTube Playlist', icon: 'fab fa-youtube' },
  website: { label: 'Website', icon: 'fas fa-globe' },
  external_link: { label: 'Link', icon: 'fas fa-link' }
};

function cacheEls() {
  els.backButton = document.getElementById('backButton');
  els.navTitle = document.getElementById('navTitle');
  els.heroTitle = document.getElementById('heroTitle');
  els.heroMeta = document.getElementById('heroMeta');
  els.statTotal = document.getElementById('statTotal');
  els.statWeek = document.getElementById('statWeek');
  els.statBookmarked = document.getElementById('statBookmarked');
  els.statDownloadable = document.getElementById('statDownloadable');
  els.searchInput = document.getElementById('searchInput');
  els.filterControl = document.getElementById('filterControl');
  els.sortSelect = document.getElementById('sortSelect');
  els.resourceList = document.getElementById('resourceList');
  els.toast = document.getElementById('toast');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(message) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  setTimeout(() => els.toast.classList.remove('show'), 2600);
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function init() {
  cacheEls();
  await initGlobalTheme({ supabase });

  els.backButton.addEventListener('click', () => { window.location.href = 'active-groups.html'; });
  document.getElementById('homeButton')?.addEventListener('click', () => { window.location.href = 'dashboard.html'; });

  if (!groupId) {
    renderError('No group selected. Go back and pick a group first.');
    return;
  }

  const { user } = await getCurrentUserContext(supabase, { force: true });
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  currentUser = user;

  const { data: membership } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) {
    renderError("You're not a member of this group, so its resources aren't visible here.");
    return;
  }

  await loadGroupInfo();
  await loadResources();

  wireControls();
  renderAll();
  subscribeToResourceChanges();
}

function subscribeToResourceChanges() {
  const channel = supabase
    .channel(`resources-hub-${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'resources', filter: `group_id=eq.${groupId}` }, async () => {
      await loadResources();
      renderAll();
    })
    .subscribe();

  window.addEventListener('beforeunload', () => supabase.removeChannel(channel));
}

async function loadGroupInfo() {
  const { data: group } = await supabase
    .from('groups')
    .select('id, name, course_code')
    .eq('id', groupId)
    .single();
  groupInfo = group || { name: 'Group' };
}

async function loadResources() {
  const { data, error } = await supabase
    .from('resources')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load resources:', error);
    allResources = [];
    return;
  }
  allResources = data || [];

  const { data: bookmarks } = await supabase
    .from('resource_bookmarks')
    .select('resource_id')
    .eq('user_id', currentUser.id);
  bookmarkedIds = new Set((bookmarks || []).map((b) => b.resource_id));
}

function renderAll() {
  renderHero();
  renderStats();
  renderList();
}

function renderHero() {
  els.heroTitle.textContent = `${groupInfo?.name || 'Group'} Resources`;
  els.navTitle.textContent = 'Resources';
  els.heroMeta.innerHTML = groupInfo?.course_code
    ? `<div class="hero-meta-item"><i class="fas fa-graduation-cap"></i> <strong>${escapeHtml(groupInfo.course_code)}</strong></div>`
    : '';
}

function renderStats() {
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  els.statTotal.textContent = allResources.length;
  els.statWeek.textContent = allResources.filter((r) => new Date(r.published_at || r.created_at).getTime() >= oneWeekAgo).length;
  els.statBookmarked.textContent = bookmarkedIds.size;
  els.statDownloadable.textContent = allResources.filter((r) => r.download_permission !== 'view_only' && r.file_url).length;
}

function getFilteredSortedResources() {
  let list = [...allResources];

  if (activeFilter === 'documents') list = list.filter((r) => DOCUMENT_TYPES.includes(r.resource_type));
  else if (activeFilter === 'media') list = list.filter((r) => MEDIA_TYPES.includes(r.resource_type));
  else if (activeFilter === 'links') list = list.filter((r) => LINK_TYPES.includes(r.resource_type));
  else if (activeFilter === 'bookmarked') list = list.filter((r) => bookmarkedIds.has(r.id));

  if (searchTerm.trim()) {
    const term = searchTerm.trim().toLowerCase();
    list = list.filter((r) =>
      (r.title || '').toLowerCase().includes(term) ||
      (r.topic || '').toLowerCase().includes(term) ||
      (r.description || '').toLowerCase().includes(term)
    );
  }

  if (activeSort === 'newest') list.sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at));
  else if (activeSort === 'oldest') list.sort((a, b) => new Date(a.published_at || a.created_at) - new Date(b.published_at || b.created_at));
  else if (activeSort === 'alphabetical') list.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  return list;
}

function renderList() {
  const list = getFilteredSortedResources();

  if (!list.length) {
    els.resourceList.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-folder-open"></i>
        <h3>Nothing here yet</h3>
        <p>${allResources.length ? 'No resources match this filter.' : 'Your lecturer hasn\u2019t shared anything here yet.'}</p>
      </div>`;
    return;
  }

  els.resourceList.innerHTML = list.map(renderResourceCard).join('');

  els.resourceList.querySelectorAll('[data-action="preview"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) window.open(url, '_blank', 'noopener');
    });
  });

  els.resourceList.querySelectorAll('[data-action="download"]').forEach((btn) => {
    btn.addEventListener('click', () => downloadResource(btn.dataset.id, btn.dataset.url, btn.dataset.name));
  });

  els.resourceList.querySelectorAll('[data-action="bookmark"]').forEach((btn) => {
    btn.addEventListener('click', () => toggleBookmark(btn.dataset.id, btn));
  });

  els.resourceList.querySelectorAll('[data-action="share"]').forEach((btn) => {
    btn.addEventListener('click', () => shareResource(btn.dataset.url));
  });
}

function renderResourceCard(r) {
  const meta = TYPE_META[r.resource_type] || { label: r.resource_type, icon: 'fas fa-file' };
  const url = r.file_url || r.external_url;
  const isBookmarked = bookmarkedIds.has(r.id);
  const isDownloadable = r.download_permission !== 'view_only' && !!r.file_url;

  return `
    <div class="quiz-card animate-fade-in">
      <div class="quiz-card-top">
        <div class="quiz-title-row">
          <span class="quiz-title">${escapeHtml(r.title || 'Untitled resource')}</span>
          ${r.topic ? `<span class="quiz-visibility">${escapeHtml(r.topic)}</span>` : ''}
        </div>
        <span class="status-badge available"><i class="${meta.icon}"></i> ${meta.label}</span>
      </div>

      ${r.description ? `<p class="quiz-description">${escapeHtml(r.description)}</p>` : ''}

      <div class="quiz-detail-chips">
        ${r.category ? `<span class="detail-chip"><i class="fas fa-tag"></i> ${escapeHtml(r.category)}</span>` : ''}
        ${r.week ? `<span class="detail-chip"><i class="fas fa-calendar-week"></i> Week ${r.week}</span>` : ''}
        ${r.file_size_bytes ? `<span class="detail-chip"><i class="fas fa-weight-hanging"></i> ${formatFileSize(r.file_size_bytes)}</span>` : ''}
        <span class="detail-chip"><i class="fas fa-clock"></i> ${formatDate(r.published_at || r.created_at) || '—'}</span>
      </div>

      <div class="quiz-card-bottom">
        <div class="attempts-remaining"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="start-quiz-btn" data-action="preview" data-url="${escapeHtml(url || '')}"><i class="fas fa-eye"></i> Preview</button>
          ${isDownloadable ? `<button class="start-quiz-btn" data-action="download" data-id="${r.id}" data-url="${escapeHtml(url)}" data-name="${escapeHtml(r.file_name || r.title)}"><i class="fas fa-download"></i> Download</button>` : ''}
          <button class="start-quiz-btn" data-action="bookmark" data-id="${r.id}" style="${isBookmarked ? 'background: linear-gradient(135deg, var(--warning), #ff9500);' : ''}"><i class="fa-${isBookmarked ? 'solid' : 'regular'} fa-bookmark"></i></button>
          <button class="start-quiz-btn" data-action="share" data-url="${escapeHtml(url || '')}"><i class="fas fa-share"></i></button>
        </div>
      </div>
    </div>
  `;
}

async function downloadResource(resourceId, url, name) {
  if (!url) return;
  try {
    await supabase.from('resource_downloads').insert({ resource_id: resourceId, user_id: currentUser.id });
    const resource = allResources.find((r) => r.id === resourceId);
    if (resource?.created_by && resource.created_by !== currentUser.id) {
      await supabase.from('notifications').insert({
        user_id: resource.created_by,
        sender_id: currentUser.id,
        type: 'resource_downloaded',
        content: `Someone downloaded "${resource.title}"`,
        post_id: resourceId,
        origin: 'resources'
      });
    }
  } catch (err) {
    console.error('Failed to log download:', err);
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = name || 'resource';
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function toggleBookmark(resourceId, btn) {
  try {
    if (bookmarkedIds.has(resourceId)) {
      await supabase.from('resource_bookmarks').delete().eq('resource_id', resourceId).eq('user_id', currentUser.id);
      bookmarkedIds.delete(resourceId);
    } else {
      await supabase.from('resource_bookmarks').upsert({ resource_id: resourceId, user_id: currentUser.id }, { onConflict: 'resource_id,user_id' });
      bookmarkedIds.add(resourceId);
    }
    renderAll();
  } catch (err) {
    console.error('Failed to toggle bookmark:', err);
    showToast("Couldn't update bookmark");
  }
}

async function shareResource(url) {
  try {
    await navigator.clipboard.writeText(url || window.location.href);
    showToast('Link copied to clipboard');
  } catch (err) {
    console.error('Failed to copy link:', err);
  }
}

function renderError(message) {
  els.resourceList.innerHTML = `
    <div class="empty-state">
      <i class="fas fa-triangle-exclamation"></i>
      <h3>Can't show resources</h3>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

function wireControls() {
  els.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = e.target.value;
      renderList();
    }, 200);
  });

  els.filterControl.querySelectorAll('.segment-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.dataset.filter;
      els.filterControl.querySelectorAll('.segment-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderList();
    });
  });

  els.sortSelect.addEventListener('change', (e) => {
    activeSort = e.target.value;
    renderList();
  });
}

init().catch((err) => {
  console.error('Failed to initialize resources hub:', err);
  renderError('Something went wrong loading resources.');
});