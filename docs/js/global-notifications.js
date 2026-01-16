// Import Supabase client
import { supabase } from './supabaseClient.js';

// Global state
let globalCurrentUser = null;
let globalUserProfile = null;

// ============= NOTIFICATION HELPER FUNCTIONS =============
function playNotificationSound() {
    const prefs = globalUserProfile?.notification_preferences || {};
    if (prefs.sound === false) return;

    try {
        const audio = new Audio('/sounds/notification.mp3');
        audio.volume = 0.5;
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
function showToast(message, type = 'info', duration = 5000, onClick = null) {
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
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(0,0,0,0.1);
            padding: 16px; border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            color: #333;
            pointer-events: auto;
            animation: slideInToast 0.3s ease;
            display: flex; align-items: center; gap: 12px; min-width: 280px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .toast i { font-size: 1.2em; margin-right: 8px; }
        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
            .toast { background: rgba(30, 30, 30, 0.9); color: #fff; border-color: rgba(255,255,255,0.1); }
        }
        [data-theme="dark"] .toast, body.dark .toast {
            background: rgba(30, 30, 30, 0.9) !important; color: #fff !important; border-color: rgba(255,255,255,0.1) !important;
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
}

function setupGlobalRealtimeUpdates() {
    supabase
        .channel('global-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${globalCurrentUser.id}` },
            (payload) => {
                const newNotification = payload.new;

                // Play sound and show desktop notification based on preferences
                playNotificationSound();
                
                const typeLabel = newNotification.type.charAt(0).toUpperCase() + newNotification.type.slice(1);
                const message = newNotification.content || `New ${typeLabel}`;
                showDesktopNotification('Peerloom', {
                    body: message,
                    tag: `notification-${newNotification.id}`
                });

                // Show in-app toast
                let onClick = null;
                let toastType = 'info';

                if (newNotification.type === 'new_follower') {
                    onClick = () => window.location.href = `profile.html?userId=${newNotification.sender_id}`;
                    toastType = 'follow';
                } else if (newNotification.type === 'new_like') {
                    onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
                    toastType = 'like';
                } else if (newNotification.post_id) {
                    onClick = () => window.location.href = `feed.html?videoId=${newNotification.post_id}`;
                }
                
                showToast(message, toastType, 5000, onClick);
                
                // Optionally, dispatch a custom event that pages can listen to if they need to update their UI
                document.dispatchEvent(new CustomEvent('new-notification', { detail: newNotification }));
            }
        ).subscribe();
}

async function setupGroupMessagesSubscription() {
    if (!globalCurrentUser) return;

    // Fetch user groups to listen to
    const { data: members, error } = await supabase
        .from('group_members')
        .select('group_id, groups(name)')
        .eq('user_id', globalCurrentUser.id);

    if (error || !members || members.length === 0) return;

    const groupIds = members.map(m => m.group_id);
    const groupMap = {};
    members.forEach(m => { if (m.groups) groupMap[m.group_id] = m.groups.name; });

    const filterString = `group_id=in.(${groupIds.join(',')})`;

    supabase.channel('global-group-messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages', filter: filterString },
            (payload) => {
                const newMessage = payload.new;
                if (newMessage.sender_id === globalCurrentUser.id) return; // Don't notify own messages

                const groupName = groupMap[newMessage.group_id] || 'Group';
                const content = escapeHtml(newMessage.content.length > 50 ? newMessage.content.substring(0, 50) + '...' : newMessage.content);
                
                playNotificationSound();
                showToast(`New message in <strong>${groupName}</strong>: "${content}"`, 'message', 5000, () => {
                    window.location.href = `chatroom.html?groupId=${newMessage.group_id}`;
                });
            }
        ).subscribe();
}

// Initialize on script load
document.addEventListener('DOMContentLoaded', initializeGlobalNotifications);
