'use strict';
// Tags: your own labels with an emoji and a colour, on any number of songs.
// Data lives in app.js state: S.tags = [{ id, name, emoji, color }], S.songTags = { path: [ids] }.
// Uses app.js globals: S, lib, $, $$, esc, anim, toast, openMenu, openModal, libChanged, save, plural, filtersChanged, setView, transitionView.
(() => {
  const COLORS = ['#ff5c80', '#ff8a4c', '#ffc23d', '#9be15d', '#3ddc97', '#35c9e8', '#5b8cff', '#a77bff', '#ef6fd8', '#b8b8c4'];
  const EMOJI = ['🔥', '❤️', '💜', '💙', '💚', '⭐', '✨', '🎧', '🎉', '🕺', '😌', '😴', '🌙', '☀️', '🌧️', '❄️',
    '🌊', '🌸', '🍂', '🌈', '⚡', '💎', '👑', '🦋', '🚗', '🏋️', '🏃', '📚', '🧠', '🎮', '☕', '🍕',
    '🎸', '🎹', '🎤', '🥁', '🎻', '🎷', '💿', '📼', '💔', '😢', '😈', '😂', '🥶', '🤍', '🖤', '🙏'];
  const ICON = '<svg viewBox="0 0 24 24"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.6"/></svg>';

  const byId = (id) => S.tags.find((x) => x.id === id);
  const tagsFor = (t) => (S.songTags[t.path] || []).map(byId).filter(Boolean);
  const changed = () => { tagVersion++; libChanged(); save(); };
  const newId = () => Math.random().toString(36).slice(2, 9);

  // ---------- look ----------
  const dot = (tg) => `<span class="tag-dot" style="--tc:${tg.color}">${tg.emoji ? esc(tg.emoji) : ''}</span>`;
  const chip = (tg, cls = '') => `<span class="tag ${cls}" style="--tc:${tg.color}">${tg.emoji ? `<i>${esc(tg.emoji)}</i>` : ''}<b>${esc(tg.name)}</b></span>`;
  // on a song row: the first tag in full, the rest as emoji/colour dots
  function rowHTML(t, compact = false) {
    const list = tagsFor(t);
    if (!list.length) return '';
    const shown = list.slice(0, compact ? 3 : 4);
    return `<span class="row-tags">${shown.map((tg, i) => (i === 0 && !compact ? chip(tg, 'sm') : `<span class="tag-mini" style="--tc:${tg.color}" title="${esc(tg.name)}">${tg.emoji ? esc(tg.emoji) : ''}</span>`)).join('')}${list.length > shown.length ? `<span class="tag-more">+${list.length - shown.length}</span>` : ''}</span>`;
  }

  // ---------- give / take ----------
  function setFor(tracks, id, on) {
    for (const t of tracks) {
      const cur = new Set(S.songTags[t.path] || []);
      on ? cur.add(id) : cur.delete(id);
      if (cur.size) S.songTags[t.path] = [...cur]; else delete S.songTags[t.path];
    }
    changed();
  }
  function setExact(t, ids) {
    if (ids.length) S.songTags[t.path] = [...ids]; else delete S.songTags[t.path];
    changed();
  }
  // a menu page: tick tags on/off for these songs (stays open so several can be ticked)
  function menuItems(tracks) {
    const items = S.tags.map((tg) => {
      const n = tracks.filter((t) => (S.songTags[t.path] || []).includes(tg.id)).length;
      return {
        label: tg.name, icon: dot(tg), checked: n === tracks.length, keep: true,
        title: n && n < tracks.length ? `${n} of ${tracks.length} have it` : '',
        act: () => setFor(tracks, tg.id, n !== tracks.length),
      };
    });
    if (items.length) items.push('-');
    items.push({ label: 'New tag…', icon: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', act: () => editTag(null, tracks) });
    if (S.tags.length) items.push({ label: 'Manage tags…', icon: '<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>', act: manage });
    return items;
  }

  // ---------- create / edit ----------
  // resolves with the tag (new or edited) or null; `tracks` get the new tag straight away
  function editTag(tag, tracks = []) {
    return new Promise((resolve) => {
      const draft = tag ? { ...tag } : { id: newId(), name: '', emoji: EMOJI[Math.floor(Math.random() * 16)], color: COLORS[S.tags.length % COLORS.length] };
      let out = null;
      const L = Art.layer(`
        <h3 class="modal-title">${tag ? 'Edit tag' : 'New tag'}</h3>
        <div class="tg-preview" data-prev></div>
        <label class="field"><span>Name</span><input type="text" data-name maxlength="32" placeholder="Chill, Gym, Road trip…" value="${esc(draft.name)}" /></label>
        <div class="field"><span>Emoji</span>
          <div class="tg-emoji" data-emoji>${['', ...EMOJI].map((e) => `<button type="button" class="tg-e${e === draft.emoji ? ' on' : ''}" data-e="${esc(e)}" title="${e ? '' : 'No emoji'}">${e || '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>'}</button>`).join('')}</div>
          <div class="tg-own"><input type="text" data-own maxlength="8" placeholder="Or type any emoji (Win + .)" /></div></div>
        <div class="field"><span>Colour</span>
          <div class="tg-colors" data-colors>${COLORS.map((c) => `<button type="button" class="tg-c${c === draft.color ? ' on' : ''}" data-c="${c}" style="--tc:${c}"></button>`).join('')}</div></div>
        <div class="modal-actions">
          ${tag ? '<button type="button" class="btn ghost danger" data-del>Delete tag</button>' : ''}
          <span class="grow"></span><button type="button" class="btn" data-x>Cancel</button>
          <button type="button" class="btn primary" data-ok>${tag ? 'Save' : tracks.length ? `Add to ${plural(tracks.length, 'song')}` : 'Create'}</button></div>`, 'tg-panel');
      L.onClose = () => resolve(out);
      const P = L.panel, name = $('[data-name]', P);
      const paint = (pop) => {
        const prev = $('[data-prev]', P);
        prev.innerHTML = chip({ ...draft, name: draft.name.trim() || 'Tag name' }, 'lg');
        if (pop) anim(prev.firstElementChild, [{ transform: 'scale(.85)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 420 });
        $$('.tg-e', P).forEach((b) => b.classList.toggle('on', b.dataset.e === draft.emoji));
        $$('.tg-c', P).forEach((b) => b.classList.toggle('on', b.dataset.c === draft.color));
      };
      paint(false);
      setTimeout(() => name.focus(), 80);
      name.addEventListener('input', () => { draft.name = name.value; paint(false); });
      $('[data-emoji]', P).addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) { draft.emoji = b.dataset.e; $('[data-own]', P).value = ''; paint(true); } });
      $('[data-own]', P).addEventListener('input', (e) => { const v = [...e.target.value.trim()].slice(0, 2).join(''); draft.emoji = v; paint(true); });
      $('[data-colors]', P).addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { draft.color = b.dataset.c; paint(true); } });
      const submit = () => {
        draft.name = name.value.trim().replace(/\s+/g, ' ');
        if (!draft.name) { name.focus(); anim(name, [{ transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }], { duration: 320 }); return; }
        const clash = S.tags.find((x) => x.id !== draft.id && x.name.toLowerCase() === draft.name.toLowerCase());
        if (clash) { toast(`There's already a tag called “${clash.name}”`, true); return; }
        if (tag) Object.assign(tag, draft); else S.tags.push(draft);
        out = tag || draft;
        if (tracks.length) setFor(tracks, out.id, true); else changed();
        toast(tag ? 'Tag saved' : tracks.length ? `Tagged ${plural(tracks.length, 'song')} “${draft.name}”` : `Made “${draft.name}”`);
        L.close();
      };
      $('[data-ok]', P).addEventListener('click', submit);
      name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      $('[data-x]', P).addEventListener('click', L.close);
      $('[data-del]', P)?.addEventListener('click', () => { remove(tag); out = null; L.close(); });
    });
  }
  function remove(tag) {
    S.tags = S.tags.filter((x) => x !== tag);
    for (const [p, ids] of Object.entries(S.songTags)) {
      const keep = ids.filter((id) => id !== tag.id);
      if (keep.length) S.songTags[p] = keep; else delete S.songTags[p];
    }
    S.filters.tags = S.filters.tags.filter((id) => id !== tag.id);
    changed();
    filtersChanged();
    toast(`Deleted “${tag.name}”`);
  }

  // ---------- manage all tags ----------
  function manage() {
    const L = Art.layer(`
      <h3 class="modal-title">Tags</h3>
      <div class="tg-list" data-list></div>
      <div class="modal-actions"><button type="button" class="btn" data-new>New tag</button><span class="grow"></span><button type="button" class="btn primary" data-x>Done</button></div>`, 'tg-panel');
    const P = L.panel, list = $('[data-list]', P);
    const paint = () => {
      const cnt = new Map();
      for (const [p, ids] of Object.entries(S.songTags)) if (lib.has(p)) for (const id of ids) cnt.set(id, (cnt.get(id) || 0) + 1);
      list.innerHTML = S.tags.length ? S.tags.map((tg, i) => `<div class="tg-row" style="--d:${i * 35}ms">${chip(tg)}<span class="tg-n">${plural(cnt.get(tg.id) || 0, 'song')}</span><span class="grow"></span>
          <button type="button" class="btn ghost" data-show="${tg.id}">Show songs</button>
          <button type="button" class="ibtn xs" data-edit="${tg.id}" title="Edit"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg></button></div>`).join('')
        : '<div class="lk-empty">No tags yet. Make one, then tag songs from their ••• menu.</div>';
    };
    paint();
    list.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-edit]'), sh = e.target.closest('[data-show]');
      if (ed) { await editTag(byId(ed.dataset.edit)); paint(); }
      if (sh) { show(sh.dataset.show); L.close(); }
    });
    $('[data-new]', P).addEventListener('click', async () => { await editTag(null); paint(); });
    $('[data-x]', P).addEventListener('click', L.close);
  }
  // Library filtered to one tag
  function show(id) {
    S.filters.tags = [id];
    if (S.view !== 'library') setView('library');
    filtersChanged();
  }

  // ---------- Edit info: a row of tag toggles ----------
  function fieldHTML() { return '<div class="field"><span>Tags</span><div class="tg-field" data-tags></div></div>'; }
  function mountField(form, t) {
    const box = $('[data-tags]', form), sel = new Set(S.songTags[t.path] || []);
    const paint = () => {
      box.innerHTML = S.tags.map((tg) => `<button type="button" class="tg-tog${sel.has(tg.id) ? ' on' : ''}" data-id="${tg.id}" style="--tc:${tg.color}">${tg.emoji ? `<i>${esc(tg.emoji)}</i>` : ''}${esc(tg.name)}</button>`).join('')
        + `<button type="button" class="tg-tog add" data-add>${'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>'}New tag</button>`;
    };
    paint();
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-id]');
      if (b) { sel.has(b.dataset.id) ? sel.delete(b.dataset.id) : sel.add(b.dataset.id); b.classList.toggle('on'); anim(b, [{ transform: 'scale(.88)' }, { transform: 'none' }], { duration: 380 }); return; }
      if (e.target.closest('[data-add]')) { const tg = await editTag(null); if (tg) { sel.add(tg.id); paint(); } }
    });
    return () => setExact(t, S.tags.map((x) => x.id).filter((id) => sel.has(id)));   // call on Save
  }

  window.Tags = { ICON, dot, chip, rowHTML, menuItems, editTag, manage, show, fieldHTML, mountField, tagsFor };
})();
