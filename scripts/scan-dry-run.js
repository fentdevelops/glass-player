// Read-only dry run of the song score. Usage:  npx electron scripts/scan-dry-run.js [--music=<folder>] <folder> [<folder> ...]
// (also works with plain `node`). Prints totals only: ticked/unticked, a score histogram, how many files hit each
// reason, and the extensions seen. It never prints a file or folder name, writes nothing, and only reads.

const path = require('path');
const { walk } = require('../scan/walk');
const { scoreFile, THRESHOLD } = require('../scan/score');
const { readInfo } = require('../scan/info');
const { countAlbumNeighbours, isUnder } = require('../scan/neighbours');

async function run(folders, musicFolders) {
  const files = [];
  const exts = {};
  const { scanned } = await walk(folders, {
    onBatch: (b) => { for (const p of b) { files.push(p); const e = path.extname(p).toLowerCase(); exts[e] = (exts[e] || 0) + 1; } },
  });

  const infos = [];
  let unreadable = 0;
  for (const p of files) {
    const info = await readInfo(p);
    if (!info.duration) unreadable++;
    if (musicFolders.some((m) => isUnder(p, m))) info.inMusicFolder = true;
    infos.push(info);
  }
  countAlbumNeighbours(infos);

  let ticked = 0;
  const hist = {};
  const reasons = {};
  for (const i of infos) {
    const r = scoreFile(i);
    if (r.ticked) ticked++;
    else reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const bucket = Math.floor(r.score / 10) * 10;
    hist[bucket] = (hist[bucket] || 0) + 1;
  }

  const out = [];
  out.push(`audio files found: ${scanned}`);
  out.push(`length unknown: ${unreadable}`);
  out.push(`threshold: ${THRESHOLD}`);
  out.push(`ticked: ${ticked}   unticked: ${infos.length - ticked}`);
  out.push('score histogram (bucket start: count)');
  for (const k of Object.keys(hist).map(Number).sort((a, b) => a - b)) out.push(`  ${String(k).padStart(4)}: ${hist[k]}`);
  out.push('reasons for unticked');
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) out.push(`  ${v}  ${k.replace(/^\d+ seconds/, 'N seconds')}`);
  out.push('extensions seen');
  for (const [k, v] of Object.entries(exts).sort((a, b) => b[1] - a[1])) out.push(`  ${k}: ${v}`);
  console.log(out.join('\n'));
}

const args = process.argv.slice(2);
const folders = args.filter((a) => !a.startsWith('--'));
// --music=<folder> marks files under that folder as sitting in the Music folder (repeatable)
const musicFolders = args.filter((a) => a.startsWith('--music=')).map((a) => a.slice(8));
if (!folders.length) {
  console.log('Give at least one folder.');
  process.exitCode = 1;
}
const done = (code) => {
  if (process.versions.electron) require('electron').app.exit(code);
  else process.exitCode = code;
};
const go = () => (folders.length ? run(folders, musicFolders).then(() => done(0), () => { console.log('dry run failed'); done(1); }) : done(1));
if (process.versions.electron) require('electron').app.whenReady().then(go);
else go();
