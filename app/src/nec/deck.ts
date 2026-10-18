// Builds the NEC-2 input ("card deck") that nec2c reads.
import type { Geometry } from '../antennas';

export type GroundKey = 'average' | 'poor' | 'good' | 'salt' | 'free';

// Relative permittivity and conductivity (S/m) for each ground choice.
export const GROUNDS: Record<Exclude<GroundKey, 'free'>, { eps: number; sigma: number }> = {
  average: { eps: 13, sigma: 0.005 },
  poor: { eps: 5, sigma: 0.001 },
  good: { eps: 14, sigma: 0.01 },
  salt: { eps: 80, sigma: 5 },
};

export interface DeckInput {
  geometry: Geometry;
  wireDiaMm: number;
  ground: GroundKey;
  freqMhz: number;      // frequency the pattern is calculated at
  sweepStartMhz: number;
  sweepStopMhz: number;
  sweepSteps: number;
}

// Pattern grid the deck asks for: theta from straight up, phi around the compass.
export const PATTERN_STEP = 5;

export function patternThetaCount(ground: GroundKey): number {
  // over ground only the upper half is meaningful; free space gets the full sphere
  return (ground === 'free' ? 180 : 90) / PATTERN_STEP + 1;
}
export const PATTERN_PHI_COUNT = 360 / PATTERN_STEP + 1;

const f = (n: number, d = 6) => n.toFixed(d);

export function buildDeck(p: DeckInput): string {
  const radius = p.wireDiaMm / 2000;
  const step = p.sweepSteps > 1 ? (p.sweepStopMhz - p.sweepStartMhz) / (p.sweepSteps - 1) : 0;
  const g = p.geometry;

  const lines = ['CM Easy Antenna Model', 'CE'];
  g.wires.forEach((w, i) => {
    lines.push(`GW ${i + 1} ${w.segs} ${f(w.a[0])} ${f(w.a[1])} ${f(w.a[2])} ${f(w.b[0])} ${f(w.b[1])} ${f(w.b[2])} ${f(radius, 7)}`);
  });
  lines.push('GE 0');
  if (p.ground !== 'free') {
    const gr = GROUNDS[p.ground];
    lines.push(`GN 2 0 0 0 ${gr.eps} ${gr.sigma}`);
  }
  lines.push(
    `EX 0 ${g.feed.wire} ${g.feed.seg} 0 1 0`,
    'PT -1 0 0 0',
    // impedance across the band, no pattern
    `FR 0 ${p.sweepSteps} 0 0 ${f(p.sweepStartMhz)} ${f(step)}`,
    'XQ',
    // full 3D pattern at the chosen frequency
    `FR 0 1 0 0 ${f(p.freqMhz)} 0`,
    `RP 0 ${patternThetaCount(p.ground)} ${PATTERN_PHI_COUNT} 1000 0 0 ${PATTERN_STEP} ${PATTERN_STEP}`,
    'EN',
  );
  return lines.join('\n') + '\n';
}
