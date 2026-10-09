const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const styles=require('../lib/captionStyles');
const {buildASS}=require('../lib/pipeline');
test('26 distinct styles include legacy IDs and accessible off/contrast options',()=>{
  assert.ok(styles.presets.length>=20);
  assert.equal(new Set(styles.presets.map(x=>x.id)).size,styles.presets.length);
  for(const id of ['classic','white','green','pink','off','contrast']) assert.ok(styles.presets.find(x=>x.id===id));
  assert.notDeepEqual(styles.validate('classic').resolved,styles.validate('white').resolved);
});
test('caption schema rejects unsafe colors, fonts, type confusion and unknown options',()=>{
  for(const options of [{color:'red;rm -rf /'},{font:'evil,ASS'},{size:10000},{wordsPerLine:0},{box:'yes'},{command:'bad'}])
    assert.throws(()=>styles.validate({preset:'classic',options}));
});
test('legacy four styles and settings migrate without losing captions',()=>{
  for(const id of ['classic','white','green','pink']) assert.equal(styles.fromLegacy({captionStyle:id}).preset,id);
  const s=styles.fromLegacy({captionStyle:'green',fontSize:78,position:'top',karaoke:false});
  assert.equal(s.resolved.size,78);assert.equal(s.resolved.position,'top');assert.equal(s.resolved.karaoke,false);
});
test('ASS escapes markup, wraps lines, applies safe margins and disables captions',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snipo-style-'));
  try{const file=path.join(dir,'captions.ass');const words=['Hello','{\\pos(0,0)}','दुनिया','this','is','long','indeed'].map((word,i)=>({word,start:i*.5,end:(i+1)*.5}));
    buildASS(words,0,4,file,{caption:{preset:'contrast',options:{wordsPerLine:2}},w:1080,h:1920});
    const body=fs.readFileSync(file,'utf8');assert.match(body,/Style: Cap,Noto Sans Devanagari/);assert.match(body,/,86,86,230,1/);assert.ok(!body.includes('\\pos('));assert.ok((body.match(/Dialogue: 0/g)||[]).length>=4);
    buildASS(words,0,4,file,{caption:{preset:'off'},w:1080,h:1920});assert.ok(!fs.readFileSync(file,'utf8').includes('Dialogue: 0'));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('FFmpeg burns the high-contrast subtitle into a representative frame',t=>{
  if(spawnSync('ffmpeg',['-version']).status!==0) return t.skip('FFmpeg unavailable');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snipo-frame-'));
  try{const ass=path.join(dir,'sample.ass'),out=path.join(dir,'out.png');
    buildASS([{word:'CAPTION',start:0,end:2}],0,2,ass,{caption:{preset:'contrast',options:{karaoke:false}},w:540,h:960});
    const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=540x960:d=2','-vf',`subtitles=${ass}`,'-ss','1','-frames:v','1','-y',out]);
    assert.equal(r.status,0,r.stderr.toString());
    const blank=path.join(dir,'blank.png');const b=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=540x960:d=2','-ss','1','-frames:v','1','-y',blank]);
    assert.equal(b.status,0,b.stderr.toString());assert.notDeepEqual(fs.readFileSync(out),fs.readFileSync(blank));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('preview route selects only the authenticated user’s clip', async()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(__dirname,'../routes/clips.js'),'utf8');
  const start=source.indexOf("router.post('/clips/:id/caption-preview'");
  const end=source.indexOf('// Re-render a clip',start);
  assert.ok(start>0 && end>start);
  let handler,filters={};
  const admin={from:()=>({select:()=>({eq(k,v){filters[k]=v;return this},maybeSingle:async()=>({data:null,error:null})})})};
  vm.runInNewContext(source.slice(start,end),{router:{post:(_p,_auth,_json,fn)=>{handler=fn}},requireUser:()=>{},express:{json:()=>{}},captionStyles:styles,admin});
  let code=200;await handler({user:{id:'owner'},params:{id:'clip-1'},body:{caption:{preset:'classic'}}},{status(x){code=x;return this},json(){}});
  assert.equal(code,404);assert.equal(filters.id,'clip-1');assert.equal(filters.user_id,'owner');
});
test('Studio preset selection replaces stale overrides and export renders visibly different styles',()=>{
 const vm=require('node:vm'),script=fs.readFileSync(path.join(__dirname,'../public/app/studio.js'),'utf8');
 const start=script.indexOf('const properties='),end=script.indexOf("$('#project-name').onchange",start);
 const listeners={},project={captionPreset:'classic',captionColor:'#ffffff',captionSize:74,captionPosition:'bottom',captions:true};
 vm.runInNewContext(script.slice(start,end),{$:id=>({addEventListener:(_event,fn)=>{listeners[id]=fn;}}),captionPresets:styles.presets,change:fn=>fn(project)});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snipo-switch-'));const images=[];
 try{
  for(const preset of ['pink','ice','off']){
   listeners['#captionPreset']({target:{value:preset}});const expected=styles.validate(preset).resolved;
   assert.equal(project.captionColor,expected.color);assert.equal(project.captionSize,expected.size);assert.equal(project.captionPosition,expected.position);assert.equal(project.captions,preset!=='off');
   const ass=path.join(dir,preset+'.ass');buildASS([{word:'STYLE',start:0,end:2}],0,2,ass,{caption:{preset,options:{color:project.captionColor,size:project.captionSize,position:project.captionPosition}},w:540,h:960});
   if(preset==='off')assert.ok(!fs.readFileSync(ass,'utf8').includes('Dialogue: 0'));
   if(spawnSync('ffmpeg',['-version']).status===0){const image=path.join(dir,preset+'.png');const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=540x960:d=2','-vf',`subtitles=${ass}`,'-ss','1','-frames:v','1','-y',image]);assert.equal(r.status,0,r.stderr.toString());images.push(fs.readFileSync(image));}
  }
  if(images.length){assert.notDeepEqual(images[0],images[1]);assert.notDeepEqual(images[1],images[2]);}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
