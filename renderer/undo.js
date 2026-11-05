'use strict';
// Undo / redo: Ctrl+Z puts back what you just did, Ctrl+Shift+Z (or Ctrl+Y) does it again.
// Every change Glass saves becomes an undo step: queue edits and song changes, favorites, playlists, song info,
// tags, album covers, renaming a file (the file is renamed back) and removing songs from the library.
// Songs moving on by themselves don't count. A glass pill at the top says what was undone.
// Uses app.js globals: S, lib, edits (let), deck, current, play, save, libChanged, rebuild, paintHeader, stateChanged,
// showNow, withReleased, renameTrack, removeFromLibrary, api, anim, done, restoreAt, toast.
(() => {
  const MAX = 30;
  const undoStack = [], redoStack = [];
  let last = null, timer = 0, quietNext = false, applying = false, pendingFiles = [], pendingRemoved = [];
  const posOf = new Map();          // song path -> where it was last heard (for undoing a song change)
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // what one undo step remembers
  function capture() {
    const t = current();
    return {
      queue: S.queue.map((x) => x.path), cur: t ? t.path : null,
      playlists: clone(S.playlists), favs: [...S.favs].sort(),
      edits: clone(edits), tags: clone(S.tags), songTags: clone(S.songTags), albumArt: clone(S.albumArt),
    };
  }
  const key = (s) => JSON.stringify([s.queue, s.cur, s.playlists, s.favs, s.edits, s.tags, s.songTags, s.albumArt]);
  // a short name for what changed
  function labelFor(a, b, files, removed) {
    if (removed.length) return removed.length === 1 ? 'Removed from library' : `Removed ${removed.length} songs from library`;
    if (files.length) return 'Rename';
    if (JSON.stringify(a.edits) !== JSON.stringify(b.edits)) return 'Song info';
    if (JSON.stringify(a.albumArt) !== JSON.stringify(b.albumArt)) return 'Album cover';
    if (JSON.stringify(a.tags) !== JSON.stringify(b.tags) || JSON.stringify(a.songTags) !== JSON.stringify(b.songTags)) return 'Tags';
    if (a.favs.join('\n') !== b.favs.join('\n')) return b.favs.length > a.favs.length ? 'Favorite' : 'Removed favorite';
    if (JSON.stringify(a.playlists) !== JSON.stringify(b.playlists)) return b.playlists.length > a.playlists.length ? 'New playlist' : b.playlists.length < a.playlists.length ? 'Deleted playlist' : 'Playlist change';
    if (a.cur !== b.cur && b.cur) return 'Song change';
    if (a.queue.join('\n') !== b.queue.join('\n')) return !b.queue.length ? 'Cleared the queue' : b.queue.length < a.queue.length ? 'Removed from queue' : 'Added to queue';
    return 'Change';
  }

  // called by save(): a short moment after things settle, the change becomes one undo step
  function touch() {
    if (applying || !last) return;
    clearTimeout(timer);
    timer = setTimeout(checkpoint, 450);
  }
  function checkpoint() {
    if (applying || !last) return;
    const now = capture();
    if (key(now) === key(last) && !pendingFiles.length && !pendingRemoved.length) return;
    if (quietNext) { quietNext = false; last = now; return; }         // the song moved on by itself
    const before = last;
    before.at = posOf.get(before.cur) || 0;
    before.playing = !deck.paused;
    undoStack.push({ label: labelFor(before, now, pendingFiles, pendingRemoved), before, after: now, files: pendingFiles, removed: pendingRemoved });
    if (undoStack.length > MAX) undoStack.shift();
    redoStack.length = 0;
    pendingFiles = []; pendingRemoved = [];
    last = now;
  }

  // put a remembered state back
  async function apply(st, files, removed, back) {
    applying = true;
    try {
      // files renamed in this step: rename them back (or again)
      for (const f of back ? [...files].reverse() : files) {
        const from = back ? f.to : f.from, to = back ? f.from : f.to;
        const t = lib.get(from);
        if (!t) continue;
        const base = to.slice(Math.max(to.lastIndexOf('\\'), to.lastIndexOf('/')) + 1).replace(/\.[^.]+$/, '');
        try { await withReleased(t, async () => renameTrack(t, await api.rename(t.path, base))); }
        catch (err) { toast('Couldn’t rename the file back: ' + String(err.message || err), true); }
      }
      // songs removed from the library come back (or go again)
      for (const t of removed) { if (back) lib.set(t.path, t); else lib.delete(t.path); }
      // song info: put the remembered edits back, then let each changed song re-read its tags underneath them
      const changed = new Set([...Object.keys(edits), ...Object.keys(st.edits)].filter((p) => JSON.stringify(edits[p]) !== JSON.stringify(st.edits[p])));
      edits = clone(st.edits);
      for (const p of changed) {
        const t = lib.get(p);
        if (!t) continue;
        t.metaState = undefined;
        Object.assign(t, edits[p] || {});
        queueMeta(t, true);
      }
      S.playlists = clone(st.playlists);
      S.favs = new Set(st.favs);
      S.tags = clone(st.tags); S.songTags = clone(st.songTags); S.albumArt = clone(st.albumArt);
      // the queue, and the song that was playing, at the spot it was at
      const was = current();
      S.queue = st.queue.map((p) => lib.get(p)).filter(Boolean);
      const i = st.cur ? S.queue.findIndex((t) => t.path === st.cur) : -1;
      if (i < 0) { if (!S.queue.length) stopAll(); else S.cur = Math.min(Math.max(0, S.cur), S.queue.length - 1); }
      else if (S.queue[i] !== was) { restoreAt = st.at || 0; play(i, st.playing !== false && !deck.paused); }
      else S.cur = i;
      libChanged();
      rebuild(false);
      paintHeader();
      stateChanged(false);
      showNow(false);
      save();
    } finally {
      last = capture();
      applying = false;
    }
  }
  async function undo() {
    clearTimeout(timer); checkpoint();
    const e = undoStack.pop();
    if (!e) { pill('Nothing to undo'); return; }
    await apply(e.before, e.files, e.removed, true);
    redoStack.push(e);
    pill(`Undone: ${e.label}`, 'Ctrl+Shift+Z to redo');
  }
  async function redo() {
    const e = redoStack.pop();
    if (!e) { pill('Nothing to redo'); return; }
    await apply(e.after, e.files, e.removed, false);
    undoStack.push(e);
    pill(`Redone: ${e.label}`);
  }

  // ---------- the glass pill at the top ----------
  const el = document.createElement('div');
  el.className = 'undo-pop glass';
  el.hidden = true;
  el.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 7H4V2"/><path d="M4.5 7.5A8 8 0 1 1 6 17"/></svg><b></b><span></span>';
  document.body.appendChild(el);
  window.Liquid?.watch?.(el);
  let pillT = 0, shown = false;
  function pill(text, hint = '') {
    el.querySelector('b').textContent = text;
    el.querySelector('span').textContent = hint;
    el.classList.toggle('redo', text.startsWith('Redone'));
    clearTimeout(pillT);
    if (!shown) {
      shown = true; el.hidden = false;
      anim(el, [{ opacity: 0, transform: 'translateY(-14px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 520 });
    } else anim(el, [{ transform: 'scale(.96)' }, { transform: 'none' }], { duration: 360 });
    pillT = setTimeout(async () => {
      shown = false;
      await done(anim(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px) scale(.95)' }], { duration: 320, easing: 'ease-in', fill: 'forwards' }));
      if (!shown) { el.hidden = true; el.getAnimations().forEach((a) => a.cancel()); }
    }, 2400);
  }

  // ---------- keys: Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y (text boxes keep their own undo) ----------
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
    if (!document.querySelector('#modalRoot').hidden) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (k === 'y' || e.shiftKey) redo(); else undo();
  }, true);

  // ---------- file renames and library removals are remembered with the step they belong to ----------
  const origRename = renameTrack;
  renameTrack = function (t, nt) {
    const from = t.path;
    origRename(t, nt);
    if (!applying && from !== t.path) pendingFiles.push({ from, to: t.path });
  };
  const origRemove = removeFromLibrary;
  removeFromLibrary = async function (t, node) {
    if (!applying) pendingRemoved.push(t);
    return origRemove(t, node);
  };
  // where the playing song is, so undoing a song change goes back to the same spot
  setInterval(() => {
    const t = current();
    if (!t || applying) return;
    posOf.delete(t.path); posOf.set(t.path, deck.currentTime);
    if (posOf.size > 60) posOf.delete(posOf.keys().next().value);
  }, 400);

  window.Undo = {
    init() { last = capture(); },
    touch,
    quiet() { quietNext = true; },      // the next change is the player moving on by itself
    undo, redo,
    get canUndo() { return undoStack.length > 0; },
  };
  // the saved state may have loaded before this file ran: start right away then
  if (typeof loaded !== 'undefined' && loaded && !last) last = capture();
})();
