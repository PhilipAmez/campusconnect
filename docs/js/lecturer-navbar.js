function renderNavbar(container, profile, onThemeToggle, onMenuToggle) {
  if (!container) return;

  const displayName = profile?.full_name || profile?.username || 'Lecturer';
  const institution = (profile?.institution || profile?.campus || profile?.custom_campus || 'Your institution').trim();
  const department = profile?.department || 'Teaching & Learning';
  const today = new Date().toLocaleDateString('en', {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  });

  const verifiedBadge = profile?.verified
    ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified lecturer" aria-label="Verified lecturer"></i>'
    : '';

  const lecturerBadge = profile?.lecturer_badge
    ? '<span class="lecturer-badge" role="img" title="Premium lecturer" aria-label="Premium lecturer badge"><i class="fa-solid fa-check"></i></span>'
    : '';

  container.innerHTML = `
    <div class="topbar-left">
      <button class="hamburger-btn" type="button" data-action="toggle-menu" aria-label="Open navigation menu" aria-expanded="false" aria-controls="sidebar">
        <i class="fa-solid fa-bars" aria-hidden="true"></i>
      </button>
      <div>
        <h2><span class="name-with-badges">Welcome back, ${displayName}${verifiedBadge}${lecturerBadge}</span></h2>
        <p>${today} • ${institution} • ${department}</p>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="topbar-btn" aria-label="Open support center"><i class="fa-solid fa-headset" aria-hidden="true"></i></button>
      <button class="theme-toggle" aria-label="Toggle dark mode" aria-pressed="false"><i class="fa-solid fa-moon" aria-hidden="true"></i></button>
    </div>
  `;

  const themeToggle = container.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', onThemeToggle);
  }

  const menuToggle = container.querySelector('[data-action="toggle-menu"]');
  if (menuToggle && typeof onMenuToggle === 'function') {
    menuToggle.addEventListener('click', onMenuToggle);
  }
}

export { renderNavbar };