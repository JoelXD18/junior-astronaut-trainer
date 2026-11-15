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
    y *= THREE.MathUtils.smoothstep(Math.hypot(x + 26, z - 14), 9, 30); // and level where the lander sits
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
    y *= THREE.MathUtils.smoothstep(Math.hypot(x + 26, z - 14), 9, 30);
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

// Exact height of the ground (Moon or Mars) at a point, so the lander stands on it.
const downRay = new THREE.Raycaster();
function groundY(x, z) {
  const g = planet === 'mars' ? parts.marsGround : parts.moonGround;
  if (!g) return 0;
  const mesh = g.children[0];
  mesh.updateMatrixWorld();
  downRay.set(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0));
  const hit = downRay.intersectObject(mesh)[0];
  return hit ? hit.point.y : 0;
}
const LAND = { x: -26, z: 14 };
function landingSpot() { return new THREE.Vector3(LAND.x, groundY(LAND.x, LAND.z), LAND.z); }

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

// ---------- night lights ----------
// Instead of many real lights (slow on phones), each building gets a glowing lamp and a soft pool of light
// drawn on the ground; the rovers get real headlights. They fade in at night.
let poolMat = null, lampMat = null;
const POOL_GEO = new THREE.CircleGeometry(1, 40);
const LAMP_GEO = new THREE.SphereGeometry(.28, 12, 8);
function nightMats() {
  if (poolMat) return;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(.45, 'rgba(255,190,110,.45)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xffc46b, emissiveIntensity: 0 });
}
function lightPool(radius) {
  nightMats();
  const p = new THREE.Mesh(POOL_GEO, poolMat);
  p.rotation.x = -Math.PI / 2; p.position.y = .07; p.scale.setScalar(radius);
  p.raycast = () => {}; // not clickable
  return p;
}
function headlights(g, front = 1.6, height = 1.1, side = .5) {
  nightMats();
  const spot = new THREE.SpotLight(0xfff2cc, 0, 34, .55, .55, 1.4);
  spot.position.set(front, height, 0); spot.target.position.set(front + 10, 0, 0);
  g.add(spot, spot.target);
  for (const z of [-side, side]) { const l = new THREE.Mesh(LAMP_GEO, lampMat); l.scale.setScalar(.6); l.position.set(front, height - .1, z); g.add(l); }
  g.userData.spot = spot;
}
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

// Round printed labels (like "O₂" on a tank), drawn once and shared.
const labelTex = {};
function decal(text, bg, fg, size = 1.3) {
  if (!labelTex[text]) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill();
    g.lineWidth = 8; g.strokeStyle = fg; g.stroke();
    g.fillStyle = fg; g.font = 'bold 58px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 64, 68);
    labelTex[text] = new THREE.CanvasTexture(c); labelTex[text].colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.Mesh(new THREE.CircleGeometry(size / 2, 32), new THREE.MeshStandardMaterial({ map: labelTex[text], transparent: true, roughness: .6 }));
  m.raycast = () => {};
  return m;
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
  for (const s of [1, -1]) { const d = decal('O₂', '#ffffff', '#0d8fd8', 1.5); d.position.set(-1.8, 1.4, s * (1.72 + (level > 1 ? 1.9 : 0))); d.rotation.y = s > 0 ? 0 : Math.PI; g.add(d); }
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
    const d = decal('O₂', '#ffffff', '#0d8fd8', 1.1); d.position.set(2.37, 1.05, z); d.rotation.y = Math.PI / 2; g.add(d);
  }
  return g;
}

// Battery bank: a container with level lights. Higher level = taller stack.
// Battery bank: big battery cells (green, with a + terminal on top) and a charge meter that lights up.
// Higher level = more cells.
function batteryBank(level) {
  const m = sharedMats(), g = new THREE.Group();
  const cells = 2 + level, h = 2.3 + level * .25;
  const body = metal(0x2e9d5a, .45, .35, { emissive: 0x1c7a40, emissiveIntensity: .45 }), cap = metal(0xeeeeee, .3, .6); // a slight glow: green even in shadow
  const plate = new THREE.Mesh(new THREE.BoxGeometry(cells * 1.35 + .8, .3, 2.2), m.grey);
  plate.position.y = .15; g.add(plate);
  for (let i = 0; i < cells; i++) {
    const x = (i - (cells - 1) / 2) * 1.35;
    const cell = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, h, 20), body); cell.position.set(x, .3 + h / 2, 0); g.add(cell);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(.56, .56, .35, 20), cap); top.position.set(x, .3 + h - .1, 0); g.add(top);
    const term = new THREE.Mesh(new THREE.CylinderGeometry(.2, .2, .3, 12), cap); term.position.set(x, .3 + h + .2, 0); g.add(term);
    const plus = decal('+', '#2e9d5a', '#ffffff', .75); plus.position.set(x, .3 + h * .55, .56); g.add(plus);
  }
  // charge meter: 8 lights on a post, lit by how full the batteries are
  const post = new THREE.Mesh(new THREE.BoxGeometry(.5, h + .4, .35), m.dark);
  post.position.set((cells * 1.35) / 2 + .55, .3 + (h + .4) / 2, 0); g.add(post);
  const leds = [];
  for (let i = 0; i < 8; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x113322, emissive: C.bat, emissiveIntensity: 0 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(.32, (h - .2) / 9, .05), mat);
    led.position.set(post.position.x, .45 + i * (h / 8.2), .2);
    g.add(led); leds.push(mat);
  }
  g.userData.leds = leds;
  return g;
}

// Shield generator inside the dome. Higher level = taller, stronger.
// Shield generator (inside the dome): a tripod holding a glowing purple crystal with spinning energy rings.
// Higher level = taller, more rings.
const crystalMat = new THREE.MeshStandardMaterial({ color: 0xb9a8ff, emissive: 0x7c5cff, emissiveIntensity: .8, roughness: .15, metalness: .2, transparent: true, opacity: .92 });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xd9ccff, emissive: 0x8c7cff, emissiveIntensity: .6, metalness: .6, roughness: .3 });
function shieldPylon(level) {
  const m = sharedMats(), g = new THREE.Group();
  const h = 2.6 + level * .9;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, .4, 6), m.grey); base.position.y = .2; g.add(base);
  for (let i = 0; i < 3; i++) { // tripod legs leaning in
    const a = i * Math.PI * 2 / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.09, .13, h, 8), m.frame);
    leg.position.set(Math.cos(a) * .55, .4 + h / 2, Math.sin(a) * .55);
    leg.rotation.set(Math.sin(a) * .18, 0, -Math.cos(a) * .18); g.add(leg);
  }
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(.35, .45, .3, 12), m.frame); collar.position.y = h + .35; g.add(collar);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(.7, 0), crystalMat); crystal.scale.set(.8, 1.3, .8); crystal.position.y = h + 1.3; g.add(crystal);
  const rings = new THREE.Group(); rings.position.y = h + 1.3; g.add(rings);
  for (let i = 0; i < Math.min(level + 1, 3); i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1.05 + i * .28, .06, 8, 36), ringMat);
    r.rotation.set(Math.PI / 2 + i * .7, i * .9, 0); rings.add(r);
  }
  g.userData.spin = { crystal, rings };
  (parts.spinners ||= []).push(g.userData.spin);
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
      // distance to the edge of a hexagon cell (honeycomb)
      float hex(vec2 p) {
        p *= 1.15; vec2 r = vec2(1., 1.732), h = r * .5;
        vec2 a = mod(p, r) - h, b = mod(p - h, r) - h;
        vec2 g = dot(a, a) < dot(b, b) ? a : b;
        g = abs(g); return .5 - max(dot(g, normalize(vec2(1., 1.732))), g.x);
      }
      void main(){
        float rim = pow(1. - abs(dot(vN, vV)), 2.2);
        float lat = asin(clamp(vP.y / 11., 0., 1.));            // height on the dome
        vec2 uv = vec2(atan(vP.z, vP.x) * 3.5, lat * 7.);
        float edge = 1. - smoothstep(.0, .07, hex(uv));          // the lines of the honeycomb
        float scan = smoothstep(.25, 0., abs(fract(lat * .32 - time * .18) - .5));  // a band that sweeps up
        float ripple = hit * (.5 + .5 * sin(lat * 40. - time * 30.));
        vec3 col = mix(color, vec3(.75, .95, 1.), rim * .6 + scan * .3);
        float a = power * (.06 + rim * .75 + edge * .32 + scan * .18) + hit * (rim + .25 + ripple * .4);
        gl_FragColor = vec4(col * (1. + hit * .8), clamp(a, 0., 1.) * .85); }`,
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

// Thin smoke rising from the damaged ship.
function makeSmoke() {
  const n = 120, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  // soft grey puffs rising from the damaged ship (not squares)
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8a8a8a, size: 4, map: softDot(), transparent: true, opacity: .32, depthWrite: false }));
  p.userData.seeds = Array.from({ length: n }, () => [Math.random(), (Math.random() - .5) * 2, (Math.random() - .5) * 2]);
  p.position.set(-26, 0, 14);
  return p;
}

// A soft round dot (white in the middle, fading to nothing) so particles look like glows and puffs, not squares.
let dotTex = null;
function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return (dotTex = new THREE.CanvasTexture(c));
}

// Dust thrown up by a landing or a crash: soft clouds that grow and fade.
function makeDust() {
  const n = 220, geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xc9c2b4, size: 2.4, map: softDot(), transparent: true, opacity: .7, depthWrite: false }));
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
    parts.lm.position.y = groundY(-26, 14);
    parts.lm.add(makeFlame());
    base.add(parts.lm);
  });
  load('perseverance').then(rover => { // NASA's Perseverance rover, only on Mars
    if (!rover) return;
    parts.perse = placeModel(rover, 2.2, ROVER_HOME.x, ROVER_HOME.z, 2.4);
    parts.perse.position.y = groundY(ROVER_HOME.x, ROVER_HOME.z);
    parts.perse.userData.forward = PERSE_FORWARD;
    parts.perse.userData.sign = brokenSign(); parts.perse.add(parts.perse.userData.sign);
    { const h = new THREE.Group(); h.rotation.y = PERSE_FORWARD; parts.perse.add(h); headlights(h, 1.7, 1.2, .6); parts.perse.userData.spot = h.userData.spot; }
    parts.perse.visible = planet === 'mars';
    base.add(parts.perse);
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

// A broken piece of the ship: gold foil panel, a bent strut, and a glowing ring so kids can spot it.
function makePart(i) {
  const g = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xd8a63a, metalness: .85, roughness: .35 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: .7, roughness: .4 });
  const shapes = [
    () => new THREE.Mesh(new THREE.BoxGeometry(1.4, .5, .9), foil),
    () => new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, 1.3, 10), grey),
    () => new THREE.Mesh(new THREE.ConeGeometry(.7, 1.2, 8), grey),
    () => new THREE.Mesh(new THREE.BoxGeometry(1.1, .3, 1.1), foil),
    () => new THREE.Mesh(new THREE.TorusGeometry(.55, .15, 8, 16), grey),
  ];
  const main = shapes[i % shapes.length](); main.position.y = .4; main.rotation.set(.4 * i, i, .3); g.add(main);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.6, 6), grey);
  strut.rotation.set(1.1, i, .5); strut.position.set(.4, .5, .2); g.add(strut);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.8, 40), new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .06; g.add(ring);
  g.userData.ring = ring;
  // a much bigger invisible ball around the part, so it is easy to tap (also on a phone)
  const hit = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 8), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  hit.position.y = 1; g.add(hit);
  const el = document.createElement('div');
  el.className = 'scene-label small t-part';
  el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer';
  el.innerHTML = `<span class="i">${icon('gear')}</span>`;
  el.addEventListener('click', e => { e.stopPropagation(); if (g.visible && !g.userData.carried) debrisHandler?.(g.userData.debrisId); });
  const lab = new CSS2DObject(el); lab.position.y = 2.4; g.add(lab);
  g.userData.label = lab;
  shadow(g); hit.castShadow = hit.receiveShadow = false;
  return g;
}

// A lunar rover, a bit like the Apollo one: open frame, four wire wheels, seats, antenna dish.
function makeRover() {
  const g = new THREE.Group();
  const frame = metal(0xb9bec6, .5, .6), dark = metal(0x2f3238, .8, .3), gold = metal(0xd8a63a, .35, .85);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3, .2, 1.8), frame); deck.position.y = .75; g.add(deck);
  for (const [x, z] of [[-1.15, -1.05], [1.15, -1.05], [-1.15, 1.05], [1.15, 1.05]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, .3, 18), dark);
    w.rotation.x = Math.PI / 2; w.position.set(x, .45, z); g.add(w);
    for (const a of [0, Math.PI / 2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(.8, .32, .07), frame); sp.rotation.y = a; w.add(sp); }
    (g.userData.wheels ||= []).push(w);
    const fender = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .34, 16, 1, true, 0, Math.PI), gold);
    fender.rotation.x = Math.PI / 2; fender.rotation.z = Math.PI / 2; fender.position.set(x, .5, z); g.add(fender);
  }
  for (const z of [-.4, .4]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .55), metal(0x3b5fa8, .6, .2)); seat.position.set(-.3, 1.05, z); g.add(seat);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.3), frame); mast.position.set(1.1, 1.45, 0); g.add(mast);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), frame);
  dish.position.set(1.1, 2.1, 0); dish.rotation.z = -.6; g.add(dish);
  const box = new THREE.Mesh(new THREE.BoxGeometry(.6, .35, .9), gold); box.position.set(1.05, .98, 0); g.add(box);
  g.userData.forward = 0; // drives towards +x
  return shadow(g);
}

// A small red sign over the rover when a storm has broken it.
function brokenSign() {
  const el = document.createElement('div');
  el.className = 'scene-label small t-broken';
  el.innerHTML = `<span class="i">${icon('warning')}</span>`;
  const lab = new CSS2DObject(el); lab.position.y = 3.4; lab.visible = false;
  return lab;
}
// The rover used for the escape mode: the Apollo-style one on the Moon, Perseverance on Mars.
const curRover = () => (planet === 'mars' && parts.perse ? parts.perse : parts.lrv);
function roverStop(id) {
  const o = debrisObjs.get(id);
  if (!o) return ROVER_HOME.clone();
  const target = o.userData.target.clone();
  return target.add(new THREE.Vector3().subVectors(ROVER_HOME, target).setY(0).normalize().multiplyScalar(3));
}
function placeRover(r, pos, broken) {
  r.position.set(pos.x, groundY(pos.x, pos.z), pos.z);
  r.userData.broken = broken;
  if (r.userData.sign) r.userData.sign.visible = broken;
}

// Show the rover where the game says it is (when it is not driving).
export function setRover(rv) {
  if (!ok || parts.roverTrip) return;
  const r = curRover(); if (!r) return;
  if (!rv || rv.status === 'home') placeRover(r, ROVER_HOME, false);
  else if (rv.status === 'out') placeRover(r, roverStop(rv.target), !!rv.damaged);
  else placeRover(r, ROVER_HOME, true);
}

export const ROVER_HOME = new THREE.Vector3(-13, 0, 26);
const PERSE_FORWARD = -Math.PI / 2; // its mast and arm point to +z
const debrisObjs = new Map();

// list: [{ id, x, z, collected }] – shows the parts still lying around.
export function setDebris(list) {
  if (!ok) return;
  parts.debrisGroup.visible = !!list;
  if (!list) return;
  for (const d of list) {
    let o = debrisObjs.get(d.id);
    if (!o) { o = makePart(d.id); o.userData.debrisId = d.id; debrisObjs.set(d.id, o); parts.debrisGroup.add(o); }
    if (!o.userData.flying) o.position.set(d.x, groundY(d.x, d.z), d.z);
    o.userData.target = new THREE.Vector3(d.x, groundY(d.x, d.z), d.z);
    if (!o.userData.carried) o.visible = !d.collected;
  }
  for (const [id, o] of debrisObjs) if (!list.some(d => d.id === id)) { o.traverse(x => { if (x.isCSS2DObject) x.element.remove(); }); parts.debrisGroup.remove(o); debrisObjs.delete(id); }
  if (parts.lrv) parts.lrv.visible = planet !== 'mars';
  if (parts.perse) parts.perse.visible = planet === 'mars';
}

// The ship after a crash: tilted, with smoke. Repaired: upright again.
export function setCrashed(on) {
  if (!ok || !parts.lm) return;
  parts.crashed = on;
  if (!anim) parts.lm.rotation.set(on ? .12 : 0, .6, on ? .2 : 0);
  parts.smoke.visible = on;
}

// The rover drives out to a part and waits there (the trip takes one or two days).
export function driveRover(id, done) {
  const r = curRover();
  if (!ok || !r) { done?.(); return; }
  placeRover(r, ROVER_HOME, false);
  parts.roverTrip = { r, from: ROVER_HOME.clone(), to: roverStop(id), t: 0, speed: 6, done };
  parts.roverTrip.dur = parts.roverTrip.from.distanceTo(parts.roverTrip.to) / 6;
}
// Back to the ship: with the part loaded, or broken by a storm (slowly, without the part).
export function returnRover(id, { withPart = false, broken = false } = {}, done) {
  const r = curRover(), o = debrisObjs.get(id);
  if (!ok || !r) { done?.(); return; }
  const from = roverStop(id);
  placeRover(r, from, broken);
  if (withPart && o) o.userData.carried = true;
  const speed = broken ? 2.5 : 6;
  parts.roverTrip = { r, from, to: ROVER_HOME.clone(), t: 0, speed, dur: from.distanceTo(ROVER_HOME) / speed, carry: withPart ? o : null, broken,
    done: () => { if (withPart && o) { o.visible = false; o.userData.carried = false; o.scale.setScalar(1); } done?.(); } };
}

function makeBase() {
  const base = new THREE.Group();
  parts.base = base;
  parts.debrisGroup = new THREE.Group(); parts.debrisGroup.visible = false; base.add(parts.debrisGroup);
  parts.lrv = makeRover(); parts.lrv.position.copy(ROVER_HOME); parts.lrv.rotation.y = 2.2; parts.lrv.visible = false; base.add(parts.lrv);
  parts.lrv.userData.sign = brokenSign(); parts.lrv.add(parts.lrv.userData.sign);
  headlights(parts.lrv);
  parts.smoke = makeSmoke(); parts.smoke.visible = false; base.add(parts.smoke);
  base.add(shieldDome());
  const f = flag(); f.position.set(-21.5, 0, 19.5); f.rotation.y = .5; base.add(f);

  // Building lights for the night: the same warm light as the habitat's, moved to the buildings
  parts.bLights = [];
  for (let i = 0; i < 8; i++) {
    const l = new THREE.PointLight(0xffd8a0, 0, 16, 2); l.position.set(0, -50, 0); l.visible = false; base.add(l); parts.bLights.push(l);
  }
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
  // night lights: a lamp on top and a pool of light on the ground around the building
  nightMats();
  const lamp = new THREE.Mesh(LAMP_GEO, lampMat); lamp.position.y = box.max.y + .25; lamp.raycast = () => {}; holder.add(lamp);
  holder.userData.lightY = Math.min(4, box.max.y * .6 + 1.5);
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
  parts.spinners = [...objs.values()].map(o => o.holder.children[0]?.userData?.spin).filter(Boolean);
  // put the night lights next to the buildings (one each, as many as there are lights)
  const holders = [...objs.values()].map(o => o.holder);
  parts.bLights?.forEach((l, i) => {
    const h = holders[i];
    if (h) { l.position.set(h.position.x + 2, h.userData.lightY || 3, h.position.z + 2); l.userData.on = true; }
    else { l.position.set(0, -50, 0); l.userData.on = false; }
  });

  // Cables from every building to the habitat
  parts.cables.children.slice().forEach(c => { c.geometry.dispose(); parts.cables.remove(c); });
  for (const o of objs.values()) o.holder.visible = o.holder.userData.buildingId !== movingId;
  for (const b of list) if (b.type !== 'shield' && b.id !== movingId) parts.cables.add(cable(new THREE.Vector3(b.x, 0, b.z), new THREE.Vector3(0, 0, 0)));
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
let debrisHandler = null;
export function onPickDebris(fn) { debrisHandler = fn; }

function toNdc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
function groundPoint(e) { toNdc(e); const p = new THREE.Vector3(); return ray.ray.intersectPlane(groundPlane, p) ? p : null; }

// Ghost of the building that follows the pointer until the player taps a free spot.
let movingId = null; // building being moved: hidden from its old spot until placed or cancelled
export function startPlacing({ type, level = 1, radius, valid, done, moveId = null }) {
  stopPlacing();
  movingId = moveId;
  const old = moveId != null && objs.get(moveId);
  if (old) { old.holder.visible = false; parts.ring.visible = false; }
  const ghost = BUILDERS[type](level);
  ghost.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = .85; m.material.emissive?.setHex?.(0x224422); } });
  const foot = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), new THREE.MeshBasicMaterial({ color: 0x69f0ae, transparent: true, opacity: .55, depthWrite: false }));
  foot.rotation.x = -Math.PI / 2; foot.position.y = .12;
  const g = new THREE.Group(); g.add(ghost, foot); g.visible = false;
  parts.base.add(g);
  placing = { g, foot, valid, done, ok: false, x: 0, z: 0 };
}
export function stopPlacing() {
  if (movingId != null) { const old = objs.get(movingId); if (old) old.holder.visible = true; movingId = null; }
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
  if (parts.debrisGroup.visible) { // a ship part?
    const dh = ray.intersectObjects(parts.debrisGroup.children, true)[0];
    let d = dh?.object;
    while (d && d.userData.debrisId == null) d = d.parent;
    if (d && d.visible) { debrisHandler?.(d.userData.debrisId); return; }
  }
  const hit = ray.intersectObjects(parts.buildings.children, true)[0];
  let o = hit?.object;
  while (o && o.userData.buildingId == null) o = o.parent;
  pickHandler?.(o ? o.userData.buildingId : null);
}

export function resetView() { setMode('game', true); }

// Solar storm: streaks of radiation falling from the Sun's direction, each a glowing head with a fading trail.
function makeStormParticles() {
  const n = 700, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const heads = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffe9a8, size: 1.5, map: softDot(), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
  const col = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) { col.set([1, .85, .45], i * 6); col.set([0, 0, 0], i * 6 + 3); } // bright at the head, nothing at the tail
  tg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const tails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const p = new THREE.Group(); p.add(tails, heads);
  p.visible = false;
  p.userData = { heads, tails, seeds: Array.from({ length: n }, () => [(Math.random() - .5) * 70, Math.random() * 60, (Math.random() - .5) * 70, .7 + Math.random() * .8]) };
  return p;
}

export function initScene() {
  // Phones have very sharp screens: drawing every one of their pixels makes the game slow, so the 3D is drawn at a
  // lower resolution there (it still looks sharp), and it drops a little more by itself if the device struggles.
  const touch = matchMedia('(pointer: coarse)').matches;
  try { renderer = new THREE.WebGLRenderer({ antialias: !touch, powerPreference: 'high-performance' }); }
  catch { ok = false; return false; }
  quality.max = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 1.5);
  quality.ratio = quality.max;
  renderer.setPixelRatio(quality.ratio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // softer-edged shadows cost much more
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
  sunLight.shadow.mapSize.set(touch ? 1024 : 2048, touch ? 1024 : 2048);
  Object.assign(sunLight.shadow.camera, { left: -50, right: 50, top: 50, bottom: -50, near: 10, far: 300 });
  sunLight.shadow.bias = -.0005;
  earthLight = new THREE.DirectionalLight(0x9db8ff, .12);
  earthLight.position.set(-720, 300, -720);
  ambient = new THREE.AmbientLight(0x8890a0, .12);
  scene.add(sunLight, earthLight, ambient);

  parts.moonGround = makeTerrain();
  parts.marsGround = makeMarsTerrain(parts.moonTex);
  // the ground is "transparent" only so its far edge can fade out: draw it before every other see-through thing
  // (shield, glass, rings), or it would be painted over them and hide them
  parts.moonGround.renderOrder = parts.marsGround.renderOrder = -1;
  parts.marsGround.visible = false;
  scene.add(parts.moonGround, parts.marsGround, makeSky(), makeBase());
  parts.dust = makeDust(); scene.add(parts.dust);
  scene.fog = new THREE.Fog(0x9c6b45, 60, 5000);
  storm.points = makeStormParticles();
  scene.add(storm.points);

  setMode('menu', true);
  const el = renderer.domElement;
  window.__jamt = { camera, controls, parts, THREE, scene, storm: (s, b) => playStorm(s, b), seek: s => { if (anim) anim.t = s; }, get anim() { return anim && { kind: anim.kind, t: anim.t, T: anim.T, waiting: anim.waiting }; }, get state() { return { planet, mode, target, sun: sunLight.intensity, amb: ambient.intensity, bg: scene.background.getHexString(), sky: skyColor.getHexString() }; } }; // for testing in the browser console
  el.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  renderer.setAnimationLoop(tick);
  // Always fill the screen: phones change size when rotated or when the browser bars hide, sometimes a moment
  // after the "resize" event, so the size is checked again a little later too.
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => { resize(); setTimeout(resize, 350); setTimeout(resize, 900); });
  window.visualViewport?.addEventListener('resize', resize);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(wrap);
  resize();
  return true;
}

const quality = { max: 1.5, ratio: 1.5, frames: 0, time: 0 };
function resize() {
  const w = Math.max(1, wrap.clientWidth || window.innerWidth), h = Math.max(1, wrap.clientHeight || window.innerHeight);
  renderer.setSize(w, h, false); // the canvas is stretched by CSS to fill the screen; this sets how many pixels it draws
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
// If the device can't keep up (slower than ~35 frames a second), draw at a slightly lower resolution.
function adaptQuality(raw) {
  quality.frames++; quality.time += raw;
  if (quality.time < 2.5) return;
  const fps = quality.frames / quality.time;
  quality.frames = 0; quality.time = 0;
  if (fps < 35 && quality.ratio > .75) quality.ratio = Math.max(.75, quality.ratio - .25);
  else if (fps > 55 && quality.ratio < quality.max) quality.ratio = Math.min(quality.max, quality.ratio + .25);
  else return;
  renderer.setPixelRatio(quality.ratio);
  resize();
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
  if (parts.lm && !anim) { parts.lm.position.copy(landingSpot()); parts.lm.rotation.set(0, .6, 0); }
  if (parts.earth) parts.earth.visible = !mars;
  if (parts.perse) parts.perse.visible = mars;
  if (parts.lrv) parts.lrv.visible = !mars && parts.debrisGroup.visible;
  parts.sun.scale.setScalar(mars ? 170 : 260); // the Sun looks smaller from Mars
  // on the bright Martian ground an added-light shield is invisible: draw it as a normal see-through dome
  parts.shield.blending = mars ? THREE.NormalBlending : THREE.AdditiveBlending;
  parts.shield.uniforms.color.value.setHex(mars ? 0x6fd6ff : C.shield);
  parts.shield.needsUpdate = true;
  scene.fog.color.setHex(mars ? 0xa0704a : 0x000000);
}

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
function GAME_CAM() { return window.innerWidth < 700 ? new THREE.Vector3(34, 62, 100) : new THREE.Vector3(44, 36, 80); }

// The lander comes down from the sky onto the landing site, then the camera flies to the base view.
// times: { T1, T2, T3, T4, fly } in seconds, worked out from how long the radio lines last.
// hold(): true while the radio still has to finish before the next shot (safety for browser voices).
// Get the scene ready before a film starts: wait for the lander model and prepare the graphics for the
// current planet (so the first seconds don't stutter while the computer works that out).
export async function prepareScene() {
  if (!ok) return;
  await Promise.race([lmReady, new Promise(r => setTimeout(r, 8000))]);
  try { renderer.compile(scene, camera); } catch { /* not important */ }
  await Promise.race([new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), new Promise(r => setTimeout(r, 400))]);
}

export async function playLanding(done, onProgress, { crash = false, times = null, hold = null } = {}) {
  if (!ok) { done?.(); return; }
  await Promise.race([lmReady, new Promise(r => setTimeout(r, 6000))]); // wait for the lander model
  if (!parts.lm) { done?.(); return; }
  parts.lm.position.y = 70;
  setMode('game', true);
  controls.enabled = false;
  anim = { kind: 'landing', t: 0, done, onProgress, crash, hold, T: { T1: 15, T2: 24, T3: 29, T4: 32, fly: 3, ...times } };
  parts.smoke.visible = false;
  if (crash) for (const o of debrisObjs.values()) { o.userData.flying = true; o.visible = false; }
}

// The crew takes off and leaves the base. The camera follows the craft into the sky.
export function playLaunch(done, { length = 6.5 } = {}) {
  if (!ok || !parts.lm) { done?.(); return; }
  controls.enabled = false;
  anim = { kind: 'launch', t: 0, done, length };
  parts.astronauts?.forEach(a => { a.visible = false; }); // the crew is on board
}

// Losing: the camera slowly rises and pulls away from the base.
export function playLose(done) {
  if (!ok) { done?.(); return; }
  controls.enabled = false;
  anim = { kind: 'lose', t: 0, done, from: camera.position.clone() };
}

// Opening shot: from deep space, past the Earth, down to the Moon base where the menu is.
export function playIntro(done) {
  if (!ok) { done?.(); return; }
  setMode('menu', true);
  anim = { kind: 'intro', t: 0, done, end: camera.position.clone() };
}

export function skipAnimation() {
  if (!anim) return;
  const a = anim; anim = null;
  if (a.kind === 'lose') {
    const k = ease(Math.min(1, a.t / 5));
    const away = new THREE.Vector3().subVectors(a.from, new THREE.Vector3(-5, 0, 4)).setY(0).normalize();
    camera.position.copy(a.from).addScaledVector(away, 45 * k).add(new THREE.Vector3(0, 35 * k, 0));
    camera.position.x += (Math.random() - .5) * .5 * (1 - k); // a shake at the start
    camera.lookAt(-5, 0, 4);
    if (a.t > 5) { anim = null; controls.enabled = true; controls.update(); a.done?.(); }
    return;
  }
  if (a.kind === 'intro') { camera.position.copy(a.end); controls.update(); }
  if (a.kind === 'landing') { parts.lm.position.copy(landingSpot()); parts.lm.rotation.set(a.crash ? .12 : 0, .6, a.crash ? .2 : 0); if (a.crash) parts.smoke.visible = true;
    for (const o of debrisObjs.values()) { o.userData.flying = false; if (o.userData.target) o.position.copy(o.userData.target); } parts.flame.visible = false; if (parts.earth) { parts.earth.position.copy(EARTH_POS); parts.earth.scale.setScalar(1); } setMode('game', true); }
  a.done?.();
}

function runAnim(dt) {
  const a = anim;
  a.t += dt;
  a.waiting = false;
  const lm = parts.lm, home = a.home || (a.home = landingSpot());
  const flicker = .85 + Math.random() * .3;
  if (a.kind === 'lose') {
    const k = ease(Math.min(1, a.t / 5));
    const away = new THREE.Vector3().subVectors(a.from, new THREE.Vector3(-5, 0, 4)).setY(0).normalize();
    camera.position.copy(a.from).addScaledVector(away, 45 * k).add(new THREE.Vector3(0, 35 * k, 0));
    camera.position.x += (Math.random() - .5) * .5 * (1 - k); // a shake at the start
    camera.lookAt(-5, 0, 4);
    if (a.t > 5) { anim = null; controls.enabled = true; controls.update(); a.done?.(); }
    return;
  }
  if (a.kind === 'intro') {
    const T = 6.5, p = Math.min(1, a.t / T), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const target = new THREE.Vector3(-6, 3, 6);
    // start far away and high, with the Earth on the way, then glide down to the menu camera
    const start = new THREE.Vector3(260, 520, 900);
    const mid = new THREE.Vector3(60, 140, 260);
    const q = 1 - e;
    camera.position.set(
      q * q * start.x + 2 * q * e * mid.x + e * e * a.end.x,
      q * q * start.y + 2 * q * e * mid.y + e * e * a.end.y,
      q * q * start.z + 2 * q * e * mid.z + e * e * a.end.z);
    camera.lookAt(target.clone().lerp(EARTH_POS, .25 * (1 - e)));
    if (p >= 1) { anim = null; controls.update(); a.done?.(); }
    return;
  }
  if (a.kind === 'landing') {
    // A film in three shots. The lander flies towards the Earth's direction, so the Earth is always
    // in the background, above the curved horizon of the Moon:
    // 1) wide shot over the Moon (0–10 s)  2) closer, braking (10–17 s)
    // 3) from the ground, looking up as it touches down (17–21 s), then fly to the base view.
    const { T1, T2, T3, T4, fly } = a.T;
    // wait for the radio at the end of a shot (only needed with browser voices, whose length is a guess)
    for (const [b, ph] of [[T1, 'approach'], [T2, 'braking'], [T4 - fly, 'landed']]) {
      if (a.t >= b && a.t - dt < b && a.hold?.(ph)) { a.t = b - .0001; a.waiting = true; break; }
    }
    const up = new THREE.Vector3(0, 1, 0);
    const hz = new THREE.Vector3().subVectors(EARTH_CINE, home).setY(0).normalize(); // towards the Earth
    const perp = new THREE.Vector3().crossVectors(up, hz);
    // on Mars start closer in: the Martian ground fades out near its edge, and from out there it looked see-through
    const P0 = planet === 'mars' ? home.clone().addScaledVector(hz, -260).addScaledVector(perp, 40).setY(110)
      : home.clone().addScaledVector(hz, -650).addScaledVector(perp, 90).setY(140);
    const P1 = home.clone().addScaledVector(hz, -95).addScaledVector(perp, 12).setY(55);
    const P2 = home.clone().addScaledVector(hz, -6).setY(20);
    if (parts.earth && a.t < T3) { parts.earth.position.copy(EARTH_CINE); parts.earth.scale.setScalar(1.8); }
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
      if (a.crash) { // engine trouble: it drops fast and hits the ground hard
        lm.position.y = home.y + (P2.y - home.y) * Math.max(0, 1 - Math.pow(Math.min(1, p * 1.25), 2.2));
        const hit = Math.max(0, p * 1.25 - 1) * 5;
        lm.rotation.set(.12 * Math.min(1, hit), .6, .2 * Math.min(1, hit));
        if (p * 1.25 >= 1 && !a.crashed) { a.crashed = true; a.dusted = true; burstDust(home); parts.smoke.visible = true; a.crashT = a.t; }
        if (a.crashed) camera.position.add(new THREE.Vector3((Math.random() - .5), (Math.random() - .5), 0).multiplyScalar(Math.max(0, .8 - (a.t - a.crashT))));
      } else {
        lm.position.y = home.y + (P2.y - home.y) * Math.pow(Math.max(0, 1 - p * 1.15), 1.6);
        lm.rotation.set(0, .6, 0); // upright for touchdown
      }
      if (!a.crash && p > .86 && !a.dusted) { a.dusted = true; burstDust(home); }
      camera.position.copy(groundCam);
      camera.lookAt(new THREE.Vector3(home.x, 7, home.z).addScaledVector(hz, 20));
      phase = 'final';
    } else {
      lm.position.copy(home);
      // the camera stays on the ground, slowly moving round the ship while the crew talks, then flies up
      const k = ease((a.t - (T4 - fly)) / fly);
      const pan = Math.min(a.t - T3, T4 - fly - T3);
      groundCam.addScaledVector(perp, pan * .9).addScaledVector(hz, pan * .5);
      if (parts.earth) { parts.earth.position.lerpVectors(EARTH_CINE, EARTH_POS, k); parts.earth.scale.setScalar(1.8 - .8 * k); }
      camera.position.lerpVectors(groundCam, GAME_CAM(), k);
      camera.lookAt(new THREE.Vector3(home.x, 7, home.z).addScaledVector(hz, 20 * (1 - k)).lerp(new THREE.Vector3(-5, 0, 4), k));
      phase = 'landed';
    }
    if (a.crash && a.crashed) { // the broken parts fly out to where they will lie
      const k = Math.min(1, (a.t - a.crashT) / 1.8);
      for (const o of debrisObjs.values()) {
        if (!o.userData.target) continue;
        o.visible = true;
        o.position.lerpVectors(home, o.userData.target, k).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * 14, 0));
        if (k >= 1) o.userData.flying = false;
      }
    }
    if (a.crash && a.crashed && a.t > T3 - .4) lm.rotation.set(.12, .6, .2);
    parts.flame.visible = a.crash && a.crashed ? false : a.t < T3 - .3;
    parts.flame.scale.set(flicker, flicker * (a.t < T1 ? 1.3 : 1), flicker);
    parts.flameLight.intensity = parts.flame.visible ? 60 * flicker : 0;
    a.onProgress?.({ phase: a.crash && a.crashed ? 'crash' : phase });
    if (a.t > T4) { anim = null; if (parts.earth) { parts.earth.position.copy(EARTH_POS); parts.earth.scale.setScalar(1); } controls.target.set(-5, 0, 4); camera.position.copy(GAME_CAM()); controls.enabled = true; controls.update(); a.done?.(); }
  } else if (a.kind === 'launch') {
    const ign = 1.3, s = Math.max(0, a.t - ign);
    lm.position.y = home.y + 2.5 * s * s; // speeds up as it climbs
    parts.flame.visible = true;
    parts.flame.scale.set(flicker, flicker * (a.t < ign ? .6 : 1.4), flicker);
    parts.flameLight.intensity = 80 * flicker;
    if (a.t > ign && !a.dusted) { a.dusted = true; burstDust(home); }
    const shake = a.t < ign + 1 ? (Math.random() - .5) * .4 : 0;
    camera.position.set(home.x + 30 + shake, 8 + lm.position.y * .55, home.z + 34);
    camera.lookAt(home.x, lm.position.y + 4, home.z);
    if (a.t > a.length && !a.called) { a.called = true; a.done?.(); }
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
  if (!document.hidden) adaptQuality(Math.min(raw, 1));
  if (anim) runAnim(Math.min(raw, 1)); // real time, even after a slow frame, so the animation stays with the voices

  // Smoke from the damaged ship
  if (parts.smoke.visible) {
    const pos = parts.smoke.geometry.attributes.position;
    parts.smoke.position.copy(parts.lm ? parts.lm.position : new THREE.Vector3(-26, 0, 14));
    parts.smoke.userData.seeds.forEach(([s, dx, dz], i) => { const k = (time * .25 + s) % 1; pos.setXYZ(i, dx * (.5 + k * 2.5) + k * 3, 3 + k * 16, dz * (.5 + k * 2.5)); });
    pos.needsUpdate = true;
  }
  // Ship parts: pulsing rings so they are easy to spot
  for (const o of debrisObjs.values()) if (o.userData.ring) {
    const show = o.visible && !o.userData.flying && !o.userData.carried && parts.debrisGroup.visible;
    o.userData.ring.visible = show; o.userData.label.visible = show; // CSS labels do not hide with their parent
    o.userData.ring.material.opacity = .45 + .4 * Math.sin(time * 3 + o.userData.debrisId);
  }
  for (const r of [parts.lrv, parts.perse]) if (r?.userData.sign) r.userData.sign.visible = !!r.userData.broken && r.visible;
  // Rover trip: out to the part, pick it up, back to the ship
  const trip = parts.roverTrip;
  if (trip) {
    const r = trip.r, step = Math.min(raw, .25);
    // first turn on the spot to face the way, then drive (slowing down at the end)
    const dir = new THREE.Vector3().subVectors(trip.to, trip.from).setY(0);
    const want = Math.atan2(-dir.z, dir.x) - (r.userData.forward || 0);
    let diff = ((want - r.rotation.y + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    r.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), step * 2.2);
    const turning = Math.abs(diff) > .05;
    if (!turning) trip.t += step;
    const p = Math.min(1, trip.t / trip.dur), e = p < .85 ? p / .85 * .9 : .9 + ease((p - .85) / .15) * .1;
    r.position.lerpVectors(trip.from, trip.to, Math.min(1, e));
    const bump = trip.broken ? Math.abs(Math.sin(trip.t * 5)) * .25 : Math.abs(Math.sin(trip.t * 9)) * .05;
    r.position.y = groundY(r.position.x, r.position.z) + bump;
    r.rotation.z = trip.broken ? .12 + Math.sin(trip.t * 5) * .06 : 0;
    for (const w of r.userData.wheels || []) w.rotation.y -= (turning ? 1.5 : trip.speed / .45) * step;
    if (trip.carry) { trip.carry.position.copy(r.position).add(new THREE.Vector3(0, 1.4, 0)); trip.carry.scale.setScalar(.6); }
    if (p >= 1) { parts.roverTrip = null; trip.done?.(); }
  }

  // Dust thrown up by the rocket
  if (parts.dust.visible) {
    const d = parts.dust; d.userData.t += dt;
    const t = d.userData.t, pos = d.geometry.attributes.position;
    const out = 1 - Math.pow(1 - Math.min(1, t / 2.4), 2); // fast at first, then slowing down
    d.userData.dirs.forEach(([x, z, sp, h], i) => pos.setXYZ(i, x * out * 20 * sp, .4 + h * out * 4 * (1.3 - out * .6), z * out * 20 * sp));
    pos.needsUpdate = true;
    d.material.size = 2.2 + t * 3.2;              // the puffs grow as they spread
    d.material.opacity = Math.max(0, .7 * (1 - t / 2.4));
    if (t > 2.4) d.visible = false;
  }

  // Sky: black on the Moon; butterscotch in the Martian day (dust in the air), dark at night
  const marsDay = planet === 'mars' && !night;
  skyColor.lerp(marsDay ? MARS_SKY : BLACK, k);
  parts.starsMat.opacity = lerp(parts.starsMat.opacity, marsDay ? 0 : 1, k);
  scene.fog.far = lerp(scene.fog.far, target.dust ? 160 : planet === 'mars' ? 1400 : 5000, k * .5);
  scene.fog.near = target.dust ? 20 : 60;

  sunLight.intensity = lerp(sunLight.intensity, night ? 0 : 3.2, k);
  // Mars: its dusty air spreads sunlight around, so shadows are softer and everything is easier to see
  ambient.intensity = lerp(ambient.intensity, night ? .1 : planet === 'mars' ? .55 : .12, k);
  earthLight.intensity = lerp(earthLight.intensity, night ? .35 : .12, k);
  parts.sun.material.opacity = lerp(parts.sun.material.opacity, night ? 0 : 1, k);
  parts.lights.forEach(l => { l.intensity = lerp(l.intensity, night ? 40 : 0, k); });
  if (lampMat) lampMat.emissiveIntensity = lerp(lampMat.emissiveIntensity, night ? 3 : 0, k);
  parts.bLights?.forEach(l => { l.intensity = lerp(l.intensity, night && l.userData.on ? 40 : 0, k); l.visible = l.intensity > .5; });
  parts.lights.forEach(l => { l.visible = l.intensity > .5; });
  for (const r of [parts.lrv, parts.perse]) if (r?.userData.spot) r.userData.spot.intensity = lerp(r.userData.spot.intensity, night ? 120 : 0, k);
  if (mats.cells) mats.cells.emissiveIntensity = lerp(mats.cells.emissiveIntensity, night ? 0 : .25, k);
  if (parts.globe) parts.globe.rotation.y += dt * .01;
  if (parts.spinners) for (const s of parts.spinners) { s.crystal.rotation.y += dt * .8; s.rings.rotation.y += dt * 1.2; s.rings.rotation.x = Math.sin(time * .7) * .3; }
  crystalMat.emissiveIntensity = .7 + .35 * Math.sin(time * 3) + (target.shield > 0 ? .8 : 0);

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
    const p = storm.points, { heads, tails } = p.userData;
    const pos = heads.geometry.attributes.position, tp = tails.geometry.attributes.position;
    const count = Math.min(p.userData.seeds.length, storm.strength * 140);
    p.visible = true; heads.geometry.setDrawRange(0, count); tails.geometry.setDrawRange(0, count * 2);
    const fade = Math.min(1, storm.t * 3, (3 - storm.t) * 2); // fades in and out
    heads.material.opacity = fade; heads.material.color.setRGB(1 * fade, .91 * fade, .66 * fade);
    for (let i = 0; i < count; i++) {
      const [x, y0, z, sp] = p.userData.seeds[i];
      let y = 55 - ((y0 + storm.t * 40 * sp) % 60);
      const px = x + (55 - y) * SUN_DIR.x * -.6, pz = z + (55 - y) * SUN_DIR.z * -.6;
      const r = Math.hypot(px, pz);
      let len = 5 * sp;                                   // trail length
      if (storm.blocked > 0 && r < 11.5 && i % storm.strength < storm.blocked) {
        const surf = Math.sqrt(Math.max(0, 121 - r * r));  // stopped by the shield dome: the streak shrinks into it
        if (y < surf) { len = Math.max(0, len - (surf - y)); y = surf; }
      }
      pos.setXYZ(i, px, y, pz);
      tp.setXYZ(i * 2, px, y, pz);
      tp.setXYZ(i * 2 + 1, px - SUN_DIR.x * -.6 * len, y + len, pz - SUN_DIR.z * -.6 * len);
    }
    pos.needsUpdate = true; tp.needsUpdate = true;
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
  if (parts.lm) { parts.lm.position.copy(landingSpot()); parts.lm.rotation.set(0, .6, 0); }
  if (parts.flame) parts.flame.visible = false;
  if (controls) controls.enabled = mode === 'game';
}
