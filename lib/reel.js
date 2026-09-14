// AI Reel Composer — turns existing Snipoclips clips into one finished reel.
// Reuses editor masters + caption renderer so the final reel has one visual language.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { admin } = require('./supabase');
const { renderEdit, probeDuration } = require('./pipeline');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';
const MUSIC_BUCKET = process.env.REEL_MUSIC_BUCKET || 'music';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const X264_CRF = process.env.X264_CRF || '18';
const X264_PRESET = process.env.X264_PRESET || 'medium';

const CAPTION_PRESETS = {
  viral:   { captionStyle:'classic', font:'Noto Sans Devanagari', fontSize:88, position:'bottom', upper:false, emoji:true,  animate:true,  karaoke:true,  highlight:true },
  clean:   { captionStyle:'white',   font:'Noto Sans Devanagari', fontSize:68, position:'bottom', upper:false, emoji:false, animate:false, karaoke:false, highlight:false },
  bold:    { captionStyle:'classic', font:'Noto Sans Devanagari', fontSize:96, position:'middle', upper:true,  emoji:false, animate:true,  karaoke:true,  highlight:true },
  creator: { captionStyle:'green',   font:'Noto Sans Devanagari', fontSize:78, position:'bottom', upper:false, emoji:true,  animate:true,  karaoke:true,  highlight:true },
  pop:     { captionStyle:'pink',    font:'Noto Sans Devanagari', fontSize:82, position:'bottom', upper:false, emoji:true,  animate:true,  karaoke:true,  highlight:true },
  minimal: { captionStyle:'white',   font:'Noto Sans Devanagari', fontSize:60, position:'bottom', upper:false, emoji:false, animate:false, karaoke:false, highlight:false },
  center:  { captionStyle:'classic', font:'Noto Sans Devanagari', fontSize:84, position:'middle', upper:false, emoji:false, animate:true,  karaoke:true,  highlight:true },
  headline:{ captionStyle:'white',   font:'Noto Sans Devanagari', fontSize:72, position:'top',    upper:true,  emoji:false, animate:true,  karaoke:false, highlight:true }
};

function musicLibrary() {
  try {
    const parsed = JSON.parse(process.env.REEL_MUSIC_LIBRARY_JSON || '[]');
    return Array.isArray(parsed) ? parsed.filter(x => x && x.id && x.path) : [];
  } catch { return []; }
}

function run(cmd, args, opts={}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, opts);
    let err='';
    p.stderr.on('data', d => err += d.toString());
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-700)}`)));
  });
}

async function downloadStorage(bucket, storagePath, dest) {
  const { data, error } = await admin.storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error('Could not load media from storage');
  const buf = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync(dest, buf);
  return dest;
}

function fallbackPlan(clips, opts) {
  const target = Math.max(15, Math.min(90, Number(opts.targetDuration) || 45));
  const sorted = [...clips].sort((a,b) => Number(b.score||0)-Number(a.score||0));
  const picked=[]; let total=0;
  for (const c of sorted) {
    const d = Math.max(1, Number(c.in_end ?? c.end_sec ?? 0) - Number(c.in_start ?? c.start_sec ?? 0));
    if (picked.length && total >= target) break;
    picked.push(c.id); total += Math.min(d, 14);
    if (picked.length >= 6) break;
  }
  return {
    order:picked,
    captionPreset: opts.captionPreset === 'auto' ? 'viral' : (opts.captionPreset || 'viral'),
    musicMood: opts.musicMood === 'auto' ? 'energetic' : (opts.musicMood || 'energetic'),
    transition: opts.transition === 'auto' ? 'cut' : (opts.transition || 'cut'),
    targetDuration:target,
    reason:'score-based fallback'
  };
}

async function aiPlan(clips, opts) {
  const fb = fallbackPlan(clips, opts);
  if (opts.mode !== 'auto' || !process.env.ANTHROPIC_API_KEY) return fb;
  const rows = clips.map(c => ({
    id:c.id, title:c.title || 'Untitled', score:Number(c.score||0),
    duration:Math.max(1, Number(c.in_end ?? c.end_sec ?? 0)-Number(c.in_start ?? c.start_sec ?? 0)),
    caption:(c.social_caption||'').slice(0,180)
  }));
  const prompt = `You are the edit director for a short-form social reel. Choose a coherent sequence from these already-generated clips. Start with the strongest hook, avoid repetition, keep momentum, and fit about ${fb.targetDuration}s. Return JSON only with keys: order (array of clip ids), captionPreset (one of viral,clean,bold,creator,pop,minimal,center,headline), musicMood (one of energetic,cinematic,chill,uplifting,dramatic,none), transition (cut or fade), reason (max 120 chars). Available clips: ${JSON.stringify(rows)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
      body:JSON.stringify({ model:CLAUDE_MODEL, max_tokens:450, temperature:0.25, messages:[{role:'user',content:prompt}] })
    });
    if (!r.ok) return fb;
    const j = await r.json();
    const text = ((j.content||[]).find(x=>x.type==='text')||{}).text || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fb;
    const p = JSON.parse(m[0]);
    const valid = new Set(clips.map(c=>c.id));
    const order = Array.isArray(p.order) ? p.order.filter(id=>valid.has(id)).slice(0,8) : [];
    if (!order.length) return fb;
    return {
      order,
      captionPreset: CAPTION_PRESETS[p.captionPreset] ? p.captionPreset : fb.captionPreset,
      musicMood:['energetic','cinematic','chill','uplifting','dramatic','none'].includes(p.musicMood) ? p.musicMood : fb.musicMood,
      transition:['cut','fade'].includes(p.transition) ? p.transition : fb.transition,
      targetDuration:fb.targetDuration,
      reason:String(p.reason||'AI-directed').slice(0,120)
    };
  } catch { return fb; }
}

function editFromPreset(clip, presetName, opts, inStart, inEnd) {
  const p = CAPTION_PRESETS[presetName] || CAPTION_PRESETS.viral;
  return {
    in_start:inStart, in_end:inEnd,
    captionStyle:p.captionStyle, font:p.font, fontSize:p.fontSize, position:p.position,
    upper:p.upper, emoji:p.emoji, animate:p.animate, karaoke:p.karaoke, highlight:p.highlight,
    progress:opts.progress !== false, hook:false, hookText:'', ratio:'9:16', plan:opts.plan || 'full'
  };
}

async function softenTransition(file, idx, workDir, transition) {
  if (transition !== 'fade') return file;
  const d = await probeDuration(file);
  if (!d || d < 1) return file;
  const out = path.join(workDir, `fade_${idx}.mp4`);
  const end = Math.max(0, d - 0.12).toFixed(3);
  await run(FFMPEG, ['-i',file,
    '-vf',`fade=t=in:st=0:d=0.12,fade=t=out:st=${end}:d=0.12`,
    '-af',`afade=t=in:st=0:d=0.08,afade=t=out:st=${Math.max(0,d-0.08).toFixed(3)}:d=0.08`,
    '-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-y',out]);
  return out;
}

async function concatSegments(files, workDir) {
  const list = path.join(workDir, 'concat.txt');
  fs.writeFileSync(list, files.map(f => `file '${String(f).replace(/'/g,"'\\''")}'`).join('\n'));
  const out = path.join(workDir, 'reel_base.mp4');
  await run(FFMPEG, ['-f','concat','-safe','0','-i',list,'-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,
    '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y',out]);
  return out;
}

async function mixMusic(base, music, workDir) {
  if (!music) return base;
  const dur = await probeDuration(base);
  if (!dur) return base;
  const out = path.join(workDir, 'reel_music.mp4');
  const fadeOut = Math.max(0, dur - 1.2).toFixed(2);
  await run(FFMPEG, ['-i',base,'-stream_loop','-1','-i',music,
    '-filter_complex',`[0:a]volume=1.0[voice];[1:a]volume=0.13,afade=t=in:st=0:d=0.8,afade=t=out:st=${fadeOut}:d=1.2[bed];[voice][bed]amix=inputs=2:duration=first:dropout_transition=2[a]`,
    '-map','0:v:0','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(dur),'-movflags','+faststart','-y',out]);
  return out;
}

async function resolveMusic(opts, plan, workDir) {
  if (opts.musicFile && fs.existsSync(opts.musicFile)) return opts.musicFile;
  if (opts.musicMode === 'none' || plan.musicMood === 'none') return null;
  const lib = musicLibrary();
  if (!lib.length) return null;
  let track = null;
  if (opts.trackId) track = lib.find(x=>x.id===opts.trackId);
  if (!track) track = lib.find(x=>x.mood===plan.musicMood) || lib[0];
  if (!track) return null;
  const ext = path.extname(track.path) || '.mp3';
  return downloadStorage(track.bucket || MUSIC_BUCKET, track.path, path.join(workDir, `music${ext}`));
}

async function createReel(job, clips, opts={}) {
  const workDir = path.join(TMP, `reel_${job.id}_${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(workDir, { recursive:true });
  try {
    await admin.from('jobs').update({ status:'processing', stage:'planning', error:null }).eq('id',job.id);
    const plan = await aiPlan(clips, opts);
    const byId = new Map(clips.map(c=>[c.id,c]));
    const ordered = plan.order.map(id=>byId.get(id)).filter(Boolean);
    if (!ordered.length) throw new Error('No usable clips selected for this reel');

    let accountPlan='free';
    try { const { data:p } = await admin.from('profiles').select('plan').eq('id',job.user_id).single(); if (p && p.plan) accountPlan=p.plan; } catch {}
    opts.plan = accountPlan;

    await admin.from('jobs').update({ stage:'rendering' }).eq('id',job.id);
    const segments=[]; let used=0;
    for (let i=0;i<ordered.length;i++) {
      if (used >= plan.targetDuration) break;
      const c=ordered[i];
      const remaining = plan.targetDuration-used;
      const baseStart = Number(c.in_start ?? 0);
      const naturalEnd = Number(c.in_end ?? (baseStart + Math.max(1,Number(c.end_sec||0)-Number(c.start_sec||0))));
      const naturalDur = Math.max(1,naturalEnd-baseStart);
      const desired = Math.min(naturalDur, remaining, opts.mode==='auto' ? 14 : remaining);
      const inEnd = baseStart + desired;
      let rendered;
      if (c.master_path && Array.isArray(c.words) && c.words.length) {
        const masterExt = path.extname(c.master_path)||'.mp4';
        const master = await downloadStorage(CLIPS_BUCKET,c.master_path,path.join(workDir,`master_${i}${masterExt}`));
        rendered = await renderEdit(master,c.words,editFromPreset(c,plan.captionPreset,opts,baseStart,inEnd),`reel_${i}`,workDir);
      } else {
        const src = await downloadStorage(CLIPS_BUCKET,c.storage_path,path.join(workDir,`clip_${i}.mp4`));
        const cut = path.join(workDir,`clipcut_${i}.mp4`);
        await run(FFMPEG,['-i',src,'-t',String(desired),'-vf','scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black',
          '-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-y',cut]);
        rendered=cut;
      }
      rendered = await softenTransition(rendered,i,workDir,plan.transition);
      segments.push(rendered); used += desired;
    }
    if (!segments.length) throw new Error('Could not render reel segments');

    await admin.from('jobs').update({ stage:'composing' }).eq('id',job.id);
    let out = await concatSegments(segments,workDir);
    const music = await resolveMusic(opts,plan,workDir);
    if (music) out = await mixMusic(out,music,workDir);
    const finalDur = await probeDuration(out);

    await admin.from('jobs').update({ stage:'uploading' }).eq('id',job.id);
    const storagePath = `${job.user_id}/${job.id}/reel.mp4`;
    const { error:upErr } = await admin.storage.from(CLIPS_BUCKET).upload(storagePath,fs.readFileSync(out),{contentType:'video/mp4',upsert:true});
    if (upErr) throw new Error('Could not upload reel: '+upErr.message);

    const title = opts.title ? String(opts.title).slice(0,100) : 'AI Reel';
    const { error:dbErr } = await admin.from('clips').insert({
      job_id:job.id,user_id:job.user_id,title,score:100,storage_path:storagePath,
      start_sec:0,end_sec:finalDur||used,master_path:null,words:null,m0:0,in_start:0,in_end:finalDur||used,
      edit:{ type:'reel', captionPreset:plan.captionPreset, transition:plan.transition, musicMood:plan.musicMood, sourceClipIds:ordered.map(c=>c.id), aiReason:plan.reason, ratio:'9:16' }
    });
    if (dbErr) throw new Error('Could not save reel: '+dbErr.message);
    await admin.from('jobs').update({ status:'done',stage:'done',clips_count:1,error:null }).eq('id',job.id);
    return { storagePath, plan, duration:finalDur||used };
  } catch (e) {
    await admin.from('jobs').update({ status:'error',stage:'error',error:String(e.message||e).slice(0,400) }).eq('id',job.id);
    throw e;
  } finally {
    try { fs.rmSync(workDir,{recursive:true,force:true}); } catch {}
    if (opts.musicFile) { try { fs.rmSync(opts.musicFile,{force:true}); } catch {} }
  }
}

module.exports = { createReel, CAPTION_PRESETS, musicLibrary, aiPlan };
