// Folder walker: finds audio files under some roots and hands them over in batches. Read-only, plain Node.
// Directory links are followed but each real folder is visited once, so a link back up the tree can't loop.

const fs = require('fs');
const path = require('path');

// Same audio list as main.js (AUDIO_EXT); video is not offered here.
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus'].map((e) => '.' + e));
// Half-finished downloads end in one of these, so they never match AUDIO_EXT anyway ("song.mp3.crdownload").
// Listed on purpose: a name like "song.crdownload.mp3" is not a download in progress, but "x.tmp" never is audio either.
const PARTIAL_EXT = new Set(['.crdownload', '.part', '.tmp', '.download']);

const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);

async function walk(roots, { onBatch, batchSize = 200, signal } = {}) {
  const seenDirs = new Set();
  let batch = [];
  let scanned = 0;
  const aborted = () => !!(signal && signal.aborted);

  async function flush() {
    if (!batch.length) return;
    const out = batch;
    batch = [];
    await onBatch(out);
  }

  async function visit(dir) {
    if (aborted()) return;
    let real;
    try { real = await fs.promises.realpath(dir); } catch { return; }
    if (seenDirs.has(key(real))) return;
    seenDirs.add(key(real));

    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }

    const subdirs = [];
    for (const e of entries) {
      if (aborted()) return;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory();
      let isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try {
          const st = await fs.promises.stat(full);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch { continue; }
      }
      if (isDir) { subdirs.push(full); continue; }
      if (!isFile) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (PARTIAL_EXT.has(ext) || !AUDIO_EXT.has(ext)) continue;
      batch.push(full);
      scanned++;
      if (batch.length >= batchSize) {
        await flush();
        if (aborted()) return;
      }
    }
    for (const d of subdirs) {
      await visit(d);
      if (aborted()) return;
    }
  }

  for (const r of roots) {
    await visit(r);
    if (aborted()) break;
  }
  if (!aborted()) await flush();
  return { scanned };
}

module.exports = { walk, AUDIO_EXT };
