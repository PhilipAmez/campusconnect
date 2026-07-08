import { supabase } from './supabaseClient.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateLabel(value) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadMyGroups(profile) {
  if (!profile?.id) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('id, name, description, course_code, is_public, is_frozen, member_count, invite_code, cover_photo, created_at')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load course groups:', error);
    return [];
  }
  return data || [];
}

function renderLoadingSkeleton() {
  return `
    <section class="quiz-shell">
      <div class="hero-card glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-users"></i> Course groups</div>
          <h3>My Course Groups</h3>
          <p>Loading the teaching circles you manage&hellip;</p>
        </div>
      </div>
      <div class="quiz-list-grid">
        ${[1, 2].map(() => `<div class="empty-state-card">Loading&hellip;</div>`).join('')}
      </div>
    </section>
  `;
}

function renderGroupCard(group) {
  const visibilityBadge = group.is_public
    ? '<span class="badge-pill">Public</span>'
    : '<span class="badge-pill soft">Private</span>';
  const frozenBadge = group.is_frozen
    ? '<span class="badge-pill" style="background:rgba(185,28,28,0.12); color:#b91c1c;">Frozen</span>'
    : '';

  return `
    <article class="quiz-card glass-card" data-group-id="${group.id}">
      <div class="quiz-card-head">
        <div>
          <h4>${escapeHtml(group.name || 'Untitled group')}</h4>
          <p>${escapeHtml(group.description || 'No description yet.')}</p>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">${visibilityBadge}${frozenBadge}</div>
      </div>
      <div class="quiz-card-meta">
        <span><i class="fa-solid fa-book"></i> ${escapeHtml(group.course_code || 'No course code')}</span>
        <span><i class="fa-solid fa-user-group"></i> ${group.member_count ?? 0} members</span>
        <span><i class="fa-regular fa-calendar"></i> ${formatDateLabel(group.created_at)}</span>
      </div>
      <div class="quiz-card-actions">
        ${group.invite_code ? `<button class="secondary-btn small" data-action="copy-invite" data-code="${escapeHtml(group.invite_code)}"><i class="fa-solid fa-copy"></i> Invite code</button>` : ''}
      </div>
    </article>
  `;
}

function bindGroupEvents(container) {
  container.querySelectorAll('[data-action="copy-invite"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const code = button.dataset.code;
      try {
        await navigator.clipboard.writeText(code);
        const original = button.innerHTML;
        button.innerHTML = '<i class="fa-solid fa-check"></i> Copied';
        setTimeout(() => { button.innerHTML = original; }, 1400);
      } catch (error) {
        console.error('Could not copy invite code:', error);
      }
    });
  });
}

async function renderGroupsSection(container, profile) {
  if (!container) return;

  container.innerHTML = renderLoadingSkeleton();

  const groups = await loadMyGroups(profile);

  container.innerHTML = `
    <section class="quiz-shell">
      <div class="hero-card glass-card">
        <div>
          <div class="hero-badge"><i class="fa-solid fa-users"></i> Course groups</div>
          <h3>My Course Groups</h3>
          <p>Manage the teaching circles you've created${profile?.institution ? ` at ${escapeHtml(profile.institution)}` : ''}. These are also the groups you can publish quizzes to.</p>
        </div>
      </div>
      ${groups.length
        ? `<div class="quiz-list-grid">${groups.map(renderGroupCard).join('')}</div>`
        : `<div class="empty-state-card">You haven't created any course groups yet. Create one from the main Groups experience to start publishing quizzes to students.</div>`}
    </section>
  `;

  bindGroupEvents(container);
}

export { renderGroupsSection, loadMyGroups };