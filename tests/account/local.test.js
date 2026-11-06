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
  const r = await acct.create('Me@Example.com', PW, 'tester');
  assert.strictEqual(r.ok, true);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PW), 'plain password found in the file');
  assert.ok(!raw.includes('battery'), 'part of the password found in the file');
  assert.ok(!JSON.stringify(r).includes(PW), 'password handed back');
  assert.deepStrictEqual(Object.keys(acct.state()).sort(), ['exists', 'signedIn', 'username']);
});

test('the right password signs in, a wrong one does not', async () => {
  const { acct } = store();
  await acct.create('me@example.com', PW, 'tester');
  acct.signOut();
  assert.strictEqual(acct.state().signedIn, false);
  assert.strictEqual((await acct.signIn('me@example.com', PW + 'x')).ok, false);
  assert.strictEqual((await acct.signIn('other@example.com', PW)).ok, false);
  assert.strictEqual(acct.state().signedIn, false);
  const r = await acct.signIn(' ME@example.com ', PW);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(acct.state().username, 'tester');
});

test('a corrupt file reads as signed out and does not throw', async () => {
  const { file, acct } = store();
  fs.writeFileSync(file, '{"v":1,"email":');
  assert.deepStrictEqual(acct.state(), { exists: false, signedIn: false, username: '' });
  assert.strictEqual((await acct.signIn('me@example.com', PW)).ok, false);
  assert.strictEqual(acct.signOut().signedIn, false);
  fs.writeFileSync(file, 'not json at all');
  assert.strictEqual(acct.state().signedIn, false);
  assert.strictEqual((await acct.create('me@example.com', PW, 'tester')).ok, true);   // and a new account replaces it
});

test('remove deletes only the account file', async () => {
  const { dir, file, acct } = store();
  const lib = path.join(dir, 'library.json');
  fs.writeFileSync(lib, '{}');
  await acct.create('me@example.com', PW, 'tester');
  acct.remove();
  assert.ok(!fs.existsSync(file));
  assert.ok(fs.existsSync(lib));
  assert.strictEqual(acct.state().exists, false);
});

test('username rules', () => {
  assert.deepStrictEqual(Username.check('Tester'), { ok: true, name: 'tester', error: '' });
  for (const good of ['f', '7', 'a.b_c', 'a'.repeat(18)]) assert.strictEqual(Username.check(good).ok, true, good);
  for (const bad of ['', '.', '..', '_', 'a b', 'a-b', 'é', 'admin', 'Admin', 'a'.repeat(19)]) assert.strictEqual(Username.check(bad).ok, false, bad);
  for (const r of ['support', 'glassy', 'official', 'moderator', 'system', 'glass', 'root', 'null', 'undefined', 'staff', 'mod', 'help', 'administrator', 'fent', 'FENT']) assert.strictEqual(Username.check(r).ok, false, r);
});

test('the file keeps its scrypt numbers, and an old file with none still signs in', async () => {
  const { file, acct } = store();
  await acct.create('me@example.com', PW, 'tester');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(saved.scrypt, { N: 131072, r: 8, p: 1 });
  assert.strictEqual((await acct.signIn('me@example.com', PW)).ok, true);
  // an account written before the numbers were saved: hashed with Node's defaults, no scrypt field
  const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const hash = require('crypto').scryptSync(PW, salt, 64);
  fs.writeFileSync(file, JSON.stringify({ v: 1, email: 'me@example.com', username: 'tester', salt: salt.toString('hex'), hash: hash.toString('hex'), signedIn: false }));
  assert.strictEqual((await acct.signIn('me@example.com', PW)).ok, true);
  assert.strictEqual((await acct.signIn('me@example.com', PW + 'x')).ok, false);
});

test('a phone number works, and the same number typed another way signs in', async () => {
  const { file, acct } = store();
  assert.strictEqual((await acct.create('+1 (555) 123-4567', PW, 'tester')).ok, true);
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).contact, '+15551234567');
  acct.signOut();
  for (const typed of ['+15551234567', '+1 555 123 4567', '1-555-123-4567', ' +1 (555)-123-4567 ']) {
    assert.strictEqual((await acct.signIn(typed, PW)).ok, true, typed);
    acct.signOut();
  }
  assert.strictEqual((await acct.signIn('+1 555 123 4568', PW)).ok, false);
});

test('contact rules: email lowercased, phone 7 to 15 digits, anything else refused', async () => {
  const Contact = require('../../account/contact');
  assert.deepStrictEqual(Contact.check('  Me@Example.COM '), { ok: true, kind: 'email', value: 'me@example.com' });
  assert.deepStrictEqual(Contact.check('(555) 123-4567'), { ok: true, kind: 'phone', value: '5551234567' });
  for (const bad of ['', 'nope', '123456', '1'.repeat(16), '55-55-5', 'a@b', '555 abc 1234', '++15551234567']) assert.strictEqual(Contact.check(bad).ok, false, bad);
  const { acct } = store();
  assert.strictEqual((await acct.create('nope', PW, 'tester')).error, 'contact');
});
