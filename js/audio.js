// Background music (Pixabay tracks) with soft cross-fades, a volume setting and a mute button.
// Browsers only allow sound after the player touches the page, so the first tap starts the music.
const TRACKS = {
  menu: { src: 'assets/audio/menu.mp3', loop: true },
  game: { src: 'assets/audio/game.mp3', loop: true },
  landing: { src: 'assets/audio/landing.mp3', loop: false },
  credits: { src: 'assets/audio/credits.mp3', loop: false },
  tutorial: { src: 'assets/audio/tutorial.mp3', loop: true },
};
const KEY = 'jamt-audio';
let settings = { volume: .6, muted: false };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }

const players = {};
let current = null;      // name of the track that should be playing
let unlocked = false;    // true after the first user gesture
let duck = 1;            // lowered while the narrator reads text aloud

// On iPhones and iPads the volume of an <audio> element cannot be changed from code (it is always 100%),
// so the music goes through Web Audio, where a "gain" node sets the volume on every device.
function player(name) {
  if (!players[name]) {
    const a = new Audio(TRACKS[name].src);
    a.loop = TRACKS[name].loop;
    a.preload = 'none';
    const p = { a, vol: 0, gain: null };
    try {
      const c = audioCtx();
      p.gain = c.createGain(); p.gain.gain.value = 0;
      c.createMediaElementSource(a).connect(p.gain).connect(c.destination);
    } catch { p.gain = null; a.volume = 0; }
    players[name] = p;
  }
  return players[name];
}
function setVol(p, v) { p.vol = v; if (p.gain) p.gain.gain.value = v; else p.a.volume = v; }

const target = () => (settings.muted ? 0 : settings.volume * duck);

// Smoothly move every track towards its volume (current track up, others down to silence and paused).
let fading = null;
function fade() {
  clearInterval(fading);
  fading = setInterval(() => {
    let busy = false;
    for (const [name, p] of Object.entries(players)) {
      const want = name === current ? target() : 0;
      let v = Math.max(0, Math.min(1, p.vol + Math.sign(want - p.vol) * Math.min(.05, Math.abs(want - p.vol))));
      if (Math.abs(v - want) < .002) v = want; // land exactly on the target (so a silent track really reaches 0 and stops)
      setVol(p, v);
      if (Math.abs(p.vol - want) > .001) busy = true;
      if (name !== current && p.vol === 0 && !p.a.paused) p.a.pause();
    }
    if (!busy) clearInterval(fading);
  }, 40);
}

// Phones: stop the music when the game goes to the background, and go on when it comes back.
document.addEventListener('visibilitychange', () => {
  const p = current && players[current];
  if (document.hidden) { for (const q of Object.values(players)) q.a.pause(); ctx?.suspend?.(); }
  else if (p && unlocked) { ctx?.resume?.(); p.a.play().catch(() => {}); }
});

export function playMusic(name, { restart = false } = {}) {
  if (name === current && !restart) return;
  current = name;
  if (!unlocked || !name) return fade();
  const a = player(name).a;
  if (restart || a.ended) a.currentTime = 0;
  a.play().catch(() => { /* blocked until the user taps */ });
  fade();
}

export function setVolume(v) { settings.volume = v; save(); fade(); }
export function toggleMute() { settings.muted = !settings.muted; save(); fade(); return settings.muted; }
export function audioSettings() { return { ...settings }; }
export function setDuck(on) { duck = on ? .25 : 1; fade(); }

function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

function unlock() {
  if (unlocked) return;
  unlocked = true;
  try { audioCtx(); } catch { /* no Web Audio */ } // phones only allow it to start during a tap
  if (current) { const name = current; current = null; playMusic(name); }
}
// iPhones only allow sound to start on "touchend" and "click", so listen to those too; every tap also wakes the audio up
['pointerdown', 'keydown', 'touchstart', 'touchend', 'click'].forEach(ev => window.addEventListener(ev, () => { unlock(); if (ctx?.state === 'suspended' && !document.hidden) ctx.resume(); }, { passive: true }));

// Read a text aloud in the game's language (narrator for the tutorial). Music is lowered meanwhile.
export function speak(text, lang) {
  stopClip();
  const c = clipFor('narrator', text, lang);
  if (c) { if (settings.muted) return true; setDuck(true); playClip(c, () => setDuck(false)); return true; }
  if (!('speechSynthesis' in window)) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'es' ? 'es-ES' : 'en-US';
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith(lang));
  if (voice) u.voice = voice;
  u.rate = .95;
  u.onend = u.onerror = () => setDuck(false);
  setDuck(true);
  speechSynthesis.speak(u);
  return true;
}
export function stopSpeaking() { stopClip(); if ('speechSynthesis' in window) speechSynthesis.cancel(); setDuck(false); }

// ---------- recorded voices and sound effects ----------
// tools/make-audio.mjs records every line once (ElevenLabs) and writes assets/voice/manifest.json with
// the exact length of each clip. Knowing the lengths, the animations are timed so voice and picture match.
let manifest = { voice: {}, sfx: {} };
fetch('assets/voice/manifest.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).then(m => { if (m) manifest = m; }).catch(() => {});
const clipFor = (who, text, lang) => manifest.voice?.[lang]?.[who + '|' + text] || null;
let clip = null;
function playClip(c, done) {
  const a = new Audio(c.file);
  a.volume = settings.muted ? 0 : Math.min(1, .35 + settings.volume);
  let ended = false;
  const end = () => { if (ended) return; ended = true; if (clip === a) clip = null; done?.(); };
  a.onended = a.onerror = end;
  setTimeout(end, (c.dur + 1.5) * 1000); // never get stuck
  clip = a;
  a.play().catch(end);
}
function stopClip() { if (clip) { const a = clip; clip = null; a.pause(); a.onended?.(); } }

// Download the recorded clips of some lines in advance (so the first words are not late). Resolves when they are
// ready or after a few seconds, whatever comes first.
export function preloadLines(lines, lang) {
  const files = [...new Set(lines.map(l => clipFor(l.who, l.text, lang)?.file).filter(Boolean))];
  return Promise.race([
    Promise.all(files.map(f => fetch(f).then(r => r.blob()).catch(() => null))),
    new Promise(r => setTimeout(r, 6000)),
  ]);
}

// How long a radio line takes (seconds), including the beeps and the pause after it.
export function lineTime(l, lang) {
  const c = clipFor(l.who, l.text, lang);
  const talk = c ? c.dur : .4 + l.text.length * .062; // browser voices: a guess (the animation waits if they run late)
  return talk + (l.who === 'control' ? .3 : 0) + .35;
}
export const radioTime = (lines, lang) => lines.reduce((s, l) => s + lineTime(l, lang), 0);

// Short sound effects. Returns a stop function (for loops such as the engine).
// They are made in code with Web Audio (no sound files); a recorded file in the manifest is used instead if there is one.
export function sfx(name, { loop = false, vol = 1 } = {}) {
  const s = manifest.sfx?.[name];
  if (!unlocked || settings.muted) return () => {};
  if (!s) return synth(name, vol);
  const a = new Audio(s.file);
  a.loop = loop;
  a.volume = Math.min(1, settings.volume * vol * (s.vol || 1));
  a.play().catch(() => {});
  return () => { const v0 = a.volume; let k = 1; const f = setInterval(() => { k -= .1; a.volume = Math.max(0, v0 * k); if (k <= 0) { clearInterval(f); a.pause(); } }, 40); };
}

// ---------- mission radio ----------
// Apollo radio had short beeps ("Quindar tones") at the start and end of each message from Mission Control.
let ctx = null;
function beep(freq, when = 0, len = .25) {
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.value = settings.muted ? 0 : .08 * settings.volume + .02;
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + len);
  } catch { /* no Web Audio: no beeps */ }
}

function pickVoices(lang) {
  // natural / online voices sound much better than the old robotic ones: try them first
  const score = v => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  const all = ('speechSynthesis' in window) ? speechSynthesis.getVoices().filter(v => v.lang.startsWith(lang)).sort((a, b) => score(b) - score(a)) : [];
  const male = all.find(v => /male|jorge|pablo|alvaro|david|daniel|guy|mark|george|diego/i.test(v.name) && !/female/i.test(v.name));
  return { crew: male || all[0] || null, control: all.find(v => v !== (male || all[0])) || all[0] || null };
}

let radioQueue = [], radioOn = false;
// lines: [{ who: 'crew' | 'control', text }]; onLine(line) is called when each line starts (for subtitles).
export function radio(lines, lang, onLine) {
  radioQueue.push(...lines.map(l => ({ ...l, lang, onLine })));
  if (!radioOn) nextRadio();
}
function nextRadio() {
  const l = radioQueue.shift();
  if (!l) { radioOn = false; setDuck(false); return; }
  radioOn = true;
  l.onLine?.(l); // subtitle right away (also works when the browser has no voices)
  let finished = false;
  const next = () => { if (finished) return; finished = true; clearTimeout(guard); if (l.who === 'control') beep(2475); setTimeout(nextRadio, 350); };
  const c = clipFor(l.who, l.text, l.lang);
  if (c) { // recorded voice: we know exactly how long it lasts
    var guard = setTimeout(next, (c.dur + 2) * 1000);
    setDuck(true);
    if (l.who === 'control') beep(2525);
    setTimeout(() => (settings.muted ? setTimeout(next, c.dur * 1000) : playClip(c, next)), l.who === 'control' ? 300 : 0);
    return;
  }
  if (!('speechSynthesis' in window)) { guard = setTimeout(next, 1500 + l.text.length * 75); return; }
  // if speech is not available or never ends, move on after a reading time
  guard = setTimeout(next, 1500 + l.text.length * 75);
  if (settings.muted) return;
  // the browser loads its voices a moment after the page: wait for them instead of skipping the first line
  if (!speechSynthesis.getVoices().length) {
    const go = () => { speechSynthesis.removeEventListener('voiceschanged', go); if (!finished) sayLine(l, next); };
    speechSynthesis.addEventListener('voiceschanged', go);
    return;
  }
  sayLine(l, next);
}
function sayLine(l, next) {
  const v = pickVoices(l.lang)[l.who];
  const u = new SpeechSynthesisUtterance(l.text);
  u.lang = l.lang === 'es' ? 'es-ES' : 'en-US';
  if (v) u.voice = v;
  u.rate = l.who === 'crew' ? 1.02 : 1.08;
  u.pitch = l.who === 'crew' ? .8 : 1.15;
  u.onend = u.onerror = next;
  setDuck(true);
  if (l.who === 'control') beep(2525);
  setTimeout(() => speechSynthesis.speak(u), l.who === 'control' ? 300 : 0);
}
export function radioBusy() { return radioOn || radioQueue.length > 0; }
export function stopRadio() {
  radioQueue = []; radioOn = false;
  stopClip();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setDuck(false);
}

// ---------- sound effects made in code ----------
function audioCtx() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
let noiseBuf = null;
function noise(c, brown = false) {
  if (!noiseBuf) {
    noiseBuf = { white: c.createBuffer(1, c.sampleRate * 2, c.sampleRate), brown: c.createBuffer(1, c.sampleRate * 2, c.sampleRate) };
    const w = noiseBuf.white.getChannelData(0), b = noiseBuf.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < w.length; i++) { w[i] = Math.random() * 2 - 1; last = (last + .02 * w[i]) / 1.02; b[i] = last * 3.5; }
  }
  const src = c.createBufferSource();
  src.buffer = brown ? noiseBuf.brown : noiseBuf.white;
  src.loop = true;
  return src;
}
// envelope: [[time, value], ...] relative to now
function env(param, now, points) { param.setValueAtTime(points[0][1], now + points[0][0]); for (const [t, v] of points.slice(1)) param.linearRampToValueAtTime(v, now + t); }
function tone(c, out, now, { type = 'sine', f, f2, at = 0, len = .2, gain = .3 }) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, now + at);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + at + len);
  env(g.gain, now, [[0, 0], [at, 0], [at + .01, gain], [at + len, 0]]);
  o.connect(g).connect(out); o.start(now + at); o.stop(now + at + len + .05);
}
function noiseHit(c, out, now, { at = 0, len = .5, gain = .6, type = 'lowpass', f = 400, f2, q = 1, brown = false }) {
  const n = noise(c, brown), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, now + at);
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + at + len);
  env(g.gain, now, [[0, 0], [at, 0], [at + .01, gain], [at + len, 0]]);
  n.connect(fl).connect(g).connect(out); n.start(now + at); n.stop(now + at + len + .05);
}

function synth(name, vol = 1) {
  let c;
  try { c = audioCtx(); } catch { return () => {}; }
  const now = c.currentTime + .02;
  const out = c.createGain();
  out.gain.value = settings.volume * vol;
  out.connect(c.destination);
  const stopAll = [];
  switch (name) {
    case 'engine': { // steady rocket rumble until stopped
      const n = noise(c, true), fl = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      fl.type = 'lowpass'; fl.frequency.value = 420; fl.Q.value = .7;
      lfo.frequency.value = 7; lg.gain.value = 60; lfo.connect(lg).connect(fl.frequency);
      env(g.gain, now, [[0, 0], [1.2, .9]]);
      n.connect(fl).connect(g).connect(out); n.start(now); lfo.start(now);
      const hiss = noise(c), hf = c.createBiquadFilter(), hg = c.createGain();
      hf.type = 'bandpass'; hf.frequency.value = 2200; hf.Q.value = .8; hg.gain.value = .05;
      hiss.connect(hf).connect(hg).connect(out); hiss.start(now);
      stopAll.push(() => { const t = c.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + .6); hg.gain.linearRampToValueAtTime(0, t + .6); [n, lfo, hiss].forEach(x => x.stop(t + .7)); });
      break;
    }
    case 'touchdown':
      noiseHit(c, out, now, { len: .7, gain: .9, f: 260, f2: 80, brown: true });
      tone(c, out, now, { f: 70, f2: 35, len: .5, gain: .5 });
      tone(c, out, now, { type: 'triangle', f: 520, f2: 480, at: .12, len: .25, gain: .06 }); // metal legs settling
      break;
    case 'crash':
      noiseHit(c, out, now, { len: 1.6, gain: 1, f: 2400, f2: 120 });
      tone(c, out, now, { f: 60, f2: 28, len: .9, gain: .7 });
      for (let i = 0; i < 6; i++) tone(c, out, now, { type: 'square', f: 300 + Math.random() * 900, at: .05 + i * .11 + Math.random() * .05, len: .12, gain: .05 }); // metal bits
      noiseHit(c, out, now, { at: .4, len: 1.2, gain: .25, type: 'bandpass', f: 900, q: .5 }); // debris
      break;
    case 'launch': { // ignition, then a roar that rises and fades into the sky
      const n = noise(c, true), fl = c.createBiquadFilter(), g = c.createGain();
      fl.type = 'lowpass'; fl.Q.value = .8;
      env(fl.frequency, now, [[0, 150], [1.3, 300], [3, 1100], [8, 500]]);
      env(g.gain, now, [[0, 0], [.3, .4], [1.3, .5], [1.6, 1], [5, .9], [8.5, 0]]);
      n.connect(fl).connect(g).connect(out); n.start(now); n.stop(now + 9);
      tone(c, out, now, { f: 45, f2: 30, at: 1.3, len: 4, gain: .45 });
      noiseHit(c, out, now, { at: 1.3, len: .8, gain: .5, f: 600, f2: 100 });
      break;
    }
    case 'lose': // alarm, then a sad falling tune and a low rumble
      for (let i = 0; i < 4; i++) tone(c, out, now, { type: 'square', f: 660, f2: 440, at: i * .35, len: .28, gain: .08 });
      [523, 466, 415, 349].forEach((f, i) => tone(c, out, now, { type: 'triangle', f, at: 1.6 + i * .45, len: i === 3 ? 1.6 : .42, gain: .2 }));
      tone(c, out, now, { type: 'sawtooth', f: 90, f2: 40, at: 1.4, len: 3.5, gain: .06 });
      noiseHit(c, out, now, { at: 1.4, len: 3.5, gain: .25, f: 300, f2: 60, brown: true });
      break;
    case 'alarm':
      for (let i = 0; i < 3; i++) tone(c, out, now, { type: 'square', f: 880, at: i * .22, len: .13, gain: .09 });
      break;
    case 'storm': { // electric crackle and whoosh
      noiseHit(c, out, now, { len: 1.8, gain: .5, type: 'bandpass', f: 3500, f2: 400, q: 1.5 });
      for (let i = 0; i < 14; i++) noiseHit(c, out, now, { at: Math.random() * 1.4, len: .03 + Math.random() * .05, gain: .5, type: 'highpass', f: 2500 });
      tone(c, out, now, { type: 'sawtooth', f: 120, f2: 40, len: 1.4, gain: .08 });
      break;
    }
    case 'build':
      [0, .16, .32].forEach((at, i) => { tone(c, out, now, { type: 'triangle', f: [320, 420, 360][i], at, len: .1, gain: .25 }); noiseHit(c, out, now, { at, len: .05, gain: .3, type: 'highpass', f: 3000 }); });
      tone(c, out, now, { f: 1320, at: .55, len: .25, gain: .12 });
      tone(c, out, now, { f: 1760, at: .7, len: .4, gain: .12 });
      break;
    case 'upgrade':
      [660, 880, 1100, 1320].forEach((f, i) => tone(c, out, now, { type: 'triangle', f, at: i * .08, len: .25, gain: .14 }));
      break;
    case 'rover': {
      const o = c.createOscillator(), fl = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = 85; lfo.frequency.value = 3; lg.gain.value = 12;
      lfo.connect(lg).connect(o.frequency);
      fl.type = 'lowpass'; fl.frequency.value = 500;
      env(g.gain, now, [[0, 0], [.3, .12], [1.8, .12], [2.4, 0]]);
      o.connect(fl).connect(g).connect(out); o.start(now); lfo.start(now); o.stop(now + 2.5); lfo.stop(now + 2.5);
      noiseHit(c, out, now, { len: 2.4, gain: .12, type: 'bandpass', f: 1500, q: .7 }); // gravel
      break;
    }
  }
  return () => stopAll.forEach(f => f());
}

// For testing in the browser console: which tracks are playing and how loud.
export const musicState = () => Object.fromEntries(Object.entries(players).map(([n, p]) => [n, { playing: !p.a.paused, vol: +p.vol.toFixed(2), webAudio: !!p.gain }]));
