// Thirty-day retention for user media and analytics; accounts, billing,
// support reports, and the licensed music catalog are kept.
const { admin } = require('./supabase');

const RETENTION_DAYS = 30;
const CLIPS_BUCKET = process.env.SUPABASE_CLIPS_BUCKET || 'clips';
const MUSIC_BUCKET = process.env.REEL_MUSIC_BUCKET || 'music';
let running = false;

async function removeMedia(table, bucket, fields, cutoff) {
  let removed = 0;
  for (;;) {
    // Supabase defaults to 1,000 rows per result. Small batches let interrupted
    // runs resume and prevent deleting a row when its file could not be removed.
    const { data: rows, error } = await admin.from(table).select(['id',...fields,...(table==='clips'?['edit']:[])].join(','))
      .lt('created_at',cutoff).order('created_at',{ascending:true}).limit(100);
    if (error) throw error;
    if (!rows || !rows.length) break;
    const paths = [...new Set(rows.flatMap(row=>[...fields.map(key=>row[key]),...(table==='clips'?[...(row.edit?.studioAssets||[]).map(a=>a.path),...(row.edit?.studioExports||[])]:[])]).filter(Boolean))];
    for(let i=0;i<paths.length;i+=100){
      const { error: storageError } = await admin.storage.from(bucket).remove(paths.slice(i,i+100));
      if(storageError)throw storageError;
    }
    const { error: deleteError } = await admin.from(table).delete().in('id',rows.map(row=>row.id));
    if(deleteError)throw deleteError;
    removed += rows.length;
  }
  return removed;
}

async function deleteExpired(table,column,cutoff) {
  const { count, error: countError } = await admin.from(table).select('*',{count:'exact',head:true}).lt(column,cutoff);
  if(countError)throw countError;
  if(!count)return 0;
  const { error }=await admin.from(table).delete().lt(column,cutoff);
  if(error)throw error;
  return count;
}

async function runCleanup() {
  if(!admin)return {removed:0,error:'Supabase unavailable'};
  if(running)return {skipped:true};
  running=true;
  const cutoff=new Date(Date.now()-RETENTION_DAYS*86400000).toISOString();
  const cutoffDay=new Date(Date.now()-(RETENTION_DAYS-1)*86400000).toISOString().slice(0,10);
  const report={removed:0,tracksRemoved:0,analyticsRemoved:0,status:'ok'};
  try{
    report.removed=await removeMedia('clips',CLIPS_BUCKET,['storage_path','master_path'],cutoff);
    report.tracksRemoved=await removeMedia('user_music_tracks',MUSIC_BUCKET,['storage_path'],cutoff);
    report.analyticsRemoved+=await deleteExpired('site_visits','day',cutoffDay);
    report.analyticsRemoved+=await deleteExpired('user_activity_daily','day',cutoffDay);
    report.analyticsRemoved+=await deleteExpired('user_activity_events','created_at',cutoff);
    report.analyticsRemoved+=await deleteExpired('music_uses','created_at',cutoff);
    report.analyticsRemoved+=await deleteExpired('user_presence','last_seen_at',cutoff);
    // OAuth nonces are single-use; remove abandoned attempts after their expiry.
    report.analyticsRemoved+=await deleteExpired('social_oauth_states','expires_at',new Date().toISOString());
    const rollups=await admin.rpc('refresh_presence_30_day_rollups',{p_cutoff:cutoffDay});
    if(rollups.error)throw rollups.error;
    // Jobs with a clip newer than the cutoff must remain: deleting the job
    // cascades to the clip without deleting its storage object.
    const jobs=await admin.rpc('delete_old_empty_jobs',{p_cutoff:cutoff});
    if(jobs.error)throw jobs.error;
    report.jobsRemoved=jobs.data||0;
    await deleteExpired('retention_runs','finished_at',cutoff);
    console.log(`[cleanup] removed ${report.removed} clips, ${report.tracksRemoved} private tracks, ${report.analyticsRemoved} analytics rows`);
  }catch(e){
    report.status='error';report.error=String(e.message||e).slice(0,250);
    console.error('[cleanup] failed:',report.error);
  }finally{
    const audit=await admin.from('retention_runs').insert({
      clips_removed:report.removed,tracks_removed:report.tracksRemoved,
      analytics_removed:report.analyticsRemoved,status:report.status,error:report.error||null
    });
    if(audit.error)console.error('[cleanup] audit failed:',audit.error.message);
    running=false;
  }
  return report;
}

function startCleanupScheduler(){
  setTimeout(runCleanup,60*1000);
  setInterval(runCleanup,24*60*60*1000);
  console.log('[cleanup] scheduler on - media and analytics auto-delete after 30 days');
}

module.exports={runCleanup,startCleanupScheduler,removeMedia};
