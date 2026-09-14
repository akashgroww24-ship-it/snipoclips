(function(){
  if(window.__snipoActivityHeartbeat) return;
  window.__snipoActivityHeartbeat = true;
  let timer = null;
  async function beat(){
    if(document.visibilityState !== 'visible') return;
    try{
      if(typeof api !== 'function') return;
      await api('/api/activity/heartbeat', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({ path: location.pathname })
      });
    }catch{}
  }
  function start(){
    if(timer) return;
    beat();
    timer = setInterval(beat, 30000);
  }
  function stop(){ if(timer){ clearInterval(timer); timer=null; } }
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible') start(); else stop(); });
  setTimeout(start, 4000);
})();
