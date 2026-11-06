'use strict';
// The first-launch intro. Run: node scripts/ui-test.js tests/ui/intro.js
// Everything here runs inside the real app, off-screen and muted, on fresh data folders.

// ---- shared page-side checks. Each is stringified into the page, so they're passed in as source text ----
const COMMON = `
  // counts animation frames asked for from inside intro.js
  T.spyFrames = () => {
    const real = window.requestAnimationFrame.bind(window), spy = { n: 0 };
    window.requestAnimationFrame = (cb) => { if ((new Error().stack || '').includes('intro.js')) spy.n++; return real(cb); };
    return spy;
  };
  T.shown = () => !!document.querySelector('#intro');
  T.next = async () => { document.querySelector('.intro-go').click(); await T.wait(700); };
  T.ended = async (what) => {
    await T.until(() => !T.shown(), what + ': the intro ends', 9000);
  };
  // the app is really there and usable, with nothing of the intro left behind
  T.appIsBack = async (what) => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    T.ok(!T.shown(), what + ': overlay removed');
    await new Promise(requestAnimationFrame);    // under reduced motion the app gives every property a tiny transition: one frame
    T.ok(!document.querySelector('[class*="intro-"]'), what + ': no intro element left');
    T.ok(!document.documentElement.className.includes('intro'), what + ': no intro class left on the page');
    T.ok(cs('.app').zIndex === '2', what + ': app back at its own layer, got ' + cs('.app').zIndex);
    T.ok(cs('.app').pointerEvents === 'auto', what + ': app takes clicks again');
    for (const s of ['#side', '#dock', '#stage', '.ambient', '#btnSettings']) {
      T.ok(cs(s).visibility === 'visible', what + ': ' + s + ' visible');
      await T.until(() => +cs(s).opacity === 1, what + ': ' + s + ' fully opaque, got ' + cs(s).opacity, 1500);   // the app's own first rise, if it's that early
    }
    for (const s of ['#side', '#dock']) {
      const stuck = document.querySelector(s).getAnimations().filter((a) => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition));
      T.ok(!stuck.length, what + ': no leftover animation on ' + s);
    }
    const spy = T.frames;
    if (spy) { const n = spy.n; await T.wait(250); T.ok(spy.n === n, what + ': intro.js stopped asking for animation frames'); }
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight - 40);
    T.ok(hit && hit.closest('#dock'), what + ': the dock takes clicks, got ' + (hit && (hit.id || hit.className)));
  };
`;
const page = (fn) => `async (T) => { ${COMMON} await (${fn})(T); }`;

const WELCOME = 'Glassy';
const HEADINGS = [WELCOME, 'Everything you already have.', 'Lyrics that follow along.', 'Sound you can shape.', 'Make it yours.'];
const vars = { HEADINGS };

// ---- a new install ----
const newInstall = page(async (T) => {
  T.frames = T.spyFrames();
  T.ok(T.shown(), 'new install: the intro shows');
  const script = document.head.querySelector('script[src="intro.js"]');
  T.ok(script, 'the decision is made from <head>, before anything in <body> can paint');
  T.ok(window.Intro && Intro.accountStep === null, 'Intro.accountStep is an empty slot');
  T.ok(localStorage.getItem('glass.introSeen') === null, 'not marked seen yet');
  const root = T.$('#intro');
  if (!root) return;

  // it's above the modals, below the window rim, and fills the window
  const z = +getComputedStyle(root).zIndex;
  T.ok(z > 80 && z < 200, 'overlay layer between modals and rim, got ' + z);
  const b = T.box(root);
  T.ok(b.x === 0 && b.y === 0 && b.w === innerWidth && b.h === innerHeight, 'overlay fills the window');
  T.ok(getComputedStyle(T.$('#side')).visibility === 'hidden', 'the app panels are hidden under it');

  // the background moves
  await T.wait(350);
  T.ok(T.frames.n > 3, 'the moving background is running, frames: ' + T.frames.n);
  T.ok(T.$('canvas.intro-amb').width <= 200, 'the background is a small canvas');
  const glassFilter = /url\(#(.+?)\)/.exec(getComputedStyle(T.$('.intro-glass')).getPropertyValue('--lg'))?.[1];
  T.ok(glassFilter && document.getElementById(glassFilter), 'the shape wears a real glass filter');

  // the title bar still works: real window buttons on top, the strip still drags
  for (const w of document.querySelectorAll('.wbtn[data-win]')) {
    const r = w.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    T.ok(hit && hit.closest('.wbtn') === w, w.dataset.win + ' window button takes clicks over the intro');
    T.ok(getComputedStyle(w).visibility === 'visible' && +getComputedStyle(w).opacity > 0.5, w.dataset.win + ' window button is visible');
  }
  const strip = document.elementFromPoint(innerWidth / 2, 20);
  T.ok(strip && strip.closest('.titlebar'), 'the top strip is the title bar, got ' + (strip && (strip.id || strip.className)));
  T.ok(getComputedStyle(T.$('.titlebar')).webkitAppRegion === 'drag', 'the top strip drags the window');
  T.ok(getComputedStyle(T.$('#btnSettings')).visibility === 'hidden', 'no gear on the intro');

  // Skip sits below the strip and works as a button
  const skip = T.box('.intro-skip');
  T.ok(skip && skip.y >= 44, 'Skip is below the title bar, top ' + (skip && skip.y));
  if (skip) T.ok(document.elementFromPoint(skip.x + skip.w / 2, skip.y + skip.h / 2)?.closest('.intro-skip'), 'Skip takes clicks');

  // walk every screen, in order
  await T.until(() => T.$('.intro-words h1')?.textContent === T.vars.HEADINGS[0], 'the welcome screen');
  await T.wait(700);
  for (let i = 1; i < T.vars.HEADINGS.length; i++) {
    await T.next();
    await T.until(() => T.$('.intro-words h1')?.textContent === T.vars.HEADINGS[i], 'screen ' + T.vars.HEADINGS[i], 2000);
  }

  // the app's shortcuts wait: pressing s doesn't toggle shuffle behind the intro
  const before = S.shuffle;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  T.ok(S.shuffle === before, "the app's keyboard shortcuts don't reach through the intro");

  // accounts off: the last Continue goes straight into the app
  T.$('.intro-go').click();
  await T.wait(250);
  T.ok(!document.querySelector('#intro form, #intro input, #intro fieldset'), 'no account screen while accounts are off');
  T.ok(!/sign (up|in)/i.test(document.querySelector('#intro')?.textContent || ''), 'no sign-up words on the way out');
  await T.ended('finishing');
  T.ok(localStorage.getItem('glass.introSeen'), 'marked seen after finishing');
  T.ok(!document.querySelector('canvas.intro-amb, canvas.intro-eq'), "the intro's canvases are gone");
  T.ok(glassFilter && !document.getElementById(glassFilter), 'the intro took its glass filter with it: ' + glassFilter);
  await T.appIsBack('finishing');
});

// ---- launched again: not shown. Replay from Settings, and Skip from every screen ----
const launchedAgain = page(async (T) => {
  T.frames = T.spyFrames();
  T.ok(!T.shown(), 'seen once: not shown again');
  T.ok(!document.documentElement.className.includes('intro'), 'seen once: nothing hidden for the intro');
  await T.wait(1000);
  T.ok(!T.shown() && T.frames.n === 0, 'seen once: still nothing after the library loads');

  const filtersBefore = document.querySelectorAll('svg filter').length;
  Settings.open();
  await T.wait(600);
  const btn = T.$('[data-replay-intro]');
  T.ok(btn, 'Settings has a Replay intro row');
  if (!btn) return;
  T.ok(/intro/i.test(btn.closest('.set-row').textContent), 'the row says what it replays');
  btn.click();
  await T.until(() => T.shown(), 'Replay shows the intro');
  await T.until(() => T.$('#modalRoot').hidden, 'Replay closes Settings');
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'Replay starts from the welcome screen');
  await T.wait(650);
  T.$('.intro-skip').click();
  await T.ended('replay');
  await T.appIsBack('replay');

  // Skip works from every screen, including the moment it opens
  for (let i = -1; i < T.vars.HEADINGS.length; i++) {
    Intro.replay();
    if (i >= 0) {
      await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome before skipping');
      await T.wait(650);
      for (let n = 0; n < i; n++) await T.next();
    } else await T.wait(40);
    T.$('.intro-skip').click();
    await T.ended('Skip from screen ' + i);
    await T.appIsBack('Skip from screen ' + i);
  }
  T.ok(document.querySelectorAll('svg filter').length === filtersBefore, 'no filters pile up over replays');
  T.ok(localStorage.getItem('glass.introSeen'), 'still marked seen');

  // Esc is Skip too, and the arrows move between screens
  Intro.replay();
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(650);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await T.until(() => T.$('.intro-words h1')?.textContent === T.vars.HEADINGS[1], 'right arrow goes forward', 1500);
  await T.wait(650);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await T.until(() => T.$('.intro-words h1')?.textContent === T.vars.HEADINGS[0], 'left arrow goes back', 1500);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.ended('Esc');
  await T.appIsBack('Esc');
});

// ---- someone who already has a library or playlists never sees it ----
const notForExisting = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  T.ok(!T.shown(), T.vars.what + ': no intro');
  T.ok(!document.documentElement.className.includes('intro'), T.vars.what + ': nothing hidden for the intro');
  T.ok(localStorage.getItem('glass.introSeen'), T.vars.what + ': marked seen');
  T.ok(getComputedStyle(T.$('#side')).visibility === 'visible', T.vars.what + ': the app is visible');
});
const track = (song) => ({ path: song, url: 'file:///' + song.replace(/\\/g, '/'), name: 'Test-Song' });

// ---- updating from an older version: the version note exists, so it's an existing user, decided on the spot ----
const seedVersionNote = page(async (T) => {
  localStorage.removeItem('glass.introSeen');
  localStorage.removeItem('glass.introOwed');
  localStorage.setItem('glass.seenVersion', '0.2.17');
  await T.wait(300);
});
const updater = page(async (T) => {
  T.ok(!T.shown(), 'updating user: no intro');
  T.ok(!document.documentElement.className.includes('intro'), 'updating user: nothing hidden, even before the library loads');
  T.ok(localStorage.getItem('glass.introSeen'), 'updating user: marked seen');
});

// ---- reduced motion: nothing moves, screens crossfade ----
const reduced = page(async (T) => {
  T.frames = T.spyFrames();
  T.ok(reduceMotion === true, 'the test really has reduced motion on');
  T.ok(T.shown(), 'reduced motion: the intro still shows');
  const pixels = () => { const c = T.$('canvas.intro-amb'); return c ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join() : ''; };
  const a = pixels();
  await T.wait(600);
  T.ok(a && a === pixels(), 'reduced motion: the background holds still');
  T.ok(T.frames.n === 0, 'reduced motion: no animation loop, frames: ' + T.frames.n);
  const moving = (el) => el.getAnimations().filter((x) => {
    if (x instanceof CSSTransition && x.transitionProperty === 'opacity') return false;
    return x.effect.getKeyframes().some((k) => ['left', 'top', 'width', 'height', 'transform', 'translate'].some((p) => k[p] && k[p] !== 'none'));
  });

  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(700);
  const glass = T.$('.intro-glass');
  T.ok(!moving(glass).length, 'reduced motion: the glass shape does not glide in');
  T.$('.intro-go').click();
  await T.wait(30);
  T.ok(!moving(glass).length, 'reduced motion: the glass shape crossfades instead of gliding');
  T.ok(glass.getAnimations().some((x) => x.effect.getKeyframes().some((k) => 'opacity' in k)), 'reduced motion: the glass shape fades');
  T.ok(!moving(T.$('.intro-words h1')).length, 'reduced motion: the words only fade');
  await T.until(() => T.$('.intro-words h1')?.textContent === T.vars.HEADINGS[1], 'second screen', 2000);
  T.ok(!moving(T.$('.intro-words h1')).length, 'reduced motion: the new words only fade');
  await T.wait(800);
  const box = T.box(glass);
  T.ok(box.x > innerWidth / 2 && +getComputedStyle(glass).opacity === 1, 'reduced motion: the shape is at its new place');

  // what you see of the contents is the shape's opacity times their own. Frame by frame, the old ones leave and the
  // new ones arrive gradually with the shape: no frame where they snap, and frames where they're part-way
  const arriving = T.$('.intro-view[data-v="lyr"]'), leaving = T.$('.intro-view[data-v="lib"]');
  const seen = [];
  let sampling = true;
  const sample = () => {
    const g = +getComputedStyle(glass).opacity;
    seen.push({ in: g * +getComputedStyle(arriving).opacity, out: g * +getComputedStyle(leaving).opacity });
    if (sampling) requestAnimationFrame(sample);
  };
  T.$('.intro-go').click();
  sample();
  await T.wait(1100);
  sampling = false;
  const jump = (k) => seen.reduce((top, f, i) => (i ? Math.max(top, Math.abs(f[k] - seen[i - 1][k])) : top), 0);
  T.ok(seen.length > 20, 'reduced motion: enough frames sampled, got ' + seen.length);
  T.ok(seen.at(-1).in === 1 && seen.at(-1).out === 0, 'reduced motion: the new contents end fully there, the old ones fully gone');
  T.ok(seen.some((f) => f.in > 0.05 && f.in < 0.95), 'reduced motion: the new contents pass through part-way');
  T.ok(seen.some((f) => f.out > 0.05 && f.out < 0.95), 'reduced motion: the old contents pass through part-way');
  T.ok(jump('in') < 0.5, 'reduced motion: the new contents fade in with the shape, biggest jump in one frame ' + jump('in').toFixed(2));
  T.ok(jump('out') < 0.5, 'reduced motion: the old contents fade out with the shape, biggest jump in one frame ' + jump('out').toFixed(2));

  // the still pictures inside the shape: the lyrics don't scroll, the curve is drawn once and isn't stretched
  const lyr = T.$('.intro-lyr').style.transform;
  T.ok(lyr && T.$('.intro-lyr .cur'), 'reduced motion: the lyrics are in place');
  await T.wait(1900);
  T.ok(T.$('.intro-lyr').style.transform === lyr, 'reduced motion: the lyrics hold still');
  T.$('.intro-go').click();
  await T.wait(800);
  const eq = T.$('.intro-eq');
  T.ok(eq.width === eq.offsetWidth * 2 && eq.height === eq.offsetHeight * 2, 'reduced motion: the curve fits its box, canvas ' + eq.width + 'x' + eq.height + ', box ' + eq.offsetWidth + 'x' + eq.offsetHeight);
  T.ok(T.frames.n === 0, 'reduced motion: the curve runs no loop');

  T.$('.intro-skip').click();
  await T.wait(30);
  T.ok(!moving(glass).length, 'reduced motion: no morph on the way into the app');
  for (const s of ['#side', '#dock', '#empty']) T.ok(!moving(T.$(s)).length, 'reduced motion: ' + s + ' does not rise');
  await T.ended('reduced motion');
  await T.appIsBack('reduced motion');
  T.ok(T.frames.n === 0, 'reduced motion: still no animation loop');
});

// ---- a song opened from Explorer on first launch ----
const fromExplorer = page(async (T) => {
  T.frames = T.spyFrames();
  await T.until(() => !T.shown(), 'the song dismisses the intro', 400);
  await T.until(() => typeof current === 'function' && current(), 'the song is loaded', 3000);
  await T.until(() => !deck.paused, 'the song plays', 4000);
  T.ok(localStorage.getItem('glass.introSeen') === null, 'the intro stays unseen');
  await T.appIsBack('opened from Explorer');
  T.ok(T.frames.n === 0, 'opened from Explorer: no intro loop left');
  await T.wait(800);      // the song reaches the saved library
});
const afterExplorer = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  T.ok(lib.size === 1, 'the library holds the song from last time, got ' + lib.size);
  await T.wait(500);
  T.ok(T.shown(), 'the next plain launch shows the intro, even with that song in the library');
  if (!T.shown()) return;
  T.$('.intro-skip').click();
  await T.ended('next launch');
  T.ok(localStorage.getItem('glass.introSeen'), 'now it counts as seen');
});

// ---- a song opened while it's playing (second copy of the app, or a drop): it gets out of the way too ----
const openedDuring = page(async (T) => {
  T.ok(T.shown(), 'new install: shown');
  await T.wait(600);
  Intro.dismiss();
  T.ok(!T.shown(), 'dismiss ends it at once');
  T.ok(localStorage.getItem('glass.introSeen') === null, 'dismissed is not seen');
  await T.appIsBack('dismissed');

  // a file dropped on the intro counts the same
  Intro.replay();
  await T.wait(300);
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'nothing.txt'));
  document.body.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  T.ok(!T.shown(), 'a dropped file ends it at once');
  await T.appIsBack('dropped');
});

// ---- closing the app part way through: it comes back next time (the version note must not count as "existing user") ----
const closedPartWay = page(async (T) => {
  T.ok(T.shown(), 'first launch: shown');
  await T.until(() => localStorage.getItem('glass.seenVersion'), 'the app notes its version', 25000);
  await T.wait(200);
});
const reopened = page(async (T) => {
  T.ok(T.shown(), 'closed part way: shown again next launch');
});

// ---- the account slot: a later task fills it, it runs before entering the app ----
const accountSlot = page(async (T) => {
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(650);
  let calls = 0, release;
  Intro.accountStep = () => { calls++; return new Promise((r) => { release = r; }); };
  for (let i = 1; i < T.vars.HEADINGS.length; i++) await T.next();
  T.$('.intro-go').click();
  T.$('.intro-go').click();
  await T.wait(1500);
  T.ok(calls === 1, 'the slot runs once, ran ' + calls);
  T.ok(T.shown() && !T.$('#intro').classList.contains('leaving'), 'the app waits for the slot');
  // while it's up the keyboard is the slot's: its own text boxes hear keys, and Esc doesn't skip past it
  const input = document.createElement('input');
  input.type = 'text';
  document.body.appendChild(input);
  let heard = 0;
  input.addEventListener('keydown', () => heard++);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  input.remove();
  T.ok(heard === 2, 'the slot hears its own keys, heard ' + heard);
  T.ok(!T.$('#intro').classList.contains('leaving'), 'Esc does not skip past the slot');
  release();
  await T.ended('after the slot');
  T.ok(localStorage.getItem('glass.introSeen'), 'seen after the slot');
  await T.appIsBack('after the slot');
  Intro.accountStep = null;
});

// ---- a double-click moves one screen, never past a screen: the intro only shows once, so a lost screen is lost for good ----
const doubleClick = page(async (T) => {
  const heading = () => T.$('.intro-words h1')?.textContent;
  await T.until(() => heading() === 'Glassy', 'welcome');
  await T.wait(650);
  let calls = 0;
  Intro.accountStep = () => { calls++; };
  for (let i = 1; i < T.vars.HEADINGS.length; i++) {
    T.$('.intro-go').click();
    await T.wait(120);
    T.$('.intro-go').click();
    await T.wait(800);
    const at = 'double-click towards ' + T.vars.HEADINGS[i];
    T.ok(heading() === T.vars.HEADINGS[i], at + ': lands on that screen, got ' + heading());
    T.ok(T.shown() && !T.$('#intro').classList.contains('leaving'), at + ': not on the way into the app');
    T.ok(calls === 0, at + ': the account step stays shut');
    T.ok(localStorage.getItem('glass.introSeen') === null, at + ': not marked seen');
  }
  // and the last screen's own button still does its job
  T.$('.intro-go').click();
  await T.ended('after the double-clicks');
  T.ok(calls === 1, 'the account step ran once, from the last screen, ran ' + calls);
  T.ok(localStorage.getItem('glass.introSeen'), 'seen after really finishing');
});

// ---- every size: fills the window, words never touch the glass ----
const sizes = page(async (T) => {
  const [W, H] = T.vars.size.split('x').map(Number);
  T.ok(innerWidth === W && innerHeight === H, 'the test window is ' + T.vars.size + ', got ' + innerWidth + 'x' + innerHeight);
  const check = (at) => {
    const glass = T.box('.intro-glass'), words = T.box('.intro-words'), h = T.box('.intro-words h1'), p = T.box('.intro-words p'), go = T.box('.intro-go'), skip = T.box('.intro-skip'), ticks = T.box('.intro-ticks');
    T.ok(T.inWindow(glass), at + ': the glass is inside the window');
    for (const [n, b] of [['words', words], ['heading', h], ['text', p], ['button', go], ['ticks', ticks]]) {
      T.ok(!T.overlap(glass, b), at + ': ' + n + ' clear of the glass');
      T.ok(T.inWindow(b), at + ': ' + n + ' inside the window');
    }
    T.ok(!T.overlap(words, go), at + ': words clear of the button');
    T.ok(!T.overlap(glass, skip), at + ': Skip clear of the glass');
    T.ok(glass.y >= 44, at + ': the glass is below the title bar');
    T.ok(skip.y >= 44, at + ': Skip is below the title bar');
    const lg = getComputedStyle(T.$('.intro-glass')).getPropertyValue('--lg').trim();
    const id = /url\(#(.+?)\)/.exec(lg)?.[1];
    const f = id && document.getElementById(id);
    T.ok(f && Math.abs(+f.getAttribute('width') - glass.w) <= 1 && Math.abs(+f.getAttribute('height') - glass.h) <= 1, at + ': the glass filter fits this shape');
  };
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(1800);
  check('welcome');
  T.ok(Math.abs(T.box('.intro-glass').x + T.box('.intro-glass').w / 2 - W / 2) < 2, 'welcome: the glass is centered');
  for (let i = 1; i < T.vars.HEADINGS.length; i++) {
    await T.next();
    await T.wait(1000);
    check(T.vars.HEADINGS[i]);
    if (T.vars.HEADINGS[i].startsWith('Sound')) {
      const eq = T.$('.intro-eq');
      T.ok(eq.width === eq.offsetWidth * 2 && eq.height === eq.offsetHeight * 2, 'the curve fits its box');
    }
  }
  // nothing scales the page: a transform on an ancestor breaks the glass
  for (let e = T.$('.intro-glass').parentElement; e; e = e.parentElement) T.ok(getComputedStyle(e).transform === 'none', 'no transform above the glass on ' + (e.id || e.tagName));
  T.$('.intro-skip').click();
  await T.ended('size ' + T.vars.size);
  await T.appIsBack('size ' + T.vars.size);
});

// ---- the window changes size while the intro is on ----
const resizing = page(async (T) => {
  const same = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.w - b.w) <= 1 && Math.abs(a.h - b.h) <= 1;
  const sized = async (w, h) => { window.resizeTo(w, h); await T.until(() => innerWidth === w && innerHeight === h, 'the window resizes to ' + w + 'x' + h, 3000); await T.wait(400); };
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(1800);
  await T.next();
  await T.next();
  await T.wait(1000);
  const wide = T.box('.intro-glass');
  await sized(900, 600);
  const small = T.box('.intro-glass');
  T.ok(small.w < wide.w && small.h < wide.h, 'the shape recomputes on resize');
  T.ok(T.inWindow(small), 'still inside the smaller window');
  for (const s of ['.intro-words', '.intro-go', '.intro-ticks']) T.ok(!T.overlap(small, T.box(s)) && T.inWindow(T.box(s)), s + ' still clear and inside after resize');
  T.ok(T.box('#intro').w === 900 && T.box('#intro').h === 600, 'the overlay follows the window');
  await T.wait(400);
  const lg = /url\(#(.+?)\)/.exec(getComputedStyle(T.$('.intro-glass')).getPropertyValue('--lg'))?.[1];
  T.ok(lg && +document.getElementById(lg).getAttribute('width') === Math.round(small.w), 'the glass filter refits after resize');
  T.$('.intro-skip').click();
  await T.wait(500);
  await sized(1100, 700);        // mid-way into the app
  await T.ended('resize');
  T.ok(T.box('#side').r <= 1100, 'the panel fits the new window');
  await T.appIsBack('resize');
});

// ---- the hand-over: the shape lands exactly on the real panel with no jump anywhere ----
const handOver = page(async (T) => {
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(1800);
  for (let i = 1; i < T.vars.at; i++) await T.next();
  await T.wait(800);
  const side = T.$('#side'), glass = T.$('.intro-glass'), dock = T.$('#dock'), bg = T.$('.intro-bg');
  const op = (e) => +getComputedStyle(e).opacity;
  const frames = [];
  const sample = () => {
    const g = T.box(glass), d = T.box(dock);
    frames.push({ t: performance.now(), g, radius: parseFloat(getComputedStyle(glass).borderTopLeftRadius), gOp: op(glass), sideOp: op(side), dockOp: op(dock), dockY: d.y, bgOp: op(bg), empty: op(T.$('#empty')) });
    if (T.$('#intro')?.isConnected && glass.isConnected) requestAnimationFrame(sample);
  };
  // the last screen's own button, or Skip from any other
  if (T.vars.at === T.vars.HEADINGS.length) T.$('.intro-go').click(); else T.$('.intro-skip').click();
  sample();
  await T.ended('hand-over');
  await T.wait(50);
  T.ok(frames.length > 30, 'enough frames sampled, got ' + frames.length);
  // the very last sample can be taken after removal (an empty box), so look at the last real one
  while (frames.length > 1 && !frames[frames.length - 1].g.w) frames.pop();
  const last = frames[frames.length - 1];
  const target = T.box(side);
  // the shape ends exactly on the real panel
  for (const k of ['x', 'y', 'w', 'h']) T.ok(Math.abs(last.g[k] - target[k]) <= 1, 'the shape lands on #side ' + k + ': ' + last.g[k] + ' vs ' + target[k]);
  T.ok(Math.abs(last.radius - parseFloat(getComputedStyle(side).borderTopLeftRadius)) < 0.5, 'the shape takes the panel radius, got ' + last.radius);
  // nothing teleports between frames
  let worst = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], dt = Math.max(1, b.t - a.t);
    for (const k of ['x', 'y', 'w', 'h']) worst = Math.max(worst, Math.abs(b.g[k] - a.g[k]) / dt);
  }
  const speedLimit = 3 * (innerWidth / 1240);     // the longest glide, at its fastest moment, stays under this
  T.ok(worst < speedLimit, 'the shape glides with no jump, worst ' + worst.toFixed(2) + ' px/ms');
  // real panels only ever fade in, the intro's background only ever fades out, and all of it is done before the overlay goes
  const mono = (k, dir) => frames.every((f, i) => !i || (dir > 0 ? f[k] >= frames[i - 1][k] - 0.001 : f[k] <= frames[i - 1][k] + 0.001));
  T.ok(mono('sideOp', 1), 'the real panel fades in without flicker');
  T.ok(mono('dockOp', 1), 'the dock fades in without flicker');
  T.ok(mono('empty', 1), 'the stage fades in without flicker');
  T.ok(mono('bgOp', -1), 'the background fades out without flicker');
  T.ok(last.sideOp === 1, 'the panel is fully there at the hand-over, got ' + last.sideOp);
  T.ok(last.dockOp === 1, 'the dock is fully there at the hand-over, got ' + last.dockOp);
  T.ok(last.bgOp < 0.01, 'the background is fully gone at the hand-over, got ' + last.bgOp);
  T.ok(last.gOp < 0.01, 'the shape is fully gone at the hand-over, got ' + last.gOp);
  // where the shape fades, the real panel is already there: no moment with neither
  const hole = frames.filter((f) => f.gOp < 0.98).find((f) => Math.max(f.gOp, f.sideOp) < 0.6);
  T.ok(!hole, 'no moment where neither the shape nor the panel shows');
  // the dock rises upward, and arrives at its real place
  T.ok(frames[0].dockY >= last.dockY, 'the dock rises');
  T.ok(Math.abs(last.dockY - T.box(dock).y) < 0.5, 'the dock is at its real place when the overlay goes');
  await T.appIsBack('hand-over');
});

const SIZES = ['900x600', '1240x800', '1920x1080', '2560x1440', '1000x1100', '2200x620'];
module.exports = [
  { name: 'new install: shows, every screen, into the app, nothing left', profile: 'a', vars, page: newInstall },
  { name: 'launched again: not shown; Replay; Skip from every screen; keys', profile: 'a', vars, page: launchedAgain, timeout: 180000 },
  { name: 'library already there: no intro', vars: { what: 'library' }, page: notForExisting, library: (song) => ({ v: 3, tracks: [track(song)], queue: [], playlists: [] }) },
  { name: 'playlists already there: no intro', vars: { what: 'playlists' }, page: notForExisting, library: () => ({ v: 3, tracks: [], queue: [], playlists: [{ id: 'p1', name: 'Mix', tracks: [] }] }) },
  { name: 'updating user: set up', profile: 'u', page: seedVersionNote },
  { name: 'updating user: no intro', profile: 'u', page: updater },
  { name: 'reduced motion', vars, page: reduced, args: ['--force-prefers-reduced-motion'] },
  { name: 'opened from Explorer: dismisses at once, plays, stays unseen', profile: 'e', songs: 1, page: fromExplorer },
  { name: 'opened from Explorer: next plain launch shows it', profile: 'e', page: afterExplorer },
  { name: 'dismiss ends it at once', page: openedDuring },
  { name: 'closed part way: first launch', profile: 'c', page: closedPartWay },
  { name: 'closed part way: shown again', profile: 'c', page: reopened },
  { name: 'account slot runs before the app', vars, page: accountSlot },
  { name: 'double-click moves one screen, even onto the last', vars, page: doubleClick },
  ...SIZES.map((size) => ({ name: `fits ${size}`, size, vars: { ...vars, size }, page: sizes })),
  { name: 'window resized during the intro', vars, page: resizing },
  ...[['1240x800', 5], ['900x600', 5], ['1240x800', 1], ['2560x1440', 3]].map(([size, at]) => ({ name: `hand-over at ${size} from screen ${at}`, size, vars: { ...vars, at }, page: handOver })),
];
