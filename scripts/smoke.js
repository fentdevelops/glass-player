'use strict';
// Smoke test: starts Glassy off-screen with a small generated test song and checks that it really runs. It looks for
// errors from the page, a song on screen, the lyrics panel and Settings opening, and saves a picture of the window.
// Used by the Mac build on GitHub, where nobody can look at the app: node scripts/smoke.js <out dir> [path to the app's program]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const out = path.resolve(process.argv[2] || 'smoke-out');
const app = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-smoke-'));

// a 40 second test song: a kick twice a second and a hi-hat tick eight times a second
const sr = 44100, n = sr * 40, data = Buffer.alloc(n * 2);
let last = 0, seed = 12345;
for (let i = 0; i < n; i++) {
  const t = i / sr, kt = t % 0.5, ht = (t + 0.0625) % 0.125;
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const w = seed / 2147483648 - 1, hp = w - last;
  last = w;
  const v = Math.sin(2 * Math.PI * 55 * kt) * Math.exp(-kt * 9) * 0.8 + hp * Math.exp(-ht * 70) * 0.18;
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2);
}
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
const song = path.join(tmp, 'Smoke-Test.wav');
fs.writeFileSync(song, Buffer.concat([h, data]));

const evalJs = `(async () => {
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  Settings.open();
  await w(700);
  const sections = [...document.querySelectorAll('.settings-sheet h4')].map((e) => e.textContent);
  const seeThrough = [...document.querySelectorAll('.settings-sheet b')].some((b) => b.textContent === 'See-through window');
  const box = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] : null; };
  return {
    platform: navigator.platform, macClass: document.body.classList.contains('mac'), title: document.title,
    song: document.querySelector('#nowTitle')?.textContent, lyricsOn: document.body.classList.contains('lyrics-on'),
    playing: !deck.paused, time: +deck.currentTime.toFixed(1), sections, seeThrough,
    gear: box('#btnSettings'), winButtonsShown: getComputedStyle(document.querySelector('.win-btns')).display !== 'none',
    bars: [...(document.querySelector('.row.current .eq')?.children || [])].map((i) => i.style.transform),
  };
})()`;

const env = {
  ...process.env, GLASS_USERDATA: path.join(tmp, 'data'), GLASS_SHOT: path.join(out, 'smoke.png'),
  GLASS_SIZE: '1240x800', GLASS_SHOT_DELAY: '6000', GLASS_PRE: 'Lyrics.toggle();', GLASS_EVAL: evalJs,
};
const cmd = app || path.join('node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
const child = spawn(cmd, app ? [song] : ['.', song], { env, shell: process.platform === 'win32' });
let log = '';
const take = (b) => { log += b; process.stdout.write(b); };
child.stdout.on('data', take);
child.stderr.on('data', take);
const killer = setTimeout(() => { log += '\n[timed out]\n'; child.kill(); }, 90000);
child.on('close', (code) => {
  clearTimeout(killer);
  fs.writeFileSync(path.join(out, 'smoke-log.txt'), log);
  const line = log.split('\n').map((l) => l.trim()).find((l) => l.startsWith('[eval] {'));
  const errors = log.split('\n').filter((l) => /\[renderer\].*(Error|is not defined|Cannot read|is not a function)/.test(l) || /\[eval-error\]/.test(l));
  const r = line ? JSON.parse(line.slice(7)) : null;
  const problems = [];
  if (!r) problems.push('the app never reported back');
  if (errors.length) problems.push(`errors from the page: ${errors.join(' | ')}`);
  if (r && !r.song) problems.push('no song on screen');
  if (r && !r.lyricsOn) problems.push('lyrics panel did not open');
  if (r && !r.sections.length) problems.push('Settings did not open');
  if (!fs.existsSync(env.GLASS_SHOT)) problems.push('no picture of the window');
  if (r && process.platform === 'darwin') {
    if (!r.macClass) problems.push('the page did not notice it is on a Mac');
    if (r.winButtonsShown) problems.push('Windows window buttons are showing');
    if (r.seeThrough) problems.push('a Windows-only setting is showing');
  }
  if (r && !(r.time > 0)) console.log('NOTE: the song did not move (time 0). This machine may have no sound device: look at this one.');
  console.log('\nResult:', JSON.stringify(r, null, 2));
  if (problems.length) { console.error('SMOKE TEST FAILED:\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('Smoke test passed, exit code', code);
});
