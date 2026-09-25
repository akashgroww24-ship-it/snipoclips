// Run after: npm install --no-save --package-lock=false jsdom
// node --test scripts/test-navigation.cjs
const {JSDOM}=require('jsdom');
const fs=require('fs');const assert=require('node:assert/strict');const test=require('node:test');
const base=require('path').join(__dirname,'../public/app/');
function setup(mobile=false){
 const dom=new JSDOM(fs.readFileSync(base+'index.html','utf8'),{runScripts:'outside-only',url:'https://example.test/app/'});
 const w=dom.window;w.matchMedia=()=>({matches:mobile,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};
 w.HTMLElement.prototype.getClientRects=function(){return [{}]};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
 const d=w.document;const pills=['Karaoke','Hook title','Enhance audio','Clean up','AI B-roll','Face tracking','Keyword pop','Emojis','Progress bar'];
 for(const label of pills){const b=d.createElement('button');b.className='pill';b.textContent=label;b.setAttribute('aria-pressed','false');b.onclick=()=>b.setAttribute('aria-pressed',b.getAttribute('aria-pressed')==='false'?'true':'false');d.querySelector('#pills').append(b)}
 w.eval(fs.readFileSync(base+'studio-navigation.js','utf8'));
 return {w,d,close:()=>w.close()};
}
test('desktop sidebar collapses and restores without hiding studio',()=>{const {d,close}=setup();assert.equal(d.querySelector('#studio-menu').getAttribute('aria-expanded'),'true');d.querySelector('#studio-close').click();assert.equal(d.querySelector('#studio-sidebar').inert,true);d.querySelector('#studio-menu').click();assert.equal(d.querySelector('#studio-sidebar').inert,false);assert.equal(d.querySelector('.scene').inert,false);close()});
test('mobile menu closes on Escape and restores focus',()=>{const {w,d,close}=setup(true);assert.equal(d.querySelector('#studio-sidebar').inert,true);d.querySelector('#studio-menu').click();assert.equal(d.querySelector('.scene').inert,true);assert.equal(d.querySelector('#studio-sidebar').getAttribute('aria-modal'),'true');d.querySelector('#studio-close').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('.scene').inert,false);assert.equal(d.activeElement.id,'studio-menu');close()});
test('guide searches all features and has a recoverable empty result',()=>{const {w,d,close}=setup();d.querySelector('[data-studio="guides"]').click();assert.ok(d.querySelectorAll('#studio-guide details').length>=38);const input=d.querySelector('#studio-guide-search');input.value='nonexistentzzz';input.dispatchEvent(new w.Event('input'));assert.ok(d.querySelector('.studio-no-results'));input.value='karaoke';input.dispatchEvent(new w.Event('input'));assert.ok(d.querySelectorAll('#studio-guide details').length>0);close()});
test('contextual help does not toggle an effect; original effect still works',()=>{const {d,close}=setup();const p=d.querySelector('#pills .pill');d.querySelector('[aria-label="About Karaoke"]').click();assert.equal(p.getAttribute('aria-pressed'),'false');assert.equal(d.querySelector('[data-topic="karaoke"]').open,true);d.querySelector('#studio-guide-close').click();p.click();assert.equal(p.getAttribute('aria-pressed'),'true');assert.equal(d.querySelectorAll('#pills .pill').length,9);close()});
test('Show me opens options and focuses matching control without changing value',()=>{const {d,close}=setup();d.querySelector('[aria-label="About Aspect ratio"]').click();d.querySelector('[data-show="ratio"]').click();assert.equal(d.querySelector('#studio-guide').open,false);assert.equal(d.querySelector('#opt-btn').getAttribute('aria-expanded'),'true');assert.equal(d.activeElement.id,'ratio');assert.equal(d.activeElement.value,'9:16');close()});
test('create navigation restores a previously hidden upload panel',()=>{const {d,close}=setup();d.querySelector('.hero').style.display='none';d.querySelector('[data-studio="create"]').click();assert.equal(d.querySelector('.hero').style.display,'');assert.equal(d.activeElement.id,'t-url');close()});
test('dynamically added reel controls get help exactly once',async()=>{const {w,d,close}=setup();const s=d.createElement('select');s.id='reel-name';d.body.append(s);await new Promise(r=>w.setTimeout(r,0));assert.equal(d.querySelectorAll('[aria-label="About Reel title"]').length,1);d.body.append(d.createElement('span'));await new Promise(r=>w.setTimeout(r,0));assert.equal(d.querySelectorAll('[aria-label="About Reel title"]').length,1);close()});
test('production bundle order preserves original presets and reel launchers',async()=>{
 const dom=new JSDOM(fs.readFileSync(base+'index.html','utf8'),{runScripts:'outside-only',url:'http://localhost/app/'});const w=dom.window,d=w.document;try{
 w.matchMedia=()=>({matches:false,addEventListener(){}});w.HTMLElement.prototype.scrollIntoView=function(){};w.HTMLElement.prototype.getClientRects=function(){return [{}]};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.requestAnimationFrame=()=>0;w.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({clips:[],tracks:[],captionPresets:[],moods:[],transitions:[]})});
 w.__REFERENCE_FIXTURES__={me:{email:'preview@example.test',minutes:{remaining:120,monthly:300}},clips:[]};
 // One eval preserves the global lexical declarations shared by classic scripts.
 w.eval(['app.js','reel-integrated.js','studio-navigation.js','reel-layout-fix.js','music-picker.js','music-picker-submit.js','activity-heartbeat.js','help-bot.js','promo-access.js'].map(f=>fs.readFileSync(base+f,'utf8')).join('\n;\n'));
 await new Promise(r=>w.setTimeout(r,700));
 d.querySelectorAll('#track .tool')[4].click();const broll=[...d.querySelectorAll('#pills .pill')].find(p=>p.textContent==='AI B-roll');assert.equal(broll.getAttribute('aria-pressed'),'true');
 d.querySelector('[data-studio="reels"]').click();await new Promise(r=>w.setTimeout(r,700));assert.equal(d.querySelector('#reel-modal').classList.contains('on'),true);
 assert.ok(d.querySelector('#sm-open'));assert.equal(d.querySelectorAll('[aria-label="About Music preview and mix"]').length,1);
 d.querySelector('[aria-label="About Reel title"]').click();assert.equal(d.querySelector('#studio-guide').open,true);
 }finally{w.close();}
});
