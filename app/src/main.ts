import './style.css';
import { createScene, type PatternStyle } from './scene';
import { gridToLatLon } from './sky';
import { drawSweep, watchSize } from './chart';
import { buildDeck, type GroundKey } from './nec/deck';
import { geometry, problem, ANTENNA_NAMES, type AntennaKey } from './antennas';
import { parseNec, type NecResult } from './nec/parse';
import { runNec } from './nec/engine';
import { feedline, type CoaxKey } from './feedline';
import { BANDS, bandFor, sweepFor } from './bands';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement;

function store(key: string, val: string) { try { localStorage.setItem(key, val); } catch { /* storage blocked */ } }
function read(key: string) { try { return localStorage.getItem(key); } catch { return null; } }

// ---------- theme: saved choice if there is one, otherwise dark ----------
root.setAttribute('data-theme', read('eam-theme') === 'light' ? 'light' : 'dark');
function showTheme() {
  const t = root.getAttribute('data-theme');
  document.querySelectorAll<HTMLButtonElement>('#theme button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
}
document.querySelectorAll<HTMLButtonElement>('#theme button').forEach(b => {
  b.addEventListener('click', () => { root.setAttribute('data-theme', b.dataset.t!); store('eam-theme', b.dataset.t!); showTheme(); });
});
showTheme();

// ---------- options drawer: open on a first visit, then as the visitor left it ----------
const drawer = $('drawer'), handle = $('drawerHandle');
function setDrawer(open: boolean, save: boolean) {
  drawer.classList.toggle('closed', !open);
  handle.setAttribute('aria-expanded', open ? 'true' : 'false');
  $('drawerArrow').textContent = open ? '▼' : '▲';
  if (save) store('eam-drawer', open ? 'open' : 'closed');
}
setDrawer(read('eam-drawer') !== 'closed', false);
handle.addEventListener('click', () => setDrawer(drawer.classList.contains('closed'), true));

// ---------- number boxes and units ----------
const FT = 3.28084;
let units = read('eam-units') === 'm' ? 'm' : 'ft';
let wireMode: 'awg' | 'dia' = 'awg';
const trim = (n: number, dec: number) => parseFloat(n.toFixed(dec)).toString();
const awgToMm = (n: number) => 0.127 * Math.pow(92, (36 - n) / 39);
const mmToAwg = (d: number) => 36 - 39 * Math.log(d / 0.127) / Math.log(92);
const val = (id: string) => parseFloat($(id).dataset.val!);

// what a box shows, from its stored value (metres, mm or MHz)
function shown(box: HTMLElement) {
  const v = parseFloat(box.dataset.val!);
  switch (box.dataset.kind) {
    case 'freq': return { text: trim(v, 4), unit: 'MHz' };
    case 'len': return units === 'ft' ? { text: trim(v * FT, 2), unit: 'ft' } : { text: trim(v, 3), unit: 'm' };
    case 'count': return { text: trim(v, 0), unit: '' };
    case 'deg': return { text: trim(v, 1), unit: '°' };
    default: return wireMode === 'awg' ? { text: trim(mmToAwg(v), 1), unit: '' } : { text: trim(v, 2), unit: 'mm' };
  }
}
// typed text -> stored value, or null if not a number
function stored(box: HTMLElement, txt: string): number | null {
  if (!/^\s*-?\d*[.,]?\d+\s*$/.test(txt)) return null;
  const n = parseFloat(txt.replace(',', '.'));
  switch (box.dataset.kind) {
    case 'freq': return n;
    case 'len': return units === 'ft' ? n / FT : n;
    case 'count': return Number.isInteger(n) ? n : null;
    case 'deg': return n;
    default: return wireMode === 'awg' ? awgToMm(n) : n;
  }
}
function limitsText(box: HTMLElement) {
  const lo = parseFloat(box.dataset.min!), hi = parseFloat(box.dataset.max!);
  if (box.dataset.kind === 'freq') return `${lo}–${hi} MHz`;
  if (box.dataset.kind === 'count') return `a whole number, ${lo}–${hi}`;
  if (box.dataset.kind === 'deg') return `${lo}–${hi}°`;
  if (box.dataset.kind === 'len') return units === 'ft' ? `${trim(lo * FT, 2)}–${trim(hi * FT, 0)} ft` : `${lo}–${hi} m`;
  return wireMode === 'awg' ? `${trim(mmToAwg(hi), 0)} to ${trim(mmToAwg(lo), 0)} AWG` : `${lo}–${hi} mm`;
}
function paint(box: HTMLElement) {
  const v = shown(box);
  box.querySelector('input')!.value = v.text;
  box.querySelector('.u')!.textContent = v.unit;
}
function paintAll() {
  document.querySelectorAll<HTMLElement>('.nbox').forEach(paint);
  document.querySelectorAll<HTMLButtonElement>('#units button').forEach(b => b.classList.toggle('on', b.dataset.u === units));
  const band = bandFor(val('freqBox'));
  // e.g. "128 ft Dipole @ 32.81 ft - 10 m - 28.4 MHz"
  const vertical = antenna() === 'gp' || antenna() === 'gpa';
  const len = shown($(vertical ? 'gpVertBox' : 'lenBox'));
  const hv = shown($(vertical ? 'gpBaseBox' : 'heightBox'));
  $('legendWhat').textContent = [
    `${len.text} ${len.unit} ${ANTENNA_NAMES[antenna()]} @ ${hv.text} ${hv.unit}`,
    ...(band ? [band.label] : []),
    `${trim(val('freqBox'), 4)} MHz`,
  ].join(' - ');
  document.querySelectorAll<HTMLButtonElement>('#bands button').forEach(b => b.classList.toggle('on', !!band && b.dataset.band === band.key));
}

document.querySelectorAll<HTMLButtonElement>('#units button').forEach(b => {
  b.addEventListener('click', () => { units = b.dataset.u!; store('eam-units', units); paintAll(); });
});
document.querySelectorAll<HTMLButtonElement>('#wiremode button').forEach(b => {
  b.addEventListener('click', () => {
    wireMode = b.dataset.w as 'awg' | 'dia';
    document.querySelectorAll('#wiremode button').forEach(x => x.classList.toggle('on', x === b));
    paintAll();
    saveSetup();
  });
});

// typed numbers count on Enter or leaving the box
document.querySelectorAll<HTMLElement>('.nbox').forEach(box => {
  const input = box.querySelector('input')!;
  const label = box.parentElement!.querySelector('small')!;
  let timer = 0;
  function complain(msg: string) {
    box.classList.add('bad');
    label.classList.add('err');
    label.textContent = msg;
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      box.classList.remove('bad');
      label.classList.remove('err');
      label.textContent = label.dataset.label!;
    }, 3000);
  }
  function commit() {
    const before = shown(box).text;
    if (input.value.trim() === before) return;
    const v = stored(box, input.value);
    if (v === null) { paint(box); complain('Not a number, kept ' + before); return; }
    if (v < parseFloat(box.dataset.min!) || v > parseFloat(box.dataset.max!)) { paint(box); complain('Use ' + limitsText(box)); return; }
    // a value that would make an impossible antenna is undone, with the reason shown
    const previous = box.dataset.val!;
    box.dataset.val = String(v);
    const why = problem(settingsNow());
    if (why) { box.dataset.val = previous; paint(box); complain(why); return; }
    paintAll();
    changed();
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { paint(box); input.blur(); }
  });
  input.addEventListener('blur', commit);
});

// band buttons set the frequency
document.querySelectorAll<HTMLButtonElement>('#bands button').forEach(b => {
  b.addEventListener('click', () => {
    const band = BANDS.find(x => x.key === b.dataset.band);
    if (!band) return;
    $('freqBox').dataset.val = String(band.pick);
    paintAll();
    changed();
  });
});
// balun buttons
let balunRatio = 1;
document.querySelectorAll<HTMLButtonElement>('#balun button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#balun button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    balunRatio = parseFloat(b.dataset.ratio!);
    changed();
  });
});
$('ground').addEventListener('change', changed);

// ---------- antenna picker: each antenna keeps its own setup ----------
const antenna = () => ($('antenna') as HTMLSelectElement).value as AntennaKey;
const HEIGHT_LABEL: Record<AntennaKey, string> = { dipole: 'Height', invv: 'Apex height', efhw: 'Far end height', gp: 'Height', gpa: 'Height' };
function showAntennaBoxes() {
  const a = antenna();
  let shownCount = 0;
  document.querySelectorAll<HTMLElement>('.bar .opt').forEach(o => {
    const off = !!o.dataset.for && !o.dataset.for.split(' ').includes(a);
    o.classList.toggle('off', off);
    if (!off) shownCount++;
  });
  document.querySelector<HTMLElement>('.bar')!.style.setProperty('--rows', String(Math.ceil(shownCount / 2)));
  const hl = $('heightLabel');
  hl.dataset.label = hl.textContent = HEIGHT_LABEL[a];
  $('heightBox').querySelector('input')!.setAttribute('aria-label', HEIGHT_LABEL[a]);
}
$('antenna').addEventListener('change', () => {
  setups[current] = capture();
  current = antenna();
  resetView = true;
  apply(setups[current] ?? defaults(current));
  showAntennaBoxes();
  paintAll();
  changed();
});
$('coax').addEventListener('change', changed);

// ---------- calculation: half a second after the last change ----------
const view3d = createScene();
watchSize($('chart') as unknown as SVGSVGElement);
let pending = 0, runNo = 0;
let resetView = true;
let last: NecResult | null = null;

function changed() {
  saveSetup();
  clearTimeout(pending);
  $('busy').textContent = 'Calculating…';
  $('busy').classList.remove('warn');
  $('busy').hidden = false;
  pending = window.setTimeout(calculate, 500);
}

// the current antenna's settings, read from the boxes
function settingsNow() {
  const freq = val('freqBox');
  return {
    antenna: antenna(), maxMhz: Math.max(freq, sweepFor(freq).hi), freqMhz: freq,
    lengthM: val('lenBox'), heightM: val('heightBox'), wireDiaMm: val('wireBox'),
    invEndM: val('invEndBox'), efhwFeedM: val('efhwFeedBox'),
    gpVertM: val('gpVertBox'), gpRadM: val('gpRadBox'), gpRadN: val('gpRadNBox'), gpDroopDeg: val('gpDroopBox'), gpBaseM: val('gpBaseBox'),
    arrRefLenM: val('arrRefLenBox'), arrRefSpM: val('arrRefSpBox'), arrDirLenM: val('arrDirLenBox'), arrDirSpM: val('arrDirSpBox'),
  };
}

async function calculate() {
  const my = ++runNo;
  const freq = val('freqBox');
  const sweep = sweepFor(freq);
  const ground = ($('ground') as HTMLSelectElement).value as GroundKey;
  const settings = settingsNow();
  // always draw the antenna; if it can't be built, say why and keep the last results
  const geo = geometry(settings);
  // after opening the page or switching antenna, show that antenna's default view:
  // verticals from half the radiator's height, wire antennas level with the feed point
  let eye: number | null = null;
  if (resetView) {
    eye = settings.antenna === 'gp' || settings.antenna === 'gpa' ? settings.gpBaseM + settings.gpVertM / 2 : geo.feedPoint[2];
    resetView = false;
  }
  view3d.setAntenna(geo, settings.wireDiaMm, eye);
  const why = problem(settings);
  const busy = $('busy'), warn = $('viewWarn');
  warn.hidden = !why;
  warn.textContent = why ?? '';
  if (why) {
    busy.textContent = why;
    busy.classList.add('warn');
    busy.hidden = false;
    return;
  }
  busy.textContent = 'Calculating…';
  busy.classList.remove('warn');
  const deck = buildDeck({
    geometry: geo, wireDiaMm: settings.wireDiaMm, ground, freqMhz: freq,
    sweepStartMhz: sweep.lo, sweepStopMhz: sweep.hi, sweepSteps: 21,
  });
  try {
    const result = parseNec(await runNec(deck));
    if (my !== runNo) return; // a newer calculation has started
    if (result.points.length < 2 || !result.pattern) throw new Error('no results');
    last = result;
    showResults();
    view3d.setPattern(result.pattern);
  } catch (err) {
    if (my !== runNo) return;
    $('rVerdict').textContent = 'Engine error';
    $('rVerdict').className = 'verdict bad';
    console.error(err);
  }
  if (my === runNo) $('busy').hidden = true;
}

const fmtSwr = (s: number) => (s > 99 ? '>99' : s.toFixed(2));

function showResults() {
  if (!last || !last.pattern) return;
  const coax = ($('coax') as HTMLSelectElement).value as CoaxKey;
  const coaxLen = val('coaxLenBox');
  const centre = last.points[last.points.length - 1];
  const sweepPts = last.points.slice(0, -1);
  const fr = feedline(centre.r, centre.x, balunRatio, coax, centre.mhz, coaxLen);

  $('rSwrRadio').textContent = fmtSwr(fr.swrRadio);
  const v = $('rVerdict');
  if (fr.swrRadio <= 1.5) { v.textContent = 'Good'; v.className = 'verdict'; }
  else if (fr.swrRadio <= 2) { v.textContent = 'OK'; v.className = 'verdict ok'; }
  else { v.textContent = 'High'; v.className = 'verdict bad'; }
  $('rSwrAnt').textContent = fmtSwr(fr.swrAntenna);
  $('rGain').textContent = `${last.pattern.maxGain.toFixed(1)} dBi`;
  // with no ground there is no "up", so no best angle to show
  const free = ($('ground') as HTMLSelectElement).value === 'free';
  $('rAngle').textContent = free ? '—' : `${Math.round(90 - last.pattern.maxTheta)}° up`;
  // front-to-back: forward (towards the director) against backward, at the best elevation
  const isArray = antenna() === 'gpa';
  $('rowFB').classList.toggle('off', !isArray);
  if (isArray) {
    const p = last.pattern;
    const row = p.gain[p.thetas.indexOf(p.maxTheta)];
    const fb = row[p.phis.indexOf(0)] - row[p.phis.indexOf(180)];
    $('rFB').textContent = `${fb.toFixed(1)} dB`;
  }
  $('rZ').textContent = `${centre.r.toFixed(0)} ${centre.x < 0 ? '−' : '+'} j${Math.abs(centre.x).toFixed(0)} Ω`;
  $('rLoss').textContent = `${fr.totalLossDb.toFixed(2)} dB`;
  $('rPower').textContent = `${Math.round(fr.powerFraction * 100)}%`;
  $('rWatts').textContent = `${Math.round(fr.powerFraction * 100)} W out`;

  // SWR at the radio across the band, drawn like an antenna analyzer
  drawSweep($('chart') as unknown as SVGSVGElement,
    sweepPts.map(p => ({ mhz: p.mhz, swr: feedline(p.r, p.x, balunRatio, coax, p.mhz, coaxLen).swrRadio })),
    centre.mhz, fr.swrRadio);
}

// pattern style: a viewing choice, shared by all antennas and remembered
const patStyle = $('patStyle') as HTMLSelectElement;
const savedStyle = read('eam-pattern');
if (savedStyle && [...patStyle.options].some(o => o.value === savedStyle)) patStyle.value = savedStyle;
view3d.setPatternStyle(patStyle.value as PatternStyle);
patStyle.addEventListener('change', () => { store('eam-pattern', patStyle.value); view3d.setPatternStyle(patStyle.value as PatternStyle); });

// 3D background colour: the theme's, or a picked one; shared by all antennas and remembered
const bgMenu = $('bgMenu'), bgBtn = $('bgBtn');
function setBg(choice: string) {
  const isNight = choice === 'night';
  const hex = choice === 'theme' || isNight ? null : choice;
  view3d.setBackground(hex, isNight);
  $('bgSwatch').style.background = hex ?? '';
  $('bgSwatch').classList.toggle('theme', choice === 'theme');
  $('bgSwatch').classList.toggle('night', isNight);
  store('eam-bg', choice);
}
const savedBg = read('eam-bg');
setBg(savedBg && /^(theme|night|#[0-9a-f]{6})$/i.test(savedBg) ? savedBg : 'theme');

// constellation lines (night sky only), remembered
const constLines = $('constLines') as HTMLInputElement;
constLines.checked = read('eam-constellations') === 'on';
view3d.setConstellations(constLines.checked);
constLines.addEventListener('change', () => { view3d.setConstellations(constLines.checked); store('eam-constellations', constLines.checked ? 'on' : 'off'); });

// grid square: the station's location for the night sky; shared by all antennas, remembered
const gridIn = $('gridSq') as HTMLInputElement;
const gridLabel = $('gridBox').parentElement!.querySelector('small')!;
let gridGood = read('eam-grid') ?? '';
if (!gridToLatLon(gridGood)) gridGood = '';
gridIn.value = gridGood;
view3d.setSkyLocation(gridToLatLon(gridGood));
let gridTimer = 0;
function commitGrid() {
  const v = gridIn.value.trim().toUpperCase();
  if (v === gridGood) { gridIn.value = gridGood; return; }
  if (v !== '' && !gridToLatLon(v)) {
    gridIn.value = gridGood;
    $('gridBox').classList.add('bad');
    gridLabel.classList.add('err');
    gridLabel.textContent = 'Use 4 or 6 characters, like EN91 or EN91WK';
    clearTimeout(gridTimer);
    gridTimer = window.setTimeout(() => { $('gridBox').classList.remove('bad'); gridLabel.classList.remove('err'); gridLabel.textContent = 'Grid square'; }, 3000);
    return;
  }
  gridGood = v;
  gridIn.value = v;
  store('eam-grid', v);
  view3d.setSkyLocation(gridToLatLon(v));
}
gridIn.addEventListener('keydown', e => { if (e.key === 'Enter') gridIn.blur(); if (e.key === 'Escape') { gridIn.value = gridGood; gridIn.blur(); } });
gridIn.addEventListener('blur', commitGrid);
bgBtn.addEventListener('click', () => {
  bgMenu.hidden = !bgMenu.hidden;
  bgBtn.setAttribute('aria-expanded', String(!bgMenu.hidden));
});
bgMenu.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
  b.addEventListener('click', () => { setBg(b.dataset.bg!); bgMenu.hidden = true; bgBtn.setAttribute('aria-expanded', 'false'); });
});
$('bgCustom').addEventListener('input', e => setBg((e.target as HTMLInputElement).value));
document.addEventListener('click', e => {
  if (!bgMenu.hidden && !(e.target as HTMLElement).closest('.bgpick')) { bgMenu.hidden = true; bgBtn.setAttribute('aria-expanded', 'false'); }
});

// legend: on wider screens the name goes top-left and the colour scale bottom-right
// of the 3D view; on phones both sit together in a strip under it
const legend = document.querySelector<HTMLElement>('.legend')!;
const wide = matchMedia('(min-width: 761px)');
function placeLegend() {
  if (wide.matches) $('view').append($('legendWhat'), $('legendScale'));
  else { legend.append($('legendWhat'), $('legendScale')); $('view').after(legend); }
}
wide.addEventListener('change', placeLegend);
placeLegend();

// ---------- each antenna's setup is saved in this browser and comes back next visit ----------
interface Setup { ground: string; coax: string; balun: number; boxes: Record<string, number> }

function capture(): Setup {
  const boxes: Record<string, number> = {};
  document.querySelectorAll<HTMLElement>('.nbox').forEach(b => { boxes[b.id] = parseFloat(b.dataset.val!); });
  return {
    ground: ($('ground') as HTMLSelectElement).value,
    coax: ($('coax') as HTMLSelectElement).value,
    balun: [...document.querySelectorAll('#balun button')].findIndex(b => b.classList.contains('on')),
    boxes,
  };
}

function apply(setup: Setup) {
  const pick = (id: string, v: string) => {
    const sel = $(id) as HTMLSelectElement;
    if ([...sel.options].some(o => o.value === v)) sel.value = v;
  };
  pick('ground', setup.ground);
  pick('coax', setup.coax);
  // only values inside each box's limits are put back
  for (const [id, v] of Object.entries(setup.boxes ?? {})) {
    const box = document.getElementById(id);
    if (box?.classList.contains('nbox') && Number.isFinite(v) &&
        v >= parseFloat(box.dataset.min!) && v <= parseFloat(box.dataset.max!)) box.dataset.val = String(v);
  }
  const balunBtns = [...document.querySelectorAll<HTMLButtonElement>('#balun button')];
  if (balunBtns[setup.balun]) {
    balunBtns.forEach((b, i) => b.classList.toggle('on', i === setup.balun));
    balunRatio = parseFloat(balunBtns[setup.balun].dataset.ratio!);
  }
}

// first-use values: the page's starting values, with each antenna's own changes (metres, MHz)
const PAGE_START = capture();
const FIRST_USE: Record<AntennaKey, Record<string, number>> = {
  dipole: {},
  invv: {},
  efhw: {},
  gp: { freqBox: 14.175, gpVertBox: 5.0292, gpRadBox: 5.0292, gpRadNBox: 4, gpDroopBox: 0, gpBaseBox: 0.0508 },
  gpa: {
    freqBox: 14.175, gpVertBox: 5.0292, gpRadBox: 5.0292, gpRadNBox: 8, gpDroopBox: 0, gpBaseBox: 0.0508,
    arrRefLenBox: 5.27304, arrRefSpBox: 4.23672, arrDirLenBox: 4.78536, arrDirSpBox: 4.23672,
  },
};
function defaults(a: AntennaKey): Setup {
  return { ...PAGE_START, boxes: { ...PAGE_START.boxes, ...FIRST_USE[a] } };
}

let current: AntennaKey = 'dipole';
let setups: Partial<Record<AntennaKey, Setup>> = {};

function saveSetup() {
  setups[current] = capture();
  store('eam-setups', JSON.stringify({ current, setups, wireMode }));
}

function loadSetup() {
  try {
    const saved = JSON.parse(read('eam-setups') ?? '');
    if (saved && typeof saved === 'object' && saved.setups && typeof saved.setups === 'object') setups = saved.setups;
    if (saved?.current in ANTENNA_NAMES) current = saved.current;
    if (saved?.wireMode === 'awg' || saved?.wireMode === 'dia') {
      wireMode = saved.wireMode;
      document.querySelectorAll<HTMLButtonElement>('#wiremode button').forEach(x => x.classList.toggle('on', x.dataset.w === wireMode));
    }
  } catch { /* nothing saved yet */ }
  ($('antenna') as HTMLSelectElement).value = current;
  apply(setups[current] ?? defaults(current));
}

loadSetup();
showAntennaBoxes();
paintAll();
calculate();
