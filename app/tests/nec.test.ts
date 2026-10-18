// Runs our card-deck builder and parser against the real nec2c engine.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDeck } from '../src/nec/deck.ts';
import { geometry, problem, type Settings } from '../src/antennas.ts';
import { parseNec } from '../src/nec/parse.ts';
import { feedline } from '../src/feedline.ts';

const dir = new URL('../public/engine/', import.meta.url);
const g = globalThis as Record<string, unknown>;
g.self = globalThis;
g.importScripts = () => {};
g.location = { href: 'file:///x' };
const createNec2c = new Function(readFileSync(new URL('nec2c.js', dir), 'utf8') + '; return createNec2c;')();
const wasm = readFileSync(new URL('nec2c.wasm', dir));

const base: Settings = { antenna: 'dipole', maxMhz: 14.35, freqMhz: 14.175, lengthM: 10.1, heightM: 10, wireDiaMm: 1.628,
  invEndM: 3.048, efhwFeedM: 3.048, gpVertM: 5.0, gpRadM: 5.2, gpRadN: 4, gpDroopDeg: 45, gpBaseM: 6,
  arrRefLenM: 5.25, arrRefSpM: 4.2, arrDirLenM: 4.75, arrDirSpM: 4.2 };
function deckFor(s: Partial<Settings>, ground: 'average' | 'free', lo: number, hi: number, steps: number) {
  const set = { ...base, ...s, maxMhz: Math.max(hi, s.freqMhz ?? base.freqMhz) };
  return buildDeck({ geometry: geometry(set), wireDiaMm: set.wireDiaMm, ground, freqMhz: set.freqMhz, sweepStartMhz: lo, sweepStopMhz: hi, sweepSteps: steps });
}

async function run(deck: string): Promise<string> {
  const nec = await createNec2c({
    instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) => {
      WebAssembly.instantiate(wasm, imports).then(r => done(r.instance));
      return {};
    },
    print: () => {}, printErr: () => {},
  });
  nec.FS.writeFile('/in.nec', deck);
  try { nec.callMain(['-i', '/in.nec', '-o', '/out.txt']); } catch { /* exit() */ }
  return nec.FS.readFile('/out.txt', { encoding: 'utf8' });
}

test('free-space 20 m dipole matches the engine check from the build', async () => {
  const deck = deckFor({ freqMhz: 14.1, lengthM: 10.63, heightM: 0, wireDiaMm: 2 }, 'free', 14.0, 14.2, 3);
  const res = parseNec(await run(deck));
  assert.equal(res.points.length, 4);
  const c = res.points[3];
  assert.equal(c.mhz, 14.1);
  assert.ok(Math.abs(c.r - 78.82) < 0.05, `R ${c.r}`);
  assert.ok(Math.abs(c.x - 44.57) < 0.05, `X ${c.x}`);
  assert.ok(res.pattern);
  assert.ok(Math.abs(res.pattern.maxGain - 2.16) < 0.02, `gain ${res.pattern.maxGain}`);
  // broadside to the wire (phi 90) it is full strength; off the wire end (phi 0) almost nothing
  const th90 = res.pattern.thetas.indexOf(90);
  assert.ok(Math.abs(res.pattern.gain[th90][res.pattern.phis.indexOf(90)] - 2.16) < 0.02);
  assert.ok(res.pattern.gain[th90][res.pattern.phis.indexOf(0)] < -50);
  assert.equal(res.pattern.thetas.length, 37);
  assert.equal(res.pattern.phis.length, 73);
});

test('dipole 10 m over average ground: lobe goes up, horizon is weak', async () => {
  const deck = deckFor({}, 'average', 14.0, 14.35, 21);
  const res = parseNec(await run(deck));
  assert.equal(res.points.length, 22);
  assert.equal(res.points[0].mhz, 14.0);
  assert.equal(res.points[20].mhz, 14.35);
  const p = res.pattern!;
  assert.equal(p.thetas.length, 19);
  const elev = 90 - p.maxTheta;
  assert.ok(elev >= 20 && elev <= 45, `best angle ${elev}`);
  assert.ok(p.maxGain > 5 && p.maxGain < 9, `gain ${p.maxGain}`);
  const horizon = p.gain[p.thetas.indexOf(90)][0];
  assert.ok(horizon < p.maxGain - 15, `horizon ${horizon}`);
  console.log('  20 m dipole, 10 m up:', res.points[21], 'gain', p.maxGain, 'dBi at', elev, 'deg');
});

test('feedline: perfect match loses only the matched loss', () => {
  const fr = feedline(50, 0, 1, 'lmr400', 14, 30.48); // 100 ft
  const expected = 0.12229 * Math.sqrt(14) + 0.00026 * 14;
  assert.ok(Math.abs(fr.totalLossDb - expected) < 1e-4);
  assert.equal(fr.swrAntenna, 1);
});

test('feedline: loss hides mismatch at the radio', () => {
  const fr = feedline(150, 0, 1, 'rg58', 28, 30.48); // SWR 3 at the antenna, lossy line
  assert.ok(Math.abs(fr.swrAntenna - 3) < 1e-9);
  assert.ok(fr.swrRadio < fr.swrAntenna);
  assert.ok(fr.powerFraction < 1 && fr.powerFraction > 0);
});

test('balun 4:1 brings 200 ohms down to 50', () => {
  const fr = feedline(200, 0, 4, 'rg213', 7, 10);
  assert.ok(Math.abs(fr.swrAntenna - 1) < 1e-9);
});

test('inverted V on 20 m: impedance lower than a flat dipole, near 50 ohms', async () => {
  const res = parseNec(await run(deckFor({ antenna: 'invv', lengthM: 10.4, heightM: 10, invEndM: 7 }, 'average', 14.0, 14.35, 3)));
  const c = res.points[3];
  assert.ok(c.r > 30 && c.r < 75, `R ${c.r}`);
  console.log('  inverted V:', c, 'gain', res.pattern!.maxGain);
});

test('EFHW on 20 m: very high impedance at the end feed', async () => {
  const res = parseNec(await run(deckFor({ antenna: 'efhw', lengthM: 10.3, heightM: 10, efhwFeedM: 3 }, 'average', 14.0, 14.35, 3)));
  const c = res.points[3];
  assert.ok(Math.hypot(c.r, c.x) > 1000, `Z ${c.r} ${c.x}`);
  console.log('  EFHW:', c, 'gain', res.pattern!.maxGain);
});

test('ground plane on 20 m: around 50 ohms, low angle, round pattern', async () => {
  const res = parseNec(await run(deckFor({ antenna: 'gp', gpVertM: 5.0, gpRadM: 5.2, gpRadN: 4, gpDroopDeg: 45, gpBaseM: 6 }, 'average', 14.0, 14.35, 3)));
  const c = res.points[3];
  const p = res.pattern!;
  assert.ok(c.r > 25 && c.r < 80, `R ${c.r}`);
  assert.ok(90 - p.maxTheta < 40, `angle ${90 - p.maxTheta}`);
  const row = p.gain[p.thetas.indexOf(p.maxTheta)];
  assert.ok(Math.abs(row[p.phis.indexOf(0)] - row[p.phis.indexOf(45)]) < 1.5, 'not round');
  console.log('  ground plane:', c, 'gain', p.maxGain, 'at', 90 - p.maxTheta, 'deg');
});

test('impossible shapes are caught before the engine runs', () => {
  assert.ok(problem({ ...base, antenna: 'invv', heightM: 5, invEndM: 6 }));
  assert.ok(problem({ ...base, antenna: 'invv', lengthM: 4, heightM: 10, invEndM: 2 }));
  assert.ok(problem({ ...base, antenna: 'efhw', lengthM: 3, heightM: 10, efhwFeedM: 2 }));
  assert.ok(problem({ ...base, antenna: 'gp', gpBaseM: 2, gpRadM: 5, gpDroopDeg: 45 }));
  assert.ok(problem({ ...base, antenna: 'invv', lengthM: 10.4, heightM: 10, invEndM: 5.0 })); // legs would hang almost straight down
  assert.equal(problem({ ...base, antenna: 'gp', gpBaseM: 6 }), null);
  assert.equal(problem({ ...base, antenna: 'gp', gpBaseM: 0.0508, gpDroopDeg: 0 }), null); // on the ground, flat radials
});

test('ground-mounted ground plane on 20 m: runs, lower impedance and gain than raised', async () => {
  const res = parseNec(await run(deckFor({ antenna: 'gp', gpVertM: 5.0, gpRadM: 5.2, gpRadN: 4, gpDroopDeg: 0, gpBaseM: 0.0508 }, 'average', 14.0, 14.35, 3)));
  const c = res.points[3];
  assert.ok(c.r > 5 && c.r < 80, `R ${c.r}`);
  console.log('  ground-mounted GP:', c, 'gain', res.pattern!.maxGain, 'at', 90 - res.pattern!.maxTheta, 'deg');
});

test('3-element ground plane array on 20 m: beams towards the director', async () => {
  // raised 6 m with radials drooping 45°, the usual way an elevated vertical beam is built
  const res = parseNec(await run(deckFor({ antenna: 'gpa', gpVertM: 5.0292, gpRadM: 5.0292, gpDroopDeg: 45, gpBaseM: 6, arrRefLenM: 5.27304, arrDirLenM: 4.78536, arrRefSpM: 4.23672, arrDirSpM: 4.23672 }, 'average', 14.0, 14.35, 3)));
  const p = res.pattern!;
  const row = p.gain[p.thetas.indexOf(p.maxTheta)];
  const fb = row[p.phis.indexOf(0)] - row[p.phis.indexOf(180)];
  assert.ok(p.maxPhi <= 20 || p.maxPhi >= 340, `beam at phi ${p.maxPhi}`);
  assert.ok(fb > 5, `front-to-back ${fb}`);
  console.log('  3-el array:', res.points[3], 'gain', p.maxGain, 'dBi at', 90 - p.maxTheta, 'deg, F/B', fb.toFixed(1), 'dB');
});

test('array radials: 8 in sideways fans fit the 20 m first-use spacing; too-long radials are caught', () => {
  const first = { ...base, antenna: 'gpa' as const, gpVertM: 5.0292, gpRadM: 5.0292, gpRadN: 8, gpDroopDeg: 0, gpBaseM: 0.0508,
    arrRefLenM: 5.27304, arrRefSpM: 4.23672, arrDirLenM: 4.78536, arrDirSpM: 4.23672 };
  assert.equal(problem(first), null);
  assert.equal(geometry(first).wires.length, 27); // 3 elements x (vertical + 8 radials)
  assert.ok(problem({ ...first, arrRefSpM: 2.1 }));      // the old 10 m spacing on 20 m
  assert.equal(problem({ ...first, gpRadN: 2, arrRefSpM: 2.1 }), null); // one each side points straight out: never touches
});

test('ground-mounted 3-element array, 8 radials: forward beam', async () => {
  const res = parseNec(await run(deckFor({ antenna: 'gpa', gpVertM: 5.0292, gpRadM: 5.0292, gpRadN: 8, gpDroopDeg: 0, gpBaseM: 0.0508,
    arrRefLenM: 5.27304, arrDirLenM: 4.78536, arrRefSpM: 4.23672, arrDirSpM: 4.23672 }, 'average', 14.0, 14.35, 3)));
  const p = res.pattern!;
  const row = p.gain[p.thetas.indexOf(p.maxTheta)];
  const fb = row[p.phis.indexOf(0)] - row[p.phis.indexOf(180)];
  assert.ok(fb > 8, `front-to-back ${fb}`);
  console.log('  ground-mounted array, 8 radials: gain', p.maxGain, 'dBi, F/B', fb.toFixed(1), 'dB');
});
