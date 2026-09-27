const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('retention preserves database rows if storage deletion fails',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'../lib/cleanup.js'),'utf8');
  let deleted=0, audited;
  const admin={
    from:table=>table==='retention_runs'?{insert:async data=>{audited=data;return {error:null};}}:{
      select:()=>({lt:()=>({order:()=>({limit:async()=>({data:[{id:'clip-1',storage_path:'old.mp4',master_path:'master.mp4'}],error:null})})})}),
      delete:()=>{deleted++;return {in:async()=>({error:null})};}
    },
    storage:{from:()=>({remove:async()=>({error:new Error('Storage unavailable')})})},
    rpc:async()=>({error:null})
  };
  const ctx={require:id=>id==='./supabase'?{admin}:require(id),process:{env:{}},module:{exports:{}},console:{log:()=>{},error:()=>{}},Date,setTimeout,setInterval};
  vm.runInNewContext(code+'\nglobalThis.cleanup=runCleanup;',ctx);
  const result=await ctx.cleanup();
  assert.equal(result.status,'error');
  assert.equal(deleted,0,'the clip row must remain for the next cleanup attempt');
  assert.equal(audited.status,'error');
});

test('visitor tracking only counts public HTML pages and never the admin dashboard',()=>{
  const code=fs.readFileSync(path.join(__dirname,'../lib/visits.js'),'utf8');
  const ctx={require:id=>id==='./supabase'?{admin:null}:require(id),process:{env:{}},module:{exports:{}},console};
  vm.runInNewContext(code,ctx);
  const tracked=ctx.module.exports.trackedPath;
  assert.equal(tracked('/app'),'/app');
  assert.equal(tracked('/blog/example-post'),'/blog/example-post');
  assert.equal(tracked('/admin'),null);
  assert.equal(tracked('/api/jobs'),null);
});

test('retention removes rendered and editable files before their rows',async()=>{
  const code=fs.readFileSync(path.join(__dirname,'../lib/cleanup.js'),'utf8');
  const order=[];
  let remaining=[{id:'old-clip',storage_path:'clip.mp4',master_path:'master.mp4'}];
  const admin={
    from:()=>({
      select:()=>({lt:()=>({order:()=>({limit:async()=>({data:remaining,error:null})})})}),
      delete:()=>({in:async()=>{order.push('rows');remaining=[];return {error:null};}})
    }),
    storage:{from:()=>({remove:async paths=>{order.push(paths.join(','));return {error:null};}})}
  };
  const ctx={require:id=>id==='./supabase'?{admin}:require(id),process:{env:{}},module:{exports:{}},console,Date,setTimeout,setInterval};
  vm.runInNewContext(code,ctx);
  assert.equal(await ctx.module.exports.removeMedia('clips','clips',['storage_path','master_path'],'2026-01-01'),1);
  assert.deepEqual(order,['clip.mp4,master.mp4','rows']);
});
