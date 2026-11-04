'use strict';
// Settings (gear, top left): Spotify account and device, and how the glass looks.
(() => {
  const sys = window.glass.system;
  const Settings = (window.Settings = {});

  function spotifyHTML() {
    const st = window.Spot ? Spot.status() : { connected: false };
    if (st.connected) {
      const plan = st.user && st.user.product ? (st.user.product === 'premium' ? 'Premium' : 'Free') : '';
      return `
        <div class="set-row"><div><b>Connected</b><span>${esc(st.user ? st.user.name : 'Spotify')}${plan ? ' · ' + plan : ''}</span></div>
          <span class="set-pill on"><i></i>Linked</span></div>
        <div class="set-row"><div><b>Play inside Glass</b><span data-spp>${esc(window.SpotPlayer ? SpotPlayer.message() || 'Off' : 'Off')}</span></div>
          ${window.SpotPlayer && SpotPlayer.state() === 'reconnect' ? '<button type="button" class="btn primary" data-act-sp="reconnect">Reconnect</button>' : ''}</div>
        <div class="set-row"><div><b>Play on</b><span>Glass Player shows up here as a device. Pick where Spotify plays.</span></div></div>
        <div class="dev-list" data-devices><span class="set-hint">Looking for devices…</span></div>
        <div class="set-row"><span class="set-grow"></span>
          <button type="button" class="btn" data-act-sp="reload">Reload library</button>
          <button type="button" class="btn ghost" data-act-sp="disconnect">Disconnect</button></div>`;
    }
    return `
      <div class="set-row"><div><b>Not connected</b><span>Create a free app on the Spotify dashboard, add the Redirect URI, then paste its Client ID.</span></div>
        <button type="button" class="btn" data-act-sp="dashboard">Open dashboard</button></div>
      <div class="sp-uri"><code>${esc(document.querySelector('#spRedirect').textContent)}</code><button type="button" class="btn ghost" data-act-sp="copy">Copy</button></div>
      <div class="set-row"><label class="field set-grow"><input type="text" name="sp_client" placeholder="Client ID (32 letters and digits)" spellcheck="false" autocomplete="off" value="${esc(document.querySelector('#spClient').value)}" /></label>
        <button type="button" class="btn primary" data-act-sp="connect">Connect</button></div>`;
  }

  // ---- Sound + Playback ----
  const chips = (key, opts) => `<div class="set-chips" data-chips="${key}">${opts.map(([v, l]) => `<button type="button" class="schip" data-v="${v}">${l}</button>`).join('')}</div>`;
  const toggle = (key, label, hint) => `<label class="set-row set-toggle"><div><b>${label}</b><span>${hint}</span></div><span class="switch"><input type="checkbox" data-tog="${key}" /><i></i></span></label>`;
  const slider = (key, label, hint, min, max, unit) => `<div class="set-row"><div><b>${label} <em class="set-val" data-val="${key}"></em></b><span>${hint}</span></div>
    <input type="range" class="range" min="${min}" max="${max}" step="1" data-slide="${key}" data-unit="${unit}" /></div>`;
  const bandLabel = (f) => (f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + 'k' : f);
  function soundHTML() {
    return `
      ${slider('sound.bass', 'Bass boost', 'Adds weight to kicks and bass lines', 0, 12, 'dB')}
      ${slider('sound.treble', 'Treble', 'Brightens or softens cymbals and voices', -6, 9, 'dB')}
      <div class="set-row"><div><b>Equalizer</b><span>Pick a preset or shape it yourself</span></div></div>
      ${chips('sound.preset', Object.entries(Sound.PRESETS).map(([k, p]) => [k, p.label]).concat([['custom', 'Custom']]))}
      <div class="set-eq">${Sound.BANDS.map((f, i) => `<label class="eq-band"><em data-val="eq${i}"></em>
        <input type="range" class="range" min="-12" max="12" step="1" data-eq="${i}" /><span>${bandLabel(f)}</span></label>`).join('')}</div>
      ${slider('sound.reverb', 'Reverb', 'Space around the sound', 0, 100, '%')}
      ${chips('sound.room', [['room', 'Room'], ['plate', 'Plate'], ['hall', 'Hall']])}
      ${toggle('sound.even', 'Even out volume', 'Quiet songs come up, loud ones settle down')}
      ${toggle('sound.mono', 'Mono', 'Both ears get the same sound, handy with one earbud')}
      <div class="set-row"><span class="set-grow"></span><button type="button" class="btn ghost" data-sound-reset>Reset sound</button></div>`;
  }
  function playbackHTML() {
    const sl = sleepState();
    return `
      <div class="set-row"><div><b>Clicking the song that's playing</b><span>Start it over, or pause it</span></div></div>
      ${chips('play.click', [['restart', 'Restart'], ['pause', 'Pause']])}
      ${toggle('play.autoplay', 'Autoplay', 'When the queue runs out, keep going with similar songs')}
      <div class="set-row"><div><b>Between songs</b><span>Gapless runs songs straight into each other. Songs from one album always stay gapless.</span></div></div>
      ${chips('play.crossfade', [[0, 'Gapless'], [3, 'Crossfade 3 s'], [6, '6 s'], [10, '10 s']])}
      ${slider('play.xfade', 'Fade in and out', 'Each song fades in at the start and out at the end (off while crossfading)', 0, 8, 's')}
      ${toggle('play.fade', 'Fade on play and pause', 'A soft fade instead of a hard stop')}
      <div class="set-row"><div><b>Speed</b><span>Also good for podcasts and practice</span></div></div>
      ${chips('play.speed', [[0.75, '0.75×'], [1, '1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']])}
      ${toggle('play.keepPitch', 'Keep pitch', 'Voices don\'t go chipmunk when sped up')}
      <div class="set-row"><div><b>Arrow keys skip</b><span>Shift + arrow always skips 30 seconds</span></div></div>
      ${chips('play.skip', [[5, '5 s'], [10, '10 s'], [15, '15 s']])}
      <div class="set-row"><div><b>Sleep timer</b><span data-sleep-hint>${sl === 'end' ? 'Stops when this song ends' : sl ? `Pauses in about ${sl} min` : 'Off'}</span></div></div>
      <div class="set-chips" data-sleep>${[[0, 'Off'], [15, '15 min'], [30, '30 min'], [60, '1 hr'], ['end', 'End of song']]
        .map(([v, l]) => `<button type="button" class="schip${String(sl === 0 ? 0 : sl === 'end' ? 'end' : -1) === String(v) ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
  }
  const getK = (k) => k.split('.').reduce((o, p) => o[p], S);
  const setK = (k, v) => { const ps = k.split('.'), last = ps.pop(); ps.reduce((o, p) => o[p], S)[last] = v; };
  function mountAudio(form) {
    const after = (k) => { if (k.startsWith('sound.')) Sound.apply(); if (k.startsWith('play.')) applySpeed(); if (k.startsWith('ui.')) applyUi(); save(); };
    const paintChips = () => form.querySelectorAll('[data-chips]').forEach((box) => box.querySelectorAll(".schip").forEach((b) => b.classList.toggle('on', String(getK(box.dataset.chips)) === b.dataset.v)));
    const paintVal = (k, v, unit) => { const e = form.querySelector(`[data-val="${k}"]`); if (e) e.textContent = unit === 'dB' ? (v > 0 ? '+' : '') + v + ' dB' : unit === 's' ? (v ? v + ' s' : 'Off') : v + unit; };
    const paintEq = () => S.sound.eq.forEach((g, i) => { const r = form.querySelector(`[data-eq="${i}"]`); r.value = g; setFill(r); form.querySelector(`[data-val="eq${i}"]`).textContent = (g > 0 ? '+' : '') + g; });
    const paintAll = () => {
      form.querySelectorAll('[data-slide]').forEach((r) => { r.value = getK(r.dataset.slide); setFill(r); paintVal(r.dataset.slide, +r.value, r.dataset.unit); });
      form.querySelectorAll('[data-tog]').forEach((c) => { c.checked = !!getK(c.dataset.tog); });
      paintChips(); paintEq();
    };
    paintAll();
    form.querySelectorAll('[data-slide]').forEach((r) => {
      r.addEventListener('input', () => { setK(r.dataset.slide, +r.value); setFill(r); paintVal(r.dataset.slide, +r.value, r.dataset.unit); after(r.dataset.slide); });
    });
    form.querySelectorAll('[data-tog]').forEach((c) => c.addEventListener('change', () => { setK(c.dataset.tog, c.checked); after(c.dataset.tog); }));
    form.querySelectorAll('[data-chips]').forEach((box) => box.addEventListener('click', (e) => {
      const b = e.target.closest(".schip");
      if (!b) return;
      const k = box.dataset.chips, cur = getK(k);
      const v = typeof cur === 'number' ? +b.dataset.v : b.dataset.v;
      setK(k, v);
      if (k === 'sound.preset' && v !== 'custom') { S.sound.eq = [...Sound.PRESETS[v].eq]; paintEq(); }
      paintChips();
      after(k);
    }));
    form.querySelectorAll('[data-eq]').forEach((r) => r.addEventListener('input', () => {
      S.sound.eq[+r.dataset.eq] = +r.value;
      S.sound.preset = 'custom';
      paintEq(); paintChips(); after('sound.eq');
    }));
    form.querySelector('[data-sound-reset]').addEventListener('click', () => {
      Object.assign(S.sound, { bass: 0, treble: 0, eq: [0, 0, 0, 0, 0], preset: 'flat', reverb: 0, room: 'room', even: false, mono: false });
      paintAll(); after('sound.reset');
    });
    const sleepBox = form.querySelector('[data-sleep]');
    sleepBox.addEventListener('click', (e) => {
      const b = e.target.closest(".schip");
      if (!b) return;
      const v = b.dataset.v === 'end' ? 'end' : +b.dataset.v;
      setSleep(v);
      sleepBox.querySelectorAll(".schip").forEach((x) => x.classList.toggle('on', x === b));
      form.querySelector('[data-sleep-hint]').textContent = v === 'end' ? 'Stops when this song ends' : v ? `Pauses in about ${v} min` : 'Off';
    });
  }

  Settings.open = () => {
    openModal(`
      <div class="modal-head"><h3 class="modal-title">Settings</h3></div>
      <div class="set-scroll">
      <div class="set-sec"><h4>Sound</h4>${soundHTML()}</div>
      <div class="set-sec"><h4>Playback</h4>${playbackHTML()}</div>
      <div class="set-sec"><h4>Spotify</h4><div data-sp-sec>${spotifyHTML()}</div></div>
      <div class="set-sec"><h4>Updates</h4>
        <div class="set-row"><div><b>Glass ${esc(window.Updates?.state().version || '')}</b><span data-upd>${esc(window.Updates ? Updates.label() : '')}</span></div>
          <button type="button" class="btn" data-act-upd>Check now</button></div></div>
      <div class="set-sec"><h4>Glass</h4>
        <div class="set-row"><div><b>Style</b><span>Liquid bends the background at the glass edges. Frosted is lighter on older PCs.</span></div></div>
        ${chips('ui.style', [['liquid', 'Liquid'], ['frosted', 'Frosted']])}
        <div class="set-row"><div><b>Background</b><span>The song's artwork behind the glass, just its colours, or a picture of your own</span></div></div>
        ${chips('ui.wall', [['art', 'Artwork'], ['colors', 'Colours'], ['custom', 'Your image']])}
        <div class="set-row set-wall" data-wall-row><div><b>Your image</b><span data-wall-hint></span></div>
          <button type="button" class="btn" data-act="wallpaper">Choose image…</button></div>
        <div class="set-row"><div><b>Background blur <em class="set-val" data-wallblur></em></b><span>How soft the picture behind the glass looks</span></div>
          <input type="range" class="range" min="0" max="40" step="1" data-ui="wallBlur" /></div>
        ${toggle('ui.quickEdit', 'Quick edits', 'Right-click the cover to change it. Double-click the title, artist or album to rename it.')}
        <div class="set-row"><div><b>See-through window</b><span data-transp>Checking Windows…</span></div>
          <button type="button" class="btn" data-act="colors">Open Windows settings</button></div>
        <div class="set-row"><div><b>Color glow</b><span>How much the artwork tints the glass</span></div>
          <input type="range" class="range" min="0" max="100" data-ui="glow" /></div>
        <div class="set-row"><div><b>Glass darkness</b><span>Darker keeps text readable over bright windows</span></div>
          <input type="range" class="range" min="0" max="100" data-ui="tint" /></div>
      </div>
      </div>
      <div class="modal-actions"><span class="grow"></span><button type="submit" class="btn primary">Done</button></div>`, {
      onMount(form) {
        mountAudio(form);
        const updLine = form.querySelector('[data-upd]');
        if (window.Updates) Updates.onChange = (s) => { if (updLine.isConnected) updLine.textContent = Updates.label(s); };
        form.querySelector('[data-act-upd]').addEventListener('click', () => { updLine.textContent = 'Checking…'; Updates.check(); });
        // appearance sliders apply live
        for (const r of form.querySelectorAll('[data-ui]')) {
          r.value = S.ui[r.dataset.ui];
          setFill(r);
          r.addEventListener('input', () => { S.ui[r.dataset.ui] = +r.value; setFill(r); applyUi(); });
          r.addEventListener('change', () => save());
        }
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
          else if (a === 'reload') Spot.reload();
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
