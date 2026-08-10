const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];

/* background squares */
(()=>{ if(matchMedia('(max-width:900px)').matches) return; const box=$('#sq');
  for(let i=0;i<56;i++){ const d=document.createElement('div'); d.className='sq';
    const w=18+Math.random()*86, h=w*(.55+Math.random()*.8), mag=Math.random()>.7;
    d.style.cssText=`width:${w}px;height:${h}px;left:${Math.random()*100}%;top:${Math.random()*88}%;
      background:${mag?'transparent':'rgba(168,85,247,.10)'};
      border:1px solid ${mag?'rgba(229,73,200,.30)':'rgba(168,85,247,.14)'};
      transform:rotate(${Math.random()*30-15}deg)`; box.appendChild(d);} })();

function toast(t,m,k='ok'){ const e=document.createElement('div'); e.className='toast '+k;
  e.innerHTML=`<div class="ic">${k==='ok'?'✓':'!'}</div><div><strong>${t}</strong>${m?`<p>${m}</p>`:''}</div><button aria-label="Dismiss">&times;</button>`;
  e.querySelector('button').onclick=()=>e.remove(); $('#toasts').appendChild(e); setTimeout(()=>e.remove(),7000); }
function human(raw,st){ const s=String(raw||'').toLowerCase();
  if(st===401||st===403) return ['Please sign in','Your session expired — sign in and try again.'];
  if(st===402||s.indexOf('limit')>-1||s.indexOf('plan')>-1) return ['Not enough quota',raw];
  if(st===429) return ['Server is busy','Too many videos at once. Try again in a minute.'];
  if(s.indexOf('not allowed')>-1||s.indexOf('valid video')>-1) return ["That link won't work",'Paste a public video URL.'];
  if(st>=500) return ["We couldn't process this video",'Something failed on our side — try again.'];
  return ["We couldn't process this video",raw||'Check the link and try again.']; }

/* tabs */
let mode='url', picked=null;
function setMode(m){ mode=m;
  $('#t-url').classList.toggle('on',m==='url'); $('#t-file').classList.toggle('on',m==='file');
  $('#t-url').setAttribute('aria-selected',m==='url'); $('#t-file').setAttribute('aria-selected',m==='file');
  $('#f-url').style.display=m==='url'?'':'none'; $('#drop').style.display=m==='file'?'':'none'; }
$('#t-url').onclick=()=>setMode('url'); $('#t-file').onclick=()=>setMode('file');

function setFile(f){ if(!f) return;
  if(!f.type.startsWith('video/')) return toast('Not a video file','Choose an MP4, MOV or WebM.','err');
  if(f.size>1073741824) return toast('File too large','Maximum upload size is 1GB.','err');
  picked=f; $('#drop-txt').textContent=f.name+' · '+(f.size/1048576).toFixed(1)+' MB'; setMode('file'); }
$('#drop').onclick=()=>$('#file').click();
$('#drop').onkeydown=e=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();$('#file').click();} };
$('#file').onchange=e=>setFile(e.target.files[0]);
['dragenter','dragover'].forEach(v=>$('#drop').addEventListener(v,e=>{e.preventDefault();$('#drop').classList.add('over')}));
['dragleave','drop'].forEach(v=>$('#drop').addEventListener(v,e=>{e.preventDefault();$('#drop').classList.remove('over')}));
$('#drop').addEventListener('drop',e=>setFile(e.dataTransfer.files[0]));
window.addEventListener('paste',e=>{ const f=[...(e.clipboardData?.files||[])][0]; if(f) return setFile(f);
  const t=e.clipboardData?.getData('text')||''; if(/^https?:\/\//.test(t)){setMode('url');$('#url').value=t.trim();} });

/* options — real backend fields only */
const T=[['karaoke','Karaoke',1],['hook','Hook title',1],['enhance','Enhance audio',0],['fillers','Clean up',0],
  ['broll','AI B-roll',0],['faceTrack','Face tracking',0],['highlight','Keyword pop',0],['emoji','Emojis',0],['progress','Progress bar',0]];
const st={}; T.forEach(([k,,o])=>st[k]=!!o);
T.forEach(([k,l])=>{ const b=document.createElement('button'); b.className='pill'; b.type='button';
  b.textContent=l; b.setAttribute('aria-pressed',st[k]);
  b.onclick=()=>{st[k]=!st[k];b.setAttribute('aria-pressed',st[k]);cnt()};
  $('#pills').appendChild(b); });
function cnt(){ $('#opt-count').textContent=Object.values(st).filter(Boolean).length+' on'; }
$('#opt-btn').onclick=()=>{const o=$('#panel').classList.toggle('open');$('#opt-btn').setAttribute('aria-expanded',o)};
cnt();

/* tools */
const TOOLS=[['M7 4v16M17 4v16M7 9h10M7 15h10','Long to shorts',['karaoke','hook'],1],
  ['M4 5h16v14H4zM8 10h8M8 14h5','AI Captions',['karaoke'],0],
  ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm10 16-4.2-4.2','Find moments',['karaoke','hook'],0],
  ['M12 3v11M8 8l4-5 4 5M5 16c0 3 3 5 7 5s7-2 7-5','Hinglish',['karaoke'],0,'NEW'],
  ['M3 6h18v12H3zm6 0v12','AI B-roll',['broll'],0],
  ['M6 10v4M10 6v12M14 8v8M18 11v2','Enhance audio',['enhance'],0]];
$$('.tool').forEach((b,i)=>{ const on=TOOLS[i]?TOOLS[i][2]:[];
  b.onclick=()=>{ $$('.tool').forEach(x=>x.setAttribute('aria-pressed','false')); b.setAttribute('aria-pressed','true');
    T.forEach(([k])=>st[k]=on.indexOf(k)>-1); $$('#pills .pill').forEach((p,n)=>p.setAttribute('aria-pressed',st[T[n][0]])); cnt(); }; });
$('#pv').onclick=()=>$('#track').scrollBy({left:-250,behavior:'smooth'});
$('#nx').onclick=()=>$('#track').scrollBy({left:250,behavior:'smooth'});

/* real data */
/* ===== REFERENCE PREVIEW MODE (development only) =====
   Active only when the dev fixture file loaded AND we're on a local host.
   Production never ships development/, so this stays inert. */
const LOCAL=location.protocol==='file:'||['localhost','127.0.0.1','[::1]'].indexOf(location.hostname)>-1;
const PREVIEW=!!(window.__REFERENCE_FIXTURES__ && LOCAL);
const FIX=PREVIEW?window.__REFERENCE_FIXTURES__:null;
if(PREVIEW) console.info('[snipoclip] reference preview mode — fixture data, not real account data');

async function api(path){
  for(let attempt=0; attempt<2; attempt++){
    const r=await fetch(path,{credentials:'include',headers:{accept:'application/json'}});
    const ct=r.headers.get('content-type')||'';
    if(!ct.includes('json')){
      const body=(await r.text()).slice(0,120);
      throw new Error(`${path} returned ${r.status} ${ct||'no content-type'} — ${body}`);
    }
    const data=await r.json();
    if(r.ok) return data;
    if(r.status>=500 && attempt===0){ await new Promise(r=>setTimeout(r,700)); continue; }
    throw Object.assign(new Error(data.error||`${path} failed (${r.status})`),{status:r.status});
  }
}

async function me(){ try{
  if(PREVIEW){ applyMe(FIX.me); if(FIX.forceLowCredits)
    toast("You're low on Credits!",'Top up to keep exporting clips.','err'); return; }
  applyMe(await api('/api/me'));
}catch(e){ console.error('[snipoclip] /api/me failed:',e); $('#mins').textContent='—'; } }

function applyMe(m){
  const q=m.minutes||{};
  $('#mins').textContent=(typeof q.remaining==='number')?q.remaining.toLocaleString():'—';
  $('#av').textContent=(m.email||'?')[0].toUpperCase(); $('#av').title=m.email||'';
  if(!PREVIEW && typeof q.remaining==='number' && typeof q.monthly==='number' && q.remaining<=q.monthly*0.25)
    toast("You're low on minutes", q.remaining+' of '+q.monthly+' video-minutes left this month.','err');
}

let clips=[];
async function load(){ try{
  if(PREVIEW){ clips=FIX.clips; draw(); return; }
  clips=(await api('/api/clips')).clips||[]; draw();
}catch(e){
  console.error('[snipoclip] /api/clips failed:',e);
  const offline=location.protocol==='file:';
  $('#grid').innerHTML=`<div class="empty">
    <p>${offline?'No backend on this page':"Couldn't load your clips"}</p>
    <small>${offline?'Open the app from your server so /api/clips can respond.':'Refresh to try again.'}</small></div>`;
} }
function skeletons(){ $('#grid').innerHTML='<div class="skel"></div>'.repeat(4); }
function draw(){ const q=$('#q').value.trim().toLowerCase();
  const list=q?clips.filter(c=>(c.title||'').toLowerCase().indexOf(q)>-1):clips;
  if(!list.length){ $('#grid').innerHTML=`<div class="empty">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>
    <p>${q?'No clips match that search':'No projects yet'}</p>
    <small>${q?'Try another word.':'Paste a video link above to make your first clip.'}</small></div>`; return; }
  $('#grid').innerHTML=list.map(card).join('');
  $$('.card').forEach(k=>{const v=k.querySelector('video');
    k.onmouseenter=()=>v.play().catch(()=>{}); k.onmouseleave=()=>{v.pause();v.currentTime=0}; }); }
function card(c){
  const secs=(c.end_sec!=null&&c.start_sec!=null)?Math.round(c.end_sec-c.start_sec):null;
  const dur=secs!=null?`${Math.floor(secs/60)}:${String(secs%60).padStart(2,'0')}`:'';
  if(c.state==='placeholder') return `<article class="card ghost"><div class="th">
    <svg class="ph" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></div>
    <div class="in"><div class="t">&nbsp;</div><div class="m"><span>&nbsp;</span></div></div></article>`;
  if(c.state==='uploading') return `<article class="card ghost" data-id="${c.id}"><div class="th">
    <svg class="ph" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">
    <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
    <span class="upbar"><i style="width:${c.progress||0}%"></i></span><span class="menu">&#8942;</span></div>
    <div class="in"><div class="t">${(c.title||'New Project').replace(/</g,'&lt;')}</div>
    <div class="m"><span class="st">Uploading…</span></div></div></article>`;
  if(c.state==='rendering') return `<article class="card ghost"><div class="th"><span class="spin"></span></div>
    <div class="in"><div class="t">${(c.title||'Rendering').replace(/</g,'&lt;')}</div>
    <div class="m"><span>Generating clips…</span></div></div></article>`;
  const media = c.thumbnail ? `<img src="${c.thumbnail}" alt="">`
              : c.url ? `<video src="${c.url}" preload="metadata" muted playsinline></video>` : '';
  return `<article class="card" data-id="${c.id||''}"><div class="th">${media}
    ${c.position?`<span class="pos"><i></i>${c.position}</span>`:''}
    ${dur?`<span class="dur">${dur}</span>`:''}
    ${c.position?'<span class="scrub"><i style="width:34%"></i></span>':''}<span class="menu">&#8942;</span></div>
    <div class="in"><div class="t">${(c.title||'Untitled').replace(/</g,'&lt;')}</div>
    <div class="m"><span>${c.created_at?new Date(c.created_at).toLocaleDateString():''}</span>
    ${c.url?`<a href="${c.url}" download onclick="event.stopPropagation()">Download</a>`:''}</div></div></article>`;
}
$('#q').oninput=draw;

/* processing — real stages only */
const S=[['queued','Video imported'],['download','Media downloaded'],['transcribe','Transcript generated'],
  ['highlights','Finding viral moments'],['rendering','Generating clips'],['done','Clips ready']];
function steps(stage){ const i=Math.max(0,S.findIndex(x=>x[0]===stage));
  $('#proc-b').style.width=Math.round(i/(S.length-1)*100)+'%';
  $('#proc-n').textContent=S[i]?S[i][1]+'…':'Working…';
  $('#proc-s').innerHTML=S.map(([,l],n)=>`<div class="step ${n<i?'done':n===i?'cur':''}"><span class="d">${n<i?'✓':''}</span>${l}</div>`).join(''); }

let poll=null;
$('#go').onclick=async()=>{
  const u=$('#url').value.trim();
  if(!picked&&!u) return toast('Nothing to clip yet','Paste a video link or choose a file first.','err');
  const fd=new FormData();
  if(picked) fd.append('video',picked); else fd.append('videoUrl',u);
  fd.append('ratio',$('#ratio').value); fd.append('duration',$('#duration').value);
  fd.append('captionStyle',$('#captionStyle').value);
  if($('#count').value) fd.append('count',$('#count').value);
  if($('#language').value!=='auto') fd.append('language',$('#language').value);
  Object.entries(st).forEach(([k,v])=>fd.append(k,v?'1':'0'));
  const g=$('#go'); g.disabled=true; g.textContent=picked?'Uploading…':'Starting…';
  $('#proc').classList.add('on'); steps('queued');
  try{ const r=await fetch('/api/jobs',{method:'POST',body:fd,credentials:'include'});
    const d=await r.json().catch(()=>({}));
    if(!r.ok){ const [t,m]=human(d.error,r.status); throw Object.assign(new Error(m),{t}); }
    g.textContent='Processing…'; toast('Processing started',"We'll show your clips here when they're ready."); watch(d.jobId);
  }catch(e){ toast(e.t||"We couldn't process this video",e.message,'err'); console.error('[jobs]',e);
    $('#proc').classList.remove('on'); reset(); } };
function watch(id){ clearInterval(poll); let n=0;
  poll=setInterval(async()=>{ try{
    const r=await fetch('/api/jobs/'+id,{credentials:'include'}); const d=await r.json(); const j=d.job||{};
    steps(j.stage||'queued');
    if(j.status==='done'||(d.clips&&d.clips.length)){ clearInterval(poll); steps('done');
      $('#proc-t').textContent=(d.clips?.length||0)+' clips ready';
      toast('Clips ready','Scroll down to watch and download them.'); reset(); load(); me(); }
    else if(j.status==='error'){ clearInterval(poll); const [t,m]=human(j.error,500);
      toast(t,m,'err'); console.error('[job]',j.error); $('#proc').classList.remove('on'); reset(); }
    else if(++n>96){ clearInterval(poll);
      toast('Still rendering','Taking longer than expected — the render may have run out of memory. Check your server logs.','err'); reset(); }
  }catch(e){} },5000); }
function reset(){ const g=$('#go'); g.disabled=false; g.textContent='Get clips in 1 click'; }

$('#hero-x').onclick=()=>$('.hero').style.display='none';
$('#out').onclick=async()=>{ try{await fetch('/api/logout',{method:'POST',credentials:'include'})}catch(e){} location.href='/login'; };
$('#help').onclick=()=>toast('Help','Use the in-app assistant or the Report a bug link.');

/* ================= REFERENCE DEMO TIMELINE (development only) =================
   One orchestrated timeline. Never runs in production: requires the dev fixture,
   a local host, demo:true, and a desktop viewport. */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEMO = PREVIEW && FIX.demo && innerWidth>=1100 && !REDUCED;

const CAM_LIMITS = { minScale:0.94, maxScale:1.26, maxRot:2 };

const lerp=(a,b,t)=>a+(b-a)*t;
const easeInOut=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const easeOut=t=>1-Math.pow(1-t,3);
const clamp01=t=>t<0?0:t>1?1:t;
const phaseProgress=(t,s,e)=>clamp01((t-s)/(e-s));
function track(keys,t,ease=easeInOut){
  if(t<=keys[0].t) return keys[0];
  if(t>=keys[keys.length-1].t) return keys[keys.length-1];
  for(let i=0;i<keys.length-1;i++){
    const k=keys[i],n=keys[i+1];
    if(t>=k.t&&t<=n.t){ const p=ease(phaseProgress(t,k.t,n.t)); const o={};
      for(const key in k) if(key!=='t'&&typeof k[key]==='number') o[key]=lerp(k[key],n[key],p);
      return o; }
  }
}

/* One master timeline. Every property below is interpolated from `elapsed`. */
const timeline = {
  camera:[
    {t:0.00, y:0,    s:1.000, ry:0},
    {t:0.35, y:6,    s:0.978, ry:-1.4},
    {t:1.00, y:8,    s:0.962, ry:-2.0},
    {t:1.90, y:0,    s:1.000, ry:0},
    {t:2.50, y:-4,   s:1.014, ry:0},
    {t:3.90, y:-8,   s:1.032, ry:0},
    {t:5.50, y:-10,  s:1.042, ry:0},
    {t:6.30, y:-26,  s:1.052, ry:0},
    {t:7.00, y:-72,  s:1.074, ry:0},
    {t:7.90, y:-166, s:1.128, ry:0},
    {t:8.60, y:-232, s:1.186, ry:0},
    {t:9.20, y:-250, s:1.212, ry:0},
    {t:10.0, y:-252, s:1.216, ry:0}
  ],
  cursor:[
    {t:0.00, a:'toolFar'}, {t:1.30, a:'tool'}, {t:2.30, a:'tool'},
    {t:2.90, a:'input'},   {t:5.40, a:'input'}, {t:5.90, a:'cta'},
    {t:6.90, a:'cta'},     {t:7.60, a:'grid'},  {t:8.55, a:'card1'}, {t:10.0, a:'card1'}
  ],
  typing:{ start:3.90, end:5.50 },
  ctaGlow:{ start:5.30, end:5.95 },
  toolSwap:{ at:6.35, from:3, to:2 },
  progress:{ start:2.00, end:9.20 },
  playback:{ c2:{base:7, rate:1}, c3:{base:38, rate:1}, scrubBase:34, scrubRate:1.9 },
  hoverAt:8.70,
  doneAt:9.20
};

function clampCam(c){ const L=CAM_LIMITS;
  return { y:c.y, s:Math.min(L.maxScale,Math.max(L.minScale,c.s)),
           ry:Math.max(-L.maxRot,Math.min(L.maxRot,c.ry||0)) }; }

function runReferenceDemo(){
  const cam=$('#cam'), url=$('#url'), go=$('#go'), grid=$('#grid');
  const text=FIX.demoUrl;
  document.body.classList.add('demo');
  const cur=document.createElement('div'); cur.id='cursor';
  cur.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 2l7 18 2.5-7.5L21 10z" fill="#fff" stroke="#1a1030" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cur); cur.classList.add('on');

  const at=name=>{
    const pick={ tool:$$('.tool')[3], toolFar:$$('.tool')[5], input:url, cta:go,
                 grid:$('#projects'), card1:grid.children[0] }[name] || grid;
    const b=pick.getBoundingClientRect();
    return { x:b.left+b.width*(name==='input'?0.22:0.4), y:b.top+b.height*0.6 };
  };
  const cursorPts=()=>timeline.cursor.map(k=>({t:k.t, ...at(k.a)}));

  let pts=cursorPts(), toolNow=3, hoverOn=false, doneOn=false, focused=false;
  addEventListener('resize',()=>{pts=cursorPts();});

  const tools=$$('.tool'), hero=$('.hero'), toolsRow=$('.tools');
  const ON={bg:'rgba(229,73,200,.11)',bd:'rgba(229,73,200,1)',gl:22,ic:'#F472B6',tx:'#F5F2FF'};
  const OFF={bg:'rgba(28,18,48,.62)',bd:'rgba(255,255,255,.075)',gl:0,ic:'#A855F7',tx:'#A99FC4'};
  const mix=(a,b,t)=>a.map?a:0;
  function paintTool(el,a){
    el.style.background = a>0 ? `rgba(229,73,200,${(0.11*a).toFixed(3)})` : OFF.bg;
    el.style.borderColor = `rgba(229,73,200,${(a).toFixed(3)})`;
    el.style.boxShadow = a>0 ? `inset 0 1px 0 rgba(255,255,255,${(0.07*a).toFixed(3)}), 0 0 ${(22*a).toFixed(1)}px rgba(229,73,200,${(0.30*a).toFixed(3)})` : 'none';
    const svg=el.querySelector('svg'), b=el.querySelector('b');
    if(svg) svg.style.color = a>0.5?ON.ic:OFF.ic;
    if(b) b.style.color = a>0.5?ON.tx:OFF.tx;
    el.setAttribute('aria-pressed', a>0.5);
  }
  const SWAP={from:3,to:2,start:6.35,end:6.65};
  const HOVER={approach:8.45,reach:8.60,react:8.65,full:8.70};
  const start=performance.now();
  function frame(now){
    const t=(now-start)/1000;
    const T=Math.min(t,10);

    const c=clampCam(track(timeline.camera,T));
    cam.style.transform=`translate3d(0,${c.y.toFixed(2)}px,0) rotateY(${c.ry.toFixed(3)}deg) scale(${c.s.toFixed(4)})`;

    const cp=track(pts,T,easeOut);
    cur.style.transform=`translate(${cp.x.toFixed(1)}px,${cp.y.toFixed(1)}px)`;

    if(!focused && T>=2.85){ url.focus(); focused=true; }
    const ty=timeline.typing;
    if(T>=ty.start){ const k=Math.round(easeOut(phaseProgress(T,ty.start,ty.end))*text.length);
      if(url.value.length!==k) url.value=text.slice(0,k); }

    const g=phaseProgress(T,timeline.ctaGlow.start,timeline.ctaGlow.end);
    go.style.filter=`brightness(${(1+0.16*easeInOut(g)).toFixed(3)})`;
    go.style.boxShadow=`0 0 0 1px rgba(229,73,200,${(0.3+0.35*g).toFixed(2)}), 0 ${(3+5*g).toFixed(1)}px ${(18+22*g).toFixed(0)}px var(--glow-m)`;

    const sw=easeInOut(phaseProgress(T,SWAP.start,SWAP.end));
    tools.forEach((b,i)=>{
      const a = i===SWAP.from ? 1-sw : i===SWAP.to ? sw : 0;
      paintTool(b,a);
    });
    hero.style.opacity=(1-0.45*easeInOut(phaseProgress(T,7.0,8.0))).toFixed(3);
    toolsRow.style.opacity=(1-0.28*easeInOut(phaseProgress(T,7.4,8.2))).toFixed(3);

    const card1=grid.children[0];
    if(card1){
      const bar=card1.querySelector('.upbar i');
      if(bar) bar.style.width=(easeOut(phaseProgress(T,timeline.progress.start,timeline.progress.end))*100).toFixed(2)+'%';
      const on = T>=HOVER.react;
      if(on!==hoverOn){ hoverOn=on; card1.classList.toggle('hovered',on); }
      const menu=card1.querySelector('.menu');
      if(menu) menu.style.opacity=easeOut(phaseProgress(T,HOVER.react,HOVER.full+0.15)).toFixed(3);
      if(!doneOn && T>=timeline.doneAt){ doneOn=true;
        const st=card1.querySelector('.st'); if(st) st.textContent='Ready to download'; }
    }
    const pb=timeline.playback;
    $$('.card .pos').forEach((el,i)=>{
      const base=i===0?pb.c2.base:pb.c3.base, sec=base+T;
      el.lastChild.textContent=(i===0?'0:':'00:')+String(Math.floor(sec)).padStart(2,'0')+(i===0?' / 1:18':'');
      const sc=el.parentElement.querySelector('.scrub i');
      if(sc) sc.style.width=(pb.scrubBase+T*pb.scrubRate).toFixed(2)+'%';
    });
    const hint=$('#hint');
    if(hint){ const on=T>=2.0&&T<2.6; hint.textContent=on?'Generate automated captions':hint.textContent;
      hint.classList.toggle('on',on); }

    if(t<10.6) requestAnimationFrame(frame); else cur.classList.remove('on');
  }
  requestAnimationFrame(frame);
}

me(); load();
if(DEMO) setTimeout(runReferenceDemo, 600);
