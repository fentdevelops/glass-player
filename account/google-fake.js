'use strict';
// A stand-in for Google, used only by main.js when GLASS_SHOT and GLASS_FAKE_GOOGLE are both set (UI tests).
// The "browser" calls the listener after a short wait; the "token endpoint" answers with a fake, unsigned id_token.
const http = require('http');

module.exports = (mode) => ({
  open(url) {
    const u = new URL(url);
    setTimeout(() => {
      const q = new URLSearchParams({ state: u.searchParams.get('state') });
      if (mode === 'denied') q.set('error', 'access_denied'); else q.set('code', 'fake-code');
      const r = new URL(u.searchParams.get('redirect_uri'));
      http.get({ host: r.hostname, port: r.port, path: '/?' + q }, (res) => res.resume()).on('error', () => {});
    }, 900);
  },
  async fetch(url, init) {
    const seg = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const idToken = `${seg({ alg: 'none' })}.${seg({ iss: 'https://accounts.google.com', aud: 'fake-client', sub: 'fake-sub', email: 'google.tester@example.com', name: 'Google Tester', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
    return { ok: true, json: async () => ({ id_token: idToken }) };
  },
});
