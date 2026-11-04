'use strict';
// Spotify inside Glass (Web Playback SDK, Premium): Glass registers as a Spotify Connect device called
// "Glass Player", so songs play here without the Spotify app open anywhere. Needs castlabs Electron (Widevine)
// and a Spotify sign-in that includes the 'streaming' scope. Everything else (browse, queue, controls) keeps
// using the Web API in spotify.js, which simply sees one more device.
(() => {
  const sp = window.glass.spotify;
  let player = null, deviceId = null, state = 'off', message = '', scriptP = null;
  const listeners = new Set();
  const set = (st, msg = '') => { state = st; message = msg; listeners.forEach((f) => f()); };

  function loadSdk() {
    scriptP ??= new Promise((resolve, reject) => {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
      const s = document.createElement('script');
      s.src = 'https://sdk.scdn.co/spotify-player.js';
      s.onerror = () => { scriptP = null; reject(new Error("Couldn't load Spotify's player. Check your connection.")); };
      document.head.appendChild(s);
    });
    return scriptP;
  }

  async function start() {
    if (player || state === 'loading') return;
    const st = await sp.status().catch(() => ({}));
    if (!st.connected || (st.mock && !st.vmp)) { set('off'); return; }
    if (!st.canStream) { set('reconnect', 'Reconnect Spotify once to allow playing inside Glass.'); return; }
    if (st.user && st.user.product && st.user.product !== 'premium') { set('error', 'Playing inside Glass needs Spotify Premium.'); return; }
    // Without the castlabs signature Spotify refuses every song here and skips through the queue,
    // so Glass doesn't offer itself as a device until the build is signed.
    if (!st.vmp) { set('unsigned', 'One more step: this Glass build isn\u2019t signed for Spotify yet, so Spotify plays on your other devices.'); return; }
    set('loading', 'Starting the Glass player…');
    try { await loadSdk(); } catch (e) { set('error', e.message); return; }
    player = new window.Spotify.Player({
      name: 'Glass Player',
      getOAuthToken: (cb) => { sp.token().then(cb).catch(() => set('error', 'Spotify sign-in expired. Reconnect in Settings.')); },
      volume: Math.max(0, Math.min(1, (+$('#vol').value || 60) / 100)),
    });
    player.addListener('ready', async ({ device_id }) => {
      deviceId = device_id;
      set('ready', 'Glass is a Spotify device. Songs can play right here.');
      // nothing playing anywhere: make Glass the active device so Play just works
      try {
        const now = await sp.api('GET', '/me/player', null, null);
        if (!now.ok || !now.data || !now.data.device || !now.data.device.is_active) await sp.api('PUT', '/me/player', null, { device_ids: [device_id], play: false });
      } catch { /* the first Play will pick it */ }
      window.Spot?.refreshNow?.();
    });
    player.addListener('not_ready', () => { deviceId = null; set('loading', 'Reconnecting the Glass player…'); });
    player.addListener('initialization_error', ({ message: m }) => giveUp(`This Glass build can't play Spotify (${m}).`, m));
    player.addListener('authentication_error', () => { stop(); set('reconnect', 'Reconnect Spotify once to allow playing inside Glass.'); });
    player.addListener('account_error', () => giveUp('Playing inside Glass needs Spotify Premium.', 'account'));
    // one error can be a hiccup; a second within 30 s means songs can't play here: stop being a device
    // (Spotify would otherwise skip through the whole queue) and move playback somewhere that works
    let fails = [];
    player.addListener('playback_error', ({ message: m }) => {
      sp.log(`player error: ${m}`);
      const t = Date.now();
      fails = fails.filter((x) => t - x < 30000).concat(t);
      if (fails.length >= 2) giveUp(`Spotify couldn't play inside Glass (${m}), so it's playing on your other devices.`, m);
      else toast(`Spotify: ${m}`, true);
    });
    // the SDK knows the moment a song changes or pauses here: refresh the dock right away instead of waiting for a poll
    player.addListener('player_state_changed', () => window.Spot?.refreshNow?.());
    const ok = await player.connect();
    if (!ok && state === 'loading') set('error', "Couldn't connect the Glass player to Spotify.");
  }
  async function giveUp(msg, why) {
    const id = deviceId;
    sp.log(`glass player off: ${why}`);
    stop();
    set('error', msg);
    toast(msg, true);
    try {
      const r = await sp.api('GET', '/me/player/devices', null, null);
      const ds = ((r.ok && r.data && r.data.devices) || []).filter((d) => d.id !== id && !d.is_restricted);
      const to = ds.find((d) => d.type === 'Computer') || ds[0];
      if (to) await sp.api('PUT', '/me/player', null, { device_ids: [to.id], play: true });
      else await sp.api('PUT', '/me/player/pause', null, null);
    } catch { /* nothing else to play on */ }
    window.Spot?.refreshNow?.();
  }
  function stop() {
    try { player?.disconnect(); } catch { /* already gone */ }
    player = null; deviceId = null;
    set('off');
  }

  window.SpotPlayer = {
    start, stop,
    deviceId: () => deviceId,
    state: () => state,
    message: () => message,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f); },
    // Chromium only allows audio after a user gesture; the SDK needs this once per launch
    activate: () => { try { player?.activateElement?.(); } catch { /* fine */ } },
  };
})();
