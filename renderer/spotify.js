'use strict';
// Spotify mode: your Spotify library in the side panel, Spotify Connect playback control in the dock.
// Spotify's audio plays in the Spotify app on one of your devices; Glass is the remote (Web API).
// Loaded after app.js and reuses its list builders, menus, toasts and animation helpers.
(() => {
  const sp = window.glass.spotify;
  const LIKED_ART = 'background-image:linear-gradient(140deg, #8f86ff, #3c2f9f)';
  let status = { connected: false };
  let player = null, recvAt = 0, seekingSp = false, lastSec = -1, palUri = null, shownUri = null, muteFrom = null, endPoll = null;
  const likedIds = new Map();      // track id -> liked?
  const objs = new Map();          // uri -> adapted track (stable identity keeps list rows from re-rendering)
  const data = freshData();
  // each tab keeps its own stack of opened pages (artist, album, playlist, liked, all songs for a search)
  const nav = { queue: [], library: [], playlists: [] };
  const active = () => S.source === 'spotify';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const Spot = (window.Spot = {});

  function freshData() {
    return {
      liked: [], likedSet: new Set(), likedTotal: null, likedBusy: false, likedError: '',
      playlists: null, plBusy: false, plError: '',
      lists: new Map(),      // 'playlist:id' | 'album:id' -> { tracks, done, error, info }
      artists: new Map(),    // id -> { info, top, albums, done, error }
      queue: null, queueBusy: false, queueAt: 0,
      recs: null,            // Search tab when empty: { recent, top, error }
      searches: new Map(),   // query -> { tracks, artists, albums, playlists, trackTotal, nextOffset, busy, error }
    };
  }

  // ---------- data helpers ----------
  function pickImg(imgs, want) {
    if (!imgs || !imgs.length) return null;
    const sorted = [...imgs].sort((a, b) => (a.width || 0) - (b.width || 0));
    return (sorted.find((i) => (i.width || 0) >= want) || sorted[sorted.length - 1]).url || null;
  }
  // Cover vs video picture: when a song is switched to its music video, Spotify can hand over a wide
  // video frame as the song's "art". Square images are the cover (and the dock icon); wide ones are kept
  // apart for the Video view (the Audio / Video switch under the song). Never the other way round.
  // A picture's shape comes from its width/height; when Spotify leaves those out it is measured once (by URL).
  const wideUrls = new Set(), squareUrls = new Set(), measuring = new Set();
  const sized = (im) => !!(im && im.width && im.height);
  const isWide = (im) => !!im && (sized(im) ? im.width / im.height > 1.25 : wideUrls.has(im.url));
  const sure = (im) => sized(im) || squareUrls.has(im.url);          // known to be square
  const squareCovers = new Map();      // "title|artist" and "album:<id>" -> { cover, thumb }, square for certain
  let hintedUri = null;
  const artKey = (o) => `${o.title}|${o.artist}`.toLowerCase();
  function applyArt(o, imgs) {
    const list = imgs || [];
    if (list.length) o.artImgs = list;
    const square = list.filter((im) => !isWide(im)), wide = list.filter(isWide);
    if (square.length) {
      const sq = { cover: pickImg(square, 600), thumb: pickImg(square, 64) };
      Object.assign(o, sq);
      if (square.every(sure)) {
        squareCovers.set(artKey(o), sq);
        if (o.albumRef) squareCovers.set('album:' + o.albumRef.id, sq);
      }
    }
    if (wide.length) o.video = pickImg(wide, 1280);
  }
  // the square cover for a song, even when Spotify only sent its video frame this time
  const albumTried = new Set();
  function squareArt(t) {
    if (t.cover) return { cover: t.cover, thumb: t.thumb || t.cover };
    const known = squareCovers.get(artKey(t)) || (t.albumRef && squareCovers.get('album:' + t.albumRef.id));
    if (known) return known;
    if (t.albumRef && !albumTried.has(t.albumRef.id) && status.connected) {
      albumTried.add(t.albumRef.id);
      const id = t.albumRef.id;
      call('GET', '/albums/' + id).then((al) => {
        const square = ((al && al.images) || []).filter((im) => sized(im) && !isWide(im));
        if (square.length) { squareCovers.set('album:' + id, { cover: pickImg(square, 600), thumb: pickImg(square, 64) }); render(false); }
      }).catch(() => {});
    }
    return { cover: null, thumb: null };
  }
  // The album's own cover, fetched once per album: a playing song whose picture isn't one of these was switched
  // to its music video by Spotify (the frame can be square too), so that picture is the video picture and the
  // album cover stays the cover and the icon.
  const canon = new Map();             // album id -> { cover, thumb, urls } | null while loading
  function canonFor(t) {
    const id = t.albumRef && t.albumRef.id;
    if (!id || !status.connected) return null;
    if (canon.has(id)) return canon.get(id);
    canon.set(id, null);
    call('GET', '/albums/' + id).then((al) => {
      const imgs = ((al && al.images) || []).filter((im) => !isWide(im));
      if (!imgs.length) return;
      canon.set(id, { cover: pickImg(imgs, 600), thumb: pickImg(imgs, 64), urls: new Set(imgs.map((im) => im.url)) });
      render(false);
    }).catch(() => {});
    return null;
  }
  function useAlbumCover(t) {
    const c = canonFor(t);
    if (!c || !t.artImgs || !t.artImgs.length || t.artImgs.some((im) => c.urls.has(im.url))) return;
    t.video = t.video || pickImg(t.artImgs, 1280);
    t.cover = c.cover; t.thumb = c.thumb;
    const sq = { cover: c.cover, thumb: c.thumb };          // remember the real cover, not the frame
    squareCovers.set(artKey(t), sq);
    squareCovers.set('album:' + t.albumRef.id, sq);
  }
  // a cover that came without a size: measure it; if it's wide (a video frame) it moves to the Video view,
  // and the cover falls back to the last real cover of this song or its album
  function checkArt(t) {
    const src = t.cover, im0 = (t.artImgs || []).find((x) => x.url === src);
    if (!src || sized(im0) || wideUrls.has(src) || squareUrls.has(src) || measuring.has(src)) return;
    measuring.add(src);
    const im = new Image();
    im.onload = () => {
      measuring.delete(src);
      const wide = im.naturalWidth / im.naturalHeight > 1.25, into = wide ? wideUrls : squareUrls;
      // every unsized size of this picture has the same shape
      [src, ...(t.artImgs || []).filter((x) => !sized(x)).map((x) => x.url)].forEach((u) => into.add(u));
      if (wide) t.cover = t.thumb = null;
      applyArt(t, t.artImgs);
      render(false);
    };
    im.onerror = () => measuring.delete(src);
    im.src = src;
  }
  // Spotify track -> the same shape local tracks have, so the existing rows render it.
  // Album pages return "simplified" tracks without album info, so the album can be passed in.
  function T(tr, album) {
    if (!tr || !tr.uri) return null;
    let o = objs.get(tr.uri);
    const al = tr.album || album || null;
    const imgs = (al && al.images) || tr.images || [];
    if (o) { if (imgs.length) applyArt(o, imgs); return o; }
    o = {
      raw: tr.album || !album ? tr : { ...tr, album },
      sp: true, path: 'sp:' + tr.uri, uri: tr.uri, id: tr.id, name: tr.name || 'Unknown', title: tr.name || 'Unknown',
      artist: (tr.artists || []).map((a) => a.name).filter(Boolean).join(', ') || (tr.show && tr.show.name) || '',
      artistRef: tr.artists && tr.artists[0] && tr.artists[0].id ? { id: tr.artists[0].id, name: tr.artists[0].name } : null,
      artistRefs: (tr.artists || []).filter((a) => a && a.name).map((a) => ({ id: a.id || null, name: a.name })),
      album: (al && al.name) || '', albumRef: al && al.id ? { id: al.id, name: al.name, uri: al.uri, images: al.images } : null,
      duration: (tr.duration_ms || 0) / 1000, thumb: null, cover: null, video: null,
      metaState: 'done', playable: tr.is_playable !== false && !tr.is_local,
    };
    objs.set(tr.uri, o);
    applyArt(o, imgs);
    return o;
  }
  async function call(method, path, query, body) {
    const r = await sp.api(method, path, query || null, body || null);
    if (method !== 'GET') sp.log(`${method} ${path}${query && query.device_id ? ' device ' + query.device_id.slice(0, 8) : ''} -> ${r.ok ? 'ok' : r.status + ' ' + (r.reason || r.message)}`);
    else if (!r.ok && r.status !== 404) sp.log(`${method} ${path} -> ${r.status} ${r.reason || r.message}`);
    if (r.ok) return r.data;
    const e = new Error(r.message);
    e.status = r.status;
    e.reason = r.reason;
    throw e;
  }
  function explain(e) {
    if (e.reason === 'PREMIUM_REQUIRED' || (e.status === 403 && /premium/i.test(e.message))) return 'Controlling playback needs Spotify Premium';
    if (e.reason === 'NO_ACTIVE_DEVICE' || (e.status === 404 && /device/i.test(e.message))) return 'Open Spotify on any device first';
    if (e.reason === 'NOT_CONNECTED') return 'Connect Spotify first';
    if (e.status === 429) return 'Spotify is busy. Try again in a moment.';
    return e.message || 'Spotify request failed';
  }
  // Spotify has lowered page sizes for some apps over time; start generous and fall back on "invalid limit"
  const limits = { search: 20, page: 50 };
  async function paged(path, query, kind = 'page') {
    try { return await call('GET', path, { ...query, limit: Math.min(query.limit || limits[kind], limits[kind]) }); }
    catch (e) {
      if (e.status === 400 && /limit/i.test(e.message) && limits[kind] > 10) { limits[kind] = 10; return call('GET', path, { ...query, limit: 10 }); }
      throw e;
    }
  }
  let refreshT = 0;
  function refresh() {
    clearTimeout(refreshT);
    refreshT = setTimeout(() => { if (active()) { rebuild(false); paintHeader(); } }, 80);
  }

  // ---------- loading ----------
  async function loadLiked() {
    if (data.likedBusy || !status.connected || (data.likedTotal !== null && data.liked.length >= data.likedTotal) || data.likedError) return;
    data.likedBusy = true;
    try {
      while (status.connected && (data.likedTotal === null || data.liked.length < data.likedTotal)) {
        const j = await paged('/me/tracks', { offset: data.liked.length, limit: 50 });
        data.likedTotal = j.total;
        for (const it of j.items || []) {
          const t = T(it.track);
          if (t && !data.likedSet.has(t)) { data.liked.push(t); data.likedSet.add(t); likedIds.set(t.id, true); }
        }
        refresh();
        if (!j.next || !(j.items || []).length) break;
        await wait(100);
      }
    } catch (e) { data.likedError = explain(e); } finally { data.likedBusy = false; refresh(); }
  }
  async function loadPlaylists() {
    if (data.playlists || data.plBusy || !status.connected) return;
    data.plBusy = true;
    data.plError = '';
    const out = [];
    try {
      for (let off = 0; ; ) {
        const j = await paged('/me/playlists', { offset: off, limit: 50 });
        const got = (j.items || []).filter(Boolean);
        out.push(...got);
        data.playlists = out.slice();
        refresh();
        if (!j.next || !got.length) break;
        off += got.length;
      }
    } catch (e) { data.plError = explain(e); data.playlists = out; } finally { data.plBusy = false; refresh(); }
  }
  // playlist or album tracks, page by page, with retry-able errors
  async function loadList(kind, ref) {
    const key = kind + ':' + ref.id;
    if (data.lists.has(key)) return;
    const e = { tracks: [], done: false, error: '', info: ref };
    data.lists.set(key, e);
    try {
      if (kind === 'album') {
        const al = await call('GET', `/albums/${encodeURIComponent(ref.id)}`);
        e.info = { ...ref, name: al.name, uri: al.uri, images: al.images, artists: al.artists, year: (al.release_date || '').slice(0, 4), total: al.total_tracks };
        const albumRef = { id: al.id, name: al.name, uri: al.uri, images: al.images };
        let page = al.tracks;
        for (;;) {
          for (const tr of (page && page.items) || []) { const t = T(tr, albumRef); if (t) e.tracks.push(t); }
          refresh();
          if (!page || !page.next) break;
          page = await paged(`/albums/${encodeURIComponent(ref.id)}/tracks`, { offset: e.tracks.length, limit: 50 });
        }
      } else {
        // Spotify renamed playlist tracks to "items"; use whichever endpoint this account's API answers
        let path = `/playlists/${encodeURIComponent(ref.id)}/tracks`;
        for (let off = 0; ; ) {
          let j;
          try { j = await paged(path, { offset: off, limit: 50, additional_types: 'track' }); }
          catch (err) {
            if (off === 0 && path.endsWith('/tracks') && [403, 404, 410].includes(err.status)) { path = path.replace(/\/tracks$/, '/items'); continue; }
            throw err;
          }
          const got = j.items || [];
          for (const it of got) { const t = T(it && (it.track || it.item)); if (t) e.tracks.push(t); }
          checkLikes(e.tracks.map((t) => t.id));
          refresh();
          if (!j.next || !got.length) break;
          off += got.length;
          await wait(100);
        }
      }
    } catch (err) {
      e.error = kind === 'playlist' && (err.status === 404 || err.status === 403) ? 'Spotify doesn’t let apps open this playlist' : explain(err);
    }
    e.done = true;
    refresh();
  }
  async function loadArtist(ref) {
    if (data.artists.has(ref.id)) return;
    const e = { info: ref, top: [], albums: [], done: false, error: '' };
    data.artists.set(ref.id, e);
    const id = encodeURIComponent(ref.id);
    const [info, top, albums] = await Promise.allSettled([
      call('GET', `/artists/${id}`),
      call('GET', `/artists/${id}/top-tracks`, { market: 'from_token' }),
      paged(`/artists/${id}/albums`, { include_groups: 'album,single', limit: 20 }),
    ]);
    if (info.status === 'fulfilled') e.info = { ...ref, ...info.value };
    if (top.status === 'fulfilled') e.top = ((top.value && top.value.tracks) || []).map((x) => T(x)).filter(Boolean);
    else {
      // Spotify removed "top tracks" for apps on the 2026 API: their best-known songs come from search instead
      const name = (info.status === 'fulfilled' && info.value && info.value.name) || ref.name || '';
      if (name) {
        try {
          const j = await call('GET', '/search', { q: `artist:"${name.replace(/"/g, '')}"`, type: 'track', limit: 10 });
          e.top = ((j && j.tracks && j.tracks.items) || []).filter((x) => x && (x.artists || []).some((a) => a.id === ref.id)).map((x) => T(x)).filter(Boolean);
        } catch { /* no popular songs then */ }
      }
    }
    if (albums.status === 'fulfilled') e.albums = ((albums.value && albums.value.items) || []).filter(Boolean);
    if ([info, top, albums].every((r) => r.status === 'rejected')) e.error = explain(info.reason);
    checkLikes(e.top.map((t) => t.id));
    e.done = true;
    refresh();
  }
  // Search tab with nothing typed: what you played lately and your top songs
  async function loadRecs() {
    if (data.recs) return;
    data.recs = { recent: [], top: [], done: false, error: '' };
    const [rp, tp] = await Promise.allSettled([
      call('GET', '/me/player/recently-played', { limit: 30 }),
      call('GET', '/me/top/tracks', { limit: 20, time_range: 'short_term' }),
    ]);
    const seen = new Set();
    if (rp.status === 'fulfilled') data.recs.recent = ((rp.value && rp.value.items) || []).map((x) => T(x.track)).filter((t) => t && !seen.has(t.uri) && seen.add(t.uri)).slice(0, 8);
    if (tp.status === 'fulfilled') data.recs.top = ((tp.value && tp.value.items) || []).map((x) => T(x)).filter(Boolean).slice(0, 12);
    if (rp.status === 'rejected' && tp.status === 'rejected') data.recs.error = rp.reason && rp.reason.status === 403 ? 'Reconnect Spotify in Settings to see your recent and top songs.' : explain(rp.reason);
    data.recs.done = true;
    checkLikes([...data.recs.recent, ...data.recs.top].map((t) => t.id));
    refresh();
  }
  function recsPage() {
    loadRecs();
    const r = data.recs, out = [];
    if (!r.done) return [loading('Finding songs for you')];
    if (r.recent.length) { out.push(section('rec', 'Jump back in')); r.recent.forEach((t, i) => out.push(row(t, 'sprc', i, i + 1, r.recent))); }
    if (r.top.length) { out.push(section('top', 'Your top songs')); r.top.forEach((t, i) => out.push(row(t, 'sptp', i, i + 1, r.top))); }
    if (!out.length) out.push(r.error ? failed('Nothing to recommend yet', r.error, () => { data.recs = null; }) : emptyItem('Search Spotify', 'Type a song, artist or album above'));
    return out;
  }
  async function loadQueue() {
    if (data.queueBusy || !status.connected) return;
    data.queueBusy = true;
    try {
      const j = await call('GET', '/me/player/queue');
      data.queue = { now: T(j && j.currently_playing), next: ((j && j.queue) || []).map((x) => T(x)).filter(Boolean), error: '' };
      checkLikes([data.queue.now, ...data.queue.next].filter(Boolean).map((t) => t.id));
    } catch (e) { data.queue = { now: null, next: [], error: explain(e) }; } finally { data.queueAt = performance.now(); data.queueBusy = false; refresh(); }
  }
  // full catalog search: songs, artists, albums and playlists at once
  let searchT = 0;
  function kickSearch(q, force = false) {
    if (data.searches.has(q)) return;
    const e = { q, tracks: [], artists: [], albums: [], playlists: [], trackTotal: 0, nextOffset: 0, busy: true, error: '' };
    data.searches.set(q, e);
    if (data.searches.size > 30) data.searches.delete(data.searches.keys().next().value);
    clearTimeout(searchT);
    searchT = setTimeout(async () => {
      if (!force && S.filter !== q) { data.searches.delete(q); return; }
      try {
        const j = await paged('/search', { q, type: 'track,artist,album,playlist', limit: limits.search }, 'search');
        e.tracks = ((j.tracks && j.tracks.items) || []).map((x) => T(x)).filter(Boolean);
        e.trackTotal = (j.tracks && j.tracks.total) || e.tracks.length;
        e.nextOffset = e.tracks.length;
        e.artists = ((j.artists && j.artists.items) || []).filter(Boolean);
        e.albums = ((j.albums && j.albums.items) || []).filter(Boolean);
        e.playlists = ((j.playlists && j.playlists.items) || []).filter(Boolean);
        checkLikes(e.tracks.map((t) => t.id));
      } catch (err) { e.error = explain(err); }
      e.busy = false;
      refresh();
    }, 260);
  }
  async function moreSongs(q) {
    const e = data.searches.get(q);
    if (!e || e.busy || e.nextOffset >= Math.min(e.trackTotal, 1000)) return;
    e.busy = true;
    refresh();
    try {
      const j = await paged('/search', { q, type: 'track', offset: e.nextOffset, limit: limits.search }, 'search');
      const got = ((j.tracks && j.tracks.items) || []).map((x) => T(x)).filter(Boolean);
      for (const t of got) if (!e.tracks.includes(t)) e.tracks.push(t);
      e.nextOffset += got.length || limits.search;
      if (!got.length) e.trackTotal = e.tracks.length;
      checkLikes(got.map((t) => t.id));
    } catch (err) { toast(explain(err), true); }
    e.busy = false;
    refresh();
  }
  // Which of these tracks are in Liked Songs. Spotify's 2026 API checks, saves and removes through one
  // library endpoint that takes URIs (40 per request); apps on the old API still answer /me/tracks.
  // After a refusal it stops asking for this session instead of retrying on every song.
  let likeQ = new Set(), likeT = 0, likeApi = 'library';
  const trackUri = (id) => `spotify:track:${id}`;
  async function likesContain(batch) {
    if (likeApi === 'library') {
      try { return await call('GET', '/me/library/contains', { uris: batch.map(trackUri).join(',') }); }
      catch (e) { if (e.status !== 404 && e.status !== 405) throw e; likeApi = 'tracks'; }
    }
    return call('GET', '/me/tracks/contains', { ids: batch.join(',') });
  }
  function checkLikes(ids) {
    if (likeApi === 'off') return;
    for (const id of ids) if (id && !likedIds.has(id)) likeQ.add(id);
    if (!likeQ.size) return;
    clearTimeout(likeT);
    likeT = setTimeout(async () => {
      const batch = [...likeQ].slice(0, 40);
      batch.forEach((id) => likeQ.delete(id));
      try {
        const r = await likesContain(batch);
        batch.forEach((id, i) => likedIds.set(id, !!(r && r[i])));
        stateChanged();
        if (player && player.item && batch.includes(player.item.id)) paintHeart($('#btnFav'), !!likedIds.get(player.item.id), false);
      } catch (e) {
        if (e.status === 401 || e.status === 403) { likeApi = 'off'; likeQ.clear(); sp.log(`liked-songs check off: ${e.status} ${e.message}`); return; }
      }
      if (likeQ.size) checkLikes([]);
    }, 200);
  }
  function resetData() {
    Object.assign(data, freshData());
    likedIds.clear();
    for (const k in nav) nav[k] = [];
  }

  // ---------- navigation ----------
  const page = () => { const st = nav[S.view] || []; return st[st.length - 1] || null; };
  function open(p) { transitionView(1, () => nav[S.view].push(p)); }
  function back() { transitionView(-1, () => nav[S.view].pop()); }
  // tapping the tab you're already on goes back to its top
  document.querySelector('#seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b || !active() || b.dataset.view !== S.view || !nav[S.view].length) return;
    e.stopPropagation();
    transitionView(-1, () => { nav[S.view] = []; });
  }, true);

  // ---------- list items ----------
  const section = (key, label) => miscItem('sps:' + key, 36, `<div class="sp-section">${esc(label)}</div>`);
  const loading = (label) => miscItem('spl:' + label, 120, `<div class="sp-loading"><i></i><i></i><i></i><span>${esc(label)}</span></div>`);
  const failed = (title, msg, retry) => miscItem('spe:' + title, 160,
    `<div class="view-empty"><b>${esc(title)}</b><span>${esc(msg)}</span><button class="btn" data-sp-retry>Try again</button></div>`, { retry });
  const button = (key, label, act) => miscItem('spb:' + key, 52, `<div class="sp-more"><button class="btn" data-sp-more>${esc(label)}</button></div>`, { more: act });
  function row(t, ctx, i, n, col, context) {
    const it = rowItem(t, ctx, i, n, col);
    it.key += ':' + i;            // a song can appear twice in a playlist
    it.spContext = context || null;
    return it;
  }
  const fuzzy = (t) => !S.filter || GlassSearch.match(`${t.title} ${t.artist} ${t.album}`, S.filter) > 0;
  const year = (s) => (s || '').slice(0, 4);
  function albumCard(a) {
    const img = pickImg(a.images, 160);
    return { key: 'al' + a.id, name: a.name, sub: [((a.artists || [])[0] || {}).name, year(a.release_date)].filter(Boolean).join(' · '), art: artStyle(img, a.name), icon: img ? '' : ICON.note, act: () => open({ type: 'album', id: a.id, name: a.name, uri: a.uri, images: a.images }) };
  }
  function artistCard(a) {
    const img = pickImg(a.images, 160);
    return { key: 'ar' + a.id, cls: 'round', name: a.name, sub: 'Artist', art: artStyle(img, a.name), icon: img ? '' : ICON.person, act: () => open({ type: 'artist', id: a.id, name: a.name, uri: a.uri, images: a.images }) };
  }
  function playlistCard(p) {
    const img = pickImg(p.images, 160), total = (p.tracks && p.tracks.total) ?? (p.items && p.items.total) ?? null;
    return {
      key: 'pl' + p.id, name: p.name, sub: [total != null ? plural(total, 'song') : 'Playlist', p.owner && p.owner.display_name].filter(Boolean).join(' · '),
      art: artStyle(img, p.name + p.id), icon: img ? '' : ICON.list, act: () => open({ type: 'playlist', id: p.id, name: p.name, uri: p.uri, images: p.images, owner: p.owner }),
    };
  }
  function likedPage() {
    loadLiked();
    const out = [];
    if (nav[S.view].length) out.push(backItem('Back', back));
    const n = data.likedTotal;
    const h = heroItem('liked', { art: LIKED_ART, icon: ICON.heart, cls: 'liked', title: 'Liked Songs', sub: n == null ? 'Spotify' : plural(n, 'song') });
    h.col = data.liked;
    out.push(h);
    const rows = data.liked.filter(fuzzy);
    rows.forEach((t, i) => out.push(row(t, 'spl', i, i + 1, data.liked)));
    if (data.likedError && !data.liked.length) out.push(failed('Couldn’t load your liked songs', data.likedError, () => { data.likedError = ''; loadLiked(); }));
    else if (!data.liked.length) out.push(data.likedBusy || n == null ? loading('Loading your liked songs') : miscItem('spl:none', 150, '<div class="view-empty"><b>No liked songs yet</b><span>Tap the heart on any song</span></div>'));
    else if (!rows.length) out.push(emptyItem('No matches', 'Try a different search'));
    return out;
  }
  function listPage(p) {
    const kind = p.type;
    loadList(kind, p);
    const e = data.lists.get(kind + ':' + p.id);
    const info = e.info || p;
    const img = pickImg(info.images, 300);
    const sub = kind === 'album'
      ? [((info.artists || [])[0] || {}).name, info.year, plural(e.tracks.length || info.total || 0, 'song')].filter(Boolean).join(' · ')
      : [plural(e.tracks.length || 0, 'song'), info.owner && info.owner.display_name].filter(Boolean).join(' · ');
    const out = [backItem('Back', back)];
    const h = heroItem(`sp:${kind}:${p.id}`, { art: artStyle(img, info.name + p.id), icon: img ? '' : kind === 'album' ? ICON.note : ICON.list, title: info.name || p.name, sub });
    h.col = e.tracks;
    h.spContext = info.uri || p.uri;
    out.push(h);
    const rows = e.tracks.filter(fuzzy);
    rows.forEach((t, i) => out.push(row(t, kind === 'album' ? 'spa' : 'spp', i, i + 1, e.tracks, h.spContext)));
    if (e.error) out.push(failed(kind === 'album' ? 'Can’t show this album' : 'Can’t show this playlist', e.error, () => { data.lists.delete(kind + ':' + p.id); }));
    else if (!e.tracks.length) out.push(e.done ? emptyItem('Nothing here', '') : loading('Loading songs'));
    else if (!rows.length) out.push(emptyItem('No matches', 'Try a different search'));
    return out;
  }
  function artistPage(p) {
    loadArtist(p);
    const e = data.artists.get(p.id);
    const info = e.info || p;
    const img = pickImg(info.images, 300);
    const out = [backItem('Back', back)];
    const name = info.name || p.name;
    const followers = info.followers && info.followers.total;
    // Spotify gives followers, popularity and genres; the bio comes from Wikipedia (Spotify's API has no bios or play counts)
    out.push(artistHeroItem({
      key: 'sp:' + p.id, name, img, info: artistInfo(name), col: e.top, spContext: info.uri || p.uri, genres: info.genres || [],
      facts: [followers != null ? plural(followers, 'follower') : '', info.popularity != null ? `Popularity ${info.popularity}/100` : '',
        e.albums.length ? plural(e.albums.length, 'release') : ''],
    }));
    if (!e.done) { out.push(loading('Loading artist')); return out; }
    if (e.error) { out.push(failed('Can’t show this artist', e.error, () => data.artists.delete(p.id))); return out; }
    if (e.top.length) { out.push(section('pop', 'Popular')); e.top.forEach((t, i) => out.push(row(t, 'spt', i, i + 1, e.top))); }
    if (e.albums.length) { out.push(section('alb', 'Albums and singles')); out.push(...tileItems(e.albums.map(albumCard), 'spar' + p.id)); }
    return out;
  }
  function songsPage(p) {
    const e = data.searches.get(p.q);
    if (!e) { kickSearchNow(p.q); return [backItem('Back', back), loading('Searching Spotify')]; }
    const out = [backItem('Back', back), section('songs', `Songs for “${p.q}”`)];
    e.tracks.forEach((t, i) => out.push(row(t, 'sps', i, i + 1, e.tracks)));
    if (e.nextOffset < Math.min(e.trackTotal, 1000)) out.push(e.busy ? loading('Loading more') : button('more:' + p.q + e.nextOffset, 'Load more songs', () => moreSongs(p.q)));
    return out;
  }
  const kickSearchNow = (q) => kickSearch(q, true);
  function searchPage(q) {
    kickSearch(q);
    const e = data.searches.get(q);
    if (e.busy && !e.tracks.length) return [loading('Searching Spotify')];
    if (e.error) return [failed('Search failed', e.error, () => data.searches.delete(q))];
    const out = [];
    if (!e.tracks.length && !e.artists.length && !e.albums.length && !e.playlists.length) return [emptyItem('No results on Spotify', 'Try a different spelling')];
    // the best artist match goes first when the query names an artist
    const topArtist = e.artists.find((a) => GlassSearch.match(a.name, q) > 0);
    if (topArtist && (!e.tracks[0] || GlassSearch.match(topArtist.name, q) >= GlassSearch.match(e.tracks[0].title, q))) {
      out.push(section('top', 'Top result'), ...tileItems([artistCard(topArtist)], 'sptop'));
    }
    if (e.tracks.length) {
      out.push(section('songs', 'Songs'));
      e.tracks.slice(0, 6).forEach((t, i) => out.push(row(t, 'sps', i, i + 1, e.tracks)));
      if (e.trackTotal > 6) out.push(button('all:' + q, `See all songs`, () => open({ type: 'songs', q })));
    }
    if (e.artists.length) out.push(section('artists', 'Artists'), ...tileItems(e.artists.map(artistCard), 'spsa'));
    if (e.albums.length) out.push(section('albums', 'Albums'), ...tileItems(e.albums.map(albumCard), 'spsb'));
    if (e.playlists.length) out.push(section('pls', 'Playlists'), ...tileItems(e.playlists.map(playlistCard), 'spsp'));
    return out;
  }
  function pageItems(p) {
    if (p.type === 'liked') return likedPage();
    if (p.type === 'artist') return artistPage(p);
    if (p.type === 'songs') return songsPage(p);
    return listPage(p);
  }
  Spot.items = () => {
    if (!status.connected) return [emptyItem('Spotify isn’t connected', 'Open Settings (top left) or follow the steps in the middle')];
    const p = page();
    if (p) return pageItems(p);
    if (S.view === 'queue') {
      if (!data.queue) { loadQueue(); return [loading('Loading your Spotify queue')]; }
      const q = data.queue, out = [];
      if (q.error) return [failed('Couldn’t load the queue', q.error, () => { data.queue = null; })];
      if (q.now && fuzzy(q.now)) out.push(section('now', 'Now playing'), row(q.now, 'spq', 0, 1, [q.now]));
      const next = q.next.filter(fuzzy);
      if (next.length) {
        out.push(section('next', 'Next up'));
        q.next.forEach((t, i) => { if (fuzzy(t)) { const it = row(t, 'spq', i + 1, i + 1, q.next); it.skip = i + 1; out.push(it); } });
      }
      if (!out.length) out.push(emptyItem(S.filter ? 'No matches' : 'Nothing queued', S.filter ? 'Try a different search' : 'Play something from your Spotify library'));
      return out;
    }
    // Search tab: results while typing, recommendations when empty
    if (S.view === 'library') return S.filter ? searchPage(S.filter) : recsPage();
    // playlists tab
    loadPlaylists();
    const cards = [{
      key: 'liked', cls: 'fav', name: 'Liked Songs', sub: data.likedTotal == null ? 'Your saved songs' : plural(data.likedTotal, 'song'),
      art: LIKED_ART, icon: ICON.heart, act: () => open({ type: 'liked' }),
    }];
    for (const p2 of data.playlists || []) if (!S.filter || GlassSearch.match(p2.name, S.filter) > 0) cards.push(playlistCard(p2));
    const out = tileItems(cards, 'spg');
    if (data.plError && !(data.playlists || []).length) out.push(failed('Couldn’t load your playlists', data.plError, () => { data.playlists = null; }));
    else if (!data.playlists || data.plBusy) out.push(loading('Loading your playlists'));
    return out;
  };
  Spot.header = () => {
    if (!status.connected) return { title: 'Spotify', sub: 'Not connected' };
    const p = page();
    if (p) {
      const kind = { liked: 'Playlist', playlist: 'Playlist', album: 'Album', artist: 'Artist', songs: 'Search' }[p.type];
      return { title: kind, sub: p.type === 'liked' ? 'Liked Songs' : p.type === 'songs' ? `All songs for “${p.q}”` : p.name || '' };
    }
    if (S.view === 'queue') return { title: 'Queue', sub: player && player.device ? `Playing on ${player.device.name}` : 'Spotify' };
    if (S.view === 'library') return S.filter ? { title: 'Search', sub: 'All of Spotify' } : { title: 'Search', sub: 'Recommended for you' };
    return { title: 'Library', sub: data.playlists ? plural(data.playlists.length + 1, 'playlist') : 'Spotify' };
  };
  Spot.isCurrent = (t) => !!(player && player.item && player.item.uri === t.uri);
  Spot.isLiked = (t) => !!likedIds.get(t.id);

  // ---------- playback control (Spotify Connect) ----------
  const progress = () => (!player || !player.item ? 0
    : Math.min(player.item.duration_ms, (player.progress_ms || 0) + (player.is_playing ? performance.now() - recvAt : 0)));
  async function devices() {
    try { return ((await call('GET', '/me/player/devices')).devices || []).filter((d) => !d.is_restricted); } catch { return []; }
  }
  async function findDevice() {
    const ds = await devices();
    // something already playing keeps playing there; otherwise Glass itself (in-app player), then any computer
    const glass = window.SpotPlayer?.deviceId();
    return ds.find((d) => d.is_active) || (glass && (ds.find((d) => d.id === glass) || { id: glass, name: 'Glass Player' })) || ds.find((d) => d.type === 'Computer') || ds[0] || null;
  }
  async function play(body, deviceId) {
    if (!deck.paused) deck.pause();
    window.SpotPlayer?.activate();
    try { await call('PUT', '/me/player/play', deviceId ? { device_id: deviceId } : null, body); }
    catch (e) {
      if (!deviceId && (e.status === 404 || e.reason === 'NO_ACTIVE_DEVICE')) {
        const d = await findDevice();
        if (d) return play(body, d.id);
      }
      toast(explain(e), true);
      return;
    }
    if (player) { player.is_playing = true; recvAt = performance.now(); }
    data.queue = null;
    soon(300);
  }
  async function cmd(method, path, query, after = 300) {
    try { await call(method, path, query); } catch (e) { toast(explain(e), true); }
    soon(after);
  }
  // The song you pick shows at once (cover, title, colours glide in); the music follows when Spotify starts it.
  // For a few seconds Spotify may still report the old song: those reports don't pull the screen back.
  let expect = null;
  function showPending(t) {
    if (!t || !t.raw || Spot.isCurrent(t)) return;
    expect = { uri: t.uri, until: Date.now() + 6000 };
    player = { ...(player || {}), item: t.raw, progress_ms: 0, is_playing: true };
    recvAt = performance.now();
    lastSec = -1;
    render(true);
  }
  function playRow(it) {
    const t = it.track;
    if (!t.playable) { toast('Spotify can’t play this one here', true); return; }
    if (Spot.isCurrent(t)) { togglePlaySp(); return; }
    showPending(t);
    if (it.skip) { skipTo(it.skip, t); return; }
    if (it.spContext) return play({ context_uri: it.spContext, offset: { uri: t.uri } });
    const col = it.col || [t], i = Math.max(0, col.indexOf(t));
    return play({ uris: col.slice(i, i + 100).map((x) => x.uri) });
  }
  // Spotify can't jump inside the queue, so skip forward to the chosen song
  let skipping = false;
  async function skipTo(k, t) {
    if (skipping) return;
    skipping = true;
    toast(`Skipping to “${t.title}”`);
    try {
      for (let i = 0; i < k; i++) { await call('POST', '/me/player/next'); await wait(140); }
    } catch (e) { toast(explain(e), true); }
    skipping = false;
    data.queue = null;
    soon(250);
  }
  async function playList(col, shuffle, context) {
    if ((!col || !col.length) && !context) { toast('Nothing to play yet'); return; }
    if (shuffle) await setShuffle(true);
    if (context) return play(shuffle || /:artist:/.test(context) ? { context_uri: context } : { context_uri: context, offset: { position: 0 } });
    const start = shuffle ? Math.floor(Math.random() * col.length) : 0;
    showPending(col[start]);
    return play({ uris: col.slice(start, start + 100).map((t) => t.uri) });
  }
  function togglePlaySp() {
    window.SpotPlayer?.activate();
    if (!player || !player.item) { toast('Pick a song from your Spotify library'); return; }
    const was = player.is_playing;
    player.progress_ms = progress();
    recvAt = performance.now();
    player.is_playing = !was;
    render(false);
    if (!was && !deck.paused) deck.pause();
    cmd('PUT', was ? '/me/player/pause' : '/me/player/play');
  }
  function seekTo(ms) {
    if (!player || !player.item) return;
    player.progress_ms = Math.max(0, Math.min(player.item.duration_ms, ms));
    recvAt = performance.now();
    cmd('PUT', '/me/player/seek', { position_ms: Math.round(player.progress_ms) }, 700);
  }
  async function setShuffle(on) {
    if (player) player.shuffle_state = on;
    paintModes();
    try { await call('PUT', '/me/player/shuffle', { state: on }); } catch (e) { toast(explain(e), true); }
    data.queue = null;
    soon(600);
  }
  function cycleRepeat() {
    const next = { off: 'context', context: 'track', track: 'off' }[(player && player.repeat_state) || 'off'];
    if (player) player.repeat_state = next;
    paintModes();
    cmd('PUT', '/me/player/repeat', { state: next }, 600);
  }
  let volT = 0;
  function setVolume(v) {
    v = Math.max(0, Math.min(100, Math.round(v)));
    if (player && player.device) {
      if (player.device.supports_volume === false) { toast('This Spotify device doesn’t allow volume changes', true); return; }
      player.device.volume_percent = v;
    }
    vol.value = v;
    setFill(vol);
    body.classList.toggle('muted', v === 0);
    clearTimeout(volT);
    volT = setTimeout(() => cmd('PUT', '/me/player/volume', { volume_percent: v }, 900), 180);
  }
  function toggleMute() {
    if (+vol.value > 0) { muteFrom = +vol.value; setVolume(0); } else setVolume(muteFrom || 50);
  }
  async function toggleLike(t, btn) {
    if (!t || !t.id) return;
    const on = !likedIds.get(t.id);
    likedIds.set(t.id, on);
    if (btn) paintHeart(btn, on);
    if (player && player.item && player.item.id === t.id) paintHeart($('#btnFav'), on, btn !== $('#btnFav'));
    stateChanged();
    try {
      if (likeApi === 'tracks') await call(on ? 'PUT' : 'DELETE', '/me/tracks', { ids: t.id });
      else {
        try { await call(on ? 'PUT' : 'DELETE', '/me/library', null, { uris: [t.uri || trackUri(t.id)] }); }
        catch (e) { if (e.status !== 404 && e.status !== 405) throw e; likeApi = 'tracks'; await call(on ? 'PUT' : 'DELETE', '/me/tracks', { ids: t.id }); }
      }
      if (on && !data.likedSet.has(t)) { data.liked.unshift(t); data.likedSet.add(t); if (data.likedTotal != null) data.likedTotal++; }
      if (!on && data.likedSet.has(t)) { data.liked.splice(data.liked.indexOf(t), 1); data.likedSet.delete(t); if (data.likedTotal != null) data.likedTotal--; }
      refresh();
      toast(on ? 'Added to Liked Songs' : 'Removed from Liked Songs');
    } catch (e) {
      likedIds.set(t.id, !on);
      stateChanged();
      if (btn) paintHeart(btn, !on, false);
      toast(explain(e), true);
    }
  }
  // media keys and Windows' media controls, while Spotify is the source
  Spot.media = (a, v) => {
    if (!status.connected) return;
    sp.log(`media key: ${a}`);
    if (a === 'toggle') togglePlaySp();
    else if (a === 'pause') { if (player && player.is_playing) togglePlaySp(); }
    else if (a === 'next') { data.queue = null; cmd('POST', '/me/player/next', null, 250); }
    else if (a === 'prev') { data.queue = null; cmd('POST', '/me/player/previous', null, 250); }
    else if (a === 'seek') seekTo(v * 1000);
  };
  Spot.pauseIfPlaying = () => {
    if (!status.connected || !player || !player.is_playing) return;
    player.progress_ms = progress();
    recvAt = performance.now();
    player.is_playing = false;
    call('PUT', '/me/player/pause').catch(() => {});
    render(false);
  };

  // ---------- now playing (stage + dock) ----------
  function paintModes() {
    $('#btnShuffle').classList.toggle('on', !!(player && player.shuffle_state));
    const r = (player && player.repeat_state) || 'off';
    $('#btnRepeat').classList.toggle('on', r !== 'off');
    $('#btnRepeat').classList.toggle('one', r === 'track');
  }
  function render(animate) {
    if (!active()) return;
    body.classList.toggle('sp-unlinked', !status.connected);
    if (!status.connected) {
      body.classList.remove('playing', 'has-track', 'is-video', 'has-vart');
      setArtMode(false, false);
      $('#dockTitle').textContent = 'Spotify';
      setHTML($('#dockSub'), 'Not connected');
      $('#nowTitle').title = $('#dockTitle').title = '';
      $('#dockThumb').style.backgroundImage = '';
      $('#dockThumb').classList.add('placeholder');
      $('#tCur').textContent = $('#tDur').textContent = '0:00';
      seek.value = 0;
      setFill(seek);
      return;
    }
    body.classList.add('has-track');
    body.classList.remove('is-video');
    const t = player && player.item ? T(player.item) : null;
    body.classList.toggle('playing', !!(player && player.is_playing));
    const title = t ? t.title : 'Nothing playing on Spotify';
    const sub = t ? (t.album ? `${t.artist} — ${t.album}` : t.artist)
      : player && player.device ? `Ready on ${player.device.name}` : 'Pick a song from your Spotify library';
    $('#nowTitle').textContent = title;
    if (t && typeof nowSubHTML === 'function') { const parts = spParts(t); setHTML($('#nowSub'), nowSubHTML(parts, t.album)); setHTML($('#dockSub'), nowSubHTML(parts, t.album)); }
    else { setHTML($('#nowSub'), esc(sub)); setHTML($('#dockSub'), esc(t ? t.artist : 'Spotify')); }
    $('#nowQ').textContent = '';
    $('#dockTitle').textContent = title;
    $('#nowTitle').title = $('#dockTitle').title = t ? `Playing from ${contextLabel()}` : '';
    document.title = t ? `${title} — Glass Player` : 'Glass Player';
    const artImg = $('#artImg'), thumb = $('#dockThumb');
    if (t) { checkArt(t); useAlbumCover(t); }
    // the big frame shows the cover, or the video picture in 16:9 when Video is picked; the dock icon is always the cover
    const sq = t ? squareArt(t) : { cover: null, thumb: null };
    const vid = t ? t.video : null, showVid = !!(vid && S.ui.spVideo);
    body.classList.toggle('has-vart', !!vid);
    setArtMode(showVid, !animate);
    // first time this song shows up with a video picture: a little widening hint (after the song-change animation)
    if (vid && !showVid && t.uri !== hintedUri) { hintedUri = t.uri; setTimeout(hintWide, animate ? 950 : 60); }
    const big = showVid ? vid : sq.cover || sq.thumb;
    artImg.style.backgroundImage = big ? cssUrl(big) : '';
    artImg.classList.toggle('placeholder', !big);
    thumb.style.backgroundImage = sq.thumb ? cssUrl(sq.thumb) : '';
    thumb.classList.toggle('placeholder', !sq.thumb);
    window.Liquid?.art(big || '');
    const uri = t ? t.uri : null, palSrc = sq.thumb || sq.cover || '';
    if (uri + '|' + palSrc !== palUri) { palUri = uri + '|' + palSrc; palSrc ? paletteFromImage(palSrc, title) : paletteFromSeed(title); }
    paintHeart($('#btnFav'), !!(t && likedIds.get(t.id)), false);
    paintModes();
    $('#tDur').textContent = fmt(t ? t.duration : 0);
    if (player && player.device && player.device.volume_percent != null && document.activeElement !== vol) {
      vol.value = player.device.volume_percent;
      setFill(vol);
      body.classList.toggle('muted', +vol.value === 0);
    }
    if (animate && uri !== shownUri) {
      anim($('#artWrap'), [{ transform: 'scale(.86)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 900 });
      anim($('#nowMeta'), [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: 80, fill: 'backwards' });
      anim($('#dockText'), [{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 600 });
      anim(thumb, [{ transform: 'scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 700 });
    }
    shownUri = uri;
    window.Lyrics?.track(t);
    stateChanged();
  }
  Spot.tick = () => {
    if (!player || !player.item) return;
    const ms = progress(), d = player.item.duration_ms;
    if (!seekingSp && d) {
      seek.value = (ms / d) * 1000;
      setFill(seek);
      const sec = Math.floor(ms / 1000);
      if (sec !== lastSec) { lastSec = sec; $('#tCur').textContent = fmt(sec); }
    }
    // the song just ended on the device: ask Spotify what's next right away instead of waiting for the next poll
    if (player.is_playing && d - ms < 250 && endPoll !== player.item.uri) { endPoll = player.item.uri; soon(500); }
  };

  // ---------- polling ----------
  let pollT = 0, pollBusy = false;
  function schedule(ms) { clearTimeout(pollT); pollT = setTimeout(poll, ms); }
  function soon(ms = 350) { schedule(ms); }
  async function poll() {
    if (!status.connected) return;
    if (pollBusy) { schedule(400); return; }
    pollBusy = true;
    try { setPlayer(await call('GET', '/me/player', { additional_types: 'track' })); }
    catch (e) {
      if (e.reason === 'NOT_CONNECTED') { await loadStatus(); render(false); refresh(); }
    } finally { pollBusy = false; }
    // the queue changes when songs are added from other devices: keep it fresh while it's on screen
    if (active() && S.view === 'queue' && !page() && performance.now() - data.queueAt > 5000) loadQueue();
    schedule(active() && !document.hidden ? 1500 : 8000);
  }
  function setPlayer(j) {
    const prev = player && player.item ? player.item.uri : null;
    const was = player;
    // a song was just picked: until Spotify reports it (or a few seconds pass), keep showing it
    if (expect) {
      if (j && j.item && j.item.uri === expect.uri) expect = null;
      else if (Date.now() < expect.until && was && was.item) j = { ...(j || {}), item: was.item, progress_ms: 0, is_playing: true };
      else expect = null;
    }
    player = j || null;
    // what changed on Spotify's side (track, play/pause, device), for spotify-log.txt
    if (player) {
      const p = player, w = was || {};
      if ((p.item && p.item.uri) !== (w.item && w.item.uri)) sp.log(`now: ${p.item ? p.item.name + ' (' + p.item.uri + ') at ' + Math.round((p.progress_ms || 0) / 1000) + 's' : 'nothing'} on ${p.device ? p.device.name : '?'}`);
      else if (!!p.is_playing !== !!w.is_playing) sp.log(`${p.is_playing ? 'playing' : 'paused'} at ${Math.round((p.progress_ms || 0) / 1000)}s on ${p.device ? p.device.name : '?'}`);
      else if ((p.device && p.device.id) !== (w.device && w.device.id)) sp.log(`device: ${p.device ? p.device.name : 'none'}`);
    }
    recvAt = performance.now();
    const uri = player && player.item ? player.item.uri : null;
    if (uri !== prev) {
      if (player && player.item && player.item.id) checkLikes([player.item.id]);
      if (active() && S.view === 'queue') loadQueue();
    }
    render(uri !== prev);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && status.connected) soon(150); });
  window.addEventListener('focus', () => { if (status.connected && active()) soon(150); });

  // ---------- status, setup, account ----------
  async function loadStatus() {
    try { status = await sp.status(); } catch { status = { connected: false }; }
    body.classList.toggle('sp-on', !!status.connected);
    if (status.redirect) $('#spRedirect').textContent = status.redirect;
    if (status.clientId && !$('#spClient').value) $('#spClient').value = status.clientId === 'mock' ? '' : status.clientId;
    return status;
  }
  const statusP = loadStatus();
  // in-app playback: start Glass's own Spotify device once signed in
  statusP.then((s) => { if (s.connected) window.SpotPlayer?.start(); });
  Spot.status = () => status;
  Spot.devices = devices;
  Spot.transfer = (d) => transfer(d);
  Spot.player = () => player;
  Spot.refreshNow = () => { if (status.connected) soon(150); };
  // for the lyrics panel
  Spot.nowTrack = () => (player && player.item ? T(player.item) : null);
  Spot.position = () => progress() / 1000;
  Spot.isPlaying = () => !!(player && player.is_playing);
  Spot.seek = (ms) => seekTo(ms);
  // the links under the song that's playing and in the dock: each artist, the album, and the title (where it plays from)
  function spParts(t) {
    const refs = t.artistRefs && t.artistRefs.length ? t.artistRefs : t.artist ? [{ id: null, name: t.artist }] : [];
    return refs.map((a, i) => ({ name: a.name, sep: i < refs.length - 1 ? ', ' : '', plain: !a.id }));
  }
  // what Spotify says it's playing from: a playlist, album, artist or Liked Songs (nothing = songs picked one by one)
  function contextPage() {
    const c = player && player.context, uri = (c && c.uri) || '';
    if (!uri) return null;
    if (/:collection$/.test(uri) || (c && c.type === 'collection')) return { type: 'liked' };
    const [, type, id] = uri.split(':');
    if (!id) return null;
    if (type === 'playlist') { const pl = (data.playlists || []).find((x) => x.id === id); return { type: 'playlist', id, uri, name: pl ? pl.name : 'Playlist', images: pl && pl.images, owner: pl && pl.owner }; }
    if (type === 'album') { const t = Spot.nowTrack(); return t && t.albumRef && t.albumRef.id === id ? { type: 'album', ...t.albumRef } : { type: 'album', id, uri, name: 'Album' }; }
    if (type === 'artist') { const t = Spot.nowTrack(), a = t && (t.artistRefs || []).find((x) => x.id === id); return { type: 'artist', id, name: a ? a.name : 'Artist' }; }
    return null;
  }
  function contextLabel() {
    const p = contextPage();
    if (!p) return 'your queue';
    if (p.type === 'liked') return 'Liked Songs';
    return p.name && !['Playlist', 'Album', 'Artist'].includes(p.name) ? p.name : 'this ' + p.type;
  }
  // Audio / Video under the song: cover, or the music video's picture in 16:9 (remembered)
  document.querySelector('#avSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-av]');
    if (!b || !active()) return;
    const on = b.dataset.av === 'video';
    if (!!S.ui.spVideo === on) return;
    S.ui.spVideo = on;
    save();
    render(false);
  });
  Spot.fromTip = () => (player && player.item ? `Playing from ${contextLabel()}` : '');
  Spot.goNow = (kind, i = 0) => {
    const t = Spot.nowTrack();
    if (!t) return;
    if (kind === 'artist') { const a = (t.artistRefs || [])[i] || t.artistRef; if (a && a.id) open({ type: 'artist', id: a.id, name: a.name }); }
    if (kind === 'album' && t.albumRef) open({ type: 'album', ...t.albumRef });
    if (kind === 'from') {
      const p = contextPage();
      if (p) navTo(p.type === 'artist' || p.type === 'album' ? 'library' : 'playlists', () => { nav[S.view] = [p]; });
      else navTo('queue', () => { nav.queue = []; });
    }
  };
  let setupOffered = false;
  Spot.activate = async () => {
    $('#search').placeholder = 'Search Spotify';
    await statusP;
    render(true);
    if (status.connected) soon(50);
    refresh();
    // playing inside Glass isn't set up yet: open the setup by itself, once per launch
    if (status.connected && !setupOffered && window.SpSetup) {
      setupOffered = true;
      setTimeout(async () => { if (S.source === 'spotify' && !modalClose && await SpSetup.needed()) SpSetup.open(); }, 1200);
    }
  };
  Spot.deactivate = () => {
    $('#search').placeholder = 'Search songs, artists, albums';
    body.classList.remove('sp-unlinked', 'sp-waiting');
    shownUri = null;
    palUri = null;
    if (status.connected) schedule(8000);
  };
  async function connectWith(id) {
    try {
      await sp.setClient(id);
      body.classList.add('sp-waiting');
      $('#spConnect').disabled = true;
      await sp.connect();
      await loadStatus();
      resetData();
      toast(status.user ? `Connected as ${status.user.name}` : 'Spotify connected');
      window.SpotPlayer?.stop();
      window.SpotPlayer?.start();
      render(true);
      soon(50);
      refresh();
      return true;
    } catch (e) { toast(cleanErr(e), true); return false; } finally {
      body.classList.remove('sp-waiting');
      $('#spConnect').disabled = false;
    }
  }
  Spot.connect = connectWith;
  $('#spSetup').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    if (b.dataset.sp === 'dashboard') api.openExternal('https://developer.spotify.com/dashboard').catch(() => {});
    else if (b.dataset.sp === 'copy') {
      try { await navigator.clipboard.writeText($('#spRedirect').textContent); toast('Redirect URI copied'); } catch { toast('Couldn’t copy. Select it and press Ctrl+C.', true); }
    } else if (b.dataset.sp === 'connect') connectWith($('#spClient').value.trim());
  });
  $('#spClient').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connectWith($('#spClient').value.trim()); } });
  async function transfer(d) {
    try { await call('PUT', '/me/player', null, { device_ids: [d.id], play: !!(player && player.is_playing) }); toast(`Playing on ${d.name}`); }
    catch (e) { toast(explain(e), true); }
    soon(700);
  }
  $('#btnSpAccount').addEventListener('click', async (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ds = status.connected ? await devices() : [];
    const who = status.user ? `${status.user.name}${status.user.product ? ' · ' + (status.user.product === 'premium' ? 'Premium' : 'Free') : ''}` : 'Spotify';
    openMenu(rect, () => [
      { header: who },
      ...(ds.length
        ? [{ header: 'Play on' }, ...ds.map((d) => ({ label: d.name, checked: !!d.is_active, act: () => transfer(d) }))]
        : [{ label: status.connected ? 'No devices. Open Spotify somewhere.' : 'Not connected', act: () => {} }]),
      '-',
      { label: 'Reload from Spotify', icon: ICON.queue, act: Spot.reload },
      { label: 'Settings', icon: ICON.edit, act: () => window.Settings && Settings.open() },
      ...(status.connected ? [{ label: 'Disconnect Spotify', icon: ICON.x, danger: true, act: disconnect }] : []),
    ]);
  });
  Spot.reload = () => { resetData(); refresh(); soon(50); toast('Reloading from Spotify'); };
  // the library keeps itself fresh: quietly reloaded when you come back after 10 minutes, and every 30
  let lastLoad = Date.now();
  const autoReload = () => {
    if (!status.connected || Date.now() - lastLoad < 10 * 60000) return;
    lastLoad = Date.now();
    resetData(); refresh(); soon(50);
    sp.log('library reloaded by itself');
  };
  window.addEventListener('focus', autoReload);
  setInterval(() => { if (Date.now() - lastLoad >= 30 * 60000) autoReload(); }, 5 * 60000);
  async function disconnect() {
    window.SpotPlayer?.stop();
    try { await sp.disconnect(); } catch { /* fall through to local reset */ }
    await loadStatus();
    resetData();
    player = null;
    shownUri = null;
    render(false);
    refresh();
    toast('Spotify disconnected');
  }
  Spot.disconnect = disconnect;

  // ---------- list clicks (capture: Spotify rows never reach the local handlers) ----------
  vspace.addEventListener('click', (e) => {
    if (!active()) return;
    const node = e.target.closest('.vi');
    if (!node) return;
    const it = items[node._vi];
    if (!it) return;
    e.stopPropagation();
    const q = (s) => e.target.closest(s);
    let el;
    if (q('[data-back]')) { it.back(); return; }
    if (q('[data-sp-retry]')) { it.retry && it.retry(); refresh(); return; }
    if (q('[data-sp-more]')) { it.more && it.more(); return; }
    if (it.kind === 'tiles') { if ((el = q('[data-ci]'))) it.cards[+el.dataset.ci].act(); return; }
    if (it.kind === 'row') {
      if ((el = q('[data-heart]'))) { toggleLike(it.track, el); return; }
      if ((el = q('[data-dots]'))) { trackMenu(node, it, el.getBoundingClientRect()); return; }
      playRow(it);
      return;
    }
    if (q('[data-hero-play]')) playList(it.col, false, it.spContext);
    else if (q('[data-hero-shuffle]')) playList(it.col, true, it.spContext);
  }, true);
  vspace.addEventListener('contextmenu', (e) => {
    if (!active()) return;
    const node = e.target.closest('.vi.row');
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    trackMenu(node, items[node._vi], { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
  }, true);
  function trackMenu(node, it, rect) {
    const t = it.track;
    const list = [];
    if (!Spot.isCurrent(t)) list.push({ label: 'Play now', icon: ICON.play, act: () => playRow(it) });
    list.push({ label: 'Add to Spotify queue', icon: ICON.queue, act: async () => { await cmd('POST', '/me/player/queue', { uri: t.uri }, 500); data.queue = null; toast('Added to queue'); refresh(); } });
    list.push({ label: likedIds.get(t.id) ? 'Remove from Liked Songs' : 'Add to Liked Songs', icon: ICON.heart, act: () => toggleLike(t) });
    list.push('-');
    if (t.artistRef) list.push({ label: `Go to ${t.artistRef.name}`, icon: ICON.person, act: () => open({ type: 'artist', id: t.artistRef.id, name: t.artistRef.name }) });
    if (t.albumRef) list.push({ label: 'Go to album', icon: ICON.note, act: () => open({ type: 'album', ...t.albumRef }) });
    list.push({ label: 'Open in Spotify', icon: ICON.next, act: () => api.openExternal(`https://open.spotify.com/track/${encodeURIComponent(t.id)}`).catch(() => {}) });
    menuNode = node;
    node.classList.add('menu-open');
    openMenu(rect, () => list);
  }

  // ---------- dock, seek, volume and keys drive Spotify while in Spotify mode ----------
  document.addEventListener('click', (e) => {
    if (!active()) return;
    const b = e.target.closest('#btnPlay, #btnNext, #btnPrev, #btnShuffle, #btnRepeat, #btnMute, #btnFav');
    if (!b) return;
    e.stopPropagation();
    if (!status.connected) { toast('Connect Spotify first'); return; }
    if (b.id === 'btnPlay') togglePlaySp();
    else if (b.id === 'btnNext') { const n = data.queue && data.queue.next && data.queue.next[0]; if (n) showPending(n); data.queue = null; cmd('POST', '/me/player/next', null, 250); }
    else if (b.id === 'btnPrev') { data.queue = null; cmd('POST', '/me/player/previous', null, 250); }
    else if (b.id === 'btnShuffle') setShuffle(!(player && player.shuffle_state));
    else if (b.id === 'btnRepeat') cycleRepeat();
    else if (b.id === 'btnMute') toggleMute();
    else if (b.id === 'btnFav' && player && player.item) toggleLike(T(player.item), b);
  }, true);
  document.addEventListener('input', (e) => {
    if (!active() || (e.target !== seek && e.target !== vol)) return;
    e.stopPropagation();
    if (e.target === seek) {
      seekingSp = true;
      setFill(seek);
      const d = player && player.item ? player.item.duration_ms : 0;
      $('#tCur').textContent = fmt(((seek.value / 1000) * d) / 1000);
    } else setVolume(+vol.value);
  }, true);
  document.addEventListener('change', (e) => {
    if (!active() || (e.target !== seek && e.target !== vol)) return;
    e.stopPropagation();
    e.target.blur();
    if (e.target === seek) {
      seekingSp = false;
      const d = player && player.item ? player.item.duration_ms : 0;
      if (d) seekTo((seek.value / 1000) * d);
    }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (!active() || e.ctrlKey || e.altKey || e.metaKey || !status.connected) return;
    if ((e.target.matches && e.target.matches('input, textarea')) || !$('#modalRoot').hidden) return;
    const k = e.key.toLowerCase();
    const fns = {
      ' ': togglePlaySp,
      n: () => { data.queue = null; cmd('POST', '/me/player/next', null, 250); },
      p: () => { data.queue = null; cmd('POST', '/me/player/previous', null, 250); },
      arrowright: () => seekTo(progress() + (e.shiftKey ? 30000 : 5000)),
      arrowleft: () => seekTo(progress() - (e.shiftKey ? 30000 : 5000)),
      arrowup: () => setVolume(+vol.value + 5),
      arrowdown: () => setVolume(+vol.value - 5),
      l: () => player && player.item && toggleLike(T(player.item), $('#btnFav')),
      s: () => setShuffle(!(player && player.shuffle_state)),
      r: cycleRepeat,
      m: toggleMute,
    };
    if (!fns[k]) return;
    e.preventDefault();
    e.stopImmediatePropagation();   // the local player's key handler must not also act on this key
    fns[k]();
  }, true);

  // keep a slow eye on Spotify in Local mode too, so starting local music can pause it
  statusP.then(() => { if (status.connected) schedule(active() ? 50 : 4000); });
})();
