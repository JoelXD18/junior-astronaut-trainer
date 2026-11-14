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
