# Snipoclips — Feature 6: End-to-End Validation Runbook

This is the one feature only **you** can complete: running the real pipeline with
your keys and a real video. Follow this once before trusting it in production.

## Why this can't be skipped
Transcription (Groq), clip selection (Anthropic), and rendering (ffmpeg) only run
with real credentials on a real machine. Everything else has been code-verified and
unit-tested, but clip *quality* and the *live* chain can only be confirmed by a run.

---

## Step 0 — Preconditions
- `npm install` done.
- `.env` filled: `SUPABASE_*`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `JWT_SECRET`,
  `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`.
- `supabase/schema.sql` run once in the Supabase SQL editor (creates tables +
  the new `minutes_used` column and YouTube tables).
- **ffmpeg installed** on the machine. This is the #1 blocker — Hostinger managed
  Node can't run it, which is why the app is meant to deploy on a container host
  (Render, the included `render.yaml` + `Dockerfile`).

## Step 1 — Config check (5 seconds)
```
npm run check
```
Every key and ffmpeg/yt-dlp should show ✓. Fix any ✗ before continuing.

## Step 2 — Fast end-to-end smoke test (≈1 minute)
Grab a **short** clip with speech (30–90s, `.mp4`) and run:
```
npm run smoke path/to/short-clip.mp4
# Hindi/Hinglish clip? add:  npm run smoke clip.mp4 --lang hi
```
It runs every stage — probe → audio → transcribe → confidence → select → render —
prints timings, and writes `smoke-output/clip_0.mp4`. **Open that file** and check:
- captions are present, in sync, correct script (Devanagari for Hindi)
- framing is 9:16 and sensible
- audio is intact

If it prints `PASS`, the whole chain works. If it prints `FAIL`, the last ✓ line
above it is the stage that broke — start there (see Troubleshooting).

## Step 3 — Real run through the app
```
npm start
```
Open http://localhost:8080 → sign up → **My clips / Create**:
1. Upload a real long video (start with ~10–20 min, then try ~60 min).
2. Watch the server console. Expected stages in order:
   `fetching → transcribing → selecting → rendering → done`
   You'll also see `[confidence]` and (for low-dialogue video) `[signals]` logs.
3. Confirm in the UI: clips appear, play, download; the minute counter drops;
   karaoke captions animate; language matches.

## Step 4 — Verify the new v20 features live
- **Minutes quota:** upload something over your plan's per-upload cap → rejected
  before processing with a clear message. Dashboard shows remaining minutes.
- **Karaoke toggle:** off = static captions, on = words light up.
- **Long audio:** run a video >~70 min → transcript still complete (chunking).
- **Scene fallback:** run a near-silent/gaming clip → still get clips.
- **YouTube (if Google creds set):** Settings → Connect; a clip → ▶ Shorts → upload.

---

## Troubleshooting (by stage)
- **probe fails** → file is corrupt or not a video ffmpeg can read.
- **audio fails** → ffmpeg missing or no audio track.
- **transcribe fails** → bad/'missing `GROQ_API_KEY`, or Groq rate limit; error text
  is shown. Very long files auto-chunk; if a chunk fails it's a transient API issue.
- **select fails / 0 clips** → bad/missing `ANTHROPIC_API_KEY`, or the video truly
  has no usable moments (the app then falls back to scene+audio).
- **render fails** → ffmpeg filter/font issue. Check the fonts are installed
  (the Docker image ships them; a bare OS may not have `fonts-indic`).
- **upload/download fails** → Supabase storage buckets missing; re-run schema.sql.

## Cost & safety notes
- Cost scales with **input minutes** (Whisper), not clip count — that's why the
  minute quota exists. Do your first big run on a plan/limit you're comfortable with.
- The smoke test uses your real keys and spends a few cents; that's expected.
- Concurrency is capped (`MAX_CONCURRENCY`, default 2) and single-video length by
  `MAX_VIDEO_MINUTES` (default 180). Adjust in `.env` if needed.
