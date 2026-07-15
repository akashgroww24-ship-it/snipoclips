# Snipoclips — full app

The complete product: marketing site, blog, user app (auth + upload + clips),
admin dashboard, and the AI clip pipeline. One Node server runs all of it.

## What you do (about 20 minutes + your keys)

1) Install system tools on the server
   sudo apt install ffmpeg          # required (cutting/reframing/captions)
   pip install yt-dlp               # optional (for "paste a URL" imports)

2) Create a Supabase project (free tier is fine)
   - In Supabase → SQL Editor, paste & run  supabase/schema.sql
   - That creates the tables, security rules (RLS), and the storage buckets.
   - Project Settings → API gives you the 3 Supabase keys for .env.
   - Authentication → enable Email; set the password-reset redirect to
     https://yourdomain/login

3) Configure
   cp .env.example .env
   # fill in: Supabase (3 keys), ANTHROPIC_API_KEY, GROQ_API_KEY,
   #          ADMIN_EMAIL/ADMIN_PASSWORD_HASH, JWT_SECRET, ALLOWED_ORIGINS
   node -e "console.log(require('bcryptjs').hashSync('YourAdminPassword',12))"   # ADMIN_PASSWORD_HASH
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"      # JWT_SECRET

4) Run
   npm install
   npm run check      # confirms every key + ffmpeg/yt-dlp are ready
   npm test           # runs the feature unit tests (quota, captions, chunking)
   npm start          # serves everything on PORT

## Plan limits & optional tuning (env)
Clip limits and minute limits are enforced server-side in lib/quota.js.
All of the following are OPTIONAL — sensible defaults ship in code:
   FREE_CLIP_LIMIT            free lifetime clips (default 2)
   # per-upload length caps (minutes) and monthly minute allowances per plan:
   FREE_MAX_UPLOAD_MIN=30     FREE_MONTHLY_MIN=60
   SINGLE_MAX_UPLOAD_MIN=90   SINGLE_MONTHLY_MIN=300
   HALF_MAX_UPLOAD_MIN=150    HALF_MONTHLY_MIN=900
   FULL_MAX_UPLOAD_MIN=180    FULL_MONTHLY_MIN=3000
   # long-audio transcription (Feature 7) — chunks audio over Whisper's 25MB cap:
   WHISPER_MAX_BYTES          per-chunk byte ceiling (default 24MB)
   CHUNK_OVERLAP_SEC          overlap between chunks in seconds (default 6)
   # language (Feature 2) — auto-detected by default; override per job in the UI:
   WHISPER_PROMPT             punctuation/Hinglish bias hint sent to Whisper (has a sensible default)
   # scene-detection fallback (Feature 4) — for gaming/music/low-dialogue video:
   SPARSE_WORDS_PER_MIN       below this words/min, switch to scene+audio clipping (default 18)
   SCENE_THRESHOLD            ffmpeg scene-change sensitivity 0..1 (default 0.4)

## YouTube one-click upload (Feature 5) — requires Google setup
The code is ready; to switch it on you must create Google credentials (the app
hides the feature until these are set):
  1. console.cloud.google.com -> new project.
  2. Enable "YouTube Data API v3".
  3. APIs & Services -> OAuth consent screen: External; add the youtube.upload
     and youtube.readonly scopes; add yourself as a Test user (while unverified).
  4. Credentials -> Create OAuth client ID -> Web application. Add an authorized
     redirect URI EXACTLY equal to:  https://YOURDOMAIN/api/youtube/callback
     (for local testing: http://localhost:8080/api/youtube/callback)
  5. Put these in .env:
       GOOGLE_CLIENT_ID=...
       GOOGLE_CLIENT_SECRET=...
       YOUTUBE_REDIRECT_URI=https://YOURDOMAIN/api/youtube/callback   # must match step 4
       TOKEN_ENCRYPTION_KEY=<optional; a long random string. Falls back to JWT_SECRET>
Tokens are stored AES-256-GCM encrypted (lib/secretbox.js) and never sent to the browser.
Note: while your OAuth app is in "Testing" mode, only added Test users can connect,
and uploads default to Private until Google verifies the app.

## URLs (one server)
- /            marketing site
- /blog/       blog (SEO)
- /login       sign in / sign up / forgot password (Supabase)
- /app         the studio: upload or paste URL, watch jobs, download clips
- /dashboard   admin ops dashboard (separate admin login)
- /api/...     the app + AI pipeline API

## How the pipeline works (lib/pipeline.js)
source video → extract audio → Whisper transcript (word timestamps) →
Claude picks the best 15-60s ranges → per clip: ffmpeg cut + reframe to 9:16 +
burn captions → upload to Supabase (private) → row in `clips`. Quota is checked
server-side before each job; usage is recorded after.

## Security built in
- API keys live in .env (server only). The browser never sees Anthropic/Groq/
  service-role keys. It only gets the Supabase ANON key (safe; RLS-protected).
- helmet (CSP/HSTS/nosniff/clickjacking), CORS locked to your origins, rate limits.
- Supabase Auth for users (httpOnly handled by Supabase); JWT verified server-side
  on every /api call. Admin uses a separate bcrypt+JWT httpOnly cookie.
- RLS means even a leaked anon key can't read another user's clips.
- Plan limits enforced on the SERVER (the browser is never trusted).

## Honest scope — what's a starter vs done
- Pipeline is real and runnable, but I could not execute a full job here (needs
  your keys + ffmpeg/yt-dlp + a real video). Test end-to-end after you add keys.
- Reframe is a center-crop to 9:16; true speaker tracking is a later upgrade.
- Captions are line-level; word-by-word karaoke is a later upgrade.
- In-process worker (fine for low volume). For scale, move jobs to BullMQ+Redis
  and run rendering on dedicated workers — shared hosting won't handle heavy ffmpeg.
- Whisper caps audio at 25MB; chunk very long videos.
- PayU billing + webhook signature verification still to wire (plan upgrades).
- Nothing is "unhackable." This is hardened to a professional standard; security
  is ongoing. Test, monitor your AI spend, and add per-IP abuse limits before
  going fully public.
