'use strict';
// The account on this computer. Nothing here touches the network: it is one small file in the app's data folder.
// The password is hashed with scrypt and a random salt and compared with timingSafeEqual. It is never stored, logged or
// handed back to the window; state() says only whether someone is signed in and under which username.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Username = require('./username');
const Contact = require('./contact');

const MIN_PASSWORD = 15;
const MAX_FIELD = Contact.MAX;
const KEY_LEN = 64;
// New accounts use these; the file keeps its own N, r and p so the numbers can be raised later without breaking old files.
// Files from before that were written with Node's defaults (16384, 8, 1) and carry no numbers.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
const LEGACY_SCRYPT = { N: 16384, r: 8, p: 1 };
const paramsOf = (a) => (a && a.scrypt && Number.isInteger(a.scrypt.N) && Number.isInteger(a.scrypt.r) && Number.isInteger(a.scrypt.p)
  ? { N: a.scrypt.N, r: a.scrypt.r, p: a.scrypt.p } : LEGACY_SCRYPT);

const scrypt = (password, salt, params = SCRYPT) => new Promise((resolve, reject) => {
  // maxmem: scrypt needs about 128 * N * r bytes (N=2^17, r=8 is 128 MiB), over Node's 32 MiB default
  const maxmem = 128 * params.N * params.r + 16 * 1024 * 1024;
  crypto.scrypt(password, salt, KEY_LEN, { ...params, maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
});
const cleanContact = (e) => { const c = Contact.check(e); return c.ok ? c.value : ''; };
// the file says "email" in accounts made before phone numbers were allowed; new ones say "contact" (an email or a phone number)
const contactOf = (a) => (typeof a.contact === 'string' ? a.contact : a.email);

function createAccountStore(file) {
  // a missing, unreadable or odd file is simply "no account"
  function read() {
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (a && a.v === 1 && typeof contactOf(a) === 'string' && typeof a.username === 'string' && Username.check(a.username).ok
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

  async function create(contact, password, username) {
    if (typeof contact !== 'string' || typeof password !== 'string' || typeof username !== 'string') return fail('invalid');
    const who = cleanContact(contact);
    if (!who) return fail('contact');
    if (password.length < MIN_PASSWORD || password.length > MAX_FIELD) return fail('password');
    const u = Username.check(username);
    if (!u.ok) return fail('username');
    if (read()) return fail('exists');
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password.normalize('NFKC'), salt);
    write({ v: 1, contact: who, username: u.name, salt: salt.toString('hex'), hash: hash.toString('hex'), scrypt: { ...SCRYPT }, signedIn: true });
    return { ok: true, ...state() };
  }

  async function signIn(contact, password) {
    if (typeof contact !== 'string' || typeof password !== 'string' || password.length > MAX_FIELD) return fail('mismatch');
    const a = read();
    if (!a) return fail('mismatch');
    // the hash is worked out either way, so a wrong email or number and a wrong password take the same time
    const got = await scrypt(password.normalize('NFKC'), Buffer.from(a.salt, 'hex'), paramsOf(a));
    const same = crypto.timingSafeEqual(got, Buffer.from(a.hash, 'hex'));
    if (!same || !Contact.same(cleanContact(contact), contactOf(a))) return fail('mismatch');
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
