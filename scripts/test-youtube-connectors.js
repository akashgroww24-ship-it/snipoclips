const test=require('node:test');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const yt=require('../lib/youtube');
process.env.JWT_SECRET='youtube-test-only-secret';
function router(db,client){
  const paths=['../lib/supabase','../lib/youtube','../routes/youtube'].map(require.resolve);
  const prior=paths.map(p=>require.cache[p]);
  require.cache[paths[0]]={exports:{admin:db}};
  require.cache[paths[1]]={exports:client};delete require.cache[paths[2]];
  try{return require('../routes/youtube');}finally{paths.forEach((p,i)=>{if(prior[i])require.cache[p]=prior[i];else delete require.cache[p];});}
}
function db(result){return {from(){return {select(){return this;},eq(){return this;},delete(){return this;},maybeSingle:async()=>result,then(resolve){resolve(result);}};}};}
function handler(r,method,path){return r.stack.find(s=>s.route?.path===path&&s.route.methods[method]).route.stack.at(-1).handle;}
function res(){return {code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},redirect(url){this.url=url;return this;}};}
const client={configured:()=>true};
test('YouTube status distinguishes database failure from a disconnected channel',async()=>{
  const r=res();await handler(router(db({error:{message:'db down'}}),client),'get','/youtube/status')({user:{id:'owner'}},r);
  assert.equal(r.code,503);assert.match(r.body.error,/retry/);
});
test('YouTube status requests reconnection for an expired nonrefreshable token and never leaks it',async()=>{
  const r=res();await handler(router(db({data:{channel_id:'channel',expiry:new Date(0).toISOString(),enc_refresh:null}}),client),'get','/youtube/status')({user:{id:'owner'}},r);
  assert.equal(r.body.connected,false);assert.equal(r.body.reconnectRequired,true);assert.equal('enc_refresh' in r.body.channel,false);
});
test('YouTube disconnect does not report success when database deletion fails',async()=>{
  const r=res();await handler(router(db({error:{message:'db down'}}),client),'post','/youtube/disconnect')({user:{id:'owner'}},r);assert.equal(r.code,503);
});
test('YouTube consent state binds the user, purpose and exact callback URI',async()=>{
  const redirect='https://snipoclip.com/api/youtube/callback';let state;
  const r=res();await handler(router(db({}),{...client,redirectUri:()=>redirect,authUrl:(s,u)=>{state=s;assert.equal(u,redirect);return 'https://accounts.google.com';}}),'post','/youtube/connect')({user:{id:'owner'},body:{acceptedYouTubeTerms:true}},r);
  const claims=jwt.verify(state,process.env.JWT_SECRET);assert.equal(claims.uid,'owner');assert.equal(claims.purpose,'youtube-connect');assert.equal(claims.redirect,redirect);assert.ok(claims.n.length>=40);
});
test('YouTube token errors are classified without echoing provider secrets',async()=>{
  const prior=global.fetch;global.fetch=async()=>({ok:false,json:async()=>({error:'invalid_client',error_description:'secret leaked by provider'})});
  try{await assert.rejects(yt.exchangeCode('code','https://example.com/callback'),e=>e.code==='YOUTUBE_CLIENT_INVALID'&&!e.message.includes('secret'));}finally{global.fetch=prior;}
});
