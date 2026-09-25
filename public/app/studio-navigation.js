/* Studio navigation and local, searchable feature help. No account data is sent. */
(() => {
  'use strict';
  const one = s => document.querySelector(s);
  const topics = [
    ['upload','Upload a video','Start','#t-file','Choose an MP4, MOV or WebM up to 1 GB. Your plan also limits video length and monthly minutes.','Choose Upload file, select your video, then press Get clips in 1 click.'],
    ['link','Import a link','Start','#t-url','Use a video URL you have permission to edit. Some sites reject imports; connecting YouTube does not unlock source downloads.','Paste the link. If the import fails, upload your original video file instead.'],
    ['shorts','Long to shorts','Presets','#track .tool:nth-child(1)','Find highlight ranges in a longer video and turn them into short clips. This preset enables karaoke captions and a hook title.','Select the preset, review Options, then submit a video.'],
    ['captions','AI Captions','Presets','#track .tool:nth-child(2)','Select a caption-focused clipping preset with timed word highlighting. It still creates clips from your source video.','Choose the preset and set caption color and language in Options. Check generated text before publishing.'],
    ['moments','Find moments','Presets','#track .tool:nth-child(3)','Highlight selection finds promising sections. This preset enables karaoke and a hook, like Long to shorts; it is not a separate search engine.','Select the preset and submit your video. Review the suggested clips in All projects.'],
    ['hinglish','Hinglish','Presets','#track .tool:nth-child(4)','A caption preset for mixed Hindi and English speech. The preset enables karaoke; language is still controlled separately.','Open Options and use Auto-detect or Hindi as appropriate. Check names and mixed-language words in the result.'],
    ['ratio','Aspect ratio','Options','#ratio','Choose vertical 9:16, square 1:1, portrait 4:5 or landscape 16:9. Cropping can remove content near the edges.','Pick the format before generating. Use face tracking when it suits your source.'],
    ['duration','Clip length','Options','#duration','Auto lets the system choose clip length. Short, Medium and Long guide the highlight selection.','Choose a length before generating; final length depends on suitable sections in your video.'],
    ['count','Clip count','Options','#count','Request a number of clips, or leave Auto count. Available material and plan limits can reduce the result.','Choose the count before starting a job.'],
    ['color','Caption color','Options','#captionStyle','Choose yellow highlight, clean white, mint or pink caption styling.','Select a color before generating. Review readability against your video.'],
    ['look','Clip style','Options','#clipStyle','Choose an editing preset such as Clean look, Punchy, Sigma edit or Meme.','Choose the look, then review individual effects before generating.'],
    ['language','Spoken language','Options','#language','Auto-detect estimates the spoken language. Hindi and English give transcription a language hint; this is not translation.','Choose the language spoken in the source video.'],
    ['karaoke','Karaoke','Effects','@Karaoke','Highlights caption words as they are spoken.','Turn this on in Options before generating.'],
    ['hook','Hook title','Effects','@Hook title','Adds a short opening title to introduce the clip.','Turn this on before generating, then review the title for accuracy.'],
    ['enhance','Enhance audio','Effects','@Enhance audio','Applies audio enhancement during rendering. Results depend on the recording and cannot restore missing speech.','Enable in Options before generating and listen to the exported result.'],
    ['cleanup','Clean up','Effects','@Clean up','Attempts to tighten speech by removing detected filler words and silences.','Enable before generating. Review the result so the cuts preserve your meaning.'],
    ['broll','AI B-roll','Effects','@AI B-roll','Can insert related stock footage when the stock provider is configured and suitable footage is available.','Enable before generating. If no suitable stock footage is available, the original clip may be used.'],
    ['faces','Face tracking','Effects','@Face tracking','Attempts to follow detected faces while reframing the video. A centered crop is used when tracking is unavailable.','Enable before generating and check that the subject stays in frame.'],
    ['keywords','Keyword pop','Effects','@Keyword pop','Emphasizes selected caption words to make them stand out.','Enable in Options and inspect the rendered captions.'],
    ['emoji','Emojis','Effects','@Emojis','Adds matching emoji accents to supported captions.','Enable before generating; review whether the accents suit your content.'],
    ['progress','Progress bar','Effects','@Progress bar','Adds an on-video progress indicator as the clip plays.','Enable before generating. This is different from the job processing indicator.'],
    ['reels','AI Reel Composer','Reels','#reel-open','Combines your generated clips into one reel. Create clips first so the composer has material to work with.','Open the composer, select clips and settings, then choose Create reel.'],
    ['director','Auto Director and manual selection','Reels','#reel-modal .reel-mode','Auto Director can plan the story and reorder selected clips. Manual lets you choose which clips are included.','Open AI Reel Composer and choose a mode. Review selected clips before creating.'],
    ['reel-title','Reel title','Reels','#reel-name','Names the finished reel so you can find it in your projects.','Enter a title of up to 100 characters.'],
    ['reel-length','Reel target length','Reels','#reel-duration','Choose a target of 30, 45, 60 or 90 seconds. Available clips affect the final duration.','Set the target before creating the reel.'],
    ['reel-captions','Reel caption style','Reels','#reel-caption','Apply a consistent caption preset across the reel, or let AI choose.','Choose one of the presets available in your composer.'],
    ['mood','Music mood','Reels','#reel-mood','Guides soundtrack selection when library music is available.','Choose a mood or leave AI chooses.'],
    ['transitions','Transitions','Reels','#reel-transition','Controls how the reel moves between clips.','Choose a transition or let AI select one.'],
    ['music','Music source','Reels','#reel-music-mode','Use the available licensed library, no music, or your own audio that you have rights to use. A streaming subscription does not grant soundtrack rights.','Choose the source in the composer. Library availability depends on configuration.'],
    ['track','Library track','Reels','#reel-track','Choose an available soundtrack for your reel. If Add music is shown, it opens the music picker.','Preview a track where available and confirm your selection before creating the reel.'],
    ['music-file','Upload music','Reels','#reel-music-file','Adds your own licensed audio to a reel.','Choose Upload my own licensed track under Music source, then select the audio file.'],
    ['music-picker','Music preview and mix','Reels','#sm-open','Where the music picker is available, search and preview tracks, save favorites, choose a start point, and balance music with original audio.','Select Add music in the composer, choose a track, adjust the mix, then select Use Audio.'],
    ['projects','Projects and downloads','Library','#projects','Finished clips and reels appear here. Preview your result and use Download to save a copy.','Search projects by title. Save anything you need to keep; stored files are subject to the service retention policy.'],
    ['search','Search projects','Library','#q','Filters the visible project list by your search text.','Type part of the project title; clear the field to see all projects.'],
    ['hide','Hide the upload panel','Start','#hero-x','Hides the upload panel to give your projects more space.','Choose Create clips in the side menu to bring it back.'],
    ['redeem','Redeem an access code','Account','#snipo-promo-open','Eligible free-plan accounts can activate a valid complimentary access code. Codes can expire and have limited uses.','Choose Redeem code in the top bar, enter your code and review the activation result.'],
    ['quota','Minutes and plans','Account','.chip','The minutes badge shows the remaining video allowance returned by your account. Clip limits and upload limits also depend on your plan.','Check the badge before a long upload. Pricing lists the available plans.'],
    ['youtube','YouTube publishing','Account','','Publishing a finished video and importing a YouTube source are different features. Publishing requires configured Google credentials and channel authorization.','If publishing controls are available, connect your channel and review the video and visibility before uploading. Otherwise, download the clip and upload it in YouTube Studio.'],
    ['support','Help and support','Account','#help','Use the help assistant for guidance. Where Report a problem is available, include the step and error text so support can investigate.','Do not include passwords, tokens or payment card details in a report.'],
    ['account','Sign out','Account','#out','Ends the current app session on this browser.','Use Sign out in the top bar when you finish on a shared device.']
  ];
  const escape = s => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const resolve = t => t[3].startsWith('@') ? [...document.querySelectorAll('#pills .pill')].find(e=>e.textContent===t[3].slice(1)) : t[3] ? one(t[3]) : null;
  const nav = document.createElement('aside');
  nav.id='studio-sidebar'; nav.setAttribute('aria-label','Studio sidebar');
  nav.innerHTML=`<div class="studio-side-heading"><a href="/app" class="studio-wordmark">Snipo Clips<span>YOUR CREATIVE STUDIO</span></a><button type="button" id="studio-close" aria-label="Close menu">×</button></div>
    <nav aria-label="Studio"><p class="studio-group">CREATE</p><button type="button" data-studio="create" aria-current="page"><span aria-hidden="true">＋</span>Create clips</button><button type="button" data-studio="reels"><span aria-hidden="true">▶</span>AI Reel Composer</button><p class="studio-group">WORKSPACE</p><button type="button" data-studio="projects"><span aria-hidden="true">▦</span>All projects</button><button type="button" data-studio="guides"><span aria-hidden="true">?</span>Feature guide</button><a href="/pricing"><span aria-hidden="true">◇</span>Plans & pricing</a><button type="button" data-studio="support"><span aria-hidden="true">☏</span>Help & support</button></nav>
    <div class="studio-tip"><b>A little guidance, right here.</b><p>Tap a ? beside a setting to see what it does.</p><button type="button" data-studio="guides">Explore all features →</button></div>`;
  document.body.appendChild(nav);
  const shade=document.createElement('button'); shade.id='studio-shade'; shade.type='button'; shade.tabIndex=-1; shade.setAttribute('aria-label','Close menu'); shade.hidden=true; document.body.appendChild(shade);
  const toggle=document.createElement('button'); toggle.id='studio-menu'; toggle.type='button'; toggle.className='btn ghost'; toggle.innerHTML='<span aria-hidden="true">☰</span><span class="studio-menu-label">Menu</span>'; toggle.setAttribute('aria-controls',nav.id); one('.nav').prepend(toggle);
  document.body.classList.add('studio-navigation');
  const mobile=matchMedia('(max-width: 900px)'); let opened=!mobile.matches;
  function setMenu(value, restore=false){
    opened=value; document.body.classList.toggle('studio-menu-open',opened); toggle.setAttribute('aria-expanded',String(opened));
    nav.inert=!opened; shade.hidden=!(opened&&mobile.matches);
    nav.setAttribute('role',mobile.matches?'dialog':'complementary');
    if(mobile.matches&&opened) nav.setAttribute('aria-modal','true'); else nav.removeAttribute('aria-modal');
    const scene=one('.scene'); if(scene) scene.inert=mobile.matches&&opened;
    if(restore) toggle.focus();
  }
  toggle.addEventListener('click',()=>{setMenu(!opened); if(opened&&mobile.matches)one('#studio-close').focus();});
  one('#studio-close').addEventListener('click',()=>setMenu(false,true)); shade.addEventListener('click',()=>setMenu(false,true));
  mobile.addEventListener('change',()=>setMenu(!mobile.matches)); setMenu(opened);
  nav.addEventListener('keydown',e=>{
    if(!mobile.matches)return;
    if(e.key==='Escape'){e.preventDefault();setMenu(false,true);}
    if(e.key==='Tab'){
      const nodes=[...nav.querySelectorAll('a,button')], first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  const dialog=document.createElement('dialog'); dialog.id='studio-guide'; dialog.setAttribute('aria-labelledby','studio-guide-title');
  dialog.innerHTML=`<header><div><p class="studio-group">LEARN AS YOU CREATE</p><h2 id="studio-guide-title">Feature guide</h2></div><button type="button" id="studio-guide-close" aria-label="Close feature guide">×</button></header><p class="studio-guide-intro">What it does, how to use it, and where to find it.</p><label for="studio-guide-search">Find a feature</label><input type="search" id="studio-guide-search" placeholder="Try captions, music or downloads…"><p id="studio-guide-count" role="status"></p><div id="studio-guide-results"></div>`;
  document.body.appendChild(dialog);
  function render(query='',active=''){
    const matches=topics.filter(t=>t.join(' ').toLowerCase().includes(query.trim().toLowerCase()));
    one('#studio-guide-count').textContent=matches.length+' features';
    one('#studio-guide-results').innerHTML=matches.length?matches.map(t=>`<details data-topic="${t[0]}" ${t[0]===active?'open':''}><summary><span>${escape(t[1])}</span><small>${t[2]}</small></summary><div class="studio-guide-copy"><p>${escape(t[4])}</p><p><b>How to use it</b><br>${escape(t[5])}</p>${t[3]?`<button type="button" class="btn ghost" data-show="${t[0]}">Show me →</button>`:''}</div></details>`).join(''):'<p class="studio-no-results">No matching feature. Try “captions”, “reel” or “audio”.</p>';
  }
  function showGuide(id=''){
    if(mobile.matches&&opened)setMenu(false);
    one('#studio-guide-search').value=''; render('',id); dialog.showModal();
    if(id){const item=dialog.querySelector(`[data-topic="${id}"]`);item.scrollIntoView({block:'nearest'});item.querySelector('summary').focus();}
    else one('#studio-guide-search').focus();
  }
  one('#studio-guide-search').addEventListener('input',e=>render(e.target.value));
  one('#studio-guide-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  let focusTimer;
  function locate(t){
    if(t[2]==='Options'||t[2]==='Effects'){one('.hero').style.display='';one('#panel').classList.add('open');one('#opt-btn').setAttribute('aria-expanded','true');}
    if(t[2]==='Reels'&&t[0]!=='reels'&&!one('#reel-modal')?.classList.contains('on'))one('#reel-open')?.click();
    if(t[0]==='music-file'){const source=one('#reel-music-mode');source.value='upload';source.dispatchEvent(new Event('change',{bubbles:true}));}
    const target=resolve(t);
    if(!target||!target.getClientRects().length){showGuide(t[0]);return;}
    target.scrollIntoView({block:'center',behavior:'auto'}); if(!target.matches('button,input,select,a'))target.tabIndex=-1; target.focus();
    document.querySelectorAll('.studio-highlight').forEach(el=>el.classList.remove('studio-highlight'));
    target.classList.add('studio-highlight');clearTimeout(focusTimer);focusTimer=setTimeout(()=>target.classList.remove('studio-highlight'),2400);
  }
  dialog.addEventListener('click',e=>{const b=e.target.closest('[data-show]');if(!b)return;const topic=topics.find(t=>t[0]===b.dataset.show);dialog.close();locate(topic);});
  nav.addEventListener('click',e=>{
    const b=e.target.closest('[data-studio]');if(!b)return;
    if(mobile.matches)setMenu(false);
    const action=b.dataset.studio;
    if(action==='guides')return showGuide();
    if(action==='support')return showGuide('support');
    nav.querySelectorAll('[aria-current]').forEach(el=>el.removeAttribute('aria-current'));
    if(action==='create'||action==='projects')b.setAttribute('aria-current','page');
    if(action==='create'){one('.hero').style.display='';one('.hero').scrollIntoView({block:'center'});one('#t-url').focus();}
    if(action==='projects')locate(topics.find(t=>t[0]==='projects'));
    if(action==='reels')one('#reel-open')?.click();
  });
  function addHelp(){
    topics.forEach(t=>{
      if(!['Options','Effects','Reels'].includes(t[2])||['reels','director'].includes(t[0]))return;
      const control=resolve(t); if(!control||control.dataset.studioHelp)return;
      control.dataset.studioHelp=t[0];
      if(!control.getAttribute('aria-label')&&!control.labels?.length)control.setAttribute('aria-label',t[1]);
      const note=document.createElement('span');note.id='studio-desc-'+t[0];note.className='sr';note.textContent=t[4];
      control.setAttribute('aria-describedby',[control.getAttribute('aria-describedby'),note.id].filter(Boolean).join(' '));
      const button=document.createElement('button');button.type='button';button.className='studio-info';button.textContent='?';button.setAttribute('aria-label','About '+t[1]);button.addEventListener('click',()=>showGuide(t[0]));
      const wrap=document.createElement('span');wrap.className='studio-control';control.before(wrap);wrap.append(control,button,note);
    });
  }
  addHelp();
  // Optional music controls can arrive after the composer is installed.
  new MutationObserver(()=>addHelp()).observe(document.body,{childList:true,subtree:true});
  const quick=document.createElement('button');quick.type='button';quick.className='studio-quick-guide';quick.textContent='? How these tools work';quick.addEventListener('click',()=>showGuide('shorts'));one('.tools').after(quick);
  one('#url').setAttribute('aria-label','Source video URL');one('#q').setAttribute('aria-label','Search projects');
})();
