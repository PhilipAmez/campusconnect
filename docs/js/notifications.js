// Import Supabase client
import { supabase } from './supabaseClient.js';

// DOM Elements
const notificationsList = document.getElementById('notificationsList');
const markAllReadBtn = document.getElementById('markAllReadBtn');
const filterButtons = document.querySelectorAll('.filter-btn');

// Video viewer elements
const videoViewerOverlay = document.getElementById('videoViewerOverlay');
const viewerVideo = document.getElementById('viewerVideo');
const closeViewerBtn = document.getElementById('closeViewerBtn');
const viewerPostTitle = document.getElementById('viewerPostTitle');
const viewerLikeBtn = document.getElementById('viewerLikeBtn');
const viewerLikeCount = document.getElementById('viewerLikeCount');
const viewerAuthorAvatar = document.getElementById('viewerAuthorAvatar');
const viewerAuthorName = document.getElementById('viewerAuthorName');

const userProfileHeader = document.getElementById('userProfileHeader');


// State
let currentUser = null;
let userProfile = null;
let allNotifications = [];
let currentFilter = 'all';

async function initializePage() {
    // Apply theme from localStorage
    const savedTheme = localStorage.getItem('peerloom-theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);

    try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            window.location.href = 'login.html';
            return;
        }
        currentUser = user;

        await loadUserProfile();
        await loadAllNotifications();
        setupEventListeners();
        setupRealtimeUpdates(); // Add this line to start listening for changes

    } catch (error) {
        console.error('Error initializing notifications page:', error);
        notificationsList.innerHTML = `<div class="empty-state"><p>Error loading notifications.</p></div>`;
    }
}

async function loadUserProfile() {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('full_name, profile_photo')
            .eq('id', currentUser.id)
            .single();

        if (error) throw error;
        userProfile = data;
        renderUserProfile();
    } catch (error) {
        console.error('Error loading user profile:', error);
    }
}

function renderUserProfile() {
    if (!userProfile || !userProfileHeader) return;

    const avatarHtml = userProfile.profile_photo
        ? `<img src="${userProfile.profile_photo}" alt="${userProfile.full_name}">`
        : `<span>${getInitials(userProfile.full_name)}</span>`;

    userProfileHeader.innerHTML = `<div class="user-avatar">${avatarHtml}</div> <div class="user-name">${userProfile.full_name}</div>`;
}

async function loadAllNotifications() {
    try {
        const { data, error } = await supabase
            .from('notifications')
            .select(`*,
                sender:sender_id(full_name, username, profile_photo),
                post:post_id(id, content)
            `)
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        allNotifications = data || [];
        renderNotifications();

    } catch (error) {
        console.error('Error loading notifications:', error);
        notificationsList.innerHTML = `<div class="empty-state"><p>Could not fetch notifications.</p></div>`;
    }
}

function renderNotifications() {
    notificationsList.innerHTML = '';

    const filteredNotifications = allNotifications.filter(n => {
        if (currentFilter === 'all') return true;
        if (currentFilter === 'unread') return !n.read;
        if (currentFilter === 'follows') return n.type === 'new_follower';
        if (currentFilter === 'likes') return n.type === 'new_like';
        return true;
    });

    if (filteredNotifications.length === 0) {
        notificationsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-bell-slash"></i>
                <p>No notifications here.</p>
            </div>
        `;
        return;
    }

    filteredNotifications.forEach(notification => {
        const item = document.createElement('div');
        item.className = `notification-item ${notification.read ? '' : 'unread'}`;
        item.dataset.notificationId = notification.id;

        const timeAgo = getTimeAgo(new Date(notification.created_at));
        const sender = notification.sender;
        const senderName = sender?.full_name || 'System';
        const avatarHtml = sender?.profile_photo
            ? `<img src="${sender.profile_photo}" alt="${senderName}">`
            : `<span>${getInitials(senderName)}</span>`;

        let message = notification.content;
        if (notification.type === 'new_follower') message = 'started following you.';
        if (notification.type === 'new_like') message = 'liked your post.';
        if (notification.type === 'new_comment') message = 'commented on your post.';
        if (notification.type === 'new_group_message') message = 'New message in your group.';

        item.innerHTML = `
            <div class="notification-avatar">${avatarHtml}</div>
            <div class="notification-body">
                <div class="notification-header">
                    <div class="notification-sender">
                        <a href="profile.html?userId=${notification.sender_id}" style="color: var(--primary); text-decoration: none; font-weight: 600;">${senderName}</a>
                    </div>
                    <div class="notification-time">${timeAgo}</div>
                </div>
                <div class="notification-message">${message}</div>
            </div>
        `;

        item.addEventListener('click', () => handleNotificationClick(notification));
        notificationsList.appendChild(item);
    });
}

async function handleNotificationClick(notification) {
    // Mark as read if unread
    if (!notification.read) {
        const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notification.id);
        if (!error) {
            notification.read = true;
            renderNotifications(); // Re-render to update style
        }
    }

    // Navigate or show content
    switch (notification.type) {
        case 'new_follower':
            if (notification.sender_id) {
                window.location.href = `profile.html?userId=${notification.sender_id}`;
            }
            break;
        case 'new_like':
        case 'new_comment':
        case 'new_post':
            if (notification.post_id) {
                const { data: post, error } = await supabase.from('posts').select('*, profiles:user_id(*)').eq('id', notification.post_id).single();
                if (post) openVideoViewer(post);
            }
            break;
        case 'new_group_message':
            // The group_id is stored in the post_id column for this notification type
            if (notification.post_id) {
                window.location.href = `chatroom.html?groupId=${notification.post_id}`;
            }
            break;
        default:
            console.log('Clicked notification with no defined action:', notification.type);
    }
}

function setupEventListeners() {
    markAllReadBtn.addEventListener('click', async () => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ read: true })
                .eq('user_id', currentUser.id)
                .eq('read', false);

            if (error) throw error;

            allNotifications.forEach(n => n.read = true);
            renderNotifications();
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    });

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            currentFilter = button.dataset.filter;
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            renderNotifications();
        });
    });

    // Video viewer listeners
    closeViewerBtn.addEventListener('click', closeVideoViewer);
    videoViewerOverlay.addEventListener('click', (e) => {
        if (e.target === videoViewerOverlay) closeVideoViewer();
    });
}

// --- Real-time Updates ---

function setupRealtimeUpdates() {
    const channel = supabase
        .channel(`public:notifications:user_id=eq.${currentUser.id}`)
        .on(
            'postgres_changes',
            {
                event: '*', // Listen for INSERT, UPDATE, DELETE
                schema: 'public',
                table: 'notifications',
                filter: `user_id=eq.${currentUser.id}`
            },
            async (payload) => {
                console.log('Real-time notification change received:', payload);

                if (payload.eventType === 'INSERT') {
                    // Fetch the full new notification with sender/post details
                    const { data: newNotification, error } = await supabase
                        .from('notifications')
                        .select(`*, sender:sender_id(full_name, username, profile_photo), post:post_id(id, content)`)
                        .eq('id', payload.new.id)
                        .single();

                    if (newNotification && !error) {
                        // Add to the top of the list and re-render
                        allNotifications.unshift(newNotification);
                        renderNotifications();
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const updatedNotification = payload.new;
                    const index = allNotifications.findIndex(n => n.id === updatedNotification.id);
                    if (index > -1) {
                        // Merge the changes into the existing notification object
                        allNotifications[index] = { ...allNotifications[index], ...updatedNotification };
                        renderNotifications();
                    }
                } else if (payload.eventType === 'DELETE') {
                    const deletedNotificationId = payload.old.id;
                    allNotifications = allNotifications.filter(n => n.id !== deletedNotificationId);
                    renderNotifications();
                }
            }
        )
        .subscribe();
}

// --- Helper & UI Functions (copied from profile.js) ---

function openVideoViewer(post) {
    if (!post || !post.media_url) return;

    viewerVideo.src = post.media_url;
    viewerVideo.play().catch(e => console.log("Autoplay prevented."));

    const author = post.profiles;
    if (author) {
        viewerAuthorName.textContent = author.full_name;
        viewerAuthorAvatar.innerHTML = author.profile_photo
            ? `<img src="${author.profile_photo}" alt="${author.full_name}">`
            : `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-weight:bold; background-color: var(--primary); color: white;">${getInitials(author.full_name)}</div>`;
    }

    viewerPostTitle.textContent = post.title || 'Untitled Post';
    viewerLikeCount.textContent = post.likes_count || 0;
    // Note: Like button state/functionality would require more logic here

    videoViewerOverlay.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeVideoViewer() {
    videoViewerOverlay.classList.remove('active');
    viewerVideo.pause();
    viewerVideo.src = "";
    document.body.style.overflow = '';
}

function getInitials(fullName) {
    if (!fullName) return 'U';
    return fullName.split(' ').map(name => name[0]).join('').toUpperCase();
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m ago";
    return Math.floor(seconds) + "s ago";
}

// Initialize the page
initializePage();
