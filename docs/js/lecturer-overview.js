import { renderQuizExperience } from './lecturer-quizzes.js';
import { renderGroupsSection } from './lecturer-groups.js';

function formatDateLabel(date) {
  return new Date(date).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric'
  });
}

function renderOverview(profile) {
  const name = profile?.full_name || profile?.username || 'Lecturer';
  const institution = profile?.institution || 'Your institution';
  const department = profile?.department || 'Teaching & Learning';
  const verifiedBadge = profile?.verified
    ? '<i class="fa-solid fa-circle-check verified-badge" title="Verified lecturer"></i>'
    : '';

  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sparkles"></i> Faculty workspace</div>
        <h3>Welcome back, ${name}${verifiedBadge}</h3>
        <p>Your teaching, pacing, and student feedback are orchestrated here with a calm, focused view of every important signal.</p>
        <div class="hero-meta">
          <span class="meta-chip"><i class="fa-regular fa-calendar"></i> Today • ${new Date().toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
          <span class="meta-chip"><i class="fa-solid fa-building-columns"></i> ${institution}</span>
          <span class="meta-chip"><i class="fa-solid fa-book-open"></i> ${department}</span>
        </div>
        <div class="hero-actions">
          <button class="primary-btn"><i class="fa-solid fa-plus"></i> New announcement</button>
          <button class="secondary-btn"><i class="fa-solid fa-file-lines"></i> Review submissions</button>
        </div>
      </div>
      <div class="glass-card">
        <h4>Today at a glance</h4>
        <div class="stats-grid">
          <div class="stat-card">
            <p class="value">18</p>
            <p class="label">Active groups</p>
          </div>
          <div class="stat-card">
            <p class="value">92%</p>
            <p class="label">Engagement</p>
          </div>
          <div class="stat-card">
            <p class="value">4</p>
            <p class="label">Pending reviews</p>
          </div>
          <div class="stat-card">
            <p class="value">3</p>
            <p class="label">Upcoming quizzes</p>
          </div>
        </div>
      </div>
    </section>

    <div class="grid-2">
      <section class="glass-card">
        <h4>Recent activity</h4>
        <div class="list-card">
          <div class="list-item">
            <div>
              <strong>New submission ready for review</strong>
              <small>Computer Science 201 • 14 mins ago</small>
            </div>
            <span class="badge-pill">Review</span>
          </div>
          <div class="list-item">
            <div>
              <strong>Weekly reflection released</strong>
              <small>Research Methods • 56 mins ago</small>
            </div>
            <span class="badge-pill">Published</span>
          </div>
          <div class="list-item">
            <div>
              <strong>Integrity alert reviewed</strong>
              <small>Applied Math • 1 hr ago</small>
            </div>
            <span class="badge-pill">Safe</span>
          </div>
        </div>
      </section>

      <section class="glass-card">
        <h4>Quick actions</h4>
        <div class="list-card">
          <div class="list-item">
            <div>
              <strong>Open course groups</strong>
              <small>Manage teaching circles</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
          <div class="list-item">
            <div>
              <strong>Build a quiz</strong>
              <small>Compose next assessment</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
          <div class="list-item">
            <div>
              <strong>Share a resource</strong>
              <small>Drop in notes, slides, or readings</small>
            </div>
            <i class="fa-solid fa-arrow-right"></i>
          </div>
        </div>
      </section>
    </div>

    <div class="grid-2">
      <section class="glass-card">
        <h4>My course groups</h4>
        <div class="list-card">
          <div class="list-item">
            <div>
              <strong>Interactive Systems Studio</strong>
              <small>24 students • 2 active discussions</small>
            </div>
            <span class="badge-pill">Live</span>
          </div>
          <div class="list-item">
            <div>
              <strong>Research Methods Lab</strong>
              <small>16 students • 1 scheduled session</small>
            </div>
            <span class="badge-pill">Planned</span>
          </div>
        </div>
      </section>

      <section class="glass-card">
        <h4>Upcoming quizzes</h4>
        <div class="list-card">
          <div class="list-item">
            <div>
              <strong>Design Thinking Checkpoint</strong>
              <small>${formatDateLabel(new Date(Date.now() + 86400000))}</small>
            </div>
            <span class="badge-pill">Tomorrow</span>
          </div>
          <div class="list-item">
            <div>
              <strong>Applied Statistics Quiz</strong>
              <small>${formatDateLabel(new Date(Date.now() + 3 * 86400000))}</small>
            </div>
            <span class="badge-pill">In 3 days</span>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderPlaceholder(section) {
  const sectionMap = {
    results: { title: 'Results', body: 'Track performance trends, grade snapshots, and student progress at a glance.' },
    integrity: { title: 'Integrity Logs', body: 'Inspect recent review flags, suspicious patterns, and moderation history.' },
    resources: { title: 'Resources', body: 'Share notes, slides, references, and supplemental materials with your groups.' },
    announcements: { title: 'Announcements', body: 'Compose updates for your classes, schedule reminders, and broadcast important notices.' },
    settings: { title: 'Settings', body: 'Tune your profile, teaching preferences, and notification defaults for your academic workflow.' }
  };

  const meta = sectionMap[section] || sectionMap.results;

  return `
    <section class="placeholder-card">
      <h3>${meta.title}</h3>
      <p>${meta.body}</p>
      <ul>
        <li>Glassmorphism layout preserved for a premium teaching experience.</li>
        <li>Built as an independent module so the student dashboard remains untouched.</li>
        <li>Ready for deeper workflow integrations in future phases.</li>
      </ul>
    </section>
  `;
}

function renderSectionContent(container, section, profile) {
  if (!container) return;

  if (section === 'overview') {
    container.innerHTML = renderOverview(profile);
    return;
  }

  if (['quiz-builder', 'published-quizzes', 'draft-quizzes'].includes(section)) {
    renderQuizExperience(container, section, profile, (nextSection) => {
      const event = new CustomEvent('lecturer-section-change', { detail: nextSection });
      window.dispatchEvent(event);
    });
    return;
  }

  if (section === 'groups') {
    renderGroupsSection(container, profile);
    return;
  }

  container.innerHTML = renderPlaceholder(section);
}

export { renderSectionContent };