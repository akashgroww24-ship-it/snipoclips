// lib/requireUser.js
// Verifies the end-user's Supabase access token (sent as Authorization: Bearer <token>).
// On success, attaches req.user = { id, email }. Never trusts a user id from the body.
const { admin, ready } = require('./supabase');

async function requireUser(req, res, next) {
  if (!ready()) return res.status(503).json({ error: 'Auth not configured yet' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  try {
    const { data, error } = await admin.auth.getUser(token); // validates the JWT with Supabase
    if (error || !data || !data.user) return res.status(401).json({ error: 'Invalid or expired session' });
    req.user = { id: data.user.id, email: data.user.email };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

module.exports = { requireUser };
