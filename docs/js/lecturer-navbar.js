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
    ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified lecturer"></i>'
    : '';

  container.innerHTML = `
    <div class="topbar-left">
      <h2>Welcome back, ${displayName}${verifiedBadge}</h2>
      <p>${today} • ${institution} • ${department}</p>
    </div>
    <div class="topbar-actions">
      <button class="topbar-btn" aria-label="Open support center"><i class="fa-solid fa-headset"></i></button>
      <button class="theme-toggle" aria-label="Toggle theme"><i class="fa-solid fa-moon"></i></button>
    </div>
  `;

  const themeToggle = container.querySelector('.theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', onThemeToggle);
  }
}

export { renderNavbar };