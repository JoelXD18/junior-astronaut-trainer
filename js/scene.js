// 3D view of the Moon base, seen from above. It mirrors the player's choices live:
// solar panels (energy), oxygen machine, battery and the radiation shield dome.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const COLORS = { o2: 0x4fc3f7, shield: 0xb388ff, bat: 0x69f0ae, sun: 0xffcc33, danger: 0xff6b6b };

let renderer, labelRenderer, scene, camera, controls, wrap;
let sunLight, ambient, hemi;
const parts = {};
const storm = { active: false, t: 0, strength: 0, blocked: 0, particles: null };
let target = { night: false, oxygen: 0, shield: 0, battery: 0, batteryMax: 1, tank: 0, tankMax: 1 };
let ok = true;
const clock = new THREE.Clock();

function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function makeGround() {
  const geo = new THREE.PlaneGeometry(80, 80, 120, 120);
  geo.rotateX(-Math.PI / 2);
  const rnd = seeded(7);
  const craters = Array.from({ length: 40 }, () => ({
    x: (rnd() - .5) * 70, z: (rnd() - .5) * 70, r: 1 + rnd() * 4, d: .3 + rnd() * .8,
  })).filter(c => Math.hypot(c.x, c.z) > 9); // keep the base area flat
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let y = Math.sin(x * .25) * Math.cos(z * .2) * .25 + Math.sin(x * .9 + z * .7) * .06;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1) y -= c.d * (1 - d * d);
      else if (d < 1.4) y += c.d * .35 * (1 - (d - 1) / .4);
    }
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9a9f, roughness: 1, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function makeStars() {
  const g = new THREE.BufferGeometry();
  const n = 800, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(150);
    v.y = Math.abs(v.y) + 10;
    arr.set([v.x, v.y, v.z], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: .6 }));
}

function label(text, cls) {
  const el = document.createElement('div');
  el.className = 'scene-label ' + (cls || '');
  el.textContent = text;
  return new CSS2DObject(el);
}

function std(color, extra = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .6, metalness: .2, ...extra }); }

function cast(m) { m.castShadow = true; m.receiveShadow = true; return m; }

// Simple US flag drawn in code (13 stripes and a blue corner with stars).
function usFlagTexture() {
  const c = document.createElement('canvas');
  c.width = 190; c.height = 100;
  const g = c.getContext('2d');
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#b22234'; g.fillRect(0, i * 100 / 13, 190, 100 / 13 + 1); }
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, 76, 54);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++) for (let col = 0; col < (r % 2 ? 5 : 6); col++) {
    g.beginPath(); g.arc(6 + col * 12.6 + (r % 2 ? 6.3 : 0), 4 + r * 5.8, 1.6, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBase() {
  const base = new THREE.Group();

  // Habitat: where the crew lives
  const hab = new THREE.Group();
  hab.add(cast(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 1.6, 32), std(0xf2f2f2))));
  const dome = cast(new THREE.Mesh(new THREE.SphereGeometry(2.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), std(0xe8e8e8)));
  dome.position.y = .8; hab.add(dome);
  const windows = new THREE.Mesh(new THREE.TorusGeometry(2.25, .12, 8, 32), std(0x223355, { emissive: 0xffd27a, emissiveIntensity: .2 }));
  windows.rotation.x = Math.PI / 2; windows.position.y = .3; hab.add(windows);
  hab.position.set(0, .8, 0);
  base.add(hab);
  parts.windows = windows;

  // Shield dome around the habitat
  const shieldMat = new THREE.MeshStandardMaterial({ color: COLORS.shield, transparent: true, opacity: 0, emissive: COLORS.shield, emissiveIntensity: .6, side: THREE.DoubleSide, depthWrite: false });
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), shieldMat);
  base.add(shield);
  parts.shield = shield;

  // Solar panels
  const panels = new THREE.Group();
  const panelMat = std(0x1d3b8f, { emissive: 0x2244aa, emissiveIntensity: .25, metalness: .6, roughness: .3 });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Group();
    const post = cast(new THREE.Mesh(new THREE.CylinderGeometry(.08, .08, 1.2), std(0x888888)));
    post.position.y = .6; p.add(post);
    const board = cast(new THREE.Mesh(new THREE.BoxGeometry(2.2, .08, 1.3), panelMat));
    board.position.y = 1.25; board.rotation.x = -.5; p.add(board);
    p.position.set(-9 + (i % 2) * 2.8, 0, -3 + Math.floor(i / 2) * 2.4);
    panels.add(p);
  }
  base.add(panels);
  parts.panelMat = panelMat;
  const sunLabel = label('☀️'); sunLabel.position.set(-7.6, 3, -1.8); base.add(sunLabel);

  // Oxygen machine: tanks that glow blue when powered
  const o2 = new THREE.Group();
  const o2Mat = std(0xdddddd, { emissive: COLORS.o2, emissiveIntensity: 0 });
  for (let i = 0; i < 3; i++) {
    const tank = cast(new THREE.Mesh(new THREE.CapsuleGeometry(.45, 1.1, 6, 16), o2Mat));
    tank.position.set(i * 1.1, 1, 0); o2.add(tank);
  }
  o2.position.set(6.5, 0, -2.5);
  base.add(o2);
  parts.o2Mat = o2Mat;
  const o2Label = label('💨'); o2Label.position.set(7.6, 2.8, -2.5); base.add(o2Label);

  // Battery: a box with a green level inside
  const bat = new THREE.Group();
  const shell = cast(new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 1.4), std(0x444a55, { transparent: true, opacity: .55 })));
  shell.position.y = .8; bat.add(shell);
  const fill = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.2), std(COLORS.bat, { emissive: COLORS.bat, emissiveIntensity: .5 }));
  fill.geometry.translate(0, .7, 0);
  fill.position.y = .1; bat.add(fill);
  bat.position.set(6.5, 0, 3);
  base.add(bat);
  parts.batFill = fill;
  const batLabel = label('🔋'); batLabel.position.set(6.5, 2.6, 3); base.add(batLabel);

  // Cables from the panels to the base
  const cableMat = new THREE.LineBasicMaterial({ color: 0x333333 });
  for (const [x, z] of [[-6, -1.8], [6.5, -2.5], [6.5, 3]]) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, .05, z), new THREE.Vector3(0, .05, 0)]);
    base.add(new THREE.Line(g, cableMat));
  }

  // Two little astronauts walking around
  parts.astronauts = [0, 1].map(i => {
    const a = new THREE.Group();
    const body = cast(new THREE.Mesh(new THREE.CapsuleGeometry(.22, .4, 4, 8), std(0xffffff)));
    body.position.y = .45; a.add(body);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(.15, 12, 8), std(0xffb300, { metalness: .9, roughness: .1 }));
    visor.position.set(0, .72, .12); a.add(visor);
    a.userData.phase = i * Math.PI;
    base.add(a);
    return a;
  });

  // Flag next to the habitat
  const flag = new THREE.Group();
  const pole = cast(new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 2.2), std(0xcccccc)));
  pole.position.y = 1.1; flag.add(pole);
  const cloth = cast(new THREE.Mesh(new THREE.PlaneGeometry(.9, .55), std(0xffffff, { side: THREE.DoubleSide, map: usFlagTexture() })));
  cloth.position.set(.45, 1.9, 0); flag.add(cloth);
  flag.position.set(-2.8, 0, 3.2);
  base.add(flag);

  return base;
}

function makeStormParticles() {
  const n = 600;
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = new THREE.PointsMaterial({ color: COLORS.sun, size: .35, transparent: true, opacity: .9 });
  const p = new THREE.Points(g, m);
  p.visible = false;
  p.userData.seeds = Array.from({ length: n }, () => [(Math.random() - .5) * 30, Math.random() * 30, (Math.random() - .5) * 30, .6 + Math.random()]);
  return p;
}

export function initScene() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    ok = false;
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  wrap = document.createElement('div');
  wrap.className = 'scene-wrap';
  wrap.appendChild(renderer.domElement);
  labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'scene-labels';
  wrap.appendChild(labelRenderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  camera = new THREE.PerspectiveCamera(45, 1, .1, 500);
  camera.position.set(7, 13, 12);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 9;
  controls.maxDistance = 45;
  controls.maxPolarAngle = Math.PI * .42; // always look from above
  controls.autoRotate = true;
  controls.autoRotateSpeed = .4;

  ambient = new THREE.AmbientLight(0xffffff, .25);
  hemi = new THREE.HemisphereLight(0xbcd0ff, 0x222222, .3);
  sunLight = new THREE.DirectionalLight(0xfff3d6, 2.2);
  sunLight.position.set(-20, 30, 10);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunLight.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
  scene.add(ambient, hemi, sunLight);

  scene.add(makeGround(), makeStars(), makeBase());
  storm.particles = makeStormParticles();
  scene.add(storm.particles);

  renderer.setAnimationLoop(tick);
  new ResizeObserver(resize).observe(wrap);
  return true;
}

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Put the 3D view inside an element of the page (the page is re-drawn often, the view is kept).
export function mountScene(slot) {
  if (!ok || !slot) return;
  slot.appendChild(wrap);
  resize();
}

export function updateScene(s) { target = { ...target, ...s }; }

export function playStorm(strength, blocked) {
  storm.active = true; storm.t = 0; storm.strength = strength; storm.blocked = blocked;
}

const lerp = (a, b, k) => a + (b - a) * k;

function tick() {
  const dt = Math.min(clock.getDelta(), .05);
  const time = clock.elapsedTime;
  const k = 1 - Math.pow(.02, dt);

  // Day / night light
  sunLight.intensity = lerp(sunLight.intensity, target.night ? 0 : 2.2, k);
  ambient.intensity = lerp(ambient.intensity, target.night ? .12 : .25, k);
  hemi.intensity = lerp(hemi.intensity, target.night ? .15 : .3, k);
  parts.panelMat.emissiveIntensity = lerp(parts.panelMat.emissiveIntensity, target.night ? 0 : .35, k);
  parts.windows.material.emissiveIntensity = lerp(parts.windows.material.emissiveIntensity, target.night ? 1.4 : .2, k);

  // Shield: stronger shield = more visible dome
  const sh = Math.min(target.shield / 5, 1);
  const pulse = storm.active ? .15 * Math.sin(time * 20) : 0;
  parts.shield.material.opacity = lerp(parts.shield.material.opacity, sh * .45 + (sh > 0 ? .08 : 0) + pulse * sh, k);
  parts.shield.scale.setScalar(.9 + sh * .1);

  // Oxygen machine glows with the energy you give it
  parts.o2Mat.emissiveIntensity = lerp(parts.o2Mat.emissiveIntensity, Math.min(target.oxygen / 4, 1) * (1 + .3 * Math.sin(time * 4)), k);

  // Battery level
  const lvl = Math.max(.02, target.battery / target.batteryMax);
  parts.batFill.scale.y = lerp(parts.batFill.scale.y, lvl, k);

  // Astronauts walk between the habitat and the machines
  parts.astronauts.forEach((a, i) => {
    const t = time * .25 + a.userData.phase;
    const r = 3.4 + Math.sin(t * 1.3) * .4;
    a.position.set(Math.cos(t) * r, .02, Math.sin(t) * r);
    a.rotation.y = -t + (i ? 0 : Math.PI);
    a.position.y = Math.abs(Math.sin(time * 5 + i)) * .12; // low-gravity hop
  });

  // Solar storm: particles rain down on the base; red flash if the shield was not enough
  if (storm.active) {
    storm.t += dt;
    const p = storm.particles;
    p.visible = true;
    const pos = p.geometry.attributes.position;
    const count = Math.min(p.userData.seeds.length, storm.strength * 120);
    p.geometry.setDrawRange(0, count);
    for (let i = 0; i < count; i++) {
      const [x, y0, z, sp] = p.userData.seeds[i];
      let y = 25 - ((y0 + storm.t * 25 * sp) % 30);
      const r = Math.hypot(x, z);
      const blockedHere = storm.blocked > 0 && r < 4.6 && y < 4.4 && i % storm.strength < storm.blocked;
      if (blockedHere) y = 4.4;
      pos.setXYZ(i, x * .6 - storm.t * 2, y, z * .6);
    }
    pos.needsUpdate = true;
    const hurt = storm.blocked < storm.strength;
    scene.background.setHex(hurt && Math.sin(storm.t * 12) > .6 ? 0x2a0508 : 0x02030a);
    if (storm.t > 3) { storm.active = false; p.visible = false; scene.background.setHex(0x02030a); }
  }

  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
