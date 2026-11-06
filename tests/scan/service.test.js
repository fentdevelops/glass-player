const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createScanService } = require('../../scan/service');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-svc-'));
}
function touch(dir, name) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'x');
  return path.join(dir, name);
}
const tagged = (extra = {}) => async (p) => ({ path: p, size: 4e6, duration: 200, title: path.parse(p).name, artist: 'A', album: 'B', channels: 2, sampleRate: 44100, ...extra });

function make(root, state, opts = {}) {
  const sent = [];
  const svc = createScanService({
    roots: [root],
    musicRoot: root,
    statePath: path.join(state, 'scan-state.json'),
    send: (channel, msg) => sent.push({ channel, msg }),
    readInfo: tagged(),
    resolve: (paths) => paths.map((p) => ({ path: p, url: 'file:///' + p, name: path.parse(p).name })),
    toUrl: (p) => 'file:///' + p,
    ...opts,
  });
  return { svc, sent };
}
const items = (sent) => sent.flatMap((s) => s.msg.items);
const lastMsg = (sent) => sent[sent.length - 1].msg;

test('progress arrives in batches, and the event loop stays free during 5000 files', async () => {
  const d = scratch(), st = scratch();
  try {
    for (let f = 0; f < 50; f++) { fs.mkdirSync(path.join(d, `f${f}`)); for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(d, `f${f}`, `s${i}.mp3`), 'x'); }
    const { svc, sent } = make(d, st);
    let gap = 0, last = Date.now();
    const timer = setInterval(() => { const n = Date.now(); gap = Math.max(gap, n - last); last = n; }, 10);
    await svc.start();
    clearInterval(timer);
    assert.ok(sent.length > 1, 'more than one progress message');
    assert.ok(sent.length < 200, `throttled, got ${sent.length}`);
    assert.strictEqual(items(sent).length, 5000);
    assert.strictEqual(lastMsg(sent).done, true);
    assert.strictEqual(lastMsg(sent).scanned, 5000);
    assert.ok(gap < 200, `timer gap ${gap} ms`);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('a file whose metadata read throws is still scored from its name, and the scan finishes', async () => {
  const d = scratch(), st = scratch();
  try {
    touch(d, 'good.mp3'); touch(d, 'notification sound.mp3');
    const { svc, sent } = make(d, st, { readInfo: async (p) => { if (p.includes('notification')) throw new Error('boom'); return tagged()(p); } });
    await svc.start();
    const got = items(sent);
    assert.strictEqual(got.length, 2);
    const bad = got.find((i) => i.path.includes('notification'));
    assert.strictEqual(bad.ticked, false);
    assert.ok(bad.reason);
    assert.strictEqual(lastMsg(sent).done, true);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('a missing root is skipped; two missing roots finish with found 0', async () => {
  const d = scratch(), st = scratch();
  try {
    touch(d, 'a.mp3');
    const gone = path.join(d, 'nope');
    const one = make(d, st, { roots: [gone, d] });
    await one.svc.start();
    assert.strictEqual(items(one.sent).length, 1);
    const two = make(d, scratch(), { roots: [gone, path.join(d, 'nope2')] });
    await two.svc.start();
    assert.strictEqual(lastMsg(two.sent).done, true);
    assert.strictEqual(lastMsg(two.sent).found, 0);
    assert.strictEqual(lastMsg(two.sent).scanned, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('albumNeighbours counts tagged files sharing an album in one folder', async () => {
  const d = scratch(), st = scratch();
  try {
    const names = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3'].map((n) => touch(path.join(d, 'Album'), n));
    const lone = touch(path.join(d, 'Other'), 'lone.mp3');
    const seen = [];
    const { svc } = make(d, st, { readInfo: async (p) => ({ path: p, size: 4e6, duration: 60, title: 't', artist: 'a', album: 'Same', channels: 2, sampleRate: 44100 }), onScore: (i) => seen.push(i) });
    await svc.start();
    for (const n of names) assert.strictEqual(seen.find((i) => i.path === n).albumNeighbours, 3);
    assert.strictEqual(seen.find((i) => i.path === lone).albumNeighbours, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('a path in skipped or seen is not offered again', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3'), b = touch(d, 'b.mp3'), c = touch(d, 'c.mp3');
    fs.writeFileSync(path.join(st, 'scan-state.json'), JSON.stringify({ seen: { [a]: true }, skipped: { [b]: true }, watching: false, ran: true }));
    const { svc, sent } = make(d, st);
    await svc.start();
    assert.deepStrictEqual(items(sent).map((i) => i.path), [c]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('add() records the skipped paths, marks ran and turns watching on', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3'), b = touch(d, 'b.mp3');
    const { svc } = make(d, st);
    assert.deepStrictEqual(svc.status(), { ran: false, watching: false, scanning: false });
    await svc.start();
    const tracks = svc.add([a], [b]);
    assert.deepStrictEqual(tracks.map((t) => t.path), [a]);
    assert.strictEqual(tracks[0].url, 'file:///' + a);
    const saved = JSON.parse(fs.readFileSync(path.join(st, 'scan-state.json'), 'utf8'));
    assert.deepStrictEqual(saved, { seen: { [a]: true }, skipped: { [b]: true }, watching: true, ran: true });
    assert.deepStrictEqual(svc.status(), { ran: true, watching: true, scanning: false });
    assert.deepStrictEqual(fs.readdirSync(st), ['scan-state.json'], 'no temp file left behind');
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('add() only accepts paths the scan itself offered', async () => {
  const d = scratch(), st = scratch(), other = scratch();
  try {
    const a = touch(d, 'a.mp3');
    const stranger = touch(other, 'x.mp3');
    const { svc } = make(d, st);
    await svc.start();
    assert.deepStrictEqual(svc.add([stranger, 42, null], [stranger]), []);
    const saved = JSON.parse(fs.readFileSync(path.join(st, 'scan-state.json'), 'utf8'));
    assert.deepStrictEqual(saved.skipped, {});
    assert.deepStrictEqual(svc.add(a, 'nope'), [], 'non-arrays are ignored');
  } finally { for (const x of [d, st, other]) fs.rmSync(x, { recursive: true, force: true }); }
});

test('stop() ends the scan and no more progress is sent', async () => {
  const d = scratch(), st = scratch();
  try {
    for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(d, `s${i}.mp3`), 'x');
    const slow = async (p) => { await new Promise((r) => setTimeout(r, 2)); return tagged()(p); };
    const { svc, sent } = make(d, st, { readInfo: slow });
    const run = svc.start();
    await new Promise((r) => setTimeout(r, 150));
    svc.stop();
    await run;
    const n = sent.length;
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(sent.length, n);
    assert.ok(items(sent).length < 3000, 'stopped before the end');
    assert.ok(!sent.some((s) => s.msg.done), 'no done message after stop');
    assert.strictEqual(svc.status().scanning, false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('findFromSettings() forgets earlier skips and scans again, offering seen songs too', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3'), b = touch(d, 'b.mp3');
    fs.writeFileSync(path.join(st, 'scan-state.json'), JSON.stringify({ seen: { [a]: true }, skipped: { [b]: true }, watching: false, ran: true }));
    const { svc, sent } = make(d, st);
    await svc.findFromSettings();
    assert.deepStrictEqual(items(sent).map((i) => i.path).sort(), [a, b].sort(), 'seen songs are offered again; the window hides those in the library');
    assert.strictEqual(svc.status().watching, false, 'watching only turns on when songs are added');
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

const album = (n, dir) => Array.from({ length: n }, (_, i) => touch(dir, `t${String(i).padStart(2, '0')}.mp3`));
const sameAlbum = async (p) => ({ path: p, size: 4e6, duration: 200, title: path.parse(p).name, artist: 'A', album: 'Same', channels: 2, sampleRate: 44100 });
const stateFile = (st) => path.join(st, 'scan-state.json');
const clean = (...dirs) => dirs.forEach((x) => fs.rmSync(x, { recursive: true, force: true }));

test('an album that straddles a batch boundary still counts every neighbour', async () => {
  const d = scratch(), st = scratch();
  try {
    // 7 loose files first, so the 12-track album starts mid-batch (batches of 5)
    for (let i = 0; i < 7; i++) touch(path.join(d, 'a-loose'), `l${i}.mp3`);
    const tracks = album(12, path.join(d, 'z-album'));
    const seen = [];
    const { svc } = make(d, st, { batchSize: 5, readInfo: sameAlbum, onScore: (i) => seen.push(i) });
    await svc.start();
    for (const t of tracks) assert.strictEqual(seen.find((i) => i.path === t).albumNeighbours, 11);
  } finally { clean(d, st); }
});

test('a rescan counts already-seen siblings as neighbours but only offers the fresh ones', async () => {
  const d = scratch(), st = scratch();
  try {
    const tracks = album(12, d);
    const seenSet = {};
    tracks.slice(0, 6).forEach((t) => { seenSet[t] = true; });
    fs.writeFileSync(stateFile(st), JSON.stringify({ seen: seenSet, skipped: {}, watching: true, ran: true }));
    const scored = [];
    const { svc, sent } = make(d, st, { readInfo: sameAlbum, onScore: (i) => scored.push(i) });
    await svc.start();
    assert.deepStrictEqual(items(sent).map((i) => i.path), tracks.slice(6));
    for (const i of scored) assert.strictEqual(i.albumNeighbours, 11);
  } finally { clean(d, st); }
});

test('a folder where every file is already seen or skipped is not read at all', async () => {
  const d = scratch(), st = scratch();
  try {
    const old = album(3, path.join(d, 'old'));
    const fresh = album(2, path.join(d, 'new'));
    fs.writeFileSync(stateFile(st), JSON.stringify({ seen: { [old[0]]: true, [old[1]]: true }, skipped: { [old[2]]: true }, watching: true, ran: true }));
    const reads = [];
    const { svc } = make(d, st, { readInfo: async (p) => { reads.push(p); return tagged()(p); } });
    await svc.start();
    assert.deepStrictEqual(reads.sort(), fresh.slice().sort());
  } finally { clean(d, st); }
});

test('progress counts files during listing, and stop() ends listing promptly', async () => {
  const d = scratch(), st = scratch();
  try {
    for (let f = 0; f < 20; f++) for (let i = 0; i < 50; i++) touch(path.join(d, `f${f}`), `s${i}.mp3`);
    const full = make(d, scratch());
    await full.svc.start();
    assert.ok(full.sent.some((s) => !s.msg.done && s.msg.items.length === 0 && s.msg.scanned > 0), 'a listing-time message');
    const { svc, sent } = make(d, st, { batchSize: 10 });
    const run = svc.start();
    svc.stop();
    await run;
    assert.strictEqual(sent.length, 0);
  } finally { clean(d, st); }
});

test('start() during a scan returns the running scan, and only one scan runs', async () => {
  const d = scratch(), st = scratch();
  try {
    album(30, d);
    let reads = 0;
    const { svc, sent } = make(d, st, { readInfo: async (p) => { reads++; return tagged()(p); } });
    const a = svc.start(), b = svc.start();
    assert.strictEqual(a, b);
    await a;
    assert.strictEqual(reads, 30);
    assert.strictEqual(sent.filter((s) => s.msg.done).length, 1);
  } finally { clean(d, st); }
});

test('findFromSettings() during a scan ends it, forgets skips, and runs one fresh scan', async () => {
  const d = scratch(), st = scratch();
  try {
    const [a, b] = album(2, d);
    fs.writeFileSync(stateFile(st), JSON.stringify({ seen: {}, skipped: { [b]: true }, watching: false, ran: true }));
    const slow = async (p) => { await new Promise((r) => setTimeout(r, 40)); return tagged()(p); };
    const { svc, sent } = make(d, st, { readInfo: slow });
    const first = svc.start();
    await new Promise((r) => setTimeout(r, 20));
    await svc.findFromSettings();
    await first;
    const dones = sent.filter((s) => s.msg.done);
    assert.strictEqual(dones.length, 1, 'the ended scan sent no done');
    assert.deepStrictEqual(items(sent).map((i) => i.path).sort(), [a, b]);
    assert.strictEqual(svc.status().scanning, false);
  } finally { clean(d, st); }
});

test('a scan that fails still ends with done and error, and start() does not reject', async () => {
  const d = scratch(), st = scratch();
  try {
    const { svc, sent } = make(d, st, { roots: null });
    await svc.start();
    assert.deepStrictEqual(lastMsg(sent), { scanned: 0, found: 0, done: true, items: [], looking: '', error: true });
    assert.strictEqual(svc.status().scanning, false);
  } finally { clean(d, st); }
});

test('one file that cannot be turned into an item does not fail the scan', async () => {
  const d = scratch(), st = scratch();
  try {
    const [a, b, c] = album(3, d);
    const { svc, sent } = make(d, st, { toUrl: (p) => { if (p === b) throw new Error('bad'); return 'file:///' + p; } });
    await svc.start();
    assert.deepStrictEqual(items(sent).map((i) => i.path), [a, c]);
    assert.strictEqual(lastMsg(sent).done, true);
    assert.ok(!lastMsg(sent).error);
  } finally { clean(d, st); }
});

test('a corrupt scan-state.json is read as empty, odd shapes and values included', async () => {
  const d = scratch();
  try {
    const t = touch(d, 'a.mp3');
    const cases = ['not json', 'null', '[1,2]', '{"seen":"abc","skipped":["x"],"watching":1}', JSON.stringify({ seen: { [t]: 1 }, skipped: { [t]: 'yes' } }), JSON.stringify({ seen: [t] })];
    for (const text of cases) {
      const st = scratch();
      fs.writeFileSync(stateFile(st), text);
      const { svc, sent } = make(d, st);
      await svc.start();
      assert.deepStrictEqual(items(sent).map((i) => i.path), [t], text);
      clean(st);
    }
  } finally { clean(d); }
});

test('a failed state write does not throw out of add() or findFromSettings()', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3');
    fs.writeFileSync(path.join(st, 'blocker'), 'x');   // a file where the state folder should be
    const { svc } = make(d, st, { statePath: path.join(st, 'blocker', 'scan-state.json') });
    await svc.start();
    assert.deepStrictEqual(svc.add([a], []).map((t) => t.path), [a]);
    assert.deepStrictEqual(svc.status(), { ran: true, watching: true, scanning: false });
    await assert.doesNotReject(svc.findFromSettings());
  } finally { clean(d, st); }
});

test('progress says where it is looking, with the root and the folders under it, and done clears it', async () => {
  const d = scratch(), st = scratch();
  try {
    for (let f = 0; f < 6; f++) for (let i = 0; i < 3; i++) touch(path.join(d, 'Artist', `Album ${f}`), `s${i}.mp3`);
    touch(path.join(d, 'A', 'B', 'C', 'D', 'E'), 'deep.mp3');
    const slow = async (p) => { await new Promise((r) => setTimeout(r, 40)); return tagged()(p); };
    const { svc, sent } = make(d, st, { readInfo: slow, batchSize: 2 });
    await svc.start();
    const where = sent.map((s) => s.msg.looking).filter(Boolean);
    const root = path.basename(d);
    assert.ok(where.length >= 2, 'sent along the way, got ' + where.length);
    assert.ok(where.every((w) => w.startsWith(root)), 'starts with the root\'s name: ' + where[0]);
    assert.ok(where.some((w) => w.startsWith(root + ' › Artist › Album ')), 'the root and the folders under it: ' + [...new Set(where)].join(' | '));
    assert.ok(!where.some((w) => w.includes(d)), 'never the full path');
    assert.ok(where.every((w) => w.split(' › ').length <= 4), 'at most three folders under the root');
    assert.ok(sent.slice(0, -1).some((s) => s.msg.done === false && s.msg.looking), 'sent in progress messages');
    assert.strictEqual(lastMsg(sent).done, true);
    assert.strictEqual(lastMsg(sent).looking, '', 'done clears it');
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});

test('findFromSettings() offers songs already seen (removed from the library), without clearing seen', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3'), b = touch(d, 'b.mp3');
    fs.writeFileSync(stateFile(st), JSON.stringify({ seen: { [a]: true, [b]: true }, skipped: {}, watching: false, ran: true }));
    const { svc, sent } = make(d, st);
    await svc.findFromSettings();
    assert.deepStrictEqual(items(sent).map((i) => i.path).sort(), [a, b].sort());
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(stateFile(st), 'utf8')).seen).sort(), [a, b].sort());
    const again = make(d, st);
    await again.svc.start();
    assert.strictEqual(items(again.sent).length, 0, 'a plain scan still skips seen songs');
  } finally { clean(d, st); }
});
