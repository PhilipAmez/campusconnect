// Import Supabase client
import { supabase } from './supabaseClient.js';

// Global state
let globalCurrentUser = null;
let globalUserProfile = null;
let lastSeenNotificationAt = null;
let realtimeConfirmedWorking = false;

// ============= NOTIFICATION HELPER FUNCTIONS =============
// Which file plays for which kind of notification — matched by name to what
// each is for, same approach as the Command Centre's sound manager.
const NOTIFICATION_SOUNDS = {
    message: '/sounds/new-message.mp3',   // a new chat message in one of your groups
    post: '/sounds/new-post.mp3',         // someone you follow / your group posted
    quiz: '/sounds/quiz-alert.mp3',       // new quiz published, deadline reminder, quiz graded
    default: '/sounds/notification.mp3',  // likes, follows, comments, anything else
};
const soundPlayers = {};
// Tracks whichever notification sound is currently mid-playback so a second
// notification of a different kind (e.g. a quiz alert arriving while a
// message chime is still playing) stops the first instead of overlapping it.
// Without this, bursts of notifications turned into a wall of overlapping
// audio that didn't match what was actually newest on screen.
let currentlyPlayingAudio = null;

function playNotificationSound(kind = 'default') {
    const prefs = globalUserProfile?.notification_preferences || {};
    if (prefs.sound === false) return;

    const src = NOTIFICATION_SOUNDS[kind] || NOTIFICATION_SOUNDS.default;
    try {
        if (!soundPlayers[src]) {
            soundPlayers[src] = new Audio(src);
            soundPlayers[src].volume = 0.5;
        }
        const audio = soundPlayers[src];

        if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
            currentlyPlayingAudio.pause();
            currentlyPlayingAudio.currentTime = 0;
        }
        currentlyPlayingAudio = audio;

        audio.currentTime = 0;
        audio.play().catch(error => console.log('Could not play notification sound:', error));
    } catch (error) {
        console.log('Notification sound error:', error);
    }
}

function showDesktopNotification(title, options = {}) {
    const prefs = globalUserProfile?.notification_preferences || {};
    if (prefs.push === false) return;

    if ('Notification' in window) {
        if (Notification.permission === 'granted') {
            new Notification(title, {
                icon: '/android-chrome-192x192.png',
                badge: '/android-chrome-192x192.png',
                ...options
            });
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(title, {
                        icon: '/android-chrome-192x192.png',
                        badge: '/android-chrome-192x192.png',
                        ...options
                    });
                }
            });
        }
    }
}

// Show in-app toast notification
function showToast(message, type = 'info', duration = 5000, onClick = null, soundKind = 'default') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Icon selection
    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-circle';
    if (type === 'message') iconClass = 'fa-comment-dots';
    if (type === 'like') iconClass = 'fa-heart';
    if (type === 'follow') iconClass = 'fa-user-plus';

    toast.innerHTML = `
        <i class="fas ${iconClass}"></i>
        <div style="flex:1; font-size: 0.9rem;">${message}</div>
    `;

    if (onClick) {
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', () => {
            onClick();
            toast.remove();
        });
    }

    // Play sound whenever a toast is displayed
    playNotificationSound(soundKind);

    container.appendChild(toast);

    // Remove after duration
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (s) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s];
    });
}

// Inject Toast UI if missing (for pages that don't have it manually added)
function ensureToastUI() {
    if (document.getElementById('toast-container')) return;

    // Create Container
    const container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);

    // Inject Styles
    const style = document.createElement('style');
    style.textContent = `
        .toast-container {
            position: fixed; top: 20px; right: 20px; z-index: 9999;
            pointer-events: none; display: flex; flex-direction: column; gap: 10px;
        }
        .toast {
            background: var(--glass-gradient, var(--glass-bg, rgba(255, 255, 255, 0.9)));
            backdrop-filter: blur(var(--blur, 10px));
            -webkit-backdrop-filter: blur(var(--blur, 10px));
            border: 1px solid var(--border, rgba(0,0,0,0.1));
            padding: 16px; border-radius: 12px;
            box-shadow: var(--shadow, 0 4px 20px rgba(0,0,0,0.15));
            color: var(--text-primary, var(--text, #333));
            pointer-events: auto;
            animation: slideInToast 0.3s ease;
            display: flex; align-items: center; gap: 12px; min-width: 280px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .toast i { font-size: 1.2em; margin-right: 8px; color: var(--accent, #3498db); }
        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .toast { background: var(--glass-gradient, var(--glass-bg, rgba(30, 30, 30, 0.9))); color: var(--text-primary, var(--text, #fff)); border-color: var(--border, rgba(255,255,255,0.1)); }
        }
        [data-theme="dark"] .toast, body.dark .toast {
            background: var(--glass-gradient, var(--glass-bg, rgba(30, 30, 30, 0.9))) !important; 
            color: var(--text-primary, var(--text, #fff)) !important; 
            border-color: var(--border, rgba(255,255,255,0.1)) !important;
        }
        @keyframes slideInToast {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);
}

async function initializeGlobalNotifications() {
    ensureToastUI();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        // Not logged in, no need to listen for notifications
        return;
    }
    globalCurrentUser = user;

    // Fetch user profile to get notification preferences
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('notification_preferences')
        .eq('id', globalCurrentUser.id)
        .single();

    if (profileError) {
        console.error('Error fetching global notification preferences:', profileError);
    } else {
        globalUserProfile = profile;
    }

    setupGlobalRealtimeUpdates();
    setupGroupMessagesSubscription();
    startNotificationPolling();
}

// Shared by both delivery paths (realtime push AND the polling fallback
// below), so a notification is presented identically no matter which one
// actually catches it first — and shownNotificationIds means if BOTH catch
// the same row (e.g. realtime fires right as a poll was already in flight),
// it's still only ever shown once.
const shownNotificationIds = new Set();
function presentNotification(newNotification) {
    if (shownNotificationIds.has(newNotification.id)) return;
    shownNotificationIds.add(newNotification.id);
    if (shownNotificationIds.size > 500) {
        // Simple cap so this doesn't grow forever across a long session.
        const first = shownNotificationIds.values().next().value;
        shownNotificationIds.delete(first);
    }

    const typeLabel = newNotification.type.charAt(0).toUpperCase() + newNotification.type.slice(1);
    const message = newNotification.content || `New ${typeLabel}`;
    showDesktopNotification('Peerloom', {
        body: message,
        tag: `notification-${newNotification.id}`
    });

    let onClick = null;
    let toastType = 'info';
    let soundKind = 'default';

    switch (newNotification.type) {
        case 'new_follower':
            onClick = () => window.location.href = `profile.html?userId=${newNotification.sender_id}`;
            toastType = 'follow';
            break;
        case 'new_like':
            onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
            toastType = 'like';
            break;
        case 'new_comment':
            onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
            toastType = 'message';
            break;
        case 'new_post':
            onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
            toastType = 'info';
            soundKind = 'post';
            break;
        case 'new_quiz':
        case 'quiz_deadline_reminder':
        case 'quiz_completed':
            // These previously fell through to the default case below, which
            // sends clicks to feed.html?videoId=... — the wrong page
            // entirely for a quiz notification.
            onClick = () => window.location.href = 'active-groups.html';
            toastType = 'info';
            soundKind = 'quiz';
            break;
        case 'lecturer_free_year_ending':
        case 'lecturer_free_year_expired':
            // PeerLoom membership (spec item #8): the 30-day/7-day reminder
            // and the expiry notice both point to the lecturer membership
            // page, where the exact remaining time and plan options live.
            onClick = () => window.location.href = 'lecturer-membership.html';
            toastType = newNotification.type === 'lecturer_free_year_expired' ? 'error' : 'info';
            break;
        case 'account_warning':
        case 'group_warning':
        case 'group_suspended':
        case 'group_reinstated':
        case 'content_warning':
        case 'content_removed':
            // Moderation notices get their own persistent banner (see
            // js/moderation-banner.js) in addition to this one-off toast —
            // the toast is for "something just happened right now", the
            // banner is for "you are currently in this state".
            onClick = () => window.location.href = 'notifications.html';
            toastType = 'error';
            break;
        default:
            if (newNotification.post_id) {
                onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
            }
    }

    showToast(message, toastType, 5000, onClick, soundKind);
    document.dispatchEvent(new CustomEvent('new-notification', { detail: newNotification }));
}

function setupGlobalRealtimeUpdates() {
    supabase
        .channel('global-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${globalCurrentUser.id}` },
            (payload) => {
                realtimeConfirmedWorking = true;
                presentNotification(payload.new);
            }
        ).subscribe();
}

// Resilience layer: if Realtime isn't enabled for the `notifications` table
// in this Supabase project (a project setting, separate from any frontend
// code — see supabase/realtime-diagnostic.sql), the subscription above
// silently never fires and nothing else would ever tell you. This polls for
// anything newer than the last notification seen, on every authenticated
// page, so delivery works either way. Deliberately not fast (would be wasted
// load once realtime IS confirmed working) — just a safety net, not the
// primary path.
// Persisted per-user, not just an in-memory variable: this is a multi-page
// app (full navigations, not an SPA), so an in-memory watermark reset to
// null on every single page load. That reset itself was harmless by design
// — the "first run" branch below only ever sets the watermark, never
// presents anything — but it was built by re-calling .order()/.limit() on
// a query object that had ALREADY had .order()/.limit() called on it for a
// different purpose a few lines above. Reusing a partially-built query
// object like that is exactly the kind of thing that can silently return
// the wrong rows depending on how the client library merges repeated
// calls — which is almost certainly why old notifications were firing as
// "new": the watermark was very likely being set from the OLDEST row
// instead of the newest, so the very next poll saw dozens of "new" rows
// that were actually ancient. Fixed below by never reusing a query object
// across two different purposes — each path builds its own, fresh.
function watermarkStorageKey(userId) {
    return `peerloom_last_seen_notification_${userId}`;
}

async function pollForNewNotifications() {
    if (!globalCurrentUser) return;

    if (lastSeenNotificationAt === null) {
        const stored = localStorage.getItem(watermarkStorageKey(globalCurrentUser.id));
        if (stored) lastSeenNotificationAt = stored;
    }

    try {
        if (!lastSeenNotificationAt) {
            // First time this user has ever been seen on this device: find
            // the single most recent existing notification (a completely
            // separate, freshly-built query — nothing shared with the one
            // below) and treat that as "already seen", so nothing in their
            // existing history gets presented as if it just happened.
            const { data, error } = await supabase
                .from('notifications')
                .select('created_at')
                .eq('user_id', globalCurrentUser.id)
                .order('created_at', { ascending: false })
                .limit(1);
            if (error) { console.warn('Notification polling (establishing watermark) failed:', error.message); return; }
            lastSeenNotificationAt = data?.[0]?.created_at || new Date().toISOString();
            localStorage.setItem(watermarkStorageKey(globalCurrentUser.id), lastSeenNotificationAt);
            return;
        }

        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', globalCurrentUser.id)
            .gt('created_at', lastSeenNotificationAt)
            .order('created_at', { ascending: true })
            .limit(25);
        if (error) { console.warn('Notification polling failed:', error.message); return; }

        (data || []).forEach(row => {
            presentNotification(row);
            lastSeenNotificationAt = row.created_at;
        });
        if ((data || []).length) {
            localStorage.setItem(watermarkStorageKey(globalCurrentUser.id), lastSeenNotificationAt);
        }
    } catch (err) {
        console.warn('Notification polling error:', err);
    }
}

function startNotificationPolling() {
    pollForNewNotifications();
    setInterval(pollForNewNotifications, 20000);
}

async function setupGroupMessagesSubscription() {
    if (!globalCurrentUser) return;

    // Fetch user groups to listen to. Two flat queries, not an embedded
    // `groups(name)` relationship select: that syntax was failing with a
    // 400 (PostgREST couldn't resolve the group_members -> groups
    // relationship), which silently meant this subscription always treated
    // the user as being in zero groups — every incoming message toast was
    // being filtered out before it ever had a chance to show. This was
    // masked on feed.html by a separate patch that intercepted the failing
    // network request and faked an empty success response instead of
    // fixing the query (removed — a fake 200 for a real 400 is worse than
    // the error, since it hides that anything is wrong at all).
    const { data: members, error } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', globalCurrentUser.id);

    if (error || !members || members.length === 0) {
        if (error) console.warn('Could not load your groups for message notifications:', error.message);
        return;
    }

    const groupIds = members.map(m => m.group_id);
    const groupMap = {};
    const { data: groupRows, error: groupsError } = await supabase
        .from('groups')
        .select('id, name')
        .in('id', groupIds);
    if (groupsError) {
        console.warn('Could not load group names for message notifications:', groupsError.message);
    } else {
        (groupRows || []).forEach(g => { groupMap[g.id] = g.name; });
    }

    supabase.channel('global-group-messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' },
            (payload) => {
                console.log('🔔 Notification Payload:', payload);
                const newMessage = payload.new;
                
                if (!groupIds.includes(newMessage.group_id)) {
                    console.log('❌ Message ignored: Group ID not in user groups', newMessage.group_id, groupIds);
                    return;
                }
                if (newMessage.sender_id === globalCurrentUser.id) {
                    console.log('❌ Message ignored: Sender is current user');
                    return;
                }
                // chatroom.html already renders the message directly (its own
                // realtime channel for the open group) and plays its own
                // sound for it — a toast here too would be a redundant
                // second notification, right on top of the message itself.
                const isViewingThisGroupInChat = location.pathname.endsWith('chatroom.html') &&
                    new URLSearchParams(location.search).get('groupId') === newMessage.group_id;
                if (isViewingThisGroupInChat) return;

                const groupName = groupMap[newMessage.group_id] || 'Group';
                const content = escapeHtml(newMessage.content.length > 50 ? newMessage.content.substring(0, 50) + '...' : newMessage.content);
                
                showToast(`New message in <strong>${escapeHtml(groupName)}</strong>: "${content}"`, 'message', 5000, () => {
                    window.location.href = `chatroom.html?groupId=${newMessage.group_id}`;
                }, 'message');
            }
        ).subscribe((status) => {
            console.log('📡 Notification Subscription Status:', status);
        });
}

// Initialize on script load
document.addEventListener('DOMContentLoaded', initializeGlobalNotifications);