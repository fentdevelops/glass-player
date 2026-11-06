'use strict';
// UI tests: starts Glassy off-screen and muted (no window ever shows, nothing steals focus), runs a test inside the page,
// and fails if the test finds a problem or the page reports any error.
//   node scripts/ui-test.js tests/ui/intro.js [--only <text>] [--shots <dir>]
// A test file exports one run or a list of them. A run is:
//   { name, page(T) }   page runs inside the app; its checks go through T (below)
//   size: '900x600'     window size, default 1240x800
//   profile: 'a'        runs naming the same profile share a data folder, like launching the app again. Default: its own.
//   songs: 1            how many generated test songs to open on launch, as if opened from Explorer
//   library(song)       returns a library.json to seed the data folder with before launch; song is a generated song's path
//   args: [...]         extra command line arguments
//   env()               returns extra environment variables for the run (GLASS_SCAN_ROOTS, say), just before it launches
// --shots saves a picture of each run's last moment. Every data folder is a fresh one under the system temp folder.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? null : argv.splice(i, 2)[1]; };
const only = opt('--only');
const shotsDir = opt('--shots');
const file = argv[0];
if (!file) { console.error('Usage: node scripts/ui-test.js <test file> [--only <text>] [--shots <dir>]'); process.exit(2); }
const all = [].concat(require(path.resolve(file)));
const runs = only ? all.filter((r) => r.name.includes(only)) : all;
if (!runs.length) { console.error('No runs match.'); process.exit(2); }
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-ui-'));
const electron = require('electron');   // from Node this is the path to the program
const appDir = path.join(__dirname, '..');

function testSong() {
  const sr = 22050, n = sr * 12, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 110 * (i / sr)) * 9000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const p = path.join(tmp, 'Test-Song.wav');
  if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.concat([h, data]));
  return p;
}

// what the page side of a test gets as T
const HELPERS = `{
  fails: [],
  ok(cond, what) { if (!cond) this.fails.push(what); return !!cond; },
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, what, ms = 8000) { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (fn()) return true; await this.wait(30); } this.fails.push('timed out waiting for: ' + what); return false; },
  $: (s) => document.querySelector(s),
  box(s) { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; },
  overlap: (a, b) => !!(a && b) && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b,
  inWindow: (a) => !!a && a.x >= 0 && a.y >= 0 && a.r <= innerWidth && a.b <= innerHeight,
}`;
const wrap = (run) => `(async () => { const T = ${HELPERS}; T.vars = ${JSON.stringify(run.vars || {})};
  try { await (${run.page})(T); } catch (e) { T.fails.push('the test threw: ' + (e && e.stack || e)); }
  return { fails: T.fails };
})()`;

function launch(run, i) {
  return new Promise((resolve) => {
    const data = path.join(tmp, 'data', run.profile || `run${i}`);
    fs.mkdirSync(data, { recursive: true });
    if (run.library) fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify(run.library(testSong())));
    const shot = shotsDir ? path.join(shotsDir, `${run.name.replace(/[^\w-]+/g, '_')}.png`) : path.join(tmp, `run${i}.png`);
    const env = { ...process.env, GLASS_USERDATA: data, GLASS_SHOT: shot, GLASS_SIZE: run.size || '1240x800', GLASS_SHOT_DELAY: '30', GLASS_EVAL: wrap(run) };
    if (run.env) Object.assign(env, run.env());
    delete env.GLASS_SCREEN;
    delete env.ELECTRON_RUN_AS_NODE;
    const args = ['.', ...Array.from({ length: run.songs || 0 }, testSong), ...(run.args || [])];
    const child = spawn(electron, args, { env, cwd: appDir });
    let log = '';
    child.stdout.on('data', (b) => { log += b; });
    child.stderr.on('data', (b) => { log += b; });
    const killer = setTimeout(() => { log += '\n[timed out]\n'; child.kill(); }, run.timeout || 120000);
    child.on('close', () => { clearTimeout(killer); resolve(log); });
  });
}

function judge(log) {
  const lines = log.split(/\r?\n/).map((l) => l.trim());
  const problems = [];
  const line = lines.find((l) => l.startsWith('[eval] {'));
  const r = line ? JSON.parse(line.slice(7)) : null;
  if (!r) problems.push('the app never reported back');
  else problems.push(...r.fails);
  problems.push(...lines.filter((l) => /^\[eval-error\]/.test(l) || /\[renderer\].*(Error|Uncaught|is not defined|Cannot read|is not a function)/.test(l)).map((l) => 'error from the page: ' + l));
  if (lines.includes('[timed out]')) problems.push('timed out');
  return problems;
}

(async () => {
  let failed = 0;
  for (const [i, run] of runs.entries()) {
    const t0 = Date.now();
    const problems = judge(await launch(run, i));
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (problems.length) { failed++; console.log(`FAIL  ${run.name} (${secs}s)`); for (const p of problems) console.log(`      - ${p}`); }
    else console.log(`pass  ${run.name} (${secs}s)`);
  }
  console.log(failed ? `\n${failed} of ${runs.length} runs failed.` : `\nAll ${runs.length} runs passed.`);
  process.exit(failed ? 1 : 0);
})();
