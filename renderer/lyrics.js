'use strict';
// Lyrics panel.
// Lookup order lives in main (lyrics-get): sidecar .lrc/.txt → tags → saved pick → LRCLIB.
// The search lists matches from LRCLIB, Kugou and NetEase, inside Glass.
// Synced lyrics follow playback (current line glides to centre, click a line to jump); plain lyrics just scroll.
// Uses app.js globals: api, S, $, body, deck, current, esc, anim, toast, cleanErr, guessQuery, openMenu, ICON, fmt, save.
(() => {
  const pane = $('#lyrics'), lyBody = $('#lyBody'), srcEl = $('#lySrc'), btn = $('#btnLyrics');
  const wrap = $('#lyLookup'), q = $('#lyQ'), out = $('#lyResults'), findBtn = $('#lyFind');
  let open = false, shownFor = null, data = null, lines = [], curLine = -2, seq = 0;
  let userScrollUntil = 0, results = [], searchSeq = 0;
  const cache = new Map();   // song file path -> lyrics result, this session
  const remember = (t, r) => { cache.set(t.path, r); if (cache.size > 400) cache.delete(cache.keys().next().value); };

  // ---------- the player ----------
  const nowSong = () => current() || null;
  const nowTime = () => deck.currentTime || 0;
  const isPlaying = () => !deck.paused;
  function seekTo(sec) {
    deck.seek(sec);
    if (deck.paused) deck.play();
  }

  const SRC_LABEL = { File: 'From the lyrics file', Tags: 'From the song file', LRCLIB: 'From LRCLIB', Kugou: 'From Kugou', NetEase: 'From NetEase' };
  const ONLINE = new Set(['LRCLIB', 'Kugou', 'NetEase']);
  const hintsOf = (t) => ({
    title: t.title || '', artist: t.artist || '', album: t.album || '',
    duration: t.duration || (t === current() ? deck.duration || 0 : 0),
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
      html = `<div class="ly-empty">${EMPTY_ICON}<b>Nothing playing</b><span>Play a song and its lyrics show up here.</span></div>`;
    } else if (!data || data.none) {
      html = `<div class="ly-empty">${EMPTY_ICON}
        <b>${data?.error ? esc(data.error) : 'No lyrics found'}</b>
        <span>${data?.error ? '' : 'Search with different words, or put a .lrc file next to the song.'}</span>
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
    // force (Look again): really search online again instead of getting the saved answer back
    try { r = await api.lyrics.get(t.path, hintsOf(t), force ? 'fresh' : 'auto'); } catch (err) { r = { none: true, error: cleanErr(err) }; }
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
  // The panel changing size (dragging the queue panel, resizing the window, cover ⇄ corner) re-wraps the
  // lines. Synced lyrics keep the sung line exactly where it was on every frame; plain lyrics keep their place
  // in the text. Without this the text jumped about and then slid back.
  let lyW = 0, place = 0;
  lyBody.addEventListener('scroll', () => {
    const room = lyBody.scrollHeight - lyBody.clientHeight;
    if (!glideRaf) place = room > 0 ? lyBody.scrollTop / room : 0;
  }, { passive: true });
  new ResizeObserver(() => {
    const w = lyBody.clientWidth;
    if (!open || !w || Math.abs(w - lyW) < 0.5) { lyW = w; return; }
    lyW = w;
    const box = lyBody.firstElementChild;
    const cur = lines.length && curLine >= 0 && box ? box.children[curLine] : null;
    if (cur) { if (performance.now() > userScrollUntil) follow(cur, true); return; }
    if (!lines.length) lyBody.scrollTop = place * Math.max(0, lyBody.scrollHeight - lyBody.clientHeight);
  }).observe(lyBody);
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

  // ---------- search: LRCLIB, Kugou and NetEase, all shown here (synced first) ----------
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
            <span class="lk-text"><b>${esc(r.title || 'Unknown')}</b><small>${esc([r.artist, r.album, r.duration ? fmt(r.duration) : '', r.source].filter(Boolean).join(' · '))}${off ? ' · different length' : ''}</small></span>
            <span class="lk-src${r.synced ? ' on' : ''}">${r.instrumental ? 'Instrumental' : r.synced ? 'Synced' : 'Plain'}</span></button>`;
        }).join('')
        : '<div class="lk-empty">No matches. Try just the song name.</div>';
    out.innerHTML = `<div class="ly-sec">Lyrics <span>LRCLIB, Kugou and NetEase · synced first</span></div>` + lrHTML;
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
      ...(has && data.source === 'LRCLIB' ? [{
        label: data.synced ? 'Save as .lrc next to the song' : 'Save as .txt next to the song', icon: ICON.folder,
        act: async () => {
          try { const name = await api.lyrics.saveFile(t.path, data); data = { ...data, source: 'File', file: name }; remember(t, data); paintSrc(); toast(`Saved ${name}`); }
          catch (err) { toast(cleanErr(err), true); }
        },
      }] : []),
      // any lyrics found online (LRCLIB, Kugou, NetEase) can be thrown out; your own .lrc file and the song's tags can't
      ...(data && (has || data.instrumental) && ONLINE.has(data.source) ? [{
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

  // ---------- room for the cover? ----------
  // When the stage gets too narrow for cover and lyrics side by side (the queue panel was widened, the window
  // shrunk), the lyrics flow out to fill it and the glass takes the cover in like a water drop: it drifts into
  // their top-left corner, shrinking and softening as the glass absorbs it, and the small cover surfaces from
  // inside with a ripple. Widening lets it rise back out. A small gap between the two widths keeps it from
  // flickering at the edge.
  const stage = $('#stage');
  const ROOM_OFF = 640, ROOM_ON = 680;      // stage widths: narrower than OFF → compact; wider than ON → side by side
  let compact = false;
  function fitRoom(animate) {
    const w = stage.clientWidth;
    if (!w) return;
    const want = compact ? w < ROOM_ON : w < ROOM_OFF;
    if (want === compact) return;
    compact = want;
    const shown = animate && open && !moving && !reduceMotion && body.classList.contains('lyrics-on')
      && body.classList.contains('has-track') && !body.classList.contains('is-video') && !body.classList.contains('wide');
    if (shown) drop(want);
    else body.classList.toggle('ly-compact', want);
    if (open && lines.length) setTimeout(() => tick(true), shown ? 760 : 0);
  }
  // The moving cover is a stand-in drawn at full size and only ever scaled down, so it stays sharp the whole way
  // (scaling the small corner cover up to full size was what made it look blurry mid-way).
  let ghost = null;
  function drop(toCorner) {
    const wrapEl = $('#artWrap'), img = $('#artImg'), meta = $('#nowMeta');
    [wrapEl, img, meta, pane].forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
    ghost?.remove();
    ghost = null;
    const i0 = img.getBoundingClientRect(), p0 = pane.getBoundingClientRect();
    body.classList.toggle('ly-compact', toCorner);
    const i1 = img.getBoundingClientRect(), p1 = pane.getBoundingClientRect();
    if (!i0.width || !i1.width) return;
    const big = toCorner ? i0 : i1, small = toCorner ? i1 : i0;        // the cover picture: full size, and in the corner
    const s = small.width / big.width, dx = small.left - big.left, dy = small.top - big.top;
    const at = (k, sc) => `translate(${dx * k}px, ${dy * k}px) scale(${sc})`;
    const cs = getComputedStyle(img);
    const g = ghost = document.createElement('div');
    g.className = 'art-ghost';
    Object.assign(g.style, { left: big.left + 'px', top: big.top + 'px', width: big.width + 'px', height: big.height + 'px',
      backgroundImage: cs.backgroundImage, backgroundColor: cs.backgroundColor });
    document.body.appendChild(g);
    const finish = (a) => done(a).then(() => { if (ghost === g) ghost = null; g.remove(); });
    const T = 900, R = 22, r = 12 / s;          // corner radius at full size; the corner cover's radius, in full-size units
    if (toCorner) {
      // drifts toward the corner and shrinks, rounds into a drop as it reaches the glass, then softens and fades
      // into it: the glass takes it in rather than it landing on top
      finish(anim(g, [
        { transform: 'none', borderRadius: R + 'px', opacity: 1, filter: 'blur(0px)' },
        { transform: at(0.8, s * 1.5), borderRadius: '50%', opacity: 1, filter: `blur(${0.6 / s}px)`, offset: 0.58 },
        { transform: at(1, s), borderRadius: '50%', opacity: 0, filter: `blur(${5 / s}px)` },
      ], { duration: T, easing: 'cubic-bezier(.45, 0, .2, 1)', fill: 'forwards' }));
      // ...and the small cover surfaces from inside the glass with a ripple
      anim(wrapEl, [{ opacity: 0, filter: 'blur(7px)', transform: 'scale(.72)' }, { opacity: 1, filter: 'blur(0px)', transform: 'none' }],
        { duration: 520, delay: T * 0.55, easing: GLIDE, fill: 'backwards' });
      ripple(small, p1, T * 0.6);
      // the lyrics pour out from where they were to fill the stage
      const ins = [p0.top - p1.top, p1.right - p0.right, p1.bottom - p0.bottom, p0.left - p1.left].map((v) => Math.max(0, Math.round(v)) + 'px');
      anim(pane, [{ clipPath: `inset(${ins.join(' ')} round 26px)` }, { clipPath: 'inset(-30px round 56px)' }], { duration: 760, easing: GLIDE });
    } else {
      // the small cover lifts out of the glass as a soft drop, sharpens and swells into the full cover
      finish(anim(g, [
        { transform: at(1, s), borderRadius: r + 'px', opacity: 0, filter: `blur(${5 / s}px)` },
        { transform: at(0.85, s * 1.5), borderRadius: '50%', opacity: 1, filter: `blur(${0.6 / s}px)`, offset: 0.35 },
        { transform: 'none', borderRadius: R + 'px', opacity: 1, filter: 'blur(0px)' },
      ], { duration: T, easing: 'cubic-bezier(.4, 0, .2, 1)' }));
      anim(wrapEl, [{ opacity: 0 }, { opacity: 0, offset: 0.92 }, { opacity: 1 }], { duration: T, easing: 'linear' });
      anim(pane, [{ transform: `translateX(${Math.round(p0.left - p1.left)}px)`, opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 760, easing: GLIDE });
      anim(meta, [{ opacity: 0, transform: 'translateY(10px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'none' }], { duration: 620, delay: 300, easing: GLIDE, fill: 'backwards' });
    }
  }
  // a soft ring spreading through the lyrics glass where the cover went in (kept inside the panel)
  function ripple(at, box, delay) {
    const clip = document.createElement('div'), ring = document.createElement('i');
    clip.className = 'drop-ripple';
    const size = at.width * 1.15;
    Object.assign(ring.style, { left: at.left - box.left + at.width / 2 - size / 2 + 'px', top: at.top - box.top + at.height / 2 - size / 2 + 'px', width: size + 'px', height: size + 'px' });
    clip.appendChild(ring);
    pane.appendChild(clip);
    done(anim(ring, [{ transform: 'scale(.55)', opacity: 0 }, { transform: 'scale(.85)', opacity: 0.75, offset: 0.18 }, { transform: 'scale(2.6)', opacity: 0 }],
      { duration: 820, delay, easing: 'cubic-bezier(.2, .7, .3, 1)', fill: 'both' })).then(() => clip.remove());
  }
  new ResizeObserver(() => fitRoom(true)).observe(stage);
  fitRoom(false);

  window.Lyrics = {
    // the song on screen changed (showNow); null = nothing playing
    track(t) {
      if (t === shownFor && t) return;
      if (open) load(t || null); else { shownFor = null; data = null; }
    },
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
  for (const v of deck.elements) v.addEventListener('seeked', () => { if (v === deck.videoElement) window.Lyrics.seeked(); });
})();
