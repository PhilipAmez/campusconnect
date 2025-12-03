// Import Supabase client
import { supabase } from './supabaseClient.js';

// State
let userProfile = null;
let currentUser = null;
let currentTab = 'all';
let page = 1;
const NOTIFICATIONS_PER_PAGE = 15;

// DOM Elements
const notificationList = document.getElementById('notification-list');
const tabsContainer = document.getElementById('tabs');
const tabElements = document.querySelectorAll('.tab');
const pill = document.getElementById('pill');
const title = document.getElementById('title');
const settingsPanel = document.getElementById('settings-panel');

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        window.location.href = 'login.html';
        return;
    }
    currentUser = user;

    initializeTabs();
    await initializeSettings(); // Make this async to load settings
    initializeTheme();
    addEventListeners();

    await fetchNotifications(currentTab, true);
    setupRealtimeUpdates();
});

function addEventListeners() {
    document.getElementById('markAllReadBtn').addEventListener('click', markAllRead);
    document.getElementById('clearAllBtn').addEventListener('click', clearAll);
    document.getElementById('openSettingsBtn').addEventListener('click', openSettings);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
    document.getElementById('settings-panel').addEventListener('click', (e) => {
        if (e.target.id === 'settings-panel') closeSettings();
    });
    document.getElementById('loadMoreBtn').addEventListener('click', () => fetchNotifications(currentTab));
}

// --- Notification Logic ---

async function fetchNotifications(tab, reset = false) {
    if (reset) {
        page = 1;
        showSkeletonLoaders(); // Show loaders instead of clearing immediately
    }

    // Hide 'Load More' button during fetch
    document.getElementById('loadMoreBtn').style.display = 'none';

    const from = (page - 1) * NOTIFICATIONS_PER_PAGE;
    const to = from + NOTIFICATIONS_PER_PAGE - 1;

    let query = supabase
        .from('notifications')
        .select(`*, sender:sender_id(full_name, profile_photo), post_id, sender_id`) // Ensure we get post_id and sender_id
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .range(from, to);

    if (tab !== 'all') {
        query = query.eq('type', tab);
    }

    const { data, error } = await query;

    if (error) {
        console.error('Error fetching notifications:', error);
        // On error, clear the list and show an error message.
        notificationList.innerHTML = '<p>Error loading notifications.</p>';
        if (reset) notificationList.innerHTML = '<p>Error loading notifications.</p>';
        return;
    }

    if (reset) {
        notificationList.innerHTML = ''; // Clear the list (and skeletons) before rendering new data
    }

    if (data.length > 0) {
        renderNotifications(data);
        page++;
    } else if (reset) {
        // If it's a fresh load and no data was returned, show an empty state message.
        notificationList.innerHTML = '<p style="text-align: center; padding: 2rem; color: var(--text-secondary);">No notifications here.</p>';
    }

    document.getElementById('loadMoreBtn').style.display = data.length < NOTIFICATIONS_PER_PAGE ? 'none' : 'block';
}

function showSkeletonLoaders() {
    notificationList.innerHTML = ''; // Clear previous content
    for (let i = 0; i < 5; i++) { // Show 5 skeleton items
        const item = document.createElement('div');
        item.className = 'notification-item skeleton';
        item.innerHTML = `
            <div class="avatar"></div>
            <div class="content">
                <p></p>
                <div class="timestamp"></div>
            </div>
        `;
        notificationList.appendChild(item);
    }
}

function renderNotifications(data) {
    data.forEach(notif => {
        const item = document.createElement('div');
        item.className = `notification-item ${!notif.read ? 'unread' : ''}`;
        item.dataset.id = notif.id;

        const avatarUrl = notif.sender?.profile_photo || 'https://via.placeholder.com/48';
        const senderName = notif.sender?.full_name || 'System';

        item.innerHTML = `
            <img src="${avatarUrl}" alt="${senderName}" class="avatar">
            <div class="content">
                <p>${notif.content}</p>
                <div class="timestamp">${new Date(notif.created_at).toLocaleString()}</div>
            </div>
        `;
        item.onclick = () => handleNotificationClick(notif, item);
        notificationList.appendChild(item);
    });
}

async function handleNotificationClick(notif, element) {
    // First, mark the notification as read
    if (!notif.read) {
        await markRead(notif.id, element);
        notif.read = true; // Update local state
    }

    // Then, navigate based on the notification type
    switch (notif.type) {
        case 'new_follower':
            if (notif.sender_id) {
                window.location.href = `profile.html?userId=${notif.sender_id}`;
            }
            break;
        case 'new_like':
        case 'new_comment':
        case 'new_post':
            if (notif.post_id) {
                // Navigate to the feed, focused on the specific video
                window.location.href = `feed.html?videoId=${notif.post_id}`;
            }
            break;
        case 'new_group_message':
            if (notif.post_id) { // We use post_id to store the group_id for this type
                window.location.href = `chatroom.html?groupId=${notif.post_id}`;
            }
            break;
        default:
            console.log('Clicked notification with no defined action:', notif.type);
    }
}

async function markRead(id, element) {
    element.classList.remove('unread');
    await supabase.from('notifications').update({ read: true }).eq('id', id);
}

async function markAllRead() {
    document.querySelectorAll('.unread').forEach(el => el.classList.remove('unread'));
    await supabase.from('notifications').update({ read: true }).eq('user_id', currentUser.id).eq('read', false);
}

async function clearAll() {
    if (confirm('Are you sure you want to delete all notifications? This cannot be undone.')) {
        notificationList.innerHTML = '';
        await supabase.from('notifications').delete().eq('user_id', currentUser.id);
    }
}

function setupRealtimeUpdates() {
    supabase
        .channel(`public:notifications:user_id=eq.${currentUser.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${currentUser.id}` },
            (payload) => {
                // Only add if on 'all' tab or the matching tab
                if (currentTab === 'all' || currentTab === payload.new.type) {
                    fetchNotifications(currentTab, true); // Simple refresh for now
                }
            }
        ).subscribe();
}

// --- Settings Panel ---

function openSettings() {
    settingsPanel.style.display = 'flex';
    setTimeout(() => settingsPanel.classList.add('visible'), 10);
}

function closeSettings() {
    settingsPanel.classList.remove('visible');
    setTimeout(() => settingsPanel.style.display = 'none', 400);
}

async function initializeSettings() {
    // 1. Load user profile to get current settings
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('notification_preferences')
            .eq('id', currentUser.id)
            .single();

        if (error || !data) {
            // If there's an error or no profile data is returned, we'll catch it.
            // This can happen if the columns don't exist yet. We'll proceed with defaults.
            console.warn("Could not load notification preferences, proceeding with defaults. The 'notification_preferences' column might be missing.", error);
            userProfile = {}; // Use an empty object to prevent further errors
        } else {
            userProfile = data;
        }

        const prefs = userProfile?.notification_preferences || {};

        // 2. Set the toggles to match the saved preferences
        document.querySelectorAll('.settings-item input[type="checkbox"]').forEach(toggle => {
            const prefKey = toggle.dataset.pref;
            // If a preference isn't set, default to 'checked' for most, 'unchecked' for a few.
            const isEnabled = prefs[prefKey] ?? !['email', 'vibration', 'dnd'].includes(prefKey);
            toggle.checked = isEnabled;
        });

    } catch (error) {
        console.error("Critical error loading notification preferences:", error);
    }

    // 3. Add event listeners to save changes
    document.querySelectorAll('.settings-item input[type="checkbox"]').forEach(toggle => {
        toggle.addEventListener('change', () => {
            togglePref(toggle.dataset.pref, toggle.checked);
        });
    });
}
async function togglePref(type, enabled) {
    console.log(`Preference for '${type}' set to: ${enabled}`);

    // Ensure userProfile and its preferences object exist
    if (!userProfile) userProfile = {};
    if (!userProfile.notification_preferences) userProfile.notification_preferences = {};
    userProfile.notification_preferences[type] = enabled;

    const { error } = await supabase.from('profiles').update({ notification_preferences: userProfile.notification_preferences }).eq('id', currentUser.id);
    if (error) {
        console.error('Error saving preference:', error);
    }
}

// --- Theme Logic ---

function initializeTheme() {
    const savedTheme = localStorage.getItem('peerloom-theme') || 'light';
    document.body.classList.toggle('dark', savedTheme === 'dark');
    title.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            const touchStartX = e.touches[0].clientX;
            title.addEventListener('touchend', (e_end) => {
                const touchEndX = e_end.changedTouches[0].clientX;
                if (Math.abs(touchEndX - touchStartX) > 50) {
                    toggleTheme();
                }
            }, { once: true });
        }
    });
}

function toggleTheme() {
    document.body.classList.toggle('dark');
    localStorage.setItem('peerloom-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
}

// --- Interactive Tabs Logic ---

let tabPositions = [];
let isDragging = false;
let startX = 0;
let currentLeft = 0;

function initializeTabs() {
    updateTabPositions();
    window.addEventListener('resize', updateTabPositions);

    tabElements.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    tabsContainer.addEventListener('touchstart', (e) => {
        isDragging = true;
        startX = e.touches[0].clientX;
        const activeIndex = Array.from(tabElements).findIndex(t => t.dataset.tab === currentTab);
        currentLeft = tabPositions[activeIndex].left;
        pill.style.transition = 'none';
    });

    tabsContainer.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        const mx = e.touches[0].clientX - startX;
        const newLeft = currentLeft + mx;
        const clampedLeft = Math.max(0, Math.min(newLeft, tabPositions[tabPositions.length - 1].left));
        pill.style.left = `${clampedLeft}px`;
    });

    tabsContainer.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        isDragging = false;
        const mx = e.changedTouches[0].clientX - startX;
        const projectedCenter = tabPositions[Array.from(tabElements).findIndex(t => t.dataset.tab === currentTab)].center + mx;
        const closestIndex = findClosestTab(projectedCenter);
        switchTab(tabElements[closestIndex].dataset.tab);
    });

    // Ripple effect for buttons and tabs
    document.querySelectorAll('button, .tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');
            const rect = btn.getBoundingClientRect();
            ripple.style.left = `${e.clientX - rect.left}px`;
            ripple.style.top = `${e.clientY - rect.top}px`;
            btn.appendChild(ripple);
            setTimeout(() => ripple.remove(), 500);
        });
    });
}

function updateTabPositions() {
    const containerRect = tabsContainer.getBoundingClientRect();
    tabPositions = Array.from(tabElements).map(el => {
        const rect = el.getBoundingClientRect();
        return {
            left: rect.left - containerRect.left,
            width: rect.width,
            center: rect.left - containerRect.left + rect.width / 2
        };
    });
    const activeIndex = Array.from(tabElements).findIndex(t => t.dataset.tab === currentTab);
    if (activeIndex !== -1) {
        pill.style.left = `${tabPositions[activeIndex].left}px`;
        pill.style.width = `${tabPositions[activeIndex].width}px`;
    }
}

function findClosestTab(x) {
    let closestIndex = 0;
    let minDistance = Infinity;
    tabPositions.forEach((pos, index) => {
        const distance = Math.abs(x - pos.center);
        if (distance < minDistance) {
            minDistance = distance;
            closestIndex = index;
        }
    });
    return closestIndex;
}

function switchTab(tab) {
    currentTab = tab;
    tabElements.forEach(t => t.classList.remove('active'));
    const activeTabEl = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (activeTabEl) {
        activeTabEl.classList.add('active');
    }

    const index = Array.from(tabElements).findIndex(t => t.dataset.tab === tab);
    if (index !== -1) {
        animatePill(tabPositions[index].left, tabPositions[index].width);
    }

    fetchNotifications(tab, true);
}

function animatePill(toLeft, toWidth) {
    pill.style.transition = 'left var(--transition), width var(--transition)';
    pill.style.left = `${toLeft}px`;
    pill.style.width = `${toWidth}px`;
}
