// ============================================================
// campusDiscovery.js — PeerLoom campus discovery utilities
// All campus resolution is delegated to CampusIndicator.js.
// This file owns: context caching, group enrichment, ranking,
// mixing, and section rendering helpers.
// ============================================================

import {
  CampusIndicator,
  getCampusMeta,
  getUserCampus,
  isSameCampus,
  isSameInstitution,
  normalizeCampus,
  normalizeInstitution,
  renderCampusIndicator,
  resolveCampus
} from './CampusIndicator.js';

export {
  CampusIndicator,
  getCampusMeta,
  getUserCampus,
  isSameCampus,
  isSameInstitution,
  normalizeCampus,
  normalizeInstitution,
  renderCampusIndicator,
  resolveCampus
};

// ------------------------------------------------------------
// Discovery section styles
// ------------------------------------------------------------

const DISCOVERY_STYLE_ID = 'peerloom-campus-discovery-section-styles';

function ensureDiscoveryStyles() {
  if (document.getElementById(DISCOVERY_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = DISCOVERY_STYLE_ID;
  style.textContent = `
    .discovery-section {
      display: grid;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .discovery-section-header {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }
    .discovery-section-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #6d28d9;
      letter-spacing: 0.01em;
      line-height: 1.4;
      text-transform: uppercase;
    }
    .discovery-empty {
      margin: 0;
      color: #6b7280;
      font-size: 0.85rem;
      text-align: center;
      padding: 0.75rem 1rem;
      line-height: 1.5;
    }
    [data-theme="dark"] .discovery-section-title {
      color: #c4b5fd;
    }
    [data-theme="dark"] .discovery-empty {
      color: #9ca3af;
    }
  `;
  document.head.appendChild(style);
}

// ------------------------------------------------------------
// Context caching — one fetch per page load unless forced
// ------------------------------------------------------------

let cachedContext        = null;
let cachedContextPromise = null;

export async function getCurrentUserContext(supabase, { force = false } = {}) {
  if (!force && cachedContext) return cachedContext;
  if (!force && cachedContextPromise) return cachedContextPromise;

  cachedContextPromise = (async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      cachedContext = { user: null, profile: null };
      return cachedContext;
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select(
        'id, institution, campus, custom_campus, department, level, custom_level, username, full_name, theme_preference'
      )
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error loading current user context:', error);
    }

    cachedContext = { user, profile: profile || null };
    return cachedContext;
  })();

  try {
    return await cachedContextPromise;
  } finally {
    cachedContextPromise = null;
  }
}

// ------------------------------------------------------------
// Group enrichment — attach creator campus fields to each group
// ------------------------------------------------------------

export async function enrichGroupsWithCreatorCampus(supabase, groups) {
  const normalizedGroups = Array.isArray(groups) ? groups : [];
  const creatorIds = [
    ...new Set(normalizedGroups.map((g) => g?.created_by).filter(Boolean))
  ];

  // Minimal mapper used whether or not we have profiles
  function mapGroup(group, creatorProfile) {
    const creator            = group?.creator || creatorProfile || null;
    const creatorInstitution =
      group?.creator?.institution ||
      group?.creator_institution  ||
      creatorProfile?.institution ||
      null;

    return {
      ...group,
      creator,
      institution: normalizeCampus(group?.institution)
        ? group.institution
        : creatorInstitution,
      creator_campus:
        group?.creator?.campus        ||
        group?.creator_campus         ||
        creatorProfile?.campus        ||
        null,
      creator_custom_campus:
        group?.creator?.custom_campus ||
        group?.creator_custom_campus  ||
        creatorProfile?.custom_campus ||
        null,
      creator_institution: creatorInstitution
    };
  }

  if (creatorIds.length === 0) {
    return normalizedGroups.map((g) => mapGroup(g, null));
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, username, campus, custom_campus, institution')
    .in('id', creatorIds);

  if (error) {
    console.error('Error enriching groups with creator campus:', error);
    return normalizedGroups.map((g) => mapGroup(g, null));
  }

  const profileById = (profiles || []).reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {});

  return normalizedGroups.map((g) => mapGroup(g, profileById[g?.created_by] || null));
}

// Alias used by dashboard.html
export const enrichGroupsWithInstitution = enrichGroupsWithCreatorCampus;

// ------------------------------------------------------------
// Connection ranking
// ------------------------------------------------------------

function activeScore(statusValue) {
  const s = String(statusValue || '').toLowerCase();
  if (s.includes('online') || s.includes('active now')) return 3;
  if (s.includes('active')) return 2;
  return 1;
}

function scoreConnection(candidate, currentProfile) {
  let score = 0;
  if (isSameInstitution(currentProfile, candidate)) score += 100;

  const dep1 = normalizeCampus(currentProfile?.department);
  const dep2 = normalizeCampus(candidate?.department);
  if (dep1 && dep1 === dep2) score += 20;

  const lvl1 = (currentProfile?.custom_level || currentProfile?.level || '').trim().toLowerCase();
  const lvl2 = (candidate?.custom_level  || candidate?.level  || '').trim().toLowerCase();
  if (lvl1 && lvl1 === lvl2) score += 10;

  score += activeScore(candidate?.status);
  return score;
}

export function rankConnectionCandidates(candidates, currentProfile) {
  return [...candidates].sort((a, b) =>
    scoreConnection(b, currentProfile) - scoreConnection(a, currentProfile)
  );
}

// ------------------------------------------------------------
// Campus-first mixing
// ------------------------------------------------------------

export function mixCampusFirstItems(sameCampusItems, globalItems, limit = 10) {
  const result      = [];
  const localQueue  = [...sameCampusItems];
  const globalQueue = [...globalItems];
  // Pattern: 4 local for every 1 global
  const pattern     = ['local', 'local', 'local', 'local', 'global'];
  let idx           = 0;

  while (result.length < limit && (localQueue.length || globalQueue.length)) {
    const expected = pattern[idx % pattern.length];
    idx += 1;

    if (expected === 'local' && localQueue.length)  { result.push(localQueue.shift());  continue; }
    if (expected === 'global' && globalQueue.length) { result.push(globalQueue.shift()); continue; }
    if (localQueue.length)  { result.push(localQueue.shift());  continue; }
    if (globalQueue.length) { result.push(globalQueue.shift()); continue; }
  }

  return result;
}

// ------------------------------------------------------------
// Discovery section HTML builder
// Note: note/description text intentionally omitted per spec —
//       callers pass an empty string or omit it.
// ------------------------------------------------------------

export function createDiscoverySection(title, _note, contentHtml) {
  ensureDiscoveryStyles();
  return `
    <section class="discovery-section">
      <div class="discovery-section-header">
        <div class="discovery-section-title">${title}</div>
      </div>
      ${contentHtml}
    </section>
  `;
}