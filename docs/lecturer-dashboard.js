import { supabase } from './js/supabaseClient.js';
import { renderSidebar } from './js/lecturer-sidebar.js';
import { renderNavbar } from './js/lecturer-navbar.js';
import { renderSectionContent } from './js/lecturer-overview.js';
import { performLogout } from './js/lecturer-logout.js';

const contentArea = document.getElementById('contentArea');
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');

let activeSection = 'overview';
let currentProfile = null;
let darkMode = false;
let mobileMenuOpen = false;

let sidebarBackdrop = document.querySelector('.sidebar-backdrop');
if (!sidebarBackdrop) {
  sidebarBackdrop = document.createElement('div');
  sidebarBackdrop.className = 'sidebar-backdrop';
  // IMPORTANT: appended inside .lecturer-shell (not document.body). The shell
  // has `backdrop-filter`, which creates its own stacking context — a fixed,
  // z-indexed sibling appended to <body> would always paint above that whole
  // context regardless of z-index, which hid the sidebar behind the backdrop.
  const shell = document.querySelector('.lecturer-shell');
  (shell || document.body).appendChild(sidebarBackdrop);
}

function applyTheme() {
  document.body.classList.toggle('dark', darkMode);
  const icon = document.querySelector('.theme-toggle i');
  const themeToggle = document.querySelector('.theme-toggle');
  if (icon) {
    icon.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
  if (themeToggle) {
    themeToggle.setAttribute('aria-pressed', darkMode ? 'true' : 'false');
  }
}

function toggleTheme() {
  darkMode = !darkMode;
  localStorage.setItem('lecturer-theme', darkMode ? 'dark' : 'light');
  applyTheme();
}

function setMobileMenu(open) {
  mobileMenuOpen = open;
  sidebar.classList.toggle('open', open);
  sidebarBackdrop.classList.toggle('visible', open);
  document.body.classList.toggle('menu-locked', open);

  const menuToggle = document.querySelector('[data-action="toggle-menu"]');
  if (menuToggle) {
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    menuToggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
  }
}

function toggleMobileMenu() {
  setMobileMenu(!mobileMenuOpen);
}

sidebarBackdrop.addEventListener('click', () => setMobileMenu(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mobileMenuOpen) {
    setMobileMenu(false);
  }
});

window.addEventListener('resize', () => {
  if (window.innerWidth > 980 && mobileMenuOpen) {
    setMobileMenu(false);
  }
});

async function loadProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    window.location.href = 'login.html';
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, institution, department, role, level, custom_level, is_lecturer, verified, lecturer_badge, bio, contact, profile_photo, notification_preferences, theme_preference, privacy, phone, campus, custom_campus')
    .eq('id', session.user.id)
    .maybeSingle();

  if (!error && data) {
    currentProfile = data;
    const isLecturer = data.is_lecturer === true || data.role === 'lecturer' || data.level === 'lecturer' || data.custom_level === 'lecturer';
    if (!isLecturer) {
      window.location.href = 'dashboard.html';
      return;
    }
  } else {
    currentProfile = {
      full_name: session.user.user_metadata?.full_name || session.user.email || 'Lecturer',
      username: session.user.user_metadata?.user_name || 'lecturer',
      institution: 'Your institution',
      department: 'Teaching & Learning',
      role: 'lecturer',
      verified: false,
      lecturer_badge: false
    };
  }

  // Always guarantee the profile carries the authenticated user's id, since
  // downstream features (course groups, quiz targeting) key off it directly.
  currentProfile.id = session.user.id;

  const savedTheme = localStorage.getItem('lecturer-theme');
  darkMode = savedTheme === 'dark';
  applyTheme();
  render();
}

function render() {
  renderSidebar(sidebar, activeSection, (section) => {
    activeSection = section;
    render();
    if (window.innerWidth <= 980) {
      setMobileMenu(false);
    }
  }, () => performLogout(currentProfile));

  renderNavbar(topbar, currentProfile, toggleTheme, toggleMobileMenu);
  renderSectionContent(contentArea, activeSection, currentProfile);
}

window.addEventListener('lecturer-section-change', (event) => {
  const nextSection = event.detail;
  if (nextSection) {
    activeSection = nextSection;
    render();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  loadProfile();
});