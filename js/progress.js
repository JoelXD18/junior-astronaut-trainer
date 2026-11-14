// Player progress saved in this browser: unlocked maps and best survival records.
const KEY = 'jamt-progress';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: progress only for this visit */ }
}

let progress = { unlocked: ['moon'], best: {}, unlockAll: false, ...read() };

export function isUnlocked(map) { return progress.unlockAll || progress.unlocked.includes(map); }

export function unlock(map) {
  if (progress.unlocked.includes(map)) return false;
  progress.unlocked.push(map);
  write(progress);
  return true;
}

export function setUnlockAll(on) { progress.unlockAll = on; write(progress); }
export function unlockAll() { return progress.unlockAll; }

// Best number of days survived in survival mode, per map and difficulty.
export function best(map, difficulty) { return progress.best[map + ':' + difficulty] || 0; }
export function saveBest(map, difficulty, days) {
  const k = map + ':' + difficulty;
  if (days <= (progress.best[k] || 0)) return false;
  progress.best[k] = days;
  write(progress);
  return true;
}
