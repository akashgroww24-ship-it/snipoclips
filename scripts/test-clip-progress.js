const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/app/app.js'),'utf8');
const start=source.indexOf('let activeJobId=null;');
const end=source.indexOf('async function resumeJob()',start);
assert.ok(start>=0&&end>start,'job polling exists');

test('first completed clip appears while the remaining clips keep rendering',async()=>{
  const responses=[
    {job:{status:'processing',stage:'rendering'},clips:[{id:'first'}]},
    {job:{status:'done',stage:'done'},clips:[{id:'first'},{id:'second'}]}
  ];
  let nextTick,loads=0,resets=0;
  const elements={ '#proc':{classList:{add:()=>{}}}, '#proc-t':{textContent:''}, '#proc-n':{textContent:''} };
  const ctx={
    poll:null,
    $:selector=>elements[selector],clearTimeout:()=>{},setTimeout:fn=>{nextTick=fn;return 1;},
    fetch:async(_url,opts)=>{assert.equal(opts.cache,'no-store');return {ok:true,status:200,json:async()=>responses.shift()};},
    authToken:async()=> 'test-token',steps:()=>{},load:()=>{loads++;},me:()=>{},reset:()=>{resets++;},
    toast:()=>{},console,sessionStorage:{removeItem:()=>{}},redirectToLogin:()=>{}
  };
  vm.runInNewContext(source.slice(start,end),ctx);
  vm.runInNewContext("watch('job-1')",ctx);
  await new Promise(setImmediate);
  assert.equal(loads,1);
  assert.equal(resets,0,'first clip must not finish the job');
  assert.match(elements['#proc-t'].textContent,/more rendering/);
  assert.equal(typeof nextTick,'function');
  await nextTick();
  assert.equal(resets,1);
  assert.equal(elements['#proc-t'].textContent,'2 clips ready');
});
