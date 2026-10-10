'use strict';
// Shared with editor routes to prevent a write starting during folder deletion.
const deletingClips = new Set();
let running = false;
async function drainMediaCleanup(admin) {
  if (!admin || running) return;
  running = true;
  try {
    const { data, error } = await admin.from('folder_media_cleanup').select('id,user_id,paths').order('created_at').limit(20);
    if (error) throw error;
    for (const row of data || []) {
      try {
        const paths = (row.paths || []).filter(p => typeof p === 'string' && p.startsWith(row.user_id + '/'));
        for (let i = 0; i < paths.length; i += 100) {
          const result = await admin.storage.from(process.env.SUPABASE_CLIPS_BUCKET || 'clips').remove(paths.slice(i, i + 100));
          if (result.error) throw result.error;
        }
        const result = await admin.from('folder_media_cleanup').delete().eq('id', row.id);
        if (result.error) throw result.error;
      } catch (e) { console.error('[folder cleanup] Will retry:', e.message); }
    }
  } catch (e) { console.error('[folder cleanup]', e.message); }
  finally { running = false; }
}
function startMediaCleanup(admin) {
  setTimeout(() => drainMediaCleanup(admin), 10000).unref();
  setInterval(() => drainMediaCleanup(admin), 60000).unref();
}
module.exports = { deletingClips, drainMediaCleanup, startMediaCleanup };
