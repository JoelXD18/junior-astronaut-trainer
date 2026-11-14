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

function player(name) {
  if (!players[name]) {
    const a = new Audio(TRACKS[name].src);
    a.loop = TRACKS[name].loop;
    a.preload = 'none';
    a.volume = 0;
    players[name] = a;
  }
  return players[name];
}

const target = () => (settings.muted ? 0 : settings.volume * duck);

// Smoothly move every track towards its volume (current track up, others down to silence).
let fading = null;
function fade() {
  clearInterval(fading);
  fading = setInterval(() => {
    let busy = false;
    for (const [name, a] of Object.entries(players)) {
      const want = name === current ? target() : 0;
      const v = a.volume + Math.sign(want - a.volume) * Math.min(.05, Math.abs(want - a.volume));
      a.volume = Math.max(0, Math.min(1, v));
      if (Math.abs(a.volume - want) > .001) busy = true;
      if (name !== current && a.volume === 0 && !a.paused) a.pause();
    }
    if (!busy) clearInterval(fading);
  }, 40);
}

export function playMusic(name, { restart = false } = {}) {
  if (name === current && !restart) return;
  current = name;
  if (!unlocked || !name) return fade();
  const a = player(name);
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
  if (current) { const name = current; current = null; playMusic(name); }
}
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { once: false, passive: true }));

// Read a text aloud in the game's language (narrator for the tutorial). Music is lowered meanwhile.
export function speak(text, lang) {
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
export function stopSpeaking() { if ('speechSynthesis' in window) speechSynthesis.cancel(); setDuck(false); }

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
  if (!('speechSynthesis' in window)) { onLine?.(lines[lines.length - 1]); return; }
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
  // if speech is not available or never ends, move on after a reading time
  const guard = setTimeout(next, 1500 + l.text.length * 75);
  const voices = speechSynthesis.getVoices();
  if (!voices.length || settings.muted) return;
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
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setDuck(false);
}
