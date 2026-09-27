// First-party page analytics. The database stores a hash of a random browser
// cookie, never an IP address or the cookie itself. Admin and API pages are excluded.
const crypto = require('crypto');
const { admin } = require('./supabase');

const COOKIE = 'sc_visit';
const ID = /^[a-f0-9]{32}$/;
const PATHS = new Set(['/','/app','/login','/pricing','/features','/how-it-works','/faq']);
const salt = process.env.ANALYTICS_HASH_SECRET || process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

function trackedPath(path) {
  const clean = String(path || '').replace(/\/$/,'') || '/';
  if (PATHS.has(clean)) return clean;
  if (/^\/blog(?:\/[a-z0-9-]+)?$/.test(clean)) return clean;
  return null;
}

function visitMiddleware(req, res, next) {
  const page = req.method === 'GET' ? trackedPath(req.path) : null;
  if (!page || !req.accepts('html') || /bot|crawler|spider|preview|headless/i.test(req.get('user-agent') || '')) return next();
  let id = req.cookies && req.cookies[COOKIE];
  if (!ID.test(id || '')) {
    id = crypto.randomBytes(16).toString('hex');
    res.cookie(COOKIE, id, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', maxAge:30*86400000, path:'/' });
  }
  const visitorHash = crypto.createHmac('sha256',salt).update(id).digest('hex');
  res.on('finish', () => {
    if (res.statusCode >= 400 || !admin) return;
    admin.rpc('record_site_visit',{p_hash:visitorHash,p_path:page})
      .then(({error})=>{if(error)console.error('[visits]',error.message);})
      .catch(e=>console.error('[visits]',e.message));
  });
  next();
}

module.exports = { visitMiddleware, trackedPath };
