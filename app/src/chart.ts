// SWR sweep graph, drawn like an antenna analyzer's display. Text is laid out in real pixels
// (the drawing is rebuilt at the graph's actual size), so labels stay the same size on any screen.

export interface SweepPoint { mhz: number; swr: number }

const NS = 'http://www.w3.org/2000/svg';
const SWR_TICKS = [1, 1.5, 2, 3, 5, 10, 20, 50, 100];
const MHZ_STEPS = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];

let last: { pts: SweepPoint[]; cursorMhz: number; cursorSwr: number } | null = null;

export function drawSweep(svg: SVGSVGElement, pts: SweepPoint[], cursorMhz: number, cursorSwr: number) {
  last = { pts, cursorMhz, cursorSwr };
  render(svg);
}

export function watchSize(svg: SVGSVGElement) {
  new ResizeObserver(() => render(svg)).observe(svg);
}

function render(svg: SVGSVGElement) {
  if (!last) return;
  const { pts, cursorMhz, cursorSwr } = last;
  const W = svg.clientWidth, H = svg.clientHeight;
  if (W < 50 || H < 50) return;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const L = 34, R = 10, T = 24, B = 30;           // plot margins
  const pw = W - L - R, ph = H - T - B;
  const lo = pts[0].mhz, hi = pts[pts.length - 1].mhz;
  const top = [3, 5, 10, 20, 50, 100].find(t => Math.max(...pts.map(p => p.swr)) <= t) ?? 100;
  const X = (mhz: number) => L + ((mhz - lo) / (hi - lo)) * pw;
  const Y = (s: number) => T + ph - ((Math.min(s, top) - 1) / (top - 1)) * ph;

  const out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
    out.push(`<line class="${cls}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  const text = (x: number, y: number, s: string, cls: string, anchor = 'middle') =>
    out.push(`<text class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}">${s}</text>`);

  // SWR gridlines and labels; labels too close together are skipped
  let lastLabelY = Infinity;
  for (const t of SWR_TICKS.filter(v => v <= top)) {
    const y = Y(t);
    line(L, y, L + pw, y, t === 1.5 ? 'ref good' : t === 2 ? 'ref ok' : 'grid');
    if (lastLabelY - y >= 13 || t === 1) { text(L - 6, y + 3.5, String(t), 'tick', 'end'); lastLabelY = y; }
  }
  text(L - 6, T - 10, 'SWR', 'axis', 'end');

  // frequency gridlines at a round step, about 60 px or more apart
  const step = MHZ_STEPS.find(s => (s / (hi - lo)) * pw >= 60) ?? 100;
  const dec = (String(step).split('.')[1] ?? '').length;   // 0.25 → 2 decimals, 0.1 → 1
  for (let f = Math.ceil(lo / step - 1e-9) * step; f <= hi + 1e-9; f += step) {
    const x = X(f);
    line(x, T, x, T + ph, 'grid');
    // a label too close to the right edge to centre ends at its gridline instead
    const label = f.toFixed(dec);
    text(x, T + ph + 14, label, 'tick', x + label.length * 3.4 > W ? 'end' : 'middle');
  }
  text(L + pw, T + ph + 27, 'MHz', 'axis', 'end');
  out.push(`<rect class="frame" x="${L}" y="${T}" width="${pw}" height="${ph}"/>`);

  // the sweep
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.mhz).toFixed(1)} ${Y(p.swr).toFixed(1)}`).join(' ');
  out.push(`<path class="curve" d="${d}"/>`);

  // lowest SWR: where the antenna is closest to resonance
  const best = pts.reduce((a, b) => (b.swr < a.swr ? b : a));
  const bx = X(best.mhz), by = Y(best.swr);
  out.push(`<circle class="best" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3.5"/>`);
  const bLabel = `min ${fmt(best.swr)} @ ${best.mhz.toFixed(3)}`;
  const bAnchor = bx < L + 70 ? 'start' : bx > L + pw - 70 ? 'end' : 'middle';
  text(bx, by - 8 < T + 10 ? by + 16 : by - 8, bLabel, 'mark', bAnchor);

  // cursor at the chosen frequency, with its reading at the top
  const cx = X(cursorMhz);
  line(cx, T, cx, T + ph, 'cursor');
  const cLabel = `${cursorMhz.toFixed(3)} MHz · SWR ${fmt(cursorSwr)}`;
  const cAnchor = cx < L + 80 ? 'start' : cx > L + pw - 80 ? 'end' : 'middle';
  text(cx, T - 8, cLabel, 'readout', cAnchor);

  svg.innerHTML = out.join('');
}

const fmt = (s: number) => (s > 99 ? '>99' : s.toFixed(2));
