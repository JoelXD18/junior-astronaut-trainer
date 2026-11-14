// Records the game's voices with Gemini text-to-speech in very few requests ("takes"):
// one take per language with every radio line (two voices: crew and Mission Control) and one take per
// language for the tutorial narrator. Each take is cut into one clip per line at the longest silences,
// the radio clips get a radio/interference sound, and every clip is measured. The game uses those lengths
// to time the animations, so voice and picture always match.
//
//   node tools/make-voices-gemini.mjs              -> lists the takes and lines (no request)
//   node tools/make-voices-gemini.mjs --go [take]  -> records (all takes, or one: radio-en, radio-es, narrator-en, narrator-es)
//
// Needs GEMINI_API_KEY in the environment and ffmpeg (FFMPEG=path or the ffmpeg-static package).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import en from '../lang/en.js';
import es from '../lang/es.js';
import { MAPS, ESCAPE } from '../js/game.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OUT = path.join(ROOT, 'assets', 'voice');
const MANIFEST = path.join(OUT, 'manifest.json');
const TMP = path.join(ROOT, 'node_modules', '.audio-tmp');
const GO = process.argv.includes('--go');
const ALIGN = process.argv.includes('--align'); // re-cut saved takes by listening, without recording again
const MISSING = process.argv.includes('--missing'); // only the radio lines that have no clip yet
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { voice: {}, sfx: {} };
const ONLY = process.argv.slice(2).find(a => !a.startsWith('--'));
const MODEL = process.env.TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const VOICE = { crew: 'Charon', control: 'Kore', narrator: 'Leda' };
const LANGS = { en, es };
const fill = (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : `{${k}}`));

// ---------- every line the game can say ----------
function radioLines(L) {
  const T = (k, v) => fill(L[k] ?? en[k], v);
  const out = [];
  const ctrl = k => /^r_(ctrl|brief|welcome|warn|storm_real|storm_copy|launch_ctrl|dust_start)/.test(k);
  for (const k of Object.keys(en).filter(k => k.startsWith('r_'))) {
    const who = ctrl(k) ? 'control' : 'crew';
    const raw = L[k] ?? en[k];
    if (k === 'r_rover_back') for (let n = 1; n <= ESCAPE.parts; n++) out.push({ who, text: T(k, { n, m: ESCAPE.parts }) });
    else if (k === 'r_dust_start') for (let n = MAPS.mars.dustSols[0]; n <= MAPS.mars.dustSols[1]; n++) out.push({ who, text: T(k, { n }) });
    else if (k === 'r_brief_survival') out.push({ who, text: T(k, { n: MAPS.moon.missionDays }) });
    else if (k === 'r_brief_survival_mars') out.push({ who, text: T(k, { n: MAPS.mars.missionDays }) });
    else if (raw.includes('{n}')) for (const m of Object.values(MAPS)) out.push({ who, text: T(k, { n: m.missionDays, p: ESCAPE.parts }) });
    else if (raw.includes('{c}')) for (const c of ['C', 'M', 'X']) out.push({ who, text: T(k, { c }) });
    else if (raw.includes('{cls}')) for (const c of ['C', 'M', 'X']) out.push({ who, text: T(k, { cls: c }) });
    else out.push({ who, text: T(k, { p: ESCAPE.parts }) });
  }
  return dedupe(out);
}
function narratorLines(L) {
  const T = (k, v) => fill(L[k] ?? en[k], v);
  const out = [];
  for (const [id, map] of Object.entries(MAPS)) {
    const mars = id === 'mars';
    for (const [title, text] of [
      [T('tutEnergy'), T('help1')],
      [T('tutOxygen'), T('help2', { n: map.oxygenUse }) + (mars ? ' ' + T('moxieNote') : '')],
      [T('tutShield'), T('help3')],
      [T(mars ? 'tutDust' : 'tutBattery'), mars ? T('help4mars') : T('help4', { day: map.nightStart })],
      [T('tutBuild'), T('help6')],
      [T('tutParts'), T('helpParts', { n: ESCAPE.parts })],
      [T('tutReal'), T('sunHowGame')],
    ]) out.push({ who: 'narrator', text: title + '. ' + text });
  }
  return dedupe(out);
}
function dedupe(list) { const seen = new Set(); return list.filter(l => !seen.has(l.who + '|' + l.text) && seen.add(l.who + '|' + l.text)); }

// ---------- helpers ----------
let ffmpeg = process.env.FFMPEG;
if (!ffmpeg) { try { ffmpeg = (await import('ffmpeg-static')).default; } catch { /* checked below */ } }
const ff = args => execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...args]);
const duration = file => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg, ['-i', file], { encoding: 'utf8' }).stderr); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; };
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

async function tts(prompt, speakers) {
  const speech = speakers.length > 1
    ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map(([name, voice]) => ({ speaker: name, voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } })) } }
    : { voiceConfig: { prebuiltVoiceConfig: { voiceName: speakers[0][1] } } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: speech } }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message}`);
  const data = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!data) throw new Error('No audio in the answer: ' + JSON.stringify(j).slice(0, 300));
  return Buffer.from(data.data, 'base64'); // 16-bit PCM, 24 kHz, mono
}

// Cut a take into n clips at its n-1 longest silences (the pauses between lines are the longest ones).
function split(wav, n) {
  const r = spawnSync(ffmpeg, ['-i', wav, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-'], { encoding: 'utf8' });
  const sil = [];
  let start = null;
  for (const line of r.stderr.split('\n')) {
    const a = /silence_start: ([\d.]+)/.exec(line); if (a) start = +a[1];
    const b = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/.exec(line); if (b && start != null) { sil.push({ start, end: +b[1], len: +b[2] }); start = null; }
  }
  const total = duration(wav);
  const inner = sil.filter(s => s.start > .05 && s.end < total - 1.5); // a pause right before a tiny noise at the end is not a line break
  if (inner.length < n - 1) throw new Error(`Only ${inner.length} pauses found for ${n} lines`);
  const cuts = inner.sort((a, b) => b.len - a.len).slice(0, n - 1).sort((a, b) => a.start - b.start);
  const bounds = [0, ...cuts.map(c => (c.start + c.end) / 2), total];
  return bounds.slice(0, -1).map((s, i) => [s, bounds[i + 1]]);
}

// Cut a take using where Gemini hears each paragraph start and end (for takes where the pauses are not
// clear, or where the model also read the instructions aloud). Each cut is moved to the nearest pause.
async function align(wav, lines) {
  const mp3 = wav.replace(/\.wav$/, '.mp3');
  ff(['-i', wav, '-ac', '1', '-b:a', '48k', mp3]);
  const prompt = 'This audio contains the following paragraphs, read in this order (there may be other words before them; ignore those). ' +
    'For each paragraph, give the time in seconds when its first word starts and when its last word ends. ' +
    'Answer only with JSON: [[start, end], ...] with exactly ' + lines.length + ' pairs.\n\n' + lines.map((l, i) => (i + 1) + '. ' + l.text).join('\n');
  let times = null;
  for (const model of ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash']) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: 'audio/mp3', data: fs.readFileSync(mp3).toString('base64') } }] }],
        generationConfig: { responseMimeType: 'application/json' } }) }).catch(e => ({ ok: false, json: async () => ({ error: { message: e.message } }) }));
    const j = await r.json();
    const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    try { times = JSON.parse(txt); } catch { times = null; }
    if (Array.isArray(times) && times.length === lines.length) { console.log('  aligned with', model); break; }
    console.log('  ', model, 'could not align:', j.error?.message?.slice(0, 80) || String(txt).slice(0, 80));
    times = null;
  }
  if (!times) throw new Error('No alignment');
  // pauses in the take
  const r = spawnSync(ffmpeg, ['-i', wav, '-af', 'silencedetect=noise=-40dB:d=0.15', '-f', 'null', '-'], { encoding: 'utf8' });
  const sil = []; let st = null;
  for (const line of r.stderr.split('\n')) {
    const a = /silence_start: ([\d.]+)/.exec(line); if (a) st = +a[1];
    const b = /silence_end: ([\d.]+)/.exec(line); if (b && st != null) { sil.push([st, +b[1]]); st = null; }
  }
  const total = duration(wav);
  // start: the end of the nearest pause before it; end: the start of the nearest pause after it
  const snapStart = t => { const c = sil.filter(([a, b]) => Math.abs(b - t) < 1.5).sort((x, y) => Math.abs(x[1] - t) - Math.abs(y[1] - t))[0]; return c ? Math.max(0, c[1] - .08) : Math.max(0, t - .15); };
  const snapEnd = t => { const c = sil.filter(([a]) => Math.abs(a - t) < 1.5).sort((x, y) => Math.abs(x[0] - t) - Math.abs(y[0] - t))[0]; return c ? Math.min(total, c[0] + .15) : Math.min(total, t + .2); };
  return times.map(([s, e]) => [snapStart(+s), snapEnd(+e)]);
}

// Radio sound: narrow band like a radio, a little crunch, and a soft hiss with crackle underneath.
const RADIO_FX = '[0:a]highpass=f=320,lowpass=f=3300,acompressor=threshold=-22dB:ratio=4:attack=4:release=80,acrusher=bits=12:mix=0.25,volume=1.6[v];' +
  'anoisesrc=color=pink:amplitude=0.035:seed=7,highpass=f=900,lowpass=f=5000,tremolo=f=11:d=0.6[n];' +
  '[v][n]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5[out]';
const TRIM = 'silenceremove=start_periods=1:start_threshold=-42dB,areverse,silenceremove=start_periods=1:start_threshold=-42dB,areverse';

// ---------- takes ----------
const TAKES = [];
for (const [lang, L] of Object.entries(LANGS)) {
  const say = lang === 'es' ? 'en español de España' : 'in English';
  const radio = radioLines(L).filter(l => !MISSING || !manifest.voice[lang]?.[l.who + '|' + l.text]);
  if (radio.length) TAKES.push({ id: 'radio-' + lang + (MISSING ? '-new' : ''), lang, lines: radio,
    speakers: [['Crew', VOICE.crew], ['Control', VOICE.control]].filter(([n]) => radio.some(l => (l.who === 'crew' ? 'Crew' : 'Control') === n)),
    prompt: (lang === 'es'
      ? `Lee ${say} estas comunicaciones de radio entre una tripulación espacial (Crew, voz de astronauta tranquila y valiente) y Control de Misión (Control, voz clara y segura), para un juego infantil. Lee cada línea exactamente como está escrita, sin añadir ni quitar nada, y haz una pausa larga de dos segundos entre una línea y la siguiente.\n\n`
      : `Read ${say} these radio calls between a space crew (Crew: calm, brave astronaut voice) and Mission Control (Control: clear, confident voice) for a children's game. Read every line exactly as written, adding or skipping nothing, with a long two-second pause between one line and the next.\n\n`)
      // with one voice only, no speaker names (they would be read aloud)
      + (new Set(radio.map(l => l.who)).size > 1 ? radio.map(l => `${l.who === 'crew' ? 'Crew' : 'Control'}: ${l.text}`).join('\n') : radio.map(l => l.text).join('\n\n')) });
  // the narrator texts are long: two shorter takes per language are much more reliable than one long one
  const allNar = narratorLines(L), half = Math.ceil(allNar.length / 2);
  for (const [part, nar] of [[1, allNar.slice(0, half)], [2, allNar.slice(half)]]) TAKES.push({ id: 'narrator-' + lang + '-' + part, lang, lines: nar, speakers: [['Narrator', VOICE.narrator]],
    prompt: (lang === 'es'
      ? `Lee ${say}, con voz amable, alegre y clara para niños de 7 a 12 años, estos textos de un tutorial. Lee cada párrafo exactamente como está, y haz una pausa de dos segundos entre un párrafo y el siguiente.\n\n`
      : `Read ${say}, in a kind, cheerful and clear voice for children aged 7 to 12, these tutorial texts. Read every paragraph exactly as written, with a two-second pause between paragraphs.\n\n`)
      + nar.map(l => l.text).join('\n\n') });
}

TAKES.push({ id: 'narrator-en', lang: 'en', lines: narratorLines(en), speakers: [], prompt: '', alignOnly: true });
manifest.voice ||= {}; manifest.sfx ||= {};
const done = take => take.lines.every(l => { const e = manifest.voice[take.lang]?.[l.who + '|' + l.text]; return e && fs.existsSync(path.join(ROOT, e.file)); });
for (const take of TAKES) console.log(`${take.id}: ${take.lines.length} lines, ${take.prompt.length} characters${done(take) ? ' (already recorded)' : ''}`);
if (!GO) process.exit(0);
if (!process.env.GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY');
if (!ffmpeg) throw new Error('ffmpeg not found (set FFMPEG=path)');
fs.mkdirSync(TMP, { recursive: true });

for (const take of TAKES.filter(t => (ONLY ? t.id === ONLY : !done(t) && !t.alignOnly))) {
  console.log(`${ALIGN ? 'Re-cutting' : 'Recording'} ${take.id}…`);
  const pcm = path.join(TMP, take.id + '.pcm'), wav = path.join(TMP, take.id + '.wav');
  if (ALIGN && !fs.existsSync(pcm)) throw new Error('No saved take ' + take.id);
  // PLAIN=1: send only the texts (newer models read any instructions aloud)
  const prompt = process.env.PLAIN ? take.lines.map(l => l.text).join('\n\n') : take.prompt;
  if (!fs.existsSync(pcm) || process.argv.includes('--fresh')) fs.writeFileSync(pcm, await tts(prompt, take.speakers)); // keep the take: re-cutting costs nothing
  ff(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, wav]);
  const parts = ALIGN ? await align(wav, take.lines) : split(wav, take.lines.length);
  // sanity check: clip lengths should follow text lengths
  const rates = parts.map(([a, b], i) => (b - a) / take.lines[i].text.length);
  const avg = rates.reduce((s, x) => s + x, 0) / rates.length;
  const odd = rates.map((r, i) => [r / avg, i]).filter(([k]) => k < .45 || k > 2.2);
  if (odd.length && !ALIGN) { console.log('  Clips that do not match their text length:', odd.map(([k, i]) => `#${i} x${k.toFixed(2)} "${take.lines[i].text.slice(0, 40)}"`).join('; ')); throw new Error('Split does not match the lines; nothing saved for ' + take.id); }
  manifest.voice[take.lang] ||= {};
  fs.mkdirSync(path.join(OUT, take.lang), { recursive: true });
  take.lines.forEach((l, i) => {
    const [a, b] = parts[i];
    const rel = `assets/voice/${take.lang}/${l.who}-${hash(l.text)}.mp3`;
    const piece = path.join(TMP, 'piece.wav');
    ff(['-ss', a.toFixed(3), '-to', b.toFixed(3), '-i', wav, '-af', TRIM, piece]);
    if (l.who === 'narrator') ff(['-i', piece, '-af', 'loudnorm=I=-16:TP=-1.5', '-ar', '44100', '-b:a', '80k', path.join(ROOT, rel)]);
    else ff(['-i', piece, '-filter_complex', RADIO_FX, '-map', '[out]', '-ar', '44100', '-b:a', '80k', path.join(ROOT, rel)]);
    manifest.voice[take.lang][l.who + '|' + l.text] = { file: rel, dur: +duration(path.join(ROOT, rel)).toFixed(2) };
  });
  manifest.voices = { ...VOICE, model: MODEL };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
  console.log(`  saved ${take.lines.length} clips`);
}
console.log('Done.');
