const test = require('node:test');
const assert = require('node:assert');
const { scoreFile, THRESHOLD } = require('../../scan/score');

test('a 9 second ogg is not ticked and says so', () => {
  const r = scoreFile({ path: 'C:/x/ding.ogg', duration: 9 });
  assert(!r.ticked);
  assert.match(r.reason, /9 seconds/);
});

test('a fully tagged song is ticked, with no reason', () => {
  const r = scoreFile({ path: 'C:/m/a.mp3', duration: 200, title: 'T', artist: 'A', album: 'B' });
  assert(r.ticked);
  assert.strictEqual(r.reason, null);
  assert(r.score >= THRESHOLD);
});

test('an untagged full-length song is still ticked', () => {
  assert(scoreFile({ path: 'C:/m/untagged song.mp3', duration: 210 }).ticked);
});

test('a podcast-length file is not ticked', () => {
  const r = scoreFile({ path: 'C:/d/podcast.mp3', duration: 3700 });
  assert(!r.ticked);
  assert.match(r.reason, /over 30 minutes/);
});

test('a mono low-rate WhatsApp recording is a voice recording', () => {
  const r = scoreFile({ path: 'C:/d/WhatsApp Audio 2026.ogg', duration: 120, channels: 1, sampleRate: 16000 });
  assert(!r.ticked);
  assert.match(r.reason, /voice recording/);
});

test('a drum loop in a packs folder is a sample pack', () => {
  const r = scoreFile({ path: 'C:/d/Packs/808 kick loop 140bpm.wav', duration: 8 });
  assert(!r.ticked);
  assert.match(r.reason, /sample pack/);
});

test('a short album intro stays ticked', () => {
  const r = scoreFile({ path: 'C:/m/Album/x.mp3', duration: 80, title: 'Intro', artist: 'A', album: 'B', albumNeighbours: 9 });
  assert(r.ticked);
});

test('music inside a game folder is not ticked', () => {
  assert(!scoreFile({ path: 'C:/Downloads/MyGame/Audio/music1.ogg', duration: 95 }).ticked);
});

test('a tagged full-length song whose name has a junk word is still ticked', () => {
  assert(scoreFile({ path: 'C:/m/Hat Trick.mp3', duration: 190, title: 'Hat Trick', artist: 'A' }).ticked);
});

test('windows backslash paths work the same as slashes', () => {
  assert(!scoreFile({ path: 'C:\\Downloads\\MyGame\\Audio\\music1.ogg', duration: 95 }).ticked);
  assert(scoreFile({ path: 'C:\\m\\song.mp3', duration: 200 }).ticked);
});

test('a file with no duration is judged on its other signals', () => {
  assert(scoreFile({ path: 'C:/m/song.mp3', title: 'T', artist: 'A' }).ticked);
  assert(!scoreFile({ path: 'C:/m/notification.mp3' }).ticked);
});
