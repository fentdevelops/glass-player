const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readInfo } = require('../../scan/info');
const { scoreFile } = require('../../scan/score');

// a real 8-bit mono WAV of the given length
function wav(seconds, rate = 8000) {
  const data = Buffer.alloc(Math.round(seconds * rate), 128);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate, 28); head.writeUInt16LE(1, 32); head.writeUInt16LE(8, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('a length under a second is unknown, not "0 seconds, too short for a song"', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-info-'));
  try {
    const empty = path.join(d, 'Real Title.wav'), real = path.join(d, 'Song.wav');
    fs.writeFileSync(empty, wav(0));
    fs.writeFileSync(real, wav(200));
    const a = await readInfo(empty), b = await readInfo(real);
    assert.strictEqual(a.duration, undefined, 'no duration for a file with no sound in it');
    assert.ok(b.duration > 199, 'a real length is kept, got ' + b.duration);
    const r = scoreFile({ ...a, title: 'Real Title', artist: 'Someone', albumNeighbours: 0, inMusicFolder: true });
    assert.ok(!/seconds/.test(r.reason || ''), 'never says 0 seconds, got ' + r.reason);
    const unknown = scoreFile({ path: empty, channels: a.channels, sampleRate: a.sampleRate, title: 'Real Title', artist: 'Someone', size: a.size, albumNeighbours: 0, inMusicFolder: true });
    assert.strictEqual(r.score, unknown.score, 'scored exactly as an unknown length');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
