(()=>{
  'use strict';
  if(document.getElementById('snipo-promo'))return;
  // Shared campaign content for every page. Change this one object for a new promotion.
  const campaign={id:'snipo-creator-workspace-v1',label:'SNIPO CLIPS · CREATOR WORKSPACE',title:'Your next reel starts here.',body:'Let AI find your highlights. Make the final cut yours with captions, music and the Video Studio.',action:'Explore Snipo Clips',url:'/start#create'};
  const key='sc_promo_dismissed_'+campaign.id;
  let dismissed=false,timer;
  try{dismissed=sessionStorage.getItem(key)==='1';}catch{}
  if(dismissed)return;
  const root=document.createElement('aside');root.id='snipo-promo';root.className='snipo-promo';root.hidden=true;root.setAttribute('aria-label','Snipo Clips promotion');
  const close=document.createElement('button');close.type='button';close.className='snipo-promo-close';close.setAttribute('aria-label','Dismiss promotion');close.textContent='×';
  const label=document.createElement('span');label.className='snipo-promo-label';label.textContent=campaign.label;
  const title=document.createElement('h2');title.textContent=campaign.title;
  const body=document.createElement('p');body.textContent=campaign.body;
  const link=document.createElement('a');link.href=campaign.url;link.className='snipo-promo-action';link.textContent=campaign.action+' ↗';
  const later=document.createElement('button');later.type='button';later.className='snipo-promo-later';later.textContent='Not now';
  root.append(close,label,title,body,link,later);document.body.append(root);
  function dismiss(){dismissed=true;clearTimeout(timer);try{sessionStorage.setItem(key,'1');}catch{}root.remove();}
  close.addEventListener('click',dismiss);later.addEventListener('click',dismiss);link.addEventListener('click',dismiss);
  function show(){
    if(dismissed)return;
    // Leave sign-in, editing dialogs and fullscreen video unobstructed.
    if(document.hidden||document.querySelector('dialog[open]')||document.fullscreenElement){timer=setTimeout(show,2000);return;}
    root.hidden=false;
  }
  timer=setTimeout(show,7000);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!root.hidden&&!document.querySelector('dialog[open]'))dismiss();});
})();
