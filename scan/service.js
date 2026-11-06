// The first-launch scan, in the main process. Plain Node, no Electron: main.js passes in what it needs.
// Walks the roots, reads each file's tags, scores it and streams the results to the window.
// Read-only on songs. The only file written is the scan state (atomically).

const fs = require('fs');
const path = require('path');
const { walk } = require('./walk');
const { scoreFile } = require('./score');
const { countAlbumNeighbours, isUnder } = require('./neighbours');
const { readInfo: defaultReadInfo } = require('./info');

const PROGRESS_EVERY_MS = 100;   // at most 10 progress messages a second
const READ_AT_ONCE = 8;
const MAX_ADD = 100000;

const yieldToLoop = () => new Promise((r) => setImmediate(r));
const isPathList = (v) => Array.isArray(v) && v.length <= MAX_ADD && v.every((p) => typeof p === 'string');

function createScanService({ roots, musicRoot, statePath, send, resolve, toUrl, readInfo = defaultReadInfo, onScore }) {
  let state = { seen: {}, skipped: {}, watching: false, ran: false };
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = { seen: { ...s.seen }, skipped: { ...s.skipped }, watching: !!s.watching, ran: !!s.ran };
  } catch { /* first run, or an unreadable file: start fresh */ }

  let ctrl = null;           // AbortController of the running scan
  let offered = new Set();   // paths this scan has shown the window; add() accepts only these

  function save() {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, statePath);
  }

  async function infoFor(p) {
    try { return { ...(await readInfo(p)), path: p }; } catch { return { path: p }; }
  }

  async function start() {
    if (ctrl) return;
    const mine = (ctrl = new AbortController());
    offered = new Set();
    const live = () => ctrl === mine && !mine.signal.aborted;
    let scanned = 0, found = 0, pending = [], lastSent = 0;

    const flush = (done) => {
      if (!live()) return;
      send('scan:progress', { scanned, found, done, items: pending });
      pending = [];
      lastSent = Date.now();
    };

    async function onBatch(paths) {
      const fresh = paths.filter((p) => !state.seen[p] && !state.skipped[p]);
      scanned += paths.length - fresh.length;
      const infos = [];
      for (let i = 0; i < fresh.length && live(); i += READ_AT_ONCE) {
        infos.push(...await Promise.all(fresh.slice(i, i + READ_AT_ONCE).map(infoFor)));
        await yieldToLoop();
      }
      if (!live()) return;
      countAlbumNeighbours(infos);
      for (const info of infos) {
        if (onScore) onScore(info);
        const { ticked, reason } = scoreFile({
          ...info,
          albumNeighbours: info.albumNeighbours || 0,
          inMusicFolder: !!musicRoot && isUnder(info.path, musicRoot),
        });
        scanned++;
        if (ticked) found++;
        offered.add(info.path);
        pending.push({
          path: info.path, title: info.title, artist: info.artist, album: info.album, duration: info.duration,
          ticked, reason, folder: path.dirname(info.path), url: toUrl(info.path),
        });
      }
      if (Date.now() - lastSent >= PROGRESS_EVERY_MS) flush(false);
    }

    try {
      await walk(roots, { onBatch, signal: mine.signal });
      flush(true);
    } finally {
      if (ctrl === mine) ctrl = null;
    }
  }

  function stop() {
    if (ctrl) ctrl.abort();
    ctrl = null;
  }

  // paths: ticked songs to add; skipped: the ones left unticked. Both must be files this scan offered.
  // Returns the tracks for the renderer's addTracks.
  function add(paths, skipped) {
    const take = (list) => (isPathList(list) ? [...new Set(list)].filter((p) => offered.has(p)) : []);
    const added = take(paths);
    for (const p of take(skipped)) state.skipped[p] = true;
    for (const p of added) { state.seen[p] = true; delete state.skipped[p]; }
    state.ran = true;
    state.watching = true;
    save();
    return resolve(added);
  }

  // "Find songs on this PC": the user is asking again, so earlier "no"s are forgotten. Songs already added stay added.
  function findFromSettings() {
    state.skipped = {};
    save();
    return start();
  }

  const status = () => ({ ran: state.ran, watching: state.watching, scanning: !!ctrl });

  return { start, stop, add, findFromSettings, status };
}

module.exports = { createScanService };
