// Languages: one file per language in /lang. To add one, add a file and list it here.
import en from '../lang/en.js';
import es from '../lang/es.js';

export const LANGUAGES = { en, es };
const STORAGE_KEY = 'jamt-lang';

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: ignore */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function startLang() {
  const saved = load(STORAGE_KEY);
  if (saved && LANGUAGES[saved]) return saved;
  const browser = (navigator.language || 'en').slice(0, 2);
  return LANGUAGES[browser] ? browser : 'en';
}

let current = startLang();
const listeners = [];

export function lang() { return current; }

export function setLang(code) {
  if (!LANGUAGES[code] || code === current) return;
  current = code;
  store(STORAGE_KEY, code);
  document.documentElement.lang = code;
  listeners.forEach(fn => fn(code));
}

export function onLangChange(fn) { listeners.push(fn); }

// t('dayOf', { day: 3, total: 14 }) -> "Day 3 of 14". Falls back to English, then to the key.
export function t(key, vars = {}) {
  const text = LANGUAGES[current][key] ?? LANGUAGES.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
}

document.documentElement.lang = current;
