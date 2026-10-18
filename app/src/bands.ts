// Amateur bands offered as quick picks (US band edges, MHz).

export interface Band { key: string; label: string; lo: number; hi: number; pick: number }

export const BANDS: Band[] = [
  { key: '80', label: '80 m', lo: 3.5, hi: 4.0, pick: 3.75 },
  { key: '40', label: '40 m', lo: 7.0, hi: 7.3, pick: 7.15 },
  { key: '20', label: '20 m', lo: 14.0, hi: 14.35, pick: 14.175 },
  { key: '15', label: '15 m', lo: 21.0, hi: 21.45, pick: 21.225 },
  { key: '10', label: '10 m', lo: 28.0, hi: 29.7, pick: 28.4 },
];

export function bandFor(mhz: number): Band | undefined {
  return BANDS.find(b => mhz >= b.lo && mhz <= b.hi);
}

// Sweep range for the SWR graph: the band edges, or ±2.5% when outside a band.
export function sweepFor(mhz: number): { lo: number; hi: number } {
  const b = bandFor(mhz);
  return b ? { lo: b.lo, hi: b.hi } : { lo: mhz * 0.975, hi: mhz * 1.025 };
}
