'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
process.env.JWT_SECRET='synthetic-leads-test-secret';
const {createRouter}=require('../routes/leads');
test('lead capture validates consent, deduplicates, fails safely and protects admin data',async()=>{
 const records=new Map();let fail=false;
 const db={from:()=>({upsert:async(row)=>{if(fail)return {error:{message:'storage down'}};if(!records.has(row.email))records.set(row.email,row);return {error:null};}})};
 const app=express();app.set('trust proxy',1);app.use(express.json());app.use('/api',createRouter({db,adminGuard:(req,res)=>res.status(401).json({error:'Not signed in'})}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const post=b=>fetch(base+'/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 try{
  assert.equal((await post({email:'bad',consent:true})).status,400);
  assert.equal((await post({email:'person@example.com',consent:false})).status,400);
  assert.equal((await post({email:' PERSON@example.com ',consent:true,source:'/blog/'})).status,200);
  assert.equal((await post({email:'person@example.com',consent:true,source:'/pricing'})).status,200);
  assert.equal(records.size,1);assert.equal(records.get('person@example.com').source_path,'/blog/');assert.match(records.get('person@example.com').consent_text,/withdraw consent/);
  assert.equal((await fetch(base+'/api/admin/leads')).status,401);
  fail=true;assert.equal((await post({email:'another@example.com',consent:true})).status,503);
  assert.equal((await post({email:'bot@example.com',consent:true,website:'bot'})).status,200);assert.equal(records.size,1);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
