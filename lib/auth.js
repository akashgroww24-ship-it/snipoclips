// lib/auth.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SECRET = process.env.JWT_SECRET || 'dev-only-insecure-secret';
// Never run with the insecure default in production — forgeable admin tokens.
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  console.error('[auth] FATAL: set a strong JWT_SECRET (>=16 chars) in production. Refusing to start.');
  process.exit(1);
}

// Verify the admin login against env-stored email + bcrypt hash.
// Defensive: trims stray whitespace/newlines (a very common paste problem in
// hosting dashboards) and never throws on a malformed hash — a bad hash logs a
// clear reason and returns false instead of crashing the request with a 500.
function checkAdmin(email, password) {
  const gotEmail = String(email || '').toLowerCase().trim();
  const wantEmail = String(process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const okEmail = !!gotEmail && gotEmail === wantEmail;
  const hash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();

  let okPass = false;
  if (hash) {
    try {
      okPass = bcrypt.compareSync(password || '', hash);
    } catch (e) {
      console.error('[auth] ADMIN_PASSWORD_HASH is malformed (bcrypt could not read it): ' + e.message +
        ' — re-paste the full $2a$12$... hash in your host env, no spaces/line breaks.');
    }
  } else {
    console.error('[auth] ADMIN_PASSWORD_HASH is not set.');
  }

  // Diagnostics (admin's own server log; never logs the password):
  if (!okEmail) console.warn(`[auth] admin login failed: email mismatch (got "${gotEmail}", expected "${wantEmail}").`);
  else if (!okPass) console.warn('[auth] admin login failed: password/hash mismatch.');
  return okEmail && okPass;
}

function issueToken(email) {
  return jwt.sign({ sub: email, role: 'admin' }, SECRET, { expiresIn: '8h' });
}

// Middleware: only allow requests carrying a valid admin cookie.
function requireAdmin(req, res, next) {
  const token = req.cookies && req.cookies.sc_admin;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    req.admin = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

// Cookie options: httpOnly (JS can't read it), Secure (HTTPS only), SameSite=Strict.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/'
};

module.exports = { checkAdmin, issueToken, requireAdmin, COOKIE_OPTS };
