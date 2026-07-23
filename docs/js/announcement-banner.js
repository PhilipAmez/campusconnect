import './toast.js';

const IMPORTANCE_META = {
  urgent: { label: 'Urgent', className: 'ann-urgent' },
  important: { label: 'Important', className: 'ann-important' },
  normal: { label: 'Announcement', className: 'ann-normal' }
};

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function notify(message, type = 'info') {
  if (window.toast) window.toast(message, { type });
}

function dismissedKey(groupId) {
  return `dismissed_announcements_${groupId}`;
}

function getDismissedIds(groupId) {
  try {
    return new Set(JSON.parse(localStorage.getItem(dismissedKey(groupId)) || '[]'));
  } catch {
    return new Set();
  }
}

function dismissLocally(groupId, announcementId) {
  const set = getDismissedIds(groupId);
  set.add(announcementId);
  try { localStorage.setItem(dismissedKey(groupId), JSON.stringify([...set])); } catch { /* ignore */ }
}

export async function mountAnnouncementBanner({ supabase, groupId, user }) {
  const host = document.createElement('div');
  host.className = 'pinned-announcements';
  host.id = 'pinnedAnnouncements';

  const messagePanel = document.getElementById('messagePanel');
  if (messagePanel && messagePanel.parentElement) {
    messagePanel.parentElement.insertBefore(host, messagePanel);
  } else {
    document.body.prepend(host);
  }

  const state = {
    announcements: [],
    profilesById: {},
    reactionsByAnnouncement: {},
    expanded: new Set(),
    notifiedRead: new Set()
  };

  async function loadAnnouncements() {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'published')
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('pinned', { ascending: false })
      .order('published_at', { ascending: false });

    if (error) {
      console.error('Failed to load announcements:', error);
      return;
    }

    const dismissed = getDismissedIds(groupId);
    state.announcements = (data || []).filter((a) => !dismissed.has(a.id));

    const posterIds = [...new Set(state.announcements.map((a) => a.created_by).filter(Boolean))];
    if (posterIds.length) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, verified, lecturer_badge')
        .in('id', posterIds);
      state.profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    }

    const announcementIds = state.announcements.map((a) => a.id);
    if (announcementIds.length) {
      const { data: reactions } = await supabase
        .from('announcement_reactions')
        .select('announcement_id, user_id, emoji')
        .in('announcement_id', announcementIds);
      state.reactionsByAnnouncement = {};
      (reactions || []).forEach((r) => {
        if (!state.reactionsByAnnouncement[r.announcement_id]) state.reactionsByAnnouncement[r.announcement_id] = [];
        state.reactionsByAnnouncement[r.announcement_id].push(r);
      });
    } else {
      state.reactionsByAnnouncement = {};
    }
  }

  async function loadComments(announcementId) {
    const { data, error } = await supabase
      .from('announcement_comments')
      .select('*')
      .eq('announcement_id', announcementId)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to load comments:', error);
      return [];
    }
    return data || [];
  }

  function renderReactionBar(a) {
    const reactions = state.reactionsByAnnouncement[a.id] || [];
    const myReaction = reactions.find((r) => r.user_id === user.id);
    const grouped = {};
    reactions.forEach((r) => { grouped[r.emoji] = (grouped[r.emoji] || 0) + 1; });
    const emojiChoices = ['👍', '❤️', '🎉', '👏'];

    return `
      <div class="ann-reactions" data-announcement-id="${a.id}">
        ${emojiChoices.map((emoji) => `
          <button class="ann-reaction-btn ${myReaction?.emoji === emoji ? 'active' : ''}" data-emoji="${emoji}" data-announcement-id="${a.id}">
            ${emoji}${grouped[emoji] ? ` <span>${grouped[emoji]}</span>` : ''}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderCard(a) {
    const poster = state.profilesById[a.created_by];
    const posterName = poster?.full_name || 'Your lecturer';
    const verified = poster?.verified || poster?.lecturer_badge;
    const importance = IMPORTANCE_META[a.importance] || IMPORTANCE_META.normal;
    const isExpanded = state.expanded.has(a.id);

    return `
      <div class="ann-card ${importance.className} ${isExpanded ? 'expanded' : ''}" data-announcement-id="${a.id}">
        <div class="ann-card-top">
          <span class="ann-badge"><i class="fa-solid fa-bullhorn"></i> ${importance.label}</span>
          <button class="ann-dismiss-btn" data-action="dismiss" data-id="${a.id}" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <h4 class="ann-title">${escapeHtml(a.title)}</h4>
        <p class="ann-body ${isExpanded ? '' : 'clamped'}">${escapeHtml(a.message)}</p>
        <div class="ann-meta">
          <span>Posted by <strong>${escapeHtml(posterName)}</strong>${verified ? ' <i class="fa-solid fa-circle-check ann-verified"></i>' : ''}</span>
          <span>${formatDateTime(a.published_at || a.created_at)}</span>
        </div>

        <button class="ann-expand-btn" data-action="toggle" data-id="${a.id}">
          ${isExpanded ? 'Collapse' : 'View Details'} <i class="fa-solid fa-chevron-${isExpanded ? 'up' : 'down'}"></i>
        </button>

        ${isExpanded ? `
          <div class="ann-expanded-area">
            ${a.allow_reactions ? renderReactionBar(a) : ''}
            ${a.allow_comments ? `
              <div class="ann-comments" id="annComments-${a.id}">
                <p class="ann-comments-loading">Loading comments&hellip;</p>
              </div>
              <div class="ann-comment-input-row">
                <input type="text" class="ann-comment-input" data-id="${a.id}" placeholder="Write a comment&hellip;" />
                <button class="ann-comment-send-btn" data-action="comment" data-id="${a.id}"><i class="fa-solid fa-paper-plane"></i></button>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  async function render({ animateNewIds = [] } = {}) {
    if (!state.announcements.length) {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    host.innerHTML = state.announcements.map(renderCard).join('');

    animateNewIds.forEach((id) => {
      const el = host.querySelector(`.ann-card[data-announcement-id="${id}"]`);
      el?.classList.add('ann-enter');
    });

    wireCards();

    for (const a of state.announcements) {
      if (state.expanded.has(a.id) && a.allow_comments) {
        renderCommentsInto(a.id);
      }
    }
  }

  async function renderCommentsInto(announcementId) {
    const el = host.querySelector(`#annComments-${announcementId}`);
    if (!el) return;
    const comments = await loadComments(announcementId);
    if (!comments.length) {
      el.innerHTML = '<p class="ann-comments-empty">No comments yet — be the first to reply.</p>';
      return;
    }
    el.innerHTML = comments.map((c) => `
      <div class="ann-comment">
        <strong>${escapeHtml(c.user_name || 'Student')}</strong>
        <span>${escapeHtml(c.content)}</span>
      </div>
    `).join('');
  }

  function wireCards() {
    host.querySelectorAll('[data-action="toggle"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        if (state.expanded.has(id)) {
          state.expanded.delete(id);
        } else {
          state.expanded.add(id);
          notifyAnnouncementRead(id);
        }
        render();
      });
    });

    host.querySelectorAll('[data-action="dismiss"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        dismissLocally(groupId, id);
        state.announcements = state.announcements.filter((a) => a.id !== id);
        render();
      });
    });

    host.querySelectorAll('.ann-reaction-btn').forEach((btn) => {
      btn.addEventListener('click', () => toggleReaction(btn.dataset.announcementId, btn.dataset.emoji));
    });

    host.querySelectorAll('[data-action="comment"]').forEach((btn) => {
      btn.addEventListener('click', () => submitComment(btn.dataset.id));
    });
    host.querySelectorAll('.ann-comment-input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitComment(input.dataset.id);
      });
    });
  }

  async function toggleReaction(announcementId, emoji) {
    const reactions = state.reactionsByAnnouncement[announcementId] || [];
    const existing = reactions.find((r) => r.user_id === user.id);
    const isNewReaction = !existing;

    try {
      if (existing && existing.emoji === emoji) {
        await supabase.from('announcement_reactions').delete().eq('announcement_id', announcementId).eq('user_id', user.id);
      } else {
        await supabase.from('announcement_reactions').upsert(
          { announcement_id: announcementId, user_id: user.id, emoji },
          { onConflict: 'announcement_id,user_id' }
        );
      }
      const { data } = await supabase.from('announcement_reactions').select('announcement_id, user_id, emoji').eq('announcement_id', announcementId);
      state.reactionsByAnnouncement[announcementId] = data || [];
      render();

      if (isNewReaction) notifyAnnouncementActivity(announcementId, 'announcement_reaction', `Someone reacted ${emoji} to`);
    } catch (err) {
      console.error('Failed to react to announcement:', err);
      notify("Couldn't react to that announcement.", 'error');
    }
  }

  async function submitComment(announcementId) {
    const input = host.querySelector(`.ann-comment-input[data-id="${announcementId}"]`);
    const content = input?.value.trim();
    if (!content) return;

    const userName = user.user_metadata?.firstName || user.user_metadata?.full_name || 'Student';

    try {
      const { error } = await supabase.from('announcement_comments').insert({
        announcement_id: announcementId,
        user_id: user.id,
        user_name: userName,
        content
      });
      if (error) throw error;
      input.value = '';
      renderCommentsInto(announcementId);
      notifyAnnouncementActivity(announcementId, 'announcement_comment', 'Someone commented on');
    } catch (err) {
      console.error('Failed to post comment:', err);
      notify("Couldn't post that comment.", 'error');
    }
  }

  async function notifyAnnouncementActivity(announcementId, type, verbPhrase) {
    const a = state.announcements.find((x) => x.id === announcementId);
    if (!a || !a.created_by || a.created_by === user.id) return;
    try {
      await supabase.from('notifications').insert({
        user_id: a.created_by,
        sender_id: user.id,
        type,
        content: `${verbPhrase} "${a.title}"`,
        post_id: announcementId,
        origin: 'announcements'
      });
    } catch (err) {
      console.error(`Failed to notify ${type}:`, err);
    }
  }

  async function notifyAnnouncementRead(announcementId) {
    if (state.notifiedRead.has(announcementId)) return;
    state.notifiedRead.add(announcementId);
    const a = state.announcements.find((x) => x.id === announcementId);
    if (!a || !a.created_by || a.created_by === user.id) return;
    try {
      await supabase.from('notifications').insert({
        user_id: a.created_by,
        sender_id: user.id,
        type: 'announcement_read',
        content: `Someone read "${a.title}"`,
        post_id: announcementId,
        origin: 'announcements'
      });
    } catch (err) {
      console.error('Failed to notify announcement read:', err);
    }
  }

  await loadAnnouncements();
  await render();

  const channel = supabase
    .channel(`announcements-${groupId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `group_id=eq.${groupId}` }, async (payload) => {
      const previousIds = new Set(state.announcements.map((a) => a.id));
      await loadAnnouncements();
      const newIds = state.announcements.filter((a) => !previousIds.has(a.id)).map((a) => a.id);
      await render({ animateNewIds: newIds });
      if (payload.eventType === 'INSERT' && newIds.length) {
        notify('New announcement posted', 'info');
      }
    })
    .subscribe();

  // Scheduled announcements become visible purely by the clock, not by a row
  // change — poll periodically to pick those up without a page refresh.
  const pollHandle = setInterval(async () => {
    await loadAnnouncements();
    await render();
  }, 60000);

  window.addEventListener('beforeunload', () => {
    clearInterval(pollHandle);
    supabase.removeChannel(channel);
  });
}