// lib/pipeline.js
// The clip pipeline. Runs per job. Each stage is real; you supply the keys
// and have ffmpeg + yt-dlp installed on the server.
//
// Flow:  source video -> audio -> transcript (Whisper) -> highlight ranges (Claude)
//        -> per clip: cut + reframe 9:16 + burn captions (ffmpeg) -> upload (Supabase)
//
// Honest limits (v1, documented so you can upgrade later):
//  - Reframe is a center crop to 9:16. True speaker tracking (keeping a moving
//    face centred) is a later upgrade via face detection.
//  - Captions support word-by-word "karaoke" sweep (default) or static "normal"
//    lines, chosen per job (buildASS `karaoke` opt).
//  - Whisper API caps audio at 25MB. Long audio is split into overlapping
//    chunks, transcribed, and stitched back with corrected timestamps
//    (transcribeLong) so multi-hour podcasts work transparently.
//  - Single in-process worker. For volume, move to a queue (BullMQ + Redis).

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { admin } = require('./supabase');
const { recordUsage, checkMinutes, recordMinutes } = require('./quota');
const { fetchBroll } = require('./broll');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const AUDIO_ENHANCE = 'highpass=f=80,afftdn=nf=-25,acompressor=threshold=-18dB:ratio=3:attack=20:release=250,loudnorm=I=-16:TP=-1.5:LRA=11';
const MAX_CONCURRENCY = parseInt(process.env.MAX_CONCURRENCY || '2', 10);
const MAX_VIDEO_MINUTES = parseInt(process.env.MAX_VIDEO_MINUTES || '180', 10);
// Encode quality. CRF 18 is visually near-lossless (23 was noticeably soft on
// captioned vertical video); 'medium' preset retains far more detail than
// 'veryfast'. Both env-tunable — raise CRF or use a faster preset if your host
// CPU is the bottleneck.
// Download source at up to 4K by default: cropping 16:9 -> 9:16 discards ~70% of
// the width, so a 1080p source yields only ~600px of usable width and must be
// upscaled (the main cause of soft output). Lower this if bandwidth is a concern.
const MAX_SRC_HEIGHT = process.env.MAX_SRC_HEIGHT || '2160';
const X264_CRF = process.env.X264_CRF || '18';
const X264_PRESET = process.env.X264_PRESET || 'medium';
const RATIOS = { '9:16':[1080,1920], '4:5':[1080,1350], '1:1':[1080,1080], '16:9':[1920,1080] };
function dimsOf(r){ return RATIOS[r] || RATIOS['9:16']; }
let ACTIVE = 0;

// Strip anything sensitive (proxy creds, API keys) before an error is ever
// stored on the job or shown to a user — yt-dlp/ffmpeg stderr can echo them.
function redact(s) {
  s = String(s == null ? '' : s);
  s = s.replace(/\/\/[^/\s@]+:[^/\s@]+@/g, '//');   // user:pass@ in any URL
  if (process.env.YTDLP_PROXY) {
    try { const h = new URL(process.env.YTDLP_PROXY).host; if (h) s = s.split(h).join('[proxy]'); } catch {}
    s = s.split(process.env.YTDLP_PROXY).join('[proxy]');
  }
  for (const k of ['GROQ_API_KEY','ANTHROPIC_API_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','DODO_API_KEY','DODO_WEBHOOK_SECRET','PEXELS_API_KEY','JWT_SECRET']) {
    const val = process.env[k]; if (val && val.length > 6) s = s.split(val).join('[redacted]');
  }
  return s;
}
function probeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', file]);
    let out=''; p.stdout.on('data',d=>out+=d.toString());
    p.on('close',()=>resolve(parseFloat(out)||0)); p.on('error',()=>resolve(0));
  });
}

fs.mkdirSync(TMP, { recursive: true });

// run a shell command, resolve on exit 0
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOpts } = opts;
    const p = spawn(cmd, args, spawnOpts);
    let err = '';
    let timedOut = false;
    let timer = null;
    if (timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        try { p.kill('SIGKILL'); } catch {}
      }, timeoutMs);
    }
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', e => { if (timer) clearTimeout(timer); reject(e); });
    p.on('close', code => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        const e = new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s`);
        e.stderr = err; e.timedOut = true;
        return reject(e);
      }
      if (code === 0) return resolve();
      const e = new Error(`${cmd} exited ${code}: ${err.slice(-500)}`);
      e.stderr = err; e.exitCode = code;  // keep full stderr for the classifier
      reject(e);
    });
  });
}

async function setStatus(jobId, fields) {
  if (admin) await admin.from('jobs').update(fields).eq('id', jobId);
}

// --- YouTube/source URL helpers + error classification (audit hardening) ---

// Clean common tracking/playlist params off YouTube links so the same video
// isn't re-fetched under different URLs, and short/shorts/mobile forms work.
// yt-dlp already understands every YouTube URL shape; this is for dedup + clarity.
function normalizeVideoUrl(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\.|^music\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (url.pathname.startsWith('/shorts/')) id = url.pathname.split('/')[2];
    else if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2];
    else if (url.pathname.startsWith('/live/')) id = url.pathname.split('/')[2];
  }
  if (id && /^[a-zA-Z0-9_-]{6,20}$/.test(id)) {
    return { canonical: `https://www.youtube.com/watch?v=${id}`, id, provider: 'youtube' };
  }
  // non-YouTube (Vimeo/Twitch/direct mp4/etc.) — yt-dlp still handles many; pass through
  return { canonical: url.toString(), id: null, provider: host };
}

// Turn raw yt-dlp/ffmpeg stderr into an actionable, user-safe message + a code
// developers can branch on. Pure + unit-tested.
function classifyDownloadError(err) {
  const raw = (err && (err.stderr || err.message) || String(err || '')).toLowerCase();
  const cat = (code, message) => ({ code, message });
  if (err && err.timedOut) return cat('timeout', 'The video took too long to download and timed out. Try a shorter video or retry.');
  if (/private video|sign in to confirm your age|members[- ]only|join this channel/.test(raw))
    return cat('auth_required', 'This video is private, age-restricted, or members-only, so it can’t be downloaded.');
  if (/video unavailable|has been removed|no longer available|does not exist|not available/.test(raw))
    return cat('unavailable', 'This video is unavailable or has been removed.');
  if (/not available in your country|geo|blocked it in your country|content is not available/.test(raw))
    return cat('geo_blocked', 'This video is blocked in the server’s region.');
  if (/429|too many requests|sign in to confirm you.?re not a bot|rate.?limit/.test(raw))
    return cat('rate_limited', 'YouTube is rate-limiting the server right now. Please try again in a few minutes.');
  if (/this live event|premieres in|will begin|is not yet available/.test(raw))
    return cat('not_ready', 'This is a live/upcoming video that hasn’t finished yet.');
  if (/unsupported url|no video formats|unable to extract|is not a valid url/.test(raw))
    return cat('unsupported', 'That link isn’t a supported video URL.');
  if (/timed out|timeout|connection reset|network|temporary failure|getaddrinfo|resolve/.test(raw))
    return cat('network', 'A network problem stopped the download. Please retry.');
  return cat('download_failed', 'Could not download that video. Please check the link and try again.');
}


async function fetchSource({ filePath, videoUrl }, workDir) {
  if (filePath) return filePath; // uploaded file already on disk
  if (videoUrl) {
    const norm = normalizeVideoUrl(videoUrl);
    const target = (norm && norm.canonical) || videoUrl; // dedup-friendly canonical form
    const out = path.join(workDir, 'source.%(ext)s');
    // Build yt-dlp args. Residential proxy + cookies make YouTube/Vimeo/Twitch/etc.
    // work from a server IP (otherwise the site blocks the datacenter address).
    const args = [
      '-f', `bv*[height<=${MAX_SRC_HEIGHT}]+ba/b[height<=${MAX_SRC_HEIGHT}]`,
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--retries', '5',
      '--fragment-retries', '10',
      '--socket-timeout', '30',
      '--no-warnings'
    ];
    if (process.env.YTDLP_PROXY) args.push('--proxy', process.env.YTDLP_PROXY);
    if (process.env.YTDLP_COOKIES && fs.existsSync(process.env.YTDLP_COOKIES)) {
      args.push('--cookies', process.env.YTDLP_COOKIES);
    }
    if (process.env.YTDLP_UA) args.push('--user-agent', process.env.YTDLP_UA);
    args.push('-o', out, target);
    // Hard timeout so a hung download can't block the worker forever.
    const DL_TIMEOUT = Number(process.env.YTDLP_TIMEOUT_MS || 20 * 60 * 1000); // 20 min default
    try {
      await run(YTDLP, args, { timeoutMs: DL_TIMEOUT });
    } catch (e) {
      const info = classifyDownloadError(e);
      const clean = new Error(info.message);
      clean.code = info.code;                 // actionable category for the UI/logs
      clean.detail = redact(e.stderr || e.message || ''); // dev diagnostics, secrets stripped
      throw clean;
    }
    const merged = fs.readdirSync(workDir).find(f => f.startsWith('source.'));
    if (!merged) { const e = new Error('Could not download that video. Please check the link and try again.'); e.code = 'download_failed'; throw e; }
    return path.join(workDir, merged);
  }
  throw new Error('No video source provided');
}

// 2) Extract compact mono audio for transcription.
async function extractAudio(input, workDir) {
  const audio = path.join(workDir, 'audio.mp3');
  await run(FFMPEG, ['-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-y', audio]);
  return audio;
}

// 3) Transcribe with Groq Whisper (word-level timestamps). OpenAI-compatible API.
// Language is AUTO-DETECTED by default (never hardcoded). Callers may pass an
// explicit ISO code (e.g. 'hi', 'en') to override, and an optional `prompt` to
// bias punctuation/spelling — which noticeably improves Hindi & code-switched
// Hinglish output. The detected language is returned so downstream stages
// (captions, titles) can match it.
const WHISPER_PROMPT = process.env.WHISPER_PROMPT ||
  'Transcribe naturally with correct punctuation. Keep Hindi words in Devanagari and English words in English for code-switched Hinglish speech.';

async function transcribe(audioPath, opts = {}) {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not set (transcription)');
  const model = process.env.WHISPER_MODEL || 'whisper-large-v3';
  const buf = fs.readFileSync(audioPath);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/mpeg' }), 'audio.mp3');
  fd.append('model', model);
  fd.append('response_format', 'verbose_json');
  fd.append('timestamp_granularities[]', 'word');
  fd.append('timestamp_granularities[]', 'segment');
  // manual override only when a concrete 2-letter code is given; else auto-detect
  const lang = typeof opts.language === 'string' && /^[a-z]{2}$/.test(opts.language) ? opts.language : null;
  if (lang) fd.append('language', lang);
  const hint = opts.prompt || WHISPER_PROMPT;
  if (hint) fd.append('prompt', String(hint).slice(0, 500));
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: fd
  });
  if (!r.ok) throw new Error('Transcription failed: ' + (await r.text()).slice(0, 300));
  return r.json(); // { text, language, segments:[{start,end,text}], words:[{word,start,end}] }
}

// --- Feature 7: chunked transcription for audio over Whisper's 25MB limit ---
// The extracted audio is 16kHz mono MP3 @ ~48kbps ≈ 6 KB/s, so a 25MB cap is
// roughly 70 minutes. Multi-hour podcasts exceed it. We split into overlapping
// windows, transcribe each, then stitch — every chunk "owns" a slice of the
// timeline so overlaps are de-duplicated without dropping words on the seam.
const WHISPER_MAX_BYTES = parseInt(process.env.WHISPER_MAX_BYTES || String(24 * 1024 * 1024), 10); // stay under 25MB
const CHUNK_OVERLAP_SEC = Math.max(2, parseInt(process.env.CHUNK_OVERLAP_SEC || '6', 10));

// Pure planner (unit-tested): given total duration + bytes/sec, return chunk
// windows [{start,end,ownStart,ownEnd}] with `own*` = the de-dup ownership band.
function planAudioChunks(durationSec, bytesPerSec, maxBytes = WHISPER_MAX_BYTES, overlap = CHUNK_OVERLAP_SEC) {
  const dur = Math.max(0, Number(durationSec) || 0);
  const bps = Math.max(1, Number(bytesPerSec) || 6000);
  const maxSec = Math.max(30, Math.floor((maxBytes / bps) * 0.9)); // 10% headroom
  if (dur <= maxSec) return [{ start: 0, end: dur, ownStart: 0, ownEnd: dur }];
  const step = Math.max(10, maxSec - overlap);
  const chunks = [];
  for (let s = 0; s < dur; s += step) {
    const start = Math.max(0, s === 0 ? 0 : s);
    const end = Math.min(dur, start + maxSec);
    const isFirst = start === 0;
    const isLast = end >= dur - 0.001;
    chunks.push({
      start, end,
      ownStart: isFirst ? 0 : start + overlap / 2,       // previous chunk owns the first half of the overlap
      ownEnd:   isLast  ? dur : end - overlap / 2         // next chunk owns the last half
    });
    if (isLast) break;
  }
  return chunks;
}

// Transcribe any-length audio transparently. Falls back to a single call when
// the file is already under the cap. Returns the same shape as transcribe().
// Detect the dominant script of transcribed text so downstream stages can match
// it (Hindi titles for Hindi videos, right font, etc). Pure + testable.
function detectScript(input) {
  const text = Array.isArray(input) ? input.map(w => String(w.word || '')).join(' ') : String(input || '');
  const devanagari = (text.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = devanagari + latin;
  if (!total) return { script: 'unknown', hasDevanagari: false, label: 'auto' };
  const devFrac = devanagari / total;
  let label;
  if (devFrac > 0.85) label = 'hindi';
  else if (devFrac > 0.12) label = 'hinglish'; // meaningful code-switching
  else label = 'english';
  return { script: devanagari > latin ? 'devanagari' : 'latin', hasDevanagari: devanagari > 0, devFrac, label };
}

async function transcribeLong(audioPath, workDir, opts = {}) {
  const size = fs.statSync(audioPath).size;
  if (size <= WHISPER_MAX_BYTES) return transcribe(audioPath, opts);

  const dur = await probeDuration(audioPath);
  if (!dur) return transcribe(audioPath, opts); // can't plan without a duration — let the single call try/fail loudly
  const bytesPerSec = size / dur;
  const plan = planAudioChunks(dur, bytesPerSec);
  const dir = workDir || fs.mkdtempSync(path.join(TMP, 'chunk_'));
  fs.mkdirSync(dir, { recursive: true });

  const allWords = [];
  const allSegs = [];
  const textParts = [];
  let detected = null;
  for (let i = 0; i < plan.length; i++) {
    const { start, end, ownStart, ownEnd } = plan[i];
    const part = path.join(dir, `chunk_${i}.mp3`);
    // re-encode (not -c copy) so timestamps inside each chunk are exact
    await run(FFMPEG, ['-ss', String(start), '-i', audioPath, '-t', String(end - start),
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-y', part]);
    let tr;
    // lock later chunks to the first chunk's detected language for consistency
    const chunkOpts = detected ? { ...opts, language: opts.language || detected } : opts;
    try { tr = await transcribe(part, chunkOpts); }
    finally { try { fs.rmSync(part, { force: true }); } catch {} }
    if (!detected && tr.language) detected = tr.language;

    // shift chunk-relative times back to absolute, then keep only this chunk's
    // owned band so overlapping words aren't emitted twice.
    for (const w of (tr.words || [])) {
      const ws = w.start + start, we = w.end + start;
      const mid = (ws + we) / 2;
      if (mid >= ownStart && mid < ownEnd) allWords.push({ word: w.word, start: +ws.toFixed(3), end: +we.toFixed(3) });
    }
    for (const s of (tr.segments || [])) {
      const ss = s.start + start, se = s.end + start;
      const mid = (ss + se) / 2;
      if (mid >= ownStart && mid < ownEnd) allSegs.push({ start: +ss.toFixed(3), end: +se.toFixed(3), text: s.text });
    }
    if (tr.text) textParts.push(tr.text.trim());
  }
  allWords.sort((a, b) => a.start - b.start);
  allSegs.sort((a, b) => a.start - b.start);
  return { text: textParts.join(' '), words: allWords, segments: allSegs, language: detected || (opts.language || null) };
}

// 4) Ask Claude to pick the most viral clip ranges.
async function selectHighlights(transcript, opts = {}, maxClips = 8) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set (highlights)');
  const DUR = { auto:{min:15,max:60,label:'15-60 seconds'}, short:{min:10,max:30,label:'10-30 seconds'}, medium:{min:30,max:60,label:'30-60 seconds'}, long:{min:60,max:90,label:'60-90 seconds'} };
  const d = DUR[opts.duration] || DUR.auto;
  const userPrompt = (opts.prompt || '').toString().slice(0, 800).trim();
  const wantClips = Math.min(12, Math.max(1, parseInt(opts.count, 10) || maxClips));
  const safePrompt = userPrompt.replace(/[\r\n`]/g, ' ');
  const guidance = userPrompt ? ('\nIMPORTANT - the user wants clips like this; prioritise it heavily: ' + safePrompt + '.\n') : '';
  const segs = (transcript.segments || []).map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.trim()}`).join('\n').slice(0, 60000);
  // Language-match instruction: titles, captions and hashtags should be in the
  // same language/script the creator actually speaks (Hindi video -> Hindi hooks,
  // Hinglish -> natural Roman Hinglish). Derived from the detected language +
  // the transcript's script, so it's automatic, not hardcoded.
  const det = detectScript(transcript.words && transcript.words.length ? transcript.words : (transcript.text || ''));
  const langCode = opts.language || transcript.language || '';
  const langLine = (det.label === 'hindi' || langCode === 'hi')
    ? 'The video is in HINDI. Write "title" and "caption" in Hindi (Devanagari script). Hashtags may mix Hindi and English.'
    : (det.label === 'hinglish')
    ? 'The video is in HINGLISH (Hindi-English mix). Write "title" and "caption" in natural Hinglish exactly as an Indian creator would, matching the speaker\'s mix.'
    : 'Write "title" and "caption" in the same language the speaker uses in the transcript.';
  const prompt = `You are an expert short-form video editor. From this timestamped transcript, choose up to ${wantClips} self-contained clips most likely to go viral as vertical Reels/Shorts/TikToks.
Rules: each clip ${d.label}, must start and end on a complete thought, prioritise a strong hook in the first seconds.${guidance}
${langLine}
Return ONLY a JSON array, no prose, each item: {"start": number_seconds, "end": number_seconds, "title": "punchy 3-6 word on-screen hook", "score": 0-100, "broll": "1-2 word concrete visual keyword for stock b-roll footage, e.g. city, money, ocean, gaming, gym, nature", "caption": "one engaging sentence to post as the clip caption", "hashtags": ["4-6 relevant lowercase hashtags, no # symbol"]}.

TRANSCRIPT:
${segs}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] })
  });
  if (!r.ok) throw new Error('Highlight selection failed: ' + (await r.text()).slice(0, 300));
  const data = await r.json();
  const text = (data.content || []).map(b => b.text || '').join('');
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse highlights from AI response');
  const clips = JSON.parse(match[0]);
  const lo = Math.max(5, d.min - 5), hi = d.max + 12;
  return clips.filter(c => c.end > c.start && c.end - c.start >= lo && c.end - c.start <= hi)
              .map(c => ({ start: +c.start, end: +c.end, title: String(c.title || 'Clip').slice(0, 60), score: Math.max(0, Math.min(100, +c.score || 70)), broll: String(c.broll || '').replace(/[^a-zA-Z0-9 ]/g,'').slice(0, 40), caption: String(c.caption || '').replace(/[\r\n]+/g,' ').slice(0, 300), hashtags: Array.isArray(c.hashtags) ? c.hashtags.slice(0, 8).map(h => String(h).replace(/[^\p{L}\p{N}_]/gu,'').slice(0, 30)).filter(Boolean) : [] }))
              .slice(0, wantClips);
}

// ============================================================================
// Feature 4: scene-detection fallback for low-dialogue video
// ----------------------------------------------------------------------------
// Transcript-based clipping is weak on gaming, music, montages and silent
// footage. When the transcript is too sparse to be useful we fall back to
// VISUAL scene changes + AUDIO energy, then let Claude (or a heuristic) rank
// the moments. The path always yields clips — it never fails silently.
// ============================================================================
const SPARSE_WPM = Number(process.env.SPARSE_WORDS_PER_MIN || 18); // below this words/min = "sparse"
const SCENE_THRESH = Number(process.env.SCENE_THRESHOLD || 0.4);   // ffmpeg scene score 0..1

// capture ffmpeg STDERR (showinfo/ebur128 print diagnostics there, not stdout)
function runCaptureErr(cmd, args) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(cmd, args);
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', () => resolve(null));
    p.on('close', () => resolve(err)); // ffmpeg exits 0 with -f null; return stderr regardless
  });
}

// Pure: how usable is this transcript? density = spoken words per minute.
function transcriptConfidence(transcript, durSec) {
  const words = (transcript && transcript.words) ? transcript.words.length : 0;
  const dur = Math.max(1, Number(durSec) || 0);
  const wpm = words / (dur / 60);
  const sparse = words < 5 || wpm < SPARSE_WPM;
  const confidence = Math.max(0, Math.min(1, wpm / (SPARSE_WPM * 2))); // saturates at 2x threshold
  return { words, wpm: +wpm.toFixed(1), sparse, confidence: +confidence.toFixed(2) };
}

// ffmpeg scene-change timestamps (seconds) via select='gt(scene,thresh)'.
async function detectScenes(input, thresh = SCENE_THRESH) {
  const out = await runCaptureErr(FFMPEG, ['-i', input, '-filter:v', `select='gt(scene,${thresh})',showinfo`, '-an', '-f', 'null', '-']);
  if (!out) return [];
  const times = []; const re = /pts_time:([0-9.]+)/g; let m;
  while ((m = re.exec(out))) times.push(+parseFloat(m[1]).toFixed(2));
  times.sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1] > 0.3); // drop near-duplicates
}

// ffmpeg audio energy timeline via ebur128 momentary loudness (LUFS, higher=louder).
async function analyzeAudioEnergy(input) {
  const out = await runCaptureErr(FFMPEG, ['-i', input, '-filter_complex', 'ebur128=metadata=1', '-f', 'null', '-']);
  if (!out) return [];
  const samples = []; const re = /t:\s*([0-9.]+).*?M:\s*(-?[0-9.]+)/g; let m;
  while ((m = re.exec(out))) {
    const t = +parseFloat(m[1]).toFixed(2);
    let e = parseFloat(m[2]);
    if (!isFinite(e) || e < -70) e = -70; // silence floor
    samples.push({ t, e });
  }
  return samples;
}

// Pure: turn scene cuts + energy samples into scored candidate windows.
function buildCandidateWindows(sceneTimes, energy, durSec, opts = {}) {
  const dur = Math.max(1, Number(durSec) || 0);
  const min = Math.max(5, opts.min || 15), max = Math.max(min, opts.max || 60);
  const win = Math.min(max, Math.max(min, (min + max) / 2)); // target clip length
  const step = Math.max(3, win / 2);
  const es = (energy || []).slice().sort((a, b) => a.t - b.t);
  const between = (a, b) => es.filter(s => s.t >= a && s.t < b);
  const avgE = (a, b) => { const w = between(a, b); return w.length ? w.reduce((s, x) => s + x.e, 0) / w.length : -70; };
  const peakE = (a, b) => { const w = between(a, b); return w.length ? Math.max(...w.map(x => x.e)) : -70; };
  const scenes = (sceneTimes || []).filter(t => t >= 0 && t <= dur).sort((a, b) => a - b);
  const sceneCount = (a, b) => scenes.filter(t => t >= a && t < b).length;

  const cands = [];
  for (let start = 0; start + win <= dur + 0.01; start += step) {
    const end = Math.min(dur, start + win);
    cands.push({ start: +start.toFixed(2), end: +end.toFixed(2), scenes: sceneCount(start, end), avgE: +avgE(start, end).toFixed(1), peakE: +peakE(start, end).toFixed(1) });
  }
  if (!cands.length) cands.push({ start: 0, end: Math.min(dur, win), scenes: 0, avgE: -70, peakE: -70 });

  const norm = e => Math.max(0, Math.min(1, (e + 40) / 35)); // map ~[-40,-5] LUFS to 0..1
  for (const c of cands) c.score = +(0.6 * norm(c.peakE) + 0.25 * norm(c.avgE) + 0.15 * Math.min(1, c.scenes / 6)).toFixed(3);
  cands.sort((a, b) => b.score - a.score);
  return cands;
}

// Pure heuristic: top-scoring, non-overlapping windows (used when Claude is
// unavailable) so the fallback NEVER returns nothing.
function heuristicPick(cands, count) {
  const want = Math.min(12, Math.max(1, count || 8));
  const picked = [];
  for (const c of cands) {
    if (picked.length >= want) break;
    if (picked.some(p => c.start < p.end && c.end > p.start)) continue; // no overlap
    picked.push(c);
  }
  return picked.sort((a, b) => a.start - b.start).map((c, i) => ({
    start: c.start, end: c.end, title: 'Highlight ' + (i + 1),
    score: Math.round(60 + 40 * (c.score || 0)), broll: '', caption: '', hashtags: []
  }));
}

// Rank signal-based candidates with Claude (reads the numeric timeline, writes
// short hooks); fall back to the heuristic on any error.
async function rankSignalCandidates(cands, opts = {}) {
  const want = Math.min(12, Math.max(1, opts.count || 8));
  const top = cands.slice(0, Math.min(30, cands.length));
  if (!process.env.ANTHROPIC_API_KEY || !top.length) return heuristicPick(cands, want);
  try {
    const lines = top.map((c, i) => `${i}: ${c.start.toFixed(1)}-${c.end.toFixed(1)}s scenes=${c.scenes} peakLoud=${c.peakE} avgLoud=${c.avgE}`).join('\n');
    const prompt = `A video has little or no speech (gaming/music/montage). Below are candidate clip windows with visual scene-change counts and audio loudness in LUFS (higher = louder). Pick the ${want} most exciting, watchable moments for vertical shorts — favour high energy and visual activity, and spread them across the video.
Return ONLY a JSON array, each: {"index": number from the list, "title": "punchy 3-5 word hook", "score": 0-100, "broll": "1-2 word visual keyword", "caption": "one short caption", "hashtags": ["3-5 lowercase tags, no #"]}.

CANDIDATES:
${lines}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
    });
    if (!r.ok) throw new Error('rank http ' + r.status);
    const data = await r.json();
    const text = (data.content || []).map(b => b.text || '').join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('no json in rank response');
    const arr = JSON.parse(match[0]);
    const out = [];
    for (const it of arr) {
      const c = top[it.index];
      if (!c) continue;
      out.push({
        start: c.start, end: c.end,
        title: String(it.title || 'Highlight').slice(0, 60),
        score: Math.max(0, Math.min(100, +it.score || 70)),
        broll: String(it.broll || '').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 40),
        caption: String(it.caption || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
        hashtags: Array.isArray(it.hashtags) ? it.hashtags.slice(0, 8).map(h => String(h).replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 30)).filter(Boolean) : []
      });
      if (out.length >= want) break;
    }
    return out.length ? out : heuristicPick(cands, want);
  } catch (e) {
    console.warn('[signals] Claude rank failed, heuristic fallback: ' + redact(e.message || e));
    return heuristicPick(cands, want);
  }
}

// helper: seconds -> ASS time (H:MM:SS.cc)
function ts(sec) {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = (sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

// 5a) Build a styled ASS caption file for the words inside [start,end].
function buildASS(words, start, end, assPath, opts) {
  if (typeof opts === 'string') opts = { captionStyle: opts };
  opts = opts || {};
  const CAP = { classic:{p:'&H0000FFFF',s:'&H00FFFFFF'}, white:{p:'&H00FFFFFF',s:'&H00FFFFFF'}, green:{p:'&H0000FF00',s:'&H00FFFFFF'}, pink:{p:'&H00B469FF',s:'&H00FFFFFF'} };
  const capc = CAP[opts.captionStyle] || CAP.classic;
  let font = (opts.font || 'Noto Sans Devanagari').toString().replace(/[,{}\r\n]/g,'').slice(0,40) || 'Noto Sans Devanagari';
  // If the words contain Devanagari, guarantee a Devanagari-capable font so
  // Hindi/Hinglish never renders as missing-glyph boxes — even if a Latin-only
  // font was requested via the editor. (fonts-indic ships in the Docker image.)
  const _hasDeva = /[\u0900-\u097F]/.test((words || []).map(w => String(w.word || '')).join(''));
  if (_hasDeva && !/devanagari|mangal|nirmala|lohit|noto sans deva/i.test(font)) font = 'Noto Sans Devanagari';
  const fontSize = Math.min(140, Math.max(40, parseInt(opts.fontSize,10) || 74));
  const W = Math.max(2, parseInt(opts.w,10) || 1080), H = Math.max(2, parseInt(opts.h,10) || 1920), vscale = H/1920;
  const POS = { bottom:{a:2,mv:Math.round(320*vscale)}, middle:{a:5,mv:0}, top:{a:8,mv:Math.round(300*vscale)} };
  const pos = POS[opts.position] || POS.bottom;
  const hook = (opts.hook || '').toString().replace(/[{}\r\n]/g, ' ').trim().slice(0, 90);
  const hookDur = Math.max(1, Math.min(6, parseFloat(opts.hookDur) || 2.5));
  const upper = !!opts.upper, animate = !!opts.animate, useEmoji = !!opts.emoji, highlight = !!opts.highlight;
  // karaoke: words fill in progressively via ASS \k timing (the default, viral
  // look). When off, each line shows as a clean static block. Script-agnostic —
  // \k works identically for Latin, Devanagari and mixed Hinglish text.
  const karaoke = opts.karaoke === undefined ? true : !!opts.karaoke;
  const HLC = { classic:'&H0000FF00', white:'&H0000FFFF', green:'&H0000FFFF', pink:'&H0000FFFF' };
  const hlCol = HLC[opts.captionStyle] || '&H0000FFFF';
  const STOP = new Set(['the','a','an','to','of','and','or','but','is','are','was','were','in','on','at','it','this','that','you','i','we','they','he','she','my','your','our','for','with','so','as','be','will','just','what','if','do','not','can','have','has','its','im','dont']);
  const EMOJI = [[/(money|cash|dollar|paid|profit|rich|price|\$)/i,'\u{1F4B0}'],[/(fire|hot|insane|crazy|amazing|epic|wild|lit)/i,'\u{1F525}'],[/(love|heart|beautiful|favorite)/i,'❤️'],[/(laugh|funny|joke|hilarious|lol|haha)/i,'\u{1F602}'],[/(idea|smart|think|brain|genius|learn|know)/i,'\u{1F9E0}'],[/(win|winner|success|best|champion|goal|achieve)/i,'\u{1F3C6}'],[/(time|fast|quick|now|today|minute|second)/i,'⏰'],[/(grow|growth|increase|scale|boost|more|profit)/i,'\u{1F4C8}'],[/(stop|warning|careful|danger|mistake|wrong|never|avoid)/i,'⚠️'],[/(work|business|job|career|company|client)/i,'\u{1F4BC}'],[/(gym|workout|strong|muscle|train|fit)/i,'\u{1F4AA}'],[/(star|famous|viral|trend|popular)/i,'⭐']];
  function pickEmoji(cw){ const j=cw.map(w=>String(w.word||'')).join(' '); for(const e of EMOJI){ if(e[0].test(j)) return e[1]; } return ''; }
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${font},${fontSize},${capc.p},${capc.s},&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,2,${pos.a},90,90,${pos.mv},1
Style: Hook,${font},62,&H00FFFFFF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,100,100,0,0,3,2,0,8,90,90,${Math.round(150*vscale)},1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text
`;
  const inRange = (words || []).filter(w => w.end > start && w.start < end);
  const lines = [];
  for (let i = 0; i < inRange.length; i += 4) {
    const chunk = inRange.slice(i, i + 4);
    const s = Math.max(0, chunk[0].start - start);
    const e = Math.max(s + 0.4, chunk[chunk.length - 1].end - start);
    let txt = '';
    let keyIdx = -1, keyLen = 0;
    if (highlight) chunk.forEach((w, j) => { const cw = String(w.word || '').toLowerCase().replace(/[^a-z']/g, ''); if (cw.length >= 4 && !STOP.has(cw) && cw.length > keyLen) { keyLen = cw.length; keyIdx = j; } });
    chunk.forEach((w, j) => {
      const wStart = Math.max(0, w.start - start);
      const wEnd = Math.max(wStart, w.end - start);
      const cs = Math.max(1, Math.round((wEnd - wStart) * 100));
      let clean = String(w.word || '').replace(/[\r\n]/g, ' ').replace(/[{}]/g, '').trim();
      if (upper) clean = clean.toUpperCase();
      if (!clean) return;
      let tag;
      if (karaoke) {
        // progressive fill; optionally recolour the key word as it lands
        tag = highlight ? `{\\k${cs}\\c${(j === keyIdx ? hlCol : capc.p)}&}` : `{\\k${cs}}`;
      } else {
        // static line: whole caption in primary colour, key word recoloured only
        tag = highlight ? `{\\c${(j === keyIdx ? hlCol : capc.p)}&}` : '';
      }
      txt += `${tag}${clean} `;
    });
    txt = txt.trim();
    if (useEmoji) { const em = pickEmoji(chunk); if (em) txt += ' ' + em; }
    if (animate && txt) txt = `{\\fad(60,0)\\fscx90\\fscy90\\t(0,120,\\fscx100\\fscy100)}` + txt;
    if (txt) lines.push(`Dialogue: 0,${ts(s)},${ts(e)},Cap,,0,0,0,${txt}`);
  }
  if (hook) lines.unshift(`Dialogue: 1,${ts(0)},${ts(hookDur)},Hook,,90,90,0,${upper ? hook.toUpperCase() : hook}`);
  fs.writeFileSync(assPath, header + lines.join('\n') + '\n');
}

// 5b) Cut + reframe to 9:16 + burn captions.
async function renderClip(input, words, clip, idx, workDir, opts = {}) {
  const assPath = path.join(workDir, `subs_${idx}.ass`);
  const [W,H] = dimsOf(opts.ratio);
  buildASS(words, clip.start, clip.end, assPath, { captionStyle: opts.captionStyle, w: W, h: H, hook: opts.hook, highlight: opts.highlight, emoji: opts.emoji, karaoke: opts.karaoke });
  const out = path.join(workDir, `clip_${idx}.mp4`);
  const dur = (clip.end - clip.start).toFixed(2);
  const WM = `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='snipoclip.com':fontcolor=white@0.6:fontsize=36:x=(w-text_w)/2:y=h-160:box=1:boxcolor=black@0.35:boxborderw=10`;
  const PROG = opts.progress ? `,drawbox=y=ih-12:x=0:h=12:w=iw*t/${dur}:color=0x7B5CFF@0.95:t=fill` : '';
  const capChain = `subtitles=subs_${idx}.ass` + (opts.plan === 'free' ? `,${WM}` : '') + PROG;
  if (opts.brollFile && opts.brollStart != null && opts.brollEnd != null && opts.brollEnd > opts.brollStart) {
    const bs = opts.brollStart, be = opts.brollEnd;
    const fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}[base];`
             + `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setpts=PTS-STARTPTS+${bs}/TB[bv];`
             + `[base][bv]overlay=enable='between(t,${bs},${be})'[ov];`
             + `[ov]${capChain}[outv]`;
    const a = ['-ss', String(clip.start), '-t', dur, '-i', input, '-i', opts.brollFile, '-filter_complex', fc, '-map', '[outv]', '-map', '0:a'];
    if (opts.enhance) a.push('-af', AUDIO_ENHANCE);
    a.push('-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y', out);
    try { await run(FFMPEG, a, { cwd: workDir }); return out; }
    catch (e) { console.warn('[broll] composite failed, plain render: ' + (e.message || e)); }
  }
  const reframe = opts.reframe || `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`;
  let vf = `${reframe},${capChain}`;
  const args = ['-ss', String(clip.start), '-t', dur, '-i', input, '-vf', vf];
  if (opts.enhance) args.push('-af', AUDIO_ENHANCE);
  args.push('-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y', out);
  await run(FFMPEG, args, { cwd: workDir });
  return out;
}

// 5c) No-caption padded MASTER (the editable source for the in-app editor).
async function renderMaster(input, m0, m1, idx, workDir, opts = {}) {
  const out = path.join(workDir, `master_${idx}.mp4`);
  const dur = (m1 - m0).toFixed(2);
  const [W,H] = dimsOf(opts.ratio);
  const args = ['-ss', String(m0), '-t', dur, '-i', input, '-vf', (opts.reframe || `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}`)];
  if (opts.enhance) args.push('-af', AUDIO_ENHANCE);
  args.push('-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y', out);
  await run(FFMPEG, args, { cwd: workDir });
  return out;
}

// 5d) Re-render from a MASTER with new caption style/text/trim (the editor).
//  edit = { in_start, in_end, captionStyle, font, fontSize, position, plan, words? }
async function renderEdit(masterPath, words, edit, idx, workDir) {
  const assPath = path.join(workDir, `edit_${idx}.ass`);
  const [ew, eh] = dimsOf(edit.ratio);
  buildASS(edit.words || words, edit.in_start, edit.in_end, assPath,
    { captionStyle: edit.captionStyle, font: edit.font, fontSize: edit.fontSize, position: edit.position,
      upper: edit.upper, emoji: edit.emoji, animate: edit.animate, w: ew, h: eh,
      hook: edit.hook ? (edit.hookText || '') : '', highlight: edit.highlight,
      karaoke: edit.karaoke === undefined ? true : !!edit.karaoke });
  const out = path.join(workDir, `edit_${idx}.mp4`);
  const dur = (edit.in_end - edit.in_start).toFixed(2);
  let vf = `subtitles=edit_${idx}.ass`;
  if (edit.plan === 'free') {
    vf += `,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='snipoclip.com':fontcolor=white@0.6:fontsize=36:x=(w-text_w)/2:y=h-160:box=1:boxcolor=black@0.35:boxborderw=10`;
  }
  if (edit.progress) vf += `,drawbox=y=ih-12:x=0:h=12:w=iw*t/${dur}:color=0x7B5CFF@0.95:t=fill`;
  await run(FFMPEG, ['-ss', String(edit.in_start), '-t', dur, '-i', masterPath, '-vf', vf,
    '-c:v','libx264','-preset',X264_PRESET,'-crf',X264_CRF,'-maxrate','12M','-bufsize','24M','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y', out],
    { cwd: workDir });
  return out;
}

// 6) Upload a rendered clip to Supabase storage (private bucket).
async function uploadClip(localPath, userId, jobId, idx) {
  const storagePath = `${userId}/${jobId}/clip_${idx}.mp4`;
  const buf = fs.readFileSync(localPath);
  const { error } = await admin.storage.from(CLIPS_BUCKET).upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error('Upload failed: ' + error.message);
  return storagePath;
}

async function uploadMaster(localPath, userId, jobId, idx) {
  const storagePath = `${userId}/${jobId}/master_${idx}.mp4`;
  const buf = fs.readFileSync(localPath);
  const { error } = await admin.storage.from(CLIPS_BUCKET).upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });
  if (error) throw new Error('Master upload failed: ' + error.message);
  return storagePath;
}

// ---- Filler-word + silence removal -------------------------------------------------
const FILLERS = new Set(['um','umm','uhm','uh','uhh','er','erm','ah','ahh','mm','mmm','hmm','huh']);
function isFiller(w){ return FILLERS.has(String(w || '').toLowerCase().replace(/[^a-z]/g, '')); }

// Source-time intervals to KEEP (drops filler words + silences > 0.6s). null = not worth cutting.
function computeKeep(words, clipStart, clipEnd){
  const SIL = 0.6, PAD = 0.10;
  const ws = (words || []).filter(w => w.end > clipStart && w.start < clipEnd)
    .map(w => ({ word:w.word, start:Math.max(clipStart,w.start), end:Math.min(clipEnd,w.end) }))
    .sort((a,b)=>a.start-b.start);
  if (ws.length < 4) return null;
  const remove = [];
  if (ws[0].start - clipStart > SIL) remove.push([clipStart, ws[0].start - PAD]);
  if (clipEnd - ws[ws.length-1].end > SIL) remove.push([ws[ws.length-1].end + PAD, clipEnd]);
  for (let i=0;i<ws.length;i++){
    if (isFiller(ws[i].word)) remove.push([ws[i].start - 0.02, ws[i].end + 0.02]);
    if (i < ws.length-1){ const gap = ws[i+1].start - ws[i].end; if (gap > SIL) remove.push([ws[i].end + PAD, ws[i+1].start - PAD]); }
  }
  if (!remove.length) return null;
  remove.sort((a,b)=>a[0]-b[0]);
  const merged = [remove[0].slice()];
  for (let i=1;i<remove.length;i++){ const last = merged[merged.length-1];
    if (remove[i][0] <= last[1] + 0.001) last[1] = Math.max(last[1], remove[i][1]); else merged.push(remove[i].slice()); }
  const keep = []; let cur = clipStart;
  for (const seg of merged){ const aa = Math.max(clipStart, seg[0]), bb = Math.min(clipEnd, seg[1]);
    if (aa > cur + 0.05) keep.push([cur, aa]); cur = Math.max(cur, bb); }
  if (cur < clipEnd - 0.05) keep.push([cur, clipEnd]);
  const keep2 = keep.filter(seg => seg[1] - seg[0] >= 0.12);
  while (keep.length) keep.pop(); keep2.forEach(seg => keep.push(seg));
  const keepDur = keep.reduce((a,seg)=>a+(seg[1]-seg[0]),0), fullDur = clipEnd - clipStart;
  if (!keep.length || keepDur < 2 || keepDur > fullDur - 0.3) return null;
  return { keep, removed: +(fullDur - keepDur).toFixed(2) };
}
function srcToComp(t, keep){ let acc = 0; for (const seg of keep){ if (t >= seg[1]) acc += (seg[1]-seg[0]); else if (t <= seg[0]) return acc; else return acc + (t - seg[0]); } return acc; }
function retimeWords(words, keep, clipStart, clipEnd){
  return (words || []).filter(w => w.end > clipStart && w.start < clipEnd && !isFiller(w.word)).map(w => {
    const sft = Math.max(clipStart, w.start), eft = Math.min(clipEnd, w.end);
    return { word:w.word, start:+srcToComp(sft,keep).toFixed(3), end:+srcToComp(eft,keep).toFixed(3) };
  }).filter(w => w.end > w.start);
}
// Render a "tight" file with fillers + silences removed; returns { file, words, duration, removed } or null.
async function tightenClip(input, clipStart, clipEnd, words, workDir, idx, enhance){
  const plan = computeKeep(words, clipStart, clipEnd);
  if (!plan) return null;
  const sel = plan.keep.map(seg => `between(t,${(seg[0]-clipStart).toFixed(3)},${(seg[1]-clipStart).toFixed(3)})`).join('+');
  const out = path.join(workDir, `tight_${idx}.mp4`);
  const vf = `select='${sel}',setpts=N/FRAME_RATE/TB`;
  const af = `aselect='${sel}',asetpts=N/SR/TB` + (enhance ? ',' + AUDIO_ENHANCE : '');
  await run(FFMPEG, ['-ss', String(clipStart), '-t', String(clipEnd-clipStart), '-i', input,
    '-vf', vf, '-af', af, '-c:v','libx264','-preset',X264_PRESET,'-crf',String(Math.max(14,parseInt(X264_CRF,10)-3)),'-maxrate','16M','-bufsize','32M','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-y', out], { cwd: workDir });
  const dur = await probeDuration(out);
  if (!dur || dur < 1) return null;
  return { file: out, words: retimeWords(words, plan.keep, clipStart, clipEnd), duration: dur, removed: plan.removed };
}

// ---- main entry: process one job ----
// ---- Smart reframe: follow the speaker's face (graceful fallback to centre crop) ----
const PYTHON_BIN = process.env.PYTHON_BIN || 'python3';
const FACETRACK_PY = path.join(__dirname, 'facetrack.py');
function runCapture(cmd, args){
  return new Promise((resolve) => {
    let out = '';
    const p = spawn(cmd, args);
    p.stdout.on('data', d => out += d.toString());
    p.on('error', () => resolve(null));
    p.on('close', code => resolve(code === 0 ? out : null));
  });
}
function pwl(pts){
  if (pts.length === 1) return String(pts[0][1]);
  let expr = String(pts[pts.length-1][1]);
  for (let i = pts.length-1; i >= 1; i--){
    const t0 = pts[i-1][0], x0 = pts[i-1][1], t1 = pts[i][0], x1 = pts[i][1];
    const span = (t1 - t0) || 0.001;
    expr = `if(lt(t,${t1}),${x0}+(${x1-x0})*(t-${t0})/${span.toFixed(3)},${expr})`;
  }
  return `if(lt(t,${pts[0][0]}),${pts[0][1]},${expr})`;
}
// Returns an ffmpeg "crop=...:x='expr':y=..,scale=W:H" string, or null to fall back.
async function buildFaceCrop(input, ss, dur, W, H){
  try {
    if (!fs.existsSync(FACETRACK_PY)) return null;
    const out = await runCapture(PYTHON_BIN, [FACETRACK_PY, String(input), String(ss), String(dur), String(W), String(H)]);
    if (!out) return null;
    const d = JSON.parse(out);
    if (!d || !Array.isArray(d.track) || d.track.length < 2 || !d.cw) return null;
    const SW = d.W, SH = d.H, cw = d.cw, ch = d.ch;
    if (cw >= SW && ch >= SH) return null;              // same AR -> no room to pan
    let ema = null; const pts = [];
    for (const row of d.track){
      const t = row[0], cx = row[1];
      ema = (ema == null) ? cx : (ema * 0.7 + cx * 0.3);  // smooth out jitter
      let x = Math.round(ema - cw/2);
      x = Math.max(0, Math.min(SW - cw, x));
      pts.push([+t.toFixed(2), x]);
    }
    let kept = pts;
    if (pts.length > 24){ const stepN = Math.ceil(pts.length/24); kept = pts.filter((_, i) => i % stepN === 0); if (kept[kept.length-1] !== pts[pts.length-1]) kept.push(pts[pts.length-1]); }
    const xexpr = pwl(kept);
    const yc = Math.max(0, Math.round((SH - ch) / 2));
    return `crop=${cw}:${ch}:x='${xexpr}':y=${yc},scale=${W}:${H}:flags=lanczos`;
  } catch (e) { return null; }
}

async function processJob(job, source) {
  const workDir = path.join(TMP, job.id + '_' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });
  ACTIVE++;
  try {
    await setStatus(job.id, { status: 'processing', stage: 'fetching' });
    const input = await fetchSource(source, workDir);
    const vdur = await probeDuration(input);
    if (vdur && vdur > MAX_VIDEO_MINUTES * 60) throw new Error(`Video is ${Math.round(vdur/60)} min long — the limit is ${MAX_VIDEO_MINUTES} min.`);

    // Plan-aware MINUTE quota. This is the authoritative check for URL uploads
    // (whose length is unknown until now) and a backstop for file uploads. It
    // runs before any paid API call, so an over-quota video costs us nothing.
    const videoMinutes = vdur ? vdur / 60 : 0;
    if (videoMinutes > 0) {
      const mq = await checkMinutes(job.user_id, videoMinutes);
      if (!mq.ok) {
        if (mq.reason === 'per_upload') throw new Error(`This video is ${Math.round(videoMinutes)} min. Your ${mq.plan} plan allows up to ${mq.perUpload} min per upload.`);
        throw new Error(`Not enough monthly minutes left on the ${mq.plan} plan (${Math.round(mq.remaining)} min remaining, this video is ${Math.round(videoMinutes)} min). Upgrade or wait for your cycle to reset.`);
      }
      // Charge the input minutes now — the cost is incurred at transcription,
      // regardless of how many clips the video ultimately yields.
      await recordMinutes(job.user_id, videoMinutes);
    }

    await setStatus(job.id, { status: 'processing', stage: 'transcribing' });
    const audio = await extractAudio(input, workDir);
    const transcript = await transcribeLong(audio, workDir, { language: source.language });

    await setStatus(job.id, { status: 'processing', stage: 'selecting' });
    // Feature 4: decide whether the transcript is rich enough for text-based
    // clipping, or whether we should fall back to scene + audio signals.
    const conf = transcriptConfidence(transcript, vdur);
    console.log(`[confidence] job=${job.id} words=${conf.words} wpm=${conf.wpm} sparse=${conf.sparse} confidence=${conf.confidence}`);

    let highlights = [];
    if (!conf.sparse) {
      highlights = await selectHighlights(transcript, { prompt: source.prompt, duration: source.duration, count: source.count, language: source.language || transcript.language });
    }

    // Fallback: sparse transcript OR the text pass found nothing usable. Uses
    // visual scene-change detection + audio energy so gaming/music/silent
    // footage still produces clips. Requires a known duration to window over.
    if (!highlights.length && vdur) {
      console.log(`[signals] job=${job.id} entering scene+audio fallback`);
      const [scenes, energy] = await Promise.all([
        detectScenes(input).catch(() => []),
        analyzeAudioEnergy(input).catch(() => [])
      ]);
      const DR = { auto:{min:15,max:60}, short:{min:10,max:30}, medium:{min:30,max:60}, long:{min:60,max:90} };
      const dr = DR[source.duration] || DR.auto;
      const cands = buildCandidateWindows(scenes, energy, vdur, { min: dr.min, max: dr.max, count: source.count });
      highlights = await rankSignalCandidates(cands, { count: source.count });
      console.log(`[signals] job=${job.id} scenes=${scenes.length} energySamples=${energy.length} candidates=${cands.length} picked=${highlights.length}`);
    }

    if (!highlights.length) throw new Error('No suitable clips found in this video');

    let plan = 'free';
    try { const { data: prof } = await admin.from('profiles').select('plan').eq('id', job.user_id).single(); if (prof && prof.plan) plan = prof.plan; } catch {}
    await setStatus(job.id, { status: 'processing', stage: 'rendering' });
    let made = 0;
    for (let i = 0; i < highlights.length; i++) {
      const c = highlights[i];
      const [W, H] = dimsOf(source.ratio);

      // (a) optional filler/silence tighten
      let tight = null;
      if (source.fillers) {
        try { tight = await tightenClip(input, c.start, c.end, transcript.words, workDir, i, source.enhance); }
        catch (e) { console.warn('[tighten] ' + redact(e.message || e)); }
      }
      const baseFile = tight ? tight.file : input;
      const baseStart = tight ? 0 : c.start;
      const baseEnd = tight ? tight.duration : c.end;
      const baseWords = tight ? tight.words : transcript.words;
      const baseEnhance = tight ? false : source.enhance;
      const clipDur = baseEnd - baseStart;

      // (b) optional face-tracking reframe over the base region
      let reframe = null;
      if (source.faceTrack) {
        try { reframe = await buildFaceCrop(baseFile, baseStart, clipDur, W, H); }
        catch (e) { console.warn('[facetrack] ' + redact(e.message || e)); }
      }

      // (c) optional b-roll
      let brollFile = null, brollStart = null, brollEnd = null;
      if (source.broll && process.env.PEXELS_API_KEY && c.broll) {
        try {
          brollFile = await fetchBroll(c.broll, workDir, i);
          if (brollFile) {
            brollStart = Math.max(0.5, +((clipDur * 0.3).toFixed(2)));
            brollEnd = Math.min(clipDur - 0.5, brollStart + 2.5);
            if (brollEnd <= brollStart) brollFile = null;
          }
        } catch (e) { brollFile = null; }
      }

      const clipObj = { ...c, start: baseStart, end: baseEnd };
      const file = await renderClip(baseFile, baseWords, clipObj, i, workDir, { plan, captionStyle: source.captionStyle, enhance: baseEnhance, brollFile, brollStart, brollEnd, ratio: source.ratio, hook: source.hook ? c.title : '', highlight: source.highlight, progress: source.progress, emoji: source.emoji, karaoke: source.karaoke, reframe: brollFile ? null : reframe });
      const storagePath = await uploadClip(file, job.user_id, job.id, i);

      // (d) editor master: region-based (framing baked in) when tightened or face-tracked
      let master_path = null, wordsRel = null, in_start = null, in_end = null, m0 = 0;
      const regionMaster = !!tight || !!(reframe && !brollFile);
      try {
        if (regionMaster) {
          const mfile = await renderMaster(baseFile, baseStart, baseEnd, i, workDir, { enhance: baseEnhance, ratio: source.ratio, reframe: brollFile ? null : reframe });
          master_path = await uploadMaster(mfile, job.user_id, job.id, i);
          wordsRel = (baseWords || []).filter(w => w.end > baseStart && w.start < baseEnd)
                     .map(w => ({ word: w.word, start: +((w.start - baseStart).toFixed(3)), end: +((w.end - baseStart).toFixed(3)) }));
          in_start = 0; in_end = +clipDur.toFixed(3); m0 = 0;
        } else {
          m0 = Math.max(0, c.start - 10); const m1 = c.end + 10;
          const mfile = await renderMaster(input, m0, m1, i, workDir, { enhance: source.enhance, ratio: source.ratio });
          master_path = await uploadMaster(mfile, job.user_id, job.id, i);
          wordsRel = (transcript.words || []).filter(w => w.end > m0 && w.start < m1)
                     .map(w => ({ word: w.word, start: +((w.start - m0).toFixed(3)), end: +((w.end - m0).toFixed(3)) }));
          in_start = +((c.start - m0).toFixed(3)); in_end = +((c.end - m0).toFixed(3));
        }
      } catch (e) { console.warn('[master] ' + redact(e.message || e)); }

      const { data: _ins } = await admin.from('clips').insert({
        job_id: job.id, user_id: job.user_id,
        title: c.title, score: c.score, storage_path: storagePath,
        start_sec: c.start, end_sec: c.end,
        master_path, words: wordsRel, m0, in_start, in_end,
        edit: { captionStyle: source.captionStyle || 'classic', font: 'Noto Sans Devanagari', fontSize: 74, position: 'bottom', ratio: source.ratio || '9:16', hook: !!source.hook, hookText: source.hook ? c.title : '', highlight: !!source.highlight, progress: !!source.progress, emoji: !!source.emoji, karaoke: source.karaoke === undefined ? true : !!source.karaoke }
      }).select('id').single();
      if (_ins && _ins.id && (c.caption || (c.hashtags && c.hashtags.length))) {
        try { await admin.from('clips').update({ social_caption: c.caption || null, hashtags: (c.hashtags || []).map(h => '#' + h).join(' ') || null }).eq('id', _ins.id); } catch (e) {}
      }
      made++;
    }
    await recordUsage(job.user_id, made);
    await setStatus(job.id, { status: 'done', stage: 'done', clips_count: made, error: null });
  } catch (e) {
    console.error(`[job ${job.id}] failed [${e.code || 'error'}]: ${redact(e.detail || e.message || String(e))}`);
    await setStatus(job.id, { status: 'error', stage: 'error', error: redact(String(e.message || e)).slice(0, 400) });
  } finally {
    ACTIVE = Math.max(0, ACTIVE - 1);
    // cleanup temp files (don't keep user video around)
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    try { if (source.filePath) fs.rmSync(source.filePath, { force: true }); } catch {}
  }
}

// ---- DEV TEST runner: full pipeline WITHOUT Supabase (no auth, no storage) ----
// Renders clips to a local folder and returns their metadata. For local testing only.
async function runTestJob(source, outDir) {
  const workDir = path.join(TMP, 'test_' + crypto.randomBytes(3).toString('hex'));
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const input = await fetchSource(source, workDir);
    const audio = await extractAudio(input, workDir);
    const transcript = await transcribeLong(audio, workDir, { language: source.language });
    const highlights = await selectHighlights(transcript, { prompt: source.prompt, duration: source.duration, count: source.count, language: source.language || transcript.language });
    if (!highlights.length) throw new Error('No suitable clips found in this video');
    const clips = [];
    for (let i = 0; i < highlights.length; i++) {
      const c = highlights[i];
      const file = await renderClip(input, transcript.words, c, i, workDir, { plan: (typeof plan!=='undefined'?plan:'free'), captionStyle: source.captionStyle, enhance: source.enhance });
      const name = `clip_${Date.now()}_${i}.mp4`;
      fs.copyFileSync(file, path.join(outDir, name));
      clips.push({ title: c.title, score: c.score, start: c.start, end: c.end, url: '/test-clips/' + name });
    }
    return { count: clips.length, clips };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    try { if (source.filePath) fs.rmSync(source.filePath, { force: true }); } catch {}
  }
}

module.exports = { processJob, runTestJob, renderClip, renderMaster, renderEdit, buildASS, probeDuration, tightenClip, computeKeep, buildFaceCrop, selectHighlights, extractAudio, transcribe, transcribeLong, planAudioChunks, detectScript, transcriptConfidence, buildCandidateWindows, heuristicPick, normalizeVideoUrl, classifyDownloadError, activeJobs: () => ACTIVE, maxConcurrency: MAX_CONCURRENCY };
