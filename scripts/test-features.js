// scripts/test-features.js
// Automated tests for the v20 feature work. Pure logic only — no DB, no network,
// no ffmpeg — so it runs anywhere with `npm test`.
//
// Covers:
//   Feature 1  minuteDecision  — plan-aware per-upload + monthly minute quota
//   Feature 3  buildASS        — karaoke (\k) vs normal (static) captions
//   Feature 7  planAudioChunks — chunk windows with gap-free, dup-free ownership
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-feature-tests';

const { minuteDecision, planOf } = require('../lib/quota');
const { planAudioChunks, buildASS, detectScript, transcriptConfidence, buildCandidateWindows, heuristicPick } = require('../lib/pipeline');
const box = require('../lib/secretbox');
const yt = require('../lib/youtube');

// ---------------------------------------------------------------- Feature 1
test('minuteDecision: rejects a single upload longer than the per-upload cap', () => {
  const free = planOf('free'); // maxUploadMin 30, monthlyMin 60
  const d = minuteDecision(free, 0, 45);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'per_upload');
});

test('minuteDecision: rejects when it would exceed the monthly balance', () => {
  const single = planOf('single'); // maxUploadMin 90, monthlyMin 300
  const d = minuteDecision(single, 290, 20); // 310 > 300
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'monthly');
  assert.equal(d.remaining, 10);
});

test('minuteDecision: allows an upload that fits both caps', () => {
  const half = planOf('half'); // maxUploadMin 150, monthlyMin 900
  const d = minuteDecision(half, 100, 60);
  assert.equal(d.ok, true);
  assert.equal(d.reason, null);
});

test('minuteDecision: exact monthly boundary is allowed (<=, not <)', () => {
  const single = planOf('single');
  const d = minuteDecision(single, 250, 50); // 300 == 300
  assert.equal(d.ok, true);
});

// ---------------------------------------------------------------- Feature 7
test('planAudioChunks: short audio stays a single chunk', () => {
  const chunks = planAudioChunks(600, 6000); // 10 min, well under cap
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].start, 0);
  assert.equal(chunks[0].end, 600);
});

test('planAudioChunks: long audio splits with gap-free ownership bands', () => {
  const dur = 3 * 3600; // 3-hour podcast
  const chunks = planAudioChunks(dur, 6000);
  assert.ok(chunks.length > 1, 'should split into multiple chunks');

  // ownership bands must tile [0, dur] with no gaps and no overlaps
  assert.equal(chunks[0].ownStart, 0);
  assert.equal(chunks[chunks.length - 1].ownEnd, dur);
  for (let i = 1; i < chunks.length; i++) {
    assert.ok(Math.abs(chunks[i].ownStart - chunks[i - 1].ownEnd) < 1e-6,
      `band ${i} must start where band ${i - 1} ends`);
  }
  // every ownership band must sit inside its (padded) transcription window
  for (const c of chunks) {
    assert.ok(c.ownStart >= c.start - 1e-6 && c.ownEnd <= c.end + 1e-6);
  }
});

// ---------------------------------------------------------------- Feature 3
const WORDS = [
  { word: 'यह', start: 0.0, end: 0.4 },
  { word: 'बहुत', start: 0.4, end: 0.9 },
  { word: 'powerful', start: 0.9, end: 1.5 },
  { word: 'strategy', start: 1.5, end: 2.2 }
];

function render(opts) {
  const p = path.join(os.tmpdir(), `ass_${Math.random().toString(36).slice(2)}.ass`);
  buildASS(WORDS, 0, 3, p, opts);
  const out = fs.readFileSync(p, 'utf8');
  fs.rmSync(p, { force: true });
  return out;
}

test('buildASS: karaoke mode emits \\k progressive-fill timing tags', () => {
  const ass = render({ captionStyle: 'classic', karaoke: true });
  assert.ok(/\\k\d+/.test(ass), 'expected \\k timing tags in karaoke mode');
});

test('buildASS: normal mode emits NO \\k timing tags', () => {
  const ass = render({ captionStyle: 'classic', karaoke: false });
  assert.ok(!/\\k\d+/.test(ass), 'normal mode must not contain \\k tags');
});

test('buildASS: karaoke defaults ON when unspecified (back-compat)', () => {
  const ass = render({ captionStyle: 'classic' });
  assert.ok(/\\k\d+/.test(ass), 'karaoke should default on');
});

test('buildASS: Devanagari + Latin words both render (Hinglish safe)', () => {
  const ass = render({ captionStyle: 'classic', karaoke: true });
  assert.ok(ass.includes('यह') && ass.includes('powerful'),
    'both scripts must survive into the subtitle file');
});

// ---------------------------------------------------------------- Feature 2
test('detectScript: pure Hindi is labelled hindi', () => {
  const d = detectScript('यह एक बहुत अच्छा वीडियो है');
  assert.equal(d.label, 'hindi');
  assert.equal(d.hasDevanagari, true);
});

test('detectScript: mixed speech is labelled hinglish', () => {
  const d = detectScript('यह strategy बहुत powerful है for growth');
  assert.equal(d.label, 'hinglish');
});

test('detectScript: pure English is labelled english', () => {
  const d = detectScript('this is a really powerful growth strategy');
  assert.equal(d.label, 'english');
  assert.equal(d.hasDevanagari, false);
});

test('detectScript: empty/no-letters falls back to auto', () => {
  assert.equal(detectScript('').label, 'auto');
  assert.equal(detectScript('12345 —— !!').label, 'auto');
});

test('buildASS: Hindi text forces a Devanagari font even if a Latin font is requested', () => {
  const ass = render({ captionStyle: 'classic', font: 'Impact' });
  // the Style line must carry a Devanagari-capable font, not the requested Latin one
  const styleLine = ass.split('\n').find(l => l.startsWith('Style: Cap,'));
  assert.ok(/Devanagari/i.test(styleLine), 'expected a Devanagari font on the caption style');
  assert.ok(!/Impact/i.test(styleLine), 'must not keep the Latin-only font for Hindi text');
});

// ---------------------------------------------------------------- Feature 4
test('transcriptConfidence: a talky video is NOT sparse', () => {
  // 600 words over 10 min = 60 wpm, well above the ~18 threshold
  const words = Array.from({ length: 600 }, (_, i) => ({ word: 'w', start: i, end: i + 0.5 }));
  const c = transcriptConfidence({ words }, 600);
  assert.equal(c.sparse, false);
  assert.ok(c.confidence > 0.5);
});

test('transcriptConfidence: a gaming clip with almost no speech IS sparse', () => {
  const words = [{ word: 'go', start: 5, end: 5.3 }, { word: 'nice', start: 40, end: 40.4 }];
  const c = transcriptConfidence({ words }, 600); // 2 words in 10 min
  assert.equal(c.sparse, true);
});

test('transcriptConfidence: empty transcript is sparse', () => {
  assert.equal(transcriptConfidence({ words: [] }, 300).sparse, true);
});

test('buildCandidateWindows: produces scored windows and ranks louder ones higher', () => {
  const dur = 120;
  const scenes = [10, 12, 14, 62, 64]; // activity clusters near 10s and 62s
  // loud around 60s, quiet elsewhere
  const energy = [];
  for (let t = 0; t < dur; t += 1) energy.push({ t, e: (t >= 58 && t <= 66) ? -8 : -35 });
  const cands = buildCandidateWindows(scenes, energy, dur, { min: 15, max: 30, count: 5 });
  assert.ok(cands.length > 1);
  // top candidate should overlap the loud region around 60s
  const top = cands[0];
  assert.ok(top.start < 66 && top.end > 58, 'highest-scoring window should sit on the loud section');
});

test('heuristicPick: returns non-overlapping, time-ordered clips', () => {
  const dur = 120;
  const energy = Array.from({ length: dur }, (_, t) => ({ t, e: -20 - (t % 10) }));
  const cands = buildCandidateWindows([], energy, dur, { min: 15, max: 30, count: 4 });
  const picks = heuristicPick(cands, 4);
  assert.ok(picks.length >= 1 && picks.length <= 4);
  for (let i = 1; i < picks.length; i++) {
    assert.ok(picks[i].start >= picks[i - 1].end, 'clips must not overlap and must be in order');
  }
  // shape matches what processJob expects downstream
  assert.ok('start' in picks[0] && 'end' in picks[0] && 'title' in picks[0] && 'score' in picks[0]);
});

test('buildCandidateWindows: never returns empty for a valid duration', () => {
  const cands = buildCandidateWindows([], [], 20, { min: 15, max: 30, count: 3 });
  assert.ok(cands.length >= 1);
});

// ---------------------------------------------------------------- Feature 5
test('secretbox: encrypt then decrypt round-trips the original token', () => {
  const secret = 'ya29.a0Af_Example_Access_Token-with.symbols_123/=';
  const blob = box.encrypt(secret);
  assert.notEqual(blob, secret, 'stored value must not be plaintext');
  assert.ok(blob.startsWith('v1:'), 'versioned format');
  assert.equal(box.decrypt(blob), secret);
});

test('secretbox: tampered ciphertext fails authentication (does not silently return garbage)', () => {
  const blob = box.encrypt('refresh-token-xyz');
  const parts = blob.split(':');
  const bad = [parts[0], parts[1], parts[2], Buffer.from('tampered').toString('base64')].join(':');
  assert.throws(() => box.decrypt(bad));
});

test('youtube.shortsTitle: appends #Shorts once, never twice', () => {
  assert.match(yt.shortsTitle('My clip'), /#Shorts$/);
  const already = yt.shortsTitle('Already #Shorts here');
  assert.equal((already.match(/#shorts/gi) || []).length, 1);
});

test('youtube.configured: false when Google creds are absent', () => {
  const c1 = process.env.GOOGLE_CLIENT_ID, c2 = process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal(yt.configured(), false);
  if (c1) process.env.GOOGLE_CLIENT_ID = c1; if (c2) process.env.GOOGLE_CLIENT_SECRET = c2;
});

test('youtube.authUrl: includes offline access + upload scope + state', () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  const url = yt.authUrl('STATE123', 'https://app.example.com/api/youtube/callback');
  assert.match(url, /access_type=offline/);
  assert.match(url, /youtube\.upload/);
  assert.match(url, /state=STATE123/);
  delete process.env.GOOGLE_CLIENT_ID;
});
