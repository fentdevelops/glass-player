'use strict';
// The username rules, in one place: main (account/local.js) and the window (renderer/signup.js) both use this file.
// Lowercase only (capitals typed become lowercase), a to z, 0 to 9, "." and "_", 1 to 18 characters, at least one letter
// or number, and a few names nobody can take.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.Username = make();
})(typeof self !== 'undefined' ? self : this, () => {
  const MAX = 18;
  const RESERVED = ['admin', 'support', 'glassy', 'official', 'moderator', 'system', 'glass', 'root', 'null', 'undefined', 'staff', 'mod', 'help', 'administrator', 'fent'];
  // check('Fent') -> { ok: true, name: 'fent' }; otherwise { ok: false, name, error } with a plain sentence for the person
  function check(raw) {
    const name = String(raw == null ? '' : raw).toLowerCase();
    if (!name) return { ok: false, name, error: 'Pick a username' };
    if (name.length > MAX) return { ok: false, name, error: `Use ${MAX} characters or fewer` };
    if (!/^[a-z0-9._]+$/.test(name)) return { ok: false, name, error: 'Use only a to z, 0 to 9, . and _' };
    if (!/[a-z0-9]/.test(name)) return { ok: false, name, error: 'Include at least one letter or number' };
    if (RESERVED.includes(name)) return { ok: false, name, error: 'That name isn\'t available' };
    return { ok: true, name, error: '' };
  }
  return { check, MAX, RESERVED };
});
