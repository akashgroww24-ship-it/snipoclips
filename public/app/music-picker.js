/* Snipo Music Picker — search, preview and choose the exact music section for a reel. */
(function(){
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state={tracks:[],selected:null,preview:null,start:0,searchTimer:null};

  function css(){
    const s=document.createElement('style');
    s.textContent=`
      .sm-open{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 13px;border:1px solid rgba(168,85,247,.28);background:rgba(168,85,247,.07);color:#eee8f7;border-radius:11px;cursor:pointer;font:700 11px 'Plus Jakarta Sans',sans-serif}.sm-open span{color:#9d91b8;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sm-modal{position:fixed;inset:0;z-index:10040;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(4,2,10,.86);backdrop-filter:blur(14px)}.sm-modal.on{display:flex}.sm-shell{width:min(760px,96vw);max-height:88vh;display:flex;flex-direction:column;border-radius:22px;border:1px solid rgba(229,73,200,.32);background:#100b1a;box-shadow:0 30px 90px rgba(0,0,0,.6);overflow:hidden;color:#fff}.sm-head{padding:18px 20px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between}.sm-head h3{margin:0;font-size:18px}.sm-x{width:34px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.09);background:#1b1327;color:#cdbfe0;font-size:18px;cursor:pointer}.sm-search{padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06)}.sm-search input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.09);background:#090610;color:#fff;outline:none;font:500 12px 'Plus Jakarta Sans',sans-serif}.sm-search input:focus{border-color:#a855f7}.sm-chips{display:flex;gap:7px;overflow:auto;padding:0 18px 12px}.sm-chip{white-space:nowrap;padding:7px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:#171021;color:#a99fba;font-size:10px;cursor:pointer}.sm-chip.on{border-color:#d946ef;color:#fff;background:rgba(217,70,239,.1)}.sm-list{padding:5px 12px 12px;overflow:auto;min-height:240px}.sm-row{display:grid;grid-template-columns:42px 1fr auto;gap:11px;align-items:center;padding:10px;border-radius:12px;border:1px solid transparent;cursor:pointer}.sm-row:hover{background:rgba(255,255,255,.035)}.sm-row.on{border-color:rgba(217,70,239,.36);background:rgba(217,70,239,.075)}.sm-play{width:42px;height:42px;border-radius:11px;border:0;background:linear-gradient(135deg,#7c3aed,#d946ef);color:#fff;cursor:pointer}.sm-info strong{font-size:11px;display:block}.sm-info small{font-size:9px;color:#8f84a5}.sm-bpm{font-size:9px;color:#8e83a0}.sm-empty{padding:34px;text-align:center;color:#81768f;font-size:11px}.sm-editor{display:none;padding:16px 18px 18px;border-top:1px solid rgba(255,255,255,.07);background:#0b0712}.sm-editor.on{display:block}.sm-selected{display:flex;justify-content:space-between;gap:10px;align-items:end}.sm-selected strong{font-size:12px}.sm-selected small{display:block;color:#968ba7;font-size:9px;margin-top:3px}.sm-auto{border:1px solid rgba(168,85,247,.28);background:rgba(168,85,247,.08);color:#ddb8ff;border-radius:9px;padding:7px 9px;font-size:9px;cursor:pointer}.sm-range{margin-top:14px}.sm-range input{width:100%;accent-color:#d946ef}.sm-times{display:flex;justify-content:space-between;color:#8e839e;font-size:9px}.sm-actions{display:flex;gap:8px;margin-top:12px}.sm-actions button{flex:1;padding:10px;border-radius:10px;font-weight:800;font-size:10px;cursor:pointer}.sm-cancel{border:1px solid rgba(255,255,255,.08);background:#171021;color:#aaa0b7}.sm-use{border:0;background:linear-gradient(90deg,#a855f7,#e549c8);color:#fff}
    `;
    document.head.appendChild(s);
  }

  function fmt(sec){sec=Math.max(0,Math.floor(Number(sec)||0));return Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');}

  function setup(){
    const mode=document.querySelector('#reel-music-mode');
    const wrap=document.querySelector('#reel-track-wrap');
    const select=document.querySelector('#reel-track');
    if(!mode||!wrap||!select||document.querySelector('#sm-open')) return false;

    wrap.style.display='flex';
    select.style.display='none';
    const btn=document.createElement('button');
    btn.type='button';btn.id='sm-open';btn.className='sm-open';btn.innerHTML='<b>♪ Add music</b><span id="sm-current">Search Snipo Music</span>';
    wrap.appendChild(btn);

    const hidden=document.createElement('input');hidden.type='hidden';hidden.id='reel-music-start';hidden.value='0';wrap.appendChild(hidden);

    btn.onclick=open;
    return true;
  }

  function buildModal(){
    if(document.querySelector('#sm-modal')) return;
    const m=document.createElement('div');m.id='sm-modal';m.className='sm-modal';
    m.innerHTML=`<div class="sm-shell"><div class="sm-head"><div><h3>Add Music</h3><div style="font-size:10px;color:#8d829d;margin-top:4px">Search, preview, then choose the exact part to use.</div></div><button class="sm-x">×</button></div><div class="sm-search"><input id="sm-q" placeholder="Search songs, artists, moods or genres…"></div><div class="sm-chips" id="sm-chips"><button class="sm-chip on" data-mood="">For You</button><button class="sm-chip" data-mood="energetic">Energetic</button><button class="sm-chip" data-mood="cinematic">Cinematic</button><button class="sm-chip" data-mood="chill">Chill</button><button class="sm-chip" data-mood="uplifting">Uplifting</button><button class="sm-chip" data-mood="dramatic">Dramatic</button></div><div class="sm-list" id="sm-list"><div class="sm-empty">Loading music…</div></div><div class="sm-editor" id="sm-editor"><div class="sm-selected"><div><strong id="sm-title"></strong><small id="sm-meta"></small></div><button class="sm-auto" id="sm-auto">✦ AI Best Part</button></div><div class="sm-range"><input id="sm-start" type="range" min="0" max="0" value="0" step="1"><div class="sm-times"><span id="sm-start-label">0:00</span><span id="sm-window">45s selection</span><span id="sm-end-label">0:45</span></div></div><div class="sm-actions"><button class="sm-cancel" type="button">Cancel</button><button class="sm-use" type="button">Use Audio</button></div></div></div>`;
    document.body.appendChild(m);
    m.querySelector('.sm-x').onclick=close;
    m.querySelector('.sm-cancel').onclick=close;
    m.addEventListener('click',e=>{if(e.target===m)close();});
    document.querySelector('#sm-q').oninput=e=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadTracks(e.target.value,'') ,220);};
    document.querySelectorAll('.sm-chip').forEach(c=>c.onclick=()=>{document.querySelectorAll('.sm-chip').forEach(x=>x.classList.toggle('on',x===c));document.querySelector('#sm-q').value='';loadTracks('',c.dataset.mood||'');});
    document.querySelector('#sm-start').oninput=updateRangeLabels;
    document.querySelector('#sm-auto').onclick=()=>{if(!state.selected)return;const dur=Number(state.selected.duration_sec)||45;const reelDur=Number(document.querySelector('#reel-duration')?.value)||45;const max=Math.max(0,dur-reelDur);const drop=Math.round(max*.35);document.querySelector('#sm-start').value=drop;updateRangeLabels();};
    document.querySelector('.sm-use').onclick=useSelected;
  }

  async function open(){buildModal();document.querySelector('#sm-modal').classList.add('on');await loadTracks('','');}
  function close(){const m=document.querySelector('#sm-modal');if(m)m.classList.remove('on');stopPreview();}
  function stopPreview(){if(state.preview){state.preview.pause();state.preview=null;}}

  async function loadTracks(q,mood){
    const list=document.querySelector('#sm-list'); if(!list)return;
    list.innerHTML='<div class="sm-empty">Searching music…</div>';
    try{
      const qs=new URLSearchParams();if(q)qs.set('q',q);if(mood)qs.set('mood',mood);qs.set('limit','60');
      const data=await api('/api/music/tracks?'+qs.toString());state.tracks=data.tracks||[];render();
    }catch(e){list.innerHTML='<div class="sm-empty">Could not load music library.</div>';}
  }

  function render(){
    const list=document.querySelector('#sm-list');
    if(!state.tracks.length){list.innerHTML='<div class="sm-empty">No matching tracks yet. Add tracks from the Snipo Music admin library.</div>';return;}
    list.innerHTML=state.tracks.map(t=>`<div class="sm-row ${state.selected&&state.selected.id===t.id?'on':''}" data-id="${esc(t.id)}"><button class="sm-play" data-play="${esc(t.id)}">▶</button><div class="sm-info"><strong>${esc(t.title)}</strong><small>${esc(t.artist||'Snipo Music')} · ${esc(t.mood||t.genre||'music')}${t.duration_sec?' · '+fmt(t.duration_sec):''}</small></div><span class="sm-bpm">${t.bpm?Math.round(t.bpm)+' BPM':''}</span></div>`).join('');
    list.querySelectorAll('.sm-row').forEach(r=>r.onclick=e=>{if(e.target.closest('[data-play]'))return;selectTrack(r.dataset.id);});
    list.querySelectorAll('[data-play]').forEach(b=>b.onclick=e=>{e.stopPropagation();preview(b.dataset.play,b);});
  }

  async function preview(id,button){
    try{
      if(state.preview){state.preview.pause();state.preview=null;document.querySelectorAll('.sm-play').forEach(x=>x.textContent='▶');if(button.textContent==='❚❚')return;}
      const d=await api('/api/music/tracks/'+id+'/preview');const a=new Audio(d.url);state.preview=a;button.textContent='❚❚';a.onended=()=>{button.textContent='▶';state.preview=null;};await a.play();
    }catch(e){toast('Preview unavailable','Could not play this track right now.','err');}
  }

  function selectTrack(id){
    state.selected=state.tracks.find(x=>String(x.id)===String(id))||null;if(!state.selected)return;render();
    const ed=document.querySelector('#sm-editor');ed.classList.add('on');document.querySelector('#sm-title').textContent=state.selected.title;document.querySelector('#sm-meta').textContent=[state.selected.artist,state.selected.mood,state.selected.bpm?Math.round(state.selected.bpm)+' BPM':null].filter(Boolean).join(' · ');
    const reelDur=Number(document.querySelector('#reel-duration')?.value)||45;const max=Math.max(0,Math.floor((Number(state.selected.duration_sec)||reelDur)-reelDur));const range=document.querySelector('#sm-start');range.max=String(max);range.value='0';updateRangeLabels();
  }

  function updateRangeLabels(){
    const range=document.querySelector('#sm-start');if(!range)return;const start=Number(range.value)||0;const reelDur=Number(document.querySelector('#reel-duration')?.value)||45;document.querySelector('#sm-start-label').textContent=fmt(start);document.querySelector('#sm-window').textContent=reelDur+'s selection';document.querySelector('#sm-end-label').textContent=fmt(start+reelDur);
  }

  function useSelected(){
    if(!state.selected)return;const select=document.querySelector('#reel-track');select.value=state.selected.id;document.querySelector('#reel-music-start').value=String(Number(document.querySelector('#sm-start').value)||0);document.querySelector('#reel-music-mode').value='catalog';let current=document.querySelector('#sm-current');current.textContent=(state.selected.title+(state.selected.artist?' · '+state.selected.artist:''));close();toast('Music selected','This exact section will be mixed into your reel.');
  }

  css();
  const timer=setInterval(()=>{if(setup()){clearInterval(timer);buildModal();}},120);
  setTimeout(()=>clearInterval(timer),10000);
})();
