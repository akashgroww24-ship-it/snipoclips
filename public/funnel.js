(()=>{'use strict';const $=id=>document.getElementById(id);const form=$('funnel-form');if(!form)return;let step=0,source='link';const panels=Array.from(document.querySelectorAll('[data-step]'));const markers=Array.from(document.querySelectorAll('[data-step-marker]'));function show(n){step=n;panels.forEach((p,i)=>p.hidden=i!==n);markers.forEach((m,i)=>{m.classList.toggle('active',i===n);if(i===n)m.setAttribute('aria-current','step');else m.removeAttribute('aria-current');});$('funnel-back').hidden=n===0;$('funnel-next').textContent=n===2?'Continue to your workspace ↗':'Next step →';$('funnel-error').textContent='';panels[n].querySelector('h2').focus();}function sourceURL(){const value=source==='link'?$('funnel-url').value.trim():'';if(!value)return '';const u=new URL(value);if(u.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname.toLowerCase())||u.username||u.password)throw new Error();return u.href;}document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;document.querySelectorAll('[data-source]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});$('link-field').hidden=source==='upload';$('funnel-url').disabled=source==='upload';$('upload-note').hidden=source!=='upload';$('funnel-error').textContent='';});$('funnel-back').onclick=()=>show(step-1);form.onsubmit=e=>{e.preventDefault();let url;try{url=sourceURL();}catch{$('funnel-error').textContent='Enter a valid HTTPS YouTube URL, or leave it empty to add a source in the app.';return;}if(step<2){if(step===1){$('review-source').textContent=source==='upload'?'Upload a file inside the app':url||'Add a YouTube link inside the app';$('review-settings').textContent=$('funnel-duration').selectedOptions[0].textContent+' · '+$('funnel-count').selectedOptions[0].textContent+' · '+$('funnel-language').selectedOptions[0].textContent;}show(step+1);return;}try{localStorage.setItem('sc_funnel_start',JSON.stringify({source,url,goal:$('funnel-goal').value,duration:$('funnel-duration').value,count:$('funnel-count').value,language:$('funnel-language').value,createdAt:Date.now()}));}catch{$('funnel-error').textContent='Your browser could not save your choices. Enable site storage, or use Sign in above and set up your reel in the app.';return;}location.assign('/login?next=%2Fapp%3Fonboard%3D1');};})();

// Decorative motion only; forms and navigation stay stationary.
(()=>{
  const preference=matchMedia('(prefers-reduced-motion: reduce)');
  const layers=[['.hero-art',.055,10],['.hero-art .r1',-.035,5],['.hero-art .r2',.025,-5],['.hero-art .portrait',-.018,3]].flatMap(([selector,speed,depth])=>Array.from(document.querySelectorAll(selector),el=>({el,speed,depth})));
  if(!layers.length)return;
  let frame=0,pointerX=0,pointerY=0,enabled=false;
  const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
  function paint(){
    frame=0;if(!enabled||document.hidden)return;
    const hero=document.querySelector('.hero');if(!hero||hero.closest('main')?.hidden)return;
    const offset=clamp(-hero.getBoundingClientRect().top,-150,1000);
    for(const {el,speed,depth} of layers){el.style.setProperty('--parallax-x',(pointerX*depth).toFixed(2)+'px');el.style.setProperty('--parallax-y',clamp(offset*speed+pointerY*depth,-40,60).toFixed(2)+'px');}
  }
  function schedule(){if(enabled&&!frame)frame=requestAnimationFrame(paint);}
  function pointer(event){if(!matchMedia('(hover: hover) and (pointer: fine)').matches)return;pointerX=clamp(event.clientX/innerWidth-.5,-.5,.5);pointerY=clamp(event.clientY/innerHeight-.5,-.5,.5);schedule();}
  function resetPointer(){pointerX=pointerY=0;schedule();}
  function configure(){
    enabled=!preference.matches;
    document.documentElement.classList.toggle('funnel-motion',enabled);
    if(!enabled){cancelAnimationFrame(frame);frame=0;for(const {el} of layers){el.style.removeProperty('--parallax-x');el.style.removeProperty('--parallax-y');}}
    else schedule();
  }
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});addEventListener('pointermove',pointer,{passive:true});document.addEventListener('pointerleave',resetPointer);document.addEventListener('visibilitychange',schedule);addEventListener('hashchange',schedule);
  preference.addEventListener('change',configure);configure();
})();
