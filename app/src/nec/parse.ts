// Reads nec2c's text output back into numbers.

export interface ImpedancePoint {
  mhz: number;
  r: number; // resistance, ohms
  x: number; // reactance, ohms
}

export interface Pattern {
  mhz: number;
  thetas: number[];          // degrees from straight up
  phis: number[];            // degrees around, from +X (east)
  gain: number[][];          // total gain dBi, gain[thetaIndex][phiIndex]; -999.99 = none
  maxGain: number;
  maxTheta: number;
  maxPhi: number;
}

export interface NecResult {
  points: ImpedancePoint[];  // one per frequency, in the order nec2c ran them
  pattern: Pattern | null;
}

const FREQ_RE = /FREQUENCY\s*:\s*([-+\d.E]+)\s*MHz/i;
const NUM = /^[-+]?\d*\.?\d+(E[-+]?\d+)?$/i;

export function parseNec(text: string): NecResult {
  const lines = text.split(/\r?\n/);
  const points: ImpedancePoint[] = [];
  let mhz = NaN;
  let section: 'none' | 'input' | 'pattern' = 'none';
  let patMhz = NaN;
  const rows: Array<[number, number, number]> = [];

  for (const line of lines) {
    const fm = FREQ_RE.exec(line);
    if (fm) { mhz = parseFloat(fm[1]); section = 'none'; continue; }
    if (line.includes('ANTENNA INPUT PARAMETERS')) { section = 'input'; continue; }
    if (line.includes('RADIATION PATTERNS')) { section = 'pattern'; patMhz = mhz; rows.length = 0; continue; }
    if (line.includes('-----') || line.includes('DATA CARD')) {
      if (section === 'pattern' && rows.length) section = 'none';
      continue;
    }

    const t = line.trim().split(/\s+/);
    if (section === 'input') {
      // TAG SEG  V(re) V(im)  I(re) I(im)  Z(re) Z(im)  Y(re) Y(im)  POWER
      if (t.length >= 8 && /^\d+$/.test(t[0]) && /^\d+$/.test(t[1]) && NUM.test(t[6]) && NUM.test(t[7])) {
        points.push({ mhz, r: parseFloat(t[6]), x: parseFloat(t[7]) });
        section = 'none';
      }
    } else if (section === 'pattern') {
      // THETA PHI  VERT HOR TOTAL ...
      if (t.length >= 5 && NUM.test(t[0]) && NUM.test(t[1]) && NUM.test(t[4])) {
        rows.push([parseFloat(t[0]), parseFloat(t[1]), parseFloat(t[4])]);
      }
    }
  }

  return { points, pattern: rows.length ? toGrid(rows, patMhz) : null };
}

function toGrid(rows: Array<[number, number, number]>, mhz: number): Pattern {
  const thetas = [...new Set(rows.map(r => r[0]))].sort((a, b) => a - b);
  const phis = [...new Set(rows.map(r => r[1]))].sort((a, b) => a - b);
  const gain = thetas.map(() => phis.map(() => -999.99));
  let maxGain = -Infinity, maxTheta = 0, maxPhi = 0;
  for (const [th, ph, g] of rows) {
    gain[thetas.indexOf(th)][phis.indexOf(ph)] = g;
    if (g > maxGain) { maxGain = g; maxTheta = th; maxPhi = ph; }
  }
  return { mhz, thetas, phis, gain, maxGain, maxTheta, maxPhi };
}
