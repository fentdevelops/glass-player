'use strict';
// GlassDeck: two-deck playback engine for Glassy (browser global window.GlassDeck, no deps).
//
// Two <video> elements (they play audio files too) feed one AudioWorklet ("glass-seam", deck-worklet.js)
// that runs each deck through a few-millisecond delay line. That buffer is what makes album transitions
// exact: the next track is started a little early, held back, and released on the sample right after the
// current track's last one. The worklet also owns every fade (crossfades, skips, pause, seek, stop), so a
// fade starts on the sample where the audio really arrives, not whenever a main-thread timer fired.
//
// Graph: <video> -> MediaElementSource -> seam (delay, envelope, duck per deck) -> bus -> analyser (visuals)
//                                                                                    \-> master (v^2, mute) -> out
//
// Scheduling uses setTimeout + media events only (never rAF), so it keeps working while minimised.
(function () {
  const VIDEO_RE = /\.(mp4|m4v|webm|mkv|mov)$/i;
  const now = () => performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const folderOf = (p) => { p = String(p || ''); return p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))); };
  const eqp = (g0, g1, n = 64) => Float32Array.from({ length: n }, (_, i) => {
    const p = i / (n - 1), s = Math.sin(p * Math.PI / 2), c = Math.cos(p * Math.PI / 2);
    return Math.sqrt(g0 * g0 * c * c + g1 * g1 * s * s);
  });

  class GlassDeck extends EventTarget {
    // consecutive tracks of one album stay gapless even when crossfade is on
    static sameAlbum(a, b) {
      if (!a || !b || !a.album || !b.album) return false;
      if (a.album.trim().toLowerCase() !== b.album.trim().toLowerCase()) return false;
      if (folderOf(a.path) !== folderOf(b.path)) return false;
      return !(a.trackNo && b.trackNo) || b.trackNo === a.trackNo + 1;
    }

    constructor(opts = {}) {
      super();
      this.o = {
        elements: null,             // two existing <video> elements, or
        host: null,                 // an element to create them in
        videoClass: 'deck',
        planner: () => null,        // (afterItem, { reason }) => next item | null. Called once per transition
        isGapless: GlassDeck.sameAlbum,
        urlOf: (it) => it.url,
        keyOf: (it) => it.path,
        isVideo: (it) => VIDEO_RE.test(String(it?.path || it?.url || '')),
        crossfade: 0,               // seconds for non-album transitions; 0 = gapless everywhere
        maxCrossfadeShare: 0.45,    // of either track's length (a deck cannot fade in and out at once)
        skipFadeMs: 180,            // manual next / prev / jump
        startFadeMs: 6,             // start from silence: removes a start click, keeps the attack
        resumeFadeMs: 40,           // pause / resume
        seekFadeMs: 18,             // out before a seek ...
        seekInMs: 30,               // ... and in once the new position sounds
        stopFadeMs: 30,
        leadMs: 50,                 // how early the next audio track is started (and held in the worklet)
        videoXfadeMs: 120,          // video transitions: a short crossfade instead of a held splice, because
                                    // holding a video's sound back would put it behind its picture
        holdForLoadMs: 250,         // keep the old track playing this long while a skip target loads
        preloadAfterMs: 800,        // let a new track settle before loading the one after it
        rewarmIdleMs: 12000,        // re-prime a preloaded deck that has sat idle this long
        suspendAfterMs: 15000,      // let the audio device sleep after a long pause
        loadTimeoutMs: 10000,       // a file that never becomes playable counts as an error
        videoFadeMs: 250,           // picture dissolve at gapless / skip transitions (crossfades follow the sound)
        sampleRate: 44100,          // CD rate: most music reaches the decks without resampling
        latencyHint: 'interactive',
        workletUrl: 'deck-worklet.js',
        declick: true,              // smooth hard steps at gapless joints (separately mastered tracks)
        loopDeclick: true,          // native loop: fade the last/first 2.9 ms around the loop gap
        repeatOneMode: 'loop',      // 'loop': native element loop, no deck swap (~9.5 ms gap, de-clicked)
                                    // 'splice': the idle deck preloads the same file -> gapless loop
        maxErrorSkips: 25,
        fallbackLeadMs: 20,         // timer-only mode (no worklet): start this early, 14 ms micro-crossfade
        seam: { D: 256, Z: 64, XN: 128 },
        ...opts,
      };
      this.crossfade = +this.o.crossfade || 0;
      this.repeatOne = false;
      this.volume = 1;
      this.muted = false;
      this.userPaused = true;
      this.cur = null;        // deck of the track that is "now playing"
      this.out = null;        // deck still fading out after a transition
      this.plan = null;       // { item, key, fails } | false (end of queue) | null (not planned yet)
      this.pending = null;    // automatic transition started in the worklet but not audible yet
      this.jumping = false;
      this.holds = new Set(); // keys released for a rename / tag write: nothing may open them
      this.seq = 0; this.jumpTok = 0;
      this.errStreak = 0; this.leadAdj = 0; this.curSince = 0;
      this.log = [];          // worklet reports (tests, tuning)
      this.ready = this._init();
    }

    // ---------- public state ----------
    get item() { return this.cur?.item || null; }
    get currentTime() {
      const c = this.cur;
      if (!c?.item) return 0;
      if (c.state === 'held') return c.heldAt;
      return c.seekPhase ? c.seekTarget : c.el.currentTime;
    }
    get duration() { const d = this.cur?.el.duration; return isFinite(d) ? d : (this.cur?.item?.duration || 0); }
    get paused() { return this.userPaused || !this.cur?.item; }
    get videoElement() { return this.cur?.item ? this.cur.el : null; }
    get elements() { return this.decks.map((d) => d.el); }
    get plannedItem() { return this._plan()?.item || null; }
    on(name, fn) { this.addEventListener(name, (e) => fn(e.detail)); return this; }

    // ---------- setup ----------
    async _init() {
      const o = this.o;
      const ctx = this.ctx = new AudioContext({ ...(o.sampleRate ? { sampleRate: o.sampleRate } : {}), latencyHint: o.latencyHint });
      this.sr = ctx.sampleRate;
      this.D = o.seam.D;
      this.decks = [0, 1].map((i) => this._mkDeck(i));
      const bus = ctx.createGain();
      this.master = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.82;
      try {
        await ctx.audioWorklet.addModule(o.workletUrl);
        this.seam = new AudioWorkletNode(ctx, 'glass-seam', {
          numberOfInputs: 2, numberOfOutputs: 2, outputChannelCount: [2, 2],
          channelCount: 2, channelCountMode: 'clamped-max', channelInterpretation: 'speakers',
          processorOptions: { cfg: o.seam },
        });
        this.seam.port.onmessage = (e) => this._onSeam(e.data);
        for (const d of this.decks) { d.src.connect(this.seam, 0, d.i); this.seam.connect(bus, d.i, 0); }
      } catch (err) {
        // no worklet (packaging problem): plain gains, transitions timed from the main thread only
        console.warn('GlassDeck: worklet unavailable, timer-only transitions', err);
        this.seam = null;
        for (const d of this.decks) { d.gain = ctx.createGain(); d.duckG = ctx.createGain(); d.src.connect(d.gain).connect(d.duckG).connect(bus); }
      }
      bus.connect(this.analyser);            // before volume: the visuals follow the music, not the slider
      bus.connect(this.master).connect(ctx.destination);
      this.nodes = { bus, master: this.master, analyser: this.analyser, seam: this.seam };
      this._applyVolume(true);
      // nothing plays yet: let the audio device sleep until the first play (jump/play wake it)
      this._suspendT = setTimeout(() => { if (this.userPaused) this.ctx.suspend().catch(() => {}); }, this.o.suspendAfterMs);
    }

    _mkDeck(i) {
      let el = this.o.elements?.[i];
      if (!el) {
        el = document.createElement('video');
        if (this.o.host) this.o.host.appendChild(el);
      }
      el.preload = 'auto';
      el.playsInline = true;
      el.disablePictureInPicture = true;
      el.classList.add(this.o.videoClass);
      el.dataset.deck = i;
      Object.assign(el, { volume: 1, muted: false });          // level lives in the graph
      const d = { i, el, src: this.ctx.createMediaElementSource(el), item: null, key: null, state: 'empty', delay: this.D, token: 0, loadedAt: 0, rewarmed: false, open: false, rearmed: false, seekPhase: null, seekTarget: 0, heldAt: 0 };
      el.addEventListener('ended', () => this._onEnded(d));
      el.addEventListener('error', () => this._onElError(d));
      el.addEventListener('timeupdate', () => { if (d === this.cur && d.item && !d.seekPhase) this._emit('time', { item: d.item, currentTime: el.currentTime, duration: this.duration }); });
      el.addEventListener('loadedmetadata', () => {
        if (!d.item) return;
        if (d === this.cur) { this._emit('meta', this._meta(d)); this._showVideo(d, this.o.videoFadeMs); } else this._emit('preloaded', this._meta(d));
      });
      el.addEventListener('durationchange', () => { if (d === this.cur && d.item) { this._emit('meta', this._meta(d)); this._kick(); } });
      el.addEventListener('playing', () => { if (d === this.cur) { this.errStreak = 0; this._kick(); } });
      el.addEventListener('seeked', () => this._onSeeked(d));
      return d;
    }

    _meta(d) { return { item: d.item, duration: isFinite(d.el.duration) ? d.el.duration : 0, isVideo: d.el.videoWidth > 0, width: d.el.videoWidth, height: d.el.videoHeight }; }
    _trace(tag, o) { if (!this.o.trace) return; (this.traceLog ||= []).push({ tag, perf: +now().toFixed(2), frame: Math.round(this.ctx.currentTime * this.sr), ...o }); }
    _emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail })); }
    _other(d) { return this.decks[1 - d.i]; }
    _fr(ms) { return Math.round((ms * this.sr) / 1000); }
    _ms(fr) { return (fr * 1000) / this.sr; }
    _post(m) { if (this.seam) this.seam.port.postMessage(m); else this._fallback(m); }
    // quietAt: when a deck ducked to 0 is really silent (its delay line drained); nothing may cut it before
    _duck(d, to, ms) { this._post({ t: 'duck', deck: d.i, to, frames: this._fr(ms) }); d.quietAt = to === 0 ? now() + ms + this._ms(d.delay) + 3 : 0; }
    _sounding(d) { return !!d && !!d.item && d.open && !d.el.paused && !this.userPaused; }
    _planFor(item, reason) {
      try { return this.o.planner(item, { reason }) || null; } catch (err) { console.error('GlassDeck planner', err); return null; }
    }

    // ---------- loading ----------
    _load(d, item, at = 0) {
      const token = ++d.token;
      this._post({ t: 'close', deck: d.i });
      d.open = false; d.rearmed = false; d.seekPhase = null; clearTimeout(d.seekWd);
      d.delay = this.D;
      d.item = item; d.key = this.o.keyOf(item); d.state = 'loading'; d.loadedAt = now(); d.rewarmed = false;
      const el = d.el;
      el.loop = false;
      el.src = this.o.urlOf(item);
      const p = new Promise((resolve, reject) => {
        const finish = (ok, why) => {
          clearTimeout(timer);
          el.removeEventListener('loadedmetadata', onMeta); el.removeEventListener('canplay', onCan);
          el.removeEventListener('seeked', onCan); el.removeEventListener('error', onErr); el.removeEventListener('abort', onAbort);
          if (token !== d.token) return reject(new Error('superseded'));
          d.state = ok ? 'ready' : 'error';
          ok ? resolve(d) : reject(why);
        };
        const onMeta = () => { if (at > 0 && isFinite(el.duration)) el.currentTime = Math.min(at, Math.max(0, el.duration - 0.05)); };
        const onCan = () => { if (!el.seeking && el.readyState >= 3) finish(true); };
        const onErr = () => finish(false, Object.assign(new Error('load failed'), { code: el.error?.code }));
        const onAbort = () => { if (token !== d.token) finish(false); };
        const timer = setTimeout(() => finish(false, Object.assign(new Error('load timeout'), { code: 0 })), this.o.loadTimeoutMs);
        el.addEventListener('abort', onAbort);
        el.addEventListener('loadedmetadata', onMeta);
        el.addEventListener('canplay', onCan);
        el.addEventListener('seeked', onCan);
        el.addEventListener('error', onErr);
      });
      p.catch(() => {});
      return (d.ready = p);
    }

    // keep = the deck stays "the current track" while its file is released (rename, tag write)
    _unload(d, keep = false) {
      d.token++;
      this._post({ t: 'close', deck: d.i });
      d.open = false; d.rearmed = false; d.seekPhase = null; clearTimeout(d.seekWd);
      d.el.pause();
      d.el.removeAttribute('src');
      d.el.load();
      if (keep) { d.state = 'held'; return; }
      d.item = null; d.key = null; d.state = 'empty';
    }

    // The outgoing deck is done. It is ducked out first (a later fade may still be running on it, so a
    // timer must never be what silences it), paused, and its gate closed once the delay line has drained.
    // The deck keeps its file until reused or released.
    _retire(d) {
      if (d.item) d.state = 'spent';
      if (d.retiring) return;
      d.retiring = true;
      const tok = d.token, silent = d.el.paused || d.el.ended || !d.open;
      if (!silent) this._duck(d, 0, 20);
      const live = () => d.token === tok && d !== this.cur;   // not reloaded or reused meanwhile
      setTimeout(() => {
        if (!live()) { d.retiring = false; return; }
        d.el.pause();
        setTimeout(() => {
          d.retiring = false;
          if (!live()) return;
          this._post({ t: 'close', deck: d.i });
          d.open = false;
          if (this.out === d) this.out = null;
          this._kick();
        }, this._ms(d.delay) + 15);
      }, silent ? 0 : 24 + this._ms(d.delay));
    }

    // ---------- planning ----------
    _plan() {
      if (this.plan !== null) return this.plan || null;
      const c = this.cur;
      if (!c || !c.item) return null;
      if (this.repeatOne && this.o.repeatOneMode === 'splice') return (this.plan = { item: c.item, key: c.key, fails: 0, loop: true });
      const it = this._planFor(c.item, 'next');
      this.plan = it ? { item: it, key: this.o.keyOf(it), fails: 0 } : false;
      return this.plan || null;
    }

    // queue, order, shuffle or repeat changed: plan again, keep the preload if it is still right
    invalidate() {
      const old = this.plan || null;
      this.plan = null;
      const p = this._plan();
      if (old && p && old.key === p.key) this.plan = old;
      else if (this.pending) this._cancelPending();
      this._noFire();
      this._kick();
    }

    _ensurePreload() {
      const c = this.cur;
      if (!c || !c.item || this.jumping) return;
      const plan = this._plan();
      if (!plan || this.holds.has(plan.key)) return;
      const nd = this._other(c);
      if (nd === this.out || this.pending) return;
      if (nd.key === plan.key && (nd.state === 'ready' || nd.state === 'loading')) return;
      const rem = (c.el.duration || 0) - c.el.currentTime;
      if (now() - this.curSince < this.o.preloadAfterMs && !(rem < 4)) return;
      this._load(nd, plan.item).then(() => this._kick(), (err) => {
        if (err.message === 'superseded' || this.plan !== plan) return;
        this._emit('error', { item: plan.item, where: 'preload', error: err });
        const fails = plan.fails + 1;
        const next = fails > this.o.maxErrorSkips ? null : this._planFor(plan.item, 'error');
        this.plan = next ? { item: next, key: this.o.keyOf(next), fails } : false;
        this._kick();
      });
    }

    // ---------- scheduler (timers + media events only) ----------
    _kick() { clearTimeout(this._tt); this._tt = setTimeout(() => this._tick(), 0); }
    _noFire() { clearTimeout(this._ft); this._fireAt = 0; }
    _later(ms) { clearTimeout(this._tt); this._tt = setTimeout(() => this._tick(), ms); }

    _kindFor(c, plan, nd) {
      let xf = plan.loop ? 0 : this.crossfade;
      if (xf > 0 && this.o.isGapless(c.item, plan.item)) xf = 0;
      const share = this.o.maxCrossfadeShare;
      if (xf > 0) xf = Math.min(xf, (c.el.duration || 0) * share, isFinite(nd.el.duration) ? nd.el.duration * share : xf);
      const video = this.o.isVideo(c.item) || this.o.isVideo(plan.item);
      if (!(xf >= 0.5) && video) {
        // a video's decoder starts slower and less predictably: leave it more room
        return { type: 'xfade', xfMs: this.o.videoXfadeMs, fireOffset: this._ms(c.delay - this.D) - this.o.videoXfadeMs - 150 };
      }
      if (!(xf >= 0.5)) {
        if (!this.seam) return { type: 'gapless', lead: this.o.fallbackLeadMs, fireOffset: -this.o.fallbackLeadMs };
        const lead = this.o.leadMs + this.leadAdj;
        return { type: 'gapless', lead, fireOffset: this._ms(c.delay - this.D) - lead };
      }
      // the outgoing gain reaches 0 a little before its last sample, so prediction error never cuts it off
      return { type: 'xfade', xfMs: xf * 1000, fireOffset: this._ms(c.delay - this.D) - xf * 1000 - 60 };
    }

    _tick() {
      clearTimeout(this._tt);
      const c = this.cur;
      if (!c || !c.item || this.userPaused) return;           // play(), jump() and invalidate() kick it again
      if (this.pending || this.jumping) return this._later(400);
      this._ensurePreload();
      const nativeLoop = this.repeatOne && this.o.repeatOneMode !== 'splice';
      c.el.loop = nativeLoop;
      // an 'ended' that could not act (a file was held for a rename) is retried from here
      if (c.state === 'ready' && c.el.ended && !nativeLoop && !c.seekPhase) { this._onEnded(c); return this._later(250); }
      if (c.state !== 'ready' || c.el.paused || c.el.seeking || c.seekPhase) return this._later(250);
      if (nativeLoop) {
        // let the worklet de-click the loop point: fade the end, fade in the restart
        const t = c.el.currentTime, rem = ((c.el.duration || 0) - t) * 1000 / (c.el.playbackRate || 1);
        if (c.lastCt != null && t + 0.5 < c.lastCt) c.loopArmed = false;
        c.lastCt = t;
        if (this.o.loopDeclick && !c.loopArmed && isFinite(rem) && rem < 250) { c.loopArmed = true; this._post({ t: 'loopwatch', deck: c.i, endIn: this._fr(rem), tol: this._fr(35) }); }
        return this._later(isFinite(rem) && rem > 320 ? Math.min(1000, rem - 260) : 60);
      }
      const plan = this._plan();
      if (!plan) return this._later(1000);
      const nd = this._other(c);
      if (nd === this.out) return this._later(250);
      const dur = c.el.duration;
      if (!isFinite(dur) || dur <= 0) return this._later(500);
      const kind = this._kindFor(c, plan, nd);
      const fireIn = (dur - c.el.currentTime) * 1000 / (c.el.playbackRate || 1) + kind.fireOffset;
      this._trace('tick', { fireIn: +fireIn.toFixed(2), ct: c.el.currentTime, dur, delay: c.delay, kind: kind.type, ndReady: nd.state, ndKey: nd.key === plan.key });
      // Chromium may suspend a paused pipeline that sat idle; a seek re-primes it well before it is needed
      if (fireIn < 2500 && nd.state === 'ready' && !nd.rewarmed && now() - nd.loadedAt > this.o.rewarmIdleMs) {
        nd.rewarmed = true;
        nd.el.currentTime = 0;
      }
      if (nd.key !== plan.key || nd.state !== 'ready' || nd.el.seeking) return this._later(Math.max(15, Math.min(200, fireIn)));
      if (fireIn > 1500) return this._later(Math.min(1000, fireIn - 1000));
      if (fireIn > 40) return this._later(fireIn - 30);       // come back and re-predict close to the moment
      this._noFire();
      const target = this._fireAt = now() + Math.max(0, fireIn);
      this._ft = setTimeout(() => {
        if (this.cur !== c || this.pending || this.userPaused || this.plan !== plan || c.seekPhase) return;
        while (now() < target) { /* <= 2 ms spin for timer jitter */ }
        this._fire(false, kind);
      }, Math.max(0, fireIn - 2));
      this._later(500);
    }

    _fire(late = false, kind = null) {
      // a stalled main thread can fire after the outgoing stream has already ended: look back that far too
      const lateMs = this._fireAt ? Math.max(0, now() - this._fireAt) : 0;
      this._noFire();
      this._trace('fire', { late, ct: this.cur && this.cur.el.currentTime });
      const c = this.cur, plan = this._plan();
      if (!c || !plan || this.pending) return;
      const nd = this._other(c);
      if (nd === this.out || this.holds.has(plan.key)) return;
      if (nd.key !== plan.key || nd.state !== 'ready' || nd.el.seeking) { this.jump(plan.item, { reason: 'auto' }); return; }
      kind = kind || this._kindFor(c, plan, nd);
      const id = ++this.seq;
      this.pending = { id, kind: kind.type, from: c, to: nd, item: plan.item, key: plan.key, firedAt: now(), late, loop: !!plan.loop };
      this._post({ t: 'hold', deck: nd.i });
      const rem = Math.max(0, ((c.el.duration || 0) - c.el.currentTime) * 1000 / (c.el.playbackRate || 1));
      if (kind.type === 'gapless') {
        // the worklet looks for the outgoing stream's end from 35 ms before its predicted end, so trailing
        // digital silence is kept rather than mistaken for the end
        this._post({ t: 'release', deck: nd.i, id, mode: 'after', other: c.i, declick: this.o.declick, endIn: this._fr(rem), tol: this._fr(35 + lateMs) });
      } else {
        const fr = this._fr(kind.xfMs);
        this.pending.xfFrames = fr;
        this._post({ t: 'release', deck: nd.i, id, mode: 'asap', fadeIn: fr, fadeOther: { deck: c.i, frames: fr } });
      }
      nd.open = true;
      // testStartDelayMs (tests only) simulates Chromium starting the stream late after the hold marker
      if (this.o.testStartDelayMs) setTimeout(() => nd.el.play().catch(() => {}), this.o.testStartDelayMs);
      else nd.el.play().catch(() => {});
      clearTimeout(this._wd);
      this._wd = setTimeout(() => this._watchdog(id), rem + 1500);
    }

    // the outgoing deck never finished (bad duration estimate, stalled file): rewind and plan again
    _watchdog(id) {
      const p = this.pending;
      if (!p || p.id !== id) return;
      this._cancelPending();
      if (this.cur?.el.ended && !this.userPaused) { const pl = this._plan(); if (pl) this.jump(pl.item, { reason: 'auto' }); }
      else this._kick();
    }

    _cancelPending() {
      clearTimeout(this._wd);
      const p = this.pending;
      if (!p) return;
      this.pending = null;
      this._post({ t: 'abort', deck: p.to.i });
      p.to.open = false;
      p.to.el.pause();
      if (p.to.el.currentTime !== 0) p.to.el.currentTime = 0;
    }

    _onSeam(m) {
      this.log.push(m);
      if (this.log.length > 400) this.log.splice(0, 100);
      if (m.t === 'released') {
        this.decks[m.deck].delay = m.delay;
        const p = this.pending;
        if (p && p.id === m.id) { this.pending = null; clearTimeout(this._wd); this._adopt(p, m); }
      } else if (m.t === 'overflow') {
        const p = this.pending;
        if (p && p.id === m.id) this._watchdog(m.id);
      }
    }

    // an automatic transition became audible
    _adopt(p, m) {
      const { from, to } = p;
      this.cur = to;
      this.out = from;
      this.plan = null;
      this.curSince = now();
      this.errStreak = 0;
      if (p.kind === 'gapless' && this.seam && !p.late) {
        // keep the lead comfortably positive without letting it creep up
        // slack = how long the incoming deck waited in the worklet beyond the minimum delay
        const slack = this._ms(m.slack), target = this.o.leadMs + this.leadAdj;
        if (m.gap > 0 || slack < 8) this.leadAdj = Math.min(60, this.leadAdj + 10);
        else if (slack > target + 25 && this.leadAdj > 0) this.leadAdj = Math.max(0, this.leadAdj - 5);
      }
      if (from.el.ended) this._retire(from);
      const audibleIn = p.kind === 'gapless' ? Math.max(0, this._ms(m.frame - m.now)) : 0;
      const ms = Math.min(Math.max(this.o.videoFadeMs, p.kind === 'gapless' ? 0 : this._ms(p.xfFrames || 0)), 3000);
      setTimeout(() => {
        if (this.cur !== to) return;
        if (p.loop) this._emit('loop', { item: to.item });
        else { this._emit('trackchange', { item: to.item, reason: 'auto', transition: p.kind }); this._emit('meta', this._meta(to)); }
        this._showVideo(to, ms);
      }, audibleIn);
      this._kick();
    }

    _onEnded(d) {
      this._trace('ended', { deck: d.i, isCur: d === this.cur, isOut: d === this.out, pending: !!this.pending });
      if (d === this.out) { this._retire(d); return; }
      if (d !== this.cur || this.jumping || d.seekPhase || (this.repeatOne && this.o.repeatOneMode !== 'splice')) return;
      const p = this.pending;
      if (p && p.from === d) return;                       // the worklet is splicing right now
      const plan = this._plan();
      if (!plan) {
        this.userPaused = true;
        this._emit('pause', {});
        this._emit('queueend', { item: d.item });
        d.el.currentTime = 0;
        return;
      }
      // ran out while a pause was fading it: cue the next track, paused, so resume plays that one
      if (this.userPaused) { this.jump(plan.item, { autoplay: false, reason: 'auto' }); return; }
      this._fire(true);                                    // ended before the timer fired: go now
    }

    _onElError(d) {
      if (!d.item || d.state === 'loading' || d.state === 'held' || !d.el.getAttribute('src')) return;   // load errors: _load's caller
      d.state = 'error';
      if (d === this.cur) this._activeFailed(d, Object.assign(new Error('playback failed'), { code: d.el.error?.code }), null);
      else if (this.plan && this.plan.key === d.key) { this.plan = null; this._kick(); }
    }

    _activeFailed(d, err, audibleFrom) {
      this._emit('error', { item: d.item, where: 'active', error: err });
      if (audibleFrom) {
        this._post({ t: 'ramp', deck: audibleFrom.i, frames: this._fr(this.o.skipFadeMs), to: 0 });
        this.out = audibleFrom;
        const tok = audibleFrom.token;
        setTimeout(() => { if (audibleFrom.token === tok && audibleFrom !== this.cur) this._retire(audibleFrom); }, this.o.skipFadeMs + 40);
      }
      const next = ++this.errStreak > this.o.maxErrorSkips ? null : this._planFor(d.item, 'error');
      if (!next) { this.errStreak = 0; this.userPaused = true; this._emit('pause', {}); this._emit('queueend', { item: d.item }); return; }
      if (!this.userPaused) setTimeout(() => this.jump(next, { reason: 'error-skip' }), 120);
    }

    // ---------- transport ----------
    // Resume a suspended context and wait for its clock to move: right after resume() currentTime is
    // stale, and the first fades would be timed from it.
    async _wake() {
      if (this.ctx.state === 'running') return;
      await this.ctx.resume().catch(() => {});
      const t0 = this.ctx.currentTime, s = now();
      while (this.ctx.currentTime === t0 && now() - s < 80) await sleep(2);
    }

    // first start of a freshly loaded deck: its audio is released (and faded in) on arrival
    _startDeck(d, fadeFrames, fadeOther = null) {
      const id = ++this.seq;
      this._post({ t: 'hold', deck: d.i });
      this._post({ t: 'release', deck: d.i, id, mode: 'asap', fadeIn: fadeFrames, fadeOther });
      d.open = true; d.rearmed = false;
      d.el.play().catch(() => {});
      return id;
    }

    // A paused (or seeking) deck waits in the worklet for its old stream to go quiet; the restarted
    // stream's first sample opens it, ducked in from zero, and resets its delay to the minimum.
    _rearm(d) {
      if (d.rearmed) return;
      this._post({ t: 'hold', deck: d.i, keepEnv: true, rearm: true });
      d.rearmed = true;
    }
    _reopen(d, ms) {
      this._rearm(d);
      d.el.play().catch(() => {});
      this._post({ t: 'release', deck: d.i, id: ++this.seq, mode: 'asap', keepEnv: true, duckIn: this._fr(d.el.currentTime > 0.05 ? ms : this.o.startFadeMs) });
      d.rearmed = false;
      d.open = true;
    }

    async play() {
      await this.ready;
      if (this.jumping) { this.userPaused = false; return; }    // the jump in flight starts playback
      const c = this.cur;
      if (!c || !c.item) return;
      clearTimeout(this._suspendT);
      const fading = !!this._pauseT;
      clearTimeout(this._pauseT); this._pauseT = 0; this._pausing?.resolve();
      if (!this.userPaused) return;
      this.userPaused = false;
      if (fading) {                                           // resumed inside the pause fade: just go back up
        for (const d of this.decks) if (d.open && !d.el.paused) this._duck(d, 1, this.o.resumeFadeMs);
        this._emit('play', {});
        this._kick();
        return;
      }
      await this._wake();
      if (this.userPaused || this.cur !== c) return;
      this._post({ t: 'unfreeze' });
      if (c.state === 'loading') { await c.ready.catch(() => {}); if (this.userPaused || this.cur !== c) return; }
      if (c.state === 'held') return;                         // release() restarts it
      if (c.el.ended) c.el.currentTime = 0;                   // replay after the end of the queue
      const o = this.out;
      if (o && o !== c && (o.el.ended || o.state === 'spent' || !o.open)) { this._retire(o); }
      for (const d of [c, this.out]) {
        if (!d || !d.item || d.seekPhase || d.state !== 'ready') continue;   // a seek resumes its deck when it lands
        if (d !== c && (d.el.ended || !d.open)) continue;
        if (!d.open) this._startDeck(d, this._fr(d.el.currentTime > 0.05 ? this.o.resumeFadeMs : this.o.startFadeMs));
        else this._reopen(d, this.o.resumeFadeMs);
      }
      this._emit('play', {});
      this._kick();
    }

    pause() {
      if (!this.cur?.item || this.userPaused) return;
      this.userPaused = true;
      this._noFire();
      this._cancelPending();
      this._post({ t: 'loopwatch', deck: this.cur.i, cancel: true });
      this.cur.loopArmed = false;
      const decks = this.decks.filter((d) => d.item && d.open && !d.el.paused);
      for (const d of decks) this._duck(d, 0, this.o.resumeFadeMs);
      clearTimeout(this._pauseT);
      let resolve;
      this._pausing = new Promise((r) => (resolve = r));
      this._pausing.resolve = () => { this._pausing = null; resolve(); };
      this._pauseT = setTimeout(() => {
        this._pauseT = 0;
        for (const d of decks) {
          if (d.seekPhase || d.el.paused) continue;
          d.el.pause();
          this._rearm(d);
        }
        this._post({ t: 'freeze' });              // a crossfade in progress resumes where it stopped
        this._pausing?.resolve();
        // paused in the last moments of a track: cue the next one, so resume does not replay a sliver
        const c = this.cur, d = c?.el.duration;
        if (c?.item && !this.repeatOne && isFinite(d) && (c.el.ended || d - c.el.currentTime < 0.06)) {
          const plan = this._plan();
          if (plan) this.jump(plan.item, { autoplay: false, reason: 'auto' });
        }
        this._suspendT = setTimeout(() => { if (this.userPaused) this.ctx.suspend().catch(() => {}); }, this.o.suspendAfterMs);
      }, this.o.resumeFadeMs + 4);
      this._emit('pause', {});
    }

    toggle() { return this.paused ? this.play() : this.pause(); }

    // a crossfade or skip-fade still running collapses onto the current track
    _finishOut(ms = 60) {
      const o = this.out;
      if (!o || o.finishing) return;
      o.finishing = true;                         // stays this.out until _retire: nothing may reuse it mid-fade
      this._post({ t: 'ramp', deck: o.i, frames: this._fr(ms), to: 0 });
      if (this.cur) this._post({ t: 'ramp', deck: this.cur.i, frames: this._fr(ms), to: 1 });
      const tok = o.token;
      setTimeout(() => { o.finishing = false; if (o.token === tok && o !== this.cur) this._retire(o); }, ms + this._ms(o.delay) + 10);
    }

    // Duck out, pause, seek, and open again on the first sample from the new position (the worklet
    // times the fade-in, so neither the deck's delay nor the decoder's restart time can click).
    seek(t) {
      const c = this.cur;
      if (!c || !c.item || !isFinite(t)) return;
      const dur = c.el.duration;
      t = Math.max(0, isFinite(dur) ? Math.min(t, dur) : t);
      this._noFire();
      this._cancelPending();
      this._post({ t: 'loopwatch', deck: c.i, cancel: true });
      c.loopArmed = false;
      this._finishOut(60);
      c.seekTarget = t;
      if (c.seekPhase === 'seeking') { c.el.currentTime = t; return; }
      if (c.seekPhase === 'ducking') return;                  // the step below applies the latest target
      if (this.userPaused || this.jumping || c.state !== 'ready' || c.el.paused || !c.open) { c.el.currentTime = t; return; }
      c.seekPhase = 'ducking';
      this._duck(c, 0, this.o.seekFadeMs);
      const tok = c.token;
      setTimeout(() => {
        if (c.token !== tok || c.seekPhase !== 'ducking') return;
        c.seekPhase = 'seeking';
        c.el.pause();
        this._rearm(c);
        c.el.currentTime = c.seekTarget;
        clearTimeout(c.seekWd);
        c.seekWd = setTimeout(() => this._seekLanded(c, tok), 1500);   // never stay silent if 'seeked' is lost
      }, this.o.seekFadeMs + 4);
    }
    _onSeeked(d) {
      if (d.seekPhase === 'seeking') { if (!d.el.seeking) this._seekLanded(d, d.token); return; }
      if (d === this.cur) this._kick();
    }
    _seekLanded(d, tok) {
      if (d.token !== tok || d.seekPhase !== 'seeking') return;
      clearTimeout(d.seekWd);
      d.seekPhase = null;
      if (d === this.cur && !this.userPaused) this._reopen(d, this.o.seekInMs);
      this._kick();
    }

    // ---------- track changes ----------
    next() {
      const c = this.cur, p = this._plan();
      // with repeat-one the manual next still moves on
      const it = p && !p.loop ? p.item : (c && c.item ? this._planFor(c.item, 'next') : null);
      if (!it) return false;
      this.jump(it, { reason: 'next' });
      return true;
    }

    // manual change (next / prev / click / restore). Instant if the item is preloaded, short crossfade.
    async jump(item, opts = {}) {
      await this.ready;
      if (!item) return;
      const tok = ++this.jumpTok;
      this.jumping = true;                 // keeps the scheduler and the preloader off both decks meanwhile
      try { await this._jump(item, opts, tok); }
      catch (err) { console.error('GlassDeck jump', err); }
      finally { if (tok === this.jumpTok) { this.jumping = false; this._kick(); } }
    }

    async _jump(item, { autoplay = true, at = 0, reason = 'jump' }, tok) {
      const key = this.o.keyOf(item);
      this._noFire(); clearTimeout(this._suspendT);
      if (this._pausing) { await this._pausing; if (tok !== this.jumpTok) return; }   // let a pause fade finish
      const wasPaused = this.userPaused;
      this.userPaused = !autoplay;
      if (autoplay && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this._post({ t: 'unfreeze' });
      for (const d of this.decks) if (d.seekPhase) { d.seekPhase = null; clearTimeout(d.seekWd); }
      const sounding = (d) => !!d && !!d.item && d.open && !d.el.paused && !wasPaused;
      // the track the listener hears now; it fades out under the new one
      const cur = this.cur && this.cur.item ? this.cur : null;
      let from = sounding(cur) ? cur : cur && sounding(this._other(cur)) ? this._other(cur) : null;
      let to = null, held = false;
      const p = this.pending;
      if (p && p.key === key && p.to.state === 'ready') { to = p.to; held = true; this.pending = null; clearTimeout(this._wd); }
      else {
        if (p) this._cancelPending();
        to = this.decks.find((d) => d !== from && d !== this.out && d.key === key && d.state === 'ready' && !d.el.error)
          || this.decks.find((d) => d !== from && !sounding(d))
          || (from ? this._other(from) : this.decks[0]);
      }
      clearTimeout(to.stopT);                                 // stop() was about to unload it
      if (sounding(to) || to === this.out) {
        // still fading out an earlier track (crossfade or skip): silence it quickly, then reuse the deck
        if (sounding(to)) { this._duck(to, 0, 30); await sleep(35 + this._ms(to.delay)); }
        if (tok !== this.jumpTok) return;
        if (this.out === to) this.out = null;
        held = false;
      }
      // a deck still ducking out (pause, stop) is cut only once it is silent
      const quiet = Math.max(0, ...this.decks.filter((d) => d !== from).map((d) => (d.quietAt || 0) - now()));
      if (quiet > 0) { await sleep(quiet); if (tok !== this.jumpTok) return; }
      for (const d of this.decks) {                           // anything else stops (it is silent by now)
        if (d === to || d === from) continue;
        if (d.open) { d.el.pause(); this._post({ t: 'close', deck: d.i }); d.open = false; d.rearmed = false; }
        if (this.out === d) this.out = null;
      }
      this.cur = to;
      this.plan = null;
      this.curSince = now();
      this._emit('trackchange', { item, reason, transition: 'manual' });
      const instant = held || (to.key === key && to.state === 'ready' && !to.el.ended && !to.el.seeking && Math.abs(to.el.currentTime - at) < 0.02);
      let fromFaded = false;
      if (!instant) {
        const t = from ? setTimeout(() => { fromFaded = true; this._post({ t: 'ramp', deck: from.i, frames: this._fr(this.o.skipFadeMs), to: 0 }); }, this.o.holdForLoadMs) : 0;
        try {
          if (to.key === key && to.state === 'loading' && !(at > 0)) await to.ready;   // already on its way
          else await this._load(to, item, at);
        } catch (err) {
          if (tok === this.jumpTok && err.message !== 'superseded') this._activeFailed(to, err, from && !fromFaded ? from : null);
          return;
        } finally { clearTimeout(t); }
        if (tok !== this.jumpTok) return;
      } else if (!held && to.open) { this._post({ t: 'close', deck: to.i }); to.open = false; }
      this._showVideo(to, this.o.videoFadeMs);
      this._emit('meta', this._meta(to));
      if (this.userPaused) {
        if (from) {
          this._post({ t: 'ramp', deck: from.i, frames: this._fr(60), to: 0 });
          const ft = from.token;
          setTimeout(() => { if (from.token === ft && from !== this.cur) this._retire(from); }, 80 + this._ms(from.delay));
        }
        this._emit('pause', {});
        return;
      }
      await this._wake();
      if (tok !== this.jumpTok) return;
      const fade = this._fr(from ? this.o.skipFadeMs : at > 0.05 ? this.o.resumeFadeMs : this.o.startFadeMs);
      const fadeOther = from && !fromFaded ? { deck: from.i, frames: fade } : null;
      if (held) {
        const id = ++this.seq;
        this._post({ t: 'release', deck: to.i, id, mode: 'asap', fadeIn: fade, fadeOther });
      } else this._startDeck(to, fade, fadeOther);
      if (from) {
        this.out = from;
        const ftok = from.token;
        setTimeout(() => { if (from.token === ftok && this.out === from) this._retire(from); }, this.o.skipFadeMs + this._ms(from.delay) + 40);
      }
      this._emit('play', {});
    }

    stop() {
      this._noFire(); clearTimeout(this._tt); clearTimeout(this._wd); clearTimeout(this._pauseT); this._pauseT = 0;
      this._pausing?.resolve();
      this.jumpTok++; this.jumping = false;
      if (this.pending) this._cancelPending();
      for (const d of this.decks || []) {
        const tok = d.token, ms = this._sounding(d) ? this.o.stopFadeMs : 0;
        if (ms) this._duck(d, 0, ms);
        d.seekPhase = null; clearTimeout(d.seekWd);
        // unload once silent, unless a jump has reused the deck meanwhile
        clearTimeout(d.stopT);
        d.stopT = setTimeout(() => { if (d.token === tok) this._unload(d); }, ms ? ms + 6 + this._ms(d.delay) : 0);
      }
      this.cur = null; this.out = null; this.plan = null; this.userPaused = true;
      this._showVideo(null, this.o.videoFadeMs);
      this._emit('pause', {});
    }

    async destroy() {
      await this.ready.catch(() => {});
      this.stop();
      await sleep(this.o.stopFadeMs + 80);
      for (const d of this.decks) if (!this.o.elements) d.el.remove();
      await this.ctx.close().catch(() => {});
    }

    // ---------- settings ----------
    setVolume(v) { this.volume = Math.max(0, Math.min(1, +v || 0)); this._applyVolume(); }
    setMuted(m) { this.muted = !!m; this._applyVolume(); }
    _applyVolume(first = false) {
      if (!this.master) return;
      const v = this.muted ? 0 : this.volume * this.volume;    // perceptual: slider^2
      const g = this.master.gain, t = this.ctx.currentTime;
      if (first) g.setValueAtTime(v, t); else { g.cancelScheduledValues(t); g.setTargetAtTime(v, t, 0.012); }
    }
    setCrossfade(sec) { this.crossfade = Math.max(0, +sec || 0); this._kick(); }
    setRepeatOne(on) {
      on = !!on;
      if (on === this.repeatOne) return;
      this.repeatOne = on;
      const c = this.cur;
      if (c) {
        c.el.loop = on && this.o.repeatOneMode !== 'splice';
        c.loopArmed = false;
        this._post({ t: 'loopwatch', deck: c.i, cancel: true });
      }
      this.invalidate();                          // the next item changes (itself, or the real next)
    }

    // ---------- file handles (rename / tag writes) ----------
    // No deck holds `key` while fn runs. The current track then reloads at the same position from
    // urlOf(item) again, so an item renamed inside fn plays on from its new path.
    async release(key, fn) {
      await this.ready;
      this.holds.add(key);
      const hits = this.decks.filter((d) => d.key === key);
      let saved = null;
      try {
        for (const d of hits) if (this.pending && (this.pending.to === d || this.pending.from === d)) this._cancelPending();
        if (hits.includes(this.cur)) { saved = { d: this.cur, at: this.currentTime }; this._finishOut(30); }
        const loud = hits.filter((d) => this._sounding(d) || d === this.out);
        for (const d of loud) this._duck(d, 0, 30);
        if (loud.length) await sleep(36 + Math.max(...loud.map((d) => this._ms(d.delay))));
        for (const d of hits) {
          if (d.key !== key) continue;                       // reloaded with another file meanwhile
          if (saved && d === saved.d && d === this.cur) { d.heldAt = saved.at; this._unload(d, true); }
          else { if (this.out === d) this.out = null; this._unload(d); }
        }
        if (hits.length) await sleep(120);        // Chromium closes file handles asynchronously
        return await fn();
      } finally {
        this.holds.delete(key);
        const d = saved?.d;
        if (d && this.cur === d && d.state === 'held') {
          try {
            await this._load(d, d.item, saved.at);
            this._emit('meta', this._meta(d));
            if (!this.userPaused && this.cur === d) { await this._wake(); this._startDeck(d, this._fr(this.o.resumeFadeMs)); }
          } catch (err) {
            if (err.message !== 'superseded') { d.state = 'error'; this._activeFailed(d, err, null); }
          }
        }
        this.invalidate();
      }
    }
    withReleased(key, fn) { return this.release(key, fn); }

    // ---------- video ----------
    // The new picture fades in on top; the old one stays opaque underneath until that is done.
    _showVideo(d, ms) {
      clearTimeout(this._underT);
      for (const x of this.decks) {
        const on = x === d && !!x.item && (x.el.videoWidth > 0 || (x.el.readyState < 1 && this.o.isVideo(x.item)));
        const was = x.el.classList.contains('on');
        x.el.style.transitionDuration = Math.round(ms) + 'ms';
        x.el.classList.toggle('under', !on && was && !!d);
        x.el.classList.toggle('on', on);
      }
      this._underT = setTimeout(() => { for (const x of this.decks) x.el.classList.remove('under'); }, ms + 60);
    }

    // ---------- timer-only fallback (no AudioWorklet) ----------
    _fallback(m) {
      const t = this.ctx.currentTime, d = this.decks[m.deck];
      // every curve starts from where the previous one really is at that moment (kept in a small model)
      const valueAt = (k, at) => {
        if (!k || at >= k.t1) return k ? k.g1 : 1;
        if (at <= k.t0) return k.g0;
        const p = (at - k.t0) / (k.t1 - k.t0), s = Math.sin(p * Math.PI / 2), c = Math.cos(p * Math.PI / 2);
        return Math.sqrt(k.g0 * k.g0 * c * c + k.g1 * k.g1 * s * s);
      };
      const ramp = (g, name, dd, to, frames, at) => {
        const from = valueAt(dd[name], at), dur = frames / this.sr;
        try {
          g.cancelAndHoldAtTime(at);
          if (frames <= 1 || Math.abs(to - from) < 1e-4) g.setValueAtTime(to, at); else g.setValueCurveAtTime(eqp(from, to), at, dur);
        } catch { g.cancelScheduledValues(at); g.setTargetAtTime(to, at, Math.max(dur, 0.001) / 3); }
        dd[name] = { t0: at, t1: at + (frames <= 1 ? 0 : dur), g0: from, g1: to };
      };
      const env = (dd, to, frames, at) => ramp(dd.gain.gain, 'envK', dd, to, frames, at);
      const duck = (dd, to, frames, at) => ramp(dd.duckG.gain, 'duckK', dd, to, frames, at);
      switch (m.t) {
        case 'hold': if (!m.keepEnv) { env(d, 0, 0, t); duck(d, 1, 0, t); } break;
        case 'abort': env(d, 0, 0, t); break;
        case 'close': env(d, 0, 0, t); duck(d, 1, 0, t); break;      // silent until the next release
        case 'ramp': env(d, m.to, m.frames, t); break;
        case 'duck': duck(d, m.to, m.frames, t); break;
        case 'release': {
          // play() -> first sample of a decoded deck (measured ~4 ms); a restarted one gets a burst more
          const at = t + (m.duckIn ? 0.012 : 0.004);
          const micro = this._fr(14);
          if (m.duckIn) { duck(d, 0, 0, t); duck(d, 1, m.duckIn, at); }
          if (!m.keepEnv) {
            const fin = m.mode === 'after' ? micro : (m.fadeIn || 0);
            env(d, 0, 0, t);
            env(d, 1, fin, at);
            const other = m.mode === 'after' ? { deck: m.other, frames: micro } : m.fadeOther;
            if (other) env(this.decks[other.deck], 0, other.frames, at);
          }
          setTimeout(() => this._onSeam({ t: 'released', deck: m.deck, id: m.id, mode: m.mode, frame: Math.round(at * this.sr), now: Math.round(t * this.sr), delay: 0, slack: 0, lead: 0, gap: 0 }), 0);
          break;
        }
      }
    }
  }

  window.GlassDeck = GlassDeck;
})();
