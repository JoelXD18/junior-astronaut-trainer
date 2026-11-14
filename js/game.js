// Game rules. Pure logic, no DOM: easy to test and to balance.

export const MAPS = {
  moon: {
    id: 'moon',
    missionDays: 14,
    nightStart: 8,        // days 8..14 are lunar night (shortened for the game)
    oxygenUse: 3,         // oxygen the crew breathes each day
    oxygenStart: 9,
    batteryStart: 4,
    baseDose: 2,          // background radiation every day (% of the safe limit)
    baseEnergy: 1,        // small panels on the habitat roof
    baseOxygenMax: 10,    // tank inside the habitat
    // Buildings at the start (x, z in meters around the habitat)
    start: [
      ['solar', -20, -10], ['solar', -15, -16], ['solar', -24, -3],
      ['oxygen', 18, -8], ['tank', 24, -1], ['tank', 13, -16],
      ['battery', 17, 9], ['battery', 22, 15],
      ['shield', 7, 5],
    ],
  },
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
export const tankCap = level => 5 + level * 5;        // 10, 15, 20 oxygen storage
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
  return day >= map.nightStart;
}

const ofType = (state, type) => state.buildings.filter(b => b.type === type);
const levelOf = (state, type) => (ofType(state, type)[0] || { level: 1 }).level;

export function sunEnergy(state) {
  const map = MAPS[state.map];
  // A tower built today starts working tomorrow.
  return map.baseEnergy + ofType(state, 'solar').filter(b => b.builtDay !== state.day).reduce((s, b) => s + solarEnergy(b.level), 0);
}
export function energyToday(state) {
  return isNight(MAPS[state.map], state.day) ? 0 : sunEnergy(state);
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

function rollWeather(state, rng) {
  const diff = DIFFICULTY[state.difficulty];
  const storm = rng() < diff.stormChance;
  const strength = storm ? 1 + Math.floor(rng() * diff.maxStrength) : 0;
  const warned = storm ? rng() < diff.warnChance : rng() < diff.falseAlarm;
  return { strength, warned };
}

export function newGame({ map = 'moon', difficulty = 'normal', seed = Date.now() } = {}) {
  const m = MAPS[map];
  const state = {
    map, difficulty, seed, rngCalls: 0,
    day: 1,
    oxygen: m.oxygenStart,
    battery: m.batteryStart,
    spent: 0,          // energy spent on buildings today
    dose: 0,
    nextId: 1,
    buildings: [],
    today: null,       // weather that will hit today (hidden from the player)
    status: 'playing', // playing | won | lost-oxygen | lost-dose
    history: [],
  };
  for (const [type, x, z] of m.start) state.buildings.push({ id: state.nextId++, type, level: 1, x, z });
  const rng = rngFor(state);
  state.today = rollWeather(state, rng);
  return state;
}

// Re-creates the generator at the right point, so saved games continue the same way.
function rngFor(state) {
  const raw = makeRng(state.seed);
  for (let i = 0; i < state.rngCalls; i++) raw();
  return () => { state.rngCalls++; return raw(); };
}

// What the player sees about today's space weather.
export function forecast(state) {
  return { warned: state.today.warned };
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
  const dose = state.dose + map.baseDose + stormDose;

  const report = {
    day: state.day, night: isNight(map, state.day), energy: energyToday(state), spent: state.spent,
    oxygen, shield, shieldPower, o2Bonus, wasted, oxygenLost, storm, blocked, warned: state.today.warned,
    stormDose, baseDose: map.baseDose,
  };

  state.oxygen = Math.max(0, oxygenAfter);
  state.battery = battery;
  state.spent = 0;
  state.dose = dose;
  state.history.push(report);

  if (oxygenAfter < 0) state.status = 'lost-oxygen';
  else if (dose >= DOSE_LIMIT) state.status = 'lost-dose';
  else if (state.day >= map.missionDays) state.status = 'won';
  else {
    state.day++;
    state.today = rollWeather(state, rngFor(state));
  }
  report.status = state.status;
  return report;
}

// How many storm points the shield blocks with this much energy.
export function shieldBlocks(state, energy) {
  return energy > 0 ? energy + shieldBonus(shieldLevel(state)) : 0;
}
