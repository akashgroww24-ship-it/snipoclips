// routes/youtube.js — connect a YouTube channel (OAuth) and one-click upload
// clips as Shorts. Tokens are stored encrypted; secrets never reach the browser.
const express = require('express');
const jwt = require('jsonwebtoken');
const { requireUser } = require('../lib/requireUser');
const { admin } = require('../lib/supabase');
const yt = require('../lib/youtube');
const box = require('../lib/secretbox');

const router = express.Router();
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';
const MAX_ATTEMPTS = 3;

// ---- connection status (also tells the UI whether the feature is set up) ----
router.get('/youtube/status', requireUser, async (req, res) => {
  if (!yt.configured()) return res.json({ configured: false, connected: false });
  const { data } = await admin.from('youtube_accounts').select('channel_id,channel_title,channel_thumb').eq('user_id', req.user.id).single();
  res.json({ configured: true, connected: !!data, channel: data || null });
});

// ---- step 1: hand the browser a Google consent URL (state ties it to the user) ----
router.post('/youtube/connect', requireUser, async (req, res) => {
  if (!yt.configured()) return res.status(501).json({ error: 'YouTube upload is not configured on this server yet.' });
  const state = jwt.sign({ uid: req.user.id, n: Math.random().toString(36).slice(2) }, process.env.JWT_SECRET, { expiresIn: '10m' });
  res.json({ url: yt.authUrl(state, yt.redirectUri(req)) });
});

// ---- step 2: Google redirects here with ?code&state (public route, no bearer) ----
router.get('/youtube/callback', async (req, res) => {
  const done = (ok, msg) => res.redirect(`/app?yt=${ok ? 'connected' : 'error'}${msg ? '&msg=' + encodeURIComponent(msg) : ''}`);
  try {
    if (req.query.error) return done(false, String(req.query.error));
    const { code, state } = req.query;
    if (!code || !state) return done(false, 'missing code');
    let uid;
    try { uid = jwt.verify(String(state), process.env.JWT_SECRET).uid; } catch { return done(false, 'invalid state'); }

    const tok = await yt.exchangeCode(String(code), yt.redirectUri(req));
    const channel = await yt.getChannel(tok.access_token).catch(() => null);
    const row = {
      user_id: uid,
      channel_id: channel ? channel.id : null,
      channel_title: channel ? channel.title : null,
      channel_thumb: channel ? channel.thumbnail : null,
      enc_access: box.encrypt(tok.access_token),
      expiry: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
      scope: tok.scope || null,
      updated_at: new Date().toISOString()
    };
    // keep any existing refresh token if Google didn't return a new one
    if (tok.refresh_token) row.enc_refresh = box.encrypt(tok.refresh_token);
    await admin.from('youtube_accounts').upsert(row, { onConflict: 'user_id' });
    done(true);
  } catch (e) {
    done(false, (e.message || 'connect failed').slice(0, 120));
  }
});

router.post('/youtube/disconnect', requireUser, async (req, res) => {
  await admin.from('youtube_accounts').delete().eq('user_id', req.user.id);
  res.json({ ok: true });
});

// Return a valid (refreshed if needed) access token for this user, or null.
async function accessTokenFor(userId) {
  const { data: acct } = await admin.from('youtube_accounts').select('*').eq('user_id', userId).single();
  if (!acct) return null;
  const expired = !acct.expiry || (new Date(acct.expiry).getTime() - Date.now() < 60 * 1000);
  if (!expired && acct.enc_access) {
    try { return box.decrypt(acct.enc_access); } catch { /* fall through to refresh */ }
  }
  if (!acct.enc_refresh) return null; // can't refresh — user must reconnect
  const refreshToken = box.decrypt(acct.enc_refresh);
  const fresh = await yt.refresh(refreshToken);
  const enc_access = box.encrypt(fresh.access_token);
  await admin.from('youtube_accounts').update({
    enc_access, expiry: new Date(Date.now() + (fresh.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString()
  }).eq('user_id', userId);
  return fresh.access_token;
}

// ---- one-click upload (with safe retry) ----
router.post('/youtube/upload', requireUser, express.json(), async (req, res) => {
  if (!yt.configured()) return res.status(501).json({ error: 'YouTube upload is not configured on this server yet.' });
  const b = req.body || {};
  const clipId = b.clipId;
  if (!clipId) return res.status(400).json({ error: 'clipId required' });

  // verify the clip belongs to this user
  const { data: clip } = await admin.from('clips').select('id,user_id,title,storage_path,social_caption,hashtags').eq('id', clipId).eq('user_id', req.user.id).single();
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  // don't allow a second successful upload of the same clip; allow retry of errors
  const { data: prior } = await admin.from('youtube_uploads').select('id,status,attempts,video_id').eq('clip_id', clipId).eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(1).single();
  if (prior && prior.status === 'done') return res.status(409).json({ error: 'This clip is already on YouTube.', videoId: prior.video_id });
  if (prior && prior.status === 'uploading') return res.status(409).json({ error: 'This clip is already uploading.' });
  if (prior && prior.attempts >= MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many failed attempts for this clip. Please reconnect or try later.' });

  const token = await accessTokenFor(req.user.id).catch(() => null);
  if (!token) return res.status(401).json({ error: 'Connect (or reconnect) your YouTube account first.' });

  const privacy = ['public', 'unlisted', 'private'].includes(b.privacy) ? b.privacy : 'private';
  const title = (b.title || clip.title || 'Clip').toString().slice(0, 100);
  const description = (b.description || clip.social_caption || '').toString().slice(0, 4900);
  const tags = Array.isArray(b.tags) ? b.tags : (clip.hashtags ? String(clip.hashtags).replace(/#/g, '').split(/\s+/).filter(Boolean) : []);
  const publishAt = typeof b.publishAt === 'string' && b.publishAt ? b.publishAt : null;

  // reuse the prior row on retry, else create one
  let uploadId = prior && prior.status === 'error' ? prior.id : null;
  if (uploadId) {
    await admin.from('youtube_uploads').update({ status: 'uploading', error: null, attempts: (prior.attempts || 0) + 1, privacy, updated_at: new Date().toISOString() }).eq('id', uploadId);
  } else {
    const { data: ins } = await admin.from('youtube_uploads').insert({ user_id: req.user.id, clip_id: clipId, status: 'uploading', attempts: 1, privacy }).select('id').single();
    uploadId = ins && ins.id;
  }

  try {
    const { data: dl, error: dlErr } = await admin.storage.from(CLIPS_BUCKET).download(clip.storage_path);
    if (dlErr || !dl) throw new Error('Clip file unavailable');
    const bytes = Buffer.from(await dl.arrayBuffer());
    const { videoId } = await yt.uploadVideo(token, { bytes, title, description, tags, privacyStatus: privacy, publishAt });
    await admin.from('youtube_uploads').update({ status: 'done', video_id: videoId, error: null, updated_at: new Date().toISOString() }).eq('id', uploadId);
    res.json({ ok: true, status: 'done', videoId, url: `https://youtube.com/watch?v=${videoId}` });
  } catch (e) {
    const msg = (e.message || 'upload failed').toString().slice(0, 300);
    if (uploadId) await admin.from('youtube_uploads').update({ status: 'error', error: msg, updated_at: new Date().toISOString() }).eq('id', uploadId);
    res.status(502).json({ error: msg, status: 'error' });
  }
});

// ---- upload status for a clip (UI polling / retry button) ----
router.get('/youtube/uploads', requireUser, async (req, res) => {
  const clipId = req.query.clipId;
  let q = admin.from('youtube_uploads').select('id,clip_id,video_id,status,error,attempts,privacy,created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
  if (clipId) q = q.eq('clip_id', clipId);
  const { data } = await q;
  res.json({ uploads: data || [] });
});

module.exports = router;
