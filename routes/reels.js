const express = require('express');
const multer = require('multer');
const os = require('os');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { requireUser } = require('../lib/requireUser');
const { admin } = require('../lib/supabase');
const { createReel, CAPTION_PRESETS, musicLibrary } = require('../lib/reel');

const router = express.Router();
const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
fs.mkdirSync(TMP, { recursive:true });

const upload = multer({
  dest: TMP,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^audio\//.test(file.mimetype) || /\.(mp3|m4a|aac|wav|ogg)$/i.test(file.originalname || '');
    cb(ok ? null : new Error('Choose an audio file'), ok);
  }
});

const reelLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.REELS_PER_HOUR || '8', 10),
  standardHeaders:true,
  legacyHeaders:false,
  keyGenerator:req => req.user && req.user.id ? req.user.id : req.ip,
  message:{ error:'Too many reel renders this hour — try again shortly.' }
});

function truthy(v){ return v === true || v === '1' || v === 'true' || v === 1; }

router.get('/reels/options', requireUser, async (req,res) => {
  const tracks = musicLibrary().map(x => ({ id:x.id, title:x.title || x.id, mood:x.mood || 'general' }));
  res.json({
    captionPresets:Object.keys(CAPTION_PRESETS),
    moods:['auto','energetic','cinematic','chill','uplifting','dramatic','none'],
    transitions:['auto','cut','fade'],
    tracks
  });
});

router.post('/reels', requireUser, reelLimit, upload.single('music'), async (req,res) => {
  const cleanupMusic = () => { if (req.file) { try { fs.rmSync(req.file.path,{force:true}); } catch {} } };
  try {
    let ids = [];
    try { ids = JSON.parse(req.body.clipIds || '[]'); } catch {}
    if (!Array.isArray(ids)) ids=[];
    ids = [...new Set(ids.map(String))].slice(0,12);

    let query = admin.from('clips').select('*').eq('user_id', req.user.id).order('score',{ascending:false}).limit(30);
    const { data: all, error } = await query;
    if (error) { cleanupMusic(); return res.status(500).json({error:'Could not load your clips'}); }
    const source = ids.length ? (all||[]).filter(c=>ids.includes(String(c.id))) : (all||[]).filter(c => !(c.edit && c.edit.type === 'reel')).slice(0,8);
    if (source.length < 1) { cleanupMusic(); return res.status(400).json({error:'Create at least one clip before making a reel.'}); }

    const mode = req.body.mode === 'manual' ? 'manual' : 'auto';
    const captionPreset = CAPTION_PRESETS[req.body.captionPreset] ? req.body.captionPreset : 'auto';
    const musicMood = ['auto','energetic','cinematic','chill','uplifting','dramatic','none'].includes(req.body.musicMood) ? req.body.musicMood : 'auto';
    const transition = ['auto','cut','fade'].includes(req.body.transition) ? req.body.transition : 'auto';
    const targetDuration = Math.max(15, Math.min(90, parseInt(req.body.targetDuration,10)||45));
    const title = String(req.body.title || 'AI Reel').trim().slice(0,100) || 'AI Reel';

    const { data: job, error:jobErr } = await admin.from('jobs')
      .insert({ user_id:req.user.id, source_url:null, status:'queued', stage:'planning' })
      .select().single();
    if (jobErr || !job) { cleanupMusic(); return res.status(500).json({error:'Could not create reel job'}); }

    const opts = {
      mode, captionPreset, musicMood, transition, targetDuration, title,
      musicMode: req.body.musicMode || (req.file ? 'upload' : 'auto'),
      trackId: req.body.trackId || null,
      musicFile: req.file ? req.file.path : null,
      progress: req.body.progress === undefined ? true : truthy(req.body.progress)
    };
    setImmediate(() => createReel(job, source, opts).catch(e => console.error(`[reel ${job.id}] ${e.message || e}`)));
    res.json({ jobId:job.id });
  } catch (e) {
    cleanupMusic();
    res.status(500).json({error:'Could not start reel render'});
  }
});

module.exports = router;
