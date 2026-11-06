'use strict';
// The sign-up screen. Run: node scripts/ui-test.js tests/ui/signup.js
// Everything runs inside the real app, off-screen and muted, on fresh data folders. The only folders scanned are scratch
// ones from firstrun-files.js, passed in through GLASS_SCAN_ROOTS. Runs that share a profile are one install, launched again.
const Files = require('./firstrun-files');

const COMMON = `
  T.$$ = (s) => [...document.querySelectorAll(s)];
  T.intro = () => !!document.querySelector('#intro');
  T.heading = () => T.$('.intro-words h1')?.textContent;
  T.su = () => T.$('.su');
  T.finder = () => !!T.$('.fr-panel');
  T.hint = () => T.$('.su-creds .su-hint-t')?.textContent || '';
  T.type = (sel, v) => { const i = T.$(sel); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); };
  T.send = () => T.$('.su-form').requestSubmit();
  T.walkIntro = async () => {
    await T.until(() => T.heading() === 'Glassy', 'the welcome screen');
    await T.wait(700);
    for (let i = 0; i < 4; i++) { T.$('.intro-go').click(); await T.wait(700); }
    T.$('.intro-go').click();
  };
  T.toScreen = async () => {
    await T.walkIntro();
    await T.until(T.su, 'the sign-up screen');
    await T.wait(1400);       // it has glided in
  };
  T.openSettings = async () => { Settings.open(); await T.until(() => T.$('[data-account] h4'), 'Settings opens'); await T.wait(300); };
  T.account = () => T.$('[data-account]')?.textContent || '';
  // past the song finder, with nothing added
  T.pastFinder = async () => {
    await T.until(() => T.finder() && T.$('.fr-later'), 'the song finder opens', 20000);
    await T.wait(1500);
    T.$('.fr-later').click();
    await T.until(() => !T.intro(), 'the intro ends', 9000);
    await T.wait(300);
  };
`;
const page = (fn) => `async (T) => { ${COMMON} await (${fn})(T); }`;
const small = () => ({ GLASS_SCAN_ROOTS: Files.roots(Files.small()) });

// ---- Skip goes to the sign-up screen, from the first screen on, and on from there as usual ----
const skipButton = page(async (T) => {
  await T.until(() => T.heading() === 'Glassy', 'the welcome screen');
  await T.wait(1800);
  T.$('.intro-skip').click();
  await T.until(T.su, 'Skip opens the sign-up screen');
  T.ok(!T.finder(), 'the song finder has not opened yet');
  await T.wait(1400);
  T.$('.su-noacc').click();
  await T.pastFinder();
});

// ---- the screen is after the last intro screen and before the finder; Continue without an account writes nothing ----
const skipping = page(async (T) => {
  T.ok(typeof Intro.accountStep === 'function', 'signup.js fills the intro\'s account slot');
  await T.walkIntro();
  await T.until(T.su, 'the sign-up screen after the last intro screen');
  await T.wait(1400);
  T.ok(T.intro() && !T.finder(), 'still in the intro, and the song finder has not started yet');
  T.ok(T.$('.su-h').textContent === 'Sign up to Glassy' && T.$('.su-kick').textContent === 'Start your journey', 'the words, got ' + T.$('.su-h').textContent);
  T.ok(T.$('.su-honest')?.textContent === 'For now, your account stays on this computer.', 'the honesty line is there');
  T.ok(T.$('.su-creds .su-hint-t').textContent === 'At least 15 characters', 'the hint');
  T.ok(T.$$('.su-way').map((b) => b.textContent).join() === 'Google', 'Google is the only provider button');
  T.ok(Math.abs(T.box('.su-way').w - T.box('.su-soc').w) < 2, 'the one button fills the row, got ' + Math.round(T.box('.su-way').w));
  // the logo and links sit below the 44 px title bar, and the bar still takes clicks
  for (const s of ['.su-logo', '.su-stage', '.su-noacc', '.su-have']) {
    const b = T.box(s);
    T.ok(b.y >= 44 && T.inWindow(b), s + ' is below the title bar and inside the window, got y ' + Math.round(b.y));
  }
  const lg = T.box('.intro-glass');
  T.ok(lg.w < 60 && lg.x < 100 && lg.y >= 44, 'the intro\'s glass shrank into the logo, got ' + JSON.stringify(lg));
  const bar = document.elementFromPoint(innerWidth - 20, 22);
  T.ok(bar && bar.closest('.titlebar'), 'the title bar is on top and takes clicks, got ' + (bar && (bar.id || bar.className)));
  T.$('.su-noacc').click();
  await T.until(T.finder, 'Continue without an account goes on to the song finder', 20000);
  T.ok(!T.su(), 'the sign-up screen is gone');
  const st = await glass.localAccount.state();
  T.ok(!st.exists && !st.signedIn, 'nothing stored: ' + JSON.stringify(st));
});

// ---- the whole way: checks, terms, username, Settings, sign out, sign in ----
const journey = page(async (T) => {
  await T.toScreen();
  const sheetOn = () => !!T.$('.su-sheet.on');

  T.ok(T.$('.su-f legend').textContent === 'Email or phone number' && T.$('.su-em').placeholder === 'you@example.com', 'the first field takes either, with an email as the example');
  T.ok(T.$('.su-sheet').inert, 'the shut terms cannot be reached by keyboard');
  // checks come first
  T.type('.su-em', 'nope');
  T.type('.su-pw', 'a'.repeat(15));
  T.send();
  await T.wait(200);
  T.ok(T.hint() === 'Enter your email or phone number' && !sheetOn(), 'a bad value says so and opens no terms, got ' + T.hint());
  T.type('.su-em', 'me@example.com');
  T.type('.su-pw', 'a'.repeat(14));
  T.send();
  await T.wait(200);
  T.ok(/15 characters/.test(T.hint()) && T.$('.su-creds .su-hint-t').classList.contains('bad'), '14 characters shows the hint, got ' + T.hint());
  T.ok(!sheetOn(), '14 characters does not open the terms');

  // terms: I agree stays off until the end
  T.type('.su-pw', 'correct horse battery staple');
  T.send();
  await T.until(sheetOn, 'the terms open');
  await T.wait(900);
  const agree = T.$('.su-agree'), terms = T.$('.su-terms');
  T.ok(terms.scrollHeight > terms.clientHeight + 40, 'the terms are longer than the window on them');
  T.ok(agree.disabled && agree.textContent === 'Scroll to the end', 'I agree is off at the start, got ' + agree.textContent);
  T.ok(/That's the end\./.test(terms.textContent) && /in one file on this computer/.test(terms.textContent), 'the real terms are there');
  terms.scrollTop = 60;
  await T.wait(200);
  T.ok(agree.disabled, 'still off part way down');
  agree.click();
  await T.wait(200);
  T.ok(T.$('.su-name').hidden, 'a click while it is off does nothing');
  terms.scrollTop = terms.scrollHeight;
  await T.wait(300);
  T.ok(!agree.disabled && agree.textContent === 'I agree', 'I agree lights up at the end, got ' + agree.textContent);
  // Esc shuts the terms: I agree is off again and out of reach, the form is back; opening them again starts from the top
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.wait(300);
  T.ok(!sheetOn() && T.$('.su-sheet').inert && agree.disabled && !T.$('.su-form').inert, 'Esc: sheet shut and inert, I agree off, form live');
  T.send();
  await T.until(sheetOn, 'the terms open again');
  T.ok(T.$('.su-form').inert && agree.disabled, 'while the terms are up the form is inert and I agree starts off');
  terms.scrollTop = terms.scrollHeight;
  await T.wait(400);
  agree.click();

  // username, with a live check
  await T.until(() => !T.$('.su-name').hidden, 'the username step');
  await T.wait(700);
  const nh = () => T.$('.su-name-hint .su-hint-t');
  T.type('.su-un', 'Tester');
  T.ok(T.$('.su-un').value === 'tester' && nh().classList.contains('good'), 'capitals become lowercase and it looks good, got ' + T.$('.su-un').value);
  T.type('.su-un', 'admin');
  T.ok(nh().classList.contains('bad'), 'admin is refused live, got ' + nh().textContent);
  T.type('.su-un', 'a b');
  T.ok(nh().classList.contains('bad'), 'a space is refused live');
  T.type('.su-un', 'Tester');
  T.send();
  await T.until(() => !T.su(), 'the screen finishes');
  await T.pastFinder();

  // Settings shows the account
  await T.openSettings();
  T.ok(T.$('.set-scroll .set-sec h4').textContent === 'Account', 'Account is the top section');
  T.ok(T.$('[data-acct-name]')?.textContent === 'tester', 'Settings shows tester, got ' + T.account());
  T.ok(/Saved on this computer/.test(T.account()) && T.$('[data-acct-out]'), 'it says Saved on this computer and has Sign out');
  T.ok(!/example\.com|battery/.test(document.body.innerHTML), 'no email or password in the page');

  // sign out, then back in
  T.$('[data-acct-out]').click();
  await T.until(() => T.$('[data-acct-in]'), 'Sign out leaves a Sign in button');
  T.ok(!T.$('[data-acct-name]'), 'the username is gone');
  T.$('[data-acct-in]').click();
  await T.until(() => T.$('.su-overlay .su'), 'the screen opens over the app');
  await T.wait(1000);
  T.ok(T.$('.su').dataset.mode === 'signin', 'it opens as Sign in once an account exists');
  const ob = T.box('.su-overlay');
  T.ok(ob.y === 44 && ob.w === innerWidth, 'the overlay starts under the title bar, got y ' + ob.y);
  T.type('.su-em', 'me@example.com');
  T.type('.su-pw', 'wrong wrong wrong wrong');
  T.send();
  await T.until(() => /doesn't match/.test(T.hint()), 'a wrong password says so');
  T.ok(T.hint() === "That email, phone number or password doesn't match." && !sheetOn(), 'the message, and no terms, got ' + T.hint());
  T.type('.su-pw', 'correct horse battery staple');
  T.send();
  await T.until(() => !T.$('.su-overlay'), 'the right password signs in');
  await T.until(() => T.$('[data-acct-name]'), 'Settings comes back signed in');
  T.ok(T.$('[data-acct-name]').textContent === 'tester', 'signed in as tester again');
});

// ---- the same install, launched again: none of this ----
const again = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.wait(1200);
  T.ok(!T.intro() && !T.su() && !T.$('.su-overlay'), 'a normal launch shows no intro and no sign-up screen');
  T.ok(!document.documentElement.className.includes('intro'), 'no intro class on the page');
  await T.openSettings();
  T.ok(T.$('[data-acct-name]')?.textContent === 'tester', 'still signed in as tester, got ' + T.account());
});

// ---- Google, with the stand-in provider (GLASS_FAKE_GOOGLE, honoured only under GLASS_SHOT): no browser, no network ----
const googleNew = page(async (T) => {
  await T.toScreen();
  const sheetOn = () => !!T.$('.su-sheet.on');
  T.$('[data-way="Google"]').click();
  await T.until(sheetOn, 'Sign up with Google opens the terms first');
  await T.wait(900);
  T.ok(T.$('.su-wait').hidden, 'the browser has not been asked yet');
  T.ok(/Google is contacted only if you choose to sign in with it/.test(T.$('.su-terms').textContent), 'the terms say when Google is contacted');
  T.$('.su-terms').scrollTop = T.$('.su-terms').scrollHeight;
  await T.wait(300);
  T.$('.su-agree').click();
  await T.until(() => !T.$('.su-wait').hidden, 'the waiting note shows after the terms');
  T.ok(T.$('.su-wait p').textContent === 'Finish signing in in your browser' && T.$('.su-wait-x').textContent === 'Cancel', 'the note and a Cancel');
  await T.until(() => !T.$('.su-name').hidden, 'a new Google account goes on to the username step');
  await T.wait(700);
  T.ok(T.$('.su-wait').hidden, 'the waiting note is gone');
  T.type('.su-un', 'gtester');
  T.send();
  await T.until(() => !T.su(), 'the screen finishes');
  await T.pastFinder();
  await T.openSettings();
  T.ok(T.$('[data-acct-name]')?.textContent === 'gtester', 'Settings shows gtester, got ' + T.account());
  T.ok(!/example\.com|fake-sub|Google Tester/.test(document.body.innerHTML), 'no email, sub or name in the page');
  // signing out, then password sign-in says to use Google
  T.$('[data-acct-out]').click();
  await T.until(() => T.$('[data-acct-in]'), 'Sign out leaves a Sign in button');
  T.$('[data-acct-in]').click();
  await T.until(() => T.$('.su-overlay .su'), 'the screen opens over the app');
  await T.wait(1000);
  T.type('.su-em', 'google.tester@example.com');
  T.type('.su-pw', 'correct horse battery staple');
  T.send();
  await T.until(() => /Google/.test(T.hint()), 'a password on a Google account points to Google');
  // and Google itself signs straight in: no terms
  T.$('[data-way="Google"]').click();
  await T.until(() => !T.$('.su-overlay'), 'Google signs the existing account in');
  T.ok(!sheetOn(), 'no terms on Sign in');
  await T.until(() => T.$('[data-acct-name]'), 'Settings comes back signed in');
});

const googleMissing = page(async (T) => {
  await T.toScreen();
  T.$('[data-way="Google"]').click();
  await T.wait(600);
  T.ok(T.$('.su-soon').textContent === 'Coming soon' && +getComputedStyle(T.$('.su-soon')).opacity > 0.5, 'without the client file Google says Coming soon');
  T.ok(!T.$('.su-sheet.on') && T.$('.su-wait').hidden && T.$('.su-creds').hidden === false, 'no terms, no waiting, nothing changed');
});

const googleDenied = page(async (T) => {
  await T.toScreen();
  T.$('[data-way="Google"]').click();
  await T.until(() => !!T.$('.su-sheet.on'), 'the terms');
  await T.wait(900);
  T.$('.su-terms').scrollTop = T.$('.su-terms').scrollHeight;
  await T.wait(300);
  T.$('.su-agree').click();
  await T.until(() => /declined/.test(T.hint()), 'a declined sign-in says so in plain text');
  T.ok(T.$('.su-wait').hidden && T.$('.su-name').hidden, 'back on the form, no username step');
  const st = await glass.localAccount.state();
  T.ok(!st.exists, 'nothing stored');
});

module.exports = [
  { name: 'after the last intro screen: Continue without an account goes on, nothing stored', signup: true, env: small, page: skipping, timeout: 180000 },
  { name: 'sign up: checks, Coming soon, terms, username, Settings, sign out and in', signup: true, profile: 'acct', env: small, page: journey, timeout: 180000 },
  { name: 'Skip goes to the sign-up screen', signup: true, env: small, page: skipButton },
  { name: 'an existing user\'s normal launch shows none of it', signup: true, profile: 'acct', env: small, page: again },
  { name: 'Google (stand-in): terms first, then the browser, then the username; sign in later', signup: true, profile: 'google', env: () => ({ ...small(), GLASS_FAKE_GOOGLE: 'new' }), page: googleNew, timeout: 180000 },
  { name: 'Google without the client file says Coming soon', signup: true, env: () => ({ ...small(), GLASS_FAKE_GOOGLE: 'missing' }), page: googleMissing },
  { name: 'Google declined shows plain text and stores nothing', signup: true, env: () => ({ ...small(), GLASS_FAKE_GOOGLE: 'denied' }), page: googleDenied },
];
