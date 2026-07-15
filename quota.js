// lib/quota.js
// Enforces plan limits SERVER-SIDE. The browser cannot be trusted to do this.
//
// TWO limits per plan, because they guard two different costs:
//   1. CLIPS  — output count (what the user gets).
//   2. MINUTES of input video — what actually costs us money (Whisper is billed
//      per input minute, and ffmpeg/Claude work scales with length too). Without
//      a minute cap a user could upload a 3-hour video for 2 clips and burn far
//      more compute than the plan pays for. So each plan also has:
//        - maxUploadMin : hard cap on the length of a SINGLE upload
//        - monthlyMin   : total input minutes allowed per billing cycle
//
// Free is a LIFETIME trial for clips (default 2, set FREE_CLIP_LIMIT). Minute
// limits reset monthly for every plan. All numbers live here so one edit
// updates the whole app. Any limit can be overridden by env (see below).
const { admin } = require('./supabase');

const FREE_LIMIT = Number(process.env.FREE_CLIP_LIMIT || 2);
const numEnv = (k, d) => (process.env[k] != null && process.env[k] !== '' ? Number(process.env[k]) : d);

// clip `limit`: number = cap, Infinity = unlimited. `lifetime`: counts forever.
// `maxUploadMin`: per-upload minute cap. `monthlyMin`: minutes per cycle.
const PLANS = {
  free:   { limit: FREE_LIMIT, lifetime: true,  maxUploadMin: numEnv('FREE_MAX_UPLOAD_MIN',   30), monthlyMin: numEnv('FREE_MONTHLY_MIN',     60) },
  single: { limit: 10,  lifetime: false,         maxUploadMin: numEnv('SINGLE_MAX_UPLOAD_MIN', 90), monthlyMin: numEnv('SINGLE_MONTHLY_MIN',  300) },
  half:   { limit: 30,  lifetime: false,         maxUploadMin: numEnv('HALF_MAX_UPLOAD_MIN',  150), monthlyMin: numEnv('HALF_MONTHLY_MIN',    900) },
  full:   { limit: 100, lifetime: false,         maxUploadMin: numEnv('FULL_MAX_UPLOAD_MIN',  180), monthlyMin: numEnv('FULL_MONTHLY_MIN',    3000) }
};

function planOf(name) { return PLANS[name] || PLANS.free; }

// Returns the user's profile, creating sane defaults if missing.
async function getProfile(userId) {
  const { data } = await admin.from('profiles').select('*').eq('id', userId).single();
  return data || { id: userId, plan: 'free', clips_used: 0, minutes_used: 0, period_start: new Date().toISOString().slice(0, 10) };
}

// If we've crossed into a new calendar month, reset the per-cycle counters
// (clips for paid plans + minutes for everyone). Returns the profile with
// counters already zeroed in-memory so callers see fresh numbers immediately.
// Reused by every quota check so the reset logic exists in exactly one place.
async function maybeReset(userId, p, plan) {
  const now = new Date();
  const start = new Date(p.period_start || now);
  const rolled = now.getMonth() !== start.getMonth() || now.getFullYear() !== start.getFullYear();
  if (!rolled) return p;
  const upd = { minutes_used: 0, period_start: now.toISOString().slice(0, 10) };
  if (!plan.lifetime) upd.clips_used = 0;   // free clips are lifetime; don't refill them
  await admin.from('profiles').update(upd).eq('id', userId);
  return { ...p, ...upd, clips_used: plan.lifetime ? p.clips_used : 0 };
}

// ---- CLIP quota ----
// True if the user still has clips left. Free = lifetime cap; paid = monthly cap.
async function checkQuota(userId, want = 1) {
  let p = await getProfile(userId);
  const plan = planOf(p.plan);
  p = await maybeReset(userId, p, plan);
  const used = p.clips_used || 0;
  const remaining = plan.limit === Infinity ? Infinity : Math.max(0, plan.limit - used);
  return { ok: remaining >= want, remaining, limit: plan.limit, used, plan: p.plan, lifetime: plan.lifetime };
}

// ---- MINUTE quota (pure decision, unit-testable without a DB) ----
// Given the plan + minutes already used this cycle + this video's length,
// decide whether the upload is allowed and why not.
function minuteDecision(plan, minutesUsed, videoMinutes) {
  const v = Math.max(0, Number(videoMinutes) || 0);
  const used = Math.max(0, Number(minutesUsed) || 0);
  const perUpload = plan.maxUploadMin;
  const monthly = plan.monthlyMin;
  const remaining = monthly === Infinity ? Infinity : Math.max(0, +(monthly - used).toFixed(2));
  if (perUpload !== Infinity && v > perUpload) {
    return { ok: false, reason: 'per_upload', remaining, perUpload, monthly, used, video: v };
  }
  if (monthly !== Infinity && used + v > monthly) {
    return { ok: false, reason: 'monthly', remaining, perUpload, monthly, used, video: v };
  }
  return { ok: true, reason: null, remaining, perUpload, monthly, used, video: v };
}

// DB-backed wrapper around minuteDecision. `videoMinutes` may be undefined at
// the route (URL uploads, length unknown until download) — pass 0 to check only
// the remaining monthly balance without the per-upload test.
async function checkMinutes(userId, videoMinutes = 0) {
  let p = await getProfile(userId);
  const plan = planOf(p.plan);
  p = await maybeReset(userId, p, plan);
  return { ...minuteDecision(plan, p.minutes_used || 0, videoMinutes), plan: p.plan };
}

// ---- record usage ----
// Call after clips are produced.
async function recordUsage(userId, count) {
  const p = await getProfile(userId);
  await admin.from('profiles').update({ clips_used: (p.clips_used || 0) + count }).eq('id', userId);
}

// Call once we've committed to transcribing a video (that's when the input-minute
// cost is incurred), regardless of how many clips come out.
async function recordMinutes(userId, minutes) {
  const m = Math.max(0, Number(minutes) || 0);
  if (!m) return;
  const p = await getProfile(userId);
  await admin.from('profiles').update({ minutes_used: +(((p.minutes_used || 0) + m)).toFixed(2) }).eq('id', userId);
}

module.exports = {
  checkQuota, recordUsage, getProfile,
  checkMinutes, recordMinutes, minuteDecision, planOf,
  PLANS, FREE_LIMIT
};
