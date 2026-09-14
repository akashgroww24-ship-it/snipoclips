/* Adds the exact selected Snipo Music start offset to Reel Composer requests. */
(function(){
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url === '/api/reels' && init && init.method === 'POST' && init.body instanceof FormData) {
        const start = document.querySelector('#reel-music-start');
        if (start) init.body.set('musicStart', String(Number(start.value) || 0));
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };
})();
