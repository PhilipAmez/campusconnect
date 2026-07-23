function renderNavbar(container, profile, onThemeToggle) {
  if (!container) return;

  const displayName = profile?.full_name || profile?.username || 'Lecturer';
  const institution = profile?.institution || 'Your institution';
  const department = profile?.department || 'Teaching & Learning';
  const today = new Date().toLocaleDateString('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });

  const verifiedBadge = profile?.verified
    ? '<i class="fa-solid fa-check verified-badge" title="Verified lecturer"></i>'
    : '';

  container.innerHTML = `
    <div class="topbar-left">
      <h2>Welcome back, ${displayName}${verifiedBadge}</h2>
      <p>${today} • ${institution} • ${department}</p>
    </div>
    <div class="topbar-actions">
      <button class="topbar-btn" id="notifBellBtn" aria-label="Notifications">
        <i class="fa-solid fa-bell"></i>
        <span class="notif-badge" id="notifBellBadge" hidden></span>
      </button>
      <a class="topbar-btn" href="./support.html" aria-label="Open support center"><i class="fa-solid fa-headset"></i></a>
      <button class="theme-toggle" aria-label="Toggle theme"><i class="fa-solid fa-moon"></i></button>
    </div>
  `;

  const themeToggle = container.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', onThemeToggle);
  }
}

export { renderNavbar };