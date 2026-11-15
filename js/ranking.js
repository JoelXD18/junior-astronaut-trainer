// World ranking for the Infinite mode (Supabase). No accounts and no personal data:
// - the player is a random code kept in this browser;
// - the nickname is picked from word lists (no free text) and stored as a code like "n3-a7-42",
//   so every player sees it in their own language ("Brave Comet 42" / "Cometa Valiente 42").
// The key below is Supabase's public ("publishable") key: it is meant to be in web pages. The database only
// lets anyone read scores and add new ones with the right shape; nobody can change or delete them.
import { LANGUAGES, lang } from './i18n.js';

const URL = 'https://rbecuknoaqullaaebezw.supabase.co/rest/v1/scores';
const KEY = 'sb_publishable_xvMOCuxC_6t4xMQu9uGDdw_02vJvoeS';
const HEADERS = { apikey: KEY, 'Content-Type': 'application/json' };

const store = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const load = k => { try { return localStorage.getItem(k); } catch { return null; } };
const rand = n => Math.floor(Math.random() * n);

export function playerId() {
  let id = load('jamt-player');
  if (!/^[a-z0-9]{12}$/.test(id || '')) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    id = Array.from({ length: 12 }, () => abc[rand(abc.length)]).join('');
    store('jamt-player', id);
  }
  return id;
}

const words = () => LANGUAGES[lang()].nickWords || LANGUAGES.en.nickWords;
export function newNick() {
  const w = LANGUAGES.en.nickWords;
  const code = `n${rand(w.nouns.length)}-a${rand(w.adjs.length)}-${1 + rand(99)}`;
  store('jamt-nick', code);
  return code;
}
export function myNick() { const c = load('jamt-nick'); return /^n\d{1,2}-a\d{1,2}-\d{1,2}$/.test(c || '') ? c : newNick(); }
export function nickName(code) {
  const m = /^n(\d+)-a(\d+)-(\d+)$/.exec(code || '');
  if (!m) return '?';
  const w = words();
  return (w.format || '{a} {n} {d}').replace('{n}', w.nouns[+m[1]] ?? '?').replace('{a}', w.adjs[+m[2]] ?? '?').replace('{d}', m[3]);
}

export async function submitScore(map, difficulty, days) {
  const r = await fetch(URL, {
    method: 'POST', headers: { ...HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ player: playerId(), nick: myNick(), map, difficulty, days }),
  });
  if (!r.ok) throw new Error('Ranking ' + r.status);
}

// Best score of each player, highest first. Returns { list: [{ nick, days, me }], myRank }.
export async function topScores(map, difficulty, limit = 10) {
  const q = `?select=player,nick,days,created_at&map=eq.${map}&difficulty=eq.${difficulty}&order=days.desc,created_at.asc&limit=300`;
  const r = await fetch(URL + q, { headers: HEADERS });
  if (!r.ok) throw new Error('Ranking ' + r.status);
  const rows = await r.json();
  const seen = new Set(), best = [];
  for (const row of rows) if (!seen.has(row.player)) { seen.add(row.player); best.push(row); }
  const me = playerId();
  const myIndex = best.findIndex(b => b.player === me);
  return {
    list: best.slice(0, limit).map((b, i) => ({ rank: i + 1, nick: b.nick, days: b.days, me: b.player === me })),
    myRank: myIndex >= 0 ? myIndex + 1 : null, myDays: myIndex >= 0 ? best[myIndex].days : null, players: best.length,
  };
}
