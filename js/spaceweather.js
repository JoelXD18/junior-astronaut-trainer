// Real space weather from NASA DONKI (Space Weather Database Of Notifications, Knowledge, Information).
// 1) Ask DONKI live for the last 30 days (no key needed).
// 2) Merge it with data/donki-snapshot.json (one year of flares saved by tools/update-donki.mjs).
// If DONKI can't be reached, the game uses the saved copy and SAYS it is not live.
import { normalize, activity, flareStrength } from './spaceweather-core.js';

const API = 'https://ccmc.gsfc.nasa.gov/DONKI-API/get';
const day = d => d.toISOString().slice(0, 10);

let weather = null;
const listeners = [];

async function getJson(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } finally { clearTimeout(timer); }
}

export async function loadSpaceWeather() {
  const now = new Date();
  const from = day(new Date(now.getTime() - 30 * 864e5)), to = day(now);
  const snapshot = await getJson('data/donki-snapshot.json').catch(() => ({ flares: [], sep: [], gst: [] }));
  let live = null;
  try {
    const [flr, sep, gst] = await Promise.all(['FLR', 'SEP', 'GST'].map(type => getJson(`${API}/${type}?startDate=${from}&endDate=${to}`)));
    live = normalize({ flr, sep, gst });
  } catch { /* offline or DONKI down: use the saved copy */ }

  const seen = new Set();
  const flares = [...(live?.flares || []), ...snapshot.flares]
    .filter(f => { const k = f.t + f.cls; return !seen.has(k) && seen.add(k); })
    .sort((a, b) => b.t.localeCompare(a.t));
  const data = { flares, sep: live ? live.sep : snapshot.sep || [], gst: live ? live.gst : snapshot.gst || [] };
  const refTime = live ? now : new Date(snapshot.savedAt || now);
  weather = {
    ...data,
    source: live ? 'live' : 'saved',
    time: live ? now.toISOString() : snapshot.savedAt,
    activity: activity(data, refTime),
    pool: flares.filter(f => flareStrength(f.cls) > 0), // flares strong enough to become game storms
  };
  listeners.forEach(fn => fn(weather));
  return weather;
}

export function getWeather() { return weather; }
export function onWeather(fn) { listeners.push(fn); }
export { flareStrength };
