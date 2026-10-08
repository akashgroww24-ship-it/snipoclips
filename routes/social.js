const express=require('express');
const crypto=require('node:crypto');
const {requireUser}=require('../lib/requireUser');
const {admin}=require('../lib/supabase');
const box=require('../lib/secretbox');
const meta=require('../lib/meta');
const router=express.Router();
const providers=['instagram','facebook'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const publicAccount='id,provider,external_id,display_name,token_expires_at,status,created_at';
const yt=require('../lib/youtube');
const publicPost='id,account_id,clip_id,status,permalink,error_code,created_at,updated_at';

// Feature availability only: no account data, credentials, or token values.
router.get('/social/capabilities',(req,res)=>{
  const present=key=>!!process.env[key]?.trim();
  const setup=provider=>{
    const prefix=provider==='instagram'?'META_INSTAGRAM':'META_FACEBOOK';
    return {configured:meta.configured(provider),credentials:present(prefix+'_APP_ID')&&present(prefix+'_APP_SECRET'),redirect:/^https:\/\//.test(process.env[prefix+'_REDIRECT_URI']||''),apiVersion:/^v\d+\.\d+$/.test(process.env.META_GRAPH_VERSION||'')};
  };
  res.set('Cache-Control','no-store').json({youtube:{configured:yt.configured()},instagram:setup('instagram'),facebook:setup('facebook')});
});

router.get('/social/accounts',requireUser,async(req,res)=>{
  const {data,error}=await admin.from('social_accounts').select(publicAccount).eq('user_id',req.user.id).order('created_at',{ascending:false});
  if(error)return res.status(503).json({error:'Connections unavailable'});
  const accounts=(data||[]).map(account=>({ ...account,
    status:account.token_expires_at&&new Date(account.token_expires_at).getTime()<Date.now()?'reconnect_required':account.status
  }));
  res.json({configured:{instagram:meta.configured('instagram'),facebook:meta.configured('facebook')},accounts,insights:{enabled:false,reason:'Meta insights permission review is pending'}});
});

router.post('/social/:provider/connect',requireUser,async(req,res)=>{
  const provider=req.params.provider;
  if(!providers.includes(provider))return res.status(404).json({error:'Unknown provider'});
  if(!meta.configured(provider))return res.status(503).json({error:'Connector configuration is pending'});
  if(req.body?.consent!==true)return res.status(400).json({error:'Review and agree to connect this account'});
  const state=crypto.randomBytes(32).toString('base64url');
  const {error}=await admin.from('social_oauth_states').insert({state_hash:hash(state),user_id:req.user.id,provider,expires_at:new Date(Date.now()+10*60000).toISOString()});
  if(error)return res.status(503).json({error:'Could not start connection'});
  res.json({url:meta.authUrl(provider,state)});
});

router.get('/social/:provider/callback',async(req,res)=>{
  const provider=req.params.provider;
  const done=(status,reason)=>res.redirect(303,'/app?social='+encodeURIComponent(status)+(reason?'&socialReason='+encodeURIComponent(reason):''));
  if(!providers.includes(provider))return done('error');
  if(!admin||!meta.configured(provider))return done('error','setup');
  const state=req.query.state;
  if(typeof state!=='string'||state.length<30||state.length>100)return done('error','expired');
  // Delete and return in a single database operation: state cannot be replayed.
  const {data:record,error:consumeError}=await admin.from('social_oauth_states').delete().eq('state_hash',hash(state)).eq('provider',provider).select('user_id,expires_at').maybeSingle();
  if(consumeError||!record||new Date(record.expires_at).getTime()<Date.now())return done('error','expired');
  if(req.query.error)return done('denied','denied');
  const code=req.query.code;
  if(typeof code!=='string'||!code||code.length>4000)return done('error');
  try{
    const tokens=await meta.exchange(provider,code);
    if(!tokens.access_token)throw new Error('No access token');
    const accounts=await meta.identities(provider,tokens.access_token);
    for(const account of accounts){
      const expiry=provider==='instagram'&&tokens.expires_in?new Date(Date.now()+tokens.expires_in*1000).toISOString():null;
      const {error}=await admin.from('social_accounts').upsert({user_id:record.user_id,provider,external_id:account.id,
        display_name:account.name,enc_access:box.encrypt(account.token),token_expires_at:expiry,scopes:tokens.scopes,status:'connected',updated_at:new Date().toISOString()},
      {onConflict:'user_id,provider,external_id'});
      if(error)throw error;
    }
    return done('connected');
  }catch(e){console.error('[social callback]',/^[A-Z_]+$/.test(e.message||'')?e.message:'META_CONNECT_FAILED');return done('error',({INSTAGRAM_PROFESSIONAL_REQUIRED:'professional',FACEBOOK_PAGE_REQUIRED:'page',META_PUBLISH_PERMISSION_REQUIRED:'permissions',META_PERMISSIONS_REQUIRED:'permissions'})[e.message]||'failed');}
});

router.delete('/social/accounts/:id',requireUser,async(req,res)=>{
  if(!uuid.test(req.params.id))return res.status(400).json({error:'Invalid account'});
  const {data,error}=await admin.from('social_accounts').delete().eq('id',req.params.id).eq('user_id',req.user.id).select('id').maybeSingle();
  if(error)return res.status(503).json({error:'Could not disconnect'});
  if(!data)return res.status(404).json({error:'Account not found'});
  res.json({ok:true});
});

router.post('/social/publish',requireUser,async(req,res)=>{
  const {accountId,clipId,idempotencyKey,caption,consent}=req.body||{};
  if(!uuid.test(accountId||'')||!uuid.test(clipId||'')||!uuid.test(idempotencyKey||'')||typeof caption!=='string'||caption.length>2200||consent!==true)
    return res.status(400).json({error:'Choose a clip and account, review the caption, and confirm publication'});
  const [{data:account,error:accountError},{data:clip,error:clipError}]=await Promise.all([
    admin.from('social_accounts').select('id,provider,status').eq('id',accountId).eq('user_id',req.user.id).maybeSingle(),
    admin.from('clips').select('id,storage_path').eq('id',clipId).eq('user_id',req.user.id).maybeSingle()
  ]);
  if(accountError||clipError)return res.status(503).json({error:'Could not verify account or clip'});
  if(!account||!clip?.storage_path)return res.status(404).json({error:'Account or finished clip not found'});
  if(account.status!=='connected')return res.status(409).json({error:'Reconnect this account first'});
  if(!meta.configured(account.provider))return res.status(503).json({error:'Connector configuration is pending'});
  const {data,error}=await admin.from('social_publications').insert({user_id:req.user.id,account_id:accountId,clip_id:clipId,
    idempotency_key:idempotencyKey,caption:caption.trim(),status:'queued'}).select(publicPost).single();
  if(error?.code==='23505'){
    const {data:prior,error:priorError}=await admin.from('social_publications').select(publicPost+',caption').eq('user_id',req.user.id).eq('idempotency_key',idempotencyKey).maybeSingle();
    if(priorError||!prior)return res.status(503).json({error:'Could not verify earlier publication'});
    if(prior.account_id!==accountId||prior.clip_id!==clipId||prior.caption!==caption.trim())
      return res.status(409).json({error:'This publishing attempt belongs to a different clip, account, or caption'});
    delete prior.caption;
    return res.status(200).json({publication:prior});
  }
  if(error)return res.status(503).json({error:'Could not queue publication'});
  res.status(202).json({publication:data});
});

router.get('/social/publications',requireUser,async(req,res)=>{
  const {data,error}=await admin.from('social_publications').select(publicPost).eq('user_id',req.user.id).order('created_at',{ascending:false}).limit(50);
  if(error)return res.status(503).json({error:'Publications unavailable'});
  res.json({publications:data||[]});
});

module.exports=router;
