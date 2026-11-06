'use strict';
// The account on this computer. Nothing here touches the network: it is one small file in the app's data folder.
// The password is hashed with scrypt and a random salt and compared with timingSafeEqual. It is never stored, logged or
// handed back to the window; state() says only whether someone is signed in and under which username.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Username = require('./username');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 15;
const MAX_FIELD = 256;
const KEY_LEN = 64;
const SCRYPT = { N: 16384, r: 8, p: 1 };

const scrypt = (password, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
});
const cleanEmail = (e) => String(e == null ? '' : e).trim().toLowerCase();

function createAccountStore(file) {
  // a missing, unreadable or odd file is simply "no account"
  function read() {
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (a && a.v === 1 && typeof a.email === 'string' && typeof a.username === 'string' && Username.check(a.username).ok
        && typeof a.salt === 'string' && typeof a.hash === 'string' && Buffer.from(a.hash, 'hex').length === KEY_LEN) return a;
    } catch { /* no file, or a damaged one */ }
    return null;
  }
  // temp file, then rename: a crash part way leaves the old file, never half of a new one
  function write(a) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(a));
    fs.renameSync(tmp, file);
  }
  const fail = (error) => ({ ok: false, error });

  function state() {
    const a = read();
    return { exists: !!a, signedIn: !!(a && a.signedIn), username: a && a.signedIn ? a.username : '' };
  }

  async function create(email, password, username) {
    if (typeof email !== 'string' || typeof password !== 'string' || typeof username !== 'string') return fail('invalid');
    const mail = cleanEmail(email);
    if (!EMAIL.test(mail) || mail.length > MAX_FIELD) return fail('email');
    if (password.length < MIN_PASSWORD || password.length > MAX_FIELD) return fail('password');
    const u = Username.check(username);
    if (!u.ok) return fail('username');
    if (read()) return fail('exists');
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password.normalize('NFKC'), salt);
    write({ v: 1, email: mail, username: u.name, salt: salt.toString('hex'), hash: hash.toString('hex'), signedIn: true });
    return { ok: true, ...state() };
  }

  async function signIn(email, password) {
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > MAX_FIELD) return fail('mismatch');
    const a = read();
    if (!a) return fail('mismatch');
    // the hash is worked out either way, so a wrong email and a wrong password take the same time
    const got = await scrypt(password.normalize('NFKC'), Buffer.from(a.salt, 'hex'));
    const same = crypto.timingSafeEqual(got, Buffer.from(a.hash, 'hex'));
    if (!same || cleanEmail(email) !== a.email) return fail('mismatch');
    if (!a.signedIn) write({ ...a, signedIn: true });
    return { ok: true, ...state() };
  }

  function signOut() {
    const a = read();
    if (a && a.signedIn) write({ ...a, signedIn: false });
    return { ok: true, ...state() };
  }

  // only the account file goes: never the library, never anything else in the folder
  function remove() {
    for (const f of [file, file + '.tmp']) { try { fs.unlinkSync(f); } catch { /* not there */ } }
    return { ok: true, ...state() };
  }

  return { create, signIn, signOut, remove, state };
}

module.exports = { createAccountStore, MIN_PASSWORD };
