const { admin } = require('./supabase');

const HEARTBEAT_CAP_SECONDS = 45;

function cleanPath(input) {
  const s = String(input || '').split('?')[0].slice(0, 180);
  return s.startsWith('/') ? s : '/app';
}

async function heartbeat(userId, path) {
  if (!admin || !userId) return;
  const now = new Date();
  const { data: row } = await admin.from('user_presence')
    .select('user_id,last_heartbeat_at,session_count,active_seconds')
    .eq('user_id', userId).maybeSingle();

  let add = 0, sessions = row ? Number(row.session_count || 0) : 1;
  if (row && row.last_heartbeat_at) {
    const gap = Math.max(0, (now.getTime() - new Date(row.last_heartbeat_at).getTime()) / 1000);
    if (gap <= 90) add = Math.min(HEARTBEAT_CAP_SECONDS, Math.round(gap));
    else sessions += 1;
  }

  const payload = {
    user_id: userId,
    last_seen_at: now.toISOString(),
    last_heartbeat_at: now.toISOString(),
    last_path: cleanPath(path),
    updated_at: now.toISOString(),
    session_count: sessions,
    active_seconds: Number((row && row.active_seconds) || 0) + add
  };
  if (!row) payload.first_seen_at = now.toISOString();
  await admin.from('user_presence').upsert(payload, { onConflict: 'user_id' });
}

async function logAction(userId, req, statusCode) {
  if (!admin || !userId || !req) return;
  const method = String(req.method || 'GET').toUpperCase();
  if (!['POST','PUT','PATCH','DELETE'].includes(method)) return;
  const path = cleanPath(req.originalUrl || req.path || '');
  const action = `${method} ${path}`.slice(0, 220);
  await admin.from('user_activity_events').insert({
    user_id: userId,
    event_type: 'api_action',
    action,
    path,
    method,
    status_code: Number(statusCode || 0) || null,
    metadata: {}
  });
  await admin.from('user_presence').upsert({
    user_id: userId,
    last_seen_at: new Date().toISOString(),
    last_path: path,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
}

module.exports = { heartbeat, logAction, cleanPath };
