'use strict';
// Library extras, loaded after app.js and sharing its globals:
//  • audio quality badges (Hi-Res / CD / HQ / SQ / LQ) from codec, bitrate, sample rate and bit depth
//  • play counts (a play counts after 30 s, or half the song if shorter)
//  • artist pages: photo + short bio from Wikipedia, songs / albums / time / plays, most played, albums, all songs
//  • clickable artist and album under the song that's playing
//  • the side panel's width can be dragged (horizontally only)
//  • fade in at the start / out at the end of every song (Settings > Playback, 0–8 s)

// ---------- quality ----------
const QUALITY = { hires: 'Hi-Res', cd: 'CD', hq: 'HQ', sq: 'SQ', lq: 'LQ' };
const QUALITY_TIPS = {
  hires: 'Lossless, better than CD (over 16-bit or 48 kHz)',
  cd: 'Lossless at CD quality (16-bit, 44.1/48 kHz)',
  hq: 'High-quality lossy (like MP3 320 or AAC 256)',
  sq: 'Standard lossy (like MP3 192)',
  lq: 'Low bitrate (like MP3 128 or less)',
};
const LOSSLESS_EXT = new Set(['flac', 'wav', 'aif', 'aiff', 'alac', 'ape', 'wv']);
function qualityOf(t) {
  if (isVid(t)) return null;
  const ext = fmtOf(t);
  const lossless = t.lossless ?? LOSSLESS_EXT.has(ext);
  if (lossless) return (t.bits || 0) > 16 || (t.sampleRate || 0) > 48000 ? 'hires' : 'cd';
  const kbps = (t.bitrate || 0) / 1000;
  if (!kbps) return null;
  // newer codecs sound better per kbps than MP3
  const codec = (t.codec || '').toLowerCase();
  const eff = /opus/.test(codec) || ext === 'opus' ? kbps * 2 : /vorbis/.test(codec) || ext === 'ogg' ? kbps * 1.6 : /aac|mp4a/.test(codec) || ext === 'm4a' || ext === 'aac' ? kbps * 1.25 : kbps;
  return eff >= 250 ? 'hq' : eff >= 160 ? 'sq' : 'lq';
}
function qualityText(t) {
  const q = qualityOf(t);
  if (!q) return '';
  const lossless = q === 'hires' || q === 'cd';
  return [fmtOf(t).toUpperCase(), lossless && t.bits ? `${t.bits}-bit` : '', lossless && t.sampleRate ? `${+(t.sampleRate / 1000).toFixed(1)} kHz` : '',
    !lossless && t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : '', QUALITY[q]].filter(Boolean).join(' · ');
}
const qBadge = (t) => { const q = qualityOf(t); return q ? `<span class="q q-${q}" title="${esc(qualityText(t) + ' — ' + QUALITY_TIPS[q])}">${QUALITY[q]}</span>` : ''; };
// a song restored at start is shown before this file loads: fill in its quality line now
if (current()) $('#nowQ').textContent = qualityText(current());

// ---------- play counts ----------
let playCounted = null;
function countPlay() {
  const t = current();
  if (!t || deck.paused) return;
  if (playCounted === t && deck.currentTime < 1.5) playCounted = null;    // started over: a new play
  if (playCounted === t) return;
  const d = deck.duration || 0;
  if (deck.currentTime >= Math.min(30, d ? d / 2 : 30)) {
    playCounted = t;
    S.plays[t.path] = (S.plays[t.path] || 0) + 1;
    save();
  }
}
const playsOf = (t) => S.plays[t.path] || 0;

// ---------- fade in / out of every song ----------
let songLv = 1;
function songFade() {
  const f = +S.play.xfade || 0;
  let lv = 1;
  // album songs that flow into each other stay seamless
  if (f > 0 && window.Sound?.ready() && !seeking) {
    const d = deck.duration, c = deck.currentTime, t = current(), nx = deck.plannedItem;
    if (d && isFinite(d) && d > f * 2.5) {
      const fin = lastTransition === 'gapless' ? 1 : c / f;
      const fout = t && nx && GlassDeck.sameAlbum(t, nx) ? 1 : (d - c) / f;
      lv = Math.max(0, Math.min(1, fin, fout));
    }
  }
  if (Math.abs(lv - songLv) > 0.004 || (lv === 1 && songLv !== 1)) { songLv = lv; window.Sound?.songLevel(lv); }
}

// ---------- artist info (Wikipedia, via main) ----------
const artistInfos = new Map();   // lower-case name -> undefined (loading) | null (none) | info
function artistInfo(name) {
  const k = String(name || '').toLowerCase();
  if (!k) return null;
  if (artistInfos.has(k)) return artistInfos.get(k);
  artistInfos.set(k, undefined);
  api.artistInfo(name).then((info) => { artistInfos.set(k, info || null); rebuild(false); })
    .catch(() => { artistInfos.set(k, null); rebuild(false); });
  return undefined;
}
// the header of an artist's page
function artistHeroItem(o) {
  const loading = o.info === undefined;
  const bio = o.info?.extract || '';
  const img = o.img || o.info?.image || null;
  // header height follows the bio's length (about 62 characters a line, 6 lines at most)
  const h = bio ? 214 + Math.min(6, Math.ceil(bio.length / 62)) * 19 : loading ? 270 : 176;
  return miscItem(`ahero:${o.key}:${bio ? 'b' : loading ? 'l' : 'n'}`, h, `<div class="ahero">
    <div class="ahero-top">
      <div class="ahero-art" style="${artStyle(img, o.name)}">${img ? '' : ICON.person}</div>
      <div class="ahero-info">
        <span class="ahero-kind">${esc(o.info?.description ? o.info.description : 'Artist')}</span>
        <h3>${esc(o.name)}</h3>
        <p class="ahero-facts">${o.facts.filter(Boolean).map(esc).join(' · ')}</p>
        ${o.genres?.length ? `<div class="ahero-genres">${o.genres.slice(0, 4).map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
        <div class="hero-actions"><button class="btn-play" data-hero-play>${ICON.play}Play</button><button class="ibtn xs" data-hero-shuffle title="Shuffle">${ICON.shuffle}</button></div>
      </div>
    </div>
    ${bio ? `<div class="ahero-bio"><p>${esc(bio)}</p><button class="ahero-src" data-ext="${esc(o.info.url)}">Read more on Wikipedia ↗</button></div>`
      : loading ? '<div class="ahero-bio loading"><i></i><i></i><i></i></div>' : ''}
  </div>`, { col: o.col });
}
const sectionItem = (key, label) => miscItem('sec:' + key, 40, `<div class="list-section">${esc(label)}</div>`);

// a local artist's page: everything Glass knows about them
function localArtistItems(g, back) {
  const tracks = g.tracks, info = artistInfo(g.name);
  const albums = new Map();
  for (const t of tracks) {
    const ag = albumGroupOf(t);
    if (ag.special) continue;
    let a = albums.get(ag.key);
    if (!a) albums.set(ag.key, (a = { ...ag, tracks: [] }));
    a.tracks.push(t);
  }
  const plays = tracks.reduce((s, t) => s + playsOf(t), 0);
  const dur = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const gc = new Map();
  for (const t of tracks) if (t.genre) gc.set(t.genre, (gc.get(t.genre) || 0) + 1);
  const genres = [...gc.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
  // Wikipedia's photo when there is one, otherwise their album art
  const items = [back, artistHeroItem({
    key: 'local:' + g.key, name: g.name, img: info?.image ? null : g.thumb, info, col: tracks, genres,
    facts: [plural(tracks.length, 'song'), albums.size ? plural(albums.size, 'album') : '', dur ? fmtLong(dur) : '', plays ? plural(plays, 'play') : 'No plays yet'],
  })];
  const top = tracks.filter((t) => playsOf(t) > 0).sort((a, b) => playsOf(b) - playsOf(a)).slice(0, 5);
  if (top.length) {
    items.push(sectionItem('top:' + g.key, 'Most played'));
    top.forEach((t, i) => { const r = rowItem(t, 'lib', i, i + 1, top); r.key = 'top:' + r.key; items.push(r); });
  }
  if (albums.size) {
    items.push(sectionItem('alb:' + g.key, 'Albums'));
    const list = [...albums.values()].sort((a, b) => b.tracks.length - a.tracks.length);
    items.push(...tileItems(list.map((a) => {
      const thumb = S.albumArt[a.key]?.thumb || a.tracks.find((t) => t.thumb)?.thumb;
      return { key: 'aa' + a.key, name: a.name, sub: a.merged ? `Singles · ${plural(a.tracks.length, 'song')}` : plural(a.tracks.length, 'song'),
        art: artStyle(thumb, a.name), icon: thumb ? '' : ICON.note, act: () => openLibGroup('album', a.key, a.name) };
    }), 'aal' + g.key));
  }
  items.push(sectionItem('all:' + g.key, 'All songs'));
  tracks.forEach((t, i) => items.push(rowItem(t, 'lib', i, i + 1, tracks)));
  return items;
}

// ---------- open an album / artist page from anywhere ----------
function openLibGroup(by, key, name) {
  if (!key) return;
  closeMenu();
  if (S.filter) { S.filter = ''; $('#search').value = ''; }
  if (S.view !== 'library') {
    $('#segInd').style.setProperty('--k', VIEWS.indexOf('library'));
    $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === 'library'));
  }
  if (S.wide) setWide(false);
  return transitionView(1, () => { S.view = 'library'; S.plOpen = null; S.libOpen = { by, key, name }; });
}
const openArtistOf = (t) => { const a = mainArtist(t); if (t.artist) openLibGroup('artist', a.toLowerCase(), a); };
const openAlbumOf = (t) => { const ag = albumGroupOf(t); openLibGroup('album', ag.key, ag.name); };
// "Artist x Artist — Album" under the song and in the dock: every artist is its own link, then the album
// parts: [{ name, before, after, sep, plain }] (artistParts)
function nowSubHTML(parts, album) {
  if (typeof parts === 'string') parts = parts ? [{ name: parts }] : [];
  const who = parts.map((p, i) => esc(p.before || '')
    + (p.plain ? esc(p.name) : `<button class="nlink" data-go="artist" data-ai="${i}" title="Go to ${esc(p.name)}">${esc(p.name)}</button>`)
    + esc(p.after || '') + esc(p.sep || '')).join('');
  return `${who ? `<span class="nartists">${who}</span>` : ''}${who && album ? '<span class="nsep"> — </span>' : ''}${album ? `<button class="nlink" data-go="album" title="Go to album">${esc(album)}</button>` : ''}`;
}
function goLink(kind, ai = 0) {
  const t = current();
  if (!t) return;
  // album / artist links open that page and find the playing song in it
  if (kind === 'from') goFrom();
  else if (kind === 'album') { const ag = albumGroupOf(t); Promise.resolve(openLibGroup('album', ag.key, ag.name)).then(revealCurrent); }
  else if (kind === 'artist') { const p = (t.artist ? artistParts(t.artist) : [])[ai]; if (p) Promise.resolve(openLibGroup('artist', p.name.toLowerCase(), p.name)).then(revealCurrent); }
}
// one click opens the artist / album / source; a double click (quick edits on) renames it instead,
// so under the cover a single click waits a moment to see whether a second one follows
let goTimer = 0;
const quickOn = () => S.ui.quickEdit !== false && !!current();
const goLater = (fn) => { clearTimeout(goTimer); if (quickOn()) goTimer = setTimeout(fn, 260); else fn(); };
$('#nowSub').addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b || b.querySelector('input')) return;
  goLater(() => goLink(b.dataset.go, +b.dataset.ai || 0));
});
$('#nowTitle').addEventListener('click', (e) => { if (!e.target.closest('input')) goLater(() => goLink('from')); });
// the dock has no inline renaming: links go straight away
$('#dockTitle').addEventListener('click', () => goLink('from'));
// the hover tip always names where the song plays from
for (const el of [$('#nowTitle'), $('#dockTitle')]) el.addEventListener('mouseenter', () => {
  el.title = current() ? `Playing from ${fromLabel()}` : '';
});
$('#dockSub').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) goLink(b.dataset.go, +b.dataset.ai || 0); });

// ---------- quick edits: double-click the title / artist / album, right-click the cover ----------
function quickSave(t, field, value) {
  const e = (edits[t.path] = { ...(edits[t.path] || {}), [field]: value });
  Object.assign(t, e);
  afterEdit(t);
  toast('Saved');
}
// swaps the text for a matching text box right where it is; Enter saves, Esc cancels, clicking away saves
function inlineEdit(el, value, placeholder, onSave) {
  const cs = getComputedStyle(el);
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'inline-edit';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.style.font = cs.font;
  input.style.width = Math.max(180, el.getBoundingClientRect().width + 40) + 'px';
  el.style.display = 'none';
  el.after(input);
  input.focus();
  input.select();
  anim(input, [{ transform: 'scale(.96)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 320 });
  let finished = false;
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    const v = input.value.trim().replace(/\s+/g, ' ');
    input.remove();
    el.style.display = '';
    if (keep && v !== value.trim()) onSave(v);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();          // typing here never triggers player shortcuts
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}
$('#nowTitle').addEventListener('dblclick', (e) => {
  clearTimeout(goTimer);
  if (!quickOn()) return;
  const t = current();
  inlineEdit(e.currentTarget, t.title || '', t.name, (v) => quickSave(t, 'title', v));
});
$('#nowSub').addEventListener('dblclick', (e) => {
  const b = e.target.closest('[data-go]');
  if (!b || !quickOn()) return;
  clearTimeout(goTimer);
  const t = current(), field = b.dataset.go === 'artist' ? 'artist' : 'album';
  inlineEdit(field === 'artist' ? b.closest('.nartists') || b : b, t[field] || '', field === 'artist' ? 'Artist' : 'Album', (v) => quickSave(t, field, v));
});
$('#art').addEventListener('contextmenu', (e) => {
  if (!quickOn()) return;
  e.preventDefault();
  const t = current();
  Art.coverMenu({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }, {
    current: t.cover || t.thumb, forTrack: t,
    onPick: (r) => {
      const ed = (edits[t.path] = { ...(edits[t.path] || {}), cover: r.cover, thumb: r.thumb });
      Object.assign(t, ed);
      afterEdit(t);
      anim($('#artWrap'), [{ transform: 'scale(.94)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 700 });
      toast('Cover changed');
    },
  });
});

// ---------- side panel width (drag its left edge) ----------
const bodyGrid = $('.body');
const sideMax = () => Math.max(320, Math.min(980, innerWidth - 460));
function applySideW() {
  if (S.sideW && !S.wide && !body.classList.contains('fs')) bodyGrid.style.setProperty('--side', Math.min(S.sideW, sideMax()) + 'px');
  else bodyGrid.style.removeProperty('--side');
}
(() => {
  const grip = document.createElement('div');
  grip.className = 'side-grip';
  grip.title = 'Drag to resize · double-click to reset';
  $('#side').appendChild(grip);
  let from = null;
  grip.addEventListener('pointerdown', (e) => {
    if (S.wide) return;
    grip.setPointerCapture(e.pointerId);
    from = { x: e.clientX, w: $('#side').getBoundingClientRect().width };
    body.classList.add('side-resizing');
  });
  grip.addEventListener('pointermove', (e) => {
    if (!from) return;
    S.sideW = Math.round(Math.max(300, Math.min(sideMax(), from.w + (from.x - e.clientX))));
    applySideW();
  });
  const end = () => { if (!from) return; from = null; body.classList.remove('side-resizing'); save(); };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { S.sideW = 0; applySideW(); save(); });
  window.addEventListener('resize', applySideW);
})();

window.Extras = { tick() { countPlay(); songFade(); } };

// ---------- Search tab: recommendations when the box is empty ----------
let recSeed = 0, recKey = '', recCache = null;
function browseBy(by) {
  S.lib.group = by;
  transitionView(1, () => { S.browse = true; S.libOpen = null; });
}
function reshuffleRecs() { recSeed++; recKey = ''; rebuild(true); }
function recRows(list, key) { return list.map((t, i) => { const r = rowItem(t, 'lib', i, i + 1, list); r.key = key + ':' + r.key; return r; }); }
function recItems() {
  const key = `${libVersion}|${recSeed}|${S.recent.length}|${Object.keys(S.plays).length}`;
  if (key === recKey && recCache) return recCache;
  recKey = key;
  const out = [];
  if (!lib.size) {
    out.push(emptyItem('Your library is empty', 'Add a folder of music to get started', '<button class="btn primary" data-act="open-folder">Add a folder</button>'));
    return (recCache = out);
  }
  out.push(miscItem('rec-browse', 52, `<div class="rec-browse"><span>Browse</span>
    <button class="schip" data-browse="album">Albums</button><button class="schip" data-browse="artist">Artists</button>
    <button class="schip" data-browse="none">All songs</button><button class="schip" data-browse="folder">Folders</button>
    <span class="grow"></span><button class="ibtn xs" data-recshuffle title="New picks">${ICON.shuffle}</button></div>`));
  const ok = (t) => t && !t.missing && !t.error;
  const recent = [...S.recent].reverse().map((p) => lib.get(p)).filter(ok).slice(0, 6);
  if (recent.length) out.push(sectionItem('rec-recent', 'Jump back in'), ...recRows(recent, 'rr'));
  // made for you: songs like the ones you play most, favorite, and played lately
  const seeds = [...new Set([
    ...Object.entries(S.plays).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => lib.get(p)),
    ...[...S.favs].map((p) => lib.get(p)), ...recent,
  ].filter(ok))];
  const picked = new Set(recent.map((t) => t.path)), mix = [];
  const pool = seeds.length ? seeds : [...lib.values()].filter(ok);
  for (let k = 0; k < 4 && mix.length < 12 && pool.length; k++) {
    const seed = pool[Math.floor(Math.random() * pool.length)];
    for (const t of autoplayPicks(seed, 6, { anyQueue: true })) if (!picked.has(t.path) && mix.length < 12) { picked.add(t.path); mix.push(t); }
  }
  if (mix.length) out.push(sectionItem('rec-mix', 'Made for you'), ...recRows(mix, 'rm'));
  const most = [...lib.values()].filter((t) => ok(t) && playsOf(t) > 0).sort((a, b) => playsOf(b) - playsOf(a)).slice(0, 6);
  if (most.length) out.push(sectionItem('rec-most', 'Most played'), ...recRows(most, 'rp'));
  const fresh = [...lib.values()].filter(ok).sort((a, b) => (b.added || 0) - (a.added || 0)).slice(0, 6);
  if (fresh.length) out.push(sectionItem('rec-new', 'Recently added'), ...recRows(fresh, 'ra'));
  return (recCache = out);
}

// ---------- Search tab: matching artists and albums above the songs ----------
function searchExtras(q) {
  const artists = new Map(), albums = new Map();
  for (const t of lib.values()) {
    if (t.artist) { const a = mainArtist(t), k = a.toLowerCase(); if (!artists.has(k)) artists.set(k, { name: a, key: k, thumb: t.thumb, n: 0 }); const e = artists.get(k); e.n++; if (!e.thumb) e.thumb = t.thumb; }
    const ag = albumGroupOf(t);
    if (!ag.special) { if (!albums.has(ag.key)) albums.set(ag.key, { ...ag, thumb: S.albumArt[ag.key]?.thumb || t.thumb, artist: t.artist, n: 0 }); const e = albums.get(ag.key); e.n++; if (!e.thumb) e.thumb = t.thumb; }
  }
  const top = (m) => [...m.values()].map((x) => [GlassSearch.match(x.name, q), x]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0] || b[1].n - a[1].n).slice(0, 6).map(([, x]) => x);
  const out = [], ar = top(artists), al = top(albums);
  if (ar.length) {
    out.push(sectionItem('s-ar', 'Artists'));
    out.push(...tileItems(ar.map((a) => ({ key: 'sa' + a.key, cls: 'round', name: a.name, sub: plural(a.n, 'song'), art: artStyle(a.thumb, a.name), icon: a.thumb ? '' : ICON.person,
      act: () => openLibGroup('artist', a.key, a.name) })), 'sar'));
  }
  if (al.length) {
    out.push(sectionItem('s-al', 'Albums'));
    out.push(...tileItems(al.map((a) => ({ key: 'sl' + a.key, name: a.name, sub: [a.merged ? 'Singles' : a.artist, plural(a.n, 'song')].filter(Boolean).join(' · '), art: artStyle(a.thumb, a.name), icon: a.thumb ? '' : ICON.note,
      act: () => openLibGroup('album', a.key, a.name) })), 'sal'));
  }
  if (out.length) out.push(sectionItem('s-songs', 'Songs'));
  return out;
}

// ---------- the cover drifts a few pixels toward the mouse (translate only, never a tilt) ----------
const drift = { mx: null, my: null, x: 0, y: 0, rect: null, at: 0 };
window.addEventListener('pointermove', (e) => { drift.mx = e.clientX; drift.my = e.clientY; }, { passive: true });
document.documentElement.addEventListener('mouseleave', () => { drift.mx = null; });
window.addEventListener('blur', () => { drift.mx = null; });
function artDrift(ts) {
  if (reduceMotion) return;
  const MAX = 5;          // px: very, very slight
  if (!drift.rect || ts - drift.at > 400) { drift.rect = $('#artWrap').getBoundingClientRect(); drift.at = ts; }
  let tx = 0, ty = 0;
  const r = drift.rect;
  // small in the lyrics' corner (.ly-compact): it stays put
  if (drift.mx != null && r.width && !(body.classList.contains('lyrics-on') && body.classList.contains('ly-compact'))) {
    tx = Math.max(-1, Math.min(1, (drift.mx - (r.left + r.width / 2)) / (innerWidth / 2))) * MAX;
    ty = Math.max(-1, Math.min(1, (drift.my - (r.top + r.height / 2)) / (innerHeight / 2))) * MAX;
  }
  const nx = drift.x + (tx - drift.x) * 0.05, ny = drift.y + (ty - drift.y) * 0.05;
  if (Math.abs(nx - drift.x) < 0.005 && Math.abs(ny - drift.y) < 0.005) return;
  drift.x = nx; drift.y = ny;
  artEl.style.translate = `${nx.toFixed(2)}px ${ny.toFixed(2)}px`;
}
window.Extras.drift = artDrift;
