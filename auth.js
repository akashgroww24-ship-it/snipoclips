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
function checkAdmin(email, password) {
  const okEmail = email && email.toLowerCase() === (process.env.ADMIN_EMAIL || '').toLowerCase();
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  const okPass = hash && bcrypt.compareSync(password || '', hash);
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
