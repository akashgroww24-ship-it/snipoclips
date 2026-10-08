(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
function number(x,min,max,name){x=Number(x);if(!Number.isFinite(x)||x<min||x>max)throw new Error('Invalid '+name);return x;}
function text(x,n=160){return String(x||'').replace(/[{}\\\r]/g,'').slice(0,n);}
function color(x){if(!/^#[0-9a-f]{6}$/i.test(x))throw new Error('Invalid color');return x;}
function duration(p){return p.segments.reduce((n,s)=>n+(s.end-s.start)/s.speed,0);}
function locate(p,time){let offset=0;for(let i=0;i<p.segments.length;i++){const s=p.segments[i],d=(s.end-s.start)/s.speed;if(time<offset+d||i===p.segments.length-1)return {index:i,source:s.start+Math.max(0,Math.min(d,time-offset))*s.speed,offset};offset+=d;}return null;}
function split(p,time){const q=clone(p),at=locate(q,time);if(!at)throw new Error('Select a position on the timeline');const s=q.segments[at.index];if(at.source-s.start<.1||s.end-at.source<.1)throw new Error('Split inside a segment');q.segments.splice(at.index,1,{...s,end:at.source},{...s,start:at.source});return q;}
function words(p,input){let offset=0;const out=[];for(const s of p.segments){for(const w of s.assetId?[]:input||[]){const a=Math.max(s.start,w.start),b=Math.min(s.end,w.end);if(b>a)out.push({word:text(w.word,60),start:offset+(a-s.start)/s.speed,end:offset+(b-s.start)/s.speed});}offset+=(s.end-s.start)/s.speed;}return out;}
function validate(raw,sourceDuration,assets=[]){
if(!raw||raw.version!==1)throw new Error('Unsupported project version');
if(!Array.isArray(raw.segments)||!raw.segments.length||raw.segments.length>32)throw new Error('Use 1–32 timeline segments');
const p={version:1,name:text(raw.name,80)||'My edit',ratio:['9:16','1:1','16:9','4:5'].includes(raw.ratio)?raw.ratio:'9:16',resolution:raw.resolution===1080?1080:720,
segments:raw.segments.map(s=>{const a=s.assetId?assets.find(a=>a.id===s.assetId&&a.type==='video'):null;if(s.assetId&&!a)throw new Error('Video not in this project');const d=a?a.duration:sourceDuration;return {start:number(s.start,0,d,'segment start'),end:number(s.end,0,d,'segment end'),speed:number(s.speed,.5,2,'speed'),...(a?{assetId:a.id}:{})};}),rotation:[0,90,180,270].includes(Number(raw.rotation))?Number(raw.rotation):0,
volume:number(raw.volume??1,0,2,'volume'),brightness:number(raw.brightness??0,-.3,.3,'brightness'),contrast:number(raw.contrast??1,.5,1.5,'contrast'),zoom:number(raw.zoom??1,1,2,'zoom'),
cropX:number(raw.cropX??.5,0,1,'crop position'),cropY:number(raw.cropY??.5,0,1,'crop position'),fade:number(raw.fade??0,0,1,'fade'),
captions:raw.captions!==false,captionPreset:text(raw.captionPreset||'classic',30),captionColor:color(raw.captionColor||'#ffffff'),captionSize:number(raw.captionSize??74,40,140,'caption size'),captionPosition:['top','middle','bottom'].includes(raw.captionPosition)?raw.captionPosition:'bottom',
words:Array.isArray(raw.words)?raw.words.slice(0,2000).map(w=>({word:text(w.word,60),start:number(w.start,0,sourceDuration,'word start'),end:number(w.end,0,sourceDuration,'word end')})):[],layers:[]};
if(p.segments.some(s=>s.end-s.start<.1))throw new Error('Each segment must contain at least 0.1 seconds');
const total=duration(p);if(total>300)throw new Error('Exports are limited to five minutes');
if(p.words.some(w=>w.end<=w.start))throw new Error('Caption word end must follow its start');
if((raw.layers||[]).length>12)throw new Error('Use up to 12 layers');
for(const l of raw.layers||[]){const x={type:l.type,start:number(l.start,0,total,'layer start'),end:number(l.end,0,total,'layer end')};if(x.end<=x.start)throw new Error('Layer end must follow its start');
if(l.type==='text'){Object.assign(x,{text:text(l.text),color:color(l.color||'#ffffff'),size:number(l.size??64,20,160,'text size'),x:number(l.x??.5,0,1,'text position'),y:number(l.y??.2,0,1,'text position')});}
else if(l.type==='image'){if(!assets.some(a=>a.id===l.assetId&&a.type==='image'))throw new Error('Image not in this project');Object.assign(x,{assetId:l.assetId,x:number(l.x??.5,0,1,'image position'),y:number(l.y??.5,0,1,'image position'),width:number(l.width??.3,.05,1,'image size')});}
else throw new Error('Unsupported layer');p.layers.push(x);}
if(raw.audio){if(!assets.some(a=>a.id===raw.audio.assetId&&a.type==='audio'))throw new Error('Audio not in this project');p.audio={assetId:raw.audio.assetId,volume:number(raw.audio.volume??.3,0,2,'music volume'),offset:number(raw.audio.offset??0,0,300,'audio offset')};}
return p;}
function removePauses(p){const q=clone(p),speech=(q.words||[]).filter(w=>w.end>w.start).sort((a,b)=>a.start-b.start),next=[];
for(const s of q.segments){if(s.assetId){next.push(s);continue;}const ranges=[];for(const w of speech){const a=Math.max(s.start,w.start-.12),b=Math.min(s.end,w.end+.12);if(b<=a)continue;const prev=ranges[ranges.length-1];if(prev&&a-prev.end<.45)prev.end=Math.max(prev.end,b);else ranges.push({start:a,end:b,speed:s.speed});}next.push(...ranges);}
if(!next.length)throw new Error('No speech timings available for pause removal');if(next.length>32)throw new Error('Too many cuts; remove pauses on a shorter selection');q.segments=next;return q;}
const api={clone,duration,locate,split,words,validate,removePauses};if(typeof module!=='undefined')module.exports=api;else root.StudioModel=api;
})(typeof window!=='undefined'?window:this);
