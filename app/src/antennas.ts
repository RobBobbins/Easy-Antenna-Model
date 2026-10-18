// Antenna shapes. Each turns the settings into straight wires for the engine and the 3D view.
// NEC coordinates: X east, Y north, Z up, all in metres.

export type AntennaKey = 'dipole' | 'invv' | 'efhw' | 'gp' | 'gpa';

export const ANTENNA_NAMES: Record<AntennaKey, string> = {
  dipole: 'Dipole',
  invv: 'Inverted V',
  efhw: 'EFHW',
  gp: 'Ground plane vertical',
  gpa: 'Ground plane array (3 el)',
};

export type P3 = [number, number, number];

export interface Wire { a: P3; b: P3; segs: number }

export interface Geometry {
  wires: Wire[];
  feed: { wire: number; seg: number }; // 1-based, as NEC counts them
  feedPoint: P3;
  poles: P3[];                          // points held up by a support, drawn as a dashed line to the ground
}

export interface Settings {
  antenna: AntennaKey;
  maxMhz: number;      // top of the frequency sweep, sets the segment size
  freqMhz: number;
  lengthM: number;     // total wire length (dipole, inverted V, EFHW)
  heightM: number;     // shared Height box: wire / apex / far end height
  wireDiaMm: number;
  invEndM: number;     // inverted V: height of both wire ends
  efhwFeedM: number;   // EFHW: height of the feed end
  gpVertM: number;     // ground plane: vertical length
  gpRadM: number;      // ground plane: radial length
  gpRadN: number;      // ground plane: number of radials (per element in the array)
  gpDroopDeg: number;  // ground plane: radial droop below horizontal
  gpBaseM: number;     // ground plane: base height (starts on the ground)
  arrRefLenM: number;  // array: reflector length
  arrRefSpM: number;   // array: reflector spacing behind the driver
  arrDirLenM: number;  // array: director length
  arrDirSpM: number;   // array: director spacing in front of the driver
}

const C = 299.792458;

// segments no longer than 1/20 wavelength; odd so a centre segment exists
function segs(lenM: number, maxMhz: number, min: number): number {
  let n = Math.max(min, Math.ceil(lenM / (C / maxMhz / 20)));
  if (n % 2 === 0) n += 1;
  return Math.min(n, 201);
}

const FAN_SPREAD = 20 * Math.PI / 180;

const ft = (m: number) => (m * 3.28084).toFixed(1) + ' ft';

/** Returns a reason when the settings can't make this antenna, otherwise null. */
export function problem(s: Settings): string | null {
  switch (s.antenna) {
    case 'invv': {
      if (s.invEndM >= s.heightM) return 'End height must be below the apex height';
      // legs must slope outwards, not hang straight down
      if (s.heightM - s.invEndM >= 0.95 * s.lengthM / 2) return `Each leg is ${ft(s.lengthM / 2)}, too short to drop ${ft(s.heightM - s.invEndM)}`;
      return null;
    }
    case 'efhw':
      if (Math.abs(s.heightM - s.efhwFeedM) >= 0.95 * s.lengthM) return 'The wire is too short to reach between those heights';
      return null;
    case 'gpa': {
      // sideways fans lean up to 20° towards the neighbours; their tips must not meet
      const lean = Math.ceil(s.gpRadN / 2) > 1 ? s.gpRadM * Math.cos(s.gpDroopDeg * Math.PI / 180) * Math.sin(FAN_SPREAD) : 0;
      if (2 * lean >= 0.95 * Math.min(s.arrRefSpM, s.arrDirSpM)) return "Radials would touch the next element's radials; use shorter radials or wider spacing";
    }
    // falls through to the ground check
    case 'gp': {
      const radialEnd = s.gpBaseM - s.gpRadM * Math.sin(s.gpDroopDeg * Math.PI / 180);
      if (radialEnd < 0.025) return 'The radials would reach the ground; raise the base or reduce the droop';
      return null;
    }
    default:
      return null;
  }
}

export function geometry(s: Settings): Geometry {
  const H = s.heightM;
  switch (s.antenna) {
    case 'dipole': {
      const half = s.lengthM / 2;
      const n = segs(s.lengthM, s.maxMhz, 21);
      return {
        wires: [{ a: [-half, 0, H], b: [half, 0, H], segs: n }],
        feed: { wire: 1, seg: (n + 1) / 2 },
        feedPoint: [0, 0, H],
        poles: [[0, 0, H]],
      };
    }

    case 'invv': {
      // left leg, a one-segment feed wire across the apex, right leg
      const segLen = C / s.maxMhz / 20;
      const feedLen = Math.min(segLen, s.lengthM / 20);
      const leg = (s.lengthM - feedLen) / 2;
      const drop = H - s.invEndM;
      const run = Math.sqrt(Math.max(leg * leg - drop * drop, 0));
      const f = feedLen / 2;
      const n = segs(leg, s.maxMhz, 9);
      return {
        wires: [
          { a: [-f - run, 0, s.invEndM], b: [-f, 0, H], segs: n },
          { a: [-f, 0, H], b: [f, 0, H], segs: 1 },
          { a: [f, 0, H], b: [f + run, 0, s.invEndM], segs: n },
        ],
        feed: { wire: 2, seg: 1 },
        feedPoint: [0, 0, H],
        poles: [[0, 0, H]],
      };
    }

    case 'efhw': {
      // short counterpoise | one-segment feed wire | radiator sloping from the feed end to the far end
      const segLen = C / s.maxMhz / 20;
      const feedLen = Math.min(segLen, s.lengthM / 20);
      const cp = 0.05 * C / s.freqMhz;
      const hf = s.efhwFeedM;
      const rad = s.lengthM - feedLen;
      const rise = H - hf;
      const run = Math.sqrt(Math.max(rad * rad - rise * rise, 0));
      return {
        wires: [
          { a: [-feedLen - cp, 0, hf], b: [-feedLen, 0, hf], segs: segs(cp, s.maxMhz, 3) },
          { a: [-feedLen, 0, hf], b: [0, 0, hf], segs: 1 },
          { a: [0, 0, hf], b: [run, 0, H], segs: segs(rad, s.maxMhz, 21) },
        ],
        feed: { wire: 2, seg: 1 },
        feedPoint: [-feedLen / 2, 0, hf],
        poles: [[0, 0, hf], [run, 0, H]],
      };
    }

    case 'gp': {
      const B = s.gpBaseM;
      const n = segs(s.gpVertM, s.maxMhz, 9);
      const droop = s.gpDroopDeg * Math.PI / 180;
      const wires: Wire[] = [{ a: [0, 0, B], b: [0, 0, B + s.gpVertM], segs: n }];
      const rn = segs(s.gpRadM, s.maxMhz, 5);
      for (let i = 0; i < s.gpRadN; i++) {
        const az = (i / s.gpRadN) * 2 * Math.PI;
        const out = s.gpRadM * Math.cos(droop);
        wires.push({ a: [0, 0, B], b: [out * Math.cos(az), out * Math.sin(az), B - s.gpRadM * Math.sin(droop)], segs: rn });
      }
      return {
        wires,
        feed: { wire: 1, seg: 1 },   // bottom of the vertical, where the radials join
        feedPoint: [0, 0, B],
        poles: [[0, 0, B]],
      };
    }

    case 'gpa': {
      // reflector behind (−X), driver, director in front (+X); the beam points along +X
      const B = s.gpBaseM;
      const droop = s.gpDroopDeg * Math.PI / 180;
      const out = s.gpRadM * Math.cos(droop);
      const rn = segs(s.gpRadM, s.maxMhz, 5);
      // radials split into two fans pointing sideways (+Y and −Y), each spread ±20°;
      // with one radial a side it points straight out. An odd one goes left (+Y)
      const left = Math.ceil(s.gpRadN / 2), right = s.gpRadN - left;
      const fan = (centre: number, k: number) =>
        Array.from({ length: k }, (_, i) => centre + (k > 1 ? -FAN_SPREAD + (2 * FAN_SPREAD * i) / (k - 1) : 0));
      const azs = [...fan(Math.PI / 2, left), ...fan(-Math.PI / 2, right)];
      const elements: Array<[number, number]> = [[-s.arrRefSpM, s.arrRefLenM], [0, s.gpVertM], [s.arrDirSpM, s.arrDirLenM]];
      const wires: Wire[] = [];
      let feedWire = 0;
      for (const [x, len] of elements) {
        if (x === 0) feedWire = wires.length + 1;
        wires.push({ a: [x, 0, B], b: [x, 0, B + len], segs: segs(len, s.maxMhz, 9) });
        for (const az of azs) {
          wires.push({ a: [x, 0, B], b: [x + out * Math.cos(az), out * Math.sin(az), B - s.gpRadM * Math.sin(droop)], segs: rn });
        }
      }
      return {
        wires,
        feed: { wire: feedWire, seg: 1 },
        feedPoint: [0, 0, B],
        poles: elements.map(([x]) => [x, 0, B] as P3),
      };
    }
  }
}
