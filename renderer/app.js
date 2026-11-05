'use strict';

const api = window.glass;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const body = document.body;
// Two decks (deck.js): while a song plays, the idle deck loads the next one and the worklet splices it in
// sample-exact, so albums play gapless and skips are instant. planAfter() (below) says what comes next.
const deck = new GlassDeck({
  elements: $$('video.deck'),
  planner: (after) => planAfter(after),
  isVideo: (t) => isVideoPath(t.path),
});
let muted = false, lastTransition = 'manual';
const stage = $('#stage');
const seek = $('#seek');
const vol = $('#vol');
const side = $('#side');
const view = $('#view');
const vspace = $('#vspace');

const GLIDE = 'cubic-bezier(.22,.8,.24,1)';
const SOFT = 'cubic-bezier(.33,1.2,.5,1)';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const anim = (el, kf, o = {}) => (el && !reduceMotion ? el.animate(kf, { duration: 480, easing: GLIDE, ...o }) : null);
const done = (a) => (a ? a.finished.catch(() => {}) : Promise.resolve());
const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// ---------- state ----------
const lib = new Map();      // path -> track
let edits = {};             // path -> user overrides { title, artist, album, cover, thumb }
const S = {
  queue: [], cur: -1, shuffle: false, repeat: 'off', history: [],
  view: 'queue',            // queue | library | playlists
  plOpen: null,             // open playlist id (or FAV_ID)
  libOpen: null,            // { by, key } open group page in Library
  playlists: [],
  favs: new Set(),
  expanded: new Set(),      // "by:key" of groups opened by hand: albums (and other groups) start closed
  filter: '',               // search text
  filters: { type: 'all', formats: [], fav: false, missing: false, nocover: false },   // Library filter menu
  lib: { group: 'album', sort: 'title', layout: 'list' },
  wide: false,
  // Settings > Glass (style: liquid | frosted, wall: art | colors | custom). A new install starts clean: the colour
  // background, no extra darkness, no background blur. Saved settings always win over these.
  // wallBlurArt: blur behind the artwork background (max, so it reads as coloured light); wallBlur: behind your own image
  ui: { glow: 55, tint: 0, tintColor: '', style: 'liquid', wall: 'colors', quickEdit: true, zoom: 1, wallBlurArt: 40, wallBlur: 0, wallImg: '', wallImgSize: '' },
  albumArt: {},             // album key -> { cover, thumb } made when songs are dragged together
  tags: [],                 // [{ id, name, color }] (tags.js)
  songTags: {},             // path -> [tag ids]
  plays: {},                // path -> play count (extras.js)
  recent: [],               // recently played paths, newest last (Search > Jump back in)
  browse: false,            // Search tab: browsing the whole collection instead of recommendations
  sideW: 0,                 // dragged side panel width (0 = default)
  from: null,               // the page the playing songs were started from (the song title links back to it)
  // Settings > Playback
  play: { skip: 5, speed: 1, keepPitch: true, xfade: 0 },
  // Settings > Sound (sound.js builds the Web Audio chain from this)
  sound: { bass: 0, treble: 0, eq: [0, 0, 0, 0, 0], preset: 'flat', reverb: 0, room: 'room', even: true, mono: false, wide: 0 },   // Even out volume: on from the start
};
// glow: how strongly the artwork colours wash the glass; tint: how dark the glass is (keeps white text readable)
function applyUi() {
  const r = document.documentElement.style, g = S.ui.glow / 100, t = S.ui.tint / 100;
  r.setProperty('--glow', g.toFixed(2));
  r.setProperty('--tint-a', (0.08 + t * 0.5).toFixed(3));
  r.setProperty('--tint-b', (0.18 + t * 0.5).toFixed(3));
  const blur = S.ui.wall === 'custom' ? S.ui.wallBlur : S.ui.wallBlurArt;
  r.setProperty('--wall-blur', Math.max(0, Math.min(40, +blur || 0)) + 'px');   // Settings > Glass > Background blur (per background)
  // Settings > Glass > Glass colour: a light tint on every panel, and the dark layer behind leans the same way
  const m = /^#([0-9a-f]{6})$/i.exec(S.ui.tintColor || '');
  if (m) {
    const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    r.setProperty('--glass-tint', `rgba(${c.join(',')}, .17)`);
    r.setProperty('--tint-rgb', c.map((v) => Math.round(14 + (v - 14) * 0.28)).join(','));
  } else { r.removeProperty('--glass-tint'); r.removeProperty('--tint-rgb'); }
  window.Liquid?.apply();
}
let libVersion = 0, favVersion = 0, tagVersion = 0;

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => {
  if (!isFinite(t) || t < 0) return '0:00';
  t = Math.floor(t);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
};
const fmtLong = (t) => { const m = Math.round(t / 60); return m >= 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m} min`; };
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const isVideoPath = (p) => /\.(mp4|m4v|webm|mkv|mov)$/i.test(p);
const current = () => S.queue[S.cur];
const titleOf = (t) => t.title || t.name;
const artistOf = (t) => t.artist || (isVideoPath(t.path) ? 'Video' : 'Unknown artist');
const albumOf = (t) => t.album || (isVideoPath(t.path) ? 'Videos' : 'Unknown album');
const subOf = (t) => (t.album ? `${artistOf(t)} — ${t.album}` : artistOf(t));
// every artist on a song: "A x B", "A, B", "A & B", "A feat. B", "A (feat. B)". The joins are kept for display.
const ARTIST_SPLIT = /(\s+x\s+|\s*[,;&]\s*|(?:\s+|\s*[(\[])(?:feat\.?|ft\.?|featuring)\s+)/i;
const partsCache = new Map();
function rawArtistParts(s) {
  const bits = s.split(ARTIST_SPLIT), out = [];
  for (let k = 0; k < bits.length; k += 2) {
    const m = /^([\s([]*)(.*?)([\s)\]]*)$/.exec(bits[k]);
    if (m[2]) out.push({ name: m[2], before: m[1].trim(), after: m[3].trim(), sep: bits[k + 1] || '' });
    else if (out.length) out[out.length - 1].sep += bits[k] + (bits[k + 1] || '');
  }
  return out;
}
// Real acts with a comma or "&" in their name ("Tyler, the Creator", "Earth, Wind & Fire") aren't collabs: they stay
// in one piece. Which ones those are comes from Deezer, checked in the background (checkActs, further down).
const wholeActs = new Set();
const actKey = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}$]+/gu, ' ').trim();
const joinParts = (ps, i, j) => { let s = ''; for (let k = i; k <= j; k++) s += ps[k].name + (k < j ? ps[k].sep : ''); return s; };
function keepActsWhole(ps) {
  if (!wholeActs.size || ps.length < 2) return ps;
  const out = [];
  for (let i = 0; i < ps.length; i++) {
    let j = ps.length - 1;
    while (j > i && !wholeActs.has(actKey(joinParts(ps, i, j)))) j--;
    out.push(j === i ? ps[i] : { name: joinParts(ps, i, j), before: ps[i].before, after: ps[j].after, sep: ps[j].sep });
    i = j;
  }
  return out;
}
function artistParts(s) {
  s = String(s || '');
  let out = partsCache.get(s);
  if (out) return out;
  out = keepActsWhole(rawArtistParts(s));
  if (partsCache.size > 20000) partsCache.clear();
  partsCache.set(s, out);
  return out;
}
const artistNames = (t) => (t.artist ? artistParts(t.artist).map((p) => p.name) : []);
const mainArtist = (t) => (t.artist ? artistParts(t.artist)[0]?.name || t.artist.trim() : artistOf(t));
// writes HTML only when it changed, so a link being hovered isn't replaced under the mouse
function setHTML(el, html) { if (el._h === html && el.firstChild) return; el._h = html; el.innerHTML = html; }
const folderOf = (t) => t.path.slice(0, Math.max(t.path.lastIndexOf('\\'), t.path.lastIndexOf('/')));
const baseName = (p) => p.slice(Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')) + 1);
// --p: filled share as a percentage; --f: the same as a fraction, so the fill can end exactly under the knob's centre
const setFill = (el) => { const f = (el.value - el.min) / (el.max - el.min) || 0; el.style.setProperty('--p', f * 100 + '%'); el.style.setProperty('--f', f); };
const hueFrom = (str) => { let h = 0; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const gradFor = (seed) => { const h = hueFrom(seed); return `linear-gradient(140deg, hsl(${h} 45% 62%), hsl(${(h + 40) % 360} 40% 38%))`; };
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const cssUrl = (u) => `url("${u}")`;
const letterOf = (s) => { const c = String(s || '').trim().charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };
const safeName = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
function guessQuery(t) {
  const name = (t.title || t.name)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*\b(?:v\d|prod|official|audio|video|lyrics?|remaster(?:ed)?|visuali[sz]er)\b[^)]*)\)/gi, ' ')
    .replace(/[^\p{L}\p{N}$&'’ .-]+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const artist = t.artist && !/unknown/i.test(t.artist) ? mainArtist(t) : '';
  return artist && !name.toLowerCase().includes(artist.toLowerCase()) ? `${artist} ${name}` : name;
}

const ICON = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.5 8.1 3.6 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.6 0 5.7 3.6 4.5 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z"/></svg>',
  find: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/><path d="M10.5 7.5v6M7.5 10.5h6"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  video: '<svg class="kind" viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M3 6h12M3 12h12M3 18h8"/><circle cx="18" cy="17" r="3"/><path d="M21 17V6"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L8.5 4.74A1 1 0 0 0 7 5.6Z" fill="currentColor" stroke="none"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 12h11M12 7l5 5-5 5"/><path d="M20 5v14"/></svg>',
  queue: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h10M18 14v8M14 18h8"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
  chevR: '<svg class="chev-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>',
  chevD: '<svg class="chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg class="tick" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
};

// ---------- library + metadata ----------
function trackFor(info) {
  let t = lib.get(info.path);
  if (!t) {
    t = { path: info.path, url: info.url, name: info.name, added: info.added || Date.now() };
    Object.assign(t, edits[t.path] || {});
    lib.set(t.path, t);
    queueMeta(t);
  }
  return t;
}
const metaQ = [], metaUrgent = [];
let metaRunning = false;
function queueMeta(t, urgent = false) {
  if (t.metaState) return;
  t.metaState = 'q';
  (urgent ? metaUrgent : metaQ).push(t);
  pumpMeta();
}
async function pumpMeta() {
  if (metaRunning) return;
  metaRunning = true;
  while (metaUrgent.length || metaQ.length) {
    const batch = metaUrgent.length ? metaUrgent.splice(0, 20) : metaQ.splice(0, 160);
    let res = [];
    try { res = await api.metaBatch(batch.map((t) => t.path)); } catch { /* keep names */ }
    batch.forEach((t, i) => {
      const m = res[i] || {};
      t.missing = !!m.missing;
      Object.assign(t, m, edits[t.path] || {});
      t.metaState = 'done';
    });
    libChanged();
    if (batch.includes(current())) showNow(false);
  }
  metaRunning = false;
  queueActs();
}
let rebuildTimer = 0;
function libChanged() {
  libVersion++;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { rebuild(false); paintHeader(); }, 120);
}

// ---------- ambient: soft colour wash from the artwork ----------
const amb = $('#amb');
const actx = amb.getContext('2d');
const DEFAULT_PAL = [[118, 122, 140], [96, 100, 122], [138, 134, 150], [88, 96, 114], [34, 34, 42]];
let pal = DEFAULT_PAL.map((c) => c.slice());
let palTarget = DEFAULT_PAL.map((c) => c.slice());
const blobs = Array.from({ length: 5 }, (_, i) => ({ ph: Math.random() * 6.28, sx: 0.06 + Math.random() * 0.08, sy: 0.05 + Math.random() * 0.07, r: 0.6 + Math.random() * 0.3, c: i % 4 }));
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
function paletteFromSeed(seed) {
  dimTarget = 0;
  const h = hueFrom(seed);
  palTarget = [hsl(h, 45, 55), hsl((h + 40) % 360, 40, 45), hsl((h + 320) % 360, 45, 50), hsl((h + 180) % 360, 30, 45), hsl(h, 20, 18)];
}
function paletteFromImage(src, seed) {
  const img = new Image();
  if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    let d;
    try { d = x.getImageData(0, 0, 24, 24).data; } catch { paletteFromSeed(seed); return; }
    const buckets = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, n: 0, w: 0 }));
    let ar = 0, ag = 0, ab = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      ar += r; ag += g; ab += b; n++;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 25) continue;
      let h = 0;
      if (mx !== mn) h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
      const bk = buckets[((Math.round(h * 2) % 12) + 12) % 12];
      bk.r += r; bk.g += g; bk.b += b; bk.n++; bk.w += 0.2 + (mx - mn) / mx;
    }
    const picked = buckets.filter((b) => b.n > 2).sort((a, b) => b.w - a.w).slice(0, 4).map((b) => [b.r / b.n, b.g / b.n, b.b / b.n]);
    const avg = [ar / n, ag / n, ab / n];
    dimTarget = dimFor(avg);
    while (picked.length < 4) picked.push(avg);
    picked.push(avg.map((v) => v * 0.3));
    palTarget = picked.map((c) => c.map((v) => Math.round(v)));
  };
  img.onerror = () => paletteFromSeed(seed);
  img.src = src;
}
let level = 0;
// The colour wash behind the glass. Every change to it makes every glass panel redo its blur and bent rim, so it
// only moves while it has somewhere to go: gliding to a new song's colours (or following a video). Once the colours
// have settled it holds still. It used to drift and pulse with the beat 24 times a second, which made the glass rims
// flicker (they bend whatever is behind them) and cost a lot of frame rate on big screens.
let ambClock = 0, ambLast = 0;
// A bright cover would turn the colour wash, and the see-through glass on it, nearly white, and the white text with it.
// So on the colours background the wash is dimmed just enough to keep text readable, only for bright covers; normal
// and dark ones are left exactly as they are. It eases with the colours on each new song. Picture backgrounds (the
// artwork, your own image) don't need this: they get a shadow over just their bright parts (liquid.js).
let dim = 0, dimTarget = 0;
function dimFor([r, g, b]) {
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return Math.max(0, Math.min(1, (y - 0.45) / 0.35)) * 0.62;
}
const dimNow = () => (S.ui.wall === 'colors' ? dimTarget : 0);
const ambSettled = () => Math.abs(dimNow() - dim) < 0.004 && pal.every((c, i) => c.every((v, k) => Math.abs(palTarget[i][k] - v) < 0.6));
function drawAmbient(ts) {
  const w = amb.width, h = amb.height;
  ambClock += Math.min(0.05, Math.max(0, (ts - (ambLast || ts)) / 1000));   // the wash's own clock: stands still while it rests
  ambLast = ts;
  const t = ambClock;
  for (let i = 0; i < pal.length; i++) for (let k = 0; k < 3; k++) pal[i][k] += (palTarget[i][k] - pal[i][k]) * 0.07;   // ~3 s to a new song's colours
  dim += (dimNow() - dim) * 0.07;
  document.documentElement.style.setProperty('--dim', dim.toFixed(3));
  const base = pal[4];
  actx.globalCompositeOperation = 'source-over';
  actx.fillStyle = `rgb(${base[0]} ${base[1]} ${base[2]})`;
  actx.fillRect(0, 0, w, h);
  const v = deck.videoElement;
  if (body.classList.contains('is-video') && v && v.readyState >= 2) actx.drawImage(v, 0, 0, w, h);
  for (const b of blobs) {
    const x = w * (0.5 + 0.45 * Math.sin(t * b.sx + b.ph));
    const y = h * (0.5 + 0.42 * Math.cos(t * b.sy * 1.3 + b.ph * 2));
    const r = b.r * w;
    const c = pal[b.c];
    const g = actx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgb(${c[0]} ${c[1]} ${c[2]} / .7)`);
    g.addColorStop(1, `rgb(${c[0]} ${c[1]} ${c[2]} / 0)`);
    actx.fillStyle = g;
    actx.fillRect(0, 0, w, h);
  }
}

// ---------- audio level ----------
// The Sound chain (EQ, reverb, fades) sits between the decks' mix and the volume; the analyser hears its output.
const analyser = deck.analyser, freq = new Uint8Array(analyser.frequencyBinCount);
deck.ready.then(() => {
  if (!window.Sound) return;
  const { bus, master } = deck.nodes;
  try {
    bus.disconnect();
    const out = Sound.build(deck.ctx, bus);
    out.connect(analyser);
    out.connect(master);
    startBars(out);
  } catch (err) {
    console.error('sound chain', err);
    try { bus.disconnect(); } catch {}
    bus.connect(analyser);
    bus.connect(master);
    startBars(bus);
  }
});
function readLevel() {
  if (deck.paused || muted) return 0;
  analyser.getByteFrequencyData(freq);
  let s = 0;
  for (let i = 1; i < 9; i++) s += freq[i];
  return Math.max(0, (s / 8 / 255 - 0.35) / 0.65);
}

// ---------- the bars on the playing song's cover ----------
// They follow the music itself: the first bar is the low end (808s, kicks), the second the middle (vocals, snares), the
// third the top (hi-hats, ticks). Each band is measured against its own recent loudest and quietest, so a quiet hat
// pattern still moves its bar all the way and a long 808 doesn't just pin it at the top.
let barsAn = null, barsBuf = null, barEls = [], barFind = 0, barLast = 0;
const barBands = [[35, 140], [300, 2500], [5000, 14000]].map((hz) => ({ hz, lv: 0, peak: 0, floor: 1, shown: -1, from: 1, to: 1 }));
function startBars(source) {
  barsAn = deck.ctx.createAnalyser();
  barsAn.fftSize = 2048;                 // fine enough to tell an 808 from the notes above it
  barsAn.smoothingTimeConstant = 0;      // raw: paintBars does its own smoothing
  barsAn.minDecibels = -80;
  barsAn.maxDecibels = -12;
  source.connect(barsAn);
  barsBuf = new Uint8Array(barsAn.frequencyBinCount);
  const perBin = deck.ctx.sampleRate / barsAn.fftSize;
  for (const b of barBands) {
    b.from = Math.max(1, Math.round(b.hz[0] / perBin));
    b.to = Math.min(barsBuf.length - 1, Math.max(b.from, Math.round(b.hz[1] / perBin)));
  }
}
function paintBars(ts) {
  if (ts - barFind > 150) { barFind = ts; barEls = [...document.querySelectorAll('.row.current .eq')].map((e) => e.children); }
  const dt = Math.min(0.1, (ts - barLast) / 1000);
  barLast = ts;
  if (!barEls.length || !barsAn || reduceMotion) return;
  const live = !deck.paused;
  if (live) barsAn.getByteFrequencyData(barsBuf);
  barBands.forEach((b, i) => {
    let target = 0;
    if (live) {
      let sum = 0, top = 0;
      for (let k = b.from; k <= b.to; k++) { const v = barsBuf[k] / 255; sum += v; if (v > top) top = v; }
      const v = (sum / (b.to - b.from + 1) + top) / 2;     // between the band's average and its loudest note
      b.peak = Math.max(v, b.peak - dt * 0.08);            // the loudest lately sinks slowly...
      b.floor = Math.min(v, b.floor + dt * 0.12);          // ...the quietest lately rises slowly
      target = v < 0.02 ? 0 : Math.min(1, (v - b.floor) / Math.max(0.14, b.peak - b.floor));
    }
    b.lv += (target - b.lv) * (1 - Math.exp(-(target > b.lv ? 40 : 7) * dt));   // up with the hit, back down more slowly
    const y = +(0.14 + 0.86 * b.lv).toFixed(3);
    if (y === b.shown) return;
    b.shown = y;
    for (const bars of barEls) if (bars[i]) bars[i].style.transform = `scaleY(${y})`;
  });
}

// ---------- frame loop (touches only the few elements that move) ----------
const artEl = $('#art');
let seeking = false, lastSec = -1, lastAmb = 0;
function tick(ts) {
  requestAnimationFrame(tick);
  const target = readLevel();
  level += (target - level) * (target > level ? 0.3 : 0.07);
  if (body.classList.contains('has-track') && !body.classList.contains('wide')) artEl.style.scale = (1 + level * 0.035).toFixed(4);
  const ambLive = body.classList.contains('is-video') || !ambSettled() || !lastAmb;   // !lastAmb: the very first paint
  if (ambLive && ts - lastAmb > 42) { lastAmb = ts; drawAmbient(ts); }
  else if (!ambLive) ambLast = 0;
  paintBars(ts);
  window.Extras?.drift?.(ts);
  const d = deck.duration;
  if (!seeking && d && isFinite(d) && !deck.paused) {
    const c = deck.currentTime;
    seek.value = (c / d) * 1000;
    setFill(seek);
    const sec = Math.floor(c);
    if (sec !== lastSec) { lastSec = sec; $('#tCur').textContent = fmt(c); }
  }
  window.Extras?.tick();
  window.Lyrics?.tick();
}

// ---------- now playing ----------
let lastShown = null, palKey = null;
function loadCover(t) {
  if (t.cover || t.coverLoading || (edits[t.path] && 'cover' in edits[t.path]) || !t.hasCover) return;
  t.coverLoading = true;
  api.cover(t.path).then((u) => { t.coverLoading = false; if (u) { t.cover = u; if (t === current()) showNow(false); } }).catch(() => { t.coverLoading = false; });
}
function showNow(animate) {
  const t = current();
  body.classList.toggle('has-track', !!t);
  if (!t) {
    $('#dockTitle').textContent = 'Nothing playing';
    setHTML($('#dockSub'), 'Open something to start');
    $('#nowTitle').title = $('#dockTitle').title = '';
    $('#dockThumb').style.backgroundImage = '';
    $('#dockThumb').classList.add('placeholder');
    document.title = 'Glass Player';
    window.Liquid?.art('');
    lastShown = null;
    window.Lyrics?.track(null);
    return;
  }
  const title = titleOf(t), sub = subOf(t);
  $('#nowTitle').textContent = title;
  const parts = t.artist ? artistParts(t.artist) : [{ name: artistOf(t), plain: true }];
  if (typeof nowSubHTML === 'function') { setHTML($('#nowSub'), nowSubHTML(parts, t.album || '')); setHTML($('#dockSub'), nowSubHTML(parts, t.album || '')); }
  else { $('#nowSub').textContent = sub; $('#dockSub').textContent = sub; }
  $('#nowTitle').title = $('#dockTitle').title = `Playing from ${fromLabel()}`;
  $('#nowQ').textContent = typeof qualityText === 'function' ? qualityText(t) : '';
  $('#dockTitle').textContent = title;
  document.title = `${title} — Glass Player`;
  paintHeart($('#btnFav'), S.favs.has(t.path), false);
  loadCover(t);

  const big = t.cover || t.thumb, small = t.thumb || t.cover;
  const artImg = $('#artImg'), thumb = $('#dockThumb');
  artImg.style.backgroundImage = big ? cssUrl(big) : '';
  artImg.classList.toggle('placeholder', !big);
  thumb.style.backgroundImage = small ? cssUrl(small) : '';
  thumb.classList.toggle('placeholder', !small);

  window.Liquid?.art(big);
  const key = t.path + '|' + (small || '');
  if (key !== palKey) { palKey = key; small ? paletteFromImage(small, title) : paletteFromSeed(title); }

  if (animate && lastShown !== t) {
    anim($('#artWrap'), [{ transform: 'scale(.86)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900 });
    anim($('#nowMeta'), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 80, fill: 'backwards' });
    anim($('#dockText'), [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 600 });
    anim(thumb, [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700 });
  }
  lastShown = t;
  window.Lyrics?.track(t);

  // Windows' media pop-up (volume keys, lock screen) shows the song with its cover; refreshed once the cover loads
  if ('mediaSession' in navigator) {
    const art = big || small;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: t.artist || '', album: t.album || '',
      artwork: art ? [{ src: art, sizes: '720x720', type: /\.png(\?|$)/i.test(art) ? 'image/png' : 'image/jpeg' }] : [] });
  }
  syncMedia();
}

// ---------- playback ----------
let restoreAt = 0;
function play(i, autoplay = true) {
  const t = S.queue[i];
  if (!t) return;
  const prev = current();
  if (prev && prev !== t) S.history.push(prev);
  S.cur = i;
  S.recent = [...S.recent.filter((p) => p !== t.path), t.path].slice(-40);
  body.classList.toggle('is-video', isVideoPath(t.path));
  deck.jump(t, { autoplay, at: restoreAt });   // instant when it's the preloaded song
  restoreAt = 0;
  queueMeta(t, true);
  showNow(true);
  stateChanged(false);   // leave the list where the user scrolled it; the playing row just lights up
  paintHeader();
  save();
}
// clicking the song that's already on: start it over
function clickPlaying() {
  deck.seek(0);
  if (deck.paused) deck.play();
}
function togglePlay() {
  if (!current()) { if (S.queue.length) play(0); return; }
  if (deck.paused) deck.play(); else deck.pause();   // no audible fade (the engine's 40 ms ramp only stops a click)
}
// speed + pitch survive track changes, on both decks
function applySpeed() {
  for (const v of deck.elements) {
    v.defaultPlaybackRate = v.playbackRate = S.play.speed || 1;
    v.preservesPitch = S.play.keepPitch !== false;
  }
  paintSpeed();
}
// the speed button next to Lyrics: shows the speed ("1×", "1.25×") and opens the choices
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const speedText = (v) => `${+(v || 1).toFixed(2)}\u00d7`;
function paintSpeed() {
  const b = $('#btnSpeed');
  if (!b) return;
  const v = S.play.speed || 1, txt = speedText(v), lab = $('#speedLabel');
  if (lab.textContent !== txt) { lab.textContent = txt; anim(lab, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SOFT }); }
  b.classList.toggle('on', v !== 1);
  b.title = `Speed: ${txt}`;
}
$('#btnSpeed').addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  openMenu(rect, () => [{ header: 'Speed' },
    ...SPEEDS.map((v) => ({ label: speedText(v) + (v === 1 ? '  normal' : ''), checked: (S.play.speed || 1) === v, keep: true, act: () => { S.play.speed = v; applySpeed(); save(); } })),
    '-',
    { label: 'Keep pitch', checked: S.play.keepPitch !== false, keep: true, act: () => { S.play.keepPitch = S.play.keepPitch === false; applySpeed(); save(); } }]);
});
// sleep timer: pause after N minutes, or when the current song ends
let sleepTimer = 0, sleepAtEnd = false, sleepUntil = 0;
function setSleep(mins) {
  clearTimeout(sleepTimer);
  sleepAtEnd = mins === 'end';
  sleepUntil = typeof mins === 'number' && mins > 0 ? Date.now() + mins * 60000 : 0;
  if (sleepUntil) sleepTimer = setTimeout(() => { sleepUntil = 0; if (!deck.paused) togglePlay(); toast('Sleep timer: paused'); }, mins * 60000);
  queueChanged();   // "end of song": nothing gets lined up after this one
}
// ---------- up next: decided ahead of time, preloaded, and topped up by Autoplay ----------
// While a song plays, the next one is already chosen (even on shuffle) and the idle deck loads it, so it starts
// gapless (or crossfades) and a skip is instant. Tags, full cover, palette and lyrics are warmed up as well.
let upNextT = null, upNextFor = null, prepTimer = 0;
const autoSet = new Set();        // paths Autoplay added to the queue (shown under an "Autoplay" label)
function pickNext(wrap, from = S.cur) {
  const n = S.queue.length;
  if (!n || from < 0) return n ? 0 : -1;
  if (S.shuffle && n > 1) {
    const recent = new Set(S.history.slice(-Math.min(n - 1, 50)));
    const pool = S.queue.map((t, i) => i).filter((i) => i !== from && i !== S.cur && !recent.has(S.queue[i]));
    const src = pool.length ? pool : S.queue.map((t, i) => i).filter((i) => i !== from);
    return src[Math.floor(Math.random() * src.length)];
  }
  const i = from + 1;
  return i < n ? i : wrap || S.repeat === 'all' ? 0 : -1;
}
// the song after the current one; the same pick until the queue, order or current song changes,
// so shuffle doesn't re-roll and the preloaded deck stays valid
function chooseNext() {
  const cur = current();
  if (!cur || sleepAtEnd) return null;
  maybeAutoplay();
  if (!(upNextFor === cur && upNextT && upNextT !== cur && S.queue.includes(upNextT) && (S.shuffle || upNextT === S.queue[pickNext(false)]))) {
    upNextT = S.queue[pickNext(false)] || null;
    upNextFor = cur;
  }
  return upNextT;
}
// the deck asks this whenever it lines up a song (repeat-one loops inside the deck)
function planAfter(after) {
  if (!after) return null;
  if (after === current()) return chooseNext();
  const i = S.queue.indexOf(after);        // a file that wouldn't play: the one after it
  return i < 0 ? null : S.queue[pickNext(false, i)] || null;
}
function prepareNext() {
  deck.invalidate();                      // asks planAfter() again; keeps the preload if the answer is the same
  const t = chooseNext();
  if (!t || t === current()) return;
  queueMeta(t, true);
  loadCover(t);
  const art = t.cover || t.thumb;
  if (art) { const im = new Image(); im.src = art; im.decode?.().catch(() => {}); }
  window.Lyrics?.prefetch(t);
}
const scheduleNext = () => { clearTimeout(prepTimer); prepTimer = setTimeout(prepareNext, 120); };
const queueChanged = scheduleNext;   // queue, order, shuffle or repeat changed

// Autoplay: when the queue is about to run out, add songs like the one playing.
// Same artist counts most, then album, genre and folder; favorites get a nudge; recent plays are skipped.
// opts.anyQueue: recommendations may include songs that are already queued (Autoplay itself never repeats them)
function autoplayPicks(seed, count, opts = {}) {
  const recent = new Set([...S.history.slice(-80), ...(opts.anyQueue ? [seed] : S.queue)].map((t) => t.path));
  const vid = isVideoPath(seed.path);
  const ar = seed.artist ? mainArtist(seed).toLowerCase() : '', al = (seed.album || '').toLowerCase(), ge = (seed.genre || '').toLowerCase(), fo = folderOf(seed);
  const scored = [];
  for (const t of lib.values()) {
    if (recent.has(t.path) || t.error || t.missing || isVideoPath(t.path) !== vid) continue;
    let s = Math.random() * 3;
    if (ar && t.artist && mainArtist(t).toLowerCase() === ar) s += 5;
    if (al && (t.album || '').toLowerCase() === al) s += 3;
    if (ge && (t.genre || '').toLowerCase() === ge) s += 3;
    if (folderOf(t) === fo) s += 1.5;
    if (S.favs.has(t.path)) s += 1;
    scored.push([s, t]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const perArtist = new Map(), out = [];
  for (const [, t] of scored) {          // at most 4 by one artist, so it doesn't turn into one album on repeat
    const k = mainArtist(t).toLowerCase(), c = perArtist.get(k) || 0;
    if (c >= 4) continue;
    perArtist.set(k, c + 1);
    out.push(t);
    if (out.length >= count) break;
  }
  return out;
}
function maybeAutoplay() {
  if (S.repeat !== 'off' || S.shuffle || S.cur < 0) return;
  if (S.queue.length - S.cur - 1 > 1) return;          // top up when one song or fewer is left
  const seed = current();
  if (!seed) return;
  const picks = autoplayPicks(seed, 10);
  if (!picks.length) return;
  for (const t of picks) autoSet.add(t.path);
  S.queue.push(...picks);
  if (S.view === 'queue') rebuild(false);
  paintHeader();
  save();
}
const sleepState = () => (sleepAtEnd ? 'end' : sleepUntil ? Math.max(1, Math.round((sleepUntil - Date.now()) / 60000)) : 0);
// manual next (songs ending move on inside the deck): the song already chosen and preloaded, else wrap around
function next() {
  if (!S.queue.length) return;
  const t = chooseNext() || S.queue[pickNext(true)] || S.queue[0];
  play(S.queue.indexOf(t));
}
function prev() {
  if (deck.currentTime > 3) { deck.seek(0); return; }
  const n = S.queue.length;
  if (!n) return;
  if (S.shuffle && S.history.length) {
    const i = S.queue.indexOf(S.history.pop());
    if (i !== -1) { play(i); S.history.pop(); return; }
  }
  play((S.cur - 1 + n) % n);
}
// where the side panel is right now (playlist, album, artist, search...), so the song title can lead back
const navHere = () => ({ view: S.view, plOpen: S.plOpen, libOpen: S.libOpen && { ...S.libOpen }, browse: S.browse, filter: S.filter });
const fromGroup = (g) => ({ view: 'library', plOpen: null, libOpen: { by: g.by, key: g.key, name: g.name }, browse: S.browse, filter: '' });
function fromLabel() {
  const f = S.from;
  if (!f || f.view === 'queue') return 'the queue';
  if (f.plOpen) return f.plOpen === FAV_ID ? 'Favorites' : S.playlists.find((p) => p.id === f.plOpen)?.name || 'a playlist';
  if (f.libOpen) return f.libOpen.name || f.libOpen.key;
  if (f.filter) return `a search for “${f.filter}”`;
  return f.view === 'playlists' || f.browse ? 'your library' : 'Search';
}
// open a tab (and a page inside it) the same way clicking around would
function navTo(name, mutate) {
  closeMenu();
  if (name !== S.view) {
    $('#segInd').style.setProperty('--k', VIEWS.indexOf(name));
    anim($('#segInd i'), [{ transform: 'scale(1)' }, { transform: 'scale(1.12, .9)' }, { transform: 'scale(1)' }], { duration: 700 });
    $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  }
  const dir = Math.sign(VIEWS.indexOf(name) - VIEWS.indexOf(S.view)) || 1;
  return transitionView(dir, () => {
    S.view = name; S.plOpen = null; S.libOpen = null;
    S.filter = ''; $('#search').value = '';
    mutate?.();
    if (S.view === 'queue') { S.filter = ''; $('#search').value = ''; }
  });
}
// the song title: go to the playlist / album / artist / search the music is playing from
async function goFrom() {
  if (!current()) return;
  const f = S.from || { view: 'queue' };
  await navTo(f.view, () => {
    S.plOpen = f.plOpen || null;
    S.libOpen = f.libOpen ? { ...f.libOpen } : null;
    S.browse = !!f.browse;
    S.filter = f.filter || '';
    $('#search').value = f.filter || '';
    // a list grouped by album / artist / folder: open the group the song is in (groups start closed)
    const by = S.libOpen ? null : S.lib.group;
    if (S.view === 'library' && by && by !== 'none') S.expanded.add(`${by}:${groupOf(current(), by).key}`);
  });
  revealCurrent();
}
// the playing song in the list: glide it to the middle and give it a soft glow so it's easy to spot
function revealCurrent() {
  const t = current();
  if (!t) return;
  const i = items.findIndex((it) => it.kind === 'row' && (it.ctx === 'queue' ? it.i === S.cur : it.track === t));
  if (i < 0) return;
  const H = view.clientHeight, top = Math.max(0, offs[i] - H / 2 + items[i].h / 2);
  view.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  const it = items[i];
  const glow = (tries) => {
    const n = [...vspace.querySelectorAll('.vi.row')].find((x) => items[x._vi] === it);
    if (!n) { if (tries) setTimeout(() => glow(tries - 1), 250); return; }
    n.classList.remove('found');
    void n.offsetWidth;                  // restart the glow if it's already running
    n.classList.add('found');
    setTimeout(() => n.classList.remove('found'), 2800);
  };
  setTimeout(() => glow(4), 380);
}
function playCollection(tracks, start, shuffle = false, from = navHere()) {
  if (!tracks.length) return;
  S.from = from;
  S.queue = tracks.slice();
  autoSet.clear();
  S.history = [];
  S.cur = -1;
  if (shuffle) { S.shuffle = true; paintShuffle(); }
  play(Math.max(0, start ? S.queue.indexOf(start) : shuffle ? Math.floor(Math.random() * S.queue.length) : 0));
  if (S.view === 'queue') rebuild(false);
}
function addTracks(infos, { playFirst = false } = {}) {
  const tracks = infos.map(trackFor);
  if (!tracks.length) return;
  const inQ = new Set(S.queue);
  const fresh = tracks.filter((t) => !inQ.has(t));
  const start = S.queue.length;
  S.queue.push(...fresh);
  if (playFirst || S.cur === -1) play(fresh.length ? start : S.queue.indexOf(tracks[0]), playFirst || S.cur === -1);
  else queueChanged();
  libChanged();
  save();
  if (fresh.length > 1) toast(`Added ${plural(fresh.length, 'song')}`);
}
function addToQueue(tracks) {
  const inQ = new Set(S.queue);
  const fresh = tracks.filter((t) => !inQ.has(t));
  S.queue.push(...fresh);
  if (S.cur === -1 && S.queue.length) play(0, false);
  queueChanged();
  if (S.view === 'queue') rebuild(false);
  save();
  toast(fresh.length ? 'Added to queue' : 'Already in queue');
}
function playNext(t) {
  const j = S.queue.indexOf(t);
  if (j === S.cur && j !== -1) return;
  if (j !== -1) { S.queue.splice(j, 1); if (j < S.cur) S.cur--; }
  S.queue.splice(S.cur + 1, 0, t);
  queueChanged();
  if (S.view === 'queue') rebuild(false);
  save();
  toast('Plays next');
}
function releaseQueueIndex(i) {
  const wasCurrent = i === S.cur;
  const t = S.queue[i];
  S.queue.splice(i, 1);
  S.history = S.history.filter((h) => h !== t);
  if (wasCurrent) {
    const playing = !deck.paused;
    if (S.queue.length) { S.cur = -1; play(Math.min(i, S.queue.length - 1), playing); } else stopAll();
  } else if (i < S.cur) S.cur--;
  queueChanged();
}
function stopAll() {
  deck.stop();
  S.cur = -1;
  S.history = [];
  body.classList.remove('is-video', 'playing');
  palKey = null;
  palTarget = DEFAULT_PAL.map((c) => c.slice());
  showNow(false);
  stateChanged();
}
async function clearQueue() {
  if (!S.queue.length) return;
  const nodes = [...mounted.values()].slice(0, 18);
  await Promise.all(nodes.map((n, k) => done(anim(n, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(30px)' }], { duration: 320, delay: k * 18, fill: 'forwards', easing: 'ease-in' }))));
  S.queue = [];
  autoSet.clear();
  stopAll();
  rebuild(false);
  paintHeader();
  save();
}

// ---------- grouping + sorting (cached per library version) ----------
const GROUPS = { none: 'None', album: 'Album', artist: 'Artist', folder: 'Folder' };
const SORTS = { title: 'Title', artist: 'Artist', album: 'Album', added: 'Recently added', duration: 'Length' };
const LAYOUTS = { list: 'List', compact: 'Compact', grid: 'Grid' };
// fuzzy search (search.js): sound-alikes (vampire = vampyre, cash = Ca$h) and small typos still match
const searchIx = GlassSearch.createIndex((t) => [titleOf(t), t.artist || '', t.album || '', t.name]);
function searchQuery() { searchIx.sync(lib.values(), libVersion); return searchIx.query(S.filter); }
// tags: "#name" in the search box shows songs with a matching tag
const tagsOf = (t) => S.songTags[t.path] || [];
const tagQuery = () => (S.filter.startsWith('#') ? S.filter.slice(1).trim().toLowerCase() : null);
const tagMatch = (t, q) => tagsOf(t).some((id) => (S.tags.find((x) => x.id === id)?.name || '').toLowerCase().includes(q));
const matches = (t) => { if (!S.filter) return true; const tq = tagQuery(); return tq !== null ? tagMatch(t, tq) : searchQuery().score(t) > 0; };
const nameMatches = (name) => !S.filter || GlassSearch.match(name, S.filter) > 0;

// ---------- filters (Library only): type, formats and "show only" toggles, ANDed with the search ----------
const TYPES = { all: 'All', music: 'Music', video: 'Videos' };
const TOGGLES = { fav: 'Favorites', missing: 'Missing info', nocover: 'No cover art' };
const TOGGLE_TIPS = { missing: 'No artist or album tag', nocover: 'No artwork' };
const noFilters = () => ({ type: 'all', formats: [], fav: false, missing: false, nocover: false, tags: [], quality: [] });
// type and format come from the path, which never changes them, so each track works them out once
const fmtOf = (t) => (t._f ??= (/\.([^.\\/]+)$/.exec(t.path)?.[1] || '').toLowerCase());
const isVid = (t) => (t._vid ??= isVideoPath(t.path));
const fmtFits = (x, type = S.filters.type) => type === 'all' || (type === 'video') === isVideoPath('.' + x);
const filtersOn = () => { const f = S.filters; return f.type !== 'all' || f.formats.length > 0 || f.fav || f.missing || f.nocover || f.tags.length > 0 || f.quality.length > 0; };
function passesFilters(t) {
  const f = S.filters;
  return (f.type === 'all' || (f.type === 'video') === isVid(t))
    && (!f.formats.length || f.formats.includes(fmtOf(t)))
    && (!f.fav || S.favs.has(t.path))
    && (!f.missing || !t.artist || !t.album)
    && (!f.nocover || !(t.thumb || t.cover))
    && (!f.tags.length || tagsOf(t).some((id) => f.tags.includes(id)))
    && (!f.quality.length || f.quality.includes(qualityOf(t)));
}
// part of the libraryData() cache key; favourites only matter while that toggle is on
const filterKey = () => { const f = S.filters; return `${f.type}|${f.formats.join()}|${+f.fav}${+f.missing}${+f.nocover}${f.fav ? '|' + favVersion : ''}${f.tags.length ? '|t' + f.tags.join() + ':' + tagVersion : ''}${f.quality.length ? '|q' + f.quality.join() : ''}`; };
function readFilters(f) {
  const out = noFilters();
  if (!f || typeof f !== 'object') return out;
  if (Object.hasOwn(TYPES, f.type)) out.type = f.type;
  if (Array.isArray(f.formats)) out.formats = [...new Set(f.formats.filter((x) => typeof x === 'string' && /^[a-z0-9]{1,8}$/.test(x) && fmtFits(x, out.type)))];
  for (const k in TOGGLES) out[k] = f[k] === true;
  if (Array.isArray(f.tags)) out.tags = f.tags.filter((id) => typeof id === 'string');
  if (Array.isArray(f.quality)) out.quality = f.quality.filter((k) => ['hires', 'cd', 'hq', 'sq', 'lq'].includes(k));
  return out;
}
// what the whole Library holds, for the menu counts. Ignores search and filters so numbers stay put while you click.
let invKey = -1, inv = null;
function filterInventory() {
  if (invKey === libVersion) return inv;
  const fmts = new Map();
  let video = 0, missing = 0, nocover = 0;
  for (const t of lib.values()) {
    const x = fmtOf(t);
    fmts.set(x, (fmts.get(x) || 0) + 1);
    if (isVid(t)) video++;
    if (!t.artist || !t.album) missing++;
    if (!(t.thumb || t.cover)) nocover++;
  }
  invKey = libVersion;
  const vidFmt = (x) => isVideoPath('.' + x);   // audio formats first, then video, each by count
  return (inv = { fmts: [...fmts].sort((a, b) => vidFmt(a[0]) - vidFmt(b[0]) || b[1] - a[1] || coll.compare(a[0], b[0])), music: lib.size - video, video, missing, nocover });
}
function chipList() {
  const f = S.filters, out = [];
  if (S.view !== 'library') return out;
  if (f.type !== 'all') out.push({ k: 'type', label: TYPES[f.type] });
  for (const x of f.formats) out.push({ k: 'fmt:' + x, label: x.toUpperCase() });
  for (const k in TOGGLES) if (f[k]) out.push({ k, label: TOGGLES[k] });
  for (const k of f.quality) out.push({ k: 'q:' + k, label: QUALITY[k] });
  for (const id of f.tags) { const tg = S.tags.find((x) => x.id === id); if (tg) out.push({ k: 'tag:' + id, label: tg.name, color: tg.color }); }
  if (out.length > 1) out.push({ k: 'clear', label: 'Clear all' });
  return out;
}
let derivedKey = '', derived = null;
function sortKeyFn(sort) {
  if (sort === 'artist') return (a, b) => coll.compare(artistOf(a), artistOf(b)) || coll.compare(albumOf(a), albumOf(b)) || (a.trackNo || 999) - (b.trackNo || 999) || coll.compare(titleOf(a), titleOf(b));
  if (sort === 'album') return (a, b) => coll.compare(albumOf(a), albumOf(b)) || (a.trackNo || 999) - (b.trackNo || 999) || coll.compare(titleOf(a), titleOf(b));
  if (sort === 'added') return (a, b) => (b.added || 0) - (a.added || 0);
  if (sort === 'duration') return (a, b) => (b.duration || 0) - (a.duration || 0);
  return (a, b) => coll.compare(titleOf(a), titleOf(b));
}
const sortField = (t, sort) => (sort === 'artist' ? artistOf(t) : sort === 'album' ? albumOf(t) : titleOf(t));
// Album grouping, worked out over the whole library (so filters/search don't reshuffle it):
// a real album needs 2+ songs. Strays (one-song albums, untagged songs) gather under their artist's name
// when that artist has 2+ of them; anything left goes to "Unknown album".
let albumPlanV = -1, albumPlan = null;
function planAlbums() {
  if (albumPlanV === libVersion) return albumPlan;
  const count = new Map(), strays = new Map();
  for (const t of lib.values()) if (t.album) { const k = t.album.toLowerCase(); count.set(k, (count.get(k) || 0) + 1); }
  const known = (t) => (t.artist && !/^unknown/i.test(t.artist) ? mainArtist(t) : '');
  for (const t of lib.values()) {
    if (t.album && count.get(t.album.toLowerCase()) >= 2) continue;
    const a = known(t).toLowerCase();
    if (a) strays.set(a, (strays.get(a) || 0) + 1);
  }
  albumPlanV = libVersion;
  return (albumPlan = { count, strays, known });
}
function albumGroupOf(t) {
  const { count, strays, known } = planAlbums();
  if (t.album && count.get(t.album.toLowerCase()) >= 2) return { key: t.album.toLowerCase(), name: t.album, special: false };
  const a = known(t);
  if (a && strays.get(a.toLowerCase()) >= 2) return { key: '~artist:' + a.toLowerCase(), name: a, special: false, merged: true };
  return { key: '~unknown', name: isVideoPath(t.path) && !t.album ? 'Videos' : 'Unknown album', special: true };
}
function groupOf(t, by) {
  if (by === 'album') return albumGroupOf(t);
  if (by === 'artist') { const a = mainArtist(t); return { key: a.toLowerCase(), name: a, special: !t.artist }; }
  const f = folderOf(t);
  return { key: f.toLowerCase(), name: baseName(f) || f, path: f, special: false };
}
// an artist's page: their own songs plus the ones they're featured on ("A x B" opens for B too)
function withFeatured(g, open, tracks) {
  const key = open.key;
  const extra = tracks.filter((t) => t.artist && mainArtist(t).toLowerCase() !== key && artistNames(t).some((a) => a.toLowerCase() === key));
  if (!extra.length) return g;
  const all = g ? [...g.tracks, ...extra] : extra;
  return { by: 'artist', key, name: open.name || key, special: false, sub: '', ...(g || {}),
    tracks: all, thumb: g?.thumb || all.find((t) => t.thumb)?.thumb, duration: all.reduce((s, t) => s + (t.duration || 0), 0) };
}
function libraryData() {
  // while searching the Library root, results are one flat list ranked by relevance; inside an open album/artist/folder they filter in place
  const ranked = !!S.filter && !S.libOpen;
  const by = S.libOpen ? S.libOpen.by : S.lib.group;
  const k = `${libVersion}|${S.filter}|${by}|${S.lib.sort}|${filterKey()}|${ranked}`;
  if (k === derivedKey) return derived;
  let tracks = [...lib.values()].filter(passesFilters).sort(sortKeyFn(S.lib.sort));
  const tq = S.filter ? tagQuery() : null;
  if (tq !== null) tracks = tracks.filter((t) => tagMatch(t, tq));
  else if (S.filter) { const q = searchQuery(); tracks = ranked ? searchIx.search(S.filter, tracks) : tracks.filter((t) => q.score(t) > 0); }
  let groups = null;
  if (by !== 'none' && !ranked) {
    const m = new Map();
    for (const t of tracks) {
      const g = groupOf(t, by);
      let e = m.get(g.key);
      if (!e) m.set(g.key, (e = { ...g, by: by, tracks: [] }));
      e.tracks.push(t);
    }
    groups = [...m.values()];
    const inner = by === 'album' ? sortKeyFn('album') : by === 'artist' ? sortKeyFn('artist') : (a, b) => coll.compare(a.name, b.name);
    for (const g of groups) {
      if (S.lib.sort !== 'added' && S.lib.sort !== 'duration') g.tracks.sort(inner);
      const artists = new Set(g.tracks.map((t) => t.artist).filter(Boolean));
      g.sub = g.merged ? 'Singles' : g.special ? '' : by === 'album' ? (artists.size === 1 ? [...artists][0] : artists.size ? 'Various artists' : '')
        : by === 'folder' ? g.path : '';
      g.thumb = (g.by === 'album' && S.albumArt[g.key]?.thumb) || g.tracks.find((t) => t.thumb)?.thumb;
      g.duration = g.tracks.reduce((s, t) => s + (t.duration || 0), 0);
      g.added = Math.max(...g.tracks.map((t) => t.added || 0));
    }
    if (S.lib.sort === 'added') groups.sort((a, b) => b.added - a.added);
    // biggest first: the albums/artists/folders with the most songs lead, unknowns go last
    else groups.sort((a, b) => a.special - b.special || b.tracks.length - a.tracks.length || coll.compare(a.name, b.name));
  }
  derivedKey = k;
  derived = { tracks, groups };
  return derived;
}

// ---------- item builders (virtual list) ----------
const isCompact = () => S.view === 'library' && S.lib.layout === 'compact';
const rowH = () => (isCompact() ? 40 : 58);
function thumbHTML(t, n) {
  const style = t.thumb ? ` style="background-image:url('${t.thumb}')"` : '';
  const inner = t.thumb ? '' : isVideoPath(t.path) ? ICON.video : `<span class="n">${n}</span>`;
  return `<div class="thumb"${style}>${inner}<div class="eq"><i></i><i></i><i></i></div></div>`;
}
function rowItem(t, ctx, i, n, col, grouped = false) {
  const compact = isCompact();
  return {
    kind: 'row', key: `${ctx}:${t.path}`, h: rowH(), track: t, ctx, i, col, grouped,
    letter: letterOf(sortField(t, S.lib.sort)),
    html: () => `<div class="vi row${compact ? ' compact' : ''}${grouped ? ' in-group' : ''}${t.missing || t.error ? ' error' : ''}">
      ${compact ? `<span class="num">${n}</span><div class="eq"><i></i><i></i><i></i></div>` : thumbHTML(t, n)}
      <div class="row-text">${compact
        ? `<div class="row-title">${esc(titleOf(t))}<span class="row-artist">${esc(artistOf(t))}</span>${window.Tags?.rowHTML(t, true) || ""}</div>`
        : `<div class="row-title">${esc(titleOf(t))}${window.Tags?.rowHTML(t) || ""}</div><div class="row-sub">${esc(artistOf(t))}<span class="rs-album">${t.album ? ' — ' + esc(t.album) : ''}</span></div>`}</div>
      ${compact || grouped ? '' : `<div class="row-album">${esc(t.album || '')}</div>`}
      <span class="row-dur">${typeof qBadge === 'function' ? qBadge(t) : ''}${t.duration ? fmt(t.duration) : ''}</span>
      <button class="heart" data-heart title="Favorite">${ICON.heart}</button>
      <button class="dots" data-dots title="More">${ICON.dots}</button>
    </div>`,
  };
}
function artStyle(thumb, seed) { return thumb ? `background-image:url('${thumb}')` : `background-image:${gradFor(seed)}`; }
const groupIcon = (by) => (by === 'artist' ? ICON.person : by === 'folder' ? ICON.folder : ICON.note);
function groupSub(g) { return [g.sub, plural(g.tracks.length, 'song'), g.duration ? fmtLong(g.duration) : ''].filter(Boolean).join(' · '); }
function headItem(g) {
  return {
    kind: 'head', key: `head:${g.by}:${g.key}`, h: 100, group: g, ckey: `${g.by}:${g.key}`, letter: letterOf(g.name),
    html: () => `<div class="vi ghead">
      <div class="g-art" style="${artStyle(g.thumb, g.name)}">${g.thumb ? '' : groupIcon(g.by)}</div>
      <div><div class="g-name">${esc(g.name)}</div><div class="g-sub">${esc(groupSub(g))}</div></div>
      <span class="g-btns">${g.by === 'album' && !g.special ? `<button class="ibtn xs album-edit" data-gedit title="Edit album">${ICON.edit}</button>` : ''}<button class="ibtn xs album-play" data-gplay title="Play">${ICON.play}</button></span>
      ${ICON.chevD}
    </div>`,
  };
}
function tileItems(cards, keyBase) {
  const W = Math.max(200, vspace.clientWidth || view.clientWidth - 30);
  const cols = Math.max(2, Math.floor((W + 12) / 168));
  const cw = (W - 4 - (cols - 1) * 12) / cols;
  const h = Math.round(cw - 14 + 64 + 12);
  const out = [];
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols);
    out.push({
      kind: 'tiles', key: `${keyBase}:${row[0].key}`, h, cards: row, letter: row[0].letter, base: keyBase, cols,
      html: () => `<div class="vi tiles" style="--cols:${cols}">${row.map((c, j) => `<button class="card${c.cls ? ' ' + c.cls : ''}" data-ci="${j}" data-ck="${esc(c.key)}">
        <div class="card-art" style="${c.art}">${c.icon || ''}</div>
        <div class="card-name">${esc(c.name)}</div><div class="card-sub">${esc(c.sub)}</div></button>`).join('')}</div>`,
    });
  }
  return out;
}
const miscItem = (key, h, html, extra = {}) => ({ kind: 'misc', key, h, html: () => `<div class="vi">${html}</div>`, ...extra });
const emptyItem = (title, sub, btn = '') => miscItem(`empty:${title}`, 150, `<div class="view-empty"><b>${esc(title)}</b><span>${esc(sub)}</span>${btn}</div>`);
function noMatchItem(title) {
  if (!filtersOn()) return emptyItem(title || 'No matches', 'Try a different search');
  return emptyItem(title || 'Nothing matches these filters', S.filter ? 'Try a different search, or clear the filters' : 'Turn a filter off to see more',
    '<button class="btn" data-act="clear-filters">Clear filters</button>');
}
const backItem = (label, back) => miscItem(`back:${label}`, 44, `<button class="back" data-back>${ICON.back}${esc(label)}</button>`, { back });
function heroItem(key, { art, icon = '', cls = '', title, sub, editable = false, actions = '' }) {
  return miscItem(`hero:${key}`, 140, `<div class="hero">
    <div class="hero-art ${cls}${editable ? ' editable' : ''}" ${editable ? 'data-hero-edit title="Change image"' : ''} style="${art}">${icon}</div>
    <div><h3>${esc(title)}</h3><p>${esc(sub)}</p><div class="hero-actions">
      <button class="btn-play" data-hero-play>${ICON.play}Play</button>
      <button class="ibtn xs" data-hero-shuffle title="Shuffle">${ICON.shuffle}</button>${actions}
    </div></div></div>`);
}

const FAV_ID = '__fav';
const favPlaylist = () => ({ id: FAV_ID, name: 'Favorites', virtual: true, image: null, paths: [...S.favs] });
const openPl = () => (S.plOpen === FAV_ID ? favPlaylist() : S.playlists.find((p) => p.id === S.plOpen));
const plTracks = (p) => p.paths.map((x) => lib.get(x)).filter(Boolean);
const plArt = (p) => (p.virtual ? 'background-image:linear-gradient(140deg, #ff7d9c, #b8407f)' : artStyle(p.thumb || p.image, p.name + p.id));

function buildItems() {
  const items = buildItemsInner();
  if (S.view === 'library' && S.browse && !S.libOpen && !S.filter) items.unshift(backItem('Search', () => transitionView(-1, () => { S.browse = false; })));
  return items;
}
function buildItemsInner() {
  const items = [];
  if (S.view === 'queue') {
    if (!S.queue.length) items.push(emptyItem('Queue is empty', 'Play something from your Library, or drop files here', '<button class="btn" data-act="open-folder">Add a folder</button>'));
    let labeled = false;
    S.queue.forEach((t, i) => {
      if (!matches(t)) return;
      if (!labeled && autoSet.has(t.path) && i > S.cur) {
        labeled = true;
        items.push(miscItem('autoplay-label', 46, `<div class="auto-label">${ICON.shuffle}<b>Autoplay</b><span>Songs like what you're playing</span></div>`));
      }
      items.push(rowItem(t, 'queue', i, i + 1));
    });
    if (S.queue.length && items.length === 0) items.push(emptyItem('No matches', 'Try a different search'));
    return items;
  }

  if (S.view === 'playlists') {
    const p = openPl();
    if (p) {
      const tracks = plTracks(p);
      const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
      items.push(backItem('Playlists', () => transitionView(-1, () => { S.plOpen = null; })));
      items.push(heroItem(p.id, {
        art: plArt(p), icon: p.virtual ? ICON.heart : p.image ? '' : ICON.list, cls: p.virtual ? 'fav' : '',
        title: p.name, sub: `${plural(tracks.length, 'song')}${dur ? ' · ' + fmtLong(dur) : ''}`, editable: !p.virtual,
        actions: p.virtual ? '' : `<button class="ibtn xs" data-pl-edit title="Edit name and image">${ICON.edit}</button><button class="ibtn xs" data-pl-delete title="Delete playlist">${ICON.trash}</button>`,
      }));
      items[items.length - 1].col = tracks;
      const rows = tracks.filter(matches);
      rows.forEach((t, i) => items.push(rowItem(t, 'pl', i, i + 1, tracks)));
      if (!tracks.length) items.push(p.virtual ? emptyItem('No favorites yet', 'Tap the heart on any song') : emptyItem('Nothing here yet', 'Use ••• on any song → Add to playlist'));
      return items;
    }
    const cards = [
      { key: 'new', name: 'New playlist', sub: 'Name it, give it a cover', art: 'background-color:rgba(255,255,255,.08)', icon: ICON.plus, act: () => playlistModal() },
      { key: FAV_ID, cls: 'fav', name: 'Favorites', sub: plural(plTracks(favPlaylist()).length, 'song'), art: plArt(favPlaylist()), icon: ICON.heart, act: () => transitionView(1, () => { S.plOpen = FAV_ID; }) },
      ...S.playlists.filter((p) => nameMatches(p.name)).map((p) => ({
        key: p.id, name: p.name, sub: plural(plTracks(p).length, 'song'), art: plArt(p), icon: p.image ? '' : ICON.list,
        act: () => transitionView(1, () => { S.plOpen = p.id; }),
      })),
    ];
    return tileItems(cards, 'plg');
  }

  // library
  if (!lib.size) return [emptyItem('Your library is empty', 'Add a folder of music to get started', '<button class="btn primary" data-act="open-folder">Add a folder</button>')];
  const { tracks, groups } = libraryData();
  if (S.libOpen) {
    let g = groups?.find((x) => x.by === S.libOpen.by && x.key === S.libOpen.key);
    if (S.libOpen.by === 'artist') g = withFeatured(g, S.libOpen, tracks);
    const back = backItem(GROUPS[S.libOpen.by] === 'Album' ? 'Albums' : GROUPS[S.libOpen.by] === 'Artist' ? 'Artists' : 'Folders', () => transitionView(-1, () => { S.libOpen = null; }));
    // search or filters hid everything in the open album/artist/folder: stay on its page instead of jumping to the root
    if (!g && S.libOpen.name && (S.filter || filtersOn())) return [back, noMatchItem(`Nothing in “${S.libOpen.name}” matches`)];
    if (!g) { S.libOpen = null; return buildItems(); }
    if (g.by === 'artist' && typeof localArtistItems === 'function') return localArtistItems(g, back);
    items.push(back);
    const canEdit = g.by === 'album' && !g.special;
    const h = heroItem(`${g.by}:${g.key}`, { art: artStyle(g.thumb, g.name), icon: g.thumb ? '' : groupIcon(g.by), title: g.name, sub: groupSub(g), editable: canEdit,
      actions: canEdit ? `<button class="ibtn xs" data-hero-edit title="Edit album">${ICON.edit}</button>` : '' });
    h.group = g;
    h.col = g.tracks;
    items.push(h);
    g.tracks.forEach((t, i) => items.push(rowItem(t, 'lib', i, i + 1, g.tracks)));
    return items;
  }
  if (!S.filter && !S.browse && !filtersOn() && typeof recItems === 'function') return recItems();
  if (!tracks.length) return [noMatchItem()];
  if (S.filter && typeof searchExtras === 'function') items.push(...searchExtras(S.filter));
  if (!groups) {
    if (S.lib.layout === 'grid') {
      return tileItems(tracks.map((t) => ({
        key: t.path, name: titleOf(t), sub: artistOf(t), art: artStyle(t.thumb, titleOf(t)), icon: t.thumb ? '' : ICON.note,
        letter: letterOf(sortField(t, S.lib.sort)), track: t, act: () => (t === current() ? clickPlaying() : playCollection(randomQueueFor(t), t)),
      })), 'sg');
    }
    tracks.forEach((t, i) => items.push(rowItem(t, 'lib', i, i + 1, tracks)));
    return items;
  }
  if (S.lib.layout === 'grid') {
    return tileItems(groups.map((g) => ({
      key: g.key, name: g.name, sub: `${g.sub ? g.sub + ' · ' : ''}${plural(g.tracks.length, 'song')}`, art: artStyle(g.thumb, g.name),
      icon: g.thumb ? '' : groupIcon(g.by), letter: letterOf(g.name),
      act: () => transitionView(1, () => { S.libOpen = { by: g.by, key: g.key, name: g.name }; }),
    })), 'gg');
  }
  for (const g of groups) {
    items.push(headItem(g));
    if (S.expanded.has(`${g.by}:${g.key}`) || S.filter) g.tracks.forEach((t, i) => items.push(rowItem(t, 'lib', i, i + 1, g.tracks, true)));
  }
  return items;
}

// ---------- virtual list engine ----------
let items = [], offs = [], heads = [];
const mounted = new Map();
let enterUntil = 0, enterCount = 0, stateV = 0;
const tpl = document.createElement('template');
const fromHTML = (h) => { tpl.innerHTML = h.trim(); return tpl.content.firstElementChild; };

function setItems(next, animate) {
  items = next;
  offs = new Array(items.length);
  heads = [];
  let y = 0;
  for (let i = 0; i < items.length; i++) { offs[i] = y; y += items[i].h; if (items[i].kind === 'head') heads.push(i); }
  vspace.style.height = y + 'px';
  if (animate) {
    for (const n of mounted.values()) n.remove();
    mounted.clear();
    enterUntil = performance.now() + 450;
    enterCount = 0;
  }
  buildAZ();
  paint();
}
function rebuild(animate = false) { setItems(buildItems(), animate); }
function indexAt(y) {
  let lo = 0, hi = offs.length - 1, ans = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (offs[m] <= y) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function applyState(node, it) {
  if (it.kind === 'row') {
    const t = it.track;
    node.classList.toggle('current', it.ctx === 'queue' ? it.i === S.cur : t === current());
    node.querySelector('.heart')?.classList.toggle('on', S.favs.has(t.path));
  } else if (it.kind === 'head') node.classList.toggle('collapsed', !S.expanded.has(it.ckey) && !S.filter);
  else if (it.kind === 'tiles') {
    const cur = current();
    it.cards.forEach((c, j) => node.children[j]?.classList.toggle('current', !!c.track && c.track === cur));
  }
}
function paint() {
  const top = view.scrollTop, H = view.clientHeight || 600;
  const want = new Set();
  const now = performance.now();
  if (items.length) {
    for (let i = indexAt(Math.max(0, top - 300)); i < items.length && offs[i] < top + H + 300; i++) {
      const it = items[i];
      want.add(it.key);
      const html = (it._html ??= it.html());
      let node = mounted.get(it.key);
      if (!node || node._html !== html) {
        const fresh = fromHTML(html);
        fresh._html = html;
        fresh.style.height = it.h + 'px';
        fresh.style.top = offs[i] + 'px';
        fresh._top = offs[i];
        if (node) node.replaceWith(fresh);
        else {
          vspace.appendChild(fresh);
          if (now < enterUntil && enterCount < 22) { fresh.classList.add('enter'); fresh.style.setProperty('--d', `${enterCount++ * 26}ms`); }
        }
        mounted.set(it.key, fresh);
        node = fresh;
        node._sv = -1;
      } else if (node._top !== offs[i]) {
        node.style.top = offs[i] + 'px';
        node._top = offs[i];
      }
      if (node.style.height !== it.h + 'px') node.style.height = it.h + 'px';
      node._vi = i;
      if (node._sv !== stateV) { applyState(node, it); node._sv = stateV; }
    }
  }
  for (const [k, n] of mounted) if (!want.has(k)) { n.remove(); mounted.delete(k); }
  paintSticky(top);
}
let paintQueued = false;
view.addEventListener('scroll', () => {
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => { paintQueued = false; paint(); });
  if (menuNode) closeMenu();   // only menus anchored to a row; header menus (View options, Filter) stay open while the list resets
}, { passive: true });
// Card grids follow the panel while it moves (dragging its edge, resizing the window): every frame the rows
// take the cards' new height, so cards grow and shrink smoothly instead of overlapping and snapping into
// place afterwards. When a column comes or goes, the cards glide from where they were to their new spots.
function retile() {
  if (!items.some((i) => i.kind === 'tiles')) return;
  const next = [];
  let run = null;
  const flush = () => { if (run) next.push(...tileItems(run.cards, run.base)); run = null; };
  for (const it of items) {
    if (it.kind !== 'tiles') { flush(); next.push(it); continue; }
    if (!run || run.base !== it.base) { flush(); run = { base: it.base, cards: [] }; }
    run.cards.push(...it.cards);
  }
  flush();
  const was = items.find((i) => i.kind === 'tiles'), now = next.find((i) => i.kind === 'tiles');
  const moved = was && now && was.cols !== now.cols;
  // rows follow the cards' height at once while the panel moves (their usual .5s glide would trail behind)
  vspace.classList.add('retiling');
  clearTimeout(retileT);
  retileT = setTimeout(() => vspace.classList.remove('retiling'), 250);
  const before = new Map();
  if (moved && !reduceMotion) vspace.querySelectorAll('.card[data-ck]').forEach((c) => before.set(c.dataset.ck, c.getBoundingClientRect()));
  setItems(next, false);
  if (!before.size) return;
  vspace.querySelectorAll('.card[data-ck]').forEach((c) => {
    const a = before.get(c.dataset.ck);
    if (!a) return;
    const b = c.getBoundingClientRect();
    if (!b.width || (Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1)) return;
    c.style.transformOrigin = '0 0';
    anim(c, [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})` }, { transform: 'none' }], { duration: 460 });
  });
}
let lastW = 0, retileT = 0;
new ResizeObserver(() => {
  const w = view.clientWidth;
  side.classList.toggle('roomy', w >= 500);
  if (Math.abs(w - lastW) > 0.5) { lastW = w; retile(); }
  paint();
}).observe(view);

let winResizeT = 0;
window.addEventListener('resize', () => {
  body.classList.add('win-resizing');
  clearTimeout(winResizeT);
  winResizeT = setTimeout(() => body.classList.remove('win-resizing'), 250);
}, { passive: true });

function stateChanged(scroll = false) {
  stateV++;
  paint();
  if (scroll) scrollToCurrent();
  scheduleNext();
}
function scrollToCurrent() {
  const t = current();
  if (!t) return;
  const i = items.findIndex((it) => it.kind === 'row' && (it.ctx === 'queue' ? it.i === S.cur : it.track === t));
  if (i < 0) return;
  const y = offs[i], top = view.scrollTop, H = view.clientHeight;
  if (y < top || y + items[i].h > top + H) view.scrollTo({ top: Math.max(0, y - H / 3), behavior: 'smooth' });
}

// sticky group label
const sticky = $('#vsticky');
sticky.title = 'Back to the top of this album';
sticky.addEventListener('click', () => {
  if (stickyFor < 0 || offs[stickyFor] == null) return;
  view.scrollTo({ top: Math.max(0, offs[stickyFor]), behavior: reduceMotion ? 'auto' : 'smooth' });
});
let stickyFor = -1;
function paintSticky(top) {
  if (!heads.length || S.lib.layout === 'grid') { sticky.classList.remove('on'); stickyFor = -1; return; }
  let h = -1;
  for (let lo = 0, hi = heads.length - 1; lo <= hi;) { const m = (lo + hi) >> 1; if (offs[heads[m]] <= top) { h = heads[m]; lo = m + 1; } else hi = m - 1; }
  const on = h >= 0 && offs[h] < top - 8;
  if (on && h !== stickyFor) {
    const g = items[h].group;
    sticky.innerHTML = `${esc(g.name)}<small>${esc(plural(g.tracks.length, 'song'))}</small>`;
    stickyFor = h;
  }
  sticky.classList.toggle('on', on);
}

// A–Z scrubber
const az = $('#az'), azBubble = $('#azBubble');
const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
let azMap = new Map();
function buildAZ() {
  // groups are ordered by size now, so the A–Z rail only makes sense for the flat, alphabetical list
  const usable = S.view === 'library' && !S.libOpen && !S.filter && S.lib.group === 'none' && ['title', 'artist', 'album'].includes(S.lib.sort) && items.length > 30;
  side.classList.toggle('has-az', usable);
  if (!usable) return;
  azMap = new Map();
  items.forEach((it, i) => { if (it.letter && !azMap.has(it.letter) && (it.kind === 'head' || it.kind === 'tiles' || (it.kind === 'row' && S.lib.group === 'none'))) azMap.set(it.letter, offs[i]); });
  az.innerHTML = LETTERS.map((l) => `<span class="${azMap.has(l) ? '' : 'off'}">${l}</span>`).join('');
}
function azJump(clientY) {
  const r = az.getBoundingClientRect();
  const k = Math.max(0, Math.min(LETTERS.length - 1, Math.floor(((clientY - r.top) / r.height) * LETTERS.length)));
  let l = LETTERS[k];
  if (!azMap.has(l)) {        // nearest letter that exists
    for (let d = 1; d < LETTERS.length; d++) {
      if (azMap.has(LETTERS[k + d])) { l = LETTERS[k + d]; break; }
      if (azMap.has(LETTERS[k - d])) { l = LETTERS[k - d]; break; }
    }
  }
  if (!azMap.has(l)) return;
  view.scrollTop = azMap.get(l);
  azBubble.textContent = l;
  azBubble.style.top = `${Math.max(0, clientY - r.top - 18)}px`;
  azBubble.classList.add('on');
  $$('span', az).forEach((s) => s.classList.toggle('hot', s.textContent === l));
}
az.addEventListener('pointerdown', (e) => { az.setPointerCapture(e.pointerId); az.classList.add('drag'); azJump(e.clientY); });
az.addEventListener('pointermove', (e) => { if (az.classList.contains('drag')) azJump(e.clientY); });
const azEnd = () => { az.classList.remove('drag'); azBubble.classList.remove('on'); $$('span.hot', az).forEach((s) => s.classList.remove('hot')); };
az.addEventListener('pointerup', azEnd);
az.addEventListener('pointercancel', azEnd);

// ---------- header + views ----------
function paintHeader() {
  side.dataset.view = S.view;
  let title = 'Queue', sub = plural(S.queue.length, 'song');
  if (S.view === 'library') {
    const g = S.libOpen ? GROUPS[S.libOpen.by] : null;
    title = 'Search';
    sub = g ? `${g} · ${S.libOpen.name || S.libOpen.key}`
      : lib.size && (S.filter || filtersOn()) ? `${libraryData().tracks.length.toLocaleString()} of ${plural(lib.size, 'song')}`
      : !S.browse ? 'Recommended for you'
      : `Browsing ${plural(lib.size, 'song')} · by ${GROUPS[S.lib.group] === 'None' ? SORTS[S.lib.sort].toLowerCase() : GROUPS[S.lib.group].toLowerCase()}`;
  } else if (S.view === 'playlists') {
    const p = openPl();
    title = p ? 'Playlist' : 'Library';
    sub = p ? p.name : plural(S.playlists.length + 1, 'playlist');
  } else if (S.queue.length) {
    const left = S.queue.slice(Math.max(S.cur, 0)).reduce((s, t) => s + (t.duration || 0), 0);
    if (left) sub += ` · ${fmtLong(left)} left`;
  }
  $('#sideTitle').textContent = title;
  $('#sideSub').textContent = sub;
  paintChips();
}
async function transitionView(dir, mutate) {
  const out = anim(view, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-dir * 14}px)` }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
  await done(out);
  mutate?.();
  view.scrollTop = 0;
  rebuild(true);
  paintHeader();
  out?.cancel();
  anim(view, [{ opacity: 0, transform: `translateX(${dir * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 520 });
  save();
}
const VIEWS = ['queue', 'library', 'playlists'];
// Each tab keeps its own search text (Search and Library); the Queue has no search box.
const searchBy = {};
function swapSearch(to) {
  clearTimeout(searchTimer);
  const box = $('#search');
  if (S.view !== 'queue') searchBy[S.view] = { raw: box.value, f: S.filter };
  const s = to === 'queue' ? null : searchBy[to];
  S.filter = s ? s.f : '';
  box.value = s ? s.raw : '';
  if (to === 'queue') box.blur();
}
function setView(name) {
  if (name === S.view && !S.plOpen && !S.libOpen) return;
  const dir = Math.sign(VIEWS.indexOf(name) - VIEWS.indexOf(S.view)) || -1;
  $('#segInd').style.setProperty('--k', VIEWS.indexOf(name));
  anim($('#segInd i'), [{ transform: 'scale(1)' }, { transform: 'scale(1.12, .9)' }, { transform: 'scale(1)' }], { duration: 700 });
  $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  transitionView(dir, () => { if (name !== S.view) swapSearch(name); S.view = name; S.plOpen = null; S.libOpen = null; });
}
$$('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

let searchTimer = 0;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { S.filter = e.target.value.trim().toLowerCase(); view.scrollTop = 0; rebuild(false); paintHeader(); }, 110);
});

// ---------- list interactions ----------
function rowActivate(it) {
  const t = it.track;
  if (t === current()) { clickPlaying(); return; }
  if (it.ctx === 'queue') play(it.i);
  else if (playsInOrder(it)) playCollection(it.col || [t], t);
  else playCollection(randomQueueFor(t), t);
}
// albums, playlists (and Favorites) and folders play in their order; a song picked from anywhere else
// (search, recommendations, All songs, an artist) starts a random queue from the whole library
function playsInOrder(it) {
  if (it.ctx === 'pl') return true;
  const by = S.libOpen ? S.libOpen.by : it.grouped ? S.lib.group : null;
  return !S.filter && (by === 'album' || by === 'folder');
}
function randomQueueFor(t) {
  const vid = isVideoPath(t.path);
  const pool = [...lib.values()].filter((x) => x !== t && !x.missing && !x.error && isVideoPath(x.path) === vid);
  for (let k = pool.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
  return [t, ...pool.slice(0, 200)];
}
// album drop-down: songs ghost out from under the header (faded, soft, staggered) and fold back up on close;
// everything that stays on screen glides to its new place instead of jumping
let toggling = false;
async function toggleGroup(it, node) {
  if (toggling) return;
  toggling = true;
  const k = it.ckey, g = it.group, closing = S.expanded.has(k);
  const inGroup = (n) => { const x = items[n._vi]; return x && x.kind === 'row' && g.tracks.includes(x.track); };
  try {
    if (closing && !reduceMotion) {
      const rows = [...mounted.values()].filter((n) => inGroup(n) && n._top > node._top).sort((a, b) => a._top - b._top);
      await Promise.all(rows.map((n, j) => done(anim(n, [
        { opacity: 1, transform: 'none', filter: 'none' },
        { opacity: 0, transform: `translateY(${-Math.min(60, (n._top - node._top) * 0.3)}px) scale(.97)`, filter: 'blur(4px)' },
      ], { duration: 260, delay: (rows.length - 1 - j) * 16, easing: 'cubic-bezier(.4,0,.8,.4)', fill: 'forwards' }))));
    }
    const before = new Map();
    for (const [key, n] of mounted) before.set(key, n._top);
    S.expanded.has(k) ? S.expanded.delete(k) : S.expanded.add(k);
    stateV++;
    rebuild(false);
    save();
    if (reduceMotion) return;
    let j = 0;
    for (const [key, n] of mounted) {
      if (before.has(key)) {
        const dy = before.get(key) - n._top;
        if (dy) anim(n, [{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 560 });
      } else if (!closing && inGroup(n)) {
        anim(n, [
          { opacity: 0, transform: 'translateY(-16px) scale(.97)', filter: 'blur(5px)' },
          { opacity: 0.55, transform: 'translateY(-4px) scale(.99)', filter: 'blur(1.5px)', offset: 0.5 },
          { opacity: 1, transform: 'none', filter: 'none' },
        ], { duration: 620, delay: j++ * 28, fill: 'backwards' });
      }
    }
  } finally { toggling = false; }
}
vspace.addEventListener('click', (e) => {
  const node = e.target.closest('.vi');
  if (!node) return;
  const it = items[node._vi];
  if (!it) return;
  const q = (s) => e.target.closest(s);
  let el;
  if ((el = q('[data-act]'))) { act(el.dataset.act); return; }
  if ((el = q('[data-browse]'))) { browseBy(el.dataset.browse); return; }
  if ((el = q('[data-recshuffle]'))) { reshuffleRecs(); return; }
  if ((el = q('[data-ext]'))) { api.openExternal(el.dataset.ext).catch((err) => toast(cleanErr(err), true)); return; }
  if (q('[data-back]')) { it.back(); return; }
  if (it.kind === 'row') {
    if (q('[data-heart]')) { toggleFav(it.track, q('[data-heart]')); return; }
    if ((el = q('[data-dots]'))) { openTrackMenu(node, it, el.getBoundingClientRect()); return; }
    rowActivate(it);
    return;
  }
  if (it.kind === 'head') {
    if (q('[data-gedit]')) { albumEditModal(it.group); return; }
    if (q('[data-gplay]')) { playCollection(it.group.tracks, it.group.tracks[0], false, fromGroup(it.group)); return; }
    toggleGroup(it, node);
    return;
  }
  if (it.kind === 'tiles') {
    if ((el = q('[data-ci]'))) it.cards[+el.dataset.ci].act();
    return;
  }
  const col = it.col || [];
  if (q('[data-hero-play]')) playCollection(col, col[0]);
  else if (q('[data-hero-shuffle]')) playCollection(col, null, true);
  else if (q('[data-hero-edit]') && it.group) albumEditModal(it.group);
  else if (q('[data-pl-edit]') || q('[data-hero-edit]')) { const p = openPl(); if (p && !p.virtual) playlistModal(p); }
  else if (q('[data-pl-delete]')) { const p = openPl(); if (p && !p.virtual) deletePlaylist(p); }
});
vspace.addEventListener('contextmenu', (e) => {
  // right-click an album/artist/folder header: play it or tag every song in it at once
  const head = e.target.closest('.vi.ghead');
  if (head && items[head._vi]?.group) {
    e.preventDefault();
    const g = items[head._vi].group;
    openMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, () => [
      { label: `Play “${g.name}”`, icon: ICON.play, act: () => playCollection(g.tracks, g.tracks[0], false, fromGroup(g)) },
      { label: 'Add to queue', icon: ICON.queue, act: () => addToQueue(g.tracks) },
      ...(g.by === 'album' && !g.special ? [{ label: 'Edit album…', icon: ICON.edit, act: () => albumEditModal(g) }] : []),
      { label: `Tag all ${plural(g.tracks.length, 'song')}`, icon: Tags.ICON, sub: () => Tags.menuItems(g.tracks) },
    ]);
    return;
  }
  const node = e.target.closest('.vi.row');
  if (!node) return;
  e.preventDefault();
  openTrackMenu(node, items[node._vi], { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
});
// ---------- drag a song onto another song → new album; onto an album header → add it there ----------
let drag = null, swallowClick = false;
const ghost = document.createElement('div');
ghost.className = 'drag-ghost glass';
ghost.hidden = true;
document.body.appendChild(ghost);
function dropTargetAt(x, y) {
  const node = document.elementFromPoint(x, y)?.closest('#vspace .vi');
  const it = node && items[node._vi];
  if (!it) return null;
  if (it.kind === 'row' && it.track && it.track !== drag.it.track) return { node, it, kind: 'song' };
  if (it.kind === 'head' && it.group.by === 'album' && !it.group.special && !it.group.merged && !it.group.tracks.includes(drag.it.track)) return { node, it, kind: 'album' };
  return null;
}
function dragScrollLoop() {
  if (!drag?.on) return;
  const r = view.getBoundingClientRect(), y = drag.cy;
  const v = y < r.top + 50 ? -(r.top + 50 - y) / 3 : y > r.bottom - 50 ? (y - (r.bottom - 50)) / 3 : 0;
  if (v) view.scrollTop += Math.max(-18, Math.min(18, v));
  requestAnimationFrame(dragScrollLoop);
}
vspace.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const node = e.target.closest('.vi.row');
  if (!node || e.target.closest('button')) return;
  const it = items[node._vi];
  if (it?.track) drag = { it, x: e.clientX, y: e.clientY, cx: e.clientX, cy: e.clientY, on: false, target: null };
});
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.cx = e.clientX; drag.cy = e.clientY;
  if (!drag.on) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.on = true;
    const t = drag.it.track;
    ghost.innerHTML = `<span class="dg-art" style="${artStyle(t.thumb, titleOf(t))}">${t.thumb ? '' : ICON.note}</span><span class="dg-text"><b>${esc(titleOf(t))}</b><small>Drop on a song to make an album</small></span>`;
    ghost.hidden = false;
    body.classList.add('dragging-song');
    anim(ghost, [{ opacity: 0, transform: 'scale(.8)' }, { opacity: 1, transform: 'none' }], { duration: 320 });
    requestAnimationFrame(dragScrollLoop);
  }
  ghost.style.translate = `${e.clientX + 14}px ${e.clientY + 10}px`;
  const tg = dropTargetAt(e.clientX, e.clientY);
  if (drag.target?.node !== tg?.node) {
    drag.target?.node.classList.remove('drop-target');
    tg?.node.classList.add('drop-target');
    $('small', ghost).textContent = tg?.kind === 'album' ? `Add to “${tg.it.group.name}”` : tg ? 'Let go to make an album' : 'Drop on a song to make an album';
  }
  drag.target = tg;
});
async function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  swallowClick = true;
  setTimeout(() => { swallowClick = false; }, 0);
  body.classList.remove('dragging-song');
  d.target?.node.classList.remove('drop-target');
  await done(anim(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.85)' }], { duration: 220, fill: 'forwards' }));
  ghost.hidden = true;
  ghost.getAnimations().forEach((a) => a.cancel());
  if (e.type !== 'pointerup' || !d.target) return;
  const t = d.it.track;
  if (d.target.kind === 'song') albumModal([d.target.it.track, t]);
  else setAlbum([t], d.target.it.group.name, `Added to “${d.target.it.group.name}”`);
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);
vspace.addEventListener('click', (e) => { if (swallowClick) { e.stopImmediatePropagation(); swallowClick = false; } }, true);

function setAlbum(tracks, name, msg) {
  for (const t of tracks) {
    const e = (edits[t.path] = { ...(edits[t.path] || {}), album: name });
    Object.assign(t, e);
  }
  libChanged();
  save();
  if (tracks.includes(current())) showNow(false);
  if (msg) toast(msg);
}
// edit an album: its name (written to every song in it, Glass-side) and its cover
function albumEditModal(g) {
  let art = S.albumArt[g.key] || null, changedArt = false;
  const thumbNow = () => art?.thumb || g.thumb;
  openModal(`
    <h3 class="modal-title">Edit album</h3>
    <div class="pl-edit">
      <button type="button" class="pl-pick album-new" data-art-pick title="Change cover"><div class="pl-pick-img" data-art></div><span class="cover-hint">Change cover</span></button>
      <div class="fields">
        <label class="field"><span>Album name</span><input type="text" name="a_name" value="${esc(g.merged ? '' : g.name)}" placeholder="${esc(g.name)}" maxlength="120" /></label>
        <p class="note">${plural(g.tracks.length, 'song')}${g.sub ? ' · ' + esc(g.sub) : ''}. The new name goes on every song in this album.</p>
      </div>
    </div>
    <div class="modal-actions">${S.albumArt[g.key] ? '<button type="button" class="btn ghost" data-art-reset>Use song artwork</button>' : ''}<span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">Save</button></div>`, {
    onMount(form) {
      const img = $('[data-art]', form);
      const paint = (pop) => {
        const u = art?.cover || thumbNow();
        img.style.backgroundImage = u ? cssUrl(u) : gradFor(g.name);
        if (pop) anim(img, [{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 700 });
      };
      paint(false);
      $('[data-art-pick]', form).addEventListener('click', (e) => Art.coverMenu(e.currentTarget.getBoundingClientRect(), {
        current: art?.cover || g.tracks.find((t) => t.cover)?.cover || thumbNow(),
        onPick: (r) => { art = r; changedArt = true; paint(true); },
      }));
      $('[data-art-reset]', form)?.addEventListener('click', () => { art = null; changedArt = true; paint(true); });
    },
    onSubmit(form) {
      const name = form.elements.a_name.value.trim().replace(/\s+/g, ' ') || g.name;
      const newKey = name.toLowerCase();
      if (changedArt) { if (art) S.albumArt[g.key] = art; else delete S.albumArt[g.key]; }
      if (newKey !== g.key || g.merged) {
        if (S.albumArt[g.key]) { S.albumArt[newKey] = S.albumArt[g.key]; if (newKey !== g.key) delete S.albumArt[g.key]; }
        if (S.expanded.delete('album:' + g.key)) S.expanded.add('album:' + newKey);
        setAlbum(g.tracks, name, `Renamed to “${name}”`);
        if (S.libOpen && S.libOpen.by === 'album' && S.libOpen.key === g.key) S.libOpen = { by: 'album', key: newKey, name };
      } else { libChanged(); save(); toast('Album saved'); }
      rebuild(false);
      paintHeader();
    },
  });
}
// name the new album; its cover is made from the songs' artwork
function albumModal(tracks) {
  let art = null;
  const artists = new Set(tracks.map((t) => t.artist).filter(Boolean));
  openModal(`
    <h3 class="modal-title">New album</h3>
    <div class="pl-edit">
      <button type="button" class="pl-pick album-new" data-art-pick title="Change cover"><div class="pl-pick-img" data-art></div><span class="cover-hint">Change cover</span></button>
      <div class="fields">
        <label class="field"><span>Album name</span><input type="text" name="a_name" placeholder="Name this album" maxlength="120" /></label>
        <p class="note">${esc(tracks.map(titleOf).join(' + '))}${artists.size === 1 ? ` · ${esc([...artists][0])}` : ''}</p>
      </div>
    </div>
    <div class="modal-actions"><span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Make album</button></div>`, {
    onMount(form) {
      const img = $('[data-art]', form);
      const urls = tracks.map((t) => t.cover || t.thumb).filter(Boolean);
      img.style.backgroundImage = gradFor(tracks.map(titleOf).join());
      img.classList.add('loading');
      api.collage(urls).then((r) => {
        img.classList.remove('loading');
        if (!r) return;
        art = r;
        img.style.backgroundImage = cssUrl(r.cover);
        anim(img, [{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 700 });
      }).catch(() => img.classList.remove('loading'));
      $('[data-art-pick]', form).addEventListener('click', (e) => Art.coverMenu(e.currentTarget.getBoundingClientRect(), {
        current: art?.cover,
        onPick: (r) => { art = r; img.style.backgroundImage = cssUrl(r.cover); anim(img, [{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 700 }); },
      }));
      setTimeout(() => form.elements.a_name.focus(), 80);
    },
    onSubmit(form) {
      const name = form.elements.a_name.value.trim().replace(/\s+/g, ' ');
      if (!name) { form.elements.a_name.focus(); return false; }
      if (art) S.albumArt[name.toLowerCase()] = art;
      setAlbum(tracks, name, `Made “${name}”`);
    },
  });
}

async function collapseNode(node) {
  if (!node) return;
  node.style.pointerEvents = 'none';
  await done(anim(node, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(30px) scale(.96)' }], { duration: 300, fill: 'forwards', easing: 'ease-in' }));
}

// ---------- favourites ----------
function toggleFav(t, btn) {
  if (!t) return;
  const on = !S.favs.has(t.path);
  on ? S.favs.add(t.path) : S.favs.delete(t.path);
  favVersion++;
  stateChanged();
  if (btn) paintHeart(btn, on);
  if (t === current()) paintHeart($('#btnFav'), on);
  save();
  if (S.view === 'playlists') {
    if (!on && S.plOpen === FAV_ID) setTimeout(() => rebuild(false), 350);
    else if (!S.plOpen) rebuild(false);
  } else if (S.view === 'library' && S.filters.fav) setTimeout(() => { rebuild(false); paintHeader(); }, 350);
  toast(on ? 'Added to Favorites' : 'Removed from Favorites');
}
function paintHeart(btn, on, animate = true) {
  if (!btn) return;
  btn.classList.toggle('on', on);
  if (!animate) return;
  btn.classList.remove('pop', 'burst');
  void btn.offsetWidth;
  btn.classList.add('pop');
  if (on) btn.classList.add('burst');
}
$('#btnFav').addEventListener('click', (e) => toggleFav(current(), e.currentTarget));

// ---------- menus ----------
const menu = $('#menu');
let menuNode = null, menuStack = [], menuBuild = null;
function openTrackMenu(node, it, rect) {
  const t = it.track;
  const items = [];
  if (t !== current()) items.push({ label: 'Play now', icon: ICON.play, act: () => rowActivate(it) });
  items.push({ label: 'Play next', icon: ICON.next, act: () => playNext(t) });
  if (!S.queue.includes(t)) items.push({ label: 'Add to queue', icon: ICON.queue, act: () => addToQueue([t]) });
  items.push({ label: S.favs.has(t.path) ? 'Remove from favorites' : 'Add to favorites', icon: ICON.heart, act: () => toggleFav(t) });
  items.push({ label: 'Add to playlist', icon: ICON.list, sub: () => playlistPickItems([t]) });
  items.push({ label: 'Tags', icon: Tags.ICON, sub: () => Tags.menuItems([t]) });
  items.push('-');
  items.push({ label: 'Edit info…', icon: ICON.edit, act: () => editModal(t) });
  items.push({ label: 'Find info online…', icon: ICON.find, act: () => editModal(t, { lookup: true }) });
  items.push({ label: 'Show in folder', icon: ICON.folder, act: () => api.reveal(t.path) });
  items.push('-');
  if (it.ctx === 'queue') items.push({ label: 'Remove from queue', icon: ICON.x, danger: true, act: async () => { await collapseNode(node); releaseQueueIndex(it.i); rebuild(false); paintHeader(); save(); } });
  else if (it.ctx === 'pl') items.push({ label: S.plOpen === FAV_ID ? 'Remove from favorites' : 'Remove from playlist', icon: ICON.x, danger: true, act: () => removeFromPlaylist(openPl(), t, node) });
  else items.push({ label: 'Remove from library', icon: ICON.trash, danger: true, act: () => removeFromLibrary(t, node) });
  menuNode = node;
  node.classList.add('menu-open');
  openMenu(rect, () => items);
}
function playlistPickItems(tracks) {
  const items = [{ label: 'New playlist…', icon: ICON.plus, act: () => playlistModal(null, tracks) }];
  if (S.playlists.length) items.push('-');
  for (const p of S.playlists) {
    const has = tracks.every((t) => p.paths.includes(t.path));
    items.push({ label: p.name, img: p.thumb || null, seed: p.name + p.id, checked: has, act: () => addToPlaylist(p, tracks) });
  }
  return items;
}
function viewOptionItems() {
  const radio = (field, map) => Object.entries(map).map(([v, label]) => ({
    label, checked: S.lib[field] === v, keep: true,
    act: () => { if (S.lib[field] === v) return; S.lib[field] = v; S.libOpen = null; transitionView(0, null); },
  }));
  return [{ header: 'Group by' }, ...radio('group', GROUPS), '-', { header: 'Sort by' }, ...radio('sort', SORTS), '-', { header: 'Layout' }, ...radio('layout', LAYOUTS)];
}
$('#btnViewOpts').addEventListener('click', (e) => openMenu(e.currentTarget.getBoundingClientRect(), viewOptionItems));

// Type is a radio, Format is checkboxes (several = any of them), Show only toggles each narrow further
function filterItems() {
  const f = S.filters, inv = filterInventory(), out = [{ header: 'Type' }];
  const typeN = { all: lib.size, music: inv.music, video: inv.video };
  for (const [v, label] of Object.entries(TYPES)) out.push({
    label, count: typeN[v], checked: f.type === v, keep: true,
    act: () => { if (f.type === v) return; f.type = v; f.formats = f.formats.filter((x) => fmtFits(x)); filtersChanged(); },
  });
  const fmts = inv.fmts.filter(([x]) => fmtFits(x));
  for (const x of f.formats) if (!fmts.some(([y]) => y === x)) fmts.push([x, 0]);
  if (fmts.length > 1 || f.formats.length) {
    out.push('-', { header: 'Format' });
    for (const [x, n] of fmts) out.push({
      label: x.toUpperCase(), count: n, checked: f.formats.includes(x), keep: true,
      act: () => { f.formats = f.formats.includes(x) ? f.formats.filter((y) => y !== x) : [...f.formats, x]; filtersChanged(); },
    });
  }
  let favN = 0;
  for (const p of S.favs) if (lib.has(p)) favN++;
  const togN = { fav: favN, missing: inv.missing, nocover: inv.nocover };
  out.push('-', { header: 'Show only' });
  for (const [k, label] of Object.entries(TOGGLES)) out.push({
    label, count: togN[k], checked: f[k], keep: true, title: TOGGLE_TIPS[k],
    act: () => { f[k] = !f[k]; filtersChanged(); },
  });
  {
    const qc = new Map();
    for (const t of lib.values()) { const q = qualityOf(t); if (q) qc.set(q, (qc.get(q) || 0) + 1); }
    if (qc.size) {
      out.push('-', { header: 'Quality' });
      for (const k of Object.keys(QUALITY)) if (qc.has(k) || f.quality.includes(k)) out.push({
        label: QUALITY[k], count: qc.get(k) || 0, checked: f.quality.includes(k), keep: true, title: QUALITY_TIPS[k],
        act: () => { f.quality = f.quality.includes(k) ? f.quality.filter((x) => x !== k) : [...f.quality, k]; filtersChanged(); },
      });
    }
  }
  if (S.tags.length) {
    out.push('-', { header: 'Tags' });
    const cnt = new Map();
    for (const [p, ids] of Object.entries(S.songTags)) if (lib.has(p)) for (const id of ids) cnt.set(id, (cnt.get(id) || 0) + 1);
    for (const tg of S.tags) out.push({
      label: tg.name, icon: Tags.dot(tg), count: cnt.get(tg.id) || 0, checked: f.tags.includes(tg.id), keep: true,
      act: () => { f.tags = f.tags.includes(tg.id) ? f.tags.filter((x) => x !== tg.id) : [...f.tags, tg.id]; filtersChanged(); },
    });
  }
  if (filtersOn()) out.push('-', { label: 'Clear filters', act: clearFilters });
  return out;
}
$('#btnFilter').addEventListener('click', (e) => openMenu(e.currentTarget.getBoundingClientRect(), filterItems));

function filtersChanged() {
  view.scrollTop = 0;
  rebuild(true);        // rows re-enter with the usual stagger, so every change reads as a fresh list
  paintHeader();        // count, chips, dot
  save();
}
function clearFilters() { Object.assign(S.filters, noFilters()); filtersChanged(); }

// chips: new ones pop in, leaving ones lift out where they stand, the rest glide over (FLIP), the row glides to its new height
const fchips = $('#fchips');
let chipSig = '';
const chipHTML = (c) => (c.k === 'clear'
  ? '<button class="fchip clear" data-k="clear">Clear all</button>'
  : `<button class="fchip${c.color ? ' tagged' : ''}" data-k="${esc(c.k)}" title="Remove filter"${c.color ? ` style="--tc:${c.color}"` : ''}>${esc(c.label)}${ICON.x}</button>`);
function paintChips() {
  $('#btnFilter').classList.toggle('lit', filtersOn());
  const want = chipList(), sig = want.map((c) => c.k).join('|');
  if (sig === chipSig) return;
  chipSig = sig;
  const fromH = fchips.offsetHeight;
  fchips.getAnimations().forEach((a) => a.cancel());
  const live = new Map(), at = new Map();
  for (const el of fchips.children) if (!el._out) { live.set(el.dataset.k, el); at.set(el, [el.offsetLeft, el.offsetTop]); }
  for (const [k, el] of live) {
    if (want.some((c) => c.k === k)) continue;
    const [x, y] = at.get(el);
    el._out = true;
    el.classList.add('out');
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    done(anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.6)' }], { duration: 240, easing: 'ease-in', fill: 'forwards' })).then(() => el.remove());
  }
  let prev = null;
  for (const c of want) {
    let el = live.get(c.k);
    if (!el || el._out) {
      el = fromHTML(chipHTML(c));
      fchips.insertBefore(el, prev ? prev.nextSibling : fchips.firstChild);
      anim(el, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: SOFT });
    }
    prev = el;
  }
  for (const [el, [x, y]] of at) {
    if (el._out) continue;
    const dx = x - el.offsetLeft, dy = y - el.offsetTop;
    if (dx || dy) anim(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 480 });
  }
  const toH = fchips.offsetHeight;
  if (toH !== fromH) anim(fchips, [{ height: fromH + 'px' }, { height: toH + 'px' }], { duration: 480 });
}
fchips.addEventListener('click', (e) => {
  const b = e.target.closest('.fchip');
  if (!b || b._out) return;
  const k = b.dataset.k, f = S.filters, kb = b.matches(':focus-visible');
  if (k === 'clear') Object.assign(f, noFilters());
  else if (k === 'type') f.type = 'all';
  else if (k.startsWith('fmt:')) f.formats = f.formats.filter((x) => x !== k.slice(4));
  else if (k.startsWith('tag:')) f.tags = f.tags.filter((x) => x !== k.slice(4));
  else if (k.startsWith('q:')) f.quality = f.quality.filter((x) => x !== k.slice(2));
  else f[k] = false;
  filtersChanged();
  if (kb) ($('.fchip:not(.out)', fchips) || $('#btnFilter')).focus();   // keyboard users keep their place
});

function menuPageHTML(items, depth) {
  let html = '<div class="menu-page">';
  if (depth) html += `<button class="menu-item head" data-mi="back">${ICON.back}<span class="grow">Back</span></button><div class="menu-sep"></div>`;
  items.forEach((it, k) => {
    if (it === '-') { html += '<div class="menu-sep"></div>'; return; }
    if (it.header) { html += `<div class="menu-label">${esc(it.header)}</div>`; return; }
    const lead = it.img !== undefined ? `<span class="mi-img" style="background-image:${it.img ? `url('${it.img}')` : gradFor(it.seed)}"></span>` : it.icon || '';
    const trail = it.sub ? ICON.chevR : 'checked' in it ? ICON.check : '';
    const count = it.count != null ? `<span class="mi-count">${it.count.toLocaleString()}</span>` : '';
    html += `<button class="menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" data-mi="${k}"${it.title ? ` title="${esc(it.title)}"` : ''}>${lead}<span class="grow">${esc(it.label)}</span>${count}${trail}</button>`;
  });
  return html + '</div>';
}
function showMenuPage(items, dir) {
  const fromH = menu.offsetHeight;
  menu.innerHTML = menuPageHTML(items, menuStack.length);
  menu._items = items;
  if (!dir) return;
  anim(menu, [{ height: fromH + 'px' }, { height: menu.offsetHeight + 'px' }], { duration: 420 });
  anim(menu.firstElementChild, [{ opacity: 0, transform: `translateX(${dir * 30}px)` }, { opacity: 1, transform: 'none' }], { duration: 420 });
}
function openMenu(rect, build) {
  menuStack = [];
  menuBuild = build;
  menu.hidden = false;
  menu._closing = false;
  menu.getAnimations().forEach((a) => a.cancel());
  menu.style.left = '-999px';
  showMenuPage(build(), 0);
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = rect.right - mw, y = rect.bottom + 6;
  if (x < 8) x = rect.left;
  x = Math.max(8, Math.min(x, innerWidth - mw - 8));
  const below = y + mh <= innerHeight - 8;
  if (!below) y = Math.max(8, rect.top - mh - 6);
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.transformOrigin = `${Math.min(mw, Math.max(0, rect.right - x - 10))}px ${below ? 0 : mh}px`;
  anim(menu, [{ opacity: 0, transform: 'scale(.9, .8)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
}
async function closeMenu() {
  if (menu.hidden || menu._closing) return;
  menu._closing = true;
  menuNode?.classList.remove('menu-open');
  menuNode = null;
  await done(anim(menu, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94, .88)' }], { duration: 180, easing: 'ease-in', fill: 'forwards' }));
  if (!menu._closing) return;
  menu.hidden = true;
  menu._closing = false;
  menu.getAnimations().forEach((a) => a.cancel());
}
menu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mi]');
  if (!b) return;
  if (b.dataset.mi === 'back') { showMenuPage(menuStack.pop(), -1); return; }
  const it = menu._items[+b.dataset.mi];
  if (it.sub) { menuStack.push(menu._items); showMenuPage(it.sub(), 1); return; }
  if (it.keep) {
    it.act?.();
    const st = menu.scrollTop, fromH = menu.offsetHeight, fromTop = parseFloat(menu.style.top);
    showMenuPage(menuBuild(), 0);
    menu.scrollTop = st;
    // rows can come and go (Clear filters, the Format list): glide to the new size and stay on screen
    const toH = menu.offsetHeight, toTop = Math.max(8, Math.min(fromTop, innerHeight - 8 - toH));
    menu.style.top = toTop + 'px';
    if (toH !== fromH || toTop !== fromTop) anim(menu, [{ height: fromH + 'px', top: fromTop + 'px' }, { height: toH + 'px', top: toTop + 'px' }], { duration: 420 });
    return;
  }
  closeMenu();
  it.act?.();
});
window.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

// ---------- modals ----------
const modalRoot = $('#modalRoot');
let modalClose = null;
function openModal(html, { onSubmit, onMount } = {}) {
  modalRoot.innerHTML = `<div class="backdrop"></div><form class="modal glass" autocomplete="off">${html}</form>`;
  modalRoot.hidden = false;
  const form = $('.modal', modalRoot), bd = $('.backdrop', modalRoot);
  anim(bd, [{ opacity: 0 }, { opacity: 1 }], { duration: 350 });
  anim(form, [{ opacity: 0, transform: 'translateY(24px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 600 });
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    anim(bd, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: 'forwards' });
    await done(anim(form, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.96)' }], { duration: 240, easing: 'ease-in', fill: 'forwards' }));
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    modalClose = null;
  };
  modalClose = close;
  bd.addEventListener('click', close);
  $$('[data-cancel]', form).forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    if (btn) btn.disabled = true;
    let ok = true;
    try { ok = (await onSubmit?.(form)) !== false; } finally { if (btn) btn.disabled = false; }
    if (ok) close();
    else anim(form, [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' }], { duration: 420 });
  });
  onMount?.(form, close);
  setTimeout(() => $('input[type=text]:not([name=t_q])', form)?.select(), 60);
  return { form, close };
}

// let go of the file on both decks while fn renames it or writes its tags; the song carries on afterwards
// from the same spot (and from its new name: the deck reloads t.url)
function withReleased(t, fn) {
  return deck.release(t.path, fn);
}
function renameTrack(t, nt) {
  const old = t.path;
  if (old === nt.path) return;
  lib.delete(old);
  t.path = nt.path; t.url = nt.url; t.name = nt.name;
  t._f = t._vid = undefined;   // format/type are cached from the path
  lib.set(t.path, t);
  if (edits[old]) { edits[t.path] = edits[old]; delete edits[old]; }
  if (S.songTags[old]) { S.songTags[t.path] = S.songTags[old]; delete S.songTags[old]; }
  if (S.plays[old]) { S.plays[t.path] = S.plays[old]; delete S.plays[old]; }
  for (const p of S.playlists) p.paths = p.paths.map((x) => (x === old ? t.path : x));
  if (S.favs.has(old)) S.favs = new Set([...S.favs].map((x) => (x === old ? t.path : x)));
}

function editModal(t, { lookup = false } = {}) {
  const ext = t.path.slice(t.path.lastIndexOf('.'));
  const isMp3 = ext.toLowerCase() === '.mp3';
  let cover = t.cover || t.thumb || null, thumb = t.thumb || null, coverChanged = false, applyTags = null;
  if (!t.cover) loadCover(t);
  openModal(`
    <div class="modal-head">
      <h3 class="modal-title">Edit info</h3>
      <button type="button" class="btn ghost find-btn" data-find>${ICON.find}Find online</button>
    </div>
    <div class="lookup-wrap" data-lookup>
      <div class="lookup">
        <div class="lookup-bar">
          <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input type="text" name="t_q" placeholder="Artist and song name" spellcheck="false" /></label>
          <button type="button" class="btn" data-go>Search</button>
        </div>
        <div class="lookup-results" data-results></div>
        <p class="lookup-note">Results from Apple Music and Deezer. Pick one to fill everything in, then edit anything before saving.</p>
      </div>
    </div>
    <div class="edit-grid">
      <button type="button" class="cover-pick" data-pick title="Change cover"><div class="cover-img"></div><span class="cover-hint">Change cover</span></button>
      <div class="fields">
        <label class="field"><span>Title</span><input type="text" name="t_title" value="${esc(t.title || '')}" placeholder="${esc(t.name)}" /></label>
        <div class="field"><span>Artist</span><div class="combo"><input type="text" name="t_artist" value="${esc(t.artist || '')}" placeholder="Unknown artist" autocomplete="off" /><button type="button" class="combo-btn" tabindex="-1" title="Pick an artist">${ICON.chevD}</button></div></div>
        <div class="field"><span>Album</span><div class="combo"><input type="text" name="t_album" value="${esc(t.album || '')}" placeholder="Unknown album" autocomplete="off" /><button type="button" class="combo-btn" tabindex="-1" title="Pick an album">${ICON.chevD}</button></div></div>
      </div>
    </div>
    <label class="field"><span>File name</span><div class="fname"><input type="text" name="t_file" value="${esc(t.name)}" spellcheck="false" /><em>${esc(ext)}</em></div></label>
    ${Tags.fieldHTML()}
    ${isMp3
      ? '<label class="check"><input type="checkbox" name="t_tags" checked /><span class="box"></span>Also save into the MP3 file\'s tags</label>'
      : '<p class="note">Changes are saved in Glass. Writing tags into the file works for MP3 only for now.</p>'}
    <div class="modal-actions">
      <button type="button" class="btn ghost" data-reset>Remove cover</button>
      <span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">Save</button>
    </div>`, {
    onMount(form) {
      const img = $('.cover-img', form), reset = $('[data-reset]', form);
      const paint = (bounce) => {
        img.style.backgroundImage = cover ? cssUrl(cover) : '';
        img.classList.toggle('placeholder', !cover);
        reset.hidden = !cover;
        if (bounce) anim(img, [{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 700 });
      };
      paint(false);
      if (!t.cover && t.hasCover) setTimeout(() => { if (!coverChanged && t.cover) { cover = t.cover; paint(false); } }, 600);
      // choose a file (then adjust), take art from other songs (and hand it to several at once), or adjust this one
      $('[data-pick]', form).addEventListener('click', (e) => Art.coverMenu(e.currentTarget.getBoundingClientRect(), {
        current: cover, forTrack: t,
        onPick: (r) => { cover = r.cover; thumb = r.thumb; coverChanged = true; paint(true); },
      }));
      reset.addEventListener('click', () => { cover = null; thumb = null; coverChanged = true; paint(true); });

      const f = form.elements, wrap = $('[data-lookup]', form), out = $('[data-results]', form), findBtn = $('[data-find]', form);
      let results = [], seq = 0;
      const runLookup = async () => {
        const q = f.t_q.value.trim();
        if (!q) return;
        const my = ++seq;
        out.innerHTML = Array.from({ length: 4 }, () => '<div class="lk-skel"><i></i><b></b></div>').join('');
        try {
          results = await api.lookup(q);
          if (my !== seq) return;
          out.innerHTML = results.length
            ? results.map((r, i) => `<button type="button" class="lk-item" data-r="${i}" style="--d:${i * 40}ms">
                <span class="lk-art" style="background-image:url('${esc(r.thumb || '')}')"></span>
                <span class="lk-text"><b>${esc(r.title)}</b><small>${esc([r.artist, r.album, r.year].filter(Boolean).join(' · '))}</small></span>
                <span class="lk-src">${esc(r.source)}</span></button>`).join('')
            : '<div class="lk-empty">No matches. Try fewer words or just the song name.</div>';
        } catch (err) { if (my === seq) out.innerHTML = `<div class="lk-empty">${esc(cleanErr(err))}</div>`; }
      };
      const openLookup = (auto) => {
        const open = !wrap.classList.contains('open');
        wrap.classList.toggle('open', open);
        findBtn.classList.toggle('on', open);
        if (!open) return;
        if (!f.t_q.value) f.t_q.value = guessQuery(t);
        setTimeout(() => f.t_q.focus(), 60);
        if (auto || !out.childElementCount) runLookup();
      };
      findBtn.addEventListener('click', () => openLookup(false));
      $('[data-go]', form).addEventListener('click', runLookup);
      // searches as you type (Enter still works)
      let typeTimer = 0;
      f.t_q.addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(runLookup, 450); });
      f.t_q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typeTimer); runLookup(); } });
      out.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        const r = results[+b.dataset.r];
        f.t_title.value = r.title || '';
        f.t_artist.value = r.artist || '';
        f.t_album.value = r.album || '';
        f.t_file.value = safeName(r.artist ? `${r.artist} - ${r.title}` : r.title) || f.t_file.value;
        [f.t_title, f.t_artist, f.t_album, f.t_file].forEach((el, k) => {
          const box = el.closest('.fname') || el;
          box.classList.remove('flash'); void box.offsetWidth;
          box.style.animationDelay = k * 80 + 'ms';
          box.classList.add('flash');
        });
        wrap.classList.remove('open');
        findBtn.classList.remove('on');
        if (r.art) {
          img.classList.add('loading');
          try { const u = await api.fetchArt(r.art); cover = u.cover; thumb = u.thumb; coverChanged = true; paint(true); }
          catch (err) { toast(cleanErr(err), true); }
          finally { img.classList.remove('loading'); }
        }
      });
      if (lookup) openLookup(true);
      // pick from artists/albums already in the library (with their artwork) so songs land in the same group
      applyTags = Tags.mountField(form, t);
      attachSuggest(f.t_artist, 'artist', t);
      attachSuggest(f.t_album, 'album', t, (s) => { if (!f.t_artist.value.trim() && s.artist) f.t_artist.value = s.artist; });
    },
    async onSubmit(form) {
      const f = form.elements;
      const fields = { title: f.t_title.value.trim(), artist: f.t_artist.value.trim(), album: f.t_album.value.trim() };
      const e = (edits[t.path] = { ...(edits[t.path] || {}), ...fields });
      if (coverChanged) { e.cover = cover; e.thumb = thumb; }
      Object.assign(t, e);
      applyTags?.();
      const writeTags = isMp3 && f.t_tags?.checked;
      const base = f.t_file.value.trim();
      try {
        if (writeTags || (base && base !== t.name)) {
          await withReleased(t, async () => {
            if (writeTags) await api.writeTags(t.path, { ...fields, cover: coverChanged ? cover : null });
            if (base && base !== t.name) renameTrack(t, await api.rename(t.path, base));
          });
        }
      } catch (err) { toast(cleanErr(err), true); afterEdit(t); return false; }
      afterEdit(t);
      toast('Saved');
    },
  });
}
// ---------- real artists: which names with a comma or "&" are one act (Deezer, in the background) ----------
// Only names joined by a comma or "&" can be one act; "x" and "feat." always mean a collab. Whatever has been checked is
// remembered, so this only looks up names it hasn't seen.
const actsAsked = new Set();
let actsBusy = false, actsTimer = 0;
const queueActs = () => { clearTimeout(actsTimer); actsTimer = setTimeout(checkActs, 4000); };
async function checkActs() {
  if (actsBusy || !api.acts) return;
  actsBusy = true;
  try {
    const todo = new Map();
    for (const t of lib.values()) {
      if (!t.artist) continue;
      const ps = rawArtistParts(t.artist);
      for (let i = 0; i < ps.length - 1 && ps.length <= 6; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          if (!/^\s*[,&]\s*$/.test(ps[j - 1].sep)) break;
          const name = joinParts(ps, i, j), k = actKey(name);
          if (!actsAsked.has(k)) todo.set(k, { name, parts: ps.slice(i, j + 1).map((p) => p.name) });
        }
      }
    }
    const list = [...todo.entries()];
    for (let i = 0; i < list.length; i += 20) {
      const batch = list.slice(i, i + 20);
      const r = await api.acts.check(batch.map(([, v]) => v)).catch(() => null);
      if (!r) break;
      const failed = new Set((r.failed || []).map(actKey));
      batch.forEach(([k]) => { if (!failed.has(k)) actsAsked.add(k); });
      if (failed.size) break;                       // offline or refused: tried again later
      const fresh = (r.whole || []).map(actKey).filter((k) => !wholeActs.has(k));
      if (fresh.length) { fresh.forEach((k) => wholeActs.add(k)); partsCache.clear(); libChanged(); }
    }
  } finally { actsBusy = false; }
}
api.acts?.known().then((c) => {
  c.checked.forEach((k) => actsAsked.add(k));
  if (c.whole.length) { c.whole.forEach((k) => wholeActs.add(k)); partsCache.clear(); libChanged(); }
  queueActs();
}).catch(() => {});

// ---------- artist / album picker for Edit info ----------
function libraryChoices(kind, except) {
  const m = new Map();
  for (const x of lib.values()) {
    if (x === except) continue;
    // artists one by one: "A & B" counts for A and for B, and isn't an artist itself
    const names = kind === 'artist' ? artistNames(x) : [x.album];
    for (const name of names) {
      if (!name || /^unknown/i.test(name)) continue;
      const k = name.toLowerCase();
      let e = m.get(k);
      if (!e) m.set(k, (e = { name, count: 0, thumb: null, artists: new Set() }));
      e.count++;
      if (!e.thumb && x.thumb) e.thumb = x.thumb;
      if (x.artist) e.artists.add(x.artist);
    }
  }
  return [...m.values()].map((e) => ({ ...e, artist: e.artists.size === 1 ? [...e.artists][0] : '' }))
    .sort((a, b) => b.count - a.count || coll.compare(a.name, b.name));
}
function attachSuggest(input, kind, t, onPick) {
  const all = libraryChoices(kind, t);
  const pop = document.createElement('div');
  pop.className = 'sugg glass';
  pop.hidden = true;
  modalRoot.appendChild(pop);
  let shown = [], hi = -1, online = [], onlineFor = '', onlineT = 0;
  const place = () => {
    const r = input.closest('.combo').getBoundingClientRect();
    const below = innerHeight - r.bottom > 240 || r.top < 260;
    pop.style.left = r.left + 'px';
    pop.style.width = r.width + 'px';
    pop.style.top = below ? r.bottom + 6 + 'px' : '';
    pop.style.bottom = below ? '' : innerHeight - r.top + 6 + 'px';
  };
  const paintHi = () => $$('.sg-item', pop).forEach((b, i) => b.classList.toggle('hi', i === hi));
  const show = (everything = false) => {
    const q = everything ? '' : input.value.trim().toLowerCase();
    shown = (q ? all.filter((s) => s.name.toLowerCase().includes(q) && s.name.toLowerCase() !== q)
      .sort((a, b) => b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) : all).slice(0, q ? 7 : 60);
    // real artists from Deezer that aren't in the library yet, under the ones that are
    if (q && kind === 'artist' && onlineFor === q) {
      const have = new Set([...all.map((s) => s.name.toLowerCase()), q]);
      shown = shown.concat(online.filter((s) => !have.has(s.name.toLowerCase())).slice(0, 5));
    }
    if (!shown.length) { hide(); return; }
    hi = -1;
    pop.innerHTML = shown.map((s, i) => `<button type="button" class="sg-item" data-i="${i}" style="--d:${i * 30}ms">
      <span class="sg-art${s.photo ? ' round' : ''}" style="${artStyle(s.photo || s.thumb, s.name)}">${s.photo || s.thumb ? '' : kind === 'artist' ? ICON.person : ICON.note}</span>
      <span class="sg-text"><b>${esc(s.name)}</b><small>${esc(s.photo !== undefined ? 'Not in your library yet' : [kind === 'album' ? s.artist : '', plural(s.count, 'song')].filter(Boolean).join(' · '))}</small></span></button>`).join('');
    const wasHidden = pop.hidden;
    pop.hidden = false;
    place();
    if (wasHidden) anim(pop, [{ opacity: 0, transform: 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 380 });
  };
  const hide = () => { pop.hidden = true; hi = -1; };
  const pick = (s) => {
    input.value = s.name;
    onPick?.(s);
    hide();
    const box = input.closest('.combo');
    box.classList.remove('flash'); void box.offsetWidth; box.classList.add('flash');
  };
  input.addEventListener('input', () => {
    show();
    if (kind !== 'artist' || !api.acts) return;
    clearTimeout(onlineT);
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) return;
    onlineT = setTimeout(async () => {
      const r = await api.acts.search(q).catch(() => []);
      if (input.value.trim().toLowerCase() !== q || document.activeElement !== input) return;
      online = r;
      onlineFor = q;
      show();
    }, 320);
  });
  // clicking anywhere on the field opens the whole list (typing then narrows it down)
  input.addEventListener('focus', () => show(true));
  input.addEventListener('pointerdown', () => { if (document.activeElement === input && pop.hidden) show(true); });
  input.addEventListener('blur', () => setTimeout(hide, 120));
  input.closest('.combo').querySelector('.combo-btn').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (pop.hidden) { input.focus(); show(true); } else hide();
  });
  input.addEventListener('keydown', (e) => {
    if (pop.hidden) { if (e.key === 'ArrowDown') { show(true); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + shown.length + 1) % (shown.length + 1); if (hi === shown.length) hi = -1; paintHi(); e.preventDefault(); }
    else if (e.key === 'Enter' && hi >= 0) { pick(shown[hi]); e.preventDefault(); }
    else if (e.key === 'Escape') { hide(); e.preventDefault(); e.stopPropagation(); }
  });
  pop.addEventListener('pointerdown', (e) => {
    e.preventDefault();   // keep focus in the field
    const b = e.target.closest('[data-i]');
    if (b) pick(shown[+b.dataset.i]);
  });
  $('.modal', modalRoot)?.addEventListener('scroll', () => { if (!pop.hidden) place(); });
}

function afterEdit(t) {
  palKey = null;
  libChanged();
  save();
  if (t === current()) showNow(false);
}

function playlistModal(p = null, addTracksAfter = null) {
  let image = p?.image || null, thumb = p?.thumb || null;
  const seedId = p?.id || 'new';
  openModal(`
    <h3 class="modal-title">${p ? 'Edit playlist' : 'New playlist'}</h3>
    <div class="pl-edit">
      <button type="button" class="pl-pick" data-pick title="Choose image"><div class="pl-pick-img"></div><span class="cover-hint">Choose image</span></button>
      <div class="fields">
        <label class="field"><span>Name</span><input type="text" name="p_name" value="${esc(p?.name || '')}" placeholder="My playlist" maxlength="80" /></label>
        <button type="button" class="btn ghost" data-reset style="align-self:flex-start">Remove image</button>
      </div>
    </div>
    <div class="modal-actions">
      <span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn primary">${p ? 'Save' : 'Create'}</button>
    </div>`, {
    onMount(form) {
      const img = $('.pl-pick-img', form), input = form.elements.p_name, reset = $('[data-reset]', form);
      const paint = (bounce) => {
        img.style.backgroundImage = image ? cssUrl(image) : gradFor((input.value.trim() || 'My playlist') + seedId);
        img.innerHTML = image ? '' : ICON.list;
        reset.hidden = !image;
        if (bounce) anim(img, [{ transform: 'scale(.86)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 700 });
      };
      paint(false);
      input.addEventListener('input', () => { if (!image) paint(false); });
      $('[data-pick]', form).addEventListener('click', (e) => Art.coverMenu(e.currentTarget.getBoundingClientRect(), {
        current: image, onPick: (r) => { image = r.cover; thumb = r.thumb; paint(true); },
      }));
      reset.addEventListener('click', () => { image = null; thumb = null; paint(true); });
    },
    onSubmit(form) {
      const name = form.elements.p_name.value.trim() || 'Untitled playlist';
      if (p) Object.assign(p, { name, image, thumb });
      else { p = { id: 'pl' + Date.now().toString(36), name, image, thumb, paths: [] }; S.playlists.push(p); }
      if (addTracksAfter) addToPlaylist(p, addTracksAfter);
      else toast(`Saved “${name}”`);
      save();
      if (S.view === 'playlists') { rebuild(false); paintHeader(); }
    },
  });
}
function addToPlaylist(p, tracks) {
  const fresh = tracks.filter((t) => !p.paths.includes(t.path));
  p.paths.push(...fresh.map((t) => t.path));
  save();
  if (S.view === 'playlists') rebuild(false);
  toast(fresh.length ? `Added to “${p.name}”` : `Already in “${p.name}”`);
}
async function removeFromPlaylist(p, t, node) {
  if (!p) return;
  await collapseNode(node);
  if (p.virtual) { S.favs.delete(t.path); favVersion++; stateV++; } else p.paths = p.paths.filter((x) => x !== t.path);
  save();
  rebuild(false);
}
async function removeFromLibrary(t, node) {
  await collapseNode(node);
  const i = S.queue.indexOf(t);
  if (i !== -1) releaseQueueIndex(i);
  lib.delete(t.path);
  delete edits[t.path];
  delete S.songTags[t.path];
  S.favs.delete(t.path);
  for (const p of S.playlists) p.paths = p.paths.filter((x) => x !== t.path);
  libChanged();
  save();
  toast('Removed from library');
}
function deletePlaylist(p) {
  openModal(`
    <h3 class="modal-title">Delete “${esc(p.name)}”?</h3>
    <p class="confirm-text">The songs stay in your library and on disk.</p>
    <div class="modal-actions"><span class="grow"></span>
      <button type="button" class="btn" data-cancel>Cancel</button>
      <button type="submit" class="btn danger">Delete</button>
    </div>`, {
    onSubmit() {
      S.playlists = S.playlists.filter((x) => x !== p);
      save();
      transitionView(-1, () => { S.plOpen = null; });
    },
  });
}

// ---------- toast ----------
const toastEl = $('#toast');
let toastTimer = 0;
function toast(msg, error = false) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', !!error);
  const wasHidden = toastEl.hidden;
  toastEl.hidden = false;
  toastEl.getAnimations().forEach((a) => a.cancel());
  if (wasHidden) anim(toastEl, [{ opacity: 0, transform: 'translateY(16px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
  toastTimer = setTimeout(async () => {
    await done(anim(toastEl, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.96)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' }));
    toastEl.hidden = true;
    toastEl.getAnimations().forEach((a) => a.cancel());
  }, error ? 3600 : 1800);
}

// ---------- deck events ----------
deck.on('play', () => {
  body.classList.add('playing');
  armIdle();
  syncMedia();
});
deck.on('pause', () => { body.classList.remove('playing', 'idle'); syncMedia(); });
// play state for Windows: the media pop-up and the taskbar preview's play/pause button
function syncMedia() {
  const playing = !!current() && !deck.paused;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = current() ? (playing ? 'playing' : 'paused') : 'none';
  api.media?.state({ playing, has: !!current() });
}
deck.on('meta', ({ item: t, duration, isVideo }) => {
  if (!t || t !== current()) return;
  if (!t.duration && duration) { t.duration = duration; libChanged(); }
  if (t.error) { t.error = false; libChanged(); }
  body.classList.toggle('is-video', isVideo);
  $('#tDur').textContent = fmt(duration);
  seek.value = duration ? (deck.currentTime / duration) * 1000 : 0;
  setFill(seek);
  $('#tCur').textContent = fmt(deck.currentTime);
  fitVideo();
});
deck.on('preloaded', ({ item: t, duration }) => {
  if (t && !t.duration && duration) { t.duration = duration; libChanged(); }
  fitVideo();
});
// a song ended and the next one took over (gapless, crossfade, or skipping a file that won't play)
deck.on('trackchange', ({ item: t, reason, transition }) => {
  lastTransition = transition;
  if (reason === 'jump') return;          // play() did the bookkeeping already
  const i = S.queue.indexOf(t);
  if (i < 0) return;
  const p = current();
  if (p && p !== t) S.history.push(p);
  S.cur = i;
  S.recent = [...S.recent.filter((x) => x !== t.path), t.path].slice(-40);
  body.classList.toggle('is-video', isVideoPath(t.path));
  queueMeta(t, true);
  showNow(true);
  stateChanged(false);
  paintHeader();
  window.Undo?.quiet();            // the song moving on by itself isn't an undo step
  save();
});
deck.on('error', ({ item: t }) => { if (t) { t.error = true; libChanged(); } });
deck.on('queueend', () => {
  body.classList.remove('playing', 'idle');
  if (sleepAtEnd) { sleepAtEnd = false; toast('Sleep timer: stopped after this song'); queueChanged(); }
  stateChanged();
});
function fitVideo() {
  const W = stage.clientWidth, H = stage.clientHeight;
  for (const v of deck.elements) {
    if (!v.videoWidth) continue;
    const s = Math.min(W / v.videoWidth, H / v.videoHeight);
    v.style.width = Math.round(v.videoWidth * s) + 'px';
    v.style.height = Math.round(v.videoHeight * s) + 'px';
  }
  const v = deck.videoElement;
  if (v && v.videoWidth) { stage.style.setProperty('--vw', v.style.width); stage.style.setProperty('--vh', v.style.height); }
}
new ResizeObserver(fitVideo).observe(stage);
// fullscreen button on the video's bottom-right corner: shows while the pointer moves over the video,
// glides away after a couple of seconds of stillness (or straight away when the pointer leaves)
const vidFs = $('#btnVidFs');
let vHoverT = 0;
function videoHover(on) {
  clearTimeout(vHoverT);
  if (!on) { vHoverT = setTimeout(() => body.classList.remove('v-hover'), 140); return; }
  body.classList.add('v-hover');
  vHoverT = setTimeout(() => { if (!vidFs.matches(':hover')) body.classList.remove('v-hover'); }, 2200);
}
for (const v of deck.elements) {
  v.addEventListener('mousemove', () => videoHover(true));
  v.addEventListener('mouseleave', (e) => { if (e.relatedTarget !== vidFs && !vidFs.contains(e.relatedTarget)) videoHover(false); });
}
vidFs.addEventListener('mouseenter', () => clearTimeout(vHoverT));
vidFs.addEventListener('mouseleave', (e) => { if (!deck.elements.includes(e.relatedTarget)) videoHover(false); });
vidFs.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
seek.addEventListener('input', () => { seeking = true; setFill(seek); $('#tCur').textContent = fmt((seek.value / 1000) * (deck.duration || 0)); });
seek.addEventListener('change', () => { if (deck.duration) deck.seek((seek.value / 1000) * deck.duration); seeking = false; seek.blur(); });

// ---------- volume ----------
function applyVolume() {
  const v = vol.value / 100;
  deck.setVolume(v);                      // the deck squares it, like the old v * v
  deck.setMuted(muted);
  setFill(vol);
  body.classList.toggle('muted', muted || v === 0);
  save();
}
vol.addEventListener('input', () => { muted = false; applyVolume(); });
vol.addEventListener('change', () => vol.blur());
$('#btnMute').addEventListener('click', () => { muted = !muted; applyVolume(); });

// ---------- buttons ----------
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnNext').addEventListener('click', () => next());
$('#btnPrev').addEventListener('click', prev);
function paintShuffle() { $('#btnShuffle').classList.toggle('on', S.shuffle); }
$('#btnShuffle').addEventListener('click', () => { S.shuffle = !S.shuffle; paintShuffle(); queueChanged(); save(); });
function paintRepeat() {
  const b = $('#btnRepeat');
  b.classList.toggle('on', S.repeat !== 'off');
  b.classList.toggle('one', S.repeat === 'one');
  b.title = { off: 'Repeat off (R)', all: 'Repeat all (R)', one: 'Repeat one (R)' }[S.repeat];
}
$('#btnRepeat').addEventListener('click', () => { S.repeat = { off: 'all', all: 'one', one: 'off' }[S.repeat]; paintRepeat(); deck.setRepeatOne(S.repeat === 'one'); queueChanged(); save(); });
function toggleFullscreen() {
  document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { body.classList.toggle('fs', !!document.fullscreenElement); setTimeout(fitVideo, 50); });
$('#btnFull').addEventListener('click', toggleFullscreen);
for (const v of deck.elements) {         // only the visible deck takes the pointer
  v.addEventListener('click', togglePlay);
  v.addEventListener('dblclick', toggleFullscreen);
}
function setWide(on) {
  S.wide = on;
  body.classList.toggle('wide', on);
  if (typeof applySideW === 'function') applySideW();
  save();
}
$('#btnWide').addEventListener('click', () => setWide(!S.wide));

async function act(name) {
  if (name === 'open-files') addTracks(await api.openFiles(), { playFirst: true });
  else if (name === 'open-folder') {
    const infos = await api.openFolder();
    if (!infos.length) return;
    infos.forEach(trackFor);
    libChanged();
    save();
    toast(`Added ${plural(infos.length, 'song')} to your library`);
    if (!current()) addTracks(infos.slice(0, 1), { playFirst: false });
    if (S.view !== 'library') setView('library');
  }
  else if (name === 'clear') clearQueue();
  else if (name === 'new-playlist') playlistModal();
  else if (name === 'clear-filters') clearFilters();
}
$$('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
$$('[data-win]').forEach((b) => b.addEventListener('click', () => api.win(b.dataset.win)));
$('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.win-btns')) api.win('max'); });
api.onMaximized((v) => body.classList.toggle('maximized', v));

// ---------- auto-hide controls over fullscreen video ----------
let idleTimer = 0;
function armIdle() {
  body.classList.remove('idle');
  clearTimeout(idleTimer);
  if (body.classList.contains('fs') && body.classList.contains('is-video') && !deck.paused) {
    idleTimer = setTimeout(() => { if (!$('#dock').matches(':hover')) body.classList.add('idle'); }, 2600);
  }
}
window.addEventListener('mousemove', armIdle, { passive: true });

// ---------- keyboard ----------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!menu.hidden) { closeMenu(); return; }
    if (modalClose) { modalClose(); return; }
  }
  if (modalClose) return;
  if (e.target.matches('input[type=text]')) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'o') { act('open-files'); e.preventDefault(); return; }
  if (e.ctrlKey && k === 'f') { if (S.view === 'queue') { setView('library'); setTimeout(() => $('#search').focus(), 260); } else $('#search').focus(); e.preventDefault(); return; }
  if (e.ctrlKey && k === 'e') { setWide(!S.wide); e.preventDefault(); return; }
  if (e.ctrlKey && /^[123]$/.test(k)) { setView(VIEWS[+k - 1]); e.preventDefault(); return; }
  switch (k) {
    case ' ': togglePlay(); break;
    case 'arrowright': deck.seek(Math.min(deck.duration || 0, deck.currentTime + (e.shiftKey ? 30 : S.play.skip || 5))); break;
    case 'arrowleft': deck.seek(Math.max(0, deck.currentTime - (e.shiftKey ? 30 : S.play.skip || 5))); break;
    case 'arrowup': vol.value = Math.min(100, +vol.value + 5); muted = false; applyVolume(); break;
    case 'arrowdown': vol.value = Math.max(0, +vol.value - 5); applyVolume(); break;
    case 'n': next(); break;
    case 'p': prev(); break;
    case 'm': $('#btnMute').click(); break;
    case 's': $('#btnShuffle').click(); break;
    case 'r': $('#btnRepeat').click(); break;
    case 'f': toggleFullscreen(); break;
    case 'l': toggleFav(current(), $('#btnFav')); break;
    case 'y': window.Lyrics?.toggle(); break;
    default: return;
  }
  e.preventDefault();
});

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  // media keys and Windows' media controls
  ms.setActionHandler('play', () => togglePlay());
  ms.setActionHandler('pause', () => deck.pause());
  ms.setActionHandler('previoustrack', () => prev());
  ms.setActionHandler('nexttrack', () => next());
  ms.setActionHandler('seekto', (d) => deck.seek(d.seekTime));
}
// the taskbar preview's buttons
api.media?.onAction((a) => { if (a === 'prev') prev(); else if (a === 'next') next(); else togglePlay(); });

// ---------- drag & drop ----------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  body.classList.remove('dragging');
  if (!e.dataTransfer.files.length) return;
  addTracks(await api.resolveDropped(e.dataTransfer.files), { playFirst: !current() || deck.paused });
});
const pendingOpen = [];
let loaded = false;
api.onOpenPaths((infos) => (loaded ? addTracks(infos, { playFirst: true }) : pendingOpen.push(infos)));

// ---------- persistence ----------
let saveTimer = 0;
function snapshot() {
  return {
    v: 3,
    tracks: [...lib.values()].map(({ path, url, name, added }) => ({ path, url, name, added })),
    edits,
    queue: S.queue.map((t) => t.path),
    cur: S.cur, at: deck.currentTime || 0,
    shuffle: S.shuffle, repeat: S.repeat,
    playlists: S.playlists, favs: [...S.favs],
    view: S.view, lib: S.lib, filters: S.filters, wide: S.wide, ui: S.ui, lyrics: !!window.Lyrics?.open, albumArt: S.albumArt, play: S.play, sound: S.sound, tags: S.tags, songTags: S.songTags, plays: S.plays, sideW: S.sideW, recent: S.recent, browse: S.browse, from: S.from,
    vol: +vol.value, muted,
  };
}
function save() {
  if (!loaded) return;
  window.Undo?.touch();            // every saved change can be undone (undo.js)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.storeSet(snapshot()).catch(() => {}), 500);
}
window.addEventListener('beforeunload', () => { if (loaded) { clearTimeout(saveTimer); api.storeSetSync(snapshot()); } });

async function restore() {
  const s = (await api.storeGet().catch(() => null)) || {};
  edits = s.edits || {};
  for (const info of s.tracks || []) trackFor(info);
  S.playlists = s.playlists || [];
  S.favs = new Set(s.favs || []);
  // v2 stored "albumkey"; v3 stores "by:key"
  S.expanded = new Set();   // every launch starts with all albums closed
  S.shuffle = !!s.shuffle;
  S.repeat = s.repeat || 'off';
  S.view = s.view === 'albums' ? 'library' : VIEWS.includes(s.view) ? s.view : 'queue';
  if (s.lib) Object.assign(S.lib, s.lib);
  S.filters = readFilters(s.filters);
  S.queue = (s.queue || []).map((p) => lib.get(p)).filter(Boolean);
  // only the settings Glass has (S.ui's keys) are taken from a saved state
  if (s.ui && typeof s.ui === 'object') for (const k of Object.keys(S.ui)) if (k in s.ui) S.ui[k] = s.ui[k];
  // from before blur was set per background: an untouched old default (3) moves to the new max, a blur someone
  // picked on purpose is kept for the artwork
  if (s.ui && 'wallBlur' in s.ui && !('wallBlurArt' in s.ui)) S.ui.wallBlurArt = +s.ui.wallBlur === 3 ? 40 : +s.ui.wallBlur;
  if (s.albumArt) S.albumArt = s.albumArt;
  if (Array.isArray(s.tags)) { S.tags = s.tags; S.tags.forEach((tg) => { delete tg.emoji; }); }   // tags no longer have emojis
  if (s.songTags && typeof s.songTags === 'object') S.songTags = s.songTags;
  if (s.plays && typeof s.plays === 'object') S.plays = s.plays;
  if (Array.isArray(s.recent)) S.recent = s.recent.filter((p) => typeof p === 'string').slice(-40);
  S.browse = !!s.browse;
  S.from = s.from && typeof s.from === 'object' && VIEWS.includes(s.from.view) ? s.from : null;
  S.sideW = +s.sideW || 0;
  if (typeof applySideW === 'function') applySideW();
  if (s.play) {
    S.play = { ...S.play, ...s.play };
    // settings that no longer exist: restart on click, Autoplay always on, no crossfade, no fade on play/pause
    for (const k of ['click', 'autoplay', 'crossfade', 'fade']) delete S.play[k];
  }
  if (s.sound) S.sound = { ...S.sound, ...s.sound };
  window.Sound?.apply();
  S.ui.style = 'liquid';          // the Frosted style was removed
  S.play.skip = 5;                 // arrow keys: 5 s (Shift: 30 s); the setting was removed
  applySpeed();
  deck.setRepeatOne(S.repeat === 'one');
  applyUi();
  window.Zoom?.restore(S.ui.zoom);
  vol.value = s.localVol ?? s.vol ?? 80;   // localVol: where older saves kept the volume
  muted = !!s.muted;
  body.classList.toggle('wide', (S.wide = !!s.wide));

  paintShuffle();
  paintRepeat();
  $('#segInd').style.setProperty('--k', VIEWS.indexOf(S.view));
  $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  applyVolume();
  setFill(seek);

  if (S.queue.length) {
    restoreAt = s.at || 0;
    play(Math.min(Math.max(0, s.cur ?? 0), S.queue.length - 1), false);
  } else showNow(false);
  loaded = true;
  window.Undo?.init();
  rebuild(true);
  paintHeader();
  for (const infos of pendingOpen.splice(0)) addTracks(infos, { playFirst: true });
  window.Lyrics?.restore(!!s.lyrics);
}

requestAnimationFrame(tick);
restore();
