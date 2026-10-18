// Night sky: the real stars (Yale Bright Star Catalogue) placed for a grid square and the
// current time, plus optional constellation lines (d3-celestial). Drawn on a huge sphere that
// moves with the camera, so it always reads as infinitely far away.
import * as THREE from 'three';

const R = 2900; // just inside the sky dome

/** Maidenhead grid square (4 or 6 characters) → centre latitude/longitude, or null if invalid. */
export function gridToLatLon(grid: string): { lat: number; lon: number } | null {
  const g = grid.trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (5 / 60) + 2.5 / 60;
    lat += (g.charCodeAt(5) - 65) * (2.5 / 60) + 1.25 / 60;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

/** Local sidereal time in degrees for a longitude (east positive). */
function siderealDeg(date: Date, lonDeg: number): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0);
  return (((gmst + lonDeg) % 360) + 360) % 360;
}

/** Star colour from its B−V index, via an approximate surface temperature. */
function starColour(bv: number): THREE.Color {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)) / 100;
  const r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const c = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

export function createSky(scene: THREE.Scene, pixelRatio: number) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  // dark ground out to the horizon, fading into the horizon glow so there's no hard line
  // (follows the camera across, stays at ground level)
  const groundMat = new THREE.ShaderMaterial({
    uniforms: { near: { value: new THREE.Color(0x0a0c10) }, horizon: { value: new THREE.Color(0x1c2636) } },
    vertexShader: 'varying vec2 vXY; void main() { vXY = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 near;
      uniform vec3 horizon;
      varying vec2 vXY;
      void main() {
        gl_FragColor = vec4(mix(near, horizon, smoothstep(150.0, 2800.0, length(vXY))), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2800, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  ground.visible = false;
  scene.add(ground);

  let raDec: Float32Array | null = null;   // stars: RA, Dec pairs (degrees)
  let lineRaDec: Float32Array | null = null; // constellation segments: RA, Dec pairs
  let starGeo: THREE.BufferGeometry | null = null;
  let lineGeo: THREE.BufferGeometry | null = null;
  let lines: THREE.LineSegments | null = null;
  let location: { lat: number; lon: number } | null = null;
  let showLines = false;
  let loading: Promise<void> | null = null;
  let timer = 0;

  const starMat = new THREE.ShaderMaterial({
    // sizeScale / alphaScale shrink and dim the stars while the Mirror's reflection is taken
    uniforms: { pixelRatio: { value: pixelRatio }, sizeScale: { value: 1 }, alphaScale: { value: 1 } },
    vertexShader: `
      attribute float starSize;
      attribute vec3 starColor;
      attribute float starAlpha;
      uniform float pixelRatio;
      uniform float sizeScale;
      uniform float alphaScale;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = starColor;
        vAlpha = starAlpha * alphaScale;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = starSize * pixelRatio * sizeScale;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float a = smoothstep(0.5, 0.15, length(gl_PointCoord - 0.5)) * vAlpha;
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4a6fa5, transparent: true, opacity: 0.55, depthWrite: false });

  // RA/Dec → a point on the sky sphere in scene axes (x east, y up, −z north)
  function place(ra: number, dec: number, lst: number, lat: number, out: THREE.Vector3) {
    const h = THREE.MathUtils.degToRad(lst - ra), d = THREE.MathUtils.degToRad(dec), p = THREE.MathUtils.degToRad(lat);
    const east = -Math.cos(d) * Math.sin(h);
    const north = Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(h) * Math.sin(p);
    const up = Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(h) * Math.cos(p);
    return out.set(east * R, up * R, -north * R);
  }

  // with a grid square: the real sky over it now; without one: a fixed sky with the
  // North Star overhead. Either way only the stars above the horizon show.
  function update() {
    if (!raDec || !starGeo) return;
    const lat = location ? location.lat : 90;
    const lst = location ? siderealDeg(new Date(), location.lon) : 0;
    const v = new THREE.Vector3();
    const pos = starGeo.getAttribute('position') as THREE.BufferAttribute;
    const vis = starGeo.getAttribute('starAlpha') as THREE.BufferAttribute;
    const base = starGeo.getAttribute('baseAlpha') as THREE.BufferAttribute;
    for (let i = 0; i < raDec.length / 2; i++) {
      place(raDec[i * 2], raDec[i * 2 + 1], lst, lat, v);
      pos.setXYZ(i, v.x, v.y, v.z);
      // stars fade out over the last few degrees above the horizon, as the air dims them
      vis.setX(i, base.getX(i) * THREE.MathUtils.smoothstep(v.y / R, 0, 0.12));
    }
    pos.needsUpdate = vis.needsUpdate = true;
    if (lineRaDec && lineGeo) {
      const lp = lineGeo.getAttribute('position') as THREE.BufferAttribute;
      const w = new THREE.Vector3();
      for (let i = 0; i < lineRaDec.length / 4; i++) {
        place(lineRaDec[i * 4], lineRaDec[i * 4 + 1], lst, lat, v);
        place(lineRaDec[i * 4 + 2], lineRaDec[i * 4 + 3], lst, lat, w);
        // a segment touching the horizon is hidden by shrinking it to nothing
        if (v.y < 0 || w.y < 0) v.set(0, 0, 0), w.set(0, 0, 0);
        lp.setXYZ(i * 2, v.x, v.y, v.z);
        lp.setXYZ(i * 2 + 1, w.x, w.y, w.z);
      }
      lp.needsUpdate = true;
    }
  }

  async function load() {
    const base = import.meta.env.BASE_URL + 'sky/';
    const [stars, cons] = await Promise.all([
      fetch(base + 'stars.json').then(r => r.json()),
      fetch(base + 'constellations.json').then(r => r.json()),
    ]);
    const s: number[] = stars.stars;
    const n = s.length / 4;
    raDec = new Float32Array(n * 2);
    const size = new Float32Array(n), alpha = new Float32Array(n), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const [ra, dec, mag, bv] = [s[i * 4], s[i * 4 + 1], s[i * 4 + 2], s[i * 4 + 3]];
      raDec[i * 2] = ra;
      raDec[i * 2 + 1] = dec;
      size[i] = Math.max(1.3, 5.5 - 0.7 * mag);             // Sirius ≈ 6.5 px, faintest ≈ 1.3 px
      alpha[i] = Math.min(1, Math.max(0.3, 1.15 - 0.12 * mag));
      const c = starColour(bv);
      col.set([c.r, c.g, c.b], i * 3);
    }
    starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    starGeo.setAttribute('starSize', new THREE.Float32BufferAttribute(size, 1));
    starGeo.setAttribute('starColor', new THREE.Float32BufferAttribute(col, 3));
    starGeo.setAttribute('baseAlpha', new THREE.Float32BufferAttribute(alpha, 1));
    starGeo.setAttribute('starAlpha', new THREE.Float32BufferAttribute(alpha.slice(), 1));
    const points = new THREE.Points(starGeo, starMat);
    points.frustumCulled = false;
    group.add(points);

    // polylines → separate segments
    const segs: number[] = [];
    for (const line of cons.lines as number[][]) {
      for (let k = 0; k + 3 < line.length; k += 2) segs.push(line[k], line[k + 1], line[k + 2], line[k + 3]);
    }
    lineRaDec = new Float32Array(segs);
    lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((segs.length / 2) * 3), 3));
    lines = new THREE.LineSegments(lineGeo, lineMat);
    lines.frustumCulled = false;
    lines.visible = showLines;
    group.add(lines);
    update();
  }

  return {
    group,
    ground,
    async setVisible(on: boolean) {
      group.visible = on;
      ground.visible = on;
      clearInterval(timer);
      if (!on) return;
      loading ??= load();
      await loading;
      update();
      timer = window.setInterval(update, 30000); // the sky creeps round with the clock
    },
    setLocation(loc: { lat: number; lon: number } | null) {
      location = loc;
      update();
    },
    /** While the Mirror's small reflection picture is taken: stars at 40% size, half brightness. */
    reflecting(on: boolean) {
      starMat.uniforms.sizeScale.value = on ? 0.4 : 1;
      starMat.uniforms.alphaScale.value = on ? 0.5 : 1;
    },
    setHorizon(c: THREE.Color) {
      groundMat.uniforms.horizon.value.copy(c);
    },
    setLines(on: boolean) {
      showLines = on;
      if (lines) lines.visible = on;
    },
  };
}
