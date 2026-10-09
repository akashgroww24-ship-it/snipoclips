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

test('English transcript corrections keep timings and reject silent truncation',()=>{
 const {captionWords}=require('../lib/captionText');
 const original=[{word:'Wrong',start:10,end:11},{word:'words',start:11,end:12}];
 assert.deepEqual(captionWords(original,"Hello world!"),[{word:'Hello',start:10,end:11},{word:'world!',start:11,end:12}]);
 const expanded=captionWords(original,"It’s my English caption.");
 assert.equal(expanded[0].start,10);assert.equal(expanded.at(-1).end,12);assert.equal(expanded.length,4);
 assert.strictEqual(captionWords(original,undefined),original);
 for(const input of ['',42,'word '.repeat(401),'x'.repeat(201)])assert.throws(()=>captionWords(original,input));
});
test('caption studio loads English text and sends corrections to preview and Apply',async()=>{
 const vm=require('node:vm'),nodes=new Map(),calls=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,textContent:'',innerHTML:'',listeners:{},addEventListener(k,fn){this.listeners[k]=fn},querySelectorAll(){return[]},replaceChildren(){},showModal(){this.open=true},close(){this.open=false}});return nodes.get(id)};
 const clip={id:'english-clip',url:'https://example.com/original.mp4',edit:{captionStyle:'white'}};
 const context={document:{querySelector:node},window:{},api:async(url,opts)=>{calls.push({url,body:opts?.body&&JSON.parse(opts.body)});if(url.endsWith('/text'))return {text:'Hello original world',editable:true};if(url.endsWith('/restyle'))return {url:'https://example.com/edited.mp4',edit:{}};return {presets:[],styles:[]}},authToken:async()=> 'token',fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true,blob:async()=>({})}},URL:{createObjectURL:()=> 'blob:preview',revokeObjectURL(){}},setTimeout:()=>1,clearTimeout(){}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../public/app/caption-styles.js'),'utf8'),context);
 await context.window.openCaptionEditor(clip);assert.equal(node('#cap-text').value,'Hello original world');assert.equal(node('#cap-text').disabled,false);
 node('#cap-text').value='Hello corrected English';node('#cap-text').listeners.input();
 await node('#cap-preview').onclick();await node('#cap-apply').onclick();
 for(const suffix of ['/caption-preview','/restyle'])assert.equal(calls.find(x=>x.url.endsWith(suffix)).body.text,'Hello corrected English');
});
test('English text corrections preserve padding outside the visible clip',()=>{
 const {captionWords,visibleWords}=require('../lib/captionText');
 const words=[{word:'Before',start:0,end:1},{word:'Wrong',start:10,end:11},{word:'After',start:20,end:21}];
 assert.deepEqual(visibleWords(words,10,12),[words[1]]);
 assert.deepEqual(captionWords(words,'Correct English',{start:10,end:12}),[words[0],{word:'Correct',start:10,end:10.5},{word:'English',start:10.5,end:11},words[2]]);
});
test('karaoke follows actual word timestamps, including silent gaps',()=>{
 const {karaokeWindows}=require('../lib/karaoke');
 assert.deepEqual(karaokeWindows([{word:'Hello',start:0,end:.3},{word:'world',start:1,end:1.4}],0,1.4),[{start:0,end:.3,active:0},{start:.3,end:1,active:-1},{start:1,end:1.4,active:1}]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'snipo-karaoke-'));
 try{const file=path.join(dir,'captions.ass');buildASS([{word:'Hello',start:0,end:.3},{word:'world',start:1,end:1.4}],0,1.4,file,{caption:{preset:'karaoke'}});const text=fs.readFileSync(file,'utf8');assert.match(text,/Dialogue: 0,0:00:01.00,0:00:01.40/);assert.ok(text.includes('{\\c&H0015CCFA}world'));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
