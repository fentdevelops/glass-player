'use strict';
// Spotify inside Glass (Web Playback SDK, Premium): Glass registers as a Spotify Connect device called
// "Glass Player", so songs play here without the Spotify app open anywhere. Needs castlabs Electron (Widevine)
// and a Spotify sign-in that includes the 'streaming' scope. Everything else (browse, queue, controls) keeps
// using the Web API in spotify.js, which simply sees one more device.
//
// The connection heals itself: if Spotify refuses the player's sign-in, the player goes offline, or the song
// drops while Glass is still the device, Glass gets a fresh sign-in, starts a new player and carries on with
// the same song at the same spot. Every step goes into spotify-log.txt.
(() => {
  const sp = window.glass.spotify;
  let player = null, deviceId = null, state = 'off', message = '', scriptP = null;
  const listeners = new Set();
  const set = (st, msg = '') => { state = st; message = msg; listeners.forEach((f) => f()); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function loadSdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve();   // already loaded (or a test player)
    scriptP ??= new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onerror = () => { scriptP = null; reject(new Error("Couldn't load Spotify's player. Check your connection.")); };
      document.head.appendChild(s);
    });
    return scriptP;
  }

  // what is playing here, so a broken connection can pick the song up where it was
  let last = null;            // { uri, context, position, at, paused }
  let lastBody = null;        // the last list Glass sent to play (songs without a playlist or album around them)
  let resumeNext = null;      // while reconnecting: what to play once the new player is ready
  let healing = false, heals = [];

  // Spotify lists every player Glass ever made until that player signs off. One that never did (Glass
  // closed, a player replaced while starting) stays listed as a second "Glass Player" that plays nothing.
  const NAME = 'Glass Player';
  const ghost = (d) => !!d && d.name === NAME && d.id !== deviceId;   // a Glass Player that isn't this one
  const gone = new WeakSet();   // players Glass has switched off
  // start() can be asked twice at once (sign-in, Play, a reconnect): only one player is ever made,
  // and stop() while one is starting cancels that one
  let starting = null, epoch = 0, freshNext = false;
  function start(opts = {}) {
    if (opts.fresh) freshNext = true;
    if (starting && starting.epoch === epoch) return starting.run;
    const s = { epoch, run: null };
    starting = s;
    s.run = begin(epoch).finally(() => { if (starting === s) starting = null; });
    return s.run;
  }

  async function begin(my) {
    if (player) return;
    const st = await sp.status().catch(() => ({}));
    if (my !== epoch || player) return;
    // the test mock never loads Spotify's real player; tests hand Glass a stand-in instead
    if (!st.connected || (st.mock && !(window.Spotify && window.Spotify.Player))) { set('off'); return; }
    if (!st.canStream) { set('reconnect', 'Reconnect Spotify once to allow playing inside Glass.'); return; }
    if (st.user && st.user.product && st.user.product !== 'premium') { set('error', 'Playing inside Glass needs Spotify Premium.'); return; }
    // Without the castlabs signature Spotify refuses every song here and skips through the queue,
    // so Glass doesn't offer itself as a device until the build is signed.
    if (!st.vmp) { set('unsigned', 'One more step: this Glass build isn’t signed for Spotify yet, so Spotify plays on your other devices.'); return; }
    set('loading', freshNext ? 'Reconnecting the Glass player…' : 'Starting the Glass player…');
    try { await loadSdk(); } catch (e) { if (my === epoch) { sp.log(`player: ${e.message}`); set('error', e.message); } return; }
    if (my !== epoch || player) return;
    const p = new window.Spotify.Player({
      name: NAME,
      getOAuthToken: (cb) => {
        const f = freshNext;
        freshNext = false;
        sp.token(f).then(cb).catch((e) => {
          sp.log(`player: no sign-in token (${(e && e.message) || e})`);
          set('error', 'Spotify sign-in expired. Reconnect in Settings.');
        });
      },
      volume: Math.max(0, Math.min(1, (+$('#vol').value || 60) / 100)),
    });
    player = p;
    const mine = () => player === p;
    // a player Glass has replaced is switched off the moment it speaks up, so it can't stay on Spotify
    // as a second "Glass Player"; its events are ignored
    const stale = () => {
      if (player === p) return false;
      if (!gone.has(p)) { gone.add(p); try { p.disconnect(); } catch { /* already gone */ } }
      return true;
    };
    p.addListener('ready', async ({ device_id }) => {
      if (stale()) return;
      deviceId = device_id;
      sp.log('player: ready as a Spotify device');
      set('ready', 'Glass is a Spotify device. Songs can play right here.');
      const again = resumeNext;
      resumeNext = null;
      healing = false;
      if (again) { await pickUp(again); noteGhosts(); window.Spot?.refreshNow?.(); return; }
      // nothing playing anywhere: make Glass the active device so Play just works. If Spotify points at an
      // old Glass Player left behind by an earlier Glass, take over from it (it can't play anything).
      try {
        const now = await sp.api('GET', '/me/player', null, null);
        const dev = now.ok && now.data && now.data.device;
        if (!dev || !dev.is_active || ghost(dev)) {
          if (dev && ghost(dev)) sp.log('player: Spotify pointed at an old Glass Player, taking over here');
          await sp.api('PUT', '/me/player', null, { device_ids: [device_id], play: !!(dev && ghost(dev) && now.data.is_playing) });
        }
      } catch { /* the first Play will pick it */ }
      noteGhosts();
      window.Spot?.refreshNow?.();
    });
    p.addListener('not_ready', () => {
      if (stale()) return;
      deviceId = null;
      sp.log('player: dropped off Spotify');
      set('loading', 'Reconnecting the Glass player…');
      // it usually comes back by itself; if it hasn't within 15 s, start a new one
      setTimeout(() => { if (mine() && !deviceId) heal('offline for 15 s'); }, 15000);
    });
    p.addListener('initialization_error', ({ message: m }) => { if (!stale()) giveUp(`This Glass build can't play Spotify (${m}).`, m); });
    // a refused sign-in used to switch the player off for good (it waited for "Reconnect" in Settings);
    // now Glass fetches a fresh sign-in and reconnects by itself
    p.addListener('authentication_error', ({ message: m }) => { if (!stale()) heal(`sign-in refused (${m})`); });
    p.addListener('account_error', ({ message: m }) => { if (!stale()) giveUp('Playing inside Glass needs Spotify Premium.', `account: ${m}`); });
    // one error can be a hiccup; a second within 30 s means songs can't play here: stop being a device
    // (Spotify would otherwise skip through the whole queue) and move playback somewhere that works
    let fails = [];
    p.addListener('playback_error', ({ message: m }) => {
      if (stale()) return;
      sp.log(`player error: ${m}`);
      const t = Date.now();
      fails = fails.filter((x) => t - x < 30000).concat(t);
      if (fails.length >= 2) giveUp(`Spotify couldn't play inside Glass (${m}), so it's playing on your other devices.`, m);
      else toast(`Spotify: ${m}`, true);
    });
    // the browser didn't let the music start by itself: the next click or key press in Glass starts it
    p.addListener('autoplay_failed', () => {
      if (stale()) return;
      sp.log('player: autoplay blocked, waiting for a click');
      toast('Click anywhere in Glass to start the music');
      const go = () => {
        window.removeEventListener('pointerdown', go, true);
        window.removeEventListener('keydown', go, true);
        Promise.resolve(mine() && p.activateElement()).then(() => mine() && p.resume()).catch(() => { /* noted if it stays stuck */ });
        sp.log('player: started after a click');
      };
      window.addEventListener('pointerdown', go, true);
      window.addEventListener('keydown', go, true);
    });
    // what the player itself says (playing, paused, still loading), noted whenever that changes
    let lastSdk = '';
    p.addListener('player_state_changed', (s) => {
      if (stale()) return;
      const tr = s && s.track_window && s.track_window.current_track;
      const line = !s ? 'sdk: no song here' : `sdk: ${s.paused ? 'paused' : 'playing'}${s.loading ? ', loading' : ''} at ${Math.round((s.position || 0) / 1000)}s${tr ? ' · ' + tr.name : ''}`;
      if (line !== lastSdk) { lastSdk = line; sp.log(line); }
      if (tr) last = { uri: tr.uri, context: (s.context && s.context.uri) || '', position: s.position || 0, at: Date.now(), paused: !!s.paused };
      else if (!s && last && !last.paused && !healing) checkDrop(p, last);
      window.Spot?.refreshNow?.();
    });
    const ok = await p.connect();
    if (!ok && mine() && state === 'loading') { sp.log("player: couldn't connect to Spotify"); healing = false; set('error', "Couldn't connect the Glass player to Spotify."); }
  }

  // The song left Glass while it was playing. If Spotify now names another device, someone moved it there:
  // leave it. If it still names Glass (or nothing), the connection broke: reconnect and carry on.
  async function checkDrop(p, was) {
    await wait(1500);
    if (player !== p || healing) return;
    const s = await p.getCurrentState().catch(() => null);
    if (s && s.track_window && s.track_window.current_track) return;   // it came back by itself
    const r = await sp.api('GET', '/me/player', null, null).catch(() => null);
    const dev = r && r.ok && r.data && r.data.device;
    if (dev && dev.id && dev.id !== deviceId && dev.is_active) {
      if (!ghost(dev)) { sp.log(`player: playback moved to ${dev.name}`); return; }
      // Spotify handed the song to an old Glass Player left behind by an earlier Glass: bring it back here
      sp.log('player: Spotify moved the song to an old Glass Player, bringing it back');
      const back = await sp.api('PUT', '/me/player', null, { device_ids: [deviceId], play: true }).catch(() => null);
      if (back && back.ok) { window.Spot?.refreshNow?.(); return; }
    }
    heal('the song dropped', was);
  }

  // say once (per count) when Spotify still lists old Glass Players, so the log shows why there are two
  let ghostsNoted = 0;
  async function noteGhosts() {
    const r = await sp.api('GET', '/me/player/devices', null, null).catch(() => null);
    const n = ((r && r.ok && r.data && r.data.devices) || []).filter(ghost).length;
    if (n && n !== ghostsNoted) sp.log(`player: Spotify still lists ${n} old Glass Player${n > 1 ? 's' : ''} from before; Glass hides ${n > 1 ? 'them' : 'it'} and plays here`);
    ghostsNoted = n;
  }

  async function heal(why, was = last) {
    if (healing) return;
    healing = true;
    const t = Date.now();
    heals = heals.filter((x) => t - x < 600000).concat(t);
    if (heals.length > 3) {
      sp.log(`player: ${why}; reconnected 3 times in 10 minutes already, so stopping until you press Play`);
      healing = false;
      stop();
      set('error', 'Spotify keeps dropping inside Glass. Press Play to try again.');
      toast('Spotify keeps dropping inside Glass. Press Play to try again.', true);
      return;
    }
    sp.log(`player: ${why}, reconnecting`);
    // carry on where it was, if it was playing (the song kept moving while Glass noticed)
    resumeNext = was && !was.paused ? { ...was, position: was.position + (Date.now() - was.at) } : null;
    stop();
    await wait(700 * heals.length);
    await start({ fresh: true });
    if (!player) { healing = false; resumeNext = null; }
  }

  // play the same song, at the same spot, inside the same playlist / album / list when Glass knows it
  async function pickUp(w) {
    const at = Math.max(0, Math.round(w.position));
    const ctx = w.context && /^spotify:(album|playlist):/.test(w.context) ? w.context : '';
    const list = !ctx && lastBody && lastBody.uris && lastBody.uris.includes(w.uri) ? lastBody.uris.slice(lastBody.uris.indexOf(w.uri)) : null;
    const body = ctx ? { context_uri: ctx, offset: { uri: w.uri }, position_ms: at } : { uris: list || [w.uri], position_ms: at };
    let r = await sp.api('PUT', '/me/player/play', { device_id: deviceId }, body).catch((e) => ({ ok: false, message: e.message }));
    if (!r.ok && ctx) r = await sp.api('PUT', '/me/player/play', { device_id: deviceId }, { uris: [w.uri], position_ms: at }).catch((e) => ({ ok: false, message: e.message }));
    sp.log(r.ok ? `player: back, carrying on at ${Math.round(at / 1000)}s` : `player: back, but couldn't carry on (${r.message || r.status})`);
  }

  async function giveUp(msg, why) {
    const id = deviceId;
    sp.log(`glass player off: ${why}`);
    stop();
    set('error', msg);
    toast(msg, true);
    try {
      const r = await sp.api('GET', '/me/player/devices', null, null);
      const ds = ((r.ok && r.data && r.data.devices) || []).filter((d) => d.id !== id && d.name !== NAME && !d.is_restricted);
      const to = ds.find((d) => d.type === 'Computer') || ds[0];
      if (to) await sp.api('PUT', '/me/player', null, { device_ids: [to.id], play: true });
      else await sp.api('PUT', '/me/player/pause', null, null);
    } catch { /* nothing else to play on */ }
    window.Spot?.refreshNow?.();
  }
  // switches the player off; disconnect() is what tells Spotify to drop it from your devices
  function stop() {
    const p = player;
    epoch++;                      // a player still starting is cancelled too
    player = null; deviceId = null;
    if (p) gone.add(p);
    try { p?.disconnect(); } catch { /* already gone */ }
    set('off');
  }

  // Glass is closing: sign the player off first, so Spotify doesn't keep a "Glass Player" that plays nothing.
  // Main waits for Spotify to confirm (at most 1.5 s) before the window goes.
  sp.onSignOff?.(() => {
    const had = !!deviceId;
    if (had) sp.log('player: Glass is closing, signing off Spotify');
    stop();
    sp.signedOff?.(had);
  });

  // Before Play: if the player stopped (an error, or it gave up after drops), start it again and wait for it.
  // Pressing Play is the user asking to try again.
  async function ensure() {
    if (player && deviceId) return true;
    if (['unsigned', 'reconnect'].includes(state)) return false;
    if (!player) { heals = []; await start(); }
    for (let i = 0; i < 40 && !deviceId && player; i++) await wait(200);
    return !!deviceId;
  }

  // After Glass is told to play: if the song still sits at 0:00 a few seconds later, push it from inside
  // (unlock audio, then the player's own resume) and note what happened, so a silent stall shows in the log.
  let watchTok = 0;
  function watch() {
    const tok = ++watchTok;
    setTimeout(async () => {
      if (tok !== watchTok || !player) return;
      const s = await player.getCurrentState().catch(() => null);
      if (!s || !s.paused || s.position > 1500) return;      // playing, or the song isn't on Glass
      sp.log(`player: stuck at 0:00${s.loading ? ' (still loading)' : ''}, nudging it`);
      try { await player.activateElement(); await player.resume(); } catch { /* noted below */ }
      setTimeout(async () => {
        if (tok !== watchTok || !player) return;
        const s2 = await player.getCurrentState().catch(() => null);
        sp.log(!s2 ? 'player: the song left Glass' : s2.paused ? `player: still stuck${s2.loading ? ' (loading)' : ''}` : 'player: playing after the nudge');
      }, 3000);
    }, 3500);
  }

  window.SpotPlayer = {
    start, stop, ensure,
    deviceId: () => deviceId,
    ghost,                        // spotify.js: hide old Glass Players and move music off them
    watch,
    unwatch: () => { watchTok++; },
    sent: (body) => { if (body && body.uris) lastBody = body; },   // spotify.js: the list it just asked to play
    state: () => state,
    message: () => message,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    // Chromium only allows audio after a user gesture; the SDK needs this once per launch
    activate: () => { try { Promise.resolve(player?.activateElement?.()).catch(() => {}); } catch { /* fine */ } },
  };
})();
