import { supabase } from './supabaseClient.js';

const TYPE_META = {
  new_submission: { icon: 'fa-inbox', label: 'New submission', section: 'submissions' },
  quiz_completed: { icon: 'fa-square-check', label: 'Quiz completed', section: 'results' },
  announcement_read: { icon: 'fa-bullhorn', label: 'Announcement read', section: 'announcements' },
  announcement_reaction: { icon: 'fa-face-smile', label: 'Announcement reaction', section: 'announcements' },
  announcement_comment: { icon: 'fa-comment', label: 'Announcement comment', section: 'announcements' },
  resource_downloaded: { icon: 'fa-download', label: 'Resource downloaded', section: 'resources' },
  integrity_event: { icon: 'fa-shield-halved', label: 'Integrity event', section: 'integrity' },
  new_student_joined: { icon: 'fa-user-plus', label: 'New student', section: 'groups' }
};

const state = {
  profile: null,
  notifications: [],
  initialized: false,
  panelOpen: false
};

let panel = null;

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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function unreadCount() {
  return state.notifications.filter((n) => !n.seen_at).length;
}

function ensurePanel() {
  if (panel) return panel;
  panel = document.createElement('div');
  panel.className = 'lecturer-notif-panel';
  panel.innerHTML = `
    <div class="lecturer-notif-header">
      <h4>Notifications</h4>
      <button class="subtle-action" id="notifMarkAllBtn">Mark all read</button>
    </div>
    <div class="lecturer-notif-list" id="notifListBody"></div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('#notifMarkAllBtn').addEventListener('click', markAllRead);

  document.addEventListener('click', (e) => {
    if (!state.panelOpen) return;
    if (panel.contains(e.target) || e.target.closest('#notifBellBtn')) return;
    closePanel();
  });

  return panel;
}

function renderPanel() {
  const listEl = panel.querySelector('#notifListBody');
  if (!state.notifications.length) {
    listEl.innerHTML = `<div class="lecturer-notif-empty"><i class="fa-solid fa-bell-slash"></i><p>No notifications yet</p></div>`;
    return;
  }

  listEl.innerHTML = state.notifications.map((n) => {
    const meta = TYPE_META[n.type] || { icon: 'fa-bell', label: n.type };
    return `
      <div class="lecturer-notif-item ${n.seen_at ? '' : 'unread'}" data-id="${n.id}" data-section="${meta.section || ''}">
        <div class="lecturer-notif-icon"><i class="fa-solid ${meta.icon}"></i></div>
        <div class="lecturer-notif-body">
          <strong>${escapeHtml(meta.label)}</strong>
          <span>${escapeHtml(n.content || '')}</span>
          <small>${timeAgo(n.created_at)}</small>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.lecturer-notif-item').forEach((item) => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const section = item.dataset.section;
      markRead(id);
      closePanel();
      if (section) {
        window.dispatchEvent(new CustomEvent('lecturer-section-change', { detail: section }));
      }
    });
  });
}

function updateBadge() {
  const badge = document.getElementById('notifBellBadge');
  if (!badge) return;
  const count = unreadCount();
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function openPanel() {
  ensurePanel();
  renderPanel();
  panel.classList.add('visible');
  state.panelOpen = true;
}

function closePanel() {
  if (panel) panel.classList.remove('visible');
  state.panelOpen = false;
}

function togglePanel() {
  if (state.panelOpen) closePanel();
  else openPanel();
}

async function markRead(id) {
  const notif = state.notifications.find((n) => n.id === id);
  if (!notif || notif.seen_at) return;
  const ts = new Date().toISOString();
  notif.seen_at = ts;
  updateBadge();
  try {
    await supabase.from('notifications').update({ seen_at: ts }).eq('id', id).eq('user_id', state.profile.id);
  } catch (err) {
    console.error('Failed to mark notification read:', err);
  }
}

async function markAllRead() {
  const ts = new Date().toISOString();
  state.notifications.forEach((n) => { if (!n.seen_at) n.seen_at = ts; });
  updateBadge();
  renderPanel();
  try {
    await supabase.from('notifications').update({ seen_at: ts }).eq('user_id', state.profile.id).is('seen_at', null);
  } catch (err) {
    console.error('Failed to mark all notifications read:', err);
  }
}

async function loadNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, content, post_id, sender_id, origin, created_at, seen_at')
    .eq('user_id', state.profile.id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('Failed to load notifications:', error);
    return;
  }
  state.notifications = data || [];
}

function subscribeRealtime() {
  supabase
    .channel(`lecturer-notifications-${state.profile.id}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.profile.id}` }, (payload) => {
      state.notifications.unshift(payload.new);
      updateBadge();
      if (state.panelOpen) renderPanel();
    })
    .subscribe();
}

function attachBellButton() {
  const btn = document.getElementById('notifBellBtn');
  if (!btn) return;
  btn.onclick = (e) => {
    e.stopPropagation();
    togglePanel();
  };
  updateBadge();
}

export async function initLecturerNotifications(profile) {
  state.profile = profile;
  attachBellButton();

  if (state.initialized) return;
  state.initialized = true;

  try {
    await loadNotifications();
  } catch (err) {
    console.error('Failed to initialize lecturer notifications:', err);
  }
  updateBadge();
  subscribeRealtime();
}