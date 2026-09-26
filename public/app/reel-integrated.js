/* Snipo Clips — integrated AI Reel Composer */
(function(){
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nonReels=()=>Array.isArray(clips)?clips.filter(c=>!(c.edit&&c.edit.type==='reel')&&c.id):[];
  const state={open:false,mode:'auto',selected:new Set(),options:null,poll:null,running:false};

  const css=`
  .reel-launch{display:inline-flex;align-items:center;gap:9px;border:1px solid rgba(229,73,200,.5);background:linear-gradient(135deg,rgba(124,58,237,.25),rgba(229,73,200,.18));color:#fff;border-radius:13px;padding:10px 15px;font:700 13px/1 'Plus Jakarta Sans',sans-serif;cursor:pointer;box-shadow:0 0 24px rgba(168,85,247,.12);transition:.2s}.reel-launch:hover{transform:translateY(-1px);border-color:#e549c8;box-shadow:0 10px 30px rgba(168,85,247,.18)}.reel-launch svg{width:17px;height:17px;color:#f472d9}
  .reel-project-bar{display:flex;justify-content:flex-end;align-items:center;margin:-44px 0 16px;position:relative;z-index:2}.reel-badge{font-size:10px;background:#e549c8;color:#fff;border-radius:999px;padding:3px 7px;margin-left:3px}
  .reel-modal{position:fixed;inset:0;z-index:10020;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(6,3,15,.82);backdrop-filter:blur(12px)}.reel-modal.on{display:flex}.reel-shell{width:min(1080px,96vw);max-height:92vh;overflow:auto;border:1px solid rgba(229,73,200,.38);border-radius:24px;background:linear-gradient(160deg,#171027,#0d0918 72%);box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 80px rgba(139,92,246,.11);color:#f7f3ff}.reel-head{position:sticky;top:0;z-index:2;display:flex;justify-content:space-between;gap:20px;align-items:center;padding:22px 24px;background:rgba(18,12,32,.94);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.07)}.reel-head h2{font-size:22px;margin:0}.reel-head p{margin:5px 0 0;color:#9f94bd;font-size:12px}.reel-close{border:1px solid rgba(255,255,255,.1);background:#211731;color:#c8bddc;width:34px;height:34px;border-radius:10px;cursor:pointer;font-size:20px}.reel-body{display:grid;grid-template-columns:1.25fr .8fr;gap:22px;padding:22px}.reel-panel{border:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.025);border-radius:18px;padding:18px}.reel-panel h3{font-size:14px;margin:0 0 6px}.reel-sub{color:#9d91b8;font-size:11px;line-height:1.5}.reel-mode{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.reel-mode button{padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:#151020;color:#a99fbd;cursor:pointer;font-weight:700}.reel-mode button.on{border-color:#d946ef;background:rgba(217,70,239,.12);color:#fff;box-shadow:0 0 20px rgba(217,70,239,.12)}
  .reel-clips-head{display:flex;justify-content:space-between;align-items:center;margin:12px 0 10px}.reel-mini{border:0;background:transparent;color:#d88cff;font-size:11px;cursor:pointer}.reel-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-height:430px;overflow:auto;padding-right:3px}.reel-pick{position:relative;border:1px solid rgba(255,255,255,.075);border-radius:13px;padding:10px;background:#110c1d;cursor:pointer;display:grid;grid-template-columns:62px 1fr;gap:10px;min-height:74px}.reel-pick:hover{border-color:rgba(216,140,255,.4)}.reel-pick.on{border-color:#d946ef;background:rgba(217,70,239,.09);box-shadow:inset 0 0 0 1px rgba(217,70,239,.12)}.reel-thumb{width:62px;height:56px;object-fit:cover;border-radius:9px;background:#08050f}.reel-pick strong{display:block;font-size:11px;line-height:1.35;margin:2px 0 5px}.reel-meta{font-size:10px;color:#8f84a8}.reel-check{position:absolute;right:8px;top:8px;width:19px;height:19px;border-radius:6px;border:1px solid rgba(255,255,255,.18);background:#171125;display:grid;place-items:center;font-size:11px}.reel-pick.on .reel-check{background:#d946ef;border-color:#d946ef;color:#fff}.reel-auto-note{padding:10px 12px;border-radius:11px;background:rgba(91,33,182,.15);border:1px solid rgba(168,85,247,.18);color:#baa9d1;font-size:10px;line-height:1.5;margin-top:10px}
  .reel-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px}.reel-field{display:flex;flex-direction:column;gap:6px}.reel-field.full{grid-column:1/-1}.reel-field label{font-size:10px;color:#9c91b5;font-weight:700}.reel-field input,.reel-field select{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.085);background:#0e0a17;color:#eee8f7;border-radius:10px;padding:10px 11px;font:500 11px 'Plus Jakarta Sans',sans-serif;outline:none}.reel-field input:focus,.reel-field select:focus{border-color:#a855f7}.reel-upload{border:1px dashed rgba(168,85,247,.35)!important;background:rgba(168,85,247,.06)!important}.reel-summary{margin:14px 0 0;padding:12px;border-radius:12px;background:#0d0916;color:#9f94b6;font-size:10px;line-height:1.6}.reel-summary b{color:#f1e9ff}.reel-go{width:100%;margin-top:14px;padding:13px 16px;border:0;border-radius:12px;background:linear-gradient(90deg,#a855f7,#e549c8);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 10px 28px rgba(168,85,247,.2)}.reel-go:disabled{opacity:.55;cursor:not-allowed}.reel-progress{display:none;margin-top:14px;border:1px solid rgba(168,85,247,.22);background:rgba(168,85,247,.07);border-radius:13px;padding:12px}.reel-progress.on{display:block}.reel-prog-row{display:flex;justify-content:space-between;font-size:10px;color:#bbb0cf;margin-bottom:8px}.reel-trackbar{height:5px;background:#211932;border-radius:99px;overflow:hidden}.reel-trackbar i{display:block;height:100%;width:6%;background:linear-gradient(90deg,#8b5cf6,#ec4899);transition:width .4s}.reel-stage-list{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}.reel-stage-list span{font-size:9px;color:#716682}.reel-stage-list span.on{color:#f0c6ff}.reel-stage-list span.done{color:#79e4aa}
  @media(max-width:800px){.reel-body{grid-template-columns:1fr}.reel-list{grid-template-columns:1fr}.reel-project-bar{margin:10px 0}.reel-shell{max-height:96vh}.reel-fields{grid-template-columns:1fr}.reel-field.full{grid-column:auto}}
  `;
  const style=document.createElement('style'); style.textContent=css; document.head.appendChild(style);

  const modal=document.createElement('div'); modal.className='reel-modal'; modal.id='reel-modal';
  modal.innerHTML=`<div class="reel-shell" role="dialog" aria-modal="true" aria-labelledby="reel-title">
    <div class="reel-head"><div><h2 id="reel-title">AI Reel Composer <span class="reel-badge">NEW</span></h2><p>Turn your best generated clips into one finished, social-ready reel.</p></div><button class="reel-close" aria-label="Close">×</button></div>
    <div class="reel-body">
      <section class="reel-panel"><h3>1. Choose the story material</h3><div class="reel-sub">Auto Director can choose for you, or switch to Manual to control exactly which clips make the reel.</div>
        <div class="reel-mode"><button data-mode="auto" class="on">✦ Auto Director</button><button data-mode="manual">Manual selection</button></div>
        <div class="reel-clips-head"><span class="reel-sub" id="reel-count">0 clips available</span><button class="reel-mini" id="reel-select-all">Select top clips</button></div>
        <div class="reel-list" id="reel-list"></div>
        <div class="reel-auto-note" id="reel-note"><b>Auto Director:</b> AI builds a story arc — hook → context → value/tension → strongest payoff → ending — instead of simply concatenating the highest scores.</div>
      </section>
      <aside class="reel-panel"><h3>2. Direct the reel</h3><div class="reel-sub">Leave controls on Auto for one-click creation, or override any decision.</div>
        <div class="reel-fields" style="margin-top:14px">
          <div class="reel-field full"><label>REEL TITLE</label><input id="reel-name" maxlength="100" value="AI Reel" placeholder="My new reel"></div>
          <div class="reel-field"><label>TARGET LENGTH</label><select id="reel-duration"><option value="30">30 sec</option><option value="45" selected>45 sec</option><option value="60">60 sec</option><option value="90">90 sec</option></select></div>
          <div class="reel-field"><label>CAPTION STYLE</label><select id="reel-caption"><option value="auto">AI chooses</option></select></div>
          <div class="reel-field"><label>MUSIC MOOD</label><select id="reel-mood"><option value="auto">AI chooses</option></select></div>
          <div class="reel-field"><label>TRANSITIONS</label><select id="reel-transition"><option value="auto">AI chooses</option></select></div>
          <div class="reel-field full"><label>MUSIC SOURCE</label><select id="reel-music-mode"><option value="auto">Auto-pick from licensed library</option><option value="none">No music</option><option value="upload">Upload my own licensed track</option></select></div>
          <div class="reel-field full" id="reel-track-wrap" style="display:none"><label>LIBRARY TRACK</label><select id="reel-track"><option value="">AI chooses track</option></select></div>
          <div class="reel-field full" id="reel-upload-wrap" style="display:none"><label>YOUR MUSIC FILE</label><input class="reel-upload" id="reel-music-file" type="file" accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg"></div>
        </div>
        <div class="reel-summary"><b>AI automation includes:</b> strongest opening hook, coherent clip ordering, pacing, consistent caption styling, vertical 9:16 output, soundtrack mood, voice-safe music level, transitions, and final export.</div>
        <button class="reel-go" id="reel-go">✦ Create reel automatically</button>
        <div class="reel-progress" id="reel-progress"><div class="reel-prog-row"><span id="reel-progress-label">Planning your reel…</span><b id="reel-progress-pct">10%</b></div><div class="reel-trackbar"><i id="reel-progress-bar"></i></div><div class="reel-stage-list" id="reel-stages"></div></div>
      </aside>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const stageOrder=['planning','rendering','composing','uploading','done'];
  const stageLabel={planning:'AI directing story',rendering:'Styling captions',composing:'Joining clips + music',uploading:'Saving reel',done:'Reel ready'};
  const updateProgress=stage=>{
    let i=stageOrder.indexOf(stage); if(i<0)i=0;
    const pct=Math.round(((i+1)/stageOrder.length)*100);
    $('#reel-progress').classList.add('on'); $('#reel-progress-label').textContent=stageLabel[stage]||'Creating reel…'; $('#reel-progress-pct').textContent=pct+'%'; $('#reel-progress-bar').style.width=pct+'%';
    $('#reel-stages').innerHTML=stageOrder.map((s,n)=>`<span class="${n<i?'done':n===i?'on':''}">${stageLabel[s]}</span>`).join('');
  };

  function renderPicks(){
    const list=nonReels();
    $('#reel-count').textContent=list.length+' generated clip'+(list.length===1?'':'s')+' available';
    $('#reel-list').innerHTML=list.length?list.map(c=>{
      const dur=(c.end_sec!=null&&c.start_sec!=null)?Math.max(0,Math.round(c.end_sec-c.start_sec)):0;
      const score=c.score!=null?` · ${Math.round(Number(c.score)||0)} score`:'';
      return `<button type="button" class="reel-pick ${state.selected.has(String(c.id))?'on':''}" data-id="${esc(c.id)}"><video class="reel-thumb" src="${esc(c.url||'')}" muted playsinline preload="metadata"></video><div><strong>${esc(c.title||'Untitled clip')}</strong><div class="reel-meta">${dur?dur+'s':''}${score}</div></div><span class="reel-check">${state.selected.has(String(c.id))?'✓':''}</span></button>`;
    }).join(''):`<div class="reel-sub">Create some clips first. They will appear here automatically.</div>`;
    $$('#reel-list .reel-pick').forEach(b=>b.onclick=()=>{const id=String(b.dataset.id);state.selected.has(id)?state.selected.delete(id):state.selected.add(id);renderPicks();});
  }

  async function loadOptions(){
    try{
      state.options=await api('/api/reels/options');
      const caps=(state.options.captionPresets||[]); $('#reel-caption').innerHTML='<option value="auto">AI chooses</option>'+caps.map(x=>`<option value="${esc(x)}">${esc(x.replace(/_/g,' '))}</option>`).join('');
      const moods=(state.options.moods||[]).filter(x=>x!=='auto'); $('#reel-mood').innerHTML='<option value="auto">AI chooses</option>'+moods.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
      const trs=(state.options.transitions||[]).filter(x=>x!=='auto'); $('#reel-transition').innerHTML='<option value="auto">AI chooses</option>'+trs.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('');
      const tracks=state.options.tracks||[]; $('#reel-track').innerHTML='<option value="">AI chooses track</option>'+tracks.map(t=>`<option value="${esc(t.id)}">${esc(t.title)} · ${esc(t.mood)}</option>`).join('');
      $('#reel-track-wrap').style.display=tracks.length?'flex':'none';
      if(!tracks.length) $('#reel-music-mode').querySelector('option[value="auto"]').textContent='Auto music (library not configured yet)';
    }catch(e){ console.warn('[reel options]',e); }
  }

  async function open(){
    state.open=true; modal.classList.add('on'); document.body.style.overflow='hidden';
    try{await load();}catch(e){}
    const candidates=[...nonReels()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,5);
    state.selected=new Set(candidates.map(c=>String(c.id)));
    renderPicks(); loadOptions();
  }
  function close(){ if(state.running)return; state.open=false;modal.classList.remove('on');document.body.style.overflow=''; }
  modal.querySelector('.reel-close').onclick=close; modal.addEventListener('click',e=>{if(e.target===modal)close();});

  $$('.reel-mode button').forEach(b=>b.onclick=()=>{
    state.mode=b.dataset.mode; $$('.reel-mode button').forEach(x=>x.classList.toggle('on',x===b));
    $('#reel-note').innerHTML=state.mode==='auto'?'<b>Auto Director:</b> AI builds a story arc — hook → context → value/tension → strongest payoff → ending — and may reorder your selected clips.':'<b>Manual mode:</b> only the clips you select are used. Snipo still normalizes captions, audio, format, soundtrack and export automatically.';
  });
  $('#reel-select-all').onclick=()=>{const top=[...nonReels()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,8);state.selected=new Set(top.map(c=>String(c.id)));renderPicks();};
  $('#reel-music-mode').onchange=e=>{const v=e.target.value;$('#reel-upload-wrap').style.display=v==='upload'?'flex':'none';$('#reel-track-wrap').style.display=v==='auto'&&state.options&&state.options.tracks&&state.options.tracks.length?'flex':'none';};

  async function watchReel(id){
    clearInterval(state.poll); let ticks=0;
    state.poll=setInterval(async()=>{try{
      const d=await api('/api/jobs/'+id); const j=d.job||{}; updateProgress(j.stage||'planning');
      if(j.status==='done'){
        clearInterval(state.poll); updateProgress('done'); state.running=false; $('#reel-go').disabled=false; $('#reel-go').textContent='✦ Create another reel';
        folderCategory='reels'; openFolder='reels:'+id;
        toast('AI reel ready','Your finished reel is in its AI Reels folder.'); await load();
        setTimeout(()=>{modal.classList.remove('on');document.body.style.overflow='';const p=$('#projects');if(p)p.scrollIntoView({behavior:'smooth'});},1100);
      } else if(j.status==='error'){
        clearInterval(state.poll); state.running=false; $('#reel-go').disabled=false; $('#reel-go').textContent='Try again'; toast("We couldn't create the reel",j.error||'Render failed.','err');
      } else if(++ticks>180){ clearInterval(state.poll); state.running=false; $('#reel-go').disabled=false; $('#reel-go').textContent='Check status'; toast('Reel is taking longer than expected','It may still be rendering. Check projects again shortly.','err'); }
    }catch(e){}},4000);
  }

  $('#reel-go').onclick=async()=>{
    const available=nonReels(); if(!available.length)return toast('No clips yet','Generate at least one clip before making a reel.','err');
    if(state.mode==='manual'&&!state.selected.size)return toast('Choose clips','Select at least one clip for Manual mode.','err');
    const fd=new FormData();
    fd.append('mode',state.mode); fd.append('clipIds',JSON.stringify([...state.selected])); fd.append('title',$('#reel-name').value||'AI Reel');
    fd.append('targetDuration',$('#reel-duration').value); fd.append('captionPreset',$('#reel-caption').value); fd.append('musicMood',$('#reel-mood').value); fd.append('transition',$('#reel-transition').value); fd.append('musicMode',$('#reel-music-mode').value); fd.append('trackId',$('#reel-track').value||''); fd.append('progress','1');
    const mf=$('#reel-music-file').files[0]; if(mf)fd.append('music',mf);
    state.running=true; $('#reel-go').disabled=true; $('#reel-go').textContent='AI is directing…'; updateProgress('planning');
    try{
      const tok=await authToken(); const r=await fetch('/api/reels',{method:'POST',body:fd,credentials:'include',headers:tok?{Authorization:'Bearer '+tok}:{}}); const d=await r.json().catch(()=>({}));
      if(!r.ok)throw Object.assign(new Error(d.error||'Could not start reel'),{status:r.status});
      toast('Reel render started','AI is choosing the story, style and soundtrack.'); watchReel(d.jobId);
    }catch(e){state.running=false;$('#reel-go').disabled=false;$('#reel-go').textContent='✦ Create reel automatically';toast('Could not start reel',e.message,'err');}
  };

  function installLaunchers(){
    const track=$('#track');
    if(track&&!$('#reel-tool')){
      const b=document.createElement('button'); b.id='reel-tool'; b.className='tool'; b.type='button'; b.setAttribute('aria-pressed','false');
      b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z"/><path d="m10 9 5 3-5 3V9Z"/><path d="M18 3v4M16 5h4"/></svg><b>AI Reel</b><span class="reel-badge">NEW</span>';
      b.onclick=open; track.appendChild(b);
    }
    const projects=$('#projects');
    if(projects&&!$('#reel-project-bar')){
      const bar=document.createElement('div');bar.className='reel-project-bar';bar.id='reel-project-bar';bar.innerHTML='<button class="reel-launch" id="reel-open"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z"/><path d="m10 9 5 3-5 3V9Z"/></svg>Create AI Reel <span class="reel-badge">NEW</span></button>';
      const grid=$('#grid'); if(grid)projects.insertBefore(bar,grid); else projects.appendChild(bar); $('#reel-open').onclick=open;
    }
  }
  installLaunchers();
})();
