(()=>{
  'use strict';
  if(document.getElementById('snipo-promo'))return;
  const path=location.pathname;
  // One campaign, with relevant destinations for each part of the customer journey.
  const campaign={id:'snipo-creator-workspace-v2',label:'YOUR NEXT CREATIVE MOVE',title:'One video. More stories.',body:'Turn your long videos into short-form moments with AI. Add your finishing touches with captions and the Video Studio.',action:'Create your first reel',url:'/start',chips:['AI highlights','Caption styling','Manual editing']};
  if(path==='/start'||path==='/start.html'||path==='/funnel')Object.assign(campaign,{label:'YOUR CREATIVE WORKSPACE IS NEXT',title:'Make your first cut yours.',body:'Choose your source and clip preferences, then continue to your workspace. You review everything before generation starts.',action:'Continue my setup',url:'#funnel-form',chips:['Choose your source','Set your preferences','Review & create']});
  else if(path.startsWith('/app'))Object.assign(campaign,{label:'AI + YOUR CREATIVE CONTROL',title:'Polish your next reel.',body:'Your generated clips are a starting point. Open a folder to edit captions, adjust cuts and export your final video.',action:'Open my folders',url:'/app#projects',chips:['Edit captions','Trim & arrange','Save your export']});
  else if(path==='/pricing'||path==='/pricing.html')Object.assign(campaign,{label:'START WITH YOUR NEXT IDEA',title:'Try your first clips.',body:'Explore the free allowance before choosing a paid plan. Pick your video source and build your first reel workflow.',action:'Start creating',url:'/start'});
  const sessionKey='sc_promo_dismissed_'+campaign.id,snoozeKey='sc_promo_snooze_until';
  let dismissed=false,timer,visible=false;
  try{dismissed=sessionStorage.getItem(sessionKey)==='1'||Number(localStorage.getItem(snoozeKey))>Date.now();}catch{}
  if(dismissed)return;
  const root=document.createElement('aside');root.id='snipo-promo';root.className='snipo-promo';root.hidden=true;root.setAttribute('aria-label','Snipo Clips creator promotion');
  const close=document.createElement('button');close.type='button';close.className='snipo-promo-close';close.setAttribute('aria-label','Dismiss promotion for this visit');close.textContent='×';
  const visual=document.createElement('div');visual.className='snipo-promo-visual';visual.setAttribute('aria-hidden','true');
  const image=document.createElement('img');image.src='/clip-2.jpg';image.alt='';image.width=540;image.height=960;
  const stamp=document.createElement('span');stamp.className='snipo-promo-stamp';stamp.textContent='✦ AI FIRST CUT';
  const wordmark=document.createElement('span');wordmark.className='snipo-promo-brand';wordmark.textContent='SNIPO CLIPS';
  visual.append(image,stamp,wordmark);
  const content=document.createElement('div');content.className='snipo-promo-content';
  const label=document.createElement('span');label.className='snipo-promo-label';label.textContent=campaign.label;
  const title=document.createElement('h2');title.textContent=campaign.title;
  const body=document.createElement('p');body.textContent=campaign.body;
  const chips=document.createElement('ul');chips.className='snipo-promo-chips';campaign.chips.forEach(text=>{const item=document.createElement('li');item.textContent='✓ '+text;chips.append(item);});
  const link=document.createElement('a');link.href=campaign.url;link.className='snipo-promo-action';link.textContent=campaign.action+' ↗';
  const later=document.createElement('button');later.type='button';later.className='snipo-promo-later';later.textContent='Hide promotions for 7 days';
  const note=document.createElement('small');note.className='snipo-promo-note';note.textContent='Use videos you own or have permission to edit.';
  content.append(label,title,body,chips,link,later,note);root.append(visual,close,content);document.body.append(root);
  function dismiss(days=0){dismissed=true;clearTimeout(timer);try{sessionStorage.setItem(sessionKey,'1');}catch{}if(days)try{localStorage.setItem(snoozeKey,String(Date.now()+days*86400000));}catch{}root.remove();document.removeEventListener('keydown',escape);window.removeEventListener('storage',syncDismissal);}
  close.addEventListener('click',()=>dismiss());later.addEventListener('click',()=>dismiss(7));
  link.addEventListener('click',()=>{dismiss();if(campaign.url==='#funnel-form'){const heading=document.querySelector('[data-step]:not([hidden]) h2');if(heading)heading.focus();}});
  function busy(){const active=document.activeElement;return (document.getElementById('snipo-lead')&&!document.getElementById('snipo-lead').hidden)||document.hidden||document.querySelector('dialog[open]')||document.fullscreenElement||active?.matches('input,textarea,select,[contenteditable="true"]')||document.querySelector('#proc.on')||Array.from(document.querySelectorAll('video')).some(v=>!v.paused&&!v.ended);}
  function show(){if(dismissed)return;if(busy()){timer=setTimeout(show,3000);return;}root.hidden=false;visible=true;}
  function escape(event){if(event.key==='Escape'&&visible&&!document.querySelector('dialog[open]'))dismiss();}
  function syncDismissal(event){if(event.key===snoozeKey&&Number(event.newValue)>Date.now())dismiss();}
  window.addEventListener('storage',syncDismissal);document.addEventListener('keydown',escape);
  // No modal overlay or focus steal. Let visitors read before showing the campaign.
  timer=setTimeout(show,18000);
})();
