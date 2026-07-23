import { supabase } from './js/supabaseClient.js';
import { renderSidebar } from './js/lecturer-sidebar.js';
import { renderNavbar } from './js/lecturer-navbar.js';
import { renderSectionContent } from './js/lecturer-overview.js';
import { performLogout } from './js/lecturer-logout.js';
import { initLecturerNotifications } from './js/lecturer-notifications.js';
import { initLanguage } from './js/i18n.js';

const contentArea = document.getElementById('contentArea');
const sidebar = document.getElementById('sidebar');
const topbar = document.getElementById('topbar');
const lecturerShell = document.getElementById('lecturerShell');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');

let activeSection = 'overview';
let currentProfile = null;
let darkMode = false;

function openSidebar() {
  lecturerShell?.classList.add('sidebar-open');
  hamburgerBtn?.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  lecturerShell?.classList.remove('sidebar-open');
  hamburgerBtn?.setAttribute('aria-expanded', 'false');
}

function toggleSidebar() {
  if (lecturerShell?.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

hamburgerBtn?.addEventListener('click', toggleSidebar);
sidebarBackdrop?.addEventListener('click', closeSidebar);

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

async function fetchProfile(userId) {
  return supabase
    .from('profiles')
    .select('id, full_name, username, institution, campus, custom_campus, department, role, level, custom_level, is_lecturer, verified, lecturer_badge')
    .eq('id', userId)
    .maybeSingle();
}

function isLecturerProfile(data) {
  return !!data && (
    data.is_lecturer === true ||
    data.role === 'lecturer' ||
    data.level === 'lecturer' ||
    data.custom_level === 'lecturer'
  );
}

function renderProfileLoadError(message) {
  document.body.innerHTML = `
    <div style="min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; font-family:Inter,'Segoe UI',sans-serif; background:linear-gradient(140deg,#f7f2ff 0%,#eef2ff 45%,#f8fbff 100%);">
      <div style="max-width:420px; text-align:center; background:rgba(255,255,255,0.9); border:1px solid rgba(255,255,255,0.6); border-radius:24px; padding:36px 28px; box-shadow:0 20px 60px rgba(15,23,42,0.12);">
        <div style="font-size:40px; margin-bottom:12px;">⚠️</div>
        <h2 style="margin:0 0 10px; color:#14213d;">Couldn't load your lecturer profile</h2>
        <p style="color:#5b6784; line-height:1.6; margin-bottom:22px;">${message}</p>
        <button id="profileRetryBtn" style="border:0; border-radius:999px; padding:12px 22px; background:linear-gradient(120deg,#7c3aed,#8b5cf6); color:#fff; font-weight:700; cursor:pointer;">
          Try again
        </button>
      </div>
    </div>`;
  document.getElementById('profileRetryBtn')?.addEventListener('click', () => window.location.reload());
}

async function loadProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    window.location.href = 'login.html';
    return;
  }

  let { data, error } = await fetchProfile(session.user.id);

  // A profile row may not exist yet for a split second right after signup
  // (created by a DB trigger). Give it one retry before treating it as
  // a real failure, rather than faking a lecturer profile that can write
  // nothing (every insert/update is blocked by RLS regardless of what
  // the UI shows).
  if ((!data || error) && !error?.message?.includes('permission')) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    ({ data, error } = await fetchProfile(session.user.id));
  }

  if (error) {
    console.error('Failed to load lecturer profile:', error);
    renderProfileLoadError('We hit an error reading your profile. This is usually temporary — please try again in a moment.');
    return;
  }

  if (!data) {
    renderProfileLoadError("We couldn't find a profile for your account yet. If you just signed up, wait a few seconds and retry. If this keeps happening, please contact support.");
    return;
  }

  if (!isLecturerProfile(data)) {
    window.location.href = 'dashboard.html';
    return;
  }

  currentProfile = data;

  // Always guarantee the profile carries the authenticated user's id, since
  // downstream features (course groups, quiz targeting) key off it directly.
  currentProfile.id = session.user.id;

  // The lecturer signup flow only ever populates 'campus'/'custom_campus',
  // not 'institution' — but every other module in the dashboard reads
  // profile.institution directly. Resolve it once here so nothing downstream
  // needs its own fallback chain (this also fixes quiz target-audience
  // group lookups and the institution stamped on newly created groups,
  // which were previously always null).
  currentProfile.institution = data.institution || data.campus || data.custom_campus || null;

  const savedTheme = localStorage.getItem('lecturer-theme');
  darkMode = savedTheme === 'dark';
  applyTheme();
  await initLanguage({ supabase, userId: currentProfile.id });
  render();
}

function render() {
  renderSidebar(sidebar, activeSection, (section) => {
    activeSection = section;
    render();
    closeSidebar();
  }, () => performLogout(currentProfile));

  renderNavbar(topbar, currentProfile, toggleTheme);
  initLecturerNotifications(currentProfile).catch((err) => console.error('Failed to init notifications:', err));
  renderSectionContent(contentArea, activeSection, currentProfile);
}

window.addEventListener('lecturer-section-change', (event) => {
  const nextSection = event.detail;
  if (nextSection) {
    activeSection = nextSection;
    render();
  }
});

window.addEventListener('lecturer-language-change', () => {
  render();
});

window.addEventListener('DOMContentLoaded', () => {
  loadProfile();
});