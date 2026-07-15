# Deploying Snipoclips to Hostinger (fixing the live-site 503)

Your 503 means the Node app is NOT running on the server. The app itself is
fine (it runs on localhost). Do these steps ON HOSTINGER, not on your PC.

## 1. Open the Node.js app setup
hPanel → your website → "Node.js" (or "Setup Node.js App").

## 2. Create / configure the app
- Node version: 18 or higher (24 is fine)
- Application root: the folder you'll upload into (e.g. /domains/yourdomain/app)
- Application startup file: server.js
- Application URL: your domain

## 3. Upload the files INTO that application root
Use hPanel File Manager or SFTP. Upload everything in this `app` folder
EXCEPT node_modules (let the server build it). So upload:
  server.js, package.json, .env.example, lib/, routes/, scripts/, public/,
  supabase/, data/
Do NOT upload node_modules — it's built on the server in step 5.

## 4. Create .env IN the application root (on the server)
Same folder as server.js. Paste the SAME keys you used locally:
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  ANTHROPIC_API_KEY, GROQ_API_KEY, ADMIN_EMAIL, ADMIN_PASSWORD_HASH,
  JWT_SECRET, ALLOWED_ORIGINS=https://yourdomain.com
Also add your live domain to Supabase → URL Configuration → Redirect URLs:
  https://yourdomain.com/app
And add the SAME Supabase callback to Google (you already did the localhost one):
  it's the same callback: https://olwlicqotscencduhtgz.supabase.co/auth/v1/callback

## 5. Install dependencies ON THE SERVER
In the Node.js panel click "Run NPM Install" (or `npm install` over SSH in
the app folder). THIS is the step that's almost certainly missing — without it
the app crashes on boot = 503.

## 6. Start / Restart the app
Click Restart in the Node.js panel. Then open your domain.

## If it STILL 503s
Open the app's log (Node.js panel has a log link, or check stderr/error log in
the app folder) and read the last lines. That is the exact crash reason. The
usual ones:
  - "Cannot find module ..."  -> npm install wasn't run on the server (step 5)
  - a path / permission error -> DATA_DIR or TMP_DIR not writable; set them to
    folders you own, e.g. DATA_DIR=/home/USER/snipoclips-data, TMP_DIR=/tmp

## IMPORTANT honest limitation
The clip pipeline needs ffmpeg (and yt-dlp for URL imports). Hostinger's managed
Node.js hosting usually does NOT let you install ffmpeg. So even once the site
loads, real clip rendering may fail until you move to a VPS (Hostinger VPS, or
Railway/Render/Fly.io) where you can `apt install ffmpeg`. Login, the dashboard,
and the marketing site will work on managed hosting; the rendering step needs
ffmpeg available.
