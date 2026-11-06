'use strict';
// Pictures of "Here's what we found" for a person to look at. Only scratch folders are scanned.
// Run: node scripts/ui-test.js tests/ui/firstrun-screens.js --shots <folder>          (add --only <text> for some of them)
const Files = require('./firstrun-files');

const ready = `async (T) => {
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(T.vars.fromLast ? 700 : 300);
  if (T.vars.fromLast) { for (let i = 0; i < 4; i++) { T.$('.intro-go').click(); await T.wait(700); } T.$('.intro-go').click(); }
  else T.$('.intro-skip').click();
  await T.until(() => T.$('.fr-panel'), 'the window');
  await T.until(() => T.$('.fr-panel').dataset.state !== 'scanning', 'the scan', 60000);
  await T.wait(T.vars.settle || 2200);
}`;
const stage = `async (T) => {
  await (${ready})(T);
  const list = T.$('.fr-list');
  if (T.vars.search) { const i = T.$('.fr-search input'); i.focus(); i.value = T.vars.search; i.dispatchEvent(new Event('input', { bubbles: true })); await T.wait(900); }
  if (T.vars.untick) { [...document.querySelectorAll('.fr-row')].slice(1, 3).forEach((r) => r.querySelector('input').click()); await T.wait(700); }
  if (T.vars.openJunk) {
    list.scrollTop = list.scrollHeight; await T.wait(500);
    [...document.querySelectorAll('.fr-group')].find((g) => /Probably/.test(g.textContent))?.querySelector('.fr-text').click();
    await T.wait(800); list.scrollTop = list.scrollHeight; await T.wait(600);
  }
  if (T.vars.scroll) { list.scrollTop = T.vars.scroll; await T.wait(500); }
  if (T.vars.none) { T.$('.fr-none').click(); await T.wait(900); }
}`;
const sheet = `async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library');
  await T.wait(400);
  Settings.open();
  await T.wait(800);
  if (T.vars.settings) { const b = T.$('[data-find-songs]'); b.scrollIntoView({ block: 'center' }); await T.wait(700); return; }
  T.$('[data-find-songs]').click();
  await T.until(() => T.$('.fr-sheet'), 'the sheet');
  await T.until(() => T.$('.fr-panel').dataset.state !== 'scanning', 'the scan', 60000);
  await T.wait(1200);
  document.activeElement?.blur();
  await T.wait(700);
}`;
const moment = `async (T) => { await (${ready})(T); }`;
// while the scan is still going: the window up as soon as the library is in, and the picture taken a moment later
const scanning = `async (T) => {
  await T.until(() => typeof loaded !== 'undefined' && loaded, 'the library');
  await T.wait(30);
  T.$('.intro-skip').click();
  await T.wait(T.vars.ms);
}`;
const seedPlaylist = () => ({ v: 3, tracks: [], queue: [], playlists: [{ id: 'p1', name: 'Mix', tracks: [], paths: [] }] });
const roots = (s) => () => ({ GLASS_SCAN_ROOTS: Files.roots(s()) });

const runs = [];
for (const size of ['1240x800', '900x600']) {
  runs.push({ name: `stage ${size} realistic`, size, env: roots(Files.gallery), vars: { fromLast: true }, page: stage });
  runs.push({ name: `stage ${size} partly ticked`, size, env: roots(Files.gallery), vars: { untick: true }, page: stage });
  runs.push({ name: `stage ${size} probably not`, size, env: roots(Files.gallery), vars: { openJunk: true }, page: stage });
  runs.push({ name: `stage ${size} searching`, size, env: roots(Files.small), vars: { search: 'beetles' }, page: stage });
  runs.push({ name: `stage ${size} none ticked`, size, env: roots(Files.small), vars: { none: true }, page: stage });
  runs.push({ name: `stage ${size} 2000 rows one group`, size, env: roots(() => Files.oneBig(2000)), vars: { scroll: 40000 }, page: stage, timeout: 180000 });
  runs.push({ name: `stage ${size} 2000 rows many groups`, size, env: roots(() => Files.folders(40, 50)), vars: {}, page: stage, timeout: 180000 });
  runs.push({ name: `stage ${size} empty`, size, env: roots(Files.none), vars: { settle: 2600 }, page: stage });
  runs.push({ name: `sheet ${size} realistic`, size, library: seedPlaylist, env: roots(Files.gallery), vars: {}, page: sheet });
  runs.push({ name: `sheet ${size} 2000 rows`, size, library: seedPlaylist, env: roots(() => Files.oneBig(2000)), vars: {}, page: sheet, timeout: 180000 });
  runs.push({ name: `sheet ${size} empty`, size, library: seedPlaylist, env: roots(Files.none), vars: {}, page: sheet });
  runs.push({ name: `settings ${size} the button`, size, library: seedPlaylist, env: roots(Files.none), vars: { settings: true }, page: sheet });
}
// where Add lands: the app with the library in it, a little after the way in has finished
const landed = `async (T) => { await (${ready})(T); T.$('.intro-go').click(); await T.until(() => !T.$('#intro'), 'into the app', 9000); await T.wait(T.vars.after); }`;
for (const size of ['1240x800', '900x600']) runs.push({ name: `landed ${size}`, size, env: roots(Files.gallery), vars: { after: 1400 }, page: landed });
// a big window: the list scales up with the words
runs.push({ name: 'stage 2560x1440 realistic', size: '2560x1440', env: roots(Files.gallery), vars: {}, page: stage });
// the way in, frame by frame
for (const ms of [120, 500, 900, 1300]) runs.push({ name: `way in ${String(ms).padStart(4, '0')}ms`, env: roots(Files.gallery), vars: { fromLast: true, settle: ms }, page: moment });
// still looking
for (const size of ['1240x800', '900x600']) for (const ms of [250, 1600]) runs.push({ name: `looking ${size} ${String(ms).padStart(4, '0')}ms`, size, env: roots(() => Files.folders(120, 50)), vars: { ms }, page: scanning, timeout: 180000 });
module.exports = runs;
