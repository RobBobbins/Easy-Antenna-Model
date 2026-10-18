// The 3D view: antenna, ground, radiation pattern, view cube, view buttons and orbit.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export type PatternStyle = 'default' | 'solid' | 'wireframe' | 'slices' | 'dots' | 'mirror';
import type { Pattern } from './nec/parse';
import type { Geometry, P3 } from './antennas';
import { createSky } from './sky';

const root = document.documentElement;
const css = (name: string) => getComputedStyle(root).getPropertyValue(name).trim();

// NEC (x east, y north, z up) -> three.js (x, y up, z towards viewer)
const necDir = (thetaDeg: number, phiDeg: number) => {
  const t = THREE.MathUtils.degToRad(thetaDeg), p = THREE.MathUtils.degToRad(phiDeg);
  return new THREE.Vector3(Math.sin(t) * Math.cos(p), Math.cos(t), -Math.sin(t) * Math.sin(p));
};

function heat(t: number): THREE.Color {
  const stops: Array<[number, number]> = [[0, 0x2b4cff], [0.25, 0x00c8ff], [0.5, 0x22d36b], [0.75, 0xffd400], [1, 0xff3b1f]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const f = (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]);
      return new THREE.Color(stops[i - 1][1]).lerp(new THREE.Color(stops[i][1]), f);
    }
  }
  return new THREE.Color(stops[stops.length - 1][1]);
}

const FLOOR_DB = 25; // pattern shows the strongest 25 dB

export function createScene() {
  const view = document.getElementById('view')!;
  const holder = document.getElementById('three')!;
  const cubeCanvas = document.getElementById('cube') as HTMLCanvasElement;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  holder.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.2;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 25);
  scene.add(sun);

  // ground
  let grid = new THREE.GridHelper(30, 15);
  scene.add(grid);

  // antenna wires, feed point, support poles
  // wires: true to scale when zoomed in close; further out a minimum width that grows
  // gently with wire size (28 AWG = 2 px, 14 AWG ≈ 3.2 px), set every frame
  const wireMat = new LineMaterial({ linewidth: 3, worldUnits: false });
  let wireDiaM = 0.001628;
  let wireMinPx = 3.2;
  // default camera distance for a 10 m antenna (25% closer than the first version)
  const VIEW_DIST = 40.95;
  let openingDist = VIEW_DIST;   // camera distance of the opening view; further out, the minimum tapers to 1 px
  const poleMat = new THREE.LineDashedMaterial({ dashSize: 0.6, gapSize: 0.4 });
  const antennaGroup = new THREE.Group();
  scene.add(antennaGroup);
  // feed point: a round dot 10 pixels across at any zoom
  const dot = document.createElement('canvas');
  dot.width = dot.height = 64;
  const dg = dot.getContext('2d')!;
  dg.fillStyle = '#ff8a00';
  dg.beginPath(); dg.arc(32, 32, 30, 0, Math.PI * 2); dg.fill();
  const feed = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)),
    new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, map: new THREE.CanvasTexture(dot), transparent: true, alphaTest: 0.5, depthTest: false }),
  );
  feed.renderOrder = 2;
  scene.add(feed);

  // radiation pattern
  const patMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  const patLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 });
  const pattern = new THREE.Group();
  scene.add(pattern);

  // size of the scene, from the antenna; 1 = a 10 m antenna
  let scale = 1;
  let fittedScale = 0;

  const toThree = (p: P3) => new THREE.Vector3(p[0], p[2], -p[1]);

  /** eyeHeightM: when given, the camera moves to this antenna's default view with its eye at that height (NEC metres). */
  function setAntenna(geo: Geometry, wireDiaMm: number, eyeHeightM: number | null = null) {
    wireDiaM = wireDiaMm / 1000;
    wireMinPx = Math.max(2, 2 + 0.5 * Math.log2(wireDiaMm / 0.32));
    const pts = geo.wires.flatMap(w => [toThree(w.a), toThree(w.b)]);
    const box = new THREE.Box3().setFromPoints(pts);
    const size = box.getSize(new THREE.Vector3());
    const top = box.max.y;
    scale = Math.max(size.x, size.z, top * 0.8, 6) / 10;
    openingDist = VIEW_DIST * scale;

    // rebuild wires and poles
    antennaGroup.children.forEach(c => (c as THREE.Mesh).geometry.dispose());
    antennaGroup.clear();
    const seg: number[] = [];
    for (const w of geo.wires) {
      const a = toThree(w.a), b = toThree(w.b);
      seg.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    antennaGroup.add(new LineSegments2(new LineSegmentsGeometry().setPositions(seg), wireMat));
    poleMat.dashSize = 0.6 * scale;
    poleMat.gapSize = 0.4 * scale;
    for (const p of geo.poles) {
      const t = toThree(p);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(t.x, 0, t.z), t]), poleMat);
      line.computeLineDistances();
      antennaGroup.add(line);
    }
    const fp = toThree(geo.feedPoint);
    feed.position.copy(fp);
    pattern.position.copy(fp);

    const target = new THREE.Vector3((box.min.x + box.max.x) / 2, top * 0.7, (box.min.z + box.max.z) / 2);
    const reset = !fittedScale || eyeHeightM !== null;
    if (reset) {
      // the antenna's default view, from the usual side angle
      const dir = new THREE.Vector3(35.4, 0, 41.6).normalize();
      const dist = VIEW_DIST * scale;
      camera.position.set(target.x + dir.x * dist, eyeHeightM ?? fp.y, target.z + dir.z * dist);
      controls.target.copy(target);
    } else {
      // keep the viewing angle, follow the antenna
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      // and pull back or move in when the antenna changes size
      if (scale / fittedScale > 1.25 || scale / fittedScale < 0.8) {
        const offset = camera.position.clone().sub(target).multiplyScalar(scale / fittedScale);
        camera.position.copy(target).add(offset);
      }
    }
    controls.update();

    // regrow the ground when the antenna changes size
    if (reset || scale / fittedScale > 1.25 || scale / fittedScale < 0.8) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid = new THREE.GridHelper(30 * scale, 15);
      scene.add(grid);
      mirrorMat.uniforms.gridHalf.value = 15 * scale;
      mirrorMat.uniforms.gridCell.value = 2 * scale;
      fittedScale = scale;
      applyTheme();
    }
  }

  // ---------- radiation pattern, in one of five styles ----------
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const meshLineMat = new THREE.LineBasicMaterial({ vertexColors: true });
  const dotMat = new THREE.PointsMaterial({ vertexColors: true, size: 3, sizeAttenuation: false });
  const sliceMat = new LineMaterial({ vertexColors: true, linewidth: 2.5, worldUnits: false });
  // mirror: chrome. Far surroundings (sky gradient or stars) come from a photo taken from the
  // middle of the pattern, which is exact for things far away. The ground and grid, which are
  // close, are worked out exactly per point: the reflected ray is traced to the ground plane.
  const mirrorTarget = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const mirrorCam = new THREE.CubeCamera(0.1, 5000, mirrorTarget);
  const mirrorMat = new THREE.ShaderMaterial({
    uniforms: {
      env: { value: mirrorTarget.texture },
      gridHalf: { value: 15 }, gridCell: { value: 2 }, gridColor: { value: new THREE.Color() },
      floorNear: { value: new THREE.Color() }, floorHorizon: { value: new THREE.Color() }, nightFloor: { value: 0 },
      sunDir: { value: new THREE.Vector3(20, 40, 25).normalize() },
    },
    vertexShader: `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform samplerCube env;
      uniform float gridHalf;
      uniform float gridCell;
      uniform vec3 gridColor;
      uniform vec3 floorNear;
      uniform vec3 floorHorizon;
      uniform float nightFloor;
      uniform vec3 sunDir;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 r = reflect(normalize(vWorld - cameraPosition), n);
        vec3 col;
        if (r.y < 0.0) {
          // the reflected ray hits the ground: find where, and draw the grid there
          vec3 hit = vWorld + r * (-vWorld.y / r.y);
          float far = length(hit.xz - cameraPosition.xz);
          col = nightFloor > 0.5 ? mix(floorNear, floorHorizon, smoothstep(150.0, 2800.0, far)) : floorHorizon;
          vec2 q = hit.xz / gridCell;
          vec2 d = abs(fract(q) - 0.5);
          vec2 w = fwidth(q);
          float line = 1.0 - min(min((0.5 - d.x) / max(w.x, 1e-4), (0.5 - d.y) / max(w.y, 1e-4)), 1.0);
          float inside = step(abs(hit.x), gridHalf) * step(abs(hit.z), gridHalf);
          col = mix(col, gridColor, line * inside);
        } else {
          col = textureCube(env, r).rgb;   // sky: exact, since it is far away
        }
        col *= 0.92;                                         // polished metal reflects a little less
        col += vec3(1.0) * pow(max(dot(r, sunDir), 0.0), 300.0) * 1.5;  // the scene light's glint
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  // the reflection is taken from the middle of the pattern, not its feed point,
  // so ground-level feeds (verticals) still see the grid below them
  const mirrorCentre = new THREE.Vector3();
  let lastPattern: Pattern | null = null;
  let style: PatternStyle = 'default';

  function setPatternStyle(s: PatternStyle) {
    style = s;
    setPattern(lastPattern);
  }

  function setPattern(p: Pattern | null) {
    lastPattern = p;
    pattern.children.forEach(c => (c as THREE.Mesh).geometry.dispose());
    pattern.clear();
    if (!p) return;
    const R = 13 * scale;
    const nT = p.thetas.length, nP = p.phis.length;
    // one point per (theta, phi): distance from the feed point = strength in that direction
    const point = (i: number, j: number) => {
      const g = p.gain[i][j];
      const t = g <= -999 ? 0 : Math.max(0, (g - p.maxGain + FLOOR_DB) / FLOOR_DB);
      return { pos: necDir(p.thetas[i], p.phis[j]).multiplyScalar(t * R), col: heat(t) };
    };
    const pos: number[] = [], col: number[] = [];
    for (let i = 0; i < nT; i++) {
      for (let j = 0; j < nP; j++) {
        const q = point(i, j);
        pos.push(q.pos.x, q.pos.y, q.pos.z);
        col.push(q.col.r, q.col.g, q.col.b);
      }
    }
    const surface = () => {
      const idx: number[] = [];
      for (let i = 0; i < nT - 1; i++) {
        for (let j = 0; j < nP - 1; j++) {
          const a = i * nP + j, b = a + nP;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    };

    if (style === 'default') {
      const geo = surface();
      pattern.add(new THREE.Mesh(geo, patMat));
      pattern.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), patLineMat));
    } else if (style === 'solid') {
      pattern.add(new THREE.Mesh(surface(), solidMat));
    } else if (style === 'mirror') {
      const geo = surface();
      geo.computeBoundingBox();
      geo.boundingBox!.getCenter(mirrorCentre);
      pattern.add(new THREE.Mesh(geo, mirrorMat));
    } else if (style === 'wireframe') {
      // the grid lines along theta and phi, each coloured by strength
      const lp: number[] = [], lc: number[] = [];
      const seg = (i1: number, j1: number, i2: number, j2: number) => {
        const a = (i1 * nP + j1) * 3, b = (i2 * nP + j2) * 3;
        lp.push(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2]);
        lc.push(col[a], col[a + 1], col[a + 2], col[b], col[b + 1], col[b + 2]);
      };
      for (let i = 0; i < nT; i++) for (let j = 0; j < nP - 1; j++) seg(i, j, i, j + 1);
      for (let i = 0; i < nT - 1; i++) for (let j = 0; j < nP; j++) seg(i, j, i + 1, j);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
      pattern.add(new THREE.LineSegments(geo, meshLineMat));
    } else if (style === 'dots') {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      pattern.add(new THREE.Points(geo, dotMat));
    } else {
      // slices: a compass ring at the angle of strongest signal,
      // and a vertical cut through the direction of strongest signal
      const ti = p.thetas.indexOf(p.maxTheta);
      const ring = Array.from({ length: nP }, (_, j) => point(ti, j));
      const jF = p.phis.indexOf(p.maxPhi);
      const jB = p.phis.findIndex(ph => Math.abs(ph - ((p.maxPhi + 180) % 360)) < 1e-6);
      const cut = [
        ...Array.from({ length: nT }, (_, k) => point(nT - 1 - k, jF)),  // horizon (or straight down) up to straight up
        ...Array.from({ length: nT - 1 }, (_, k) => point(k + 1, jB)),   // and down the far side
      ];
      for (const line of [ring, cut]) {
        const g = new LineGeometry();
        g.setPositions(line.flatMap(q => [q.pos.x, q.pos.y, q.pos.z]));
        g.setColors(line.flatMap(q => [q.col.r, q.col.g, q.col.b]));
        pattern.add(new Line2(g, sliceMat));
      }
    }
  }

  // ---------- view cube ----------
  const cubeRenderer = new THREE.WebGLRenderer({ canvas: cubeCanvas, antialias: true, alpha: true });
  cubeRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  cubeRenderer.setSize(110, 110, false);
  const cubeScene = new THREE.Scene();
  const cubeCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  const FACES = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']; // +X -X +Y -Y +Z -Z
  let cubeMats: THREE.MeshBasicMaterial[] = [];
  function faceTexture(label: string, fill: string, text: string, edge: string) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = fill; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = edge; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
    g.fillStyle = text; g.font = 'bold 22px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 64, 66);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  cubeScene.add(cube);
  const hoverMark = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }));
  hoverMark.visible = false;
  cubeScene.add(hoverMark);

  // ---------- theme colours into 3D ----------
  // sky dome: the background colour overhead, fading to a contrasting shade at the horizon,
  // so the pattern stands out and Mirror has a light-to-dark horizon to reflect.
  // It moves with whichever camera is looking, so it always reads as a distant sky.
  const domeMat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vDir;
      void main() {
        // horizon colour from straight ahead down; the chosen colour from about 20° up
        float t = smoothstep(-0.05, 0.35, normalize(vDir).y);
        gl_FragColor = vec4(mix(horizon, top, t), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), domeMat);
  dome.renderOrder = -1;
  scene.add(dome);

  // background: the theme's colour, or one the user picked. With a picked colour the grid,
  // ground and wire switch to shades that stand out against it.
  let bgOverride: string | null = null;
  // night sky: the real stars over a black sky that glows blue-grey near the horizon
  const sky = createSky(scene, renderer.getPixelRatio());
  let night = false;
  function setBackground(hex: string | null, nightSky = false) {
    bgOverride = nightSky ? '#000000' : hex;
    night = nightSky;
    sky.setVisible(night);
    applyTheme();
  }

  function applyTheme() {
    const bg = new THREE.Color(bgOverride ?? css('--view-bg'));
    const light = bg.getHSL({ h: 0, s: 0, l: 0 }).l > 0.5;
    // mixed in screen colours (sRGB) so the step looks even to the eye
    const horizon = night
      ? new THREE.Color(0x1c2636)
      : bg.clone().convertLinearToSRGB().lerp(new THREE.Color(light ? 0x000000 : 0xffffff), light ? 0.22 : 0.18).convertSRGBToLinear();
    domeMat.uniforms.top.value.copy(bg);
    domeMat.uniforms.horizon.value.copy(horizon);
    mirrorMat.uniforms.floorHorizon.value.copy(horizon);
    mirrorMat.uniforms.floorNear.value.set(0x0a0c10);
    mirrorMat.uniforms.nightFloor.value = night ? 1 : 0;
    scene.background = horizon;
    sky.setHorizon(horizon);
    const gridCol = new THREE.Color(bgOverride ? (light ? '#9aa6b5' : '#3a4656') : css('--grid'));
    const gm = grid.material as THREE.LineBasicMaterial;
    gm.color = gridCol;
    gm.vertexColors = false;
    gm.needsUpdate = true;
    mirrorMat.uniforms.gridColor.value.copy(gridCol); // the real grid's colour, unchanged
    wireMat.color.set(bgOverride ? (light ? '#17202b' : '#e6edf3') : css('--wire'));
    poleMat.color = gridCol;
    cubeMats.forEach(m => { m.map?.dispose(); m.dispose(); });
    cubeMats = FACES.map(f => new THREE.MeshBasicMaterial({ map: faceTexture(f, css('--panel'), css('--text'), css('--border')) }));
    cube.material = cubeMats;
  }
  new MutationObserver(applyTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------- camera moves (CAD-style glide) ----------
  let glide: null | { from: THREE.Vector3; dist: number; q: THREE.Quaternion; start: number; ms: number } = null;
  function flyTo(dir: THREE.Vector3) {
    const to = dir.clone().normalize();
    if (Math.abs(to.y) > 0.999) to.set(0, Math.sign(to.y), 0.001).normalize();
    const from = camera.position.clone().sub(controls.target).normalize();
    glide = { from, dist: camera.position.distanceTo(controls.target), q: new THREE.Quaternion().setFromUnitVectors(from, to), start: performance.now(), ms: 800 };
    controls.enabled = false;
  }
  const VIEWS: Record<string, THREE.Vector3> = {
    front: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(1, 0, 0),
    top: new THREE.Vector3(0, 1, 0),
    iso: new THREE.Vector3(1, 0.65, 1.15),
  };
  document.querySelectorAll<HTMLButtonElement>('#views button').forEach(b => {
    b.addEventListener('click', () => flyTo(VIEWS[b.dataset.view!]));
  });

  const orbitBtn = document.getElementById('orbitBtn')!;
  orbitBtn.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    orbitBtn.textContent = 'Orbit: ' + (controls.autoRotate ? 'On' : 'Off');
    orbitBtn.classList.toggle('on', controls.autoRotate);
  });

  // view cube clicks: 6 faces, 12 edges, 8 corners
  const ray = new THREE.Raycaster();
  function cubeHit(ev: PointerEvent | MouseEvent) {
    const r = cubeCanvas.getBoundingClientRect();
    const p = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, cubeCam);
    const hit = ray.intersectObject(cube)[0];
    if (!hit) return null;
    const snap = (v: number) => (Math.abs(v) > 0.3 ? Math.sign(v) : 0);
    return new THREE.Vector3(snap(hit.point.x), snap(hit.point.y), snap(hit.point.z));
  }
  cubeCanvas.addEventListener('pointermove', ev => {
    const d = cubeHit(ev);
    hoverMark.visible = !!d;
    if (d) hoverMark.position.copy(d).multiplyScalar(0.5);
    cubeCanvas.style.cursor = d ? 'pointer' : 'default';
  });
  cubeCanvas.addEventListener('pointerleave', () => { hoverMark.visible = false; });
  cubeCanvas.addEventListener('click', ev => { const d = cubeHit(ev); if (d) flyTo(d); });

  // ---------- size + loop ----------
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    renderer.setSize(w, h, false);
    wireMat.resolution.set(w, h);
    sliceMat.resolution.set(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(view);
  resize();

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const ident = new THREE.Quaternion();
  function frame(now: number) {
    if (glide) {
      const t = Math.min(1, (now - glide.start) / glide.ms);
      const q = ident.clone().slerp(glide.q, ease(t));
      camera.position.copy(glide.from).applyQuaternion(q).multiplyScalar(glide.dist).add(controls.target);
      camera.lookAt(controls.target);
      if (t === 1) { glide = null; controls.enabled = true; controls.update(); }
    } else {
      controls.update();
    }
    const pxPerM = renderer.domElement.clientHeight / (2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const dist = camera.position.distanceTo(controls.target);
    const minPx = Math.max(1, wireMinPx * Math.min(1, openingDist / dist));
    wireMat.linewidth = Math.max(wireDiaM * pxPerM, minPx);
    if (style === 'mirror' && pattern.children.length) {
      // photograph only the far surroundings (sky, stars) from inside the pattern;
      // the near ground and grid are drawn exactly by the mirror shader instead
      pattern.visible = false;
      grid.visible = false;
      antennaGroup.visible = false;
      feed.visible = false;
      mirrorCam.position.copy(pattern.position).add(mirrorCentre);
      dome.position.copy(mirrorCam.position);
      sky.group.position.copy(mirrorCam.position);
      sky.ground.position.set(mirrorCam.position.x, -0.2, mirrorCam.position.z);
      sky.reflecting(true);
      mirrorCam.update(renderer, scene);
      sky.reflecting(false);
      pattern.visible = true;
      grid.visible = true;
      antennaGroup.visible = true;
      feed.visible = true;
    }
    dome.position.copy(camera.position);
    sky.group.position.copy(camera.position);
    sky.ground.position.set(camera.position.x, -0.2, camera.position.z);
    renderer.render(scene, camera);
    const dir = camera.position.clone().sub(controls.target).normalize();
    cubeCam.position.copy(dir).multiplyScalar(3.4);
    cubeCam.up.copy(camera.up);
    cubeCam.lookAt(0, 0, 0);
    cubeRenderer.render(cubeScene, cubeCam);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  (window as unknown as { __eam: unknown }).__eam = { camera, controls, wireMat };
  return { setAntenna, setPattern, setPatternStyle, setBackground, setSkyLocation: sky.setLocation, setConstellations: sky.setLines };
}
