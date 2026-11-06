'use strict';
// The sign-up screen. Its look and motion come from docs/superpowers/mockups/intro-preview.html, which the owner approved.
// It runs in two places: after the intro's last screen (Intro.accountStep, where the intro's one glass shape shrinks into the
// logo), and from Settings > Account as a full-window overlay. The account lives in one file on this computer
// (account/local.js, through glass.localAccount); nothing here goes online.
// Uses globals: esc (app.js), Username (account/username.js), Contact (account/contact.js), Liquid (liquid.js), reduceMotion, Intro.
(() => {
  const api = window.glass.localAccount;
  const E = 'cubic-bezier(.42,.02,.2,1)';
  const MIN_PASSWORD = 15;
  const NAME_HELP = 'Lowercase letters, numbers, . and _ , up to 18';
  const rm = () => (typeof reduceMotion !== 'undefined' && reduceMotion);

  // ---------- what's known about the account on this computer ----------
  let cache = { exists: false, signedIn: false, username: '', skipScreen: false };
  const take = (s) => { if (s && typeof s.signedIn === 'boolean') cache = { ...cache, exists: !!s.exists, signedIn: s.signedIn, username: String(s.username || '') }; return cache; };
  let known = false;
  const ready = api.state().then((s) => { cache = { ...cache, ...s }; return cache; }).catch(() => cache).then((c) => { known = true; return c; });

  // ---------- the pieces ----------
  const IC = {
    apple: '<path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.3-1.7 2.9-.4 7.2 1.2 9.5.8 1.1 1.7 2.4 3 2.3 1.2 0 1.7-.8 3.1-.8s1.9.8 3.2.8 2.2-1.1 3-2.3c.9-1.3 1.3-2.6 1.3-2.7-.1 0-2.9-1.1-2.9-4.1zM14.1 5.8c.7-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.2-.6 2.8-1.4z" fill="#fff" stroke="none"/>',
  };
  const GOOGLE = '<svg viewBox="0 0 24 24" style="stroke:none"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>';
  const WAYS = [['Apple', `<svg viewBox="0 0 24 24">${IC.apple}</svg>`], ['Google', GOOGLE]];
  const MAIL = '<svg viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/></svg>';
  const EYE = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const PERSON = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c.8-3.4 3.6-5 7-5s6.2 1.6 7 5"/></svg>';

  // Short, local-only, and meant: this is what the person agrees to.
  const TERMS = `
    <p style="margin-top:0">Glassy is a personal music player that lives on your computer. This is the whole agreement, and it is short.</p>
    <h3>What this is</h3>A personal app that runs on your computer. There is no Glassy server, and nobody else can see your account.
    <h3>Your account and your music</h3>The email or phone number, password and username you choose are saved in one file on this computer. The password is scrambled before it is saved. None of it is uploaded. Your music and videos stay where they are, and Glassy does not upload them either.
    <h3>When Glassy goes online</h3>Only to look up lyrics, artist info and covers, and to check for updates. Your account details are not part of those requests. Google is contacted only if you choose to sign in with it.
    <h3>What you play</h3>Only use Glassy with files you have the right to play.
    <h3>As is</h3>Glassy is provided as is, with no promise that it will always work or be free of mistakes.
    <h3>Leaving</h3>You can remove your account at any time in Settings. That deletes the account file and nothing else, so your music and library stay.
    <p>That's the end.</p>`;

  const HTML = `
    <div class="su-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 4.6c0-1 1.1-1.6 2-1.1l11.4 7.4c.8.5.8 1.7 0 2.2L9 20.5c-.9.5-2-.1-2-1.1z"/></svg></div>
    <div class="su-logo">Glassy</div>
    <button type="button" class="su-close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="su-stage">
      <form class="su-form" autocomplete="off" novalidate>
        <p class="su-kick"></p>
        <h2 class="su-h"></h2>
        <div class="su-creds">
          <fieldset class="su-f"><legend>Email or phone number</legend><input class="su-em" type="text" inputmode="email" spellcheck="false" placeholder="you@example.com" aria-label="Email or phone number" />${MAIL}</fieldset>
          <fieldset class="su-f"><legend>Password</legend><input class="su-pw" type="password" placeholder="A few words work well" aria-label="Password" /><button type="button" class="su-eye" aria-label="Show password" aria-pressed="false">${EYE}</button></fieldset>
          <div class="su-hint"><span class="su-hint-t" role="status"></span><button type="button" class="su-forgot">Forgot password?</button></div>
          <button type="submit" class="su-main"></button>
          <div class="su-or"><span></span></div>
          <div class="su-soc">${WAYS.map(([l, svg]) => `<button type="button" class="su-way" data-way="${l}" aria-label="${l}">${svg}<span>${l}</span></button>`).join('')}</div>
          <div class="su-soon" role="status" aria-live="polite"></div>
          <div class="su-wait" hidden><p role="status">Finish signing in in your browser</p><button type="button" class="su-wait-x">Cancel</button></div>
          <p class="su-honest">For now, your account stays on this computer.</p>
        </div>
        <div class="su-name" hidden>
          <fieldset class="su-f"><legend>Username</legend><input class="su-un" type="text" placeholder="yourname" spellcheck="false" autocapitalize="none" aria-label="Username" />${PERSON}</fieldset>
          <div class="su-hint su-name-hint"><span class="su-hint-t" role="status"></span></div>
          <button type="submit" class="su-main su-finish">Finish</button>
        </div>
      </form>
    </div>
    <div class="su-have"><span class="su-have-t"></span><button type="button" class="su-have-b"></button></div>
    <button type="button" class="su-noacc">Continue without an account &rarr;</button>
    <div class="su-scrim"></div>
    <div class="su-sheet" role="dialog" aria-modal="true" aria-label="Terms">
      <h2>Before you start</h2>
      <div class="su-terms" tabindex="0">${TERMS}</div>
      <button type="button" class="su-agree" disabled>Scroll to the end</button>
    </div>`;

  let live = null;      // the screen that's up, if any

  // ---------- one screen ----------
  // opts: { stage } inside the intro, or { overlay: true } over the app; startIn: 'signin' | 'signup'; done(result) once it's over.
  function mount(opts, done) {
    const inIntro = !!opts.stage;
    const layer = document.createElement('div');
    layer.className = 'su ' + (inIntro ? 'su-intro' : 'su-over');
    layer.innerHTML = HTML;
    let host = layer;
    if (inIntro) opts.stage.root.appendChild(layer);
    else {
      host = document.createElement('div');
      host.className = 'su-overlay';
      host.appendChild(layer);
      document.body.appendChild(host);
    }
    const q = (s) => layer.querySelector(s);
    const form = q('.su-form'), stageEl = q('.su-stage');
    const em = q('.su-em'), pw = q('.su-pw'), un = q('.su-un'), hint = q('.su-hint-t'), nameHint = q('.su-name-hint .su-hint-t');
    const sheet = q('.su-sheet'), terms = q('.su-terms'), agree = q('.su-agree'), scrim = q('.su-scrim'), soon = q('.su-soon');
    sheet.inert = true;      // shut: nothing in it can be reached by keyboard
    let signingIn = false, phase = 'creds', sheetOpen = false, busy = false, over = false, soonT = 0;
    let nextStep = 'name', waiting = false, googleName = false;      // what 'I agree' leads to; a browser sign-in is open; the username is for a Google account
    let creds = null;      // email or phone number, and password, held only between the terms and the end of the username step

    // ---- mode: Sign up or Sign in ----
    const say = (box, msg, cls = '') => { box.className = 'su-hint-t' + (cls ? ' ' + cls : ''); box.textContent = msg; };
    const bad = (box, msg) => {
      say(box, msg, 'bad');
      if (!rm()) form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 380, easing: E });
    };
    const plain = (box, msg) => say(box, msg);
    function setMode(si, quiet) {
      signingIn = si;
      layer.dataset.mode = si ? 'signin' : 'signup';
      q('.su-kick').textContent = si ? 'Welcome back' : 'Start your journey';
      q('.su-h').textContent = si ? 'Sign in to Glassy' : 'Sign up to Glassy';
      q('.su-creds .su-main').textContent = si ? 'Sign in' : 'Sign up';
      q('.su-or span').textContent = si ? 'or sign in with' : 'or sign up with';
      q('.su-have-t').textContent = si ? 'New here?' : 'Have an account?';
      q('.su-have-b').textContent = si ? 'Sign up' : 'Sign in';
      q('.su-forgot').hidden = !si;
      plain(hint, si ? '' : `At least ${MIN_PASSWORD} characters`);
      if (!quiet && !rm()) form.animate([{ opacity: .3 }, { opacity: 1 }], { duration: 600, easing: E });
    }

    // ---- fitting the window: the form scales down in a short window instead of running under the logo or the links ----
    function fit() {
      const top = inIntro ? 44 : 0, avail = layer.clientHeight - top - 130, h = form.offsetHeight || 1;
      layer.style.setProperty('--su-s', Math.max(.6, Math.min(1, avail / h)).toFixed(3));
    }

    // ---- the terms ----
    function openTerms(next = 'name') {
      sheetOpen = true; nextStep = next;
      sheet.inert = false; form.inert = true;      // the form waits while the sheet is up
      scrim.classList.add('on'); sheet.classList.add('on');
      agree.disabled = true; agree.classList.remove('ready'); agree.textContent = 'Scroll to the end';
      terms.scrollTop = 0;
      if (!rm()) sheet.animate([{ opacity: 0, transform: 'translate(-50%, calc(-50% + 46px)) scale(.96)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], { duration: 760, easing: E });
      Liquid.snap(sheet);
      setTimeout(() => { if (!over) { terms.focus({ preventScroll: true }); onScroll(); } }, 120);
    }
    function closeTerms(refocus = true) {
      if (!sheetOpen) return;
      sheetOpen = false; nextStep = 'name';
      sheet.inert = true; form.inert = false;
      agree.disabled = true; agree.classList.remove('ready'); agree.textContent = 'Scroll to the end';      // not left ready for the next time
      scrim.classList.remove('on'); sheet.classList.remove('on');
      if (refocus) pw.focus({ preventScroll: true });
    }
    function onScroll() {
      if (terms.scrollTop + terms.clientHeight < terms.scrollHeight - 6) return;
      agree.disabled = false; agree.classList.add('ready'); agree.textContent = 'I agree';
    }
    terms.addEventListener('scroll', onScroll);
    scrim.addEventListener('click', () => closeTerms());
    agree.addEventListener('click', () => {
      if (agree.disabled) return;
      const n = nextStep;
      closeTerms(false);
      if (n === 'google') return googleGo();
      if (n === 'gname') googleName = true;
      toName();
    });

    // ---- the username step ----
    function toName() {
      phase = 'name';
      layer.dataset.phase = 'name';
      q('.su-kick').textContent = 'One last thing';
      q('.su-h').textContent = 'Choose a username';
      q('.su-creds').hidden = true; q('.su-name').hidden = false;
      q('.su-have').classList.add('gone');
      plain(nameHint, NAME_HELP);
      un.value = '';
      if (!rm()) form.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 650, easing: E });
      fit();
      setTimeout(() => un.focus({ preventScroll: true }), 60);
    }
    un.addEventListener('input', () => {
      // capitals become lowercase as they're typed, and the caret stays where it was
      const at = un.selectionStart, lower = un.value.toLowerCase();
      if (lower !== un.value) { un.value = lower; un.setSelectionRange(at, at); }
      const r = Username.check(un.value);
      if (!un.value) say(nameHint, NAME_HELP);
      else if (r.ok) say(nameHint, 'Looks good', 'good');
      else say(nameHint, r.error, 'bad');
    });

    // ---- the form ----
    async function submit(e) {
      e.preventDefault();
      if (busy || sheetOpen) return;
      if (phase === 'name') return finish();
      const who = Contact.check(em.value), pass = pw.value;
      if (!who.ok) return bad(hint, 'Enter your email or phone number');
      const email = who.value;
      if (signingIn) {
        busy = true;
        const r = await api.signIn(email, pass).catch(() => null);
        busy = false;
        if (over) return;
        if (r && r.error === 'google') return bad(hint, 'This account uses Google. Use the Google button.');
        if (!r || !r.ok) return bad(hint, 'That email, phone number or password doesn\'t match.');
        take(r);
        return end({ account: true, signedIn: true });
      }
      if (pass.length < MIN_PASSWORD) return bad(hint, `Use at least ${MIN_PASSWORD} characters. A few words work well`);
      busy = true;
      const now = await api.state().catch(() => null);
      busy = false;
      if (over) return;
      if (now && now.exists) return bad(hint, 'There is already an account on this computer. Sign in, or remove it in Settings first.');
      plain(hint, `At least ${MIN_PASSWORD} characters`);
      creds = { email, pass };
      openTerms();
    }
    async function finish() {
      const r = Username.check(un.value);
      if (!r.ok) return bad(nameHint, r.error);
      if (!creds && !googleName) return;
      busy = true;
      const res = await (googleName ? api.googleFinish(r.name) : api.create(creds.email, creds.pass, r.name)).catch(() => null);
      busy = false;
      if (over) return;
      if (!res || !res.ok) return bad(nameHint, res && res.error === 'exists' ? 'There is already an account on this computer.' : res && res.error === 'expired' ? 'That took too long. Go back and sign in with Google again.' : 'The account couldn\'t be saved. Try again.');
      creds = null; googleName = false;
      take(res);
      end({ account: true, signedIn: true });
    }
    form.addEventListener('submit', submit);
    q('.su-eye').addEventListener('click', () => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      q('.su-eye').setAttribute('aria-pressed', String(show));
      q('.su-eye').setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    q('.su-forgot').addEventListener('click', () => plain(hint, 'Password reset needs online accounts, which aren\'t here yet. You can remove this account in Settings and make a new one.'));
    q('.su-have-b').addEventListener('click', () => { if (phase === 'creds' && !busy && !waiting) setMode(!signingIn); });
    // Apple isn't here yet (and Google, until the app has its client file): a note, nothing else
    const comingSoon = () => {
      soon.textContent = 'Coming soon';
      soon.classList.add('on');
      clearTimeout(soonT);
      soonT = setTimeout(() => soon.classList.remove('on'), 2400);
    };
    // ---- Google: Sign up reads the terms first, then the browser; Sign in goes straight to the browser ----
    const GOOGLE_ERR = {
      denied: 'Google sign-in was declined. Try again whenever you like.',
      timeout: 'That took too long. Try again.',
      failed: 'Google sign-in didn\'t work. Try again.',
      exists: 'This computer already has an account. Remove it in Settings first.',
    };
    async function google() {
      if (busy || sheetOpen || phase !== 'creds') return;
      busy = true;
      const ok = await api.googleAvailable().catch(() => false);
      busy = false;
      if (over) return;
      if (!ok) return comingSoon();
      plain(hint, signingIn ? '' : `At least ${MIN_PASSWORD} characters`);
      if (signingIn) googleGo(); else openTerms('google');
    }
    async function googleGo() {
      busy = true; waiting = true;
      layer.dataset.wait = '1';
      q('.su-wait').hidden = false;
      q('.su-wait-x').focus({ preventScroll: true });
      const r = await api.googleStart().catch(() => ({ ok: false, error: 'failed' }));
      busy = false; waiting = false;
      if (over) return;
      delete layer.dataset.wait;
      q('.su-wait').hidden = true;
      if (r && r.ok && r.status === 'signedIn') { take(r); return end({ account: true, signedIn: true }); }
      if (r && r.ok && r.status === 'new') {
        // signing in with nothing here yet makes an account, so the terms come first
        if (signingIn) return openTerms('gname');
        googleName = true;
        return toName();
      }
      const err = r && r.error;
      if (err === 'cancelled') return;
      if (err === 'unavailable') return comingSoon();
      bad(hint, GOOGLE_ERR[err] || GOOGLE_ERR.failed);
    }
    const stopWaiting = () => { if (waiting) api.googleCancel().catch(() => {}); };
    q('.su-wait-x').addEventListener('click', stopWaiting);
    q('.su-soc').addEventListener('click', (e) => {
      const b = e.target.closest('[data-way]');
      if (!b) return;
      if (b.dataset.way === 'Google') google(); else comingSoon();
    });
    q('.su-noacc').addEventListener('click', () => end({ account: false }));
    q('.su-close').addEventListener('click', () => end({ account: false }));

    // ---- keys: the screen has the keyboard while it's up ----
    function onKey(e) {
      e.stopPropagation();       // the app's shortcuts (and the intro's) wait
      if (e.key !== 'Escape') return;
      if (waiting) { stopWaiting(); e.preventDefault(); }
      else if (sheetOpen) { closeTerms(); e.preventDefault(); }
      else if (!inIntro) end({ account: false });
    }
    addEventListener('keydown', onKey, true);
    addEventListener('resize', onResize);

    // ---- where the logo sits ----
    const LOGO = { x: 28, y: 56, w: 44, h: 44, r: 22 };
    function onResize() { if (inIntro) opts.stage.put(LOGO); fit(); }
    if (inIntro) {
      opts.stage.onResize = onResize;
      opts.stage.shape(LOGO);
    }
    Liquid.watch(sheet);

    // ---- over: take it all down ----
    function teardown() {
      over = true;
      clearTimeout(soonT);
      removeEventListener('keydown', onKey, true);
      removeEventListener('resize', onResize);
      Liquid.unwatch(sheet);
      if (inIntro) opts.stage.onResize = null;
      host.remove();
      if (live === ctl) live = null;
    }
    let gone = false;
    const fin = (result) => { if (gone) return; gone = true; teardown(); done(result); };
    function end(result) {
      if (over) return;
      over = true;
      stopWaiting();
      closeTerms(false);
      creds = null; pw.value = '';
      const fade = host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: rm() ? 160 : 380, easing: E, fill: 'forwards' });
      host.style.pointerEvents = 'none';
      fade.onfinish = () => fin(result);
      setTimeout(() => fin(result), 700);
    }
    const ctl = { abort() { stopWaiting(); fin({ account: false, aborted: true }); } };

    // ---- in ----
    setMode(opts.startIn === 'signin', true);
    fit();
    if (!rm()) {
      const parts = [['.su-logo', 0], ['.su-stage', 1], ['.su-have', 2], ['.su-noacc', 3], ['.su-close', 3], ['.su-mark', 0]];
      for (const [s, i] of parts) {
        const el = q(s);
        el.animate([{ opacity: 0, translate: '0 20px' }, { opacity: 1, translate: '0 0' }], { duration: 950, delay: (inIntro ? 340 : 80) + i * 60, easing: E, fill: 'backwards' });
      }
    } else host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: inIntro ? 300 : 0, fill: 'backwards' });
    setTimeout(() => { if (!over) em.focus({ preventScroll: true }); }, inIntro ? 800 : 300);
    return ctl;
  }

  // ---------- the public side ----------
  window.Signup = {
    cached: () => cache,
    // the account as it stands now (Settings asks when it opens)
    async refresh() { try { take(await api.state()); } catch { /* keep what's known */ } return cache; },
    // Settings > Account: the same screen over the app. Resolves when it's closed or someone has signed in.
    open() {
      if (live) return Promise.resolve({ account: false });
      return new Promise((resolve) => {
        live = mount({ overlay: true, startIn: cache.exists ? 'signin' : 'signup' }, resolve);
      });
    },
    abort() { live?.abort(); },
    async signOut() { try { take(await api.signOut()); } catch { /* unchanged */ } return cache; },
    async remove() { try { take(await api.remove()); } catch { /* unchanged */ } return cache; },
  };

  // the intro, after its last screen and before the song finder
  // Nothing to show (already in, or a test run that goes straight on) returns at once, so the intro goes on in the same turn.
  const show = (s, intro) => new Promise((resolve) => { live = mount({ stage: intro.begin(), startIn: s.exists ? 'signin' : 'signup' }, resolve); });
  Intro.accountStep = (intro) => {
    const skip = (s) => s.skipScreen || s.signedIn;
    if (known) return skip(cache) ? undefined : show(cache, intro);
    return ready.then((s) => (skip(s) ? undefined : show(s, intro)));
  };
})();
