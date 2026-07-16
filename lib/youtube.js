// lib/youtube.js
// YouTube Data API v3 client: OAuth (offline access) + resumable video upload.
// The app owner must create a Google Cloud project, enable "YouTube Data API v3",
// build an OAuth consent screen, and set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// (+ register the redirect URI). Until then, configured() is false and the UI
// hides the feature instead of erroring.

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly'
];

function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// The redirect URI must EXACTLY match one registered in the Google console.
function redirectUri(req) {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
  return `${proto}://${req.get('host')}/api/youtube/callback`;
}

function authUrl(state, redirect) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',       // we want a refresh_token
    include_granted_scopes: 'true',
    prompt: 'consent',            // force refresh_token even on re-consent
    state
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

async function exchangeCode(code, redirect) {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirect,
    grant_type: 'authorization_code'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  });
  if (!r.ok) throw new Error('Token exchange failed: ' + (await r.text()).slice(0, 200));
  return r.json(); // { access_token, refresh_token, expires_in, scope, token_type }
}

async function refresh(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  });
  if (!r.ok) throw new Error('Token refresh failed: ' + (await r.text()).slice(0, 200));
  return r.json(); // { access_token, expires_in, scope, token_type }  (no new refresh_token)
}

async function getChannel(accessToken) {
  const r = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error('Channel fetch failed: ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  const ch = (data.items || [])[0];
  if (!ch) return null;
  const thumb = ch.snippet && ch.snippet.thumbnails && (ch.snippet.thumbnails.default || {});
  return { id: ch.id, title: ch.snippet ? ch.snippet.title : '', thumbnail: thumb ? thumb.url : '' };
}

// Ensure the caption is Shorts-friendly: a #Shorts tag helps YouTube classify
// vertical <=3min clips as Shorts. (Non-destructive — only appended if missing.)
function shortsTitle(title) {
  const t = (title || 'Clip').toString().slice(0, 90);
  return /#shorts/i.test(t) ? t : (t.slice(0, 82) + ' #Shorts');
}

// Resumable upload. `bytes` is a Buffer of the mp4. Returns { videoId }.
async function uploadVideo(accessToken, { bytes, title, description, tags, privacyStatus, publishAt }) {
  const snippet = {
    title: shortsTitle(title),
    description: (description || '').toString().slice(0, 4900) + '\n\n#Shorts',
    tags: Array.isArray(tags) ? tags.slice(0, 15).map(t => String(t).slice(0, 30)) : undefined,
    categoryId: '22'
  };
  const status = { privacyStatus: ['public', 'unlisted', 'private'].includes(privacyStatus) ? privacyStatus : 'private' };
  if (publishAt) { status.privacyStatus = 'private'; status.publishAt = publishAt; } // scheduled = private until publishAt
  const meta = { snippet, status };

  // 1) start a resumable session
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'x-upload-content-type': 'video/mp4',
      'x-upload-content-length': String(bytes.length)
    },
    body: JSON.stringify(meta)
  });
  if (!start.ok) throw new Error('Upload init failed: ' + (await start.text()).slice(0, 200));
  const uploadUrl = start.headers.get('location');
  if (!uploadUrl) throw new Error('No resumable upload URL returned');

  // 2) send the bytes in one PUT (clips are small; a single request is fine)
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) },
    body: bytes
  });
  if (!put.ok) throw new Error('Upload failed: ' + (await put.text()).slice(0, 200));
  const done = await put.json();
  return { videoId: done.id };
}

module.exports = { configured, redirectUri, authUrl, exchangeCode, refresh, getChannel, uploadVideo, shortsTitle, SCOPES };
