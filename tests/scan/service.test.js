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
    for (let i = 0; i < 5000; i++) fs.writeFileSync(path.join(d, `s${i}.mp3`), 'x');
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

test('findFromSettings() forgets earlier skips, keeps added songs, and scans again', async () => {
  const d = scratch(), st = scratch();
  try {
    const a = touch(d, 'a.mp3'), b = touch(d, 'b.mp3');
    fs.writeFileSync(path.join(st, 'scan-state.json'), JSON.stringify({ seen: { [a]: true }, skipped: { [b]: true }, watching: false, ran: true }));
    const { svc, sent } = make(d, st);
    await svc.findFromSettings();
    assert.deepStrictEqual(items(sent).map((i) => i.path), [b]);
    assert.strictEqual(svc.status().watching, false, 'watching only turns on when songs are added');
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(st, { recursive: true, force: true }); }
});
