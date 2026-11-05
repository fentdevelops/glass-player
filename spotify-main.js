'use strict';
// Spotify Web API for Glass Player (main process).
// Sign-in: Authorization Code + PKCE in the user's own browser (no client secret, Glass never sees the password).
// Tokens live only here; the refresh token is stored encrypted with Windows DPAPI (safeStorage).
// The renderer gets a narrow proxy: whitelisted Web API paths, structured errors.
const { app, ipcMain, shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 43821;
const REDIRECT = `http://127.0.0.1:${PORT}/callback`;
const SCOPES = [
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'user-library-modify',
  // in-app playback (Web Playback SDK, Premium): Glass itself becomes a Spotify device
  'streaming',
  'user-read-email',
  // Search tab recommendations
  'user-read-recently-played',
  'user-top-read',
];
const MOCK = !!process.env.GLASS_SPOTIFY_MOCK;   // dev/test only: a fake Spotify so the UI can be tested without an account

const file = () => path.join(app.getPath('userData'), 'spotify.json');
let cfg = null;              // { clientId, refresh (encrypted), user }
let access = null, accessExp = 0, refreshing = null, authServer = null;

function load() {
  if (cfg) return cfg;
  try { cfg = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cfg = {}; }
  return cfg;
}
function persist() {
  fs.writeFileSync(file() + '.tmp', JSON.stringify(cfg));
  fs.renameSync(file() + '.tmp', file());
}
const seal = (s) => (safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + Buffer.from(s).toString('base64'));
function unseal(s) {
  if (!s) return null;
  try { return s.startsWith('e:') ? safeStorage.decryptString(Buffer.from(s.slice(2), 'base64')) : Buffer.from(s.slice(2), 'base64').toString(); }
  catch { return null; }
}

// Spotify only plays inside apps with a production Widevine (VMP) signature. A signed app carries
// resources/vmp-signed next to its exe: written by the build (scripts/vmp-sign.js) or by Glass's own setup
// (Settings > Spotify > Set up), which signs the installed copy in place.
const appDir = () => path.dirname(process.execPath);
const vmpMarker = () => path.join(appDir(), 'resources', 'vmp-signed');
const vmpSigned = () => fs.existsSync(vmpMarker()) || process.env.GLASS_VMP === '1';
function status() {
  if (MOCK) return { clientId: 'mock', connected: true, user: { name: 'Mock Listener', product: 'premium' }, redirect: REDIRECT, mock: true, vmp: process.env.GLASS_VMP === '1', canStream: true };
  load();
  // canStream: the sign-in included the 'streaming' scope (older sign-ins need a reconnect for in-app playback)
  return { clientId: cfg.clientId || '', connected: !!cfg.refresh, user: cfg.user || null, redirect: REDIRECT, canStream: !!(cfg.scope && cfg.scope.split(' ').includes('streaming')), vmp: vmpSigned() };
}

class SpotifyError extends Error {
  constructor(message, status = 0, reason = '') { super(message); this.status = status; this.reason = reason; }
}

async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new SpotifyError(j.error_description || j.error || `Spotify sign-in failed (${r.status})`, r.status, j.error || '');
  return j;
}
function keep(j) {
  access = j.access_token;
  accessExp = Date.now() + Math.max(60, (j.expires_in || 3600) - 60) * 1000;
  if (j.scope && cfg.scope !== j.scope) { cfg.scope = j.scope; persist(); }
  if (j.refresh_token) { cfg.refresh = seal(j.refresh_token); persist(); }   // PKCE refresh tokens rotate: always keep the newest
}
async function token() {
  if (access && Date.now() < accessExp) return access;
  // one refresh at a time: a second concurrent refresh would spend an already-rotated token and sign the user out
  refreshing ??= (async () => {
    load();
    const rt = unseal(cfg.refresh);
    if (!rt || !cfg.clientId) throw new SpotifyError('Connect Spotify first', 401, 'NOT_CONNECTED');
    try { keep(await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt, client_id: cfg.clientId })); }
    catch (e) {
      if (e.reason === 'invalid_grant') { cfg.refresh = null; persist(); throw new SpotifyError('Spotify signed you out. Connect again.', 401, 'NOT_CONNECTED'); }
      throw e;
    }
  })().finally(() => { refreshing = null; });
  await refreshing;
  return access;
}

const PATH_OK = /^\/(me|search|playlists|albums|artists|tracks)(\/|\?|$)/;
const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE']);
async function api(method, p, query, body, retry = true) {
  if (!METHODS.has(method) || !PATH_OK.test(p) || p.includes('..')) throw new SpotifyError('Blocked Spotify request');
  if (MOCK) return mockApi(method, p, query || {}, body);
  const url = new URL('https://api.spotify.com/v1' + p);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + (await token()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 401 && retry) { access = null; return api(method, p, query, body, false); }
  if (r.status === 429 && retry) {
    const s = Math.min(10, Number(r.headers.get('retry-after')) || 1);
    await new Promise((res) => setTimeout(res, s * 1000));
    return api(method, p, query, body, false);
  }
  const text = r.status === 204 ? '' : await r.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* some player endpoints answer with plain text */ }
  if (!r.ok) throw new SpotifyError(j?.error?.message || `Spotify error ${r.status}`, r.status, j?.error?.reason || '');
  return j;
}

function page(msg) {
  return `<!doctype html><meta charset="utf-8"><title>Glass Player</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;background:#2a2a30;color:#fff;font:16px 'Segoe UI',system-ui,sans-serif">
<div style="padding:28px 36px;border-radius:20px;background:rgba(255,255,255,.1);box-shadow:inset 0 1px 0 rgba(255,255,255,.3)">${msg}</div>`;
}
function closeServer() {
  if (authServer) { try { authServer.close(); } catch { /* already closed */ } authServer = null; }
}
async function connect() {
  if (MOCK) return status();
  load();
  if (!cfg.clientId) throw new SpotifyError('Paste your Spotify app Client ID first');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  closeServer();
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { closeServer(); reject(new SpotifyError('Spotify sign-in timed out. Try again.')); }, 5 * 60 * 1000);
    authServer = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT);
      if (u.pathname !== '/callback') { res.writeHead(404); res.end(); return; }
      const ok = u.searchParams.get('state') === state && !!u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(ok ? 'Spotify is connected to Glass Player. You can close this tab.' : 'Spotify sign-in was cancelled. You can close this tab.'));
      clearTimeout(timer);
      closeServer();
      if (ok) resolve(u.searchParams.get('code'));
      else reject(new SpotifyError(u.searchParams.get('error') === 'access_denied' ? 'Spotify access was not allowed' : 'Spotify sign-in failed'));
    });
    authServer.on('error', (e) => {
      clearTimeout(timer);
      closeServer();
      reject(new SpotifyError(e.code === 'EADDRINUSE' ? `Port ${PORT} is busy. Close whatever uses it and try again.` : e.message));
    });
    authServer.listen(PORT, '127.0.0.1', () => {
      const u = new URL('https://accounts.spotify.com/authorize');
      u.search = new URLSearchParams({
        client_id: cfg.clientId, response_type: 'code', redirect_uri: REDIRECT,
        code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES.join(' '),
      }).toString();
      shell.openExternal(u.toString());
    });
  });
  keep(await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: cfg.clientId, code_verifier: verifier }));
  const me = await api('GET', '/me');
  cfg.user = { name: me.display_name || me.id, id: me.id, product: me.product || '' };
  persist();
  return status();
}

// ---------- fake Spotify for off-screen UI tests (GLASS_SPOTIFY_MOCK=1) ----------
let mock = null;
// test pictures: a square cover, or a wide "video frame" with a play mark
function mockImg(w, h, hue) {
  const mark = w > h
    ? `<circle cx="${w / 2}" cy="${h / 2}" r="${h / 6}" fill="rgba(255,255,255,.85)"/><path d="M${w / 2 - h / 18} ${h / 2 - h / 12}L${w / 2 + h / 11} ${h / 2}L${w / 2 - h / 18} ${h / 2 + h / 12}Z" fill="hsl(${hue},45%,32%)"/>`
    : `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 4}" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="${w / 40}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,62%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},60%,28%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>${mark}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function mockState() {
  if (mock) return mock;
  const words = ['Glass', 'Neon', 'Velvet', 'Orbit', 'Static', 'Bloom', 'Echo', 'Drift', 'Halo', 'Pulse', 'Ember', 'Tide'];
  const artists = ['Nova Lane', 'The Weekends', 'Lil Prism', 'Mara Vex', 'Juno Park', 'Vampyre Club'];
  const artistObj = (k) => ({ id: 'art' + k, uri: 'spotify:artist:art' + k, name: artists[k], images: [], followers: { total: 1000 * (k + 3) } });
  const albumObj = (k) => ({ id: 'alb' + k, uri: 'spotify:album:alb' + k, name: `${words[(k * 3) % 12]} Sessions`,
    images: [{ url: mockImg(640, 640, k * 24), width: 640, height: 640 }, { url: mockImg(64, 64, k * 24), width: 64, height: 64 }], release_date: `20${10 + k}-05-01`, artists: [artistObj(k % 6)], total_tracks: 20 });
  const track = (i) => ({
    id: 'trk' + i, uri: 'spotify:track:trk' + i, name: `${words[i % 12]} ${words[(i * 5) % 12]}${i % 7 === 0 ? ' (Remix)' : ''}`,
    duration_ms: 150000 + (i % 9) * 17000, is_playable: true,
    artists: [artistObj(i % 6), ...(i % 4 === 0 ? [artistObj((i + 2) % 6)] : [])],
    album: albumObj(i % 15),
  });
  const catalog = Array.from({ length: 300 }, (_, i) => track(i));
  const artistList = artists.map((_, k) => artistObj(k));
  const albumList = Array.from({ length: 15 }, (_, k) => albumObj(k));
  const playlists = ['Late night drive', 'Gym', 'Rainy day'].map((name, k) => ({
    id: 'pl' + k, uri: 'spotify:playlist:pl' + k, name, images: [], owner: { display_name: 'Mock Listener' },
    tracks: { total: 20 + k * 15 }, items: catalog.slice(k * 30, k * 30 + 20 + k * 15),
  }));
  mock = {
    catalog, playlists, artistList, albumList, liked: new Set(catalog.slice(0, 140).map((t) => t.id)),
    player: { is_playing: false, item: null, progress_ms: 0, at: Date.now(), shuffle_state: false, repeat_state: 'off', list: [], idx: 0,
      device: { id: 'dev1', name: 'Mock PC', type: 'Computer', is_active: true, volume_percent: 60, supports_volume: true } },
  };
  return mock;
}
function mockApi(method, p, q, body) {
  const m = mockState(), P = m.player;
  const pos = () => Math.min(P.item ? P.item.duration_ms : 0, P.progress_ms + (P.is_playing ? Date.now() - P.at : 0));
  const pageOf = (arr, limit, offset, wrap) => {
    const o = Number(offset) || 0, l = Number(limit) || 20;
    return { items: arr.slice(o, o + l).map(wrap || ((x) => x)), total: arr.length, next: o + l < arr.length ? 'more' : null };
  };
  const start = (list, idx) => { P.list = list; P.idx = Math.max(0, idx); P.item = list[P.idx]; P.audioItem = null; P.progress_ms = 0; P.at = Date.now(); P.is_playing = true; };
  // tests: the playing song switched to its music video in Spotify (same song with a wide frame as its art,
  // a separate "video" track, or a wide frame that comes without a size)
  if (method === 'PUT' && p === '/me/player/mock-video') {
    if (!P.item) return null;
    const base = (P.audioItem = P.audioItem || P.item);
    const wide = [{ url: mockImg(1280, 720, 200), width: 1280, height: 720 }, { url: mockImg(320, 180, 200), width: 320, height: 180 }];
    if (q.mode === 'same') P.item = { ...base, album: { ...base.album, images: wide } };
    else if (q.mode === 'twin') P.item = { ...base, id: base.id + 'v', uri: base.uri + 'v', album: { ...base.album, id: base.album.id + 'v', uri: base.album.uri + 'v', images: wide } };
    else if (q.mode === 'squareframe') P.item = { ...base, album: { ...base.album, images: [{ url: mockImg(640, 640, 120), width: 640, height: 640 }] } };
    else if (q.mode === 'nodims') P.item = { ...base, id: base.id + 'n', uri: base.uri + 'n', album: { ...base.album, id: base.album.id + 'n', images: [{ url: mockImg(1280, 720, 300), width: null, height: null }] } };
    else { P.item = base; P.audioItem = null; }
    return null;
  }
  if (method === 'GET' && p === '/me') return { id: 'mock', display_name: 'Mock Listener', product: 'premium' };
  if (method === 'GET' && p === '/me/tracks') return pageOf(m.catalog.filter((t) => m.liked.has(t.id)), q.limit, q.offset, (t) => ({ added_at: '2026-01-01', track: t }));
  // 2026 API: the per-type like endpoints are refused, the library endpoint takes URIs
  if (p === '/me/tracks/contains' || ((method === 'PUT' || method === 'DELETE') && p === '/me/tracks')) throw new SpotifyError('Forbidden', 403);
  if (method === 'GET' && p === '/me/library/contains') {
    const uris = String(q.uris || '').split(',').filter(Boolean);
    if (!uris.length || uris.length > 40) throw new SpotifyError('Invalid uris', 400);
    return uris.map((u) => m.liked.has(u.split(':').pop()));
  }
  if ((method === 'PUT' || method === 'DELETE') && p === '/me/library') {
    for (const u of (body && body.uris) || []) { const id = String(u).split(':').pop(); method === 'PUT' ? m.liked.add(id) : m.liked.delete(id); }
    return null;
  }
  if (method === 'GET' && p === '/me/playlists') return pageOf(m.playlists.map(({ items, ...pl }) => pl), q.limit, q.offset);
  const plm = /^\/playlists\/([^/]+)\/tracks$/.exec(p);
  if (method === 'GET' && plm) { const pl = m.playlists.find((x) => x.id === plm[1]); if (!pl) throw new SpotifyError('Not found', 404); return pageOf(pl.items, q.limit, q.offset, (t) => ({ track: t })); }
  if (method === 'GET' && p === '/search') {
    if (Number(q.limit) > 10) throw new SpotifyError('Invalid limit', 400);   // like apps whose search page size was capped
    const s = String(q.q || '').toLowerCase(), types = String(q.type || 'track').split(',');
    const byArtist = /^artist:"([^"]+)"$/.exec(s);
    const out = {};
    if (types.includes('track')) out.tracks = pageOf(m.catalog.filter((t) => (byArtist ? t.artists.some((a) => a.name.toLowerCase() === byArtist[1]) : `${t.name} ${t.artists.map((a) => a.name).join(' ')}`.toLowerCase().includes(s))), q.limit, q.offset);
    if (types.includes('artist')) out.artists = pageOf(m.artistList.filter((a) => a.name.toLowerCase().includes(s)), q.limit, 0);
    if (types.includes('album')) out.albums = pageOf(m.albumList.filter((a) => `${a.name} ${a.artists[0].name}`.toLowerCase().includes(s)), q.limit, 0);
    if (types.includes('playlist')) out.playlists = pageOf(m.playlists.filter((x) => x.name.toLowerCase().includes(s)).map(({ items, ...pl }) => pl), q.limit, 0);
    return out;
  }
  const alm = /^\/albums\/([^/]+)(\/tracks)?$/.exec(p);
  if (method === 'GET' && alm) {
    const al = m.albumList.find((a) => a.id === alm[1]);
    if (!al) throw new SpotifyError('Not found', 404);
    const tracks = m.catalog.filter((t) => t.album.id === al.id).map(({ album, ...t }) => t);   // simplified tracks, like Spotify
    return alm[2] ? pageOf(tracks, q.limit, q.offset) : { ...al, total_tracks: tracks.length, tracks: pageOf(tracks, 50, 0) };
  }
  const arm = /^\/artists\/([^/]+)(\/top-tracks|\/albums)?$/.exec(p);
  if (method === 'GET' && arm) {
    const ar = m.artistList.find((a) => a.id === arm[1]);
    if (!ar) throw new SpotifyError('Not found', 404);
    if (arm[2] === '/top-tracks') throw new SpotifyError('Not found', 404);   // removed in the 2026 API
    if (arm[2] === '/albums') return pageOf(m.albumList.filter((a) => a.artists[0].id === ar.id), q.limit, q.offset);
    return ar;
  }
  if (method === 'GET' && p === '/me/player') return P.item ? { ...P, progress_ms: pos(), timestamp: Date.now(), list: undefined, idx: undefined, at: undefined } : null;
  if (method === 'GET' && p === '/me/player/queue') return { currently_playing: P.item, queue: P.list.slice(P.idx + 1, P.idx + 21) };
  if (method === 'GET' && p === '/me/player/devices') {
    const pc = m.pc || P.device, seen = new Set();
    const all = [pc, ...(m.ghosts || []).map((id) => ({ ...pc, id, name: 'Glass Player' })), P.device];
    return { devices: all.filter((d) => !seen.has(d.id) && seen.add(d.id)).map((d) => ({ ...d, is_active: d.id === P.device.id })) };
  }
  // tests: an old "Glass Player" left on the account by a Glass that closed without signing off
  // (route=1: Spotify sends the music there, like picking it in the Spotify app)
  if (method === 'PUT' && p === '/me/player/mock-ghost') {
    (m.ghosts ??= []).push(String(q.id));
    if (q.route) { m.pc ??= P.device; P.device = { ...m.pc, id: String(q.id), name: 'Glass Player' }; P.is_playing = true; P.at = Date.now(); }
    return null;
  }
  if (method === 'GET' && p === '/me/player/recently-played') return { items: m.catalog.slice(40, 40 + (Number(q.limit) || 20)).map((t) => ({ track: t, played_at: '2026-11-03T12:00:00Z' })) };
  if (method === 'GET' && p === '/me/top/tracks') return pageOf(m.catalog.slice(10, 60), q.limit, q.offset);
  const onDevice = (id) => { if (!id) return; m.pc ??= P.device; P.device = /^(fake|ghost)-/.test(String(id)) ? { ...m.pc, id: String(id), name: 'Glass Player' } : m.pc; };
  if (method === 'PUT' && p === '/me/player/play') {
    onDevice(q.device_id);
    if (body?.uris) { start(body.uris.map((u) => m.catalog.find((t) => t.uri === u)).filter(Boolean), body.offset?.position || 0); P.context = null; }
    else if (body?.context_uri) {
      P.context = { type: body.context_uri.split(':')[1], uri: body.context_uri };
      const pl = m.playlists.find((x) => x.uri === body.context_uri);
      const list = pl ? pl.items : m.catalog;
      start(list, list.findIndex((t) => t.uri === body.offset?.uri));
    } else if (P.item) { P.progress_ms = pos(); P.at = Date.now(); P.is_playing = true; }
    if (body && body.position_ms) P.progress_ms = Number(body.position_ms);
    return null;
  }
  if (method === 'PUT' && p === '/me/player/pause') { P.progress_ms = pos(); P.at = Date.now(); P.is_playing = false; return null; }
  if (method === 'POST' && (p === '/me/player/next' || p === '/me/player/previous')) {
    if (P.list.length) start(P.list, (P.idx + (p.endsWith('next') ? 1 : -1) + P.list.length) % P.list.length);
    return null;
  }
  if (method === 'PUT' && p === '/me/player/seek') { P.progress_ms = Number(q.position_ms) || 0; P.at = Date.now(); return null; }
  if (method === 'PUT' && p === '/me/player/volume') { P.device.volume_percent = Number(q.volume_percent); return null; }
  if (method === 'PUT' && p === '/me/player/shuffle') { P.shuffle_state = q.state === 'true' || q.state === true; return null; }
  if (method === 'PUT' && p === '/me/player/repeat') { P.repeat_state = q.state; return null; }
  if (method === 'POST' && p === '/me/player/queue') { const t = m.catalog.find((x) => x.uri === q.uri); if (t) P.list.splice(P.idx + 1, 0, t); return null; }
  if (method === 'PUT' && p === '/me/player') { onDevice(body && body.device_ids && body.device_ids[0]); return null; }
  throw new SpotifyError(`Mock has no ${method} ${p}`, 404);
}

// ---------- one-time setup so Spotify plays inside Glass (renderer/spsetup.js) ----------
// Glass drives castlabs' own free tool (the castlabs-evs Python package): it installs it when missing,
// creates or logs into the castlabs account with what was typed in Glass, then signs this install.
// Passwords travel to Python over stdin, never on a command line, and Glass doesn't keep them.
const { spawn } = require('child_process');
const os = require('os');
const EVS_FAKE = !!(process.env.GLASS_SHOT && process.env.GLASS_EVS_FAKE);   // tests: pretend, never touch castlabs
const fake = { python: true, evs: true, account: null, signed: false, pending: null };
let pyCmd = null;
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
function run(cmd, args, input, ms = 180000, onLine = null) {
  return new Promise((resolve) => {
    let out = '', err = '', p, part = '';
    try { p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, EVS_NO_ASK: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' } }); }
    catch (e) { resolve({ code: -1, out, err: e.message }); return; }
    const t = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, ms);
    // every line the tool prints (both streams), for the live log in the setup window
    const feed = (d) => {
      if (!onLine) return;
      part += String(d);
      const bits = part.split(/\r\n|\n|\r/);
      part = bits.pop();
      for (const b of bits) { const l = b.replace(ANSI, '').trim(); if (l) onLine(l); }
    };
    p.stdout.on('data', (d) => { out += d; if (!onLine || !String(d).trim().startsWith('{')) feed(d); });
    p.stderr.on('data', (d) => { err += d; feed(d); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); if (part.trim() && onLine && !part.trim().startsWith('{')) onLine(part.replace(ANSI, '').trim()); resolve({ code, out, err }); });
    p.stdin.on('error', () => {});
    p.stdin.end(input == null ? '' : input);
  });
}
async function python() {
  if (pyCmd) return pyCmd;
  for (const c of ['py', 'python']) {
    const r = await run(c, ['-c', 'import sys; print(sys.version_info[0])'], null, 20000);
    if (r.code === 0 && /^3/.test(r.out.trim())) return (pyCmd = c);
  }
  return null;
}
const evsConfig = () => {
  try { return JSON.parse(fs.readFileSync(process.env.EVS_CONFIG_FILE || path.join(os.homedir(), '.config', 'evs', 'config.json'), 'utf8')); } catch { return {}; }
};
function evsAccount() { const a = evsConfig().Auth || {}; return a.AccountName && a.RefreshToken ? a.AccountName : null; }
// castlabs' answers (Amazon Cognito errors underneath) in plain words, on the field they're about
function friendlyPw(p) {
  p = String(p || '').toLowerCase();
  if (p.includes('uppercase')) return 'castlabs wants a capital letter in it';
  if (p.includes('lowercase')) return 'castlabs wants a small letter in it';
  if (p.includes('numeric') || p.includes('number')) return 'castlabs wants a number in it';
  if (p.includes('symbol')) return 'castlabs wants a symbol in it, like ! or #';
  if (p.includes('long')) return '8 or more characters';
  return '';
}
function explainEvs(msg) {
  const m = String(msg || '');
  const has = (x) => m.includes(x);
  if (has('UsernameExistsException') || /user already exists/i.test(m)) return { field: 'account', error: 'That account name is taken' };
  if (has('InvalidPasswordException')) return { field: 'password', error: friendlyPw(m.split('policy:')[1]) || 'castlabs wants a stronger password' };
  if (has('CodeMismatchException')) return { field: 'code', error: 'That code isn\u2019t right' };
  if (has('ExpiredCodeException')) return { field: 'code', error: 'That code expired. Send a new one.' };
  if (has('UserNotConfirmedException')) return { field: 'code', error: '', needsCode: true };
  if (has('NotAuthorizedException')) return { field: 'password', error: 'Wrong account name or password' };
  if (has('UserNotFoundException')) return { field: 'account', error: 'No castlabs account with that name' };
  if (has('InvalidParameterException') && /email/i.test(m)) return { field: 'email', error: 'castlabs didn\u2019t accept that email' };
  if (has('InvalidParameterException') && /username/i.test(m)) return { field: 'account', error: 'castlabs didn\u2019t accept that account name' };
  if (has('LimitExceededException') || has('TooManyRequests')) return { error: 'Too many tries. Wait a few minutes, then try again.' };
  if (/getaddrinfo|ConnectTimeout|EndpointConnectionError|ConnectionError|timed out/i.test(m)) return { error: 'Couldn\u2019t reach castlabs. Check your internet connection.' };
  return { error: m.replace(/^[\s\S]*?An error occurred \((\w+)\) when calling the \w+ operation: /, '').slice(0, 220) || 'castlabs said no' };
}
// rough progress from what the tools print: each pattern moves the bar to at least that far
const STAGES = {
  prepare: [[/winget|Found Python/i, 8], [/Downloading .*python/i, 15], [/verified installer hash/i, 25], [/Starting package install/i, 30], [/Successfully installed\b(?!.*castlabs)/i, 45],
    [/Collecting|Requirement already satisfied/i, 55], [/Downloading/i, 65], [/Installing collected packages/i, 82], [/Successfully installed/i, 96]],
  sign: [[/^Signing:/i, 8], [/Checking existing signature/i, 16], [/Existing signature invalid/i, 24], [/No cached signature|Checking cached signature/i, 30],
    [/Acquiring upload slot/i, 38], [/(\d{1,3})(?:\.\d+)?\s*%/, null], [/Requesting signature/i, 80], [/Signature request successful|Retain existing signature|Using cached signature/i, 94]],
};
function progressFor(task, sender) {
  let pct = 0, n = 0;
  const send = (d) => { try { if (!sender.isDestroyed()) sender.send('evs:progress', { task, ...d }); } catch { /* window gone */ } };
  send({ pct: 3 });
  return {
    line(l) {
      n++;
      let to = pct;
      for (const [re, at] of STAGES[task] || []) {
        const m = re.exec(l);
        if (!m) continue;
        if (at === null) to = Math.max(to, 38 + Math.min(100, +m[1]) * 0.4);   // upload percentage: 38 -> 78
        else to = Math.max(to, at);
      }
      if (!STAGES[task]) to = Math.min(88, 12 + n * 18);                     // account steps: a few lines each
      pct = Math.max(pct, to);
      send({ pct, line: l });
    },
    done(ok) { send({ pct: ok ? 100 : pct }); },
  };
}
async function evsStatus() {
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (EVS_FAKE) return { portable, signed: fake.signed, python: fake.python, evs: fake.evs, account: fake.account, cachedAccount: fake.pending || '' };
  const py = await python();
  const evs = py ? (await run(py, ['-c', 'import castlabs_evs'], null, 20000)).code === 0 : false;
  const cached = (evsConfig().Account || {}).AccountName || '';
  return { portable, signed: vmpSigned(), python: !!py, evs, account: evsAccount(), cachedAccount: cached };
}
const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
const EVS_WRAPPER = String.raw`import json, sys, io, contextlib
d = json.loads(sys.stdin.read())
buf = io.StringIO()
try:
    from castlabs_evs.account import Account
    with contextlib.redirect_stdout(sys.stderr):
        a = Account(no_ask=True)
        act = d.get('action')
        if act == 'signup':
            a.signup(d['account'], d['password'], d['email'], d['first'], d['last'], d.get('org') or 'Personal', no_confirm=True)
        elif act == 'confirm':
            a.confirm_signup(d['account'], d['password'], d['code'])
        elif act == 'resend':
            a.resend(d['account'], no_confirm=True)
        elif act == 'login':
            a.reauth(d['account'], d['password'])
        else:
            raise ValueError('unknown action')
    print(json.dumps({'ok': True}))
except Exception as e:
    msg, c = str(e), e.__cause__
    while c is not None:
        msg += ': ' + str(c)
        c = c.__cause__
    print(json.dumps({'ok': False, 'error': msg[:400]}))
`;

function register() {
  // the Web Playback SDK asks for a fresh token whenever it needs one
  // fresh: Spotify refused the in-app player's sign-in, so don't hand it the same token again
  ipcMain.handle('sp:token', async (_e, fresh) => {
    if (fresh) { spLog('player: getting a fresh sign-in'); access = null; }
    return MOCK ? 'mock-token' : token();
  });
  ipcMain.handle('sp:status', () => status());
  ipcMain.handle('sp:setClient', (_e, id) => {
    id = String(id || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) throw new SpotifyError('That doesn\'t look like a Spotify Client ID (32 letters and digits).');
    load();
    if (cfg.clientId !== id) { cfg = { clientId: id }; access = null; accessExp = 0; persist(); }
    return status();
  });
  ipcMain.handle('sp:connect', () => connect());
  ipcMain.handle('sp:cancel', () => { closeServer(); return true; });
  ipcMain.handle('sp:disconnect', () => {
    load();
    cfg = { clientId: cfg.clientId || '' };
    access = null; accessExp = 0;
    persist();
    return status();
  });
  // errors are returned, not thrown, so status/reason survive the IPC boundary
  ipcMain.handle('sp:api', async (_e, method, p, query, body) => {
    try { return { ok: true, data: await api(String(method).toUpperCase(), String(p), query, body) }; }
    catch (e) { return { ok: false, status: e.status || 0, reason: e.reason || '', message: e.message || 'Spotify request failed' }; }
  });
  // ----- setup steps -----
  ipcMain.handle('evs:status', () => evsStatus());
  // castlabs' tool ready: Python (installed for this user with winget if missing), then castlabs-evs
  ipcMain.handle('evs:prepare', async (e) => {
    const pr = progressFor('prepare', e.sender);
    if (EVS_FAKE) {
      for (const l of ['Collecting castlabs-evs', 'Downloading castlabs_evs-1.3.3-py3-none-any.whl (32 kB)', 'Installing collected packages: castlabs-evs', 'Successfully installed castlabs-evs-1.3.3']) { pr.line(l); await new Promise((r) => setTimeout(r, 250)); }
      fake.python = fake.evs = true; pr.done(true); return { ok: true };
    }
    if (!(await python())) {
      pr.line('Python isn\u2019t installed: getting it with winget');
      const w = await run('winget', ['install', '-e', '--id', 'Python.Python.3.12', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], null, 600000, pr.line);
      pyCmd = null;
      if (!(await python())) { pr.done(false); return { ok: false, error: 'Couldn\u2019t install Python automatically. Install it from python.org, then open this again.' + (w.code ? ` (winget ${w.code})` : '') }; }
      pr.line('Found Python');
    }
    const r = await run(pyCmd, ['-m', 'pip', 'install', '--user', '--upgrade', '--disable-pip-version-check', 'castlabs-evs'], null, 600000, pr.line);
    pr.done(r.code === 0);
    if (r.code !== 0) return { ok: false, error: 'Couldn\u2019t install castlabs\u2019 tool: ' + lastLine(r.err || r.out).slice(0, 200) };
    return { ok: true };
  });
  // castlabs account: signup (sends a code by email), confirm, resend, login
  ipcMain.handle('evs:account', async (e, d) => {
    d = d && typeof d === 'object' ? d : {};
    const action = String(d.action || '');
    if (!['signup', 'confirm', 'resend', 'login'].includes(action)) return { ok: false, error: 'Unknown step' };
    const pr = progressFor(action, e.sender);
    const fail = (raw) => { pr.done(false); return { ok: false, ...explainEvs(raw) }; };
    if (EVS_FAKE) {
      pr.line(action === 'signup' ? 'Signing up for castLabs EVS' : action === 'login' ? 'Refreshing authorization tokens' : 'Confirming EVS account');
      await new Promise((r) => setTimeout(r, 300));
      if (action === 'signup') { if (['taken-name', 'mocklistener'].includes(d.account)) return fail('Signup request failed: Account not created: An error occurred (UsernameExistsException) when calling the SignUp operation: User already exists'); fake.pending = d.account; pr.done(true); return { ok: true }; }
      if (action === 'resend') { pr.done(true); return { ok: true }; }
      if (action === 'confirm') { if (d.code !== '123456') return fail('An error occurred (CodeMismatchException) when calling the ConfirmSignUp operation: Invalid verification code provided, please try again.'); fake.account = fake.pending; pr.done(true); return { ok: true }; }
      if (action === 'login') { if (d.password !== 'right-password') return fail('An error occurred (NotAuthorizedException) when calling the InitiateAuth operation: Incorrect username or password.'); fake.account = d.account; pr.done(true); return { ok: true }; }
    }
    const py = await python();
    if (!py) return fail('Python isn\u2019t installed yet');
    const payload = JSON.stringify({ action, account: String(d.account || ''), password: String(d.password || ''), email: String(d.email || ''), first: String(d.first || ''), last: String(d.last || ''), code: String(d.code || '') });
    const r = await run(py, ['-c', EVS_WRAPPER], payload, 120000, pr.line);
    let res;
    try { res = JSON.parse(lastLine(r.out)); } catch { res = { ok: false, error: lastLine(r.err || r.out) || 'castlabs didn\u2019t answer' }; }
    if (res.ok) { pr.done(true); return { ok: true }; }
    const why = explainEvs(res.error);
    // that name is already your castlabs account (signed in on this PC): nothing left to do
    if (action === 'signup' && why.field === 'account' && evsAccount() && evsAccount().toLowerCase() === String(d.account).toLowerCase()) { pr.line('That account is already yours and signed in'); pr.done(true); return { ok: true, already: true }; }
    // logging into an account whose email was never confirmed: send a fresh code and ask for it
    if (why.needsCode) {
      await run(py, ['-c', EVS_WRAPPER], JSON.stringify({ action: 'resend', account: String(d.account || '') }), 60000, pr.line);
      pr.done(false);
      return { ok: false, needsCode: true, field: 'code', error: '' };
    }
    pr.done(false);
    return { ok: false, ...why };
  });
  // sign this install in place (the exe's .sig), then leave the marker Glass checks at start
  ipcMain.handle('evs:sign', async (e) => {
    const pr = progressFor('sign', e.sender);
    if (EVS_FAKE) {
      for (const l of ['Signing: Glass Player.exe', ' - Checking existing signature', ' - Existing signature invalid: Failed to verify signature', ' - No cached signature found', ' - Acquiring upload slot for mode: single', 'Uploading 48%', 'Uploading 100%', ' - Requesting signature: streaming', ' - Signature request successful: streaming, 1351 days left']) { pr.line(l.trim()); await new Promise((r) => setTimeout(r, 200)); }
      fake.signed = true; pr.done(true); return { ok: true };
    }
    if (process.env.PORTABLE_EXECUTABLE_DIR) { pr.done(false); return { ok: false, error: 'Open the installed Glass (Start menu) to sign it' }; }
    const py = await python();
    if (!py) { pr.done(false); return { ok: false, error: 'Python isn\u2019t installed yet' }; }
    const r = await run(py, ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', appDir()], null, 300000, pr.line);
    if (r.code !== 0) { pr.done(false); return { ok: false, error: 'Signing failed: ' + lastLine(r.err || r.out).replace(ANSI, '').slice(0, 220) }; }
    try { fs.writeFileSync(vmpMarker(), new Date().toISOString()); } catch (err) { pr.done(false); return { ok: false, error: 'Signed, but couldn\u2019t mark it: ' + err.message }; }
    pr.line('Glass is signed');
    pr.done(true);
    return { ok: true };
  });
  ipcMain.handle('evs:relaunch', async (e) => { if (EVS_FAKE) return; await signOff(e.sender); app.relaunch(); app.exit(0); });

  ipcMain.on('sp:log', (_e, line) => spLog(line));
  ipcMain.handle('open-external', (_e, url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || !['open.spotify.com', 'developer.spotify.com', 'genius.com', 'en.wikipedia.org'].includes(u.hostname)) throw new Error('Blocked link');
    return shell.openExternal(u.toString());
  });
}

// what Glass asked Spotify to do and what came back (no tokens), so a skip or stop can be traced;
// userData/spotify-log.txt, kept under ~300 KB
function spLog(line) {
  try {
    const f = path.join(app.getPath('userData'), 'spotify-log.txt');
    if (fs.existsSync(f) && fs.statSync(f).size > 300000) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, new Date().toISOString() + ' ' + String(line).slice(0, 400).replace(/[\r\n]+/g, ' ') + '\n');
  } catch { /* logging never breaks playback */ }
}

// Spotify's in-app player runs in a hidden sdk.scdn.co frame and talks to Spotify's servers by itself, so its
// problems (a refused licence, audio that won't load, an autoplay block) never reach Glass's code. This notes
// them in the log: that frame's console warnings and errors, and how Spotify's servers answered it.
// Only host + path are written (long ids shortened), never query strings or tokens.
function watchPlayer(wc) {
  const short = (u) => { try { const x = new URL(u); return x.host + x.pathname.replace(/[A-Za-z0-9_-]{24,}/g, '…').slice(0, 70); } catch { return '?'; } };
  const clean = (s) => String(s).replace(/https?:\/\/[^\s"')]+/g, short).replace(/[A-Za-z0-9_\-.]{40,}/g, '…');
  let last = '';
  const note = (line) => { if (line !== last) { last = line; spLog(line); } };
  wc.on('console-message', (e) => {
    if (e.level !== 'warning' && e.level !== 'error') return;
    let fr = '';
    try { fr = (e.frame && e.frame.url) || ''; } catch { /* frame already gone */ }
    if (!/scdn\.co|spotify/i.test(String(e.sourceId || '') + ' ' + fr)) return;
    note(`sdk ${e.level}: ${clean(e.message).slice(0, 300)}`);
  });
  const urls = ['*://*.spotify.com/*', '*://*.scdn.co/*', '*://*.spotifycdn.com/*', '*://*.akamaized.net/*'];
  const picture = (host) => /^(i|mosaic|t)\.scdn\.co$|image|seed-mix|lineup/i.test(host);
  const kindOf = (u) => (/license/i.test(u) ? 'licence' : /storage-resolve/i.test(u) ? 'audio lookup'
    : /audio|akamaized|\/mp4\//i.test(u) ? 'audio' : /track-playback|connect-state|playplay|melody/i.test(u) ? 'player' : '');
  const seen = new Map();   // kind -> when a success was last noted (one line per kind every 20 s)
  const wr = wc.session.webRequest;
  wr.onCompleted({ urls }, (d) => {
    let host = '', where = '';
    try { const x = new URL(d.url); host = x.host; where = x.pathname; } catch { return; }
    if (picture(host)) return;
    // the player told Spotify to drop it from your devices (it does this when it's switched off)
    if (d.method === 'DELETE' && /\/track-playback\/v1\/devices\/[^/]+$/.test(where)) {
      note(`player: signed off Spotify (${d.statusCode})`);
      signOffSeen.forEach((f) => f());
      return;
    }
    const kind = kindOf(d.url);
    if (d.statusCode >= 400) { note(`server ${d.statusCode} for ${kind || 'request'} ${short(d.url)}`); return; }
    if (!kind) return;
    const t = Date.now();
    if (t - (seen.get(kind) || 0) < 20000) return;
    seen.set(kind, t);
    note(`server ok (${d.statusCode}) for ${kind} ${short(d.url)}`);
  });
  wr.onErrorOccurred({ urls }, (d) => {
    let host = '';
    try { host = new URL(d.url).host; } catch { return; }
    if (picture(host) || /ERR_ABORTED/.test(d.error)) return;
    note(`network ${d.error} for ${kindOf(d.url) || 'request'} ${short(d.url)}`);
  });
  // any sound element in the window starting or stopping (Spotify's player, or the local player)
  wc.on('media-started-playing', () => note('sound started in Glass'));
  wc.on('media-paused', () => note('sound paused in Glass'));
}

// Glass is closing: the in-app player signs off Spotify first. Spotify keeps listing a player until it does,
// so a Glass that just closed left a second "Glass Player" behind that plays nothing. Resolves once Spotify
// confirms, right away when there was no player, and after `ms` at most.
const signOffSeen = new Set();
function signOff(wc, ms = 1500) {
  return new Promise((resolve) => {
    let t = 0;
    const done = () => { clearTimeout(t); signOffSeen.delete(done); ipcMain.removeListener('sp:off', onOff); resolve(); };
    const onOff = (e, had) => { if (e.sender === wc && !had) done(); };
    t = setTimeout(done, ms);
    signOffSeen.add(done);
    ipcMain.on('sp:off', onOff);
    try { wc.send('sp:sign-off'); } catch { done(); }
  });
}

module.exports = { register, watchPlayer, spLog, signOff };
