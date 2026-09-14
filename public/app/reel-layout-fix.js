/* Keeps the AI Reel launcher inside the native project toolbar so it never overlaps Search/Newest. */
(function(){
  function placeReelButton(){
    const controls=document.querySelector('#projects .sec-r');
    if(!controls) return;

    let button=document.querySelector('#reel-open');
    if(!button){
      const oldBar=document.querySelector('#reel-project-bar');
      button=oldBar && oldBar.querySelector('.reel-launch');
    }
    if(!button) return;

    const oldBar=button.closest('.reel-project-bar');
    controls.appendChild(button);
    button.classList.add('reel-toolbar-btn');
    if(oldBar) oldBar.remove();
  }

  const style=document.createElement('style');
  style.textContent=`
    #projects .sec-h{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    #projects .sec-r{margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap;min-width:0}
    #projects .sec-r .ctl{flex:0 0 auto}
    #projects .sec-r label.ctl{min-width:180px;max-width:260px}
    #projects .sec-r label.ctl input{min-width:0;width:100%}
    #projects .reel-toolbar-btn{position:static!important;margin:0!important;flex:0 0 auto;white-space:nowrap;min-height:40px;padding:0 15px;border-radius:12px;z-index:auto!important}
    #reel-project-bar{display:none!important}
    @media(max-width:980px){
      #projects .sec-r{width:100%;margin-left:0;justify-content:flex-start}
      #projects .sec-r label.ctl{flex:1 1 220px;max-width:none}
      #projects .reel-toolbar-btn{margin-left:auto!important}
    }
    @media(max-width:620px){
      #projects .sec-r{display:grid;grid-template-columns:auto 1fr;gap:8px;width:100%}
      #projects .sec-r label.ctl{grid-column:1/-1;max-width:none;width:100%}
      #projects .reel-toolbar-btn{margin-left:0!important;width:100%;justify-content:center;grid-column:1/-1}
    }
  `;
  document.head.appendChild(style);

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',placeReelButton);
  else placeReelButton();

  // reel-integrated.js may install its launcher after this script on a cached page.
  setTimeout(placeReelButton,50);
  setTimeout(placeReelButton,400);
})();
