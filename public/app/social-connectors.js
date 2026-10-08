/* Meta publishing UI. Users always select a finished clip, destination and caption. */
(()=>{
  const byId=id=>document.getElementById(id);
  let callbackNotice='',configured={};
  let accounts=[],selectedClip=null,attemptKey=null,pollTimer=null;
  const state=byId('meta-state'),list=byId('meta-accounts'),publications=byId('meta-publications');
  const dialog=byId('social-publish-dialog');
  const label=a=>(a.provider==='instagram'?'Instagram':'Facebook Page')+' · '+a.display_name;
  async function loadAccounts(){
    try{
      const result=await api('/api/social/accounts',{cache:'no-store'});
      accounts=result.accounts||[];configured=result.configured||{};
      const unavailable=['instagram','facebook'].filter(p=>!configured[p]).map(p=>p==='instagram'?'Instagram':'Facebook');
      state.textContent=[callbackNotice,accounts.length?`${accounts.length} connected account${accounts.length===1?'':'s'}`:'No Meta accounts connected.',unavailable.length?unavailable.join(' and ')+' publishing awaits server setup. You can still download your clips.':''].filter(Boolean).join(' ');
      for(const provider of ['instagram','facebook']){
        const button=byId(provider+'-connect');
        button.disabled=!result.configured?.[provider]||!byId('meta-consent').checked;
        button.title=result.configured?.[provider]?'Connect with Meta':'Waiting for Meta app setup';
      }
      list.replaceChildren();
      for(const account of accounts){
        const row=document.createElement('div');row.className='social-account-row';
        const name=document.createElement('span');name.textContent=label(account)+(account.status==='connected'?'':' · Reconnect required');
        const remove=document.createElement('button');remove.type='button';remove.className='btn ghost';remove.textContent='Disconnect';
        remove.onclick=async()=>{
          if(!confirm('Disconnect '+label(account)+' and remove its publication history from Snipoclip?'))return;
          remove.disabled=true;
          try{await api('/api/social/accounts/'+encodeURIComponent(account.id),{method:'DELETE'});await loadAccounts();await loadPublications();}
          catch{remove.disabled=false;state.textContent='Could not disconnect. Please try again.';}
        };
        row.append(name,remove);list.appendChild(row);
      }
      window.socialHasAccounts=accounts.some(a=>a.status==='connected');
      if(typeof draw==='function')draw();
    }catch{state.textContent='Connections unavailable. Reload to try again.';}
  }
  async function loadPublications(){
    try{
      const result=await api('/api/social/publications',{cache:'no-store'});
      const rows=result.publications||[];publications.replaceChildren();
      if(!rows.length){publications.textContent='No Reels published from Snipoclip yet.';return;}
      for(const p of rows){
        const row=document.createElement('div');row.className='social-publication-row';
        const account=accounts.find(a=>a.id===p.account_id);
        const text=document.createElement('span');text.textContent=(account?label(account):'Disconnected account')+' · '+p.status.replace('_',' ')+(p.error_code?' · '+p.error_code.replaceAll('_',' ').toLowerCase():'');
        row.appendChild(text);
        if(p.status==='published'&&p.permalink&&/^https:\/\/(www\.)?(instagram\.com|facebook\.com)\//.test(p.permalink)){
          const link=document.createElement('a');link.href=p.permalink;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View Reel';row.appendChild(link);
        }
        publications.appendChild(row);
      }
      if(rows.some(p=>['queued','preparing','uploading','processing','publishing'].includes(p.status))){
        if(!pollTimer)pollTimer=setTimeout(()=>{pollTimer=null;loadPublications();},10000);
      }else if(pollTimer){clearTimeout(pollTimer);pollTimer=null;}
    }catch{publications.textContent='Could not load publication status.';}
  }
  byId('meta-consent').onchange=()=>{
    for(const provider of ['instagram','facebook']){
      const button=byId(provider+'-connect');
      button.disabled=!byId('meta-consent').checked||!configured[provider];
    }
  };
  for(const provider of ['instagram','facebook'])byId(provider+'-connect').onclick=async()=>{
    const button=byId(provider+'-connect');button.disabled=true;
    try{
      const result=await api('/api/social/'+provider+'/connect',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({consent:byId('meta-consent').checked})});
      location.assign(result.url);
    }catch(e){state.textContent=e.message||'Could not start connection';button.disabled=false;}
  };
  window.openSocialPublish=clip=>{
    const available=accounts.filter(a=>a.status==='connected');
    if(!available.length){state.textContent='Connect an eligible account first.';byId('social-accounts').scrollIntoView({behavior:'smooth'});return;}
    selectedClip=clip;attemptKey=crypto.randomUUID();
    const select=byId('social-target');select.replaceChildren();
    for(const account of available){const option=document.createElement('option');option.value=account.id;option.textContent=label(account);select.appendChild(option);}
    byId('social-caption').value=clip.social_caption||clip.title||'';
    byId('social-publish-consent').checked=false;byId('social-publish-error').textContent='';
    dialog.showModal();
  };
  byId('social-publish-cancel').onclick=()=>dialog.close();
  byId('social-publish-form').onsubmit=async event=>{
    event.preventDefault();if(!selectedClip||!byId('social-publish-consent').checked)return;
    const button=byId('social-publish-confirm');button.disabled=true;
    byId('social-publish-error').textContent='';
    try{
      await api('/api/social/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        accountId:byId('social-target').value,clipId:selectedClip.id,idempotencyKey:attemptKey,
        caption:byId('social-caption').value,consent:true
      })});
      dialog.close();await loadPublications();byId('social-accounts').scrollIntoView({behavior:'smooth'});
    }catch(e){byId('social-publish-error').textContent=e.message||'Could not queue Reel. Try again.';}
    finally{button.disabled=false;}
  };
  const outcome=new URLSearchParams(location.search).get('social');
  if(outcome){
    const reason=new URLSearchParams(location.search).get('socialReason');
    const messages={setup:'This connector needs server setup.',expired:'Connection expired. Start Connect again.',denied:'Authorization was cancelled or refused. Try again and grant the publishing permissions.',professional:'Use an Instagram Business or Creator account.',page:'Choose a Facebook Page where you can create content.',permissions:'Publishing permission was not granted. Reconnect and approve the requested permissions.',failed:'Connection could not finish. Check account eligibility and app access, then retry.'};
    callbackNotice=outcome==='connected'?'Account connected.':messages[reason]||messages.failed;
    const url=new URL(location.href);url.searchParams.delete('social');url.searchParams.delete('socialReason');history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  loadAccounts().then(loadPublications);
})();
