'use strict';
// The glass workshop page: one slider from a plain bar to liquid glass, over something busy enough to see it bend.
// player.js draws window.GlassExtra's picture and glass on the graphics-card layer. Without that layer the page says why.
(() => {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const LOOKS = {
    normal: { bend: 0, edge: 1, clear: 1, rainbow: 0, shine: 0, rim: 0, dim: 0, plain: 1 },
    frosted: { bend: 0, edge: 1, clear: .55, rainbow: 0, shine: .12, rim: .06, dim: .12, plain: 0 },
    liquid: { bend: .9, edge: 44, clear: 1, rainbow: .25, shine: .7, rim: .24, dim: .06, plain: 0 },
    lens: { bend: 1, edge: 74, clear: 1, rainbow: .45, shine: .95, rim: .3, dim: 0, plain: 0 },
  };
  const mixLook = (a, b, t) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b[k] - a[k]) * t]));
  // the big slider: plain, then frosted, then liquid
  const lookAt = (t) => (t < .4 ? mixLook(LOOKS.normal, LOOKS.frosted, t / .4) : mixLook(LOOKS.frosted, LOOKS.liquid, (t - .4) / .6));
  let stage = null, look = lookAt(0), tween = 0, stopPage = null;

  function paint(c) {
    if (!stage?.isConnected) return;
    const r = stage.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    c.save();
    c.beginPath(); c.roundRect(r.left, r.top, r.width, r.height, 26); c.clip();
    const g = c.createLinearGradient(r.left, r.top, r.right, r.bottom);
    g.addColorStop(0, '#2a1a8e'); g.addColorStop(.5, '#b0348f'); g.addColorStop(1, '#f08a4e');
    c.fillStyle = g; c.fillRect(r.left, r.top, r.width, r.height);
    // stripes and dots: straight lines show bending best
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.34)';
    for (let x = r.left + 18; x < r.right; x += 36) { c.beginPath(); c.moveTo(x, r.top); c.lineTo(x, r.bottom); c.stroke(); }
    c.fillStyle = 'rgba(13,7,38,.5)';
    for (let y = r.top + 30; y < r.bottom; y += 60) for (let x = r.left + 36; x < r.right; x += 72) { c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); }
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${Math.min(r.width * .24, 210)}px ${getComputedStyle(document.body).fontFamily}`;
    c.fillText('Glassy', r.left + r.width / 2, r.top + r.height * .42);
    c.restore();
  }
  function pieces() {
    if (!stage?.isConnected) return [];
    const box = stage.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) return [];
    const m = { refraction: look.bend, depth: look.edge, dispersion: look.rainbow, frost: (1 - look.clear) * 40, specular: look.shine, rim: look.rim, dim: look.dim };
    return [...stage.querySelectorAll('[data-glass]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { key: `ws-${el.dataset.glass}`, x: r.left, y: r.top, w: r.width, h: r.height, radius: el.dataset.group ? r.height / 2 : 28, look: m, group: el.dataset.group || null };
    });
  }
  window.GlassExtra = { paint, pieces, on: () => !!stage?.isConnected };

  function paintControls(root) {
    stage.style.setProperty('--plain', look.plain.toFixed(3));
    root.querySelectorAll('input[data-k]').forEach((s) => { s.value = look[s.dataset.k]; s.setAttribute('aria-valuetext', (+look[s.dataset.k]).toFixed(s.step < 1 ? 2 : 0)); });
  }
  function setup() {
    stopPage?.();
    stopPage = null;
    const root = document.querySelector('.ws');
    stage = root && root.querySelector('.ws-stage');
    if (!stage) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, off = new AbortController(), on = { signal: off.signal };
    const master = root.querySelector('.ws-master');
    const setT = (t) => { master.value = t; look = lookAt(t); paintControls(root); };
    const glide = (to, ms = 900) => {
      const from = { ...look }, t0 = performance.now(), me = ++tween;
      if (still) { look = to; paintControls(root); return; }
      const step = (now) => {
        if (me !== tween || !stage?.isConnected) return;
        const k = clamp((now - t0) / ms), e = k * k * (3 - 2 * k);
        look = mixLook(from, to, e); paintControls(root);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    master.addEventListener('input', () => { tween++; setT(+master.value); }, on);
    root.querySelectorAll('input[data-k]').forEach((s) => s.addEventListener('input', () => { tween++; look = { ...look, [s.dataset.k]: +s.value, plain: 0 }; paintControls(root); }, on));
    root.querySelectorAll('[data-look]').forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.look;
      master.value = { normal: 0, frosted: .4, liquid: 1, lens: 1 }[name];
      glide(LOOKS[name]);
    }, on));
    // anything on the stage can be dragged; the two drops melt together when they get close
    stage.querySelectorAll('[data-glass]').forEach((el) => {
      let from = null;
      el.addEventListener('pointerdown', (e) => {
        const r = el.getBoundingClientRect();
        from = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        el.setPointerCapture(e.pointerId); el.classList.add('held'); e.preventDefault();
      }, on);
      el.addEventListener('pointermove', (e) => {
        if (!from) return;
        const b = stage.getBoundingClientRect();
        el.style.left = `${clamp(e.clientX - from.dx - b.left, 0, b.width - el.offsetWidth)}px`;
        el.style.top = `${clamp(e.clientY - from.dy - b.top, 0, b.height - el.offsetHeight)}px`;
      }, on);
      const up = () => { from = null; el.classList.remove('held'); };
      el.addEventListener('pointerup', up, on); el.addEventListener('pointercancel', up, on);
    });
    setT(0);
    // the first time it's on screen, it plays once from plain to liquid
    const seen = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      seen.disconnect();
      if (still) { setT(1); return; }
      const t0 = performance.now(), me = ++tween;
      const step = (now) => {
        if (me !== tween || !stage?.isConnected) return;
        const k = clamp((now - t0 - 700) / 3000);
        setT(k * k * (3 - 2 * k));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: .4 });
    seen.observe(stage);
    const noGpu = setTimeout(() => { root.classList.toggle('ws-nogpu', !document.body.classList.contains('glass-gpu')); }, 2500);
    stopPage = () => { off.abort(); seen.disconnect(); clearTimeout(noGpu); tween++; };
  }
  addEventListener('glassy:page', setup);
  setup();
})();
