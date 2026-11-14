// Realistic 3D Moon base, full screen behind the game. Seen from above while playing,
// and as a slow cinematic orbit behind the menus.
// 3D models: NASA 3D Resources (Apollo Lunar Module, Habitat Demonstration Unit, Astronaut).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const C = { o2: 0x4fc3f7, shield: 0x8fb8ff, bat: 0x69f0ae, sun: 0xffdd88 };
const SUN_DIR = new THREE.Vector3(-0.8, 0.45, 0.35).normalize(); // low Sun, long shadows (like the real Moon)

let renderer, labelRenderer, scene, camera, controls, wrap;
let sunLight, earthLight, ambient;
const parts = { labels: {}, lights: [] };
const storm = { active: false, t: 0, strength: 0, blocked: 0, points: null };
let target = { night: false, oxygen: 0, shield: 0, battery: 0, batteryMax: 1 };
let mode = 'menu';
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
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;

  // Scattered rocks
  const rockGeo = new THREE.DodecahedronGeometry(1, 1);
  const rp = rockGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (1 + (hash(i, 1) - .5) * .5), rp.getY(i) * (.6 + hash(i, 2) * .3), rp.getZ(i) * (1 + (hash(i, 3) - .5) * .5));
  rockGeo.computeVertexNormals();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1, flatShading: true }), 500);
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
  g.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true })));

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
  el.className = 'scene-label';
  el.innerHTML = `<span class="i">${icon}</span><span class="t"></span>`;
  const o = new CSS2DObject(el);
  parts.labels[key] = el;
  return o;
}

const metal = (color, r = .45, m = .7, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, ...extra });
function shadow(o) { o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }

// Vertical solar array (like NASA's Artemis VSAT concept): a tall mast with a long panel that follows the Sun.
function solarTower() {
  const g = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.18, .25, 13, 12), metal(0xc8c8c8));
  mast.position.y = 6.5; g.add(mast);
  const panelGroup = new THREE.Group();
  const cells = new THREE.MeshStandardMaterial({ color: 0x0c1a3a, roughness: .25, metalness: .8, emissive: 0x0a1a44, emissiveIntensity: .0 });
  const frame = metal(0xd9d9d9, .4, .6);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.2, .08), cells);
    p.position.set(0, 3 + i * 2.35, .3); panelGroup.add(p);
    const f = new THREE.Mesh(new THREE.BoxGeometry(3.3, .1, .12), frame);
    f.position.set(0, 1.85 + i * 2.35, .3); panelGroup.add(f);
  }
  g.add(panelGroup);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, .5, 16), metal(0x8d8d8d, .7, .4));
  base.position.y = .25; g.add(base);
  parts.panelCells = cells;
  panelGroup.rotation.y = Math.atan2(SUN_DIR.x, SUN_DIR.z); // face the Sun
  return shadow(g);
}

// Oxygen plant: pulls oxygen out of moon rock, then stores it in tanks.
function oxygenPlant() {
  const g = new THREE.Group();
  const tankMat = metal(0xe8e8e8, .35, .5);
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(.9, 3.6, 8, 24), tankMat);
    tank.rotation.z = Math.PI / 2; tank.position.set(0, 1.1, i * 2.1 - 2.1); g.add(tank);
    const band = new THREE.Mesh(new THREE.TorusGeometry(.92, .06, 8, 24), metal(0x4fc3f7, .3, .2, { emissive: C.o2, emissiveIntensity: 0 }));
    band.rotation.y = Math.PI / 2; band.position.set(0, 1.1, i * 2.1 - 2.1); g.add(band);
    (parts.o2Bands ||= []).push(band.material);
    for (const sx of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.15, .5, 1.4), metal(0x777777));
      leg.position.set(sx, .25, i * 2.1 - 2.1); g.add(leg);
    }
  }
  const proc = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 3.4), metal(0xb7b2a6, .6, .3));
  proc.position.set(-4.2, 1.3, 0); g.add(proc);
  const hopper = new THREE.Mesh(new THREE.CylinderGeometry(1.2, .5, 1.6, 4), metal(0x9a9488, .6, .3));
  hopper.position.set(-4.2, 3.4, 0); hopper.rotation.y = Math.PI / 4; g.add(hopper);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, 3, 8), metal(0xaaaaaa));
  pipe.rotation.z = Math.PI / 2; pipe.position.set(-2.2, 1.9, 0); g.add(pipe);
  const lamp = new THREE.PointLight(C.o2, 0, 9, 2); lamp.position.set(0, 3, 0); g.add(lamp);
  parts.o2Light = lamp;
  return shadow(g);
}

// Battery bank: container units with level lights on the side.
function batteryBank() {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.2), metal(0xd6d3cc, .55, .35));
    box.position.set(0, 1.2, i * 2.6 - 1.3); g.add(box);
    const rad = new THREE.Mesh(new THREE.BoxGeometry(4.6, .06, 2), metal(0xf0f0f0, .2, .9));
    rad.position.set(0, 2.45, i * 2.6 - 1.3); g.add(rad);
  }
  parts.batLeds = [];
  for (let i = 0; i < 8; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(.45, .35, .05), new THREE.MeshStandardMaterial({ color: 0x113322, emissive: C.bat, emissiveIntensity: 0 }));
    led.position.set(-1.9 + i * .55, 1.3, 2.43);
    g.add(led); parts.batLeds.push(led.material);
  }
  return shadow(g);
}

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

async function loadModels(base) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  const load = n => loader.loadAsync(`assets/models/${n}.glb`).then(g => g.scene).catch(() => null);
  const [hab, lm, astro] = await Promise.all([load('habitat-1'), load('lunar-module'), load('astronaut')]);
  if (hab) base.add(placeModel(hab, 5.5, 0, 0, -.4));
  if (lm) base.add(placeModel(lm, 7, -26, 14, .6));
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

function makeBase() {
  const base = new THREE.Group();
  base.add(shieldDome());

  const towers = [[-20, -10], [-15, -16], [-24, -3]];
  towers.forEach(([x, z]) => { const t = solarTower(); t.position.set(x, 0, z); base.add(t); });
  const o2 = oxygenPlant(); o2.position.set(18, 0, -8); o2.rotation.y = .3; base.add(o2);
  const bat = batteryBank(); bat.position.set(17, 0, 9); bat.rotation.y = -.2; base.add(bat);
  const f = flag(); f.position.set(-21.5, 0, 19.5); f.rotation.y = .5; base.add(f);

  for (const [x, z] of [...towers, [18, -8], [17, 9]]) base.add(cable(new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 0, 0)));

  // Habitat lights for the night
  for (const [x, z] of [[4, 4], [-4, 4], [0, -5]]) {
    const l = new THREE.PointLight(0xffd8a0, 0, 16, 2); l.position.set(x, 3, z); base.add(l); parts.lights.push(l);
  }

  const lab = (key, icon, x, y, z) => { const o = label(key, icon); o.position.set(x, y, z); base.add(o); };
  lab('solar', '☀️', -20, 15, -10);
  lab('oxygen', '💨', 16, 6, -8);
  lab('battery', '🔋', 17, 5, 9);
  lab('shield', '🛡️', 0, 12.5, 0);
  lab('home', '🏠', 0, 7.5, 0);

  loadModels(base);
  return base;
}

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

  scene.add(makeTerrain(), makeSky(), makeBase());
  storm.points = makeStormParticles();
  scene.add(storm.points);

  setMode('menu');
  window.__jamt = { scene, camera, parts }; // debugging helper
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
export function setMode(m) {
  if (!ok) return;
  mode = m;
  document.body.classList.toggle('scene-game', m === 'game');
  if (m === 'menu') {
    controls.enabled = false;
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
    controls.minPolarAngle = .25; controls.maxPolarAngle = 1.05; // always from above
    controls.minDistance = 25; controls.maxDistance = 120;
  }
  controls.update();
}

export function setLabels(texts) {
  for (const [k, el] of Object.entries(parts.labels)) el.querySelector('.t').textContent = texts[k] || '';
}

export function updateScene(s) { target = { ...target, ...s }; }

export function playStorm(strength, blocked) { Object.assign(storm, { active: true, t: 0, strength, blocked }); }

const lerp = (a, b, k) => a + (b - a) * k;

function tick() {
  const dt = Math.min(clock.getDelta(), .05), time = clock.elapsedTime;
  const k = 1 - Math.pow(.03, dt);
  const night = target.night && mode === 'game';

  sunLight.intensity = lerp(sunLight.intensity, night ? 0 : 3.2, k);
  ambient.intensity = lerp(ambient.intensity, night ? .05 : .12, k);
  earthLight.intensity = lerp(earthLight.intensity, night ? .35 : .12, k);
  parts.sun.material.opacity = lerp(parts.sun.material.opacity, night ? 0 : 1, k);
  parts.lights.forEach(l => { l.intensity = lerp(l.intensity, night ? 40 : 0, k); });
  if (parts.panelCells) parts.panelCells.emissiveIntensity = lerp(parts.panelCells.emissiveIntensity, night ? 0 : .25, k);
  if (parts.earth) parts.earth.rotation.y += dt * .01;

  // Shield
  const sh = mode === 'game' ? Math.min(target.shield / 5, 1) : 0;
  parts.shield.uniforms.power.value = lerp(parts.shield.uniforms.power.value, sh > 0 ? .35 + sh * .65 : 0, k);
  parts.shield.uniforms.time.value = time;
  parts.shield.uniforms.hit.value = storm.active && storm.blocked > 0 ? .5 + .5 * Math.sin(time * 25) : lerp(parts.shield.uniforms.hit.value, 0, k);

  // Oxygen plant glows with the energy you give it
  const o2 = mode === 'game' ? Math.min(target.oxygen / 4, 1) : .3;
  (parts.o2Bands || []).forEach(m => { m.emissiveIntensity = lerp(m.emissiveIntensity, o2 * (1.5 + .5 * Math.sin(time * 3)), k); });
  if (parts.o2Light) parts.o2Light.intensity = lerp(parts.o2Light.intensity, o2 * 25, k);

  // Battery level lights
  const lvl = mode === 'game' ? target.battery / target.batteryMax : .6;
  parts.batLeds?.forEach((m, i) => { m.emissiveIntensity = lerp(m.emissiveIntensity, (i + .5) / 8 <= lvl ? 2 : 0, k); });

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
    scene.background.setHex(hurt && Math.sin(storm.t * 10) > .7 ? 0x300508 : 0x000000);
    if (storm.t > 3) { storm.active = false; p.visible = false; scene.background.setHex(0x000000); }
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
