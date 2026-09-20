/* Snipo complimentary access: no payment card, browser cannot grant plans. */
(function(){
  'use strict';
  if (document.querySelector('#snipo-promo-open')) return;
  const nav = document.querySelector('.nav-r');
  if (!nav) return;
  const style = document.createElement('style');
  style.textContent = `
  #snipo-promo-open{border:1px solid rgba(168,85,247,.65);background:rgba(168,85,247,.12);color:#f7e9ff;border-radius:12px;padding:10px 13px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap}#snipo-promo-open:hover{background:rgba(168,85,247,.25)}
  .sp-overlay{position:fixed;inset:0;z-index:11000;background:rgba(5,3,13,.83);display:none;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(9px)}.sp-overlay.open{display:flex}.sp-dialog{width:min(430px,100%);background:#170e2b;border:1px solid rgba(168,85,247,.48);color:#f6efff;border-radius:22px;padding:25px;box-shadow:0 20px 65px #000a;font-family:'Plus Jakarta Sans',sans-serif}.sp-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.sp-heading h2{font-size:22px;margin:0}.sp-close{background:transparent;color:#ddd;border:0;font-size:26px;cursor:pointer}.sp-dialog p{color:#bfb1d1;font-size:13px;line-height:1.6}.sp-dialog label{display:block;color:#d8cee8;font-size:12px;font-weight:700;margin:17px 0 7px}.sp-dialog input{width:100%;box-sizing:border-box;background:#0d081b;color:#fff;border:1px solid #5b4178;border-radius:10px;padding:13px;font:700 13px 'Plus Jakarta Sans',sans-serif;letter-spacing:.4px;text-transform:uppercase}.sp-dialog input:focus{outline:2px solid #a855f7}.sp-submit{margin-top:14px;width:100%;background:linear-gradient(90deg,#a855f7,#ec4899);border:0;border-radius:10px;color:white;padding:13px;cursor:pointer;font-weight:800}.sp-submit:disabled{opacity:.55;cursor:wait}.sp-status{min-height:20px;margin-top:11px;font-size:12px;line-height:1.5;white-space:pre-wrap}.sp-status.bad{color:#ff9caa}.sp-status.good{color:#85ecb5}.sp-note{font-size:11px!important;margin-bottom:0}
  `;
  document.head.appendChild(style);
  const open = document.createElement('button'); open.type='button'; open.id='snipo-promo-open'; open.textContent='🎁 Redeem code'; open.setAttribute('aria-haspopup','dialog');
  const upgrade = nav.querySelector('button[onclick*="pricing"]'); nav.insertBefore(open, upgrade || nav.lastElementChild);
  const overlay = document.createElement('div'); overlay.className='sp-overlay'; overlay.id='snipo-promo-dialog';
  overlay.innerHTML=`<div class="sp-dialog" role="dialog" aria-modal="true" aria-labelledby="sp-title"><div class="sp-heading"><h2 id="sp-title">Redeem your access code</h2><button class="sp-close" type="button" aria-label="Close">&times;</button></div><p>Have a complimentary Snipo code? Enter it to unlock the included plan for the code's duration. No card needed and no automatic renewal.</p><form id="sp-form"><label for="sp-code">ACCESS CODE</label><input id="sp-code" name="code" maxlength="64" autocomplete="off" spellcheck="false" required placeholder="SNIPO-XXXXXX-XXXXXX-XXXXXX"><button class="sp-submit" type="submit">Activate free access</button></form><div class="sp-status" id="sp-status" role="status" aria-live="polite"></div><p class="sp-note">Free-plan accounts only. Codes have limited uses and expire automatically. Your existing trial allowance is preserved.</p></div>`;
  document.body.appendChild(overlay);
  const form=overlay.querySelector('#sp-form'), input=overlay.querySelector('#sp-code'), status=overlay.querySelector('#sp-status'), submit=overlay.querySelector('.sp-submit');
  let lastFocus=null;
  function close(){ overlay.classList.remove('open'); (lastFocus||open).focus(); }
  open.addEventListener('click',()=>{lastFocus=document.activeElement;overlay.classList.add('open');status.textContent='';status.className='sp-status';input.focus();});
  overlay.querySelector('.sp-close').addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  overlay.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  form.addEventListener('submit',async e=>{
    e.preventDefault(); if(submit.disabled)return;
    submit.disabled=true; status.textContent='Checking code…';status.className='sp-status';
    try {
      if(typeof authToken!=='function')throw new Error('Please refresh the page and sign in again.');
      const token=await authToken(); if(!token)throw new Error('Please sign in to redeem a code.');
      const r=await fetch('/api/promo/redeem',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({code:input.value})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Could not redeem the code.');
      input.value='';status.className='sp-status good';
      status.textContent=`Access activated! ${String(d.plan||'').toUpperCase()} plan until ${new Date(d.expiresAt).toLocaleString()}. No charge or auto-renewal.`;
      if(typeof me==='function')await me();
    } catch(err){status.className='sp-status bad';status.textContent=err.message||'Please try again.';}
    finally{submit.disabled=false;}
  });
})();
