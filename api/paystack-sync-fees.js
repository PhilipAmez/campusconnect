// POST /api/paystack-sync-fees
// Super-admin only. For successful Paystack payments that have no fee recorded yet, asks Paystack
// (server to server, using the secret key) what it charged, and stores fee + net on the payment row.
// Safe to call repeatedly: it only touches rows whose fee is still empty, and the database function
// refuses a row whose amount does not match what Paystack says was paid.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mdofjippejpqylwuzsqp.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY;
const BATCH = 40;

function send(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

async function requireSuperAdmin(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` } });
  if (!who.ok) return null;
  const user = await who.json();
  if (!user || !user.id) return null;
  const r = await sb('/rest/v1/rpc/peerloom_is_super_admin', { method: 'POST', body: JSON.stringify({ check_uid: user.id }) });
  if (!r.ok) return null;
  return (await r.json()) === true ? user.id : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  if (!SERVICE_KEY || !PAYSTACK_KEY) return send(res, 500, { error: 'Server is not configured' });

  const adminId = await requireSuperAdmin(req);
  if (!adminId) return send(res, 403, { error: 'Not allowed' });

  const q = await sb(`/rest/v1/payments?select=provider_reference,amount&provider=eq.paystack&status=eq.SUCCESS&paystack_fee=is.null&order=created_at.desc&limit=${BATCH}`);
  if (!q.ok) return send(res, 500, { error: 'Could not read payments' });
  const rows = await q.json();

  const out = { checked: rows.length, updated: 0, skipped: 0, problems: [] };
  for (const row of rows) {
    try {
      const pr = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(row.provider_reference)}`, {
        headers: { Authorization: `Bearer ${PAYSTACK_KEY}` },
      });
      const j = await pr.json().catch(() => ({}));
      const d = j && j.data;
      if (!pr.ok || !d || d.status !== 'success' || d.currency !== 'GHS' || typeof d.fees !== 'number') {
        out.skipped++; out.problems.push({ ref: row.provider_reference, why: 'paystack_no_fee_data' });
        continue;
      }
      const rr = await sb('/rest/v1/rpc/paystack_record_fees', {
        method: 'POST',
        body: JSON.stringify({
          p_reference: row.provider_reference,
          p_amount_pesewas: d.amount,
          p_fee_pesewas: d.fees,
          p_channel: d.channel || null,
          p_paid_at: d.paid_at || null,
        }),
      });
      const result = rr.ok ? await rr.json() : 'rpc_failed';
      if (result === 'ok') out.updated++;
      else { out.skipped++; out.problems.push({ ref: row.provider_reference, why: result }); }
    } catch (e) {
      out.skipped++; out.problems.push({ ref: row.provider_reference, why: 'error' });
    }
  }
  return send(res, 200, out);
};