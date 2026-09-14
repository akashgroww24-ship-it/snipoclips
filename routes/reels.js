const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { requireUser } = require('../lib/requireUser');
const { requireAdmin } = require('../lib/auth');
const { admin } = require('../lib/supabase');
const { createReel, CAPTION_PRESETS } = require('../lib/reel');
const { probeDuration } = require('../lib/pipeline');
const { BUCKET, listTracks, previewUrl, prepareTrackSegment } = require('../lib/music-catalog');

const router = express.Router();
const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
fs.mkdirSync(TMP, { recursive:true });

const audioFilter = (req, file, cb) => {
  const ok = /^audio\//.test(file.mimetype) || /\.(mp3|m4a|aac|wav|ogg)$/i.test(file.originalname || '');
  cb(ok ? null : new Error('Choose an audio file'), ok);
};
const upload = multer({ dest: TMP, limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: audioFilter });
const adminMusicUpload = multer({ dest: TMP, limits: { fileSize: 40 * 1024 * 1024 }, fileFilter: audioFilter });

const reelLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.REELS_PER_HOUR || '8', 10),
  standardHeaders:true,
  legacyHeaders:false,
  keyGenerator:req => req.user && req.user.id ? req.user.id : req.ip,
  message:{ error:'Too many reel renders this hour — try again shortly.' }
});

function truthy(v){ return v === true || v === '1' || v === 'true' || v === 1; }
function safeText(v, n=120){ return String(v || '').trim().slice(0,n); }

// ---------- Snipo Music catalog (end-user) ----------
router.get('/music/tracks', requireUser, async (req,res) => {
  try {
    const tracks = await listTracks({
      q: safeText(req.query.q, 80),
      mood: safeText(req.query.mood, 40),
      genre: safeText(req.query.genre, 40),
      limit: Math.min(100, parseInt(req.query.limit, 10) || 50)
    });
    res.json({ tracks });
  } catch (e) {
    console.error('[music/list]', e.message || e);
    res.status(500).json({ error:'Could not load music library' });
  }
});

router.get('/music/tracks/:id/preview', requireUser, async (req,res) => {
  try {
    const p = await previewUrl(req.params.id, 600);
    if (!p) return res.status(404).json({ error:'Track not found' });
    res.json({ url:p.url, track:{ id:p.track.id, title:p.track.title, artist:p.track.artist, duration_sec:p.track.duration_sec, bpm:p.track.bpm, mood:p.track.mood, genre:p.track.genre, attribution:p.track.attribution } });
  } catch (e) {
    res.status(500).json({ error:'Could not preview track' });
  }
});

// ---------- Snipo Music catalog (admin) ----------
router.get('/music/admin/tracks', requireAdmin, async (req,res) => {
  try {
    const { data, error } = await admin.from('music_tracks').select('*').order('created_at',{ascending:false}).limit(500);
    if (error) throw error;
    res.json({ tracks:data || [] });
  } catch (e) { res.status(500).json({ error:'Could not load music catalog' }); }
});

router.post('/music/admin/tracks', requireAdmin, adminMusicUpload.single('audio'), async (req,res) => {
  if (!req.file) return res.status(400).json({ error:'Choose an audio file' });
  const tmp = req.file.path;
  let storagePath = null;
  try {
    const title = safeText(req.body.title || path.parse(req.file.originalname || 'Track').name, 120) || 'Untitled track';
    const artist = safeText(req.body.artist, 120) || null;
    const ext = (path.extname(req.file.originalname || '') || '.mp3').toLowerCase().replace(/[^.a-z0-9]/g,'');
    storagePath = `catalog/${new Date().toISOString().slice(0,7)}/${crypto.randomUUID()}${ext}`;
    let duration = null;
    try { duration = await probeDuration(tmp); } catch {}

    const { error:upErr } = await admin.storage.from(BUCKET).upload(storagePath, fs.readFileSync(tmp), {
      contentType:req.file.mimetype || 'audio/mpeg',
      upsert:false
    });
    if (upErr) throw upErr;

    const tags = safeText(req.body.tags, 500).split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,20);
    const row = {
      title,
      artist,
      storage_path:storagePath,
      genre:safeText(req.body.genre,60) || null,
      mood:safeText(req.body.mood,60) || null,
      energy:['low','medium','high'].includes(req.body.energy) ? req.body.energy : null,
      bpm:Number.isFinite(Number(req.body.bpm)) ? Number(req.body.bpm) : null,
      duration_sec:duration || null,
      instrumental:truthy(req.body.instrumental),
      vocals:truthy(req.body.vocals),
      language:safeText(req.body.language,40) || null,
      license_type:safeText(req.body.licenseType,60) || 'owned',
      license_url:safeText(req.body.licenseUrl,500) || null,
      attribution:safeText(req.body.attribution,500) || null,
      commercial_use:req.body.commercialUse === undefined ? true : truthy(req.body.commercialUse),
      source:safeText(req.body.source,60) || 'snipo',
      tags,
      featured:truthy(req.body.featured),
      is_active:true
    };
    const { data, error } = await admin.from('music_tracks').insert(row).select().single();
    if (error) throw error;
    res.json({ track:data });
  } catch (e) {
    if (storagePath) { try { await admin.storage.from(BUCKET).remove([storagePath]); } catch {} }
    console.error('[music/upload]', e.message || e);
    res.status(500).json({ error:'Could not add music track' });
  } finally { try { fs.rmSync(tmp,{force:true}); } catch {} }
});

router.delete('/music/admin/tracks/:id', requireAdmin, async (req,res) => {
  try {
    const { data } = await admin.from('music_tracks').select('storage_path').eq('id',req.params.id).single();
    const { error } = await admin.from('music_tracks').update({ is_active:false }).eq('id',req.params.id);
    if (error) throw error;
    // Keep the file for audit/license history; it can be hard-deleted manually later.
    res.json({ ok:true, storage_path:data && data.storage_path });
  } catch (e) { res.status(500).json({ error:'Could not disable track' }); }
});

router.get('/reels/options', requireUser, async (req,res) => {
  let tracks=[];
  try { tracks = await listTracks({ limit:60 }); } catch {}
  res.json({
    captionPresets:Object.keys(CAPTION_PRESETS),
    moods:['auto','energetic','cinematic','chill','uplifting','dramatic','none'],
    transitions:['auto','cut','fade'],
    tracks:tracks.map(x=>({ id:x.id, title:x.title, artist:x.artist, mood:x.mood || 'general', genre:x.genre, bpm:x.bpm, duration_sec:x.duration_sec, featured:x.featured }))
  });
});

router.post('/reels', requireUser, reelLimit, upload.single('music'), async (req,res) => {
  const cleanupMusic = () => { if (req.file) { try { fs.rmSync(req.file.path,{force:true}); } catch {} } };
  try {
    let ids = [];
    try { ids = JSON.parse(req.body.clipIds || '[]'); } catch {}
    if (!Array.isArray(ids)) ids=[];
    ids = [...new Set(ids.map(String))].slice(0,12);

    const { data:all, error } = await admin.from('clips').select('*').eq('user_id', req.user.id).order('score',{ascending:false}).limit(30);
    if (error) { cleanupMusic(); return res.status(500).json({error:'Could not load your clips'}); }
    const source = ids.length ? (all||[]).filter(c=>ids.includes(String(c.id))) : (all||[]).filter(c => !(c.edit && c.edit.type === 'reel')).slice(0,8);
    if (source.length < 1) { cleanupMusic(); return res.status(400).json({error:'Create at least one clip before making a reel.'}); }

    const mode = req.body.mode === 'manual' ? 'manual' : 'auto';
    const captionPreset = CAPTION_PRESETS[req.body.captionPreset] ? req.body.captionPreset : 'auto';
    const musicMood = ['auto','energetic','cinematic','chill','uplifting','dramatic','none'].includes(req.body.musicMood) ? req.body.musicMood : 'auto';
    const transition = ['auto','cut','fade'].includes(req.body.transition) ? req.body.transition : 'auto';
    const targetDuration = Math.max(15, Math.min(90, parseInt(req.body.targetDuration,10)||45));
    const title = safeText(req.body.title || 'AI Reel',100) || 'AI Reel';

    const { data:job, error:jobErr } = await admin.from('jobs')
      .insert({ user_id:req.user.id, source_url:null, status:'queued', stage:'planning' })
      .select().single();
    if (jobErr || !job) { cleanupMusic(); return res.status(500).json({error:'Could not create reel job'}); }

    let catalogSegment = null;
    const trackId = safeText(req.body.trackId,80) || null;
    if (!req.file && trackId && req.body.musicMode !== 'none') {
      try {
        catalogSegment = await prepareTrackSegment(trackId, {
          start:Math.max(0, Number(req.body.musicStart) || 0),
          duration:targetDuration
        });
      } catch (e) {
        await admin.from('jobs').update({ status:'error',stage:'error',error:'Selected music could not be prepared' }).eq('id',job.id);
        return res.status(400).json({ error:'Selected music could not be prepared' });
      }
    }

    const opts = {
      mode, captionPreset, musicMood, transition, targetDuration, title,
      musicMode:req.body.musicMode || (req.file ? 'upload' : (trackId ? 'catalog' : 'auto')),
      trackId,
      musicStart:Math.max(0, Number(req.body.musicStart) || 0),
      musicFile:req.file ? req.file.path : (catalogSegment ? catalogSegment.filePath : null),
      progress:req.body.progress === undefined ? true : truthy(req.body.progress)
    };

    if (catalogSegment) {
      try { await admin.from('music_uses').insert({ user_id:req.user.id, job_id:job.id, track_id:trackId, segment_start:catalogSegment.start, segment_duration:catalogSegment.duration, provider:'snipo' }); } catch {}
    }

    setImmediate(() => createReel(job, source, opts).catch(e => console.error(`[reel ${job.id}] ${e.message || e}`)));
    res.json({ jobId:job.id });
  } catch (e) {
    cleanupMusic();
    res.status(500).json({error:'Could not start reel render'});
  }
});

module.exports = router;
