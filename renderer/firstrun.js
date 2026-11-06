'use strict';
// "Here's what we found": the song finder's window (scan/service.js does the finding). On a fresh install it comes after the
// intro's screens: big words on the intro's moving background, the list inside the intro's one glass shape. From Settings
// it's a normal glass sheet. The list is the same both ways: one flat windowed list of group and song rows, so only what's in
// sight is on the page however many songs there are.
// Uses app.js globals: lib, esc, plural, fmt, gradFor, cssUrl, ICON, toast, api, openModal, modalClose, addFound, reduceMotion.
(() => {
  const scan = window.glass.scan;
  const FirstRun = (window.FirstRun = {});
  FirstRun.cover = (p) => api.cover(p);      // one place that asks for a cover (the tests watch it)

  const OPEN_UP_TO = 12;     // this many groups or fewer start open
  const SONG_H = 44, GROUP_H = 62, GROUP_GAP = 4, JUNK_GAP = 14;
  const OVERSCAN = 420;      // px of rows kept on the page beyond what's in sight
  const GLIDE_MS = 520;      // how long rows take to glide to a new place (.fr-item in styles.css)
  const MAX_ENTERING = 14;   // new rows that fade in one after another; the rest are out of sight anyway
  const ARRIVE_MS = 120;     // songs coming in are shown this often at most
  const ADD_CHUNK = 50000;   // the scan service takes at most 100000 paths in one call
  const E = 'cubic-bezier(.42,.02,.2,1)';   // the intro's motion
  const collate = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  const HEADING = "Here's what we found";
  const EMPTY_HEADING = 'No songs here yet';
  const LOOKED = "We looked through your Music and Downloads folders and didn't find any. If your music lives somewhere else, show Glassy where.";
  const ALL_HAVE_HEADING = 'Nothing new';
  const ALL_HAVE = 'Every song we found is already in your library.';
  const ICON_SEARCH = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>';
  const ICON_CHEV = '<svg class="fr-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>';
  const ICON_NOTE = '<svg class="fr-note" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg>';
  const ICON_PLAY = '<svg class="fr-i-play" viewBox="0 0 24 24"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l9.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z" /></svg>';
  const ICON_PAUSE = '<svg class="fr-i-pause" viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" /></svg>';
  const STATUS = '<span class="fr-count"></span><span class="fr-rest"></span><span class="fr-also"></span>';

  // ---------- the running search for songs: listening starts before its window shows ----------
  let session = null;

  function newSession(auto) {
    return {
      auto, off: false, over: false, done: false, failed: false,
      items: [], paths: new Set(), hidden: 0, have: new Set([...lib.keys()].map((p) => p.toLowerCase())),
      groups: [], songGroups: 0, junk: 0, sorted: new Map(), dirty: false,
      opens: new Map(), shut: new Set(),   // groups opened or shut by hand, and those shut during a search
      query: '', ticked: 0, ui: null, looking: '',
      ix: GlassSearch.createIndex((it) => [it.title || it.name, it.artist || '', it.album || '', `${it.name} ${it.fb}`]),
    };
  }
  const baseOf = (p) => p.split(/[\\/]+/).filter(Boolean).pop() || p;

  function take(s, m) {
    for (const raw of m.items || []) {
      const key = raw.path.toLowerCase();
      if (s.paths.has(key)) continue;
      s.paths.add(key);
      if (s.have.has(key)) { s.hidden++; continue; }     // in the library already (Windows paths don't care about capitals)
      const folder = raw.folder || '';
      s.items.push({ ...raw, name: baseOf(raw.path).replace(/\.[^.]+$/, ''), fk: folder.toLowerCase(), fb: baseOf(folder), junk: !raw.ticked, sel: !!raw.ticked });
      s.dirty = true;
    }
    s.done = !!m.done;
    s.looking = s.done ? '' : m.looking || '';
    if (m.error) s.failed = true;
    s.ui?.soon();
  }
  scan.onProgress((m) => { if (session && !session.off) take(session, m); });

  // Finished with this search: a scan still going is stopped, and later messages go nowhere.
  function endSession(s) {
    if (session === s) session = null;
    if (s.over) return;
    s.over = true;
    if (!s.done) scan.stop().catch(() => {});
  }

  // ---------- groups: albums by album and folder, loose files by folder, biggest first, the probably-nots last ----------
  function regroup(s) {
    s.dirty = false;
    const albumKey = (it) => `${it.fk}\0${it.album.trim().toLowerCase()}`;
    const albums = new Map();
    for (const it of s.items) if (!it.junk && it.album) albums.set(albumKey(it), (albums.get(albumKey(it)) || 0) + 1);
    const out = new Map(), junk = [];
    for (const it of s.items) {
      if (it.junk) { junk.push(it); continue; }
      // one song with an album tag of its own isn't an album: it stays with the loose files around it, or a Downloads
      // folder full of singles would be a long list of one-song groups
      const isAlbum = !!it.album && albums.get(albumKey(it)) > 1;
      const key = isAlbum ? `a\0${albumKey(it)}` : `f\0${it.fk}`;
      let g = out.get(key);
      if (!g) { g = { key, kind: isAlbum ? 'album' : 'folder', name: isAlbum ? it.album.trim() : it.fb, folder: it.folder, items: [] }; out.set(key, g); }
      g.items.push(it);
    }
    // items only ever arrive, so the same count means the same songs: no need to sort them again
    const sortedItems = (key, items) => {
      const had = s.sorted.get(key);
      if (had && had.length === items.length) return had;
      items.sort((a, b) => collate.compare(a.name, b.name));
      s.sorted.set(key, items);
      return items;
    };
    const groups = [...out.values()];
    for (const g of groups) g.items = sortedItems(g.key, g.items);
    groups.sort((a, b) => b.items.length - a.items.length || collate.compare(a.name, b.name));
    s.songGroups = groups.length;
    if (junk.length) groups.push({ key: '!junk', kind: 'junk', name: 'Probably not songs', items: sortedItems('!junk', junk) });
    s.groups = groups;
    s.junk = junk.length;
    countTicks(s);
  }
  function countTicks(s) {
    let n = 0;
    for (const it of s.items) if (it.sel) n++;
    s.ticked = n;
  }
  const pathTail = (p) => p.split(/([\\/]+)/).filter(Boolean).slice(-3).join('');
  function groupSub(g, s) {
    const n = g.shown ? g.shown.length : g.items.length, all = g.items.length;
    const some = (w) => (s.query && n < all ? `${n.toLocaleString()} of ${plural(all, w)}` : plural(all, w));
    if (g.kind === 'junk') return s.query ? some('file') : `${plural(all, 'file')}. Tick any you want to keep.`;
    if (g.kind === 'folder') return `${some('song')} · ${pathTail(g.folder)}`;
    const artists = new Set(g.items.map((it) => it.artist || ''));
    return [artists.size === 1 ? [...artists][0] : 'Various artists', some('song')].filter(Boolean).join(' · ');
  }
  const isOpen = (s, g) => {
    if (s.query) return !s.shut.has(g.key);
    if (s.opens.has(g.key)) return s.opens.get(g.key);
    if (g.kind === 'junk') return s.songGroups === 0;      // the only thing to look at
    return s.songGroups <= OPEN_UP_TO;
  };
  const upper = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  // under a song's name: why it's a probably-not, or who it's by. Inside an album that's only worth saying if it changes
  function songSub(it, g) {
    if (it.junk) return upper(it.reason || 'Probably not a song');
    if (g.kind === 'album') return g.items.some((x) => x.artist !== g.items[0].artist) ? it.artist || '' : '';
    return [it.artist, it.album].filter(Boolean).join(' · ');
  }

  // ---------- the list ----------
  function makeList(s) {
    const work = document.createElement('div');
    work.className = 'fr-work';
    work.innerHTML = `
      <div class="fr-tools">
        <label class="search fr-search">${ICON_SEARCH}<input type="text" placeholder="Search what we found" aria-label="Search what we found" spellcheck="false" /></label>
        <button type="button" class="btn ghost fr-all">Select all</button>
        <button type="button" class="btn ghost fr-none">Select none</button>
      </div>
      <div class="fr-look"><span class="fr-bar"><span></span></span><span class="fr-where"></span></div>
      <div class="fr-wrap"><div class="fr-list"><div class="fr-space" role="list"></div></div><div class="fr-msg" hidden></div></div>`;
    const list = work.querySelector('.fr-list'), space = work.querySelector('.fr-space'), msg = work.querySelector('.fr-msg'), input = work.querySelector('input');
    const mounted = new Map();     // row key -> element on the page
    let rows = [], height = 0, fr = 1, songH = SONG_H, groupH = GROUP_H;
    let searchT = 0, settleT = 0, entering = 0, paintQueued = false;
    let onTicks = () => {};

    // the flat list of what's showing, with where each row sits
    function flatten() {
      const cq = s.query ? s.ix.query(s.query) : null;
      const next = [];
      let y = 0;
      for (const g of s.groups) {
        g.shown = cq ? g.items.filter((it) => cq.score(it) > 0) : g.items;
        if (cq && !g.shown.length) continue;
        if (g.kind === 'junk' && next.length) y += JUNK_GAP;
        next.push({ key: 'g' + g.key, g, y, h: groupH });
        y += groupH;
        if (isOpen(s, g)) for (const it of g.shown) { next.push({ key: 's' + it.path, it, g, y, h: songH }); y += songH; }
        y += GROUP_GAP;
      }
      rows = next;
      height = y;
    }
    function indexAt(y) {
      let lo = 0, hi = rows.length - 1, ans = 0;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].y <= y) { ans = m; lo = m + 1; } else hi = m - 1; }
      return ans;
    }
    function make(r) {
      const n = document.createElement(r.it ? 'label' : 'div');
      if (r.it) {
        const it = r.it;
        n.className = 'fr-item fr-row';
        n.innerHTML = `<span class="check"><input type="checkbox" /><span class="box"></span></span>
          <span class="fr-art">${ICON.note}</span>
          <button type="button" class="fr-play" aria-label="Play a preview of ${esc(it.title || it.name)}">${ICON_PLAY}${ICON_PAUSE}</button>
          <span class="fr-text"><b>${esc(it.title || it.name)}</b><small>${esc(songSub(it, r.g))}</small></span>
          <span class="fr-dur">${it.duration >= 1 ? fmt(it.duration) : ''}</span>`;
        n.title = it.path;
      } else {
        const g = r.g;
        const art = g.kind === 'album' ? `<span class="fr-art" style="background-image:${gradFor(g.name)}"></span>`
          : `<span class="fr-art">${g.kind === 'junk' ? ICON.note : ICON.folder}</span>`;
        n.className = 'fr-item fr-group';
        n.innerHTML = `<label class="check"><input type="checkbox" aria-label="${esc(g.name)}" /><span class="box"></span></label>
          ${art}<span class="fr-text"><b>${esc(g.name)}</b><small></small></span>
          <button type="button" class="fr-toggle" aria-label="${esc(g.name)}: show or hide its songs">${ICON_CHEV}</button>`;
        if (g.folder) n.title = g.folder;
      }
      n.setAttribute('role', 'listitem');
      return n;
    }
    // ---- covers: only for rows on the page, four at a time, each file asked once for as long as the window is up ----
    const covered = new Map();     // path -> cover url, or null for none
    const asking = new Map();      // path -> the question being asked
    const waiting = [];            // rows waiting for a turn: { n, paths }
    let busy = 0, over = false;
    function askCover(p) {
      if (asking.has(p)) return asking.get(p);
      const q = Promise.resolve().then(() => FirstRun.cover(p)).then((u) => (typeof u === 'string' && u ? u : null), () => null)
        .then((u) => { covered.set(p, u); asking.delete(p); return u; });
      asking.set(p, q);
      return q;
    }
    const alive = (n) => !over && !n._gone;
    function showCover(n, url, now) {
      const art = n.querySelector('.fr-art');
      if (!art || art.querySelector('.fr-pic')) return;
      const pic = document.createElement('i');
      pic.className = now || reduceMotion ? 'fr-pic still' : 'fr-pic';
      pic.style.backgroundImage = cssUrl(url);
      art.appendChild(pic);
      art.classList.add('has-pic');
    }
    async function runCover(job) {
      for (const p of job.paths) {
        if (!alive(job.n)) return;
        const url = covered.has(p) ? covered.get(p) : await askCover(p);
        if (!alive(job.n)) return;
        if (url) { showCover(job.n, url, false); return; }
      }
    }
    function pump() {
      while (busy < 4 && waiting.length) {
        const job = waiting.shift();
        if (!alive(job.n)) continue;      // scrolled away before its turn
        busy++;
        runCover(job).finally(() => { busy--; pump(); });
      }
    }
    function wantCover(n, r) {
      if (r.g.kind === 'junk' && !r.it) return;
      if (!r.it && r.g.kind !== 'album') return;       // folders keep their icon
      const paths = r.it ? [r.it.path] : r.g.items.slice(0, 3).map((it) => it.path);
      for (const p of paths) {
        if (!covered.has(p)) continue;
        const u = covered.get(p);
        if (u) { showCover(n, u, true); return; }
      }
      if (paths.every((p) => covered.has(p))) return;
      waiting.push({ n, paths });
      pump();
    }
    // ---- previews: one <audio> for the window; starting one stops any other ----
    let audio = null, playing = null;
    function syncPlay(n, it) {
      const on = playing === it;
      n.classList.toggle('playing', on);
      n.classList.toggle('bad', !!it.bad);
      const b = n.querySelector('.fr-play');
      b.disabled = !!it.bad;
      b.setAttribute('aria-pressed', on);
      b.title = it.bad ? "This one won't play" : on ? 'Pause' : 'Play a preview';
    }
    const syncPlays = () => { for (const n of mounted.values()) if (n._row.it) syncPlay(n, n._row.it); };
    function stopPreview() {
      if (!playing) return;
      playing = null;
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* nothing to stop */ }
      syncPlays();
    }
    function failed(it) { if (playing === it) { it.bad = true; stopPreview(); } }
    function preview(it) {
      if (playing === it) { stopPreview(); return; }
      stopPreview();
      if (!audio) {
        audio = FirstRun.audio = new Audio();
        audio.preload = 'none';
        audio.addEventListener('ended', stopPreview);
        audio.addEventListener('error', () => failed(playing));
      }
      if (typeof deck !== 'undefined' && deck && !deck.paused) deck.pause();     // the main player is paused for good: it never resumes by itself
      playing = it;
      audio.src = it.url;
      syncPlays();
      let p;
      try { p = audio.play(); } catch { failed(it); return; }
      if (p) p.catch(() => failed(it));
    }
    space.addEventListener('click', (e) => {
      const b = e.target.closest('.fr-play');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const it = b.closest('.fr-item')?._row?.it;
      if (it) preview(it);
    });

    // the bar and the line that say it is still looking, and where
    const look = work.querySelector('.fr-look'), where = work.querySelector('.fr-where');
    look.classList.toggle('calm', !!reduceMotion);
    function paintLook() {
      const on = !s.done;
      look.classList.toggle('on', on);
      if (on) where.textContent = s.looking ? `Looking in ${s.looking}` : 'Looking';     // as it fades the words stay
    }

    // ticks and counts on a row that's on the page
    function sync(n, r) {
      const box = n.querySelector('input');
      if (r.it) { if (box.checked !== r.it.sel) box.checked = r.it.sel; syncPlay(n, r.it); return; }
      const g = r.g;
      let on = 0;
      for (const it of g.shown) if (it.sel) on++;
      box.checked = on > 0 && on === g.shown.length;
      box.indeterminate = on > 0 && on < g.shown.length;
      const open = isOpen(s, g);
      n.classList.toggle('open', open);
      n.querySelector('.fr-toggle').setAttribute('aria-expanded', open);
      const sub = groupSub(g, s), small = n.querySelector('small');
      if (small.textContent !== sub) small.textContent = sub;
    }
    const place = (n, r) => {
      if (n._y !== r.y) { n.style.transform = `translateY(${r.y}px)`; n._y = r.y; }
      if (n._h !== r.h) { n.style.height = r.h + 'px'; n._h = r.h; }
      n._row = r;
    };
    function paint(animate = false) {
      const top = list.scrollTop, H = list.clientHeight || 500;
      const want = new Set();
      if (rows.length) {
        for (let i = indexAt(Math.max(0, top - OVERSCAN)); i < rows.length && rows[i].y < top + H + OVERSCAN; i++) {
          const r = rows[i];
          want.add(r.key);
          let n = mounted.get(r.key);
          if (!n) {
            n = make(r);
            place(n, r);
            space.appendChild(n);
            mounted.set(r.key, n);
            wantCover(n, r);
            if (animate && !reduceMotion && entering < MAX_ENTERING) { n.classList.add('enter'); n.style.setProperty('--d', `${entering++ * 22}ms`); }
          } else place(n, r);
          sync(n, r);
        }
      }
      const byKey = animate && mounted.size > want.size ? new Map(rows.map((r) => [r.key, r])) : null;
      for (const [k, n] of mounted) {
        if (want.has(k)) continue;
        const r = byKey?.get(k);
        if (r) { place(n, r); continue; }     // only moving out of sight: it glides with the others and goes at the next paint
        mounted.delete(k);
        n._gone = true;
        if (animate && !reduceMotion) { n.classList.add('out'); setTimeout(() => n.remove(), 300); } else n.remove();
      }
    }
    list.addEventListener('scroll', () => {
      if (paintQueued) return;
      paintQueued = true;
      requestAnimationFrame(() => { paintQueued = false; paint(); });
    }, { passive: true });
    const sized = new ResizeObserver(() => paint());
    sized.observe(list);

    // The list changed: rows glide to their new places, new ones fade in, gone ones fade out. keepPlace: songs arriving
    // while someone reads further down leave what they're reading where it is.
    function refresh({ animate = true, keepPlace = false } = {}) {
      const top = list.scrollTop, before = keepPlace && top > 0 ? rows[indexAt(top)] : null;
      const oldHeight = height;
      flatten();
      paintMessage();
      paintLook();
      entering = 0;
      clearTimeout(settleT);
      if (before) {
        const same = rows.find((r) => r.key === before.key);
        if (same && same.y !== before.y) {
          space.classList.add('still');
          space.style.height = Math.max(height, oldHeight) + 'px';
          list.scrollTop = top + same.y - before.y;
          space.style.height = height + 'px';
          paint();
          void space.offsetHeight;      // the rows take their new places now, before they can glide again
          space.classList.remove('still');
          return;
        }
      }
      const glides = animate && !reduceMotion;
      if (glides && height < oldHeight) {
        // shrinking: rows glide up first and the list gives up its extra height after, so nothing jumps at the bottom
        const most = Math.max(0, height - list.clientHeight);
        if (top > most) list.scrollTo({ top: most, behavior: 'smooth' });
      } else space.style.height = height + 'px';
      paint(animate);
      if (glides) settleT = setTimeout(() => { space.style.height = height + 'px'; paint(); }, GLIDE_MS);
    }
    function paintMessage() {
      const looking = !s.items.length && !s.done, noMatch = !!s.query && !rows.length;
      msg.hidden = !looking && !noMatch;
      if (looking) { msg.className = 'fr-msg fr-looking'; msg.textContent = 'Looking through your Music and Downloads folders'; }
      else if (noMatch) { msg.className = 'fr-msg fr-none-found'; msg.textContent = `Nothing matches "${input.value.trim()}"`; }
    }

    // ---- ticking ----
    function ticksChanged() {
      countTicks(s);
      for (const n of mounted.values()) sync(n, n._row);
      onTicks();
    }
    space.addEventListener('change', (e) => {
      const r = e.target.closest('.fr-item')?._row;
      if (!r) return;
      if (r.it) r.it.sel = e.target.checked;
      else { const on = !r.g.shown.every((it) => it.sel); for (const it of r.g.shown) it.sel = on; }
      ticksChanged();
    });
    space.addEventListener('click', (e) => {
      const n = e.target.closest('.fr-group');
      if (!n || e.target.closest('.check')) return;
      const g = n._row.g, open = isOpen(s, g);
      if (open && playing && g.items.includes(playing)) stopPreview();      // its group is shutting
      if (s.query) { if (open) s.shut.add(g.key); else s.shut.delete(g.key); }
      else s.opens.set(g.key, !open);
      refresh();
    });
    // Select all ticks what's shown, and leaves the probably-nots out unless a search is showing them: junk must never land
    // in the library without being seen. Select none clears what's shown, wherever it is.
    work.querySelector('.fr-all').addEventListener('click', () => {
      for (const g of s.groups) {
        if (g.kind === 'junk' && !s.query) continue;
        for (const it of g.shown || g.items) it.sel = true;
      }
      ticksChanged();
    });
    work.querySelector('.fr-none').addEventListener('click', () => {
      for (const g of s.groups) for (const it of g.shown || g.items) it.sel = false;
      ticksChanged();
    });

    // ---- searching: filters the rows, ticks stay as they were ----
    function setQuery(v) {
      s.query = v.trim();
      s.shut.clear();
      list.scrollTop = 0;
      refresh();
    }
    input.addEventListener('input', () => {
      clearTimeout(searchT);
      searchT = setTimeout(() => setQuery(input.value), 110);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });   // never presses Add

    return {
      work, input, refresh, paint,
      onTicks(f) { onTicks = f; },
      clearSearch() { clearTimeout(searchT); input.value = ''; setQuery(''); },
      // big windows scale the list up, never down: it stays readable
      setScale(k) {
        const f = Math.max(1, k);
        if (f === fr) return;
        fr = f;
        songH = Math.round(SONG_H * f); groupH = Math.round(GROUP_H * f);
        work.style.setProperty('--fr', f);
        refresh({ animate: false });
      },
      stop() { clearTimeout(searchT); clearTimeout(settleT); sized.disconnect(); over = true; waiting.length = 0; stopPreview(); FirstRun.audio = null; },
      hush: stopPreview,
    };
  }

  // ---------- what the words say ----------
  const stateOf = (s) => (!s.done ? 'scanning' : s.items.length ? 'done' : 'empty');
  const addLabel = (s) => (s.ticked ? `Add ${plural(s.ticked, 'song')}` : 'Add songs');
  // "132 songs so far": the count rolls up to its new value rather than jumping
  function makeStatus(node) {
    const [countEl, rest, also] = node.children;
    let shown = 0, raf = 0;
    const roll = (n) => {
      cancelAnimationFrame(raf);
      if (reduceMotion || n === shown) { shown = n; countEl.textContent = n.toLocaleString(); return; }
      const from = shown, t0 = performance.now(), ms = 480;
      const step = (t) => {
        const u = Math.min(1, Math.max(0, (t - t0) / ms));
        shown = Math.round(from + (n - from) * (1 - (1 - u) * (1 - u)));
        countEl.textContent = shown.toLocaleString();
        if (u < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    return {
      paint(s) {
        const n = s.items.length - s.junk, word = n === 1 ? 'song' : 'songs', j = s.junk;
        const unsure = j ? `${j.toLocaleString()} more probably ${j === 1 ? "isn't a song" : "aren't songs"}.` : '';
        roll(n);
        countEl.hidden = s.done && !n;
        if (!s.done) { rest.textContent = ` ${word} so far.`; also.textContent = 'Still looking.'; }
        else if (s.failed) { rest.textContent = ` ${word} found.`; also.textContent = "We couldn't look everywhere."; }
        else if (!n) { rest.textContent = 'Nothing that looks like a song for sure.'; also.textContent = 'Have a look through these.'; }
        else if (s.auto) { rest.textContent = ` ${word}, ticked and ready.`; also.textContent = unsure; }
        else { rest.textContent = ` new ${word}`; also.textContent = ''; }
      },
      stop() { cancelAnimationFrame(raf); },
    };
  }

  // ---------- into the library ----------
  async function addTicked(s) {
    const paths = [], skipped = [];
    for (const it of s.items) (it.sel ? paths : skipped).push(it.path);
    endSession(s);       // stops a scan still going: what it hadn't offered yet can be found another day
    const infos = [];
    for (let i = 0; i < Math.max(paths.length, skipped.length); i += ADD_CHUNK) {
      infos.push(...await scan.add(paths.slice(i, i + ADD_CHUNK), skipped.slice(i, i + ADD_CHUNK)));
    }
    addFound(infos);
    return infos.length;
  }
  // from the empty state; false if they changed their mind about the folder
  async function addFolder(s) {
    const infos = await api.openFolder().catch(() => []);
    if (!infos.length) return 0;
    endSession(s);
    addFound(infos);
    return infos.length;
  }
  const noteAdded = (n, wait) => { if (n) setTimeout(() => toast(`Added ${plural(n, 'song')} to your library`), wait); };

  // shows arriving songs now and then, not on every message
  function arrivals(fn) {
    let t = 0;
    return {
      soon() { if (!t) t = setTimeout(() => { t = 0; fn(); }, ARRIVE_MS); },
      stop() { clearTimeout(t); t = 0; },
    };
  }
  const NOTE_AFTER_INTRO = () => (reduceMotion ? 900 : 2600);      // the way into the app has finished by then

  // ---------- over the intro: its words, its button, its glass ----------
  function openOnStage(s, stage) {
    return new Promise((resolve) => {
      if (s.dirty) regroup(s);
      const list = makeList(s);
      const panel = document.createElement('div');
      panel.className = 'fr-panel';
      panel.appendChild(list.work);
      panel.insertAdjacentHTML('beforeend', `<div class="fr-empty">${ICON_NOTE}</div>`);
      const fit = () => {
        const b = stage.box('finder');
        list.work.style.width = b.w + 'px';
        list.work.style.height = b.h + 'px';
        list.setScale(stage.scale());
      };
      fit();

      const { go, p } = stage;
      const later = document.createElement('button');
      later.type = 'button';
      later.className = 'fr-later';
      later.textContent = 'Not now';
      stage.root.appendChild(later);
      go.classList.add('fr-go');
      const placeLater = () => { later.style.left = `${go.offsetLeft + go.offsetWidth + 18 * stage.scale()}px`; };

      const line = document.createElement('span');
      line.className = 'fr-status';
      line.innerHTML = STATUS;
      const status = makeStatus(line);

      let state = stateOf(s), closed = false, busy = false, wordsIn = false;
      const paintWords = () => {
        if (!wordsIn || closed) return;
        if (s.dirty) regroup(s);      // the count and the button always agree
        if (state === 'empty') {
          p.textContent = LOOKED;
          go.textContent = 'Add a folder';
          go.disabled = false;
        } else {
          if (p.firstChild !== line) p.replaceChildren(line);
          status.paint(s);
          go.textContent = addLabel(s);
          go.disabled = !s.ticked;
        }
        placeLater();
      };
      const say = () => {
        wordsIn = false;
        go.style.pointerEvents = 'none';
        const empty = state === 'empty';
        stage.say({ h: empty ? EMPTY_HEADING : HEADING, p: '', go: empty ? 'Add a folder' : addLabel(s) }, () => {
          wordsIn = true;
          go.style.pointerEvents = '';
          paintWords();
        });
      };
      const shapeFor = (st) => (st === 'empty' ? 'finderEmpty' : 'finder');

      panel.dataset.state = state;
      list.refresh({ animate: false });
      stage.shape(shapeFor(state), () => stage.show(panel));
      say();
      later.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 800, delay: 590, easing: E, fill: 'both' });
      list.onTicks(paintWords);

      const arriving = arrivals(() => {
        if (s.dirty) regroup(s);
        const was = state;
        state = stateOf(s);
        panel.dataset.state = state;
        if (state === 'empty' && was !== 'empty') { stage.shape('finderEmpty'); say(); return; }
        list.refresh({ keepPlace: true });
        paintWords();
      });

      const finished = () => {
        if (closed) return;
        closed = true;
        arriving.stop();
        list.stop();
        status.stop();
        s.ui = null;
        later.style.pointerEvents = 'none';
        later.animate([{ opacity: getComputedStyle(later).opacity }, { opacity: 0 }], { duration: reduceMotion ? 240 : 480, easing: E, fill: 'forwards' });
        resolve();
      };
      const notNow = () => { if (busy) return; endSession(s); finished(); };
      async function press() {
        if (busy || closed) return;
        busy = true;
        list.hush();
        go.style.pointerEvents = 'none';
        later.style.pointerEvents = 'none';
        const n = await (state === 'empty' ? addFolder(s) : addTicked(s)).catch((e) => { console.warn('Song finder:', e); return 0; });
        busy = false;
        if (closed) return;
        if (state === 'empty' && !n) { go.style.pointerEvents = ''; later.style.pointerEvents = ''; return; }
        noteAdded(n, NOTE_AFTER_INTRO());
        finished();
      }
      go.addEventListener('click', press);
      later.addEventListener('click', notNow);

      s.ui = { soon: arriving.soon, gone: finished };
      stage.onResize = () => { fit(); placeLater(); };
      stage.onKey = (e) => {
        if (e.key !== 'Escape') return;
        if (list.input.value) list.clearSearch();
        else notNow();
      };
      arriving.soon();     // anything that came in while the window was being set up
    });
  }

  // ---------- from Settings: a normal glass sheet ----------
  function openSheet(s) {
    return new Promise((resolve) => {
      if (s.dirty) regroup(s);
      const list = makeList(s);
      let state = null, busy = false, status = null, form = null;
      const paint = () => {
        if (s.dirty) regroup(s);      // the count and the button always agree
        state = stateOf(s);
        const panel = form.querySelector('.fr-panel'), btn = form.querySelector('button[type=submit]'), line = form.querySelector('.fr-status');
        panel.dataset.state = state;
        const all = s.hidden > 0;
        form.querySelector('.modal-title').textContent = state !== 'empty' ? HEADING : all ? ALL_HAVE_HEADING : EMPTY_HEADING;
        if (state === 'empty') {
          form.querySelector('.fr-empty p').textContent = all ? ALL_HAVE : LOOKED;
          btn.textContent = 'Add a folder';
          btn.disabled = false;
          line.hidden = true;
          return;
        }
        line.hidden = false;
        status.paint(s);
        btn.textContent = addLabel(s);
        btn.disabled = !s.ticked;
      };
      const arriving = arrivals(() => {
        if (s.dirty) regroup(s);
        paint();
        if (state !== 'empty') list.refresh({ keepPlace: true });
      });
      openModal(`
        <div class="modal-head"><h3 class="modal-title">${HEADING}</h3><span class="fr-status">${STATUS}</span></div>
        <div class="fr-panel"><div class="fr-empty">${ICON_NOTE}<p></p></div></div>
        <div class="modal-actions"><button type="button" class="btn ghost fr-later" data-cancel>Not now</button><span class="grow"></span><button type="submit" class="btn primary">Add songs</button></div>`, {
        onMount(f, close) {
          form = f;
          form.classList.add('fr-sheet');
          form.querySelector('.fr-panel').prepend(list.work);
          status = makeStatus(form.querySelector('.fr-status'));
          // never a form submit: a folder dialog that's cancelled must leave the sheet as it is
          form.querySelector('button[type=submit]').addEventListener('click', async (e) => {
            e.preventDefault();
            if (busy) return;
            busy = true;
            list.hush();
            const n = await (state === 'empty' ? addFolder(s) : addTicked(s)).catch((err) => { console.warn('Song finder:', err); return 0; });
            busy = false;
            if (state === 'empty' && !n) return;
            noteAdded(n, 0);
            close();
          });
          list.onTicks(paint);
          paint();
          list.refresh({ animate: false });
        },
        onClose() {
          arriving.stop();
          list.stop();
          status?.stop();
          s.ui = null;
          endSession(s);
          resolve();
        },
      });
      s.ui = { soon: arriving.soon, gone: () => modalClose?.() };
      arriving.soon();
    });
  }

  // ---------- what the rest of the app calls ----------
  // A fresh install, as the intro opens: start looking and keep what comes in until the window shows.
  FirstRun.prepare = async () => {
    if (session) return;
    const s = (session = newSession(true));
    const st = await scan.status().catch(() => null);
    if (session !== s) return;
    if (st && st.ran) { s.off = true; return; }      // it has been answered before: not asked again by itself
    scan.start().catch(() => {});
  };
  // The intro was dismissed (a song opened, a file dropped): no window, nothing left running.
  FirstRun.abandon = () => {
    const s = session;
    if (!s || !s.auto) return;
    endSession(s);
    s.ui?.gone();
  };
  // Resolves when it has closed. auto: the fresh install's window, on the intro's stage. Otherwise the sheet from Settings.
  let openNow = null;
  FirstRun.open = ({ auto = false, stage = null } = {}) => {
    if (openNow) return openNow;
    let s = auto && session?.auto ? session : null;
    if (!s) {
      if (session) endSession(session);
      s = session = newSession(auto);
      (auto ? scan.start() : scan.findFromSettings()).catch(() => {});
    }
    if (s.off) { session = null; return Promise.resolve(); }
    openNow = (stage ? openOnStage(s, stage) : openSheet(s)).finally(() => { openNow = null; });
    return openNow;
  };
  Intro.finderStep = (stage) => FirstRun.open({ auto: true, stage });
})();
