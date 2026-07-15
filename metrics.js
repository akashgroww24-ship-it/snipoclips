// lib/metrics.js
// Builds the admin dashboard payload. Live totals come from Supabase when it's
// configured; historical time-series stays on the bundled sample (real monthly
// aggregation is a heavier job — see TODO). Every payload carries `live: bool`
// so the dashboard can label which numbers are real.
const fs = require('fs');
const path = require('path');
const { admin, ready } = require('./supabase');
const { CATALOG } = require('./plans');

function sample() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed.json'), 'utf8')); }
  catch { return {}; }
}

async function build() {
  const base = sample();
  if (!ready()) return { ...base, live: false };

  try {
    // Live totals (cheap COUNT queries).
    const [{ count: users }, { count: clips }, { count: jobs }] =
      await Promise.all([
        admin.from('profiles').select('*', { count: 'exact', head: true }),
        admin.from('clips').select('*', { count: 'exact', head: true }),
        admin.from('jobs').select('*', { count: 'exact', head: true })
      ]);

    // Plan mix (seed every known plan at 0 so the chart is always complete).
    const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
    const { data: profs } = await admin.from('profiles').select('plan');
    const plans = {};
    CATALOG.forEach(p => { plans[cap(p.id)] = 0; });
    (profs || []).forEach(p => { const k = cap(p.plan || 'free'); plans[k] = (plans[k] || 0) + 1; });

    // Recent signups.
    const { data: recent } = await admin.from('profiles')
      .select('email, plan, clips_used, created_at').order('created_at', { ascending: false }).limit(12);

    // MRR estimate from plan mix (sum across every paid plan in the catalog).
    const mrr = CATALOG.reduce((s, p) => s + (plans[cap(p.id)] || 0) * (p.usd_month || 0), 0);
    const paid = CATALOG.filter(p => p.id !== 'free').reduce((s, p) => s + (plans[cap(p.id)] || 0), 0);

    return {
      ...base,
      live: true,
      updatedAt: new Date().toISOString().slice(0, 10),
      kpis: {
        ...base.kpis,
        mrr, active_users: users || 0, clips_generated: clips || 0,
        paid_conversion: paid, jobs_total: jobs || 0
      },
      plans,
      recent_users: (recent || []).map(u => ({
        name: (u.email || '').split('@')[0],
        email: u.email || '',
        plan: ((u.plan || 'free')[0].toUpperCase() + (u.plan || 'free').slice(1)),
        clips: u.clips_used || 0,
        joined: (u.created_at || '').slice(0, 10),
        source: '—'
      }))
    };
  } catch (e) {
    return { ...base, live: false, error: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { build };
