const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const { signInWithGoogle } = require('../../account/google');

const CLIENT = 'client-123.apps.googleusercontent.com';
const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
// a fake, unsigned id_token
const token = (over = {}) => `${seg({ alg: 'none' })}.${seg({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'sub-1', email: 'me@example.com', name: 'Me Myself', exp: Math.floor(Date.now() / 1000) + 600, ...over })}.`;
const get = (port, path, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers: host ? { Host: host } : {} }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});
const listening = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});
const okFetch = (idToken, calls = []) => async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ id_token: idToken, access_token: 'SECRET-ACCESS', refresh_token: 'SECRET-REFRESH' }) }; };
// "the browser": reads the authorize URL, then calls the listener with whatever the test wants
function browser(then) {
  const seen = {};
  const open = async (url) => {
    const u = new URL(url);
    Object.assign(seen, { url: u, port: Number(new URL(u.searchParams.get('redirect_uri')).port), state: u.searchParams.get('state') });
    setImmediate(() => { seen.done = then(seen).catch((e) => { seen.err = e; }); });
  };
  return { open, seen };
}

test('it binds 127.0.0.1 only, and the authorize URL has an S256 challenge and a state', async () => {
  let addr = null;
  const b = browser(async (s) => { addr = await get(s.port, `/?code=abc&state=${s.state}`); });
  const r = await signInWithGoogle({ clientId: CLIENT, clientSecret: 'shh', open: b.open, fetch: okFetch(token()) });
  assert.deepStrictEqual(r, { sub: 'sub-1', email: 'me@example.com', name: 'Me Myself' });
  await b.seen.done;
  assert.ok(!b.seen.err, String(b.seen.err));
  const u = b.seen.url;
  assert.ok(u.href.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'));
  assert.strictEqual(u.searchParams.get('response_type'), 'code');
  assert.strictEqual(u.searchParams.get('scope'), 'openid email profile');
  assert.strictEqual(u.searchParams.get('prompt'), 'select_account');
  assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
  assert.match(u.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(u.searchParams.get('state').length >= 16);
  assert.strictEqual(u.searchParams.get('redirect_uri'), `http://127.0.0.1:${b.seen.port}`);
  assert.strictEqual(addr.status, 200);
  assert.match(addr.body, /You can go back to Glassy/);
  assert.ok(!/<script/i.test(addr.body), 'no scripts on the page');
  assert.strictEqual(await listening(b.seen.port), false, 'the listener is closed after');
});

test('it binds 127.0.0.1 and nothing wider while waiting', async () => {
  let family = null;
  const b = browser(async (s) => {
    // the listener answers on 127.0.0.1; ::1 and the machine's other addresses are not bound
    family = await new Promise((resolve) => { const c = net.connect(s.port, '::1'); c.on('connect', () => { c.destroy(); resolve('open'); }); c.on('error', () => resolve('closed')); });
    await get(s.port, `/?error=access_denied&state=${s.state}`);
  });
  await signInWithGoogle({ clientId: CLIENT, open: b.open, fetch: okFetch(token()) });
  assert.strictEqual(family, 'closed');
});

test('the code is traded with the verifier, client id and secret; the verifier matches the challenge', async () => {
  const calls = [];
  const b = browser(async (s) => { await get(s.port, `/?code=the-code&state=${s.state}`); });
  await signInWithGoogle({ clientId: CLIENT, clientSecret: 'shh', open: b.open, fetch: okFetch(token(), calls) });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://oauth2.googleapis.com/token');
  const p = new URLSearchParams(calls[0].init.body);
  assert.strictEqual(p.get('grant_type'), 'authorization_code');
  assert.strictEqual(p.get('code'), 'the-code');
  assert.strictEqual(p.get('client_id'), CLIENT);
  assert.strictEqual(p.get('client_secret'), 'shh');
  assert.strictEqual(p.get('redirect_uri'), `http://127.0.0.1:${b.seen.port}`);
  const want = require('crypto').createHash('sha256').update(p.get('code_verifier')).digest('base64url');
  assert.strictEqual(b.seen.url.searchParams.get('code_challenge'), want);
});

test('a wrong state is refused and the listener keeps waiting; other paths are 404', async () => {
  const got = {};
  const b = browser(async (s) => {
    got.bad = await get(s.port, '/?code=evil&state=nope');
    got.path = await get(s.port, `/other?code=x&state=${s.state}`);
    got.host = await get(s.port, `/?code=x&state=${s.state}`, 'evil.example');
    got.still = await listening(s.port);
    got.good = await get(s.port, `/?code=abc&state=${s.state}`);
  });
  const calls = [];
  const r = await signInWithGoogle({ clientId: CLIENT, open: b.open, fetch: okFetch(token(), calls) });
  await b.seen.done;
  assert.ok(!b.seen.err, String(b.seen.err));
  assert.strictEqual(got.bad.status, 400);
  assert.ok(!/You can go back/.test(got.bad.body));
  assert.strictEqual(got.path.status, 404);
  assert.strictEqual(got.host.status, 404);
  assert.strictEqual(got.still, true);
  assert.strictEqual(got.good.status, 200);
  assert.strictEqual(calls.length, 1, 'only the right callback reached Google');
  assert.strictEqual(new URLSearchParams(calls[0].init.body).get('code'), 'abc');
  assert.strictEqual(r.sub, 'sub-1');
});

test('error=access_denied gives denied, and the listener closes', async () => {
  const b = browser(async (s) => { await get(s.port, `/?error=access_denied&state=${s.state}`); });
  const r = await signInWithGoogle({ clientId: CLIENT, open: b.open, fetch: okFetch(token()) });
  assert.deepStrictEqual(r, { error: 'denied' });
  assert.strictEqual(await listening(b.seen.port), false);
});

test('a wrong aud, issuer, expired token or failed exchange gives failed', async () => {
  const run = async (f) => {
    const b = browser(async (s) => { await get(s.port, `/?code=abc&state=${s.state}`); });
    return signInWithGoogle({ clientId: CLIENT, open: b.open, fetch: f });
  };
  assert.deepStrictEqual(await run(okFetch(token({ aud: 'someone-else' }))), { error: 'failed' });
  assert.deepStrictEqual(await run(okFetch(token({ iss: 'https://evil.example' }))), { error: 'failed' });
  assert.deepStrictEqual(await run(okFetch(token({ exp: Math.floor(Date.now() / 1000) - 5 }))), { error: 'failed' });
  assert.deepStrictEqual(await run(async () => ({ ok: false, json: async () => ({}) })), { error: 'failed' });
  assert.deepStrictEqual(await run(async () => { throw new Error('offline'); }), { error: 'failed' });
});

test('a timeout closes the listener', async () => {
  const b = browser(async () => {});
  const r = await signInWithGoogle({ clientId: CLIENT, open: b.open, fetch: okFetch(token()), timeoutMs: 150 });
  assert.deepStrictEqual(r, { error: 'timeout' });
  assert.strictEqual(await listening(b.seen.port), false);
});

test('a second call cancels the first', async () => {
  const first = browser(async () => {});
  const p1 = signInWithGoogle({ clientId: CLIENT, open: first.open, fetch: okFetch(token()) });
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(first.seen.port, 'the first is waiting');
  const second = browser(async (s) => { await get(s.port, `/?code=abc&state=${s.state}`); });
  const p2 = signInWithGoogle({ clientId: CLIENT, open: second.open, fetch: okFetch(token()) });
  assert.deepStrictEqual(await p1, { error: 'cancelled' });
  assert.strictEqual(await listening(first.seen.port), false);
  assert.strictEqual((await p2).sub, 'sub-1');
});

test('no token and no code appear in the result', async () => {
  const b = browser(async (s) => { await get(s.port, `/?code=THE-CODE&state=${s.state}`); });
  const r = await signInWithGoogle({ clientId: CLIENT, clientSecret: 'shh', open: b.open, fetch: okFetch(token()) });
  assert.deepStrictEqual(Object.keys(r).sort(), ['email', 'name', 'sub']);
  const s = JSON.stringify(r);
  for (const bad of ['SECRET-ACCESS', 'SECRET-REFRESH', 'THE-CODE', 'shh', 'alg']) assert.ok(!s.includes(bad), bad);
});

test('an open that throws gives failed and closes the listener', async () => {
  let port = 0;
  const r = await signInWithGoogle({ clientId: CLIENT, open: async (url) => { port = Number(new URL(new URL(url).searchParams.get('redirect_uri')).port); throw new Error('no browser'); }, fetch: okFetch(token()) });
  assert.deepStrictEqual(r, { error: 'failed' });
  assert.strictEqual(await listening(port), false);
});
