/* Adds selected Snipo Music section + mix levels to Reel Composer requests. */
(function(){
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url === '/api/reels' && init && init.method === 'POST' && init.body instanceof FormData) {
        const start = document.querySelector('#reel-music-start');
        const musicVolume = document.querySelector('#reel-music-volume');
        const originalVolume = document.querySelector('#reel-original-volume');
        if (start) init.body.set('musicStart', String(Number(start.value) || 0));
        if (musicVolume) init.body.set('musicVolume', String(Math.max(0,Math.min(1,Number(musicVolume.value)||0))));
        if (originalVolume) init.body.set('originalVolume', String(Math.max(0,Math.min(1,Number(originalVolume.value)||0))));
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };
})();
