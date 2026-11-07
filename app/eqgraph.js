'use strict';
// Equalizer curve (Settings > Sound): five points you drag up and down (-12 to +12 dB),
// joined by a smooth curve with a soft white glow and a fading fill. Double-click a point: back to 0.
// Changes glide (no jumps) and apply live through Sound.apply().
// Uses app.js globals: S, Sound, reduceMotion.
(() => {
  const W = 470, H = 176, PX = 40, TOP = 16, BOT = 34, MAX = 12;
  const label = (f) => (f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + 'k' : String(f));
  function mount(host, onChange) {
    if (!host || !window.Sound) return null;
    const bands = Sound.BANDS, n = bands.length;
    const xs = bands.map((_, i) => PX + (i / (n - 1)) * (W - PX * 2));
    const yOf = (g) => TOP + ((MAX - g) / (2 * MAX)) * (H - TOP - BOT);
    const gOf = (y) => Math.max(-MAX, Math.min(MAX, Math.round((MAX - ((y - TOP) / (H - TOP - BOT)) * 2 * MAX) * 2) / 2));
    const grid = [12, 6, 0, -6, -12].map((g) => `<line x1="${PX - 14}" x2="${W - PX + 14}" y1="${yOf(g)}" y2="${yOf(g)}" class="eq-grid${g === 0 ? ' zero' : ''}"/>
      <text x="${PX - 18}" y="${yOf(g) + 3.5}" class="eq-db">${g > 0 ? '+' + g : g}</text>`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="eq-svg" role="img" aria-label="Equalizer">
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
        <filter id="eqGlow" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
      </defs>
      ${grid}
      <path class="eq-area" fill="url(#eqFill)"/>
      <path class="eq-glow" filter="url(#eqGlow)"/>
      <path class="eq-line"/>
      ${xs.map((x, i) => `<g class="eq-pt" data-i="${i}"><circle class="eq-hit" cx="${x}" r="20"/><circle class="eq-dot" cx="${x}" r="7"/>
        <text class="eq-val" x="${x}"></text><text class="eq-hz" x="${x}" y="${H - 10}">${label(bands[i])}</text></g>`).join('')}
    </svg>`;
    const svg = host.querySelector('svg');
    const area = svg.querySelector('.eq-area'), glow = svg.querySelector('.eq-glow'), line = svg.querySelector('.eq-line');
    const pts = [...svg.querySelectorAll('.eq-pt')];
    let shown = S.sound.eq.slice(), tween = 0, active = -1;

    // Catmull-Rom through the points, flat out to both edges
    function curve(vals) {
      const p = vals.map((g, i) => [xs[i], yOf(g)]);
      let d = `M 0 ${p[0][1]} L ${p[0][0]} ${p[0][1]}`;
      for (let i = 0; i < p.length - 1; i++) {
        const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0]} ${p2[1].toFixed(1)}`;
      }
      return d + ` L ${W} ${p[p.length - 1][1].toFixed(1)}`;
    }
    function draw(vals) {
      const d = curve(vals);
      line.setAttribute('d', d);
      glow.setAttribute('d', d);
      area.setAttribute('d', `${d} L ${W} ${H - BOT + 6} L 0 ${H - BOT + 6} Z`);
      pts.forEach((g, i) => {
        const y = yOf(vals[i]);
        g.querySelector('.eq-dot').setAttribute('cy', y);
        g.querySelector('.eq-hit').setAttribute('cy', y);
        const t = g.querySelector('.eq-val');
        t.setAttribute('y', y - 14);
        const v = Math.round(vals[i] * 2) / 2;
        t.textContent = (v > 0 ? '+' : '') + v + ' dB';
      });
    }
    // glide from what's shown to S.sound.eq
    function paint(animate = false) {
      const to = S.sound.eq.slice();
      cancelAnimationFrame(tween);
      if (!animate || reduceMotion) { shown = to; draw(shown); return; }
      const from = shown.slice(), t0 = performance.now(), dur = 420;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        shown = from.map((v, i) => v + (to[i] - v) * e);
        draw(shown);
        if (k < 1) tween = requestAnimationFrame(step);
      };
      tween = requestAnimationFrame(step);
    }
    const yFrom = (e) => { const r = svg.getBoundingClientRect(); return ((e.clientY - r.top) / r.height) * H; };
    svg.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('.eq-pt');
      if (!g) return;
      active = +g.dataset.i;
      svg.setPointerCapture(e.pointerId);
      g.classList.add('drag');
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => {
      if (active < 0) return;
      const v = gOf(yFrom(e));
      if (v === S.sound.eq[active]) return;
      S.sound.eq[active] = v;
      S.sound.preset = 'custom';
      cancelAnimationFrame(tween);
      shown = S.sound.eq.slice();
      draw(shown);
      onChange?.();
    });
    const end = () => { if (active < 0) return; pts[active].classList.remove('drag'); active = -1; onChange?.(); };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('dblclick', (e) => {
      const g = e.target.closest('.eq-pt');
      if (!g) return;
      S.sound.eq[+g.dataset.i] = 0;
      paint(true);
      onChange?.();
    });
    draw(shown);
    return { paint };
  }
  window.EqGraph = { mount };
})();
