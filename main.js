const { app, BrowserWindow, ipcMain, dialog, nativeImage, shell, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus'];
const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mkv', 'mov'];
const MEDIA_EXT = new Set([...AUDIO_EXT, ...VIDEO_EXT].map((e) => '.' + e));

let win = null;

// Dev: GLASS_USERDATA isolates test runs from the real library
if (process.env.GLASS_USERDATA) app.setPath('userData', process.env.GLASS_USERDATA);
// Dev: GLASS_SHOT runs render off-screen (no window ever appears, nothing steals focus) and are muted.
// GLASS_SCREEN needs a real on-screen window, so only that mode shows one; ask the user before using it.
const OFFSCREEN_TEST = !!process.env.GLASS_SHOT && !process.env.GLASS_SCREEN;

const isMedia = (p) => MEDIA_EXT.has(path.extname(p).toLowerCase());
const mkTrack = (p) => ({ path: p, url: pathToFileURL(p).href, name: path.parse(p).name });
const byPath = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const ud = (...p) => path.join(app.getPath('userData'), ...p);
const hashOf = (s) => crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 20);
const fileUrl = (p) => pathToFileURL(p).href;

function scanDir(dir, out = [], depth = 0) {
  if (depth > 14) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scanDir(full, out, depth + 1);
    else if (e.isFile() && isMedia(full)) out.push(full);
  }
  return out;
}

function resolvePaths(paths) {
  const files = [];
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) files.push(...scanDir(p).sort(byPath));
      else if (st.isFile() && isMedia(p)) files.push(p);
    } catch { /* missing path: skip */ }
  }
  return files.map(mkTrack);
}

function argPaths(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && fs.existsSync(a));
}

function createWindow() {
  // tests only: GLASS_SIZE=2560x1440 opens the window at that size
  const [testW, testH] = process.env.GLASS_SHOT ? String(process.env.GLASS_SIZE || '').split('x').map(Number) : [];
  win = new BrowserWindow({
    width: testW || 1240,
    height: testH || 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    // Windows 11 rounds a frameless window's corners; asked for explicitly
    roundedCorners: true,
    // Windows 11 acrylic: the desktop behind the player shows through, heavily blurred. With Transparency
    // effects off, acrylic is just solid grey and can cost the rounded corners, so a solid dark window is used.
    ...(transparencyOn() ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' } : { backgroundColor: '#15151b' }),
    show: false,
    title: 'Glass Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // keep timers precise while minimised so track transitions stay gapless
      backgroundThrottling: false,
      // music may start without a click (Spotify's player starts songs it's sent from your phone or the dock)
      autoplayPolicy: 'no-user-gesture-required',
      offscreen: OFFSCREEN_TEST,
    },
  });

  // tests: a size bigger than this screen (ultrawide, portrait) is set after creation
  if (testW && testH) win.setBounds({ width: testW, height: testH });
  // zoom keys are taken before the page and the default menu see them
  require('./spotify-main').watchPlayer(win.webContents);
  // before the window goes, Glass's Spotify player signs off, so Spotify doesn't keep an old "Glass Player"
  // that plays nothing (closing waits for Spotify to confirm, 1.5 s at most)
  let signedOff = false;
  win.on('close', (e) => {
    if (signedOff) return;
    signedOff = true;
    e.preventDefault();
    const w = win;
    require('./spotify-main').signOff(w.webContents).then(() => { if (!w.isDestroyed()) w.close(); });
  });
  win.webContents.on('before-input-event', (e, input) => {
    const dir = zoomKey(input);
    if (dir === null) return;
    e.preventDefault();
    stepZoom(dir);
  });
  if (process.env.GLASS_SHOT) {
    win.webContents.on('console-message', (e) => { if (e.level !== 'verbose') console.log('[renderer]', e.message); });
  }
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (OFFSCREEN_TEST) win.webContents.setFrameRate(60);
  if (process.env.GLASS_SHOT) win.webContents.setAudioMuted(true);   // tests never make sound
  win.once('ready-to-show', () => {
    if (OFFSCREEN_TEST) return;
    win.show();
    if (process.env.GLASS_SCREEN) win.setAlwaysOnTop(true, 'screen-saver');
  });
  win.on('maximize', () => win.webContents.send('maximized', true));
  win.on('unmaximize', () => win.webContents.send('maximized', false));
  win.on('enter-full-screen', () => win.webContents.send('maximized', true));
  win.on('leave-full-screen', () => win.webContents.send('maximized', win.isMaximized()));

  win.webContents.once('did-finish-load', () => {
    const tracks = resolvePaths(argPaths(process.argv));
    if (tracks.length) win.webContents.send('open-paths', tracks);

    // Dev helpers: GLASS_SHOT=out.png captures and quits. GLASS_PRE runs JS at 1.5s,
    // GLASS_EVAL logs a value before capture, GLASS_SCREEN=1 grabs the real composited
    // screen (shows the acrylic) instead of just the page.
    if (process.env.GLASS_SHOT) {
      const run = (js) => win.webContents.executeJavaScript(js).then((v) => console.log('[eval]', JSON.stringify(v))).catch((e) => console.log('[eval-error]', e.message));
      if (process.env.GLASS_PRE) setTimeout(() => run(process.env.GLASS_PRE), 1500);
      // GLASS_KEYS="control+= control+- control+0": real key presses (through before-input-event), 2.5 s in, 700 ms apart
      if (process.env.GLASS_KEYS) process.env.GLASS_KEYS.split(' ').filter(Boolean).forEach((spec, i) => setTimeout(() => {
        const parts = spec.split('+'), keyCode = parts.pop() || '+', modifiers = parts.filter(Boolean);
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      }, 2500 + i * 700));
      setTimeout(async () => {
        if (process.env.GLASS_EVAL) await run(process.env.GLASS_EVAL);
        let png;
        if (process.env.GLASS_SCREEN) {
          win.setAlwaysOnTop(true, 'screen-saver');
          win.moveTop();
          win.focus();
          await new Promise((r) => setTimeout(r, 700));
          const d = screen.getDisplayMatching(win.getBounds());
          const sf = d.scaleFactor;
          const [src] = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.size.width * sf, height: d.size.height * sf } }));
          const b = win.getBounds();
          const pad = Number(process.env.GLASS_SCREEN_PAD || 0);   // capture some desktop around the window too
          const x = Math.max(0, Math.round((b.x - d.bounds.x - pad) * sf)), y = Math.max(0, Math.round((b.y - d.bounds.y - pad) * sf));
          const tw = src.thumbnail.getSize();
          png = src.thumbnail.crop({ x, y, width: Math.min(tw.width - x, Math.round((b.width + pad * 2) * sf)), height: Math.min(tw.height - y, Math.round((b.height + pad * 2) * sf)) }).toPNG();
        } else {
          // GLASS_SHOT_RECT="x,y,w,h" (window pixels): capture just that part, for close-ups in tests
          const r = (process.env.GLASS_SHOT_RECT || '').split(',').map(Number);
          png = (await win.webContents.capturePage(r.length === 4 ? { x: r[0], y: r[1], width: r[2], height: r[3] } : undefined)).toPNG();
        }
        fs.writeFileSync(process.env.GLASS_SHOT, png);
        app.quit();
      }, Number(process.env.GLASS_SHOT_DELAY || 3500));
    }
  });
}

// ---- IPC: opening ----
const FILTERS = [
  { name: 'Media', extensions: [...AUDIO_EXT, ...VIDEO_EXT] },
  { name: 'Audio', extensions: AUDIO_EXT },
  { name: 'Video', extensions: VIDEO_EXT },
];
ipcMain.handle('open-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: FILTERS });
  return r.canceled ? [] : resolvePaths(r.filePaths);
});
ipcMain.handle('open-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'multiSelections'] });
  return r.canceled ? [] : resolvePaths(r.filePaths);
});
ipcMain.handle('resolve-paths', (_e, paths) => resolvePaths(paths || []));

// ---- metadata, cached on disk so 10k+ libraries load instantly after the first scan ----
let mm = null;
let metaCache = null, metaTimer = 0;
function loadMetaCache() {
  if (metaCache) return;
  try { metaCache = JSON.parse(fs.readFileSync(ud('meta-cache.json'), 'utf8')); } catch { metaCache = {}; }
}
function saveMetaCacheSoon() {
  clearTimeout(metaTimer);
  metaTimer = setTimeout(() => {
    try { fs.writeFileSync(ud('meta-cache.json.tmp'), JSON.stringify(metaCache)); fs.renameSync(ud('meta-cache.json.tmp'), ud('meta-cache.json')); } catch { /* retry next time */ }
  }, 1500);
}
function squareOf(img) {
  const { width: w, height: h } = img.getSize();
  const s = Math.min(w, h);
  return { sq: img.crop({ x: Math.floor((w - s) / 2), y: Math.floor((h - s) / 2), width: s, height: s }), s };
}
function writeJpeg(img, size, quality, file) {
  const { sq, s } = squareOf(img);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, sq.resize({ width: Math.min(size, s), height: Math.min(size, s), quality: 'best' }).toJPEG(quality));
  return fileUrl(file);
}
async function readMeta(p) {
  loadMetaCache();
  let st;
  try { st = fs.statSync(p); } catch { return { missing: true }; }
  // ":q1" = cache format with audio quality fields; older entries get re-read once
  const sig = `${st.size}:${Math.round(st.mtimeMs)}:q1`;
  const hit = metaCache[p];
  if (hit && hit.sig === sig) return hit.m;
  mm ??= await import('music-metadata');
  const out = {};
  try {
    const { common, format } = await mm.parseFile(p, { duration: false, skipPostHeaders: true });
    if (common.title) out.title = common.title;
    if (common.artist) out.artist = common.artist;
    if (common.album) out.album = common.album;
    if (common.genre && common.genre[0]) out.genre = common.genre[0];
    if (common.year) out.year = common.year;
    if (common.track && common.track.no) out.trackNo = common.track.no;
    if (format.duration) out.duration = format.duration;
    // audio quality (shown as Hi-Res / CD / HQ / SQ / LQ badges)
    if (format.codec) out.codec = String(format.codec).slice(0, 24);
    if (format.lossless != null) out.lossless = !!format.lossless;
    if (format.bitrate) out.bitrate = Math.round(format.bitrate);
    if (format.sampleRate) out.sampleRate = format.sampleRate;
    if (format.bitsPerSample) out.bits = format.bitsPerSample;
    const pic = mm.selectCover(common.picture);
    if (pic) {
      const img = nativeImage.createFromBuffer(Buffer.from(pic.data));
      if (!img.isEmpty()) {
        out.thumb = writeJpeg(img, 176, 80, ud('thumbs', `${hashOf(p)}-${hashOf(sig).slice(0, 6)}.jpg`));
        out.hasCover = true;
      }
    }
  } catch { /* unreadable tags: fall back to the file name */ }
  metaCache[p] = { sig, m: out };
  saveMetaCacheSoon();
  return out;
}
ipcMain.handle('meta-batch', async (_e, paths) => {
  const out = new Array(paths.length);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < paths.length) { const k = i++; out[k] = await readMeta(paths[k]); }
  }));
  return out;
});
// full-size cover, only for the track that's actually showing
ipcMain.handle('cover', async (_e, p) => {
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const file = ud('covers', `${hashOf(p)}-${hashOf(`${st.size}:${Math.round(st.mtimeMs)}`).slice(0, 6)}.jpg`);
  if (fs.existsSync(file)) return fileUrl(file);
  mm ??= await import('music-metadata');
  try {
    const { common } = await mm.parseFile(p, { duration: false, skipPostHeaders: true });
    const pic = mm.selectCover(common.picture);
    if (!pic) return null;
    const img = nativeImage.createFromBuffer(Buffer.from(pic.data));
    return img.isEmpty() ? null : writeJpeg(img, 720, 88, file);
  } catch { return null; }
});

// ---- library store (userData/library.json) ----
function writeStore(data) {
  fs.writeFileSync(ud('library.json.tmp'), JSON.stringify(data));
  fs.renameSync(ud('library.json.tmp'), ud('library.json'));
}
ipcMain.handle('store-get', () => {
  try { return JSON.parse(fs.readFileSync(ud('library.json'), 'utf8')); } catch { return null; }
});
ipcMain.handle('store-set', (_e, data) => { writeStore(data); return true; });
ipcMain.on('store-set-sync', (e, data) => {
  try { writeStore(data); } catch { /* best effort on quit */ }
  e.returnValue = true;
});

// ---- user artwork (custom covers, playlist images) saved as files ----
function saveArt(img) {
  const id = crypto.randomBytes(8).toString('hex');
  return {
    cover: writeJpeg(img, 720, 88, ud('art', `${id}.jpg`)),
    thumb: writeJpeg(img, 176, 82, ud('art', `${id}_t.jpg`)),
  };
}
ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an image',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) {
    // formats nativeImage can't decode (webp/gif) go through the Windows thumbnail codec
    try { img = await nativeImage.createThumbnailFromPath(p, { width: 720, height: 720 }); } catch { /* ignore */ }
  }
  if (img.isEmpty()) throw new Error("Couldn't read that image. Try a JPG or PNG.");
  return saveArt(img);
});

// ---- your own background picture (Settings > Glass > Background > Your image) ----
// Kept big (up to 3840 px on the long side) so it stays sharp behind the glass; the previous one is removed.
ipcMain.handle('pick-wallpaper', async (_e, oldUrl) => {
  // tests: GLASS_WALL_FILE stands in for the file dialog
  if (process.env.GLASS_SHOT && process.env.GLASS_WALL_FILE) return saveWallpaper(process.env.GLASS_WALL_FILE, oldUrl);
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a background picture (16:9, high resolution looks best)', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return saveWallpaper(r.filePaths[0], oldUrl);
});
async function saveWallpaper(p, oldUrl) {
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) { try { img = await nativeImage.createThumbnailFromPath(p, { width: 3840, height: 3840 }); } catch { /* ignore */ } }
  if (img.isEmpty()) throw new Error("Couldn't read that image. Try a JPG or PNG.");
  const { width: w, height: h } = img.getSize(), s = Math.min(1, 3840 / Math.max(w, h));
  const outImg = s < 1 ? img.resize({ width: Math.round(w * s), height: Math.round(h * s), quality: 'best' }) : img;
  const file = ud('backgrounds', crypto.randomBytes(8).toString('hex') + '.jpg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, outImg.toJPEG(92));
  try {
    const op = oldUrl ? fileURLToPath(String(oldUrl)) : '';
    if (op && path.dirname(path.resolve(op)).toLowerCase() === path.dirname(file).toLowerCase()) fs.unlinkSync(op);
  } catch { /* already gone */ }
  return { url: fileUrl(file), width: w, height: h };
}

// ---- file edits ----
ipcMain.handle('rename', (_e, oldPath, base) => {
  base = String(base || '').trim();
  if (!base || /[<>:"/\\|?*\x00-\x1f]/.test(base) || /^\.+$/.test(base) || /[. ]$/.test(base)) {
    throw new Error('That file name has characters Windows doesn\'t allow.');
  }
  const np = path.join(path.dirname(oldPath), base + path.extname(oldPath));
  if (np === oldPath) return mkTrack(oldPath);
  if (fs.existsSync(np) && np.toLowerCase() !== oldPath.toLowerCase()) throw new Error('A file with that name already exists.');
  fs.renameSync(oldPath, np);
  return mkTrack(np);
});

function imageBytes(ref) {
  if (ref.startsWith('data:')) return Buffer.from(ref.split(',')[1], 'base64');
  const p = fileURLToPath(ref.split('?')[0]);
  if (!path.resolve(p).toLowerCase().startsWith(path.resolve(app.getPath('userData')).toLowerCase())) throw new Error('Unexpected image location');
  return fs.readFileSync(p);
}
let NodeID3 = null;
ipcMain.handle('write-tags', (_e, p, tags) => {
  if (path.extname(p).toLowerCase() !== '.mp3') return false;
  NodeID3 ??= require('node-id3');
  const t = { title: tags.title || '', artist: tags.artist || '', album: tags.album || '' };
  if (tags.cover) {
    t.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: imageBytes(tags.cover) };
  }
  const r = NodeID3.update(t, p);
  if (r instanceof Error) throw r;
  return true;
});

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

// ---- online metadata lookup (no API keys needed): Apple Music/iTunes + Deezer ----
const ART_HOST = /(^|\.)(mzstatic\.com|dzcdn\.net)$/i;
async function getJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GlassPlayer/0.3' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
ipcMain.handle('lookup', async (_e, q) => {
  q = String(q || '').trim().slice(0, 200);
  if (!q) return [];
  const enc = encodeURIComponent(q);
  const [it, dz] = await Promise.allSettled([
    getJSON(`https://itunes.apple.com/search?term=${enc}&media=music&entity=song&limit=12`),
    getJSON(`https://api.deezer.com/search?q=${enc}&limit=12`),
  ]);
  if (it.status === 'rejected' && dz.status === 'rejected') throw new Error("Couldn't reach the music search services. Check your connection.");
  const a = it.status === 'fulfilled' ? (it.value.results || []).map((r) => ({
    source: 'Apple', title: r.trackName, artist: r.artistName, album: r.collectionName,
    year: r.releaseDate ? r.releaseDate.slice(0, 4) : '', trackNo: r.trackNumber,
    thumb: r.artworkUrl100, art: r.artworkUrl100 && r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/1000x1000bb.'),
  })) : [];
  const b = dz.status === 'fulfilled' ? (dz.value.data || []).map((r) => ({
    source: 'Deezer', title: r.title, artist: r.artist && r.artist.name, album: r.album && r.album.title,
    year: '', thumb: r.album && r.album.cover_medium, art: r.album && r.album.cover_xl,
  })) : [];
  const out = [], seen = new Set();
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    for (const r of [a[i], b[i]]) {
      if (!r || !r.title) continue;
      const k = `${r.title}|${r.artist}|${r.album}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out.slice(0, 16);
});
ipcMain.handle('fetch-art', async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ART_HOST.test(u.hostname)) throw new Error('Unexpected image host');
  const r = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error('Cover download failed');
  const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
  if (img.isEmpty()) throw new Error("Couldn't read that cover image");
  return saveArt(img);
});

// ---- artwork for the Adjust editor: images go to the renderer as data URLs (keeps its canvas untainted) ----
const inUserData = (p) => path.resolve(p).toLowerCase().startsWith(path.resolve(app.getPath('userData')).toLowerCase() + path.sep);
async function loadAnyImage(p) {
  let img = nativeImage.createFromPath(p);
  if (img.isEmpty()) { try { img = await nativeImage.createThumbnailFromPath(p, { width: 1600, height: 1600 }); } catch { /* ignore */ } }
  if (img.isEmpty()) throw new Error("Couldn't read that image. Try a JPG or PNG.");
  const { width: w, height: h } = img.getSize(), s = Math.min(1, 1600 / Math.max(w, h));
  if (s < 1) img = img.resize({ width: Math.round(w * s), height: Math.round(h * s), quality: 'best' });
  return { dataUrl: 'data:image/jpeg;base64,' + img.toJPEG(92).toString('base64'), ...img.getSize() };
}
ipcMain.handle('pick-image-data', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an image', properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return loadAnyImage(r.filePaths[0]);
});
ipcMain.handle('image-data', (_e, url) => {
  const p = fileURLToPath(url);
  if (!inUserData(p)) throw new Error('Unexpected image location');
  return loadAnyImage(p);
});
ipcMain.handle('save-art-data', (_e, dataUrl) => {
  if (!/^data:image\/(jpeg|png);base64,/.test(String(dataUrl))) throw new Error('Bad image');
  const img = nativeImage.createFromDataURL(dataUrl);
  if (img.isEmpty()) throw new Error("Couldn't save that cover");
  return saveArt(img);
});
// same picture → same fingerprint, so "songs with this artwork" can be grouped even though each song has its own thumb file
const artHashCache = new Map();
ipcMain.handle('art-hashes', (_e, urls) => (urls || []).map((u) => {
  if (artHashCache.has(u)) return artHashCache.get(u);
  let h = null;
  try { const p = fileURLToPath(u); if (inUserData(p)) h = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 16); } catch { /* skip */ }
  artHashCache.set(u, h);
  return h;
}));

// ---- album cover made from its songs' artwork (drag one song onto another) ----
// 1 image: as is · 2: left/right halves · 3+: 2×2 grid. Raw BGRA bitmaps, so no canvas/origin issues.
ipcMain.handle('collage', (_e, urls) => {
  const S = 600;
  const imgs = [];
  for (const u of (urls || []).slice(0, 4)) {
    try {
      const p = fileURLToPath(u);
      if (!path.resolve(p).toLowerCase().startsWith(path.resolve(app.getPath('userData')).toLowerCase() + path.sep)) continue;   // only our own thumbs/covers/art
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) imgs.push(squareOf(img).sq);
    } catch { /* skip */ }
  }
  if (!imgs.length) return null;
  if (imgs.length === 1) return saveArt(imgs[0]);
  const out = Buffer.alloc(S * S * 4);
  const cells = imgs.length === 2
    ? [{ img: imgs[0], x: 0, y: 0, w: S / 2, h: S, src: 'mid' }, { img: imgs[1], x: S / 2, y: 0, w: S / 2, h: S, src: 'mid' }]
    : [0, 1, 2, 3].map((k) => ({ img: imgs[k % imgs.length], x: (k % 2) * (S / 2), y: Math.floor(k / 2) * (S / 2), w: S / 2, h: S / 2 }));
  for (const c of cells) {
    // halves: scale to full height then take the middle strip; quarters: scale to the cell
    const full = c.h === S ? c.img.resize({ width: S, height: S, quality: 'best' }) : c.img.resize({ width: c.w, height: c.h, quality: 'best' });
    const bmp = full.toBitmap(), fw = full.getSize().width;
    const ox = c.h === S ? (S - c.w) / 2 : 0;
    for (let row = 0; row < c.h; row++) {
      const from = (row * fw + ox) * 4;
      bmp.copy(out, ((c.y + row) * S + c.x) * 4, from, from + c.w * 4);
    }
  }
  return saveArt(nativeImage.createFromBitmap(out, { width: S, height: S }));
});

// ---- lyrics: local first (sidecar .lrc/.txt, then tags), then the user's saved pick, then LRCLIB (keyless) ----
// Result shape: { source, synced: [{ t, text }] | null, plain: string | null, instrumental?, title?, artist? }
const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
function parseLrc(src) {
  const lines = [];
  let offset = 0;
  for (const raw of String(src).replace(/^﻿/, '').split(/\r?\n/)) {
    const off = /^\[offset:\s*([+-]?\d+)\]/i.exec(raw);
    if (off) { offset = +off[1] / 1000; continue; }
    const stamps = [];
    let m, last = 0;
    LRC_TIME.lastIndex = 0;
    while ((m = LRC_TIME.exec(raw)) && m.index === last) { stamps.push(+m[1] * 60 + parseFloat(m[2].replace(':', '.'))); last = LRC_TIME.lastIndex; }
    if (!stamps.length) continue;
    const text = raw.slice(last).replace(/<\d+:\d+(?:\.\d+)?>/g, '').trim();   // drop enhanced word stamps
    for (const s of stamps) lines.push({ t: Math.max(0, s - offset), text });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines.length >= 2 ? lines : null;
}
const plainOf = (lines) => lines.map((l) => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
function shapeLyrics(source, syncedText, plainText, extra = {}) {
  const synced = syncedText ? parseLrc(syncedText) : null;
  const plain = (plainText && String(plainText).trim()) || (synced ? plainOf(synced) : null);
  return synced || plain ? { source, synced, plain, ...extra } : null;
}
function lyricsSidecar(p) {
  const base = p.slice(0, p.length - path.extname(p).length);
  for (const ext of ['.lrc', '.LRC', '.txt']) {
    let txt;
    try { txt = fs.readFileSync(base + ext, 'utf8'); } catch { continue; }
    const synced = parseLrc(txt);
    if (synced) return { source: 'File', synced, plain: plainOf(synced), file: path.basename(base + ext) };
    if (ext !== '.txt' || txt.trim().length > 20) return { source: 'File', synced: null, plain: txt.trim(), file: path.basename(base + ext) };
  }
  return null;
}
async function lyricsEmbedded(p) {
  mm ??= await import('music-metadata');
  try {
    const { common } = await mm.parseFile(p, { duration: false, skipCovers: true });
    for (const l of common.lyrics || []) {
      if (typeof l === 'string') { if (l.trim()) return { source: 'Tags', synced: null, plain: l.trim() }; continue; }
      if (l.syncText && l.syncText.length > 1) {
        // SYLT timestamps are milliseconds in practice (MPEG-frame stamps are vanishingly rare)
        const synced = l.syncText.map((s) => ({ t: (s.timestamp || 0) / 1000, text: String(s.text || '').trim() })).sort((a, b) => a.t - b.t);
        return { source: 'Tags', synced, plain: plainOf(synced) };
      }
      if (l.text && l.text.trim()) {
        const synced = parseLrc(l.text);   // some taggers stash LRC text in the plain lyrics field
        return { source: 'Tags', synced, plain: synced ? plainOf(synced) : l.text.trim() };
      }
    }
  } catch { /* unreadable */ }
  return null;
}
const lyricsCacheFile = (p) => ud('lyrics', hashOf(p) + '.json');
function lyricsCacheGet(p) { try { return JSON.parse(fs.readFileSync(lyricsCacheFile(p), 'utf8')); } catch { return null; } }
function lyricsCacheSet(p, v) {
  fs.mkdirSync(ud('lyrics'), { recursive: true });
  fs.writeFileSync(lyricsCacheFile(p), JSON.stringify(v));
}
const LRCLIB = 'https://lrclib.net/api';
const lrcHeaders = { 'User-Agent': 'GlassPlayer/0.6 (desktop music player)' };
const fromLrclib = (r) => shapeLyrics('LRCLIB', r.syncedLyrics, r.plainLyrics, {
  id: r.id, title: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration, instrumental: !!r.instrumental,
});
async function lrclibJSON(url) {
  const r = await fetch(url, { headers: lrcHeaders, signal: AbortSignal.timeout(9000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// ---- more synced lyrics: Kugou and NetEase Cloud Music answer plain requests with timed lyrics (LRC) ----
// (QQ Music only answers requests that claim to come from its own website, so it isn't used.)
// Genius has words only, never timings, so it stays a "search in your browser" link.
async function getJSON(url, ms = 8000) {
  const r = await fetch(url, { headers: lrcHeaders, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// credit lines some services put at the top ("Lyricist: …", 作词 : …) and "instrumental, enjoy" notes
const CREDIT = /^\s*(作词|作曲|编曲|制作人|制作|混音|母带|和声|监制|出品|发行|词|曲|演唱|lyricist|lyrics by|composer|composed by|producer|produced by|arranger|written by|mixed by|mastered by)\s*[:：]/i;
const cleanSynced = (lines) => (lines || []).filter((l, i) => !(i < 8 && CREDIT.test(l.text)) && !/^纯音乐/.test(l.text));
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)|\[.*?\]|feat\..*$|ft\..*$/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const sameSong = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
function fromService(source, lrc, info) {
  const r = shapeLyrics(source, lrc, null, info);
  if (!r || !r.synced) return null;
  r.synced = cleanSynced(r.synced);
  if (r.synced.length < 5) return null;
  r.plain = plainOf(r.synced);
  return r;
}
async function kugouSearch(h, max = 3) {
  const kw = [h.artist, h.title].filter(Boolean).join(' - ') || h.q;
  if (!kw) return [];
  const j = await getJSON(`https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(kw)}&duration=${h.duration ? Math.round(h.duration * 1000) : ''}&hash=`);
  const out = await Promise.all((j.candidates || []).slice(0, max).map(async (c) => {
    try {
      const l = await getJSON(`https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(c.id)}&accesskey=${encodeURIComponent(c.accesskey)}&fmt=lrc&charset=utf8`);
      return fromService('Kugou', Buffer.from(l.content || '', 'base64').toString('utf8'), { title: c.song, artist: c.singer, duration: (c.duration || 0) / 1000 });
    } catch { return null; }
  }));
  return out.filter(Boolean);
}
async function neteaseSearch(h, max = 3) {
  const q = [h.title, h.artist].filter(Boolean).join(' ') || h.q;
  if (!q) return [];
  const j = await getJSON(`https://music.163.com/api/search/get?s=${encodeURIComponent(q)}&type=1&limit=${max}`);
  const out = await Promise.all((((j.result || {}).songs) || []).slice(0, max).map(async (s) => {
    try {
      const l = await getJSON(`https://music.163.com/api/song/lyric?os=pc&id=${encodeURIComponent(s.id)}&lv=-1&kv=-1&tv=-1`);
      return fromService('NetEase', (l.lrc || {}).lyric || '', { title: s.name, artist: (s.artists || []).map((a) => a.name).join(', '), album: (s.album || {}).name, duration: (s.duration || 0) / 1000 });
    } catch { return null; }
  }));
  return out.filter(Boolean);
}
// exact LRCLIB match by tags first (fast, precise); without synced lyrics there, every source is asked at once
// and the best synced match wins: same title, closest length
async function lyricsAuto(h) {
  const title = String(h.title || '').trim(), artist = String(h.artist || '').trim();
  let exact = null;
  if (title && artist) {
    const qs = new URLSearchParams({ track_name: title, artist_name: artist });
    if (h.album) qs.set('album_name', h.album);
    if (h.duration) qs.set('duration', Math.round(h.duration));
    const hit = await lrclibJSON(`${LRCLIB}/get?${qs}`).catch(() => null);
    if (hit && hit.instrumental) return { source: 'LRCLIB', instrumental: true, synced: null, plain: null };
    if (hit && hit.syncedLyrics) return fromLrclib(hit);
    if (hit && hit.plainLyrics) exact = fromLrclib(hit);
  }
  const q = h.q || [artist, title].filter(Boolean).join(' ');
  const lists = await Promise.allSettled([lyricsSearchLrclib(q), kugouSearch({ ...h, q }), neteaseSearch({ ...h, q })]);
  const list = lists.flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
  if (!list.length) return exact;
  const d = h.duration || 0;
  const fits = (r) => (!d || !r.duration || Math.abs(r.duration - d) < 6) && (!title || !r.title || sameSong(r.title, title));
  const score = (r) => (r.synced ? 0 : 30) + (d && r.duration ? Math.abs(r.duration - d) : 12) + (r.source === 'LRCLIB' ? 0 : 1);
  const best = list.filter(fits).sort((a, b) => score(a) - score(b))[0];
  return best && (best.synced || !exact) ? best : exact || best || null;
}
async function lyricsSearchLrclib(q) {
  q = String(q || '').trim().slice(0, 200);
  if (!q) return [];
  const rows = (await lrclibJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`)) || [];
  return rows.slice(0, 20).map(fromLrclib).filter(Boolean);
}
// the lyrics search box: every source together, synced first
async function lyricsSearch(q) {
  q = String(q || '').trim().slice(0, 200);
  if (!q) return [];
  const lists = await Promise.allSettled([lyricsSearchLrclib(q), kugouSearch({ q }, 4), neteaseSearch({ q }, 4)]);
  if (lists.every((x) => x.status === 'rejected')) throw lists[0].reason;
  const all = lists.flatMap((x) => (x.status === 'fulfilled' ? x.value : []));
  return all.sort((a, b) => (b.synced ? 1 : 0) - (a.synced ? 1 : 0)).slice(0, 30);
}
// mode: 'auto' (local → cache → online) | 'local' (never touch the network)
ipcMain.handle('lyrics-get', async (_e, p, hints = {}, mode = 'auto') => {
  // Spotify songs ("sp:spotify:track:…") have no file: straight to the saved pick, then LRCLIB
  const isSpotify = String(p).startsWith('sp:');
  const local = isSpotify ? null : lyricsSidecar(p) || (await lyricsEmbedded(p));
  if (local) return local;
  const cached = lyricsCacheGet(p);
  // a remembered "nothing found" is retried after a week, in case LRCLIB has it by then
  const staleMiss = cached && cached.none && Date.now() - (cached.at || 0) > 7 * 864e5;
  if (cached && !staleMiss) return cached.none ? { none: true } : cached;
  if (mode !== 'auto') return { none: true };
  let r;
  try { r = await lyricsAuto(hints); } catch { return { none: true, error: "Couldn't reach the lyrics service. Check your connection." }; }
  try { lyricsCacheSet(p, r || { none: true, at: Date.now() }); } catch { /* cache is best effort */ }
  return r || { none: true };
});
ipcMain.handle('lyrics-search', async (_e, q) => {
  try { return await lyricsSearch(q); } catch { throw new Error("Couldn't reach the lyrics service. Check your connection."); }
});
ipcMain.handle('lyrics-pick', (_e, p, r) => { lyricsCacheSet(p, r && (r.synced || r.plain || r.instrumental) ? r : { none: true, at: Date.now() }); return true; });
// writes the lyrics as a .lrc (or .txt) next to the song so other players see them too
ipcMain.handle('lyrics-save-file', (_e, p, r) => {
  if (String(p).startsWith('sp:')) throw new Error('Spotify songs have no file to save next to');
  const base = p.slice(0, p.length - path.extname(p).length);
  const stamp = (t) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`;
  const file = base + (r.synced ? '.lrc' : '.txt');
  fs.writeFileSync(file, r.synced ? r.synced.map((l) => stamp(l.t) + l.text).join('\n') + '\n' : String(r.plain || ''));
  try { fs.unlinkSync(lyricsCacheFile(p)); } catch { /* none cached */ }
  return path.basename(file);
});

// ---- artist info for artist pages: a short summary + photo from Wikipedia (keyless, cached a week) ----
// Spotify's API has no bios or play counts, so Wikipedia is the description source; the page links back to the article.
const MUSIC_WORDS = /\b(singer|rapper|musician|band|group|duo|trio|dj|disc jockey|producer|songwriter|composer|vocalist|guitarist|drummer|pianist|record|hip hop|rock|pop|orchestra|ensemble|artist)\b/i;
let artistCache = null;
const artistCacheFile = () => ud('artist-info.json');
function artistCacheLoad() { if (!artistCache) { try { artistCache = JSON.parse(fs.readFileSync(artistCacheFile(), 'utf8')); } catch { artistCache = {}; } } return artistCache; }
async function wikiJSON(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GlassPlayer/0.6 (desktop music player)', 'Api-User-Agent': 'GlassPlayer/0.6 (desktop music player)' }, signal: AbortSignal.timeout(9000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
ipcMain.handle('artist-info', async (_e, name) => {
  name = String(name || '').trim().slice(0, 120);
  if (!name) return null;
  const cache = artistCacheLoad(), key = name.toLowerCase(), hit = cache[key];
  if (hit && Date.now() - hit.at < 7 * 864e5) return hit.info;
  let info = null;
  try {
    const s = await wikiJSON(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(name + ' musician OR band OR rapper OR singer')}`);
    const titles = ((s && s.query && s.query.search) || []).map((x) => x.title);
    for (const title of titles) {
      const sum = await wikiJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
      if (!sum || sum.type === 'disambiguation') continue;
      const looksRight = MUSIC_WORDS.test(`${sum.description || ''} ${(sum.extract || '').slice(0, 300)}`)
        && title.toLowerCase().replace(/\s*\(.*\)$/, '').includes(key.replace(/^the\s+/, '').slice(0, 30).split(/\s+/)[0]);
      if (!looksRight) continue;
      const img = sum.thumbnail && /^https:\/\/upload\.wikimedia\.org\//.test(sum.thumbnail.source) ? sum.thumbnail.source : null;
      info = { title: sum.title, description: sum.description || '', extract: String(sum.extract || '').slice(0, 1200), image: img,
        url: sum.content_urls && sum.content_urls.desktop ? sum.content_urls.desktop.page : `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}` };
      break;
    }
  } catch { return hit ? hit.info : null; }   // offline: keep whatever we had
  cache[key] = { at: Date.now(), info };
  try { fs.writeFileSync(artistCacheFile(), JSON.stringify(cache)); } catch { /* best effort */ }
  return info;
});

// ---- updates from GitHub Releases ----
// Installed (NSIS) builds download new versions in the background and install on restart (popup bottom right).
// The portable exe can't replace itself, so it only checks and offers the download page.
// Off in dev and tests. The repo comes from resources/app-update.yml, which electron-builder writes into
// every build (the packaged package.json has no "build" section); package.json build.publish is the fallback.
const pkgInfo = (() => { try { return require('./package.json'); } catch { return {}; } })();
function readPub() {
  try {
    const y = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const get = (k) => ((new RegExp(`^${k}:[ \\t]*['"]?([^'"\\r\\n]+)`, 'm').exec(y) || [])[1] || '').trim();
    if (get('provider') === 'github' && get('owner') && get('repo')) return { provider: 'github', owner: get('owner'), repo: get('repo') };
  } catch { /* dev run: no app-update.yml */ }
  return [].concat((pkgInfo.build && pkgInfo.build.publish) || []).find((p) => p && p.provider === 'github' && p.owner && p.repo) || null;
}
const ghPub = readPub();
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
let updateState = { state: 'idle', version: app.getVersion() };
const sendUpdate = (patch) => { updateState = { ...updateState, ...patch }; win?.webContents.send('update', updateState); };
const newer = (a, b) => { const pa = String(a).replace(/^v/, '').split(/[.-]/).map(Number), pb = String(b).replace(/^v/, '').split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); } return false; };
let autoUpdater = null, lastCheck = 0;
async function checkUpdates(manual = false) {
  if (!ghPub || !app.isPackaged || process.env.GLASS_SHOT) { if (manual) sendUpdate({ state: 'off' }); return; }
  // an update already on its way (or waiting for a restart) isn't looked for again
  const busy = ['downloading', 'ready'].includes(updateState.state) || (updateState.state === 'checking' && Date.now() - lastCheck < 5 * 60e3);
  if (!manual && busy) return;
  lastCheck = Date.now();
  try {
    if (isPortable) {
      sendUpdate({ state: 'checking' });
      const r = await fetch(`https://api.github.com/repos/${ghPub.owner}/${ghPub.repo}/releases/latest`, { headers: { 'User-Agent': 'GlassPlayer', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (newer(j.tag_name, app.getVersion())) sendUpdate({ state: 'manual', next: String(j.tag_name).replace(/^v/, ''), url: j.html_url });
      else sendUpdate({ state: 'current' });
      return;
    }
    if (!autoUpdater) {
      ({ autoUpdater } = require('electron-updater'));
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
      autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', next: i.version, percent: 0 }));
      autoUpdater.on('update-not-available', () => sendUpdate({ state: 'current' }));
      autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0) }));
      autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', next: i.version }));
      // no release on GitHub yet counts as up to date, not as a failed check
      autoUpdater.on('error', (e) => { const m = String((e && e.message) || e); sendUpdate(/No published versions/i.test(m) ? { state: 'current' } : { state: 'error', message: m.split('\n')[0].slice(0, 160) }); });
    }
    await autoUpdater.checkForUpdates();
  } catch (e) { sendUpdate({ state: 'error', message: String((e && e.message) || e).split('\n')[0].slice(0, 160) }); }
}
ipcMain.handle('update:state', () => updateState);
ipcMain.handle('update:check', () => checkUpdates(true));
ipcMain.handle('update:install', () => { if (autoUpdater && updateState.state === 'ready') setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
ipcMain.handle('update:open', () => { if (updateState.url && /^https:\/\/github\.com\//.test(updateState.url)) shell.openExternal(updateState.url); });
// A new release reaches an open Glass within half an hour, and soon after you come back to the window:
// it downloads quietly, then a small card says it's ready to restart (renderer/updates.js).
app.whenReady().then(() => {
  setTimeout(() => checkUpdates(false), 8000);
  setInterval(() => checkUpdates(false), 30 * 60e3);
  app.on('browser-window-focus', () => { if (Date.now() - lastCheck > 10 * 60e3) checkUpdates(false); });
});

// ---- Windows glass: is "Transparency effects" on? (read only; the user flips it in Windows Settings) ----
function transparencyOn() {
  try {
    const out = require('child_process').execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'], { windowsHide: true, encoding: 'utf8', timeout: 3000 });
    const m = /EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    return m ? parseInt(m[1], 16) !== 0 : true;
  } catch { return true; }
}
ipcMain.handle('sys:transparency', () => new Promise((resolve) => {
  require('child_process').execFile('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'EnableTransparency'],
    { windowsHide: true }, (err, out) => {
      const m = !err && /EnableTransparency\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
      resolve(m ? parseInt(m[1], 16) !== 0 : null);
    });
}));
ipcMain.handle('sys:open-colors', () => shell.openExternal('ms-settings:colors'));

// ---- Spotify (Web API + Connect playback control) ----
require('./spotify-main').register();

// ---- zoom: Ctrl + / Ctrl = / Ctrl - / Ctrl 0 (and the numpad keys) ----
// Electron's built-in zoom-in shortcut needs Shift on most keyboards, so the keys are handled here.
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
function stepZoom(dir) {
  if (!win) return;
  const wc = win.webContents, z = wc.getZoomFactor();
  const next = dir > 0 ? ZOOMS.find((v) => v > z + 0.001) || ZOOMS[ZOOMS.length - 1]
    : dir < 0 ? [...ZOOMS].reverse().find((v) => v < z - 0.001) || ZOOMS[0]
    : 1;
  wc.setZoomFactor(next);
  wc.send('zoom', next);       // the renderer remembers it and shows the zoom pill
}
function zoomKey(input) {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  const k = input.key, c = input.code;
  if (k === '+' || k === '=' || c === 'Equal' || c === 'NumpadAdd') return 1;
  if (k === '-' || k === '_' || c === 'Minus' || c === 'NumpadSubtract') return -1;
  if (!input.shift && (k === '0' || c === 'Digit0' || c === 'Numpad0')) return 0;
  return null;
}
ipcMain.on('zoom-step', (_e, dir) => stepZoom(Math.sign(Number(dir) || 0)));
ipcMain.on('zoom-set', (_e, f) => {
  const v = Number(f);
  if (win && v >= ZOOMS[0] && v <= ZOOMS[ZOOMS.length - 1]) win.webContents.setZoomFactor(v);
});

ipcMain.on('win', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

// ---- single instance: "Open with" on a running player adds to its queue ----
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const tracks = resolvePaths(argPaths(argv));
    if (tracks.length) win.webContents.send('open-paths', tracks);
  });
  // castlabs Electron: wait for the Widevine CDM so Spotify's in-app player can play protected audio
  app.whenReady().then(async () => {
    const { components } = require('electron');
    if (components) { try { await components.whenReady(); } catch (err) { console.warn('Widevine not ready:', err && err.message); } }
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
