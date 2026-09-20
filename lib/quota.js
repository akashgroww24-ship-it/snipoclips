// lib/quota.js
// Enforces plan limits server-side. Coupon access is checked in the database
// before EVERY profile read; expiry cannot be bypassed with stale client state.
const { admin } = require('./supabase');

const FREE_LIMIT = Number(process.env.FREE_CLIP_LIMIT || 2);
const numEnv = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);
const PLANS = {
  free:   { limit: FREE_LIMIT, lifetime: true,  maxUploadMin: numEnv('FREE_MAX_UPLOAD_MIN',   30), monthlyMin: numEnv('FREE_MONTHLY_MIN',     60) },
  single: { limit: 10, lifetime: false, maxUploadMin: numEnv('SINGLE_MAX_UPLOAD_MIN', 90), monthlyMin: numEnv('SINGLE_MONTHLY_MIN', 300) },
  half:   { limit: 30, lifetime: false, maxUploadMin: numEnv('HALF_MAX_UPLOAD_MIN', 150), monthlyMin: numEnv('HALF_MONTHLY_MIN', 900) },
  full:   { limit: 100, lifetime: false, maxUploadMin: numEnv('FULL_MAX_UPLOAD_MIN', 180), monthlyMin: numEnv('FULL_MONTHLY_MIN', 3000) }
};
function planOf(name) { return PLANS[name] || PLANS.free; }

async function getProfile(userId) {
  // The SECURITY DEFINER function takes a row lock and atomically restores
  // free-plan usage when a complimentary grant expires. Only service_role
  // can call it; never derive a plan from a browser-provided coupon.
  const refreshed = await admin.rpc('refresh_promo_access', { p_user: userId });
  if (refreshed.error) {
    console.error('[quota] promo expiry verification failed:', refreshed.error.message);
    throw new Error('Cannot verify current account access');
  }
  const { data, error } = await admin.from('profiles').select('*').eq('id', userId).single();
  if (error && error.code !== 'PGRST116') throw error;
  return data || { id: userId, plan: 'free', clips_used: 0, minutes_used: 0, period_start: new Date().toISOString().slice(0, 10) };
}

async function maybeReset(userId, p, plan) {
  const now = new Date();
  const start = new Date(p.period_start || now);
  const rolled = now.getMonth() !== start.getMonth() || now.getFullYear() !== start.getFullYear();
  if (!rolled) return p;
  const upd = { minutes_used: 0, period_start: now.toISOString().slice(0, 10) };
  if (!plan.lifetime) upd.clips_used = 0;
  const { error } = await admin.from('profiles').update(upd).eq('id', userId);
  if (error) throw error;
  return { ...p, ...upd, clips_used: plan.lifetime ? p.clips_used : 0 };
}

async function checkQuota(userId, want = 1) {
  let p = await getProfile(userId);
  const plan = planOf(p.plan);
  p = await maybeReset(userId, p, plan);
  const used = p.clips_used || 0;
  const remaining = plan.limit === Infinity ? Infinity : Math.max(0, plan.limit - used);
  return { ok: remaining >= want, remaining, limit: plan.limit, used, plan: p.plan, lifetime: plan.lifetime,
    promoExpiresAt: p.promo_expires_at || null };
}

function minuteDecision(plan, minutesUsed, videoMinutes) {
  const v = Math.max(0, Number(videoMinutes) || 0);
  const used = Math.max(0, Number(minutesUsed) || 0);
  const perUpload = plan.maxUploadMin;
  const monthly = plan.monthlyMin;
  const remaining = monthly === Infinity ? Infinity : Math.max(0, +(monthly - used).toFixed(2));
  if (perUpload !== Infinity && v > perUpload) return { ok: false, reason: 'per_upload', remaining, perUpload, monthly, used, video: v };
  if (monthly !== Infinity && used + v > monthly) return { ok: false, reason: 'monthly', remaining, perUpload, monthly, used, video: v };
  return { ok: true, reason: null, remaining, perUpload, monthly, used, video: v };
}

async function checkMinutes(userId, videoMinutes = 0) {
  let p = await getProfile(userId);
  const plan = planOf(p.plan);
  p = await maybeReset(userId, p, plan);
  return { ...minuteDecision(plan, p.minutes_used || 0, videoMinutes), plan: p.plan };
}

async function recordUsage(userId, count) {
  const p = await getProfile(userId);
  const { error } = await admin.from('profiles').update({ clips_used: (p.clips_used || 0) + count }).eq('id', userId);
  if (error) throw error;
}
async function recordMinutes(userId, minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  if (!m) return;
  const p = await getProfile(userId);
  const { error } = await admin.from('profiles').update({ minutes_used: +(((p.minutes_used || 0) + m)).toFixed(2) }).eq('id', userId);
  if (error) throw error;
}

module.exports = { checkQuota, recordUsage, getProfile, checkMinutes, recordMinutes, minuteDecision, planOf, PLANS, FREE_LIMIT };
