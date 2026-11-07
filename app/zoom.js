'use strict';
// Zoom: Ctrl + (or Ctrl =), Ctrl −, Ctrl 0, numpad too. The keys are caught in main.js (Electron's own
// shortcut only knew Ctrl + Shift + =). A liquid glass pill at the top shows the new size for a moment,
// with − and + buttons; clicking the percentage goes back to 100%. The size is remembered (S.ui.zoom).
// Uses app.js globals: S, SOFT, anim, done, save.
(() => {
  const z = window.glass.zoom;
  const pop = document.createElement('div');
  pop.className = 'zoom-pop glass';
  pop.hidden = true;
  pop.innerHTML = `
    <button type="button" class="zp-btn" data-z="-1" title="Zoom out (${modName} −)"><svg viewBox="0 0 24 24"><path d="M6.5 12h11"/></svg></button>
    <button type="button" class="zp-val" data-z="0" title="Back to 100% (${modName} 0)"><span>100%</span></button>
    <button type="button" class="zp-btn" data-z="1" title="Zoom in (${modName} +)"><svg viewBox="0 0 24 24"><path d="M6.5 12h11M12 6.5v11"/></svg></button>`;
  document.body.appendChild(pop);
  window.Liquid?.watch?.(pop);
  const val = pop.querySelector('.zp-val span');
  let shown = false, hovering = false, hideT = 0, hiding = null;

  function arm() {
    clearTimeout(hideT);
    hideT = setTimeout(() => (hovering ? arm() : hide()), 2200);
  }
  function show(f) {
    const pct = Math.round(f * 100);
    const changed = val.textContent !== pct + '%';
    val.textContent = pct + '%';
    pop.classList.toggle('normal', pct === 100);
    if (!shown) {
      shown = true;
      hiding?.cancel();
      pop.hidden = false;
      anim(pop, [{ opacity: 0, transform: 'translateY(-16px) scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 560 });
    } else if (changed) {
      anim(val, [{ transform: 'scale(1.22)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: SOFT });
    }
    arm();
  }
  async function hide() {
    if (!shown) return;
    shown = false;
    hiding = anim(pop, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px) scale(.94)' }], { duration: 340, easing: 'ease-in', fill: 'forwards' });
    await done(hiding);
    if (!shown) { pop.hidden = true; hiding?.cancel(); }
    hiding = null;
  }
  pop.addEventListener('pointerenter', () => { hovering = true; });
  pop.addEventListener('pointerleave', () => { hovering = false; arm(); });
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (b) z.step(+b.dataset.z);
  });
  z.onChange((f) => {
    S.ui.zoom = f;
    save();
    show(f);
  });
  window.Zoom = {
    // on start: put back the size from last time, quietly
    restore(f) { if (typeof f === 'number' && Math.abs(f - 1) > 0.001) z.set(f); },
    show,
  };
})();
