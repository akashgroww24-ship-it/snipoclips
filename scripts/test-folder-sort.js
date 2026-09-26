const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'../public/app/app.js'),'utf8');
const start=source.indexOf('let clips=[];');
const end=source.indexOf('/* processing — real stages only */',start);
assert.ok(start>=0&&end>start,'folder view exists');

test('newest/oldest button reverses folders and clips',()=>{
  const nodes={};
  const $=key=>nodes[key]||(nodes[key]={value:'',innerHTML:'',textContent:'',setAttribute:()=>{}});
  const localStorage={saved:'',getItem(){return this.saved;},setItem(_key,value){this.saved=value;}};
  const ctx={ $, $$:()=>[], location:{hash:''},localStorage,console,PREVIEW:false };
  vm.runInNewContext(source.slice(start,end),ctx);
  vm.runInNewContext(`clips=[
    {id:'1',job_id:'old',title:'Old clip',created_at:'2026-09-01T00:00:00Z',folder_name:'Older folder'},
    {id:'2',job_id:'new',title:'New clip',created_at:'2026-09-25T00:00:00Z',folder_name:'Newer folder'}
  ]; draw();`,ctx);
  assert.ok($('#grid').innerHTML.indexOf('Newer folder')<$('#grid').innerHTML.indexOf('Older folder'));
  $('#sort').onclick();
  assert.ok($('#grid').innerHTML.indexOf('Older folder')<$('#grid').innerHTML.indexOf('Newer folder'));
  assert.equal($('#sort').textContent,'Oldest first');
  assert.equal(localStorage.saved,'oldest');
});
