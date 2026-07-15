# Snipoclips — Go-Live Checklist

## THE GATE: hosting with ffmpeg
Clips render with ffmpeg. Managed/shared hosting can't run it. Deploy to one of:
- **Render** (easiest): New → Web Service → connect repo → it reads the Dockerfile →
  add env vars in the dashboard → deploy. (render.yaml is included.)
- **Railway**: New Project → Deploy from repo → it builds the Dockerfile → add env vars.
- **Fly.io** or a **VPS** (Hostinger VPS, DigitalOcean): `apt install ffmpeg`, run the app.
The Dockerfile bakes in ffmpeg + yt-dlp, so any container platform works out of the box.

## MUST be set/working for launch (not "later")
1. Env vars on the host (NOT in a committed file):
   NODE_ENV=production
   ALLOWED_ORIGINS=https://snipoclips.com,https://www.snipoclips.com
   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
   ANTHROPIC_API_KEY / GROQ_API_KEY
   ADMIN_EMAIL / ADMIN_PASSWORD_HASH / JWT_SECRET
   DATA_DIR=/var/data (a writable, persistent path on the host)
   DEV_TEST_MODE=0   <-- OFF in production
2. Supabase: run supabase/schema.sql; confirm `uploads` + `clips` buckets exist.
3. Supabase → URL Configuration → Site URL = https://snipoclips.com,
   Redirect URLs include https://snipoclips.com/app
4. Google Cloud → your OAuth client → Authorized redirect URIs include:
   https://olwlicqotscencduhtgz.supabase.co/auth/v1/callback
   and publish the OAuth consent screen (so non-test users can sign in).
5. Point snipoclips.com DNS at the host (Render/Railway give you a target).

## OK to fix AFTER launch (real "small stuff")
- PayU billing — launch with the Free plan only; add upgrades later. Until then,
  the pricing buttons just send people to signup (they all get Free).
- Word-by-word captions, speaker tracking, longer-than-25MB audio chunking.
- More languages, brand templates, scheduling.

## Cost reality
Each clip job costs Groq + Claude usage + your compute/storage. Keep the per-user
quotas on, and watch spend the first week. Turn DEV_TEST_MODE off so nobody can
run the pipeline for free without an account.
