// Durable, database-claimed social publication work. Only an explicit user request inserts a job.
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {admin}=require('./supabase');
const box=require('./secretbox');
const meta=require('./meta');
const probe=promisify(execFile);
const BUCKET=process.env.SUPABASE_CLIPS_BUCKET||'clips';
let busy=false,timer;

function validateVideo(info,provider){
  const video=info.streams?.find(s=>s.codec_type==='video');
  const audio=info.streams?.find(s=>s.codec_type==='audio');
  const duration=Number(info.format?.duration||video?.duration);
  const width=Number(video?.width),height=Number(video?.height);
  const ratio=width/height;
  const fps=video?.avg_frame_rate?.split('/').map(Number);
  const frameRate=fps?.length===2&&fps[1]?fps[0]/fps[1]:0;
  if(!video||!Number.isFinite(duration)||!Number.isFinite(ratio)||Math.abs(ratio-9/16)>.025 || !['h264','hevc'].includes(video.codec_name))throw new Error('VIDEO_FORMAT_UNSUPPORTED');
  if(audio&&audio.codec_name!=='aac')throw new Error('VIDEO_AUDIO_UNSUPPORTED');
  if(provider==='facebook'&&(duration<4||duration>60||width<540||height<960||frameRate<23))throw new Error('FACEBOOK_REEL_REQUIREMENTS');
  if(provider==='instagram'&&(duration<3||duration>900))throw new Error('INSTAGRAM_REEL_REQUIREMENTS');
  if(Number(info.format?.size)>1073741824)throw new Error('VIDEO_TOO_LARGE');
}
async function signedClip(clip,provider){
  const {data,error}=await admin.storage.from(BUCKET).createSignedUrl(clip.storage_path,6*3600);
  if(error||!data?.signedUrl)throw new Error('CLIP_UNAVAILABLE');
  const signedUrl=data.signedUrl;
  // Supabase SDK returns an absolute HTTPS URL. Never log or store this bearer URL.
  if(!signedUrl.startsWith('https://'))throw new Error('CLIP_URL_INVALID');
  const {stdout}=await probe('ffprobe',['-v','error','-show_format','-show_streams','-of','json',signedUrl],{timeout:45000,maxBuffer:1024*1024});
  validateVideo(JSON.parse(stdout),provider);
  return signedUrl;
}
async function save(id,attrs){
  const {error}=await admin.from('social_publications').update({...attrs,updated_at:new Date().toISOString(),lease_until:attrs.lease_until||null}).eq('id',id);
  if(error)throw error;
}
const later=(seconds)=>new Date(Date.now()+seconds*1000).toISOString();
async function accountFor(job){
  const {data,error}=await admin.from('social_accounts').select('*').eq('id',job.account_id).eq('user_id',job.user_id).single();
  if(error||!data||data.status!=='connected')throw new Error('ACCOUNT_RECONNECT_REQUIRED');
  let token=box.decrypt(data.enc_access);
  if(data.provider==='instagram'&&data.token_expires_at&&new Date(data.token_expires_at).getTime()<Date.now()+7*86400000){
    if(new Date(data.token_expires_at).getTime()<Date.now())throw new Error('ACCOUNT_RECONNECT_REQUIRED');
    const fresh=await meta.refreshInstagram(token);
    token=fresh.access_token;
    const update={enc_access:box.encrypt(token),token_expires_at:new Date(Date.now()+fresh.expires_in*1000).toISOString()};
    const result=await admin.from('social_accounts').update(update).eq('id',data.id).eq('user_id',job.user_id);
    if(result.error)throw result.error;
  }
  return {account:data,token};
}
function readyForPublish(provider,status){
  if(provider==='instagram')return status.status_code==='FINISHED';
  return status.status?.uploading_phase?.status==='complete';
}
async function processJob(job){
  const {account,token}=await accountFor(job);
  if(job.status==='preparing'){
    const {data:clip}=await admin.from('clips').select('id,user_id,storage_path').eq('id',job.clip_id).eq('user_id',job.user_id).single();
    if(!clip?.storage_path)throw new Error('CLIP_UNAVAILABLE');
    const url=await signedClip(clip,account.provider);
    if(account.provider==='instagram'){
      const container=await meta.instagramContainer(account.external_id,token,url,job.caption);
      if(!container.id)throw new Error('META_CONTAINER_MISSING');
      await save(job.id,{remote_container_id:String(container.id),status:'processing',next_attempt_at:later(20)});
    }else{
      const start=await meta.facebookStart(account.external_id,token);
      if(!start.video_id)throw new Error('META_VIDEO_ID_MISSING');
      await save(job.id,{remote_container_id:String(start.video_id),status:'uploading',lease_until:later(120)});
      // A failed/ambiguous host upload is reconciled via the remote status; never start another Reel.
      await meta.facebookUpload(start.video_id,token,url);
      await save(job.id,{status:'processing',next_attempt_at:later(20)});
    }
    return;
  }
  if(job.status==='processing'){
    if(!job.remote_container_id)throw new Error('META_CONTAINER_MISSING');
    const state=account.provider==='instagram'
      ?await meta.instagramStatus(job.remote_container_id,token)
      :await meta.facebookStatus(job.remote_container_id,token);
    if(account.provider==='instagram'&&state.status_code==='ERROR')throw new Error('META_PROCESSING_FAILED');
    if(account.provider==='facebook'&&state.status?.video_status==='error')throw new Error('META_PROCESSING_FAILED');
    if(account.provider==='facebook'&&job.remote_post_id){
      if(state.status?.publishing_phase?.status==='complete'||state.status?.video_status==='ready'){
        await save(job.id,{status:'published',permalink:'https://www.facebook.com/reel/'+encodeURIComponent(job.remote_post_id),error_code:null});
      }else if(Date.now()-new Date(job.created_at).getTime()>5*3600000)throw new Error('META_PROCESSING_TIMEOUT');
      else await save(job.id,{status:'processing',next_attempt_at:later(30)});
      return;
    }
    if(!readyForPublish(account.provider,state)){
      if(Date.now()-new Date(job.created_at).getTime()>5*3600000)throw new Error('META_PROCESSING_TIMEOUT');
      await save(job.id,{status:'processing',next_attempt_at:later(30)});return;
    }
    // Persist the boundary before the irreversible publish request. A crash is
    // surfaced as uncertain instead of retrying and potentially posting twice.
    await save(job.id,{status:'publishing'});
    let result;
    try{
      result=account.provider==='instagram'
        ?await meta.instagramPublish(account.external_id,job.remote_container_id,token)
        :await meta.facebookPublish(account.external_id,job.remote_container_id,token,job.caption);
    }catch{await save(job.id,{status:'uncertain',error_code:'PUBLISH_RESULT_UNKNOWN'});return;}
    try{
      const remoteId=String(result.id||job.remote_container_id);
      if(account.provider==='facebook'){
        await save(job.id,{status:'processing',remote_post_id:remoteId,next_attempt_at:later(30)});
        return;
      }
      let permalink=null;
      try{permalink=(await meta.instagramPermalink(remoteId,token)).permalink||null;}catch{}
      await save(job.id,{status:'published',remote_post_id:remoteId,permalink,error_code:null});
    }catch{
      // The remote call succeeded but the local write may have failed. Do not retry.
      try{await save(job.id,{status:'uncertain',error_code:'PUBLISH_RESULT_UNKNOWN'});}catch{}
    }
  }
}
async function recoverStale(){
  const now=new Date().toISOString();
  // Leased work abandoned by a crashed process is reconciled conservatively.
  await admin.from('social_publications').update({status:'queued',lease_until:null}).eq('status','preparing').lt('lease_until',now).is('remote_container_id',null);
  await admin.from('social_publications').update({status:'processing',lease_until:null}).eq('status','uploading').lt('lease_until',now).not('remote_container_id','is',null);
  await admin.from('social_publications').update({status:'uncertain',error_code:'PUBLISH_RESULT_UNKNOWN',lease_until:null}).eq('status','publishing').lt('updated_at',new Date(Date.now()-120000).toISOString());
}
async function tick(){
  if(!admin||busy||!meta.configured('instagram')&&!meta.configured('facebook'))return;
  busy=true;
  try{
    await recoverStale();
    const {data,error}=await admin.rpc('claim_social_publication');
    if(error)throw error;
    const job=data?.[0];if(!job)return;
    try{await processJob(job);}catch(e){
      const code=/^[A-Z_]+$/.test(e.message||'')?e.message:'META_OPERATION_FAILED';
      const auth=code==='ACCOUNT_RECONNECT_REQUIRED'||e.metaCode===190;
      if(auth)await admin.from('social_accounts').update({status:'reconnect_required'}).eq('id',job.account_id).eq('user_id',job.user_id);
      const transient=!auth&&(e.status===429||e.status>=500||code==='META_OPERATION_FAILED');
      if(transient&&job.attempts<3){
        await save(job.id,{status:job.status==='preparing'?'queued':'processing',attempts:job.attempts+1,
          next_attempt_at:later(30*Math.pow(2,job.attempts)),error_code:'TEMPORARY_META_ERROR'});
      }else await save(job.id,{status:'failed',error_code:auth?'ACCOUNT_RECONNECT_REQUIRED':code});
    }
  }catch(e){console.error('[social worker]',e.message||'failed');}finally{busy=false;}
}
function start(){if(timer||!admin)return;timer=setInterval(tick,15000);timer.unref();setTimeout(tick,1000);}
module.exports={start,tick,validateVideo,readyForPublish,processJob};
