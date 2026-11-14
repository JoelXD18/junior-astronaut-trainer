// Game rules. Pure logic, no DOM: easy to test and to balance.
import { flareStrength } from './spaceweather-core.js';

export const MAPS = {
  moon: {
    id: 'moon',
    missionDays: 14,      // survival mode: survive this many days
    cycle: 14,            // a lunar day + night (repeats in infinite mode)
    nightStart: 8,        // days 8..14 of each cycle are lunar night (shortened for the game)
    sunFactor: 1,
    warnFactor: 1,
    oxygenUse: 3,         // oxygen the crew breathes each day
    oxygenStart: 9,
    batteryStart: 4,
    baseDose: 2,          // background radiation every day (% of the safe limit)
    baseEnergy: 1,        // small panels on the habitat roof
    baseOxygenMax: 8,     // tank inside the habitat
    // Buildings at the start (x, z in meters around the habitat)
    start: [
      ['solar', -20, -10], ['solar', -15, -16], ['solar', -24, -3],
      ['oxygen', 18, -8], ['tank', 24, -1],
      ['battery', 17, 9], ['battery', 22, 15],
      ['shield', 7, 5],
    ],
  },
  // Mars: a day (sol) and night every turn, so no long night. But Mars gets less than half the sunlight
  // the Moon gets, dust storms cover the solar panels, and messages from Earth take 4 to 24 minutes,
  // so storm warnings arrive less often. Its thin air blocks part of the radiation:
  // Curiosity measured about 6.1 µGy/h on the surface vs 16.5 µGy/h near the Moon (NASA RadLab).
  mars: {
    id: 'mars',
    missionDays: 16,
    cycle: 0,             // no long night
    nightStart: 0,
    sunFactor: .6,
    warnFactor: .7,
    dustChance: .12,      // chance per sol that a dust storm starts
    dustSols: [2, 4],     // how long it lasts
    dustCut: .5,          // solar power left during a dust storm
    oxygenUse: 3,
    oxygenStart: 9,
    batteryStart: 6,
    baseDose: 1,
    baseEnergy: 1,
    baseOxygenMax: 8,
    start: [
      ['solar', -20, -10], ['solar', -15, -16], ['solar', -24, -3], ['solar', -27, -12],
      ['oxygen', 18, -8], ['tank', 24, -1],
      ['battery', 17, 9], ['battery', 22, 15],
      ['shield', 7, 5],
    ],
  },
};
// escape: the ship crashes; collect its scattered parts with the rover, repair it and take off
// survival: keep the crew safe for missionDays days
// infinite: last as many days as you can (local record)
export const MODES = ['escape', 'survival', 'infinite'];
export const ESCAPE = {
  parts: 5,            // pieces of the ship to bring back
  roverBase: 0,        // energy to start the rover…
  roverPerMeters: 30,  // …plus 1 energy for every 30 m of distance (there and back)
  suitOxygen: 1,       // oxygen for the driver's suit on each trip
  farTrip: 40,         // parts further than this (metres) take 2 days to bring back; nearer ones take 1 day
  roverRepair: 3,      // energy to fix the rover after a storm breaks it
  breakStorm: 2,       // a storm this strong (or more) breaks the rover if it is outside
  outsideDose: 3,      // extra radiation per storm point for a crew caught outside (no shield there!)
  repairCost: 6,       // energy to repair the ship once every part is back
  startBattery: 20,    // the ship's batteries survived the crash
  landing: [-26, 14],  // where the ship came down
  days: { moon: 21, mars: 18 }, // the crew's food lasts this long: repair the ship before it runs out
};

// Buildings. Everything is paid with energy, so building today means less energy for oxygen,
// shield or the battery: a real trade-off.
//   cost: energy to build a new one (null = can't build more of this kind)
//   upgrade: energy to go to level 2 and level 3
export const BUILDINGS = {
  solar:   { cost: 6, upgrade: [5, 7], max: 6, radius: 3.2, movable: true },
  battery: { cost: 4, upgrade: [3, 5], max: 4, radius: 3.6, movable: true },
  tank:    { cost: 3, upgrade: [3, 4], max: 4, radius: 3.0, movable: true },
  oxygen:  { cost: null, upgrade: [6, 8], max: 1, radius: 5.0, movable: true },
  shield:  { cost: null, upgrade: [6, 9], max: 1, radius: 1.5, movable: false },
};
export const MAX_LEVEL = 3;
export const BASE_RADIUS = 48;              // you can build up to this distance from the habitat
const KEEP_OUT = [[0, 0, 12], [-26, 14, 7]]; // habitat + shield dome, landing site

// What each building gives, by level
export const solarEnergy = level => level + 1;        // 2, 3, 4 energy per sunny day
export const batteryCap = level => 5 + level * 5;     // 10, 15, 20 storage
export const tankCap = level => 4 + level * 4;        // 8, 12, 16 oxygen storage
export const oxygenBonus = level => level - 1;        // free oxygen per day when the machine is on
export const shieldBonus = level => level - 1;        // extra storm points blocked when the shield is on

export const DIFFICULTY = {
  easy:   { stormChance: 0.15, warnChance: 0.9, falseAlarm: 0.05, maxStrength: 3 },
  normal: { stormChance: 0.25, warnChance: 0.75, falseAlarm: 0.1, maxStrength: 4 },
  hard:   { stormChance: 0.35, warnChance: 0.6, falseAlarm: 0.15, maxStrength: 5 },
};

export const DOSE_PER_STORM_POINT = 10; // % of the safe limit per unblocked storm point
export const DOSE_LIMIT = 100;

// Small seeded random generator so a game can be saved and replayed.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function isNight(map, day) {
  if (!map.cycle) return false;
  return ((day - 1) % map.cycle) + 1 >= map.nightStart;
}

const ofType = (state, type) => state.buildings.filter(b => b.type === type);
const levelOf = (state, type) => (ofType(state, type)[0] || { level: 1 }).level;

export function sunEnergy(state) {
  const map = MAPS[state.map];
  // A tower built today starts working tomorrow.
  const panels = ofType(state, 'solar').filter(b => b.builtDay !== state.day).reduce((s, b) => s + solarEnergy(b.level), 0);
  return map.baseEnergy + Math.round(panels * map.sunFactor);
}
export function energyToday(state) {
  const map = MAPS[state.map];
  if (isNight(map, state.day)) return 0;
  const e = sunEnergy(state);
  return state.dust > 0 ? Math.floor(e * map.dustCut) : e;
}
export function batteryMax(state) {
  return ofType(state, 'battery').reduce((s, b) => s + batteryCap(b.level), 0);
}
export function oxygenMax(state) {
  return MAPS[state.map].baseOxygenMax + ofType(state, 'tank').reduce((s, b) => s + tankCap(b.level), 0);
}
export function oxygenLevel(state) { return levelOf(state, 'oxygen'); }
export function shieldLevel(state) { return levelOf(state, 'shield'); }

// Energy the player can still share out today (after paying for any building work).
export function available(state) {
  return energyToday(state) + state.battery - state.spent;
}

// Storms in the game are REAL solar flares recorded by NASA (DONKI), picked at random from the
// pool. How often they come depends on the difficulty and on how active the real Sun is this week.
function rollWeather(state, rng) {
  const diff = DIFFICULTY[state.difficulty];
  const pool = state.pool || [];
  const storm = rng() < Math.min(.6, diff.stormChance * (state.activity || 1));
  let strength = 0, flare = null;
  if (storm) {
    if (pool.length) {
      flare = pool[Math.floor(rng() * pool.length)];
      if (state.difficulty === 'hard') { // hard: the stronger of two real flares
        const other = pool[Math.floor(rng() * pool.length)];
        if (flareStrength(other.cls) > flareStrength(flare.cls)) flare = other;
      }
      strength = Math.min(diff.maxStrength, Math.max(1, flareStrength(flare.cls)));
    } else {
      strength = 1 + Math.floor(rng() * diff.maxStrength); // no data at all: invented storm
    }
  }
  const map = MAPS[state.map];
  const warned = storm ? rng() < diff.warnChance * map.warnFactor : rng() < diff.falseAlarm;
  // The warning tells the flare class letter (C, M or X), like real space-weather alerts.
  let hint = null;
  if (warned) hint = flare ? flare.cls[0] : pool.length ? pool[Math.floor(rng() * pool.length)].cls[0] : 'C';
  return { strength, warned, flare, hint };
}

// flares: real NASA flares to use as storms; activity: 0.8 (quiet Sun) .. 1.3 (very active Sun)
export function newGame({ map = 'moon', difficulty = 'normal', mode = 'survival', seed = Date.now(), flares = [], activity = 1 } = {}) {
  const m = MAPS[map];
  const state = {
    map, difficulty, mode, seed, rngCalls: 0,
    dust: 0,           // sols of dust storm left (Mars)
    day: 1,
    oxygen: m.oxygenStart,
    battery: m.batteryStart,
    spent: 0,          // energy spent on buildings today
    dose: 0,
    nextId: 1,
    buildings: [],
    today: null,       // weather that will hit today (hidden from the player)
    status: 'playing', // playing | won | lost-oxygen | lost-dose | lost-time (escape: not repaired in time)
    history: [],
    pool: flares.map(f => ({ t: f.t, cls: f.cls, link: f.link })),
    activity,
  };
  for (const [type, x, z] of m.start) state.buildings.push({ id: state.nextId++, type, level: 1, x, z });
  const rng = rngFor(state);
  state.today = rollWeather(state, rng);
  if (mode === 'escape') { scatterDebris(state, rng); state.battery = Math.min(batteryMax(state), ESCAPE.startBattery); }
  return state;
}

// ---------- escape mode ----------

// When the ship crashes, its broken parts land all around the base, some near and some far.
function scatterDebris(state, rng) {
  state.debris = [];
  state.rover = { status: 'home', target: null, daysLeft: 0 }; // home | out | broken
  const [lx, lz] = ESCAPE.landing;
  let tries = 0;
  while (state.debris.length < ESCAPE.parts && tries++ < 500) {
    const ang = rng() * Math.PI * 2, dist = 22 + Math.pow(rng(), .8) * 26 + state.debris.length * 3;
    const x = lx + Math.cos(ang) * dist, z = lz + Math.sin(ang) * dist;
    if (Math.hypot(x, z) > 70 || Math.hypot(x, z) < 16) continue;
    if (state.buildings.some(b => Math.hypot(b.x - x, b.z - z) < BUILDINGS[b.type].radius + 3)) continue;
    if (state.debris.some(d => Math.hypot(d.x - x, d.z - z) < 9)) continue;
    state.debris.push({ id: state.debris.length + 1, x: Math.round(x * 2) / 2, z: Math.round(z * 2) / 2, collected: false });
  }
}

export function partsCollected(state) { return (state.debris || []).filter(d => d.collected).length; }
export function partsNeeded() { return ESCAPE.parts; }

const tripDist = d => Math.hypot(d.x - ESCAPE.landing[0], d.z - ESCAPE.landing[1]);
// Days the rover needs to bring a part back (it is outside the base all that time).
export function roverDays(d) { return tripDist(d) > ESCAPE.farTrip ? 2 : 1; }
// Last day to repair the ship in escape mode (the crew's food runs out after it).
export function escapeDeadline(state) { return ESCAPE.days[state.map]; }

// Energy for a rover trip from the base to a part and back.
export function roverCost(d) {
  const dist = Math.hypot(d.x - ESCAPE.landing[0], d.z - ESCAPE.landing[1]);
  return ESCAPE.roverBase + Math.ceil((dist * 2) / ESCAPE.roverPerMeters);
}

// Why the rover can't go for this part now (or null).
export function roverProblem(state, d, budget = available(state)) {
  if (d.collected) return 'collected';
  if (state.rover.status === 'out') return 'roverBusy';
  if (state.rover.status === 'broken') return 'roverBroken';
  if (state.oxygen < ESCAPE.suitOxygen + 1) return 'noOxygen';
  if (budget < roverCost(d)) return 'noEnergy';
  return null;
}

// Send the rover: pays energy now (like building). It comes back with the part at the end of the last day
// of the trip; every day outside the driver uses suit oxygen and has no shield against storms.
export function sendRover(state, id, budget) {
  const d = state.debris.find(x => x.id === id);
  if (!d || roverProblem(state, d, budget)) throw new Error('Rover cannot go');
  state.spent += roverCost(d);
  state.oxygen -= ESCAPE.suitOxygen;
  state.rover = { status: 'out', target: id, daysLeft: roverDays(d) };
  return d;
}

export function roverRepairProblem(state, budget = available(state)) {
  if (state.rover?.status !== 'broken') return 'notBroken';
  if (budget < ESCAPE.roverRepair) return 'noEnergy';
  return null;
}
export function repairRover(state, budget) {
  if (roverRepairProblem(state, budget)) throw new Error('Cannot repair rover');
  state.spent += ESCAPE.roverRepair;
  state.rover = { status: 'home', target: null, daysLeft: 0 };
}

export function canRepair(state, budget = available(state)) {
  return state.mode === 'escape' && partsCollected(state) >= ESCAPE.parts && budget >= ESCAPE.repairCost;
}

// Fix the ship and take off: you win!
export function repairAndLaunch(state, budget) {
  if (!canRepair(state, budget)) throw new Error('Cannot repair');
  state.spent += ESCAPE.repairCost;
  state.status = 'won';
  state.repaired = true;
}

// Re-creates the generator at the right point, so saved games continue the same way.
function rngFor(state) {
  const raw = makeRng(state.seed);
  for (let i = 0; i < state.rngCalls; i++) raw();
  return () => { state.rngCalls++; return raw(); };
}

// What the player sees about today's space weather.
export function forecast(state) {
  return { warned: state.today.warned, hint: state.today.hint };
}

// ---------- building ----------

// Is (x, z) a free place for this kind of building?
export function validSpot(state, type, x, z, ignoreId = null) {
  const r = BUILDINGS[type].radius;
  if (Math.hypot(x, z) > BASE_RADIUS) return false;
  for (const [kx, kz, kr] of KEEP_OUT) if (type !== 'shield' && Math.hypot(x - kx, z - kz) < kr + r) return false;
  for (const b of state.buildings) {
    if (b.id === ignoreId) continue;
    if (Math.hypot(x - b.x, z - b.z) < r + BUILDINGS[b.type].radius + .5) return false;
  }
  return true;
}

// Why a building can't be built right now (or null if it can).
export function buildProblem(state, type, budget = available(state)) {
  const info = BUILDINGS[type];
  if (info.cost == null) return 'notBuildable';
  if (ofType(state, type).length >= info.max) return 'maxReached';
  if (budget < info.cost) return 'noEnergy';
  return null;
}

export function build(state, type, x, z, budget) {
  if (buildProblem(state, type, budget)) throw new Error('Cannot build');
  if (!validSpot(state, type, x, z)) throw new Error('Bad spot');
  state.spent += BUILDINGS[type].cost;
  const b = { id: state.nextId++, type, level: 1, x, z, builtDay: state.day };
  state.buildings.push(b);
  return b;
}

export function upgradeCost(b) {
  return b.level >= MAX_LEVEL ? null : BUILDINGS[b.type].upgrade[b.level - 1];
}

export function upgradeProblem(state, b, budget = available(state)) {
  const cost = upgradeCost(b);
  if (cost == null) return 'maxLevel';
  if (budget < cost) return 'noEnergy';
  return null;
}

export function upgrade(state, id, budget) {
  const b = state.buildings.find(x => x.id === id);
  if (!b || upgradeProblem(state, b, budget)) throw new Error('Cannot upgrade');
  state.spent += upgradeCost(b);
  b.level++;
  return b;
}

// Moving is free: it only changes where the building is.
export function moveBuilding(state, id, x, z) {
  const b = state.buildings.find(x => x.id === id);
  if (!b || !BUILDINGS[b.type].movable || !validSpot(state, b.type, x, z, id)) return false;
  b.x = x; b.z = z;
  return true;
}

// ---------- the day ----------

// The player's choice: energy to the oxygen machine and to the shield.
// Whatever is left goes to the battery (and is lost if the battery is full).
export function playDay(state, { oxygen = 0, shield = 0 }) {
  if (state.status !== 'playing') throw new Error('Game over');
  const map = MAPS[state.map];
  const total = available(state);
  if (oxygen < 0 || shield < 0 || oxygen + shield > total) throw new Error('Not enough energy');

  const left = total - oxygen - shield;
  const battery = Math.min(batteryMax(state), left);
  const wasted = left - battery;

  const o2Bonus = oxygen > 0 ? oxygenBonus(oxygenLevel(state)) : 0;
  const o2Want = oxygen + o2Bonus;
  const oxygenMade = Math.min(o2Want, oxygenMax(state) - state.oxygen);
  const oxygenLost = Math.min(oxygen, o2Want - oxygenMade);
  const oxygenAfter = state.oxygen + oxygenMade - map.oxygenUse;

  const storm = state.today.strength;
  const shieldPower = shield > 0 ? shield + shieldBonus(shieldLevel(state)) : 0;
  const blocked = Math.min(shieldPower, storm);
  const stormDose = (storm - blocked) * DOSE_PER_STORM_POINT;
  const out = state.rover?.status === 'out';
  const outsideDose = out && storm > 0 ? storm * ESCAPE.outsideDose : 0; // no shield outside the base
  const dose = state.dose + map.baseDose + stormDose + outsideDose;

  const report = {
    day: state.day, night: isNight(map, state.day), energy: energyToday(state), spent: state.spent,
    oxygen, shield, shieldPower, o2Bonus, wasted, oxygenLost, storm, blocked, warned: state.today.warned, flare: state.today.flare,
    stormDose, baseDose: map.baseDose, outsideDose, outside: out,
  };
  // the rover: a strong storm damages it; it still brings the part, but limps (one day slower) and comes back broken
  if (out) {
    const rv = state.rover;
    if (storm >= ESCAPE.breakStorm && !rv.damaged) { rv.damaged = true; rv.daysLeft++; report.roverHit = true; }
    if (--rv.daysLeft <= 0) {
      const d = state.debris.find(x => x.id === rv.target);
      d.collected = true; report.partBack = d.id;
      if (rv.damaged) report.roverBroken = d.id;
      state.rover = { status: rv.damaged ? 'broken' : 'home', target: null, daysLeft: 0 };
    } else report.roverDaysLeft = rv.daysLeft;
  }

  state.oxygen = Math.max(0, oxygenAfter);
  state.battery = battery;
  state.spent = 0;
  state.dose = dose;
  state.history.push(report);

  if (oxygenAfter < 0) state.status = 'lost-oxygen';
  else if (dose >= DOSE_LIMIT) state.status = 'lost-dose';
  else if (state.mode === 'survival' && state.day >= map.missionDays) state.status = 'won';
  else if (state.mode === 'escape' && state.day >= escapeDeadline(state)) state.status = 'lost-time';
  else {
    state.day++;
    const rng = rngFor(state);
    state.today = rollWeather(state, rng);
    report.dustStarted = false;
    if (state.dust > 0) state.dust--;
    else if (map.dustChance && rng() < map.dustChance) {
      state.dust = map.dustSols[0] + Math.floor(rng() * (map.dustSols[1] - map.dustSols[0] + 1));
      report.dustStarted = true;
    }
  }
  report.status = state.status;
  return report;
}

// How many storm points the shield blocks with this much energy.
export function shieldBlocks(state, energy) {
  return energy > 0 ? energy + shieldBonus(shieldLevel(state)) : 0;
}
