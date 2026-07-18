/* motion.js — SnipoClips motion layer (self-contained, additive).
   Drop-in: <script src="/motion.js" defer></script>. It only READS existing
   elements and animates transform/opacity (GPU) — no markup or logic changes.
   Fully respects prefers-reduced-motion: if set, everything is instantly visible.
*/
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- inject the CSS this layer needs (scoped, low-risk class names) ---- */
  var css = `
  @media (prefers-reduced-motion: no-preference){
    [data-mo]{opacity:0;transform:translateY(18px);
      transition:opacity .55s cubic-bezier(.22,.61,.36,1),transform .55s cubic-bezier(.22,.61,.36,1);will-change:opacity,transform}
    [data-mo="left"]{transform:translateX(-24px)}
    [data-mo="right"]{transform:translateX(24px)}
    [data-mo="scale"]{transform:scale(.94)}
    [data-mo].mo-in{opacity:1;transform:none}
    /* page enter */
    body.mo-page{animation:moPage .5s cubic-bezier(.22,.61,.36,1) both}
    @keyframes moPage{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
    /* button press + ripple (opt-in via .mo-btn, auto-applied to .btn/.btn-primary/#go) */
    .mo-btn{position:relative;overflow:hidden;transition:transform .12s ease}
    .mo-btn:active{transform:scale(.97)}
    .mo-ripple{position:absolute;border-radius:50%;transform:scale(0);opacity:.5;
      background:rgba(255,255,255,.45);pointer-events:none;animation:moRip .55s ease-out forwards}
    @keyframes moRip{to{transform:scale(2.6);opacity:0}}
  }`;
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

  if (reduce) return; // motion off — elements stay as-is (fully visible), nothing else runs

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('mo-page');

    /* ---- 1) mark scroll-reveal targets that exist on these pages ---- */
    var sel = 'section .card, section .step, section .feat, section .price, section .q, ' +
              '.clip, .stat, .tcard, .band > .wrap > *';
    // hero children get a staggered reveal
    var hero = document.querySelector('.hero');
    if (hero) {
      ['.pill', 'h1', '.sub', '.hero-cta', '.hero-note'].forEach(function (q, i) {
        var el = hero.querySelector(q);
        if (el) { el.setAttribute('data-mo', ''); el.style.transitionDelay = (i * 90) + 'ms'; }
      });
    }
    // section blocks + card-like items
    document.querySelectorAll('section.band, ' + sel).forEach(function (el) {
      if (!el.hasAttribute('data-mo')) el.setAttribute('data-mo', '');
    });
    // stagger siblings within a row
    document.querySelectorAll('section.band .wrap').forEach(function (row) {
      var kids = row.querySelectorAll(':scope > [data-mo]');
      kids.forEach(function (k, i) { k.style.transitionDelay = Math.min(i * 80, 400) + 'ms'; });
    });

    /* ---- 2) reveal on scroll via IntersectionObserver ---- */
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('mo-in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
      document.querySelectorAll('[data-mo]').forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll('[data-mo]').forEach(function (el) { el.classList.add('mo-in'); });
    }

    /* ---- 3) count-up for numbers marked data-count="1234" ---- */
    function countUp(el) {
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      var dur = 1100, t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }
    if ('IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      document.querySelectorAll('[data-count]').forEach(function (el) { cio.observe(el); });
    }

    /* ---- 4) button ripple + press feel on existing buttons ---- */
    document.querySelectorAll('.btn, .btn-primary, #go, button.primary').forEach(function (b) {
      b.classList.add('mo-btn');
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('.mo-btn'); if (!b) return;
      var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
      var sp = document.createElement('span'); sp.className = 'mo-ripple';
      sp.style.width = sp.style.height = d + 'px';
      sp.style.left = (ev.clientX - r.left - d / 2) + 'px';
      sp.style.top = (ev.clientY - r.top - d / 2) + 'px';
      b.appendChild(sp); setTimeout(function () { sp.remove(); }, 600);
    });

    /* ---- 5) subtle hero parallax on pointer move (desktop only) ---- */
    if (hero && window.matchMedia('(pointer:fine)').matches) {
      var layers = hero.querySelectorAll('h1, .demo, .preview, .hero-visual');
      hero.addEventListener('pointermove', function (e) {
        var cx = (e.clientX / window.innerWidth - 0.5), cy = (e.clientY / window.innerHeight - 0.5);
        layers.forEach(function (l, i) {
          var depth = (i + 1) * 4;
          l.style.transform = 'translate(' + (cx * depth) + 'px,' + (cy * depth) + 'px)';
        });
      });
      hero.addEventListener('pointerleave', function () {
        layers.forEach(function (l) { l.style.transform = ''; });
      });
    }
  });
})();
