/* Glassy search: typo-tolerant, phonetic-ish matching over title / artist / album / file name.
   Browser: window.GlassSearch. Node: module.exports. No dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GlassSearch = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';

  // ---------- normalising ----------
  const APOS = /['’‘ʼ`´]/g;                       // removed, not split: don't -> dont, Flexin' -> flexin
  const MARKS = /\p{M}+/gu;
  const LETTER = { ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', ł: 'l', Ł: 'L', þ: 'th', Þ: 'Th', ı: 'i', ħ: 'h', Ħ: 'H' };
  const LETTER_RE = /[ßẞæÆœŒøØđĐðÐłŁþÞıħĦ]/g;   // letters NFKD leaves alone
  const CAMEL = /(\p{Ll})(?=\p{Lu})/gu;            // $irCarti, PlayboiCarti: mark a sub-token boundary
  const SYM_RE = /[$@&¥€]|(?<=\p{L})!(?=\p{L})/gu; // symbols used as letters: Ca$h, M@ze, R&B, ¥$, FE!N
  const SYM = { $: 's', '@': 'a', '&': ' and ', '¥': 'y', '€': 'e', '!': 'i' };
  const SPLIT = /[^\p{L}\p{N}\u0001]+/u;
  const VS = /[\uFE0E\uFE0F\u200D]/g;              // emoji presentation selectors / joiners
  // Most tags are plain ASCII: skip NFKD and the Unicode-class regexes for them (2-3x faster index build)
  const NON_ASCII = /[^\x00-\x7f]/;
  const APOS_A = /['`]/g, CAMEL_A = /([a-z])(?=[A-Z])/g, SYM_A = /[$@&]|(?<=[A-Za-z])!(?=[A-Za-z])/g, SPLIT_A = /[^a-z0-9\u0001]+/;
  const isDigit = (c) => c >= 48 && c <= 57;
  const sym = (c, i, s) => ((c === '$' || c === '€') && isDigit(s.charCodeAt(i + 1)) ? ' ' : SYM[c]);  // $100 is money, not an s

  // Folded lowercase words of s; camel=true marks camel-case boundaries inside words with \u0001.
  function words(s, camel) {
    s = String(s ?? '');
    let out;
    if (!NON_ASCII.test(s)) {
      s = s.replace(APOS_A, '');
      if (camel) s = s.replace(CAMEL_A, '$1\u0001');
      out = s.replace(SYM_A, sym).toLowerCase().split(SPLIT_A);
    } else {
      s = s.replace(APOS, '');
      // NFKD splits accents off their letters (é -> e + ◌́) and flattens look-alikes (ﬁ, ｆｕｌｌ, ²); the marks are then dropped
      s = s.normalize('NFKD').replace(MARKS, '').replace(LETTER_RE, (c) => LETTER[c]);
      if (camel) s = s.replace(CAMEL, '$1\u0001');
      out = s.replace(SYM_RE, sym).toLowerCase().split(SPLIT);
    }
    if (out.length && out[out.length - 1] === '') out.pop();
    if (out.length && out[0] === '') out.shift();
    return out;
  }
  const tokens = (s) => words(s, false);
  const normalize = (s) => words(s, false).join(' ');

  // Field tokens; camel-case words also yield their parts ("sircarti" + "sir", "carti").
  function fieldTokens(text) {
    const out = [];
    for (const w of words(text, true)) {
      if (w.indexOf('\u0001') < 0) { out.push({ t: w, subs: null }); continue; }
      const parts = w.split('\u0001').filter(Boolean);
      out.push({ t: parts.join(''), subs: parts.length > 1 ? parts : null });
    }
    return out;
  }

  // Sound-alike skeleton: vampyre = vampire, fashun = fashion, scot = scott, karti = carti, boyz = boys.
  // One pass equivalent to: -tion/-sion/-shun -> shn, ight -> ite, ph -> f, wh -> w, chr -> kr, qu -> kw, q -> k, ck -> k,
  // c before e/i/y -> s, other c (not ch) -> k, z -> s, y -> i, then doubled letters collapsed.
  const TION = /(?:ss|sh|[tsc])i[ou]n|sh[ou]n/g, IGHT = /ight/g;
  function skeleton(t) {
    if (t.length < 3) return t;
    if (t.indexOf('n') >= 0) t = t.replace(TION, 'shn');
    if (t.indexOf('ight') >= 0) t = t.replace(IGHT, 'ite');
    let out = '', last = '';
    for (let i = 0; i < t.length; i++) {
      let c = t[i];
      const nx = t[i + 1];
      if (c === 'p') { if (nx === 'h') { c = 'f'; i++; } }
      else if (c === 'w') { if (nx === 'h') i++; }
      else if (c === 'q') {
        if (nx === 'u') { if (last !== 'k') out += 'k'; last = 'k'; c = 'w'; i++; } else c = 'k';
      } else if (c === 'c') {
        if (nx === 'k') { c = 'k'; i++; }
        else if (nx === 'h') { if (t[i + 2] === 'r') { if (last !== 'k') out += 'k'; last = 'k'; c = 'r'; i += 2; } }
        else c = nx === 'e' || nx === 'i' || nx === 'y' ? 's' : 'k';
      } else if (c === 'z') c = 's';
      else if (c === 'y') c = 'i';
      if (c !== last) { out += c; last = c; }
    }
    return out;
  }

  // ---------- bounded Damerau-Levenshtein (optimal string alignment) ----------
  const R0 = new Int32Array(72), R1 = new Int32Array(72), R2 = new Int32Array(72);
  // Distance from a to b, and from a to the closest prefix of b, both capped at k + 1.
  // Packed as full | prefix << 4 so the hot loop allocates nothing.
  function osa(a, b, k) {
    const n = a.length, bl = b.length, big = k + 1, m = bl < n + k ? bl : n + k;
    if (n - m > k || n > 64) return big | (big << 4);
    let r2 = R0, r1 = R1, r0 = R2;
    for (let j = 0; j <= m; j++) r1[j] = j < big ? j : big;
    for (let i = 1; i <= n; i++) {
      const ai = a.charCodeAt(i - 1), ap = i > 1 ? a.charCodeAt(i - 2) : -1;
      const lo = i - k > 1 ? i - k : 1, hi = i + k < m ? i + k : m;
      let rowMin = r0[lo - 1] = lo === 1 && i < big ? i : big;
      for (let j = lo; j <= hi; j++) {
        const bj = b.charCodeAt(j - 1);
        let d = r1[j - 1] + (ai === bj ? 0 : 1), x = r1[j] + 1;
        if (x < d) d = x;
        if ((x = r0[j - 1] + 1) < d) d = x;
        if (j > 1 && ai === b.charCodeAt(j - 2) && ap === bj && (x = r2[j - 2] + 1) < d) d = x;
        r0[j] = d < big ? d : big;
        if (d < rowMin) rowMin = d;
      }
      if (hi < m) r0[hi + 1] = big;
      if (rowMin >= big) return big | (big << 4);
      const t = r2; r2 = r1; r1 = r0; r0 = t;
    }
    let pre = big;
    for (let j = n - k > 0 ? n - k : 0; j <= m; j++) if (r1[j] < pre) pre = r1[j];
    const full = m === bl && bl - n <= k ? r1[bl] : big;
    return full | (pre << 4);
  }
  function distance(a, b, max = 2) {
    const r = osa(String(a), String(b), max) & 15;
    return r > max ? max + 1 : r;
  }

  function maskOf(s) {
    let m = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      m |= c >= 97 && c <= 122 ? 1 << (c - 97) : isDigit(c) ? 1 << (26 + ((c - 48) % 5)) : 1 << 31;
    }
    return m;
  }
  function pop(x) {
    x -= (x >>> 1) & 0x55555555;
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }

  // ---------- query parsing ----------
  // Joiners people type differently from how tags spell them; skipped if absent, unless being typed.
  const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'x', 'feat', 'ft', 'featuring', 'with', 'w', 'vs', 'prod', 'by']);
  const typosFor = (n) => (n <= 3 ? 0 : n <= 6 ? 1 : 2);
  function parse(q) {
    const toks = [], raw = [];
    for (const chunk of String(q ?? '').split(/\s+/)) {
      if (!chunk) continue;
      const ws = words(chunk, false);
      if (ws.length) toks.push(...ws);
      else { const r = chunk.toLowerCase().replace(VS, ''); if (r) raw.push(r); }  // emoji / symbol-only: literal match
    }
    return {
      raw,
      tokens: toks.map((t, i) => {
        const last = i === toks.length - 1, digits = /\d/.test(t);
        return { t, s: skeleton(t), n: t.length, last, opt: !last && STOP.has(t), digits, k: digits ? 0 : typosFor(t.length) };
      }),
    };
  }

  // ---------- scoring tables ----------
  // Per query token: tier points (exact > prefix > skeleton > typo) x field weight, plus small position/length bonuses.
  // prefixLast stays under exact x artist weight (90): "carti" should rank Playboi Carti above a song titled "Cartier".
  const P = {
    exact: 100, prefixLast: 85, prefix: 74, skel: 70, skelPrefixLast: 64, skelPrefix: 56, infix: 60,
    typo1: 50, typo1Prefix: 46, typo2: 40, typo2Prefix: 36, compact: 85, compactPrefixLast: 70, compactPrefix: 60, compactInfix: 50,
  };
  const SUB_PENALTY = 4;              // matched a camel-case part ("carti" in $irCarti), a hair below the whole word
  const POS = Float64Array.from({ length: 32 }, (_, i) => (i === 31 ? 0 : 20 / (i + 1)));
  const SHORT = Float64Array.from({ length: 256 }, (_, n) => (n ? 20 / n : 0));
  const PHRASE = 60, WHOLE_FIELD = 100, OPTIONAL = 0.3, RAW = 400;
  const NOMATCH = 255;

  // ---------- index ----------
  // getFields(item) -> [title, artist, album, fileName]; entries are cached per item and rebuilt only when those strings change.
  function createIndex(getFields, opts = {}) {
    const W = Float64Array.from([0, 1, 2, 3], (i) => (opts.weights || [1, 0.9, 0.75, 0.6])[i] * 10 || 0);
    let vocab, toks, skels, nmask, smask, cvocab, ctoks, entries, prims, tokCache, qCache;
    let epoch = 0, replaced = 0;
    const ix = { version: undefined };

    function reset() {
      vocab = new Map(); toks = []; skels = [];
      nmask = new Int32Array(4096); smask = new Int32Array(4096);
      cvocab = new Map(); ctoks = [];
      entries = new WeakMap(); prims = new Map();
      tokCache = new Map(); qCache = new Map();
      epoch++; replaced = 0; ix.version = undefined;
    }
    reset();

    function intern(t) {
      let id = vocab.get(t);
      if (id !== undefined) return id;
      id = toks.length;
      vocab.set(t, id);
      toks.push(t);
      const s = skeleton(t);
      skels.push(s);
      if (id >= nmask.length) {
        const a = new Int32Array(nmask.length * 2), b = new Int32Array(nmask.length * 2);
        a.set(nmask); b.set(smask); nmask = a; smask = b;
      }
      nmask[id] = maskOf(t);
      smask[id] = maskOf(s);
      return id;
    }
    function internCompact(c) {
      let id = cvocab.get(c);
      if (id === undefined) { id = ctoks.length; cvocab.set(c, id); ctoks.push(c); }
      return id;
    }

    function build(fields) {
      const ids = [], meta = [], nt = new Uint8Array(4), cids = new Int32Array([-1, -1, -1, -1]);
      for (let f = 0; f < 4; f++) {
        const text = fields[f];
        if (!text || (f > 0 && fields.indexOf(text) < f)) continue;   // untagged songs: title is the file name, index it once
        const ft = fieldTokens(text);
        nt[f] = ft.length < 255 ? ft.length : 255;
        for (let p = 0; p < ft.length; p++) {
          const pos = p < 30 ? p : 30, m = (f << 6) | pos;
          ids.push(intern(ft[p].t)); meta.push(m);
          if (ft[p].subs) for (const s of ft[p].subs) { ids.push(intern(s)); meta.push(m | 32); }
        }
        if (ft.length > 1) cids[f] = internCompact(ft.map((x) => x.t).join(''));
      }
      return { f0: fields[0], f1: fields[1], f2: fields[2], f3: fields[3], epoch, ids: Int32Array.from(ids), meta: Uint8Array.from(meta), nt, cids, raw: null };
    }

    // Cached entry for item, rebuilt only when one of its field strings changed.
    function prepare(item) {
      const map = item !== null && typeof item === 'object' ? entries : prims;
      const e = map.get(item);
      const raw = getFields(item) || [];
      const f = [raw[0] || '', raw[1] || '', raw[2] || '', raw[3] || ''];
      if (e && e.epoch === epoch && e.f0 === f[0] && e.f1 === f[1] && e.f2 === f[2] && e.f3 === f[3]) return e;
      if (e) replaced++;
      const ne = build(f);
      map.set(item, ne);
      return ne;
    }
    function entryOf(item) {
      const e = (item !== null && typeof item === 'object' ? entries : prims).get(item);
      return e && e.epoch === epoch ? e : prepare(item);
    }

    // Re-check items against their cached entries (cheap when nothing changed). Pass the data version to skip repeat calls.
    ix.sync = (items, version) => {
      if (version !== undefined && version === ix.version) return false;
      const list = Array.isArray(items) ? items : Array.from(items);   // may be a Map iterator; read twice below
      const before = replaced;
      for (let i = 0; i < list.length; i++) prepare(list[i]);
      // Edits orphan old tokens; once that is a big share, start a clean vocabulary.
      if (replaced > before && replaced > 2000 && replaced > list.length / 2) { reset(); for (let i = 0; i < list.length; i++) prepare(list[i]); }
      ix.version = version;
      return true;
    };
    ix.prepare = (item) => { prepare(item); };
    ix.forget = (item) => { (item !== null && typeof item === 'object' ? entries : prims).delete(item); };
    ix.clear = reset;
    ix.stats = () => ({ vocab: toks.length, compact: ctoks.length, cachedTokens: tokCache.size, cachedQueries: qCache.size });

    // Tier points of one query token against vocabulary ids [from, to).
    function scan(te, from, to) {
      const { t: q, s: qs, n, last, k, digits } = te.q;
      const arr = te.arr, pPre = last ? P.prefixLast : P.prefix, sPre = last ? P.skelPrefixLast : P.skelPrefix;
      const qm = maskOf(q), qsm = maskOf(qs), qsn = qs.length;
      const k1 = k + 1;
      let count = 0;
      for (let id = from; id < to; id++) {
        const t = toks[id];
        let p = 0;
        const at = t.indexOf(q);
        if (at === 0) p = t.length === n ? P.exact : pPre;
        else if (at > 0 && n > 1) p = P.infix;
        // Sound-alikes must still be spelled close, or skeleton folding drifts (light ~ liter):
        // whole word within k+2 plain edits (nite ~ night), a prefix within max(1, k)
        if (p < P.skel && n >= 3 && !digits && skels[id].startsWith(qs)) {
          const r = osa(q, t, k + 2);
          if (skels[id].length === qsn && (r & 15) <= k + 2) p = P.skel;
          else if (r >> 4 <= (k || 1) && sPre > p) p = sPre;
        }
        if (p < P.typo1 && k) {
          const tl = t.length;
          if ((last ? tl >= n - k1 : tl - n <= k1 && n - tl <= k1) && pop(qm & ~nmask[id]) <= k1) {
            const r = osa(q, t, k1);
            let full = r & 15, pre = r >> 4;
            // sound-alike plus a typo (kartie ~ cartier): whole words only, 5+ letters, nearly spelled right;
            // otherwise it drifts (cash ~ kush, xyzzy ~ pissy, light ~ liter)
            if (full > 1 && full <= k1 && n >= 5 && skels[id].length >= 4 && pop(qsm & ~smask[id]) <= k) {
              const rs = osa(qs, skels[id], k) & 15;
              if (rs < full) full = rs;
            }
            const v = full <= k ? (full <= 1 ? P.typo1 : P.typo2) : last && pre <= k ? (pre <= 1 ? P.typo1Prefix : P.typo2Prefix) : 0;
            if (v > p) p = v;
          }
        }
        if (p) { arr[id] = p; count++; }
      }
      te.count += count;
    }
    function scanCompact(ce, from, to) {
      const { t: q, n, last } = ce.q, arr = ce.arr;
      for (let id = from; id < to; id++) {
        const c = ctoks[id], at = c.indexOf(q);
        if (at === 0) arr[id] = c.length === n ? P.compact : last ? P.compactPrefixLast : P.compactPrefix;
        else if (at > 0) arr[id] = P.compactInfix;
      }
    }
    const grow = (arr, need) => {
      if (arr.length >= need) return arr;
      const a = new Uint8Array(Math.max(need, arr.length * 2));
      a.set(arr);
      return a;
    };
    // Bring a cached token's points up to date with any vocabulary added since it was scanned.
    function refresh(te) {
      if (te.len < toks.length) { te.arr = grow(te.arr, toks.length); scan(te, te.len, toks.length); te.len = toks.length; }
      if (te.c && te.c.len < ctoks.length) { te.c.arr = grow(te.c.arr, ctoks.length); scanCompact(te.c, te.c.len, ctoks.length); te.c.len = ctoks.length; }
    }
    function tokenEntry(q) {
      const key = (q.last ? '1' : '0') + q.t;
      let te = tokCache.get(key);
      if (te && te.epoch === epoch) { tokCache.delete(key); tokCache.set(key, te); return te; }
      te = { q, epoch, arr: new Uint8Array(toks.length + 64), len: 0, count: 0, c: q.n >= 4 ? { q, arr: new Uint8Array(ctoks.length + 64), len: 0 } : null };
      tokCache.set(key, te);
      if (tokCache.size > 160) tokCache.delete(tokCache.keys().next().value);
      return te;
    }

    function compile(q) {
      const { tokens: qt, raw } = parse(q);
      const n = qt.length;
      const cq = { epoch, query: q, empty: !n && !raw.length, n, raw, tes: qt.map(tokenEntry), opt: qt.map((x) => x.opt), order: null };
      for (const te of cq.tes) refresh(te);
      // most selective required token first, so most songs are rejected after one pass
      cq.order = qt.map((_, i) => i).sort((a, b) => cq.opt[a] - cq.opt[b] || cq.tes[a].count - cq.tes[b].count);
      cq.bs = new Float64Array(n); cq.bm = new Uint8Array(n); cq.bp = new Uint8Array(n);
      cq.score = (item) => score(cq, item);
      return cq;
    }
    ix.query = (q) => {
      q = String(q ?? '');
      let cq = qCache.get(q);
      if (!cq || cq.epoch !== epoch) {
        cq = compile(q);
        qCache.set(q, cq);
        if (qCache.size > 40) qCache.delete(qCache.keys().next().value);
      }
      return cq;
    };

    function score(cq, item) {
      if (cq.empty) return 1;
      const e = entryOf(item);
      if (cq.epoch !== epoch) return ix.query(cq.query).score(item);
      const { tes, order, n, bs, bm, bp } = cq;
      for (let i = 0; i < n; i++) refresh(tes[i]);
      const ids = e.ids, meta = e.meta, L = ids.length, nt = e.nt, cids = e.cids;
      let total = 0;
      for (let oi = 0; oi < n; oi++) {
        const j = order[oi], te = tes[j], arr = te.arr;
        let best = 0, m = NOMATCH, pts = 0;
        for (let k = 0; k < L; k++) {
          const p = arr[ids[k]];
          if (p === 0) continue;
          const mk = meta[k], f = mk >> 6;
          const s = (mk & 32 ? p - SUB_PENALTY : p) * W[f] + POS[mk & 31] + SHORT[nt[f]];
          if (s > best) { best = s; m = mk; pts = p; }
        }
        if (te.c) {
          const carr = te.c.arr;
          for (let f = 0; f < 4; f++) {
            const cid = cids[f];
            if (cid < 0 || !carr[cid]) continue;
            const s = carr[cid] * W[f] + SHORT[nt[f]];
            if (s > best) { best = s; m = (f << 6) | 63; pts = carr[cid]; }
          }
        }
        bm[j] = m; bp[j] = pts; bs[j] = best;
        if (!best) { if (cq.opt[j]) continue; return 0; }
        total += cq.opt[j] ? best * OPTIONAL : best;
      }
      if (cq.raw.length) {
        const raw = (e.raw ??= `${e.f0}\n${e.f1}\n${e.f2}\n${e.f3}`.toLowerCase().replace(VS, ''));
        for (const r of cq.raw) { if (raw.indexOf(r) < 0) return 0; total += RAW; }
      }
      if (n > 1) {
        // adjacent query words that sit next to each other in one field ("travis scott", "lil uzi vert")
        for (let j = 1; j < n; j++) {
          const a = bm[j - 1], b = bm[j];
          if (a === NOMATCH || b === NOMATCH || a >> 6 !== b >> 6) continue;
          const pa = a & 31, pb = b & 31, d = pb - pa;
          if (pa < 31 && pb < 31 && d >= 0 && d <= 1) total += PHRASE;
        }
      }
      // the query covers a whole field: title "Vamp" for "vamp", artist "Lil Uzi Vert" for "lil uzi vert"
      let c0 = 0, c1 = 0, c2 = 0, c3 = 0;
      for (let j = 0; j < n; j++) {
        if (bp[j] !== P.exact || bm[j] & 32) continue;
        const f = bm[j] >> 6;
        if (f === 0) c0++; else if (f === 1) c1++; else if (f === 2) c2++; else c3++;
      }
      if ((c0 && c0 >= nt[0]) || (c1 && c1 >= nt[1]) || (c2 && c2 >= nt[2]) || (c3 && c3 >= nt[3])) total += WHOLE_FIELD;
      return total;
    }

    // Ranked matches, best first; ties keep the input order (pass items in the library's current sort).
    ix.rank = (q, items) => {
      const cq = ix.query(q), out = [];
      let i = 0;
      for (const item of items) { const s = cq.score(item); if (s > 0) out.push({ item, score: s, i }); i++; }
      return out.sort((a, b) => b.score - a.score || a.i - b.i);
    };
    ix.search = (q, items) => ix.rank(q, items).map((r) => r.item);
    return ix;
  }

  // One-off matching for short lists (playlist names): shared index keyed by the text itself.
  let textIx = null;
  function match(text, query) {
    textIx ??= createIndex((s) => [s]);
    return textIx.query(query).score(String(text ?? ''));
  }

  return { normalize, tokens, skeleton, distance, parse, createIndex, match, STOP };
});
