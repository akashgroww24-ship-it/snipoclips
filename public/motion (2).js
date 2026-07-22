/* motion.js v2 — SnipoClips motion layer (vanilla, no framework).
   Drop-in: <script src="/motion.js" defer></script>
   v2 makes motion CLEARLY VISIBLE (v1 was too subtle to notice):
     - reveals travel 48px (was 18) over .8s, with real stagger
     - page entrance rises 28px and fades (was 10px)
     - TRUE scroll parallax: layers drift as you scroll, not just on hover
     - hover lift + glow on cards, ripple + press on buttons
     - magnetic pull on primary CTAs, count-up for [data-count]
   GPU-only (transform/opacity). Fully disabled under prefers-reduced-motion.
*/
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = [
  '@media (prefers-reduced-motion: no-preference){',
  '[data-mo]{opacity:0;transform:translate3d(0,48px,0);',
  'transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1);will-change:opacity,transform}',
  '[data-mo="left"]{transform:translate3d(-60px,0,0)}',
  '[data-mo="right"]{transform:translate3d(60px,0,0)}',
  '[data-mo="scale"]{transform:scale(.88)}',
  '[data-mo].mo-in{opacity:1;transform:none;filter:none}',
  'body.mo-page{animation:moPage .7s cubic-bezier(.16,1,.3,1) both}',
  '@keyframes moPage{from{opacity:0;transform:translate3d(0,28px,0)}to{opacity:1;transform:none}}',
  '.mo-btn{position:relative;overflow:hidden;transition:transform .18s cubic-bezier(.16,1,.3,1),box-shadow .25s ease,filter .2s ease}',
  '.mo-btn:hover{transform:translateY(-3px) scale(1.03);filter:brightness(1.08)}',
  '.mo-btn:active{transform:translateY(0) scale(.96)}',
  '.mo-ripple{position:absolute;border-radius:50%;transform:scale(0);opacity:.55;background:rgba(255,255,255,.5);pointer-events:none;animation:moRip .65s cubic-bezier(.16,1,.3,1) forwards}',
  '@keyframes moRip{to{transform:scale(3);opacity:0}}',
  '.mo-card{transition:transform .35s cubic-bezier(.16,1,.3,1),box-shadow .35s ease,border-color .35s ease;will-change:transform}',
  '.mo-card:hover{transform:translateY(-8px) scale(1.015);box-shadow:0 22px 50px -18px rgba(0,0,0,.75),0 0 34px -14px rgba(124,58,237,.55)}',
  '.mo-par{will-change:transform}',
  '}'].join('');
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

  if (reduce) return;

  document.addEventListener('DOMContentLoaded', function () {
    document.body.classList.add('mo-page');

    /* 1) mark reveal targets */
    var hero = document.querySelector('.hero');
    if (hero) {
      ['.pill', 'h1', '.sub', '.hero-cta', '.hero-note'].forEach(function (q, i) {
        var el = hero.querySelector(q);
        if (el) { el.setAttribute('data-mo', ''); el.style.transitionDelay = (i * 130) + 'ms'; }
      });
    }
    var cardSel = 'section .card, section .step, section .feat, section .price, section .q, .clip, .stat, .tcard';
    document.querySelectorAll('section.band, ' + cardSel).forEach(function (el) {
      if (!el.hasAttribute('data-mo')) el.setAttribute('data-mo', '');
    });
    document.querySelectorAll('section.band .wrap').forEach(function (row) {
      var kids = row.querySelectorAll(':scope > [data-mo]');
      kids.forEach(function (k, i) { k.style.transitionDelay = Math.min(i * 120, 600) + 'ms'; });
    });
    document.querySelectorAll(cardSel).forEach(function (c) { c.classList.add('mo-card'); });

    /* 2) reveal on scroll */
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('mo-in'); io.unobserve(e.target); } });
      }, { threshold: 0.1, rootMargin: '0px 0px -10% 0px' });
      document.querySelectorAll('[data-mo]').forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll('[data-mo]').forEach(function (el) { el.classList.add('mo-in'); });
    }

    /* 3) TRUE scroll parallax */
    var parallax = [];
    document.querySelectorAll('[data-par], .hero .demo, .hero .preview, .hero-visual, .hero .phone').forEach(function (el, i) {
      el.classList.add('mo-par');
      var speed = parseFloat(el.getAttribute('data-par')) || (0.12 + i * 0.06);
      parallax.push({ el: el, speed: speed });
    });
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        parallax.forEach(function (p) {
          var r = p.el.getBoundingClientRect();
          var mid = r.top + r.height / 2 - window.innerHeight / 2;
          p.el.style.transform = 'translate3d(0,' + (-mid * p.speed).toFixed(1) + 'px,0)';
        });
        ticking = false;
      });
    }
    if (parallax.length) { window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }

    /* 4) buttons: ripple + magnetic */
    document.querySelectorAll('.btn, .btn-primary, #go, button.primary, .cta').forEach(function (b) { b.classList.add('mo-btn'); });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('.mo-btn'); if (!b) return;
      var r = b.getBoundingClientRect(), d = Math.max(r.width, r.height);
      var sp = document.createElement('span'); sp.className = 'mo-ripple';
      sp.style.width = sp.style.height = d + 'px';
      sp.style.left = (ev.clientX - r.left - d / 2) + 'px';
      sp.style.top = (ev.clientY - r.top - d / 2) + 'px';
      b.appendChild(sp); setTimeout(function () { sp.remove(); }, 700);
    });
    if (window.matchMedia('(pointer:fine)').matches) {
      document.querySelectorAll('.btn-primary, #go, .btn.primary').forEach(function (b) {
        b.addEventListener('pointermove', function (e) {
          var r = b.getBoundingClientRect();
          var x = (e.clientX - r.left - r.width / 2) * 0.25;
          var y = (e.clientY - r.top - r.height / 2) * 0.35;
          b.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) scale(1.05)';
        });
        b.addEventListener('pointerleave', function () { b.style.transform = ''; });
      });
    }

    /* 5) hero pointer parallax (4px -> 18px) */
    if (hero && window.matchMedia('(pointer:fine)').matches) {
      var layers = hero.querySelectorAll('h1, .sub, .demo, .preview, .hero-visual');
      hero.addEventListener('pointermove', function (e) {
        var cx = (e.clientX / window.innerWidth - 0.5), cy = (e.clientY / window.innerHeight - 0.5);
        layers.forEach(function (l, i) {
          var depth = (i + 1) * 9;
          l.style.transform = 'translate3d(' + (cx * depth).toFixed(1) + 'px,' + (cy * depth).toFixed(1) + 'px,0)';
        });
      });
      hero.addEventListener('pointerleave', function () { layers.forEach(function (l) { l.style.transform = ''; }); });
    }

    /* 6) count-up */
    function countUp(el) {
      var target = parseFloat(el.getAttribute('data-count')) || 0;
      var suffix = el.getAttribute('data-suffix') || '';
      var dur = 1400, t0 = performance.now();
      (function tick(now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased).toLocaleString() + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(t0);
    }
    if ('IntersectionObserver' in window) {
      var cio = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); cio.unobserve(e.target); } });
      }, { threshold: 0.6 });
      document.querySelectorAll('[data-count]').forEach(function (el) { cio.observe(el); });
    }
  });
})();
