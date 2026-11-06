'use strict';
// The first sign-up field takes an email or a phone number. One place decides which it is and how it is kept, so main
// (account/local.js) and the window (renderer/signup.js) agree.
// Email: trimmed and lowercased. Phone: an optional leading "+", then 7 to 15 digits (spaces, dashes and brackets
// are allowed between them); it is kept as the digits with the "+" if there was one. Matching ignores the "+", so
// "+1 (555) 123-4567" and "1 555 123 4567" are the same number.
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.Contact = make();
})(typeof self !== 'undefined' ? self : this, () => {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE = /^\+?[\d\s\-()]+$/;
  const MAX = 256;
  // check(raw) -> { ok: true, kind: 'email' | 'phone', value } or { ok: false }
  function check(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (!t || t.length > MAX) return { ok: false };
    if (EMAIL.test(t)) return { ok: true, kind: 'email', value: t.toLowerCase() };
    if (PHONE.test(t)) {
      const digits = t.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15) return { ok: true, kind: 'phone', value: (t.startsWith('+') ? '+' : '') + digits };
    }
    return { ok: false };
  }
  // the same email or number, however it was typed
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.replace(/^\+/, '') === b.replace(/^\+/, '');
  return { check, same, MAX };
});
