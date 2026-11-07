'use strict';
// Glassy website: what every page shares. The moving colours, gliding scroll, the floating scrollbar, downloads for this
// computer, and swapping pages without reloading, so the player keeps playing. Every page still works without this file.
(() => {
  document.documentElement.classList.add('js');
  // an old link with .html on the end still works, and the address cleans itself up
  if (/^http/.test(location.protocol) && /\.html$/.test(location.pathname) && !/404\.html$/.test(location.pathname)) history.replaceState(null, '', location.pathname.replace(/(\/index)?\.html$/, (m, home) => (home ? '/' : '')) + location.search + location.hash);
  // every visit starts at the top, reload or not
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  addEventListener('pageshow', () => scrollTo(0, 0));
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const RELEASES = 'https://github.com/fentdevelops/glass-player/releases/latest';

  // ---------- the top bar: a piece of the background, blurred and fading out, once the page has scrolled under it ----------
  const top = $('.top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---------- scrolling glides, whatever the mouse: wheel and keys steer a target, and the page eases towards it ----------
  // Touch keeps the phone's own scrolling. Reduced motion keeps the browser's. Ctrl + wheel still zooms.
  const Smooth = window.Smooth = { to: (y) => scrollTo(0, y), travel: (y) => scrollTo(0, y), jump: (y) => scrollTo({ top: y, behavior: 'instant' }), goal: () => scrollY, busy: () => false, dragging: false };
  if (!still) {
    let goalY = scrollY, curY = scrollY, moving = false, lastT = 0, rate = 7.5, trip = null;
    const maxY = () => document.documentElement.scrollHeight - innerHeight;
    const tick = (ms) => {
      if (!moving) return;
      const dt = Math.max(.001, Math.min(.05, (ms - lastT) / 1000 || .016)); lastT = ms;
      if (trip) {
        const k = clamp((performance.now() - trip.t0) / trip.ms, 0, 1), e = trip.ease === 'out' ? 1 - (1 - k) ** 3 : .5 - .5 * Math.cos(Math.PI * k);
        curY = trip.from + (goalY - trip.from) * e;
        if (k >= 1) { trip = null; curY = goalY; }
      } else curY += (goalY - curY) * (1 - Math.exp(-dt * rate));
      if (Math.abs(goalY - curY) < .4) { curY = goalY; moving = false; }
      scrollTo({ top: curY, behavior: 'instant' });
      if (moving) requestAnimationFrame(tick);
    };
    const steer = (y, r = 7.5) => {
      rate = r; trip = null;
      goalY = clamp(y, 0, maxY());
      if (!moving) { moving = true; curY = scrollY; lastT = performance.now(); requestAnimationFrame(tick); }
    };
    Smooth.to = (y, r) => steer(y, r);
    Smooth.goal = () => (moving ? goalY : scrollY);
    // a timed trip: there in a fixed, short time, however far it is
    Smooth.travel = (y, ms = 520, ease = 'both') => {
      goalY = clamp(y, 0, maxY());
      trip = { from: scrollY, t0: performance.now(), ms, ease };
      if (!moving) { moving = true; curY = scrollY; lastT = performance.now(); requestAnimationFrame(tick); }
    };
    Smooth.jump = (y) => { moving = false; trip = null; goalY = curY = y; scrollTo({ top: y, behavior: 'instant' }); };
    Smooth.busy = () => moving;
    addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      if (e.target.closest && e.target.closest('.gate')) return;      // the entrance scrolls by itself on a small window
      if (Smooth.listScrolls && Smooth.listScrolls(e.target, e.deltaY)) return;      // so does an open song list
      e.preventDefault();
      if (Smooth.onWheel && Smooth.onWheel(e)) return;      // the rooms steer themselves
      const unit = e.deltaMode === 1 ? 34 : e.deltaMode === 2 ? innerHeight : 1;
      steer((moving && rate > 5 ? goalY : scrollY) + e.deltaY * unit);
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.closest && t.closest('input, textarea, select, [role="slider"], summary, .gate')) return;
      const page = innerHeight * .85;
      const by = { ArrowDown: 90, ArrowUp: -90, PageDown: page, PageUp: -page, ' ': e.shiftKey ? -page : page }[e.key];
      if (by && Smooth.onStep && !(e.key === ' ' && t.closest && t.closest('button, a')) && Smooth.onStep(Math.sign(by))) { e.preventDefault(); return; }
      if (e.key === 'Home') { e.preventDefault(); steer(0); } else if (e.key === 'End') { e.preventDefault(); steer(maxY()); } else if (by && !(e.key === ' ' && t.closest && t.closest('button, a'))) { e.preventDefault(); steer((moving ? goalY : scrollY) + by); }
    });
    addEventListener('scroll', () => { if (!moving) goalY = curY = scrollY; }, { passive: true });
  }

  // ---------- the scrollbar: a floating bean, drawn here, with nothing behind it ----------
  const bean = document.createElement('div');
  bean.className = 'bean';
  document.body.appendChild(bean);
  let beanT = 0, beanHide = 0;
  const paintBean = () => {
    const doc = document.documentElement, total = doc.scrollHeight, view = innerHeight, pad = 10;
    const room = view - pad * 2, h = Math.max(46, (view / total) * room), travel = room - h;
    bean.style.display = total <= view + 1 ? 'none' : '';
    bean.style.height = `${h}px`;
    bean.style.transform = `translateY(${(pad + (scrollY / Math.max(1, total - view)) * travel).toFixed(1)}px)`;
    bean.dataset.travel = travel;
  };
  const wake = () => { bean.classList.add('on'); clearTimeout(beanHide); beanHide = setTimeout(() => { if (!Smooth.dragging) bean.classList.remove('on'); }, 1200); };
  addEventListener('scroll', () => { cancelAnimationFrame(beanT); beanT = requestAnimationFrame(paintBean); wake(); }, { passive: true });
  addEventListener('resize', paintBean);
  addEventListener('pointermove', (e) => { if (e.clientX > innerWidth - 40) wake(); }, { passive: true });
  bean.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    bean.setPointerCapture(e.pointerId);
    Smooth.dragging = true; bean.classList.add('on', 'held');
    const y0 = e.clientY, s0 = scrollY;
    const move = (m) => Smooth.jump(clamp(s0 + ((m.clientY - y0) / Math.max(1, +bean.dataset.travel)) * (document.documentElement.scrollHeight - innerHeight), 0, document.documentElement.scrollHeight - innerHeight));
    const up = () => { Smooth.dragging = false; bean.classList.remove('held'); bean.removeEventListener('pointermove', move); bean.removeEventListener('pointerup', up); wake(); dispatchEvent(new Event('scroll')); };
    bean.addEventListener('pointermove', move);
    bean.addEventListener('pointerup', up);
  });

  // ---------- behind everything: the moving colours, or the song's own cover ----------
  // player.js hands it the cover (Ambient.wall) and the beat (Ambient.pulse). Nothing pulses until music is really playing.
  const canvas = $('.bg'), dim = $('.dim'), wallEl = $('.wall');
  const COLOURS = [[124, 59, 224], [242, 88, 156], [255, 171, 104], [86, 210, 255], [74, 47, 208]];
  let kick = 0, wallUp = 0, wallNow = '';
  window.Ambient = {
    pulse(v) { kick = Math.max(kick, v); },
    wall(art) {
      if (art === wallNow) return;
      wallNow = art || '';
      document.body.classList.toggle('wall-on', !!art);
      const layers = $$('i', wallEl);
      if (!art) { layers.forEach((l) => l.classList.remove('on')); return; }
      wallUp = 1 - wallUp;
      layers[wallUp].style.background = art;
      layers[wallUp].classList.add('on');
      layers[1 - wallUp].classList.remove('on');
    },
  };
  if (canvas && canvas.getContext) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const W = coarse ? 240 : 480, H = coarse ? 150 : 300, x = canvas.getContext('2d');      // big enough that stretching it never shows a grid
    canvas.width = W; canvas.height = H;
    //         x    y    size  sway-x sway-y phase speed
    const B = [[.26, .3, .66, .34, .28, 0, 1], [.76, .66, .56, .32, .34, 1.6, .8], [.94, .98, .42, .24, .22, 3.1, 1.2], [.06, .06, .4, .24, .2, 4.3, .9], [.14, .9, .58, .3, .26, 2.2, 1.1]];
    let lastBeat = '';
    const draw = (t) => {
      x.globalCompositeOperation = 'source-over';
      x.fillStyle = '#0d0726'; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'lighter';
      B.forEach(([bx, by, r, ax, ay, p, sp], i) => {
        const px = (bx + Math.sin(t * .42 * sp + p) * ax) * W, py = (by + Math.cos(t * .34 * sp + p) * ay) * H;
        const g = x.createRadialGradient(px, py, 0, px, py, r * W * (1 + kick * .3));
        const rgb = COLOURS[i].join(',');
        g.addColorStop(0, `rgba(${rgb},.92)`); g.addColorStop(1, `rgba(${rgb},0)`);
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      });
      const beat = kick.toFixed(3);
      if (beat !== lastBeat) {      // only what pulses hears about it: telling the whole page would make it all be worked out again
        lastBeat = beat;
        dim.style.setProperty('--kick', beat); wallEl.style.setProperty('--kick', beat);
        $$('.logo-mark').forEach((m) => m.style.setProperty('--beat', beat));
      }
      kick *= .86;
    };
    draw((Date.now() / 1000) % 86400);
    if (!still) {
      let last = 0;
      const loop = (ms) => {
        requestAnimationFrame(loop);
        // the colours rest while the panels are moving: everything behind the glass stays still, so the glass has less to redo
        if (document.hidden || ms - last < (coarse || window.Ambient.drew ? 50 : 30) || document.body.classList.contains('in-motion')) return;
        last = ms; draw((Date.now() / 1000) % 86400); window.Ambient.drew?.();
      };
      requestAnimationFrame(loop);
    }
  }

  // ---------- downloads: the right button for this computer, with its icon ----------
  const ICONS = {
    windows: '<path d="M3 5.3 10.4 4.200v7.200H3zM11.400 4.100 21 2.700v8.700h-9.600zM3 12.400h7.400v7.300L3 18.700zM11.400 12.400H21v8.900l-9.600-1.400z"/>',
    mac: '<path d="M16.400 12.600c0-2.300 1.900-3.400 2-3.500-1.100-1.600-2.800-1.800-3.400-1.800-1.400-.1-2.800.9-3.500.9s-1.900-.9-3.100-.8c-1.600 0-3.100.9-3.900 2.300-1.700 2.900-.4 7.200 1.200 9.500.8 1.100 1.700 2.400 3 2.300 1.200 0 1.700-.8 3.100-.8s1.900.8 3.200.8 2.200-1.100 3-2.300c.9-1.300 1.300-2.600 1.300-2.700-.1 0-2.900-1.100-2.900-4.100zM14.100 5.800c.7-.8 1.100-1.900 1-3-1 0-2.100.6-2.800 1.500-.6.7-1.200 1.800-1 2.900 1.100.1 2.200-.6 2.800-1.400z"/>',
    linux: '<path d="M12 2c-2.600 0-4 2.100-4 4.600 0 1.600-.6 2.700-1.500 4C5.400 12.200 4 14.300 4 16.600c0 .9.2 1.700.6 2.400l-1 1.200c-.3.400 0 1 .5 1h3.100c.3 0 .5-.1.700-.3.600.2 1.300.3 2.100.3h4c.8 0 1.500-.1 2.100-.3.200.2.400.3.700.3h3.100c.5 0 .8-.6.500-1l-1-1.200c.4-.7.600-1.500.600-2.400 0-2.300-1.400-4.400-2.500-6-.9-1.300-1.500-2.400-1.500-4C16 4.100 14.600 2 12 2z"/>',
    iphone: '<path fill-rule="evenodd" d="M7 1h10a2 2 0 0 1 2 2v18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2zm5 20.500a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM7 4v14h10V4z"/>',
    android: '<path d="M6 18c0 .6.4 1 1 1h1v3a1.500 1.500 0 0 0 3 0v-3h2v3a1.500 1.500 0 0 0 3 0v-3h1c.6 0 1-.4 1-1V8H6zM3.500 8A1.500 1.500 0 0 0 2 9.500v7a1.500 1.500 0 0 0 3 0v-7A1.500 1.500 0 0 0 3.500 8zm17 0A1.500 1.500 0 0 0 19 9.500v7a1.500 1.500 0 0 0 3 0v-7A1.500 1.500 0 0 0 20.500 8zM15.500 2.200l1.300-1.300-.7-.7-1.500 1.500A5.900 5.900 0 0 0 12 1c-.9 0-1.800.2-2.600.7L7.900.2l-.7.7 1.300 1.300A6 6 0 0 0 6 7h12a6 6 0 0 0-2.500-4.800z"/>',
    github: '<path d="M12 .5a11.500 11.500 0 0 0-3.640 22.410c.575.106.786-.25.786-.555 0-.274-.01-1-.015-1.960-3.200.695-3.875-1.540-3.875-1.540-.523-1.330-1.278-1.684-1.278-1.684-1.044-.714.08-.7.08-.7 1.154.081 1.761 1.186 1.761 1.186 1.026 1.758 2.692 1.250 3.348.956.104-.743.402-1.250.730-1.538-2.554-.29-5.240-1.277-5.240-5.684 0-1.255.448-2.282 1.183-3.087-.119-.29-.513-1.460.112-3.043 0 0 .965-.309 3.162 1.179a10.990 10.990 0 0 1 5.758 0c2.195-1.488 3.159-1.179 3.159-1.179.627 1.583.232 2.753.114 3.043.737.805 1.181 1.832 1.181 3.087 0 4.418-2.690 5.390-5.252 5.675.413.355.781 1.058.781 2.133 0 1.540-.014 2.782-.014 3.160 0 .307.207.666.792.553A11.500 11.500 0 0 0 12 .5z"/>',
  };
  const iconOf = (n) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[n]}</svg>`;
  const OS = {
    windows: { name: 'Windows', icon: 'windows', asset: 'setup' },
    mac: { name: 'Mac', icon: 'mac', asset: 'arm' },
    linux: { name: 'Linux', icon: 'linux', soon: true },
    iphone: { name: 'iPhone', icon: 'iphone', soon: true },
    android: { name: 'Android', icon: 'android', soon: true },
  };
  const ua = navigator.userAgent;
  const mine = /Android/i.test(ua) ? 'android'
    : /iPhone|iPad|iPod/i.test(ua) || (/Mac/i.test(navigator.platform) && navigator.maxTouchPoints > 1) ? 'iphone'
      : /Mac/i.test(navigator.platform || ua) ? 'mac'
        : /Win/i.test(navigator.platform || ua) ? 'windows'
          : /Linux|X11/i.test(navigator.platform || ua) ? 'linux' : 'windows';
  const want = {
    setup: (n) => /^Glassy-Setup-.*\.exe$/.test(n),
    portable: (n) => /^Glassy-\d.*\.exe$/.test(n),
    arm: (n) => /mac-arm64\.dmg$/.test(n),
    intel: (n) => /mac-x64\.dmg$/.test(n),
  };
  let release = null;
  const urlOf = (asset) => { const hit = release && release.assets.find((f) => want[asset] && want[asset](f.name)); return hit ? hit.browser_download_url : ''; };
  function setLink(a, url) {
    a.href = url || RELEASES;
    if (url) a.removeAttribute('target'); else { a.target = '_blank'; a.rel = 'noopener'; }      // the releases page opens beside the music, not over it
  }
  function paintDownloads() {
    const o = OS[mine];
    $$('[data-get]').forEach((a) => {
      const short = a.hasAttribute('data-short');
      a.innerHTML = `${iconOf(o.icon)}<span>${o.soon ? (short ? 'Coming soon' : `Coming soon to ${o.name}`) : short ? 'Download' : `Download for ${o.name}`}</span>`;
      if (o.soon) { a.href = 'download'; a.removeAttribute('target'); } else setLink(a, urlOf(a.dataset.asset || o.asset));
    });
    $$('[data-asset]:not([data-get])').forEach((a) => setLink(a, urlOf(a.dataset.asset)));
    $$('[data-os]').forEach((s) => { s.innerHTML = iconOf(s.dataset.os); });
    $$('[data-gh]').forEach((s) => { s.innerHTML = iconOf('github'); });
    const line = $('[data-latest]');
    if (line && release) line.textContent = `Latest version: ${String(release.tag_name).replace(/^v/, '')}, released ${new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}.`;
  }
  // an Intel Mac says so only in some browsers; everyone else gets Apple silicon, with Intel one tap away in Other versions
  if (mine === 'mac' && navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData.getHighEntropyValues(['architecture']).then((v) => { if (v.architecture === 'x86') { OS.mac.asset = 'intel'; paintDownloads(); } }).catch(() => {});
  }
  fetch('https://api.github.com/repos/fentdevelops/glass-player/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j && Array.isArray(j.assets)) { release = j; paintDownloads(); } })
    .catch(() => { /* the links keep pointing at the releases page */ });

  // ---------- what each page sets up, and takes down again when it's swapped out ----------
  let undo = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); undo.push(() => target.removeEventListener(type, fn, opts)); };
  function lensSetup() {
    const hero = $('.hero'), lens = $('.lens');
    if (!hero || !lens) return;
    const NS = 'http://www.w3.org/2000/svg';
    let built = '';
    function mapFor(w, h, r) {
      const BAND = h * .08;      // a tight band at the rim, so the letters inside stay clean
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'), img = g.createImageData(w, h), d = img.data;
      const hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = x + .5 - hw, py = y + .5 - hh;
        const qx = Math.abs(px) - (hw - rr), qy = Math.abs(py) - (hh - rr);
        const dist = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr);
        let t = 1 - dist / BAND; t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        let nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); } else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
        const k = (y * w + x) * 4, a = t * t;
        d[k] = 128 - nx * a * 127; d[k + 1] = 128 - ny * a * 127; d[k + 2] = 0; d[k + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      return c.toDataURL('image/png');
    }
    // the bent version needs a browser that takes an SVG filter as a backdrop; others keep the plain blurred lens from the CSS
    const canBend = !!window.chrome && CSS.supports('backdrop-filter', 'url(#a)') && !matchMedia('(pointer: coarse)').matches;
    function fit() {
      if (!canBend) return;
      const w = lens.offsetWidth, h = lens.offsetHeight, key = `${w}x${h}`;
      if (key === built || w < 24) return;
      built = key;
      let filter = document.getElementById('lens-bend');
      if (!filter) {
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
        svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        filter = document.createElementNS(NS, 'filter'); filter.id = 'lens-bend';
        filter.setAttribute('filterUnits', 'userSpaceOnUse'); filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        svg.appendChild(filter); document.body.appendChild(svg);
      }
      filter.setAttribute('x', '0'); filter.setAttribute('y', '0'); filter.setAttribute('width', w); filter.setAttribute('height', h);
      filter.innerHTML = `<feImage href="${mapFor(w, h, parseFloat(lens.style.borderRadius) || h / 2)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="raw"/><feGaussianBlur in="raw" stdDeviation="3" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="${Math.round(h * .1)}" xChannelSelector="R" yChannelSelector="G" result="bent"/><feGaussianBlur in="bent" stdDeviation="0.5"/>`;
      const f = 'url(#lens-bend) saturate(145%) brightness(1.06)';
      lens.style.backdropFilter = f; lens.style.webkitBackdropFilter = f;
    }
    const word = hero.querySelector('[data-rest]');
    // The lens hugs the word's real letter shapes: its edge lands just past the "g", below its tail, and just past the full stop.
    const ink = document.createElement('canvas').getContext('2d');
    const anchor = () => {
      // Measure where the word ends up, not where it is: the headline may still be rising in as the page loads
      const moving = hero.querySelector('h1').getAnimations({ subtree: true }).filter((x) => x.effect);
      const was = moving.map((x) => x.currentTime);
      moving.forEach((x) => { x.currentTime = x.effect.getComputedTiming().endTime; });
      const h = hero.getBoundingClientRect(), r = word.getBoundingClientRect(), cs = getComputedStyle(word), em = parseFloat(cs.fontSize);
      ink.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      if ('letterSpacing' in ink) ink.letterSpacing = cs.letterSpacing;
      const m = ink.measureText(word.textContent);
      const mark = document.createElement('span');
      mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      word.appendChild(mark);
      const base = mark.getBoundingClientRect().bottom;
      mark.remove();
      moving.forEach((x, i) => { x.currentTime = was[i]; });
      const padX = em * .1, padY = em * .09;
      const w = Math.round(m.actualBoundingBoxLeft + m.actualBoundingBoxRight + padX * 2);
      const tall = Math.round(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + padY * 2);
      if (lens.offsetWidth !== w || lens.offsetHeight !== tall) {
        lens.style.width = `${w}px`; lens.style.height = `${tall}px`;
        lens.style.borderRadius = `${Math.round(tall * .22)}px`;    // rounded, yet square enough that the g's tail stays inside
        fit();
      }
      return { x: r.left - m.actualBoundingBoxLeft - padX - h.left, y: base - m.actualBoundingBoxAscent - padY - h.top };
    };
    let home = anchor(), off = { x: 0, y: 0 }, pull = { x: 0, y: 0 };
    const place = () => { lens.style.transform = `translate3d(${(home.x + off.x).toFixed(1)}px, ${(home.y + off.y).toFixed(1)}px, 0)`; };
    place();
    const remeasure = () => { home = anchor(); place(); };
    on(window, 'resize', remeasure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (lens.isConnected) remeasure(); });
    const MAX = 34;      // how far the glass can lean
    // only while the mouse is over the glass's own resting place, and gone as soon as it's off
    const release = () => { lens.classList.remove('on'); pull = { x: 0, y: 0 }; };
    on(window, 'pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const h = hero.getBoundingClientRect(), w = lens.offsetWidth, t = lens.offsetHeight;
      const dx = e.clientX - (h.left + home.x + w / 2), dy = e.clientY - (h.top + home.y + t / 2);
      if (Math.abs(dx) > w / 2 || Math.abs(dy) > t / 2) return release();
      lens.classList.add('on');
      if (still) return;
      const d = Math.hypot(dx, dy), r = MAX * Math.tanh(d / 260);
      pull = d ? { x: (dx / d) * r, y: (dy / d) * r } : { x: 0, y: 0 };
    }, { passive: true });
    on(document.documentElement, 'pointerleave', release);
    if (still) return;
    // it eases to where it's going and back again, with no bounce
    const follow = () => {
      if (!lens.isConnected) return;
      requestAnimationFrame(follow);
      if (document.hidden) return;
      if (Math.abs(pull.x - off.x) + Math.abs(pull.y - off.y) < .02) return;
      off.x += (pull.x - off.x) * .05; off.y += (pull.y - off.y) * .05;
      place();
    };
    follow();
  }
  function initPage() {
    undo.forEach((u) => u()); undo = [];
    lensSetup();

    // the light on the inner pages' glass follows the pointer
    const glowing = $$('[data-glow]');
    if (glowing.length && !still) on(window, 'pointermove', (e) => {
      glowing.forEach((el) => { const b = el.getBoundingClientRect(); if (b.bottom < 0 || b.top > innerHeight) return; el.style.setProperty('--sx', `${e.clientX - b.left}px`); el.style.setProperty('--sy', `${e.clientY - b.top}px`); });
    }, { passive: true });

    // Questions: search and sort
    const find = $('[data-qa-find]');
    if (find) {
      const items = $$('.qa'), cats = $$('[data-qa-cat]'), none = $('[data-qa-empty]');
      let cat = 'all';
      const show = () => {
        const q = find.value.trim().toLowerCase();
        let n = 0;
        for (const d of items) {
          const hit = (cat === 'all' || d.dataset.cat === cat) && (!q || d.textContent.toLowerCase().includes(q));
          d.hidden = !hit;
          if (hit) n++;
        }
        none.hidden = n > 0;
        // a search that leaves a few answers opens them; clearing it closes them again
        for (const d of items) if (q) d.open = !d.hidden && n <= 3; else if (d.dataset.auto) d.open = false;
        for (const d of items) if (q) d.dataset.auto = '1'; else delete d.dataset.auto;
      };
      find.addEventListener('input', show);
      cats.forEach((b) => b.addEventListener('click', () => { cat = b.dataset.qaCat; cats.forEach((o) => o.setAttribute('aria-pressed', String(o === b))); show(); }));
      if (items[0]) items[0].open = true;
    }

    // Roadmap: the line fills as you go, and each stop lights up when it gets there
    const road = $('.road');
    if (road) {
      const line = road.querySelector('.road-line'), stops = $$('.stop', road);
      const paint = () => {
        const r = line.getBoundingClientRect(), reach = innerHeight * .78;
        road.style.setProperty('--road', clamp((reach - r.top) / r.height, 0, 1).toFixed(4));
        for (const s of stops) s.classList.toggle('lit', s.getBoundingClientRect().top < reach + 40);
      };
      on(window, 'scroll', paint, { passive: true });
      on(window, 'resize', paint);
      paint();
    }

    // everything arrives: blocks of every page rise in as they come into view
    const blocks = $$('.page > *:not(.rise), .prose > *, .feat, .get-big > *, .get-more, .road-top > *, .qa-side > *, .qa-list > .qa, .idea-in > *, .notfound > *');
    if ('IntersectionObserver' in window && !still) {
      let batch = 0, reset = 0;
      const seen = new IntersectionObserver((list) => {
        for (const e of list) {
          if (!e.isIntersecting) continue;
          e.target.style.setProperty('--d', `${Math.min(batch++, 9) * 55}ms`);
          e.target.classList.add('in');
          seen.unobserve(e.target);
        }
        clearTimeout(reset); reset = setTimeout(() => { batch = 0; }, 120);
      });
      blocks.forEach((b) => { if (b.classList.contains('prose')) return; b.classList.add('arrive'); seen.observe(b); });
      undo.push(() => seen.disconnect());
    }
    const rising = $$('.rise');
    if ('IntersectionObserver' in window && !still) {
      const io = new IntersectionObserver((list) => { for (const e of list) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
      rising.forEach((e) => io.observe(e));
      undo.push(() => io.disconnect());
    } else rising.forEach((e) => e.classList.add('in'));

    paintDownloads();
    macFirst();
    if (location.hash === '#all') { const all = $('#all'); if (all) all.open = true; }
    paintBean();
    onScroll();
  }

  // ---------- going between pages: the page swaps underneath and the player carries on ----------
  const main = $('main');
  let navId = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // the site's other pages are fetched quietly while nothing's going on, so clicking one swaps straight away
  const fetchedPages = new Map();
  addEventListener('load', () => {
    const queue = [...new Set($$('.nav a[href], .foot-links a[href]').map((a) => new URL(a.href, location.href)).filter((u) => u.origin === location.origin).map((u) => u.pathname))];
    const later = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
    const next = () => {
      const page = queue.shift();
      if (!page) return;
      fetch(page).then((r) => (r.ok ? r.text() : null)).then((t) => { if (t) fetchedPages.set(page, t); }).catch(() => {}).finally(() => later(next, { timeout: 1500 }));
    };
    setTimeout(next, 1500);
  });
  async function go(url, push = true) {
    const id = ++navId;
    let doc;
    try {
      const key = new URL(url, location.href).pathname;
      let html = fetchedPages.get(key);
      if (!html) {
        const r = await fetch(url);
        if (!r.ok) throw new Error('not there');
        html = await r.text();
      }
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch { location.href = url; return; }
    if (id !== navId) return;
    main.classList.remove('entering');
    main.classList.add('leaving');
    if (!still) await wait(240);
    if (id !== navId) return;
    if (push) history.pushState({}, '', url);
    document.title = doc.title;
    const meta = (s) => [$(s), $(s, doc)];
    const [d0, d1] = meta('meta[name="description"]');
    if (d0 && d1) d0.content = d1.content;
    const [c0, c1] = meta('link[rel="canonical"]');
    if (c0 && c1) c0.href = c1.href;
    main.innerHTML = $('main', doc).innerHTML;
    for (const k of ['home', 'quiet', 'vivid']) document.body.classList.toggle(k, doc.body.classList.contains(k));
    const here = new URL(url, location.href).pathname.split('/').pop();
    $$('.nav a').forEach((a) => { if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    $$('details.menu').forEach((m) => { m.open = false; });
    Smooth.jump(0);
    main.classList.remove('leaving');
    if (!still) { main.classList.add('entering'); main.addEventListener('animationend', (e) => { if (e.target === main) main.classList.remove('entering'); }, { once: true }); }
    initPage();
    window.dispatchEvent(new Event('glassy:page'));
    main.focus({ preventScroll: true });
  }
  // ---------- on a Mac: the download starts, and you land on what to do next ----------
  let macPending = null;      // 'file' when a download really began, 'page' when only the releases page could open
  function macFirst() {
    const box = $('.mac-first');
    if (!box || !macPending) return;
    $('h2', box).textContent = macPending === 'file' ? 'Your download has started. One more step on a Mac.' : 'Pick the Mac file on the page that just opened. Then one more step.';
    macPending = null;
    box.hidden = false;
    Smooth.jump(0);
    box.animate?.([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  function grabFile(url) {
    const f = document.createElement('iframe');
    f.hidden = true; f.src = url;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 60000);
  }
  // ---------- GitHub doesn't allow itself inside another site, so this is a little window of what's on there ----------
  const ghPop = document.createElement('div');
  ghPop.className = 'gh-pop';
  ghPop.hidden = true;
  ghPop.setAttribute('role', 'dialog');
  ghPop.setAttribute('aria-label', 'Glassy on GitHub');
  document.body.appendChild(ghPop);
  const REPO = 'https://github.com/fentdevelops/glass-player', REPO_API = 'https://api.github.com/repos/fentdevelops/glass-player';
  const escH = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4.500 4.500 0 0 0 6.400 0l3-3a4.500 4.500 0 0 0-6.400-6.400l-1 1"/><path d="M14 10a4.500 4.500 0 0 0-6.400 0l-3 3a4.500 4.500 0 0 0 6.400 6.400l1-1"/></svg>';
  let ghLoaded = false;
  async function fillGh() {
    if (ghLoaded) return;
    const body2 = $('.gh-body', ghPop);
    try {
      const [repo, commits] = await Promise.all([fetch(REPO_API).then((r) => (r.ok ? r.json() : Promise.reject())), fetch(`${REPO_API}/commits?per_page=4`).then((r) => (r.ok ? r.json() : []))]);
      const when = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      body2.innerHTML = `
        <p class="gh-desc">${escH(repo.description || 'A liquid-glass music and video player.')}</p>
        <div class="gh-stats"><span><b>${repo.stargazers_count}</b> stars</span><span><b>${repo.forks_count}</b> forks</span>${release ? `<span><b>${escH(String(release.tag_name).replace(/^v/, ''))}</b> latest</span>` : ''}</div>
        <h3>Latest changes</h3>
        <ul class="gh-log">${commits.slice(0, 4).map((c) => `<li><span>${escH(c.commit.message.split('\n')[0])}</span><time>${when(c.commit.author.date)}</time></li>`).join('')}</ul>`;
      ghLoaded = true;
    } catch { body2.innerHTML = '<p class="gh-desc">GitHub isn\'t answering right now. The link above still works.</p>'; }
  }
  function toggleGh(open) {
    if (open) {
      ghPop.innerHTML = ghPop.innerHTML || `<div class="gh-in"><header><span data-gh-mark></span><b>fentdevelops / glass-player</b><a class="gh-out" href="${REPO}" target="_blank" rel="noopener" aria-label="Open on GitHub" title="Open on GitHub">${LINK}</a></header><div class="gh-body"><p class="gh-desc">Loading…</p></div></div>`;
      const mark = $('[data-gh-mark]', ghPop);
      if (mark && !mark.innerHTML) mark.innerHTML = iconOf('github');
      ghPop.hidden = false;
      requestAnimationFrame(() => { ghPop.classList.add('on'); $('.gh-out', ghPop).focus({ preventScroll: true }); });
      fillGh();
    } else { ghPop.classList.remove('on'); setTimeout(() => { if (!ghPop.classList.contains('on')) ghPop.hidden = true; }, 320); }
  }
  const menu = $('details.menu');
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ghPop.classList.contains('on')) { toggleGh(false); $('.nav-gh').focus(); }
    if (menu.open) { menu.open = false; $('summary', menu).focus(); }
  });
  document.addEventListener('click', (e) => {
    if (menu.open && (!menu.contains(e.target) || e.target.closest('a'))) menu.open = false;
    if (e.target.closest && e.target.closest('.nav-gh')) { e.preventDefault(); toggleGh(!ghPop.classList.contains('on')); return; }
    if (ghPop.classList.contains('on') && !ghPop.contains(e.target)) toggleGh(false);
    // anything that downloads the Mac version goes on to the steps
    const dl = e.target.closest && e.target.closest('a[data-get], a[data-asset]');
    if (dl && !e.metaKey && !e.ctrlKey) {
      const asset = dl.dataset.asset || (dl.hasAttribute('data-get') ? OS[mine].asset : '');
      if (asset === 'arm' || asset === 'intel') {
        e.preventDefault();
        const url = urlOf(asset);
        if (url) grabFile(url); else window.open(RELEASES, '_blank', 'noopener');
        macPending = url ? 'file' : 'page';
        if (/\/download$/.test(location.pathname)) macFirst(); else go(new URL('download', location.href).href);
        return;
      }
    }
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin) return;
    if (u.pathname === location.pathname && u.hash) { const t = $(u.hash); if (t) { e.preventDefault(); if (t.tagName === 'DETAILS') t.open = true; Smooth.to(t.getBoundingClientRect().top + scrollY - 90); if (t.hasAttribute('tabindex')) t.focus({ preventScroll: true }); } return; }
    if (!/(^|\/)[^./]*$|\.html$/.test(u.pathname)) return;      // a page, not a file
    e.preventDefault();
    if (u.pathname !== location.pathname) go(u.href);
    else Smooth.to(0);
  });
  addEventListener('popstate', () => go(location.href, false));

  initPage();
})();
