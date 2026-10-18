// Feedline (coax or ladder line) loss and SWR, worked out after the antenna calculation.

export type CoaxKey = 'rg8x' | 'rg58' | 'rg213' | 'lmr400' | 'ladder450';

// Matched-line loss per 100 ft = a·√f + b·f  (f in MHz), fitted to typical published figures.
export const LINES: Record<CoaxKey, { name: string; z0: number; a: number; b: number }> = {
  rg8x: { name: 'RG-8X', z0: 50, a: 0.291, b: 0.00787 },
  rg58: { name: 'RG-58', z0: 50, a: 0.421, b: 0.00692 },
  rg213: { name: 'RG-213', z0: 50, a: 0.185, b: 0.0015 },
  lmr400: { name: 'LMR-400', z0: 50, a: 0.12229, b: 0.00026 },
  ladder450: { name: '450 Ω ladder line', z0: 450, a: 0.03, b: 0 },
};

export function matchedLossDb(line: CoaxKey, mhz: number, lengthM: number): number {
  const l = LINES[line];
  const per100ft = l.a * Math.sqrt(mhz) + l.b * mhz;
  return per100ft * (lengthM * 3.28084) / 100;
}

// |reflection coefficient| of a load against a line impedance
export function gammaMag(r: number, x: number, z0: number): number {
  const nr = r - z0, dr = r + z0;
  return Math.sqrt((nr * nr + x * x) / (dr * dr + x * x));
}

export const swrFromGamma = (g: number) => (g >= 0.999999 ? 999 : (1 + g) / (1 - g));

export interface FeedResult {
  swrAntenna: number;     // at the antenna end, after the balun
  swrRadio: number;       // at the radio end of the line
  totalLossDb: number;    // line loss including the extra loss from mismatch
  powerFraction: number;  // share of the radio's power that reaches the antenna
}

/**
 * r, x: antenna feed impedance from NEC. balunRatio: impedance ratio (4 for 4:1).
 * The balun is treated as ideal; it divides the antenna impedance by its ratio.
 */
export function feedline(r: number, x: number, balunRatio: number, line: CoaxKey, mhz: number, lengthM: number): FeedResult {
  const z0 = LINES[line].z0;
  const gL = gammaMag(r / balunRatio, x / balunRatio, z0);
  const a = Math.pow(10, matchedLossDb(line, mhz, lengthM) / 10); // matched power loss ratio
  const gIn = gL / a;
  const lossRatio = (a * a - gL * gL) / (a * (1 - gL * gL));
  return {
    swrAntenna: swrFromGamma(gL),
    swrRadio: swrFromGamma(gIn),
    totalLossDb: 10 * Math.log10(lossRatio),
    powerFraction: 1 / lossRatio,
  };
}
