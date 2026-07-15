# Snipoclips — What you still need to go live

Everything in the code is done. This list is the stuff only **you** can do because it needs your accounts, keys, and a server that can run ffmpeg. Ordered by what blocks launch first.

---

## 1. A host that can run ffmpeg + yt-dlp  ← hard blocker
Hostinger's managed Node hosting **cannot run ffmpeg**, so the clip pipeline won't work there. You need a container host:

- **Render** or **Railway** or **Fly.io** (easiest — `Dockerfile` is already in the repo, they auto-build it)
- or your **own VPS** (Hostinger VPS / DigitalOcean / Hetzner) with Docker installed

The `Dockerfile` already installs ffmpeg and yt-dlp. On a plain VPS without Docker you'd run:
```
sudo apt update && sudo apt install -y ffmpeg python3-pip && pip3 install yt-dlp
```

Pick container hosting and you skip all of that.

## 2. Supabase project
1. Create a project at supabase.com
2. SQL editor → paste and run `supabase/schema.sql`
3. Storage → create **two private buckets**: `uploads` and `clips`
4. Authentication → Providers → enable **Google** (you said this is done — just confirm the redirect URL is `https://YOURDOMAIN/app`)
5. Copy into `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server), and the anon key is served to the browser via `/api/public-config` — set `SUPABASE_ANON_KEY` too.

## 3. Fill in `.env` (copy from `.env.example`)
Required to boot for real:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`
- `ANTHROPIC_API_KEY` (clip selection)
- `GROQ_API_KEY` (transcription)
- `JWT_SECRET` (any long random string)
- `ADMIN_PASSWORD_HASH` (for the /dashboard login — generate with the snippet in `.env.example`)
- `DATA_DIR` → point at a path **outside** the project folder so job data survives redeploys
- `DEV_TEST_MODE=0` in production
- `FREE_CLIP_LIMIT=2` (already the default)

## 4. Payments (turn the checkout stub into real charging)
Right now `/api/checkout` returns an honest "not configured" until you add keys. Wire it up:
- **Razorpay** — best for India + international. Add `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, then in `routes/billing.js` create an order in the marked TODO and verify the signature in a webhook.
- **Stripe** — best for USD/EUR/GBP cards. Add `STRIPE_SECRET_KEY`, create a Checkout Session in the marked TODO.
- The **webhook** is what actually flips a user's plan in Supabase after payment — that's the one piece you must not skip, or people pay and stay on free.

Both stubs in `routes/billing.js` tell you exactly which keys are missing when called, so you can test incrementally.

## 5. Transactional email
For receipts, welcome, and password-reset emails. Add `RESEND_API_KEY` (resend.com is simplest) or your own SMTP. Supabase already sends auth confirm/reset mails, so this is only needed for billing receipts and nicer onboarding.

## 6. Watermark on free-tier exports  ← small gap
The pricing promises free clips are watermarked, but the pipeline doesn't burn one in yet. Add a watermark overlay in `lib/pipeline.js` at the ffmpeg render step for users whose plan is `free`. ~10 lines of ffmpeg `drawtext`/`overlay`.

## 7. Live FX rates (optional)
Currency conversion uses a static table in `lib/plans.js`. Fine for launch. When you want accuracy, swap `FX` for a daily fetch from any free FX API and cache it.

## 8. Scale-only, do later
- **Job queue** (BullMQ + Redis) — current worker runs in-process, fine until you have concurrent users rendering at once.
- **Abuse protection** — add a captcha on signup + a rate limit on generate so people don't burn your Groq/Claude credits.
- **Speaker-tracking reframe** — currently center-crop; word-by-word karaoke captions are line-level. Both are polish, not blockers.

---

## Quick local test before you deploy
```
cp .env.example .env     # fill in the keys above
npm install
npm start                # boots on PORT (default 3000)
```
Open `/` (landing), `/app` (studio), `/dashboard` (admin). Until Supabase keys are set, auth will say "not configured" — that's expected.

## Launch order that works
1. Container host + ffmpeg (step 1)
2. Supabase + schema + buckets + Google (step 2)
3. `.env` filled (step 3) → now the product fully works end to end
4. Razorpay/Stripe + webhook (step 4) → now you can take money
5. Email + watermark (steps 5–6) → polish
6. Point your domain at the host, set `DEV_TEST_MODE=0`, go live.
