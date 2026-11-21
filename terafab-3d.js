// Oddly Terafab — 3D site map.
// Progressive enhancement: terafab.html renders an SVG map first. If WebGL and
// the three.js modules are available, this replaces it with a 3D scene that
// shares the same zone data, info panel and filters (window.TF).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TF = window.TF;
const host = document.getElementById('map3d');
const svgBox = document.getElementById('mapbox');
if (TF && host && svgBox) init();

function init() {
  // ---------- renderer (bail out quietly to the SVG map if WebGL is missing) ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (e) { return; }
  if (!renderer.getContext()) return;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const LOW = coarse || small;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  svgBox.hidden = true;
  host.hidden = false;
  TF.mode3d = true;
  const lede = document.getElementById('mapLede');
  if (lede) lede.textContent = coarse
    ? 'Tap the map to explore. Drag to orbit, pinch to zoom, two fingers to pan. Tap a numbered marker to see what each building makes. The mint cars are Oddly Autonomous™ test cars on the Proving Loop. Their routes are their own.'
    : 'Drag to orbit. Right-drag or Shift-drag to pan. Scroll to zoom. Click any building or numbered marker. The mint cars are Oddly Autonomous™ test cars on the Proving Loop. Their routes are their own.';

  const W = () => host.clientWidth, H = () => host.clientHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1.5 : 2));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.74;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'gl';
  host.prepend(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(W(), H());
  labelRenderer.domElement.className = 'labels';
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, W() / H(), 1, 14000);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------- helpers ----------
  const S = 0.6; // SVG map units → metres
  const wx = x => (x - 500) * S, wz = y => (y - 320) * S;
  const GROUND = 2.2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  function hash(i, j, p) {
    if (p) { i = ((i % p) + p) % p; j = ((j % p) + p) % p; }
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(x, y, p) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, p), b = hash(xi + 1, yi, p), c = hash(xi, yi + 1, p), d = hash(xi + 1, yi + 1, p);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, o = 5, p) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < o; i++) { s += a * vnoise(x * f, y * f, p ? p * f : 0); n += a; a *= 0.5; f *= 2; }
    return s / n;
  }
  function ridged(x, y, o = 6) {
    let s = 0, a = 0.5, f = 1, n = 0, w = 1;
    for (let i = 0; i < o; i++) {
      let r = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); r *= r; r *= w; w = clamp(r * 1.6, 0, 1);
      s += a * r; n += a; a *= 0.5; f *= 2.03;
    }
    return s / n;
  }
  function canvasTex(w, h, draw, opts = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    return t;
  }
  function noiseFill(ctx, w, h, base, amp, scale = 1, period) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const [r, g, b] = base;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = (fbm(x / (16 * scale), y / (16 * scale), 4, period) - 0.5) * amp + (Math.random() - 0.5) * amp * 0.35;
      const i = (y * w + x) * 4;
      d[i] = clamp(r + n, 0, 255); d[i + 1] = clamp(g + n, 0, 255); d[i + 2] = clamp(b + n, 0, 255); d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- sky, sun, environment ----------
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  su.turbidity.value = 5.5; su.rayleigh.value = 2.4; su.mieCoefficient.value = 0.0055; su.mieDirectionalG.value = 0.86;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 7.5), THREE.MathUtils.degToRad(292));
  su.sunPosition.value.copy(sunDir);
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(1000);
  Object.keys(su).forEach(k => envSky.material.uniforms[k].value = su[k].value);
  envScene.add(envSky);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  scene.environment = env;

  scene.fog = new THREE.Fog(new THREE.Color('#c79c95'), 1100, 7200);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffc08a'), 3.6);
  sun.position.copy(sunDir).multiplyScalar(900);
  sun.castShadow = true;
  const SM = LOW ? 2048 : 4096;
  sun.shadow.mapSize.set(SM, SM);
  const sc = sun.shadow.camera;
  sc.left = -360; sc.right = 360; sc.top = 300; sc.bottom = -300; sc.near = 200; sc.far = 1800;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.8;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(new THREE.Color('#a9b8ff'), new THREE.Color('#6b5638'), 0.55));

  // ---------- terrain ----------
  const shoreZ = x => 166 + 9 * Math.sin(x * 0.0075 + 0.6) + 5 * Math.sin(x * 0.019 + 2.1) + (fbm(x * 0.004 + 40, 3.3, 3) - 0.5) * 18;
  const CAMPUS = { x0: -300, x1: 300, z0: -160, z1: 112 };
  function heightAt(x, z) {
    const north = Math.max(0, -z - 150);
    // rolling foothills first, then the Santa Ynez range well behind the campus
    const m = smooth(650, 2300, north);
    let h = GROUND + north * 0.03;
    h += smooth(0, 380, north) * (18 + 46 * fbm(x * 0.004 + 11, z * 0.004, 5));
    h += m * (170 + 430 * ridged(x * 0.0011 + 3.1, z * 0.0016 + 7.7)) * (0.8 + 0.4 * fbm(x * 0.0005, z * 0.0005, 3));
    h += smooth(300, 1200, north) * 50 * (ridged(x * 0.006, z * 0.006, 4) - 0.4);
    const side = Math.max(0, Math.abs(x) - 360);
    h += smooth(0, 500, side) * (30 + 90 * ridged(x * 0.003, z * 0.003 + 9, 5)) * smooth(260, 60, z);
    // campus plateau and the coastal highway corridor are graded flat
    const dx = Math.max(CAMPUS.x0 - x, 0, x - CAMPUS.x1), dz = Math.max(CAMPUS.z0 - z, 0, z - CAMPUS.z1);
    const dc = Math.hypot(dx, dz);
    h = lerp(GROUND, h, smooth(0, 90, dc));
    const hw = Math.abs(z - 118);
    h = lerp(GROUND, h, smooth(16, 60, hw));
    // the Pool Cleaner Basin pad
    if (x > -160 && x < -50 && z > 128 && z < 156) h = GROUND;
    // beach and sea floor
    const d = z - shoreZ(x);
    if (d > -18 && !(x > -160 && x < -50 && z < 156)) {
      const beach = GROUND - (d + 18) * 0.09 - Math.max(0, d - 6) * 0.08;
      h = Math.min(h, Math.max(beach, -32));
    }
    return h;
  }
  const TW = 8000, TD = 7600, TX = 0, TZ = -2400;
  const tg = new THREE.PlaneGeometry(TW, TD, LOW ? 300 : 480, LOW ? 280 : 460);
  tg.rotateX(-Math.PI / 2);
  tg.translate(TX, 0, TZ);
  const tp = tg.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
  tg.computeVertexNormals();
  const tn = tg.attributes.normal;
  const cols = new Float32Array(tp.count * 3);
  const C = s => new THREE.Color(s);
  const P = {
    wet: C('#8a7656'), sand: C('#d2bb8e'), dune: C('#bfa77a'), lawn: C('#5a6a35'), lawn2: C('#7b7f45'),
    dry: C('#a38a56'), dry2: C('#8b7a4a'), chap: C('#55603a'), scrub: C('#3a4528'), rock: C('#8c7a68'), rock2: C('#6a5a4d'), sea: C('#3c5a5c')
  };
  const tmp = new THREE.Color();
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i), ny = tn.getY(i);
    const n1 = fbm(x * 0.012, z * 0.012, 4), n2 = fbm(x * 0.05 + 9, z * 0.05, 3);
    const d = z - shoreZ(x);
    if (y < -0.5) tmp.copy(P.sea).lerp(P.wet, clamp(1 + y / 6, 0, 1));
    else if (d > -2) tmp.copy(P.wet).lerp(P.sand, smooth(-0.5, 1.4, y));
    else if (d > -16 && z > 125) tmp.copy(P.sand).lerp(P.dune, n2 * 0.6);
    else if (x > CAMPUS.x0 + 30 && x < CAMPUS.x1 - 30 && z > CAMPUS.z0 + 30 && z < CAMPUS.z1 - 6) tmp.copy(P.lawn).lerp(P.lawn2, n1);
    else {
      tmp.copy(P.dry).lerp(P.dry2, n2);
      tmp.lerp(P.chap, smooth(0.35, 0.75, n1) * 0.85);
      const mt = smooth(30, 160, y);
      const n3 = fbm(x * 0.0035 + 21, z * 0.0035, 5);
      tmp.lerp(P.scrub, mt * (0.5 + 0.5 * smooth(0.35, 0.62, n3)));
      tmp.lerp(P.chap, mt * smooth(0.55, 0.8, n2) * 0.45);
      tmp.lerp(P.dry2, mt * smooth(0.6, 0.85, n1) * 0.5);
      const steep = 1 - ny;
      tmp.lerp(P.rock, smooth(0.42, 0.66, steep) * (0.55 + 0.45 * smooth(250, 600, y)));
      tmp.lerp(P.rock2, smooth(0.6, 0.8, steep) * 0.5);
    }
    cols[i * 3] = tmp.r; cols[i * 3 + 1] = tmp.g; cols[i * 3 + 2] = tmp.b;
  }
  tg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const detail = canvasTex(256, 256, (c, w, h) => noiseFill(c, w, h, [222, 222, 222], 70, 0.6, 16));
  detail.repeat.set(TW / 9, TD / 9);
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.96, metalness: 0 }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  // ---------- ocean ----------
  function normalTex(size, period, amp) {
    return canvasTex(size, size, (ctx, w, h) => {
      const hgt = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) hgt[y * w + x] = fbm(x / w * period, y / h * period, 5, period);
      const img = ctx.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const l = hgt[y * w + ((x - 1 + w) % w)], r = hgt[y * w + ((x + 1) % w)], u = hgt[((y - 1 + h) % h) * w + x], b = hgt[((y + 1) % h) * w + x];
        const nx = (l - r) * amp, nz = (u - b) * amp, len = Math.hypot(nx, nz, 1);
        const i = (y * w + x) * 4;
        d[i] = (nx / len * 0.5 + 0.5) * 255; d[i + 1] = (nz / len * 0.5 + 0.5) * 255; d[i + 2] = (1 / len * 0.5 + 0.5) * 255; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { data: true });
  }
  const waterN = normalTex(256, 8, 14);
  waterN.repeat.set(220, 130);
  const waterN2 = waterN.clone(); waterN2.needsUpdate = true;
  const swell = normalTex(256, 4, 6); swell.repeat.set(36, 20);
  const oceanMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#0e2f45'), roughness: 0.14, metalness: 0, normalMap: waterN, normalScale: new THREE.Vector2(0.32, 0.32),
    envMapIntensity: 1.0, clearcoat: 1, clearcoatRoughness: 0.04, clearcoatNormalMap: swell, clearcoatNormalScale: new THREE.Vector2(0.45, 0.45)
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(16000, 9000).rotateX(-Math.PI / 2), oceanMat);
  ocean.position.set(0, 0, 4300);
  ocean.receiveShadow = true;
  scene.add(ocean);

  // shoreline foam
  const foamTex = canvasTex(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const y = h * (0.15 + 0.7 * Math.random()), x = Math.random() * w, l = 20 + Math.random() * 90;
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.55})`; ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + l * 0.3, y - 3, x + l * 0.6, y + 3, x + l, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - w, y); ctx.bezierCurveTo(x - w + l * 0.3, y - 3, x - w + l * 0.6, y + 3, x - w + l, y); ctx.stroke();
    }
  });
  const foamPts = [];
  for (let x = -3400; x <= 3400; x += 20) foamPts.push(new THREE.Vector3(x, 0.08, shoreZ(x) + 5));
  const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.75, depthWrite: false, color: new THREE.Color('#fff4ea') });
  const foam = new THREE.Mesh(ribbon(foamPts, 12, 40, false, true), foamMat);
  scene.add(foam);

  // ---------- roads ----------
  function ribbon(pts, width, tile, closed, swapUV) {
    const n = pts.length, pos = [], uv = [], idx = [];
    let acc = 0;
    for (let i = 0; i <= (closed ? n : n - 1); i++) {
      const p = pts[i % n];
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l * width / 2, nz = tx / l * width / 2;
      if (i > 0) acc += p.distanceTo(pts[(i - 1) % n]);
      pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
      const v = acc / tile;
      if (swapUV) uv.push(v, 1, v, 0); else uv.push(0, v, 1, v);
      if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // make sure normals point up regardless of winding
    const nm = g.attributes.normal;
    if (nm.getY(0) < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 1]; idx[i + 1] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    return g;
  }
  function roadTex(kind) {
    return canvasTex(256, 512, (ctx, w, h) => {
      noiseFill(ctx, w, h, [46, 48, 54], 22, 0.5, 16);
      const line = (u, col, lw, dash) => {
        ctx.fillStyle = col;
        if (!dash) ctx.fillRect(u * w - lw / 2, 0, lw, h);
        else for (let y = 0; y < h; y += dash * 2) ctx.fillRect(u * w - lw / 2, y, lw, dash);
      };
      if (kind === 'hwy') {
        line(0.035, '#d9d9d2', 4); line(0.965, '#d9d9d2', 4);
        line(0.49, '#d8a73c', 3); line(0.51, '#d8a73c', 3);
        line(0.255, '#d9d9d2', 3, 64); line(0.745, '#d9d9d2', 3, 64);
      } else if (kind === 'track') {
        line(0.05, '#e6e6e0', 4); line(0.95, '#e6e6e0', 4); line(0.5, '#2EE9A5', 3, 48);
      } else {
        line(0.06, '#cfcfc8', 3); line(0.94, '#cfcfc8', 3); line(0.485, '#d8a73c', 2.5); line(0.515, '#d8a73c', 2.5);
      }
      // tyre wear
      ctx.fillStyle = 'rgba(0,0,0,.10)'; ctx.fillRect(w * 0.15, 0, w * 0.12, h); ctx.fillRect(w * 0.73, 0, w * 0.12, h);
    });
  }
  const roadMat = k => new THREE.MeshStandardMaterial({ map: roadTex(k), roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const addRoad = (pts, w, k, closed, tile = 24) => { const m = new THREE.Mesh(ribbon(pts, w, tile, closed), roadMat(k)); m.receiveShadow = true; scene.add(m); return m; };

  class Poly {
    constructor(pts, closed) {
      this.p = closed ? pts.concat([pts[0]]) : pts; this.c = [0];
      for (let i = 1; i < this.p.length; i++) this.c.push(this.c[i - 1] + this.p[i].distanceTo(this.p[i - 1]));
      this.L = this.c[this.c.length - 1];
    }
    at(s, out, dir) {
      s = ((s % this.L) + this.L) % this.L;
      let lo = 0, hi = this.c.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.c[m] <= s) lo = m; else hi = m; }
      const t = (s - this.c[lo]) / ((this.c[hi] - this.c[lo]) || 1);
      out.lerpVectors(this.p[lo], this.p[hi], t);
      if (dir) dir.subVectors(this.p[hi], this.p[lo]).normalize();
      return out;
    }
  }
  function rrect(x0, z0, x1, z1, r, y, seg = 10) {
    const pts = [], cs = [[x1 - r, z0 + r, -Math.PI / 2], [x1 - r, z1 - r, 0], [x0 + r, z1 - r, Math.PI / 2], [x0 + r, z0 + r, Math.PI]];
    cs.forEach(([cx, cz, a0]) => { for (let i = 0; i <= seg; i++) { const a = a0 + i / seg * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)); } });
    return pts;
  }
  const RY = GROUND + 0.04;
  // US-101 along the coast
  const hw = new THREE.CurvePath();
  const V = (x, y) => new THREE.Vector3(wx(x), RY, wz(y));
  hw.add(new THREE.LineCurve3(new THREE.Vector3(-3600, RY, 120), V(-400, 520)));
  hw.add(new THREE.CubicBezierCurve3(V(-400, 520), V(200, 505), V(700, 535), V(1400, 512)));
  hw.add(new THREE.LineCurve3(V(1400, 512), new THREE.Vector3(3600, RY, 115.2)));
  const hwPts = hw.getSpacedPoints(420);
  addRoad(hwPts, 24, 'hwy', false, 36);
  const hwPoly = new Poly(hwPts, false);
  // campus perimeter road, spine road, entrance drive
  addRoad(rrect(wx(60), wz(96), wx(940), wz(496), 18, RY), 9, 'local', true);
  addRoad([V(120, 300), V(880, 300)], 10, 'local', false);
  addRoad([V(555, 482), V(555, 497), V(555, 512)], 12, 'local', false);
  // Proving Loop
  const loopPts = rrect(wx(660), wz(340), wx(920), wz(470), 22, RY + 0.01, 14);
  addRoad(loopPts, 9, 'track', true, 18);
  const loopPoly = new Poly(loopPts, true);

  // plazas and parking (concrete / asphalt pads)
  function pad(x0, z0, x1, z1, color, rough = 0.9) {
    const t = canvasTex(256, 256, (c, w, h) => { noiseFill(c, w, h, color, 18, 0.5, 16); c.strokeStyle = 'rgba(0,0,0,.18)'; c.lineWidth = 2; for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * w / 4, 0); c.lineTo(i * w / 4, h); c.stroke(); c.beginPath(); c.moveTo(0, i * h / 4); c.lineTo(w, i * h / 4); c.stroke(); } });
    t.repeat.set((x1 - x0) / 16, (z1 - z0) / 16);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: t, roughness: rough, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.position.set((x0 + x1) / 2, GROUND + 0.02, (z0 + z1) / 2); m.receiveShadow = true; scene.add(m); return m;
  }
  pad(wx(470), wz(470), wx(640), wz(492), [170, 168, 160]);       // entrance plaza
  const lot = { x0: wx(300), z0: wz(462), x1: wx(468), z1: wz(498) };
  pad(lot.x0, lot.z0, lot.x1, lot.z1, [52, 54, 60], 0.92);          // visitor parking
  pad(wx(100), wz(232), wx(270), wz(246), [120, 118, 112]);       // shipping apron

  // ---------- building materials ----------
  const facadeCanvas = (lit) => canvasTex(512, 256, (ctx, w, h) => {
    if (!lit) { noiseFill(ctx, w, h, [58, 62, 76], 14, 0.7, 32); } else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); }
    const bandY = h * 0.56, bandH = h * 0.2;
    if (!lit) {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      for (let x = 0; x <= w; x += w / 4) ctx.fillRect(x - 1, 0, 2, h);
      ctx.fillRect(0, h * 0.28, w, 1.5); ctx.fillRect(0, h * 0.86, w, 1.5);
      const g = ctx.createLinearGradient(0, bandY, 0, bandY + bandH); g.addColorStop(0, '#1a2233'); g.addColorStop(1, '#0e1420');
      ctx.fillStyle = g; ctx.fillRect(0, bandY, w, bandH);
      ctx.fillStyle = '#525a6e'; for (let x = 0; x <= w; x += w / 16) ctx.fillRect(x - 1, bandY, 2, bandH);
      ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, bandY, w, 3);
    } else {
      for (let i = 0; i < 16; i++) {
        const r = Math.random();
        if (r < 0.28) continue;
        ctx.fillStyle = r < 0.5 ? 'rgba(143,245,207,.55)' : r < 0.85 ? 'rgba(255,214,160,.75)' : 'rgba(210,220,255,.6)';
        ctx.fillRect(i * w / 16 + 3, bandY + 3, w / 16 - 6, bandH - 6);
      }
    }
  });
  const facadeMap = facadeCanvas(false), facadeEm = facadeCanvas(true);
  const roofMap = canvasTex(256, 256, (c, w, h) => { noiseFill(c, w, h, [150, 151, 154], 26, 0.6, 16); c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 2; for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * w / 2, 0); c.lineTo(i * w / 2, h); c.stroke(); c.beginPath(); c.moveTo(0, i * h / 2); c.lineTo(w, i * h / 2); c.stroke(); } });
  const STRIP = new THREE.Color('#7B4FFF'), MINT = new THREE.Color('#2EE9A5');
  const glassMat = () => new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#2a3a50'), metalness: 0.85, roughness: 0.07, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.05 });

  function worldUV(geo, w, h, d, tw = 16, th = 8, rw = 24) {
    const uv = geo.attributes.uv;
    const dims = [[d, h, tw, th], [d, h, tw, th], [w, d, rw, rw], [w, d, rw, rw], [w, h, tw, th], [w, h, tw, th]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k, [a, b, ta, tb] = dims[f];
      uv.setXY(i, uv.getX(i) * a / ta, uv.getY(i) * b / tb);
    }
    return geo;
  }

  const zoneObjs = {}; // id → {group, mats:[{m, base}], strip, center, size, top}
  const pickables = [];
  function zoneRec(id) {
    if (!zoneObjs[id]) zoneObjs[id] = { group: new THREE.Group(), mats: [], strips: [], center: new THREE.Vector3(), size: 40, top: 20 };
    return zoneObjs[id];
  }
  function track(rec, m) { rec.mats.push({ m, base: m.color.clone(), em: m.emissiveIntensity }); return m; }
  function addMesh(rec, geo, mat, cast = true) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; m.userData.zid = rec.id; rec.group.add(m); pickables.push(m); return m;
  }
  function stripRing(rec, cx, cz, w, d, y, color = STRIP, inten = 2.6) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1030'), emissive: color.clone(), emissiveIntensity: inten, roughness: 0.4 });
    const t = 0.45, o = 0.12;
    [[w + 2 * o, t, t, 0, -d / 2 - o], [w + 2 * o, t, t, 0, d / 2 + o], [t, t, d + 2 * o, -w / 2 - o, 0], [t, t, d + 2 * o, w / 2 + o, 0]].forEach(([a, b, c, dx, dz]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(a, b, c), mat); m.position.set(cx + dx, y, cz + dz); m.userData.zid = rec.id; rec.group.add(m);
    });
    rec.strips.push(mat);
    return mat;
  }
  function boxBuilding(rec, cx, cz, w, d, h, opts = {}) {
    const fm = track(rec, new THREE.MeshStandardMaterial({ map: facadeMap, emissiveMap: facadeEm, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.9, roughness: 0.55, metalness: 0.35, color: new THREE.Color(opts.tint || '#ffffff') }));
    const rm = track(rec, new THREE.MeshStandardMaterial({ map: roofMap, roughness: 0.85, metalness: 0.05 }));
    const g = worldUV(new THREE.BoxGeometry(w, h, d), w, h, d);
    const m = addMesh(rec, g, [fm, fm, rm, rm, fm, fm]);
    m.position.set(cx, GROUND + h / 2, cz);
    if (opts.strip !== false) stripRing(rec, cx, cz, w, d, GROUND + h + 0.2);
    // parapet
    const pm = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#3b3f4d'), roughness: 0.6, metalness: 0.3 }));
    [[w, 1.2, 0.6, 0, -d / 2 + 0.3], [w, 1.2, 0.6, 0, d / 2 - 0.3], [0.6, 1.2, d, -w / 2 + 0.3, 0], [0.6, 1.2, d, w / 2 - 0.3, 0]].forEach(([a, b, c, dx, dz]) => {
      const p = addMesh(rec, new THREE.BoxGeometry(a, b, c), pm); p.position.set(cx + dx, GROUND + h + 0.6, cz + dz);
    });
    return m;
  }
  function sawtoothRoof(rec, cx, cz, w, d, y, amp = 4.5, period = 10) {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0);
    const teeth = Math.max(2, Math.round(w / period)), t = w / teeth;
    for (let i = 0; i < teeth; i++) { const x = -w / 2 + i * t; sh.lineTo(x, amp); sh.lineTo(x + t, 0); }
    sh.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: d - 1.2, bevelEnabled: false });
    g.translate(0, 0, -(d - 1.2) / 2);
    const rm = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#8e939c'), roughness: 0.42, metalness: 0.65 }));
    const r = addMesh(rec, g, rm); r.position.set(cx, y, cz);
    // north-light glazing on the vertical faces, lit from inside
    const gl = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#202a3a'), emissive: new THREE.Color('#ffd9a8'), emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.6 }));
    const planes = [];
    for (let i = 0; i < teeth; i++) {
      const p = new THREE.PlaneGeometry(d - 2, amp * 0.8); p.rotateY(-Math.PI / 2); p.translate(-w / 2 + i * t - 0.03, amp * 0.45, 0); planes.push(p);
    }
    const pm = addMesh(rec, mergeGeometries(planes), gl, false); pm.position.set(cx, y, cz);
  }
  const hvacGeo = new THREE.BoxGeometry(3, 1.8, 2.4);
  const hvacList = [];
  function roofKit(cx, cz, w, d, top, n) {
    for (let i = 0; i < n; i++) hvacList.push([cx + (rand() - 0.5) * (w - 10), top + 0.9, cz + (rand() - 0.5) * (d - 10), rand() < 0.5 ? 0 : Math.PI / 2]);
  }
  function solar(rec, cx, cz, w, d, top) {
    const geos = [];
    for (let x = -w / 2 + 6; x < w / 2 - 6; x += 4.5) for (let z = -d / 2 + 6; z < d / 2 - 6; z += 3.2) {
      const p = new THREE.BoxGeometry(4, 0.15, 2.2); p.rotateX(-0.3); p.translate(cx + x, top + 0.9, cz + z); geos.push(p);
    }
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), track(rec, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#14213f'), metalness: 0.5, roughness: 0.18, clearcoat: 1 })));
    m.castShadow = true; m.receiveShadow = true; m.userData.zid = rec.id; rec.group.add(m); pickables.push(m);
  }
  function doorway(rec, cx, cz, w, h, face = 1, color = '#ffd9a8', inten = 1.2) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#111'), emissive: new THREE.Color(color), emissiveIntensity: inten })));
    m.position.set(cx, GROUND + h / 2, cz + face * 0.06); if (face < 0) m.rotation.y = Math.PI; m.userData.zid = rec.id; rec.group.add(m);
  }

  // logo and sign textures
  const logoTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2); ctx.scale(w / 290, h / 290); ctx.lineCap = 'round'; ctx.lineWidth = 18;
    ctx.strokeStyle = '#7B4FFF'; ctx.stroke(new Path2D('M96.59 25.88A100 100 0 0 1 -96.59 25.88 M-96.59 -25.88A100 100 0 0 1 96.59 -25.88'));
    ctx.strokeStyle = '#2EE9A5'; ctx.stroke(new Path2D('M-21.13 50.75A50 56 0 0 1 -21.13 -50.75 M21.13 -50.75A50 56 0 0 1 21.13 50.75'));
  });
  const signTex = canvasTex(1024, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#e9e9f2'; ctx.font = '600 84px "Space Grotesk", Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '10px';
    ctx.fillText('ODDLY TERAFAB', w / 2, h / 2 + 4);
  });

  // ---------- buildings ----------
  const ZB = {};
  TF.zones.forEach(z => { ZB[z.id] = z; });
  const rect = id => { const z = ZB[id]; return { cx: wx(z.x + z.w / 2), cz: wz(z.y + z.h / 2), w: z.w * S, d: z.h * S }; };
  function finish(id, cx, cz, size, top) {
    const rec = zoneObjs[id]; rec.center.set(cx, GROUND, cz); rec.size = size; rec.top = top; scene.add(rec.group);
  }
  TF.zones.forEach(z => { zoneRec(z.id).id = z.id; });

  // 2 / 3 / 7 — sawtooth production halls
  [['ff', 13], ['bb', 13], ['human', 14]].forEach(([id, h]) => {
    const r = rect(id), rec = zoneObjs[id];
    boxBuilding(rec, r.cx, r.cz, r.w, r.d, h, { strip: true });
    sawtoothRoof(rec, r.cx, r.cz, r.w - 1.5, r.d, GROUND + h + 0.05, 4.8, 10);
    doorway(rec, r.cx - r.w * 0.25, r.cz + r.d / 2, 8, 6.5); doorway(rec, r.cx + r.w * 0.25, r.cz + r.d / 2, 8, 6.5);
    finish(id, r.cx, r.cz, Math.max(r.w, r.d), h + 5);
  });
  // 4 — Rocket Motor Hall, blast doors facing the ocean, two test stacks
  {
    const r = rect('rocket'), rec = zoneObjs.rocket, h = 18;
    boxBuilding(rec, r.cx, r.cz, r.w, r.d, h); roofKit(r.cx, r.cz, r.w, r.d, GROUND + h, 10);
    const dm = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#6d717c'), roughness: 0.5, metalness: 0.8 }));
    const door = addMesh(rec, new THREE.BoxGeometry(34, 14, 0.8), dm); door.position.set(r.cx, GROUND + 7, r.cz + r.d / 2 + 0.4);
    const hz = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#e0a826'), roughness: 0.6 }));
    const band = addMesh(rec, new THREE.BoxGeometry(34, 1.2, 0.9), hz, false); band.position.set(r.cx, GROUND + 14.2, r.cz + r.d / 2 + 0.45);
    const stackM = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa0aa'), roughness: 0.35, metalness: 0.85 }));
    [-0.3, 0.3].forEach(f => { const s = addMesh(rec, new THREE.CylinderGeometry(1.6, 2.1, 30, 24), stackM); s.position.set(r.cx + r.w * f, GROUND + 15, r.cz - r.d * 0.3); });
    finish('rocket', r.cx, r.cz, Math.max(r.w, r.d), 33);
  }
  // 5 — oPhone & oOS clean room (lighter panels, solar roof)
  {
    const r = rect('phone'), rec = zoneObjs.phone, h = 15;
    boxBuilding(rec, r.cx, r.cz, r.w, r.d, h, { tint: '#d7dbe6' }); solar(rec, r.cx, r.cz, r.w, r.d, GROUND + h);
    doorway(rec, r.cx, r.cz + r.d / 2, 10, 5, 1, '#bff7e3', 1.3);
    finish('phone', r.cx, r.cz, Math.max(r.w, r.d), h + 3);
  }
  // 6 — Elevator Test Tower (glass, violet fins, no doors)
  {
    const z = ZB.elev, rec = zoneObjs.elev, cx = wx(z.x + z.w / 2), cz = wz(z.y + z.h / 2), s = 20, h = 128;
    const gm = track(rec, glassMat());
    const t = addMesh(rec, new THREE.BoxGeometry(s, h, s), gm); t.position.set(cx, GROUND + h / 2, cz);
    const core = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2f3d'), roughness: 0.5, metalness: 0.4 }));
    const base = addMesh(rec, new THREE.BoxGeometry(s + 6, 8, s + 6), core); base.position.set(cx, GROUND + 4, cz);
    const fin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a1030'), emissive: STRIP.clone(), emissiveIntensity: 2.8 });
    rec.strips.push(fin);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => { const f = new THREE.Mesh(new THREE.BoxGeometry(0.7, h + 2, 0.7), fin); f.position.set(cx + a * s / 2, GROUND + h / 2 + 1, cz + b * s / 2); f.userData.zid = 'elev'; rec.group.add(f); });
    // a car travelling up and down (no doors, for transparency)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 0.6), new THREE.MeshStandardMaterial({ color: new THREE.Color('#111'), emissive: new THREE.Color('#ffe2b8'), emissiveIntensity: 1.6 }));
    cab.position.set(cx, GROUND + 20, cz + s / 2 + 0.35); cab.userData.zid = 'elev'; rec.group.add(cab); rec.cab = cab;
    stripRing(rec, cx, cz, s, s, GROUND + h + 0.4);
    finish('elev', cx, cz, 40, h + 6);
  }
  // 8 — Oddly Labs Annex (chartreuse hazard band, solar roof, a fence with gaps)
  {
    const r = rect('lab'), rec = zoneObjs.lab, h = 11;
    boxBuilding(rec, r.cx, r.cz, r.w * 0.82, r.d * 0.78, h);
    const hz = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2410'), emissive: new THREE.Color('#C6FF3D'), emissiveIntensity: 1.1 }));
    const band = addMesh(rec, new THREE.BoxGeometry(r.w * 0.82 + 0.3, 0.8, r.d * 0.78 + 0.3), hz, false); band.position.set(r.cx, GROUND + h * 0.62, r.cz);
    solar(rec, r.cx, r.cz, r.w * 0.82, r.d * 0.78, GROUND + h);
    const posts = [], fw = r.w - 4, fd = r.d - 4;
    for (let i = 0; i < 160; i++) {
      const s = i / 160, per = 2 * (fw + fd); let p = s * per, x, zz;
      if (p < fw) { x = -fw / 2 + p; zz = -fd / 2; } else if (p < fw + fd) { x = fw / 2; zz = -fd / 2 + (p - fw); } else if (p < 2 * fw + fd) { x = fw / 2 - (p - fw - fd); zz = fd / 2; } else { x = -fw / 2; zz = fd / 2 - (p - 2 * fw - fd); }
      if (fbm(i * 0.18, 3.1, 2) > 0.6) continue; // the fence is dissolving
      const g = new THREE.BoxGeometry(0.14, 2.4 * (0.6 + 0.4 * fbm(i * 0.3, 1, 2)), 0.14); g.translate(r.cx + x, GROUND + 1.2, r.cz + zz); posts.push(g);
    }
    const fm = new THREE.Mesh(mergeGeometries(posts), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa0aa'), metalness: 0.8, roughness: 0.4 })));
    fm.castShadow = true; fm.userData.zid = 'lab'; rec.group.add(fm);
    finish('lab', r.cx, r.cz, Math.max(r.w, r.d), h + 3);
  }
  // 9 — Altitude Chamber with two glass pressure domes
  {
    const r = rect('press'), rec = zoneObjs.press, h = 11;
    boxBuilding(rec, r.cx, r.cz, r.w, r.d, h);
    const dmM = track(rec, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#9fd0ff'), metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.8, transparent: true, opacity: 0.85 }));
    [-0.24, 0.24].forEach(f => {
      const d = addMesh(rec, new THREE.SphereGeometry(r.d * 0.34, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), dmM); d.position.set(r.cx + r.w * f, GROUND + h + 0.4, r.cz);
    });
    const hose = new THREE.Mesh(new THREE.TorusGeometry(r.w * 0.24, 0.6, 10, 40, Math.PI), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#F5A623'), roughness: 0.5 })));
    hose.position.set(r.cx, GROUND + h + 0.4, r.cz + r.d * 0.36); hose.castShadow = true; hose.userData.zid = 'press'; rec.group.add(hose);
    finish('press', r.cx, r.cz, Math.max(r.w, r.d), h + r.d * 0.34 + 2);
  }
  // 1 — Main Entrance: a long dark facade with a mint-lit glass atrium, sign and logo (as in the photo)
  {
    const r = rect('entrance'), rec = zoneObjs.entrance, h = 16;
    const bw = r.w, bd = r.d * 0.62, bz = r.cz - r.d * 0.12;
    boxBuilding(rec, r.cx, bz, bw, bd, h);
    // atrium: glass curtain wall stepping forward from the facade, full height
    const aw = bw * 0.42, ad = 7, az = bz + bd / 2 + ad / 2 - 0.5, ah = h - 3.5;
    const lobby = new THREE.Mesh(new THREE.BoxGeometry(aw - 0.8, ah - 0.6, ad - 0.8), new THREE.MeshStandardMaterial({ color: new THREE.Color('#0c1a15'), emissive: MINT.clone(), emissiveIntensity: 0.75 }));
    lobby.position.set(r.cx, GROUND + ah / 2, az); lobby.userData.zid = 'entrance'; rec.group.add(lobby); pickables.push(lobby);
    const mull = [];
    for (let i = 0; i <= 12; i++) { const g = new THREE.BoxGeometry(0.18, ah, 0.18); g.translate(r.cx - aw / 2 + i * aw / 12, GROUND + ah / 2, az + ad / 2); mull.push(g); }
    for (let j = 1; j < 4; j++) { const g = new THREE.BoxGeometry(aw, 0.16, 0.2); g.translate(r.cx, GROUND + j * ah / 4, az + ad / 2); mull.push(g); }
    const mm = new THREE.Mesh(mergeGeometries(mull), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a2e38'), metalness: 0.8, roughness: 0.35 })));
    mm.userData.zid = 'entrance'; rec.group.add(mm);
    const gm = track(rec, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#9ff0d6'), metalness: 0.1, roughness: 0.04, transparent: true, opacity: 0.28, envMapIntensity: 1.6 }));
    const glass = addMesh(rec, new THREE.BoxGeometry(aw, ah, ad), gm, false); glass.position.set(r.cx, GROUND + ah / 2, az);
    const head = addMesh(rec, new THREE.BoxGeometry(aw + 6, h - ah + 0.6, ad + 1.2), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a3e4c'), roughness: 0.5, metalness: 0.4 })));
    head.position.set(r.cx, GROUND + ah + (h - ah) / 2, az + 0.6);
    // ENTRANCE door signs and lit doors
    [-0.22, 0.22].forEach(f => doorway(rec, r.cx + aw * f, az + ad / 2 + 0.25, 7, 3.4, 1, '#f6fff9', 1.4));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(aw + 4, (aw + 4) / 8), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, color: new THREE.Color(1.15, 1.15, 1.2) }));
    sign.position.set(r.cx, GROUND + ah + (h - ah) / 2, az + ad / 2 + 1.25); sign.userData.zid = 'entrance'; rec.group.add(sign);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: logoTex, transparent: true, toneMapped: false, color: new THREE.Color(1.5, 1.5, 1.5) }));
    logo.position.set(r.cx, GROUND + h + 4.6, az + 0.6); logo.userData.zid = 'entrance'; rec.group.add(logo);
    const back = addMesh(rec, new THREE.BoxGeometry(9.5, 9, 0.8), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2f3d'), roughness: 0.5, metalness: 0.4 }))); back.position.set(r.cx, GROUND + h + 4.4, az + 0.1);
    finish('entrance', r.cx, r.cz, Math.max(r.w, r.d) * 0.8, h + 9);
  }
  // 13 — Office of the CEO
  {
    const r = rect('ceo'), rec = zoneObjs.ceo, h = 7;
    const gm = track(rec, glassMat());
    const b = addMesh(rec, new THREE.BoxGeometry(r.w * 0.8, h, r.d * 0.8), gm); b.position.set(r.cx, GROUND + h / 2, r.cz);
    const roof = addMesh(rec, new THREE.BoxGeometry(r.w * 0.95, 0.7, r.d * 0.95), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2f3d'), roughness: 0.5 }))); roof.position.set(r.cx, GROUND + h + 0.35, r.cz);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(r.w * 0.6, h * 0.6, r.d * 0.6), new THREE.MeshStandardMaterial({ color: new THREE.Color('#111'), emissive: new THREE.Color('#ffd9a8'), emissiveIntensity: 1.4 }));
    lamp.position.set(r.cx, GROUND + h / 2, r.cz); lamp.userData.zid = 'ceo'; rec.group.add(lamp);
    const pole = addMesh(rec, new THREE.CylinderGeometry(0.1, 0.1, 9), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#ccc'), metalness: 0.9, roughness: 0.3 }))); pole.position.set(r.cx + r.w * 0.45, GROUND + 4.5, r.cz + r.d * 0.45);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshStandardMaterial({ map: logoTex, color: new THREE.Color('#ffffff'), side: THREE.DoubleSide, transparent: true }));
    flag.position.set(r.cx + r.w * 0.45 + 1.5, GROUND + 8, r.cz + r.d * 0.45); flag.userData.zid = 'ceo'; rec.group.add(flag); rec.flag = flag;
    stripRing(rec, r.cx, r.cz, r.w * 0.95, r.d * 0.95, GROUND + h + 0.75);
    finish('ceo', r.cx, r.cz, 30, h + 4);
  }
  // 14 — Shipping Dock (loading bays + trailers)
  {
    const r = rect('ship'), rec = zoneObjs.ship, h = 9;
    boxBuilding(rec, r.cx, r.cz, r.w, r.d, h); roofKit(r.cx, r.cz, r.w, r.d, GROUND + h, 4);
    for (let i = 0; i < 7; i++) doorway(rec, r.cx - r.w / 2 + 8 + i * (r.w - 16) / 6, r.cz + r.d / 2, 4, 4.5, 1, '#ffcf8a', 0.7);
    finish('ship', r.cx, r.cz, Math.max(r.w, r.d), h + 3);
  }
  // 10 — Pool Cleaner Basin, on the beach side of the 101
  {
    const z = ZB.pool, rec = zoneObjs.pool, cx = wx(z.x + z.w / 2), cz = 142, w = z.w * S, d = 18;
    const rim = track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#b7b2a6'), roughness: 0.85 }));
    [[w + 2, 1, 1, 0, -d / 2], [w + 2, 1, 1, 0, d / 2], [1, 1, d, -w / 2, 0], [1, 1, d, w / 2, 0]].forEach(([a, b, c, dx, dz]) => { const m = addMesh(rec, new THREE.BoxGeometry(a, b, c), rim); m.position.set(cx + dx, GROUND + 0.5, cz + dz); });
    const pw = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#1f8fa3'), roughness: 0.04, normalMap: waterN2, normalScale: new THREE.Vector2(0.25, 0.25), clearcoat: 1, envMapIntensity: 1.2 });
    waterN2.repeat.set(3, 1);
    const pool = addMesh(rec, new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), track(rec, pw), false); pool.position.set(cx, GROUND + 0.6, cz);
    const sub = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 3, 6, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color('#F5A623'), roughness: 0.4, metalness: 0.3 }));
    sub.position.set(cx, GROUND + 0.6, cz); sub.userData.zid = 'pool'; rec.group.add(sub); rec.sub = sub;
    finish('pool', cx, cz, w, 4);
  }
  // 11 / 12 — Proving Loop and the duck pond
  const pondC = new THREE.Vector3(wx(790), GROUND, wz(406)), pondR = { x: 30, z: 15.6 };
  {
    const rec = zoneObjs.pond;
    const sandRing = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), track(rec, new THREE.MeshStandardMaterial({ color: new THREE.Color('#8f8a6a'), roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 })));
    sandRing.scale.set(pondR.x + 2.5, 1, pondR.z + 2.5); sandRing.position.set(pondC.x, GROUND + 0.03, pondC.z); sandRing.receiveShadow = true; sandRing.userData.zid = 'pond'; rec.group.add(sandRing); pickables.push(sandRing);
    const pwM = track(rec, new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#1d4a5a'), roughness: 0.05, normalMap: waterN2, normalScale: new THREE.Vector2(0.2, 0.2), clearcoat: 1, envMapIntensity: 1.3, polygonOffset: true, polygonOffsetFactor: -2 }));
    const pw = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), pwM);
    pw.scale.set(pondR.x, 1, pondR.z); pw.position.set(pondC.x, GROUND + 0.08, pondC.z); pw.receiveShadow = true; pw.userData.zid = 'pond'; rec.group.add(pw); pickables.push(pw);
    // ducks
    rec.ducks = [];
    const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f4f1e8'), roughness: 0.7 }), beak = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f0a020') });
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), body); b.scale.set(1.3, 0.8, 0.9); g.add(b);
      const hd = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), body); hd.position.set(0.5, 0.42, 0); g.add(hd);
      const bk = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 8).rotateZ(-Math.PI / 2), beak); bk.position.set(0.8, 0.4, 0); g.add(bk);
      g.userData = { a: rand() * 6.28, r: 0.25 + rand() * 0.5, sp: 0.05 + rand() * 0.08, zid: 'pond' };
      rec.group.add(g); rec.ducks.push(g);
    }
    finish('pond', pondC.x, pondC.z, 70, 3);
    const lrec = zoneObjs.loop;
    const hit = new THREE.Mesh(ribbon(loopPts, 10, 18, true), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.05; hit.userData.zid = 'loop'; lrec.group.add(hit); pickables.push(hit);
    const lb = (loopPts.reduce((a, p) => a.add(p), new THREE.Vector3())).divideScalar(loopPts.length);
    finish('loop', lb.x, lb.z - 34, 160, 4);
  }

  // rooftop HVAC (instanced)
  {
    const m = new THREE.InstancedMesh(hvacGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color('#b9bcc2'), roughness: 0.5, metalness: 0.6 }), hvacList.length);
    const o = new THREE.Object3D();
    hvacList.forEach((h, i) => { o.position.set(h[0], h[1], h[2]); o.rotation.set(0, h[3], 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
  }

  // ---------- vegetation ----------
  const frondTex = canvasTex(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    for (let x = 4; x < w - 2; x += 3) {
      const l = (h / 2 - 1) * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + x / w * 1.0)), 0.7), c = 46 + Math.random() * 36;
      ctx.strokeStyle = `rgb(${c * 0.8},${c * 1.35},${c * 0.42})`; ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(x, h / 2); ctx.quadraticCurveTo(x + 5, h / 2 - l * 0.6, x + 10, h / 2 - l); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, h / 2); ctx.quadraticCurveTo(x + 5, h / 2 + l * 0.6, x + 10, h / 2 + l); ctx.stroke();
    }
    ctx.strokeStyle = '#4d5f2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  });
  frondTex.wrapS = frondTex.wrapT = THREE.ClampToEdgeWrapping;
  function palmGeos() {
    const trunk = new THREE.CylinderGeometry(0.3, 0.46, 14, 9, 7);
    trunk.translate(0, 7, 0);
    const tpz = trunk.attributes.position;
    for (let i = 0; i < tpz.count; i++) { const y = tpz.getY(i); tpz.setX(i, tpz.getX(i) + Math.pow(y / 14, 2) * 1.1); }
    trunk.computeVertexNormals();
    const fronds = [];
    for (let i = 0; i < 16; i++) {
      const p = new THREE.PlaneGeometry(5.4, 2.1, 8, 1);
      const pp = p.attributes.position;
      for (let k = 0; k < pp.count; k++) { const x = pp.getX(k) + 2.6; const up = i % 3 === 0 ? 0.75 : 0.35, side = pp.getY(k); pp.setX(k, x); pp.setY(k, -Math.pow(x / 5.4, 2) * 2.8 + x * up - Math.abs(side) * 0.35); pp.setZ(k, side * Math.min(1, x / 1.1)); }
      p.computeVertexNormals();
      p.rotateY(i / 16 * Math.PI * 2 + Math.random() * 0.25);
      p.translate(1.1, 14, 0);
      fronds.push(p);
    }
    const crown = new THREE.CylinderGeometry(0.55, 0.32, 1.6, 9); crown.translate(1.1, 13.4, 0);
    return { trunk: mergeGeometries([trunk, crown]), fronds: mergeGeometries(fronds) };
  }
  const PG = palmGeos();
  const palmSpots = [];
  // the palm-lined entrance drive and plaza (as in the photo)
  for (let y = 486; y <= 514; y += 7) { palmSpots.push([wx(538), wz(y)], [wx(572), wz(y)]); }
  [[470, 470], [640, 470], [480, 492], [630, 492]].forEach(([x, y]) => palmSpots.push([wx(x), wz(y)]));
  // along the perimeter road (south side) and the 101
  for (let x = 70; x <= 930; x += 26) { if (Math.abs(x - 555) > 30) palmSpots.push([wx(x), wz(503) + (rand() - 0.5) * 2]); }
  for (let x = -1200; x <= 1200; x += 34 + rand() * 30) { const z = 118 + 17 + rand() * 4; if (!(x > -165 && x < -45)) palmSpots.push([x, z]); }
  for (let i = 0; i < 40; i++) palmSpots.push([wx(60) + rand() * (wx(940) - wx(60)), wz(96) - 12 - rand() * 18]);
  const trunkM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a6a55'), roughness: 0.95 });
  const frondM = new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: new THREE.Color('#aab884') });
  const palmsT = new THREE.InstancedMesh(PG.trunk, trunkM, palmSpots.length), palmsF = new THREE.InstancedMesh(PG.fronds, frondM, palmSpots.length);
  {
    const o = new THREE.Object3D();
    palmSpots.forEach(([x, z], i) => {
      const s = 0.85 + rand() * 0.45;
      o.position.set(x, heightAt(x, z) - 0.2, z); o.rotation.set((rand() - 0.5) * 0.08, rand() * 6.28, (rand() - 0.5) * 0.08); o.scale.setScalar(s); o.updateMatrix();
      palmsT.setMatrixAt(i, o.matrix); palmsF.setMatrixAt(i, o.matrix);
    });
    [palmsT, palmsF].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
  }
  // shrubs on campus, coastal scrub and oaks on the foothills
  const blob = new THREE.IcosahedronGeometry(1, 1);
  {
    const bp = blob.attributes.position;
    for (let i = 0; i < bp.count; i++) { const n = 0.82 + 0.3 * vnoise(bp.getX(i) * 2.3 + 5, bp.getZ(i) * 2.3 + bp.getY(i) * 3); bp.setXYZ(i, bp.getX(i) * n, bp.getY(i) * n * 0.8, bp.getZ(i) * n); }
    blob.computeVertexNormals();
  }
  const foliage = new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true });
  const shrubN = LOW ? 1600 : 3200;
  const shrubs = new THREE.InstancedMesh(blob, foliage, shrubN);
  const busy = (x, z) => {
    for (const id in zoneObjs) { const r = zoneObjs[id]; if (id === 'loop') continue; if (Math.abs(x - r.center.x) < r.size * 0.62 && Math.abs(z - r.center.z) < r.size * 0.5 + 4) return true; }
    if (Math.abs(z - 118) < 16) return true;
    if (x > wx(640) && x < wx(940) && z > wz(330) && z < wz(480)) return true;
    if (Math.abs(z - wz(300)) < 9) return true;
    if (x > lot.x0 - 3 && x < lot.x1 + 3 && z > lot.z0 - 3 && z < lot.z1 + 3) return true;
    if (x > wx(470) && x < wx(640) && z > wz(466) && z < 122) return true;
    return z > shoreZ(x) - 14;
  };
  {
    const o = new THREE.Object3D(), col = new THREE.Color();
    const greens = ['#4a5a2a', '#5b6b31', '#3f4d26', '#6d6a35', '#7c7440', '#556b2f'].map(c => new THREE.Color(c));
    let i = 0, guard = 0;
    while (i < shrubN && guard++ < shrubN * 20) {
      let x, z, s;
      const r = rand();
      if (r < 0.32) { x = (rand() - 0.5) * 640; z = -150 + rand() * 300; s = 0.9 + rand() * 1.6; }
      else if (r < 0.55) { x = (rand() - 0.5) * 2400; z = 100 + rand() * 70; s = 0.8 + rand() * 1.5; }
      else { x = (rand() - 0.5) * 2600; z = -170 - rand() * 520; s = 2 + rand() * 3.5; }
      const h = heightAt(x, z);
      if (h < 0.6 || busy(x, z)) continue;
      if (z < -160) { const e = 1.2; const ny = Math.abs(heightAt(x + e, z) - heightAt(x - e, z)) + Math.abs(heightAt(x, z + e) - heightAt(x, z - e)); if (ny > 2.4 * e * 2 * 0.6) continue; if (fbm(x * 0.01, z * 0.01, 3) < 0.56) continue; }
      o.position.set(x, h + s * 0.35, z); o.rotation.set(0, rand() * 6.28, 0); o.scale.set(s * (0.8 + rand() * 0.5), s, s * (0.8 + rand() * 0.5)); o.updateMatrix();
      shrubs.setMatrixAt(i, o.matrix); shrubs.setColorAt(i, col.copy(greens[Math.floor(rand() * greens.length)]).multiplyScalar((z < -160 ? 0.6 : 0.8) + rand() * 0.3)); i++;
    }
    shrubs.count = i; shrubs.castShadow = true; shrubs.receiveShadow = true; scene.add(shrubs);
  }

  // ---------- cars ----------
  function carGeos() {
    const body = new THREE.BoxGeometry(4.5, 0.72, 1.86, 2, 1, 1);
    const bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = bp.getY(i); if (y > 0 && Math.abs(x) > 1.6) bp.setY(i, y - 0.12); }
    body.computeVertexNormals(); body.translate(0, 0.74, 0);
    const cabin = new THREE.BoxGeometry(2.5, 0.6, 1.66);
    const cp = cabin.attributes.position;
    for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) { cp.setX(i, cp.getX(i) * 0.72); cp.setZ(i, cp.getZ(i) * 0.9); }
    cabin.computeVertexNormals(); cabin.translate(0, 1.38, 0);
    const wheels = [];
    [[1.45, 0.92], [-1.45, 0.92], [1.45, -0.92], [-1.45, -0.92]].forEach(([x, z]) => { const w = new THREE.CylinderGeometry(0.37, 0.37, 0.26, 14); w.rotateX(Math.PI / 2); w.translate(x, 0.37, z); wheels.push(w); });
    // identical lamps at both ends: every Oddly is a Front-Front at heart
    const lamps = [];
    [[2.26, 0.62], [2.26, -0.62], [-2.26, 0.62], [-2.26, -0.62]].forEach(([x, z]) => { const l = new THREE.BoxGeometry(0.05, 0.16, 0.42); l.translate(x, 0.86, z); lamps.push(l); });
    return { paint: body, dark: mergeGeometries([cabin, ...wheels]), lamps: mergeGeometries(lamps) };
  }
  const CG = carGeos();
  const paintM = new THREE.MeshPhysicalMaterial({ roughness: 0.32, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
  const darkM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#0c0f15'), roughness: 0.12, metalness: 0.6, clearcoat: 1 });
  const lampM = new THREE.MeshStandardMaterial({ color: new THREE.Color('#222'), emissive: new THREE.Color('#fff1d6'), emissiveIntensity: 2.2 });
  function fleet(n) {
    const f = {
      paint: new THREE.InstancedMesh(CG.paint, paintM, n), dark: new THREE.InstancedMesh(CG.dark, darkM, n), lamps: new THREE.InstancedMesh(CG.lamps, lampM, n),
      set(i, m) { this.paint.setMatrixAt(i, m); this.dark.setMatrixAt(i, m); this.lamps.setMatrixAt(i, m); },
      done() { this.paint.instanceMatrix.needsUpdate = this.dark.instanceMatrix.needsUpdate = this.lamps.instanceMatrix.needsUpdate = true; }
    };
    [f.paint, f.dark].forEach(m => { m.castShadow = true; m.receiveShadow = true; scene.add(m); });
    scene.add(f.lamps);
    f.paint.frustumCulled = f.dark.frustumCulled = f.lamps.frustumCulled = false;
    return f;
  }
  const PAINTS = ['#e9e9ec', '#1b1d22', '#9da3ad', '#3b4250', '#7B4FFF', '#8e1f2a', '#2a4d7a', '#d6d0c4', '#f2f2f2', '#555b66'].map(c => new THREE.Color(c));
  // highway traffic
  const traffic = [], TN = LOW ? 46 : 80, tf = fleet(TN);
  for (let i = 0; i < TN; i++) {
    const dir = i % 2 ? 1 : -1;
    traffic.push({ s: rand() * hwPoly.L, v: (24 + rand() * 8) * dir, lane: dir * (rand() < 0.5 ? 2.9 : 8.6) });
    tf.paint.setColorAt(i, PAINTS[Math.floor(rand() * PAINTS.length)]);
  }
  // parked cars in the visitor lot
  {
    const spots = [];
    for (let x = lot.x0 + 3; x < lot.x1 - 2; x += 2.9) { spots.push([x, lot.z0 + 3.6]); spots.push([x, lot.z1 - 3.6]); }
    const pf = fleet(spots.length), o = new THREE.Object3D();
    let k = 0;
    spots.forEach(([x, z]) => { if (rand() < 0.18) return; o.position.set(x, GROUND, z); o.rotation.set(0, Math.PI / 2 + (rand() < 0.5 ? 0 : Math.PI), 0); o.updateMatrix(); pf.set(k, o.matrix); pf.paint.setColorAt(k, PAINTS[Math.floor(rand() * PAINTS.length)]); k++; });
    pf.paint.count = pf.dark.count = pf.lamps.count = k; pf.done();
    // lot striping
    const st = [];
    for (let x = lot.x0 + 1.55; x < lot.x1; x += 2.9) { [lot.z0 + 3.6, lot.z1 - 3.6].forEach(z => { const g = new THREE.PlaneGeometry(0.12, 5.4).rotateX(-Math.PI / 2); g.translate(x, GROUND + 0.05, z); st.push(g); }); }
    scene.add(new THREE.Mesh(mergeGeometries(st), new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9c9c2') })));
  }
  // trailers at the shipping dock
  {
    const r = rect('ship'), g = new THREE.BoxGeometry(2.6, 3.8, 14); g.translate(0, 2.4, 0);
    const tm = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: new THREE.Color('#e6e6ea'), roughness: 0.6, metalness: 0.2 }), 4), o = new THREE.Object3D();
    for (let i = 0; i < 4; i++) { o.position.set(r.cx - r.w / 2 + 14 + i * 9, GROUND, r.cz + r.d / 2 + 8.5); o.updateMatrix(); tm.setMatrixAt(i, o.matrix); }
    tm.castShadow = true; tm.receiveShadow = true; scene.add(tm);
  }
  // Oddly Autonomous™ test cars on the Proving Loop
  const testM = new THREE.MeshPhysicalMaterial({ color: new THREE.Color('#2EE9A5'), roughness: 0.25, metalness: 0.4, clearcoat: 1, emissive: new THREE.Color('#2EE9A5'), emissiveIntensity: 0.12 });
  const testCars = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const p = new THREE.Mesh(CG.paint, testM), d = new THREE.Mesh(CG.dark, darkM), l = new THREE.Mesh(CG.lamps, lampM);
    p.castShadow = d.castShadow = true; g.add(p, d, l); g.userData.zid = 'loop';
    scene.add(g);
    testCars.push({ g, s: rand() * loopPoly.L, v: (13 + rand() * 7) * (i % 2 ? 1 : -1), state: 'loop', t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
  }
  const splash = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#e9fff7'), transparent: true, opacity: 0, depthWrite: false }));
  splash.position.set(pondC.x, GROUND + 0.15, pondC.z); scene.add(splash);
  let splashT = 9;

  // ---------- labels ----------
  const labels = {};
  TF.zones.forEach(z => {
    const rec = zoneObjs[z.id]; if (!rec) return;
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'lab3'; el.setAttribute('aria-label', z.n + '. ' + z.name);
    el.innerHTML = `<span class="n" style="background:${TF.cats[z.cat][1]}">${z.n}</span><span class="t">${(z.short || z.name.split(' · ')[0]).replace(/&/g, '&amp;')}</span>`;
    el.addEventListener('click', e => { e.stopPropagation(); TF.select(z.id); });
    el.addEventListener('pointerdown', e => e.stopPropagation());
    const o = new CSS2DObject(el);
    o.position.set(rec.center.x, GROUND + rec.top + 3, rec.center.z);
    scene.add(o);
    labels[z.id] = el;
  });
  if (labels.elev) labels.elev.querySelector('.t').textContent = 'Elevator Tower';
  if (labels.ceo) labels.ceo.querySelector('.t').textContent = 'CEO';
  if (labels.loop) labels.loop.querySelector('.t').textContent = 'Proving Loop';
  if (labels.pond) labels.pond.querySelector('.t').textContent = 'Duck Pond';

  // ---------- selection, hover, filters ----------
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#2EE9A5'), transparent: true, opacity: 0.7, depthWrite: false }));
  selRing.position.y = GROUND + 0.2; selRing.visible = false; scene.add(selRing);
  let selId = null, hoverId = null, filter = 'all';
  function paintStrips() {
    for (const id in zoneObjs) {
      const rec = zoneObjs[id], dim = filter !== 'all' && ZB[id].cat !== filter;
      rec.strips.forEach(m => { m.emissive.copy(id === selId ? MINT : STRIP); m.emissiveIntensity = dim ? 0.15 : (id === selId ? 3.4 : id === hoverId ? 3.6 : 2.6); });
      rec.mats.forEach(({ m, base, em }) => { m.color.copy(base).multiplyScalar(dim ? 0.28 : (id === hoverId && id !== selId ? 1.25 : 1)); if (m.emissiveIntensity !== undefined && em !== undefined) m.emissiveIntensity = dim ? em * 0.15 : em; });
      if (labels[id]) { labels[id].classList.toggle('dim', dim); labels[id].classList.toggle('on', id === selId); }
    }
  }
  const fly = { t: 1, from: { p: new THREE.Vector3(), t: new THREE.Vector3() }, to: { p: new THREE.Vector3(), t: new THREE.Vector3() } };
  function flyTo(id) {
    const rec = zoneObjs[id]; if (!rec) return;
    const tgt = new THREE.Vector3(rec.center.x, GROUND + Math.min(rec.top, 40) * 0.4, rec.center.z);
    const dist = clamp(rec.size * 1.9 + rec.top * 0.8, 110, 360);
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target); dir.y = 0; dir.normalize();
    if (dir.lengthSq() < 0.1) dir.set(0.3, 0, 1).normalize();
    const pos = tgt.clone().addScaledVector(dir, dist * 0.82); pos.y = tgt.y + dist * 0.55;
    fly.from.p.copy(camera.position); fly.from.t.copy(controls.target); fly.to.p.copy(pos); fly.to.t.copy(tgt); fly.t = reduced ? 0.999 : 0;
  }
  TF.onSelect = id => {
    const first = selId === null;
    selId = id; const rec = zoneObjs[id];
    if (rec) { selRing.visible = true; selRing.position.x = rec.center.x; selRing.position.z = rec.center.z; const s = rec.size * 0.56 + 3; selRing.scale.set(s, 1, s); selRing.visible = id !== 'loop'; }
    paintStrips();
    if (tip3) tip3.textContent = 'Selected: ' + ZB[id].name;
    if (!first) flyTo(id);
  };
  TF.onFilter = f => { filter = f; paintStrips(); };

  // ---------- camera & controls ----------
  const tall = W() / H() < 1;
  if (tall) camera.position.set(70, 330, 640); else camera.position.set(300, 105, 480);
  const controls = new OrbitControls(camera, renderer.domElement);
  if (tall) controls.target.set(10, 0, -30); else controls.target.set(-10, 34, -70);
  controls.enableDamping = true; controls.dampingFactor = 0.075;
  controls.minDistance = 45; controls.maxDistance = 1150;
  controls.maxPolarAngle = 1.36; controls.minPolarAngle = 0.12;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.9; controls.rotateSpeed = 0.55; controls.panSpeed = 0.8;
  controls.keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };
  controls.listenToKeyEvents(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '3D map of the Oddly Terafab. Use the arrow keys to pan, or the numbered markers to select buildings.');
  controls.addEventListener('start', () => { fly.t = 1; });
  const HOME = { p: camera.position.clone(), t: controls.target.clone() };
  const zoomBy = f => {
    const d = new THREE.Vector3().subVectors(camera.position, controls.target);
    const L = clamp(d.length() * f, controls.minDistance, controls.maxDistance);
    fly.from.p.copy(camera.position); fly.from.t.copy(controls.target);
    fly.to.t.copy(controls.target); fly.to.p.copy(controls.target).addScaledVector(d.normalize(), L); fly.t = 0;
  };
  document.getElementById('zin3').addEventListener('click', () => zoomBy(0.66));
  document.getElementById('zout3').addEventListener('click', () => zoomBy(1.5));
  document.getElementById('zreset3').addEventListener('click', () => { fly.from.p.copy(camera.position); fly.from.t.copy(controls.target); fly.to.p.copy(HOME.p); fly.to.t.copy(HOME.t); fly.t = 0; });

  // touch devices: the map only captures gestures after a tap, so the page still scrolls
  const veil = document.getElementById('veil3'), done3 = document.getElementById('done3');
  if (coarse && veil) {
    veil.hidden = false;
    const setActive = on => { host.classList.toggle('active', on); veil.hidden = on; done3.hidden = !on; };
    veil.addEventListener('click', () => setActive(true));
    done3.addEventListener('click', () => setActive(false));
  } else host.classList.add('active');

  // picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let downAt = null;
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.zid : null;
  }
  renderer.domElement.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!downAt) return;
    const moved = Math.abs(e.clientX - downAt.x) + Math.abs(e.clientY - downAt.y); downAt = null;
    if (moved > 6) return;
    const id = pick(e); if (id) TF.select(id);
  });
  let hoverQueued = null;
  renderer.domElement.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !downAt) hoverQueued = e; });
  renderer.domElement.addEventListener('pointerleave', () => { hoverQueued = null; setHover(null); });
  const tip3 = document.getElementById('tip3');
  function setHover(id) {
    if (id === hoverId) return; hoverId = id;
    renderer.domElement.style.cursor = id ? 'pointer' : '';
    tip3.textContent = id ? ZB[id].n + ' · ' + ZB[id].name : (selId ? 'Selected: ' + ZB[selId].name : 'Click a building');
    paintStrips();
  }

  // ---------- post-processing ----------
  const rt = new THREE.WebGLRenderTarget(W() * renderer.getPixelRatio(), H() * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: LOW ? 2 : 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.55, 0.55, 0.9);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = W(), h = H(); if (!w || !h) return;
    camera.aspect = w / h;
    // keep the campus framed on tall (phone) screens
    camera.fov = w / h < 1 ? 52 : 38;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h); labelRenderer.setSize(w, h);
    host.classList.toggle('narrow', w < 560);
  }
  new ResizeObserver(resize).observe(host);
  resize();

  // ---------- loop ----------
  let visible = true, running = false, last = performance.now(), time = 0, frames = 0, slowFrames = 0, degraded = false;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && !running) start(); }, { rootMargin: '200px' }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible && !running) start(); });
  const tmpV = new THREE.Vector3(), tmpD = new THREE.Vector3(), o3 = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const loading = document.getElementById('load3');

  function tick(now) {
    if (!visible || document.hidden) { running = false; return; }
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;

    // adaptive quality: if frames are slow for a while, shed the expensive bits once
    frames++;
    if (frames > 30 && dt > 0.045) slowFrames++;
    if (!degraded && slowFrames > 40) {
      degraded = true;
      renderer.setPixelRatio(1); bloom.enabled = false; sun.shadow.mapSize.set(1024, 1024); sun.shadow.map && sun.shadow.map.dispose(); sun.shadow.map = null; resize();
    }

    if (fly.t < 1) {
      fly.t = Math.min(1, fly.t + dt / 1.3);
      const k = ease(fly.t);
      camera.position.lerpVectors(fly.from.p, fly.to.p, k); controls.target.lerpVectors(fly.from.t, fly.to.t, k);
    }
    controls.target.x = clamp(controls.target.x, -520, 520); controls.target.z = clamp(controls.target.z, -320, 260); controls.target.y = clamp(controls.target.y, 0, 60);
    controls.update();
    host.classList.toggle('near', camera.position.distanceTo(controls.target) < 420);

    // water motion
    waterN.offset.set(time * 0.004, time * 0.009); swell.offset.set(-time * 0.0015, time * 0.004);
    waterN2.offset.set(-time * 0.02, time * 0.013);
    foamTex.offset.x = time * 0.01; foamMat.opacity = 0.55 + 0.25 * Math.sin(time * 0.8);

    // traffic
    traffic.forEach((c, i) => {
      c.s += c.v * dt;
      hwPoly.at(c.s, tmpV, tmpD);
      const nx = -tmpD.z, nz = tmpD.x;
      o3.position.set(tmpV.x + nx * c.lane, GROUND, tmpV.z + nz * c.lane);
      o3.rotation.set(0, Math.atan2(-tmpD.z, tmpD.x) + (c.v < 0 ? Math.PI : 0), 0); o3.scale.setScalar(1); o3.updateMatrix();
      tf.set(i, o3.matrix);
    });
    tf.done();

    // Proving Loop test cars, which occasionally select the duck pond
    testCars.forEach(c => {
      if (c.state === 'loop') {
        c.s += c.v * dt; loopPoly.at(c.s, tmpV, tmpD);
        c.g.position.set(tmpV.x, GROUND, tmpV.z);
        c.g.rotation.set(0, Math.atan2(-tmpD.z, tmpD.x) + (c.v < 0 ? Math.PI : 0), 0);
        if (Math.random() < dt * 0.06) { c.state = 'pond'; c.t = 0; c.from.copy(c.g.position); c.to.set(pondC.x + (rand() - 0.5) * 20, GROUND, pondC.z + (rand() - 0.5) * 8); c.r0 = c.g.rotation.y; }
      } else if (c.state === 'pond') {
        c.t += dt / 2.2; const k = Math.min(1, c.t);
        c.g.position.lerpVectors(c.from, c.to, ease(k));
        c.g.rotation.y = Math.atan2(-(c.to.z - c.from.z), c.to.x - c.from.x);
        if (k > 0.8) { const s = (k - 0.8) / 0.2; c.g.position.y = GROUND - s * 1.6; c.g.rotation.z = -s * 0.25; }
        if (k >= 1) { c.state = 'sunk'; c.t = 0; splash.position.x = c.to.x; splash.position.z = c.to.z; splashT = 0; TF.pondAdd(); }
      } else {
        c.t += dt; c.g.position.y = GROUND - 1.6 - c.t * 0.8;
        if (c.t > 3) { c.state = 'loop'; c.s = rand() * loopPoly.L; c.g.rotation.z = 0; } // a replacement is produced
      }
    });
    if (splashT < 1.6) { splashT += dt; const k = splashT / 1.6; splash.scale.setScalar(1 + k * 9); splash.material.opacity = (1 - k) * 0.8; } else splash.material.opacity = 0;
    // ducks, the elevator, the flag, the sub
    zoneObjs.pond.ducks.forEach((d, i) => { const u = d.userData; u.a += u.sp * dt; d.position.set(pondC.x + Math.cos(u.a) * pondR.x * u.r, GROUND + 0.2 + Math.sin(time * 2 + i) * 0.04, pondC.z + Math.sin(u.a) * pondR.z * u.r); d.rotation.y = -u.a - Math.PI / 2; });
    zoneObjs.elev.cab.position.y = GROUND + 10 + (0.5 - 0.5 * Math.cos(time * 0.35)) * 108;
    zoneObjs.ceo.flag.rotation.y = Math.sin(time * 1.7) * 0.25;
    const sub = zoneObjs.pool.sub, pr = rect('pool'); sub.position.x = pr.cx + Math.sin(time * 0.6) * (pr.w / 2 - 4); sub.rotation.y = Math.cos(time * 0.6) > 0 ? 0 : Math.PI;
    selRing.material.opacity = 0.45 + 0.25 * Math.sin(time * 3);

    if (hoverQueued) { const id = pick(hoverQueued); hoverQueued = null; setHover(id); }

    composer.render();
    labelRenderer.render(scene, camera);
    if (loading && !loading.hidden) loading.hidden = true;
  }
  function start() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(tick); }
  start();

  // pick up whatever the 2D map already selected
  const s0 = TF.getSel(); if (s0) TF.onSelect(s0);
  window.__terafab3d = { renderer, scene, camera, controls, flyTo, zoneObjs, testCars, stats: () => renderer.info.render };
}
