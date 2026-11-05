// POST /api/paystack-verify { reference }  — called by membership.html when the user returns from Paystack.
const { configured, sb, getUser, verifyAndActivate } = require('./_paystack');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'Payments are not switched on yet.' });
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Please log in again.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const reference = String(body.reference || '');
    if (!/^PL_[a-f0-9]{32}$/.test(reference)) return res.status(400).json({ error: 'Bad reference' });

    // Ownership: the payment must belong to the caller.
    const own = await sb(`/rest/v1/payments?select=id&provider=eq.paystack&provider_reference=eq.${reference}&user_id=eq.${user.id}`);
    if (!own.ok || !Array.isArray(own.json) || !own.json.length) return res.status(404).json({ error: 'Payment not found' });

    const r = await verifyAndActivate(reference);
    return res.status(200).json({ state: r.state });
  } catch (e) {
    console.error('paystack-verify', e && e.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};