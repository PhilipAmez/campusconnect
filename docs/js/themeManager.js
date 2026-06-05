const THEME_STORAGE_KEY = 'peerloom-theme-preference';
const LEGACY_THEME_KEYS = ['peerloom-theme', 'theme'];
const THEME_CHANNEL_NAME = 'peerloom-theme-sync';
const THEME_VALUES = new Set(['light', 'dark', 'system']);

let initialized = false;
let currentPreference = 'system';
let currentResolvedTheme = 'light';
let activeSupabase = null;
let activeUserId = null;
let mediaQuery = null;
let broadcastChannel = null;
const listeners = new Set();

function ensureMediaQuery() {
  if (!mediaQuery && typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }
  return mediaQuery;
}

function normalizeThemePreference(theme) {
  if (typeof theme !== 'string') return 'system';
  const normalized = theme.trim().toLowerCase();
  return THEME_VALUES.has(normalized) ? normalized : 'system';
}

function resolveTheme(preference) {
  if (preference === 'system') {
    return ensureMediaQuery()?.matches ? 'dark' : 'light';
  }
  return preference === 'dark' ? 'dark' : 'light';
}

function setLegacyThemeState(resolvedTheme) {
  LEGACY_THEME_KEYS.forEach((key) => localStorage.setItem(key, resolvedTheme));
}

function readStoredPreference() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored) return normalizeThemePreference(stored);

  for (const key of LEGACY_THEME_KEYS) {
    const legacy = localStorage.getItem(key);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  }

  return 'system';
}

function applyTheme(preference, options = {}) {
  currentPreference = normalizeThemePreference(preference);
  currentResolvedTheme = resolveTheme(currentPreference);

  const root = document.documentElement;
  const body = document.body;

  root.setAttribute('data-theme', currentResolvedTheme);
  root.dataset.themePreference = currentPreference;
  root.style.colorScheme = currentResolvedTheme;
  root.classList.toggle('dark', currentResolvedTheme === 'dark');

  if (body) {
    body.setAttribute('data-theme', currentResolvedTheme);
    body.dataset.themePreference = currentPreference;
    body.classList.toggle('dark', currentResolvedTheme === 'dark');
  }

  if (options.persist !== false) {
    localStorage.setItem(THEME_STORAGE_KEY, currentPreference);
    setLegacyThemeState(currentResolvedTheme);
  }

  if (options.broadcast !== false && broadcastChannel) {
    broadcastChannel.postMessage({ preference: currentPreference });
  }

  const detail = getThemeState();
  listeners.forEach((listener) => listener(detail));
  window.dispatchEvent(new CustomEvent('peerloom-theme-change', { detail }));
  return detail;
}

async function saveThemePreferenceToSupabase(preference) {
  if (!activeSupabase || !activeUserId) return;

  try {
    const { error } = await activeSupabase
      .from('profiles')
      .update({ theme_preference: preference })
      .eq('id', activeUserId);

    if (error) throw error;
  } catch (error) {
    console.error('Error saving theme preference:', error);
  }
}

function setupThemeSync() {
  if (initialized) return;
  initialized = true;

  ensureMediaQuery()?.addEventListener('change', () => {
    if (currentPreference === 'system') {
      applyTheme('system', { persist: true, broadcast: true });
    }
  });

  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY && event.newValue) {
      applyTheme(event.newValue, { persist: false, broadcast: false });
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(THEME_CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event?.data?.preference) {
        applyTheme(event.data.preference, { persist: true, broadcast: false });
      }
    };
  }
}

export function getThemeState() {
  return {
    preference: currentPreference,
    resolvedTheme: currentResolvedTheme
  };
}

export async function initGlobalTheme({ supabase } = {}) {
  activeSupabase = supabase || activeSupabase;
  setupThemeSync();

  const hasStoredPreference = !!localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(readStoredPreference(), { persist: true, broadcast: false });

  if (activeSupabase) {
    Promise.resolve().then(async () => {
      try {
        const {
          data: { user }
        } = await activeSupabase.auth.getUser();

        activeUserId = user?.id || null;

        if (user?.id) {
          const { data: profile, error } = await activeSupabase
            .from('profiles')
            .select('theme_preference')
            .eq('id', user.id)
            .single();

          if (!hasStoredPreference && !error && profile?.theme_preference) {
            applyTheme(profile.theme_preference, { persist: true, broadcast: false });
          }
        }
      } catch (error) {
        console.error('Error loading theme preference:', error);
      }
    });
  }

  return {
    ...getThemeState(),
    setThemePreference,
    toggleLightDarkTheme,
    cycleThemePreference
  };
}

export function onThemeChange(listener, { immediate = true } = {}) {
  listeners.add(listener);
  if (immediate) {
    listener(getThemeState());
  }

  return () => listeners.delete(listener);
}

export async function setThemePreference(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  applyTheme(normalizedPreference, { persist: true, broadcast: true });
  await saveThemePreferenceToSupabase(normalizedPreference);
  return getThemeState();
}

export async function toggleLightDarkTheme() {
  const nextTheme = currentResolvedTheme === 'dark' ? 'light' : 'dark';
  return setThemePreference(nextTheme);
}

export async function cycleThemePreference() {
  const order = ['light', 'dark', 'system'];
  const nextIndex = (order.indexOf(currentPreference) + 1) % order.length;
  return setThemePreference(order[nextIndex]);
}
