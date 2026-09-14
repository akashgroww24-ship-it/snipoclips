const express = require('express');
const { requireAdmin } = require('../lib/auth');
const { admin } = require('../lib/supabase');

const router = express.Router();
router.use(requireAdmin);

const n = v => Number(v || 0);

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const plan = String(req.query.plan || '').trim().toLowerCase();
    const limit = Math.min(250, Math.max(1, Number(req.query.limit || 100)));
    let query = admin.from('admin_user_overview').select('*').order('last_seen_at', { ascending: false, nullsFirst: false }).limit(limit);
    if (plan) query = query.eq('plan', plan);
    const { data, error } = await query;
    if (error) throw error;
    let users = data || [];
    if (q) users = users.filter(u => String(u.email || '').toLowerCase().includes(q) || String(u.user_id || '').toLowerCase().includes(q));

    const totals = users.reduce((a,u) => {
      a.users += 1;
      a.clips += n(u.total_clips);
      a.jobs += n(u.total_jobs);
      a.failedJobs += n(u.failed_jobs);
      a.activeSeconds += n(u.active_seconds);
      a.minutesProcessed += n(u.period_minutes_used);
      return a;
    }, { users:0, clips:0, jobs:0, failedJobs:0, activeSeconds:0, minutesProcessed:0 });

    res.json({ users, totals });
  } catch (e) {
    console.error('[admin/users] list failed:', e.message || e);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const [overview, jobs, clips, activity, yt, music, ownMusic] = await Promise.all([
      admin.from('admin_user_overview').select('*').eq('user_id', id).single(),
      admin.from('jobs').select('id,status,stage,clips_count,error,source_url,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('clips').select('id,job_id,title,score,start_sec,end_sec,created_at,edit').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('user_activity_events').select('id,event_type,action,path,method,status_code,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(100),
      admin.from('youtube_uploads').select('id,clip_id,video_id,status,error,attempts,privacy,created_at,updated_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('music_uses').select('id,job_id,track_id,segment_start,segment_duration,provider,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('user_music_tracks').select('id,title,artist,duration_sec,rights_confirmed_at,created_at,updated_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50)
    ]);
    if (overview.error) return res.status(404).json({ error: 'User not found' });
    const rows = [jobs, clips, activity, yt, music, ownMusic];
    const firstErr = rows.find(x => x.error);
    if (firstErr) throw firstErr.error;
    res.json({
      user: overview.data,
      jobs: jobs.data || [],
      clips: clips.data || [],
      activity: activity.data || [],
      youtubeUploads: yt.data || [],
      musicUses: music.data || [],
      privateMusic: ownMusic.data || []
    });
  } catch (e) {
    console.error('[admin/users] detail failed:', e.message || e);
    res.status(500).json({ error: 'Could not load user details' });
  }
});

module.exports = router;
