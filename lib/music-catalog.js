const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { admin } = require('./supabase');

const BUCKET = process.env.REEL_MUSIC_BUCKET || 'music';
const TMP = process.env.TMP_DIR || path.join(os.tmpdir(), 'snipoclips');
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function safeNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', d => err += d.toString());
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`)));
  });
}

async function listTracks({ q = '', mood = '', genre = '', limit = 50 } = {}) {
  let query = admin.from('music_tracks')
    .select('id,title,artist,artwork_url,genre,mood,energy,bpm,duration_sec,instrumental,vocals,language,license_type,attribution,source,tags,featured')
    .eq('is_active', true)
    .eq('commercial_use', true)
    .order('featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, Number(limit) || 50)));

  if (mood) query = query.eq('mood', mood);
  if (genre) query = query.eq('genre', genre);
  if (q) {
    const needle = String(q).replace(/[,%()]/g, ' ').trim();
    if (needle) query = query.or(`title.ilike.%${needle}%,artist.ilike.%${needle}%,genre.ilike.%${needle}%,mood.ilike.%${needle}%`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

async function getTrack(id) {
  if (!id) return null;
  const { data, error } = await admin.from('music_tracks').select('*').eq('id', id).eq('is_active', true).eq('commercial_use', true).single();
  if (error || !data) return null;
  return data;
}

async function previewUrl(trackId, expiresIn = 600) {
  const track = await getTrack(trackId);
  if (!track) return null;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(track.storage_path, Math.max(60, Math.min(3600, expiresIn)));
  if (error || !data) return null;
  return { url: data.signedUrl, track };
}

async function prepareTrackSegment(trackId, opts = {}) {
  const track = await getTrack(trackId);
  if (!track) throw new Error('Music track not found');

  fs.mkdirSync(TMP, { recursive: true });
  const ext = path.extname(track.storage_path || '') || '.mp3';
  const token = crypto.randomBytes(4).toString('hex');
  const source = path.join(TMP, `music_${track.id}_${token}${ext}`);
  const output = path.join(TMP, `music_segment_${track.id}_${token}.m4a`);

  const { data, error } = await admin.storage.from(BUCKET).download(track.storage_path);
  if (error || !data) throw new Error('Could not download music track');
  fs.writeFileSync(source, Buffer.from(await data.arrayBuffer()));

  const start = Math.max(0, safeNum(opts.start, 0));
  const requested = Math.max(1, safeNum(opts.duration, 60));
  const maxDur = track.duration_sec ? Math.max(1, Number(track.duration_sec) - start) : requested;
  const duration = Math.max(1, Math.min(requested, maxDur));

  try {
    await run(FFMPEG, ['-ss', String(start), '-i', source, '-t', String(duration), '-vn', '-c:a', 'aac', '-b:a', '192k', '-y', output]);
    return { filePath: output, track, start, duration };
  } finally {
    try { fs.rmSync(source, { force: true }); } catch {}
  }
}

async function logUse({ userId, jobId, trackId, start = 0, duration = null, provider = 'snipo' }) {
  try {
    await admin.from('music_uses').insert({
      user_id: userId,
      job_id: jobId || null,
      track_id: trackId || null,
      segment_start: safeNum(start, 0),
      segment_duration: duration == null ? null : safeNum(duration, null),
      provider
    });
  } catch {}
}

module.exports = { BUCKET, listTracks, getTrack, previewUrl, prepareTrackSegment, logUse };
