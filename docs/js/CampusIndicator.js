// ============================================================
// CampusIndicator.js — PeerLoom campus resolution & badge system
// Single source of truth for all campus logic across the app.
// ============================================================

const CAMPUS_STYLE_ID   = 'peerloom-campus-indicator-styles';
const CAMPUS_TOOLTIP_ID = 'peerloom-campus-indicator-tooltip';

let campusIndicatorEventsReady = false;

// ------------------------------------------------------------
// Core resolution helpers
// ------------------------------------------------------------

/**
 * Normalise any campus/institution string to a trimmed lowercase
 * value so comparisons are case- and whitespace-insensitive.
 */
export function normalizeCampus(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Extract the campus string from a flat profile object.
 * Priority: profile.campus  →  profile.custom_campus
 */
export function resolveCampus(profile) {
  if (typeof profile === 'string') return normalizeCampus(profile);
  if (!profile || typeof profile !== 'object') return '';

  // Primary field first, then fallback
  const primary  = normalizeCampus(profile.campus);
  if (primary) return primary;

  const fallback = normalizeCampus(profile.custom_campus);
  if (fallback) return fallback;

  return '';
}

/**
 * Extract the campus string from *any* object that could be:
 *   - a flat profile  { campus, custom_campus }
 *   - a group/post    { creator: { campus, custom_campus } }
 *   - a group/post    { creator_campus, creator_custom_campus }
 *   - a raw string
 *
 * Resolution order (first non-empty wins):
 *   1. value.creator          (enriched group/post objects)
 *   2. value.creator_campus / value.creator_custom_campus
 *   3. value.profile
 *   4. value.campus / value.custom_campus  (flat profile)
 */
function resolveCampusTarget(value) {
  if (typeof value === 'string') return normalizeCampus(value);
  if (!value || typeof value !== 'object') return '';

  // 1. Enriched creator object (groups/posts)
  if (value.creator && typeof value.creator === 'object') {
    const v = resolveCampus(value.creator);
    if (v) return v;
  }

  // 2. Flat creator_campus / creator_custom_campus keys
  const creatorCampus = normalizeCampus(value.creator_campus);
  if (creatorCampus) return creatorCampus;

  const creatorCustom = normalizeCampus(value.creator_custom_campus);
  if (creatorCustom) return creatorCustom;

  // 3. Nested profile object
  if (value.profile && typeof value.profile === 'object') {
    const v = resolveCampus(value.profile);
    if (v) return v;
  }

  // 4. Direct campus fields on the object itself (flat profile row)
  return resolveCampus(value);
}

// ------------------------------------------------------------
// Public comparison API
// ------------------------------------------------------------

export function isSameCampus(viewer, target) {
  const viewerCampus = resolveCampusTarget(viewer);
  const targetCampus = resolveCampusTarget(target);
  return Boolean(viewerCampus && targetCampus && viewerCampus === targetCampus);
}

// Aliases kept for backwards-compatibility across the codebase
export const isSameInstitution    = isSameCampus;
export const getUserCampus        = resolveCampus;
export const normalizeInstitution = resolveCampusTarget;

// ------------------------------------------------------------
// Badge metadata
// ------------------------------------------------------------

export function getCampusMeta(viewer, target) {
  const sameCampus = isSameCampus(viewer, target);
  return {
    sameCampus,
    label     : sameCampus ? 'IYC' : 'OYC',
    tooltip   : sameCampus ? 'In Your Campus' : 'Outside Your Campus',
    className : sameCampus ? 'campus-indicator--local' : 'campus-indicator--global'
  };
}

// ------------------------------------------------------------
// Styles
// ------------------------------------------------------------

function ensureCampusStyles() {
  if (document.getElementById(CAMPUS_STYLE_ID)) {
    setupCampusIndicatorEvents();
    return;
  }

  const style = document.createElement('style');
  style.id = CAMPUS_STYLE_ID;
  style.textContent = `
    .campus-indicator {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      min-width: 32px;
      min-height: 32px;
      max-width: 32px;
      max-height: 32px;
      padding: 0;
      border-radius: 9999px;
      font-size: 0.58rem;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
      border: 1px solid transparent;
      flex: 0 0 32px;
      box-sizing: border-box;
      cursor: help;
      user-select: none;
      text-align: center;
      letter-spacing: -0.01em;
      overflow: hidden;
      flex-shrink: 0;
    }
    .campus-indicator--local {
      background: rgba(16, 185, 129, 0.16);
      color: #047857;
      border-color: rgba(16, 185, 129, 0.36);
    }
    .campus-indicator--global {
      background: rgba(99, 102, 241, 0.12);
      color: #4f46e5;
      border-color: rgba(99, 102, 241, 0.28);
    }
    .campus-indicator-tooltip {
      position: fixed;
      left: 0;
      top: 0;
      transform: translate(-50%, -100%);
      opacity: 0;
      pointer-events: none;
      z-index: 100000;
      width: max-content;
      max-width: min(220px, 88vw);
      padding: 0.38rem 0.62rem;
      border-radius: 0.45rem;
      background: rgba(17, 24, 39, 0.97);
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 600;
      line-height: 1.3;
      white-space: normal;
      overflow-wrap: break-word;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.22);
      transition: opacity 0.16s ease;
    }
    .campus-indicator-tooltip.is-visible {
      opacity: 1;
    }
    [data-theme="dark"] .campus-indicator--local {
      background: rgba(16, 185, 129, 0.18);
      color: #6ee7b7;
      border-color: rgba(16, 185, 129, 0.35);
    }
    [data-theme="dark"] .campus-indicator--global {
      background: rgba(99, 102, 241, 0.2);
      color: #a5b4fc;
      border-color: rgba(129, 140, 248, 0.38);
    }
  `;

  document.head.appendChild(style);
  setupCampusIndicatorEvents();
}

// ------------------------------------------------------------
// Tooltip
// ------------------------------------------------------------

function getTooltipElement() {
  let tooltip = document.getElementById(CAMPUS_TOOLTIP_ID);
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = CAMPUS_TOOLTIP_ID;
    tooltip.className = 'campus-indicator-tooltip';
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function hideCampusTooltip() {
  const tooltip = document.getElementById(CAMPUS_TOOLTIP_ID);
  if (tooltip) tooltip.classList.remove('is-visible');

  document.querySelectorAll('.campus-indicator[data-campus-active="true"]').forEach((el) => {
    el.removeAttribute('data-campus-active');
  });
}

function positionTooltip(tooltip, indicator) {
  const rect        = indicator.getBoundingClientRect();
  const tRect       = tooltip.getBoundingClientRect();
  const margin      = 8;
  const halfW       = tRect.width / 2;
  const showBelow   = rect.top - tRect.height - margin < margin;

  const left = Math.min(
    Math.max(rect.left + rect.width / 2, margin + halfW),
    window.innerWidth - margin - halfW
  );
  const top = showBelow ? rect.bottom + margin : rect.top - margin;

  tooltip.style.left      = `${left}px`;
  tooltip.style.top       = `${top}px`;
  tooltip.style.transform = showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
}

function showCampusTooltip(indicator, { persistent = false } = {}) {
  const tooltip = getTooltipElement();
  tooltip.textContent = indicator.dataset.campusTooltip || indicator.getAttribute('aria-label') || '';

  if (persistent) {
    document.querySelectorAll('.campus-indicator[data-campus-active="true"]').forEach((el) => {
      if (el !== indicator) el.removeAttribute('data-campus-active');
    });
    indicator.setAttribute('data-campus-active', 'true');
  }

  // Show first so getBoundingClientRect reflects actual size
  tooltip.classList.add('is-visible');
  positionTooltip(tooltip, indicator);
}

// ------------------------------------------------------------
// Event wiring — delegated to document, set up once
// ------------------------------------------------------------

function setupCampusIndicatorEvents() {
  if (campusIndicatorEventsReady) return;
  campusIndicatorEventsReady = true;

  // Desktop: hover
  document.addEventListener('mouseover', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (indicator) showCampusTooltip(indicator);
  });

  document.addEventListener('mouseout', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (!indicator) return;
    if (indicator.getAttribute('data-campus-active') === 'true') return;
    if (!e.relatedTarget || !indicator.contains(e.relatedTarget)) hideCampusTooltip();
  });

  // Keyboard focus (accessibility)
  document.addEventListener('focusin', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (indicator) showCampusTooltip(indicator);
  });

  document.addEventListener('focusout', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (indicator && indicator.getAttribute('data-campus-active') !== 'true') hideCampusTooltip();
  });

  // Mobile: tap to show persistent; tap outside to close
  document.addEventListener('click', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (!indicator) {
      hideCampusTooltip();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const isActive = indicator.getAttribute('data-campus-active') === 'true';
    hideCampusTooltip();
    if (!isActive) showCampusTooltip(indicator, { persistent: true });
  }, true);

  // Keyboard: Enter / Space to toggle
  document.addEventListener('keydown', (e) => {
    const indicator = e.target.closest?.('.campus-indicator');
    if (!indicator) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    const isActive = indicator.getAttribute('data-campus-active') === 'true';
    hideCampusTooltip();
    if (!isActive) showCampusTooltip(indicator, { persistent: true });
  }, true);

  // Hide on scroll
  document.addEventListener('scroll', hideCampusTooltip, true);
}

// ------------------------------------------------------------
// Render helpers
// ------------------------------------------------------------

/**
 * Returns an HTML string for the campus badge.
 * viewer  — the current user's profile object
 * target  — a profile, group, post, or any supported shape
 */
export function CampusIndicator({ viewer, target } = {}) {
  ensureCampusStyles();
  const meta = getCampusMeta(viewer, target);
  return `<span
    class="campus-indicator ${meta.className}"
    role="button"
    tabindex="0"
    aria-label="${meta.tooltip}"
    title="${meta.tooltip}"
    data-campus-tooltip="${meta.tooltip}"
  >${meta.label}</span>`;
}

export function renderCampusIndicator(viewer, target) {
  return CampusIndicator({ viewer, target });
}