// Realistic 3D Moon base, full screen behind the game. Seen from above while playing,
// and as a slow cinematic orbit behind the menus.
// 3D models: NASA 3D Resources (Apollo Lunar Module, Habitat Demonstration Unit, Astronaut).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { icon } from './icons.js';

const C = { o2: 0x4fc3f7, shield: 0x8fb8ff, bat: 0x69f0ae, sun: 0xffdd88 };
const SUN_DIR = new THREE.Vector3(-0.8, 0.45, 0.35).normalize(); // low Sun, long shadows (like the real Moon)

let renderer, labelRenderer, scene, camera, controls, wrap;
let sunLight, earthLight, ambient;
const parts = { labels: {}, lights: [] };
const storm = { active: false, t: 0, strength: 0, blocked: 0, points: null };
let target = { night: false, oxygen: 0, shield: 0, battery: 0, batteryMax: 1 };
let mode = 'menu';
let planet = 'moon';
let anim = null; // landing / launch animation in progress
let lmReady = Promise.resolve();
const MARS_SKY = new THREE.Color(0xb98a5c), BLACK = new THREE.Color(0x000000), FLASH = new THREE.Color(0x300508);
const skyColor = new THREE.Color(0x000000);
let ok = true;
const clock = new THREE.Clock();

// ---------- noise helpers ----------
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 5) { let s = 0, a = .5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2; a *= .5; } return s; }
function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Regolith (moon dust) texture drawn in code, tileable.
function regolithTexture() {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    // tileable noise: blend 4 samples
    const fx = x / n, fy = y / n, k = 8;
    const s = (nx, ny) => fbm(nx * k, ny * k, 6);
    const v = s(fx, fy) * (1 - fx) * (1 - fy) + s(fx - 1, fy) * fx * (1 - fy) + s(fx, fy - 1) * (1 - fx) * fy + s(fx - 1, fy - 1) * fx * fy;
    let l = 95 + v * 90 + (hash(x, y) - .5) * 40;
    if (hash(x * 3.1, y * 7.7) > .996) l += 70; // small bright pebbles
    const i = (y * n + x) * 4;
    img.data[i] = l; img.data[i + 1] = l * .985; img.data[i + 2] = l * .97; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function makeTerrain() {
  const size = 600, seg = 220;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const rnd = seeded(42);
  const craters = [];
  for (let i = 0; i < 140; i++) {
    const r = Math.pow(rnd(), 2.2) * 28 + 2;
    const x = (rnd() - .5) * size * .9, z = (rnd() - .5) * size * .9;
    if (Math.hypot(x, z) < 34 + r) continue; // keep the base area clear
    craters.push({ x, z, r, d: r * (.18 + rnd() * .1) });
  }
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const dist = Math.hypot(x, z);
    let y = (fbm(x * .012, z * .012, 5) - .5) * 14 + (fbm(x * .08, z * .08, 3) - .5) * 1.2;
    y *= THREE.MathUtils.smoothstep(dist, 20, 70); // flat ground under the base
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1) y -= c.d * (1 - d * d);
      else if (d < 1.6) y += c.d * .3 * Math.pow(1 - (d - 1) / .6, 2);
    }
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const tex = regolithTexture();
  tex.repeat.set(90, 90);
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.2, roughness: 1, metalness: 0, color: 0xb9b6b0 });
  parts.groundMat = mat;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  // Scattered rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (1 + (hash(i, 1) - .5) * .5), rp.getY(i) * (.6 + hash(i, 2) * .3), rp.getZ(i) * (1 + (hash(i, 3) - .5) * .5));
  rockGeo.computeVertexNormals();
  parts.rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, parts.rockMat, 500);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 500; i++) {
    let x, z;
    do { x = (rnd() - .5) * 260; z = (rnd() - .5) * 260; } while (Math.hypot(x, z) < 24);
    const s = Math.pow(rnd(), 3) * 2.2 + .15;
    q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
    m.compose(new THREE.Vector3(x, heightAt(geo, x, z, size, seg) + s * .2, z), q, new THREE.Vector3(s, s, s));
    rocks.setMatrixAt(i, m);
  }
  rocks.castShadow = true; rocks.receiveShadow = true;
  const g = new THREE.Group(); g.add(mesh, rocks);
  parts.moonTex = tex;
  return g;
}

// Mars: big mountains and a volcano on the horizon, rolling ground, and dry river channels
// carved by water long ago (like the ones NASA rovers explore in Jezero and Gale craters).
function makeMarsTerrain(tex) {
  const size = 900, seg = 260;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const rnd = seeded(7);
  const craters = [];
  for (let i = 0; i < 40; i++) {
    const r = Math.pow(rnd(), 2) * 24 + 4, x = (rnd() - .5) * size * .8, z = (rnd() - .5) * size * .8;
    if (Math.hypot(x, z) > 60 + r) craters.push({ x, z, r, d: r * .1 }); // old, worn-down craters
  }
  // Dry river beds: centre line z = f(x) (main river) and a second one on a diagonal.
  const river1 = x => 62 + 30 * Math.sin(x * .018) + 14 * Math.sin(x * .051 + 1);
  const river2 = u => -120 + 34 * Math.sin(u * .014 + 2) + 10 * Math.sin(u * .043);
  const SQ = Math.SQRT1_2;
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3);
  const base = new THREE.Color(0xd2784a), dark = new THREE.Color(0x7c3a22), sand = new THREE.Color(0xe6b07a), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), dist = Math.hypot(x, z);
    let y = (fbm(x * .007, z * .007, 5) - .5) * 26 + (fbm(x * .06, z * .06, 3) - .5) * 1.6;
    y *= THREE.MathUtils.smoothstep(dist, 22, 90);
    // ridged mountains far from the base
    const ridge = 1 - Math.abs(2 * fbm(x * .0045 + 9, z * .0045 - 4, 5) - 1);
    const far = THREE.MathUtils.smoothstep(dist, 120, 300);
    y += Math.pow(ridge, 3) * 140 * far;
    // a big old volcano on the horizon
    const dv = Math.hypot(x + 260, z + 240) / 150;
    if (dv < 1.4) y += 120 * Math.pow(Math.max(0, 1 - dv / 1.4), 1.6) - (dv < .18 ? 30 * (1 - dv / .18) : 0);
    for (const k of craters) {
      const d = Math.hypot(x - k.x, z - k.z) / k.r;
      if (d < 1) y -= k.d * (1 - d * d); else if (d < 1.5) y += k.d * .25 * (1 - (d - 1) / .5);
    }
    // river channels
    let river = 0;
    const d1 = Math.abs(z - river1(x)) / 9;
    const u = (x + z) * SQ, v = (z - x) * SQ, d2 = Math.abs(v - river2(u)) / 7;
    for (const d of [d1, d2]) {
      if (d < 1) { y -= 4.5 * (1 - d * d); river = Math.max(river, 1 - d); }
      else if (d < 1.8) y += .8 * (1 - (d - 1) / .8);
    }
    pos.setY(i, y);
    // colours: rusty ground, darker high rock, pale sand on the river floors
    const n = fbm(x * .03 + 3, z * .03, 3);
    tmp.copy(base).lerp(dark, Math.min(1, Math.max(0, (y - 8) / 70) + (n - .5) * .5)).lerp(sand, river * .8);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 1, vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (1 + (hash(i, 4) - .5) * .6), rp.getY(i) * (.5 + hash(i, 5) * .4), rp.getZ(i) * (1 + (hash(i, 6) - .5) * .6));
  rockGeo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x6e3520, roughness: 1, flatShading: true }), 800);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 800; i++) {
    let x, z;
    do { x = (rnd() - .5) * 300; z = (rnd() - .5) * 300; } while (Math.hypot(x, z) < 26);
    const s = Math.pow(rnd(), 3) * 2.6 + .15;
    q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3));
    m.compose(new THREE.Vector3(x, heightAt(geo, x, z, size, seg) + s * .15, z), q, new THREE.Vector3(s, s, s));
    rocks.setMatrixAt(i, m);
  }
  rocks.castShadow = true; rocks.receiveShadow = true;
  const g = new THREE.Group(); g.add(mesh, rocks);
  return g;
}

function heightAt(geo, x, z, size, seg) {
  const step = size / seg;
  const ix = Math.round((x + size / 2) / step), iz = Math.round((z + size / 2) / step);
  return geo.attributes.position.getY(iz * (seg + 1) + ix) || 0;
}

function makeSky() {
  const g = new THREE.Group();
  // Stars
  const n = 3000, arr = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(1500);
    if (v.y < -50) v.y = -v.y;
    arr.set([v.x, v.y, v.z], i * 3);
    const b = .5 + Math.random() * .5; col.set([b, b, b * (.9 + Math.random() * .2)], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  parts.starsMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true });
  g.add(new THREE.Points(sg, parts.starsMat));

  // Earth (NASA texture), hanging in the black sky
  const earthTex = new THREE.TextureLoader().load('assets/textures/earth.jpg');
  earthTex.colorSpace = THREE.SRGBColorSpace;
  const earth = new THREE.Mesh(new THREE.SphereGeometry(55, 48, 32), new THREE.MeshStandardMaterial({ map: earthTex, roughness: .8 }));
  earth.position.set(500, 380, -700);
  earth.rotation.z = .4;
  g.add(earth);
  parts.earth = earth;

  // Sun disc with glow
  const glow = document.createElement('canvas'); glow.width = glow.height = 128;
  const gg = glow.getContext('2d'); const grd = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(.15, 'rgba(255,245,210,1)'); grd.addColorStop(.35, 'rgba(255,220,150,.35)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), depthWrite: false, transparent: true }));
  sun.scale.setScalar(260);
  sun.position.copy(SUN_DIR).multiplyScalar(1300);
  g.add(sun);
  parts.sun = sun;
  return g;
}

function label(key, icon) {
  const el = document.createElement('div');
  el.className = 'scene-label t-' + key;
  el.innerHTML = `<span class="i">${icon}</span><span class="t"></span>`;
  const o = new CSS2DObject(el);
  parts.labels[key] = el;
  return o;
}

const metal = (color, r = .45, m = .7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, ...extra });
function shadow(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

// ---------- buildings (made in code, sized in meters) ----------
const mats = {};
function sharedMats() {
  if (mats.cells) return mats;
  mats.cells = new THREE.MeshStandardMaterial({ color: 0x0c1a3a, roughness: .25, metalness: .8, emissive: 0x0a1a44, emissiveIntensity: 0 });
  mats.frame = metal(0xd9d9d9, .4, .6);
  mats.white = metal(0xe8e8e8, .35, .5);
  mats.grey = metal(0x8d8d8d, .7, .4);
  mats.dark = metal(0x777777);
  mats.sand = metal(0xb7b2a6, .6, .3);
  mats.o2Band = metal(0x4fc3f7, .3, .2, { emissive: C.o2, emissiveIntensity: 0 });
  mats.container = metal(0xd6d3cc, .55, .35);
  mats.radiator = metal(0xf0f0f0, .2, .9);
  mats.pylon = metal(0xc9d6ff, .3, .7, { emissive: C.shield, emissiveIntensity: .2 });
  return mats;
}

// Vertical solar array (like NASA's Artemis VSAT concept): a tall mast with panels that face the Sun.
// More levels = more panels.
function solarTower(level) {
  const m = sharedMats(), g = new THREE.Group();
  const n = 3 + level, h = 3 + n * 2.35;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, h, 12), metal(0xc8c8c8));
  mast.position.y = h / 2; g.add(mast);
  const panels = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, .08), m.cells);
    p.position.set(0, 3 + i * 2.35, .3); panels.add(p);
    const f = new THREE.Mesh(new THREE.BoxGeometry(3.3, .1, .12), m.frame);
    f.position.set(0, 1.85 + i * 2.35, .3); panels.add(f);
  }
  panels.rotation.y = Math.atan2(SUN_DIR.x, SUN_DIR.z);
  g.add(panels);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, .5, 16), m.grey);
  base.position.y = .25; g.add(base);
  return g;
}

// Oxygen machine: takes oxygen out of moon rock (regolith). Higher level = second processor.
function oxygenPlant(level) {
  const m = sharedMats(), g = new THREE.Group();
  for (let k = 0; k < Math.min(level, 2); k++) {
    const proc = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 3.4), m.sand);
    proc.position.set(-1.8, 1.3, k * 3.8 - (level > 1 ? 1.9 : 0)); g.add(proc);
    const hopper = new THREE.Mesh(new THREE.CylinderGeometry(1.2, .5, 1.6, 4), m.sand);
    hopper.position.set(-1.8, 3.4, proc.position.z); hopper.rotation.y = Math.PI / 4; g.add(hopper);
  }
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(.9, 2.6 + level * .6, 8, 24), m.white);
  tank.rotation.z = Math.PI / 2; tank.position.set(2, 1.1, 0); g.add(tank);
  const band = new THREE.Mesh(new THREE.TorusGeometry(.92, .07, 8, 24), m.o2Band);
  band.rotation.y = Math.PI / 2; band.position.set(2, 1.1, 0); g.add(band);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 2.4, 8), m.dark);
  pipe.rotation.z = Math.PI / 2; pipe.position.set(.2, 1.9, 0); g.add(pipe);
  if (level === 3) { const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, .2, 20), m.radiator); dish.position.set(-1.8, 4.4, 0); g.add(dish); }
  return g;
}

// Oxygen tanks: store more oxygen. Higher level = more tanks.
function tankPair(level) {
  const m = sharedMats(), g = new THREE.Group();
  const n = level + 1;
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * 2;
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(.85, 3, 8, 24), m.white);
    tank.rotation.z = Math.PI / 2; tank.position.set(0, 1.05, z); g.add(tank);
    const band = new THREE.Mesh(new THREE.TorusGeometry(.87, .06, 8, 24), m.o2Band);
    band.rotation.y = Math.PI / 2; band.position.set(.8, 1.05, z); g.add(band);
    for (const sx of [-1.1, 1.1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(.15, .5, 1.3), m.dark); leg.position.set(sx, .25, z); g.add(leg); }
  }
  return g;
}

// Battery bank: a container with level lights. Higher level = taller stack.
function batteryBank(level) {
  const m = sharedMats(), g = new THREE.Group();
  const h = 1.6 + level * .8;
  const box = new THREE.Mesh(new THREE.BoxGeometry(5, h, 2.6), m.container);
  box.position.y = h / 2; g.add(box);
  const rad = new THREE.Mesh(new THREE.BoxGeometry(4.6, .06, 2.4), m.radiator);
  rad.position.y = h + .05; g.add(rad);
  const leds = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: C.bat, emissiveIntensity: 0 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(.45, .35, .05), mat);
    led.position.set(-1.9 + i * .55, h * .55, 1.33);
    g.add(led); leds.push(mat);
  }
  g.userData.leds = leds;
  return g;
}

// Shield generator inside the dome. Higher level = taller, stronger.
function shieldPylon(level) {
  const m = sharedMats(), g = new THREE.Group();
  const h = 2.5 + level;
  const col = new THREE.Mesh(new THREE.CylinderGeometry(.35, .6, h, 12), m.pylon);
  col.position.y = h / 2; g.add(col);
  for (let i = 0; i < level; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.8, .08, 8, 24), m.pylon);
    ring.rotation.x = Math.PI / 2; ring.position.y = h - .4 - i * .7; g.add(ring);
  }
  return g;
}

// Mars solar farm: rows of tilted panels on the ground (Mars has wind and dust, no tall towers).
function solarArray(level) {
  const m = sharedMats(), g = new THREE.Group();
  const rows = level + 1;
  for (let r = 0; r < rows; r++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(5.4, .1, 1.6), m.cells);
    p.position.set(0, .9, (r - (rows - 1) / 2) * 2.1); p.rotation.x = -.45; g.add(p);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(5.5, .08, .1), m.frame);
    fr.position.set(0, .55, p.position.z + .7); g.add(fr);
    for (const sx of [-2.4, 2.4]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, .9), m.grey); leg.position.set(sx, .45, p.position.z); g.add(leg); }
  }
  return g;
}

// Mars oxygen machine: a gold box that pulls oxygen out of the CO₂ in the air, like NASA's MOXIE.
function moxie(level) {
  const m = sharedMats(), g = new THREE.Group();
  const gold = metal(0xd4a537, .35, .9);
  const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4 + level * .3, 3), gold);
  box.position.set(-1.6, box.geometry.parameters.height / 2, 0); g.add(box);
  for (let i = 0; i < 3; i++) {
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .2, 20), m.dark);
    fan.rotation.z = Math.PI / 2; fan.position.set(-3.35, .8 + i * .7, -.8 + i * .8 * (i % 2 ? -1 : 1)); g.add(fan);
  }
  const tank = new THREE.Mesh(new THREE.CapsuleGeometry(.8, 2.2 + level * .5, 8, 20), m.white);
  tank.rotation.z = Math.PI / 2; tank.position.set(2.2, 1, 0); g.add(tank);
  const band = new THREE.Mesh(new THREE.TorusGeometry(.82, .07, 8, 24), m.o2Band);
  band.rotation.y = Math.PI / 2; band.position.set(2.2, 1, 0); g.add(band);
  return g;
}

const MOON_BUILDERS = { solar: solarTower, oxygen: oxygenPlant, tank: tankPair, battery: batteryBank, shield: shieldPylon };
const MARS_BUILDERS = { ...MOON_BUILDERS, solar: solarArray, oxygen: moxie };
const BUILDERS = new Proxy({}, { get: (_, type) => (planet === 'mars' ? MARS_BUILDERS : MOON_BUILDERS)[type] });
const ICONS = { solar: 'sun', oxygen: 'oxygen', tank: 'tank', battery: 'battery', shield: 'shield' };

// Radiation shield: a soft energy dome around the habitat (game effect, so kids can see it).
function shieldDome() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { power: { value: 0 }, time: { value: 0 }, hit: { value: 0 }, color: { value: new THREE.Color(C.shield) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 wp = modelMatrix * vec4(position,1.); vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform float power; uniform float time; uniform float hit; uniform vec3 color;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = pow(1. - abs(dot(vN, vV)), 2.5);
        vec2 h = vP.xz * .9 + vec2(vP.y * .6);
        float grid = smoothstep(.92, 1., abs(sin(h.x * 3.) * sin(h.y * 3.)));
        float wave = .5 + .5 * sin(vP.y * 2. - time * 2.);
        float a = power * (f * .9 + grid * .25 + wave * .05) + hit * (f + .3);
        gl_FragColor = vec4(color * (1. + hit), a * .8); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(11, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  parts.shield = mat;
  return dome;
}

function usFlagTexture() {
  const c = document.createElement('canvas'); c.width = 190; c.height = 100;
  const g = c.getContext('2d');
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, i * 100 / 13, 190, 100 / 13 + 1); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 76, 54);
  g.fillStyle = '#fff';
  for (let r = 0; r < 9; r++) for (let col = 0; col < (r % 2 ? 5 : 6); col++) { g.beginPath(); g.arc(6 + col * 12.6 + (r % 2 ? 6.3 : 0), 4 + r * 5.8, 1.6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function flag() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 2.4, 8), metal(0xdddddd));
  pole.position.y = 1.2; g.add(pole);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, 1.3, 6), metal(0xdddddd));
  bar.rotation.z = Math.PI / 2; bar.position.set(.65, 2.35, 0); g.add(bar);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, .8, 12, 4), new THREE.MeshStandardMaterial({ map: usFlagTexture(), side: THREE.DoubleSide, roughness: .9 }));
  const p = cloth.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 4) * .05); // the famous wrinkles
  cloth.geometry.computeVertexNormals();
  cloth.position.set(.65, 1.95, 0); g.add(cloth);
  return shadow(g);
}

function cable(a, b) {
  const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(b, .5).setY(.08), b].map(v => v.clone().setY(.08)));
  return new THREE.Mesh(new THREE.TubeGeometry(curve, 20, .07, 6), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: .8 }));
}

// Puts a loaded model on the ground at a real-world height (meters).
function placeModel(obj, height, x, z, rotY = 0) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const k = height / size.y;
  obj.scale.setScalar(k);
  const b2 = new THREE.Box3().setFromObject(obj), c = b2.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  obj.position.set(-c.x, -b2.min.y, -c.z);
  holder.add(obj);
  holder.position.set(x, 0, z);
  holder.rotation.y = rotY;
  return shadow(holder);
}

// The NASA astronaut model stands in a T-pose; lower its arms so it looks natural.
function relaxArms(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3());
  const shoulderY = box.min.y + size.y * .80, shoulderX = size.x * .17, cx = (box.min.x + box.max.x) / 2;
  obj.traverse(m => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position, inv = m.matrixWorld.clone().invert(), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      const dx = v.x - cx;
      if (Math.abs(dx) > shoulderX && v.y > shoulderY - size.y * .12) {
        const side = Math.sign(dx), px = cx + side * shoulderX;
        const ang = -side * 1.25; // rotate down ~72°
        const rx = v.x - px, ry = v.y - shoulderY;
        v.x = px + rx * Math.cos(ang) - ry * Math.sin(ang);
        v.y = shoulderY + rx * Math.sin(ang) + ry * Math.cos(ang);
        v.applyMatrix4(inv); p.setXYZ(i, v.x, v.y, v.z);
      }
    }
    p.needsUpdate = true; m.geometry.computeVertexNormals();
  });
}

// Rocket flame under the lander (used when landing and taking off).
function makeFlame() {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(1.1, 5, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(.55, 3.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
  outer.rotation.x = inner.rotation.x = Math.PI; // point down
  outer.position.y = -2.2; inner.position.y = -1.5;
  const light = new THREE.PointLight(0xffa040, 0, 40, 2); light.position.y = -2;
  g.add(outer, inner, light);
  g.position.y = 1.2; g.visible = false;
  parts.flame = g; parts.flameLight = light;
  return g;
}

function makeDust() {
  const n = 260, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc9c2b4, size: .9, transparent: true, opacity: .8, depthWrite: false }));
  p.userData.dirs = Array.from({ length: n }, () => { const a = Math.random() * Math.PI * 2; return [Math.cos(a), Math.sin(a), .4 + Math.random(), Math.random() * .8]; });
  p.visible = false;
  return p;
}

async function loadModels(base) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  const load = n => loader.loadAsync(`assets/models/${n}.glb`).then(g => g.scene).catch(() => null);
  // Each model appears as soon as it has loaded (the big rover doesn't hold up the others).
  load('habitat-1').then(hab => { if (hab) base.add(placeModel(hab, 5.5, 0, 0, -.4)); });
  lmReady = load('lunar-module').then(lm => {
    if (!lm) return;
    parts.lm = placeModel(lm, 7, -26, 14, .6);
    parts.lm.add(makeFlame());
    base.add(parts.lm);
  });
  load('perseverance').then(rover => { // NASA's Perseverance rover, only on Mars
    if (!rover) return;
    parts.rover = placeModel(rover, 2.2, -12, 27, 2.4);
    parts.rover.visible = planet === 'mars';
    base.add(parts.rover);
  });
  const astro = await load('astronaut');
  if (astro) {
    relaxArms(astro);
    const copy = astro.clone(); // clone before scaling, so both get the same real size
    parts.astronauts = [[-21, 17.5, 2.6], [6, 9, -1]].map(([x, z, r], i) => {
      const a = placeModel(i ? copy : astro, 1.85, x, z, r);
      a.userData.home = new THREE.Vector3(x, 0, z); a.userData.phase = i * 2;
      base.add(a); return a;
    });
  }
}

// Only on Mars: a wall of Martian soil around the habitat (extra radiation protection) and a greenhouse.
function marsDecor() {
  const g = new THREE.Group();
  const soil = new THREE.MeshStandardMaterial({ color: 0x9c4e2c, roughness: 1, flatShading: true });
  const berm = new THREE.Mesh(new THREE.TorusGeometry(6.2, 1.1, 6, 40, Math.PI * 1.6), soil);
  berm.rotation.x = -Math.PI / 2; berm.rotation.z = 1.9; berm.scale.z = .7; berm.position.y = .2; g.add(berm);
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe9ff, transparent: true, opacity: .35, roughness: .1, metalness: .2, depthWrite: false });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass);
  dome.position.set(-6.5, 0, -7); g.add(dome);
  const plants = new THREE.MeshStandardMaterial({ color: 0x3fa34d, roughness: .8 });
  for (let i = 0; i < 9; i++) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(.35, .9, 6), plants);
    p.position.set(-6.5 + Math.cos(i * 2.4) * 1.4 * (i % 3 / 2 + .3), .45, -7 + Math.sin(i * 2.4) * 1.4 * (i % 3 / 2 + .3)); g.add(p);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(2.65, 2.65, .3, 24), metal(0xdddddd));
  ring.position.set(-6.5, .15, -7); g.add(ring);
  return shadow(g);
}

function makeBase() {
  const base = new THREE.Group();
  parts.base = base;
  base.add(shieldDome());
  const f = flag(); f.position.set(-21.5, 0, 19.5); f.rotation.y = .5; base.add(f);

  // Habitat lights for the night
  for (const [x, z] of [[4, 4], [-4, 4], [0, -5]]) {
    const l = new THREE.PointLight(0xffd8a0, 0, 16, 2); l.position.set(x, 3, z); base.add(l); parts.lights.push(l);
  }
  const lab = (key, icon, x, y, z) => { const o = label(key, icon); o.position.set(x, y, z); base.add(o); };
  lab('shield', icon('shield'), 0, 12.5, 0);
  lab('home', icon('home'), 0, 7.5, 0);

  parts.marsDecor = marsDecor(); parts.marsDecor.visible = false; base.add(parts.marsDecor);
  parts.cables = new THREE.Group(); base.add(parts.cables);
  parts.buildings = new THREE.Group(); base.add(parts.buildings);

  // Ring that shows the selected building
  parts.ring = new THREE.Mesh(new THREE.RingGeometry(.92, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: .9, side: THREE.DoubleSide, depthWrite: false }));
  parts.ring.rotation.x = -Math.PI / 2; parts.ring.position.y = .15; parts.ring.visible = false;
  base.add(parts.ring);

  loadModels(base);
  return base;
}

// ---------- dynamic buildings ----------
const objs = new Map(); // building id -> { holder, key, radius }
let selectedId = null;

function removeHolder(h) {
  h.traverse(o => { if (o.isCSS2DObject) o.element.remove(); });
  h.parent?.remove(h);
}

function makeHolder(b) {
  const holder = new THREE.Group();
  holder.add(shadow(BUILDERS[b.type](b.level)));
  holder.userData.buildingId = b.id;
  const el = document.createElement('div');
  el.className = 'scene-label small t-' + b.type;
  el.innerHTML = `<span class="i">${icon(ICONS[b.type])}</span>${b.level > 1 ? `<span class="lv">${b.level}</span>` : ''}`;
  const lab = new CSS2DObject(el);
  const box = new THREE.Box3().setFromObject(holder);
  lab.position.set(0, box.max.y + 1.2, 0);
  holder.add(lab);
  return holder;
}

// list: [{ id, type, level, x, z, radius }]
export function syncBuildings(list) {
  if (!ok) return;
  const seen = new Set();
  for (const b of list) {
    seen.add(b.id);
    const key = planet + b.type + b.level;
    let o = objs.get(b.id);
    if (!o || o.key !== key) {
      if (o) removeHolder(o.holder);
      o = { holder: makeHolder(b), key };
      objs.set(b.id, o);
      parts.buildings.add(o.holder);
    }
    o.holder.position.set(b.x, 0, b.z);
    o.holder.rotation.y = b.type === 'solar' ? 0 : Math.atan2(-b.x, -b.z) + Math.PI / 2; // face the habitat
    o.radius = b.radius;
  }
  for (const [id, o] of objs) if (!seen.has(id)) { removeHolder(o.holder); objs.delete(id); }

  // Cables from every building to the habitat
  parts.cables.children.slice().forEach(c => { c.geometry.dispose(); parts.cables.remove(c); });
  for (const b of list) if (b.type !== 'shield') parts.cables.add(cable(new THREE.Vector3(b.x, 0, b.z), new THREE.Vector3(0, 0, 0)));
  parts.batLeds = list.filter(b => b.type === 'battery').map(b => objs.get(b.id).holder.children[0].userData.leds);
  setSelected(selectedId);
}

export function setSelected(id) {
  selectedId = id;
  const o = id != null && objs.get(id);
  parts.ring.visible = !!o;
  if (o) { parts.ring.position.x = o.holder.position.x; parts.ring.position.z = o.holder.position.z; parts.ring.scale.setScalar(o.radius + .6); }
}

// ---------- clicking and placing ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let pickHandler = null, placing = null, downAt = null;

export function onPickBuilding(fn) { pickHandler = fn; }

function toNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundPoint(e) { toNdc(e); const p = new THREE.Vector3(); return ray.ray.intersectPlane(groundPlane, p) ? p : null; }

// Ghost of the building that follows the pointer until the player taps a free spot.
export function startPlacing({ type, level = 1, radius, valid, done }) {
  stopPlacing();
  const ghost = BUILDERS[type](level);
  ghost.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = .55; m.material.depthWrite = false; } });
  const foot = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: .35, depthWrite: false }));
  foot.rotation.x = -Math.PI / 2; foot.position.y = .12;
  const g = new THREE.Group(); g.add(ghost, foot); g.visible = false;
  parts.base.add(g);
  placing = { g, foot, valid, done, ok: false, x: 0, z: 0 };
}
export function stopPlacing() {
  if (!placing) return;
  parts.base.remove(placing.g);
  placing = null;
}

function onMove(e) {
  if (!placing) return;
  const p = groundPoint(e);
  if (!p) return;
  const x = Math.round(p.x * 2) / 2, z = Math.round(p.z * 2) / 2;
  placing.g.visible = true;
  placing.g.position.set(x, 0, z);
  placing.g.rotation.y = Math.atan2(-x, -z) + Math.PI / 2;
  placing.ok = placing.valid(x, z);
  placing.x = x; placing.z = z;
  placing.foot.material.color.setHex(placing.ok ? 0x69f0ae : 0xff6b6b);
}

function onUp(e) {
  if (!downAt || mode !== 'game') return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 8) return; // it was a camera drag
  if (placing) {
    onMove(e); // on touch screens there is no hover, so place where the finger lifted
    if (placing.ok) { const { x, z, done } = placing; stopPlacing(); done(x, z); }
    return;
  }
  toNdc(e);
  const hit = ray.intersectObjects(parts.buildings.children, true)[0];
  let o = hit?.object;
  while (o && o.userData.buildingId == null) o = o.parent;
  pickHandler?.(o ? o.userData.buildingId : null);
}

export function resetView() { setMode('game', true); }

function makeStormParticles() {
  const n = 900, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff0a0, size: .5, transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false }));
  p.visible = false;
  p.userData.seeds = Array.from({ length: n }, () => [(Math.random() - .5) * 70, Math.random() * 60, (Math.random() - .5) * 70, .7 + Math.random() * .8]);
  return p;
}

export function initScene() {
  try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
  catch { ok = false; return false; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  wrap = document.createElement('div');
  wrap.className = 'scene-bg';
  wrap.appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'scene-labels';
  wrap.appendChild(labelRenderer.domElement);
  document.body.prepend(wrap);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  camera = new THREE.PerspectiveCamera(42, 1, .5, 4000);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;

  // Lighting: hard sunlight (no air on the Moon to soften it) + faint "earthshine"
  sunLight = new THREE.DirectionalLight(0xfff6e8, 3.2);
  sunLight.position.copy(SUN_DIR).multiplyScalar(120);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 10, far: 300 });
  sunLight.shadow.bias = -.0005;
  earthLight = new THREE.DirectionalLight(0x9db8ff, .12);
  earthLight.position.set(500, 380, -700);
  ambient = new THREE.AmbientLight(0x8890a0, .12);
  scene.add(sunLight, earthLight, ambient);

  parts.moonGround = makeTerrain();
  parts.marsGround = makeMarsTerrain(parts.moonTex);
  parts.marsGround.visible = false;
  scene.add(parts.moonGround, parts.marsGround, makeSky(), makeBase());
  parts.dust = makeDust(); scene.add(parts.dust);
  scene.fog = new THREE.Fog(0x9c6b45, 60, 5000);
  storm.points = makeStormParticles();
  scene.add(storm.points);

  setMode('menu', true);
  const el = renderer.domElement;
  window.__jamt = { camera, parts, THREE }; // for testing in the browser console
  el.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  renderer.setAnimationLoop(tick);
  window.addEventListener('resize', resize);
  resize();
  return true;
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// 'menu': slow low orbit with the horizon, the Earth and the landing site.
// 'game': view from above so the whole base is visible.
export function setMode(m, force = false) {
  if (!ok || (m === mode && !force)) return; // keep the camera where the player left it
  mode = m;
  document.body.classList.toggle('scene-game', m === 'game');
  if (m === 'menu') {
    controls.enabled = false; controls.enablePan = false;
    controls.target.set(-6, 3, 6);
    camera.position.set(-48, 9, 40);
    controls.autoRotate = true; controls.autoRotateSpeed = .35;
    controls.minPolarAngle = controls.maxPolarAngle = 1.38;
    controls.minDistance = 0; controls.maxDistance = Infinity;
  } else {
    controls.enabled = true;
    controls.target.set(-5, 0, 4);
    const narrow = window.innerWidth < 700;
    camera.position.set(22, narrow ? 78 : 55, narrow ? 62 : 48);
    controls.autoRotate = false;
    controls.enablePan = true; controls.screenSpacePanning = false; // right button / two fingers move the view
    controls.minPolarAngle = .05; controls.maxPolarAngle = 1.35;
    controls.minDistance = 10; controls.maxDistance = 160;
  }
  controls.update();
}

// Moon or Mars: ground colour, sky, Earth, rover.
export function setPlanet(p) {
  if (!ok || p === planet) return;
  planet = p;
  const mars = p === 'mars';
  parts.moonGround.visible = !mars;
  parts.marsGround.visible = mars;
  if (parts.marsDecor) parts.marsDecor.visible = mars;
  for (const o of objs.values()) o.key = ''; // rebuild buildings in the Mars (or Moon) style
  if (parts.earth) parts.earth.visible = !mars;
  if (parts.rover) parts.rover.visible = mars;
  parts.sun.scale.setScalar(mars ? 170 : 260); // the Sun looks smaller from Mars
  scene.fog.color.setHex(mars ? 0xa0704a : 0x000000);
}

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const GAME_CAM = () => new THREE.Vector3(22, window.innerWidth < 700 ? 78 : 55, window.innerWidth < 700 ? 62 : 48);

// The lander comes down from the sky onto the landing site, then the camera flies to the base view.
export async function playLanding(done) {
  if (!ok) { done?.(); return; }
  await Promise.race([lmReady, new Promise(r => setTimeout(r, 6000))]); // wait for the lander model
  if (!parts.lm) { done?.(); return; }
  parts.lm.position.y = 70;
  setMode('game', true);
  controls.enabled = false;
  anim = { kind: 'landing', t: 0, done };
}

// The crew takes off and leaves the base. The camera follows the craft into the sky.
export function playLaunch(done) {
  if (!ok || !parts.lm) { done?.(); return; }
  controls.enabled = false;
  anim = { kind: 'launch', t: 0, done };
  parts.astronauts?.forEach(a => { a.visible = false; }); // the crew is on board
}

export function skipAnimation() {
  if (!anim) return;
  const a = anim; anim = null;
  if (a.kind === 'landing') { parts.lm.position.y = 0; parts.flame.visible = false; setMode('game', true); }
  a.done?.();
}

function runAnim(dt) {
  const a = anim;
  a.t += dt;
  const lm = parts.lm, home = new THREE.Vector3(-26, 0, 14);
  const flicker = .85 + Math.random() * .3;
  if (a.kind === 'landing') {
    const T = 4.2, p = Math.min(a.t / T, 1);
    lm.position.y = 70 * Math.pow(1 - p, 2.2);
    parts.flame.visible = a.t < T + .4;
    parts.flame.scale.set(flicker, flicker * (1.2 - p * .5), flicker);
    parts.flameLight.intensity = parts.flame.visible ? 60 * flicker : 0;
    if (a.t >= T && !a.dusted) { a.dusted = true; burstDust(home); }
    const look = new THREE.Vector3(home.x, lm.position.y + 3, home.z);
    const near = new THREE.Vector3(home.x + 26, lm.position.y * .6 + 10, home.z + 26);
    const k = ease((a.t - T + .2) / 1.6);
    camera.position.lerpVectors(near, GAME_CAM(), k);
    camera.lookAt(look.lerp(new THREE.Vector3(-5, 0, 4), k));
    if (a.t > T + 1.8) { anim = null; controls.target.set(-5, 0, 4); camera.position.copy(GAME_CAM()); controls.enabled = true; controls.update(); a.done?.(); }
  } else if (a.kind === 'launch') {
    const ign = 1.3, s = Math.max(0, a.t - ign);
    lm.position.y = 2.5 * s * s; // speeds up as it climbs
    parts.flame.visible = true;
    parts.flame.scale.set(flicker, flicker * (a.t < ign ? .6 : 1.4), flicker);
    parts.flameLight.intensity = 80 * flicker;
    if (a.t > ign && !a.dusted) { a.dusted = true; burstDust(home); }
    const shake = a.t < ign + 1 ? (Math.random() - .5) * .4 : 0;
    camera.position.set(home.x + 30 + shake, 8 + lm.position.y * .55, home.z + 34);
    camera.lookAt(home.x, lm.position.y + 4, home.z);
    if (a.t > 6.5 && !a.called) { a.called = true; a.done?.(); }
    if (a.t > 14) { parts.flame.visible = false; }
  }
}

function burstDust(at) {
  const d = parts.dust;
  d.position.copy(at); d.visible = true; d.userData.t = 0;
  d.material.color.setHex(planet === 'mars' ? 0xc07850 : 0xc9c2b4);
}

export function setLabels(texts) {
  for (const [k, el] of Object.entries(parts.labels)) el.querySelector('.t').textContent = texts[k] || '';
}

export function updateScene(s) { target = { ...target, ...s }; }

export function playStorm(strength, blocked) { Object.assign(storm, { active: true, t: 0, strength, blocked }); }

const lerp = (a, b, k) => a + (b - a) * k;

function tick() {
  const raw = clock.getDelta(), dt = Math.min(raw, .05), time = clock.elapsedTime;
  const k = 1 - Math.pow(.03, dt);
  const night = target.night && mode === 'game';
  if (anim) runAnim(Math.min(raw, .25)); // real time, even on slow devices

  // Dust thrown up by the rocket
  if (parts.dust.visible) {
    const d = parts.dust; d.userData.t += dt;
    const t = d.userData.t, pos = d.geometry.attributes.position;
    d.userData.dirs.forEach(([x, z, sp, h], i) => pos.setXYZ(i, x * t * 9 * sp, h * t * 3 * (1.5 - t * .5), z * t * 9 * sp));
    pos.needsUpdate = true;
    d.material.opacity = Math.max(0, .8 - t * .35);
    if (t > 2.4) d.visible = false;
  }

  // Sky: black on the Moon; butterscotch in the Martian day (dust in the air), dark at night
  const marsDay = planet === 'mars' && !night;
  skyColor.lerp(marsDay ? MARS_SKY : BLACK, k);
  parts.starsMat.opacity = lerp(parts.starsMat.opacity, marsDay ? 0 : 1, k);
  scene.fog.far = lerp(scene.fog.far, target.dust ? 160 : planet === 'mars' ? 1400 : 5000, k * .5);
  scene.fog.near = target.dust ? 20 : 60;

  sunLight.intensity = lerp(sunLight.intensity, night ? 0 : 3.2, k);
  ambient.intensity = lerp(ambient.intensity, night ? .05 : .12, k);
  earthLight.intensity = lerp(earthLight.intensity, night ? .35 : .12, k);
  parts.sun.material.opacity = lerp(parts.sun.material.opacity, night ? 0 : 1, k);
  parts.lights.forEach(l => { l.intensity = lerp(l.intensity, night ? 40 : 0, k); });
  if (mats.cells) mats.cells.emissiveIntensity = lerp(mats.cells.emissiveIntensity, night ? 0 : .25, k);
  if (parts.earth) parts.earth.rotation.y += dt * .01;

  // Shield
  const sh = mode === 'game' ? Math.min(target.shield / 5, 1) : 0;
  parts.shield.uniforms.power.value = lerp(parts.shield.uniforms.power.value, sh > 0 ? .35 + sh * .65 : 0, k);
  parts.shield.uniforms.time.value = time;
  parts.shield.uniforms.hit.value = storm.active && storm.blocked > 0 ? .5 + .5 * Math.sin(time * 25) : lerp(parts.shield.uniforms.hit.value, 0, k);

  // Oxygen plant glows with the energy you give it
  const o2 = mode === 'game' ? Math.min(target.oxygen / 4, 1) : .3;
  if (mats.o2Band) mats.o2Band.emissiveIntensity = lerp(mats.o2Band.emissiveIntensity, o2 * (1.5 + .5 * Math.sin(time * 3)), k);

  // Battery level lights
  const lvl = mode === 'game' ? target.battery / target.batteryMax : .6;
  parts.batLeds?.forEach(leds => leds.forEach((m, i) => { m.emissiveIntensity = lerp(m.emissiveIntensity, (i + .5) / 8 <= lvl ? 2 : 0, k); }));
  if (parts.ring.visible) parts.ring.material.opacity = .6 + .3 * Math.sin(time * 4);
  if (mode === 'game') { const tg = controls.target, d = Math.hypot(tg.x, tg.z); if (d > 70) { tg.x *= 70 / d; tg.z *= 70 / d; } tg.y = 0; }

  // Astronauts walk slowly near their spot (low gravity: small hops)
  parts.astronauts?.forEach((a, i) => {
    const t = time * .18 + a.userData.phase;
    const h = a.userData.home;
    a.position.set(h.x + Math.sin(t) * 2.5, Math.abs(Math.sin(time * 2.6 + i)) * .12, h.z + Math.sin(t * 2) * 1.2);
    a.rotation.y = Math.atan2(Math.cos(t) * 2.5, Math.cos(t * 2) * 2.4);
  });

  // Solar storm
  if (storm.active) {
    storm.t += dt;
    const p = storm.points, pos = p.geometry.attributes.position;
    const count = Math.min(p.userData.seeds.length, storm.strength * 180);
    p.visible = true; p.geometry.setDrawRange(0, count);
    for (let i = 0; i < count; i++) {
      const [x, y0, z, sp] = p.userData.seeds[i];
      let y = 55 - ((y0 + storm.t * 40 * sp) % 60);
      const px = x + (55 - y) * SUN_DIR.x * -.6, pz = z + (55 - y) * SUN_DIR.z * -.6;
      const r = Math.hypot(px, pz);
      if (storm.blocked > 0 && r < 11.5 && i % storm.strength < storm.blocked) y = Math.max(y, Math.sqrt(Math.max(0, 121 - r * r)));
      pos.setXYZ(i, px, y, pz);
    }
    pos.needsUpdate = true;
    const hurt = storm.blocked < storm.strength;
    scene.background.copy(hurt && Math.sin(storm.t * 10) > .7 ? FLASH : skyColor);
    if (storm.t > 3) { storm.active = false; p.visible = false; }
  } else scene.background.copy(skyColor);

  if (!anim && controls.enabled || mode === 'menu' && !anim) controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// Back to normal (used when leaving a game): lander on the ground, no animation.
export function resetLander() {
  anim = null;
  parts.astronauts?.forEach(a => { a.visible = true; });
  if (parts.lm) parts.lm.position.y = 0;
  if (parts.flame) parts.flame.visible = false;
  if (controls) controls.enabled = mode === 'game';
}
