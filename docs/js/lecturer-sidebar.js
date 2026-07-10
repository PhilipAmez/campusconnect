const lecturerSections = [
  { id: 'overview', label: 'Dashboard', icon: 'fa-grid-2' },
  { id: 'groups', label: 'My Course Groups', icon: 'fa-users' },
  { id: 'quiz-builder', label: 'Quiz Builder', icon: 'fa-wand-magic-sparkles' },
  { id: 'published-quizzes', label: 'Published Quizzes', icon: 'fa-square-check' },
  { id: 'draft-quizzes', label: 'Draft Quizzes', icon: 'fa-file-lines' },
  { id: 'results', label: 'Results', icon: 'fa-chart-line' },
  { id: 'integrity', label: 'Integrity Logs', icon: 'fa-shield-halved' },
  { id: 'resources', label: 'Resources', icon: 'fa-folder-open' },
  { id: 'announcements', label: 'Announcements', icon: 'fa-bullhorn' },
  { id: 'settings', label: 'Settings', icon: 'fa-sliders' }
];

function renderSidebar(container, activeSection, onSelect, onLogout) {
  if (!container) return;

  container.setAttribute('role', 'navigation');
  container.setAttribute('aria-label', 'Lecturer dashboard navigation');

  container.innerHTML = `
    <div class="brand-block">
      <h1><i class="fa-solid fa-graduation-cap" aria-hidden="true"></i> Lecturer Studio</h1>
      <p>Academic operations, thoughtfully orchestrated.</p>
    </div>
    <nav class="nav-list">
      ${lecturerSections.map((section) => `
        <button
          class="nav-item ${activeSection === section.id ? 'active' : ''}"
          data-section="${section.id}"
          aria-current="${activeSection === section.id ? 'page' : 'false'}"
        >
          <i class="fa-solid ${section.icon}" aria-hidden="true"></i>
          <span>${section.label}</span>
        </button>
      `).join('')}
      <div class="nav-divider" role="separator"></div>
      <button class="nav-item logout-item" data-action="logout" aria-label="Log out of lecturer dashboard">
        <i class="fa-solid fa-arrow-right-from-bracket" aria-hidden="true"></i>
        <span>Log out</span>
      </button>
    </nav>
  `;

  container.querySelectorAll('.nav-item[data-section]').forEach((button) => {
    button.addEventListener('click', () => onSelect(button.dataset.section));
  });

  const logoutButton = container.querySelector('[data-action="logout"]');
  if (logoutButton && typeof onLogout === 'function') {
    logoutButton.addEventListener('click', onLogout);
  }
}

export { lecturerSections, renderSidebar };