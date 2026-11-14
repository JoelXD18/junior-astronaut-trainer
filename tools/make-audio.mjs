// Records the game's voices and sound effects once with ElevenLabs and saves them as files,
// so the game itself needs no key and no internet service. It also measures every clip:
// the game uses those lengths to time the animations, so voices and pictures always match.
//
//   node tools/make-audio.mjs          -> shows what would be recorded and how many characters it costs
//   node tools/make-audio.mjs --go     -> records what is missing (clips already made are kept)
//
// Needs ELEVENLABS_API_KEY in the git-ignored .env file and ffmpeg (FFMPEG=path or the ffmpeg-static package).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import en from '../lang/en.js';
import es from '../lang/es.js';
import { MAPS, ESCAPE } from '../js/game.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'assets', 'voice');
const SFX_OUT = path.join(ROOT, 'assets', 'sfx');
const MANIFEST = path.join(OUT, 'manifest.json');
const GO = process.argv.includes('--go');
const LANGS = { en, es };

const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));

// ---------- every line the game can say ----------
function lines(L) {
  const T = (k, v) => fill(L[k] ?? en[k], v);
  const out = [];
  const add = (who, text) => out.push({ who, text });
  const ctrl = k => /^r_(ctrl|brief|welcome|warn|storm_real|storm_copy|launch_ctrl)/.test(k);
  for (const k of Object.keys(en).filter(k => k.startsWith('r_'))) {
    const who = ctrl(k) ? 'control' : 'crew';
    const raw = L[k] ?? en[k];
    if (raw.includes('{n}')) for (const m of Object.values(MAPS)) add(who, T(k, { n: m.missionDays, p: ESCAPE.parts }));
    else if (raw.includes('{c}')) for (const c of ['A', 'B', 'C', 'M', 'X']) add(who, T(k, { c }));
    else if (raw.includes('{cls}')) for (const c of ['A', 'B', 'C', 'M', 'X']) add(who, T(k, { cls: c }));
    else add(who, T(k, { p: ESCAPE.parts }));
  }
  // tutorial narrator (same texts as tutorialSteps() in main.js)
  for (const [id, map] of Object.entries(MAPS)) {
    const mars = id === 'mars';
    const steps = [
      [T('tutEnergy'), T('help1')],
      [T('tutOxygen'), T('help2', { n: map.oxygenUse }) + (mars ? ' ' + T('moxieNote') : '')],
      [T('tutShield'), T('help3')],
      [T(mars ? 'tutDust' : 'tutBattery'), mars ? T('help4mars') : T('help4', { day: map.nightStart })],
      [T('tutBuild'), T('help6')],
      [T('tutParts'), T('helpParts', { n: ESCAPE.parts })],
      [T('tutReal'), T('sunHowGame')],
    ];
    for (const [title, text] of steps) add('narrator', title + '. ' + text);
  }
  const seen = new Set();
  return out.filter(l => !seen.has(l.who + '|' + l.text) && seen.add(l.who + '|' + l.text));
}

// ---------- sound effects ----------
const SFX = {
  engine: { text: 'Rocket engine of a lunar lander firing steadily in space, deep continuous rumble and hiss, no music', dur: 8, vol: .7 },
  touchdown: { text: 'Spacecraft landing legs touching down on dusty ground, soft heavy metallic thud and settling creak', dur: 2.5 },
  crash: { text: 'Small spaceship crash landing on rocky ground, metal impact, crunch and debris, short explosion', dur: 3 },
  launch: { text: 'Rocket launch from the Moon, ignition and powerful roaring engine fading up into the distance', dur: 7 },
  alarm: { text: 'Space station warning alarm, three short electronic beeps', dur: 1.5, vol: .6 },
  storm: { text: 'Solar storm hitting a space base, electric crackle and energy whoosh, sci-fi', dur: 2.5, vol: .7 },
  build: { text: 'Robotic construction of a small space module, quick mechanical clanks and a confirmation chime', dur: 2 },
  upgrade: { text: 'Positive sci-fi power-up sound, rising chime', dur: 1.2, vol: .7 },
  rover: { text: 'Small electric rover driving over gravel, whirring motors', dur: 3, vol: .6 },
};

// ---------- helpers ----------
const key = (() => {
  try { return /ELEVENLABS_API_KEY=(\S+)/.exec(fs.readFileSync(path.join(ROOT, '.env'), 'utf8'))?.[1] || process.env.ELEVENLABS_API_KEY; }
  catch { return process.env.ELEVENLABS_API_KEY; }
})();
let ffmpeg = process.env.FFMPEG;
if (!ffmpeg) { try { ffmpeg = (await import('ffmpeg-static')).default; } catch { /* checked below */ } }

const api = async (url, opts = {}) => {
  const r = await fetch('https://api.elevenlabs.io' + url, { ...opts, headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...opts.headers } });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r;
};
const duration = file => {
  const r = spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};
// radio voices sound like a radio; the narrator stays clean. Silence at the ends is cut so lengths are exact.
const finish = (src, dst, radio) => {
  const trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';
  const fx = radio ? ',highpass=f=250,lowpass=f=3600,acompressor=threshold=-20dB:ratio=3:attack=5:release=60' : '';
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-af', `${trim}${fx},loudnorm=I=-16:TP=-1.5`, '-ar', '44100', '-b:a', '96k', dst]);
};
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

// ---------- main ----------
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { voice: {}, sfx: {} };
const todo = [];
for (const [lang, L] of Object.entries(LANGS)) {
  manifest.voice[lang] ||= {};
  const want = lines(L);
  const keep = new Set(want.map(l => l.who + '|' + l.text));
  for (const k of Object.keys(manifest.voice[lang])) if (!keep.has(k)) delete manifest.voice[lang][k]; // text changed
  for (const l of want) {
    const e = manifest.voice[lang][l.who + '|' + l.text];
    if (!e || !fs.existsSync(path.join(ROOT, e.file))) todo.push({ ...l, lang });
  }
}
const sfxTodo = Object.keys(SFX).filter(n => !manifest.sfx[n] || !fs.existsSync(path.join(ROOT, manifest.sfx[n].file)));
const chars = todo.reduce((s, l) => s + l.text.length, 0);
console.log(`Voices to record: ${todo.length} (${chars} characters). Sound effects: ${sfxTodo.length}.`);
if (!GO) { for (const l of todo) console.log(`  [${l.lang}] ${l.who}: ${l.text}`); process.exit(0); }
if (!key) throw new Error('No ELEVENLABS_API_KEY in .env');
if (!ffmpeg) throw new Error('ffmpeg not found (set FFMPEG=path)');

const sub = await (await api('/v1/user/subscription')).json();
console.log(`ElevenLabs credits: ${sub.character_count} used of ${sub.character_limit}.`);
if (sub.character_limit - sub.character_count < chars) throw new Error('Not enough credits for the voices');

// pick voices from the account (premade voices), different for each role
const { voices } = await (await api('/v1/voices')).json();
const byName = n => voices.find(v => v.name.toLowerCase().startsWith(n.toLowerCase()));
const pickVoice = (names, not = []) => names.map(byName).find(v => v && !not.includes(v.voice_id)) || voices.find(v => !not.includes(v.voice_id));
const crew = pickVoice(['Brian', 'Adam', 'Daniel', 'George', 'Liam']);
const control = pickVoice(['Sarah', 'Rachel', 'Alice', 'Matilda', 'Laura'], [crew.voice_id]);
const narrator = pickVoice(['Jessica', 'Charlotte', 'Lily', 'Aria', 'Laura'], [crew.voice_id, control.voice_id]);
const VOICES = { crew, control, narrator };
console.log('Voices:', Object.entries(VOICES).map(([r, v]) => `${r}=${v.name}`).join(', '));
manifest.voices = Object.fromEntries(Object.entries(VOICES).map(([r, v]) => [r, v.name]));

const tmp = path.join(ROOT, 'node_modules', '.audio-tmp');
fs.mkdirSync(tmp, { recursive: true });
const save = () => fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));

for (const l of todo) {
  const v = VOICES[l.who];
  const settings = l.who === 'narrator' ? { stability: .55, similarity_boost: .75, style: .35 } : { stability: .45, similarity_boost: .75, style: .45 };
  const r = await api(`/v1/text-to-speech/${v.voice_id}?output_format=mp3_44100_128`, {
    method: 'POST', body: JSON.stringify({ text: l.text, model_id: 'eleven_multilingual_v2', voice_settings: settings }) });
  const raw = path.join(tmp, 'raw.mp3');
  fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  const rel = `assets/voice/${l.lang}/${l.who}-${hash(l.text)}.mp3`;
  fs.mkdirSync(path.join(OUT, l.lang), { recursive: true });
  finish(raw, path.join(ROOT, rel), l.who !== 'narrator');
  manifest.voice[l.lang][l.who + '|' + l.text] = { file: rel, dur: +duration(path.join(ROOT, rel)).toFixed(2) };
  save();
  console.log(`  ok [${l.lang}] ${l.who} ${manifest.voice[l.lang][l.who + '|' + l.text].dur}s`);
}
for (const n of sfxTodo) {
  const s = SFX[n];
  const r = await api('/v1/sound-generation', { method: 'POST', body: JSON.stringify({ text: s.text, duration_seconds: s.dur, prompt_influence: .5 }) });
  fs.mkdirSync(SFX_OUT, { recursive: true });
  const rel = `assets/sfx/${n}.mp3`;
  fs.writeFileSync(path.join(ROOT, rel), Buffer.from(await r.arrayBuffer()));
  manifest.sfx[n] = { file: rel, dur: +duration(path.join(ROOT, rel)).toFixed(2), vol: s.vol || 1 };
  save();
  console.log(`  ok sfx ${n}`);
}
save();
console.log('Done.');
