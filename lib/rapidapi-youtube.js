'use strict';
// Glavier youtube138 /video/streaming-data/, verified against its public
// RapidAPI playground response. API credentials never go to media hosts.
const fs=require('node:fs');
const path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const HOST='youtube138.p.rapidapi.com';
const MAX_BYTES=1024*1024*1024;
function problem(code,message){return Object.assign(new Error(message),{code});}
function configured(env=process.env){return !!env.RAPIDAPI_KEY?.trim();}
function mediaUrl(raw,now=Date.now()){
 let u;try{u=new URL(raw);}catch{throw problem('provider_invalid_media','The video provider returned an invalid media URL.');}
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!u.hostname.endsWith('.googlevideo.com'))throw problem('provider_invalid_media','The video provider returned an unsupported media host.');
 const expiry=Number(u.searchParams.get('expire'));if(expiry&&expiry*1000<=now+30000)throw problem('provider_expired_media','The video provider returned an expired stream. Please try a new import.');
 return u.toString();
}
function chooseStreams(data,maxHeight=2160){
 if(!data||data.isProtectedContent===true)throw problem('provider_protected_media','This video is protected and cannot be imported.');
 const valid=f=>f&&typeof f.url==='string'&&/^video\/(mp4|webm)/.test(f.mimeType||'')&&Number(f.height)>0&&Number(f.height)<=maxHeight;
 const muxed=(Array.isArray(data.formats)?data.formats:[]).filter(f=>valid(f)&&(Number(f.audioChannels)>0||/mp4a|opus|vorbis/.test(f.mimeType)));
 const adaptive=Array.isArray(data.adaptiveFormats)?data.adaptiveFormats:[];
 const video=adaptive.filter(valid);
 const audio=adaptive.filter(f=>f&&typeof f.url==='string'&&/^audio\/(mp4|webm)/.test(f.mimeType||''));
 const rankVideo=(a,b)=>Number(b.height)-Number(a.height)||Number(/^video\/mp4/.test(b.mimeType))-Number(/^video\/mp4/.test(a.mimeType))||Number(b.bitrate||0)-Number(a.bitrate||0);
 muxed.sort(rankVideo);video.sort(rankVideo);audio.sort((a,b)=>Number(/^audio\/mp4/.test(b.mimeType))-Number(/^audio\/mp4/.test(a.mimeType))||Number(b.bitrate||0)-Number(a.bitrate||0));
 let chosen;if(video[0]&&audio[0]&&(!muxed[0]||Number(video[0].height)>Number(muxed[0].height)))chosen=[video[0],audio[0]];else if(muxed[0])chosen=[muxed[0]];
 if(!chosen)throw problem('provider_no_streams','The video provider did not return usable video and audio streams. Upload the original file instead.');
 const size=chosen.reduce((n,f)=>n+Number(f.contentLength||0),0);if(size>MAX_BYTES)throw problem('provider_file_too_large','This source exceeds the 1 GB import limit. Upload a smaller video.');
 return chosen.map(f=>({...f,url:mediaUrl(f.url)}));
}
async function readJson(response){
 if(!response.body)throw problem('provider_bad_response','The video provider returned an empty response.');
 let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw problem('provider_bad_response','The video provider response was too large.');chunks.push(Buffer.from(chunk));}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw problem('provider_bad_response','The video provider returned an unreadable response.');}
}
async function streamingData(id,{key=process.env.RAPIDAPI_KEY,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 if(!key?.trim())throw problem('provider_not_configured','Set RAPIDAPI_KEY on the server to enable this video provider.');
 if(!/^[A-Za-z0-9_-]{11}$/.test(id))throw problem('invalid_video_id','Enter a valid YouTube video link.');
 for(let attempt=1;attempt<=2;attempt++){
  let response;
  try{response=await fetchImpl('https://'+HOST+'/video/streaming-data/?id='+encodeURIComponent(id),{headers:{'X-RapidAPI-Key':key.trim(),'X-RapidAPI-Host':HOST},redirect:'error',signal:AbortSignal.timeout(45000)});}
  catch{
   console.warn('[youtube-provider] stage=metadata status=network attempt='+attempt);
   if(attempt===1){await sleep(2000);continue;}
   throw problem('provider_network','The video provider could not be reached after 2 attempts. Upload the original file or try later.');
  }
  if(response.ok)return readJson(response);
  const status=response.status;
  // Never log response bodies, keys or signed media URLs.
  console.warn('[youtube-provider] stage=metadata status='+status+' attempt='+attempt);
  try{await response.body?.cancel();}catch{}
  if(attempt===1&&[502,503,504].includes(status)){
   const raw=response.headers.get('retry-after');
   const wait=raw===null?2000:(/^\d+$/.test(raw)?Number(raw)*1000:Date.parse(raw)-Date.now());
   // Do not retry earlier than a provider's requested delay or hold a job indefinitely.
   if(Number.isFinite(wait)&&wait<=10000){await sleep(Math.max(2000,wait));continue;}
  }
  const suffix=' (HTTP '+status+', attempt '+attempt+').';
  if(status===401||status===403)throw problem('provider_credentials','RapidAPI denied access. Check the server key and subscription to Video Streaming Data'+suffix);
  if(status===429)throw problem('provider_quota','RapidAPI rate or usage limit reached. Wait or check the subscription quota'+suffix);
  if(status===400||status===404||status===422)throw problem('provider_video_unavailable','The provider rejected this video request. Check that the video is public and completed, or upload the original file'+suffix);
  throw problem('provider_unavailable','The video provider could not retrieve this video. Upload the original file or try later'+suffix);
 }
}
async function downloadMedia(url,destination,{fetchImpl=fetch,budget={remaining:MAX_BYTES}}={}){
 let current=mediaUrl(url);const signal=AbortSignal.timeout(15*60*1000);let response;
 for(let i=0;i<=3;i++){
  try{response=await fetchImpl(current,{redirect:'manual',signal});}catch{throw problem('provider_media_network','The source video download failed. Please retry later or upload the original file.');}
  if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next||i===3)throw problem('provider_media_redirect','The source video redirected too many times.');current=mediaUrl(new URL(next,current).toString());continue;}
  break;
 }
 if(response.status===403){await response.body?.cancel();throw problem('provider_media_blocked','The provider returned a stream that this server cannot access. It may be expired or restricted to the provider’s network. Upload the original file instead.');}
 if(!response.ok||!response.body){await response.body?.cancel();throw problem('provider_media_unavailable','The source video file is not available from the provider.');}
 if(Number(response.headers.get('content-length')||0)>budget.remaining){await response.body.cancel();throw problem('provider_file_too_large','This source exceeds the 1 GB import limit.');}
 if(/text\/html|application\/json/.test(response.headers.get('content-type')||'')){await response.body.cancel();throw problem('provider_bad_media','The provider returned a web page instead of a video file.');}
 const limit=new Transform({transform(chunk,enc,cb){budget.remaining-=chunk.length;if(budget.remaining<0)return cb(problem('provider_file_too_large','This source exceeds the 1 GB import limit.'));cb(null,chunk);}});
 try{await pipeline(Readable.fromWeb(response.body),limit,fs.createWriteStream(destination),{signal});}catch(e){try{fs.unlinkSync(destination);}catch{}if(e.code?.startsWith('provider_'))throw e;throw problem('provider_media_network','The source video download was interrupted. Please retry or upload a file.');}
}
async function fetchVideo(id,workDir,{run,ffmpeg='ffmpeg',maxHeight=2160,key=process.env.RAPIDAPI_KEY,fetchImpl=fetch}={}){
 const data=await streamingData(id,{key,fetchImpl}),streams=chooseStreams(data,maxHeight),budget={remaining:MAX_BYTES};
 const files=streams.map((s,i)=>path.join(workDir,'rapid-source-'+i+(/webm/.test(s.mimeType)?'.webm':'.mp4'))),out=path.join(workDir,'source.mp4');
 try{
  for(let i=0;i<streams.length;i++)await downloadMedia(streams[i].url,files[i],{fetchImpl,budget});
  const args=['-y','-v','error','-i',files[0]];
  if(files[1])args.push('-i',files[1],'-map','0:v:0','-map','1:a:0');else args.push('-map','0:v:0','-map','0:a:0');
  args.push('-c','copy','-movflags','+faststart',out);
  try{await run(ffmpeg,args,{timeoutMs:180000});}catch{throw problem('provider_merge_failed','The provider video and audio could not be combined. Upload the original file instead.');}
  if(!fs.existsSync(out)||!fs.statSync(out).size)throw problem('provider_bad_media','The provider did not supply a playable video file.');
  return out;
 }catch(e){try{fs.unlinkSync(out);}catch{}throw e;}finally{for(const file of files)try{fs.unlinkSync(file);}catch{}}
}
module.exports={configured,mediaUrl,chooseStreams,streamingData,downloadMedia,fetchVideo,HOST};
