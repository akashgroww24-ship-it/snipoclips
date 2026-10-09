(()=>{'use strict';let source='link';const $=id=>document.getElementById(id);document.querySelectorAll('[data-source]').forEach(b=>b.onclick=()=>{source=b.dataset.source;document.querySelectorAll('[data-source]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});$('link-label').hidden=$('funnel-url').hidden=source==='upload';$('funnel-url').disabled=source==='upload';$('upload-note').hidden=source!=='upload';$('funnel-error').textContent='';});$('funnel-form').onsubmit=e=>{e.preventDefault();const value=source==='link'?$('funnel-url').value.trim():'';let url='';if(value){try{const u=new URL(value);const host=u.hostname.toLowerCase();if(u.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host)||u.username||u.password)throw new Error();url=u.href;}catch{$('funnel-error').textContent='Enter a valid HTTPS YouTube URL, or leave the link empty and add your video inside the app.';return;}}try{localStorage.setItem('sc_funnel_start',JSON.stringify({source,url,goal:$('funnel-goal').value,createdAt:Date.now()}));}catch{}location.assign('/login?next=%2Fapp%3Fonboard%3D1');};})();

(()=>{const ids=['terms','privacy','refund','cookies'];function route(){const key=location.hash.replace(/^#\/?/,'');const legal=ids.includes(key)&&!!document.getElementById(key);const main=document.querySelector('main');if(main)main.hidden=legal;ids.forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=!(legal&&id===key);});if(legal)scrollTo(0,0);if(key==='app')location.assign('/app');}addEventListener('hashchange',route);route();})();

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
