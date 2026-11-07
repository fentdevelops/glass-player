'use strict';
// Lets the real app's interface (site/app/, copied from renderer/) run on a web page for the Features tour.
// It stands in for the part of the app that talks to the computer. No files are read or written, and nothing is saved.
(() => {
  const yes = (v) => () => Promise.resolve(v);
  const none = () => {};
  const host = window.parent !== window ? window.parent : null;
  try { localStorage.setItem('glass.introSeen', '1'); } catch { /* the app copes */ }
  // no sign-in in the tour: Settings still asks about it, and hears there's nobody signed in
  const nobody = { signedIn: false };
  window.Signup ||= { cached: () => nobody, refresh: yes(nobody), open: yes(null), signOut: yes(null), remove: yes(null) };

  // made-up songs, with covers drawn here; if the page has local preview songs, those are shown instead
  const cover = (base, blobs) => {
    const c = document.createElement('canvas'); c.width = c.height = 320;
    const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 320, 320);
    for (const [col, px, py, r] of blobs) { const g = x.createRadialGradient(px * 3.2, py * 3.2, 0, px * 3.2, py * 3.2, r * 3.2); g.addColorStop(0, col); g.addColorStop(1, col + '00'); x.fillStyle = g; x.fillRect(0, 0, 320, 320); }
    return c.toDataURL('image/jpeg', .85);
  };
  const MADE_UP = () => {
    const a = cover('#2f2493', [['#f2589c', 30, 35, 62], ['#ffab68', 80, 85, 50], ['#7c3be0', 85, 15, 46]]);
    const b = cover('#0d0726', [['#56d2ff', 25, 70, 66], ['#4a2fd0', 75, 30, 58], ['#ff78d6', 90, 90, 30]]);
    const c = cover('#4a2fd0', [['#ffd36a', 70, 30, 54], ['#f2589c', 20, 80, 58]]);
    const rows = [];
    const add = (album, artist, art, titles) => titles.forEach((title, i) => rows.push({ title, artist, album, art, trackNo: i + 1, start: 0 }));
    add('Slow Motion', 'Violet Hours', a, ['Night Drive', 'Slow Motion', 'Windows Down', 'Streetlights', 'Long Way Home']);
    add('Glasshouse', 'Marlow Kane', b, ['Glasshouse', 'Paper Moons', 'Low Tide', 'Second Floor']);
    add('Soft Static', 'June Harbor', c, ['Soft Static', 'Half Asleep', 'Early Train', 'Radio Off']);
    return rows;
  };
  const LINES = ['Windows down, the night is warm', 'Nothing left to prove', 'The streetlights hum our song', 'Slowing down the city', 'Every word lands on time', 'Right where it should be', 'Take the long way home tonight', 'We have nowhere else to be'];
  const songs = fetch('../media/songs.json').then((r) => (r.ok ? r.json() : null)).then((list) => {
    if (!Array.isArray(list) || !list.length) return MADE_UP();
    return list.sort((x, y) => (x.order ?? x.track) - (y.order ?? y.track)).map((t) => ({ title: (host?.glassyTest?.censor || String)(t.title), lookup: t.title, artist: t.artist, album: t.album || t.artist, art: t.cover ? `../${t.cover}` : '', trackNo: t.track, start: t.start || 0, full: t.full, real: true }));
  }).catch(() => MADE_UP()).then((rows) => rows.map((r, i) => ({ ...r, path: `song-${i + 1}`, url: `silence.mp3?${i + 1}`, name: r.title })));
  const byPath = async (p) => (await songs).find((s) => s.path === p);
  const metaOf = (s) => (s ? { title: s.title, artist: s.artist, album: s.album, trackNo: s.trackNo, duration: 60, codec: 'MPEG-4/AAC', lossless: false, bitrate: 256000, sampleRate: 44100, thumb: s.art, hasCover: !!s.art } : { missing: true });

  async function lyricsFor(p) {
    const s = await byPath(p);
    if (!s) return { none: true };
    if (!s.real) return { synced: LINES.map((text, i) => ({ t: i * 5, text })), source: 'Demo' };
    const name = String(s.lookup || s.title).replace(/\s*\(feat\.[^)]*\)/i, '');
    const r = await fetch(`https://lrclib.net/api/get?${new URLSearchParams({ track_name: name, artist_name: s.artist, album_name: s.album, duration: Math.round(s.full) })}`).catch(() => null);
    const j = r && r.ok ? await r.json() : null;
    if (!j || !j.syncedLyrics) return { none: true };
    const clean = host?.glassyTest?.censor || ((x) => x), synced = [];
    for (const row of j.syncedLyrics.split('\n')) {
      const m = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/.exec(row.trim());
      if (!m) continue;
      const t = +m[1] * 60 + +m[2] - s.start, text = clean(m[3].trim());
      if (text && t >= 0 && t < 60) synced.push({ t, text });
    }
    return synced.length ? { synced, source: 'LRCLIB' } : { none: true };
  }

  window.glass = {
    openFiles: yes([]), openFolder: yes([]), resolveDropped: yes([]), resolvePaths: yes([]),
    metaBatch: async (paths) => { const all = await songs; return paths.map((p) => metaOf(all.find((s) => s.path === p))); },
    cover: async (p) => (await byPath(p))?.art || null,
    pickImage: yes(null), pickWallpaper: yes(null), rename: yes(null), writeTags: yes(true), reveal: yes(true), lookup: yes([]),
    fetchArt: yes({}), collage: yes(null), pickImageData: yes(null), imageData: yes(null), saveArtData: yes(null),
    artHashes: async (urls) => urls || [], artistInfo: yes(null),
    acts: { known: yes({ whole: [], parts: [] }), check: yes({ whole: [], failed: [] }), search: yes([]) },
    lyrics: { get: lyricsFor, search: yes([]), pick: yes(true), saveFile: yes(true) },
    storeGet: async () => { const all = await songs; return { tracks: all, queue: all.map((s) => s.path), cur: 0, at: 0, view: 'queue', vol: 80, ui: { wall: 'art' } }; },
    storeSet: yes(true), storeSetSync: () => true,
    win: none, zoom: { step: none, set: none, onChange: none },
    openExternal: yes(true), system: { transparency: yes(true), openColors: yes(true) },
    media: { state: none, onAction: none }, onOpenPaths: none, onMaximized: none,
    scan: { start: yes(false), stop: yes(true), add: yes([]), findFromSettings: yes(false), status: yes(null), onProgress: none },
    localAccount: { state: yes({ exists: false, signedIn: false, skipScreen: true }), create: yes({ ok: false }), signIn: yes({ ok: false }), signOut: yes({}), remove: yes({}), googleAvailable: yes(false), googleStart: yes({ ok: false }), googleCancel: yes(true), googleFinish: yes({ ok: false }) },
    updates: { state: yes({ state: 'current', checkedAt: Date.now() }), check: yes(true), install: yes(true), open: yes(true), on: none },
  };
})();
