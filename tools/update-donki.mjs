// Saves a copy of NASA DONKI space-weather data into data/donki-snapshot.json:
// one year of solar flares (the game turns real flares into its storms) and the last month of
// solar particle events and geomagnetic storms. The live game also asks DONKI for the latest days,
// and uses this file as its library of past flares and as a backup if DONKI can't be reached.
// Run: node tools/update-donki.mjs
import { writeFileSync } from 'node:fs';
import { normalize } from '../js/spaceweather-core.js';

const API = 'https://ccmc.gsfc.nasa.gov/DONKI-API/get';
const DAY = 864e5;
const day = d => d.toISOString().slice(0, 10);
const end = new Date();

async function get(type, from, to = end) {
  const url = `${API}/${type}?startDate=${day(from)}&endDate=${day(to)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${type}: HTTP ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// The API accepts at most ~60 days per request, so ask in pieces.
const flr = [];
for (let i = 0; i < 365; i += 60) {
  const to = new Date(end.getTime() - i * DAY);
  const from = new Date(end.getTime() - Math.min(365, i + 59) * DAY);
  flr.push(...await get('FLR', from, to));
}
const month = new Date(end.getTime() - 30 * DAY);
const [sep, gst] = await Promise.all([get('SEP', month), get('GST', month)]);

const seen = new Set();
const data = normalize({ flr: flr.filter(f => !seen.has(f.flrID) && seen.add(f.flrID)), sep, gst });
data.savedAt = end.toISOString();
data.range = [day(new Date(end.getTime() - 365 * DAY)), day(end)];
writeFileSync(new URL('../data/donki-snapshot.json', import.meta.url), JSON.stringify(data));
console.log(`Saved ${data.flares.length} flares, ${data.sep.length} particle events, ${data.gst.length} geomagnetic storms.`);
