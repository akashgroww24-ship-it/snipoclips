// scripts/smoke.js — validate the WHOLE pipeline on a short clip before you
// trust it with a 60-minute video. Runs each stage with real keys and times it,
// so if something breaks you see exactly which stage and why.
//
// Usage:
//   node scripts/smoke.js path/to/short-clip.mp4
//   node scripts/smoke.js path/to/short-clip.mp4 --lang hi
//
// Use a SHORT real video with speech (30–90s) for a fast, honest end-to-end check.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  probeDuration, extractAudio, transcribeLong, transcriptConfidence,
  selectHighlights, buildCandidateWindows, heuristicPick, renderClip
} = require('../lib/pipeline');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m';
const ok = m => console.log(`  ${G}✓${X} ${m}`);
const bad = m => console.log(`  ${R}✗${X} ${m}`);
const info = m => console.log(`  ${D}${m}${X}`);
const t0 = () => process.hrtime.bigint();
const ms = a => Number((process.hrtime.bigint() - a) / 1000000n);

async function main() {
  const args = process.argv.slice(2);
  const input = args.find(a => !a.startsWith('--'));
  const langIdx = args.indexOf('--lang');
  const language = langIdx >= 0 ? args[langIdx + 1] : undefined;

  console.log('\n  Snipoclips — pipeline smoke test\n  ' + '-'.repeat(34));
  if (!input) { bad('Give a video file:  node scripts/smoke.js clip.mp4'); process.exit(1); }
  if (!fs.existsSync(input)) { bad('File not found: ' + input); process.exit(1); }

  // preflight
  let hardFail = false;
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); ok('ffmpeg present'); }
  catch { bad('ffmpeg NOT found — install it (this is the #1 deploy blocker)'); hardFail = true; }
  if (process.env.GROQ_API_KEY) ok('GROQ_API_KEY set'); else { bad('GROQ_API_KEY missing (transcription)'); hardFail = true; }
  if (process.env.ANTHROPIC_API_KEY) ok('ANTHROPIC_API_KEY set'); else { bad('ANTHROPIC_API_KEY missing (clip selection)'); hardFail = true; }
  if (hardFail) { console.log(`\n  ${R}Fix the above, then re-run.${X}\n`); process.exit(1); }

  const work = path.resolve('./smoke-work');
  const out = path.resolve('./smoke-output');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(out, { recursive: true });

  const overall = t0();
  try {
    // 1) probe
    let a = t0();
    const dur = await probeDuration(input);
    if (!dur) throw new Error('could not read video duration');
    ok(`probe: ${dur.toFixed(1)}s video  ${D}(${ms(a)}ms)${X}`);

    // 2) extract audio
    a = t0();
    const audio = await extractAudio(input, work);
    ok(`audio extracted  ${D}(${ms(a)}ms, ${(fs.statSync(audio).size / 1024).toFixed(0)}KB)${X}`);

    // 3) transcribe (auto-chunks if needed)
    a = t0();
    const tr = await transcribeLong(audio, work, { language });
    const words = (tr.words || []).length;
    ok(`transcribed: ${words} words, language=${tr.language || 'auto'}  ${D}(${ms(a)}ms)${X}`);

    // 4) confidence / routing
    const conf = transcriptConfidence(tr, dur);
    info(`confidence: wpm=${conf.wpm} sparse=${conf.sparse} score=${conf.confidence}`);

    // 5) pick highlights (mirrors processJob: text path, else scene fallback)
    a = t0();
    let highlights = [];
    if (!conf.sparse) {
      highlights = await selectHighlights(tr, { duration: 'auto', count: 2, language: language || tr.language });
    }
    if (!highlights.length) {
      info('sparse/empty transcript → scene+audio fallback (heuristic ranking here)');
      const cands = buildCandidateWindows([], [], dur, { min: 15, max: 45, count: 2 });
      highlights = heuristicPick(cands, 2);
    }
    if (!highlights.length) throw new Error('no clips selected');
    ok(`selected ${highlights.length} clip(s)  ${D}(${ms(a)}ms)${X}`);
    highlights.forEach((h, i) => info(`  #${i + 1} ${h.start.toFixed(1)}-${h.end.toFixed(1)}s  "${h.title}"  score ${h.score}`));

    // 6) render the first clip (captions + reframe)
    a = t0();
    const clip = { ...highlights[0] };
    const file = await renderClip(input, tr.words || [], clip, 0, work, { captionStyle: 'classic', ratio: '9:16', hook: clip.title, highlight: true, karaoke: true, plan: 'full' });
    const dest = path.join(out, 'clip_0.mp4');
    fs.copyFileSync(file, dest);
    ok(`rendered clip → ${dest}  ${D}(${ms(a)}ms, ${(fs.statSync(dest).size / 1024).toFixed(0)}KB)${X}`);

    console.log(`\n  ${G}PASS${X} — full pipeline works end-to-end in ${(ms(overall) / 1000).toFixed(1)}s.`);
    console.log(`  Open ${G}${path.join(out, 'clip_0.mp4')}${X} and check captions, framing & audio.`);
    console.log('  If it looks right, you are clear to run a real long video through the app.\n');
  } catch (e) {
    console.log(`\n  ${R}FAIL${X} — ${e.message || e}`);
    console.log(`  ${D}The stage above the FAIL line is the last one that passed — start debugging there.${X}\n`);
    process.exit(1);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
main();
