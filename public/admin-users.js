(function(){
  if(document.querySelector('#userIntelPanel')) return;
  const esc=s=>String(s==null?'':s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDur=s=>{s=Number(s||0); if(s<60)return `${Math.round(s)}s`; const m=Math.floor(s/60),h=Math.floor(m/60); return h?`${h}h ${m%60}m`:`${m}m`;};
  const fmtDate=v=>v?new Date(v).toLocaleString():'—';
  const app=document.querySelector('#app'); if(!app) return;
  const style=document.createElement('style'); style.textContent=`
    #userIntelPanel{margin-top:18px}.ui-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.ui-head input,.ui-head select{background:rgba(0,0,0,.28);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:10px 12px;font:inherit}.ui-table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}.ui-table{width:100%;border-collapse:collapse;min-width:1050px}.ui-table th,.ui-table td{padding:11px 10px;border-bottom:1px solid var(--line);font-size:12px;text-align:left;vertical-align:top}.ui-table th{color:var(--muted);font-weight:600;position:sticky;top:0;background:#11111a}.ui-table tr{cursor:pointer}.ui-table tr:hover td{background:rgba(255,255,255,.035)}.pill2{display:inline-block;padding:3px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11px}.drawer{position:fixed;inset:0;z-index:10020;background:rgba(0,0,0,.66);display:none}.drawer.on{display:block}.drawer-card{position:absolute;right:0;top:0;bottom:0;width:min(720px,96vw);overflow:auto;background:#0c0c14;border-left:1px solid var(--line);padding:24px}.drawer-top{display:flex;gap:10px;align-items:center}.drawer-top h2{margin:0}.xbtn{margin-left:auto}.detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.mini{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}.mini b{display:block;font-size:20px;margin-top:5px}.section{margin-top:20px}.section h4{margin:0 0 8px}.event{padding:9px 0;border-top:1px solid var(--line);font-size:12px}.event:first-child{border-top:0}.muted{color:var(--muted)}@media(max-width:650px){.detail-grid{grid-template-columns:1fr 1fr}}
  `; document.head.appendChild(style);

  const panel=document.createElement('div'); panel.id='userIntelPanel'; panel.className='panel'; panel.innerHTML=`
    <h3>User Intelligence</h3><div class="sub">Per-user usage, clips, jobs, activity time, failures, music and YouTube activity</div>
    <div class="ui-head"><input id="uiSearch" placeholder="Search email or user ID"><select id="uiPlan"><option value="">All plans</option><option>free</option><option>single</option><option>half</option><option>full</option></select><button class="b" id="uiReload">Reload users</button><span class="muted" id="uiSummary"></span></div>
    <div class="ui-table-wrap"><table class="ui-table"><thead><tr><th>User</th><th>Plan</th><th>Clips</th><th>Jobs</th><th>Failed</th><th>Processed min</th><th>Active time</th><th>Sessions</th><th>Last seen</th><th>Last path</th></tr></thead><tbody id="uiRows"><tr><td colspan="10">Loading…</td></tr></tbody></table></div>`;
  app.appendChild(panel);

  const drawer=document.createElement('div'); drawer.className='drawer'; drawer.id='uiDrawer'; drawer.innerHTML='<div class="drawer-card"><div class="drawer-top"><h2 id="udTitle">User</h2><button class="b xbtn" id="udClose">Close</button></div><div id="udBody"></div></div>'; document.body.appendChild(drawer);
  document.querySelector('#udClose').onclick=()=>drawer.classList.remove('on'); drawer.onclick=e=>{if(e.target===drawer)drawer.classList.remove('on');};

  let users=[];
  async function loadUsers(){
    const q=document.querySelector('#uiSearch').value.trim(); const plan=document.querySelector('#uiPlan').value;
    const p=new URLSearchParams(); if(q)p.set('q',q); if(plan)p.set('plan',plan); p.set('limit','250');
    const r=await fetch('/admin/api/users?'+p.toString(),{credentials:'same-origin'}); if(!r.ok)return;
    const d=await r.json(); users=d.users||[]; document.querySelector('#uiSummary').textContent=`${d.totals.users} users · ${d.totals.clips} clips · ${Math.round(d.totals.minutesProcessed||0)} processed min · ${fmtDur(d.totals.activeSeconds)}`;
    document.querySelector('#uiRows').innerHTML=users.length?users.map(u=>`<tr data-id="${esc(u.user_id)}"><td><b>${esc(u.email||'No email')}</b><div class="muted">${esc(u.user_id)}</div></td><td><span class="pill2">${esc(u.plan||'free')}</span></td><td>${Number(u.total_clips||0)}</td><td>${Number(u.total_jobs||0)}</td><td>${Number(u.failed_jobs||0)}</td><td>${Number(u.period_minutes_used||0).toFixed(1)}</td><td>${fmtDur(u.active_seconds)}</td><td>${Number(u.session_count||0)}</td><td>${fmtDate(u.last_seen_at||u.last_job_at||u.last_clip_at)}</td><td>${esc(u.last_path||'—')}</td></tr>`).join(''):'<tr><td colspan="10">No users found.</td></tr>';
    document.querySelectorAll('#uiRows tr[data-id]').forEach(tr=>tr.onclick=()=>openUser(tr.dataset.id));
  }
  async function openUser(id){
    drawer.classList.add('on'); document.querySelector('#udBody').innerHTML='Loading…';
    const r=await fetch('/admin/api/users/'+encodeURIComponent(id),{credentials:'same-origin'}); const d=await r.json(); if(!r.ok){document.querySelector('#udBody').textContent=d.error||'Failed';return;}
    const u=d.user; document.querySelector('#udTitle').textContent=u.email||'User';
    const events=(d.activity||[]).map(x=>`<div class="event"><b>${esc(x.action||x.event_type)}</b><div class="muted">${fmtDate(x.created_at)} · ${esc(x.status_code||'')} ${esc(x.path||'')}</div></div>`).join('')||'<div class="muted">No tracked activity yet.</div>';
    const jobs=(d.jobs||[]).map(x=>`<div class="event"><b>${esc(x.status)} · ${esc(x.stage||'')}</b><div class="muted">${fmtDate(x.created_at)} · clips ${Number(x.clips_count||0)}${x.source_url?' · '+esc(x.source_url):''}</div>${x.error?`<div>${esc(x.error)}</div>`:''}</div>`).join('')||'<div class="muted">No jobs.</div>';
    const clips=(d.clips||[]).map(x=>`<div class="event"><b>${esc(x.title||'Untitled clip')}</b><div class="muted">${fmtDate(x.created_at)} · score ${x.score??'—'} · ${Number(x.start_sec||0).toFixed(1)}s–${Number(x.end_sec||0).toFixed(1)}s</div></div>`).join('')||'<div class="muted">No clips.</div>';
    const yt=(d.youtubeUploads||[]).map(x=>`<div class="event"><b>${esc(x.status)} · attempts ${Number(x.attempts||0)}</b><div class="muted">${fmtDate(x.created_at)}${x.video_id?' · '+esc(x.video_id):''}</div>${x.error?`<div>${esc(x.error)}</div>`:''}</div>`).join('')||'<div class="muted">No YouTube uploads.</div>';
    document.querySelector('#udBody').innerHTML=`
      <div class="muted">${esc(u.user_id)} · joined ${fmtDate(u.joined_at)} · plan ${esc(u.plan)}</div>
      <div class="detail-grid"><div class="mini">Total clips<b>${Number(u.total_clips||0)}</b></div><div class="mini">Total jobs<b>${Number(u.total_jobs||0)}</b></div><div class="mini">Failed jobs<b>${Number(u.failed_jobs||0)}</b></div><div class="mini">Processed minutes<b>${Number(u.period_minutes_used||0).toFixed(1)}</b></div><div class="mini">Active time<b>${fmtDur(u.active_seconds)}</b></div><div class="mini">Sessions<b>${Number(u.session_count||0)}</b></div><div class="mini">Music uses<b>${Number(u.music_uses||0)}</b></div><div class="mini">Favorites<b>${Number(u.music_favorites||0)}</b></div><div class="mini">Private tracks<b>${Number(u.private_music_tracks||0)}</b></div></div>
      <div class="muted">Last seen: ${fmtDate(u.last_seen_at)} · Last path: ${esc(u.last_path||'—')}</div>
      <div class="section"><h4>Recent activity</h4>${events}</div>
      <div class="section"><h4>Recent jobs</h4>${jobs}</div>
      <div class="section"><h4>Recent clips</h4>${clips}</div>
      <div class="section"><h4>YouTube activity</h4>${yt}</div>`;
  }
  document.querySelector('#uiReload').onclick=loadUsers; document.querySelector('#uiPlan').onchange=loadUsers; let t; document.querySelector('#uiSearch').oninput=()=>{clearTimeout(t);t=setTimeout(loadUsers,300)};
  const oldLoad=window.load; if(typeof oldLoad==='function'){ window.load=async function(){ await oldLoad.apply(this,arguments); setTimeout(loadUsers,50); }; }
  setTimeout(loadUsers,700);
})();
