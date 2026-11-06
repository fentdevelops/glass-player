'use strict';
// Pictures of the intro for a person to look at: every screen at each size, and a frame strip of the way into the app.
// Run: node scripts/ui-test.js tests/ui/intro-screens.js --shots <folder>       (add --only strip for just the strip)
const HEADINGS = ['Glassy', 'Everything you already have.', 'Lyrics that follow along.', 'Sound you can shape.', 'Make it yours.'];

const reach = `async (T, at) => {
  await T.until(() => T.$('.intro-words h1')?.textContent === 'Glassy', 'welcome');
  await T.wait(1800);
  for (let i = 1; i <= at; i++) { T.$('.intro-go').click(); await T.wait(700); }
}`;
const screen = `async (T) => { await (${reach})(T, T.vars.at); await T.wait(T.vars.at ? 1900 : 1200); }`;
// the way in: from the last screen with its own button, wait, and let the run take its picture there
const strip = `async (T) => { await (${reach})(T, T.vars.at); await T.wait(1400); T.$('.intro-go').click(); await T.wait(T.vars.ms); }`;

const names = ['welcome', 'library', 'lyrics', 'sound', 'colours'];
const runs = [];
for (const size of ['1240x800', '900x600', '2560x1440']) {
  for (let at = 0; at < HEADINGS.length; at++) runs.push({ name: `screen ${size} ${at} ${names[at]}`, size, vars: { at }, page: screen });
}
for (const size of ['1240x800', '900x600']) {
  for (const ms of [120, 450, 800, 1100, 1400, 1700, 2000, 2200, 2600]) runs.push({ name: `strip ${size} ${String(ms).padStart(4, '0')}ms`, size, vars: { at: 4, ms }, page: strip });
}
module.exports = runs;
