'use strict';
// "Here's what we found". Run: node scripts/ui-test.js tests/ui/firstrun.js
// Everything runs inside the real app, off-screen and muted, on fresh data folders. The only folders scanned are scratch
// ones from firstrun-files.js, passed in through GLASS_SCAN_ROOTS.
const path = require('path');
const Files = require('./firstrun-files');

// ---- shared page-side helpers, stringified into the page ----
const COMMON = `
  T.$$ = (s) => [...document.querySelectorAll(s)];
  T.open = () => !!document.querySelector('.fr-panel');
  T.state = () => document.querySelector('.fr-panel')?.dataset.state;
  T.intro = () => !!document.querySelector('#intro');
  T.heading = () => T.$('.intro-words h1')?.textContent;
  T.addBtn = () => T.$('.fr-sheet button[type=submit]') || T.$('.intro-go');
  T.count = () => +(T.$('.fr-count')?.textContent || '').replace(/[^0-9]/g, '');
  T.inOrder = (s) => T.$$(s + ':not(.out)').sort((a, b) => a._y - b._y);      // rows aren't in page order, they're placed
  T.groups = () => T.inOrder('.fr-group').map((el) => ({ el, name: el.querySelector('b').textContent, sub: el.querySelector('small').textContent, box: el.querySelector('input') }));
  T.group = (name) => T.groups().find((g) => g.name === name);
  T.rows = () => T.inOrder('.fr-row').map((el) => ({ el, title: el.querySelector('b').textContent, sub: el.querySelector('small').textContent, box: el.querySelector('input') }));
  T.row = (title) => T.rows().find((r) => r.title === title);
  T.search = async (q) => { const i = T.$('.fr-search input'); i.value = q; i.dispatchEvent(new Event('input', { bubbles: true })); await T.wait(260); };
  T.toEnd = async () => { const l = T.$('.fr-list'); l.scrollTop = l.scrollHeight; await T.wait(80); };
  T.toTop = async () => { T.$('.fr-list').scrollTop = 0; await T.wait(80); };
  T.walkIntro = async () => {
    await T.until(() => T.heading() === 'Glassy', 'the welcome screen');
    await T.wait(700);
    for (let i = 0; i < 4; i++) { T.$('.intro-go').click(); await T.wait(700); }
    T.$('.intro-go').click();
  };
  T.skip = async () => {
    await T.until(() => T.heading() === 'Glassy', 'the welcome screen');
    T.$('.intro-skip').click();
  };
  // the moment the library is in, so the window is up while the scan is still going
  T.skipAtOnce = async () => {
    await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
    await T.wait(30);
    T.$('.intro-skip').click();
    await T.until(T.open, 'the window opens', 3000);
  };
  T.ready = async () => {
    await T.until(T.open, 'the song finder opens');
    await T.until(() => T.state() !== 'scanning', 'the scan finishes', 30000);
    await T.wait(1500);       // the glass has landed and the words have come in
  };
  T.ended = async (what) => { await T.until(() => !T.intro(), what + ': the intro ends', 9000); };
  T.appIsBack = async (what) => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    T.ok(!T.intro(), what + ': overlay removed');
    await new Promise(requestAnimationFrame);
    T.ok(!document.querySelector('[class*="intro-"], [class*="fr-"]:not(.fr-sheet *)'), what + ': nothing of the intro or the finder left');
    T.ok(!document.documentElement.className.includes('intro'), what + ': no intro class left on the page');
    T.ok(cs('.app').pointerEvents === 'auto', what + ': app takes clicks again');
    for (const s of ['#side', '#dock', '#stage', '#btnSettings']) {
      T.ok(cs(s).visibility === 'visible', what + ': ' + s + ' visible');
      await T.until(() => +cs(s).opacity === 1, what + ': ' + s + ' fully opaque, got ' + cs(s).opacity, 1500);
    }
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight - 40);
    T.ok(hit && hit.closest('#dock'), what + ': the dock takes clicks, got ' + (hit && (hit.id || hit.className)));
  };
  T.findFromSettings = async () => {
    Settings.open();
    await T.wait(500);
    const b = T.$('[data-find-songs]');
    T.ok(b, 'Settings has the Find songs button');
    T.ok(b && /Find songs on this PC/.test(b.closest('.set-row').textContent), 'it says Find songs on this PC');
    T.ok(b && b.closest('.set-sec').querySelector('h4').textContent === 'Library', 'it sits in a Library section');
    T.ok(!T.$('.set-sec input[data-watch]'), 'the watching toggle is not here yet');
    b.click();
    await T.until(() => T.$('.fr-sheet'), 'the sheet opens');
    await T.until(() => T.state() !== 'scanning', 'the scan finishes', 30000);
    await T.wait(700);
  };
`;
const page = (fn) => `async (T) => { ${COMMON} await (${fn})(T); }`;
const realFiles = (s) => () => ({ GLASS_SCAN_ROOTS: Files.roots(s()) });

// ---- a fresh install, all the way through ----
const fresh = page(async (T) => {
  T.ok(window.FirstRun && typeof FirstRun.open === 'function', 'FirstRun.open exists');
  T.ok(typeof Intro?.finderStep === 'function', 'firstrun.js fills the intro\'s finder slot');
  const msgs = [];
  glass.scan.onProgress((m) => msgs.push(m));
  await T.wait(1200);
  T.ok(T.intro() && !T.open(), 'the window waits for the intro');
  T.ok(msgs.length > 0, 'the scan started while the intro opened, messages: ' + msgs.length);
  await T.walkIntro();
  await T.ready();
  T.ok(T.heading() === "Here's what we found", 'the heading, got ' + T.heading());
  T.ok(T.intro(), 'still over the intro\'s background');
  T.ok(!T.$('#modalRoot').querySelector('.modal'), 'not a sheet here');
  await T.until(() => T.count() === 12, 'a count of the songs found, got ' + T.count());
  T.ok(T.addBtn().textContent === 'Add 12 songs', 'the button reads Add 12 songs, got ' + T.addBtn().textContent);
  T.ok(T.state() === 'done', 'the window knows the scan is over');

  // groups: albums by album, loose files by folder, biggest first, the probably-nots last and shut
  const names = T.groups().map((g) => g.name);
  T.ok(names.join() === 'Abbey Road,Mixtapes,In Rainbows,Downloads,Probably not songs', 'groups in order, got ' + names.join());
  T.ok(/The Beatles/.test(T.group('Abbey Road').sub) && /5 songs/.test(T.group('Abbey Road').sub), 'an album says who and how many, got ' + T.group('Abbey Road').sub);
  T.ok(/4 songs/.test(T.group('Mixtapes').sub), 'a folder says how many, got ' + T.group('Mixtapes').sub);
  T.ok(T.rows().length === 12, 'a dozen or fewer groups start open, and the probably-nots shut: rows ' + T.rows().length);
  T.ok(T.row('Summer Mix') && T.row('Come Together'), 'tagged songs by their title, loose ones by file name');

  // what a name holds stays text
  const odd = T.row('<b>Not bold</b> & Co');
  T.ok(odd, 'a title with markup in it shows as it is');
  T.ok(odd && !odd.el.querySelector('b b'), 'and is not read as markup');

  // the probably-nots
  const not = T.group('Probably not songs');
  T.ok(/4/.test(not.sub), 'the group has a count, got ' + not.sub);
  T.ok(!not.box.checked && !not.box.indeterminate, 'the group is unticked');
  not.el.querySelector('.fr-text').click();
  await T.wait(700);
  await T.toEnd();
  const ding = T.row('ding');
  T.ok(ding, 'ding.ogg shows once the group is open');
  T.ok(ding && !ding.box.checked, 'ding is unticked');
  T.ok(ding && /9 seconds/.test(ding.sub), 'ding says 9 seconds next to it, got ' + (ding && ding.sub));
  T.ok(T.row('Voice memo 3') && /voice recording/i.test(T.row('Voice memo 3').sub), 'each row says its reason');
  T.ok(T.row('long talk') && /over 30 minutes/i.test(T.row('long talk').sub), 'each row says its reason: ' + T.row('long talk')?.sub);
  T.group('Probably not songs').el.querySelector('.fr-text').click();
  await T.wait(700);
  T.ok(!T.row('ding'), 'and shuts again');
  await T.toTop();

  // a group's box and its songs
  const abbey = () => T.group('Abbey Road');
  T.ok(abbey().box.checked && !abbey().box.indeterminate, 'an album starts fully ticked');
  T.row('Something').box.click();
  await T.wait(30);
  T.ok(!T.row('Something').box.checked, 'one song unticks');
  T.ok(abbey().box.indeterminate, 'one unticked song shows the group as partly ticked');
  T.ok(T.addBtn().textContent === 'Add 11 songs', 'the button follows, got ' + T.addBtn().textContent);
  abbey().box.click();
  await T.wait(30);
  T.ok(abbey().box.checked && !abbey().box.indeterminate, 'a partly ticked group ticks all the way');
  T.ok(T.vars.beatles.every((n) => T.row(n).box.checked), 'ticking a group ticks its songs');
  abbey().box.click();
  await T.wait(30);
  T.ok(!abbey().box.checked && !abbey().box.indeterminate, 'and again unticks it');
  T.ok(T.vars.beatles.every((n) => !T.row(n).box.checked), 'unticking a group unticks its songs');
  T.ok(T.addBtn().textContent === 'Add 7 songs', 'the button follows, got ' + T.addBtn().textContent);

  // shutting and opening keeps the ticks
  abbey().el.querySelector('.fr-text').click();
  await T.wait(700);
  T.ok(!T.row('Something'), 'a group shuts');
  abbey().el.querySelector('.fr-text').click();
  await T.wait(700);
  T.ok(T.row('Something') && !T.row('Something').box.checked, 'and opens with its ticks as they were');

  // Select none, Select all
  T.$('.fr-none').click();
  await T.wait(30);
  T.ok(T.rows().every((r) => !r.box.checked), 'Select none unticks everything');
  T.ok(T.addBtn().disabled, 'with none ticked the button can\'t be pressed');
  T.ok(T.addBtn().textContent === 'Add songs', 'and reads Add songs, got ' + T.addBtn().textContent);
  T.ok(getComputedStyle(T.addBtn()).pointerEvents === 'none', 'and takes no clicks');
  T.addBtn().click();
  await T.wait(50);
  T.ok(T.open(), 'pressing it does nothing');
  T.$('.fr-all').click();
  await T.wait(30);
  T.ok(T.addBtn().textContent === 'Add 12 songs', 'Select all: the button reads Add 12 songs, got ' + T.addBtn().textContent);
  T.ok(!T.addBtn().disabled, 'and can be pressed');
  T.ok(!T.group('Probably not songs').box.checked && !T.group('Probably not songs').box.indeterminate, 'Select all leaves the probably-nots alone: junk never lands unseen');

  // searching: forgiving, and it never touches a tick
  T.row('Something').box.click();
  await T.search('beetles');
  T.ok(T.rows().length === 5 && T.vars.beatles.every((n) => T.row(n)), 'beetles finds the Beatles, rows: ' + T.rows().map((r) => r.title).join());
  T.ok(T.row('Something') && !T.row('Something').box.checked, 'an unticked song stays unticked in a search');
  T.ok(T.groups().map((g) => g.name).join() === 'Abbey Road', 'only groups with a match show, got ' + T.groups().map((g) => g.name).join());
  T.row('Come Together').box.click();
  T.ok(T.addBtn().textContent === 'Add 10 songs', 'ticking in a search counts, got ' + T.addBtn().textContent);
  await T.search('radiohed');
  T.ok(T.rows().length === 2 && T.row('Reckoner'), 'changing the search finds others, with a typo too');
  await T.search('beatles');
  T.ok(!T.row('Something').box.checked && !T.row('Come Together').box.checked, 'changing the search keeps the ticks');
  T.ok(T.addBtn().textContent === 'Add 10 songs', 'the button counts what isn\'t shown as well, got ' + T.addBtn().textContent);
  await T.search('ding');
  T.ok(T.row('ding'), 'a search reaches into the probably-nots');
  T.ok(T.row('ding') && !T.row('ding').box.checked, 'still unticked');
  await T.search('夜に駆ける');
  T.ok(T.row('夜に駆ける'), 'a Japanese file name shows and is found: ' + T.rows().map((r) => r.title).join());
  await T.search('駆ける');
  T.ok(T.row('夜に駆ける'), 'and by part of it');
  await T.search('zzzzzzqqqq');
  T.ok(!T.rows().length && /zzzzzzqqqq/.test(T.$('.fr-none-found')?.textContent || ''), 'no match says so, and says what was searched');
  T.ok(!T.addBtn().disabled, 'no match leaves the ticks and the button alone');
  await T.search('');
  T.ok(T.groups().length === 5, 'clearing the search brings it all back');

  // the app's keys stay out of it: typing in the search or pressing s doesn't reach the player
  const shuffled = S.shuffle;
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
  T.ok(S.shuffle === shuffled, 'the app\'s shortcuts wait');
  T.ok(T.open(), 'and Esc hasn\'t been pressed');

  // Add: closes, those are in, the others aren't, nothing plays
  T.addBtn().click();
  await T.until(() => !T.open() || T.$('#intro').classList.contains('leaving'), 'Add closes the window', 3000);
  T.ok(lib.size === 10, 'the library has the ticked songs, got ' + lib.size);
  const inLib = (n) => [...lib.values()].some((t) => t.name.includes(n));
  T.ok(inLib('Oh Darling') && inLib('Summer Mix') && inLib('夜に駆ける'), 'those songs are in');
  T.ok(!inLib('Something') && !inLib('Come Together'), 'the unticked ones aren\'t');
  T.ok(!inLib('ding') && !inLib('notification'), 'the probably-nots aren\'t');
  T.ok(deck.paused, 'nothing starts playing by itself');
  await T.ended('after Add');
  T.ok(localStorage.getItem('glass.introSeen'), 'the intro counts as seen');
  const st = await glass.scan.status();
  T.ok(st.ran && !st.scanning, 'the scan is marked as run, and stopped');
  await T.appIsBack('after Add');
  T.ok(S.view === 'library', 'the panel is on the library, got ' + S.view);
  await T.until(() => T.$('#view .row, #view .card'), 'the library fills in');
  T.ok(T.$('#nowTitle').textContent.length > 1 && document.body.classList.contains('has-track'), 'the first song is cued up on the stage');
  await T.wait(800);      // reaches the saved library
});

// ---- the next launch of that same install ----
const nextLaunch = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.wait(600);
  T.ok(!T.intro() && !T.open(), 'launched again: no intro, no window');
  T.ok(lib.size === 10, 'the library is still there, got ' + lib.size);
  const st = await glass.scan.status();
  T.ok(st.ran && !st.scanning, 'launched again: no scan running by itself');

  // what it would offer next time: nothing, because everything has an answer
  const offered = [];
  let done = false;
  glass.scan.onProgress((m) => { offered.push(...m.items); if (m.done) done = true; });
  await glass.scan.start();
  await T.until(() => done, 'a scan to see what it would offer', 10000);
  T.ok(!offered.length, 'added and unticked files aren\'t offered next time, got: ' + offered.map((i) => i.path).join());

  // Settings asks again: only the earlier "no"s come back, and they're ticked as the score says
  await T.findFromSettings();
  T.ok(T.$('.fr-sheet .modal-title')?.textContent === "Here's what we found", 'the sheet has the heading');
  T.ok(!T.intro(), 'no intro around it');
  T.ok(T.group('Abbey Road') && !T.row('Oh! Darling'), 'songs already in the library are hidden');
  T.ok(T.row('Something') && T.row('Come Together'), 'songs passed over last time are back');
  T.ok(T.addBtn().textContent === 'Add 2 songs', 'the count is of what\'s new, got ' + T.addBtn().textContent);
  T.ok(T.count() === 2, 'the live count is of what\'s new, got ' + T.count());
  T.addBtn().click();
  await T.until(() => T.$('#modalRoot').hidden, 'Add closes the sheet');
  T.ok(lib.size === 12, 'added to what was there, got ' + lib.size);
  T.ok(deck.paused, 'nothing starts playing');
});

// ---- someone who already has a library: no window, the button hides what they have ----
const existing = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.wait(1500);
  T.ok(!T.intro() && !T.open(), 'a library that has songs: no automatic window');
  const st = await glass.scan.status();
  T.ok(!st.scanning && !st.ran, 'and no scan started');
  T.ok(lib.size === 2, 'the library is as it was, got ' + lib.size);

  await T.findFromSettings();
  T.ok(!T.row('Come Together'), 'a song already in the library is hidden, even one added by hand');
  T.ok(!T.row('Reckoner'), 'whatever the capitals in its path');
  T.ok(T.row('Something'), 'others show');
  T.ok(T.addBtn().textContent === 'Add 10 songs', 'the button counts the new ones, got ' + T.addBtn().textContent);
  // Enter in the search box must not press Add
  const input = T.$('.fr-search input');
  const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  input.dispatchEvent(ev);
  T.ok(ev.defaultPrevented, 'Enter in the search doesn\'t submit the sheet');
  // Esc is the way out
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.until(() => T.$('#modalRoot').hidden, 'Esc closes the sheet');
  T.ok(lib.size === 2, 'closing adds nothing');
  const after = await glass.scan.status();
  T.ok(!after.ran, 'and doesn\'t mark it as run');
  // and it opens again, fresh
  await T.findFromSettings();
  T.ok(T.addBtn().textContent === 'Add 10 songs', 'it opens again, got ' + T.addBtn().textContent);
  T.$('.fr-later').click();
  await T.until(() => T.$('#modalRoot').hidden, 'Not now closes the sheet');
  T.ok(lib.size === 2, 'Not now adds nothing');
});

// ---- everything it finds is in the library already ----
const allThere = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.findFromSettings();
  T.ok(T.state() === 'empty', 'nothing to offer, got ' + T.state());
  T.ok(T.$('.fr-sheet .modal-title').textContent === 'Nothing new', 'the heading says so, got ' + T.$('.fr-sheet .modal-title').textContent);
  T.ok(/already in your library/.test(T.$('.fr-empty').textContent), 'and why: ' + T.$('.fr-empty').textContent);
  T.ok(T.addBtn().textContent === 'Add a folder', 'and offers Add a folder');
});

// ---- Select all, Select none and a group's box act on what a search shows ----
const searchTicks = page(async (T) => {
  await T.skip();
  await T.ready();
  await T.search('radiohead');
  T.$('.fr-none').click();
  await T.wait(30);
  T.ok(T.rows().every((r) => !r.box.checked), 'Select none in a search unticks what is shown');
  T.ok(T.addBtn().textContent === 'Add 10 songs', 'and only that, got ' + T.addBtn().textContent);
  T.$('.fr-all').click();
  await T.wait(30);
  T.ok(T.addBtn().textContent === 'Add 12 songs', 'Select all in a search ticks them back, got ' + T.addBtn().textContent);
  await T.search('Come Together');
  T.ok(T.rows().length === 1, 'one song shows, rows ' + T.rows().length);
  T.ok(/1 of 5 songs/.test(T.group('Abbey Road').sub), 'the group says how much of it shows, got ' + T.group('Abbey Road').sub);
  T.group('Abbey Road').box.click();
  await T.wait(30);
  T.ok(T.addBtn().textContent === 'Add 11 songs', 'a group box in a search acts on what is shown, got ' + T.addBtn().textContent);
  T.group('Abbey Road').el.querySelector('.fr-text').click();
  await T.wait(600);
  T.ok(!T.rows().length, 'a group can be shut during a search');
  await T.search('');
  T.ok(T.group('Abbey Road').box.indeterminate, 'with the search gone the group shows as partly ticked');
  // a search that shows a probably-not lets Select all reach it, because it can be seen
  await T.search('ding');
  T.$('.fr-all').click();
  await T.wait(30);
  T.ok(T.row('ding')?.box.checked, 'Select all reaches a probably-not that a search shows');
  await T.search('');
  T.ok(T.addBtn().textContent === 'Add 12 songs' || T.addBtn().textContent === 'Add 13 songs', 'and it counts, got ' + T.addBtn().textContent);
  T.ok(T.group('Probably not songs').box.indeterminate, 'the group shows it as partly ticked');
  T.ok(/1 of|4 files/.test(T.group('Probably not songs').sub), 'and still has its count: ' + T.group('Probably not songs').sub);
});

// ---- things glide: rows make way, new ones fade in, the ones going fade out ----
const glides = page(async (T) => {
  await T.skip();
  await T.ready();
  const below = T.group('Mixtapes').el;
  const y0 = below._y;
  T.group('Abbey Road').el.querySelector('.fr-text').click();
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  T.ok(below._y < y0, 'the row below has somewhere new to be');
  T.ok(below.getAnimations().some((a) => a instanceof CSSTransition && a.transitionProperty === 'transform'), 'and glides there');
  T.ok(T.$$('.fr-row.out').length === 5, 'the songs of a shut group fade out, ' + T.$$('.fr-row.out').length);
  T.ok(T.group('Abbey Road').el.querySelector('.fr-chev').getAnimations().some((a) => a.transitionProperty === 'transform'), 'its arrow turns');
  await T.wait(800);
  T.ok(!T.$$('.fr-row.out').length, 'and are gone after');
  T.group('Abbey Road').el.querySelector('.fr-text').click();
  await new Promise(requestAnimationFrame);
  T.ok(T.$$('.fr-row.enter').length >= 5, 'opening: its songs fade in, ' + T.$$('.fr-row.enter').length);
  T.ok(below.getAnimations().some((a) => a.transitionProperty === 'transform'), 'and the row below makes way');
  // the keyboard can open a group too
  await T.wait(700);
  const toggle = T.group('Abbey Road').el.querySelector('.fr-toggle');
  T.ok(toggle.tagName === 'BUTTON' && toggle.getAttribute('aria-expanded') === 'true', 'the arrow is a real button that says it is open');
});

// ---- reading further down while songs arrive above: what's being read stays put ----
const keepsPlace = page(async (T) => {
  await T.skipAtOnce();
  await T.until(() => T.groups().length >= 18, 'enough groups to scroll', 20000);
  T.ok(T.state() === 'scanning', 'the scan is still going');
  const list = T.$('.fr-list');
  list.scrollTop = 300;
  await T.wait(620);      // rows that were already gliding from before the scroll have landed
  const rowAt = T.groups().find((g) => T.box(g.el).y > T.box(list).y + 40);
  const key = rowAt.name, y = T.box(rowAt.el).y, top = list.scrollTop;
  let worst = 0, moved = false;
  while (T.state() === 'scanning') {
    const g = T.group(key);
    if (g) { worst = Math.max(worst, Math.abs(T.box(g.el).y - y)); if (list.scrollTop !== top) moved = true; }
    await new Promise(requestAnimationFrame);
  }
  T.ok(moved, 'songs did arrive above it');
  T.ok(worst < 2, 'the row being read stays where it is, drifted ' + worst + ' px');
});

// ---- nothing to find ----
const nothing = page(async (T) => {
  await T.skip();
  await T.ready();
  T.ok(T.state() === 'empty', 'the window knows there is nothing, got ' + T.state());
  await T.wait(600);
  T.ok(/no songs/i.test(T.heading() || ''), 'a kind heading, got ' + T.heading());
  T.ok(/Music and Downloads/.test(T.$('.intro-words p').textContent), 'it says where it looked: ' + T.$('.intro-words p').textContent);
  T.ok(T.addBtn().textContent === 'Add a folder', 'the button is Add a folder, got ' + T.addBtn().textContent);
  T.ok(!T.addBtn().disabled, 'and it can be pressed');
  T.ok(T.$('.fr-empty'), 'an empty state in the glass');
  T.ok(!T.$('.fr-search') || T.$('.fr-search').offsetParent === null, 'no search box with nothing to search');
  T.ok(T.$('.fr-later'), 'and a way out');
  T.addBtn().click();
  await T.ended('Add a folder');
  T.ok(lib.size > 0, 'the folder\'s songs are in the library, got ' + lib.size);
  T.ok(deck.paused, 'nothing starts playing');
  await T.appIsBack('Add a folder');
});

// ---- nothing to find, leaving ----
const nothingLeave = page(async (T) => {
  await T.skip();
  await T.ready();
  T.$('.fr-later').click();
  await T.ended('empty, Not now');
  T.ok(lib.size === 0, 'the library is empty');
  await T.appIsBack('empty, Not now');
  // and in Settings, nothing to find is kind too
  await T.findFromSettings();
  T.ok(T.state() === 'empty', 'the sheet knows there is nothing');
  T.ok(T.$('.fr-empty'), 'an empty state in the sheet');
  T.ok(T.addBtn().textContent === 'Add a folder', 'with Add a folder, got ' + T.addBtn().textContent);
});

// ---- only files that probably aren't songs: they're still shown, nothing is ticked, and ticking one can add it ----
const junkOnly = page(async (T) => {
  await T.skip();
  await T.ready();
  T.ok(T.state() === 'done', 'it is not the empty state, got ' + T.state());
  T.ok(T.heading() === "Here's what we found", 'the heading, got ' + T.heading());
  T.ok(T.row('ding') && T.row('notification'), 'with nothing else to look at the group starts open');
  T.ok(T.addBtn().disabled && T.addBtn().textContent === 'Add songs', 'nothing ticked, the button waits');
  T.ok(/Nothing that looks like a song/.test(T.$('.intro-words p').textContent), 'the words say so: ' + T.$('.intro-words p').textContent);
  T.$('.fr-all').click();
  await T.wait(30);
  T.ok(T.addBtn().disabled, 'Select all still leaves them alone');
  T.row('ding').box.click();
  await T.wait(30);
  T.ok(T.addBtn().textContent === 'Add 1 song' && !T.addBtn().disabled, 'one ticked by hand: Add 1 song, got ' + T.addBtn().textContent);
  T.addBtn().click();
  await T.ended('junk only');
  T.ok(lib.size === 1, 'it is in, got ' + lib.size);
});

// ---- the way out ----
const notNow = page(async (T) => {
  await T.walkIntro();
  await T.ready();
  T.ok(T.$('.fr-later')?.textContent === 'Not now', 'there is a Not now');
  const b = T.box('.fr-later');
  T.ok(document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2)?.closest('.fr-later'), 'Not now takes clicks');
  T.$('.fr-later').click();
  await T.ended('Not now');
  T.ok(lib.size === 0, 'closing without adding leaves the library empty, got ' + lib.size);
  T.ok(localStorage.getItem('glass.introSeen'), 'the intro counts as seen');
  const st = await glass.scan.status();
  T.ok(!st.ran && !st.scanning, 'not marked as run, and the scan is stopped');
  await T.appIsBack('Not now');
  // nothing broke: the app answers, and Settings still works later
  await T.findFromSettings();
  T.ok(T.addBtn().textContent === 'Add 12 songs', 'Settings still finds them, got ' + T.addBtn().textContent);
  T.addBtn().click();
  await T.until(() => T.$('#modalRoot').hidden, 'Add closes the sheet');
  T.ok(lib.size === 12, 'and adds them, got ' + lib.size);
  T.ok((await glass.scan.status()).ran, 'now it counts as run');
});

// ---- Skip, and Esc, still come through the window. Esc there is the way out ----
const skipped = page(async (T) => {
  T.ok(T.vars.how === 'skip' || T.vars.how === 'esc', 'the test says how');
  await T.until(() => T.heading() === 'Glassy', 'the welcome screen');
  await T.wait(300);
  if (T.vars.how === 'skip') T.$('.intro-skip').click();
  else document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.ready();
  T.ok(T.intro() && !T.$('#intro').classList.contains('leaving'), T.vars.how + ': the app waits for the window');
  T.ok(T.heading() === "Here's what we found", T.vars.how + ': the heading, got ' + T.heading());
  T.ok(T.count() === 12, T.vars.how + ': the songs are there, got ' + T.count());
  // Skip is out of the way now; its spot takes no clicks
  T.ok(getComputedStyle(T.$('.intro-skip')).pointerEvents === 'none', T.vars.how + ': Skip no longer takes clicks');
  // Esc clears a search first, then leaves
  await T.search('beatles');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.wait(260);
  T.ok(T.$('.fr-search input').value === '' && T.open() && !T.$('#intro').classList.contains('leaving'), T.vars.how + ': Esc clears the search first');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await T.ended(T.vars.how);
  T.ok(lib.size === 0, T.vars.how + ': nothing added');
  await T.appIsBack(T.vars.how);
});

// ---- a song opened from Explorer on first launch: no window, no scan, and the next launch doesn't bring it back ----
const fromExplorer = page(async (T) => {
  const msgs = [];
  glass.scan.onProgress((m) => msgs.push(m));
  await T.until(() => !T.intro(), 'the song dismisses the intro', 1500);
  await T.until(() => typeof current === 'function' && current(), 'the song is loaded', 3000);
  await T.wait(1500);
  T.ok(!T.open(), 'opened from Explorer: no window');
  const st = await glass.scan.status();
  T.ok(!st.scanning && !st.ran, 'opened from Explorer: no scan left running, not marked as run');
  T.ok(lib.size === 1, 'the library holds that song, got ' + lib.size);
  await T.appIsBack('opened from Explorer');
  await T.wait(800);
});
const afterExplorer = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.wait(500);
  T.ok(T.intro(), 'the next plain launch shows the intro, as before');
  T.$('.intro-skip').click();
  let ever = false;
  const t0 = performance.now();
  while (T.intro() && performance.now() - t0 < 6000) { ever ||= T.open(); await T.wait(30); }
  T.ok(!ever, 'but a library with a song in it gets no window');
  await T.appIsBack('after Explorer');
  T.ok(!(await glass.scan.status()).scanning, 'and no scan');
});

// ---- opened while the window is up: it gets out of the way, the scan stops, the app is fine ----
const dismissed = page(async (T) => {
  await T.skip();
  await T.ready();
  Intro.dismiss();
  T.ok(!T.open() && !T.intro(), 'dismiss ends the window at once');
  T.ok(localStorage.getItem('glass.introSeen') === null, 'and it still counts as not seen');
  await T.appIsBack('dismissed');
  T.ok(!(await glass.scan.status()).scanning, 'the scan is stopped');
  T.ok(lib.size === 0, 'nothing added');
  await T.findFromSettings();
  T.ok(T.addBtn().textContent === 'Add 12 songs', 'Settings still finds them, got ' + T.addBtn().textContent);
});

// ---- Replay from Settings never brings the window ----
const replay = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  T.ok(!T.intro(), 'seen: no intro');
  Intro.replay();
  await T.until(() => T.heading() === 'Glassy', 'welcome');
  await T.wait(600);
  T.$('.intro-skip').click();
  let ever = false;
  const t0 = performance.now();
  while (T.intro() && performance.now() - t0 < 6000) { ever ||= T.open(); await T.wait(30); }
  T.ok(!ever, 'Replay goes straight back into the app');
  await T.appIsBack('Replay');
});

// ---- the count climbs while songs come in, and the app keeps moving ----
const climbs = page(async (T) => {
  let messages = 0;
  glass.scan.onProgress(() => { messages++; });
  await T.skipAtOnce();
  const before = messages;
  let gapTop = 0, last = performance.now(), going = true;
  const tick = (n) => { gapTop = Math.max(gapTop, n - last); last = n; if (going) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const seen = [];
  const t0 = performance.now();
  while (T.state() === 'scanning' && performance.now() - t0 < 60000) { const c = T.count(); if (seen.at(-1) !== c) seen.push(c); await T.wait(40); }
  await T.wait(800);
  going = false;
  T.ok(T.state() === 'done', 'the scan finished, state ' + T.state());
  T.ok(messages - before >= 3, 'the scan really was going with the window up, messages since it opened: ' + (messages - before));
  T.ok(seen.length >= 4, 'the count climbs, went through ' + seen.join(' '));
  T.ok(seen.every((c, i) => !i || c >= seen[i - 1]), 'and only goes up: ' + seen.join(' '));
  await T.until(() => T.count() === T.vars.total, 'it ends on the total, got ' + T.count());
  T.ok(gapTop < 400, 'the app stays responsive, longest frame ' + Math.round(gapTop) + ' ms');
  // more than a dozen groups: all shut, and the button knows them all
  T.ok(T.groups().length > 12, 'lots of groups: ' + T.groups().length);
  T.ok(T.rows().length === 0, 'more than a dozen groups start shut, rows ' + T.rows().length);
  T.ok(T.addBtn().textContent === `Add ${T.vars.total.toLocaleString()} songs`, 'the button knows every song, got ' + T.addBtn().textContent);
  const first = T.groups()[0];
  T.ok(first.box.checked, 'a shut group is ticked');
  first.el.querySelector('.fr-text').click();
  await T.wait(700);
  T.ok(T.rows().length > 5 && T.rows().length <= T.vars.each, 'and opens to its songs, rows on the page ' + T.rows().length);
  T.addBtn().click();
  await T.ended('many groups');
  T.ok(lib.size === T.vars.total, 'all in the library, got ' + lib.size);
});

// ---- Add pressed while the scan is still going: what's ticked goes in, the rest waits for another day ----
const addEarly = page(async (T) => {
  await T.skipAtOnce();
  await T.until(() => T.count() > 0, 'songs start to arrive', 20000);
  T.ok(T.state() === 'scanning', 'the scan is still going, state ' + T.state());
  T.ok(/still looking/i.test(T.$('.intro-words p').textContent), 'it says it is still looking: ' + T.$('.intro-words p').textContent);
  T.ok(/songs? so far/i.test(T.$('.intro-words p').textContent), 'and how many so far');
  T.ok(!T.addBtn().disabled, 'the button can be pressed already');
  T.addBtn().click();
  await T.ended('Add early');
  T.ok(lib.size > 0 && lib.size < T.vars.total, 'what was found is in, ' + lib.size + ' of ' + T.vars.total);
  const st = await glass.scan.status();
  T.ok(!st.scanning && st.ran, 'and the scan stopped');
});

// ---- a list of 2000 rows: only what's in sight is on the page, and it stays smooth ----
const long = page(async (T) => {
  await T.skip();
  await T.ready();
  T.ok(T.addBtn().textContent === 'Add 2,000 songs', 'the button, got ' + T.addBtn().textContent);
  T.ok(T.groups()[0]?.name === 'Everything', 'one group, open');
  const list = T.$('.fr-list');
  T.ok(T.rows().length > 5 && T.rows().length < 80, 'only rows in sight are on the page: ' + T.rows().length);
  T.ok(list.scrollHeight > 2000 * 30, 'the list is as tall as all of them: ' + list.scrollHeight);

  let top = 0, last = 0;
  const step = (n) => new Promise((r) => requestAnimationFrame((t) => { if (last) top = Math.max(top, t - last); last = t; r(); }));
  for (let i = 0; i < 90; i++) { list.scrollTop += 900; await step(); }
  T.ok(top < 150, 'scrolling stays smooth, longest frame ' + Math.round(top) + ' ms');
  T.ok(T.rows().length < 80, 'still only rows in sight: ' + T.rows().length);
  await T.toEnd();
  T.ok(T.row('Track 2000'), 'the last one is at the end: ' + T.rows().at(-1)?.title);
  const b = T.box(T.row('Track 2000').el), l = T.box(list);
  T.ok(b.b <= l.b + 1, 'and not cut off');
  // a row that left and came back keeps its tick
  T.row('Track 2000').box.click();
  await T.toTop();
  await T.toEnd();
  T.ok(!T.row('Track 2000').box.checked, 'it keeps its tick after scrolling away');
  T.ok(T.addBtn().textContent === 'Add 1,999 songs', 'one less, got ' + T.addBtn().textContent);

  // heavy things stay quick
  let t0 = performance.now();
  T.$('.fr-none').click();
  T.ok(performance.now() - t0 < 60, 'Select none on 2000: ' + Math.round(performance.now() - t0) + ' ms');
  t0 = performance.now();
  T.$('.fr-all').click();
  T.ok(performance.now() - t0 < 60, 'Select all on 2000: ' + Math.round(performance.now() - t0) + ' ms');
  t0 = performance.now();
  await T.search('Track 1500');
  T.ok(T.row('Track 1500'), 'search finds one in 2000');
  T.ok(performance.now() - t0 < 500, 'and quickly: ' + Math.round(performance.now() - t0) + ' ms');
});

// ---- real covers: on rows in sight only, four at a time, each asked for once ----
const covers = page(async (T) => {
  const calls = [], real = FirstRun.cover;
  let now = 0, most = 0;
  FirstRun.cover = async (p) => {
    calls.push(p);
    now++; most = Math.max(most, now);
    await T.wait(150);       // slow enough that the calls overlap if they're allowed to
    try { return await real(p); } finally { now--; }
  };
  await T.skip();
  await T.ready();
  const pic = (el) => el.querySelector('.fr-art .fr-pic');
  const bg = (el) => (pic(el) ? pic(el).style.backgroundImage : '');
  T.ok(T.row('Cover One') && T.row('Bare Three'), 'the songs are on the page');
  await T.until(() => bg(T.row('Cover One').el), 'a cover arrives', 5000);
  await T.wait(900);
  T.ok(/^url\("file:/.test(bg(T.row('Cover One').el)), 'a song with a cover gets it as a file: image, got ' + bg(T.row('Cover One').el));
  T.ok(/^url\("file:/.test(bg(T.row('Cover Two').el)), 'and so does the next, got ' + bg(T.row('Cover Two').el));
  T.ok(bg(T.row('Cover One').el) !== bg(T.row('Cover Two').el), 'each its own');
  const bare = T.row('Bare Three').el.querySelector('.fr-art');
  T.ok(!pic(T.row('Bare Three').el) && bare.querySelector('svg') && !bare.classList.contains('has-pic'), 'a song without one keeps its placeholder');
  T.ok(/^url\("file:/.test(bg(T.group('Paper Moons').el)), 'an album shows the cover of a song in it, got ' + bg(T.group('Paper Moons').el));
  T.ok(!pic(T.group('Glasshouse').el) && T.group('Glasshouse').el.querySelector('.fr-art').style.backgroundImage, 'an album with no covers keeps its gradient');
  T.ok(!pic(T.group('Loose').el) && T.group('Loose').el.querySelector('.fr-art svg'), 'a folder keeps its icon');
  T.ok(/^url\("file:/.test(bg(T.row('Loose Covered').el)), 'but its covered song shows its own');
  T.ok(+getComputedStyle(pic(T.row('Cover One').el)).opacity === 1, 'the cover has faded all the way in');
  const art = T.box(T.row('Cover One').el.querySelector('.fr-art')), bareBox = T.box(bare);
  T.ok(art.w === bareBox.w && art.h === bareBox.h && art.x === bareBox.x, 'the cover takes the placeholder\'s place exactly, ' + art.w + 'x' + art.h);
  T.ok(most >= 2 && most <= 4, 'at most four at once, and more than one: ' + most);
  T.ok(new Set(calls).size === calls.length, 'each file asked once, ' + calls.length + ' calls');
  // away and back: no new calls, and the cover is there at once
  const before = calls.length;
  await T.search('zzzzzzqqqq');
  await T.search('');
  const back = T.row('Cover One');
  T.ok(back && /^url\("file:/.test(bg(back.el)), 'back again with its cover straight away');
  T.ok(pic(back.el).classList.contains('still'), 'with no fade to flicker');
  await T.wait(400);
  T.ok(calls.length === before, 'and nothing asked twice, ' + (calls.length - before) + ' new calls');
});

// ---- the bar and the line that say it is still looking, and where ----
const looking = page(async (T) => {
  const seen = [];
  glass.scan.onProgress((m) => { if (m.looking) seen.push(m.looking); });
  await T.skipAtOnce();
  await T.until(() => T.$('.fr-where')?.textContent.startsWith('Looking in'), 'the line says where', 20000);
  T.ok(T.state() === 'scanning', 'while it is still going');
  const look = T.$('.fr-look');
  T.ok(look.classList.contains('on') && +getComputedStyle(look).opacity > 0, 'the bar is showing');
  const bar = T.box(T.$('.fr-bar')), list = T.box('.fr-list');
  T.ok(bar.h > 1 && bar.h <= 6 && bar.w > 100, 'a thin bar, ' + bar.w + 'x' + bar.h);
  T.ok(bar.b <= list.y, 'above the list, clear of it');
  const line = T.$('.fr-where');
  T.ok(/^Looking in Music( › [^›]+){0,3}$/.test(line.textContent), 'says the root and folders under it, got ' + line.textContent);
  T.ok(!/[\\/:]/.test(line.textContent.replace('Looking in ', '')), 'not a full path');
  T.ok(getComputedStyle(line).textOverflow === 'ellipsis', 'and cut off nicely when long');
  T.ok(T.$('.fr-bar span').getAnimations().length > 0, 'the shimmer moves');
  await T.until(() => T.state() === 'done', 'the scan finishes', 60000);
  await T.wait(1000);
  T.ok(!look.classList.contains('on') && +getComputedStyle(look).opacity === 0, 'when it is done the bar fades away');
  T.ok(T.$('.intro-words p').textContent.includes('songs'), 'and the words say what was found: ' + T.$('.intro-words p').textContent);
  T.ok(seen.length >= 2 && seen.every((w) => w.startsWith('Music')), 'it was sent along the way: ' + seen.length);
});

// ---- play on a row: one preview at a time, never touches a tick ----
const previews = page(async (T) => {
  await T.skip();
  await T.ready();
  const play = (t) => T.row(t).el.querySelector('.fr-play');
  const playing = () => T.$$('.fr-row.playing').map((r) => r.querySelector('b').textContent);
  T.ok(T.rows().length === 3 && T.rows().every((r) => r.el.querySelector('.fr-play')), 'every song row has a play button');
  const order = ['.check', '.fr-art', '.fr-play', '.fr-text', '.fr-dur'].map((s) => T.box(T.row('Play A').el.querySelector(s)));
  T.ok(order.every((b, i) => !i || (b.x >= order[i - 1].r - 0.5)), 'checkbox, cover, play, title, length in a row: ' + order.map((b) => Math.round(b.x)).join());
  const ticks = T.addBtn().textContent, rows = T.rows().length;
  play('Play A').click();
  await T.wait(60);
  T.ok(playing().join() === 'Play A', 'a click starts it, playing: ' + playing().join());
  T.ok(FirstRun.audio && /^file:/.test(FirstRun.audio.src), 'through the one audio element, with the song\'s file url');
  T.ok(T.row('Play A').box.checked && T.addBtn().textContent === ticks, 'it does not tick or untick the row');
  T.ok(T.rows().length === rows && T.group('Play Set').el.classList.contains('open'), 'and opens or closes nothing');
  const el = FirstRun.audio;
  play('Play B').click();
  await T.wait(60);
  T.ok(playing().join() === 'Play B' && FirstRun.audio === el, 'a second one stops the first, playing: ' + playing().join());
  play('Play B').click();
  await T.wait(30);
  T.ok(!playing().length && el.paused, 'clicking the playing one pauses it');
  play('Play A').click();
  await T.wait(30);
  el.dispatchEvent(new Event('ended'));
  await T.wait(30);
  T.ok(!playing().length, 'when the song ends the icon clicks back');
  play('Play A').click();
  await T.wait(30);
  T.group('Play Set').el.querySelector('.fr-text').click();
  await T.wait(700);
  T.ok(!playing().length && el.paused, 'shutting its group stops it');
  T.group('Play Set').el.querySelector('.fr-text').click();
  await T.wait(700);
  // a file that can't play: a quiet state on its row, and the window carries on
  await T.search('ding');
  play('ding').click();
  await T.until(() => T.row('ding').el.classList.contains('bad'), 'the row goes quiet', 4000);
  T.ok(T.open() && !playing().length, 'a file that will not play leaves the window as it was');
  T.ok(/play/i.test(T.row('ding').el.querySelector('.fr-play').title), 'and says so quietly: ' + T.row('ding').el.querySelector('.fr-play').title);
  await T.search('');
  play('Play C').click();
  await T.wait(60);
  T.ok(playing().join() === 'Play C', 'and another still plays');
  T.$('.fr-later').click();
  await T.ended('Not now');
  T.ok(el.paused && !FirstRun.audio, 'closing the window stops it');
});

// ---- the glass: the one shape morphs into the panel from where it was, and later from the panel into the side panel ----
const morphs = page(async (T) => {
  await T.until(() => T.heading() === 'Glassy', 'welcome');
  await T.wait(1800);
  for (let i = 0; i < T.vars.at; i++) { T.$('.intro-go').click(); await T.wait(700); }
  await T.wait(900);
  const glass = T.$('.intro-glass');
  const before = T.box(glass);
  const glide = [];
  let sampling = true;
  const sample = () => { const b = T.box(glass); if (b) glide.push({ t: performance.now(), b }); if (sampling) requestAnimationFrame(sample); };
  if (T.vars.at === 4) T.$('.intro-go').click(); else T.$('.intro-skip').click();
  sample();
  await T.until(T.open, 'the window opens', 3000);
  await T.wait(1500);
  sampling = false;
  const worstOf = (frames) => { let w = 0; for (let i = 1; i < frames.length; i++) { const a = frames[i - 1], b = frames[i], dt = Math.max(1, b.t - a.t); for (const k of ['x', 'y', 'w', 'h']) w = Math.max(w, Math.abs(b.b[k] - a.b[k]) / dt); } return w; };
  const limit = 3 * (innerWidth / 1240);
  T.ok(glide.length > 30, 'enough frames, got ' + glide.length);
  T.ok(worstOf(glide) < limit, 'the shape glides into the panel with no jump, worst ' + worstOf(glide).toFixed(2) + ' px/ms');
  T.ok(Math.abs(glide[0].b.x - before.x) < 3 && Math.abs(glide[0].b.w - before.w) < 3, 'it starts from where it was');
  const panel = T.box(glass);
  T.ok(panel.w !== before.w || panel.h !== before.h, 'it changes shape');
  T.ok(T.inWindow(panel) && panel.y >= 44, 'the panel is inside the window, below the title bar');
  T.ok(T.$('.fr-panel').closest('.intro-glass') === glass, 'the list is inside the one glass shape');
  T.ok(document.querySelectorAll('.intro-glass').length === 1, 'and there is only one');
  const lg = /url\(#(.+?)\)/.exec(getComputedStyle(glass).getPropertyValue('--lg'))?.[1];
  const f = lg && document.getElementById(lg);
  T.ok(f && Math.abs(+f.getAttribute('width') - panel.w) <= 1 && Math.abs(+f.getAttribute('height') - panel.h) <= 1, 'real glass, refitted to the panel');
  T.ok(!glass.classList.contains('lg-busy'), 'and back to refraction when it lands');
  await T.until(() => T.count() === 12, 'the songs');

  // Add: on into the existing way into the app. The shape lands on the real panel with no jump
  const side = T.$('#side');
  const frames = [];
  const sample2 = () => {
    const g = T.box(glass);
    frames.push({ t: performance.now(), b: g, sideOp: +getComputedStyle(side).opacity, gOp: +getComputedStyle(glass).opacity });
    if (T.$('#intro')?.isConnected && glass.isConnected) requestAnimationFrame(sample2);
  };
  T.addBtn().click();
  sample2();
  await T.ended('hand-over');
  await T.wait(50);
  while (frames.length > 1 && !frames.at(-1).b.w) frames.pop();
  const last = frames.at(-1), target = T.box(side);
  for (const k of ['x', 'y', 'w', 'h']) T.ok(Math.abs(last.b[k] - target[k]) <= 1, 'the shape lands on #side ' + k + ': ' + last.b[k] + ' vs ' + target[k]);
  T.ok(worstOf(frames) < limit, 'and glides there with no jump, worst ' + worstOf(frames).toFixed(2) + ' px/ms');
  T.ok(last.sideOp === 1 && last.gOp < 0.01, 'the real panel takes over');
  T.ok(lib.size === 12, 'the songs are in, got ' + lib.size);
  await T.appIsBack('hand-over');
});

// ---- every size: everything fits, nothing touches ----
const sizes = page(async (T) => {
  const [W, H] = T.vars.size.split('x').map(Number);
  T.ok(innerWidth === W && innerHeight === H, 'the test window is ' + T.vars.size);
  await T.skip();
  await T.ready();
  const check = (at) => {
    const glass = T.box('.intro-glass'), h = T.box('.intro-words h1'), p = T.box('.intro-words p'), go = T.box('.intro-go'), later = T.box('.fr-later');
    T.ok(T.inWindow(glass), at + ': the glass is inside the window');
    T.ok(glass.y >= 44, at + ': the glass is below the title bar, y ' + glass.y);
    for (const [n, b] of [['heading', h], ['text', p], ['button', go], ['Not now', later]]) {
      T.ok(T.inWindow(b), at + ': ' + n + ' inside the window');
      T.ok(!T.overlap(glass, b), at + ': ' + n + ' clear of the glass');
    }
    T.ok(!T.overlap(p, go), at + ': the words clear of the button');
    T.ok(!T.overlap(go, later), at + ': Not now clear of the button');
    T.ok(h.w > 150 && h.h < H * .5, at + ': the heading has room');
    const tools = ['.fr-search', '.fr-all', '.fr-none'].map((s) => T.box(s));
    for (const b of tools) T.ok(b.x >= glass.x + 6 && b.r <= glass.r - 6 && b.y >= glass.y + 6, at + ': tools inside the glass');
    T.ok(tools[0].w > 110, at + ': the search box has room, ' + tools[0].w);
    T.ok(!T.overlap(tools[0], tools[1]) && !T.overlap(tools[1], tools[2]), at + ': tools clear of each other');
    const list = T.box('.fr-list');
    T.ok(list.b <= glass.b && list.r <= glass.r && list.h > 150, at + ': the list fits, height ' + list.h);
    const lastRow = T.box(T.inOrder('.fr-item').at(-1));
    T.ok(lastRow.b >= list.b, at + ': rows reach the bottom of the list, ' + lastRow.b + ' of ' + list.b);
    for (const r of T.rows().slice(0, 6)) {
      const t = T.box(r.el.querySelector('.fr-text'));
      T.ok(t.w > 80, at + ': a row\'s words have room, ' + t.w);
      T.ok(T.box(r.el).r <= list.r, at + ': a row is not cut off at the side');
      const fs = parseFloat(getComputedStyle(r.el.querySelector('b')).fontSize);
      T.ok(fs >= 12.5, at + ': a row can be read, font ' + fs);
      const tick = T.box(r.el.querySelector('.box'));
      T.ok(tick.w / fs > 1.3, at + ': its tick box keeps up with the words, ' + tick.w + ' beside font ' + fs);
    }
    for (const g of T.groups().slice(0, 3)) T.ok(g.el.querySelector('b').scrollHeight <= g.el.offsetHeight, at + ': a group\'s name fits');
  };
  check('landed');
  const add = T.box(T.addBtn());
  T.ok(document.elementFromPoint(add.x + add.w / 2, add.y + add.h / 2)?.closest('.intro-go'), 'Add takes clicks');
  for (let e = T.$('.intro-glass').parentElement; e; e = e.parentElement) T.ok(getComputedStyle(e).transform === 'none', 'no transform above the glass on ' + (e.id || e.tagName));
  T.$('.fr-later').click();
  await T.ended('size ' + T.vars.size);
});

// ---- the sheet fits as well ----
const sheetSizes = page(async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library loads');
  await T.findFromSettings();
  const sheet = T.box('.fr-sheet'), list = T.box('.fr-list'), add = T.box('.fr-sheet button[type=submit]'), later = T.box('.fr-later');
  T.ok(T.inWindow(sheet), 'the sheet is inside the window');
  T.ok(list.h > 150, 'the list has room, ' + list.h);
  T.ok(T.inWindow(add) && add.b <= sheet.b && T.inWindow(later), 'the buttons are inside');
  T.ok(!T.overlap(add, later) && !T.overlap(list, add), 'and clear of each other');
  T.ok(T.$('.fr-sheet').classList.contains('glass'), 'it is the normal glass sheet');
  T.ok(+getComputedStyle(T.$('.fr-later')).opacity === 1 && T.$('.fr-later').textContent === 'Not now', 'Not now can be seen');
  T.ok(document.elementFromPoint(later.x + later.w / 2, later.y + later.h / 2)?.closest('.fr-later'), 'and takes clicks');
  T.ok(later.x < add.x && later.b <= sheet.b, 'and sits at the other end from Add');
  T.ok(T.count() === 12, 'the live count, got ' + T.count());
});

// ---- the window changes size while it's up ----
const resizing = page(async (T) => {
  await T.skip();
  await T.ready();
  const before = T.box('.intro-glass');
  const sized = async (w, h) => { window.resizeTo(w, h); await T.until(() => innerWidth === w && innerHeight === h, 'the window resizes to ' + w + 'x' + h, 3000); await T.wait(500); };
  await sized(900, 600);
  const small = T.box('.intro-glass');
  T.ok(small.w < before.w, 'the panel follows the window');
  T.ok(T.inWindow(small) && small.y >= 44, 'and stays inside');
  const list = T.box('.fr-list');
  T.ok(list.r <= small.r && list.b <= small.b, 'its list follows');
  T.ok(T.rows().length > 3, 'and still has rows, ' + T.rows().length);
  for (const r of T.rows().slice(0, 4)) T.ok(T.box(r.el).r <= list.r, 'rows fit the new width');
  await T.wait(400);
  const lg = /url\(#(.+?)\)/.exec(getComputedStyle(T.$('.intro-glass')).getPropertyValue('--lg'))?.[1];
  T.ok(lg && +document.getElementById(lg).getAttribute('width') === Math.round(small.w), 'the glass refits');
  T.$('.fr-later').click();
  await T.ended('resize');
  await T.appIsBack('resize');
});

// ---- reduced motion: the shape crossfades, rows don't move ----
const reduced = page(async (T) => {
  T.ok(reduceMotion === true, 'the test really has reduced motion on');
  const moving = (el) => el.getAnimations().filter((x) => {
    if (x instanceof CSSTransition) return false;
    return x.effect.getKeyframes().some((k) => ['left', 'top', 'width', 'height', 'transform', 'translate'].some((p) => k[p] && k[p] !== 'none'));
  });
  await T.until(() => T.heading() === 'Glassy', 'welcome');
  await T.wait(800);
  const glass = T.$('.intro-glass');
  T.$('.intro-skip').click();
  await T.wait(30);
  T.ok(!moving(glass).length, 'reduced motion: the shape does not glide');
  T.ok(glass.getAnimations().some((x) => x.effect.getKeyframes().some((k) => 'opacity' in k)), 'reduced motion: it fades');
  await T.ready();
  T.ok(+getComputedStyle(glass).opacity === 1, 'reduced motion: and comes back');
  await T.until(() => T.count() === 12, 'reduced motion: the count lands right away');
  T.group('Abbey Road').el.querySelector('.fr-text').click();
  await T.wait(30);
  T.ok(!T.row('Something'), 'reduced motion: a group shuts at once');
  T.ok(!T.$$('.fr-item').some((r) => moving(r).length), 'reduced motion: no rows move');
  T.$('.fr-later').click();
  await T.wait(30);
  T.ok(!moving(glass).length, 'reduced motion: no morph on the way out');
  await T.ended('reduced motion');
  await T.appIsBack('reduced motion');
});

const small = realFiles(Files.small);
const seedLibrary = () => {
  // one exactly as the scan will see it, one with its capitals changed (Windows doesn't care, so neither may we)
  const s = Files.small();
  const a = path.join(s.music, 'The Beatles', 'Abbey Road', '01 Come Together.wav');
  const b = path.join(s.music, 'Radiohead', 'In Rainbows', 'Reckoner.wav').toUpperCase();
  const t = (p) => ({ path: p, url: 'file:///' + p.replace(/\\/g, '/'), name: path.parse(p).name });
  return { v: 3, tracks: [t(a), t(b)], queue: [], playlists: [] };
};
const SIZES = ['900x600', '1240x800', '1920x1080', '2560x1440', '1000x1100', '2200x620'];
module.exports = [
  { name: 'fresh install: after the intro, groups, ticks, search, Add', profile: 'fresh', vars: { beatles: ['Come Together', 'Something', 'Oh! Darling', "Octopus's Garden", 'Here Comes the Sun'] }, env: small, page: fresh, timeout: 180000 },
  { name: 'fresh install: next launch offers nothing; Settings asks again', profile: 'fresh', env: small, page: nextLaunch, timeout: 180000 },
  { name: 'a library already there: no window; Settings hides what it has', env: small, library: seedLibrary, page: existing },
  { name: 'everything found is in the library already', env: small, library: () => { const t = (p) => ({ path: p, url: 'file:///' + p.replace(/\\/g, '/'), name: path.parse(p).name }); return { v: 3, tracks: Files.filesIn(Files.small()).map(t), queue: [], playlists: [] }; }, page: allThere },
  { name: 'a search: Select all, Select none and group boxes act on what shows', env: small, page: searchTicks },
  { name: 'rows glide, fade in and fade out', env: small, page: glides },
  { name: 'songs arriving above leave what is being read in place', env: realFiles(() => Files.growing(110)), page: keepsPlace, timeout: 180000 },
  { name: 'nothing found: kind, Add a folder', env: () => ({ GLASS_SCAN_ROOTS: Files.roots(Files.none()), GLASS_FOLDER_PICK: Files.small().music }), page: nothing },
  { name: 'nothing found: Not now, and in Settings', env: realFiles(Files.none), page: nothingLeave },
  { name: 'only files that probably are not songs', env: realFiles(Files.onlyJunk), page: junkOnly },
  { name: 'Not now: empty library, Settings still works', env: small, page: notNow },
  { name: 'Skip comes through the window', vars: { how: 'skip' }, env: small, page: skipped },
  { name: 'Esc comes through the window', vars: { how: 'esc' }, env: small, page: skipped },
  { name: 'opened from Explorer: no window, no scan', profile: 'explorer', songs: 1, env: small, page: fromExplorer },
  { name: 'opened from Explorer: next launch has a song, so no window', profile: 'explorer', env: small, page: afterExplorer },
  { name: 'dismissed while it is up', env: small, page: dismissed },
  { name: 'Replay: set up', profile: 'replay', env: small, page: notNow },
  { name: 'Replay: no window', profile: 'replay', env: small, page: replay },
  { name: 'the count climbs, more than a dozen groups, responsive', vars: { total: 6000, each: 50 }, env: realFiles(() => Files.folders(120, 50)), page: climbs, timeout: 180000 },
  { name: 'Add while it is still looking', vars: { total: 6000 }, env: realFiles(() => Files.folders(120, 50)), page: addEarly, timeout: 180000 },
  { name: '2000 rows in one group stay smooth', env: realFiles(() => Files.oneBig(2000)), page: long, timeout: 180000 },
  { name: 'real covers load for rows in sight, four at a time', env: realFiles(Files.covers), page: covers },
  { name: 'a bar and a line say it is still looking, and where', env: realFiles(() => Files.folders(120, 50)), page: looking, timeout: 180000 },
  { name: 'play buttons preview one song at a time', env: realFiles(Files.playable), page: previews },
  { name: 'the glass morphs in from the last screen and out to the panel', vars: { at: 4 }, env: small, page: morphs },
  { name: 'the glass morphs in from a Skip on the first screen', vars: { at: 0 }, env: small, page: morphs },
  { name: 'the glass morphs at 900x600', size: '900x600', vars: { at: 4 }, env: small, page: morphs },
  ...SIZES.map((size) => ({ name: `fits ${size}`, size, vars: { size }, env: realFiles(Files.gallery), page: sizes })),
  ...['900x600', '1240x800'].map((size) => ({ name: `the sheet fits ${size}`, size, library: seedNone, env: small, page: sheetSizes })),
  { name: 'window resized while it is up', env: small, page: resizing },
  { name: 'reduced motion', args: ['--force-prefers-reduced-motion'], env: small, page: reduced },
];
// a library with a playlist, so there's no intro in the way and nothing the scan knows about
function seedNone() { return { v: 3, tracks: [], queue: [], playlists: [{ id: 'p1', name: 'Mix', tracks: [], paths: [] }] }; }
