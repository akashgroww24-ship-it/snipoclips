// lib/secretbox.js
// Small authenticated-encryption helper (AES-256-GCM) for secrets we must store
// at rest — currently YouTube OAuth refresh/access tokens. Tokens are NEVER
// stored in plaintext and never sent to the browser.
//
// Key: derived from TOKEN_ENCRYPTION_KEY if set, otherwise from JWT_SECRET, so
// it works out of the box but can be hardened with a dedicated key. Rotating the
// key invalidates stored tokens (users just reconnect), which is the safe default.
const crypto = require('crypto');

const SALT = 'snipoclips.token.v1';
let _key = null;
function key() {
  if (_key) return _key;
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!secret) throw new Error('TOKEN_ENCRYPTION_KEY or JWT_SECRET must be set to store OAuth tokens');
  _key = crypto.scryptSync(secret, SALT, 32);
  return _key;
}

// -> "v1:<iv b64>:<tag b64>:<ciphertext b64>"
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(blob) {
  if (typeof blob !== 'string') throw new Error('bad ciphertext');
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('bad ciphertext format');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const enc = Buffer.from(parts[3], 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
