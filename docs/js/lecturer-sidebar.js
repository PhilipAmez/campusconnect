import { t } from './i18n.js';

function getLecturerSections() {
  return [
    { id: 'overview', label: t('sidebar_dashboard'), icon: 'fa-grid-2' },
    { id: 'groups', label: t('sidebar_course_groups'), icon: 'fa-users' },
    { id: 'quiz-builder', label: t('sidebar_quiz_builder'), icon: 'fa-wand-magic-sparkles' },
    { id: 'published-quizzes', label: t('sidebar_published_quizzes'), icon: 'fa-square-check' },
    { id: 'draft-quizzes', label: t('sidebar_draft_quizzes'), icon: 'fa-file-lines' },
    { id: 'submissions', label: t('sidebar_submissions'), icon: 'fa-inbox' },
    { id: 'results', label: t('sidebar_results'), icon: 'fa-chart-line' },
    { id: 'integrity', label: t('sidebar_integrity_logs'), icon: 'fa-shield-halved' },
    { id: 'resources', label: t('sidebar_resources'), icon: 'fa-folder-open' },
    { id: 'announcements', label: t('sidebar_announcements'), icon: 'fa-bullhorn' },
    { id: 'settings', label: t('sidebar_settings'), icon: 'fa-sliders' }
  ];
}

function renderSidebar(container, activeSection, onSelect, onLogout) {
  if (!container) return;

  const lecturerSections = getLecturerSections();

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
        <span>${t('sidebar_logout')}</span>
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

export { renderSidebar };