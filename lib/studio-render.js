'use strict';
const {spawn}=require('child_process');const fs=require('fs');const path=require('path');
const Model=require('../public/app/studio-model');const {buildASS}=require('./pipeline');
function run(bin,args,cwd){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{cwd});let out='',err='';const timer=setTimeout(()=>{p.kill('SIGKILL');},240000);p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>{err=(err+b).slice(-4000);});p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error('Media render failed: '+err));});});}
async function probe(file){const d=JSON.parse(await run(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));return d;}
function dims(p,plan){const h=p.resolution===1080&&plan!=='free'?1920:1280;return {'9:16':[h*9/16,h],'1:1':[h*9/16,h*9/16],'16:9':[h,h*9/16],'4:5':[h*9/16,h*9/16*5/4]}[p.ratio].map(x=>Math.round(x/2)*2);}
function time(t){const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=(t%60).toFixed(2).padStart(5,'0');return h+':'+String(m).padStart(2,'0')+':'+s;}
async function renderStudio(source,p,assets,dir,plan='free',onProgress=()=>{}){
const bin=process.env.FFMPEG_PATH||'ffmpeg',info=await probe(source),hasAudio=info.streams.some(s=>s.codec_type==='audio'),[W,H]=dims(p,plan),total=Model.duration(p),parts=[];
for(let i=0;i<p.segments.length;i++){const s=p.segments[i],d=(s.end-s.start)/s.speed,out=path.join(dir,'part'+i+'.mp4');const media=s.assetId?assets.find(a=>a.id===s.assetId).local:source;const si=s.assetId?await probe(media):info;const sound=si.streams.some(s=>s.codec_type==='audio');const rotation={0:'',90:'transpose=1,',180:'hflip,vflip,',270:'transpose=2,'}[p.rotation];
const vf=`setpts=(PTS-STARTPTS)/${s.speed},${rotation}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:x=(iw-ow)*${p.cropX}:y=(ih-oh)*${p.cropY},scale=iw*${p.zoom}:ih*${p.zoom},crop=${W}:${H}:x=(iw-ow)*${p.cropX}:y=(ih-oh)*${p.cropY},setsar=1,fps=30,eq=brightness=${p.brightness}:contrast=${p.contrast}`;
const args=['-threads','2','-filter_threads','1','-ss',String(s.start),'-t',String(s.end-s.start),'-i',media];
if(!sound)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
args.push('-map','0:v:0','-map',sound?'0:a:0':'1:a:0','-vf',vf,'-af',`asetpts=PTS-STARTPTS,atempo=${s.speed},volume=${p.volume},aresample=48000`,'-t',String(d),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-ac','2','-y',out);
await run(bin,args,dir);parts.push(out);onProgress(Math.round((i+1)/p.segments.length*65));}
fs.writeFileSync(path.join(dir,'parts.txt'),parts.map(f=>`file '${path.basename(f)}'`).join('\n'));
const joined=path.join(dir,'joined.mp4');await run(bin,['-f','concat','-safe','1','-i','parts.txt','-c','copy','-y',joined],dir);
const subtitle=path.join(dir,'studio.ass');buildASS(Model.words(p,p.words),0,total,subtitle,{w:W,h:H,caption:{version:1,preset:p.captions?p.captionPreset:'off',options:{color:p.captionColor,size:p.captionSize,position:p.captionPosition}}});
// ASS text is data, never executable filter text. Strip override characters.
let extra='';for(const l of p.layers.filter(l=>l.type==='text')){const c='&H00'+l.color.slice(5,7)+l.color.slice(3,5)+l.color.slice(1,3);const txt=l.text.replace(/[{}\\\r\n]/g,' ');extra+=`Dialogue: 2,${time(l.start)},${time(l.end)},Cap,,0,0,0,{\\an5\\pos(${Math.round(l.x*W)},${Math.round(l.y*H)})\\fs${Math.round(l.size*H/1920)}\\c${c}}${txt}\n`;}
fs.appendFileSync(subtitle,extra);
const args=['-threads','2','-filter_complex_threads','1','-i',joined],filters=[];let video='0:v',audio='0:a',idx=1;
for(const l of p.layers.filter(l=>l.type==='image')){const a=assets.find(a=>a.id===l.assetId);args.push('-loop','1','-i',a.local);filters.push(`[${idx}:v]scale=${Math.round(W*l.width/2)*2}:-2[img${idx}]`);filters.push(`[${video}][img${idx}]overlay=x=(W-w)*${l.x}:y=(H-h)*${l.y}:enable='between(t,${l.start},${l.end})':shortest=1[v${idx}]`);video='v'+idx;idx++;}
if(p.audio){const a=assets.find(a=>a.id===p.audio.assetId);args.push('-i',a.local);filters.push(`[${idx}:a]atrim=start=${p.audio.offset},asetpts=PTS-STARTPTS,volume=${p.audio.volume},apad[music]`);filters.push('[0:a][music]amix=inputs=2:duration=first:normalize=0[aout]');audio='aout';idx++;}
let vf='subtitles=studio.ass';if(p.fade>0)vf+=`,fade=t=in:st=0:d=${Math.min(p.fade,total/2)},fade=t=out:st=${Math.max(0,total-p.fade)}:d=${Math.min(p.fade,total/2)}`;
if(plan==='free')vf+=",drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='snipoclip.com':fontcolor=white@0.6:fontsize=28:x=(w-text_w)/2:y=h-100";
filters.push(`[${video}]${vf}[vout]`);args.push('-filter_complex',filters.join(';'),'-map','[vout]','-map',audio==='0:a'?audio:'['+audio+']','-t',String(total),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-y',path.join(dir,'export.mp4'));
await run(bin,args,dir);onProgress(95);return path.join(dir,'export.mp4');}
module.exports={renderStudio,probe,dims};
