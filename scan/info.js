// Reads what scoreFile needs from one file. Read-only, plain Node (no Electron).
// Quick read first, with the same options as main.js readMeta; a full read (no cover art) only when that
// gave no duration.

const fs = require('fs');

let mm = null;

async function readInfo(p) {
  const info = { path: p };
  try { info.size = (await fs.promises.stat(p)).size; } catch { return info; }
  try {
    mm ??= await import('music-metadata');
    let r = await mm.parseFile(p, { duration: false, skipPostHeaders: true });
    if (!r.format.duration) {
      try { r = await mm.parseFile(p, { duration: true, skipCovers: true }); } catch { /* keep the quick read */ }
    }
    const { common, format } = r;
    if (common.title) info.title = common.title;
    if (common.artist) info.artist = common.artist;
    if (common.album) info.album = common.album;
    if (format.duration) info.duration = format.duration;
    if (format.numberOfChannels) info.channels = format.numberOfChannels;
    if (format.sampleRate) info.sampleRate = format.sampleRate;
  } catch { /* unreadable tags: scored on name, folder and size */ }
  return info;
}

module.exports = { readInfo };
