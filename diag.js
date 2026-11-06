'use strict';
// Glassy Dev only (main.js never loads this in the real app): a click recorder for "the whole window stops responding".
// It writes where each mouse press got to, so one reproduction shows the layer that loses it:
//   native-nc   Windows treated the press as window frame or drag area, so the page never got it
//   input       Chromium received the press for the page
//   page        the page's own listeners received it, with what's under the pointer
//   stall       the main process or the page was busy for that long
// Only element ids and class names and timings: no song names, no paths. The file stays in the Glassy Dev data folder.
const fs = require('fs');

const PAGE = `(() => {
  if (window.__diag) return; window.__diag = true;
  const say = (s) => console.log('[diag] ' + s);
  const name = (e) => !e ? 'none' : (e.tagName || '?').toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  const seen = (ev) => {
    const top = document.elementFromPoint(ev.clientX, ev.clientY);
    say('page ' + ev.type + ' at ' + Math.round(ev.clientX) + ',' + Math.round(ev.clientY) + ' target ' + name(ev.target) + ' top ' + name(top) + ' pe ' + (top ? getComputedStyle(top).pointerEvents : '-')
      + ' html[' + document.documentElement.className + '] body[' + document.body.className + '] intro ' + !!document.querySelector('#intro') + ' modal ' + document.querySelectorAll('.modal-root').length);
  };
  for (const t of ['pointerdown', 'click']) addEventListener(t, seen, true);
  let moved = 0;
  addEventListener('mousemove', (ev) => { const n = Date.now(); if (n - moved > 2000) { moved = n; seen(ev); } }, true);
  addEventListener('error', (e) => say('error ' + String(e.message).slice(0, 160)));
  addEventListener('unhandledrejection', (e) => say('rejection ' + String(e.reason && e.reason.message || e.reason).slice(0, 160)));
  let last = performance.now();
  const beat = () => { const n = performance.now(); if (n - last > 300) say('stall page ' + Math.round(n - last) + ' ms hidden ' + document.hidden); last = n; requestAnimationFrame(beat); };
  requestAnimationFrame(beat);
  say('recorder on');
})()`;

function attach(win, file) {
  const t0 = Date.now();
  const lines = [];
  const say = (s) => { lines.push(((Date.now() - t0) / 1000).toFixed(2) + ' ' + s); };
  const flush = setInterval(() => { if (lines.length) { try { fs.appendFileSync(file, lines.join('\n') + '\n'); } catch { /* best effort */ } lines.length = 0; } }, 500);
  flush.unref?.();
  say('--- start ' + new Date().toLocaleString());

  const wc = win.webContents;
  const inject = () => wc.executeJavaScript(PAGE).catch(() => {});
  wc.on('did-finish-load', inject);
  wc.on('console-message', (e) => { const m = e.message || ''; if (m.startsWith('[diag] ')) say(m.slice(7)); });
  wc.on('before-mouse-event', (_e, m) => { if (m.type === 'mouseDown') say('input mouseDown at ' + m.x + ',' + m.y); });
  wc.on('unresponsive', () => say('stall page reported unresponsive by Windows/Chromium'));
  wc.on('responsive', () => say('page responsive again'));
  wc.on('render-process-gone', (_e, d) => say('page process gone: ' + d.reason));
  win.on('focus', () => say('window focus'));
  win.on('blur', () => say('window blur'));
  win.on('close', () => say('window close'));
  if (process.platform === 'win32') {
    // presses Windows counts as frame or drag area; the plain client press is what "input" above shows
    win.hookWindowMessage(0x00A1, () => say('native-nc left press'));
    win.hookWindowMessage(0x00A4, () => say('native-nc right press'));
  }
  let last = Date.now();
  const lag = setInterval(() => { const n = Date.now(); if (n - last > 400) say('stall main ' + (n - last) + ' ms'); last = n; }, 100);
  lag.unref?.();
  win.on('closed', () => { clearInterval(lag); clearInterval(flush); try { fs.appendFileSync(file, lines.join('\n') + '\n'); } catch { /* best effort */ } });
}

module.exports = { attach };
