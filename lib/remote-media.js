// Safe, no-proxy importer for direct video files.
//
// This intentionally does not extract media from YouTube/social page URLs.
// It accepts a URL that already points to a video response, validates every
// redirect and DNS result against SSRF targets, pins the vetted address for the
// request, and streams the response to disk with a hard byte limit.
const dns = require('dns').promises;
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');

const configuredMaxBytes = Number.parseInt(process.env.MAX_UPLOAD_BYTES || '', 10);
const MAX_REMOTE_BYTES = Number.isSafeInteger(configuredMaxBytes) && configuredMaxBytes > 0
  ? configuredMaxBytes
  : 1024 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const CONNECT_TIMEOUT_MS = parseInt(process.env.REMOTE_CONNECT_TIMEOUT_MS || '30000', 10);
const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.REMOTE_DOWNLOAD_TIMEOUT_MS || String(20 * 60 * 1000), 10);

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const MIME_EXT = new Map([
  ['video/mp4', '.mp4'],
  ['application/mp4', '.mp4'],
  ['video/quicktime', '.mov'],
  ['video/webm', '.webm'],
  ['video/x-matroska', '.mkv'],
  ['video/x-m4v', '.m4v']
]);

const PLATFORM_HOSTS = [
  ['youtube.com', 'YouTube'],
  ['youtu.be', 'YouTube'],
  ['youtube-nocookie.com', 'YouTube'],
  ['googlevideo.com', 'YouTube'],
  ['tiktok.com', 'TikTok'],
  ['instagram.com', 'Instagram'],
  ['facebook.com', 'Facebook'],
  ['fb.watch', 'Facebook'],
  ['vimeo.com', 'Vimeo'],
  ['twitch.tv', 'Twitch'],
  ['twitter.com', 'X'],
  ['x.com', 'X'],
  ['linkedin.com', 'LinkedIn']
];

function hostMatches(host, suffix) {
  return host === suffix || host.endsWith('.' + suffix);
}

function bareHostname(hostname) {
  return String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
}

function parseRemoteUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); }
  catch { throw coded('invalid_url', 'Paste a valid direct video URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw coded('invalid_url', 'Only HTTP or HTTPS video links are supported.');
  }
  if (url.username || url.password) {
    throw coded('invalid_url', 'Links containing embedded usernames or passwords are not supported.');
  }
  const hostname = bareHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw coded('unsafe_url', 'That video host is not allowed.');
  }
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== '80' && port !== '443') {
    throw coded('unsafe_url', 'Direct video links must use the standard HTTP or HTTPS port.');
  }
  return url;
}

function platformProvider(input) {
  let url;
  try { url = parseRemoteUrl(input); } catch { return null; }
  const host = bareHostname(url.hostname).replace(/^www\.|^m\.|^music\./, '');
  const hit = PLATFORM_HOSTS.find(([suffix]) => hostMatches(host, suffix));
  return hit ? hit[1] : null;
}

function sourceLabel(input) {
  const url = parseRemoteUrl(input);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function coded(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function ipv4Number(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inV4Range(n, base, bits) {
  const b = ipv4Number(base);
  if (n == null || b == null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (n & mask) === (b & mask);
}

function isPrivateOrReservedIp(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const n = ipv4Number(address);
    return [
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
      ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
      ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
      ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
      ['224.0.0.0', 4], ['240.0.0.0', 4]
    ].some(([base, bits]) => inV4Range(n, base, bits));
  }
  if (family === 6) {
    const v = address.toLowerCase().split('%')[0];
    // ::/96 contains unspecified, loopback, IPv4-compatible and IPv4-mapped
    // forms (including hex spellings such as ::ffff:7f00:1). Blocking the
    // whole special prefix avoids alternate-notation SSRF bypasses.
    if (v.startsWith('::')) return true;
    // Block transition/tunnel ranges that can encode an otherwise-blocked
    // IPv4 destination (NAT64, Teredo and 6to4).
    if (v.startsWith('64:ff9b:') || v.startsWith('2001:0000:') || v.startsWith('2001:0:') || v.startsWith('2002:')) return true;
    if (/^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff')) return true;
    if (v.startsWith('2001:db8:')) return true;
    return false;
  }
  return true;
}

async function resolvePublicAddress(hostname) {
  hostname = bareHostname(hostname);
  if (hostname === 'metadata.google.internal') throw coded('unsafe_url', 'That video host is not allowed.');
  const literalFamily = net.isIP(hostname);
  const rows = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!rows.length || rows.some(r => isPrivateOrReservedIp(r.address))) {
    throw coded('unsafe_url', 'That video host resolves to a private or reserved network.');
  }
  return rows[0];
}

function requestOnce(url, resolved) {
  const client = url.protocol === 'https:' ? https : http;
  const hostname = bareHostname(url.hostname);
  return new Promise((resolve, reject) => {
    const req = client.request({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      method: 'GET',
      path: url.pathname + url.search,
      headers: {
        Accept: 'video/*,application/octet-stream;q=0.8',
        'User-Agent': 'SnipoClips/1.0 direct-media-import'
      },
      lookup(_hostname, _options, callback) {
        callback(null, resolved.address, resolved.family);
      },
      ...(url.protocol === 'https:' && !net.isIP(hostname) ? { servername: hostname } : {})
    }, resolve);
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(coded('timeout', 'The video host took too long to respond.')));
    req.on('error', reject);
    req.end();
  });
}

async function openDirectVideo(input) {
  let url = parseRemoteUrl(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const provider = platformProvider(url.toString());
    if (provider) {
      throw coded('platform_url', `${provider} page links cannot be imported without a licensed provider. Upload a video you own instead.`);
    }
    const resolved = await resolvePublicAddress(url.hostname);
    const res = await requestOnce(url, resolved);
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume();
      if (redirects === MAX_REDIRECTS) throw coded('too_many_redirects', 'The video link redirected too many times.');
      url = parseRemoteUrl(new URL(res.headers.location, url).toString());
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.resume();
      throw coded('remote_status', `The video host returned HTTP ${res.statusCode}.`);
    }
    return { res, finalUrl: url };
  }
  throw coded('too_many_redirects', 'The video link redirected too many times.');
}

function extensionFor(url, contentType) {
  let pathname = url.pathname;
  try { pathname = decodeURIComponent(pathname); } catch {}
  const fromPath = path.extname(pathname).toLowerCase();
  if (VIDEO_EXTS.has(fromPath)) return fromPath;
  return MIME_EXT.get(contentType) || '.mp4';
}

async function downloadDirectVideo(input, workDir, options = {}) {
  const requestedMax = Number(options.maxBytes || MAX_REMOTE_BYTES);
  const maxBytes = Number.isSafeInteger(requestedMax) && requestedMax > 0 ? requestedMax : MAX_REMOTE_BYTES;
  const { res, finalUrl } = await openDirectVideo(input);
  const contentType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const acceptableType = contentType.startsWith('video/') || contentType === 'application/octet-stream' || contentType === 'application/mp4';
  if (!acceptableType) {
    res.resume();
    throw coded('not_video', 'That link returned a web page instead of a direct video file.');
  }
  const declared = Number(res.headers['content-length'] || 0);
  if (declared > maxBytes) {
    res.resume();
    throw coded('file_too_large', `The remote video is larger than ${Math.floor(maxBytes / 1048576)} MB.`);
  }

  const destination = path.join(workDir, 'source' + extensionFor(finalUrl, contentType));
  let handle;
  try { handle = await fs.promises.open(destination, 'wx'); }
  catch (err) { res.destroy(); throw err; }
  let received = 0;
  let timer;
  try {
    timer = setTimeout(() => res.destroy(coded('timeout', 'The video download took too long.')), DOWNLOAD_TIMEOUT_MS);
    for await (const chunk of res) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buf.length;
      if (received > maxBytes) throw coded('file_too_large', `The remote video is larger than ${Math.floor(maxBytes / 1048576)} MB.`);
      await handle.write(buf);
    }
  } catch (err) {
    try { await handle.close(); } catch {}
    try { await fs.promises.rm(destination, { force: true }); } catch {}
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  await handle.close();
  if (!received) {
    try { await fs.promises.rm(destination, { force: true }); } catch {}
    throw coded('empty_file', 'The direct video link returned an empty file.');
  }
  return destination;
}

module.exports = {
  MAX_REMOTE_BYTES,
  VIDEO_EXTS,
  parseRemoteUrl,
  platformProvider,
  sourceLabel,
  isPrivateOrReservedIp,
  resolvePublicAddress,
  downloadDirectVideo
};
