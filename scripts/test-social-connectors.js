const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const path=require('node:path');

process.env.META_GRAPH_VERSION='v25.0'; // test fixture; production version is set in Render
process.env.META_INSTAGRAM_APP_ID='ig-test';process.env.META_INSTAGRAM_APP_SECRET='ig-secret';
process.env.META_INSTAGRAM_REDIRECT_URI='https://snipoclip.com/api/social/instagram/callback';
process.env.META_FACEBOOK_APP_ID='fb-test';process.env.META_FACEBOOK_APP_SECRET='fb-secret';
process.env.META_FACEBOOK_REDIRECT_URI='https://snipoclip.com/api/social/facebook/callback';
process.env.TOKEN_ENCRYPTION_KEY='test-only-social-token-key';

const meta=require('../lib/meta');
const worker=require('../lib/social-worker');
const video={streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30/1'},
  {codec_type:'audio',codec_name:'aac'}],format:{duration:'35',size:'40000000'}};

test('provider consent URL separates scopes and carries an unpredictable state',()=>{
  const state=crypto.randomBytes(32).toString('base64url');
  const ig=new URL(meta.authUrl('instagram',state));
  const fb=new URL(meta.authUrl('facebook',state));
  assert.equal(ig.hostname,'www.instagram.com');
  assert.equal(fb.hostname,'www.facebook.com');
  assert.equal(ig.searchParams.get('state'),state);
  assert.match(ig.searchParams.get('scope'),/instagram_business_content_publish/);
  assert.doesNotMatch(fb.searchParams.get('scope'),/instagram_business/);
  assert.match(fb.searchParams.get('scope'),/pages_manage_posts/);
});

test('video validation rejects unsuitable Reels before sending media to Meta',()=>{
  assert.doesNotThrow(()=>worker.validateVideo(video,'facebook'));
  assert.doesNotThrow(()=>worker.validateVideo(video,'instagram'));
  assert.throws(()=>worker.validateVideo({...video,format:{duration:'80'}},'facebook'),/FACEBOOK_REEL_REQUIREMENTS/);
  assert.throws(()=>worker.validateVideo({...video,streams:[{...video.streams[0],width:1920,height:1080}]},'instagram'),/VIDEO_FORMAT_UNSUPPORTED/);
  assert.equal(worker.readyForPublish('facebook',{status:{video_status:'processing',uploading_phase:{status:'complete'},processing_phase:{status:'not_started'}}}),true);
  assert.equal(worker.readyForPublish('instagram',{status_code:'IN_PROGRESS'}),false);
});

test('Meta API errors never embed an access token in thrown errors',async()=>{
  const prior=global.fetch;
  global.fetch=async()=>({ok:false,status:403,json:async()=>({error:{code:10,message:'Sensitive token'}})});
  try{await assert.rejects(meta.instagramStatus('123','secret-token'),e=>e.message==='META_API_ERROR'&&e.status===403&&!String(e).includes('secret-token'));}
  finally{global.fetch=prior;}
});

test('Facebook hosted Reel uses the Page token and never downloads video into the server',async()=>{
  const prior=global.fetch,calls=[];
  global.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    const payload=calls.length===1?{video_id:'123'}:calls.length===2?{success:true}:{success:true,id:'123'};
    return {ok:true,status:200,json:async()=>payload};
  };
  try{
    const created=await meta.facebookStart('page-1','page-token');
    await meta.facebookUpload(created.video_id,'page-token','https://storage.example/private-signed-clip');
    await meta.facebookPublish('page-1',created.video_id,'page-token','A caption');
    assert.match(calls[0].url,/page-1\/video_reels$/);
    assert.match(calls[1].url,/rupload\.facebook\.com\/video-upload\//);
    assert.equal(calls[1].options.headers.file_url,'https://storage.example/private-signed-clip');
    assert.equal(calls[1].options.headers.Authorization,'OAuth page-token');
    assert.equal(new URLSearchParams(calls[2].options.body).get('upload_phase'),'finish');
    assert.equal(new URLSearchParams(calls[2].options.body).get('video_state'),'PUBLISHED');
  }finally{global.fetch=prior;}
});

test('Facebook connection refuses users without a Page creation task',async()=>{
  const prior=global.fetch;
  global.fetch=async()=>({ok:true,json:async()=>({data:[{id:'42',name:'Read-only Page',access_token:'page-token',tasks:['ANALYZE']}],paging:{}})});
  try{await assert.rejects(meta.identities('facebook','user-token'),/FACEBOOK_PAGE_REQUIRED/);}
  finally{global.fetch=prior;}
});

test('Instagram code exchange stops when publishing permission was not granted',async()=>{
  const prior=global.fetch,calls=[];
  global.fetch=async(url)=>{calls.push(String(url));return {ok:true,json:async()=>({access_token:'short-token',permissions:['instagram_business_basic']})};};
  try{
    await assert.rejects(meta.exchange('instagram','one-time-code'),/META_PUBLISH_PERMISSION_REQUIRED/);
    assert.equal(calls.length,1,'do not store or extend an incomplete grant');
  }finally{global.fetch=prior;}
});

// Exercise the actual Express callback/publish handlers with an in-memory DB.
function loadRouter(database){
  const supabasePath=require.resolve('../lib/supabase');
  const userPath=require.resolve('../lib/requireUser');
  const metaPath=require.resolve('../lib/meta');
  const prior=[supabasePath,userPath,metaPath].map(p=>require.cache[p]);
  require.cache[supabasePath]={exports:{admin:database}};
  require.cache[userPath]={exports:{requireUser:(req,res,next)=>next()}};
  require.cache[metaPath]={exports:{...meta,exchange:async()=>({access_token:'test-token',expires_in:3600,scopes:meta.IG_SCOPES}),
    identities:async()=>[{id:'ig-owned',name:'owned',token:'test-token'}]}};
  const routePath=require.resolve('../routes/social');delete require.cache[routePath];
  const router=require('../routes/social');
  [supabasePath,userPath,metaPath].forEach((p,i)=>{if(prior[i])require.cache[p]=prior[i];else delete require.cache[p];});
  return router;
}

function fakeDb(){
  const states=new Map(),accounts=[],clips=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',user_id:'owner',storage_path:'owner/clip.mp4'}],posts=[];
  function from(table){
    let op='select',payload,filters=[],fields;
    const q={
      insert(v){op='insert';payload=v;return q;},upsert(v){op='upsert';payload=v;return q;},delete(){op='delete';return q;},
      select(v){fields=v;return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},
      async maybeSingle(){const r=await execute();return {data:Array.isArray(r.data)?r.data[0]||null:r.data,error:r.error||null};},
      async single(){return q.maybeSingle();},then(resolve,reject){return execute().then(resolve,reject)}
    };
    async function execute(){
      if(table==='social_oauth_states'){
        if(op==='insert'){states.set(payload.state_hash,payload);return {error:null};}
        if(op==='delete'){
          const key=filters.find(([k])=>k==='state_hash')?.[1],state=states.get(key);
          if(state&&filters.every(([k,v])=>state[k]===v)){states.delete(key);return {data:state,error:null};}
          return {data:null,error:null};
        }
      }
      const rows=table==='social_accounts'?accounts:table==='clips'?clips:posts;
      if(op==='upsert'){accounts.push({...payload,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'});return {error:null};}
      if(op==='insert'){
        if(posts.some(p=>p.user_id===payload.user_id&&p.idempotency_key===payload.idempotency_key))return {error:{code:'23505'}};
        const item={...payload,id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};posts.push(item);return {data:item,error:null};
      }
      if(op==='delete'){
        const matches=rows.filter(row=>filters.every(([k,v])=>row[k]===v));
        for(const item of matches)rows.splice(rows.indexOf(item),1);
        return {data:matches,error:null};
      }
      return {data:rows.filter(row=>filters.every(([k,v])=>row[k]===v)),error:null};
    }
    return q;
  }
  return {from,states,accounts,clips,posts};
}
function handler(router,method,route){
  const layer=router.stack.find(s=>s.route?.path===route&&s.route.methods[method]);
  assert.ok(layer,route);return layer.route.stack.at(-1).handle;
}
function response(){
  const r={statusCode:200,body:null,redirectUrl:null,status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},redirect(_code,url){this.redirectUrl=url;return this;}};
  return r;
}

test('OAuth state is provider-bound, expires, and cannot be replayed',async()=>{
  const db=fakeDb(),router=loadRouter(db);
  const connect=handler(router,'post','/social/:provider/connect');
  const callback=handler(router,'get','/social/:provider/callback');
  const begin=response();await connect({params:{provider:'instagram'},user:{id:'owner'},body:{consent:true}},begin);
  const state=new URL(begin.body.url).searchParams.get('state');
  const denied=response();await callback({params:{provider:'facebook'},query:{state,code:'x'}},denied);
  assert.match(denied.redirectUrl,/error/);
  const connected=response();await callback({params:{provider:'instagram'},query:{state,code:'x'}},connected);
  assert.match(connected.redirectUrl,/connected/);
  assert.equal(db.accounts[0].user_id,'owner');
  assert.notEqual(db.accounts[0].enc_access,'test-token');
  const replay=response();await callback({params:{provider:'instagram'},query:{state,code:'x'}},replay);
  assert.match(replay.redirectUrl,/error/);
  const expired=response();await connect({params:{provider:'instagram'},user:{id:'owner'},body:{consent:true}},expired);
  const oldState=new URL(expired.body.url).searchParams.get('state');
  db.states.get(crypto.createHash('sha256').update(oldState).digest('hex')).expires_at=new Date(Date.now()-1000).toISOString();
  const timeout=response();await callback({params:{provider:'instagram'},query:{state:oldState,code:'x'}},timeout);
  assert.match(timeout.redirectUrl,/error/);
});

test('publish refuses other users’ accounts or clips and deduplicates a repeated request',async()=>{
  const db=fakeDb(),router=loadRouter(db),publish=handler(router,'post','/social/publish');
  const accountId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',clipId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const key='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  db.accounts.push({id:accountId,user_id:'owner',status:'connected',provider:'instagram'});
  const body={accountId,clipId,idempotencyKey:key,caption:'Reviewed caption',consent:true};
  const other=response();await publish({user:{id:'other'},body},other);assert.equal(other.statusCode,404);
  const missing=response();await publish({user:{id:'owner'},body:{...body,clipId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'}},missing);assert.equal(missing.statusCode,404);
  const first=response();await publish({user:{id:'owner'},body},first);assert.equal(first.statusCode,202);
  const second=response();await publish({user:{id:'owner'},body},second);assert.equal(second.statusCode,200);
  const changedCaption=response();await publish({user:{id:'owner'},body:{...body,caption:'Different caption'}},changedCaption);
  assert.equal(changedCaption.statusCode,409);
  db.clips.push({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',user_id:'owner',storage_path:'owner/other.mp4'});
  const changedClip=response();await publish({user:{id:'owner'},body:{...body,clipId:db.clips[1].id}},changedClip);
  assert.equal(changedClip.statusCode,409);
  assert.equal(db.posts.length,1);
});

test('disconnect removes only the authenticated owner’s connection',async()=>{
  const db=fakeDb(),router=loadRouter(db),disconnect=handler(router,'delete','/social/accounts/:id');
  const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  db.accounts.push({id,user_id:'owner',provider:'facebook'});
  const other=response();await disconnect({params:{id},user:{id:'other'}},other);
  assert.equal(other.statusCode,404);assert.equal(db.accounts.length,1);
  const owner=response();await disconnect({params:{id},user:{id:'owner'}},owner);
  assert.equal(owner.body.ok,true);assert.equal(db.accounts.length,0);
});

test('successful remote publish with a failed database write is never retried',async()=>{
  const sbPath=require.resolve('../lib/supabase'),metaPath=require.resolve('../lib/meta'),workerPath=require.resolve('../lib/social-worker');
  const previous=[sbPath,metaPath,workerPath].map(p=>require.cache[p]);
  const box=require('../lib/secretbox'),updates=[];
  const db={from:table=>{
    if(table==='social_accounts')return {select(){return this;},eq(){return this;},async single(){return {data:{id:'account',user_id:'owner',provider:'instagram',external_id:'ig-owned',status:'connected',enc_access:box.encrypt('token')}};}};
    return {update(attrs){updates.push(attrs);return this;},eq(){return this;},then(resolve){resolve({error:updates.length===2?{message:'database unavailable'}:null});}};
  }};
  require.cache[sbPath]={exports:{admin:db}};
  require.cache[metaPath]={exports:{...meta,instagramStatus:async()=>({status_code:'FINISHED'}),
    instagramPublish:async()=>({id:'published-id'}),instagramPermalink:async()=>({permalink:'https://www.instagram.com/reel/test/'})}};
  delete require.cache[workerPath];
  try{
    const isolated=require('../lib/social-worker');
    await isolated.processJob({id:'job',user_id:'owner',account_id:'account',status:'processing',remote_container_id:'container',created_at:new Date().toISOString(),caption:'test'});
    assert.deepEqual(updates.map(u=>u.status),['publishing','published','uncertain']);
  }finally{[sbPath,metaPath,workerPath].forEach((p,i)=>{if(previous[i])require.cache[p]=previous[i];else delete require.cache[p];});}
});
