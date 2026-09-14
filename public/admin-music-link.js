(function(){
  if(document.querySelector('#snipo-music-admin-link')) return;
  const a=document.createElement('a');
  a.id='snipo-music-admin-link';
  a.href='/admin-music.html';
  a.textContent='♫ Music Library';
  a.style.cssText='position:fixed;right:24px;bottom:24px;z-index:9999;padding:11px 15px;border-radius:12px;border:1px solid rgba(229,73,200,.45);background:linear-gradient(135deg,rgba(124,58,237,.96),rgba(229,73,200,.92));color:#fff;text-decoration:none;font:700 12px/1.2 system-ui,sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.35)';
  document.body.appendChild(a);
})();
