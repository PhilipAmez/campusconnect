// POST /api/paystack-initialize  { interval: 'monthly' | 'yearly' }  + Authorization: Bearer <user token>
// The amount is decided by the database, never by the browser.
const { configured, sb, rpc, getUser, paystack, SITE, crypto } = require('./_paystack');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!configured()) return res.status(503).json({ error: 'Payments are not switched on yet.' });
  try {
    const user = await getUser(req);
    if (!user || !user.email) return res.status(401).json({ error: 'Please log in again.' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const interval = body.interval === 'yearly' ? 'yearly' : body.interval === 'monthly' ? 'monthly' : null;
    if (!interval) return res.status(400).json({ error: 'Choose monthly or yearly.' });

    // Limit abuse: at most 5 unfinished checkouts per user per hour.
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await sb(`/rest/v1/payments?select=id&user_id=eq.${user.id}&status=eq.PENDING&created_at=gte.${since}`);
    if (recent.ok && Array.isArray(recent.json) && recent.json.length >= 5) {
      return res.status(429).json({ error: 'Too many attempts. Please wait a little and try again.' });
    }

    const reference = 'PL_' + crypto.randomUUID().replace(/-/g, '');
    const prep = await rpc('paystack_prepare', { p_user: user.id, p_interval: interval, p_reference: reference });
    if (!prep.ok || !Array.isArray(prep.json) || !prep.json[0]) return res.status(400).json({ error: 'Could not start payment.' });
    const { amount, currency } = prep.json[0];

    const init = await paystack('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(Number(amount) * 100),   // pesewas
        currency,
        reference,
        callback_url: `${SITE}/membership.html`,
        metadata: { user_id: user.id, interval },
      }),
    });
    if (!init.ok || !init.json || !init.json.status) {
      await rpc('paystack_fail', { p_reference: reference, p_reason: 'initialize_failed' });
      return res.status(502).json({ error: 'Payment provider is unavailable. Please try again.' });
    }
    return res.status(200).json({ url: init.json.data.authorization_url, reference });
  } catch (e) {
    console.error('paystack-initialize', e && e.message);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
};