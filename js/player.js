'use strict';
// The player: Glassy's panels floating in 3D. It stays on the page through every page change. On the home page the scroll moves
// it through what the app does; on other pages it sits beside the page. It's a working stand-in, not the app: invented songs,
// covers drawn with CSS, and music generated here with Web Audio, unless site/media/ has real songs (that folder is never published).
(() => {
  const body = document.body;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  // Sharpness: tilted panels get drawn once and then resampled, which softens them, so each one is drawn with spare pixels and
  // shrunk to size. Not too many: more pixels to move means less smooth motion.
  const Z = CSS.supports('zoom', '1') ? clamp(1.6 / (devicePixelRatio || 1), 1, 1.6) : 1;
  document.documentElement.style.setProperty('--z', Z);

  // ---------- the songs (all invented) ----------
  const art = (base, ...b) => b.map(([c, x, y, r]) => `radial-gradient(circle at ${x}% ${y}%, ${c}, transparent ${r}%)`).join(',') + `,${base}`;
  const LINES = {
    a: ['Windows down, the night is warm', 'Nothing left to prove', 'The streetlights hum our song', 'Slowing down the city', 'Every word lands on time', 'Right where it should be', 'Take the long way home tonight', 'We have nowhere else to be'],
    b: ['Paper moons above the glass', 'Second floor, the lights are low', 'Tide comes in and takes its time', 'Everything we said still glows', 'Fold the morning into two', 'Keep the quiet, keep it new', 'Paper moons above the glass', 'Nothing here is built to last'],
    c: ['Half asleep on the early train', 'Radio off, the static stays', 'Soft enough to hear you think', 'Counting all the stations down', 'Coffee going cold again', 'Nobody knows where we have been', 'Half asleep and wide awake', 'Soft enough to hear you think'],
  };
  const ALBUMS = [
    { album: 'Slow Motion', artist: 'Violet Hours', key: 'a', root: 45, bpm: 92, prog: [0, 5, 3, 4], art: art('#2f2493', ['#f2589c', 30, 35, 62], ['#ffab68', 80, 85, 50], ['#7c3be0', 85, 15, 46]), songs: [['Night Drive', 214], ['Slow Motion', 187], ['Windows Down', 232], ['Streetlights', 201], ['Long Way Home', 248]] },
    { album: 'Glasshouse', artist: 'Marlow Kane', key: 'b', root: 48, bpm: 118, prog: [0, 3, 5, 4], art: art('#0d0726', ['#56d2ff', 25, 70, 66], ['#4a2fd0', 75, 30, 58], ['#ff78d6', 90, 90, 30]), songs: [['Glasshouse', 196], ['Paper Moons', 223], ['Low Tide', 178], ['Second Floor', 209]] },
    { album: 'Soft Static', artist: 'June Harbor', key: 'c', root: 43, bpm: 76, prog: [0, 4, 5, 3], art: art('#4a2fd0', ['#ffd36a', 70, 30, 54], ['#f2589c', 20, 80, 58]), songs: [['Soft Static', 242], ['Half Asleep', 191], ['Early Train', 205], ['Radio Off', 233]] },
  ];
  const SONGS = [];
  ALBUMS.forEach((a, ai) => a.songs.forEach(([title, secs], i) => SONGS.push({ title, secs, artist: a.artist, album: a.album, art: a.art, a, seed: ai * 7 + i + 1 })));
  // Real songs for trying the site at home: only if site/media/ has them, and that folder is never published.
  // Without them, every song here is made up and generated.
  const PREVIEW = 60, FADE_IN = 1.5, FADE_OUT = 3;

  // ---------- state ----------
  let cur = 0, pos = 0, playing = false, soundOn = false, view = 'queue', query = '', wall = 'colours';
  const eqv = [0, 0, 0, 0, 0];
  const song = () => SONGS[cur];
  const lineLen = () => (8 * 60) / song().a.bpm;
  const lineAt = (p) => {
    const ls = song().lines;
    if (!ls) return song().clip ? -1 : Math.floor(p / lineLen());
    let n = -1;
    for (let i = 0; i < ls.length && ls[i].t <= p; i++) n = i;
    return n;
  };
  const lyr = () => LINES[song().a.key];

  // ---------- the panels ----------
  const I = {
    play: '<path d="M7 4.6c0-1 1.1-1.6 2-1.1l11.4 7.4c.8.5.8 1.7 0 2.2L9 20.5c-.9.5-2-.1-2-1.1z" fill="currentColor"/>',
    pause: '<rect x="6" y="4" width="4.4" height="16" rx="1.4" fill="currentColor"/><rect x="13.6" y="4" width="4.4" height="16" rx="1.4" fill="currentColor"/>',
    prev: '<path d="M19 5.6c0-.8-.9-1.3-1.6-.8L8 11.2c-.6.4-.6 1.2 0 1.6l9.4 6.4c.7.5 1.6 0 1.6-.8zM5 5v14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    next: '<path d="M5 5.6c0-.8.9-1.3 1.6-.8l9.4 6.4c.6.4.6 1.2 0 1.6l-9.4 6.4c-.7.5-1.6 0-1.6-.8zM19 5v14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    on: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.6 7.6 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    off: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[n]}</svg>`;
  const scene = document.createElement('div');
  scene.className = 'scene';
  body.appendChild(scene);
  scene.innerHTML = `
    <section class="gp p-art" data-p="art" aria-label="Now playing">
      <button type="button" class="d-cover" aria-label="Play or pause"></button>
      <a class="d-cover-badge" target="_blank" rel="noopener" aria-label="Listen on Apple Music" hidden><img src="https://tools.applemediaservices.com/api/badges/listen-on-apple-music/badge/en-us?size=250x83" alt="Listen on Apple Music" width="125" height="42" loading="lazy" referrerpolicy="no-referrer"></a>
      <div class="d-now"><b class="d-t"></b><span class="d-s"></span><small class="d-credit"></small></div>
    </section>
    <section class="gp p-side" data-p="side" aria-label="Songs">
      <div class="d-tabs" role="tablist">
        <button type="button" data-view="queue" role="tab">Queue</button>
        <button type="button" data-view="search" role="tab">Search</button>
        <button type="button" data-view="library" role="tab">Library</button>
      </div>
      <h3 class="d-side-h"></h3>
      <input class="d-find" type="text" placeholder="Search any artist" aria-label="Search any artist" spellcheck="false">
      <div class="d-apple" hidden>
        <label class="d-albpick"><span>Playing</span><select class="d-albsel" aria-label="Choose top songs or an album"></select></label>
        <p class="d-apple-note">30-second previews provided courtesy of iTunes.</p>
        <a class="d-apple-link" target="_blank" rel="noopener" aria-label="Listen on Apple Music"><img src="https://tools.applemediaservices.com/api/badges/listen-on-apple-music/badge/en-us?size=250x83" alt="Listen on Apple Music" width="125" height="42" loading="lazy" referrerpolicy="no-referrer"></a>
        <button type="button" class="d-apple-back">Back to the demo songs</button>
      </div>
      <div class="d-list"></div>
    </section>
    <section class="gp p-lyr" data-p="lyr" aria-label="Lyrics">
      <div class="d-ly"><div class="d-ly-in"></div><p class="d-ly-none" hidden>This one's lyrics aren't in the demo. Press any other song and watch them follow along.</p></div>
    </section>
    <section class="gp p-snd" data-p="snd" aria-label="Sound">
      <h3>Sound</h3>
      <p class="d-hint">Drag the points.</p>
      <svg class="d-eq" viewBox="0 0 400 180" role="group" aria-label="Equalizer"></svg>
      <div class="d-pills" data-pills="eq"><button type="button" data-eq="0,0,0,0,0" class="on">Flat</button><button type="button" data-eq="7,3,0,0,0">Bass</button><button type="button" data-eq="-2,-1,5,3,0">Vocal</button><button type="button" data-eq="5,2,-1,3,6">Bright</button></div>
      <p class="d-lab">Reverb</p>
      <div class="d-pills" data-pills="rev"><button type="button" data-rev="0" class="on">Off</button><button type="button" data-rev=".5">Room</button><button type="button" data-rev="1.3">Plate</button><button type="button" data-rev="2.8">Hall</button></div>
    </section>
    <section class="gp p-look" data-p="look" aria-label="Look">
      <p class="d-lab">Glass colour</p>
      <div class="d-sw">
        <button type="button" class="on none" data-tint="" aria-label="No tint"></button>
        <button type="button" style="--c:#ffc83d" data-tint="255,200,61" aria-label="Gold"></button>
        <button type="button" style="--c:#b6f24a" data-tint="182,242,74" aria-label="Lime"></button>
        <button type="button" style="--c:#2ee6c5" data-tint="46,230,197" aria-label="Aqua"></button>
        <button type="button" style="--c:#ff5c3c" data-tint="255,92,60" aria-label="Ember"></button>
        <button type="button" style="--c:#120c26" data-tint="18,12,38" aria-label="Ink"></button>
      </div>
      <p class="d-lab">Behind the glass</p>
      <div class="d-pills" data-pills="wall"><button type="button" data-wall="colours" class="on">Moving colours</button><button type="button" data-wall="cover">The song's cover</button></div>
    </section>
    <section class="gp p-edit" data-p="edit" aria-label="Edit info">
      <div class="d-e-wall" aria-hidden="true"><i></i></div>
      <div class="d-edit-top"><div class="d-edit-art"></div><div><h3>Edit info</h3><p class="d-hint d-e-status" role="status"></p></div></div>
      <div class="d-f" data-f="t"><span>Title</span><div class="d-v"><b class="d-e-t"></b></div></div>
      <div class="d-f" data-f="a"><span>Artist</span><div class="d-v"><b class="d-e-a"></b></div><div class="d-drop" data-drop="a"></div></div>
      <div class="d-f" data-f="b"><span>Album</span><div class="d-v"><b class="d-e-b"></b></div><div class="d-drop" data-drop="b"></div></div>
      <button type="button" class="d-fix"></button>
      <svg class="d-cursor" viewBox="0 0 24 24" aria-hidden="true"><circle class="m-ring" cx="5" cy="2.500" r="8"/><g class="m-body"><path d="M5 2.500v17.200l4.700-4.300 3 6.600 3.200-1.500-3-6.500 6.400-.4z"/></g></svg>
    </section>
    <section class="gp p-dock" data-p="dock" aria-label="Player">
      <div class="d-dk-now"><div class="d-dk-art"></div><div class="d-dk-tx"><b class="d-t"></b><span class="d-s"></span></div></div>
      <div class="d-dk-mid">
        <div class="d-btns">
          <button type="button" class="d-ib d-prev" aria-label="Previous song">${icon('prev')}</button>
          <button type="button" class="d-play" aria-label="Play">${icon('play')}</button>
          <button type="button" class="d-ib d-next" aria-label="Next song">${icon('next')}</button>
        </div>
        <div class="d-bar"><span class="d-cur">0:00</span><div class="d-track" role="slider" tabindex="0" aria-label="Song position"><i></i></div><span class="d-end">0:00</span></div>
      </div>
      <div class="d-right">
        <button type="button" class="d-mute" aria-pressed="false" aria-label="Unmute">${icon('off')}</button>
        <input class="d-vol" type="range" min="0" max="100" step="1" aria-label="Volume">
      </div>
    </section>`;
  const P = Object.fromEntries($$('[data-p]', scene).map((e) => [e.dataset.p, e]));
  // Each panel's glass is two layers under its contents: the glass itself, and the light on top
  Object.values(P).forEach((el) => el.insertAdjacentHTML('afterbegin', '<i class="gp-bg"></i><i class="gp-sheen"></i>'));

  // ---------- the glass: the app's own method. One filter bends the background near the rim and frosts the middle, ----------
  // with the two fading into each other, so there's no line where the rim stops.
  const canBend = !!window.chrome && CSS.supports('backdrop-filter', 'url(#a)') && !/iPhone|iPad|iPod/.test(navigator.userAgent);
  const glassHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  glassHost.setAttribute('width', '0'); glassHost.setAttribute('height', '0'); glassHost.setAttribute('aria-hidden', 'true');
  glassHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.appendChild(glassHost);
  function glassMap(w, h, r, band) {
    const s = 1, cw = Math.max(2, Math.round(w * s)), ch = Math.max(2, Math.round(h * s));
    const c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const g = c.getContext('2d'), img = g.createImageData(cw, ch), d = img.data, hw = w / 2, hh = h / 2;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const px = (x + .5) / s - hw, py = (y + .5) / s - hh, qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const dist = -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
      let t = 1 - dist / band; t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      let nx = 0, ny = 0;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); } else if (qx > qy) nx = Math.sign(px); else ny = Math.sign(py);
      const k = (y * cw + x) * 4, a = t * t;
      d[k] = 128 - nx * a * 127; d[k + 1] = 128 - ny * a * 127; d[k + 2] = Math.round(t * 255); d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  function fitGlass() {
    if (!canBend || narrow || lite) return;
    for (const [name, el] of Object.entries(P)) {
      const w = el.offsetWidth, h = el.offsetHeight, bg = el.querySelector('.gp-bg');
      if (w < 24 || bg.dataset.size === `${w}x${h}`) continue;
      bg.dataset.size = `${w}x${h}`;
      let f = glassHost.querySelector(`#glass-${name}`);
      if (!f) { f = document.createElementNS('http://www.w3.org/2000/svg', 'filter'); f.id = `glass-${name}`; glassHost.appendChild(f); }
      for (const [k, v] of Object.entries({ filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', x: 0, y: 0, width: w, height: h, 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22;
      f.innerHTML = `<feImage href="${glassMap(w, h, r, 30)}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="raw"/>
        <feGaussianBlur in="raw" stdDeviation="2" result="map"/>
        <feDisplacementMap in="SourceGraphic" in2="map" scale="58" xChannelSelector="R" yChannelSelector="G" result="bent"/>
        <feGaussianBlur in="bent" stdDeviation="10" result="frost"/>
        <feGaussianBlur in="bent" stdDeviation="1.4" result="soft"/>
        <feColorMatrix in="map" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0" result="edge"/>
        <feComposite in="soft" in2="edge" operator="in" result="rim"/>
        <feMerge><feMergeNode in="frost"/><feMergeNode in="rim"/></feMerge>`;
      const v = `url(#glass-${name}) saturate(150%) brightness(.74)`;
      bg.style.backdropFilter = v; bg.style.webkitBackdropFilter = v;
    }
  }

  // ---------- painting ----------
  const byline = (s) => (s.album && s.album !== s.artist ? `${s.artist}, ${s.album}` : s.artist);
  function paintList() {
    const list = $('.d-list');
    $$('[data-view]', scene).forEach((b) => { b.classList.toggle('on', b.dataset.view === view); b.setAttribute('aria-selected', String(b.dataset.view === view)); });
    $('.d-side-h').textContent = view === 'queue' ? 'Queue' : view === 'search' ? 'Search' : 'Library';
    $('.d-find').hidden = view !== 'search';
    paintApple();
    const row = (s, i) => `<button type="button" class="d-row${i === cur ? ' on' : ''}" data-i="${i}"><span class="d-th" style="background:${s.art}">${i === cur ? '<em class="d-eqb"><i></i><i></i><i></i></em>' : ''}</span><span class="d-rt"><b>${esc(s.title)}</b><small>${esc(byline(s))}</small></span><span class="d-q">${s.q || 'CD'}</span><span class="d-len">${fmt(s.secs)}</span></button>`;
    if (view === 'library') {
      list.innerHTML = `<div class="d-albums">${ALBUMS.map((a) => `<button type="button" class="d-alb" data-i="${SONGS.findIndex((s) => s.a === a)}"><span style="background:${a.art}"></span><b>${esc(a.album)}</b><small>${esc(a.artist)}</small></button>`).join('')}</div><p class="d-sub">All songs</p>${SONGS.map(row).join('')}`;
      return;
    }
    const q = query.trim().toLowerCase();
    const items = SONGS.map((s, i) => [s, i]);
    const shown = view === 'queue' ? [...items.slice(cur), ...items.slice(0, cur)] : items.filter(([s]) => !q || `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(q));
    if (view === 'search' && q) {
      const found = appleFound.map((a) => artistRow(a, 'data-artist')).join('');
      const head = appleBusy ? '<p class="d-none">Looking on Apple Music</p>' : appleFailed ? '<p class="d-none">Apple Music isn\'t answering. Try again in a moment.</p>' : found ? `<p class="d-sub">Artists on Apple Music</p>${found}` : '';
      list.innerHTML = head + (shown.length ? `${found ? '<p class="d-sub">Already here</p>' : ''}${shown.map(([s, i]) => row(s, i)).join('')}` : head ? '' : '<p class="d-none">Nothing by that name.</p>');
      return;
    }
    list.innerHTML = shown.length ? shown.map(([s, i]) => row(s, i)).join('') : '<p class="d-none">No songs match that.</p>';
  }
  // ---------- any artist: pick one, then their top songs or an album. 30-second previews from Apple Music. ----------
  // The browser asks Apple directly. There's no account or key, and only what's typed in the box is sent.
  const ITUNES = 'https://itunes.apple.com';
  let waitingForArtist = false;      // picked on the way in: silence until their songs are here, not a moment of something else
  let appleFound = [], appleBusy = false, appleFailed = false, appleAsk = 0, appleTimer = 0, appleNow = null, demoSongs = null;
  const itunes = async (path, params) => {
    const r = await fetch(`${ITUNES}/${path}?${new URLSearchParams(params)}`);
    if (!r.ok) throw new Error('Apple Music said no');
    return (await r.json()).results || [];
  };
  // Apple has no artist photos here, so an artist's icon is one of their album covers. All of them are asked for in one request: Apple allows about 20 a minute.
  const artistIcons = new Map(), artistSearches = new Map();
  const searchArtists = (term) => {
    const key = term.toLowerCase();
    if (!artistSearches.has(key)) {
      const asking = itunes('search', { term, entity: 'musicArtist', limit: 5 });
      asking.catch(() => artistSearches.delete(key));
      artistSearches.set(key, asking);
    }
    return artistSearches.get(key);
  };
  async function loadIcons(rows) {
    const ids = rows.map((a) => a.artistId).filter((id) => !artistIcons.has(id));
    if (!ids.length) return false;
    ids.forEach((id) => artistIcons.set(id, ''));
    const found = await itunes('lookup', { id: ids.join(','), entity: 'album', limit: 3 }).catch(() => []);
    // each artist comes back followed by their albums, and an album can be credited to someone else, so it's the order that says whose it is
    let any = false, whose = null;
    for (const a of found) {
      if (a.wrapperType === 'artist') { whose = a.artistId; continue; }
      const id = whose ?? a.artistId;
      if (a.wrapperType === 'collection' && a.artworkUrl100 && !artistIcons.get(id)) { artistIcons.set(id, String(a.artworkUrl100).replace('100x100', '120x120')); any = true; }
    }
    return any;
  }
  const artistFace = (a) => { const url = artistIcons.get(a.artistId); return `<span class="d-face" aria-hidden="true">${url ? `<img src="${esc(url)}" alt="">` : esc(String(a.artistName).trim()[0] || '').toUpperCase()}</span>`; };
  const artistRow = (a, attr) => `<button type="button" class="d-artist" ${attr}="${a.artistId}">${artistFace(a)}<span><b>${esc(a.artistName)}</b><small>${esc(a.primaryGenreName || 'Artist')}</small></span></button>`;
  function searchApple(text) {
    clearTimeout(appleTimer);
    const me = ++appleAsk, term = text.trim();
    appleFound = []; appleFailed = false; appleBusy = term.length >= 2;
    if (!appleBusy) return;
    appleTimer = setTimeout(async () => {
      let rows = [], failed = false;
      try { rows = await searchArtists(term); } catch { failed = true; }
      if (me !== appleAsk) return;
      appleBusy = false; appleFailed = failed; appleFound = rows;
      if (view === 'search') paintList();
      if (await loadIcons(rows) && me === appleAsk && view === 'search') paintList();
    }, 400);
  }
  const songsFrom = (rows) => rows.filter((t) => t.wrapperType === 'track' && t.kind === 'song' && t.previewUrl);
  // Apple's list mixes in songs they only feature on: their own come first, and the same song on two records shows once
  function topSongs(rows, name) {
    const own = (t) => String(t.artistName).toLowerCase() === String(name).toLowerCase(), seen = new Set();
    return [...songsFrom(rows).filter(own), ...songsFrom(rows).filter((t) => !own(t))].filter((t) => {
      const key = String(t.trackName).toLowerCase().replace(/\s*[([].*$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 25);
  }
  // puts these songs in the player, in place of what was there. The demo songs wait to come back.
  function playApple(rows) {
    if (!rows.length) return false;
    demoSongs ||= { albums: [...ALBUMS], songs: [...SONGS] };
    ALBUMS.length = 0; SONGS.length = 0;
    const byName = new Map();
    rows.forEach((t, i) => {
      const name = t.collectionName || t.artistName;
      if (!byName.has(name)) {
        const a = { album: name, artist: t.artistName, key: 'a', root: 45, bpm: 130, prog: [0, 5, 3, 4], songs: [], art: `center / cover no-repeat url('${String(t.artworkUrl100).replace('100x100', '600x600')}')` };
        byName.set(name, a); ALBUMS.push(a);
      }
      const a = byName.get(name);
      SONGS.push({ title: censor(t.trackName), secs: 30, artist: t.artistName, album: name, art: a.art, a, seed: i + 1, clip: true, apple: true, link: t.trackViewUrl, q: '30s', real: { title: String(t.trackName).replace(/\s*[([]feat\.?[^)\]]*[)\]]/i, ''), artist: t.artistName, album: t.collectionName || '', full: (t.trackTimeMillis || 0) / 1000 }, versions: { m4a: t.previewUrl, mp3: t.previewUrl, wav: t.previewUrl }, start: 0 });
    });
    userPaused = false;
    cur = 0; pos = 0; query = ''; appleFound = []; $('.d-find').value = '';
    wantSound();
    go(0);
    if (note) note.textContent = 'This is a working demo. These are 30-second previews, provided courtesy of iTunes.';
    return true;
  }
  const artistAsked = new Map();
  function artistData(id) {
    if (!artistAsked.has(id)) {
      const asking = Promise.all([itunes('lookup', { id, entity: 'song', limit: 60 }), itunes('lookup', { id, entity: 'album', limit: 60 })]);
      asking.catch(() => artistAsked.delete(id));
      artistAsked.set(id, asking);
    }
    return artistAsked.get(id);
  }
  async function pickArtist(id, name) {
    appleNow = { id, name, albums: [] };
    appleBusy = true; appleFailed = false; paintList();
    try {
      const [tops, albums] = await artistData(id);
      if (appleNow?.id !== id) return;
      appleNow.albums = albums.filter((a) => a.wrapperType === 'collection' && a.collectionId).map((a) => ({ id: a.collectionId, name: a.collectionName, year: String(a.releaseDate || '').slice(0, 4) }));
      appleBusy = false;
      if (!playApple(topSongs(tops, name))) { appleFailed = true; appleNow = null; }
    } catch { appleBusy = false; appleFailed = true; appleNow = null; }
    paintList();
  }
  async function pickAlbum(value) {
    if (!appleNow) return;
    const asked = value;
    appleBusy = true; appleFailed = false;
    try {
      const rows = value === 'top' ? topSongs((await artistData(appleNow.id))[0], appleNow.name) : songsFrom(await itunes('lookup', { id: value, entity: 'song' }));
      if ($('.d-albsel').value === asked) playApple(rows);
    } catch { appleFailed = true; }
    appleBusy = false;
    paintList();
  }
  function backToDemo() {
    if (!demoSongs) return;
    ALBUMS.length = 0; SONGS.length = 0;
    ALBUMS.push(...demoSongs.albums); SONGS.push(...demoSongs.songs);
    demoSongs = null; appleNow = null; appleFound = []; query = ''; $('.d-find').value = '';
    cur = 0; pos = 0;
    if (note && noteText) note.textContent = noteText;
    go(0);
  }
  function paintApple() {
    const box = $('.d-apple'), on = view === 'search' && !!appleNow;
    box.hidden = !on;
    if (!on) return;
    const sel = $('.d-albsel'), want = sel.dataset.who !== String(appleNow.id) || sel.options.length !== appleNow.albums.length + 1;
    if (want) {
      const was = sel.value;
      sel.innerHTML = `<option value="top">${esc(appleNow.name)}: top songs</option>${appleNow.albums.map((a) => `<option value="${a.id}">${esc(censor(a.name))}${a.year ? ` (${a.year})` : ''}</option>`).join('')}`;
      sel.dataset.who = appleNow.id;
      if ([...sel.options].some((o) => o.value === was)) sel.value = was;
    }
    $('.d-apple-link').href = song().link || 'https://music.apple.com/';
    $('.d-apple-back').hidden = !demoSongs;
  }
  function paintSong() {
    const s = song(), hadFocus = usingKeys && !!document.activeElement?.closest?.('.d-list');
    $('.d-cover').style.background = s.art;
    $('.d-dk-art').style.background = s.art;
    $('.d-credit').textContent = s.apple ? 'Preview courtesy of iTunes. Lyric timing is approximate.' : s.clip ? `All rights reserved to ${s.artist}` : 'Made up for this demo';
    const badge = $('.d-cover-badge');
    badge.hidden = !s.apple;
    if (s.apple) badge.href = s.link || 'https://music.apple.com/';
    $$('.d-t', scene).forEach((e) => { e.textContent = s.title; });
    $$('.d-s', scene).forEach((e) => { e.textContent = byline(s); });
    $('.d-end').textContent = fmt(s.secs);
    paintLyrics();
    lastLine = -1;
    paintEdit();
    paintList();
    if (hadFocus) $(`.d-list [data-i="${cur}"]`)?.focus({ preventScroll: true });
  }
  // Lyrics never show a bad word in full: first and last letter, stars between. Runs on every line before it's stored.
  const ROUGH = /\b\w*(?:n+[i1!]+gg+\w*|f+u+c+k+\w*|f+[*]?ck\w*|sh+[i1!]+t+\w*|b+[i1!]+t+c+h+\w*|c+u+n+t+\w*|p+u+s+s+y+|p+u+s+s+i+e+s+|m+o+t+h+[ae]+\w*f+\w*)|\b(?:ass|asses|asshole\w*|dumbass|badass|hoe|hoes|ho|dick|dicks|cock|cocks|whore\w*|slut\w*|fag|fags|faggot\w*|bastard\w*|damn|goddamn|retard\w*|thot|thots|tit|tits|titties)\b/gi;
  const censor = (line) => String(line).replace(ROUGH, (w) => (w.length < 3 ? `${w[0]}*` : w[0] + '*'.repeat(w.length - 2) + w[w.length - 1]));
  // Apple doesn't say which 30 seconds a preview is, and previews usually sit around the hook. So this starts at the first time the most repeated line comes round.
  // It's a good guess and no more, which is why the player says the timing is approximate.
  function guessPreviewStart(text, full, secs) {
    const seen = new Map();
    for (const row of text.split('\n')) {
      const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(row.trim());
      if (!m) continue;
      const words = m[3].trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '');
      if (!words) continue;
      if (!seen.has(words)) seen.set(words, { n: 0, t: +m[1] * 60 + +m[2] });
      seen.get(words).n++;
    }
    let hook = null;
    for (const v of seen.values()) if (v.n > 1 && (!hook || v.n > hook.n)) hook = v;
    const start = hook ? hook.t - 2 : (full || 180) * .3;
    return Math.max(0, Math.min(start, Math.max(0, (full || 180) - secs)));
  }
  // Synced lyrics for a real song come from LRCLIB when it's played, the same as the app, moved to fit the preview
  function fetchLyrics(s) {
    if (s.lyricsAsked) return;
    s.lyricsAsked = true;
    const q = new URLSearchParams({ track_name: s.real.title, artist_name: s.real.artist, album_name: s.real.album, duration: Math.round(s.real.full) });
    const lrc = (j) => (j && j.syncedLyrics ? j.syncedLyrics : null);
    fetch(`https://lrclib.net/api/get?${q}`).then((r) => (r.ok ? r.json() : null)).then(lrc)
      .then((text) => text || fetch(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: s.real.title, artist_name: s.real.artist })}`).then((r) => (r.ok ? r.json() : [])).then((rows) => lrc(rows.find((x) => x.syncedLyrics))))
      .then((text) => {
        if (!text) { s.lines = null; return; }
        if (s.apple) s.start = guessPreviewStart(text, s.real.full, s.secs);
        const lines = [];
        for (const row of text.split('\n')) {
          const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(row.trim());
          if (!m) continue;
          const t = +m[1] * 60 + +m[2] - s.start, words = censor(m[3].trim());
          if (words && t >= -.5 && t < s.secs) lines.push({ t: Math.max(0, t), words });
        }
        s.lines = lines.length ? lines : null;
      })
      .catch(() => { s.lines = null; })
      .finally(() => { s.lyricsDone = true; if (song() === s) paintLyrics(); });
  }
  function paintLyrics() {
    const s = song(), none = $('.d-ly-none'), box = $('.d-ly-in');
    if (s.clip) fetchLyrics(s);
    const rows = s.clip ? (s.lines || []).map((l) => l.words) : Array.from({ length: Math.ceil(s.secs / lineLen()) }, (_, i) => lyr()[i % lyr().length]);
    box.innerHTML = rows.map((w, i) => `<button type="button" data-l="${i}">${esc(w)}</button>`).join('');
    box.style.transform = '';
    none.hidden = rows.length > 0;
    none.textContent = s.lyricsDone ? 'No synced lyrics found for this part of the song.' : 'Looking for the lyrics.';
    lastLine = -1;
  }
  const setField = (k, v) => { $(`.d-e-${k}`).textContent = v; };
  // ---------- Find online, played out, a different song each time ----------
  // It only ever happens in this panel: the songs in the list keep their real names.
  const MESSES = [['track_07_FINAL(2)', 'Unknown artist', 'New folder'], ['audio_0142 (1)', 'Unknown', 'Downloads'], ['New Recording 33', 'Artist', 'Untitled'], ['untitled_master_v3', 'Various', 'misc'], ['song (copy) (copy)', 'Unknown artist', 'Music'], ['bounce_final_FINAL', 'Unknown', 'Desktop']];
  const MESS_ART = 'linear-gradient(135deg, #3b3556, #1f1a38)';
  let editIdx = -1, messIdx = -1, editSong = null, editing = false, editRun = 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  // focus only follows the song for someone on the keyboard: a mouse click shouldn't leave an outline on the next row
  let usingKeys = false;
  addEventListener('keydown', (e) => { if (e.key === 'Tab' || e.key.startsWith('Arrow')) { usingKeys = true; document.body.classList.add('using-keys'); } }, true);
  addEventListener('pointerdown', () => { usingKeys = false; document.body.classList.remove('using-keys'); }, true);
  // The glass glides from the colour it is to the one you picked, and out of colour altogether when you pick none.
  let tintRgb = null, tintA = 0, tintTrip = 0;
  function shiftTint(value) {
    const to = value ? value.split(',').map(Number) : null, fromRgb = tintRgb || to, fromA = tintA, toA = to ? 1 : 0, me = ++tintTrip, t0 = performance.now(), ms = still ? 0 : 850;
    if (!fromRgb) return;
    body.classList.add('tinted');
    const step = (now) => {
      if (me !== tintTrip) return;
      const k = ms ? Math.min(1, Math.max(0, (now - t0) / ms)) : 1, e = k * k * (3 - 2 * k), end = to || fromRgb;
      tintRgb = fromRgb.map((v, i) => v + (end[i] - v) * e);
      tintA = fromA + (toA - fromA) * e;
      scene.style.setProperty('--tint', tintRgb.map((v) => v.toFixed(1)).join(', '));
      scene.style.setProperty('--tint-a', tintA.toFixed(3));
      if (k < 1) requestAnimationFrame(step);
      else if (!to) { body.classList.remove('tinted'); tintRgb = null; }
    };
    step(t0);
  }
  function showMess() {
    const m = MESSES[messIdx];
    P.edit.classList.remove('fixed');
    $('.d-edit-art').style.background = MESS_ART;
    setField('t', m[0]); setField('a', m[1]); setField('b', m[2]);
    $('.d-e-status').textContent = 'The file on your computer';
    $('.d-fix').textContent = 'Find online';
  }
  function showClean() {
    P.edit.classList.add('fixed');
    $('.d-edit-art').style.background = editSong.art;
    $('.d-e-wall i').style.background = editSong.art;
    setField('t', editSong.title); setField('a', editSong.artist); setField('b', editSong.album);
    $('.d-e-status').textContent = 'Saved into the file';
    $('.d-fix').textContent = 'Do another song';
  }
  function paintEdit() { if (editing) return; if (editSong) showClean(); else { messIdx = Math.max(messIdx, 0); showMess(); } }
  // A mouse moved by a hand: a slight curve, quick in the middle, slowing to land, leaning a little on the way.
  function makeMouse(el) {
    let x = 0, y = 0, trip = 0;
    const ring = el.querySelector('.m-ring');
    const paint = (px, py, lean = 0) => { x = px; y = py; el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) rotate(${lean.toFixed(2)}deg)`; };
    const to = (px, py, ms) => new Promise((done) => {
      const me = ++trip, fromX = x, fromY = y, dx = px - fromX, dy = py - fromY, far = Math.hypot(dx, dy);
      if (far < 1) return done();
      const time = ms || Math.min(950, Math.max(380, 320 + far * .9)), t0 = performance.now();
      // the bend always arcs upward, the way a wrist swings
      const side = (dx >= 0 ? -1 : 1) * far * .1, bendX = fromX + dx / 2 - (dy / far) * side, bendY = fromY + dy / 2 + (dx / far) * side;
      const step = (now) => {
        if (me !== trip) return done();
        const t = Math.min(1, Math.max(0, (now - t0) / time)), s = t * t * t * (10 - 15 * t + 6 * t * t), u = 1 - s;
        paint(u * u * fromX + 2 * u * s * bendX + s * s * px, u * u * fromY + 2 * u * s * bendY + s * s * py, Math.sin(Math.PI * t) * 4 * (dx / far));
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    return {
      to,
      at(px, py) { trip++; paint(px, py); },
      async press(ms = 130) {
        el.classList.add('press');
        ring.animate?.([{ transform: 'scale(.2)', opacity: .9 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: 520, easing: 'ease-out' });
        await pause(ms);
        el.classList.remove('press');
      },
      leave() { el.classList.remove('on'); to(x + 46, y + 30, 380); },
      stop() { trip++; el.classList.remove('on', 'press'); },
    };
  }
  // the mouse in the panel: places come from the layout, so the panel's tilt and size can't throw it off
  let editMouse = null;
  const editHand = () => (editMouse ||= makeMouse($('.d-cursor')));
  async function pointAt(el, id) {
    if (id !== editRun || !el) return;
    let x = el.offsetWidth * .42, y = el.offsetHeight * .55;
    for (let e = el; e && e !== P.edit; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    $('.d-cursor').classList.add('on');
    await editHand().to(x, y);
    await pause(90);
  }
  async function pressHere(id) {
    if (id !== editRun) return;
    await editHand().press(150);
    await pause(120);
  }
  const wipe = async (el, id) => { for (let t = el.textContent; t.length; t = t.slice(0, -2)) { if (id !== editRun) return; el.textContent = t; await pause(26); } el.textContent = ''; };
  async function typeInto(k, to, id) {
    const el = $(`.d-e-${k}`), f = el.closest('.d-f');
    await pointAt(f.querySelector('.d-v'), id);
    await pressHere(id);
    f.classList.add('active');
    await wipe(el, id);
    const gap = Math.min(70, 1000 / Math.max(1, to.length));
    for (let i = 1; i <= to.length; i++) { if (id !== editRun) return; el.textContent = to.slice(0, i); await pause(gap); }
    await pause(220);
    f.classList.remove('active');
  }
  async function pick(k, typed, options, chosen, id) {
    const el = $(`.d-e-${k}`), f = el.closest('.d-f'), drop = f.querySelector('.d-drop');
    await pointAt(f.querySelector('.d-v'), id);
    await pressHere(id);
    f.classList.add('active');
    await wipe(el, id);
    const show = (q) => { drop.innerHTML = options.filter((o) => o.name.toLowerCase().startsWith(q.toLowerCase())).map((o) => `<div class="d-opt${o.name === chosen ? ' best' : ''}"><i style="background:${o.art}"></i><span><b>${esc(o.name)}</b><small>${esc(o.sub)}</small></span></div>`).join(''); };
    show('');
    drop.classList.add('open');
    await pause(520);
    for (let i = 1; i <= typed.length; i++) { if (id !== editRun) return; el.textContent = typed.slice(0, i); show(el.textContent); await pause(130); }
    await pause(180);
    if (id !== editRun) return;
    const opt = drop.querySelector('.d-opt');
    await pointAt(opt, id);
    await pressHere(id);
    opt?.classList.add('picked');
    await pause(220);
    el.textContent = chosen;
    drop.classList.remove('open');
    f.classList.remove('active');
    await pause(220);
  }
  const firstThree = (list, chosen) => [...list.filter((o) => o.name === chosen), ...list.filter((o) => o.name !== chosen)].slice(0, 3);
  function artistOptions() {
    const names = new Map();
    for (const s of SONGS) {
      if (!names.has(s.artist)) names.set(s.artist, { name: s.artist, n: 0, art: s.art });
      names.get(s.artist).n++;
      for (const m of String(s.title).matchAll(/\(feat\. ([^)]+)\)/g)) if (!names.has(m[1])) names.set(m[1], { name: m[1], n: 0, art: s.art, feat: true });
    }
    return firstThree([...names.values()].map((o) => ({ name: o.name, sub: o.feat ? 'Featured' : `${o.n} song${o.n === 1 ? '' : 's'}`, art: o.art })), editSong.artist);
  }
  function albumOptions() {
    return firstThree([...ALBUMS.map((a) => ({ name: a.album, sub: a.artist, art: a.art })), { name: MESSES[messIdx][2], sub: 'Where the file was', art: MESS_ART }], editSong.album);
  }
  async function runEdit(byItself) {
    const id = ++editRun;
    editIdx = editIdx < 0 ? Math.min(7, SONGS.length - 1) : (editIdx + 4) % SONGS.length;
    editSong = SONGS[editIdx];
    messIdx = (messIdx + 1) % MESSES.length;
    editing = true;
    showMess();
    const name = editSong.title, c = $('.d-cursor');
    if (still) { editing = false; showClean(); return; }
    // the mouse comes in from the side, unless it's already here
    if (!c.classList.contains('on')) editHand().at(P.edit.offsetWidth + 40, P.edit.offsetHeight * .3);
    await pause(byItself ? 420 : 60);
    if (byItself) {
      await pointAt($('.d-fix'), id);
      if (id !== editRun) return;
      $('.d-fix').classList.add('pressed');
      await pressHere(id);
      $('.d-fix').classList.remove('pressed');
    }
    if (id !== editRun) return;
    $('.d-fix').textContent = 'Finding it';
    $('.d-e-status').textContent = 'Looking this song up';
    await pause(260);
    await typeInto('t', name, id);
    if (id !== editRun) return;
    await pick('a', editSong.artist.slice(0, 3), artistOptions(), editSong.artist, id);
    if (id !== editRun) return;
    await pick('b', editSong.album.slice(0, 2), albumOptions(), editSong.album, id);
    if (id !== editRun) return;
    editHand().leave();
    // the real cover lands, and its colours fill the glass behind
    editing = false;
    showClean();
    $('.d-edit-art').animate?.([{ transform: 'scale(.7) rotate(-5deg)', opacity: .3 }, { transform: 'scale(1.07)', opacity: 1, offset: .65 }, { transform: 'none' }], { duration: 760, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  // when the player's away, a small mute button stays
  const miniMute = document.createElement('button');
  miniMute.type = 'button'; miniMute.className = 'mini-mute';
  body.appendChild(miniMute);
  function paintPlay() {
    $('.d-play').innerHTML = icon(playing ? 'pause' : 'play');
    $('.d-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
    const m = $('.d-mute');
    m.innerHTML = icon(soundOn ? 'on' : 'off');
    m.setAttribute('aria-label', soundOn ? 'Mute' : 'Unmute');
    miniMute.innerHTML = icon(soundOn ? 'on' : 'off');
    miniMute.setAttribute('aria-label', soundOn ? 'Mute' : 'Unmute');
    m.setAttribute('aria-pressed', String(soundOn));
    m.classList.toggle('lit', !soundOn);
  }

  // ---------- volume: starts well below full, and remembers where you left it ----------
  let vol = .16;
  try { const v = parseFloat(localStorage.getItem('glassy.volume')); if (v >= 0 && v <= 1) vol = v; } catch { /* no storage here */ }

  // ---------- the music: made here with Web Audio, so it's nobody's song ----------
  let ctx = null, out = null, dimLP = null, eqs = [], verbGain = null, verb = null, dry = null, an = null, hatBuf = null, data = null;
  let t0 = 0, nextStep = 0, ticker = 0;
  const FREQ = [60, 230, 910, 3600, 14000];
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  const MINOR = [0, 2, 3, 5, 7, 8, 10];
  function audio() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createGain(); out.gain.value = 0;
    dimLP = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' }); dimLP.frequency.value = 500; dimLP.Q.value = .3;
    eqs = FREQ.map((f, i) => Object.assign(ctx.createBiquadFilter(), { type: i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking' }));
    eqs.forEach((e, i) => { e.frequency.value = FREQ[i]; e.gain.value = eqv[i]; if (i) eqs[i - 1].connect(e); });
    dry = ctx.createGain(); verbGain = ctx.createGain(); verbGain.gain.value = 0; verb = ctx.createConvolver();
    const comp = ctx.createDynamicsCompressor();
    an = ctx.createAnalyser(); an.fftSize = 256; data = new Uint8Array(an.frequencyBinCount);
    eqs[4].connect(dry); eqs[4].connect(verb); verb.connect(verbGain);
    dry.connect(comp); verbGain.connect(comp); comp.connect(an); an.connect(dimLP); dimLP.connect(out); out.connect(ctx.destination);
    hatBuf = ctx.createBuffer(1, ctx.sampleRate * .05, ctx.sampleRate);
    const h = hatBuf.getChannelData(0); for (let i = 0; i < h.length; i++) h[i] = Math.random() * 2 - 1;
    setVerb(pendingVerb);
  }
  let pendingVerb = 0;
  function setVerb(sec) {
    pendingVerb = sec;
    if (!ctx) return;
    if (!sec) { verbGain.gain.setTargetAtTime(0, ctx.currentTime, .1); return; }
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.4; }
    verb.buffer = b;
    verbGain.gain.setTargetAtTime(.32, ctx.currentTime, .1);
  }
  const into = () => eqs[0];
  function tone(type, f, at, len, vol, cut) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + Math.min(.02, len / 4)); g.gain.exponentialRampToValueAtTime(.0008, at + len);
    if (cut) { const lp = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' }); lp.frequency.value = cut; o.connect(lp); lp.connect(g); } else o.connect(g);
    g.connect(into()); o.start(at); o.stop(at + len + .05);
  }
  function step(n, at) {
    const s = song(), a = s.a, st = 15 / a.bpm, deg = a.prog[Math.floor(n / 16) % a.prog.length];
    const note = (d, oct = 0) => a.root + 12 * oct + MINOR[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
    const r = (k) => { const x = Math.sin((s.seed * 97 + k) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    if (n % 16 === 0) [0, 2, 4, 6].forEach((d) => { tone('sawtooth', mtof(note(deg + d, 1)), at, st * 16, .035, 1300); tone('triangle', mtof(note(deg + d, 1)) * 1.003, at, st * 16, .05); });
    const four = a.bpm > 100;
    if (four ? n % 4 === 0 : (n % 16 === 0 || n % 16 === 10)) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(130, at); o.frequency.exponentialRampToValueAtTime(42, at + .12);
      g.gain.setValueAtTime(.55, at); g.gain.exponentialRampToValueAtTime(.001, at + .24);
      o.connect(g); g.connect(into()); o.start(at); o.stop(at + .26);
    }
    if (n % 16 === 4 || n % 16 === 12) { const b = ctx.createBufferSource(), g = ctx.createGain(), f = Object.assign(ctx.createBiquadFilter(), { type: 'bandpass' }); f.frequency.value = 1900; b.buffer = hatBuf; b.loop = true; g.gain.setValueAtTime(.16, at); g.gain.exponentialRampToValueAtTime(.001, at + .16); b.connect(f); f.connect(g); g.connect(into()); b.start(at); b.stop(at + .18); }
    if (n % 2 === 0) { const b = ctx.createBufferSource(), g = ctx.createGain(), f = Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }); f.frequency.value = 7500; b.buffer = hatBuf; g.gain.value = n % 4 === 2 ? .07 : .035; b.connect(f); f.connect(g); g.connect(into()); b.start(at); }
    if (n % 8 === 0 || (n % 16 === 14)) tone('triangle', mtof(note(deg, -1)), at, st * 5, .26, 600);
    const bar = Math.floor(n / 16);
    if (r(n % 64 + bar % 4) > .62) tone('sine', mtof(note(deg + [0, 2, 4, 7, 9][Math.floor(r(n % 32) * 5)], 2)), at, st * 3.5, .075);
  }
  // ---- real songs: a one-minute preview in three versions. The one played depends on this visitor's connection. ----
  const buffers = new Map();     // song -> decoded audio; the last few, since decoded audio is large
  let clipSrc = null, clipGain = null, measured = 0;
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  function versionNow() {
    if (connection && connection.saveData) return 'mp3';
    if (!measured && connection && /2g|3g/.test(connection.effectiveType || '')) return 'mp3';
    const mbps = measured || (connection && connection.downlink) || 0;      // what we really saw beats what the browser guesses
    if (mbps >= 25) return 'wav';
    if (mbps && mbps < 2) return 'mp3';
    return 'm4a';      // the middle one, and what a browser that won't say gets
  }
  const fileOf = (sg) => sg.versions[versionNow()];
  function stopClip() {
    if (!clipSrc) return;
    const src = clipSrc, g = clipGain;
    clipSrc = clipGain = null;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setTargetAtTime(0, ctx.currentTime, .05);
    src.stop(ctx.currentTime + .3);
  }
  async function download(file) {
    const t0 = performance.now(), r = await fetch(file), b = await r.arrayBuffer(), secs = (performance.now() - t0) / 1000;
    if (b.byteLength > 300000 && secs > .04) measured = measured ? measured * .6 + ((b.byteLength * 8) / 1e6 / secs) * .4 : (b.byteLength * 8) / 1e6 / secs;
    return b;
  }
  function loadClip(sg) {
    if (!buffers.has(sg)) {
      const loading = download(fileOf(sg)).then((b) => ctx.decodeAudioData(b));
      loading.catch(() => { if (buffers.get(sg) === loading) buffers.delete(sg); });      // a failed try can be tried again
      buffers.set(sg, loading);
      if (buffers.size > 3) buffers.delete(buffers.keys().next().value);
    }
    return buffers.get(sg);
  }
  // Songs get fetched ahead as you go through the site, one at a time, quietly: the browser keeps them, so pressing one starts straight away
  const fetched = new Set();
  let wanted = 0, fetching = false;
  function wantMore(room) { wanted = Math.max(wanted, (room + 1) * 3); pump(); }
  async function pump() {
    if (fetching || !SONGS[0]?.versions || SONGS[0].apple) return;      // Apple's previews load when they're played
    const limit = connection && connection.saveData ? 2 : wanted;
    const order = SONGS.map((_, i) => SONGS[(cur + 1 + i) % SONGS.length]).filter((sg) => !fetched.has(sg));
    if (!order.length || fetched.size >= limit) return;
    fetching = true;
    const sg = order[0];
    try { await download(fileOf(sg)); fetched.add(sg); } catch { fetched.add(sg); /* it loads when pressed instead */ }
    fetching = false;
    setTimeout(pump, 120);
  }
  let clipTry = 0;
  async function startClip() {
    stopClip();
    const sg = song(), id = ++clipTry;
    if (!ctx || !sg.clip || !soundOn || !playing) return;
    if (sg.apple) { streamPreview(sg, id); return; }
    let buf;
    try { buf = await loadClip(sg); } catch { buffers.delete(sg); return; }
    if (id !== clipTry || song() !== sg || !soundOn || !playing) return;
    t0 = ctx.currentTime + .03 - pos;      // decoding takes a moment: the song picks up from where the clock shows
    const now = ctx.currentTime + .03, s = clamp(pos, 0, sg.secs), left = sg.secs - s, g = ctx.createGain(), src = ctx.createBufferSource();
    src.buffer = buf; src.connect(g); g.connect(into());
    const endAt = now + left, fadeFrom = Math.max(now, endAt - FADE_OUT);
    g.gain.setValueAtTime(.0001, now);
    g.gain.linearRampToValueAtTime(1, now + Math.max(.18, FADE_IN - s));      // in from silence, whether starting or jumping
    g.gain.setValueAtTime(1, fadeFrom);
    g.gain.linearRampToValueAtTime(.0001, endAt);
    src.start(now, s, left);
    clipSrc = src; clipGain = g;
    loadClip(SONGS[(cur + 1) % SONGS.length]).catch(() => {});      // the next one is ready when this one ends
  }
  // Apple's previews are only ever streamed: nothing is downloaded or kept, and each plays through the same sound chain as everything else.
  function streamPreview(sg, id) {
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = sg.versions.m4a;
    const node = ctx.createMediaElementSource(el), g = ctx.createGain();
    node.connect(g); g.connect(into());
    const now = ctx.currentTime;
    g.gain.setValueAtTime(.0001, now);
    clipGain = g;
    clipSrc = { stop: () => setTimeout(() => { el.pause(); el.removeAttribute('src'); el.load(); node.disconnect(); g.disconnect(); }, 320) };
    const ours = () => id === clipTry && song() === sg;
    el.addEventListener('loadedmetadata', () => {
      if (!ours()) return;
      if (el.duration && Math.abs(el.duration - sg.secs) > .05) { sg.secs = el.duration; $('.d-end').textContent = fmt(sg.secs); }
      if (pos > .1 && pos < el.duration) el.currentTime = pos;
    }, { once: true });
    el.addEventListener('playing', () => {
      if (!ours()) return;
      t0 = ctx.currentTime - el.currentTime;      // the clock follows the stream, however long it took to start
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setTargetAtTime(1, ctx.currentTime, .25);
    });
    el.addEventListener('timeupdate', () => {
      if (ours() && el.duration && el.duration - el.currentTime < FADE_OUT && !el.fading) { el.fading = true; g.gain.setTargetAtTime(.0001, ctx.currentTime, .8); }
    });
    el.play().catch(() => {});
  }
  function resync() {
    if (!ctx) return;
    t0 = ctx.currentTime + .03 - pos;
    nextStep = Math.ceil(pos / (15 / song().a.bpm));
    if (song().clip) startClip(); else stopClip();
  }
  function schedule() {
    if (!ctx || !soundOn || !playing || song().clip) return;
    const st = 15 / song().a.bpm;
    while (t0 + nextStep * st < ctx.currentTime + .22) { step(nextStep, Math.max(ctx.currentTime, t0 + nextStep * st)); nextStep++; }
  }
  // ---- how loud: your volume, times where you are. Faint and muffled on the first screen, full by the first part of the demo, ----
  // a little under that beside the other pages.
  function applyLevel() {
    if (!ctx) return;
    // faint and muffled at both ends: the first screen, and the bottom of whatever page you're on
    const near = stage ? clamp(f / 1.1) * (1 - clamp(f - 5)) : .62 * (1 - pageEnd);
    const gain = soundOn && playing && !waitingForArtist ? vol * mix(.3, 1, near) : 0;
    if (Math.abs(gain - gainNow) > .002) { gainNow = gain; out.gain.setTargetAtTime(gain, ctx.currentTime, .09); }
    // off in another tab or window it goes muffled, and comes back when you do. It never gets clearer than it already was.
    const cut = tabAway ? Math.min(500, 500 * 40 ** (stage ? near : .8 * (1 - pageEnd))) : 500 * 40 ** (stage ? near : .8 * (1 - pageEnd));
    if (Math.abs(cut - cutNow) > 4) { cutNow = cut; dimLP.frequency.setTargetAtTime(cut, ctx.currentTime, tabAway ? .22 : .16); }
  }
  let tabAway = false;
  const tabChanged = (away) => { if (tabAway !== away) { tabAway = away; applyLevel(); } };
  addEventListener('blur', () => tabChanged(true));
  addEventListener('focus', () => tabChanged(false));
  document.addEventListener('visibilitychange', () => tabChanged(document.hidden));
  let gainNow = 0, cutNow = 0, started = false, startedAt = 0, pageEnd = 0, declined = false, endAway = false;
  const readPageEnd = () => {
    // only a page that ends on the download button gets the muffled ending, and clears everything away for it
    const rest = document.documentElement.scrollHeight - innerHeight - scrollY, room = document.documentElement.scrollHeight - innerHeight;
    pageEnd = stage ? 0 : $('main [data-bare]') ? 1 : room < 40 || !$('main .end-cta') ? 0 : clamp(1 - rest / Math.min(460, room));
    const away = pageEnd > .3;
    if (away !== endAway) { endAway = away; flightUntil = performance.now() + 1400; }
  };
  addEventListener('scroll', readPageEnd, { passive: true });
  function sound(on) {
    soundOn = on;
    if (on) { audio(); ctx.resume(); resync(); if (!ticker) ticker = setInterval(schedule, 40); }
    else stopClip();
    paintPlay();
  }
  function setPlaying(on) {
    playing = on;
    if (ctx) { if (on && soundOn) { if (ctx.state !== 'running') ctx.resume(); resync(); } else stopClip(); }
    paintPlay();
  }
  // ---- starting by itself: browsers allow sound only after someone clicks or presses a key, so that's the moment it begins ----
  function startMusic() {
    if (started) return;
    started = true; startedAt = performance.now();
    body.classList.add('music-on');
    playing = true;
    sound(true);
  }
  // A phone can suspend audio during a call or screen lock: coming back picks it up again.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && soundOn && playing && ctx.state !== 'running') ctx.resume(); });
  const justStarted = () => performance.now() - startedAt < 700;
  function armStart() {
    const kick = (e) => {
      if (declined || !e.isTrusted || body.classList.contains('gate-up')) return;
      if (e.type === 'keydown' && /^(Tab|Shift|Control|Alt|Meta)$/.test(e.key)) return;
      if (!started) startMusic();
      if (ctx && ctx.state !== 'running') ctx.resume();
      else if (ctx) for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) removeEventListener(t, kick, true);
    };
    for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) addEventListener(t, kick, true);
    // a browser that already trusts this site lets it start straight away
    try {
      audio();
      ctx.resume();
      setTimeout(() => { if (ctx.state === 'running' && !started && !declined && !body.classList.contains('gate-up')) startMusic(); }, 250);
    } catch { /* it waits for the first click */ }
  }
  function go(i, keep) {
    cur = (i + SONGS.length) % SONGS.length; pos = keep ? pos : 0;
    paintSong(); resync();
    if (ctx && soundOn && ctx.state !== 'running') ctx.resume();
    if (!playing) setPlaying(true);
  }
  // Pressing a song, or anything to do with the sound, means they want to hear it. Unless they paused it themselves: that stays paused.
  let userPaused = false;
  function wantSound() {
    if (!started) { started = true; body.classList.add('music-on'); }
    if (!soundOn) sound(true);
    if (!playing && !userPaused) setPlaying(true);
  }
  const toggleMute = () => { if (justStarted()) return; if (soundOn) sound(false); else wantSound(); };

  // ---------- the controls ----------
  scene.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.artist) { const n = b.querySelector('b').textContent; pickArtist(+b.dataset.artist, n); return; }
    if (b.matches('.d-apple-back')) { backToDemo(); return; }
    if (b.dataset.view) { view = b.dataset.view; paintList(); if (view === 'search') $('.d-find').focus({ preventScroll: true }); return; }
    if (b.dataset.i != null) { userPaused = false; wantSound(); go(+b.dataset.i); return; }
    if (b.dataset.l != null) { wantSound(); pos = song().lines ? song().lines[+b.dataset.l].t : +b.dataset.l * lineLen(); resync(); return; }
    if (b.dataset.eq) { b.dataset.eq.split(',').forEach((v, i) => setBand(i, +v)); pills(b); drawEq(); return; }
    if (b.dataset.rev != null) { pills(b); setVerb(+b.dataset.rev); wantSound(); return; }
    if (b.dataset.tint != null) {
      $$('.d-sw button').forEach((o) => o.classList.toggle('on', o === b));
      shiftTint(b.dataset.tint);
      return;
    }
    if (b.dataset.wall) { pills(b); wall = b.dataset.wall; return; }
    if (b.matches('.d-play, .d-cover')) {
      if (justStarted()) return;
      if (playing) { userPaused = true; setPlaying(false); } else { userPaused = false; wantSound(); }
      return;
    }
    if (b.matches('.d-next')) { userPaused = false; wantSound(); go(cur + 1); return; }
    if (b.matches('.d-prev')) { userPaused = false; wantSound(); go(pos > 3 ? cur : cur - 1); return; }
    if (b.matches('.d-mute')) { toggleMute(); return; }
    if (b.matches('.d-fix')) runEdit(false);
  });
  const pills = (b) => $$('button', b.parentElement).forEach((o) => o.classList.toggle('on', o === b));
  $('.d-find').addEventListener('input', (e) => { query = e.target.value; searchApple(query); paintList(); });
  $('.d-albsel').addEventListener('change', (e) => pickAlbum(e.target.value));
  miniMute.addEventListener('click', toggleMute);
  const volEl = $('.d-vol');
  const paintVol = () => { volEl.value = Math.round(vol * 100); volEl.style.setProperty('--v', `${vol * 100}%`); };
  paintVol();
  volEl.addEventListener('input', () => {
    vol = volEl.value / 100;
    paintVol();
    try { localStorage.setItem('glassy.volume', String(vol)); } catch { /* it just won't be remembered */ }
    wantSound();      // moving the volume means you want to hear it
  });
  const track = $('.d-track');
  const seekTo = (e) => { const r = track.getBoundingClientRect(); pos = clamp((e.clientX - r.left) / r.width) * song().secs; resync(); };
  track.addEventListener('pointerdown', (e) => { track.setPointerCapture(e.pointerId); seekTo(e); track.addEventListener('pointermove', seekTo); });
  track.addEventListener('pointerup', () => track.removeEventListener('pointermove', seekTo));
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { pos = clamp(pos + (e.key === 'ArrowRight' ? 5 : -5), 0, song().secs); resync(); e.preventDefault(); } });

  // ---------- the equalizer: a real curve on the real sound ----------
  const eqSvg = $('.d-eq');
  const EW = 400, EH = 180, ex = (i) => 36 + i * ((EW - 72) / 4), ey = (v) => EH / 2 - (v / 12) * (EH / 2 - 16);
  function setBand(i, v) { eqv[i] = clamp(v, -12, 12); if (ctx) eqs[i].gain.setTargetAtTime(eqv[i], ctx.currentTime, .03); }
  function drawEq() {
    const pts = [[0, ey(eqv[0])], ...eqv.map((v, i) => [ex(i), ey(v)]), [EW, ey(eqv[4])]];
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], m = (a[0] + b[0]) / 2; d += ` C${m} ${a[1]} ${m} ${b[1]} ${b[0]} ${b[1]}`; }
    eqSvg.innerHTML = `<line x1="0" x2="${EW}" y1="${EH / 2}" y2="${EH / 2}" class="d-eq-z"/><path d="${d} L${EW} ${EH} L0 ${EH}Z" class="d-eq-f"/><path d="${d}" class="d-eq-l"/>${eqv.map((v, i) => `<circle cx="${ex(i)}" cy="${ey(v)}" r="9" data-b="${i}" tabindex="0" role="slider" aria-label="Band ${FREQ[i]} Hz" aria-valuenow="${v.toFixed(0)}" aria-valuemin="-12" aria-valuemax="12"/>`).join('')}`;
  }
  let dragBand = -1;
  const bandFrom = (e) => { const r = eqSvg.getBoundingClientRect(), y = ((e.clientY - r.top) / r.height) * EH; setBand(dragBand, ((EH / 2 - y) / (EH / 2 - 16)) * 12); drawEq(); };
  eqSvg.addEventListener('pointerdown', (e) => {
    const r = eqSvg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * EW;
    dragBand = clamp(Math.round((x - 36) / ((EW - 72) / 4)), 0, 4);
    eqSvg.setPointerCapture(e.pointerId); wantSound(); bandFrom(e);
    $$('[data-pills="eq"] button').forEach((o) => o.classList.remove('on'));
  });
  eqSvg.addEventListener('pointermove', (e) => { if (dragBand >= 0) bandFrom(e); });
  eqSvg.addEventListener('pointerup', () => { dragBand = -1; });
  eqSvg.addEventListener('keydown', (e) => { const b = e.target.dataset?.b; if (b == null) return; if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { setBand(+b, eqv[+b] + (e.key === 'ArrowUp' ? 1 : -1)); drawEq(); eqSvg.querySelector(`[data-b="${b}"]`).focus(); e.preventDefault(); } });

  // ---------- the scroll: the app stays put and changes ----------
  // Chapters: 0 the first screen, 1 library, 2 lyrics, 3 sound, 4 make it yours, 5 fixing files, 6 the end.
  // Each panel: x, y, z, rotateX, rotateY, scale, opacity, in pixels of a 1440 x 900 window, from its centre.
  // A panel leaving is gone before the next one arrives, so no two ever cross.
  const S = (x, y, z, rx, ry, s, o) => ({ x, y, z, rx, ry, s, o });
  // Every scroll is a room. Going forward, the room you're in comes past you and fades; the next one rises out of the distance.
  const coming = (r) => ({ ...r, y: r.y + 36, z: r.z - 420, rx: r.rx - 6, s: r.s * .84, o: 0 });
  const gone = (r) => ({ ...r, y: r.y - 28, z: r.z + 170, rx: r.rx + 4, s: r.s * 1.1, o: 0 });
  // a panel that belongs to the given rooms: it waits to come before its first one, and has gone after its last
  const rooms = (places, peek) => {
    const nums = Object.keys(places).map(Number), first = Math.min(...nums), last = Math.max(...nums), out = [];
    for (let c = 0; c < 7; c++) {
      if (places[c]) out.push(places[c]);
      else if (c < first) out.push(coming(places[first]));
      else if (c > last) out.push(gone(places[last]));
      else { const next = nums.filter((n) => n > c).sort((m, n) => m - n)[0], prev = nums.filter((n) => n < c).sort((m, n) => n - m)[0]; out.push(places[c - 1] === places[prev] ? gone(places[prev]) : coming(places[next])); }
    }
    return out;
  };
  const AT = S(240, -30, 0, 2, -7, 1, 1);
  const DOCK = S(150, 372, 30, 5, 0, .86, 1);
  const WIDE = {
    art: rooms({ 1: S(-5, -20, 0, 3, 9, .74, 1), 4: S(70, -172, -20, 3, 8, .62, 1) }),
    side: rooms({ 1: S(350, -22, 0, 2, -9, .96, 1), 4: S(490, -30, -20, 2, -10, .8, 1) }),
    lyr: rooms({ 2: AT }),
    snd: rooms({ 3: AT }),
    look: rooms({ 4: S(70, 165, 20, -2, 7, .96, 1) }),
    edit: rooms({ 5: S(240, -40, 0, 2, -8, 1, 1) }),
    dock: [S(150, 640, 0, 24, 0, .86, 0), DOCK, DOCK, DOCK, DOCK, DOCK, S(150, 640, -100, 20, 0, .84, 0)],
  };
  // on a phone: one panel at a time, under the words
  const PD = S(0, 372, 20, 0, 0, 1, 1), PA = S(0, 52, 0, 0, 0, 1, 1);
  const NARROW = {
    art: rooms({ 4: S(0, -50, -40, 0, 0, .56, 1) }),
    side: rooms({ 1: S(0, 92, 0, 0, 0, 1, 1) }),
    lyr: rooms({ 2: PA }),
    snd: rooms({ 3: S(0, 52, 0, 0, 0, .9, 1) }),
    look: rooms({ 4: S(0, 180, 40, 0, 0, .94, 1) }),
    edit: rooms({ 5: S(0, 52, 0, 0, 0, .9, 1) }),
    dock: [S(0, 520, 0, 20, 0, 1, 0), PD, PD, PD, PD, PD, S(0, 520, -120, 0, 0, .9, 0)],
  };
  const smooth = (x) => { const k = clamp(x); return k * k * k * (k * (k * 6 - 15) + 10); };
  const mix = (a, b, k) => a + (b - a) * k;
  const NAT = { art: 390, side: 392, lyr: 540, snd: 460, look: 390, edit: 460, dock: 980 };
  const FLOAT = { art: 0, side: 1.3, lyr: 2.1, snd: 3.4, look: 4.2, edit: 5.1, dock: 6.2 };
  let W = innerWidth, H = innerHeight, narrow = W < 860, u = 1, prog = 0, f = 0;
  let stage = null, hero = null, caps = [], rail = [], hint = null, note = null, noteText = '';
  let railPx = 0, flightUntil = 0, editAuto = false;
  // Where the panels are right now. They ease towards where they should be, gently after changing page, closely while scrolling.
  const live = {};

  const ART_H = 376, LYR_H = 300, STACK = (ART_H + LYR_H + 12) / 300;      // the album over the lyrics, in widths of the panel
  let pinSpan = 0;      // how far the pinned part scrolls, as of the last measure
  function measure() {
    const before = Object.fromEntries(['art', 'side', 'lyr'].map((n) => [n, P[n].offsetWidth]));
    W = innerWidth; H = innerHeight;
    // The layout goes by the window's shape. A tall or small window has no room beside things, so it gets one panel at a time.
    narrow = W < 860 || W / H < 1.05;
    body.classList.toggle('compact', narrow);
    body.classList.toggle('sideways', narrow && W / H > 1.3);
    u = narrow ? Math.min(W / 430, H / 800) : Math.min(W / 1440, H / 900);
    document.documentElement.style.setProperty('--u', u);
    const pageMode = !stage;
    body.classList.toggle('page-mode', pageMode);
    // the album, lyrics and queue only come out when the page between them still has room to read; otherwise they hide, and come back when it does
    const R = Math.min(W * .19, (H - 210) / STACK, 400), hadRails = railPx > 0;
    railPx = pageMode && !isBare() && !narrow && R >= 170 && W - 2 * (R + 62) >= 600 ? Math.round(R) : 0;
    if (hadRails !== railPx > 0) flightUntil = performance.now() + 1300;
    body.classList.toggle('rails', railPx > 0);
    document.documentElement.style.setProperty('--rail', `${railPx ? railPx + 62 : 0}px`);
    P.side.style.height = railPx ? `${Math.round(STACK * 300)}px` : '';
    for (const n of Object.keys(before)) { const now = P[n].offsetWidth; if (live[n] && now) live[n].s *= before[n] / now; }
    fitGlass();
    const tourWas = tourUse;
    tourUse = !stage && railPx > 0 && !!tour;
    tour?.classList.toggle('on', tourUse);
    if (tourUse) buildTour();
    else if (tourWas) { tourRoom = -1; tourReset(); }
    document.documentElement.style.setProperty('--foot-h', `${$('.foot').offsetHeight}px`);
    const pinned = stage || (tourUse ? tour : null);
    pinSpan = pinned ? pinned.offsetHeight - H : 0;
  }
  // A new window shape changes how long the pinned part is, so stay in the same room.
  // A phone's address bar sliding away only changes the height a little: that's not a new shape.
  addEventListener('resize', () => {
    const newShape = W !== innerWidth || Math.abs(H - innerHeight) > 120;
    const room = pinSpan > 0 && newShape && !Smooth.busy() && scrollY <= pinSpan + 2 ? Math.round((scrollY / pinSpan) * 6) : null;
    measure();
    if (room != null && pinSpan > 0) Smooth.jump((room / 6) * pinSpan);
  });

  // beside a page: the album on the left with the lyrics under it, the queue on the right, the player in a bean along the bottom
  const tourActive = () => tourUse && !tourDone;
  // past the tour the app's window scrolls away: the panels wait for it, or they'd land on top of it
  const tourHolds = () => tourUse && !!tourBox && scrollY < pinSpan + tourBox.y + tourBox.h - 70;
  const isBare = () => !!$('main [data-bare], main [data-clear]');
  function pageTargets() {
    const hidden = (x) => S(x, H / u + 300, -200, -20, 0, .7, 0);
    const k = 1 / u, s = railPx / 300 / u;
    const dockW = Math.min(W - 24, railPx ? Math.min(W - railPx * 2 - 90, 900) : narrow ? 400 * Math.min(1, (W - 16) / 400) : W - 60);
    const natDock = narrow ? 400 : 980, dockS = dockW / natDock / u, dockH = (narrow ? 76 : 92) * dockW / natDock;
    const away = endAway || isBare(), dockAway = away || tourHolds();
    const dock = S(0, (H / 2 - 14 - dockH / 2 + (dockAway ? 150 : 0)) * k, 0, 0, 0, dockS, dockAway ? 0 : 1);
    const artX = (-W / 2 + 34 + railPx / 2) * k, sideX = (W / 2 - 34 - railPx / 2) * k;
    // the column sits in the middle of the room between the top bar and the player
    const artH = railPx * (ART_H / 300), lyrH = railPx * (LYR_H / 300), stackH = railPx * STACK, top = Math.max(78, (74 + (H - 112)) / 2 - stackH / 2);
    if (!railPx) return { art: hidden(0), side: hidden(0), lyr: hidden(0), snd: hidden(0), look: hidden(0), edit: hidden(0), dock };
    // on Features they start in their places, then fly into the app's window as you scroll to the first room
    const inward = tourHolds() ? smooth(f / .9) : 0;
    const intoApp = (name, sel, at) => {
      if (!inward) return at;
      const spot = tourSpot(sel), scale = Math.min(spot.w / P[name].offsetWidth, spot.h / P[name].offsetHeight) / u;
      return S(mix(at.x, (spot.x - W / 2) * k, inward), mix(at.y, (spot.y - H / 2) * k, inward), Math.sin(Math.PI * inward) * -150, mix(at.rx, 0, inward), mix(at.ry, 0, inward), mix(at.s, scale, inward), at.o * (1 - smooth((inward - .72) / .28)));
    };
    return {
      art: intoApp('art', '#art', S(artX - (away ? (railPx + 90) * k : 0), (-H / 2 + top + artH / 2) * k, 0, 1, 7, s, away ? 0 : 1)),
      lyr: intoApp('lyr', '#nowMeta', S(artX - (away ? (railPx + 90) * k : 0), (-H / 2 + top + artH + 12 * railPx / 300 + lyrH / 2) * k, 0, 1, 7, s, away ? 0 : 1)),
      side: intoApp('side', '#side', S(sideX + (away ? (railPx + 90) * k : 0), (-H / 2 + top + stackH / 2) * k, 0, 1, -7, s, away ? 0 : 1)),
      snd: hidden(artX), look: hidden(artX), edit: hidden(sideX), dock,
    };
  }
  function roomTargets(table) {
    const i = Math.min(5, Math.floor(f)), k = f - i, out = {}, sideways = narrow && W / H > 1.3;
    for (const name of Object.keys(P)) {
      const a = table[name][i], b = table[name][i + 1];
      // leaving and arriving overlap a little, so it's gradual and there's never nothing to see
      const e = a.o > .5 && b.o < .5 ? smooth(k / .62) : a.o < .5 && b.o > .5 ? smooth((k - .38) / .62) : smooth(k);
      out[name] = S(mix(a.x, b.x, e) + (sideways && name !== 'dock' ? (W * .24) / u : 0), mix(a.y, b.y, e), mix(a.z, b.z, e), mix(a.rx, b.rx, e), mix(a.ry, b.ry, e), mix(a.s, b.s, e), mix(a.o, b.o, e));
    }
    // on any shape of window the player bar sits on the bottom edge, never past it
    if (narrow) out.dock.y = Math.min(out.dock.y, (H / 2 - 12) / u - 38 * out.dock.s - 14);      // 14: room for its gentle float
    return out;
  }

  // ---------- real liquid glass, drawn on the graphics card, where the browser can do it (glass-layer.js) ----------
  // It replaces the blurred panels and the moving colours with one canvas behind the page. Without WebGPU, or on a slow computer, the CSS glass stays.
  let wallUrl = '', wallMix = 0, glassLayer = null, heroUntil = 0, extraY = -1, holding = false;
  const backImages = new Map(), panelRadius = {};
  function backImage(url) {
    if (!backImages.has(url)) { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => glassLayer?.touch(); img.src = url; backImages.set(url, img); }
    const img = backImages.get(url);
    return img.complete && img.naturalWidth ? img : null;
  }
  function paintBack(c, w, h) {
    c.filter = 'none'; c.globalAlpha = 1;
    c.drawImage($('.bg'), 0, 0, w, h);
    const img = wallUrl && wallMix > .004 ? backImage(wallUrl) : null;
    if (img) {
      const k = Math.max((w + 120) / img.naturalWidth, (h + 120) / img.naturalHeight), dw = img.naturalWidth * k, dh = img.naturalHeight * k;
      c.filter = 'blur(30px) saturate(125%)';
      c.globalAlpha = wallMix;
      c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      c.filter = 'none'; c.globalAlpha = 1;
    }
    c.globalAlpha = +getComputedStyle($('.dim')).opacity || 0;
    c.fillStyle = '#0d0726'; c.fillRect(0, 0, w, h);
    c.globalAlpha = 1;
    // fine lines of light drifting across: smooth colour has nothing to bend, and these give the glass's edge something to show
    c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,255,255,.2)';
    const drift = performance.now() / 9000;
    for (let i = 0; i < 15; i++) {
      c.beginPath();
      for (let x = -20; x <= w + 20; x += 24) {
        const y = h * (i + .5) / 15 + Math.sin(x / 260 + drift + i * .7) * h * .05 + Math.sin(x / 90 + drift * 1.7 + i) * 7;
        x < 0 ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.stroke();
    }
    window.GlassExtra?.paint(c, w, h);
    // the last word of the headline lives here, so the glass over it can really bend it
    const word = stage && hero ? $('[data-rest]', hero) : null, fade = hero ? +(hero.style.opacity || 1) * +getComputedStyle($('main')).opacity : 0;      // it fades with the page it belongs to
    if (!word || fade < .01) return;
    const r = word.getBoundingClientRect(), cs = getComputedStyle(word), em = parseFloat(cs.fontSize);
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ('letterSpacing' in c) c.letterSpacing = cs.letterSpacing;
    c.textBaseline = 'alphabetic';
    const m = c.measureText(word.textContent);
    const base = r.top + (r.height - em * .12 - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    const g = c.createLinearGradient(r.left, r.top, r.left + r.height * .2, r.bottom);
    g.addColorStop(.08, '#fff'); g.addColorStop(.42, 'rgba(255,255,255,.62)'); g.addColorStop(.58, 'rgba(255,255,255,.42)'); g.addColorStop(.94, 'rgba(255,255,255,.9)');
    c.save();
    c.globalAlpha = fade;
    c.shadowColor = 'rgba(13,7,38,.32)'; c.shadowBlur = 30; c.shadowOffsetY = 10;
    c.fillStyle = g; c.fillText(word.textContent, r.left, base);
    c.shadowColor = 'transparent';
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.62)'; c.strokeText(word.textContent, r.left, base);
    c.restore();
  }
  function syncGlass(dt, ms) {
    if (!glassLayer) return;
    if (stage && f < .7 && (ms < heroUntil || ms - moved < 200)) glassLayer.touch();
    const up = $('.wall i.on'), url = up && /url\("?(.+?)"?\)/.exec(up.style.background || '')?.[1];
    if (url) wallUrl = url;
    const wallTo = url ? 1 : 0;
    if (Math.abs(wallTo - wallMix) > .004) { wallMix += (wallTo - wallMix) * (1 - Math.exp(-dt * 3.2)); glassLayer.touch(); } else if (wallMix !== wallTo) { wallMix = wallTo; glassLayer.touch(); }
    const extra = window.GlassExtra?.on() ? window.GlassExtra : null;
    if (extra && scrollY !== extraY) { extraY = scrollY; glassLayer.touch(); }
    const pieces = [];
    // the entrance's little panel is real glass too
    const gateCard = body.classList.contains('gate-up') ? $('.gate-card') : null;
    if (gateCard) { const b = gateCard.getBoundingClientRect(); pieces.push({ key: 'gate', x: b.left, y: b.top, w: b.width, h: b.height, radius: 30, z: 2 }); }
    const lens = stage ? $('.lens', hero) : null;
    if (lens?.classList.contains('on') && f < .4) {
      const b = lens.getBoundingClientRect();
      pieces.push({ key: 'lens', x: b.left, y: b.top, w: b.width, h: b.height, radius: parseFloat(lens.style.borderRadius) || 40, kind: 'clear', frost: 0, z: 1 });
    }
    if (extra) pieces.push(...extra.pieces());
    glassLayer.sync(pieces, dt);
    if (glassLayer) syncPanels(dt);
  }
  // Each panel has its own glass canvas inside it, so the glass tilts and floats with the panel, and a panel in front really covers the one behind.
  const panelGlass = {};
  function makePanelGlass(name, el, layer) {
    const d = layer.scale(), w = el.offsetWidth, h = el.offsetHeight, cw = Math.max(2, Math.round(w * d)), ch = Math.max(2, Math.round(h * d));
    const canvas = document.createElement('canvas'), back = document.createElement('canvas');
    canvas.width = back.width = cw; canvas.height = back.height = ch;
    el.querySelector('.gp-bg').append(canvas);
    const engine = layer.attach(canvas);
    return (panelGlass[name] = { canvas, back, ctx: back.getContext('2d', { alpha: false }), engine, cw, ch, id: engine.add(0, 0, w, h, parseFloat(getComputedStyle(el).borderTopLeftRadius) || 22, 'panel', -1, -1, 0, -1) });
  }
  // The first drawing is the slow part, so it's done here, behind the scenes, for one panel at a time.
  function warmPanels() {
    const waiting = Object.entries(P);
    const next = () => {
      const layer = glassLayer;
      if (!layer || !waiting.length) return;
      const [name, el] = waiting.shift();
      try {
        if (!panelGlass[name]) {
          const g = makePanelGlass(name, el, layer);
          g.ctx.drawImage(layer.back, 0, 0, g.cw, g.ch);
          g.engine.setContent(g.back);
          g.engine.frame(.016);
        }
      } catch (e) { console.warn('Panel glass stopped:', String(e)); layer.stop(); return; }
      (window.requestIdleCallback || ((fn) => setTimeout(fn, 80)))(next, { timeout: 400 });
    };
    setTimeout(next, 500);
  }
  function syncPanels(dt) {
    const layer = glassLayer, d = layer.scale();
    try {
      const art = P.art, artShown = art.style.visibility !== 'hidden' && +art.dataset.o > .35;
      for (const [name, el] of Object.entries(P)) {
        if (el.style.visibility === 'hidden' || +el.dataset.o < .02) continue;
        const w = el.offsetWidth, h = el.offsetHeight, cw = Math.max(2, Math.round(w * d)), ch = Math.max(2, Math.round(h * d));
        let g = panelGlass[name] || makePanelGlass(name, el, layer);
        if (g.cw !== cw || g.ch !== ch) {
          g.cw = cw; g.ch = ch;
          g.canvas.width = g.back.width = cw; g.canvas.height = g.back.height = ch;
          g.engine.resize(cw, ch, d);
          g.engine.place(g.id, 0, 0, w, h);
        }
        // what's behind this panel: the background, cut to where it is now
        const b = el.getBoundingClientRect();
        g.ctx.drawImage(layer.back, b.left * d, b.top * d, b.width * d, b.height * d, 0, 0, cw, ch);
        // and if it's in front of the album, the cover, so the glass really bends it
        if (name !== 'art' && artShown && ((art.lastZ ?? 0) < (el.lastZ ?? 0) || (art.lastZ === el.lastZ && (art.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)))) {
          const c = cover.getBoundingClientRect(), k = cw / b.width;
          if (c.left < b.right && c.right > b.left && c.top < b.bottom && c.bottom > b.top) {
            const url = /url\("?(.+?)"?\)/.exec(cover.style.background || cover.style.backgroundImage || '')?.[1], img = url && backImage(url);
            if (img) g.ctx.drawImage(img, (c.left - b.left) * k, (c.top - b.top) * k, c.width * k, c.height * k);
            else { g.ctx.fillStyle = 'rgba(30,20,70,.8)'; g.ctx.fillRect((c.left - b.left) * k, (c.top - b.top) * k, c.width * k, c.height * k); }
          }
        }
        g.engine.setContent(g.back);
        g.engine.frame(dt);
      }
    } catch (e) { console.warn('Panel glass stopped:', String(e)); layer.stop(); }
  }
  const dropPanelGlass = () => { for (const k of Object.keys(panelGlass)) { panelGlass[k].canvas.remove(); delete panelGlass[k]; } };
  function startGlass() {
    if (lite || !window.GlassLayer) return;
    GlassLayer.start({ zIndex: -1, paint: paintBack }).then((layer) => {
      if (!layer || lite) { layer?.stop(); return; }
      glassLayer = layer;
      body.classList.add('glass-gpu');
      Ambient.drew = () => layer.touch();
      layer.onFail(() => { glassLayer = null; dropPanelGlass(); Ambient.drew = null; body.classList.remove('glass-gpu'); for (const el of Object.values(P)) el.lastTf = ''; });
      heroUntil = performance.now() + 1600;
      warmPanels();
    });
  }
  addEventListener('glassy:page', () => { heroUntil = performance.now() + 1600; glassLayer?.touch(); });

  let tx = 0, ty = 0, sx = 0, sy = 0;
  if (!still) addEventListener('pointermove', (e) => { tx = (e.clientX / W - .5) * 2; ty = (e.clientY / H - .5) * 2; }, { passive: true });
  // Every panel, the album included, is barely movable: it stays where it is, leans towards the pointer,
  // can be tugged a little with the mouse, and springs back.
  const pulls = Object.fromEntries(Object.keys(P).map((n) => [n, { x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0 }]));
  let tug = null, skipClick = false, topPanel = null;
  if (!still) {
    addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      if (tug) {
        const dx = e.clientX - tug.x, dy = e.clientY - tug.y, p = pulls[tug.name];
        if (Math.hypot(dx, dy) > 5) { tug.moved = true; body.classList.add('tugging'); }
        if (tug.moved) { p.gx = 74 * Math.tanh(dx / 150); p.gy = 74 * Math.tanh(dy / 150); }
      }
      for (const [name, el] of Object.entries(P)) {
        if (tug && tug.name === name) continue;
        const p = pulls[name];
        if (el.style.visibility === 'hidden' || el.inert) { p.gx = p.gy = 0; continue; }
        const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy), reach = Math.max(r.width, r.height) * .78;
        if (d > reach) { p.gx = p.gy = 0; continue; }
        const k = 15 * Math.tanh(d / 160) * Math.min(1, (reach - d) / 90) / (d || 1);
        p.gx = dx * k; p.gy = dy * k;
      }
    }, { passive: true });
    scene.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const el = e.target.closest('.gp');
      if (!el || e.target.closest('.d-eq, .d-track, input, select, a')) return;
      tug = { name: el.dataset.p, x: e.clientX, y: e.clientY, moved: false };
      topPanel = tug.name;      // the one you're holding comes to the front, and stays there until you hold another
    });
    addEventListener('pointerup', () => {
      if (!tug) return;
      const p = pulls[tug.name];
      p.gx = p.gy = 0;
      if (tug.moved) { skipClick = true; setTimeout(() => { skipClick = false; }, 60); }
      tug = null; body.classList.remove('tugging');
    });
    // letting go of a tug isn't a press on whatever's underneath
    scene.addEventListener('click', (e) => { if (skipClick) { e.stopPropagation(); e.preventDefault(); skipClick = false; } }, true);
  }

  function layout(t, dt, ms) {
    const targets = stage ? roomTargets(narrow ? NARROW : WIDE) : pageTargets();
    sx += (tx - sx) * .05; sy += (ty - sy) * .05;
    // Each panel has its own perspective, stacked by depth: sharing one 3D space makes the browser cut panels where they cross
    const camera = `perspective(${((1500 * u) / Z).toFixed(1)}px)`;
    const calm = tourUse && !tourDone && f > .5 ? .3 : 1, tiltY = narrow ? 0 : sx * 4 * calm, tiltX = narrow ? 0 : -sy * 3 * calm;
    for (const p of Object.values(pulls)) { p.vx = (p.vx + (p.gx - p.x) * .06) * .82; p.vy = (p.vy + (p.gy - p.y) * .06) * .82; p.x += p.vx; p.y += p.vy; }
    const flying = ms < flightUntil;
    const fl = still || lite ? 0 : stage ? 1 : tourUse && !tourDone && f > .5 ? .1 : .35;
    for (const [name, el] of Object.entries(P)) {
      const to = targets[name];
      if (!live[name] || still) live[name] = { ...to };
      const L = live[name], rate = flying ? 4.6 + FLOAT[name] * .25 : 34, e = 1 - Math.exp(-dt * rate);
      for (const key of Object.keys(to)) L[key] += (to[key] - L[key]) * e;
      const ph = FLOAT[name], pu = pulls[name];
      // however far it floats, leans or gets tugged, there's always space between a panel and the edge of the window
      const nat = narrow ? 400 : !stage && railPx && (name === 'art' || name === 'side' || name === 'lyr') ? 300 : NAT[name];
      const room = L.o < .95 ? 1e6 : Math.max(0, (W / 2 - 18 - nat * L.s * u * .54) / u);      // .54 and not .5: a tilted panel looks a little wider
      const x = clamp(L.x + Math.sin(t * .55 + ph) * 11 * fl + pu.x / (u || 1), -room, room);
      const y = L.y + Math.cos(t * .47 + ph) * 13 * fl + pu.y / (u || 1);
      const rx = L.rx + tiltX + Math.sin(t * .4 + ph) * 1.5 * fl - pu.y * .07, ry = L.ry + tiltY + Math.cos(t * .36 + ph) * 1.8 * fl + pu.x * .07;
      const o = clamp(L.o);
      if (o < .01) {      // gone: costs nothing
        if (el.style.visibility !== 'hidden') { el.style.visibility = 'hidden'; el.style.pointerEvents = 'none'; el.inert = true; }
        continue;
      }
      const depth = name === topPanel ? 5000 : name === 'dock' ? 4000 : Math.round(L.z + 2000);      // the player bar stays reachable
      if (el.lastZ !== depth) { el.style.zIndex = depth; el.lastZ = depth; }
      const tf = `translate(-50%, -50%) ${camera} translate3d(${((x * u) / Z).toFixed(2)}px, ${((y * u) / Z).toFixed(2)}px, ${((L.z * u) / Z).toFixed(2)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${((L.s * u) / Z).toFixed(4)})`;
      if (el.lastTf !== tf) { el.style.transform = tf; el.lastTf = tf; }
      // straight onto the panel's own layers: nothing inside them has to be worked out again
      const fade = o.toFixed(3);
      if (el.dataset.o !== fade) { el.dataset.o = fade; for (const part of el.children) part.style.opacity = fade; }
      if (el.style.visibility !== 'visible') el.style.visibility = 'visible';
      const usable = o > .4 && (!stage || f > .4);
      el.style.pointerEvents = usable ? 'auto' : 'none';
      el.inert = !usable;
    }
    caps.forEach((c) => {
      const d = Math.abs(f - +c.dataset.c), o = clamp(1 - (d - .22) / .34);
      c.style.opacity = o.toFixed(3);
      c.style.transform = `translateY(${(((f - +c.dataset.c) * -40)).toFixed(1)}px)`;
      c.style.visibility = o < .01 ? 'hidden' : 'visible';
      c.style.pointerEvents = o > .5 ? 'auto' : 'none';
    });
    if (tourUse) {
      winEl.style.opacity = clamp((f - .25) * 2).toFixed(3);
      winEl.style.transform = `translateY(${((1 - clamp(f)) * 40).toFixed(1)}px) scale(${(.96 + clamp(f) * .04).toFixed(3)})`;
      winEl.style.visibility = f < .2 ? 'hidden' : 'visible';
      if (f > .02 && !appFrame) startTourApp();
      if (!still && !tourDone) {
        const near = Math.round(f);
        if (near !== tourRoom && Math.abs(f - near) < .08 && !Smooth.busy()) { tourRoom = near; if (near > 0) runTour(near); else tourReset(); }
        else if (tourRoom >= 0 && Math.abs(f - tourRoom) > .25) { tourRoom = -1; tourReset(); }
      } else if (tourDone && tourRoom >= 0) { tourRoom = -1; tourReset(); }
    }
    if (!stage) return;
    hero.style.opacity = clamp(1 - f * 2).toFixed(3);
    hero.style.transform = f > 0 ? `translateY(${(-f * 130).toFixed(1)}px)` : '';
    hero.style.visibility = f > .5 ? 'hidden' : 'visible';
    rail.forEach((b, n) => { const on = Math.round(f) === n + 1; if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'step' : 'false'); } });
    hint.style.opacity = (f < .6 ? 0 : clamp(5.4 - f)).toFixed(2);
    body.classList.toggle('at-end', f > 5.5);
    body.classList.toggle('at-start', f < .5);
    if (!editAuto && Math.abs(f - 5) < .25) { editAuto = true; runEdit(true); }
    else if (editAuto && Math.abs(f - 5) > 1.1 && !editing) {      // coming back round does the next song
      editAuto = false;
      editSong = null; messIdx = (messIdx + 1) % MESSES.length; showMess();
    }
  }

  // ---------- scrolling through the rooms: it answers at once and can turn round at any moment, but can't rest between two rooms ----------
  const ROOM_MS = 1200, ROOM_RATE = 5.5, FOLLOW_RATE = 16;
  const pinNow = () => stage || (tourUse ? tour : null);
  const roomPast = (p, d) => (d > 0 ? Math.floor(p + .004) + 1 : Math.ceil(p - .004) - 1);
  const goRoom = (n, span) => { Smooth.to((n / 6) * span, ROOM_RATE); wantMore(n); };
  let lastWheel = 0, wheelT = 0, clicks = 0, heading = 1, swipeFrom = null, swipeLast = 0, swipeTop = 0, swiped = false;
  function stepRoom(d) {
    const pin = pinNow();
    if (!pin) return false;
    const span = pin.offsetHeight - H;
    if (scrollY > span + 2) return false;
    const here = (Smooth.goal() / span) * 6, next = clamp(roomPast(here, d), 0, 6);
    if (Math.abs(next - here) < .004) return !!stage || d < 0;      // past the tour's last place, the page below scrolls normally
    goRoom(next, span);
    return true;
  }
  // when the scrolling stops, it goes on to the next room the way you were heading
  function finishScroll() {
    const pin = pinNow();
    if (!pin) return;
    const span = pin.offsetHeight - H;
    if (scrollY > span + 2) return;
    const here = (Smooth.goal() / span) * 6;
    if (Math.abs(here - Math.round(here)) < .0005) return;
    goRoom(clamp(heading > 0 ? Math.ceil(here) : Math.floor(here), 0, 6), span);
  }
  const gateUp = () => body.classList.contains('gate-up');
  // A song list that's been opened on purpose scrolls first, then the page takes over at its end. The queue on the home page doesn't get in the way.
  Smooth.listScrolls = (target, by) => {
    const list = target.closest && target.closest('.d-list');
    if (!list || (stage && view === 'queue') || list.scrollHeight <= list.clientHeight + 1) return false;
    return by > 0 ? list.scrollTop + list.clientHeight < list.scrollHeight - 1 : list.scrollTop > 0;
  };
  Smooth.onStep = (d) => gateUp() || stepRoom(d);
  Smooth.onWheel = (e) => {
    if (gateUp()) return true;
    const pin = pinNow();
    if (!pin || scrollY > pin.offsetHeight - H + 2) return false;
    const span = pin.offsetHeight - H, by = e.deltaY * (e.deltaMode === 1 ? 34 : 1), size = Math.abs(by), d = Math.sign(by);
    if (size < 1) return true;
    if (!stage && d > 0 && Smooth.goal() >= span - 1) return false;      // past the tour's last room, the page below scrolls normally
    const now = performance.now(), fresh = now - lastWheel > 140, turned = d !== heading;
    lastWheel = now; heading = d;
    if (fresh || turned) clicks = 0;
    clearTimeout(wheelT);
    // turning round goes from where the page is now, not from where it was heading
    const from = turned ? scrollY : Smooth.goal();
    if (size >= 100) {      // a wheel click: straight to the next room. One flick is one room; spinning on adds another every third click.
      if (clicks++ % 3 === 0) goRoom(clamp(roomPast((from / span) * 6, d), 0, 6), span);
      return true;
    }
    // a trackpad: the page stays under your fingers
    Smooth.to(clamp(from + by, 0, span), FOLLOW_RATE);
    wheelT = setTimeout(finishScroll, 110);
    return true;
  };
  // on a phone the page follows the finger, and goes on to a room when it lifts. Once the tour's over, the page scrolls as usual.
  addEventListener('touchstart', (e) => { swipeFrom = swipeLast = e.touches[0].clientY; swipeTop = scrollY; swiped = false; }, { passive: true });
  addEventListener('touchmove', (e) => {
    const pin = pinNow();
    if (e.touches.length > 1 || !pin || swipeFrom == null || gateUp() || scrollY > pin.offsetHeight - H + 2) return;      // two fingers: pinch zoom
    if (e.target.closest && e.target.closest('.d-eq, .d-track, .d-vol, input')) return;
    const dy = swipeFrom - e.touches[0].clientY;
    if (Smooth.listScrolls(e.target, dy)) return;
    if (!stage && dy > 0 && scrollY >= pin.offsetHeight - H - 1) return;
    e.preventDefault();
    if (still) { if (!swiped && Math.abs(dy) > 26) { swiped = true; stepRoom(Math.sign(dy)); } return; }
    if (!swiped && Math.abs(dy) < 4) return;
    const y = e.touches[0].clientY;
    if (Math.abs(swipeLast - y) > .5) heading = Math.sign(swipeLast - y);
    swipeLast = y; swiped = true;
    const span = pin.offsetHeight - H, reach = span / 6;      // one swipe is one room, however long
    Smooth.jump(clamp(clamp(swipeTop + dy * 1.6, swipeTop - reach, swipeTop + reach), 0, span));
  }, { passive: false });

  // ---------- settling: for fingers and the scrollbar, wherever the page stops it goes on to a room ----------
  let settleT = 0, lastY = scrollY, dir = 1, touching = false;
  addEventListener('touchstart', () => { touching = true; }, { passive: true });
  addEventListener('touchend', () => { touching = false; if (swiped && !still) finishScroll(); swiped = false; }, { passive: true });
  addEventListener('scroll', () => {
    if (Math.abs(scrollY - lastY) > .5) dir = Math.sign(scrollY - lastY);
    lastY = scrollY;
    clearTimeout(settleT);
    settleT = setTimeout(settle, 300);
  }, { passive: true });
  function settle() {
    const pin = pinNow();
    if (!pin || still || touching || Smooth.dragging || Smooth.busy()) return;
    const span = pin.offsetHeight - H, here = (scrollY / span) * 6;
    if (here <= .004 || here >= 5.996) return;
    // a little way towards the next room is enough to go there, whichever way you were heading
    const from = Math.floor(here), part = here - from;
    const c = dir > 0 ? (part > .16 ? from + 1 : from) : (part < .84 ? from : from + 1);
    if (Math.abs(here - c) > .004) Smooth.to((c / 6) * span, ROOM_RATE);
  }

  // ---------- smooth no matter what: if this computer can't keep up, the costly glass and the drifting go ----------
  // phones, small computers and data savers start with the light glass, so nothing has to go wrong first
  const weak = matchMedia('(pointer: coarse)').matches || navigator.hardwareConcurrency <= 4 || navigator.deviceMemory <= 4 || !!connection?.saveData;
  let lite = weak, slow = 0, total = 0, frames = 0;
  if (lite) body.classList.add('lite');
  function guard(dt) {
    if (lite || document.hidden) return;
    total += dt; frames++;
    if (frames < 45) return;
    slow = total / frames > 1 / 28 ? slow + 1 : 0;      // under about 28 frames a second
    total = 0; frames = 0;
    if (slow >= 2) { lite = true; body.classList.add('lite'); glassLayer?.stop(); }
  }
  let px = 0, py = 0, pointerMoved = false;
  addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; pointerMoved = true; }, { passive: true });

  // ---------- the Features page: the real app, in its own window, with a mouse showing you round as you scroll ----------
  // The player bar steps aside, and the side panels fly into the window. The app is the real interface (site/app/), running silent; the music stays this page's.
  let tour = null, tourUse = false, tourDone = false, tourRoom = -1, tourRun = 0, winEl = null, appFrame = null, appScale = 1;
  let tourBoot = 0;
  function startTourApp() {
    clearTimeout(tourBoot);
    if (!tourUse || !winEl?.isConnected || appFrame?.isConnected) return;
    appFrame = document.createElement('iframe');
    appFrame.src = 'app/index.html';
    appFrame.title = 'The Glassy app';
    appFrame.tabIndex = -1;
    appFrame.setAttribute('aria-hidden', 'true');
    appFrame.style.transform = `scale(${appScale})`;
    winEl.appendChild(appFrame);
  }
  function buildTour() {
    const winW = Math.min(W * .66, (H - 110) * 1.55), winH = (winW * 800) / 1240, winL = W - 40 - winW, winT = (74 + H - 20) / 2 - winH / 2;
    winEl = $('.tour-win');
    Object.assign(winEl.style, { left: `${winL}px`, top: `${winT}px`, width: `${winW}px`, height: `${winH}px` });
    appScale = winW / 1240;
    tour.style.setProperty('--capw', `${Math.max(240, winL - 90)}px`);
    // It takes a moment to start, and it isn't on screen yet: it waits until the page change has finished, or until you scroll towards it.
    clearTimeout(tourBoot);
    if (appFrame?.isConnected) appFrame.style.transform = `scale(${appScale})`;
    else { appFrame = null; tourBoot = setTimeout(startTourApp, 1300); }
    tourBox = { x: winL, y: winT, w: winW, h: winH };
    tourSpots = {};
  }
  // where a part of the app is on the screen; the middle of the window until the app has loaded
  let tourBox = null, tourSpots = {};
  function tourSpot(sel) {
    if (tourSpots[sel]) return tourSpots[sel];
    const r = inApp(sel)?.getBoundingClientRect();
    if (!r || !r.width) return { x: tourBox.x + tourBox.w / 2, y: tourBox.y + tourBox.h / 2, w: tourBox.w * .3, h: tourBox.h * .5 };
    return (tourSpots[sel] = { x: tourBox.x + (r.left + r.width / 2) * appScale, y: tourBox.y + (r.top + r.height / 2) * appScale, w: r.width * appScale, h: r.height * appScale });
  }
  // the pointer
  const tourMouse = document.createElement('div');
  tourMouse.className = 'tour-mouse';
  tourMouse.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="m-ring" cx="5" cy="2.500" r="8"/><g class="m-body"><path d="M5 2.500v17.200l4.700-4.300 3 6.600 3.200-1.500-3-6.500 6.400-.4z"/></g></svg>';
  body.appendChild(tourMouse);
  const tourHand = makeMouse(tourMouse);
  const appDoc = () => { try { return appFrame.contentDocument; } catch { return null; } };
  const inApp = (sel) => appDoc()?.querySelector(sel) || null;
  const appDo = (js) => { try { return appFrame.contentWindow.eval(js); } catch { return undefined; } };
  const glideTo = async (el, id, fx = .5, fy = .5, ms = 800) => {
    if (id !== tourRun || !el) return;
    const r = el.getBoundingClientRect(), f = appFrame.getBoundingClientRect();
    const x = f.left + (r.left + r.width * fx) * appScale, y = f.top + (r.top + r.height * fy) * appScale;
    // it comes in from beside the window, not from the corner of the screen
    if (!tourMouse.classList.contains('on')) { tourHand.at(f.right + 30, y + 70); tourMouse.classList.add('on'); }
    await Promise.all([tourHand.to(x, y), pause(ms)]);
  };
  const pressOn = async (el, id) => {
    await glideTo(el, id);
    if (id !== tourRun || !el) return;
    await tourHand.press();
    const pressed = id === tourRun;
    if (pressed) el.click();
    await pause(700);
    return pressed;
  };
  // scrolling the way a hand does: eased, a stretch at a time
  const scrollEl = (el, to, id, ms = 1200) => new Promise((done) => {
    if (!el) return done();
    const from = el.scrollTop, t0 = performance.now();
    const go2 = () => {
      if (id !== tourRun) return done();
      const k = clamp((performance.now() - t0) / ms);
      el.scrollTop = from + (to - from) * (.5 - .5 * Math.cos(Math.PI * k));
      if (k < 1) requestAnimationFrame(go2); else done();
    };
    go2();
  });
  const scrollerIn = (root) => { if (!root) return null; const win = appFrame.contentWindow; return [root, ...root.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(win.getComputedStyle(e).overflowY)) || null; };
  const sectionNamed = (name) => [...(appDoc()?.querySelectorAll('.set-sec') || [])].find((s) => s.querySelector('h4')?.textContent === name);
  // puts the app back as it was
  function appReset() {
    if (!appFrame || !appDoc()) return;
    appDo(`modalClose && modalClose(); 0`);
    if (appDoc().querySelector('.tint-sw.none')) appDoc().querySelector('.tint-sw.none').click();
    if (tourChanged.tint) { tourChanged.tint = false; appDo(`S.ui.tintColor = ''; applyUi(); 0`); }
    if (tourChanged.wall) { tourChanged.wall = false; appDo(`S.ui.wall = 'art'; applyUi(); 0`); }
    if (tourChanged.lyrics) { tourChanged.lyrics = false; inApp('#btnLyrics')?.click(); }
    if (tourChanged.view) { tourChanged.view = false; inApp('.seg button[data-view="queue"]')?.click(); }
  }
  function tourReset() {
    tourRun++;
    tourHand.stop();
    appReset();
  }
  const tourChanged = { tint: false, wall: false, lyrics: false, view: false };
  // the window shows the song that's really playing
  function appFollow() {
    const title = song().title;
    appDo(`(() => { const i = S.queue.findIndex((t) => (t.title || t.name) === ${JSON.stringify(title)}); if (i >= 0 && i !== S.cur) play(i, ${playing}); })(); 0`);
  }
  async function runTour(n) {
    tourReset();
    const id = tourRun;
    appFollow();
    await pause(450);
    if (id !== tourRun) return;
    if (n === 1) {
      await glideTo(inApp('#art') || inApp('#empty'), id, .5, .45);
      await glideTo(inApp('#nowMeta'), id);
      await glideTo(inApp('#side .row') || inApp('#side'), id);
      await glideTo(inApp('#btnPlay'), id);
    } else if (n === 2) {
      if (await pressOn(inApp('.seg button[data-view="library"]'), id)) tourChanged.view = true;
      await pause(500);
      const s = scrollerIn(inApp('#side'));
      await glideTo(s, id, .5, .55, 500);
      if (s) { await scrollEl(s, s.scrollHeight * .4, id, 1500); await pause(300); await scrollEl(s, 0, id, 1000); }
      await pressOn(inApp('.seg button[data-view="playlists"]'), id);
      await pressOn(inApp('.seg button[data-view="queue"]'), id);
      tourChanged.view = false;
    } else if (n === 3) {
      if (await pressOn(inApp('#btnLyrics'), id)) tourChanged.lyrics = true;
      await pause(900);
      await glideTo(inApp('#lyrics .ly-lines p.on') || inApp('#lyrics'), id, .3);
      await glideTo(inApp('#lyrics .ly-lines p:nth-child(3)') || inApp('#lyrics'), id, .6);
      await glideTo(inApp('#lyrics'), id, .85, .1);
    } else if (n === 4) {
      // Settings: the gear, then down through it
      await pressOn(inApp('#btnSettings'), id);
      await pause(700);
      const box = scrollerIn(inApp('.modal-root'));
      await glideTo(box, id, .6, .4, 600);
      for (const [name, fx] of [['Sound', .6], ['Playback', .5], ['Library', .6], ['Updates', .5]]) {
        const sec = sectionNamed(name);
        if (box && sec && id === tourRun) { await scrollEl(box, sec.offsetTop - 30, id, 1300); await glideTo(sec, id, fx, .3, 500); await pause(500); }
      }
      if (box) await scrollEl(box, 0, id, 1200);
    } else if (n === 5) {
      await pressOn(inApp('#btnSettings'), id);
      await pause(700);
      tourChanged.tint = tourChanged.wall = true;
      const tints = [...(appDoc()?.querySelectorAll('.tint-sw:not(.none):not(.custom)') || [])];
      for (const i of [2, 5, 0]) if (tints[i]) { await pressOn(tints[i], id); await pause(450); }
      await pressOn(inApp('.tint-sw.none'), id);
      const chips = [...(appDoc()?.querySelectorAll('.modal [data-chips="ui.wall"] .schip') || [])];
      const colours = chips.find((c) => /Colours/.test(c.textContent)), artwork = chips.find((c) => /Artwork/.test(c.textContent));
      await pressOn(colours, id);
      await pause(900);
      await pressOn(artwork, id);
    } else if (n === 6) {
      // Edit info, from the song's menu
      await glideTo(inApp('#side .row') || inApp('#art'), id);
      if (id !== tourRun) return;
      await tourHand.press();
      appDo(`editModal(current()); 0`);
      await pause(800);
      const fields = [...(appDoc()?.querySelectorAll('.modal input[type="text"], .modal input:not([type])') || [])].slice(0, 3);
      for (const f of fields) {
        await glideTo(f, id, .3);
        if (id !== tourRun) return;
        await tourHand.press();
        // shown as active without taking the keyboard away from the page
        const was = f.style.outline;
        f.style.outline = '2px solid #fff';
        await pause(500);
        f.style.outline = was;
      }
      await glideTo(inApp('.modal button[type="submit"]'), id, .5, .5, 700);
      await pause(700);
    }
    if (id === tourRun) tourHand.leave();
  }

  // ---------- the entrance: what's new, a word about the songs, and the click browsers need before any sound ----------
  let enterWithMusic = null;      // the checks in tests/site go in this way, with the music that's here
  function entrance() {
    // every time the site is opened or reloaded; moving between its pages doesn't count
    body.classList.add('gate-up');
    document.documentElement.classList.remove('opening');
    const hide = [$('main'), $('.top'), $('.foot'), scene, $('.skip'), miniMute];
    hide.forEach((e) => { e.inert = true; });
    const g = document.createElement('div');
    g.className = 'gate';
    g.setAttribute('role', 'dialog'); g.setAttribute('aria-modal', 'true'); g.setAttribute('aria-label', 'Welcome to Glassy');
    g.tabIndex = -1;
    g.innerHTML = `<div class="gate-card">
      <svg class="gate-phones" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 30v-6a16 16 0 0 1 32 0v6"/><rect x="5" y="27" width="9" height="15" rx="4.500"/><rect x="34" y="27" width="9" height="15" rx="4.500"/></svg>
      <h2>Best with the music on</h2>
      <p>Search an artist you like and their music plays along as you scroll.</p>
      <div class="gate-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="gate-find">
        <input type="text" placeholder="Search an artist you like" aria-label="Search an artist you like" spellcheck="false" autocomplete="off">
        <div class="gate-results" hidden></div>
      </div>
      <p class="gate-credit">30-second previews provided courtesy of iTunes.</p>
      <button type="button" class="gate-quiet">Continue without music</button>
    </div>`;
    body.appendChild(g);
    // The way in: pick an artist, and you're in with their music playing
    const find = $('.gate-find input', g), results = $('.gate-results', g);
    let picked = null, findAsk = 0, findTimer = 0;
    const closeResults = () => { results.hidden = true; results.innerHTML = ''; };
    const pickIt = (id, name) => { picked = { id, name }; closeResults(); leave(true); };
    find.addEventListener('input', () => {
      clearTimeout(findTimer);
      const me = ++findAsk, term = find.value.trim();
      if (term.length < 2) { closeResults(); return; }
      findTimer = setTimeout(async () => {
        let rows = [], failed = false;
        try { rows = await searchArtists(term); } catch { failed = true; }
        if (me !== findAsk || !g.isConnected) return;
        const paint = () => { results.innerHTML = failed ? '<p>Apple Music isn\'t answering. You can still go in without it.</p>' : rows.length ? rows.map((a) => artistRow(a, 'data-id')).join('') : '<p>Nobody by that name.</p>'; results.hidden = false; };
        paint();
        if (await loadIcons(rows) && me === findAsk && g.isConnected) paint();
      }, 400);
    });
    find.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const first = results.querySelector('button');
      if (first) pickIt(+first.dataset.id, first.querySelector('b').textContent);
    });
    results.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pickIt(+b.dataset.id, b.querySelector('b').textContent); });
    const leave = (withSound) => {
      if (withSound) { if (picked) waitingForArtist = true; startMusic(); if (picked) pickArtist(picked.id, picked.name).finally(() => { waitingForArtist = false; }); } else { declined = true; body.classList.add('music-on'); }
      heroUntil = performance.now() + 1600;
      hide.forEach((e) => { e.inert = false; });
      body.classList.remove('gate-up');
      g.classList.add('leaving');
      removeEventListener('keydown', esc2, true);
      setTimeout(() => g.remove(), still ? 0 : 1000);
    };
    const esc2 = (e) => { if (e.key === 'Escape') leave(false); };
    addEventListener('keydown', esc2, true);
    $('.gate-quiet', g).addEventListener('click', () => leave(false));
    if (matchMedia('(pointer: coarse)').matches) g.focus({ preventScroll: true }); else find.focus({ preventScroll: true });      // ready to type, without a phone's keyboard jumping up
    enterWithMusic = () => leave(true);
  }

  // ---------- each page: find its parts, and send the panels to their new places ----------
  let wasOnPage = false, hadTour = false;
  function bindPage(first) {
    if (appFrame?.isConnected) tourReset();
    else { tourRun++; tourMouse.classList.remove('on', 'press'); appFrame = null; for (const k of Object.keys(tourChanged)) tourChanged[k] = false; }
    stage = $('.stage');
    tour = $('.tour');
    tourDone = false; tourRoom = -1;
    hero = $('.hero');
    caps = $$('.cap');
    rail = $$('.rail button');
    hint = $('.stage-hint');
    note = $('.cap .note');
    if (note && noteText) note.textContent = noteText;
    rail.forEach((b, n) => b.addEventListener('click', () => Smooth.travel(((stage.offsetHeight - innerHeight) * (n + 1)) / 6, ROOM_MS)));
    $$('[data-to-demo]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); Smooth.travel(((stage.offsetHeight - innerHeight)) / 6, ROOM_MS); }));
    body.classList.remove('at-end', 'at-start');
    measure();
    prog = pinNow() ? clamp(scrollY / Math.max(1, pinNow().offsetHeight - H)) : 0;
    f = prog * 6;
    editAuto = false;
    readPageEnd();
    wantMore(SONGS.length);
    // Between two pages the player has nothing to do: it stays exactly as it is. It only moves arriving from, or going to, the home page.
    const fromPage = wasOnPage && !stage;
    if (fromPage && hadTour) flightUntil = performance.now() + 1300;
    hadTour = tourUse;
    wasOnPage = !stage;
    if (fromPage) return;
    flightUntil = performance.now() + 1700;
    if (!still) {
      if (first) { if (!stage) Object.keys(P).forEach((n) => { const t = pageTargets()[n]; live[n] = { ...t, y: t.y + 240 / u, o: 0 }; }); }
      else if (!stage) {
        // the queue swings in from the right and the album from the left
        if (live.art) { live.art.ry -= 30; live.art.z -= 200; }
        if (live.lyr) { live.lyr.ry -= 30; live.lyr.z -= 200; }
        if (live.side) { live.side.ry += 30; live.side.z -= 200; }
      }
    }
    lastLine = -1;
    if (railPx && view !== 'queue') { view = 'queue'; paintList(); }
  }
  window.addEventListener('glassy:page', () => bindPage(false));

  // ---------- every frame ----------
  let lastLine = -1, lastMs = performance.now(), slowBass = 0, moved = 0, lastGlint = '', lastPump = '';
  const sheens = $$('.gp-sheen', scene);
  const dcur = $('.d-cur'), dfill = $('.d-track i'), cover = $('.d-cover'), lyIn = $('.d-ly-in');
  function frame(ms) {
    requestAnimationFrame(frame);
    const dt = clamp((ms - lastMs) / 1000, 0, .1); lastMs = ms;      // a first frame can be stamped just before the page started
    if (playing) {
      if (soundOn && ctx) pos = ctx.currentTime - t0; else pos += dt;
      if (pos >= song().secs) go(cur + 1);      // a real song has faded out by now; the next one fades in
      if (pos < 0) pos = 0;
    }
    let aim = 0;
    const pin = pinNow();
    if (tourUse) {
      const done = scrollY > tour.offsetHeight - H + 30;
      if (done !== tourDone) { tourDone = done; flightUntil = ms + 1300; }
    }
    const holds = tourHolds();
    if (holds !== holding) { holding = holds; flightUntil = ms + 1300; }
    if (pin) {
      aim = clamp(scrollY / Math.max(1, pin.offsetHeight - H));
      prog = still ? aim : prog + (aim - prog) * (1 - Math.exp(-dt * 18));
      if (Math.abs(aim - prog) < .00015) prog = aim;
      f = prog * 6;
      if (Math.abs(aim - prog) > .0008 || Smooth.busy()) moved = ms;
    }
    if (ms < flightUntil) moved = ms;
    if (document.hidden) return;
    // the fine glass rests while things are moving, the same as the app: motion stays smooth
    body.classList.toggle('in-motion', ms - moved < 180);
    guard(dt);
    applyLevel();
    // the cover is behind the glass only in the room where you chose it. Anywhere else, the colours come back.
    const coverRoom = stage ? Math.abs(f - 4) < .5 : tourUse && !tourDone && Math.abs(f - 5) < .5;
    Ambient.wall(wall === 'cover' && coverRoom ? song().art : null);
    // the light on the glass: it drifts as the page scrolls and leans towards the pointer
    if (!lite && !still) {
      const glint = `${(prog * 900 - 200).toFixed(1)}%`;
      if (glint !== lastGlint) { lastGlint = glint; for (const s of sheens) s.style.setProperty('--glint', glint); }
    }
    // only the panel the pointer is near, and not while things are moving
    if (pointerMoved && !lite && ms - moved > 180) {
      pointerMoved = false;
      for (const el of Object.values(P)) {
        if (el.inert) continue;
        const b = el.getBoundingClientRect();
        if (px < b.left - 200 || px > b.right + 200 || py < b.top - 200 || py > b.bottom + 200) continue;
        const sheen = el.querySelector('.gp-sheen');
        sheen.style.setProperty('--sx', `${(((px - b.left) / b.width) * 100).toFixed(1)}%`);
        sheen.style.setProperty('--sy', `${(((py - b.top) / b.height) * 100).toFixed(1)}%`);
      }
    }
    const shown = fmt(pos);
    if (dcur.textContent !== shown) { dcur.textContent = shown; track.setAttribute('aria-valuetext', shown); }
    dfill.style.transform = `scaleX(${clamp(pos / song().secs).toFixed(4)})`;
    const ln = lineAt(pos);
    if (ln !== lastLine) {
      lastLine = ln;
      $$('button', lyIn).forEach((b, i) => { b.classList.toggle('on', i === ln); b.classList.toggle('near', Math.abs(i - ln) === 1); });
      const on = lyIn.children[ln];
      if (on) lyIn.style.transform = `translateY(${(lyIn.parentElement.clientHeight / 2 - on.offsetTop - on.offsetHeight / 2).toFixed(1)}px)`;
      // no room for the lyrics panel: the player bar carries the line
      $$('.d-dk-tx .d-s').forEach((e) => { e.textContent = !stage && !railPx && on ? on.textContent : byline(song()); });
    }
    // the beat: only ever the real sound, so nothing moves until music is playing
    let beat = 0;
    const bars = $$('.d-eqb i');
    if (!still && playing && soundOn && an && ctx.state === 'running') {
      an.getByteFrequencyData(data);
      const band = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += data[i]; return s / (b - a) / 255; };
      const bass = band(0, 3);
      slowBass += (bass - slowBass) * .06;
      beat = clamp(Math.max(0, bass - slowBass) * 5 + clamp(bass - .55) * .9);
      const lv = [bass, band(6, 20), band(30, 70)];
      bars.forEach((b, i) => { b.style.transform = `scaleY(${(.18 + clamp(lv[i] * 1.15) * .82).toFixed(3)})`; });
    } else bars.forEach((b) => { b.style.transform = 'scaleY(.18)'; });
    body.classList.toggle('dock-away', clamp(live.dock?.o ?? 1) < .2 && !gateUp());
    const pump = `scale(${(1 + beat * .03).toFixed(4)})`;
    if (pump !== lastPump) { lastPump = pump; cover.style.transform = pump; }
    Ambient.pulse(beat);
    layout(ms / 1000, dt, ms);
    syncGlass(dt, ms);
  }

  // A background tab draws no frames, but the music goes on: this is what moves it to the next song there.
  setInterval(() => { if (document.hidden && playing && soundOn && ctx && ctx.currentTime - t0 >= song().secs) go(cur + 1); }, 500);

  // ---------- go ----------
  // the tour's app uses censor; the tests in tests/site read the rest
  window.glassyTest = { enter: () => enterWithMusic?.(), censor, pulls, level: () => (out ? out.gain.value : null), cutoff: () => (dimLP ? dimLP.frequency.value : null), state: () => ({ version: SONGS[0]?.versions ? versionNow() : null, fetched: fetched.size, songs: SONGS.length, narrow, rails: railPx > 0, playing, soundOn, pos, cur, ctx: ctx && ctx.state, title: song().title, editTitle: editSong && editSong.title, f, lite }) };
  bindPage(true);
  paintSong(); paintPlay(); drawEq();
  entrance();
  startGlass();
  requestAnimationFrame(frame);
  armStart();
  fetch('media/songs.json').then((r) => (r.ok ? r.json() : null)).then((list) => {
    if (!Array.isArray(list) || !list.length) return;
    ALBUMS.length = 0; SONGS.length = 0;
    const byName = new Map();
    list.sort((x, y) => (x.order ?? x.track) - (y.order ?? y.track)).forEach((t, i) => {
      const name = t.album || t.artist;
      if (!byName.has(name)) {
        const album = { album: name, artist: t.artist, key: 'a', root: 45, bpm: 130, prog: [0, 5, 3, 4], songs: [],
          art: t.cover ? `center / cover no-repeat url('${t.cover}')` : art('#1a0612', ['#d62b4b', 28, 30, 62], ['#5b1730', 80, 80, 60]) };
        byName.set(name, album); ALBUMS.push(album);
      }
      const a = byName.get(name), start = t.start ?? 0, secs = t.length ?? PREVIEW;
      SONGS.push({ title: censor(t.title), secs, artist: t.artist, album: name, art: a.art, a, seed: i + 1, clip: true, versions: t.versions, start, q: t.lossless ? 'CD' : t.kbps >= 192 ? 'HQ' : 'SQ', real: { title: String(t.title).replace(/\s*\(feat\.[^)]*\)/i, ''), artist: t.artist, album: t.album, full: t.full } });
    });
    cur = 0; pos = 0;
    const who = list[0].artist;
    noteText = `This is a working demo. Press anything. These are one-minute previews of songs by ${who}, all rights reserved to ${who}.`;
    if (note) note.textContent = noteText;
    const small = $('.gate-small');
    if (small) small.textContent = `The songs here are one-minute previews by ${who}, all rights reserved to ${who}. Glassy itself doesn't come with any music.`;
    paintSong();
    if (started) resync();
    wantMore(0);
  }).catch(() => { /* no songs here: the made-up ones are the demo */ });
})();
