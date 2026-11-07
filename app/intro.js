'use strict';
// The first-launch intro: a moving background in the icon's colours, one piece of real liquid glass that morphs from
// screen to screen, big words directly on the background, then a glide into the real app. Look and motion come from
// docs/superpowers/mockups/intro-preview.html, which the owner approved.
// Loaded from <head>: whether it shows is decided before anything in <body> can paint, so the app never flashes first.
// Everything else waits until every script is in, then uses these globals: reduceMotion, lib, S (app.js), Liquid (liquid.js).
(() => {
  const SEEN = 'glass.introSeen';
  // A new install whose intro hasn't been finished. updates.js notes the version on every launch, so without this a first
  // launch that was closed part way, or ended by opening a song, would look like an existing user next time.
  // Any library or playlist at launch ends it: someone who has songs never gets the intro, sign-up or finder in front of them.
  const OWED = 'glass.introOwed';
  const VERSION = 'glass.seenVersion';
  const page = document.documentElement;
  const E = 'cubic-bezier(.42,.02,.2,1)';
  const STILL_T = 6;      // with reduced motion: the one moment (seconds) the background and sound curve hold still at

  // Screen layouts are written at this size and scale with the window. Real pixels, through --k and box(): a scale
  // transform on anything above the glass would break its filter.
  const REF_W = 1240, REF_H = 800;
  const PLACES = {
    lens: { x: 495, y: 116, w: 250, h: 250, r: 125 },
    lib: { x: 680.8, y: 190, w: 460, h: 420, r: 30 },
    lyr: { x: 644.8, y: 140, w: 496, h: 520, r: 30 },
    eq: { x: 620, y: 250, w: 520.8, h: 300, r: 34 },
    col: { x: 720.8, y: 210, w: 420, h: 380, r: 91.2 },
    // the song finder (firstrun.js): the list, and a lens when there's nothing to list
    finder: { x: 566, y: 70, w: 575, h: 660, r: 30 },
    finderEmpty: { x: 761, y: 245, w: 310, h: 310, r: 155 },
  };
  const STEPS = [
    { v: 'lens', center: true, h: 'Glassy', p: 'Your music, behind glass.', go: 'Get started' },
    { v: 'lib', h: 'Everything you already have.', p: 'Glassy plays the music and videos on your computer. No subscription, and your files stay yours.', go: 'Continue' },
    { v: 'lyr', h: 'Lyrics that follow along.', p: 'Every line glides into place as it\'s sung. Click one to jump there.', go: 'Continue' },
    { v: 'eq', h: 'Sound you can shape.', p: 'Drag the curve. Add bass, add space. Even out volume keeps every song at a comfortable level.', go: 'Continue' },
    { v: 'col', h: 'Make it yours.', p: 'Tint the glass any color, and put artwork or your own picture behind it. Try one.', go: 'Continue' },
  ];

  // ---------- what's inside the glass on each screen ----------
  const ART = ['#f2589c,#4a2fd0', '#ffab68,#f2589c', '#56d2ff,#7c3be0', '#ffd36a,#ff78d6', '#7c3be0,#2f2493'];
  const SONGS = [['Slow Motion', 'Your artist'], ['Night Drive', 'Your artist'], ['Paper Moons', 'Another artist'], ['Glasshouse', 'Another artist'], ['Long Way Home', 'One more']];
  const LYRICS = ['Windows down, the night is warm', 'Nothing left to prove', 'The streetlights hum our song', 'Slowing down the city', 'Every word lands on time', 'Right where you left it', 'And the next line waits', 'Glowing, ready to go', 'Hold it for a moment', 'Then we let it move'];
  const TINTS = [['', 'No tint'], ['rgba(124,59,224,.5)', 'Violet'], ['rgba(242,88,156,.5)', 'Pink'], ['rgba(86,210,255,.42)', 'Blue'], ['rgba(255,171,104,.5)', 'Orange']];
  const HTML = `
    <div class="intro-bg"><canvas class="intro-amb" width="170" height="108"></canvas><div class="intro-grain"></div></div>
    <div class="intro-glass">
      <div class="intro-tint"></div>
      <div class="intro-view" data-v="lens"><svg class="intro-play" viewBox="0 0 24 24"><path d="M7 4.6c0-1 1.1-1.6 2-1.1l11.4 7.4c.8.5.8 1.7 0 2.2L9 20.5c-.9.5-2-.1-2-1.1z"/></svg></div>
      <div class="intro-view" data-v="lib"><div class="intro-rows">${SONGS.map(([t, a], i) => `<div class="intro-row"><u style="background:linear-gradient(135deg,${ART[i]})"></u><span><b>${t}</b><s>${a}</s></span><em>${i % 2 ? 'HQ' : 'Hi-Res'}</em></div>`).join('')}</div></div>
      <div class="intro-view" data-v="lyr"><div class="intro-lyr">${LYRICS.map((l) => `<div>${l}</div>`).join('')}</div></div>
      <div class="intro-view" data-v="eq"><canvas class="intro-eq"></canvas></div>
      <div class="intro-view" data-v="col"><div class="intro-sw">${TINTS.map(([c, n]) => `<button type="button" data-t="${c}" aria-label="${n}" style="background:${c || 'rgba(255,255,255,.16)'}"></button>`).join('')}</div></div>
    </div>
    <div class="intro-words"><h1></h1><p></p></div>
    <button type="button" class="intro-go"></button>
    <button type="button" class="intro-skip">Skip</button>
    <div class="intro-ticks">${STEPS.map(() => '<i></i>').join('')}</div>`;

  // ---------- state of the running intro ----------
  let wanted = false;
  let el = null, bg, cv, glass, words, hEl, pEl, go, skip, ticks, lyr, eq, tint;
  let k = 1, ox = 0, oy = 0;
  let step = -1, busy = false, leaving = false, inAccountStep = false, morph = null;
  let finderDue = false, inFinder = false, finderPlace = null, finderStage = null, accountStage = null;
  let timers = [], anims = [], ambRaf = 0, eqRaf = 0, lyT = 0, lyI = 0;
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  // ---------- who sees it: decided right now ----------
  try {
    if (localStorage.getItem(SEEN)) { /* done */ }
    else if (localStorage.getItem(OWED)) wanted = true;
    else if (localStorage.getItem(VERSION)) localStorage.setItem(SEEN, '1');     // updated from before the intro existed
    else { localStorage.setItem(OWED, '1'); wanted = true; }
  } catch { /* no storage: no intro */ }
  if (wanted) page.classList.add('intro-on', 'intro-hide');   // styles.css: nothing of the app paints under it

  function markSeen() {
    try { localStorage.setItem(SEEN, '1'); localStorage.removeItem(OWED); } catch { /* it just shows again */ }
  }

  // ---------- moving background: the app icon's colours glowing on deep indigo ----------
  const BLOBS = [
    ['#7c3be0', .26, .30, .50, .18, .16, 0], ['#f2589c', .78, .68, .40, .17, .18, 1.6], ['#ffab68', .96, 1.02, .26, .08, .08, 3.0],
    ['#56d2ff', .04, .02, .24, .08, .08, 4.3], ['#4a2fd0', .12, .92, .44, .12, .14, 2.2],
  ];
  function drawBg(T) {
    const x = cv.getContext('2d'), CW = cv.width, CH = cv.height;
    x.globalCompositeOperation = 'source-over'; x.fillStyle = '#0d0726'; x.fillRect(0, 0, CW, CH);
    x.globalCompositeOperation = 'lighter';
    for (const [c, bx, by, r, ax, ay, ph] of BLOBS) {
      const cx = (bx + Math.sin(T * .19 + ph) * ax) * CW, cy = (by + Math.cos(T * .15 + ph * 1.3) * ay) * CH, R = r * CW * (1 + Math.sin(T * .11 + ph) * .1);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, c + '8c'); g.addColorStop(.5, c + '38'); g.addColorStop(1, c + '00');
      x.fillStyle = g; x.fillRect(0, 0, CW, CH);
    }
  }
  function ambLoop(n) { drawBg(n / 1000); ambRaf = requestAnimationFrame(ambLoop); }

  // ---------- where things sit: everything recomputes from the window's size ----------
  function measure() {
    const W = innerWidth, H = innerHeight;
    k = Math.min(W / REF_W, H / REF_H);
    ox = (W - REF_W * k) / 2;
    oy = (H - REF_H * k) / 2;
    el.style.setProperty('--k', k);
    el.style.setProperty('--ox', ox + 'px');
    el.style.setProperty('--oy', oy + 'px');
  }
  const box = (name) => { const p = PLACES[name]; return { x: Math.round(ox + p.x * k), y: Math.round(oy + p.y * k), w: Math.round(p.w * k), h: Math.round(p.h * k), r: p.r * k }; };
  // the panel's layout box, whatever animation it's caught in
  const sideBox = () => { const s = document.getElementById('side'); return { x: s.offsetLeft, y: s.offsetTop, w: s.offsetWidth, h: s.offsetHeight, r: parseFloat(getComputedStyle(s).borderTopLeftRadius) || 24 }; };
  const css = (b) => ({ left: b.x + 'px', top: b.y + 'px', width: b.w + 'px', height: b.h + 'px', borderRadius: b.r + 'px' });
  const put = (b) => Object.assign(glass.style, css(b));

  // ---------- the one glass shape ----------
  function moveTo(b, ms = 1100) {
    // from wherever it is now, so going on before it has landed doesn't jump
    const now = getComputedStyle(glass);
    const from = { left: now.left, top: now.top, width: now.width, height: now.height, borderRadius: now.borderTopLeftRadius };
    morph?.cancel();
    glass.classList.add('lg-busy');      // plain frost while it moves, the refraction comes back when it lands
    put(b);
    morph = glass.animate([from, css(b)], { duration: ms, easing: E });
    morph.onfinish = () => { morph = null; Liquid.snap(glass); };
  }
  const showView = (v) => el.querySelectorAll('.intro-view').forEach((e) => e.classList.toggle('on', e.dataset.v === v));

  // ---------- lyrics ----------
  function lyrPaint() {
    const lines = lyr.children;
    [...lines].forEach((e, i) => e.classList.toggle('cur', i === lyI));
    const cur = lines[lyI];
    lyr.style.transform = `translateY(${-(cur.offsetTop + cur.offsetHeight / 2)}px)`;
  }
  function lyrOn(on) {
    clearInterval(lyT);
    if (!on) return;
    lyI = 2; lyrPaint();
    if (!reduceMotion) lyT = setInterval(() => { lyI = lyI >= LYRICS.length - 3 ? 2 : lyI + 1; lyrPaint(); }, 1700);
  }

  // ---------- the sound curve ----------
  function eqPaint(T) {
    const dpr = 2, w = eq.offsetWidth, h = eq.offsetHeight, m = 34 * k;
    if (!w || !h) return;
    if (eq.width !== w * dpr || eq.height !== h * dpr) { eq.width = w * dpr; eq.height = h * dpr; }
    const g = eq.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const y = (u) => h * .55 - Math.sin(u * 4.2 + T * .9) * h * .17 * (1 - u * .35) - Math.sin(u * 9 - T * 1.3) * h * .05 - (1 - u) * (1 - u) * h * .17;
    const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#fff'); grad.addColorStop(1, 'rgba(255,255,255,.75)');
    g.beginPath();
    for (let i = 0; i <= 100; i++) { const u = i / 100, X = m + u * (w - m * 2); i ? g.lineTo(X, y(u)) : g.moveTo(X, y(u)); }
    g.lineWidth = 3 * k; g.lineJoin = 'round'; g.strokeStyle = grad; g.shadowColor = 'rgba(255,255,255,.6)'; g.shadowBlur = 16 * k; g.stroke(); g.shadowBlur = 0;
    g.lineTo(w - m, h); g.lineTo(m, h); g.closePath();
    const fill = g.createLinearGradient(0, h * .3, 0, h); fill.addColorStop(0, 'rgba(255,255,255,.2)'); fill.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fill; g.fill();
    for (const u of [.12, .34, .56, .78]) { const X = m + u * (w - m * 2); g.beginPath(); g.arc(X, y(u), 7 * k, 0, 7); g.fillStyle = '#fff'; g.fill(); }
  }
  function eqLoop(n) { eqPaint(n / 1000); eqRaf = requestAnimationFrame(eqLoop); }
  function eqOn(on) {
    cancelAnimationFrame(eqRaf); eqRaf = 0;
    if (!on) return;
    if (reduceMotion) eqPaint(STILL_T);     // once: it holds still
    else eqRaf = requestAnimationFrame(eqLoop);
  }

  // ---------- the words ----------
  const rise = (px) => (reduceMotion ? {} : { transform: `translateY(${px * k}px)` });
  const still = () => (reduceMotion ? {} : { transform: 'none' });
  // each word holds one animation at a time, so nothing old stays applied to it (a hover still works on the button)
  function animateWord(e, frames, opts) {
    e.getAnimations().forEach((a) => { if (!(a instanceof CSSTransition)) a.cancel(); });
    return e.animate(frames, { easing: E, fill: 'both', ...opts });
  }
  function wordsOut(px, duration, easing) {
    for (const e of [hEl, pEl, go]) {
      const from = getComputedStyle(e).opacity;
      animateWord(e, [{ opacity: from }, { opacity: 0, ...rise(px) }], { duration, easing });
    }
  }
  function setWords(s, first, after) {
    const show = () => {
      words.classList.toggle('center', !!s.center);
      go.classList.toggle('center', !!s.center);
      hEl.textContent = s.h; pEl.textContent = s.p; go.textContent = s.go;
      animateWord(hEl, [{ opacity: 0, ...rise(26) }, { opacity: 1, ...still() }], { duration: 1000 });
      animateWord(pEl, [{ opacity: 0, ...rise(22) }, { opacity: 1, ...still() }], { duration: 1000, delay: 110 });
      animateWord(go, [{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: first ? 900 : 260 });
      ticks.querySelectorAll('i').forEach((t, i) => t.classList.toggle('on', i <= step));
      after?.();
    };
    if (first) return show();
    wordsOut(-12, 340, 'ease-in');
    later(show, 330);
  }

  // ---------- moving through the screens ----------
  // the shape goes to a new place and gets its new contents
  function shapeTo(b, inside) {
    if (!reduceMotion) { moveTo(b); inside(); return; }
    // reduced motion: the shape crossfades instead, out where it is and in where it's going, with its new contents
    const out = glass.animate([{ opacity: getComputedStyle(glass).opacity }, { opacity: 0 }], { duration: 260, easing: E, fill: 'forwards' });
    later(() => {
      put(b); Liquid.snap(glass); inside();
      out.cancel();
      glass.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: E });
    }, 260);
  }
  function goTo(n) {
    if (busy) return;
    busy = true; later(() => { busy = false; }, 600);
    step = n;
    const s = STEPS[n];
    setWords(s, false);
    shapeTo(box(s.v), () => { showView(s.v); lyrOn(s.v === 'lyr'); eqOn(s.v === 'eq'); });
  }
  // the button: on to the next screen, or from the last one to the account step (while there is one) and on
  async function forward() {
    if (busy) return;       // still moving to this screen: a double-click on the one before must not go past the last screen
    if (step < 0 || leaving || inAccountStep || inFinder) return;
    if (step < STEPS.length - 1) return goTo(step + 1);
    return toAccount();
  }
  // the last screen's button, Skip and Esc: on to the account step (while there is one), then the finder and the app
  async function toAccount() {
    if (leaving || inAccountStep || inFinder) return;
    if (Intro.accountStep) {
      inAccountStep = true;
      try {
        // begin() takes the stage over (the words go, the shape becomes the logo): the step calls it only if it has a screen to show.
        // A step with nothing to show returns at once, and then going on takes no extra turn.
        const r = Intro.accountStep({ begin: () => (accountStage = accountStageNow()) });
        if (r && typeof r.then === 'function') await r;
      } catch (e) { console.warn('Intro account step:', e); }
      inAccountStep = false; accountStage = null;
      if (!el) return;
      setInert(false, go);      // the finder's button, and the last screen's if there is no finder, are live again
    }
    leave();
  }

  // ---------- the sign-up screen (signup.js) borrows the stage: the words go, the one glass shape becomes the logo ----------
  // Its layer sits inside the intro, above the background. shape() takes a box in window pixels.
  // Controls that can't be seen must not be reachable by keyboard either.
  const swatches = () => el.querySelector('.intro-sw');
  function setInert(on, ...els) { for (const e of els) if (e) e.inert = on; }
  function accountStageNow() {
    clearTimers();
    busy = false;
    lyrOn(false); eqOn(false);
    tint.style.opacity = 0;
    for (const e of [go, skip]) e.style.pointerEvents = 'none';
    setInert(true, go, skip, swatches());
    for (const e of [hEl, pEl, go, skip, ticks]) animateWord(e, [{ opacity: getComputedStyle(e).opacity }, { opacity: 0, ...rise(-12) }], { duration: reduceMotion ? 240 : 340, easing: 'ease-in' });
    return {
      root: el, glass,
      shape(b, inside) { shapeTo(b, inside || (() => {})); showView('lens'); },
      put,
      onResize: null,      // signup.js fills this in
    };
  }

  // ---------- the song finder (firstrun.js) borrows the stage: the words, the button and the one glass shape ----------
  // The last screen's button, Skip and Esc all come through here. Only a fresh install with an empty library has the window
  // due, once; everyone else goes straight into the app.
  async function leave() {
    if (!el || leaving || inFinder || inAccountStep) return;
    if (!finderDue || !Intro.finderStep) return enter();
    finderDue = false;
    inFinder = true;
    clearTimers();
    busy = false;
    // whatever the shape was caught doing (still arriving, part way through a crossfade) carries on from where it is
    const now = getComputedStyle(glass), o = now.opacity, tf = now.transform;
    glass.getAnimations().forEach((a) => { if (a !== morph && !(a instanceof CSSTransition)) a.cancel(); });
    if (+o < 1 || tf !== 'none') glass.animate([{ opacity: o, ...(reduceMotion ? {} : { transform: tf }) }, { opacity: 1, ...still() }], { duration: 500, easing: E });
    lyrOn(false); eqOn(false);
    tint.style.opacity = 0;
    go.style.pointerEvents = 'none';      // firstrun.js gives it back with its own words on it
    skip.style.pointerEvents = 'none';
    setInert(true, skip, swatches());
    for (const e of [skip, ticks]) animateWord(e, [{ opacity: getComputedStyle(e).opacity }, { opacity: 0, ...rise(-14) }], { duration: reduceMotion ? 240 : 480 });
    finderStage = {
      root: el, glass, go, p: pEl,
      say: (s, after) => setWords(s, false, after),
      // to one of PLACES, and inside() once the shape has its new contents to show
      shape(name, inside) { finderPlace = name; shapeTo(box(name), inside || (() => {})); },
      show(node) {
        const v = document.createElement('div');
        v.className = 'intro-view'; v.dataset.v = 'finder';
        v.appendChild(node);
        glass.appendChild(v);
        showView('finder');
      },
      box, scale: () => k,
      onKey: null, onResize: null,      // firstrun.js fills these in
    };
    try { await Intro.finderStep(finderStage); } catch (e) { console.warn('Intro finder step:', e); }
    inFinder = false; finderPlace = null; finderStage = null;
    if (el) enter();
  }

  function onSwatch(e) {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    tint.style.backgroundColor = b.dataset.t || 'transparent';
    tint.style.opacity = b.dataset.t ? 1 : 0;
  }
  function onKey(e) {
    if (inAccountStep) return;    // its keyboard while it's up
    e.stopPropagation();          // the app's own shortcuts wait until the intro is over
    if (leaving) return;
    if (inFinder) { finderStage?.onKey?.(e); return; }
    if (e.key === 'ArrowRight' && step >= 0 && step < STEPS.length - 1) goTo(step + 1);
    else if (e.key === 'ArrowLeft' && step > 0) goTo(step - 1);
    else if (e.key === 'Escape') toAccount();
  }
  function onResize() {
    measure();
    if (leaving) { if (!reduceMotion) { morph?.cancel(); morph = null; put(sideBox()); } return; }
    morph?.cancel(); morph = null;
    if (inAccountStep) { accountStage?.onResize?.(); return; }
    put(box(finderPlace || (step < 0 ? 'lens' : STEPS[step].v)));    // the shape's own resize watcher fits its glass once this settles
    if (inFinder) { finderStage?.onResize?.(); return; }
    if (step >= 0 && STEPS[step].v === 'lyr') lyrPaint();
    if (reduceMotion && step >= 0 && STEPS[step].v === 'eq') eqPaint(STILL_T);
  }
  // a song dropped on the window is a song opened: same as opening one from Explorer
  function onDrop(e) { if (e.dataTransfer?.files?.length) finish(); }

  // ---------- the real panels, for the hand-over ----------
  // Each glass panel fades by itself, never through a parent: opacity on a parent would cut it off from what it bends.
  function appParts() {
    const shown = (s) => { const e = document.querySelector(s); return e && e.offsetWidth ? [e] : []; };
    return { stage: [...shown('#empty'), ...shown('#art'), ...shown('video.on')], words: [...shown('#nowMeta'), ...shown('#lyrics')], side: shown('#side'), dock: shown('#dock'), gear: shown('#btnSettings') };
  }

  // ---------- into the app: the shape becomes the side panel, the rest of the app rises around it ----------
  function enter() {
    if (!el || leaving) return;
    leaving = true;
    markSeen();
    clearTimers();
    anims.forEach((a) => a.cancel()); anims = [];
    el.classList.add('leaving');
    const rm = reduceMotion;
    if (!rm) showView(null);      // with reduced motion the contents just fade away along with the shape
    lyrOn(false); eqOn(false);
    tint.style.opacity = 0;
    wordsOut(-14, rm ? 240 : 480);
    for (const e of [skip, ticks]) animateWord(e, [{ opacity: getComputedStyle(e).opacity }, { opacity: 0, ...rise(-14) }], { duration: rm ? 240 : 480 });

    const app = appParts();
    const arrive = (e, from, delay, duration) => anims.push(e.animate(
      [{ opacity: 0, ...(rm || !from ? {} : { transform: from }), offset: 0 }],     // to wherever it really sits
      { delay: rm ? 180 : delay, duration: rm ? 420 : duration, easing: E, fill: 'backwards' }));
    app.stage.forEach((e) => arrive(e, 'scale(.82)', 340, 1200));
    app.words.forEach((e) => arrive(e, `translateY(${14 * k}px)`, 800, 1000));
    app.dock.forEach((e) => arrive(e, `translateY(${60 * k}px)`, 520, 1200));
    app.gear.forEach((e) => arrive(e, null, 800, 900));
    app.side.forEach((e) => arrive(e, null, 1250, 700));
    page.classList.remove('intro-hide');     // in this same moment as the lines above, so nothing shows before it should

    bg.animate([{ opacity: getComputedStyle(bg).opacity }, { opacity: 0 }], { delay: rm ? 100 : 800, duration: rm ? 500 : 1400, easing: E, fill: 'both' });
    const hasSide = sideBox().w > 0;       // no panel to land on in fullscreen video: the shape just fades
    if (!rm && hasSide) later(() => moveTo(sideBox(), 1250), 180);
    glass.animate([{ opacity: getComputedStyle(glass).opacity }, { opacity: 0 }], { delay: rm ? 0 : hasSide ? 1550 : 300, duration: rm ? 300 : 450, easing: E, fill: 'both' });
    later(finish, rm ? 650 : 2300);
  }

  // ---------- stop everything: nothing of it is left running or in the page ----------
  function finish() {
    wanted = false;
    finderDue = false;
    page.classList.remove('intro-on', 'intro-hide');
    if (!el) return;
    window.Signup?.abort();          // the sign-up screen, if it was the one showing
    window.FirstRun?.abandon();      // a scan that was getting ready for it, or the window itself if it was up
    clearTimers();
    cancelAnimationFrame(ambRaf); cancelAnimationFrame(eqRaf); clearInterval(lyT);
    removeEventListener('resize', onResize);
    removeEventListener('keydown', onKey, true);
    removeEventListener('drop', onDrop);
    morph?.cancel(); morph = null;
    anims.forEach((a) => a.cancel()); anims = [];
    Liquid.unwatch(glass);
    el.remove();
    el = null;
  }

  // ---------- start ----------
  function open(overApp) {
    step = -1; busy = false; leaving = false; inAccountStep = false;
    page.classList.add('intro-on');
    el = document.createElement('div');
    el.id = 'intro';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome to Glassy');
    el.innerHTML = HTML;
    const q = (s) => el.querySelector(s);
    bg = q('.intro-bg'); cv = q('.intro-amb'); glass = q('.intro-glass'); words = q('.intro-words'); hEl = q('h1'); pEl = q('p');
    go = q('.intro-go'); skip = q('.intro-skip'); ticks = q('.intro-ticks'); lyr = q('.intro-lyr'); eq = q('.intro-eq'); tint = q('.intro-tint');
    document.body.appendChild(el);
    measure();

    go.addEventListener('click', forward);
    skip.addEventListener('click', toAccount);
    q('.intro-sw').addEventListener('click', onSwatch);
    addEventListener('resize', onResize);
    addEventListener('keydown', onKey, true);
    addEventListener('drop', onDrop);

    if (reduceMotion) drawBg(STILL_T); else ambRaf = requestAnimationFrame(ambLoop);
    cv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 2200, easing: 'ease', fill: 'both' });

    put(box('lens'));
    Liquid.watch(glass);
    if (reduceMotion) glass.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, delay: 300, easing: E, fill: 'both' });
    else glass.animate([{ opacity: 0, transform: 'scale(.72)' }, { opacity: 1, transform: 'none' }], { duration: 1500, delay: 500, easing: E, fill: 'both' });
    showView('lens');
    skip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 1500, fill: 'both' });
    later(() => { step = 0; setWords(STEPS[0], true); }, 900);

    if (!overApp) { page.classList.add('intro-hide'); return; }
    // Replay: the app fades away under the background coming in, and the window buttons never leave
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, easing: E, fill: 'backwards' });
    const app = appParts();
    for (const e of [...app.stage, ...app.words, ...app.dock, ...app.gear, ...app.side]) anims.push(e.animate([{ opacity: 0 }], { duration: 420, easing: E, fill: 'forwards' }));
    later(() => { page.classList.add('intro-hide'); anims.forEach((a) => a.cancel()); anims = []; }, 520);
  }

  window.Intro = {
    accountStep: null,      // signup.js, the sign-up screen: runs after the last screen, before the song finder. Gets { begin() }, which hands it the stage; may return a promise.
    finderStep: null,       // firstrun.js, "Here's what we found": after any account step, before entering the app. Gets the stage, returns a promise.
    maybeShow() { if (wanted && !el) open(false); },
    replay() { if (!el) open(true); },
    // a song was opened: out of the way at once, and it still counts as not seen
    dismiss: finish,
    // app.js, once the saved library is in (and before any song opened from Explorer joins it): someone who already has
    // songs or playlists doesn't need this
    libraryLoaded() {
      const empty = lib.size === 0 && S.playlists.length === 0;
      if (wanted && !empty) { markSeen(); finish(); }
      // A first launch with nothing in the library: the song finder is due after this intro, and its scan starts now so the
      // results are there when the intro reaches them. The scripts may not all be in yet at this point.
      if (!wanted || !empty || leaving) return;
      finderDue = true;
      const ready = () => { if (finderDue) window.FirstRun?.prepare(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
      else ready();
    },
  };
  document.addEventListener('DOMContentLoaded', () => Intro.maybeShow());
})();
