const test = require('node:test');
const assert = require('node:assert');
const { countAlbumNeighbours, isUnder } = require('../../scan/neighbours');

test('neighbours counts other files with the same album in the same folder', () => {
  const infos = countAlbumNeighbours([
    { path: 'C:/m/a/1.mp3', album: 'X' }, { path: 'C:/m/a/2.mp3', album: 'x' }, { path: 'C:/m/b/3.mp3', album: 'X' }, { path: 'C:/m/a/4.mp3' },
  ]);
  assert.deepStrictEqual(infos.map((i) => i.albumNeighbours), [1, 1, 0, undefined]);
});

test('isUnder tells inside from outside', () => {
  assert(isUnder('C:/m/a/1.mp3', 'C:/m'));
  assert(!isUnder('C:/mm/a.mp3', 'C:/m'));
  assert(!isUnder('C:/m', 'C:/m'));
});
