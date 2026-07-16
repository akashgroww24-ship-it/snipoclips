// routes/billing.js — plan catalog + Dodo Payments hosted checkout.
const express = require('express');
const { requireUser } = require('../lib/requireUser');
const { CATALOG } = require('../lib/plans');
const { admin } = require('../lib/supabase');

const router = express.Router();
const DODO_BASE = (process.env.DODO_MODE === 'live') ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';

router.get('/plans', (req, res) => res.json({ plans: CATALOG }));

router.get('/billing/providers', (req, res) => {
  res.json({ dodo: !!process.env.DODO_API_KEY, mode: process.env.DODO_MODE === 'live' ? 'live' : 'test' });
});

// Start a Dodo hosted checkout for a paid plan; returns { url } to redirect to.
router.post('/checkout', requireUser, express.json(), async (req, res) => {
  const { planId } = req.body || {};
  const plan = CATALOG.find(p => p.id === planId);
  if (!plan || plan.id === 'free') return res.status(400).json({ error: 'Pick a paid plan.' });
  if (!process.env.DODO_API_KEY) return res.status(501).json({ error: 'Payments are not configured yet.' });
  const PRODUCTS = {
    single: process.env.DODO_PRODUCT_SINGLE,
    half:   process.env.DODO_PRODUCT_HALF,
    full:   process.env.DODO_PRODUCT_FULL
  };
  const productId = PRODUCTS[planId];
  if (!productId) return res.status(400).json({ error: 'No product configured for this plan.' });
  try {
    const r = await fetch(DODO_BASE + '/checkouts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + process.env.DODO_API_KEY },
      body: JSON.stringify({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { email: req.user.email },
        return_url: (process.env.PUBLIC_URL || 'https://snipoclip.com') + '/app',
        metadata: { user_id: String(req.user.id), plan: planId }
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: (data && (data.message || data.error)) || 'Checkout failed.' });
    const url = data.checkout_url || data.url || (data.data && data.data.checkout_url) || data.payment_link;
    if (!url) return res.status(502).json({ error: 'No checkout URL returned.' });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: 'Checkout error — please try again.' }); }
});

// Open Dodo's customer portal so the user can manage / cancel their subscription.
router.post('/billing/portal', requireUser, express.json(), async (req, res) => {
  if (!process.env.DODO_API_KEY) return res.status(501).json({ error: 'Payments not configured.' });
  try {
    const { data: prof } = await admin.from('profiles').select('dodo_customer_id').eq('id', req.user.id).single();
    const cid = prof && prof.dodo_customer_id;
    if (!cid) return res.status(400).json({ error: 'No active subscription to manage.' });
    const r = await fetch(DODO_BASE + '/customers/' + encodeURIComponent(cid) + '/customer-portal/session', {
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + process.env.DODO_API_KEY, 'content-type': 'application/json' },
      body: '{}'
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: (data && (data.message || data.error)) || 'Could not open the billing portal.' });
    const url = data.link || data.url || data.portal_url || (data.data && data.data.link);
    if (!url) return res.status(502).json({ error: 'No portal link returned.' });
    res.json({ url });
  } catch (e) { res.status(500).json({ error: 'Portal error - try again.' }); }
});

module.exports = router;
