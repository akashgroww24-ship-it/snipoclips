'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),api=require('../lib/rapidapi-youtube');
const url=()=>`https://r1.googlevideo.com/videoplayback?expire=${Math.floor(Date.now()/1000)+3600}`;
const v=(height=720)=>({url:url(),height,mimeType:'video/mp4',bitrate:1000});
const a=()=>({url:url(),mimeType:'audio/mp4',bitrate:100});
test('selects higher quality video plus audio and honors height ceiling',()=>{
 const data={formats:[{...v(360),audioChannels:2}],adaptiveFormats:[v(720),v(1080),a()]};
 assert.equal(api.chooseStreams(data,720)[0].height,720);
 assert.equal(api.chooseStreams(data,720).length,2);
 assert.equal(api.chooseStreams(data,360).length,1);
 assert.throws(()=>api.chooseStreams({adaptiveFormats:[v()]}),{code:'provider_no_streams'});
 assert.throws(()=>api.chooseStreams({isProtectedContent:true}),{code:'provider_protected_media'});
 assert.throws(()=>api.chooseStreams({formats:[{...v(),audioChannels:2,contentLength:2**31}]}),{code:'provider_file_too_large'});
});
test('rejects expired, private and lookalike media hosts',()=>{
 for(const u of ['http://r1.googlevideo.com/x','https://127.0.0.1/x','https://googlevideo.com.evil.test/x','https://user:pass@r1.googlevideo.com/x'])assert.throws(()=>api.mediaUrl(u),{code:'provider_invalid_media'});
 assert.throws(()=>api.mediaUrl('https://r1.googlevideo.com/x?expire=1'),{code:'provider_expired_media'});
});
test('API errors are actionable and do not expose credentials',async()=>{
 for(const [status,code] of [[401,'provider_credentials'],[403,'provider_credentials'],[429,'provider_quota'],[500,'provider_unavailable']]){
  await assert.rejects(api.streamingData('VyHV0BRtdxo',{key:'secret-value',fetchImpl:async()=>new Response('secret-value',{status})}),e=>e.code===code&&!e.message.includes('secret-value'));
 }
 await assert.rejects(api.streamingData('channel',{key:'x'}),{code:'invalid_video_id'});
});
test('media download blocks private redirects, enforces size and cleans partial files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rapid-test-')),dest=path.join(dir,'v.mp4');
 try{
  await assert.rejects(api.downloadMedia(url(),dest,{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/secret'}})}),{code:'provider_invalid_media'});
  await assert.rejects(api.downloadMedia(url(),dest,{fetchImpl:async()=>new Response('',{status:403})}),{code:'provider_media_blocked'});
  await assert.rejects(api.downloadMedia(url(),dest,{budget:{remaining:2},fetchImpl:async()=>new Response('12345')}),{code:'provider_file_too_large'});
  assert.equal(fs.existsSync(dest),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('full adapter downloads separate streams without forwarding API key and merges playable audio/video',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rapid-media-'));
 try{
  const video=path.join(dir,'fixture-video.mp4'),audio=path.join(dir,'fixture-audio.mp4');
  await exec('ffmpeg',['-y','-v','error','-f','lavfi','-i','color=c=purple:s=320x180:r=24','-t','1','-an','-c:v','libx264',video]);
  await exec('ffmpeg',['-y','-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','1','-vn','-c:a','aac',audio]);
  let calls=0;
  const fetchImpl=async(u,options)=>{
   calls++;
   if(u.startsWith('https://'+api.HOST)){
    assert.equal(options.headers['X-RapidAPI-Key'],'server-secret');
    assert.equal(new URL(u).searchParams.get('id'),'VyHV0BRtdxo');
    return new Response(JSON.stringify({adaptiveFormats:[{...v(),url:url()+'&track=video'},{...a(),url:url()+'&track=audio'}]}));
   }
   assert.equal(options.headers,undefined);
   return new Response(fs.readFileSync(u.includes('track=video')?video:audio),{headers:{'content-type':'application/octet-stream'}});
  };
  const output=await api.fetchVideo('VyHV0BRtdxo',dir,{key:'server-secret',fetchImpl,run:(bin,args)=>exec(bin,args)});
  const {stdout}=await exec('ffprobe',['-v','error','-show_streams','-of','json',output]);
  assert.deepEqual(JSON.parse(stdout).streams.map(s=>s.codec_type).sort(),['audio','video']);
  assert.equal(calls,3);
  assert.equal(fs.existsSync(path.join(dir,'rapid-source-0.mp4')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
