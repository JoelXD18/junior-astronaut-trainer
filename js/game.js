// Game rules. Pure logic, no DOM: easy to test and to balance.

export const MAPS = {
  moon: {
    id: 'moon',
    missionDays: 14,
    nightStart: 8,        // days 8..14 are lunar night (shortened for the game)
    sunEnergy: 7,         // energy from solar panels on a sunny day
    nightEnergy: 0,       // no sun, no solar power
    oxygenUse: 3,         // oxygen the crew breathes each day
    oxygenStart: 9,
    oxygenMax: 30,
    batteryStart: 4,
    batteryMax: 20,
    baseDose: 2,          // background radiation every day (% of the safe limit)
  },
};

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

export function energyToday(state) {
  const map = MAPS[state.map];
  return isNight(map, state.day) ? map.nightEnergy : map.sunEnergy;
}

export function available(state) {
  return energyToday(state) + state.battery;
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
    dose: 0,
    today: null,       // weather that will hit today (hidden from the player)
    status: 'playing', // playing | won | lost-oxygen | lost-dose
    history: [],
  };
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

// The player's choice: energy to the oxygen machine and to the shield.
// Whatever is left goes to the battery (and is lost if the battery is full).
export function playDay(state, { oxygen = 0, shield = 0 }) {
  if (state.status !== 'playing') throw new Error('Game over');
  const map = MAPS[state.map];
  const total = available(state);
  if (oxygen < 0 || shield < 0 || oxygen + shield > total) throw new Error('Not enough energy');

  const left = total - oxygen - shield;
  const battery = Math.min(map.batteryMax, left);
  const wasted = left - battery;

  const oxygenMade = Math.min(oxygen, map.oxygenMax - state.oxygen);
  const oxygenLost = oxygen - oxygenMade;
  const oxygenAfter = state.oxygen + oxygenMade - map.oxygenUse;

  const storm = state.today.strength;
  const blocked = Math.min(shield, storm);
  const stormDose = (storm - blocked) * DOSE_PER_STORM_POINT;
  const dose = state.dose + map.baseDose + stormDose;

  const report = {
    day: state.day, night: isNight(map, state.day), energy: energyToday(state),
    oxygen, shield, wasted, oxygenLost, storm, blocked, warned: state.today.warned,
    stormDose, baseDose: map.baseDose,
  };

  state.oxygen = Math.max(0, oxygenAfter);
  state.battery = battery;
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
