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

function applyTheme() {
  document.body.classList.toggle('dark', darkMode);
  const icon = document.querySelector('.theme-toggle i');
  if (icon) {
    icon.className = darkMode ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }
}

function toggleTheme() {
  darkMode = !darkMode;
  localStorage.setItem('lecturer-theme', darkMode ? 'dark' : 'light');
  applyTheme();
}

async function loadProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    window.location.href = 'login.html';
    return;
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, username, institution, department, role, level, custom_level, is_lecturer, verified, lecturer_badge')
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
      verified: false
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
  }, () => performLogout(currentProfile));

  renderNavbar(topbar, currentProfile, toggleTheme);
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