(()=>{
 'use strict';
 if(document.getElementById('snipo-lead'))return;
 const path=location.pathname,key='sc_lead_subscribed',snooze='sc_lead_snooze_until';
 if(path.startsWith('/admin')||path.startsWith('/dashboard'))return;
 try{if(localStorage.getItem(key)==='1'||Number(localStorage.getItem(snooze))>Date.now())return;}catch{}
 const root=document.createElement('aside');root.id='snipo-lead';root.hidden=true;root.setAttribute('aria-label','Snipo email sign-up');
 root.innerHTML='<button type="button" class="lead-close" aria-label="Close email sign-up">×</button><span class="lead-kicker">THE SNIPO CREATOR LIST</span><h2>Keep your next idea close.</h2><p>Sign up for Snipo Clips creator tips and product updates.</p><form><label class="lead-label" for="snipo-lead-email">Email address</label><input id="snipo-lead-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required><label class="lead-trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><label class="lead-consent"><input name="consent" type="checkbox" required><span>I agree to receive Snipo creator tips and product updates by email. <a href="/#/privacy">Privacy policy</a></span></label><button class="lead-submit" type="submit">Join the creator list ↗</button><p class="lead-status" role="status" aria-live="polite"></p></form><small>You can withdraw consent at support@snipoclip.com.</small>';
 document.body.append(root);let timer,closed=false,saving=false;
 const form=root.querySelector('form'),status=root.querySelector('.lead-status'),submit=root.querySelector('.lead-submit');
 function hide(subscribed=false){closed=true;clearTimeout(timer);root.remove();document.removeEventListener('keydown',escape);window.removeEventListener('storage',sync);try{if(subscribed)localStorage.setItem(key,'1');else localStorage.setItem(snooze,String(Date.now()+7*86400000));}catch{}}
 function escape(e){if(e.key==='Escape'&&!saving&&!root.hidden)hide();}
 root.querySelector('.lead-close').addEventListener('click',()=>hide());
 function busy(){return document.hidden||document.querySelector('dialog[open]')||document.fullscreenElement||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||document.querySelector('#proc.on')||[...document.querySelectorAll('video')].some(v=>!v.paused&&!v.ended)||(()=>{const p=document.getElementById('snipo-promo');return p&&!p.hidden;})();}
 function show(){if(closed)return;if(busy()){timer=setTimeout(show,3000);return;}root.hidden=false;}
 form.addEventListener('submit',async e=>{e.preventDefault();if(saving||!form.reportValidity())return;saving=true;submit.disabled=true;status.textContent='Saving your email…';try{
  const r=await fetch('/api/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value,consent:form.elements.consent.checked,website:form.elements.website.value,source:path})});
  const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Could not save your email. Please retry.');
  try{localStorage.setItem(key,'1');}catch{}form.replaceChildren();const success=document.createElement('p');success.className='lead-success';success.setAttribute('role','status');success.textContent='You’re on the list. Your email preference has been saved.';form.append(success);root.querySelector('h2').textContent='Thanks for joining Snipo.';
 }catch(e){status.textContent=e.message||'Connection failed. Please try again.';}finally{saving=false;submit.disabled=false;}});
 function sync(e){if(e.key===key&&e.newValue==='1'||e.key===snooze&&Number(e.newValue)>Date.now()){closed=true;clearTimeout(timer);root.remove();}}
 window.addEventListener('storage',sync);document.addEventListener('keydown',escape);timer=setTimeout(show,35000);
})();
