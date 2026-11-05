// POST /api/paystack-webhook  — called by Paystack. Set this URL in the Paystack dashboard.
// Trust chain: valid HMAC signature -> re-verify with Paystack -> amount/currency match -> idempotent activation.
const { configured, verifyAndActivate, safeEqualHex, readRaw, crypto } = require('./_paystack');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured()) return res.status(503).end();
  try {
    const raw = await readRaw(req);
    const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    if (!safeEqualHex(expected, req.headers['x-paystack-signature'])) return res.status(401).end();

    const evt = JSON.parse(raw.toString('utf8'));
    if (evt.event === 'charge.success' && evt.data && typeof evt.data.reference === 'string') {
      const r = await verifyAndActivate(evt.data.reference);
      console.log('paystack-webhook', evt.data.reference, r.state);
    }
    return res.status(200).json({ received: true });   // always 200 for signed events so Paystack stops retrying
  } catch (e) {
    console.error('paystack-webhook', e && e.message);
    return res.status(500).end();                       // lets Paystack retry
  }
};
module.exports.config = { api: { bodyParser: false } };