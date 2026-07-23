import { supabase } from './supabaseClient.js';
import { showLecturerNotice } from './lecturer-notify.js';
import { setThemePreference, getThemeState } from './themeManager.js';
import { SUPPORTED_LANGUAGES, getCurrentLanguage, setLanguage } from './i18n.js';

const NOTIF_TYPES = [
  { key: 'new_submission', label: 'New submission', description: 'A student submits one of your quizzes' },
  { key: 'quiz_completed', label: 'Quiz fully completed', description: 'Every assigned student has submitted' },
  { key: 'announcement_read', label: 'Announcement read', description: 'A student opens one of your announcements' },
  { key: 'resource_downloaded', label: 'Resource downloaded', description: 'A student downloads a shared resource' },
  { key: 'integrity_event', label: 'Integrity event', description: 'Copy/paste or fullscreen-exit during a quiz' }
];

let state = { profile: null };

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getNotifPrefs(profile) {
  const prefs = profile?.notification_preferences;
  if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) return prefs;
  return {};
}

const LANGUAGE_LABELS = { en: 'English', es: 'Español', fr: 'Français', de: 'Deutsch' };

function renderShell(profile) {
  const prefs = getNotifPrefs(profile);
  const themeState = getThemeState ? getThemeState() : null;
  const currentThemePref = profile?.theme_preference || themeState?.preference || 'system';
  const currentLang = getCurrentLanguage();

  return `
    <section class="hero-card">
      <div>
        <div class="hero-badge"><i class="fa-solid fa-sliders"></i> Settings</div>
        <h3>Tune your workspace</h3>
        <p>Your profile, notification defaults, and appearance — saved to your account, not just this browser.</p>
      </div>
    </section>

    <section class="glass-card">
      <div class="section-header"><h4>Profile</h4></div>
      <div class="field-grid">
        <div class="field-group full">
          <span>Full Name</span>
          <input type="text" class="quiz-input" id="setFullName" value="${escapeHtml(profile?.full_name || '')}" />
        </div>
        <div class="field-group full">
          <span>Bio</span>
          <textarea class="quiz-input" id="setBio" rows="3" placeholder="A short line students see on your profile&hellip;">${escapeHtml(profile?.bio || '')}</textarea>
        </div>
        <div class="field-group">
          <span>Department</span>
          <input type="text" class="quiz-input" id="setDepartment" value="${escapeHtml(profile?.department || '')}" />
        </div>
        <div class="field-group">
          <span>Institution</span>
          <input type="text" class="quiz-input" id="setInstitution" value="${escapeHtml(profile?.institution || '')}" />
        </div>
      </div>
      <div class="quiz-inline-actions">
        <button class="primary-btn" id="saveProfileBtn"><i class="fa-solid fa-check"></i> Save Profile</button>
      </div>
    </section>

    <section class="glass-card">
      <div class="section-header"><h4>Notification Preferences</h4></div>
      <div class="list-card">
        ${NOTIF_TYPES.map((t) => `
          <div class="list-item">
            <div>
              <strong>${t.label}</strong>
              <small>${t.description}</small>
            </div>
            <label class="settings-toggle">
              <input type="checkbox" data-notif-key="${t.key}" ${prefs[t.key] === false ? '' : 'checked'} />
              <span class="settings-toggle-track"></span>
            </label>
          </div>
        `).join('')}
      </div>
      <div class="quiz-inline-actions">
        <button class="primary-btn" id="saveNotifBtn"><i class="fa-solid fa-check"></i> Save Preferences</button>
      </div>
    </section>

    <section class="glass-card">
      <div class="section-header"><h4>Appearance</h4></div>
      <div class="field-group">
        <span>Theme</span>
        <select class="quiz-input" id="setTheme">
          <option value="system" ${currentThemePref === 'system' ? 'selected' : ''}>Match system</option>
          <option value="light" ${currentThemePref === 'light' ? 'selected' : ''}>Light</option>
          <option value="dark" ${currentThemePref === 'dark' ? 'selected' : ''}>Dark</option>
        </select>
      </div>
      <div class="field-group" style="margin-top: 14px;">
        <span>Language</span>
        <select class="quiz-input" id="setLanguage">
          ${SUPPORTED_LANGUAGES.map((code) => `<option value="${code}" ${currentLang === code ? 'selected' : ''}>${LANGUAGE_LABELS[code] || code}</option>`).join('')}
        </select>
      </div>
    </section>
  `;
}

function wireShell(container) {
  container.querySelector('#saveProfileBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#saveProfileBtn');
    btn.disabled = true;
    try {
      const payload = {
        full_name: container.querySelector('#setFullName').value.trim(),
        bio: container.querySelector('#setBio').value.trim(),
        department: container.querySelector('#setDepartment').value.trim(),
        institution: container.querySelector('#setInstitution').value.trim()
      };
      const { error } = await supabase.from('profiles').update(payload).eq('id', state.profile.id);
      if (error) throw error;
      Object.assign(state.profile, payload);
      showLecturerNotice('Profile saved', 'Your changes have been saved.', 'success');
    } catch (err) {
      console.error('Failed to save profile:', err);
      showLecturerNotice('Could not save', 'Something went wrong saving your profile.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#saveNotifBtn')?.addEventListener('click', async () => {
    const btn = container.querySelector('#saveNotifBtn');
    btn.disabled = true;
    try {
      const prefs = { ...getNotifPrefs(state.profile) };
      container.querySelectorAll('[data-notif-key]').forEach((input) => {
        prefs[input.dataset.notifKey] = input.checked;
      });
      const { error } = await supabase.from('profiles').update({ notification_preferences: prefs }).eq('id', state.profile.id);
      if (error) throw error;
      state.profile.notification_preferences = prefs;
      showLecturerNotice('Preferences saved', 'Your notification settings have been updated.', 'success');
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
      showLecturerNotice('Could not save', 'Something went wrong saving your preferences.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  container.querySelector('#setTheme')?.addEventListener('change', async (e) => {
    const value = e.target.value;
    try {
      if (typeof setThemePreference === 'function') await setThemePreference(value);
      await supabase.from('profiles').update({ theme_preference: value }).eq('id', state.profile.id);
    } catch (err) {
      console.error('Failed to save theme preference:', err);
    }
  });

  container.querySelector('#setLanguage')?.addEventListener('change', async (e) => {
    try {
      await setLanguage(e.target.value, { supabase, userId: state.profile.id });
      window.dispatchEvent(new CustomEvent('lecturer-language-change'));
      showLecturerNotice('Language updated', 'Your dashboard is now showing in the selected language.', 'success');
    } catch (err) {
      console.error('Failed to save language preference:', err);
      showLecturerNotice('Could not save', 'Something went wrong saving your language preference.', 'error');
    }
  });
}

async function renderSettingsSection(container, profile) {
  if (!container) return;
  state.profile = profile;
  container.innerHTML = renderShell(profile);
  wireShell(container);
}

export { renderSettingsSection };