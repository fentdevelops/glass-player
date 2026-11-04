'use strict';
// Update popup, bottom right. It stays until you act on it:
//  downloading → slim card with progress · ready → "Restart to update" (Later shrinks it to a pill that stays)
//  portable exe → "Download" opens the release page (a portable exe can't replace itself)
// Uses app.js globals: $, esc, anim, done.
(() => {
  const up = window.glass.updates;
  const pop = document.createElement('div');
  pop.className = 'update-pop glass';
  pop.hidden = true;
  document.body.appendChild(pop);
  let state = { state: 'idle' }, small = false, lastKey = '';
  const ICON = '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>';

  function paint() {
    const s = state, key = `${s.state}|${s.next}|${small}`;
    const show = s.state === 'downloading' || s.state === 'ready' || s.state === 'manual';
    if (!show) { if (!pop.hidden) hide(); return; }
    if (s.state === 'downloading' && key === lastKey) { const bar = $('.up-bar i', pop); if (bar) bar.style.width = (s.percent || 0) + '%'; return; }
    const wasHidden = pop.hidden;
    lastKey = key;
    pop.classList.toggle('small', small);
    if (small) {
      pop.innerHTML = `<button type="button" class="up-pill" data-big>${ICON}<span>${s.state === 'ready' ? 'Update ready' : 'Update available'}</span></button>`;
    } else if (s.state === 'downloading') {
      pop.innerHTML = `<div class="up-row">${ICON}<div class="up-text"><b>Downloading Glass ${esc(s.next || '')}</b><span>It installs when you restart</span></div></div>
        <div class="up-bar"><i style="width:${s.percent || 0}%"></i></div>`;
    } else if (s.state === 'ready') {
      pop.innerHTML = `<div class="up-row">${ICON}<div class="up-text"><b>Glass ${esc(s.next || '')} is ready</b><span>Restart to finish updating</span></div></div>
        <div class="up-actions"><button type="button" class="btn ghost" data-later>Later</button><button type="button" class="btn primary" data-install>Restart to update</button></div>`;
    } else {
      pop.innerHTML = `<div class="up-row">${ICON}<div class="up-text"><b>Glass ${esc(s.next || '')} is out</b><span>You're on ${esc(s.version || '')}</span></div></div>
        <div class="up-actions"><button type="button" class="btn ghost" data-later>Later</button><button type="button" class="btn primary" data-open>Download</button></div>`;
    }
    pop.hidden = false;
    if (wasHidden) anim(pop, [{ opacity: 0, transform: 'translateY(18px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 560 });
    else anim(pop, [{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 380 });
  }
  async function hide() {
    await done(anim(pop, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(12px) scale(.96)' }], { duration: 260, easing: 'ease-in', fill: 'forwards' }));
    pop.hidden = true;
    pop.getAnimations().forEach((a) => a.cancel());
    lastKey = '';
  }
  pop.addEventListener('click', (e) => {
    if (e.target.closest('[data-install]')) { e.target.closest('[data-install]').disabled = true; up.install(); }
    else if (e.target.closest('[data-open]')) up.open();
    else if (e.target.closest('[data-later]')) { small = true; paint(); }
    else if (e.target.closest('[data-big]')) { small = false; paint(); }
  });
  up.on((s) => { state = s; paint(); window.Updates?.onChange?.(s); });
  up.state().then((s) => { state = s; paint(); }).catch(() => {});

  window.Updates = {
    state: () => state,
    _show: (s) => { state = { ...state, ...s }; paint(); },   // dev/tests only
    check: () => up.check(),
    onChange: null,
    label(s = state) {
      return {
        off: 'Updates turn on once Glass is published on GitHub', idle: 'Not checked yet', checking: 'Checking…', current: "You're up to date",
        downloading: `Downloading ${s.next || ''}… ${s.percent || 0}%`, ready: `Version ${s.next || ''} is ready. Restart to update.`,
        manual: `Version ${s.next || ''} is out`, error: `Couldn't check: ${s.message || 'unknown error'}`,
      }[s.state] || '';
    },
  };
})();
