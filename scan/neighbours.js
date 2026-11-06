// Album neighbours: for each info with an album tag, how many OTHER files share that album in the same folder.
// Sets `albumNeighbours` on each info (in place) and returns the same list. Pure, no I/O.

const path = require('path');

function countAlbumNeighbours(infos) {
  const keyOf = (i) => path.dirname(i.path).toLowerCase() + '\n' + i.album.toLowerCase();
  const counts = new Map();
  for (const i of infos) if (i.album) counts.set(keyOf(i), (counts.get(keyOf(i)) || 0) + 1);
  for (const i of infos) if (i.album) i.albumNeighbours = counts.get(keyOf(i)) - 1;
  return infos;
}

// True when p is inside folder (case-insensitive on Windows).
function isUnder(p, folder) {
  const norm = (x) => path.resolve(x).toLowerCase();
  const rel = path.relative(norm(folder), norm(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { countAlbumNeighbours, isUnder };
