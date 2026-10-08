const express = require('express');
const { requireAdmin } = require('../lib/auth');
const { admin } = require('../lib/supabase');

const router = express.Router();
router.use(requireAdmin);

const n = v => Number(v || 0);
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const days=v=>Math.min(30,Math.max(1,parseInt(v,10)||30));
router.get('/operations',async(req,res)=>{try{const {data,error}=await admin.rpc('admin_operations',{p_days:days(req.query.days)});if(error)throw error;res.json(data);}catch(e){console.error('[admin/operations]',e.message);res.status(503).json({error:'Operations analytics unavailable'});}});

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const plan = String(req.query.plan || '').trim().toLowerCase();
    const limit = Math.min(250, Math.max(1, parseInt(req.query.limit,10)||100));
    const offset = Math.max(0,parseInt(req.query.offset,10)||0);
    let query = admin.from('admin_user_overview').select('*',{count:'exact'}).order('last_seen_at', { ascending: false, nullsFirst: false }).order('user_id').range(offset,offset+limit-1);
    if (plan) query = query.eq('plan', plan);
    if(q){const term=q.replace(/[^a-z0-9@._+ -]/g,'').slice(0,150);if(!term)return res.json({users:[],totals:{},count:0,offset,limit});query=uuid(term)?query.eq('user_id',term):query.ilike('email','%'+term.replace(/_/g,'\\_')+'%');}
    const [{ data, error,count },ops] = await Promise.all([query,admin.rpc('admin_operations',{p_days:days(req.query.days)})]);
    if (error) throw error;
    let users = data || [];
    if(ops.error)throw ops.error;const metrics=new Map((ops.data?.users||[]).map(x=>[x.user_id,x]));users=users.map(u=>({...u,...(metrics.get(u.user_id)||{})}));

    const totals = users.reduce((a,u) => {
      a.users += 1;
      a.clips += n(u.total_clips);
      a.jobs += n(u.total_jobs);
      a.failedJobs += n(u.failed_jobs);
      a.activeSeconds += n(u.active_seconds);
      a.minutesProcessed += n(u.period_minutes_used);
      return a;
    }, { users:0, clips:0, jobs:0, failedJobs:0, activeSeconds:0, minutesProcessed:0 });

    res.json({ users, totals,count,offset,limit,days:days(req.query.days) });
  } catch (e) {
    console.error('[admin/users] list failed:', e.message || e);
    res.status(500).json({ error: 'Could not load users' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const id = req.params.id;if(!uuid(id))return res.status(400).json({error:'Invalid user ID'});
    const [overview, jobs, clips, activity, yt, music, ownMusic] = await Promise.all([
      admin.from('admin_user_overview').select('*').eq('user_id', id).single(),
      admin.from('jobs').select('id,status,stage,clips_count,clips_total,source_minutes,error,source_url,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('clips').select('id,job_id,title,score,start_sec,end_sec,created_at,edit').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('user_activity_events').select('id,event_type,action,path,method,status_code,metadata,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(100),
      admin.from('youtube_uploads').select('id,clip_id,video_id,status,error,attempts,privacy,created_at,updated_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('music_uses').select('id,job_id,track_id,segment_start,segment_duration,provider,created_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50),
      admin.from('user_music_tracks').select('id,title,artist,duration_sec,rights_confirmed_at,created_at,updated_at').eq('user_id', id).order('created_at', { ascending:false }).limit(50)
    ]);
    if (overview.error) return res.status(404).json({ error: 'User not found' });
    const rows = [jobs, clips, activity, yt, music, ownMusic];
    const firstErr = rows.find(x => x.error);
    if (firstErr) throw firstErr.error;
    const operations=await admin.rpc('admin_operations',{p_days:days(req.query.days),p_user:id});if(operations.error)throw operations.error;
    res.json({
      operations:operations.data,
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
