'use strict';
// Liquid glass: each big glass panel bends what's behind it near its edges (like a thick glass slab),
// frosts the middle, and keeps the bent rim crisper. One SVG filter per panel, sized to that panel,
// rebuilt when it resizes. The current artwork fills the window behind everything so there's
// something to refract. Settings > Glass: Style (Liquid / Frosted), Background (Artwork / Colours).
// Uses app.js globals: S, $, body, current, cssUrl.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const host = document.createElementNS(NS, 'svg');
  host.setAttribute('width', '0'); host.setAttribute('height', '0');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(host);

  const TARGETS = ['#side', '#dock', '#art', '#lyrics', '#empty'];
  const BAND = 44;        // px of rim that refracts
  const BEND = 70;        // feDisplacementMap scale: up to ±35 px of bending at the very edge
  const FROST = 11;       // blur in the middle
  const filters = new Map();   // element -> { id, w, h, r }
  let n = 0, on = false;

  // displacement map at half size: R/G = how far to pull the backdrop (towards the centre near the rim),
  // B = how much of the crisp bent layer shows (rim only)
  function mapFor(w, h, r) {
    const s = 0.5, cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d'), img = g.createImageData(cw, ch), d = img.data;
    const hw = w / 2, hh = h / 2, rr = Math.min(r, hw, hh);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const px = (x + 0.5) / s - hw, py = (y + 0.5) / s - hh;
        const qx = Math.abs(px) - (hw - rr), qy = Math.abs(py) - (hh - rr);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const inside = Math.min(Math.max(qx, qy), 0);
        const dist = -(outside + inside - rr);             // px from the edge, inward
        let t = 1 - dist / BAND;
        t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); // smooth falloff into the middle
        let nx = 0, ny = 0;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
        else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
        const k = (y * cw + x) * 4, amt = t * t;
        d[k] = 128 - nx * amt * 127;        // sample from further inside: the rim magnifies inward
        d[k + 1] = 128 - ny * amt * 127;
        d[k + 2] = Math.round(t * 255);
        d[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  function build(el) {
    // layout size, not the on-screen box: a panel caught mid-animation (scaled) or pulsing to the bass
    // still gets a map that fits it exactly
    const w = el.offsetWidth, h = el.offsetHeight;
    if (w < 24 || h < 24) return;
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 24;
    let f = filters.get(el);
    if (f && f.w === w && f.h === h && f.r === r) return;
    if (!f) { f = { id: `lg${++n}` }; filters.set(el, f); }
    Object.assign(f, { w, h, r });
    const map = mapFor(w, h, r);
    let node = host.querySelector('#' + f.id);
    if (!node) { node = document.createElementNS(NS, 'filter'); node.id = f.id; host.appendChild(node); }
    node.setAttribute('filterUnits', 'userSpaceOnUse');
    node.setAttribute('primitiveUnits', 'userSpaceOnUse');
    node.setAttribute('x', '0'); node.setAttribute('y', '0');
    node.setAttribute('width', w); node.setAttribute('height', h);
    node.setAttribute('color-interpolation-filters', 'sRGB');
    node.innerHTML = `
      <feImage href="${map}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${BEND}" xChannelSelector="R" yChannelSelector="G" result="bent"/>
      <feGaussianBlur in="bent" stdDeviation="${FROST}" result="frost"/>
      <feGaussianBlur in="bent" stdDeviation="2.2" result="rimSoft"/>
      <feColorMatrix in="map" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="edge"/>
      <feComposite in="rimSoft" in2="edge" operator="in" result="rim"/>
      <feMerge><feMergeNode in="frost"/><feMergeNode in="rim"/></feMerge>`;
    el.style.setProperty('--lg', `url(#${f.id})`);
  }

  // A panel that keeps changing size (wide mode, dragging its edge, resizing the window, lyrics opening)
  // would rebuild its refraction map every frame, and that stalls the animation. Instead it wears plain
  // frosted glass while it moves and gets one map for its new size once it has been still for a moment.
  let pending = new Set(), raf = 0;
  const settle = new Map();
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const el = e.target, f = filters.get(el), box = e.borderBoxSize && e.borderBoxSize[0];
      if (!f || !on) { pending.add(el); continue; }                    // first time: build straight away
      if (!box || box.inlineSize < 24 || (Math.round(box.inlineSize) === f.w && Math.round(box.blockSize) === f.h)) continue;   // hidden, or same size again
      el.classList.add('lg-busy');
      clearTimeout(settle.get(el));
      settle.set(el, setTimeout(() => { settle.delete(el); if (on) build(el); el.classList.remove('lg-busy'); }, 180));
    }
    if (pending.size && !raf) raf = requestAnimationFrame(() => { raf = 0; if (on) pending.forEach(build); pending.clear(); });
  });
  for (const sel of TARGETS) { const el = $(sel); if (el) { el.classList.add('lg'); ro.observe(el); } }

  // ---------- artwork wallpaper (two layers so covers crossfade) ----------
  const wall = document.createElement('div');
  wall.className = 'wall';
  wall.innerHTML = '<i><b></b></i><i><b></b></i>';
  document.querySelector('.ambient').prepend(wall);
  // A soft shadow that follows the picture: darker only where the picture is bright, so a white patch can't wash out
  // the glass and the white text on it, while everything else keeps its full colour. It's a tiny map of the picture,
  // worked out once per picture and stretched over it, which keeps its edges soft, like an orb.
  const shades = new Map();
  function shadeFor(url) {
    if (shades.has(url)) return Promise.resolve(shades.get(url));
    return new Promise((resolve) => {
      const img = new Image();
      if (/^https?:/.test(url)) img.crossOrigin = 'anonymous';
      img.onerror = () => resolve('');
      img.onload = () => {
        let map = '';
        try {
          const k = 32 / Math.max(img.naturalWidth, img.naturalHeight);
          const w = Math.max(2, Math.round(img.naturalWidth * k)), h = Math.max(2, Math.round(img.naturalHeight * k));
          const a = document.createElement('canvas');
          a.width = w; a.height = h;
          const g = a.getContext('2d', { willReadFrequently: true });
          g.drawImage(img, 0, 0, w, h);
          const px = g.getImageData(0, 0, w, h);
          // how much shadow each spot wants: nothing up to mid brightness, most of the way for white
          const want = new Float32Array(w * h);
          for (let i = 0; i < want.length; i++) {
            const y = (0.2126 * px.data[i * 4] + 0.7152 * px.data[i * 4 + 1] + 0.0722 * px.data[i * 4 + 2]) / 255;
            const t = Math.max(0, Math.min(1, (y - 0.42) / 0.43));
            want[i] = t * t * (3 - 2 * t) * 0.78;
          }
          // each spot takes the strongest of its neighbours, so the soft edge falls outside the bright part, not on it
          let any = false;
          for (let yy = 0; yy < h; yy++) {
            for (let xx = 0; xx < w; xx++) {
              let top = 0;
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = xx + dx, ny = yy + dy;
                if (nx >= 0 && ny >= 0 && nx < w && ny < h && want[ny * w + nx] > top) top = want[ny * w + nx];
              }
              const i = (yy * w + xx) * 4;
              px.data[i] = 12; px.data[i + 1] = 12; px.data[i + 2] = 18;
              px.data[i + 3] = Math.round(top * 255);
              if (top > 0.02) any = true;
            }
          }
          if (any) {
            g.putImageData(px, 0, 0);
            const b = document.createElement('canvas');
            b.width = w; b.height = h;
            const s = b.getContext('2d');
            s.filter = 'blur(1.6px)';
            s.drawImage(a, -2, -2, w + 4, h + 4);               // a little oversized: the blur doesn't fade at the edges
            map = b.toDataURL('image/png');
          }
        } catch { /* a picture that can't be read just gets no shadow */ }
        if (shades.size > 60) shades.delete(shades.keys().next().value);
        shades.set(url, map);
        resolve(map);
      };
      img.src = url;
    });
  }
  let front = 0, shown = '', shadeSeq = 0;
  function setWall(url) {
    if (url === shown) return;
    shown = url;
    const layers = wall.children, next = layers[1 - front];
    next.style.backgroundImage = url ? cssUrl(url) : '';
    const shade = next.firstElementChild, my = ++shadeSeq;
    shade.classList.remove('on');
    shade.style.backgroundImage = '';
    if (url) shadeFor(url).then((map) => { if (my === shadeSeq && map) { shade.style.backgroundImage = `url("${map}")`; shade.classList.add('on'); } });
    next.classList.add('on');
    layers[front].classList.remove('on');
    front = 1 - front;
  }

  // behind the glass: the playing song's artwork, or your own picture (Settings > Glass > Background)
  let artUrl = '';
  const wallFor = () => (S.ui.wall === 'custom' && S.ui.wallImg ? S.ui.wallImg : artUrl);
  // a picture background with no picture yet (nothing playing) shows the moving colours instead, until there is one
  const picture = () => S.ui.wall !== 'colors' && !!wallFor();
  const syncMode = () => body.classList.toggle('wall-art', picture());
  function apply() {
    on = true;                       // always liquid now (the Frosted style was removed)
    body.classList.toggle('liquid', on);
    syncMode();
    setWall(wallFor());
    if (on) { for (const sel of TARGETS) { const el = $(sel); if (el) build(el); } extra.forEach(build); }
  }
  // small panels that come and go (the zoom pill) join in here
  const extra = new Set();
  function watch(el) { extra.add(el); el.classList.add('lg'); ro.observe(el); if (on) build(el); }
  // a panel that's gone for good (the intro's glass): its filter goes with it
  function unwatch(el) {
    extra.delete(el); pending.delete(el); ro.unobserve(el);
    clearTimeout(settle.get(el)); settle.delete(el);
    const f = filters.get(el);
    if (f) { host.querySelector('#' + f.id)?.remove(); filters.delete(el); }
    el.style.removeProperty('--lg');
  }
  window.Liquid = {
    apply,
    watch,
    unwatch,
    // the artwork on screen changed
    art(url) { artUrl = url || ''; syncMode(); setWall(wallFor()); },
    // true while a picture (artwork or your own image) is what's behind the glass, false while the colours are
    shown: picture,
    // a panel is about to animate at a new size: fit its glass now, so it doesn't swap partway through the motion
    snap(el) { if (!el || !on) return; clearTimeout(settle.get(el)); settle.delete(el); build(el); el.classList.remove('lg-busy'); },
  };
  apply();
})();
