const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { walk } = require('../../scan/walk');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-walk-'));
}
function touch(dir, name) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'x');
}
async function collect(roots, opts = {}) {
  const got = [];
  const res = await walk(roots, { ...opts, onBatch: (b) => got.push(...b) });
  return { got, res };
}
const names = (list) => list.map((p) => path.basename(p)).sort();

test('only audio files are returned, and .crdownload, .part, .tmp and .download are skipped', async () => {
  const d = scratch();
  try {
    for (const n of ['a.mp3', 'b.FLAC', 'c.ogg', 'd.opus', 'v.mp4', 'notes.txt', 'e.mp3.crdownload', 'f.part', 'g.tmp', 'h.download', 'sub/i.m4a']) touch(d, n);
    const { got, res } = await collect([d]);
    assert.deepStrictEqual(names(got), ['a.mp3', 'b.FLAC', 'c.ogg', 'd.opus', 'i.m4a']);
    assert.strictEqual(res.scanned, 5);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a directory link that loops ends the walk and each real file appears once', async () => {
  const d = scratch();
  try {
    touch(d, 'a/one.mp3');
    fs.symlinkSync(d, path.join(d, 'a', 'back'), 'junction');
    fs.symlinkSync(path.join(d, 'a'), path.join(d, 'alias'), 'junction');
    const { got } = await collect([d, d]);
    assert.deepStrictEqual(names(got), ['one.mp3']);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('an unreadable directory is skipped and the walk continues', async () => {
  const d = scratch();
  try {
    touch(d, 'ok.mp3');
    const gone = path.join(d, 'nope');
    const { got, res } = await collect([gone, d]);
    assert.deepStrictEqual(names(got), ['ok.mp3']);
    assert.strictEqual(res.scanned, 1);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('batches are at most batchSize, and an aborted signal stops the walk', async () => {
  const d = scratch();
  try {
    for (let i = 0; i < 25; i++) touch(d, `s${i}.mp3`);
    const sizes = [];
    const res = await walk([d], { batchSize: 10, onBatch: (b) => sizes.push(b.length) });
    assert.deepStrictEqual(sizes, [10, 10, 5]);
    assert.strictEqual(res.scanned, 25);

    const ctl = new AbortController();
    let seen = 0;
    await walk([d], { batchSize: 10, signal: ctl.signal, onBatch: (b) => { seen += b.length; ctl.abort(); } });
    assert.strictEqual(seen, 10);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
