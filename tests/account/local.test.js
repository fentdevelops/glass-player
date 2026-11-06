const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAccountStore } = require('../../account/local');
const Username = require('../../account/username');

const PW = 'correct horse battery staple';
function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassy-account-'));
  const file = path.join(dir, 'local-account.json');
  return { dir, file, acct: createAccountStore(file) };
}

test('the account file never contains the password', async () => {
  const { file, acct } = store();
  const r = await acct.create('Me@Example.com', PW, 'fent');
  assert.strictEqual(r.ok, true);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PW), 'plain password found in the file');
  assert.ok(!raw.includes('battery'), 'part of the password found in the file');
  assert.ok(!JSON.stringify(r).includes(PW), 'password handed back');
  assert.deepStrictEqual(Object.keys(acct.state()).sort(), ['exists', 'signedIn', 'username']);
});

test('the right password signs in, a wrong one does not', async () => {
  const { acct } = store();
  await acct.create('me@example.com', PW, 'fent');
  acct.signOut();
  assert.strictEqual(acct.state().signedIn, false);
  assert.strictEqual((await acct.signIn('me@example.com', PW + 'x')).ok, false);
  assert.strictEqual((await acct.signIn('other@example.com', PW)).ok, false);
  assert.strictEqual(acct.state().signedIn, false);
  const r = await acct.signIn(' ME@example.com ', PW);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(acct.state().username, 'fent');
});

test('a corrupt file reads as signed out and does not throw', async () => {
  const { file, acct } = store();
  fs.writeFileSync(file, '{"v":1,"email":');
  assert.deepStrictEqual(acct.state(), { exists: false, signedIn: false, username: '' });
  assert.strictEqual((await acct.signIn('me@example.com', PW)).ok, false);
  assert.strictEqual(acct.signOut().signedIn, false);
  fs.writeFileSync(file, 'not json at all');
  assert.strictEqual(acct.state().signedIn, false);
  assert.strictEqual((await acct.create('me@example.com', PW, 'fent')).ok, true);   // and a new account replaces it
});

test('remove deletes only the account file', async () => {
  const { dir, file, acct } = store();
  const lib = path.join(dir, 'library.json');
  fs.writeFileSync(lib, '{}');
  await acct.create('me@example.com', PW, 'fent');
  acct.remove();
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(lib));
  assert.strictEqual(acct.state().exists, false);
});

test('username rules', () => {
  assert.deepStrictEqual(Username.check('Fent'), { ok: true, name: 'fent', error: '' });
  for (const good of ['f', '7', 'a.b_c', 'a'.repeat(18)]) assert.strictEqual(Username.check(good).ok, true, good);
  for (const bad of ['', '.', '..', '_', 'a b', 'a-b', 'é', 'admin', 'Admin', 'a'.repeat(19)]) assert.strictEqual(Username.check(bad).ok, false, bad);
  for (const r of ['support', 'glassy', 'official', 'moderator', 'system']) assert.strictEqual(Username.check(r).ok, false, r);
});
