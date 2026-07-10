import { supabase } from './supabaseClient.js';

function buildOverlay(name) {
  const overlay = document.createElement('div');
  overlay.className = 'logout-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.innerHTML = `
    <div class="logout-card">
      <div class="logout-spinner" data-role="spinner" aria-hidden="true"></div>
      <div class="logout-check" data-role="check" aria-hidden="true">
        <i class="fa-solid fa-check"></i>
      </div>
      <h3 data-role="title">Signing out${name ? `, ${name}` : ''}&hellip;</h3>
      <p data-role="subtitle">Securing your session and clearing this device.</p>
    </div>
  `;
  return overlay;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performLogout(profile) {
  if (document.querySelector('.logout-overlay')) return;

  const name = profile?.full_name || profile?.username || '';
  const overlay = buildOverlay(name);
  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add('visible'));

  const minimumDelay = wait(1100);

  let signOutError = null;
  try {
    await supabase.auth.signOut();
  } catch (error) {
    signOutError = error;
  }

  await minimumDelay;

  if (signOutError) {
    const title = overlay.querySelector('[data-role="title"]');
    const subtitle = overlay.querySelector('[data-role="subtitle"]');
    if (title) title.textContent = 'Could not sign out';
    if (subtitle) subtitle.textContent = 'Please check your connection and try again.';
    await wait(1600);
    overlay.remove();
    return;
  }

  overlay.classList.add('success');
  const title = overlay.querySelector('[data-role="title"]');
  const subtitle = overlay.querySelector('[data-role="subtitle"]');
  if (title) title.textContent = name ? `See you soon, ${name}` : 'Signed out';
  if (subtitle) subtitle.textContent = 'You have been securely signed out.';

  localStorage.removeItem('lecturer-theme');

  await wait(900);
  window.location.href = 'login.html';
}

export { performLogout };