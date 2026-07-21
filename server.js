// ============================================================
//  Snipoclips APP — server
//  cp .env.example .env  →  npm install  →  npm run check  →  npm start
// ============================================================
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');

const db = require('./lib/db');
const { checkAdmin, issueToken, requireAdmin, COOKIE_OPTS } = require('./lib/auth');
const clipsRouter = require('./routes/clips');
const billingRouter = require('./routes/billing');
const youtubeRouter = require('./routes/youtube');
const metrics = require('./lib/metrics');
const { admin: sbAdmin } = require('./lib/supabase');
const { startCleanupScheduler } = require('./lib/cleanup');

db.ensureSeed();
startCleanupScheduler(); // auto-delete clips older than CLIP_RETENTION_DAYS (default 30)

const app = express();
app.set('trust proxy', 1);

// ---------- security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com",
                  "https://connect.facebook.net", "https://www.googletagmanager.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://www.facebook.com", "https://*.google-analytics.com"],
      mediaSrc: ["'self'", "https://*.supabase.co", "blob:"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://*.google-analytics.com", "https://connect.facebook.net"],
      upgradeInsecureRequests: []
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

// ---------- CORS ----------
const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const devLocal = process.env.NODE_ENV !== 'production' || process.env.DEV_TEST_MODE === '1';
const isLocalhost = o => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // same-origin / server-to-server
    if (allowed.includes(origin)) return cb(null, true);
    if (devLocal && isLocalhost(origin)) return cb(null, true); // allow localhost while testing
    return cb(new Error('Origin not allowed'));
  },
  credentials: true
}));

// ---- Dodo Payments webhook (RAW body — registered before express.json) ----
app.post('/api/billing/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  const crypto = require('crypto');
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
    const secret = process.env.DODO_WEBHOOK_SECRET;
    // FAIL CLOSED: without a configured secret we cannot verify authenticity,
    // so we must refuse — otherwise anyone could POST and upgrade any account.
    if (!secret) { console.error('[webhook] DODO_WEBHOOK_SECRET not set — refusing to process'); return res.status(503).send('webhook not configured'); }
    {
      const id = req.get('webhook-id'), ts = req.get('webhook-timestamp'), sh = req.get('webhook-signature');
      if (!id || !ts || !sh) return res.status(401).send('missing headers');
      const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
      const expected = crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + raw.toString('utf8')).digest('base64');
      const provided = sh.split(' ').map(x => x.includes(',') ? x.split(',')[1] : x);
      const ok = provided.some(x => { try { return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(expected)); } catch { return false; } });
      if (!ok) return res.status(401).send('bad signature');
    }
    const evt = JSON.parse(raw.toString('utf8'));
    const type = (evt.type || evt.event_type || '').toLowerCase();
    const d = evt.data || evt;
    const meta = d.metadata || (d.subscription && d.subscription.metadata) || {};
    const userId = meta.user_id, plan = meta.plan;
    const cid = d.customer_id || (d.customer && (d.customer.customer_id || d.customer.id)) || (d.subscription && (d.subscription.customer_id || (d.subscription.customer && d.subscription.customer.customer_id)));
    const activate = /(active|succeeded|completed|paid|renewed)/.test(type) && !/(fail|cancel|refund|expire)/.test(type);
    const deactivate = /(cancel|expired|refund|fail)/.test(type);
    if (sbAdmin && userId) {
      if (activate && ['single','half','full'].includes(plan)) {
        const upd = { plan, clips_used: 0, minutes_used: 0, period_start: new Date().toISOString().slice(0,10) };
        if (cid) upd.dodo_customer_id = cid;
        await sbAdmin.from('profiles').update(upd).eq('id', userId);
      } else if (deactivate) {
        await sbAdmin.from('profiles').update({ plan: 'free' }).eq('id', userId);
      }
    }
    res.json({ received: true });
  } catch (e) { res.status(200).json({ received: true }); }
});

app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// ---------- rate limiters ----------
const globalLimiter = rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false });
const loginLimiter  = rateLimit({ windowMs: 15 * 60_000, max: 8, message: { error: 'Too many login attempts. Try again later.' } });
app.use(globalLimiter);

// ---------- public config (anon key is safe to expose; RLS protects data) ----------
app.get('/api/public-config', (req, res) => res.json({
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
}));

// ---------- end-user app API (auth, quota, pipeline) ----------
app.use('/api', clipsRouter);
app.use('/api', billingRouter);
app.use('/api', youtubeRouter);

// ============================================================
//  ADMIN (separate from end users)
// ============================================================
app.post('/admin/login', loginLimiter,
  body('email').isEmail(), body('password').isLength({ min: 1 }),
  (req, res) => {
    try {
      if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Invalid input' });
      if (!checkAdmin(req.body.email, req.body.password)) return res.status(401).json({ error: 'Wrong email or password' });
      res.cookie('sc_admin', issueToken(req.body.email), COOKIE_OPTS);
      res.json({ ok: true });
    } catch (e) {
      console.error('[admin/login] error: ' + (e.message || e));
      res.status(500).json({ error: 'Login error — check server logs' });
    }
  }
);
app.post('/admin/logout', (req, res) => { res.clearCookie('sc_admin', { path: '/' }); res.json({ ok: true }); });
app.get('/admin/api/metrics', requireAdmin, async (req, res) => res.json(await metrics.build()));

// Real admin stats from Supabase (the numbers that actually exist).
app.get('/admin/api/stats', requireAdmin, async (req, res) => {
  try {
    if (!sbAdmin) return res.json({ configured: false });
    const head = { count: 'exact', head: true };
    const [u, c, j] = await Promise.all([
      sbAdmin.from('profiles').select('*', head),
      sbAdmin.from('clips').select('*', head),
      sbAdmin.from('jobs').select('*', head)
    ]);
    const { data: profs } = await sbAdmin.from('profiles').select('plan, created_at');
    const plans = { free: 0, single: 0, half: 0, full: 0 };
    (profs || []).forEach(p => { plans[p.plan] = (plans[p.plan] || 0) + 1; });
    const days = []; for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    const sgn = Object.fromEntries(days.map(d => [d, 0]));
    (profs || []).forEach(p => { const d = (p.created_at || '').slice(0, 10); if (d in sgn) sgn[d]++; });
    const since14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const { data: clipRows } = await sbAdmin.from('clips').select('created_at').gte('created_at', since14);
    const cpd = Object.fromEntries(days.map(d => [d, 0]));
    (clipRows || []).forEach(x => { const d = (x.created_at || '').slice(0, 10); if (d in cpd) cpd[d]++; });
    let openReports = 0, reports = [];
    try {
      const r = await sbAdmin.from('reports').select('*', head).eq('status', 'open'); openReports = r.count || 0;
      const rr = await sbAdmin.from('reports').select('id,email,message,url,status,created_at').order('created_at', { ascending: false }).limit(25); reports = rr.data || [];
    } catch (e) {}
    res.json({ configured: true, totals: { users: u.count || 0, clips: c.count || 0, jobs: j.count || 0, openReports }, plans, days, signups: days.map(d => sgn[d]), clipsSeries: days.map(d => cpd[d]), reports });
  } catch (e) { res.status(500).json({ error: 'stats failed' }); }
});
// Config status: shows which keys are SET (booleans only — never the values).
app.get('/admin/api/config-status', requireAdmin, (req, res) => {
  const has = k => !!process.env[k];
  res.json({
    supabase: has('SUPABASE_URL') && has('SUPABASE_SERVICE_ROLE_KEY') && has('SUPABASE_ANON_KEY'),
    anthropic: has('ANTHROPIC_API_KEY'),
    groq: has('GROQ_API_KEY'),
    payments: has('DODO_API_KEY') && has('DODO_PRODUCT_SINGLE') && has('DODO_PRODUCT_HALF') && has('DODO_PRODUCT_FULL'),
    email: has('RESEND_API_KEY') || has('SMTP_HOST')
  });
});

// ============================================================
//  DEV TEST MODE — test the clip pipeline with no auth / no Supabase.
//  Enable ONLY locally by setting DEV_TEST_MODE=1 in .env.
//  Leave it OFF in production (it's an unauthenticated AI endpoint).
// ============================================================
if (process.env.DEV_TEST_MODE === '1' && process.env.NODE_ENV !== 'production') {
  const multer = require('multer');
  const os = require('os');
  const { runTestJob } = require('./lib/pipeline');
  const tmp = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
  fs.mkdirSync(tmp, { recursive: true });
  const up = multer({ dest: tmp, limits: { fileSize: 1024 * 1024 * 1024 } });
  const outDir = path.join(__dirname, 'public', 'test-clips');
  fs.mkdirSync(outDir, { recursive: true });

  app.post('/api/test-clip', up.single('video'), async (req, res) => {
    try {
      const source = { filePath: req.file ? req.file.path : null, videoUrl: req.body.videoUrl || null };
      if (!source.filePath && !source.videoUrl) return res.status(400).json({ error: 'Upload a file or paste a URL' });
      const result = await runTestJob(source, outDir);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e.message || e).slice(0, 400) });
    }
  });
  console.log('[dev] TEST MODE on — open /test to try the pipeline (no auth). Turn OFF in production.');
}

// ---------- static (landing, blog, app, dashboard) ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'public/app/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public/app/login.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use((req, res) => res.status(404).send('Not found'));
app.use((err, req, res, next) => { console.error(err.message); res.status(500).json({ error: 'Something went wrong' }); });

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Snipoclips app on :${PORT}`));
