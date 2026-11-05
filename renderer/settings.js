'use strict';
// Settings (gear, top left). Top to bottom: Glass (glow, darkness, tint colour, background), Sound (bass, treble,
// a draggable EQ curve, reverb), Playback, Spotify, Updates, and What's new at the bottom.
// Speed lives in the dock now (next to Lyrics); the library reloads itself; updates install themselves.
(() => {
  const sys = window.glass.system;
  const Settings = (window.Settings = {});

  function spotifyHTML() {
    const st = window.Spot ? Spot.status() : { connected: false };
    if (st.connected) {
      const plan = st.user && st.user.product ? (st.user.product === 'premium' ? 'Premium' : 'Free') : '';
      return `
        <div class="set-row"><div><b>Connected</b><span>${esc(st.user ? st.user.name : 'Spotify')}${plan ? ' · ' + plan : ''} · your library refreshes by itself</span></div>
          <span class="set-pill on"><i></i>Linked</span></div>
        <div class="set-row"><div><b>Play inside Glass</b><span data-spp>${esc(window.SpotPlayer ? SpotPlayer.message() || 'Off' : 'Off')}</span></div>
          ${window.SpotPlayer && SpotPlayer.state() === 'reconnect' ? '<button type="button" class="btn primary" data-act-sp="reconnect">Reconnect</button>' : ''}</div>
        ${window.SpotPlayer && ['unsigned', 'reconnect'].includes(SpotPlayer.state()) ? `<div class="set-row"><div><b>Turn on playing inside Glass</b><span>Three quick steps and Glass sets itself up: no Spotify app needed after that.</span></div>
          <button type="button" class="btn primary" data-act-sp="setup">Set up</button></div>` : ''}
        <div class="set-row"><div><b>Play on</b><span>Glass Player shows up here as a device. Pick where Spotify plays.</span></div></div>
        <div class="dev-list" data-devices><span class="set-hint">Looking for devices…</span></div>
        <div class="set-row"><span class="set-grow"></span><button type="button" class="btn ghost" data-act-sp="disconnect">Disconnect</button></div>`;
    }
    return `
      <div class="set-row"><div><b>Not connected</b><span>Create a free app on the Spotify dashboard, add the Redirect URI, then paste its Client ID.</span></div>
        <button type="button" class="btn" data-act-sp="dashboard">Open dashboard</button></div>
      <div class="sp-uri"><code>${esc(document.querySelector('#spRedirect').textContent)}</code><button type="button" class="btn ghost" data-act-sp="copy">Copy</button></div>
      <div class="set-row"><label class="field set-grow"><input type="text" name="sp_client" placeholder="Client ID (32 letters and digits)" spellcheck="false" autocomplete="off" value="${esc(document.querySelector('#spClient').value)}" /></label>
        <button type="button" class="btn primary" data-act-sp="connect">Connect</button></div>`;
  }

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
      <div class="set-row"><div><b>Background blur <em class="set-val" data-wallblur></em></b><span>How soft the picture behind the glass looks</span></div>
        <input type="range" class="range" min="0" max="40" step="1" data-ui="wallBlur" /></div>
      ${toggle('ui.quickEdit', 'Quick edits', 'Right-click the cover to change it. Double-click the title, artist or album to rename it.')}
      <div class="set-row"><div><b>See-through window</b><span data-transp>Checking Windows…</span></div>
        <button type="button" class="btn" data-act="colors">Open Windows settings</button></div>`;
  }

  // ---- Sound: bass, treble, a smooth EQ curve you drag (like Spotify's), reverb ----
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
      <div class="set-row"><div><b>Clicking the song that's playing</b><span>Start it over, or pause it</span></div></div>
      ${chips('play.click', [['restart', 'Restart'], ['pause', 'Pause']])}
      ${toggle('play.autoplay', 'Autoplay', 'When the queue runs out, keep going with similar songs')}
      <div class="set-row"><div><b>Between songs</b><span>Gapless runs songs straight into each other. Songs from one album always stay gapless.</span></div></div>
      ${chips('play.crossfade', [[0, 'Gapless'], [3, 'Crossfade 3 s'], [6, '6 s'], [10, '10 s']])}
      ${slider('play.xfade', 'Fade in and out', 'Each song fades in at the start and out at the end (off while crossfading)', 0, 8, 's')}
      ${toggle('play.fade', 'Fade on play and pause', 'A soft fade instead of a hard stop')}`;
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
    form.querySelector('[data-act="colors"]').addEventListener('click', () => sys.openColors().catch(() => {}));

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
      blurVal.textContent = `${S.ui.wallBlur} px`;
    };
    const pickWall = async () => {
      const r = await api.pickWallpaper(S.ui.wallImg || null).catch((e) => { toast(cleanErr(e), true); return null; });
      if (r) { S.ui.wallImg = r.url; S.ui.wallImgSize = `${r.width}×${r.height}`; S.ui.wall = 'custom'; }
      else if (!S.ui.wallImg) S.ui.wall = 'art';            // nothing picked and nothing from before
      applyUi(); save(); paintWall();
    };
    form.querySelector('[data-chips="ui.wall"]').addEventListener('click', () => {
      if (S.ui.wall === 'custom' && !S.ui.wallImg) pickWall(); else paintWall();
    });
    form.querySelector('[data-act="wallpaper"]').addEventListener('click', pickWall);
    blurRange.addEventListener('input', () => { blurVal.textContent = `${S.ui.wallBlur} px`; });
    paintWall();
  }

  Settings.open = (opt = {}) => {
    openModal(`
      <div class="modal-head"><h3 class="modal-title">Settings</h3></div>
      <div class="set-scroll">
      <div class="set-sec"><h4>Glass</h4>${glassHTML()}</div>
      <div class="set-sec"><h4>Sound</h4>${soundHTML()}</div>
      <div class="set-sec"><h4>Playback</h4>${playbackHTML()}</div>
      <div class="set-sec"><h4>Spotify</h4><div data-sp-sec>${spotifyHTML()}</div></div>
      <div class="set-sec"><h4>Updates</h4>
        <div class="set-row"><div><b>Glass ${esc(window.Updates?.state().version || '')}</b><span data-upd>${esc(window.Updates ? Updates.label() : 'Glass updates itself')}</span></div></div></div>
      <div class="set-sec" data-news><h4>What's new</h4>${window.PatchNotes ? PatchNotes.html() : ''}</div>
      </div>
      <div class="modal-actions"><span class="grow"></span><button type="submit" class="btn primary">Done</button></div>`, {
      onMount(form) {
        form.classList.add('settings-sheet');
        if (opt.to === 'news') setTimeout(() => {
          const sc = form.querySelector('.set-scroll'), n = form.querySelector('[data-news]');
          if (sc && n) sc.scrollTo({ top: sc.scrollTop + n.getBoundingClientRect().top - sc.getBoundingClientRect().top - 6, behavior: 'smooth' });
        }, 380);
        mountGlass(form);
        mountAudio(form);
        const updLine = form.querySelector('[data-upd]');
        if (window.Updates) Updates.onChange = (s) => { if (updLine.isConnected) updLine.textContent = Updates.label(s); };

        // Spotify section
        const sec = form.querySelector('[data-sp-sec]');
        const paintDevices = async () => {
          const box = sec.querySelector('[data-devices]');
          if (!box || !window.Spot) return;
          const ds = await Spot.devices();
          box.innerHTML = ds.length
            ? ds.map((d, i) => `<button type="button" class="btn${d.is_active ? ' on' : ''}" data-dev="${i}">${esc(d.name)}</button>`).join('')
            : '<span class="set-hint">No devices yet. Open Spotify on your PC or phone, then reopen Settings.</span>';
          box.onclick = async (e) => {
            const b = e.target.closest('[data-dev]');
            if (!b) return;
            await Spot.transfer(ds[+b.dataset.dev]);
            setTimeout(paintDevices, 900);
          };
        };
        const repaint = () => { sec.innerHTML = spotifyHTML(); paintDevices(); };
        paintDevices();
        sec.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-act-sp]');
          if (!b || !window.Spot) return;
          const a = b.dataset.actSp;
          if (a === 'dashboard') api.openExternal('https://developer.spotify.com/dashboard').catch(() => {});
          else if (a === 'copy') { navigator.clipboard.writeText(document.querySelector('#spRedirect').textContent).then(() => toast('Redirect URI copied')).catch(() => {}); }
          else if (a === 'setup') { window.SpSetup?.open(); }
          else if (a === 'disconnect') { await Spot.disconnect(); repaint(); }
          else if (a === 'reconnect') { b.disabled = true; b.textContent = 'Waiting for browser…'; await Spot.connect(Spot.status().clientId); repaint(); }
          else if (a === 'connect') {
            b.disabled = true;
            b.textContent = 'Waiting for browser…';
            const ok = await Spot.connect(form.elements.sp_client.value.trim());
            repaint();
            if (ok && S.source !== 'spotify') setSource('spotify');
          }
        });
      },
      onSubmit() { save(); },
    });
  };
  document.querySelector('#btnSettings').addEventListener('click', () => Settings.open());
  window.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === ',') { e.preventDefault(); Settings.open(); } });
})();
