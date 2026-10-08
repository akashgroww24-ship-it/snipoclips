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

test('admin operations API rejects unauthenticated users and validates drilldown IDs',async()=>{
 const express=require('express');let calls=0;
 const admin={rpc:async(name,args)=>{calls++;assert.equal(name,'admin_operations');assert.equal(args.p_days,30);return {data:{summary:{exportsDone:2,editedReels:1}},error:null}}};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../routes/admin-users.js'),'utf8'),{module:mod,console,require:id=>id==='../lib/auth'?{requireAdmin:(req,res,next)=>req.headers.authorization==='Bearer test-admin'?next():res.status(401).json({error:'Not signed in'})}:id==='../lib/supabase'?{admin}:require(id)});
 const app=express();app.use('/admin/api',mod.exports);const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{assert.equal((await fetch(base+'/admin/api/operations')).status,401);assert.equal(calls,0);let r=await fetch(base+'/admin/api/operations?days=500',{headers:{Authorization:'Bearer test-admin'}});assert.equal(r.status,200);assert.equal((await r.json()).summary.editedReels,1);r=await fetch(base+'/admin/api/users/not-a-uuid',{headers:{Authorization:'Bearer test-admin'}});assert.equal(r.status,400);}finally{await new Promise(r=>server.close(r));}
});
test('activity telemetry excludes heartbeat noise and tolerates recording failures',async()=>{
 const events=[];const admin={from:()=>({insert:async row=>{events.push(row);return {error:null}},upsert:async()=>({error:null})})};const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/activity.js'),'utf8'),{module:mod,console,Date,require:id=>id==='./supabase'?{admin}:require(id)});
 await mod.exports.logAction('alice',{method:'POST',originalUrl:'/api/activity/heartbeat'},200);assert.equal(events.length,0);
 await mod.exports.recordEvent('alice','studio_export_done',{clipId:'clip-1'});assert.equal(events[0].event_type,'studio_export_done');assert.equal(events[0].metadata.clipId,'clip-1');
 await mod.exports.logAction('alice',{method:'PUT',originalUrl:'/api/studio/clip-1/draft?token=secret'},200);assert.equal(events[1].path,'/api/studio/clip-1/draft');assert.ok(!events[1].action.includes('secret'));
});
