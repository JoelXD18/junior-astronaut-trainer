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
const SUN_DIR = new THREE.Vector3(-0.09, 0.24, -0.97).normalize(); // low Sun, long shadows (like the real Moon)
// The ground is a small "planet": it curves away, so from the base you see the horizon, the Sun and the Earth.
// (Shrunk for the game: the real Moon has a radius of 1,737 km.)
const RADIUS = { moon: 1200, mars: 1700 };
const curveDrop = (d, R) => R - Math.sqrt(Math.max(0, R * R - d * d));
const EARTH_POS = new THREE.Vector3(-561, -100, -864);
const EARTH_CINE = new THREE.Vector3(-560, 250, -860); // higher in the sky for the landing film
const HOME = new THREE.Vector3(-26, 0, 14);              // landing site
const HZ = new THREE.Vector3().subVectors(EARTH_CINE, HOME).setY(0).normalize(); // from the lander towards the Earth
const PERP = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), HZ);
const FLAG_AT = HOME.clone().addScaledVector(HZ, 9);
const STEP_AT = HOME.clone().addScaledVector(HZ, 6).addScaledVector(PERP, .18);
const ALONG = Math.atan2(-HZ.z, HZ.x); // rotation that lines an object up with HZ
const SUN_POS = new THREE.Vector3(-402, -95, -1236);

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
  const size = 1000, seg = 300;
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
    y *= THREE.MathUtils.smoothstep(Math.hypot(x - HOME.x, z - HOME.z), 15, 45); // and where the crew walks
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1) y -= c.d * (1 - d * d);
      else if (d < 1.6) y += c.d * .3 * Math.pow(1 - (d - 1) / .6, 2);
    }
    pos.setY(i, y - curveDrop(dist, RADIUS.moon));
  }
  geo.computeVertexNormals();
  const tex = regolithTexture();
  tex.repeat.set(90, 90);
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.2, roughness: 1, metalness: 0, color: 0xb9b6b0, transparent: true });
  mat.onBeforeCompile = sh => { // fade out towards the edge so the real Moon map shows through
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = length(position.xz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(260.0, 470.0, vEdge);');
  };
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
  const g = new THREE.Group(); g.add(mesh, rocks, planetBody(RADIUS.moon, tex, 0xa29f99, 'moon'));
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
    y *= THREE.MathUtils.smoothstep(Math.hypot(x - HOME.x, z - HOME.z), 15, 45);
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
    pos.setY(i, y - curveDrop(dist, RADIUS.mars));
    // colours: rusty ground, darker high rock, pale sand on the river floors
    const n = fbm(x * .03 + 3, z * .03, 3);
    tmp.copy(base).lerp(dark, Math.min(1, Math.max(0, (y - 8) / 70) + (n - .5) * .5)).lerp(sand, river * .8);
    cols.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 1.4, roughness: 1, vertexColors: true, transparent: true });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = length(position.xz);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(330.0, 440.0, vEdge);');
  };
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
  const g = new THREE.Group(); g.add(mesh, rocks, planetBody(RADIUS.mars, tex, 0xb8643c, 'mars'));
  return g;
}

// The rest of the planet beyond the detailed ground: a big sphere with the same dusty surface.
// It uses NASA's real global map, turned so that the base sits on a real place:
// the Moon base at the Apollo 16 landing site (Descartes highlands), the Mars base at Jezero crater
// (where the Perseverance rover landed).
const SITES = { moon: { map: 'assets/textures/moon-lroc.jpg', lon: 15.5, lat: -9 }, mars: { map: 'assets/textures/mars.jpg', lon: 77.5, lat: 18.4 } };
function planetBody(R, tex, color, which) {
  const detail = tex.clone(); detail.needsUpdate = true; detail.repeat.set(140, 70);
  const site = SITES[which];
  const map = new THREE.TextureLoader().load(site.map);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const body = new THREE.Mesh(new THREE.SphereGeometry(R - 1.5, 200, 100),
    new THREE.MeshStandardMaterial({ map, bumpMap: detail, bumpScale: 1, color: 0xffffff, roughness: 1 }));
  // point on the sphere for this longitude/latitude (three.js sphere + equirectangular map)
  const phi = ((site.lon + 180) / 360) * Math.PI * 2, theta = (.5 - site.lat / 180) * Math.PI;
  const p = new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta));
  body.quaternion.setFromUnitVectors(p, new THREE.Vector3(0, 1, 0));
  body.position.y = -R;
  body.receiveShadow = true;
  return body;
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
    if (v.y < -450) v.y = -v.y; // stars down to the curved horizon
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
  earthTex.anisotropy = 8;
  // Sunlight on the Earth comes from the side, so from the Moon it looks like a bright "gibbous" Earth.
  const toMoon = EARTH_POS.clone().negate().normalize();
  const side = new THREE.Vector3(0, 1, 0).cross(toMoon).normalize();
  const sunOnEarth = toMoon.clone().multiplyScalar(.55).add(side.multiplyScalar(.82)).add(new THREE.Vector3(0, .15, 0)).normalize();
  const earthMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: earthTex }, sun: { value: sunOnEarth } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 sun; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vec3 tex = texture2D(map, vUv).rgb; tex = pow(tex, vec3(2.2));
        float d = dot(vN, sun); float day = smoothstep(-.15, .35, d);
        vec3 col = tex * (.03 + 1.35 * day);
        float rim = pow(1. - max(dot(vN, vV), 0.), 2.5);
        col += vec3(.25, .5, 1.) * rim * (.15 + .9 * day);
        gl_FragColor = vec4(pow(col, vec3(1. / 2.2)), 1.); }`,
  });
  const earth = new THREE.Group();
  const globe = new THREE.Mesh(new THREE.SphereGeometry(40, 64, 40), earthMat);
  globe.rotation.z = .41; // Earth's tilt
  const halo = new THREE.Mesh(new THREE.SphereGeometry(44, 64, 40), new THREE.ShaderMaterial({
    uniforms: { sun: { value: sunOnEarth } }, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 sun; varying vec3 vN; varying vec3 vV; void main(){ float r = pow(max(0., 1. - abs(dot(vN, vV))) , 4.); float day = smoothstep(-.3, .4, dot(-vN, sun) * -1.); gl_FragColor = vec4(vec3(.35, .6, 1.) * r * (.3 + day), r * .9); }`,
  }));
  earth.add(globe, halo);
  earth.position.copy(EARTH_POS);
  g.add(earth);
  parts.earth = earth; parts.globe = globe;

  // Sun disc with glow
  const glow = document.createElement('canvas'); glow.width = glow.height = 128;
  const gg = glow.getContext('2d'); const grd = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(.15, 'rgba(255,245,210,1)'); grd.addColorStop(.35, 'rgba(255,220,150,.35)'); grd.addColorStop(1, 'rgba(255,200,120,0)');
  gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), depthWrite: false, transparent: true }));
  sun.scale.setScalar(260);
  sun.position.copy(SUN_POS);
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

// The famous Apollo bootprint, drawn in code: a sole outline with the ridges of the tread.
function bootprintTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(40,38,36,.85)';
  g.beginPath(); g.ellipse(70, 56, 62, 44, 0, 0, 7); g.ellipse(180, 56, 72, 50, 0, 0, 7); g.fill();
  g.fillRect(70, 18, 110, 76);
  g.strokeStyle = 'rgba(150,146,140,.9)'; g.lineWidth = 5;
  for (let x = 22; x < 245; x += 17) { g.beginPath(); g.moveTo(x, 22); g.lineTo(x + 6, 90); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Things only used in the first-person moonwalk: Apollo-style boot and suit leg, suit arm and glove,
// and the footprint left behind.
const SUIT = () => new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: .85 });

// A cylinder stretched between two points (for arm and leg pieces).
function limb(r1, r2, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, 1, 16, 1), mat);
  m.userData.limb = true;
  return m;
}
const UPY = new THREE.Vector3(0, 1, 0);
function placeLimb(m, from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  m.position.copy(from).addScaledVector(d, .5);
  m.quaternion.setFromUnitVectors(UPY, d.clone().normalize());
  m.scale.set(1, d.length(), 1);
}

// Top view outline of the boot sole (x forward, metres).
function soleShape(s = 1) {
  const sh = new THREE.Shape();
  sh.moveTo(-.17 * s, 0);
  sh.bezierCurveTo(-.17 * s, -.07 * s, -.06 * s, -.075 * s, .02 * s, -.07 * s);
  sh.bezierCurveTo(.12 * s, -.075 * s, .19 * s, -.06 * s, .19 * s, 0);
  sh.bezierCurveTo(.19 * s, .06 * s, .12 * s, .075 * s, .02 * s, .07 * s);
  sh.bezierCurveTo(-.06 * s, .075 * s, -.17 * s, .07 * s, -.17 * s, 0);
  return sh;
}

function makeBoot() {
  const boot = new THREE.Group();
  const suit = SUIT();
  const sole = new THREE.Mesh(new THREE.ExtrudeGeometry(soleShape(), { depth: .05, bevelEnabled: true, bevelThickness: .015, bevelSize: .035, bevelSegments: 2 }),
    new THREE.MeshStandardMaterial({ color: 0x55637c, roughness: .9 }));
  sole.rotation.x = -Math.PI / 2; boot.add(sole);
  // ridges of the tread on the side of the sole
  for (let i = -6; i <= 7; i++) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(.012, .03, .16), new THREE.MeshStandardMaterial({ color: 0x4f596a }));
    r.position.set(i * .024, .02, 0); boot.add(r);
  }
  const bootMat = new THREE.MeshStandardMaterial({ color: 0xd6d1c4, roughness: .8 });
  const upper = new THREE.Mesh(new THREE.ExtrudeGeometry(soleShape(.9), { depth: .09, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 4 }), bootMat);
  upper.rotation.x = -Math.PI / 2; upper.position.y = .06; boot.add(upper);
  const toe = new THREE.Mesh(new THREE.SphereGeometry(.075, 16, 10), new THREE.MeshStandardMaterial({ color: 0x9aa3b0, roughness: .6 }));
  toe.scale.set(1.25, .75, 1); toe.position.set(.11, .12, 0); boot.add(toe);
  const ankle = new THREE.Mesh(new THREE.CylinderGeometry(.085, .1, .26, 16), bootMat);
  ankle.position.set(-.07, .27, 0); boot.add(ankle);
  const strapMat = new THREE.MeshStandardMaterial({ color: 0x3f5f9f, roughness: .6 });
  for (const y of [.2, .33]) { const strap = new THREE.Mesh(new THREE.TorusGeometry(.095, .014, 8, 24), strapMat); strap.rotation.x = Math.PI / 2; strap.position.set(-.07, y, 0); boot.add(strap); }
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(.16, .03, .07), new THREE.MeshStandardMaterial({ color: 0xc9c9c4 }));
  tongue.position.set(.03, .17, 0); tongue.rotation.z = -.35; boot.add(tongue);
  return boot;
}

// Apollo glove: light grey hand, blue fingertips, wrist ring; fingers curl around a vertical pole.
function makeGlove() {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: .7 });
  const tips = new THREE.MeshStandardMaterial({ color: 0x3d5ca8, roughness: .6 });
  const palm = new THREE.Mesh(new THREE.SphereGeometry(.06, 16, 12), skin);
  palm.scale.set(.75, 1.2, 1); palm.position.set(0, 0, .055); g.add(palm);
  for (let i = 0; i < 4; i++) { // fingers wrap round the pole (pole runs along y at the origin)
    const y = .045 - i * .03;
    for (const [ang, mat] of [[.9, skin], [2.2, skin], [3.1, tips]]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(.017, 10, 8), mat);
      f.position.set(Math.sin(ang) * .045, y, Math.cos(ang) * .045); g.add(f);
    }
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.016, .05, 4, 8), tips);
  thumb.position.set(-.05, .07, .02); thumb.rotation.z = .6; g.add(thumb);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.055, .014, 10, 28), new THREE.MeshStandardMaterial({ color: 0x2f5fb5, metalness: .8, roughness: .3 }));
  ring.position.set(0, -.005, .12); g.add(ring); // wrist ring where the glove locks to the suit
  g.userData.wrist = new THREE.Vector3(0, -.005, .13);
  return g;
}

function makeEvaProps() {
  const g = new THREE.Group();
  const suit = SUIT();
  const boot = makeBoot(); boot.rotation.y = ALONG; boot.scale.setScalar(1.25); boot.visible = false;
  const thigh = limb(.085, .078, suit), shin = limb(.075, .07, suit), knee = new THREE.Mesh(new THREE.SphereGeometry(.08, 14, 10), suit);
  const leg = new THREE.Group(); leg.add(thigh, shin, knee); leg.visible = false;
  const glove = makeGlove(); glove.scale.setScalar(1.7); glove.visible = false;
  const upperArm = limb(.085, .075, suit), foreArm = limb(.075, .065, suit), elbow = new THREE.Mesh(new THREE.SphereGeometry(.08, 14, 10), suit);
  const arm = new THREE.Group(); arm.add(upperArm, foreArm, elbow); arm.visible = false;
  const print = new THREE.Mesh(new THREE.PlaneGeometry(.4, .18), new THREE.MeshBasicMaterial({ map: bootprintTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  print.rotation.set(-Math.PI / 2, 0, ALONG); print.position.copy(STEP_AT).setY(.04); print.visible = false;
  g.add(boot, leg, glove, arm, print);
  Object.assign(parts, { boot, leg, thigh, shin, knee, glove, arm, upperArm, foreArm, elbow, print });
  // helmet lamp for the moonwalk
  parts.lamp = new THREE.SpotLight(0xfff2dd, 25, 30, .6, .5, 1.2); parts.lamp.visible = false;
  g.add(parts.lamp, parts.lamp.target);
  return g;
}

// Where the camera's right / forward point, for attaching the arm and leg to "your" body.
function camAxes() {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const fwd = camera.getWorldDirection(new THREE.Vector3());
  return { right, fwd };
}

// The leg follows the boot: hip under the camera, knee bent forward.
function poseLeg() {
  const { right, fwd } = camAxes();
  const ankle = parts.boot.localToWorld(new THREE.Vector3(-.07, .4, 0));
  const flat = fwd.clone().setY(0).normalize();
  const hip = camera.position.clone().addScaledVector(right, .25).add(new THREE.Vector3(0, -.85, 0)).addScaledVector(flat, -.2);
  const knee = hip.clone().lerp(ankle, .5).addScaledVector(flat, -.06).add(new THREE.Vector3(0, .08, 0));
  placeLimb(parts.thigh, hip, knee); placeLimb(parts.shin, knee, ankle); parts.knee.position.copy(knee);
}

// The arm reaches from your right shoulder to the glove.
function poseArm() {
  const { right, fwd } = camAxes();
  const gl = parts.glove;
  gl.updateMatrixWorld();
  const wrist = gl.localToWorld(gl.userData.wrist.clone());
  const shoulder = camera.position.clone().addScaledVector(right, .3).add(new THREE.Vector3(0, -.32, 0)).addScaledVector(fwd, -.05);
  const elbow = shoulder.clone().lerp(wrist, .5).addScaledVector(right, .12).add(new THREE.Vector3(0, -.12, 0));
  placeLimb(parts.upperArm, shoulder, elbow); placeLimb(parts.foreArm, elbow, wrist); parts.elbow.position.copy(elbow);
}

function makeBase() {
  const base = new THREE.Group();
  parts.base = base;
  base.add(shieldDome());
  const f = flag(); f.position.copy(FLAG_AT); f.rotation.y = ALONG + Math.PI / 2 + .5; base.add(f);
  parts.flag = f;
  base.add(makeEvaProps());

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
  camera = new THREE.PerspectiveCamera(50, 1, .5, 6000);

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
  earthLight.position.set(-720, 300, -720);
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
  window.__jamt = { camera, parts, THREE, seek: s => { if (anim) anim.t = s; } }; // for testing in the browser console
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
    camera.position.copy(GAME_CAM());
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
function GAME_CAM() { return window.innerWidth < 700 ? new THREE.Vector3(34, 62, 100) : new THREE.Vector3(44, 36, 80); }

// The lander comes down from the sky onto the landing site, then the camera flies to the base view.
export async function playLanding(done, onProgress) {
  if (!ok) { done?.(); return; }
  await Promise.race([lmReady, new Promise(r => setTimeout(r, 6000))]); // wait for the lander model
  if (!parts.lm) { done?.(); return; }
  parts.lm.position.y = 70;
  setMode('game', true);
  controls.enabled = false;
  parts.astronauts?.forEach(a => { a.visible = false; }); // still inside the lander
  if (parts.print) parts.print.visible = false;
  if (parts.flag) parts.flag.visible = false; // the crew brings it out
  anim = { kind: 'landing', t: 0, done, onProgress };
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
  if (a.kind === 'landing') { parts.lm.position.set(-26, 0, 14); parts.lm.rotation.set(0, .6, 0); parts.flame.visible = false; if (parts.earth) { parts.earth.position.copy(EARTH_POS); parts.earth.scale.setScalar(1); } endEva(); setMode('game', true); }
  a.done?.();
}

// After the moonwalk: flag planted, footprint stays, crew outside, normal camera.
function endEva() {
  if (parts.flag) { parts.flag.visible = true; parts.flag.position.copy(FLAG_AT); parts.flag.children[2].scale.x = 1; parts.flag.children[2].position.x = .65; }
  if (parts.print) parts.print.visible = true;
  for (const k of ['boot', 'leg', 'glove', 'arm']) if (parts[k]) parts[k].visible = false;
  parts.astronauts?.forEach(a => { a.visible = true; });
  camera.near = .5; camera.updateProjectionMatrix();
  if (parts.lamp) parts.lamp.visible = false;
}

function runAnim(dt) {
  const a = anim;
  a.t += dt;
  const lm = parts.lm, home = new THREE.Vector3(-26, 0, 14);
  const flicker = .85 + Math.random() * .3;
  if (a.kind === 'landing') {
    // A film in three shots. The lander flies towards the Earth's direction, so the Earth is always
    // in the background, above the curved horizon of the Moon:
    // 1) wide shot over the Moon (0–10 s)  2) closer, braking (10–17 s)
    // 3) from the ground, looking up as it touches down (17–21 s), then fly to the base view.
    const T1 = 10, T2 = 17, T3 = 21;
    const E1 = 22.4, E2 = 25.4, E3 = 28.6, E4 = 32.4, E5 = 37.6, T4 = 40.6; // moonwalk times
    const up = new THREE.Vector3(0, 1, 0);
    const hz = new THREE.Vector3().subVectors(EARTH_CINE, home).setY(0).normalize(); // towards the Earth
    const perp = new THREE.Vector3().crossVectors(up, hz);
    const P0 = home.clone().addScaledVector(hz, -650).addScaledVector(perp, 90).setY(140);
    const P1 = home.clone().addScaledVector(hz, -95).addScaledVector(perp, 12).setY(55);
    const P2 = home.clone().addScaledVector(hz, -6).setY(20);
    if (parts.earth && a.t < E5) { parts.earth.position.copy(EARTH_CINE); parts.earth.scale.setScalar(1.8); }
    const groundCam = home.clone().addScaledVector(hz, -32).addScaledVector(perp, 7).setY(2.4);
    let phase;
    if (a.t < T1) {
      const e = ease(a.t / T1);
      lm.position.lerpVectors(P0, P1, e);
      lm.rotation.set(0, .6, .45 * (1 - e));
      camera.position.copy(lm.position).addScaledVector(hz, -55).addScaledVector(perp, 16).add(new THREE.Vector3(0, 9, 0));
      camera.lookAt(lm.position.clone().addScaledVector(hz, 120).add(new THREE.Vector3(0, -24, 0)));
      phase = 'approach';
    } else if (a.t < T2) {
      const e = ease((a.t - T1) / (T2 - T1));
      lm.position.lerpVectors(P1, P2, e);
      lm.rotation.set(0, .6, .12 * (1 - e));
      // the camera swings from behind the lander to its side
      const off = hz.clone().multiplyScalar(-40 + 18 * e).addScaledVector(perp, 10 + 26 * e);
      camera.position.copy(lm.position).add(off).add(new THREE.Vector3(0, 5 - 3 * e, 0));
      camera.lookAt(lm.position.clone().addScaledVector(hz, 40 * (1 - e)).add(new THREE.Vector3(0, -8 * (1 - e), 0)));
      phase = 'braking';
    } else if (a.t < T3) {
      const p = (a.t - T2) / (T3 - T2);
      lm.position.lerpVectors(P2, home, ease(Math.min(1, p * 1.15)));
      lm.position.y = P2.y * Math.pow(Math.max(0, 1 - p * 1.15), 1.6);
      lm.rotation.set(0, .6, 0);
      if (p > .86 && !a.dusted) { a.dusted = true; burstDust(home); }
      camera.position.copy(groundCam);
      camera.lookAt(new THREE.Vector3(home.x, 7, home.z).addScaledVector(hz, 20));
      phase = 'final';
    } else if (a.t < E1) {
      lm.position.copy(home);
      camera.position.copy(groundCam);
      camera.lookAt(new THREE.Vector3(home.x, 7, home.z).addScaledVector(hz, 20));
      phase = 'final';
    } else if (a.t < E5) {
      // ---- first person, through the helmet visor ----
      lm.position.copy(home);
      if (camera.near > .1) { camera.near = .05; camera.updateProjectionMatrix(); }
      parts.lamp.visible = true; parts.lamp.position.copy(camera.position); parts.lamp.target.position.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
      const t = a.t, bob = s => Math.sin(t * 7) * s;
      if (t < E2) { // at the hatch, looking out at the Moon and the Earth
        const k = ease((t - E1) / (E2 - E1));
        camera.position.copy(home).addScaledVector(hz, 3).setY(3.4);
        camera.lookAt(home.clone().addScaledVector(hz, 30).addScaledVector(perp, -6 + 9 * k).setY(5 - 3 * k));
        phase = 'exit';
      } else if (t < E3) { // climbing down the ladder
        const k = ease((t - E2) / (E3 - E2));
        camera.position.copy(home).addScaledVector(hz, 3 + 1.8 * k).setY(3.4 - 1.7 * k + bob(.05));
        camera.lookAt(STEP_AT.clone().addScaledVector(hz, 3 * (1 - k)).setY(1.4 * (1 - k)));
        phase = 'ladder';
      } else if (t < E4) { // the first step and the bootprint
        camera.position.copy(home).addScaledVector(hz, 5.55).addScaledVector(perp, -.35).setY(1.7);
        camera.lookAt(STEP_AT.clone().addScaledVector(hz, .2).addScaledVector(perp, -.1).setY(.05));
        const s = t - E3, b = parts.boot;
        b.visible = parts.leg.visible = s < 2.7;
        const high = STEP_AT.clone().addScaledVector(hz, -.35).setY(.55);
        if (s < 1) b.position.lerpVectors(high, STEP_AT, ease(s));
        else if (s < 1.9) b.position.copy(STEP_AT).setY(-.01 * Math.min(1, (s - 1) * 4)); // presses into the dust
        else b.position.lerpVectors(STEP_AT, STEP_AT.clone().addScaledVector(hz, .5).setY(.9), ease((s - 1.9) / .8));
        parts.print.visible = s > 1.9;
        if (b.visible) poseLeg();
        phase = s > 1 ? 'step' : 'ladder';
      } else { // planting the flag
        const s = t - E4;
        const camAt = home.clone().addScaledVector(hz, 4.8 + Math.min(1, s / 1.2) * 2.6 - 1.2 * ease((s - 3.6) / 1.2)).setY(1.7 + bob(.03) * (s < 1.2 ? 1 : 0));
        camera.position.copy(camAt);
        camera.lookAt(FLAG_AT.clone().setY(1.1 + .7 * ease((s - 3.4) / 1.2)).addScaledVector(perp, .3 * ease((s - 3.4) / 1.2))); // look up as the flag opens
        const fl = parts.flag, cloth = fl.children[2];
        fl.visible = true;
        const held = camAt.clone().addScaledVector(hz, 1.1).addScaledVector(perp, -.22).setY(.35);
        const over = FLAG_AT.clone().setY(.8);
        let y;
        if (s < 2.4) { fl.position.lerpVectors(held, over, ease(s / 2.4)); y = null; }
        else if (s < 2.9) y = .8 - .45 * ease((s - 2.4) / .5);   // first push
        else if (s < 3.2) y = .35 + .1 * ease((s - 2.9) / .3);  // lift a little
        else if (s < 3.7) y = .45 - .45 * ease((s - 3.2) / .5); // second push: it's in!
        else y = 0;
        if (y !== null) fl.position.copy(FLAG_AT).setY(y);
        cloth.scale.x = s < 3.7 ? .06 : .06 + .94 * ease((s - 3.7) / .9); // the flag opens
        // your glove holds the pole, then lets go
        const gl = parts.glove;
        gl.visible = parts.arm.visible = s < 4.9;
        const grip = fl.position.clone().add(new THREE.Vector3(0, 1.0, 0));
        const release = Math.max(0, (s - 3.9) / 1);
        gl.position.copy(grip).addScaledVector(hz, -release * .5).add(new THREE.Vector3(0, -release * .5, 0));
        gl.lookAt(camera.position.x, gl.position.y, camera.position.z);
        gl.rotateY(Math.PI); // palm faces away, fingers wrap round the pole
        if (gl.visible) poseArm();
        phase = 'flag';
      }
    } else {
      // back to the base view
      if (camera.near < .5) endEva();
      lm.position.copy(home);
      const k = ease((a.t - E5) / (T4 - E5));
      if (parts.earth) { parts.earth.position.lerpVectors(EARTH_CINE, EARTH_POS, k); parts.earth.scale.setScalar(1.8 - .8 * k); }
      const from = home.clone().addScaledVector(hz, 6.2).setY(1.7);
      camera.position.lerpVectors(from, GAME_CAM(), k);
      camera.lookAt(FLAG_AT.clone().setY(1.1).lerp(new THREE.Vector3(-5, 0, 4), k));
      phase = 'landed';
    }
    parts.flame.visible = a.t < T3 - .3;
    parts.flame.scale.set(flicker, flicker * (a.t < T1 ? 1.3 : 1), flicker);
    parts.flameLight.intensity = parts.flame.visible ? 60 * flicker : 0;
    if (parts.flag) { const cl = parts.flag.children[2]; cl.position.x = .65 * cl.scale.x; } // the flag opens from the pole
    a.onProgress?.({ phase });
    if (a.t > T4) { anim = null; endEva(); if (parts.earth) { parts.earth.position.copy(EARTH_POS); parts.earth.scale.setScalar(1); } controls.target.set(-5, 0, 4); camera.position.copy(GAME_CAM()); controls.enabled = true; controls.update(); a.done?.(); }
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
  if (parts.globe) parts.globe.rotation.y += dt * .01;

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
