/* Snipo Clips — accessible product-help assistant. Loads after app.js. */
(function () {
  'use strict';
  const trigger = document.getElementById('help');
  if (!trigger || document.getElementById('snipo-help-panel')) return;

  const css = `
  #help{z-index:11000!important}#snipo-help-panel{box-sizing:border-box;position:fixed;z-index:11001;right:20px;bottom:84px;width:min(410px,calc(100vw - 28px));height:min(600px,calc(100dvh - 112px));display:none;flex-direction:column;background:#121024;color:#f7f4ff;border:1px solid rgba(191,151,255,.36);box-shadow:0 22px 75px rgba(0,0,0,.55);border-radius:22px;overflow:hidden;font:13px/1.55 'Plus Jakarta Sans',system-ui,sans-serif}#snipo-help-panel.open{display:flex}#snipo-help-panel *{box-sizing:border-box}#snipo-help-panel button,#snipo-help-panel textarea{font:inherit}#snipo-help-panel .sh-head{background:linear-gradient(115deg,#36226a,#732c85);padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px}#snipo-help-panel .sh-head strong{font-size:15px;display:block}#snipo-help-panel .sh-head small{display:block;color:#ddd0f9;font-size:11px}#snipo-help-panel .sh-x{border:1px solid rgba(255,255,255,.35);border-radius:9px;width:32px;height:32px;color:white;background:transparent;cursor:pointer}#snipo-help-panel .sh-feed{padding:14px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;flex:1;overscroll-behavior:contain}#snipo-help-panel .sh-msg{max-width:94%;padding:10px 12px;border-radius:14px;white-space:pre-wrap;overflow-wrap:anywhere;background:#29203d;align-self:flex-start}#snipo-help-panel .sh-msg.user{background:#6439a0;align-self:flex-end}#snipo-help-panel .sh-msg small{display:block;color:#c8b4ee;font-size:10px;margin-bottom:3px}#snipo-help-panel .sh-msg.user small{color:#e6d9fb}#snipo-help-panel .sh-msg a{color:#c7a2ff;display:inline-block;margin-top:7px;font-weight:700}#snipo-help-panel .sh-chips{padding:9px 13px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid #352c4a;max-height:102px;overflow:auto}#snipo-help-panel .sh-chips button{background:#29203e;border:1px solid #5a497a;border-radius:999px;color:#e8ddff;padding:5px 9px;cursor:pointer;font-size:11px}#snipo-help-panel .sh-chips button:hover{border-color:#b584ff}#snipo-help-panel .sh-input{padding:10px 12px;display:flex;gap:8px;border-top:1px solid #352c4a}#snipo-help-panel textarea{min-height:42px;max-height:90px;resize:vertical;flex:1;border:1px solid #5a497a;border-radius:11px;background:#1e1830;color:#fff;padding:9px;outline:none}#snipo-help-panel textarea:focus{border-color:#b584ff}#snipo-help-panel .sh-send,#snipo-help-panel .sh-report-send{background:#9f55e8;color:#fff;border:0;border-radius:11px;padding:8px 13px;font-weight:800;cursor:pointer}#snipo-help-panel button:disabled{opacity:.6;cursor:wait}#snipo-help-panel .sh-bottom{padding:8px 12px 11px;border-top:1px solid #352c4a;display:flex;justify-content:space-between;gap:10px;align-items:center}#snipo-help-panel .sh-bottom button{background:transparent;color:#d8b0ff;border:0;cursor:pointer;font-size:11px;text-decoration:underline}#snipo-help-panel .sh-bottom span{color:#a89bbf;font-size:10px}#snipo-help-panel .sh-report{display:none;flex-direction:column;gap:9px;padding:14px;flex:1;min-height:0}#snipo-help-panel .sh-report.show{display:flex}#snipo-help-panel .sh-report textarea{flex:1;max-height:none;min-height:110px}#snipo-help-panel .sh-report-actions{display:flex;gap:8px}#snipo-help-panel .sh-back{background:transparent;color:#e1c5ff;border:1px solid #67517e;border-radius:10px;padding:8px 12px;cursor:pointer}#snipo-help-panel .sh-note{font-size:11px;color:#b9afc8;margin:0}#snipo-help-panel .sh-status{font-size:11px;min-height:14px;color:#c8b4ee;padding:0 14px}#snipo-help-panel .sh-feed.hidden,#snipo-help-panel .sh-input.hidden,#snipo-help-panel .sh-chips.hidden,#snipo-help-panel .sh-bottom.hidden{display:none}@media(max-width:540px){#snipo-help-panel{right:8px;bottom:76px;width:calc(100vw - 16px);height:min(630px,calc(100dvh - 92px))}}
  `;
  const style = document.createElement('style'); style.textContent=css; document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id='snipo-help-panel'; panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-label','Snipo help assistant');
  panel.innerHTML=`<div class="sh-head"><div><strong>✦ Snipo Help</strong><small>Ask in English, Hindi or Hinglish</small></div><button type="button" class="sh-x" aria-label="Close help">×</button></div><div class="sh-feed" role="log" aria-live="polite" aria-relevant="additions"></div><div class="sh-chips" aria-label="Popular help topics"></div><div class="sh-status" role="status" aria-live="polite"></div><form class="sh-input"><textarea aria-label="Ask Snipo a question" maxlength="1000" rows="2" placeholder="Ask me how to use Snipo…" required></textarea><button type="submit" class="sh-send">Send</button></form><div class="sh-bottom"><button type="button" class="sh-report-link">Report a problem →</button><span>No passwords or payment details</span></div><form class="sh-report"><strong>Report a problem</strong><p class="sh-note">Describe what happened and include the exact error. Reports go to the Snipo support/admin team. Never include passwords, tokens or card details.</p><textarea aria-label="Describe your problem" maxlength="2000" minlength="10" required placeholder="What were you trying to do? What error did you see?"></textarea><div class="sh-report-actions"><button type="button" class="sh-back">Back to help</button><button type="submit" class="sh-report-send">Send report</button></div></form>`;
  document.body.appendChild(panel);
  const feed=panel.querySelector('.sh-feed'), chips=panel.querySelector('.sh-chips'), status=panel.querySelector('.sh-status');
  const askForm=panel.querySelector('.sh-input'), askInput=askForm.querySelector('textarea'), reportForm=panel.querySelector('.sh-report');
  let busy=false, initialized=false, lastFocus=null;

  function message(text, who, link) {
    const item=document.createElement('div');item.className='sh-msg'+(who==='user'?' user':'');
    const label=document.createElement('small'); label.textContent=who==='user'?'You':'Snipo Support';item.appendChild(label);
    const content=document.createElement('span'); content.textContent=String(text||'');item.appendChild(content);
    if(link && ['/app','/login','/pricing','/faq'].includes(link)){
      const a=document.createElement('a');a.href=link;a.textContent='Open related page →';item.appendChild(a);
    }
    feed.appendChild(item);feed.scrollTop=feed.scrollHeight;
  }
  function showTopics(topics){
    chips.replaceChildren();
    for(const topic of (topics||[]).slice(0,8)){
      if(!topic || !topic.id || !topic.title) continue;
      const b=document.createElement('button');b.type='button';b.textContent=topic.title;
      b.addEventListener('click',()=>ask('',topic.id,topic.title));chips.appendChild(b);
    }
  }
  async function post(path,body){
    const token=typeof authToken==='function'?await authToken():null;
    if(!token) throw new Error('Please sign in again to use support.');
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(result.error||'Request failed. Please try again.');
    return result;
  }
  async function init(){
    if(initialized)return;initialized=true;
    message('Hi! I can help with importing videos, making clips, editing captions, downloads, reels, music and billing. Ask in your own words, or choose a topic below. If something is broken, use Report a problem.','assistant');
    try{
      const token=typeof authToken==='function'?await authToken():null;
      if(!token)throw new Error('Sign in to use support.');
      const response=await fetch('/api/help/topics',{headers:{Authorization:'Bearer '+token},credentials:'same-origin'});
      if(!response.ok)throw new Error('Help topics are temporarily unavailable.');
      const data=await response.json();showTopics((data.topics||[]).slice(0,8));
    }catch(e){status.textContent=e.message;}
  }
  function toggle(open){
    panel.classList.toggle('open',open);trigger.setAttribute('aria-expanded',String(open));
    if(open){lastFocus=document.activeElement;init();askInput.focus();}
    else if(lastFocus && typeof lastFocus.focus==='function')lastFocus.focus();
  }
  trigger.onclick=()=>toggle(!panel.classList.contains('open'));
  trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');
  panel.querySelector('.sh-x').onclick=()=>toggle(false);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')toggle(false);});

  async function ask(question,topicId,title){
    if(busy)return;
    busy=true;status.textContent='Finding an answer…';askForm.querySelector('button').disabled=true;
    message(question||title||'Help topic','user');
    try{
      const data=await post('/api/help/ask',{question,topicId});
      message(data.reply||'Could you rephrase that question?','assistant',data.link);
      if(Array.isArray(data.topics)&&data.topics.length)showTopics(data.topics);
      status.textContent='';
    }catch(e){message(e.message+' If the issue persists, choose Report a problem.','assistant');status.textContent='';}
    finally{busy=false;askForm.querySelector('button').disabled=false;askInput.focus();}
  }
  askForm.addEventListener('submit',e=>{e.preventDefault();const question=askInput.value.trim();if(!question)return;askInput.value='';ask(question);});
  askInput.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();askForm.requestSubmit();}});

  function reportMode(on){
    reportForm.classList.toggle('show',on);
    for(const el of [feed,askForm,chips,panel.querySelector('.sh-bottom')])el.classList.toggle('hidden',on);
    status.textContent='';
    if(on)reportForm.querySelector('textarea').focus();else askInput.focus();
  }
  panel.querySelector('.sh-report-link').onclick=()=>reportMode(true);
  panel.querySelector('.sh-back').onclick=()=>reportMode(false);
  reportForm.addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const input=reportForm.querySelector('textarea');const details=input.value.trim();
    if(details.length<10){status.textContent='Please add a little more detail.';return;}
    busy=true;reportForm.querySelector('.sh-report-send').disabled=true;status.textContent='Sending report…';
    try{
      await post('/api/help/report',{message:details,path:location.pathname});
      input.value='';reportMode(false);message('Your report was sent to the Snipo support team. Thanks for sharing the details.','assistant');
    }catch(err){status.textContent=err.message;}
    finally{busy=false;reportForm.querySelector('.sh-report-send').disabled=false;}
  });
})();
