'use strict';
// Artwork tools (Edit info → cover, playlists, new albums):
//  • Adjust: drag to move, scroll/slider to zoom, Fit (whole image, blurred fill) or Fill (crop to square)
//  • From other songs: every artwork in the library, grouped by picture; open one to see the songs using it
//    and tick as many songs as you like to give them that artwork too
// Uses app.js globals: api, lib, edits, $, $$, esc, anim, done, toast, cleanErr, titleOf, artistOf, plural, artStyle, ICON, libChanged, save, current, showNow, openMenu, mainArtist.
(() => {
  // ---------- a layer above the modal ----------
  function layer(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'art-layer';
    el.innerHTML = `<div class="art-bd"></div><div class="art-panel glass ${cls}">${html}</div>`;
    document.body.appendChild(el);
    const panel = $('.art-panel', el), bd = $('.art-bd', el);
    anim(bd, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
    anim(panel, [{ opacity: 0, transform: 'translateY(18px) scale(.95)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
    let closed = false, onClose = null;
    const close = async () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', esc_, true);
      anim(bd, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      await done(anim(panel, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(10px) scale(.97)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }));
      el.remove();
      onClose?.();
    };
    const esc_ = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', esc_, true);
    bd.addEventListener('click', close);
    return { el, panel, close, set onClose(f) { onClose = f; } };
  }

  // ---------- Adjust ----------
  const V = 300, OUT = 720;
  const SHARP = 600;      // fewer of the picture's own pixels than this across the square starts to look soft
  function adjust(img, { same } = {}) {
    return new Promise((resolve) => {
      const W = img.width, H = img.height;
      const zCover = V / Math.min(W, H), zFit = V / Math.max(W, H);
      let z = zCover, x = (V - W * z) / 2, y = (V - H * z) / 2, result = null;
      const L = layer(`
        <h3 class="modal-title">Adjust cover</h3>
        ${same ? '<div class="same-cover" data-same></div>' : ''}
        <div class="adj-view" data-view>
          <div class="adj-fill" style="background-image:url('${img.dataUrl}')"></div>
          <img class="adj-img" src="${img.dataUrl}" draggable="false" alt="" />
          <div class="adj-grid"></div>
        </div>
        <div class="adj-zoom">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M8.5 11h5"/><path d="m20 20-4.5-4.5"/></svg>
          <input type="range" class="range" min="0" max="1000" data-zoom />
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M8.5 11h5M11 8.5v5"/><path d="m20 20-4.5-4.5"/></svg>
        </div>
        <div class="set-chips adj-modes"><button type="button" class="schip" data-fit>Fit whole image</button><button type="button" class="schip" data-fill>Fill square</button></div>
        <p class="note adj-hint">Drag to move · scroll to zoom</p>
        <div class="adj-warn" data-warn role="status"><p></p></div>
        <div class="modal-actions"><span class="grow"></span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok>Use cover</button></div>`, 'adj-panel');
      L.onClose = () => resolve(result);
      const strip = same ? sameStrip($('[data-same]', L.panel), same) : null;
      const view = $('[data-view]', L.panel), im = $('.adj-img', L.panel), range = $('[data-zoom]', L.panel);
      const warn = $('[data-warn]', L.panel);
      const zMin = Math.min(zFit, zCover), zMax = zCover * 4;
      const toR = (v) => Math.round(((Math.log(v) - Math.log(zMin)) / (Math.log(zMax) - Math.log(zMin))) * 1000);
      const fromR = (r) => Math.exp(Math.log(zMin) + (r / 1000) * (Math.log(zMax) - Math.log(zMin)));
      const clamp = () => {
        const w = W * z, h = H * z;
        x = w >= V ? Math.min(0, Math.max(V - w, x)) : Math.max(0, Math.min(V - w, x));
        y = h >= V ? Math.min(0, Math.max(V - h, y)) : Math.max(0, Math.min(V - h, y));
      };
      const paint = (glide = false) => {
        clamp();
        im.style.transition = glide ? 'transform .55s var(--glide)' : 'none';
        im.style.width = W + 'px'; im.style.height = H + 'px';
        im.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
        range.value = toR(z); setFill(range);
        $('[data-fit]', L.panel).classList.toggle('on', Math.abs(z - zFit) < 1e-4);
        $('[data-fill]', L.panel).classList.toggle('on', Math.abs(z - zCover) < 1e-4 && zFit !== zCover);
        // a heads-up, not a block: how many of the picture's own pixels end up across the square, zoom included
        const across = Math.round(V / z);
        warn.classList.toggle('on', across < SHARP);
        if (across < SHARP) warn.firstElementChild.textContent = `Low quality: about ${across} pixels across${across < Math.min(W, H) ? ' at this zoom' : ''}. It may look blurry as the cover and in the background. 1000 × 1000 or bigger stays sharp.`;
      };
      const zoomTo = (nz, cx = V / 2, cy = V / 2, glide = false) => {
        nz = Math.max(zMin, Math.min(zMax, nz));
        x = cx - ((cx - x) * nz) / z; y = cy - ((cy - y) * nz) / z; z = nz;
        paint(glide);
      };
      paint();
      range.addEventListener('input', () => zoomTo(fromR(+range.value)));
      view.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = view.getBoundingClientRect();
        zoomTo(z * Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });
      let dragFrom = null;
      view.addEventListener('pointerdown', (e) => { view.setPointerCapture(e.pointerId); dragFrom = { px: e.clientX, py: e.clientY, x, y }; view.classList.add('grab'); });
      view.addEventListener('pointermove', (e) => { if (!dragFrom) return; x = dragFrom.x + e.clientX - dragFrom.px; y = dragFrom.y + e.clientY - dragFrom.py; paint(); });
      const up = () => { dragFrom = null; view.classList.remove('grab'); };
      view.addEventListener('pointerup', up); view.addEventListener('pointercancel', up);
      $('[data-fit]', L.panel).addEventListener('click', () => { z = zFit; x = (V - W * z) / 2; y = (V - H * z) / 2; paint(true); });
      $('[data-fill]', L.panel).addEventListener('click', () => { z = zCover; x = (V - W * z) / 2; y = (V - H * z) / 2; paint(true); });
      $('[data-x]', L.panel).addEventListener('click', L.close);
      $('[data-ok]', L.panel).addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        try {
          const c = document.createElement('canvas');
          c.width = c.height = OUT;
          const g = c.getContext('2d'), f = OUT / V, w = W * z * f, h = H * z * f;
          const pic = new Image();
          pic.src = img.dataUrl;
          await pic.decode();
          if (w < OUT - 0.5 || h < OUT - 0.5) {      // gaps: fill with a blurred, enlarged copy
            const s = Math.max(OUT / W, OUT / H) * 1.15;
            g.filter = 'blur(36px) saturate(1.2) brightness(.85)';
            g.drawImage(pic, (OUT - W * s) / 2, (OUT - H * s) / 2, W * s, H * s);
            g.filter = 'none';
          }
          g.imageSmoothingQuality = 'high';
          g.drawImage(pic, x * f, y * f, w, h);
          result = await api.saveArtData(c.toDataURL('image/jpeg', 0.9));
          if (strip?.all()) result.alsoTo = strip.others();
          L.close();
        } catch (err) { toast(cleanErr(err), true); e.currentTarget.disabled = false; }
      });
    });
  }
  async function pickAndAdjust(opts) {
    try { const img = await api.pickImageData(); return img ? adjust(img, opts) : null; }
    catch (err) { toast(cleanErr(err), true); return null; }
  }
  async function adjustUrl(url, opts) {
    try { return adjust(await api.imageData(url), opts); }
    catch (err) { toast(cleanErr(err), true); return null; }
  }

  // ---------- artwork from other songs ----------
  async function hashesOf(songs) {
    const hashes = [];
    for (let i = 0; i < songs.length; i += 500) hashes.push(...(await api.artHashes(songs.slice(i, i + 500).map((t) => t.thumb))));
    return hashes;
  }

  // ---------- the other songs with exactly this picture, shown on top of the cover editors ----------
  // Same picture = the same thumbnail file contents. `not` leaves out the song being edited. The strip stays hidden
  // until something matches. all(): the "change them all" switch is on. others(): the songs it would change.
  function sameStrip(host, { thumb, not = [], allLabel }) {
    let others = [];
    const box = { all: () => !!host?.querySelector('input')?.checked, others: () => others };
    if (!host || !thumb) return box;
    (async () => {
      const songs = [...lib.values()].filter((t) => t.thumb);
      const [hashes, [mine]] = await Promise.all([hashesOf(songs), api.artHashes([thumb])]);
      const key = mine || thumb, skip = new Set(not);
      others = songs.filter((t, i) => (hashes[i] || t.thumb) === key && !skip.has(t));
      if (!others.length || !host.isConnected) return;
      const n = others.length, names = others.slice(0, 2).map(titleOf).join(', ');
      host.innerHTML = `<div class="sc-in">
          <button type="button" class="sc-head" data-sc-open aria-expanded="false">
            <span class="sc-thumb"></span>
            <span class="sc-text"><b>Also on ${plural(n, not.length ? 'other song' : 'song')}</b><small>${esc(names)}${n > 2 ? ` + ${n - 2} more` : ''}</small></span>
            <svg class="sc-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <div class="sc-list"><div class="sc-rows">${others.slice(0, 200).map((t) => `<div class="sc-song"><b>${esc(titleOf(t))}</b><small>${esc(artistOf(t))}</small></div>`).join('')}
            ${n > 200 ? `<div class="sc-song"><small>and ${n - 200} more</small></div>` : ''}</div></div>
          <label class="sc-all"><span>${esc(allLabel(n))}</span><span class="switch"><input type="checkbox" /><i></i></span></label>
        </div>`;
      $('.sc-thumb', host).style.backgroundImage = cssUrl(thumb);
      $('[data-sc-open]', host).addEventListener('click', (e) => e.currentTarget.setAttribute('aria-expanded', String(host.classList.toggle('open'))));
      requestAnimationFrame(() => host.classList.add('on'));
    })().catch(() => { others = []; });
    return box;
  }
  // puts a cover on several songs at once; part of the same undo step as the save that called it
  function giveCover(tracks, art) {
    let playing = false;
    for (const t of tracks) {
      Object.assign(t, (edits[t.path] = { ...(edits[t.path] || {}), cover: art.cover, thumb: art.thumb }));
      if (t === current()) playing = true;
    }
    if (tracks.length) { libChanged(); save(); if (playing) showNow(false); }
    return tracks.length;
  }

  async function artGroups() {
    const songs = [...lib.values()].filter((t) => t.thumb);
    const hashes = await hashesOf(songs);
    const m = new Map();
    songs.forEach((t, i) => {
      const k = hashes[i] || t.thumb;
      let g = m.get(k);
      if (!g) m.set(k, (g = { key: k, thumb: t.thumb, songs: [] }));
      g.songs.push(t);
    });
    for (const g of m.values()) {
      const albums = new Set(g.songs.map((t) => t.album).filter(Boolean));
      g.name = albums.size === 1 ? [...albums][0] : g.songs.length === 1 ? titleOf(g.songs[0]) : `${titleOf(g.songs[0])} +${g.songs.length - 1}`;
      g.sub = [...new Set(g.songs.map((t) => t.artist).filter(Boolean))].slice(0, 2).join(', ');
      g.text = g.songs.map((t) => `${titleOf(t)} ${t.artist || ''} ${t.album || ''}`).join(' ').toLowerCase();
    }
    return [...m.values()].sort((a, b) => b.songs.length - a.songs.length);
  }
  // full-size version of a group's picture (a custom cover, or extracted from a song's tags)
  async function fullArt(g) {
    const withCover = g.songs.find((t) => t.cover);
    if (withCover) return { cover: withCover.cover, thumb: withCover.thumb || g.thumb };
    const tagged = g.songs.find((t) => t.hasCover);
    if (tagged) { const u = await api.cover(tagged.path).catch(() => null); if (u) return { cover: u, thumb: g.thumb }; }
    return { cover: g.thumb, thumb: g.thumb };
  }

  // resolves with { cover, thumb } for `forTrack` when it was ticked, else null; other ticked songs are updated directly
  function fromSongs(forTrack) {
    return new Promise((resolve) => {
      let result = null, groups = [], open = null;
      const L = layer(`
        <div class="ap-head"><button type="button" class="ibtn xs ap-back" data-back hidden>${ICON.back}</button><h3 class="modal-title" data-title>Use art from another song</h3></div>
        <label class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input type="text" data-q placeholder="Search songs, artists, albums" spellcheck="false" /></label>
        <div class="ap-body" data-body><div class="ap-grid">${'<div class="ap-skel"></div>'.repeat(8)}</div></div>
        <div class="modal-actions"><span class="ap-count" data-count></span><span class="grow"></span><button type="button" class="btn" data-x>Cancel</button><button type="button" class="btn primary" data-ok hidden>Apply</button></div>`, 'ap-panel');
      L.onClose = () => resolve(result);
      const body = $('[data-body]', L.panel), q = $('[data-q]', L.panel), okBtn = $('[data-ok]', L.panel), back = $('[data-back]', L.panel);
      const picked = new Set();
      $('[data-x]', L.panel).addEventListener('click', L.close);
      setTimeout(() => q.focus(), 80);

      const paintGrid = () => {
        const s = q.value.trim().toLowerCase();
        const list = (s ? groups.filter((g) => g.text.includes(s)) : groups).slice(0, 240);
        body.innerHTML = list.length
          ? `<div class="ap-grid">${list.map((g, i) => `<button type="button" class="ap-tile" data-g="${groups.indexOf(g)}" style="--d:${Math.min(i, 24) * 22}ms">
              <span class="ap-art" style="background-image:url('${g.thumb}')"><em>${g.songs.length}</em></span>
              <b>${esc(g.name)}</b><small>${esc(g.sub || plural(g.songs.length, 'song'))}</small></button>`).join('')}</div>`
          : `<div class="lk-empty">${groups.length ? 'No artwork matches that search' : 'No songs have artwork yet'}</div>`;
      };
      const songRow = (t, mode) => `<label class="ap-song${mode === 'has' ? ' has' : ''}" data-p="${esc(t.path)}">
          ${mode === 'has' ? '<span class="ap-has">Has it</span>' : `<span class="check"><input type="checkbox" ${picked.has(t.path) ? 'checked' : ''} /><span class="box"></span></span>`}
          <span class="ap-thumb" style="${artStyle(t.thumb, titleOf(t))}"></span>
          <span class="ap-text"><b>${esc(titleOf(t))}</b><small>${esc([artistOf(t), t.album].filter(Boolean).join(' — '))}</small></span></label>`;
      const paintSongs = () => {
        const g = open, s = q.value.trim().toLowerCase();
        const has = new Set(g.songs.map((t) => t.path));
        const ar = forTrack?.artist ? mainArtist(forTrack).toLowerCase() : '', al = (forTrack?.album || '').toLowerCase();
        const near = (t) => (t === forTrack ? 3 : (al && (t.album || '').toLowerCase() === al ? 2 : 0) + (ar && t.artist && mainArtist(t).toLowerCase() === ar ? 1 : 0));
        let others = [...lib.values()].filter((t) => !has.has(t.path));
        if (s) others = others.filter((t) => `${titleOf(t)} ${t.artist || ''} ${t.album || ''}`.toLowerCase().includes(s));
        others.sort((a, b) => near(b) - near(a) || (picked.has(b.path) - picked.has(a.path)));
        const shown = others.slice(0, 300);
        body.innerHTML = `
          <div class="ap-hero"><span class="ap-big" style="background-image:url('${g.thumb}')"></span>
            <div><b>${esc(g.name)}</b><span>${plural(g.songs.length, 'song')} use this artwork</span></div></div>
          <h4 class="ap-h">Songs with this artwork</h4>
          <div class="ap-list">${g.songs.map((t) => songRow(t, 'has')).join('')}</div>
          <h4 class="ap-h">Give it to <button type="button" class="btn ghost ap-all" data-all>${shown.length && shown.every((t) => picked.has(t.path)) ? 'Select none' : 'Select all shown'}</button></h4>
          <div class="ap-list">${shown.map((t) => songRow(t, 'pick')).join('') || '<div class="lk-empty">Every song already has it</div>'}</div>
          ${others.length > shown.length ? `<p class="note">Showing ${shown.length} of ${others.length}. Search to find more.</p>` : ''}`;
        $('[data-all]', body)?.addEventListener('click', () => {
          const all = shown.every((t) => picked.has(t.path));
          shown.forEach((t) => (all ? picked.delete(t.path) : picked.add(t.path)));
          paintSongs(); paintCount();
        });
      };
      const paintCount = () => {
        okBtn.hidden = !open;
        okBtn.disabled = !picked.size;
        okBtn.textContent = picked.size ? `Apply to ${plural(picked.size, 'song')}` : 'Apply';
        $('[data-count]', L.panel).textContent = '';
      };
      const openGroup = (g) => {
        open = g;
        picked.clear();
        if (forTrack && !g.songs.includes(forTrack)) picked.add(forTrack.path);
        back.hidden = false;
        $('[data-title]', L.panel).textContent = 'Choose songs';
        q.value = '';
        q.placeholder = 'Search songs to give this artwork';
        paintSongs(); paintCount();
        anim(body, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
      };
      back.addEventListener('click', () => {
        open = null;
        back.hidden = true;
        $('[data-title]', L.panel).textContent = 'Use art from another song';
        q.value = ''; q.placeholder = 'Search songs, artists, albums';
        paintGrid(); paintCount();
        anim(body, [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 420 });
      });
      q.addEventListener('input', () => (open ? paintSongs() : paintGrid()));
      body.addEventListener('click', (e) => {
        const tile = e.target.closest('[data-g]');
        if (tile) { openGroup(groups[+tile.dataset.g]); return; }
      });
      body.addEventListener('change', (e) => {
        const row = e.target.closest('[data-p]');
        if (!row) return;
        e.target.checked ? picked.add(row.dataset.p) : picked.delete(row.dataset.p);
        paintCount();
      });
      okBtn.addEventListener('click', async () => {
        okBtn.disabled = true;
        const art = await fullArt(open);
        let n = 0;
        for (const p of picked) {
          const t = lib.get(p);
          if (!t) continue;
          if (t === forTrack) { result = art; continue; }    // the open Edit info applies its own song on Save
          const e = (edits[p] = { ...(edits[p] || {}), cover: art.cover, thumb: art.thumb });
          Object.assign(t, e);
          n++;
        }
        if (n) {
          libChanged(); save();
          if (current() && picked.has(current().path) && current() !== forTrack) showNow(false);
          toast(`Artwork added to ${plural(n, 'song')}${result ? ' (this one saves with Edit info)' : ''}`);
        }
        L.close();
      });
      artGroups().then((g) => { groups = g; if (!open) paintGrid(); }).catch((err) => { body.innerHTML = `<div class="lk-empty">${esc(cleanErr(err))}</div>`; });
      paintCount();
    });
  }

  // the menu behind every "change cover" button
  function coverMenu(rect, { current: cur, forTrack, onPick, fromSongs: allowSongs = true, same }) {
    openMenu(rect, () => [
      { label: 'Choose an image…', icon: ICON.folder, act: async () => { const r = await pickAndAdjust({ same }); if (r) onPick(r); } },
      ...(allowSongs ? [{ label: 'Use art from another song…', icon: ICON.note, act: async () => { const r = await fromSongs(forTrack); if (r) onPick(r); } }] : []),
      ...(cur ? [{ label: 'Adjust this cover…', icon: ICON.edit, act: async () => { const r = await adjustUrl(cur, { same }); if (r) onPick(r); } }] : []),
    ]);
  }

  window.Art = { adjust, pickAndAdjust, adjustUrl, fromSongs, coverMenu, layer, sameStrip, giveCover };
})();
