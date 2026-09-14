const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let sb=null, mode='auto', clips=[], selected=new Set(), poll=null;

async function supabaseClient(){
  if(sb) return sb;
  const r=await fetch('/api/public-config',{credentials:'include'}); const c=await r.json();
  if(!c.supabaseUrl||!c.supabaseAnonKey) throw new Error('Supabase is not configured');
  sb=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey); return sb;
}
async function token(){ const c=await supabaseClient(); const {data}=await c.auth.getSession(); return data&&data.session&&data.session.access_token; }
async function api(url,opts={}){
  const t=await token(); const h=Object.assign({accept:'application/json'},opts.headers||{}); if(t) h.Authorization='Bearer '+t;
  const r=await fetch(url,Object.assign({credentials:'include'},opts,{headers:h}));
  const j=await r.json().catch(()=>({})); if(!r.ok) throw Object.assign(new Error(j.error||'Request failed'),{status:r.status}); return j;
}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function updateCount(){ $('#selected').textContent=selected.size?`${selected.size} clip${selected.size===1?'':'s'} selected`:'AI can choose automatically'; }
function draw(){
  const usable=clips.filter(c=>!(c.edit&&c.edit.type==='reel'));
  if(!usable.length){$('#clips').innerHTML='<div class="empty">You need generated clips first. Go back and create clips, then return here.</div>';return;}
  $('#clips').innerHTML=usable.map(c=>`<article class="clip ${selected.has(String(c.id))?'on':''}" data-id="${esc(c.id)}">
    <span class="check">${selected.has(String(c.id))?'✓':''}</span>${c.url?`<video src="${esc(c.url)}" muted playsinline preload="metadata"></video>`:'<div style="aspect-ratio:9/16"></div>'}
    <div class="txt"><b>${esc(c.title||'Untitled clip')}</b><small>Score ${Math.round(Number(c.score||0))}</small></div></article>`).join('');
  $$('.clip').forEach(el=>{el.onclick=()=>{const id=el.dataset.id;selected.has(id)?selected.delete(id):selected.add(id);draw();updateCount();};const v=el.querySelector('video');if(v){el.onmouseenter=()=>v.play().catch(()=>{});el.onmouseleave=()=>{v.pause();v.currentTime=0};}});
}
async function load(){
  try{
    const [c,o]=await Promise.all([api('/api/clips'),api('/api/reels/options')]); clips=c.clips||[]; draw(); updateCount();
    (o.tracks||[]).forEach(x=>{const op=document.createElement('option');op.value=x.id;op.textContent=`${x.title} · ${x.mood}`;$('#track').appendChild(op);});
  }catch(e){if(e.status===401||e.status===403) location.href='/login?next='+encodeURIComponent(location.pathname); else $('#clips').innerHTML='<div class="empty">Could not load your clips. Refresh and try again.</div>';}
}
$$('.mode').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;$$('.mode').forEach(x=>x.classList.toggle('on',x===b));});
function progress(stage){
  const map={queued:[8,'Queued…'],planning:[18,'AI is planning your reel…'],rendering:[45,'Re-rendering clips with one visual style…'],composing:[72,'Joining clips and mixing audio…'],uploading:[90,'Uploading finished reel…'],done:[100,'Your reel is ready.']};
  const p=map[stage]||[25,'Working on your reel…']; $('#status').classList.add('on');$('#statusText').textContent=p[1];$('#bar').style.width=p[0]+'%';
}
function watch(id){clearInterval(poll);let tries=0;poll=setInterval(async()=>{try{const d=await api('/api/jobs/'+id);const j=d.job||{};progress(j.stage||'planning');if(j.status==='done'){clearInterval(poll);$('#make').disabled=false;$('#make').textContent='✦ Create AI Reel';$('#result').innerHTML='✓ Reel saved to your clips. <a href="/app">Open Clips →</a>';return;}if(j.status==='error'){clearInterval(poll);$('#make').disabled=false;$('#make').textContent='✦ Create AI Reel';$('#statusText').textContent='Reel render failed';$('#result').textContent=j.error||'Please try again.';}else if(++tries>120){clearInterval(poll);$('#result').textContent='This render is taking longer than expected. You can leave this page; the job will keep running.';}}catch(e){}},4000);}
$('#form').onsubmit=async e=>{
  e.preventDefault(); const fd=new FormData(e.currentTarget); fd.set('mode',mode); fd.set('clipIds',JSON.stringify([...selected]));
  if($('#music').files[0]){fd.set('musicMode','upload');fd.set('music',$('#music').files[0]);}else if($('#track').value){fd.set('musicMode','library');}else fd.set('musicMode','auto');
  $('#make').disabled=true;$('#make').textContent='Planning…';progress('planning');$('#result').textContent='';
  try{const t=await token();const r=await fetch('/api/reels',{method:'POST',body:fd,credentials:'include',headers:t?{Authorization:'Bearer '+t}:{}});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||'Could not start reel');watch(j.jobId);}catch(err){$('#make').disabled=false;$('#make').textContent='✦ Create AI Reel';$('#statusText').textContent='Could not start reel';$('#result').textContent=err.message;}
};
load();
