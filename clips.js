// routes/clips.js
const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { requireUser } = require('../lib/requireUser');
const { checkQuota, checkMinutes } = require('../lib/quota');
const { admin } = require('../lib/supabase');
const { processJob, renderEdit, probeDuration, activeJobs, maxConcurrency } = require('../lib/pipeline');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// SSRF GUARD: the videoUrl is handed to yt-dlp, which will fetch ANY URL —
// including internal services, cloud metadata (169.254.169.254) and file://.
// Only allow http/https to public hosts; reject loopback/private/link-local.
function isSafePublicUrl(u) {
  let url; try { url = new URL(String(u)); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (host === 'metadata.google.internal' || host === '169.254.169.254') return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a=+v4[1], b=+v4[2];
    if (a===0||a===10||a===127) return false;            // this-host / private / loopback
    if (a===169 && b===254) return false;                 // link-local + metadata
    if (a===172 && b>=16 && b<=31) return false;          // private
    if (a===192 && b===168) return false;                 // private
    if (a===100 && b>=64 && b<=127) return false;         // CGNAT
    if (a>=224) return false;                             // multicast/reserved
  }
  if (host.includes(':')) {                                // IPv6 literal
    if (host==='::1'||host.startsWith('fc')||host.startsWith('fd')||host.startsWith('fe80')||host.startsWith('::ffff:')) return false;
  }
  return true;
}

// Anti-abuse: cap how many generate requests one user can fire per hour.
const genLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.GEN_PER_HOUR || '15', 10),
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) ? req.user.id : req.ip,
  message: { error: 'Too many videos this hour — please slow down and try again later.' }
});

const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
fs.mkdirSync(TMP, { recursive: true });
const upload = multer({ dest: TMP, limits: { fileSize: 1024 * 1024 * 1024 } }); // 1GB cap
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';

async function sign(p) {
  const { data } = await admin.storage.from(CLIPS_BUCKET).createSignedUrl(p, 60 * 60 * 24 * 7);
  return data ? data.signedUrl : null;
}

// Create a clipping job (file upload OR video URL).
router.post('/jobs', requireUser, genLimit, upload.single('video'),
  body('videoUrl').optional({ checkFalsy: true }).isURL(),
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'Provide a valid video URL or file' });
    const filePath = req.file ? req.file.path : null;
    const videoUrl = req.body.videoUrl || null;
    const prompt = (req.body.prompt || '').toString().slice(0, 800);
    const duration = ['auto','short','medium','long'].includes(req.body.duration) ? req.body.duration : 'auto';
    const count = Math.min(12, Math.max(1, parseInt(req.body.count, 10) || 8));
    const captionStyle = ['classic','white','green','pink'].includes(req.body.captionStyle) ? req.body.captionStyle : 'classic';
    const enhance = req.body.enhance === '1' || req.body.enhance === 'true' || req.body.enhance === true;
    const broll = req.body.broll === '1' || req.body.broll === 'true' || req.body.broll === true;
    const ratio = ['9:16','1:1','16:9','4:5'].includes(req.body.ratio) ? req.body.ratio : '9:16';
    const hook = req.body.hook === '1' || req.body.hook === 'true' || req.body.hook === true;
    const fillers = req.body.fillers === '1' || req.body.fillers === 'true' || req.body.fillers === true;
    const tru = v => v === '1' || v === 'true' || v === true;
    const highlight = tru(req.body.highlight);
    const progress = tru(req.body.progress);
    const faceTrack = tru(req.body.faceTrack);
    const emoji = tru(req.body.emoji);
    // Karaoke captions default ON (the current viral look); explicit '0' turns
    // them off for clean static lines.
    const karaoke = req.body.karaoke === undefined ? true : tru(req.body.karaoke);
    // Language: 'auto' (default) lets Whisper detect; a 2-letter ISO code
    // (e.g. 'hi','en') forces it. Not hardcoded to any single language.
    const langRaw = (req.body.language || 'auto').toString().toLowerCase();
    const language = /^[a-z]{2}$/.test(langRaw) ? langRaw : undefined;
    if (!filePath && !videoUrl) return res.status(400).json({ error: 'Upload a file or paste a video URL' });
    if (videoUrl && !isSafePublicUrl(videoUrl)) {
      if (filePath) fs.rmSync(filePath, { force: true });
      return res.status(400).json({ error: 'That link is not allowed. Paste a public video URL (YouTube, Vimeo, TikTok, etc.).' });
    }

    // Concurrency gate — protect the box (and your AI spend) from pile-ups.
    if (activeJobs() >= maxConcurrency) {
      if (filePath) fs.rmSync(filePath, { force: true });
      return res.status(429).json({ error: 'Server is busy rendering right now — please try again in a minute.' });
    }
    // SERVER-SIDE quota check — never trust the client for this.
    const q = await checkQuota(req.user.id, 1);
    if (!q.ok) {
      if (filePath) fs.rmSync(filePath, { force: true });
      return res.status(402).json({ error: `Monthly limit reached on the ${q.plan} plan. Upgrade to make more clips.` });
    }

    // Plan-aware MINUTE check. For file uploads we can measure length right here
    // and reject before creating a job (URL uploads are checked in processJob
    // once downloaded, since length isn't known until then). This is the
    // per-upload-length and monthly-minute guard from Feature 1.
    if (filePath) {
      let vmin = 0;
      try { const d = await probeDuration(filePath); vmin = d ? d / 60 : 0; } catch {}
      if (vmin > 0) {
        const mq = await checkMinutes(req.user.id, vmin);
        if (!mq.ok) {
          fs.rmSync(filePath, { force: true });
          const msg = mq.reason === 'per_upload'
            ? `This video is ${Math.round(vmin)} min. Your ${mq.plan} plan allows up to ${mq.perUpload} min per upload.`
            : `Not enough monthly minutes left on the ${mq.plan} plan — ${Math.round(mq.remaining)} min remaining, this video is ${Math.round(vmin)} min.`;
          return res.status(402).json({ error: msg });
        }
      }
    }

    // Cap clips for THIS job to whatever the plan has left, so a single job can
    // never exceed the quota (a free 2-clip user must not get 8 clips at once).
    const remaining = (q.remaining === Infinity || q.remaining === 'unlimited') ? count : Math.max(1, q.remaining);
    const effCount = Math.min(count, remaining);

    const { data: job, error } = await admin.from('jobs')
      .insert({ user_id: req.user.id, source_url: videoUrl, status: 'queued', stage: 'queued' })
      .select().single();
    if (error) return res.status(500).json({ error: 'Could not create job' });

    // Process asynchronously (in-process worker; swap for a queue at scale).
    setImmediate(() => processJob(job, { filePath, videoUrl, prompt, duration, count: effCount, captionStyle, enhance, broll, ratio, hook, fillers, highlight, progress, faceTrack, emoji, karaoke, language }));
    res.json({ jobId: job.id });
  }
);

// List the signed-in user's jobs (most recent first).
router.get('/jobs', requireUser, async (req, res) => {
  const { data } = await admin.from('jobs').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
  res.json({ jobs: data || [] });
});

// Job status + its clips (with fresh signed URLs).
router.get('/jobs/:id', requireUser, async (req, res) => {
  const { data: job } = await admin.from('jobs').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!job) return res.status(404).json({ error: 'Job not found' });
  const { data: clips } = await admin.from('clips').select('*').eq('job_id', job.id).order('score', { ascending: false });
  const withUrls = await Promise.all((clips || []).map(async c => ({ ...c, url: await sign(c.storage_path) })));
  res.json({ job, clips: withUrls });
});

// All of the user's clips.
router.get('/clips', requireUser, async (req, res) => {
  const COLS_NEW = 'id,title,score,storage_path,start_sec,end_sec,created_at,master_path,edit,social_caption,hashtags';
  const COLS_OLD = 'id,title,score,storage_path,start_sec,end_sec,created_at,master_path,edit';
  let { data: clips, error } = await admin.from('clips').select(COLS_NEW).eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(200);
  if (error) {  // caption/hashtags migration not run yet — fall back so the list still works
    const r = await admin.from('clips').select(COLS_OLD).eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(200);
    clips = r.data;
  }
  const withUrls = await Promise.all((clips || []).map(async c => ({ ...c, url: await sign(c.storage_path) })));
  res.json({ clips: withUrls });
});

// Caption text for the editor (fetched on demand so the clips list stays light).
router.get('/clips/:id/text', requireUser, async (req, res) => {
  const { data: clip } = await admin.from('clips').select('words').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!clip) return res.status(404).json({ error: 'Not found' });
  res.json({ text: (clip.words || []).map(w => w.word).join(' ') });
});

// Current plan + remaining quota for the UI.
router.get('/me', requireUser, async (req, res) => {
  const q = await checkQuota(req.user.id, 1);
  const m = await checkMinutes(req.user.id, 0); // 0 = balance only, no per-upload test
  res.json({
    email: req.user.email,
    plan: q.plan,
    used: q.used,
    lifetime: q.lifetime,
    remaining: q.remaining === Infinity ? 'unlimited' : q.remaining,
    limit: q.limit === Infinity ? 'unlimited' : q.limit,
    minutes: {
      used: Math.round(m.used),
      monthly: m.monthly === Infinity ? 'unlimited' : m.monthly,
      remaining: m.remaining === Infinity ? 'unlimited' : Math.round(m.remaining),
      maxUpload: m.perUpload === Infinity ? 'unlimited' : m.perUpload
    }
  });
});

// Re-render a clip with new caption style (the in-app editor).
router.post('/clips/:id/restyle', requireUser, express.json(), async (req, res) => {
  const { data: clip } = await admin.from('clips').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (!clip.master_path || !clip.words) return res.status(400).json({ error: 'This clip predates the editor — regenerate it to enable editing.' });
  const b = req.body || {};
  const cur = clip.edit || {};
  const truthy = v => v === true || v === '1' || v === 1;
  const edit = {
    captionStyle: ['classic','white','green','pink'].includes(b.captionStyle) ? b.captionStyle : (cur.captionStyle || 'classic'),
    font: (typeof b.font === 'string' && b.font.trim()) ? b.font.trim().slice(0, 40) : (cur.font || 'Noto Sans Devanagari'),
    fontSize: Math.min(140, Math.max(40, parseInt(b.fontSize, 10) || cur.fontSize || 74)),
    position: ['bottom','middle','top'].includes(b.position) ? b.position : (cur.position || 'bottom'),
    upper: truthy(b.upper), emoji: truthy(b.emoji), animate: truthy(b.animate),
    ratio: (cur.ratio || '9:16'),
    hook: truthy(b.hook),
    highlight: truthy(b.highlight),
    progress: truthy(b.progress),
    // keep the clip's existing karaoke setting unless the request overrides it
    karaoke: (b.karaoke === undefined) ? (cur.karaoke === undefined ? true : !!cur.karaoke) : truthy(b.karaoke),
    hookText: ((typeof b.hookText === 'string' ? b.hookText : (cur.hookText || clip.title || '')) || '').toString().slice(0, 90),
    plan: 'free'
  };
  try { const { data: prof } = await admin.from('profiles').select('plan').eq('id', req.user.id).single(); if (prof && prof.plan) edit.plan = prof.plan; } catch {}

  // Edited caption text: remap the new words onto the clip's existing timings.
  let words = clip.words;
  if (typeof b.text === 'string' && b.text.trim()) {
    const toks = b.text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 400);
    const orig = clip.words || [];
    if (toks.length && orig.length) {
      if (toks.length === orig.length) {
        words = toks.map((t, i) => ({ word: t.slice(0, 40), start: orig[i].start, end: orig[i].end }));
      } else {
        const t0 = orig[0].start, t1 = orig[orig.length - 1].end, span = Math.max(0.3, t1 - t0), step = span / toks.length;
        words = toks.map((t, i) => ({ word: t.slice(0, 40), start: +(t0 + i * step).toFixed(3), end: +(t0 + (i + 1) * step).toFixed(3) }));
      }
    }
  }
  edit.words = words;

  const work = path.join(TMP, 'edit_' + clip.id + '_' + Date.now());
  fs.mkdirSync(work, { recursive: true });
  try {
    const { data: dl, error: dlErr } = await admin.storage.from(CLIPS_BUCKET).download(clip.master_path);
    if (dlErr || !dl) throw new Error('Master file unavailable');
    const masterFile = path.join(work, 'master.mp4');
    fs.writeFileSync(masterFile, Buffer.from(await dl.arrayBuffer()));

    // Trim: nudge in/out within the ±10s padded master.
    const mdur = (await probeDuration(masterFile)) || ((clip.in_end || 0) + 10);
    const ds = Math.max(-10, Math.min(10, Number(b.trimStart) || 0));
    const de = Math.max(-10, Math.min(10, Number(b.trimEnd) || 0));
    let nis = (clip.in_start || 0) + ds;
    let nie = (clip.in_end || mdur) + de;
    nis = Math.max(0, Math.min(nis, mdur - 1));
    nie = Math.min(mdur, Math.max(nie, nis + 1));
    edit.in_start = +nis.toFixed(3);
    edit.in_end = +nie.toFixed(3);

    const out = await renderEdit(masterFile, words, edit, 0, work);
    const buf = fs.readFileSync(out);
    const { error: upErr } = await admin.storage.from(CLIPS_BUCKET).upload(clip.storage_path, buf, { contentType: 'video/mp4', upsert: true, cacheControl: '0' });
    if (upErr) throw new Error('Re-upload failed: ' + upErr.message);
    const safeEdit = { captionStyle: edit.captionStyle, font: edit.font, fontSize: edit.fontSize, position: edit.position, upper: edit.upper, emoji: edit.emoji, animate: edit.animate, ratio: edit.ratio, hook: edit.hook, hookText: edit.hookText, highlight: edit.highlight, progress: edit.progress };
    await admin.from('clips').update({ edit: safeEdit, words, in_start: edit.in_start, in_end: edit.in_end }).eq('id', clip.id);
    res.json({ ok: true, url: await sign(clip.storage_path), edit: safeEdit });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e).slice(0, 300) });
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
});

// ---- In-app AI help assistant ----
const chatLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.CHAT_PER_HOUR || '40', 10),
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user && req.user.id) ? req.user.id : req.ip,
  message: { error: 'Too many messages this hour — please wait a bit.' }
});
const HELP_SYSTEM = `You are Snipo, the friendly in-app help assistant for Snipoclip (snipoclip.com), an AI tool that turns long videos into short vertical clips.
How it works: on the Create page the user pastes a video link (YouTube, Vimeo, Twitch, Facebook, etc.) or uploads a file, optionally types a description of the clips they want, picks clip length (Short/Medium/Long), number of clips, caption colour, Audio (AI enhance) and B-roll, then clicks Generate. The AI finds the best moments and makes 9:16 vertical clips with karaoke word-by-word captions (many languages incl. Hindi + English) and a 0-100 virality score. Clips appear under "My clips": play, Download, Copy caption, Edit captions (font/size/colour/position), select multiple + Download selected. Clips auto-delete after 30 days.
Plans (monthly; yearly is cheaper): Free = 2 trial clips (watermarked, 720p); Single Slice $12.49/mo = 10 clips/month with captions + editor; Half Pie $24.99/mo = 30 clips/month, no watermark up to 1080p, AI B-roll + audio enhance (most popular); Full Pie $49.99/mo = 100 clips/month, up to 4K, cinematic B-roll, priority processing. Subscriptions renew monthly and can be cancelled anytime via "Manage subscription".
Tips: if a link fails it's usually temporary, try again; longer videos take a few minutes to process.
Style: reply short, warm, simple, practical. If the user describes a bug or something broken, tell them to tap the "Report a bug" link at the bottom of this chat so the team gets it. Never invent features that don't exist.`;

router.post('/chat', requireUser, chatLimit, express.json(), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'Help assistant is not configured.' });
  const raw = Array.isArray(req.body && req.body.messages) ? req.body.messages.slice(-12) : [];
  const messages = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'Ask a question first.' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.CHAT_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6', max_tokens: 500, system: HELP_SYSTEM, messages })
    });
    if (!r.ok) return res.status(502).json({ error: 'Assistant unavailable — try again.' });
    const data = await r.json();
    const reply = (data.content || []).map(b => b.text || '').join('').trim();
    res.json({ reply: reply || "Sorry, I didn't catch that — could you rephrase?" });
  } catch (e) { res.status(500).json({ error: 'Assistant error — try again.' }); }
});

// ---- Bug / issue reports ----
router.post('/report', requireUser, express.json(), async (req, res) => {
  const message = String((req.body && req.body.message) || '').slice(0, 2000).trim();
  if (!message) return res.status(400).json({ error: 'Please describe the issue.' });
  const url = String((req.body && req.body.url) || '').slice(0, 300);
  try {
    await admin.from('reports').insert({ user_id: req.user.id, email: req.user.email, message, url });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Could not submit - try again.' }); }
});

// ============================================================
//  BRAND TEMPLATES — save & reuse a bundle of generation settings
// ============================================================
function cleanTemplateSettings(s){
  s = s || {};
  return {
    ratio: ['9:16','1:1','16:9','4:5'].includes(s.ratio) ? s.ratio : '9:16',
    captionStyle: ['classic','white','green','pink'].includes(s.captionStyle) ? s.captionStyle : 'classic',
    hook: !!s.hook, fillers: !!s.fillers, highlight: !!s.highlight, emoji: !!s.emoji,
    broll: !!s.broll, enhance: !!s.enhance, faceTrack: !!s.faceTrack, progress: !!s.progress
  };
}
router.get('/templates', requireUser, async (req, res) => {
  try {
    const { data, error } = await admin.from('templates').select('id,name,settings,created_at').eq('user_id', req.user.id).order('created_at', { ascending: true });
    if (error) return res.json({ templates: [], configured: false });
    res.json({ templates: data || [], configured: true });
  } catch (e) { res.json({ templates: [], configured: false }); }
});
router.post('/templates', requireUser, express.json(), async (req, res) => {
  const name = (String((req.body && req.body.name) || '').slice(0, 60).trim()) || 'My template';
  const settings = cleanTemplateSettings(req.body && req.body.settings);
  try {
    const id = req.body && req.body.id;
    if (id) {
      const { data, error } = await admin.from('templates').update({ name, settings }).eq('id', id).eq('user_id', req.user.id).select('id,name,settings').single();
      if (error) return res.status(500).json({ error: 'Could not save (run the templates migration).' });
      return res.json({ template: data });
    }
    const { data, error } = await admin.from('templates').insert({ user_id: req.user.id, name, settings }).select('id,name,settings').single();
    if (error) return res.status(500).json({ error: 'Could not save (run the templates migration in Supabase).' });
    res.json({ template: data });
  } catch (e) { res.status(500).json({ error: 'Could not save template.' }); }
});
router.delete('/templates/:id', requireUser, async (req, res) => {
  try { await admin.from('templates').delete().eq('id', req.params.id).eq('user_id', req.user.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'Could not delete.' }); }
});

module.exports = router;
