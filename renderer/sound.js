'use strict';
// Sound chain (Settings > Sound). Built once, the first time audio plays:
// media → pre-gain → (mono) → bass shelf → 5-band EQ → treble shelf → (leveller) → dry + reverb → fade gain → out
// Everything glides with setTargetAtTime so moving a slider never clicks.
(() => {
  const BANDS = [60, 230, 910, 3600, 14000];
  const PRESETS = {
    flat: { label: 'Flat', eq: [0, 0, 0, 0, 0] },
    bass: { label: 'Bass', eq: [6, 3, 0, 0, 0] },
    treble: { label: 'Treble', eq: [0, 0, 0, 3, 6] },
    vocal: { label: 'Vocal', eq: [-2, -1, 4, 3, 0] },
    rock: { label: 'Rock', eq: [4, 2, -1, 2, 4] },
    pop: { label: 'Pop', eq: [-1, 2, 4, 2, -1] },
    electronic: { label: 'Electronic', eq: [5, 2, 0, 2, 4] },
    acoustic: { label: 'Acoustic', eq: [3, 1, 1, 2, 2] },
    night: { label: 'Late night', eq: [-3, 0, 2, 0, -4] },
  };
  let ctx = null, n = null, roomBuilt = '';

  function impulse(kind) {
    const secs = kind === 'hall' ? 3.4 : kind === 'plate' ? 1.8 : 1.1;
    const decay = kind === 'hall' ? 2.2 : kind === 'plate' ? 3.5 : 3;
    const len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  const ease = (param, v, tc = 0.06) => param.setTargetAtTime(v, ctx.currentTime, tc);
  const dbToGain = (db) => Math.pow(10, db / 20);

  function build(c, src) {
    ctx = c;
    n = {
      pre: c.createGain(),
      mono: Object.assign(c.createGain(), { channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers' }),
      join: c.createGain(),
      bass: Object.assign(c.createBiquadFilter(), { type: 'lowshelf' }),
      eq: BANDS.map((f, i) => Object.assign(c.createBiquadFilter(), { type: i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking' })),
      treble: Object.assign(c.createBiquadFilter(), { type: 'highshelf' }),
      level: c.createDynamicsCompressor(),
      post: c.createGain(),
      dry: c.createGain(),
      verb: c.createConvolver(),
      wet: c.createGain(),
      fade: c.createGain(),
      song: c.createGain(),   // fade in/out at each song's start and end
    };
    n.bass.frequency.value = 90;
    n.treble.frequency.value = 7000;
    BANDS.forEach((f, i) => { n.eq[i].frequency.value = f; n.eq[i].Q.value = 1; });
    // leveller: gentle compressor that lifts quiet songs and tames loud ones
    n.level.threshold.value = -24; n.level.knee.value = 24; n.level.ratio.value = 4; n.level.attack.value = 0.01; n.level.release.value = 0.3;

    src.connect(n.pre);
    n.mono.connect(n.join);
    let x = n.join;
    for (const f of [n.bass, ...n.eq, n.treble]) { x.connect(f); x = f; }
    n.tail = x;
    n.post.connect(n.dry); n.dry.connect(n.fade);
    n.post.connect(n.verb); n.verb.connect(n.wet); n.wet.connect(n.fade);
    n.fade.connect(n.song);
    apply(true);
    return n.song;
  }

  // (re)route the switchable parts, then glide every value to the current settings
  function apply(first = false) {
    if (!n) return;
    const s = S.sound;
    n.pre.disconnect();
    n.pre.connect(s.mono ? n.mono : n.join);
    n.tail.disconnect(); n.level.disconnect();
    if (s.even) { n.tail.connect(n.level); n.level.connect(n.post); } else n.tail.connect(n.post);

    ease(n.bass.gain, s.bass);
    ease(n.treble.gain, s.treble);
    s.eq.forEach((g, i) => ease(n.eq[i].gain, g));
    // pull the level down by part of the biggest boost so heavy bass doesn't clip
    const boost = Math.max(0, s.bass + Math.max(0, s.eq[0], s.eq[1]), s.treble + Math.max(0, s.eq[3], s.eq[4]), ...s.eq);
    ease(n.pre.gain, dbToGain(-boost * 0.55));
    ease(n.post.gain, s.even ? 1.35 : 1);
    const r = s.reverb / 100;
    if (r > 0 && roomBuilt !== s.room) { n.verb.buffer = impulse(s.room); roomBuilt = s.room; }
    ease(n.wet.gain, r * 0.55);
    ease(n.dry.gain, 1 - r * 0.25);
    if (first) n.fade.gain.value = 1;
  }

  window.Sound = {
    BANDS, PRESETS, build, apply,
    ready: () => !!n,
    songLevel: (v) => { if (n) n.song.gain.setTargetAtTime(v, ctx.currentTime, 0.04); },
  };
})();
