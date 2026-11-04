'use strict';
// GlassDeck seam processor (AudioWorklet, loaded by deck.js).
// Inputs 0/1 are the two <video> decks; outputs 0/1 are the same decks after a per-deck delay line,
// gain envelope and duck. A deck can be started early and *held* in its delay line, then released on an
// exact sample: right after the other deck's last sample (gapless), or as soon as its own audio arrives
// (starts, resumes, seeks). Main-thread timers only need to be roughly right; the splice happens here.
//
// Two gains per deck:
//   envelope - crossfades and skip fades, on an "envelope clock" that stops while paused, so a crossfade
//              resumes exactly where it was;
//   duck     - pause / seek / stop fades on the real output clock. A re-opened deck ramps its duck up from
//              the first sample of the audio that really arrives, so a resume or seek can never click,
//              whatever the deck's delay or the element's start-up latency.

const CAP = 1 << 16;          // ring frames per deck (~1.4 s): bounds how early a deck may be started
const MASK = CAP - 1;
const HALF_PI = Math.PI / 2;

const C = {
  D: 256,        // base delay (lookahead) of every deck, frames. Must exceed Z + XN + RING.
  Z: 64,         // exact-zero frames that confirm a stream has ended (or, for a re-open, has stopped)
  XN: 128,       // de-click crossfade length, frames (only used when the joint is a hard step)
  W: 2048,       // gapless joint: onset later than this after the release = the track's own leading silence
  WS: 6615,      // plain start (skip, play): the same, but a slow decoder start must not count as silence
  WR: 32768,     // re-open: the restarted stream may take this long (seek spam) before we give up waiting
  RING: 40,      // max length of resampler ringing at a stream edge
  TH: 0.003,     // "real signal" level used to see past resampler ringing
  STEP: 0.02,    // smallest joint step that is worth de-clicking
  JOINT: 1.5,    // de-click when the joint jumps this many times more than the signal on either side
};

function shape(kind, g0, g1, p) {
  if (p <= 0) return g0;
  if (p >= 1) return g1;
  if (kind === 'lin') return g0 + (g1 - g0) * p;
  // equal power: g^2 travels along sin^2, so a 1->0 / 0->1 pair keeps the summed power constant
  const s = Math.sin(p * HALF_PI), c = Math.cos(p * HALF_PI);
  return Math.sqrt(g0 * g0 * c * c + g1 * g1 * s * s);
}

class Deck {
  constructor() {
    this.L = new Float32Array(CAP);
    this.R = new Float32Array(CAP);
    this.delay = C.D;
    this.gate = 0;          // 0 closed, 1 holding (buffering, silent), 2 open
    this.openAt = 0;        // first output frame of an open gate
    this.validFrom = 0;     // first input frame allowed through
    this.g = 1;             // steady envelope gain before the first segment
    this.segs = [];         // envelope ramps in envelope-clock frames, ordered by t0: { t0, t1, g0, g1, kind }
    this.duck = { t0: 0, t1: 0, g0: 1, g1: 1 };   // output-clock ramp, raised cosine
    this.loop = null;       // repeat-one de-click: { armFrom, zr, end }
    this.marker = -1;       // input frame where holding began
    this.relAt = -1;        // input frame where the release request arrived
    this.rearm = false;     // a re-open (resume, seek): only audio after the release request counts
    this.onset = -1;        // first non-zero input frame after the marker
    this.rel = null;        // pending release
    this.armFrom = -1;      // end detection: frames before this are ignored
    this.zr = -1;           // start of the current exact-zero run
    this.end = -1;          // confirmed end of stream (first zero frame after the content)
  }
  gainAt(e) {
    const s = this.segs;
    let r = null;
    for (let i = s.length - 1; i >= 0; i--) if (s[i].t0 <= e) { r = s[i]; break; }
    if (!r) return s.length ? s[0].g0 : this.g;
    if (e >= r.t1) return r.g1;
    return shape(r.kind, r.g0, r.g1, (e - r.t0) / (r.t1 - r.t0));
  }
  // a new ramp replaces only what was planned from e0 on, so a fade still running is never cut short
  setRamp(e0, frames, to, kind = 'eqp', from = null) {
    const g0 = from == null ? this.gainAt(e0) : from;
    this.segs = this.segs.filter((r) => r.t0 < e0);
    this.segs.push({ t0: e0, t1: e0 + Math.max(1, frames), g0, g1: to, kind });
  }
  setGain(g) { this.segs = []; this.g = g; }
  settle(e) {                                   // drop segments that are completely in the past
    const s = this.segs;
    while (s.length > 1 && s[1].t0 <= e) s.shift();
    if (s.length === 1 && e >= s[0].t1) { this.g = s[0].g1; s.length = 0; }
  }
  duckAt(f) {
    const u = this.duck;
    if (f >= u.t1) return u.g1;
    if (f <= u.t0) return u.g0;
    return u.g0 + ((u.g1 - u.g0) * (1 - Math.cos((Math.PI * (f - u.t0)) / (u.t1 - u.t0)))) / 2;
  }
  setDuck(f0, frames, to, from = null) {
    const g0 = from == null ? this.duckAt(f0) : from;
    this.duck = { t0: f0, t1: f0 + Math.max(1, frames), g0, g1: to };
  }
  peak(f) { const i = f & MASK; return Math.max(Math.abs(this.L[i]), Math.abs(this.R[i])); }
}

class GlassSeam extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    Object.assign(C, opts?.processorOptions?.cfg || {});
    this.d = [new Deck(), new Deck()];
    this.frozen = false; this.frozenAt = 0; this.frozenTotal = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  env(f) { return (this.frozen ? this.frozenAt : f) - this.frozenTotal; }

  onMsg(m) {
    const F = currentFrame;
    const d = this.d[m.deck];
    switch (m.t) {
      case 'hold':
        // keepEnv: a re-open (resume, seek) keeps the envelope, so a paused crossfade carries on
        d.gate = 1; d.marker = F; d.relAt = -1; d.onset = -1; d.rel = null; d.loop = null;
        d.rearm = !!m.rearm;
        if (!m.keepEnv) { d.setGain(1); d.duck = { t0: 0, t1: 0, g0: 1, g1: 1 }; }
        break;
      case 'release': {
        if (d.rel && d.rel.mode === 'after' && (m.mode !== 'after' || m.other !== d.rel.other)) this.d[d.rel.other].armFrom = -1;
        d.rel = m;
        d.relAt = F;
        if (m.mode === 'after') {
          // End detection starts a little before the predicted end (keeps trailing digital silence) and
          // may reach back into the ring: the outgoing deck can already have finished when this arrives.
          const o = this.d[m.other];
          o.armFrom = F + (m.endIn || 0) - (m.tol || 0); o.end = -1; o.zr = -1;
          let x = F - 1;
          const stop = Math.max(F - CAP + 2 * 128, o.armFrom - C.W);
          while (x >= stop && o.L[x & MASK] === 0 && o.R[x & MASK] === 0) x--;
          if (x < F - 1) o.zr = x + 1;
        }
        if (d.gate !== 1) { d.gate = 1; d.marker = F; d.onset = -1; d.rearm = false; }
        break;
      }
      case 'abort':
        if (d.rel && d.rel.mode === 'after') this.d[d.rel.other].armFrom = -1;
        d.gate = 0; d.rel = null; d.marker = -1; d.onset = -1;
        break;
      case 'close':
        if (d.rel && d.rel.mode === 'after') this.d[d.rel.other].armFrom = -1;
        d.gate = 0; d.rel = null; d.setGain(1); d.delay = C.D; d.armFrom = -1; d.loop = null; d.rearm = false;
        d.duck = { t0: 0, t1: 0, g0: 1, g1: 1 };
        break;
      case 'ramp':
        d.setRamp(this.env(F), m.frames, m.to, m.kind || 'eqp');
        break;
      case 'duck':
        d.setDuck(F, m.frames, m.to);
        break;
      case 'loopwatch': {
        // repeat-one with the native loop: fade the last XN samples before the loop gap, fade in after it
        if (m.cancel) { d.loop = null; break; }
        const L = d.loop = { armFrom: F + (m.endIn || 0) - (m.tol || 0), zr: -1, end: -1 };
        let x = F - 1;
        while (x >= F - C.W && d.L[x & MASK] === 0 && d.R[x & MASK] === 0) x--;
        if (x < F - 1) L.zr = x + 1;
        break;
      }
      case 'freeze':
        if (!this.frozen) { this.frozen = true; this.frozenAt = F; }
        break;
      case 'unfreeze':
        if (this.frozen) { this.frozenTotal += F - this.frozenAt; this.frozen = false; }
        break;
    }
  }

  // where the held deck's audio really starts, or null to keep waiting
  startOf(d, F, N) {
    const base = Math.max(d.marker, d.relAt);
    // A re-open (resume, seek) keeps waiting for the restarted stream: its first sample must land at duck 0.
    // Its leading zeros are the pause, not content, so nothing is lost by waiting.
    if (d.rearm) {
      if (d.onset < 0) return F + N - base > C.WR ? { S: F, first: F, ring: false } : null;
    }
    const W = d.rel.mode === 'after' ? C.W : C.WS;
    if (d.onset >= 0) {
      const f = d.onset;
      if (!d.rearm && f - base > W) return { S: base, first: base, ring: false };   // leading silence
      let big = -1;
      for (let x = f; x < f + C.RING && x < F + N; x++) if (d.peak(x) > C.TH) { big = x; break; }
      if (big < 0 && F + N < f + C.RING) return null;            // need the next quantum to decide
      if (big <= f) {
        // clean edge: at matched rates a stream starts on a render-quantum boundary, so the zeros
        // between that boundary and the first non-zero sample are the track's own leading samples
        const qb = d.rearm ? f : Math.max(d.marker, f - (f % 128));
        return { S: qb, first: qb, ring: false };
      }
      return { S: big, first: f, ring: true };                   // resampled: align the real signal
    }
    if (F + N - base > W) return { S: base, first: base, ring: false };
    return null;
  }

  // last sample of the real signal before `end`: above a quarter of the local peak, so a resampled
  // step's Gibbs ringing and the low-level tail are left to the crossfade
  realEnd(o, end) {
    let p = 0;
    for (let x = end - 512; x < end; x++) p = Math.max(p, o.peak(x));
    for (let x = end - 1; x > end - 512; x--) if (o.peak(x) > p * 0.25) return x + 1;
    return end;
  }

  jointCheck(o, d, A, st, avail) {
    const mix = (ch, k) => {
      const oa = A + k, ib = st.S + k;
      let v = oa < avail ? (ch ? o.R : o.L)[oa & MASK] : 0;
      if (ib >= st.first && ib < avail) v += (ch ? d.R : d.L)[ib & MASK];
      return v;
    };
    let joint = 0, ref = 0;
    for (let ch = 0; ch < 2; ch++) {
      for (let k = -6; k <= 24; k++) joint = Math.max(joint, Math.abs(mix(ch, k) - mix(ch, k - 1)));
      const X = ch ? o.R : o.L, Y = ch ? d.R : d.L;
      for (let k = -72; k <= -10; k++) ref = Math.max(ref, Math.abs(X[(A + k) & MASK] - X[(A + k - 1) & MASK]));
      for (let k = 30; k <= 92 && st.S + k < avail; k++) ref = Math.max(ref, Math.abs(Y[(st.S + k) & MASK] - Y[(st.S + k - 1) & MASK]));
    }
    return { joint, ref };
  }

  tryRelease(k, F, N) {
    const d = this.d[k], r = d.rel;
    const st = this.startOf(d, F, N);
    if (!st) return;
    let delay, J, declick = false, gap = 0, lead = 0, ringA = false, step = 0;
    if (r.mode === 'after') {
      const o = this.d[r.other];
      if (o.end < 0) {
        if (F + N - d.marker > CAP - 8192) {             // the other deck never ended: give up cleanly
          d.gate = 0; d.rel = null; o.armFrom = -1;
          this.port.postMessage({ t: 'overflow', deck: k, id: r.id });
        }
        return;
      }
      let A = o.end;
      // a low-level tail after the last loud sample is resampler ringing: let it overlap the next start
      let lastNZ = -1, lastBig = -1;
      for (let x = o.end - 1; x >= o.end - 1 - C.RING; x--) {
        const v = o.peak(x);
        if (lastNZ < 0 && v !== 0) lastNZ = x;
        if (v > C.TH) { lastBig = x; break; }
      }
      if (lastBig >= 0 && lastNZ > lastBig) { A = lastBig + 1; ringA = true; }
      const resampled = st.ring || ringA;
      if (resampled) A = this.realEnd(o, o.end);
      J = A + o.delay;                                    // output frame right after the last sample
      lead = A - st.S;
      const delay0 = J - st.S;
      if (r.declick && delay0 - C.XN >= C.D && resampled) {
        // Edges went through Chromium's resampler: their ringing and band-limited steps cannot be
        // butt-joined exactly, so these joints always get the short equal-power crossfade.
        declick = true;
      } else if (r.declick && delay0 - C.XN >= C.D) {
        // Would the butt joint click? Mix both decks exactly as they would be output and compare the
        // largest sample step across the joint with each side on its own. Only separately mastered
        // tracks with a hard edge trip this; a continuous recording joins at its own slope.
        const j = this.jointCheck(o, d, A, st, F + N);
        step = j.joint;
        declick = j.joint > Math.max(C.STEP, C.JOINT * j.ref);
      }
      if (declick) J -= C.XN;
      delay = J - st.S;
      if (delay < C.D) {                                  // arrived too late for an exact splice
        gap = C.D - delay;
        delay = C.D; J = st.S + delay;
      }
      o.armFrom = -1;
    } else {                                              // asap
      delay = Math.max(C.D, F - st.S); J = st.S + delay;
    }
    if (delay > CAP - 2 * N) { delay = CAP - 2 * N; J = st.S + delay; }
    d.delay = delay;
    d.gate = 2;
    d.validFrom = st.first;
    d.openAt = Math.max(F, st.first + delay);
    const eJ = J - this.frozenTotal;
    if (!r.keepEnv) {
      // a joint that came too late starts after a gap: fade it in rather than start on a hard edge
      const fin = declick || gap > 0 ? C.XN : (r.fadeIn || 0);
      if (fin > 0) { d.setGain(0); d.setRamp(eJ, fin, 1, 'eqp', 0); } else d.setGain(1);
    }
    if (r.duckIn) d.setDuck(J, r.duckIn, 1, 0);
    const fo = declick ? { deck: r.other, frames: C.XN } : r.fadeOther;
    if (fo) this.d[fo.deck].setRamp(eJ, fo.frames, 0, 'eqp');
    d.rel = null; d.rearm = false;
    this.port.postMessage({
      t: 'released', deck: k, id: r.id, mode: r.mode, frame: J, now: F, delay, slack: delay - C.D, lead, gap, declick,
      step: +step.toFixed(4), ring: st.ring || ringA, onsetLatency: d.onset >= 0 ? d.onset - Math.max(d.marker, d.relAt) : -1,
      S: st.S, end: r.mode === 'after' ? this.d[r.other].end : -1,
    });
  }

  watchLoop(k, d, F, N, a, b) {
    const L = d.loop;
    for (let j = 0; j < N; j++) {
      const f = F + j, zero = !a || (a[j] === 0 && b[j] === 0);
      if (L.end < 0) {
        if (!zero) { L.zr = -1; continue; }
        if (L.zr < 0) L.zr = f;
        if (f - L.zr + 1 >= C.Z && f >= L.armFrom) {
          L.end = Math.max(L.zr, L.armFrom);
          const e0 = L.end + d.delay - C.XN - this.frozenTotal;
          if (e0 >= this.env(F)) d.setRamp(e0, C.XN, 0, 'eqp');
        }
      } else if (!zero) {
        d.setRamp(f + d.delay - this.frozenTotal, C.XN, 1, 'eqp', 0);
        this.port.postMessage({ t: 'looped', deck: k, end: L.end, onset: f, gap: f - L.end });
        d.loop = null;
        return;
      }
    }
  }

  process(inputs, outputs) {
    const F = currentFrame;
    const N = outputs[0][0].length;
    const base = F & MASK;
    for (let k = 0; k < 2; k++) {
      const d = this.d[k];
      const inp = inputs[k];
      const a = inp && inp[0], b = inp && (inp[1] || inp[0]);
      if (a) { d.L.set(a, base); d.R.set(b, base); } else { d.L.fill(0, base, base + N); d.R.fill(0, base, base + N); }
      if (d.gate === 1 && d.onset < 0 && a) {
        // a re-open ignores whatever the old stream still delivered before the element was restarted
        const from = d.rearm ? (d.relAt >= 0 ? d.relAt : Infinity) : d.marker;
        for (let j = 0; j < N; j++) {
          if (F + j >= from && (a[j] !== 0 || b[j] !== 0)) { d.onset = F + j; break; }
        }
      }
      if (d.loop) this.watchLoop(k, d, F, N, a, b);
      if (d.armFrom >= 0 && d.end < 0) {
        for (let j = 0; j < N; j++) {
          const f = F + j;
          if (!a || (a[j] === 0 && b[j] === 0)) {
            if (d.zr < 0) d.zr = f;
            if (f - d.zr + 1 >= C.Z && f >= d.armFrom) { d.end = Math.max(d.zr, d.armFrom); break; }
          } else d.zr = -1;
        }
      }
    }
    for (let k = 0; k < 2; k++) if (this.d[k].gate === 1 && this.d[k].rel) this.tryRelease(k, F, N);
    for (let k = 0; k < 2; k++) {
      const d = this.d[k];
      if (d.gate !== 2) continue;
      const oL = outputs[k][0], oR = outputs[k][1];
      for (let j = 0; j < N; j++) {
        const f = F + j;
        if (f < d.openAt) continue;
        const src = f - d.delay;
        if (src < d.validFrom) continue;
        const g = d.gainAt(this.env(f)) * d.duckAt(f);
        if (g === 0) continue;
        const i = src & MASK;
        oL[j] = d.L[i] * g;
        oR[j] = d.R[i] * g;
      }
      if (!this.frozen) d.settle(this.env(F));
    }
    return true;
  }
}
registerProcessor('glass-seam', GlassSeam);
