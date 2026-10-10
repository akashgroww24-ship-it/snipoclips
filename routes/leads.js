'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { admin } = require('../lib/supabase');
const { requireAdmin } = require('../lib/auth');
const CONSENT_VERSION = 'snipo-email-updates-v1';
const CONSENT_TEXT = 'I agree to receive Snipo Clips creator tips and product updates by email. I can withdraw consent by contacting support@snipoclip.com.';
function createRouter({db=admin,adminGuard=requireAdmin}={}) {
  const router=express.Router();
  router.post('/leads',rateLimit({windowMs:3600000,max:8,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests. Please try later.'}}),async(req,res)=>{
    res.set('Cache-Control','no-store');
    const origin=req.get('origin');
    if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Submit this form from Snipo Clips.'});}catch{return res.status(403).json({error:'Invalid origin.'});}}
    const b=req.body||{};
    if(b.website)return res.json({ok:true});
    const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
    if(email.length>254||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(email))return res.status(400).json({error:'Enter a valid email address.'});
    if(b.consent!==true)return res.status(400).json({error:'Please agree to receive Snipo email updates.'});
    const source=typeof b.source==='string'&&/^\/[a-zA-Z0-9/_ .-]*$/.test(b.source)?b.source.slice(0,200):'/';
    if(!db)return res.status(503).json({error:'Email sign-up is temporarily unavailable. Please try later.'});
    try{
      const {error}=await db.from('marketing_leads').upsert({email,source_path:source,consent_version:CONSENT_VERSION,consent_text:CONSENT_TEXT},{onConflict:'email',ignoreDuplicates:true});
      if(error)throw error;
      return res.json({ok:true});
    }catch{console.error('[leads] Could not save email sign-up');return res.status(503).json({error:'We could not save your email. Please try again.'});}
  });
  router.get('/admin/leads',adminGuard,async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!db)return res.status(503).json({error:'Lead storage unavailable.'});
    const page=Math.max(0,Math.min(100000,parseInt(req.query.page,10)||0));
    try{
      const {data,error,count}=await db.from('marketing_leads').select('id,email,source_path,consent_text,consent_version,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(page*100,page*100+99);
      if(error)throw error;
      res.json({leads:data||[],total:count||0,page});
    }catch{res.status(503).json({error:'Could not load leads.'});}
  });
  router.delete('/admin/leads/:id',adminGuard,async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id))return res.status(400).json({error:'Invalid lead ID.'});
    if(!db)return res.status(503).json({error:'Lead storage unavailable.'});
    try{const {error}=await db.from('marketing_leads').delete().eq('id',req.params.id);if(error)throw error;res.json({ok:true});}catch{res.status(503).json({error:'Could not delete lead.'});}
  });
  return router;
}
module.exports=createRouter();
module.exports.createRouter=createRouter;
