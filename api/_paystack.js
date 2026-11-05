// Shared helpers for the Paystack endpoints. Server-side only.
// Env vars (Vercel): PAYSTACK_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY, optional SUPABASE_URL.
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mdofjippejpqylwuzsqp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY;
const SITE = process.env.SITE_URL || 'https://peerloom.online';

function configured() { return !!(SERVICE_KEY && PAYSTACK_KEY); }

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await r.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* ignore */ }
  return { ok: r.ok, status: r.status, json };
}
const rpc = (fn, args) => sb(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

// Resolve the logged-in user from the browser's bearer token.
async function getUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email } : null;
}

async function paystack(path, opts = {}) {
  const r = await fetch(`https://api.paystack.co${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${PAYSTACK_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let json = null; try { json = await r.json(); } catch (e) { /* ignore */ }
  return { ok: r.ok, json };
}

// Ask Paystack (not the caller) whether this reference was really paid, then activate.
async function verifyAndActivate(reference) {
  const v = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!v.ok || !v.json || !v.json.status || !v.json.data) return { state: 'verify_failed' };
  const d = v.json.data;
  if (d.reference !== reference) return { state: 'reference_mismatch' };
  if (d.status !== 'success') {
    if (d.status === 'failed' || d.status === 'abandoned') await rpc('paystack_fail', { p_reference: reference, p_reason: d.gateway_response || d.status });
    return { state: d.status };
  }
  const a = await rpc('paystack_activate', { p_reference: reference, p_paid_pesewas: d.amount, p_currency: d.currency });
  return { state: a.ok ? a.json : 'activate_failed' };
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 1_000_000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = { configured, sb, rpc, getUser, paystack, verifyAndActivate, safeEqualHex, readRaw, SITE, crypto };