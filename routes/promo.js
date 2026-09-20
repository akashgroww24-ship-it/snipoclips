'use strict';
const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireUser } = require('../lib/requireUser');
const { requireAdmin } = require('../lib/auth');
const { admin } = require('../lib/supabase');

const router = express.Router();
const redeemLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many coupon attempts. Try again later.' } });
const adminLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const cleanCode = value => String(value || '').trim().toUpperCase();
const hash = code => crypto.createHash('sha256').update(cleanCode(code)).digest('hex');
const validCode = code => /^SNIPO-[A-Z0-9]{6}-[A-Z0-9]{6}-[A-Z0-9]{6}$/.test(code);
const ownOrigin = (req, res, next) => {
  const origin = req.get('origin');
  if (!origin) return next(); // Non-browser API clients still require an admin cookie.
  try { if (new URL(origin).host === req.get('host')) return next(); } catch {}
  return res.status(403).json({ error: 'Invalid request origin.' });
};

router.post('/redeem', requireUser, redeemLimit, async (req, res) => {
  const code = cleanCode(req.body && req.body.code);
  if (!validCode(code)) return res.status(400).json({ error: 'Enter a valid Snipo access code.' });
  if (!admin) return res.status(503).json({ error: 'Access codes are temporarily unavailable.' });
  try {
    const { data, error } = await admin.rpc('redeem_promo', { p_user: req.user.id, p_hash: hash(code) });
    if (error) { console.error('[promo/redeem]', error.message); return res.status(503).json({ error: 'Could not redeem your code right now.' }); }
    if (!data || !data.ok) return res.status(400).json({ error: data && data.error || 'Code not accepted.' });
    return res.json({ ok: true, plan: data.plan, expiresAt: data.expiresAt, message: 'Your complimentary access is active. No card required; it will not auto-renew.' });
  } catch (e) { console.error('[promo/redeem]', e.message); return res.status(503).json({ error: 'Could not redeem your code right now.' }); }
});

router.get('/admin/list', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await admin.from('promo_codes').select('id,label,plan,duration_days,max_uses,used_count,active,redeem_by,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ codes: data || [] });
  } catch (e) { console.error('[promo/list]', e.message); res.status(503).json({ error: 'Could not load access codes.' }); }
});

router.post('/admin/create', requireAdmin, ownOrigin, adminLimit, async (req, res) => {
  const b = req.body || {};
  const plan = String(b.plan || 'half');
  const durationDays = Number(b.durationDays);
  const maxUses = Number(b.maxUses);
  const label = String(b.label || 'Promotion').trim().slice(0, 80) || 'Promotion';
  const redeemBy = b.redeemBy ? new Date(b.redeemBy) : null;
  if (!['single','half','full'].includes(plan) || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365 || !Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000 || (redeemBy && (!Number.isFinite(redeemBy.getTime()) || redeemBy.getTime() <= Date.now()))) {
    return res.status(400).json({ error: 'Choose a plan, a duration of 1–365 days, a redemption limit of 1–10,000 and a future expiry, if provided.' });
  }
  const secret = crypto.randomBytes(9).toString('hex').toUpperCase();
  const code = `SNIPO-${secret.slice(0,6)}-${secret.slice(6,12)}-${secret.slice(12,18)}`;
  try {
    const { data, error } = await admin.from('promo_codes').insert({ code_hash: hash(code), label, plan, duration_days: durationDays, max_uses: maxUses, redeem_by: redeemBy ? redeemBy.toISOString() : null }).select('id,label,plan,duration_days,max_uses,redeem_by').single();
    if (error) throw error;
    // Plaintext is returned ONCE; only a SHA-256 digest is stored in the database.
    return res.status(201).json({ ok: true, code, details: data });
  } catch (e) { console.error('[promo/create]', e.message); res.status(503).json({ error: 'Could not create access code.' }); }
});

router.post('/admin/:id/deactivate', requireAdmin, ownOrigin, adminLimit, async (req, res) => {
  if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid code ID.' });
  try {
    const { data, error } = await admin.from('promo_codes').update({ active: false }).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Code not found.' });
    res.json({ ok: true, note: 'Future redemptions disabled. Existing grants remain active until expiry.' });
  } catch (e) { console.error('[promo/deactivate]', e.message); res.status(503).json({ error: 'Could not deactivate code.' }); }
});

module.exports = router;
