'use strict';
// Lyrics panel, for local songs and Spotify alike.
// Lookup order lives in main (lyrics-get): local songs → sidecar .lrc/.txt → tags → saved pick → LRCLIB;
// Spotify songs → saved pick → LRCLIB. The search also lists Genius matches, which open on genius.com
// (Genius has no lyrics API and doesn't allow automated access, so it opens Genius's own search page in the browser).
// Synced lyrics follow playback (current line glides to centre, click a line to jump); plain lyrics just scroll.
// Uses app.js globals: api, S, $, body, deck, current, esc, anim, toast, cleanErr, guessQuery, openMenu, ICON, fmt, save.
(() => {
  const pane = $('#lyrics'), lyBody = $('#lyBody'), srcEl = $('#lySrc'), btn = $('#btnLyrics');
  const wrap = $('#lyLookup'), q = $('#lyQ'), out = $('#lyResults'), findBtn = $('#lyFind');
  let open = false, shownFor = null, data = null, lines = [], curLine = -2, seq = 0;
  let userScrollUntil = 0, results = [], searchSeq = 0;
  const cache = new Map();   // song key (file path, or "sp:spotify:track:…") -> lyrics result, this session
  const remember = (t, r) => { cache.set(t.path, r); if (cache.size > 400) cache.delete(cache.keys().next().value); };

  // ---------- whichever player is active ----------
  const isSp = () => S.source === 'spotify';
  const nowSong = () => (isSp() ? window.Spot?.nowTrack?.() || null : current() || null);
  const nowTime = () => (isSp() ? window.Spot?.position?.() || 0 : deck.currentTime || 0);
  const isPlaying = () => (isSp() ? !!window.Spot?.isPlaying?.() : !deck.paused);
  function seekTo(sec) {
    if (isSp()) { window.Spot?.seek?.(sec * 1000); return; }
    deck.seek(sec);
    if (deck.paused) deck.play();
  }

  const SRC_LABEL = { File: 'From the lyrics file', Tags: 'From the song file', LRCLIB: 'From LRCLIB' };
  const hintsOf = (t) => ({
    title: t.title || '', artist: t.artist || '', album: t.album || '',
    duration: t.duration || (!t.sp && t === current() ? deck.duration || 0 : 0),
    q: guessQuery(t),
  });

  function paintSrc() {
    const label = data && !data.none && !data.instrumental ? SRC_LABEL[data.source] || '' : '';
    srcEl.textContent = label ? label + (data.synced ? ' · synced' : '') : '';
    srcEl.title = data?.file || '';
  }

  const EMPTY_ICON = '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12.5h5" /></svg>';
  function render(state) {
    curLine = -2;
    lines = [];
    let html;
    if (state === 'loading') {
      html = '<div class="ly-skel">' + [72, 54, 80, 46, 66, 58].map((w, i) => `<i style="width:${w}%;--d:${i * 70}ms"></i>`).join('') + '</div>';
    } else if (state === 'idle') {
      html = `<div class="ly-empty">${EMPTY_ICON}<b>Nothing playing</b><span>${isSp() ? 'Play something on Spotify and its lyrics show up here.' : 'Play a song and its lyrics show up here.'}</span></div>`;
    } else if (!data || data.none) {
      html = `<div class="ly-empty">${EMPTY_ICON}
        <b>${data?.error ? esc(data.error) : 'No lyrics found'}</b>
        <span>${data?.error ? '' : shownFor?.sp ? 'Search with different words.' : 'Search with different words, or put a .lrc file next to the song.'}</span>
        <button class="btn" data-ly-search>Search lyrics</button></div>`;
    } else if (data.instrumental) {
      html = '<div class="ly-empty"><svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></svg><b>Instrumental</b><span>No words in this one.</span></div>';
    } else if (data.synced) {
      lines = data.synced;
      html = '<div class="ly-lines synced">' + lines.map((l, i) =>
        l.text ? `<p data-i="${i}">${esc(l.text)}</p>` : `<p data-i="${i}" class="gap"><i></i><i></i><i></i></p>`).join('') + '</div>';
    } else {
      html = '<div class="ly-lines plain">' + data.plain.split(/\n/).map((s) => (s.trim() ? `<p>${esc(s)}</p>` : '<p class="br"></p>')).join('') + '</div>';
    }
    lyBody.innerHTML = html;
    lyBody.scrollTop = 0;
    paintSrc();
    if (state !== 'loading') anim(lyBody.firstElementChild, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 700 });
    tick(true);
  }

  async function load(t, { force = false } = {}) {
    if (!t) { shownFor = null; data = null; render('idle'); return; }
    shownFor = t;
    closeSearch();
    if (!force && cache.has(t.path)) { data = cache.get(t.path); render(); return; }
    const my = ++seq;
    data = null;
    render('loading');
    let r;
    try { r = await api.lyrics.get(t.path, hintsOf(t)); } catch (err) { r = { none: true, error: cleanErr(err) }; }
    if (my !== seq || shownFor !== t) return;
    if (!r.error) remember(t, r);
    data = r;
    render();
  }

  // ---------- follow along ----------
  function lineAt(time) {
    let lo = 0, hi = lines.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (lines[mid].t <= time + 0.15) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function tick(force = false) {
    if (!open || !lines.length) return;
    const i = lineAt(nowTime());
    if (i === curLine && !force) return;
    const box = lyBody.firstElementChild;
    box.querySelector('p.cur')?.classList.remove('cur');
    box.querySelectorAll('p.past').forEach((p) => { if (+p.dataset.i >= i) p.classList.remove('past'); });
    for (let k = Math.max(0, curLine < 0 ? 0 : Math.min(curLine, i)); k < i; k++) box.children[k]?.classList.add('past');
    const el = box.children[i];
    el?.classList.add('cur');
    curLine = i;
    if (performance.now() > userScrollUntil) follow(el, force);
  }
  // The lines glide to the sung one: the scroll follows a soft spring (eases in, eases out, never jumps).
  // A new line mid-glide just bends the path, keeping the speed it already has.
  let goal = 0, pos = 0, vel = 0, glideRaf = 0, glideLast = 0;
  const OMEGA = 6.2;                       // spring stiffness: settles in about 0.8 s
  function glideStep(now) {
    const dt = Math.min(0.05, (now - glideLast) / 1000);
    glideLast = now;
    if (Math.abs(lyBody.scrollTop - pos) > 3) { pos = lyBody.scrollTop; vel = 0; }   // moved by something else
    for (let s = 0, n = Math.ceil(dt / 0.008); s < n; s++) {                         // small steps stay stable
      const h = dt / n;
      vel += (OMEGA * OMEGA * (goal - pos) - 2 * OMEGA * vel) * h;
      pos += vel * h;
    }
    lyBody.scrollTop = pos;
    if (Math.abs(goal - pos) < 0.4 && Math.abs(vel) < 4) { lyBody.scrollTop = pos = goal; vel = 0; glideRaf = 0; return; }
    glideRaf = requestAnimationFrame(glideStep);
  }
  function stopGlide() { cancelAnimationFrame(glideRaf); glideRaf = 0; vel = 0; }
  function follow(el, instant) {
    const want = el ? el.offsetTop - lyBody.clientHeight * 0.38 + el.offsetHeight / 2 : 0;
    goal = Math.max(0, Math.min(want, lyBody.scrollHeight - lyBody.clientHeight));
    if (instant || reduceMotion) { stopGlide(); lyBody.scrollTop = pos = goal; return; }
    if (!glideRaf) { pos = lyBody.scrollTop; glideLast = performance.now(); glideRaf = requestAnimationFrame(glideStep); }
  }
  // the user scrolling by hand pauses following for a few seconds
  lyBody.addEventListener('wheel', () => { stopGlide(); userScrollUntil = performance.now() + 4000; }, { passive: true });
  lyBody.addEventListener('pointerdown', (e) => { if (e.target === lyBody) { stopGlide(); userScrollUntil = performance.now() + 4000; } });
  lyBody.addEventListener('click', (e) => {
    if (e.target.closest('[data-ly-search]')) { openSearch(); return; }
    const p = e.target.closest('.synced p[data-i]');
    if (!p || !lines[+p.dataset.i]) return;
    seekTo(lines[+p.dataset.i].t);
    userScrollUntil = 0;
    tick(true);
  });

  // ---------- search: LRCLIB (shown here) + Genius (opens in the browser) ----------
  function openSearch() {
    const t = shownFor;
    if (!t) return;
    wrap.classList.add('open');
    findBtn.classList.add('on');
    if (!q.value || q.dataset.for !== t.path) { q.value = guessQuery(t); q.dataset.for = t.path; out.innerHTML = ''; }
    setTimeout(() => q.focus(), 60);
    if (!out.childElementCount) runSearch();
  }
  function closeSearch() { wrap.classList.remove('open'); findBtn.classList.remove('on'); }
  async function runSearch() {
    const text = q.value.trim();
    if (!text) return;
    const my = ++searchSeq;
    out.innerHTML = Array.from({ length: 3 }, () => '<div class="lk-skel"><i></i><b></b></div>').join('');
    const [lr] = await Promise.allSettled([api.lyrics.search(text)]);
    if (my !== searchSeq) return;
    results = lr.status === 'fulfilled' ? lr.value : [];
    const d = shownFor?.duration || 0;
    const lrHTML = lr.status === 'rejected'
      ? `<div class="lk-empty">${esc(cleanErr(lr.reason))}</div>`
      : results.length
        ? results.map((r, i) => {
          const off = d && r.duration && Math.abs(r.duration - d) > 6;
          return `<button type="button" class="lk-item ly-item" data-r="${i}" style="--d:${i * 40}ms">
            <span class="lk-text"><b>${esc(r.title || 'Unknown')}</b><small>${esc([r.artist, r.album, r.duration ? fmt(r.duration) : ''].filter(Boolean).join(' · '))}${off ? ' · different length' : ''}</small></span>
            <span class="lk-src${r.synced ? ' on' : ''}">${r.instrumental ? 'Instrumental' : r.synced ? 'Synced' : 'Plain'}</span></button>`;
        }).join('')
        : '<div class="lk-empty">No LRCLIB matches. Try just the song name.</div>';
    const gnHTML = `<div class="ly-sec">Genius <span>opens in your browser</span></div>
      <button type="button" class="lk-item ly-item ly-genius" data-genius style="--d:${results.length * 40}ms">
        <span class="lk-art">G</span>
        <span class="lk-text"><b>Search on Genius</b><small>“${esc(text)}”</small></span>
        <span class="lk-src genius">Genius ↗</span></button>`;
    out.innerHTML = `<div class="ly-sec">LRCLIB <span>shows here, synced when available</span></div>` + lrHTML + gnHTML;
  }
  findBtn.addEventListener('click', () => (wrap.classList.contains('open') ? closeSearch() : openSearch()));
  $('#lyGo').addEventListener('click', runSearch);
  // searches as you type (Enter still works)
  let typeTimer = 0;
  q.addEventListener('input', () => { clearTimeout(typeTimer); typeTimer = setTimeout(runSearch, 450); });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(typeTimer); runSearch(); }
    if (e.key === 'Escape') { e.stopPropagation(); closeSearch(); q.blur(); }
  });
  out.addEventListener('click', async (e) => {
    if (e.target.closest('[data-genius]')) {
      api.openExternal('https://genius.com/search?q=' + encodeURIComponent(q.value.trim())).catch((err) => toast(cleanErr(err), true));
      return;
    }
    const b = e.target.closest('[data-r]');
    const t = shownFor;
    if (!b || !t) return;
    const r = results[+b.dataset.r];
    try { await api.lyrics.pick(t.path, r); } catch (err) { toast(cleanErr(err), true); }
    remember(t, r);
    if (shownFor !== t) return;
    data = r;
    closeSearch();
    render();
  });

  // ---------- ••• menu ----------
  $('#lyMore').addEventListener('click', (e) => {
    const t = shownFor;
    if (!t) return;
    const has = data && !data.none && !data.instrumental;
    openMenu(e.currentTarget.getBoundingClientRect(), () => [
      { label: 'Search lyrics…', icon: ICON.find, act: openSearch },
      ...(has && data.source === 'LRCLIB' && !t.sp ? [{
        label: data.synced ? 'Save as .lrc next to the song' : 'Save as .txt next to the song', icon: ICON.folder,
        act: async () => {
          try { const name = await api.lyrics.saveFile(t.path, data); data = { ...data, source: 'File', file: name }; remember(t, data); paintSrc(); toast(`Saved ${name}`); }
          catch (err) { toast(cleanErr(err), true); }
        },
      }] : []),
      ...(has && data.source === 'LRCLIB' ? [{
        label: 'Wrong lyrics, remove', icon: ICON.x,
        act: async () => { await api.lyrics.pick(t.path, null).catch(() => {}); data = { none: true }; remember(t, data); render(); },
      }] : []),
      { label: 'Look again', icon: ICON.shuffle, act: () => { cache.delete(t.path); load(t, { force: true }); } },
    ]);
  });

  // ---------- open / close ----------
  // the lyrics swipe the cover aside: cover + title glide (and shrink) to their new spot while the
  // panel slides in. Closing is the same in reverse, at the same speed and at the same time: the panel
  // slides out while the cover glides back to the middle.
  let moving = false;
  const flipEls = () => [$('#artWrap'), $('#nowMeta')];
  const PANE_OUT = [   // the panel's way out; coming in plays it backwards
    { opacity: 1, transform: 'none', filter: 'none' },
    { opacity: 0, transform: 'translateX(70px) scale(.95)', filter: 'blur(10px)' },
  ];
  function flip(els, before) {
    els.forEach((el, i) => {
      const a = before[i], b = el.getBoundingClientRect();
      if (!a.width || !b.width) return;
      const s = a.width / b.width;
      el.style.transformOrigin = '0 0';
      done(anim(el, [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${s})` }, { transform: 'none' }], { duration: 820, easing: GLIDE }))
        .then(() => { el.style.transformOrigin = ''; });
    });
  }
  async function setOpen(on, animate = true) {
    if (moving) return;
    open = on;
    btn.classList.toggle('on', on);
    S.lyrics = on;
    save();
    const visible = animate && !reduceMotion && body.classList.contains('has-track') && !body.classList.contains('is-video') && !body.classList.contains('wide');
    if (!visible) {
      body.classList.toggle('lyrics-on', on);
      if (on) { const t = nowSong(); if (!t || t !== shownFor) load(t); else tick(true); }
      return;
    }
    moving = true;
    try {
      const els = flipEls();
      if (on) {
        const before = els.map((el) => el.getBoundingClientRect());
        body.classList.add('lyrics-on');
        flip(els, before);
        anim(pane, PANE_OUT.slice().reverse(), { duration: 820, easing: GLIDE });
        const t = nowSong();
        if (!t || t !== shownFor) load(t); else tick(true);
      } else {
        // the panel stays exactly where it is (pinned) while the layout goes back underneath it
        const before = els.map((el) => el.getBoundingClientRect());
        const r0 = pane.getBoundingClientRect();
        pane.getAnimations().forEach((a) => a.cancel());
        Object.assign(pane.style, { width: r0.width + 'px', height: r0.height + 'px', left: '0px', top: '0px' });
        pane.classList.add('ly-leaving');
        body.classList.remove('lyrics-on');
        const r1 = pane.getBoundingClientRect();
        pane.style.left = r0.left - r1.left + 'px';
        pane.style.top = r0.top - r1.top + 'px';
        flip(els, before);
        await done(anim(pane, PANE_OUT, { duration: 820, easing: GLIDE, fill: 'forwards' }));
        if (!open) {
          pane.classList.remove('ly-leaving');
          Object.assign(pane.style, { width: '', height: '', left: '', top: '' });
          pane.getAnimations().forEach((a) => a.cancel());
        }
      }
    } finally { moving = false; }
  }
  btn.addEventListener('click', () => setOpen(!open));

  window.Lyrics = {
    // the song on screen changed (local showNow, or Spotify's now playing); null = nothing playing
    track(t) {
      if (t === shownFor && t) return;
      if (open) load(t || null); else { shownFor = null; data = null; }
    },
    // Local ⇄ Spotify: drop what was showing and follow the other player
    sourceChanged() { shownFor = null; data = null; seq++; closeSearch(); if (open) load(nowSong()); },
    // called every frame by tick() in app.js (cheap: a binary search, DOM only when the line changes)
    tick() { if (open && lines.length && isPlaying()) tick(); },
    seeked() { if (open && lines.length) { userScrollUntil = 0; tick(true); } },
    toggle() { setOpen(!open); },
    restore(on) { if (on) setOpen(true, false); },
    get open() { return open; },
    // next song: look its lyrics up ahead of time, only while the panel is open (no network for people who don't use it)
    prefetch(t) {
      if (!open || !t || cache.has(t.path)) return;
      api.lyrics.get(t.path, hintsOf(t)).then((r) => { if (!r.error) remember(t, r); }).catch(() => {});
    },
  };
  for (const v of deck.elements) v.addEventListener('seeked', () => { if (!isSp() && v === deck.videoElement) window.Lyrics.seeked(); });
})();
