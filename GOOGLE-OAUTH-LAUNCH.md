# Google authentication and YouTube OAuth launch — Snipo Clips

Status: setup guide and submission draft; **NOT a claim that Google credentials, provider settings, domain ownership, or Google verification are complete**. Console actions below must be completed by the Google Cloud/Supabase project owner. Do not commit client secrets.

## Current integration in this repository

- `public/app/login.html` already has a **Continue with Google** button and calls `supa.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + nextUrl() } })` using the public Supabase config. Google login is therefore implemented in the frontend, but requires the Supabase Google provider and Google OAuth client credentials to be configured.
- `routes/youtube.js` and `lib/youtube.js` already implement a separate creator-authorized YouTube connection, channels.list identification, and videos.insert upload. YouTube authorization is initiated *after* the user signs in to Snipo Clips. Google login by itself does not authorize YouTube operations.
- YouTube credentials are server-only: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, plus `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` for state and encrypted token storage. Do not pass the YouTube client secret to the browser or commit it.
- This project does not have a standard YouTube audiovisual download API. OAuth/verification alone does not grant a media-file download interface or permission to bypass YouTube's restrictions.

## 1. Google Cloud project and brand preparation

Go to https://console.cloud.google.com/auth/overview , select a Google Cloud project dedicated to Snipo Clips, and set Google Auth Platform > Branding / Audience. Choose **External** if serving public Google-account users. While in Testing, add your Google accounts to Test users. Supply real support/developer contact emails.

**Before requesting production verification:** choose a consistent public brand (the live Render address is `snipoclips.onrender.com` while existing page metadata in `public/index.html` refers to `snipoclip.com` / `Snipoclip`). Confirm a **domain you own**, make that domain serve the working application, and verify its ownership in Google Search Console using a Google Cloud project Owner/Editor account. Shared `onrender.com` hosting is not proof that you own `onrender.com`. On the owned domain publish accessible, accurate home, Privacy Policy and Terms URLs; link the same Privacy Policy on the homepage and consent screen. Draft policies must accurately reflect real data collection, storage, retention, deletion, subprocessors, account deletion, YouTube API data usage, and revocation; seek the owner's/legal review before publication. These pages are currently NOT established by this guide.

## 2. Client A: Supabase Google Sign-In

Google Auth Platform > Clients > Create client > **Web application**. Suggested name: `Snipo Clips — user sign-in`.

- Authorized JavaScript origin (current deployment): `https://snipoclips.onrender.com`. Replace/add your actual verified custom domain when ready.
- Authorized redirect URI (**Google → Supabase**, exact): `https://wvmujyaoblwgqlnvqxct.supabase.co/auth/v1/callback`.
- Record Client ID and Client Secret securely.

In Supabase project `wvmujyaoblwgqlnvqxct` > Authentication > Sign In / Providers > Google, enable Google and enter **Client A** ID and secret. In Authentication > URL Configuration, set Site URL to `https://snipoclips.onrender.com` (or the final custom domain) and allow exactly `https://snipoclips.onrender.com/app` for the current login handler. Include the final domain's `/app` if using a custom domain. The Supabase `redirectTo` URL is **not** the Google console redirect URI; these are two separate steps.

Validate by opening `/login` in a private browser, clicking Continue with Google, consenting as a test user if applicable, arriving at `/app`, and checking `/api/me` accepts the session. Also check returning Google users sign back into the same identity, email/password login still works, and logout clears the session. Never test with someone else's credentials. If login says provider disabled, check Supabase provider settings first.

## 3. Client B: YouTube channel connection

Within the **same Snipo Clips Google Cloud project**, enable YouTube Data API v3. Create a separate **Web application** OAuth client named `Snipo Clips — YouTube publishing`.

- Authorized JavaScript origin (where applicable): `https://snipoclips.onrender.com` (use your actual domain after migration).
- Authorized redirect URI (**Google → Express**, exact): `https://snipoclips.onrender.com/api/youtube/callback`.
- Set Render server environment variables `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to **Client B** credentials and `YOUTUBE_REDIRECT_URI=https://snipoclips.onrender.com/api/youtube/callback`. Keep `JWT_SECRET` and `TOKEN_ENCRYPTION_KEY` secret and stable. Set URL to the final domain if migrating.
- Current code requests `https://www.googleapis.com/auth/youtube.upload` for uploading clips, plus `https://www.googleapis.com/auth/youtube.readonly` to identify the connected channel with channels.list. Add precisely the scopes actually requested by the running application to Google Auth Platform > Data Access, and explain each in the application submission. Do not request broad channel-management scopes just in case.

After logging in via an actual Snipo user, test **Connect YouTube**, check the displayed channel, upload a creator-owned test clip with user-selected visibility, verify upload status and disconnect/reconnect. Never represent creator authorization as permission to download YouTube video files. Existing unverified YouTube API projects may have uploads restricted to Private: separately pursue the YouTube Data API compliance audit when the project qualifies.

## 4. Google OAuth verification submission

In the same project's Google Auth Platform: complete Branding (exact app name, logo if used, support email, homepage, Privacy Policy, Terms, developer email); Audience (External/Production and app contact information); Data Access (requested scopes and truthful justifications). Verify all owned authorized domains with Search Console. Make the application functional to reviewers and record an unedited screen demonstration showing: open homepage → sign in with Google → user lands in Snipo studio → choose a clip → Connect YouTube → Google permission screen with requested scopes → show channel identity → choose privacy and upload a test clip → disconnect and explain data deletion. Provide a testing account / access path only through Google's official submission channel if reviewers require it, never commit passwords.

Draft public-facing purpose: `Snipo Clips is an AI video editing platform. Users sign in with Google and may separately authorize their own YouTube channel to publish clips they choose. We request YouTube read-only access solely to identify and display the connected channel, and YouTube upload permission solely to upload a clip after the user explicitly initiates publishing. Users can disconnect their channel in the app.` Review this against the final UI and privacy policy before submitting.

Google OAuth **brand/sensitive-scope verification** and YouTube API **compliance/quota audit** are separate processes. Start YouTube audits using https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits . Approval is Google/YouTube's decision; neither this document nor API key creation makes the app verified or authorizes source-video downloads.

## Outstanding owner actions (do not mark complete until verified)

- [ ] Confirm owned custom domain and consistent app name, then verify domain in Search Console.
- [ ] Review and publish genuine homepage-linked Privacy Policy / Terms consistent with actual implementation.
- [ ] Create both Google OAuth clients and configure Supabase Google provider + URL allowlist.
- [ ] Set Client B secrets and exact callback in Render server environment.
- [ ] Complete real Google login/YouTube connection/upload tests (including consent-screen screenshots).
- [ ] Submit Google OAuth verification through the Google Auth Platform when required; separately complete YouTube compliance audit if needed.

Official documentation: https://supabase.com/docs/guides/auth/social-login/auth-google ; https://supabase.com/docs/guides/auth/redirect-urls ; https://support.google.com/cloud/answer/13464321 ; https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification ; https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits ; https://developers.google.com/youtube/terms/developer-policies .
