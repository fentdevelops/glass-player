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
const WHERE_FOLDERS = 3;       // 'Music › Artist › Album': the root's name and at most this many folders under it
const MAX_ADD = 100000;

const yieldToLoop = () => new Promise((r) => setImmediate(r));
const isPathList = (v) => Array.isArray(v) && v.length <= MAX_ADD && v.every((p) => typeof p === 'string');

// Anything that isn't a plain object of `true` values counts as empty.
function cleanSet(v) {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) if (v[k] === true) out[k] = true;
  return out;
}

const baseOf = (p) => path.basename(p) || p;
const folderKey = (p) => path.dirname(p).toLowerCase();

function createScanService({ roots, musicRoot, statePath, send, resolve, toUrl, readInfo = defaultReadInfo, onScore, batchSize = 200 }) {
  let state = { seen: {}, skipped: {}, watching: false, ran: false };
  try {
    const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state = { seen: cleanSet(s && s.seen), skipped: cleanSet(s && s.skipped), watching: !!(s && s.watching), ran: !!(s && s.ran) };
  } catch { /* first run, or an unreadable file: start fresh */ }

  let run = null;            // { ctrl, promise } of the running scan
  let offered = new Set();   // paths this scan has shown the window; add() accepts only these

  // A failed write must not break the app: state stays right in memory and is saved again next time.
  function save() {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      const tmp = statePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, statePath);
    } catch { /* retry on the next save */ }
  }

  // where a file is, for the window's 'Looking in' line: the root's name and the folders under it, not the full path
  function whereIs(p) {
    const dir = path.dirname(p);
    for (const r of roots) {
      const rel = path.relative(r, dir);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      return [baseOf(r), ...rel.split(path.sep).filter(Boolean).slice(-WHERE_FOLDERS)].join(' › ');
    }
    return baseOf(dir);
  }

  async function infoFor(p) {
    try { return { ...(await readInfo(p)), path: p }; } catch { return { path: p }; }
  }

  async function scan(mine, ignoreSeen) {
    offered = new Set();
    const live = () => run && run.ctrl === mine && !mine.signal.aborted;
    let scanned = 0, found = 0, pending = [], lastSent = 0, looking = '';

    const flush = (done, error) => {
      if (!live()) return;
      const msg = { scanned, found, done, items: pending, looking: done ? '' : looking };
      if (error) msg.error = true;
      send('scan:progress', msg);
      pending = [];
      lastSent = Date.now();
    };
    const maybeFlush = () => { if (Date.now() - lastSent >= PROGRESS_EVERY_MS) flush(false); };

    try {
      // 1. list every audio file (progress shows the count growing)
      const folders = new Map();   // folder -> all its audio files
      await walk(roots, {
        batchSize,
        signal: mine.signal,
        onBatch: async (paths) => {
          for (const p of paths) {
            const k = folderKey(p);
            if (!folders.has(k)) folders.set(k, []);
            folders.get(k).push(p);
          }
          scanned += paths.length;
          if (paths.length) looking = whereIs(paths[paths.length - 1]);
          maybeFlush();
          await yieldToLoop();
        },
      });

      // 2. folder by folder: read, count album neighbours among every file in the folder, offer only the fresh ones
      for (const files of folders.values()) {
        if (!live()) break;
        const isFresh = (p) => (ignoreSeen || !state.seen[p]) && !state.skipped[p];
        if (!files.some(isFresh)) continue;
        looking = whereIs(files[0]);
        const infos = [];
        for (let i = 0; i < files.length && live(); i += READ_AT_ONCE) {
          infos.push(...await Promise.all(files.slice(i, i + READ_AT_ONCE).map(infoFor)));
          await yieldToLoop();
        }
        if (!live()) break;
        countAlbumNeighbours(infos);
        for (const info of infos.filter((i) => isFresh(i.path))) {
          try {
            if (onScore) onScore(info);
            const { ticked, reason } = scoreFile({
              ...info,
              albumNeighbours: info.albumNeighbours || 0,
              inMusicFolder: !!musicRoot && isUnder(info.path, musicRoot),
            });
            const item = {
              path: info.path, title: info.title, artist: info.artist, album: info.album, duration: info.duration,
              ticked, reason, folder: path.dirname(info.path), url: toUrl(info.path),
            };
            pending.push(item);
            offered.add(info.path);
            if (ticked) found++;
          } catch { /* one odd file doesn't stop the scan */ }
        }
        maybeFlush();
      }
      flush(true);
    } catch {
      flush(true, true);
    } finally {
      if (run && run.ctrl === mine) run = null;
    }
  }

  // A scan already running is returned as it is.
  function start(ignoreSeen) {
    if (run) return run.promise;
    const mine = new AbortController();
    run = { ctrl: mine, promise: null };
    run.promise = scan(mine, ignoreSeen === true);
    return run.promise;
  }

  function stop() {
    if (run) run.ctrl.abort();
    run = null;
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

  // "Find songs on this PC": the user is asking again, so a running scan is ended and earlier "no"s are forgotten.
  // Songs already added stay added.
  async function findFromSettings() {
    while (run) {
      const old = run;
      old.ctrl.abort();
      run = null;
      await old.promise;
    }
    state.skipped = {};
    save();
    return start(true);   // this run only: "seen" itself is kept
  }

  const status = () => ({ ran: state.ran, watching: state.watching, scanning: !!run });

  return { start, stop, add, findFromSettings, status };
}

module.exports = { createScanService };
