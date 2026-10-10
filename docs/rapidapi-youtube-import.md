# RapidAPI YouTube source import

Snipo supports Glavier's youtube138 **Video Streaming Data** endpoint:
https://rapidapi.com/Glavier/api/youtube138/playground/Video%20Streaming%20Data

Channel Details supplies channel metadata and cannot import a video. Snipo extracts the video ID from the submitted YouTube link.

## Setup

Set `RAPIDAPI_KEY` as a server-side Render environment variable on the Snipo service. The key must belong to a RapidAPI application subscribed to this specific API with access to Video Streaming Data. Save and redeploy. No application ID or channel ID is required. The host is fixed to `youtube138.p.rapidapi.com`; Google `YOUTUBE_API_KEY` is a different credential and does not enable this adapter.

When configured, YouTube imports use this provider. Without this key, the existing yt-dlp path remains active. File uploads and non-YouTube imports retain their existing paths. Provider failures do not silently fall back to additional provider requests.

## Pipeline

The server requests `/video/streaming-data/?id=VIDEO_ID`, selects a supported stream up to `MAX_SRC_HEIGHT` (default 2160), downloads video and audio if separate, and merges them into a local MP4 with FFmpeg. The existing transcription, clipping and storage pipeline then runs. Media hosts never receive the RapidAPI key. Downloads enforce a combined 1 GB ceiling, timeouts, expiration checks and a HTTPS googlevideo.com subdomain allowlist, including redirects. Intermediate downloads are removed after success or failure.

## Verification and limits

An administrator can inspect `/admin/api/import-provider` to check the selected provider and whether the key is configured; this never reveals the key and is not a live media test. Submit a public, completed YouTube video you own or have permission to edit through the normal app workflow. Confirm that import finishes, transcription runs, and the resulting clip has both video and audio. Check failures in Render logs by job ID.

Automated tests validate the documented response format and a real FFmpeg merge using synthetic streams. They do not verify a subscription or real provider download. Provider metadata success alone is insufficient: signed media URLs can expire or be restricted to the provider's network. A media 403 means this integration has not restored import for that video; use the original file or a provider that supplies a downloadable file accessible from Render.

401/403 from the API indicates key/subscription access problems; 429 indicates provider quota. Pricing and usage limits depend on the selected RapidAPI subscription and are not inferred from other providers. This adapter makes one metadata request per import attempt and does not automatically retry it. It does not enable YouTube publishing or access to protected/private videos.
