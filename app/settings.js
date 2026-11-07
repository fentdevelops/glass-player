'use strict';
// Settings (gear, top left). Top to bottom: Glass (glow, darkness, tint colour, background), Sound (bass, treble,
// a draggable EQ curve, reverb), Playback, Library, Updates, and What's new at the bottom.
// Speed lives in the dock now (next to Lyrics); the library reloads itself; updates install themselves.
(() => {
  const sys = window.glass.system;
  const Settings = (window.Settings = {});

  // ---- building blocks ----
  const chips = (key, opts) => `<div class="set-chips" data-chips="${key}">${opts.map(([v, l]) => `<button type="button" class="schip" data-v="${v}">${l}</button>`).join('')}</div>`;
  const toggle = (key, label, hint) => `<label class="set-row set-toggle"><div><b>${label}</b><span>${hint}</span></div><span class="switch"><input type="checkbox" data-tog="${key}" /><i></i></span></label>`;
  const slider = (key, label, hint, min, max, unit) => `<div class="set-row"><div><b>${label} <em class="set-val" data-val="${key}"></em></b><span>${hint}</span></div>
    <input type="range" class="range" min="${min}" max="${max}" step="1" data-slide="${key}" data-unit="${unit}" /></div>`;

  // ---- Glass: the two big sliders first, then the tint colour ----
  const TINTS = [['', 'None'], ['#9fb7ff', 'Ice'], ['#7c8cff', 'Indigo'], ['#b07cff', 'Violet'], ['#ff7cc8', 'Pink'], ['#ff7a7a', 'Rose'],
    ['#ffb36b', 'Amber'], ['#ffe17a', 'Gold'], ['#7ee0a1', 'Mint'], ['#6fd6e8', 'Aqua']];
  function glassHTML() {
    return `
      <div class="set-big">
        <div class="set-bigrow"><div><b>Glow</b><span>How much the artwork colours the glass</span></div><em class="set-num" data-uival="glow"></em></div>
        <input type="range" class="range big" min="0" max="100" data-ui="glow" />
        <div class="set-bigrow"><div><b>Darkness</b><span>Darker keeps text readable over bright pictures</span></div><em class="set-num" data-uival="tint"></em></div>
        <input type="range" class="range big" min="0" max="100" data-ui="tint" />
      </div>
      <div class="set-row"><div><b>Glass colour</b><span>Tint every glass panel with a colour</span></div></div>
      <div class="tint-pal" data-tints>${TINTS.map(([c, n]) => `<button type="button" class="tint-sw${c ? '' : ' none'}" data-tint="${c}" title="${n}" style="${c ? `--c:${c}` : ''}"></button>`).join('')}
        <label class="tint-sw custom" title="Pick any colour"><input type="color" data-tint-pick value="#9fb7ff" /></label></div>
      <div class="set-row"><div><b>Background</b><span>The song's artwork behind the glass, just its colours, or a picture of your own</span></div></div>
      ${chips('ui.wall', [['art', 'Artwork'], ['colors', 'Colours'], ['custom', 'Your image']])}
      <div class="set-row set-wall" data-wall-row><div><b>Your image</b><span data-wall-hint></span></div>
        <button type="button" class="btn" data-act="wallpaper">Choose image…</button></div>
      <div class="set-row set-blur" data-blur-row><div><b>Background blur <em class="set-val" data-wallblur></em></b><span>How soft the picture behind the glass looks</span></div>
        <input type="range" class="range" min="0" max="40" step="1" data-ui="wallBlur" /></div>
      ${toggle('ui.quickEdit', 'Quick edits', 'Right-click the cover to change it. Double-click the title, artist or album to rename it.')}
      ${isMac ? '' : `<div class="set-row"><div><b>See-through window</b><span data-transp>Checking Windows…</span></div>
        <button type="button" class="btn" data-act="colors">Open Windows settings</button></div>`}`;
  }

  // ---- Sound: bass, treble, a smooth EQ curve you drag, reverb ----
  function soundHTML() {
    return `
      ${slider('sound.bass', 'Bass boost', 'Adds weight to kicks and bass lines', 0, 12, 'dB')}
      ${slider('sound.treble', 'Treble', 'Brightens or softens cymbals and voices', -6, 9, 'dB')}
      <div class="set-row"><div><b>Equalizer</b><span>Drag the points. Double-click one to set it back to 0.</span></div></div>
      <div class="eq-graph" data-eqgraph></div>
      ${slider('sound.reverb', 'Reverb', 'Space around the sound', 0, 100, '%')}
      ${chips('sound.room', [['room', 'Room'], ['plate', 'Plate'], ['hall', 'Hall']])}
      ${toggle('sound.even', 'Even out volume', 'Quiet songs come up, loud ones settle down')}
      ${toggle('sound.mono', 'Mono', 'Both ears get the same sound, handy with one earbud')}
      <div class="set-row"><span class="set-grow"></span><button type="button" class="btn ghost" data-sound-reset>Reset sound</button></div>`;
  }
  function playbackHTML() {
    return `
      ${slider('play.xfade', 'Fade in and out', 'Each song fades in at the start and out at the end', 0, 8, 's')}`;
  }

  const getK = (k) => k.split('.').reduce((o, p) => o[p], S);
  const setK = (k, v) => { const ps = k.split('.'), last = ps.pop(); ps.reduce((o, p) => o[p], S)[last] = v; };
  function mountAudio(form) {
    const after = (k) => { if (k.startsWith('sound.')) Sound.apply(); if (k.startsWith('play.')) applySpeed(); if (k.startsWith('ui.')) applyUi(); save(); };
    const paintChips = () => form.querySelectorAll('[data-chips]').forEach((box) => box.querySelectorAll('.schip').forEach((b) => b.classList.toggle('on', String(getK(box.dataset.chips)) === b.dataset.v)));
    const paintVal = (k, v, unit) => { const e = form.querySelector(`[data-val="${k}"]`); if (e) e.textContent = unit === 'dB' ? (v > 0 ? '+' : '') + v + ' dB' : unit === 's' ? (v ? v + ' s' : 'Off') : v + unit; };
    const eq = window.EqGraph ? EqGraph.mount(form.querySelector('[data-eqgraph]'), () => after('sound.eq')) : null;
    const paintAll = () => {
      form.querySelectorAll('[data-slide]').forEach((r) => { r.value = getK(r.dataset.slide); setFill(r); paintVal(r.dataset.slide, +r.value, r.dataset.unit); });
      form.querySelectorAll('[data-tog]').forEach((c) => { c.checked = !!getK(c.dataset.tog); });
      paintChips();
      eq?.paint();
    };
    paintAll();
    form.querySelectorAll('[data-slide]').forEach((r) => {
      r.addEventListener('input', () => { setK(r.dataset.slide, +r.value); setFill(r); paintVal(r.dataset.slide, +r.value, r.dataset.unit); after(r.dataset.slide); });
    });
    form.querySelectorAll('[data-tog]').forEach((c) => c.addEventListener('change', () => { setK(c.dataset.tog, c.checked); after(c.dataset.tog); }));
    form.querySelectorAll('[data-chips]').forEach((box) => box.addEventListener('click', (e) => {
      const b = e.target.closest('.schip');
      if (!b) return;
      const k = box.dataset.chips, cur = getK(k);
      setK(k, typeof cur === 'number' ? +b.dataset.v : b.dataset.v);
      paintChips();
      after(k);
    }));
    form.querySelector('[data-sound-reset]').addEventListener('click', () => {
      Object.assign(S.sound, { bass: 0, treble: 0, eq: [0, 0, 0, 0, 0], preset: 'custom', reverb: 0, room: 'room', even: false, mono: false });
      paintAll(); after('sound.reset');
      eq?.paint(true);
    });
  }

  function mountGlass(form) {
    // the two big sliders show their value as you drag
    const paintNum = (k) => { const e = form.querySelector(`[data-uival="${k}"]`); if (e) e.textContent = `${S.ui[k]}%`; };
    for (const r of form.querySelectorAll('[data-ui]')) {
      r.value = S.ui[r.dataset.ui];
      setFill(r);
      paintNum(r.dataset.ui);
      r.addEventListener('input', () => { S.ui[r.dataset.ui] = +r.value; setFill(r); paintNum(r.dataset.ui); applyUi(); });
      r.addEventListener('change', () => save());
    }
    // tint colour: a swatch, or any colour from the picker
    const pal = form.querySelector('[data-tints]'), pick = form.querySelector('[data-tint-pick]');
    const paintTint = () => {
      const cur = (S.ui.tintColor || '').toLowerCase();
      let matched = false;
      pal.querySelectorAll('[data-tint]').forEach((b) => { const on = b.dataset.tint.toLowerCase() === cur; matched ||= on; b.classList.toggle('on', on); });
      pick.parentElement.classList.toggle('on', !!cur && !matched);
      if (cur && !matched) { pick.value = cur; pick.parentElement.style.setProperty('--c', cur); }
    };
    pal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tint]');
      if (!b) return;
      S.ui.tintColor = b.dataset.tint;
      applyUi(); save(); paintTint();
    });
    pick.addEventListener('input', () => { S.ui.tintColor = pick.value; pick.parentElement.style.setProperty('--c', pick.value); applyUi(); paintTint(); });
    pick.addEventListener('change', () => save());
    paintTint();

    // Windows "Transparency effects": the see-through blur needs it on
    const transp = form.querySelector('[data-transp]');
    const paintTransp = async () => {
      if (!transp) return;     // a Windows setting: not shown on macOS
      const on = await sys.transparency().catch(() => null);
      transp.textContent = on === true ? 'On: the desktop shows through, blurred'
        : on === false ? 'Off: Windows draws the glass solid grey. Turn on Transparency effects.'
        : 'Couldn’t read the Windows setting';
      transp.closest('.set-row').classList.toggle('warn', on === false);
    };
    paintTransp();
    const onFocus = () => paintTransp();
    window.addEventListener('focus', onFocus);
    new MutationObserver((_, obs) => { if (!form.isConnected) { window.removeEventListener('focus', onFocus); obs.disconnect(); } })
      .observe(document.querySelector('#modalRoot'), { childList: true });
    form.querySelector('[data-act="colors"]')?.addEventListener('click', () => sys.openColors().catch(() => {}));

    // background: your own picture + how blurred it is
    const wallRow = form.querySelector('[data-wall-row]'), wallHint = form.querySelector('[data-wall-hint]');
    const blurVal = form.querySelector('[data-wallblur]'), blurRange = form.querySelector('[data-ui="wallBlur"]');
    const paintWall = () => {
      wallRow.classList.toggle('shown', S.ui.wall === 'custom');
      form.querySelectorAll('[data-chips="ui.wall"] .schip').forEach((b) => b.classList.toggle('on', b.dataset.v === S.ui.wall));
      const m = /^(\d+)×(\d+)$/.exec(S.ui.wallImgSize || '');
      if (!S.ui.wallImg || !m) wallHint.textContent = 'Landscape 16:9 at high resolution looks best, like 3840 × 2160 or 1920 × 1080';
      else {
        const w = +m[1], h = +m[2], wide = Math.abs(w / h - 16 / 9) < 0.12, sharp = w >= 1920 && h >= 1080;
        wallHint.textContent = `${w} × ${h}` + (wide && sharp ? ' · sharp and 16:9, looks great'
          : !sharp ? ' · a 16:9 picture of 1920 × 1080 or more looks sharper' : ' · not 16:9, so the edges get cropped');
      }
      // the slider belongs to the background that's on: the artwork has its own blur (max to start), your image its own;
      // the colours background has nothing to blur, so there's no slider for it
      const key = S.ui.wall === 'custom' ? 'wallBlur' : 'wallBlurArt';
      form.querySelector('[data-blur-row]').classList.toggle('off', S.ui.wall === 'colors');
      blurRange.dataset.ui = key;
      blurRange.value = S.ui[key];
      setFill(blurRange);
      blurVal.textContent = `${S.ui[key]} px`;
    };
    const pickWall = async () => {
      const r = await api.pickWallpaper(S.ui.wallImg || null).catch((e) => { toast(cleanErr(e), true); return null; });
      if (r) { S.ui.wallImg = r.url; S.ui.wallImgSize = `${r.width}×${r.height}`; S.ui.wall = 'custom'; }
      else if (!S.ui.wallImg) S.ui.wall = 'art';         // nothing picked and nothing from before: back to the default (artwork)
      applyUi(); save(); paintWall();
    };
    // after the chip's own handler has stored the choice (it's added later, so it runs after this one)
    form.querySelector('[data-chips="ui.wall"]').addEventListener('click', () => setTimeout(() => {
      if (S.ui.wall === 'custom' && !S.ui.wallImg) pickWall(); else paintWall();
    }));
    form.querySelector('[data-act="wallpaper"]').addEventListener('click', pickWall);
    blurRange.addEventListener('input', () => { blurVal.textContent = `${S.ui[blurRange.dataset.ui]} px`; });
    paintWall();
  }

  // ---- Account: signed out, a Sign in button; signed in, the username and a Sign out. The account is one file on this computer. ----
  const REMOVE_NOTE = 'Deletes only the account on this computer. Your music and library stay.';
  function accountHTML(a) {
    const remove = `<div class="set-row" data-acct-rm-row><div><b>Remove this account</b><span>${REMOVE_NOTE}</span></div>
      <button type="button" class="btn ghost" data-acct-rm>Remove this account</button></div>`;
    if (a.signedIn) {
      return `<div class="set-row"><div><b data-acct-name>${esc(a.username)}</b><span>Saved on this computer</span></div>
        <button type="button" class="btn" data-acct-out>Sign out</button></div>${remove}`;
    }
    return `<div class="set-row"><div><b>Not signed in</b><span>${a.exists ? 'An account is saved on this computer' : 'An account is optional. Glassy works the same without one.'}</span></div>
      <button type="button" class="btn" data-acct-in>Sign in</button></div>${a.exists ? remove : ''}`;
  }
  function mountAccount(form) {
    const sec = form.querySelector('[data-account]');
    const paint = () => { if (sec.isConnected) sec.innerHTML = `<h4>Account</h4>${accountHTML(Signup.cached())}`; };
    paint();
    Signup.refresh().then(paint);
    sec.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-acct-in')) { await modalClose?.(); await Signup.open(); Settings.open(); }
      else if (b.hasAttribute('data-acct-out')) { await Signup.signOut(); paint(); }
      else if (b.hasAttribute('data-acct-rm')) {
        b.closest('[data-acct-rm-row]').innerHTML = `<div><b>Remove this account?</b><span>${REMOVE_NOTE}</span></div>
          <span class="set-grow"></span><button type="button" class="btn danger" data-acct-rm-yes>Remove</button><button type="button" class="btn ghost" data-acct-rm-no>Keep it</button>`;
      } else if (b.hasAttribute('data-acct-rm-yes')) { await Signup.remove(); paint(); }
      else if (b.hasAttribute('data-acct-rm-no')) paint();
    });
  }

  Settings.open = (opt = {}) => {
    openModal(`
      <div class="modal-head"><h3 class="modal-title">Settings</h3></div>
      <div class="set-scroll">
      <div class="set-sec" data-account></div>
      <div class="set-sec"><h4>Glass</h4>${glassHTML()}</div>
      <div class="set-sec"><h4>Sound</h4>${soundHTML()}</div>
      <div class="set-sec"><h4>Playback</h4>${playbackHTML()}</div>
      <div class="set-sec"><h4>Library</h4>
        <div class="set-row"><div><b>Your music folders</b><span>Look through Music and Downloads for songs that aren't in your library yet</span></div>
          <button type="button" class="btn" data-find-songs>Find songs on this PC</button></div></div>
      <div class="set-sec"><h4>Updates</h4>
        <div class="set-row"><div><b>Glassy ${esc(window.Updates?.state().version || '')}</b><span data-upd>${esc(window.Updates ? Updates.label() : 'Glass updates itself')}</span></div>
          <button type="button" class="btn" data-upd-btn>Check</button></div></div>
      <div class="set-sec"><h4>Welcome</h4>
        <div class="set-row"><div><b>Replay intro</b><span>See the welcome screens again</span></div>
          <button type="button" class="btn" data-replay-intro>Replay</button></div></div>
      <div class="set-sec" data-start-over hidden><h4>Test copy</h4>
        <div class="set-row"><div><b>Start over as a new user</b><span>Clears this copy's library, settings and sign-in, then restarts like a fresh install. Your music files aren't touched</span></div>
          <button type="button" class="btn" data-start-over-btn>Start over</button></div></div>
      <div class="set-sec" data-news><h4>What's new</h4>${window.PatchNotes ? PatchNotes.html() : ''}</div>
      </div>
      <div class="modal-actions"><span class="grow"></span><button type="submit" class="btn primary">Done</button></div>`, {
      onMount(form) {
        form.classList.add('settings-sheet');
        if (opt.to === 'news') setTimeout(() => {
          const sc = form.querySelector('.set-scroll'), n = form.querySelector('[data-news]');
          if (sc && n) sc.scrollTo({ top: sc.scrollTop + n.getBoundingClientRect().top - sc.getBoundingClientRect().top - 6, behavior: 'smooth' });
        }, 380);
        mountAccount(form);
        mountGlass(form);
        mountAudio(form);
        // only the test copies have this; real Glassy never shows it
        window.glass?.isTestCopy?.().then((yes) => {
          if (!yes || !form.isConnected) return;
          const box = form.querySelector('[data-start-over]'), go = form.querySelector('[data-start-over-btn]');
          box.hidden = false;
          let armed = 0;
          go.addEventListener('click', () => {
            if (armed) { clearTimeout(armed); go.textContent = 'Restarting'; go.disabled = true; window.glass.startOver(); return; }
            go.textContent = 'Click again to confirm';
            armed = setTimeout(() => { armed = 0; if (go.isConnected) go.textContent = 'Start over'; }, 4000);
          });
        }).catch(() => {});
        const updLine = form.querySelector('[data-upd]'), updBtn = form.querySelector('[data-upd-btn]');
        if (window.Updates) {
          const paintUpd = (s) => {
            if (!updLine.isConnected) return;
            updLine.textContent = Updates.label(s);
            updBtn.textContent = Updates.button(s);
            updBtn.disabled = Updates.busy(s);
          };
          Updates.onChange = paintUpd;
          paintUpd(Updates.state());
          updBtn.addEventListener('click', () => Updates.press());
          if (Updates.stale()) Updates.check();
        } else updBtn.hidden = true;
        form.querySelector('[data-replay-intro]').addEventListener('click', async () => { await modalClose?.(); Intro.replay(); });
        form.querySelector('[data-find-songs]').addEventListener('click', async () => { await modalClose?.(); FirstRun.open({ auto: false }); });
      },
      onSubmit() { save(); },
    });
  };
  document.querySelector('#btnSettings').addEventListener('click', () => Settings.open());
  window.addEventListener('keydown', (e) => { if (modKey(e) && e.key === ',') { e.preventDefault(); Settings.open(); } });
})();
