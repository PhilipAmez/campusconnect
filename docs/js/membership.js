// PeerLoom Membership — the ONE place pricing and entitlement-check
// plumbing live on the frontend. The actual allow/deny decision is never
// made here (or anywhere client-side) — every check below calls the
// database's is_entitled()/my_entitlement() RPC, the same function the
// server-side enforcement triggers use, so there is exactly one source of
// truth, not a copy of the rules duplicated into JS.
import { supabase } from './supabaseClient.js';

// ---------- Pricing (item #19 — centralized, not hardcoded per-component) ----------
// Item #18 of the spec explicitly says not to invent a lecturer paid price
// unless the project confirms one — the user has since confirmed it: once
// a lecturer's free year ends, LECTURER_PAID is billed at the exact same
// rate as a student plan (GHS 6/month or GHS 69.84/year). It's defined here
// as its own entry (rather than lecturer code importing PRICING.student
// directly) so that if PeerLoom ever DOES want the two to diverge, there is
// exactly one place to change it — no UI component hardcodes a number.
const _studentPricing = Object.freeze({
  monthly_price: 6.00,
  annual_discount: 0.03, // 3%
  get annual_price() {
    // monthly_price * 12 * (1 - discount), rounded to 2dp — matches the
    // spec's worked example exactly: 6 * 12 = 72, * 0.97 = 69.84.
    return Math.round(this.monthly_price * 12 * (1 - this.annual_discount) * 100) / 100;
  },
});
export const PRICING = Object.freeze({
  currency: 'GHS',
  student: _studentPricing,
  lecturer: _studentPricing, // confirmed: same price as a student plan
});

export function formatGHS(amount) {
  return `GHS ${amount.toFixed(2)}`;
}

// ---------- Entitlement checks ----------
// Features: 'group_messaging' | 'quiz_attempt' | 'live_class' |
// 'lecturer_quiz_builder' | 'lecturer_resources' | 'lecturer_announcements'
// | 'integrity_logs'
const entitlementCache = new Map(); // feature -> { value, at }
const CACHE_MS = 30_000; // short cache so a page with several gated widgets doesn't fire one RPC per widget

export async function canAccess(feature, { fresh = false } = {}) {
  const cached = entitlementCache.get(feature);
  if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const { data, error } = await supabase.rpc('my_entitlement', { p_feature: feature });
  if (error) {
    console.error(`membership.canAccess(${feature}) failed —`, error.message);
    // Fail closed: if the entitlement check itself can't be answered,
    // treat the feature as locked rather than silently allowing it.
    return false;
  }
  entitlementCache.set(feature, { value: data === true, at: Date.now() });
  return data === true;
}

export function clearEntitlementCache() {
  entitlementCache.clear();
}

export async function getMembershipSummary() {
  const { data, error } = await supabase.rpc('my_membership_summary');
  if (error) {
    console.error('membership.getMembershipSummary failed —', error.message);
    return null;
  }
  return Array.isArray(data) ? data[0] || null : data || null;
}

// ---------- Locked-state UI builders ----------
// Shared so every gated surface (chat composer, quiz entry, live class
// button, lecturer tools) looks and behaves the same way, and so the exact
// copy only needs to change in one place.

const LOCK_STYLE_ID = 'peerloom-membership-lock-style';
function ensureLockStyles() {
  if (document.getElementById(LOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LOCK_STYLE_ID;
  style.textContent = `
    .pl-membership-lock {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 14px 16px; border-radius: 16px;
      background: var(--liquid-glass, rgba(138,43,226,0.06));
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border: 1px solid var(--glass-border, rgba(138,43,226,0.18));
      color: var(--text-primary, inherit);
    }
    .pl-membership-lock .pl-lock-icon { font-size: 18px; flex-shrink: 0; }
    .pl-membership-lock .pl-lock-text { flex: 1 1 220px; font-size: 13.5px; line-height: 1.45; }
    .pl-membership-lock .pl-lock-text strong { display: block; font-size: 14px; margin-bottom: 2px; }
    .pl-membership-lock .pl-lock-btn {
      flex-shrink: 0; display: inline-flex; align-items: center; gap: 7px;
      border: none; border-radius: 999px; padding: 11px 20px;
      font-weight: 700; font-size: 13px; cursor: pointer; color: #fff;
      background: linear-gradient(135deg, var(--purple-border, #8a2be2), var(--accent, #a855f7));
      box-shadow: 0 4px 14px rgba(138,43,226,0.28);
      transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
    }
    .pl-membership-lock .pl-lock-btn i { font-size: 12px; }
    .pl-membership-lock .pl-lock-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(138,43,226,0.4); filter: brightness(1.05); }
    .pl-membership-lock .pl-lock-btn:active { transform: scale(0.97); }
    @media (prefers-color-scheme: dark) {
      .pl-membership-lock { background: rgba(168,85,247,0.08); }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Builds the "composer locked" element described in the spec (item #9):
 * read-only chat stays intact, the input area is replaced with a lock
 * notice and a Reactivate button — never a browser alert, never hiding
 * the group, never deleting messages.
 */
export function buildComposerLock({ onReactivate } = {}) {
  ensureLockStyles();
  const el = document.createElement('div');
  el.className = 'pl-membership-lock';
  el.innerHTML = `
    <span class="pl-lock-icon">🔒</span>
    <span class="pl-lock-text">
      <strong>PARTICIPATION IS INACTIVE</strong>
      You can still read this conversation. Reactivate your PeerLoom membership for GHS 6/month to participate in your group.
    </span>
    <button type="button" class="pl-lock-btn"><i class="fas fa-crown"></i> Reactivate Membership</button>
  `;
  el.querySelector('.pl-lock-btn').addEventListener('click', () => {
    if (onReactivate) onReactivate();
    else window.location.href = 'membership.html';
  });
  return el;
}

/** Quiz-locked notice (item #10). */
export function buildQuizLock({ onReactivate } = {}) {
  ensureLockStyles();
  const el = document.createElement('div');
  el.className = 'pl-membership-lock';
  el.innerHTML = `
    <span class="pl-lock-icon">🔒</span>
    <span class="pl-lock-text">
      <strong>QUIZ ACCESS LOCKED</strong>
      Your group has an available quiz. Activate your PeerLoom membership to take it. GHS 6/month.
    </span>
    <button type="button" class="pl-lock-btn"><i class="fas fa-crown"></i> Reactivate Membership</button>
  `;
  el.querySelector('.pl-lock-btn').addEventListener('click', () => {
    if (onReactivate) onReactivate();
    else window.location.href = 'membership.html';
  });
  return el;
}

/** Generic lecturer-tool-locked notice, reused by quiz builder/resources/announcements/integrity logs. */
export function buildLecturerLock({ feature = 'this tool', onReactivate } = {}) {
  ensureLockStyles();
  const el = document.createElement('div');
  el.className = 'pl-membership-lock';
  el.innerHTML = `
    <span class="pl-lock-icon">🔒</span>
    <span class="pl-lock-text">
      <strong>LECTURER ACCESS INACTIVE</strong>
      Your complimentary PeerLoom Lecturer Access has ended. Choose a lecturer membership plan to use ${feature} again.
    </span>
    <button type="button" class="pl-lock-btn"><i class="fas fa-crown"></i> View Plans</button>
  `;
  el.querySelector('.pl-lock-btn').addEventListener('click', () => {
    if (onReactivate) onReactivate();
    else window.location.href = 'lecturer-membership.html';
  });
  return el;
}