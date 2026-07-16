// lib/cleanup.js
// Retention cleanup: delete clips (DB rows + storage files) and old job rows
// older than CLIP_RETENTION_DAYS (default 30). Keeps Supabase storage cost bounded.
// Runs shortly after boot, then every 24h (see startCleanupScheduler).
const { admin } = require('./supabase');

const RETENTION_DAYS = parseInt(process.env.CLIP_RETENTION_DAYS || '30', 10);
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';

async function runCleanup() {
  if (!admin) { console.warn('[cleanup] Supabase not configured — skipping'); return { removed: 0 }; }
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    // 1) find expired clips
    const { data: clips, error } = await admin
      .from('clips')
      .select('id, storage_path, master_path')
      .lt('created_at', cutoff);
    if (error) throw error;

    if (clips && clips.length) {
      // 2) delete their storage files — BOTH the rendered clip and its editable
      //    master (otherwise master_*.mp4 files leak and storage grows forever).
      const paths = clips.flatMap(c => [c.storage_path, c.master_path]).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await admin.storage.from(CLIPS_BUCKET).remove(paths.slice(i, i + 100));
        if (rmErr) console.warn('[cleanup] storage remove warning:', rmErr.message);
      }
      // 3) delete the rows (batches of 200)
      const ids = clips.map(c => c.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { error: delErr } = await admin.from('clips').delete().in('id', ids.slice(i, i + 200));
        if (delErr) console.warn('[cleanup] row delete warning:', delErr.message);
      }
    }

    // 4) prune old job rows (metadata only)
    await admin.from('jobs').delete().lt('created_at', cutoff);

    const removed = clips ? clips.length : 0;
    console.log(`[cleanup] done — removed ${removed} clip(s) older than ${RETENTION_DAYS} days`);
    return { removed };
  } catch (e) {
    console.error('[cleanup] failed:', e.message || e);
    return { removed: 0, error: String(e.message || e) };
  }
}

function startCleanupScheduler() {
  setTimeout(runCleanup, 60 * 1000);                 // first pass ~1 min after boot
  setInterval(runCleanup, 24 * 60 * 60 * 1000);      // then daily
  console.log(`[cleanup] scheduler on - clips auto-delete after ${RETENTION_DAYS} days`);
}

module.exports = { runCleanup, startCleanupScheduler };
