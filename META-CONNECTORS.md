# Snipoclip Meta connectors

## What ships

Instagram Business/Creator login and Facebook Page login are independent. An authenticated user starts OAuth, Meta redirects to a provider-specific callback, and the server exchanges the code. Tokens are encrypted with `lib/secretbox.js` and never returned through the app API. Only an explicitly selected finished clip can be queued for a Reel. The database claim function coordinates web instances; a crashed publish request is marked **uncertain** rather than automatically posting twice. Insights are deliberately off until Meta grants an insights permission and the endpoint/metric mapping is implemented.

Personal Instagram accounts, Facebook personal timelines, browsing activity, and screen time are outside this feature.

## Verified primary references (checked September 30, 2026)

- [Meta Instagram API with Instagram Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login) — professional accounts; a linked Facebook Page is not required.
- [Meta Business Login for Instagram](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login) and [Meta access tokens](https://developers.facebook.com/documentation/instagram-platform/reference/access_token) — code exchange and long-lived token refresh.
- [Meta's Instagram Postman collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) — `instagram_business_basic`, `instagram_business_content_publish`, Reel media container/status/publish.
- [Meta's Facebook Reels Postman collection](https://www.postman.com/meta/facebook/folder/simabyk/reels-publishing) — start, hosted `file_url` upload, optional status, finish. The `finish` operation starts Facebook's processing; the worker keeps polling after it.
- [Meta permissions reference](https://developers.facebook.com/documentation/development/permissions) — Page permissions and access levels.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [signed URLs](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl), and [Data API grants change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).

Meta's current dashboard and docs are the authority for supported Graph versions and approval requirements. The old Facebook sample's `v13.0` is historical; set `META_GRAPH_VERSION` to a currently supported version and test its endpoints. No version is silently selected in production.

## Meta Developer setup

1. Create/configure the Meta app for Instagram API with Instagram Login and Facebook Login/Page access. Add the exact HTTPS callbacks from `.env.meta.example` to the respective allowed redirect URI lists. Register `https://snipoclip.com/#/privacy` as the privacy URL and provide Meta with a functioning data-deletion contact/instructions. Review the current policy text with counsel; the site still labels its legal text a template.
2. Instagram permissions requested: `instagram_business_basic` and `instagram_business_content_publish`. Facebook permissions requested: `pages_show_list`, `pages_read_engagement`, and `pages_manage_posts`. No messaging, ads, personal-profile posting, or insights permissions are requested.
3. Configure the two app IDs and secrets, exact redirect URLs, a current `META_GRAPH_VERSION`, and a stable `TOKEN_ENCRYPTION_KEY` as Render secret variables. The Instagram product may issue an Instagram-specific app ID/secret; use that pair for `META_INSTAGRAM_*`. Never place a secret in `/api/public-config` or frontend code.
4. Apply `supabase/migrations/20260930_meta_social.sql` to the Snipoclip Supabase project **before** deploying this code. It creates server-only tables with RLS and a service-role-only queue claim function. Confirm the Supabase Data API grants let the service-role server access those tables and RPC; do not grant client roles access to token columns.
5. Add an Instagram professional test account and a Facebook account with Page `CREATE_CONTENT` task access as app testers/admins. Test OAuth, reconnect, one short Reel, status, and disconnect in development mode. For other customers, submit only the needed permissions for Meta App Review and complete any required business verification and data-use checks. Do not call the feature publicly available until approved.
6. Use the Social accounts panel to connect. The user chooses a finished clip and checks a confirmation box for each Reel. Revoke the integration at Meta and delete already published Reels there if needed. Disconnecting in Snipoclip deletes its account tokens and publication history; it does not delete content already published on Meta.

## Worker and limits

The web process starts a 15-second poller. The queue uses database row locking (`FOR UPDATE SKIP LOCKED`) and a two-minute lease; one Render instance is sufficient and additional instances will not claim the same job. `ffprobe` checks the private signed clip URL before any publication. Instagram permits only the conservative supported 3–900 second, vertical H.264/HEVC and AAC MP4 profile in this implementation; Facebook uses a conservative 4–60 second, at least 540×960/23fps, 9:16 profile from Meta's published Reels sample. Meta may update limits; update validation from the current primary docs before broad launch.

A single signed Storage URL for the selected private object expires after six hours and is handed only to Meta's media ingestion endpoint. It is not logged or stored. A pending upload older than five hours fails for review. The worker never silently retries a publish call after an unknown outcome; an operator must check Meta Studio for an **uncertain** row. There is no webhook secret because this implementation uses status polling, not webhooks.

## Verification checklist

- Run `npm test` and `npm run check`.
- Confirm a user cannot read the social tables through their browser Supabase client; server account responses must omit `enc_access`.
- With test Meta credentials, try wrong provider/replayed/expired state, personal Instagram account, Facebook account without Page creation rights, expired token, duplicate submit, and another user's clip/account IDs.
- Publish one valid Reel per provider. Verify the remote Reel exists, statuses become `published`, links open correctly, and Meta access tokens never appear in browser network responses or application logs.
- Simulate a process restart before and after the irreversible finish/publish call. The latter should show **uncertain** and must not publish again automatically.

## Current launch blockers

Meta app credentials, redirect registration, eligible tester accounts, permission review, and an actual Reel test are external setup tasks. Insights need a separate reviewed permission and implementation; the UI explicitly says they are unavailable. The site privacy/terms are still marked as templates and require final business/legal review before submitting Meta App Review.
