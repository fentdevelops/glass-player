'use strict';
// Google sign-in for the account on this computer. Main process only.
// Google's desktop flow: the browser opens Google's page, Google sends the person back to a one-time listener on
// 127.0.0.1 (random port), and the code is traded for an id_token over HTTPS. Only sub, email and name are read from it.
// No token and no code is stored, logged or returned: the result is { sub, email, name } or { error }.
const crypto = require('crypto');
const http = require('http');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const PAGE = '<!doctype html><meta charset="utf-8"><title>Glassy</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:#111;color:#fff;font:18px system-ui,sans-serif"><p>You can go back to Glassy</p></body>';
const b64url = (buf) => buf.toString('base64url');

let current = null;      // the sign-in in progress, if any

function cancel() { if (current) current.finish({ error: 'cancelled' }); }

function readIdToken(idToken, clientId) {
  const parts = typeof idToken === 'string' ? idToken.split('.') : [];
  if (parts.length < 2) return null;
  let p;
  try { p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || p.aud !== clientId || !ISSUERS.includes(p.iss)) return null;
  if (typeof p.exp !== 'number' || p.exp * 1000 <= Date.now()) return null;
  if (typeof p.sub !== 'string' || !p.sub || typeof p.email !== 'string' || !p.email) return null;
  if (p.email_verified === false || p.email_verified === 'false') return null;
  const name = (typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.email.split('@')[0]).slice(0, 100);
  return { sub: p.sub, email: p.email, name };
}

// open(url) opens the browser; fetch is fetch; focus() brings the app window to the front (all passed in, so tests need no Electron)
function signInWithGoogle({ clientId, clientSecret, open, fetch: fetchFn, timeoutMs = 300000, focus } = {}) {
  cancel();      // a second call cancels the first
  return new Promise((resolve) => {
    if (typeof clientId !== 'string' || !clientId || typeof open !== 'function' || typeof fetchFn !== 'function') return resolve({ error: 'failed' });
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const abort = new AbortController();
    const sockets = new Set();
    let timer = null, done = false, handled = false, redirect = '';

    const server = http.createServer((req, res) => {
      const send = (code, body, type = 'text/plain; charset=utf-8') => {
        res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", Connection: 'close' });
        res.end(body);
      };
      let u;
      try { u = new URL(req.url, redirect); } catch { return send(400, 'Bad request'); }
      if (handled || req.method !== 'GET' || u.pathname !== '/' || req.headers.host !== new URL(redirect).host) return send(404, 'Not found');
      const got = u.searchParams.get('state') || '';
      const a = Buffer.from(got), b = Buffer.from(state);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(400, 'Refused');      // wrong state: keep waiting
      const err = u.searchParams.get('error');
      const code = u.searchParams.get('code');
      if (!err && !code) return send(400, 'Refused');
      handled = true;
      if (err) { send(200, PAGE, 'text/html; charset=utf-8'); return finish({ error: err === 'access_denied' ? 'denied' : 'failed' }); }
      send(200, PAGE, 'text/html; charset=utf-8');
      try { if (typeof focus === 'function') focus(); } catch { /* the page already says so */ }
      exchange(code);
    });
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

    function finish(result) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      abort.abort();
      if (current && current.finish === finish) current = null;
      try { server.close(); } catch { /* not listening */ }
      // let the page that was just sent reach the browser, then drop whatever is still open
      if (server.closeIdleConnections) server.closeIdleConnections();
      setTimeout(() => { for (const s of sockets) s.destroy(); }, 1000).unref();
      resolve(result);
    }

    async function exchange(code) {
      try {
        const body = new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect });
        if (clientSecret) body.set('client_secret', clientSecret);
        const r = await fetchFn(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: abort.signal });
        if (!r || !r.ok) return finish({ error: 'failed' });
        const j = await r.json();
        const who = readIdToken(j && j.id_token, clientId);
        finish(who ? who : { error: 'failed' });
      } catch { finish({ error: 'failed' }); }
    }

    current = { finish };
    server.on('error', () => finish({ error: 'failed' }));
    server.listen(0, '127.0.0.1', () => {
      if (done) return server.close();
      redirect = `http://127.0.0.1:${server.address().port}`;
      timer = setTimeout(() => finish({ error: 'timeout' }), timeoutMs);
      const url = AUTH_URL + '?' + new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid email profile',
        code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account',
      }).toString();
      if (!url.startsWith(AUTH_URL + '?')) return finish({ error: 'failed' });
      Promise.resolve().then(() => open(url)).catch(() => finish({ error: 'failed' }));
    });
  });
}

module.exports = { signInWithGoogle, cancel, AUTH_URL, TOKEN_URL };
