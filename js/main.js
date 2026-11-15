// Screens and controls. Every text comes from t() so the language can change at any moment.
// The 3D Moon base (scene.js) is always behind; the screens are drawn on top of it.
import { t, setLang, lang, onLangChange, LANGUAGES } from './i18n.js';
import { MAPS, DOSE_LIMIT, BUILDINGS, MAX_LEVEL, newGame, playDay, available, energyToday, isNight, forecast,
  batteryMax, oxygenMax, solarEnergy, batteryCap, tankCap, oxygenBonus, shieldBonus, shieldBlocks,
  validSpot, buildProblem, build, upgradeCost, upgradeProblem, upgrade, moveBuilding,
  ESCAPE, partsCollected, partsNeeded, roverCost, roverProblem, sendRover, canRepair, repairAndLaunch,
  roverDays, escapeDeadline, roverRepairProblem, repairRover, launchProblem } from './game.js';
import { initScene, setMode, setLabels, updateScene, playStorm, syncBuildings, setSelected, onPickBuilding,
  startPlacing, stopPlacing, resetView, setPlanet, playLanding, playLaunch, skipAnimation, resetLander, playIntro,
  setDebris, setCrashed, driveRover, returnRover, setRover, onPickDebris, playLose } from './scene.js';
import { isUnlocked, unlock, best, saveBest, unlockAll, setUnlockAll } from './progress.js';
import { playMusic, setVolume, toggleMute, audioSettings, speak, stopSpeaking, radio, stopRadio, radioBusy, radioTime, sfx } from './audio.js';
import { DEMOS } from './demos.js';
import { submitScore, topScores, myNick, newNick, nickName } from './ranking.js';
import { icon } from './icons.js';
import { loadSpaceWeather, getWeather, onWeather, flareStrength } from './spaceweather.js';

const has3d = initScene();
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');

let screen = 'menu';     // menu | map | difficulty | game | end | settings | credits
let game = null;
let choice = { oxygen: 0, shield: 0 };
let pick = { map: 'moon', difficulty: 'normal', mode: 'escape' };
let lastReport = null;   // report shown after ending a day
let openTerm = null;     // glossary word currently open
let showHelp = false;    // "how to play" tutorial (step by step)
let helpStep = 0;
let busy = false;        // true while a solar storm animation is playing
let ui = null;           // null | {kind:'build'} | {kind:'placing', type, moveId} | {kind:'selected', id}
let showSun = false;     // "real Sun" window with NASA DONKI data
let cinematic = null;    // null | 'landing' | 'launch' (HUD hidden while the camera tells the story)
let endInfo = {};        // extra info for the end screen (new record, map unlocked)
let helpSeen = false;

const fmtDate = iso => new Date(iso).toLocaleDateString(lang(), { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = iso => new Date(iso).toLocaleString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Small badge with the state of the real Sun (NASA DONKI). Says clearly if it's live or a saved copy.
function sunChip() {
  const w = getWeather();
  if (!w) return `<button class="sun-chip loading" data-action="sun">${icon('sun')}<span>${esc(t('sunLoading'))}</span></button>`;
  return `<button class="sun-chip ${w.activity.level}" data-action="sun">${icon('sun')}
    <span>${esc(t('realSun'))}: <b>${esc(t('act_' + w.activity.level))}</b></span>
    <span class="src ${w.source}">${esc(t(w.source === 'live' ? 'live' : 'saved'))}</span></button>`;
}

function flareChip(cls) {
  return `<span class="flare-chip f${cls[0]}">${esc(cls)}</span>`;
}

function sunHtml() {
  const w = getWeather();
  if (!w) return windowHtml(esc(t('realSunTitle')), `<p>${esc(t('sunLoading'))}</p>`, { close: 'close-sun' });
  const a = w.activity;
  const latest = w.flares.slice(0, 5).map(f => `<li>${flareChip(f.cls)}<span>${esc(fmtDate(f.t))}</span></li>`).join('');
  const source = w.source === 'live'
    ? t('sourceLive', { time: fmtTime(w.time) })
    : t('sourceSaved', { date: fmtDate(w.time) });
  return windowHtml(`${icon('sun')} ${esc(t('realSunTitle'))}`, `
    <p class="big-fact">${esc(t('sunWeek', { n: a.week, big: a.big }))} <b class="act ${a.level}">${esc(t('act_' + a.level))}</b></p>
    <h3>${esc(t('latestFlares'))}</h3>
    <ul class="flare-list">${latest}</ul>
    <div class="scale"><span>${flareChip('C')} ${esc(t('scaleC'))}</span><span>${flareChip('M')} ${esc(t('scaleM'))}</span><span>${flareChip('X')} ${esc(t('scaleX'))}</span></div>
    <p>${esc(t('sunHowGame'))}</p>
    <p class="source ${w.source}">${icon(w.source === 'live' ? 'energy' : 'warning')} ${esc(source)}
      <a href="https://ccmc.gsfc.nasa.gov/DONKI/" target="_blank" rel="noopener">NASA DONKI</a></p>
    <button class="btn green" data-action="close-sun"><span>${esc(t('close'))}</span></button>`, { close: 'close-sun' });
}

// Music used in the game (all from Pixabay, Pixabay Content License).
const MUSIC = [
  { title: 'Synthwave No Copyright', author: 'MiroMaxMusic', url: 'https://pixabay.com/es/music/pop-sintetizado-synthwave-no-copyright-630654/' },
  { title: 'Background Music', author: 'JonasBlakewood', url: 'https://pixabay.com/es/music/sintetizador-background-music-618629/' },
  { title: 'The Grid Part', author: 'pietiX', url: 'https://pixabay.com/es/music/electr%C3%B3nico-the-grid-part-514948/' },
  { title: 'Robo Cop (Synthwave)', author: 'Sub_Clair', url: 'https://pixabay.com/es/music/sintetizador-robo-cop-synthwave-100bpm-117s-12714/' },
  { title: 'Metropolis of Progress (Cinematic Orchestral)', author: 'Luis_Humanoide', url: 'https://pixabay.com/es/music/titulo-principal-metropolis-of-progress-cinematic-orchestral-298820/' },
];

const BICON = { solar: 'sun', battery: 'battery', tank: 'tank', oxygen: 'oxygen', shield: 'shield' };
const freeEnergy = () => available(game) - choice.oxygen - choice.shield;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// What a building does at a given level, in words for kids.
function effectText(type, level) {
  switch (type) {
    case 'solar': return t('effSolar', { n: solarEnergy(level) });
    case 'battery': return t('effBattery', { n: batteryCap(level) });
    case 'tank': return t('effTank', { n: tankCap(level) });
    case 'oxygen': return oxygenBonus(level) ? t('effOxygenPlus', { b: oxygenBonus(level) }) : t('effOxygen');
    case 'shield': return shieldBonus(level) ? t('effShieldPlus', { b: shieldBonus(level) }) : t('effShield');
  }
}

function go(next) {
  if (next === 'menu') stopRadio();
  if (next === 'ranking') loadRank();
  if (next === 'menu' && has3d) { resetLander(); stopPlacing(); setPlanet('moon'); }
  screen = next; render();
}

function langPicker() {
  return `<div class="lang-picker" role="group" aria-label="${esc(t('language'))}">
    ${Object.keys(LANGUAGES).map(code =>
      `<button data-lang="${code}" class="${code === lang() ? 'on' : ''}">${code.toUpperCase()}</button>`).join('')}
  </div>`;
}

// A "window" in game style: title ribbon + close button.
function windowHtml(title, body, { close = 'close-ui', cls = '' } = {}) {
  return `<div class="window ${cls}" role="dialog" aria-modal="true">
    <div class="win-head"><h2>${title}</h2>${close ? `<button class="x-btn" data-action="${close}" aria-label="${esc(t('close'))}">${icon('close')}</button>` : ''}</div>
    <div class="win-body">${body}</div>
  </div>`;
}

// ---------- menu screens ----------

function menuScreen() {
  return `<section class="menu">
    <div class="logo">
      <span class="logo-small">${esc(t('logoTop'))}</span>
      ${brandTitle()}
      <span class="logo-sub">${esc(t('subtitle'))}</span>
      <span class="event-badge">${icon('rocket')}<span>${esc(t('madeFor'))}</span></span>
    </div>
    <div class="stack">
      <button class="btn green xl" data-go="map">${icon('play')}<span>${esc(t('play'))}</span></button>
      <button class="btn blue" data-go="settings">${icon('gear')}<span>${esc(t('settings'))}</span></button>
      <button class="btn blue" data-go="data">${icon('radiation')}<span>${esc(t('nasaData'))}</span></button>
      <button class="btn blue" data-go="ranking">${icon('trophy')}<span>${esc(t('ranking'))}</span></button>
      <button class="btn blue" data-go="credits">${icon('menu')}<span>${esc(t('credits'))}</span></button>
    </div>
    ${sunChip()}
    ${langPicker()}
  </section>`;
}

function centered(inner) { return `<section class="centered">${inner}</section>`; }

function mapScreen() {
  return centered(windowHtml(esc(t('chooseMap')), `<div class="choice-cards">
      <button class="choice" data-map="moon"><span class="c-ico">${icon('moon')}</span><strong>${esc(t('moon'))}</strong><small>${esc(t('moonDesc'))}</small></button>
      ${isUnlocked('mars')
        ? `<button class="choice mars" data-map="mars"><span class="c-ico">${icon('mars')}</span><strong>${esc(t('mars'))}</strong><small>${esc(t('marsDesc'))}</small></button>`
        : `<button class="choice locked" disabled><span class="c-ico">🔒</span><strong>${esc(t('mars'))}</strong><small>${esc(t('marsLocked'))}</small></button>`}
    </div>`, { close: null }) + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

function modeScreen() {
  const m = MAPS[pick.map];
  return centered(windowHtml(esc(t('chooseMode')), `<div class="choice-cards three">
      <button class="choice" data-mode="escape"><span class="c-ico">${icon('rocket')}</span><strong>${esc(t('modeEscape'))}</strong><small>${esc(t('modeEscapeDesc', { n: ESCAPE.parts }))}</small></button>
      <button class="choice" data-mode="survival"><span class="c-ico">${icon('shield')}</span><strong>${esc(t('modeSurvival'))}</strong><small>${esc(t('modeSurvivalDesc', { n: m.missionDays }))}</small></button>
      <button class="choice" data-mode="infinite"><span class="c-ico">${icon('trophy')}</span><strong>${esc(t('modeInfinite'))}</strong><small>${esc(t('modeInfiniteDesc'))}</small></button>
    </div>`, { close: null }) + `<button class="btn grey back" data-go="map">← ${esc(t('back'))}</button>`);
}

function difficultyScreen() {
  const stars = { easy: 1, normal: 2, hard: 3 };
  return centered(windowHtml(esc(t('chooseDifficulty')), `<div class="choice-cards three">
      ${['easy', 'normal', 'hard'].map(d => `<button class="choice ${d}" data-difficulty="${d}">
        <span class="c-stars">${'★'.repeat(stars[d])}${'☆'.repeat(3 - stars[d])}</span>
        <strong>${esc(t(d))}</strong><small>${esc(t(d + 'Desc'))}</small></button>`).join('')}
    </div>`, { close: null }) + `<button class="btn grey back" data-go="mode">← ${esc(t('back'))}</button>`);
}

function settingsScreen() {
  return centered(windowHtml(esc(t('settings')), `<h3>${esc(t('language'))}</h3>${langPicker()}
    <h3>${esc(t('music'))}</h3>
    <div class="vol-row">${icon(audioSettings().muted ? 'mute' : 'sound')}<input type="range" min="0" max="1" step="0.05" value="${audioSettings().volume}" data-volume aria-label="${esc(t('music'))}"><button class="btn small ${audioSettings().muted ? 'grey' : 'green'}" data-action="mute"><span>${esc(t(audioSettings().muted ? 'off' : 'on'))}</span></button></div>
    <h3>${esc(t('unlockAllTitle'))}</h3>
    <button class="btn ${unlockAll() ? 'green' : 'grey'} small" data-action="toggle-unlock"><span>${esc(t(unlockAll() ? 'on' : 'off'))}</span></button>
    <p class="small">${esc(t('unlockAllHint'))}</p>`, { close: null })
    + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

function dataScreen() {
  const w = getWeather();
  const sec = (ico, title, what, why) => `<div class="data-sec">${icon(ico)}<div><h3>${esc(title)}</h3><p>${esc(what)}</p><p class="why">${esc(why)}</p></div></div>`;
  return centered(windowHtml(esc(t('nasaData')), `
    <p>${esc(t('dataIntro'))}</p>
    ${sec('sun', t('dataDonkiTitle'), t('dataDonkiWhat', { n: w ? w.flares.length : '…' }), t('dataDonkiWhy'))}
    <p class="source ${w?.source || ''}">${w ? esc(w.source === 'live' ? t('sourceLive', { time: fmtTime(w.time) }) : t('sourceSaved', { date: fmtDate(w.time) })) : ''}
      <a href="https://ccmc.gsfc.nasa.gov/DONKI/" target="_blank" rel="noopener">ccmc.gsfc.nasa.gov/DONKI</a></p>
    ${sec('radiation', t('dataRadTitle'), t('dataRadWhat'), t('dataRadWhy'))}
    <p class="source saved">${esc(t('dataRadSource'))} <a href="https://visualization.osdr.nasa.gov/radlab/" target="_blank" rel="noopener">NASA OSDR RadLab</a></p>
    ${sec('home', t('dataModelsTitle'), t('dataModelsWhat'), t('dataModelsWhy'))}
    <p class="source saved"><a href="https://github.com/nasa/NASA-3D-Resources" target="_blank" rel="noopener">NASA 3D Resources</a></p>`,
    { close: null, cls: 'data-win' }) + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

// ---------- world ranking (Infinite mode) ----------
const rank = { map: 'moon', difficulty: 'normal', status: 'idle', data: null };
const rankCache = {}; // lists already seen: shown at once while the fresh one loads
function loadRank(map = rank.map, difficulty = rank.difficulty) {
  const key = map + '|' + difficulty;
  Object.assign(rank, { map, difficulty, status: rankCache[key] ? 'ok' : 'loading', data: rankCache[key] || null });
  topScores(map, difficulty)
    .then(data => { rankCache[key] = data; if (rank.map === map && rank.difficulty === difficulty) Object.assign(rank, { status: 'ok', data }); })
    .catch(() => { if (!rankCache[key]) rank.status = 'error'; })
    .finally(() => { if (screen === 'ranking' || screen === 'end') render(); });
}
// Always the top 10 places; an empty place shows "-".
function rankList(data) {
  const rows = Array.from({ length: 10 }, (_, i) => data?.list[i] || { rank: i + 1, empty: true });
  return `<ol class="rank-list">${rows.map(r => `<li class="${r.me ? 'me' : ''} ${r.empty ? 'empty' : ''}"><span class="rk">#${r.rank}</span>
    <span class="rn">${r.empty ? '-' : esc(nickName(r.nick))}${r.me ? ` <small>${esc(t('rankYou'))}</small>` : ''}</span>
    <span class="rd">${r.empty ? '-' : esc(t('rankDays', { n: r.days }))}</span></li>`).join('')}</ol>
    ${data?.myRank > 10 ? `<p class="rank-mine">${esc(t('rankPos', { r: data.myRank, p: data.players, n: data.myDays }))}</p>` : ''}`;
}
// The player's astronaut name, big and clear. It is picked at random once and kept, so it never changes.
function nickCard() {
  return `<div class="nick-card"><span class="nc-label">🧑‍🚀 ${esc(t('rankYouAre'))}</span>
    <span class="nc-name">${esc(nickName(myNick()))}</span>
    <span class="nc-hint">${esc(t('rankNickHint'))}</span></div>`;
}
function rankingScreen() {
  const tab = (attr, val, label, on) => `<button class="rank-tab ${on ? 'on' : ''}" ${attr}="${val}">${label}</button>`;
  const body = rank.status === 'loading' ? `<div class="rank-loading" aria-label="${esc(t('rankLoading'))}">${rankList(null)}</div>`
    : rank.status === 'error' ? `<p class="notice bad">${icon('warning')} ${esc(t('rankError'))}</p>` : rankList(rank.data);
  return centered(windowHtml(`${icon('trophy')} ${esc(t('rankTitle'))}`, `
    ${nickCard()}
    <p class="rank-intro">${icon('trophy')} <span>${esc(t('rankIntro'))}</span></p>
    <div class="rank-tabs">${tab('data-rank-map', 'moon', `${icon('moon')} ${esc(t('moon'))}`, rank.map === 'moon')}${tab('data-rank-map', 'mars', `${icon('mars')} ${esc(t('mars'))}`, rank.map === 'mars')}</div>
    <div class="rank-tabs small-tabs">${['easy', 'normal', 'hard'].map(d => tab('data-rank-diff', d, esc(t(d)), rank.difficulty === d)).join('')}</div>
    ${body}`,
    { close: null }) + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}
// End of an Infinite game: offer to upload the record (only if you lasted at least one day).
function rankOffer(days) {
  const r = endInfo.rank || (endInfo.rank = { state: 'ask' });
  if (days < 1) return '';
  if (r.state === 'skipped') return '';
  if (r.state === 'ask') return `<div class="rank-offer"><p><b>${esc(t('rankAsk', { n: days }))}</b></p>
    ${nickCard()}
    <div class="sel-actions"><button class="btn green" data-action="rank-send">${icon('trophy')}<span>${esc(t('rankSend'))}</span></button>
    <button class="btn grey" data-action="rank-skip"><span>${esc(t('rankSkip'))}</span></button></div></div>`;
  if (r.state === 'sending') return `<div class="rank-offer"><p>${esc(t('rankSending'))}</p></div>`;
  if (r.state === 'error') return `<div class="rank-offer"><p class="notice bad">${icon('warning')} ${esc(t('rankError'))}</p>
    <button class="btn blue" data-action="rank-send"><span>${esc(t('rankRetry'))}</span></button></div>`;
  return `<div class="rank-offer"><p class="rank-ok">${icon('trophy')} ${esc(t('rankSent'))}</p>${rank.status === 'ok' ? rankList(rank.data) : ''}</div>`;
}

function creditsScreen() {
  return centered(windowHtml(esc(t('credits')), `<div class="credits-brand">${brandTitle()}</div>
    <p>${esc(t('creditsText'))}</p>
    <p>${esc(t('creditsGame'))}</p>
    <p class="credit-link"><a href="https://www.linkedin.com/in/joel-ramos-lazaro" target="_blank" rel="noopener">in</a> ${esc(t('creditsLinkedin'))} <a href="https://www.linkedin.com/in/joel-ramos-lazaro" target="_blank" rel="noopener">Joel Ramos Lázaro</a></p>
    <h3>${esc(t('creditsData'))}</h3>
    <ul class="credit-list">
      <li>${esc(t('creditsModels'))}</li>
      <li>${esc(t('creditsEarth'))}</li>
      <li>${esc(t('creditsDataSoon'))}</li>
      <li>${esc(t('creditsTools'))}</li>
      <li>${esc(t('crMusic'))} (Pixabay): ${MUSIC.map(m => `<a href="${m.url}" target="_blank" rel="noopener">${esc(m.title)}</a> – ${esc(m.author)}`).join(', ')}</li>
    </ul>`, { close: null }) + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

// ---------- game HUD ----------

// Decorated resource bar: name on top, glossy bar, big icon on the end. Tap it to learn what it is.
function resBar(kind, ico, label, value, max, text, term) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<button class="res ${kind}" ${term ? `data-term="${term}"` : ''}>
    <span class="res-label">${esc(label)}</span>
    <span class="res-track"><span class="res-fill" style="width:${pct}%"></span><span class="res-num">${text}</span></span>
    <span class="res-ico">${icon(ico)}</span>
  </button>`;
}

function gameScreen() {
  const map = MAPS[game.map];
  const night = isNight(map, game.day);
  const fc = forecast(game);
  // Strip of days: the mission (story) or the current lunar day+night cycle (survival). Mars has none.
  let strip = '';
  if (map.cycle || game.mode === 'survival') {
    const len = game.mode === 'survival' ? map.missionDays : map.cycle;
    const first = game.mode === 'survival' ? 1 : game.day - ((game.day - 1) % map.cycle);
    for (let i = 0; i < len; i++) { const d = first + i; strip += `<i class="${isNight(map, d) ? 'n' : 's'} ${d < game.day ? 'past' : ''} ${d === game.day ? 'now' : ''}"></i>`; }
  }
  const dayWord = t(game.map === 'mars' ? 'solLabel' : 'dayLabel');
  const limit = game.mode === 'survival' ? map.missionDays : game.mode === 'escape' ? escapeDeadline(game) : 0;
  const total = limit ? `<small>/${limit}</small>` : '';
  const bottom = !ui ? dock()
    : ui.kind === 'debris' ? debrisWindow()
    : ui.kind === 'build' ? buildWindow()
    : ui.kind === 'placing' ? placingBar()
    : selectedWindow();

  return `<section class="hud ${night ? 'is-night' : ''} ${cinematic ? 'cinematic' : ''}">
    <div class="top-left">
      <button class="day-plate" data-term="${game.map === 'mars' ? 'Sol' : night ? 'Night' : 'Day'}">
        <span class="day-ico">${icon(night ? 'moon' : 'sun')}</span>
        <span class="day-text"><span class="day-label">${esc(dayWord)}</span><span class="day-num">${game.day}${total}</span></span>
      </button>
      ${strip ? `<div class="strip" aria-hidden="true">${strip}</div>` : ''}
      ${game.mode === 'escape' ? `<button class="ribbon parts" data-term="Parts">${icon('gear')}<span>${esc(t('partsShort', { n: partsCollected(game), m: partsNeeded() }))}</span></button>` : ''}
      ${roverRibbon()}
      ${game.mode === 'escape' && launchProblem(game, freeEnergy()) === 'storm' ? `<button class="ribbon rover-broken" data-term="Storm">${icon('rocket')}<span>${esc(t('launchStorm'))}</span></button>` : ''}
      ${game.dust > 0 ? `<button class="ribbon dust" data-term="Dust">${icon('warning')}<span>${esc(t('dustShort', { n: game.dust }))}</span></button>` : ''}
      ${fc.warned
        ? `<button class="ribbon warn" data-term="Storm">${icon('warning')}<span>${esc(t('warnShort'))}</span>${fc.hint ? flareChip(fc.hint) : ''}</button>`
        : `<button class="ribbon calm" data-term="Storm"><span>${esc(t('calmShort'))}</span></button>`}
      ${sunChip()}
    </div>

    <div class="top-right">
      ${resBar('o2', 'oxygen', t('oxygen'), game.oxygen, oxygenMax(game), `${game.oxygen}<small>/${oxygenMax(game)}</small>`, 'Oxygen')}
      ${resBar('rad', 'radiation', t('dose'), game.dose, DOSE_LIMIT, `${game.dose}%`, 'Dose')}
      ${resBar('bat', 'battery', t('battery'), game.battery, batteryMax(game), `${game.battery}<small>/${batteryMax(game)}</small>`, 'Battery')}
      <div class="side-btns">
        ${langPicker()}
        <button class="round-btn" data-action="reset-view" title="${esc(t('resetView'))}" aria-label="${esc(t('resetView'))}">${icon('target')}</button>
        <button class="round-btn" data-action="mute" aria-label="${esc(t('music'))}">${icon(audioSettings().muted ? 'mute' : 'sound')}</button>
        <button class="round-btn" data-action="help" aria-label="${esc(t('howToPlay'))}">${icon('question')}</button>
        <button class="round-btn" data-go="menu" aria-label="${esc(t('mainMenu'))}">${icon('menu')}</button>
      </div>
    </div>

    <div class="bottom">${bottom}</div>
  </section>
  ${cinematic === 'landing' ? `<div class="landing-cap"><span class="cap-who" id="cap-who"></span><span class="cap-phase" id="cap-phase"></span></div>` : ''}
  ${cinematic ? `<button class="btn grey small skip" data-action="skip">${esc(t('skip'))} ⏭</button>` : ''}`;
}

function dock() {
  const total = available(game);
  const left = total - choice.oxygen - choice.shield;
  const toBattery = Math.min(batteryMax(game), left);
  const lost = left - toBattery;
  const blocks = shieldBlocks(game, choice.shield);
  const o2 = choice.oxygen + (choice.oxygen > 0 ? oxygenBonus(levelOf('oxygen')) : 0);
  const slot = (field, ico, label, out, max) => `<div class="slot ${field}">
      <span class="slot-label">${esc(label)}</span>
      <span class="slot-ico">${icon(ico)}</span>
      <div class="slot-ctrl">
        <button class="pm minus" data-step="${field}" data-d="-1" ${choice[field] <= 0 || busy ? 'disabled' : ''} aria-label="−">−</button>
        <output>${choice[field]}</output>
        <button class="pm plus" data-step="${field}" data-d="1" ${choice[field] >= max || busy ? 'disabled' : ''} aria-label="+">+</button>
      </div>
      <span class="slot-out">${out}</span>
    </div>`;
  return `<div class="dock">
    <button class="energy-orb" data-term="Energy">
      <span class="orb-ico">${icon('energy')}</span>
      <span class="orb-num">${left}</span>
      <span class="orb-label">${esc(t('energyLabel'))}</span>
      <span class="orb-of">${esc(t('energyOf', { n: total }))}</span>
    </button>
    ${slot('oxygen', 'oxygen', t('oxygen'), `+${o2} O₂`, total - choice.shield)}
    ${slot('shield', 'shield', t('shieldLabel'), blocks ? esc(t('shieldBlocksToday', { n: blocks })) : '—', total - choice.oxygen)}
    <div class="slot battery ${lost > 0 ? 'full' : ''}">
      <span class="slot-label">${esc(t('battery'))}</span>
      <span class="slot-ico">${icon('battery')}</span>
      <div class="slot-ctrl"><output>+${toBattery}</output></div>
      <span class="slot-out">${lost > 0 ? esc(t('lostShort', { n: lost })) : esc(t('savedShort'))}</span>
    </div>
    <div class="dock-actions">
      ${game.mode === 'escape' && partsCollected(game) >= partsNeeded()
        ? `<button class="btn orange build repair" data-action="repair" ${busy || !canRepair(game, freeEnergy()) ? 'disabled' : ''}>${icon('rocket')}<span>${esc(t('repairLaunch'))}</span><span class="price">${icon('energy')}${ESCAPE.repairCost}</span></button>`
        : `<button class="btn orange build" data-action="open-build" ${busy ? 'disabled' : ''}>${icon('hammer')}<span>${esc(t('build'))}</span></button>`}
      <button class="btn green end" data-action="end-day" ${busy ? 'disabled' : ''}><span>${esc(t('endDay'))}</span>${icon('play')}</button>
    </div>
  </div>`;
}

const levelOf = type => (game.buildings.find(b => b.type === type) || { level: 1 }).level;
const countOf = type => game.buildings.filter(b => b.type === type).length;

function buildWindow() {
  const budget = freeEnergy();
  const cards = ['solar', 'battery', 'tank'].map(type => {
    const info = BUILDINGS[type];
    const problem = buildProblem(game, type, budget);
    return `<button class="shop-card" data-build="${type}" ${problem ? 'disabled' : ''}>
      <span class="shop-ico">${icon(BICON[type])}</span>
      <strong>${esc(t('b_' + type))}</strong>
      <small>${esc(type === 'solar' ? t('effSolarNew', { n: solarEnergy(1) }) : effectText(type, 1))}</small>
      <span class="price">${icon('energy')}${info.cost}</span>
      <span class="count">${countOf(type)}/${info.max}</span>
    </button>`;
  }).join('');
  return windowHtml(`${icon('hammer')} ${esc(t('buildTitle'))} <span class="budget">${icon('energy')}${budget}</span>`,
    `<div class="shop">${cards}</div>`, { cls: 'shop-win' });
}

function placingBar() {
  return `<div class="place-bar">
    <span class="place-ico">${icon(BICON[ui.type])}</span>
    <span>${esc(t(ui.moveId ? 'moveHint' : 'placeHint', { name: t('b_' + ui.type) }))}</span>
    <button class="btn red small" data-action="cancel-place">${esc(t('cancel'))}</button>
  </div>`;
}

function selectedWindow() {
  const b = game.buildings.find(x => x.id === ui.id);
  if (!b) { ui = null; return dock(); }
  const cost = upgradeCost(b);
  const problem = upgradeProblem(game, b, freeEnergy());
  const stars = `<span class="stars">${'★'.repeat(b.level)}<i>${'★'.repeat(MAX_LEVEL - b.level)}</i></span>`;
  return windowHtml(`${icon(BICON[b.type])} ${esc(t('b_' + b.type))} ${stars}`, `
    <p class="effect">${esc(effectText(b.type, b.level))}</p>
    ${cost != null ? `<p class="effect next">⬆ ${esc(effectText(b.type, b.level + 1))}</p>` : `<p class="effect next">${esc(t('maxLevel'))}</p>`}
    <div class="sel-actions">
      ${cost != null ? `<button class="btn green" data-action="upgrade" ${problem ? 'disabled' : ''}><span>${esc(t('upgrade'))}</span><span class="price">${icon('energy')}${cost}</span></button>` : ''}
      ${BUILDINGS[b.type].movable ? `<button class="btn blue" data-action="move"><span>${esc(t('move'))}</span></button>` : ''}
    </div>`, { cls: 'sel-win' });
}

function endScreen() {
  const map = MAPS[game.map];
  const key = { won: game.mode === 'escape' ? 'wonEscape' : 'won', 'lost-oxygen': 'lostOxygen', 'lost-dose': 'lostDose', 'lost-time': 'lostTime' }[game.status];
  const done = game.status === 'won' && game.mode === 'survival' ? map.missionDays : game.status === 'won' ? game.day : game.status === 'lost-time' ? game.day : game.day - 1;
  const ico = game.status === 'won' ? 'trophy' : game.status === 'lost-oxygen' ? 'oxygen' : game.status === 'lost-time' ? 'gear' : 'radiation';
  const survival = game.mode === 'infinite';
  const lost = game.status !== 'won';
  // losing: a red title ("Mission failed" / "Game over" in infinite mode) and a red box with the reason
  const title = lost ? `${icon('warning')} ${esc(t(survival ? 'gameOver' : 'youLost'))}` : esc(t(key + 'Title'));
  return centered(windowHtml(title, `
    ${lost ? `<div class="lose-cause"><span class="lc-ico">${icon(ico)}</span><div><span class="lc-why">${esc(t('loseWhy'))}</span><strong>${esc(t(key + 'Title'))}</strong></div></div>`
      : `<div class="end-ico">${icon(survival ? 'trophy' : ico)}</div>`}
    ${survival ? `<p class="record">${esc(t('survivalDays', { n: done }))}</p>
      <p class="small">${esc(t(endInfo.newRecord ? 'newRecord' : 'bestRecord', { n: best(game.map, game.difficulty) }))}</p>
      ${rankOffer(done)}` : ''}
    <p>${esc(t(key + 'Text', { n: map.oxygenUse, d: escapeDeadline(game) }))}</p>
    ${game.status !== 'won' ? `<p class="end-tip">${icon('question')} ${esc(t(key + 'Tip'))}</p>` : ''}
    ${endInfo.unlocked ? `<p class="unlocked">${icon('mars')} ${esc(t('marsUnlocked'))}</p>` : ''}
    <div class="end-stats">
      <span>${icon('sun')} ${esc(t('daysSurvived', { n: done }))}</span>
      <span>${icon('radiation')} ${esc(t('finalDose', { d: game.dose }))}</span>
      ${game.mode === 'escape' ? `<span>${icon('gear')} ${esc(t('partsShort', { n: partsCollected(game), m: partsNeeded() }))}</span>` : ''}
    </div>
    <div class="stack">
      <button class="btn green" data-action="again"><span>${esc(t('playAgain'))}</span></button>
      <button class="btn blue" data-go="menu"><span>${esc(t('mainMenu'))}</span></button>
    </div>`, { close: null, cls: 'end ' + game.status + (lost ? ' lost' : '') }));
}

function creditsRoll() {
  const line = (a, b = '') => `<div class="cr-line"><span>${esc(a)}</span>${b ? `<strong>${esc(b)}</strong>` : ''}</div>`;
  return `<section class="credits-roll">
    <div class="cr-scroll">
      <div class="cr-brand">${brandTitle()}</div>
      <p class="cr-tag">${esc(t(game.map === 'mars' ? 'crEndMars' : 'crEndMoon'))}</p>
      ${line(t('crIdea'), 'JoelXD18')}
      ${line(t('crCode'), 'JoelXD18 + Claude (Anthropic AI)')}
      ${line(t('crData'), 'NASA DONKI · NASA OSDR RadLab')}
      ${line(t('crModels'), 'NASA 3D Resources')}
      ${line(t('crEngine'), 'three.js')}
      <div class="cr-line"><span>${esc(t('crMusic'))}</span>${MUSIC.map(m => `<strong>${esc(m.title)}</strong><em>${esc(m.author)} · Pixabay</em>`).join('')}</div>
      ${line(t('crVoices'), 'Google Gemini (AI) · ' + t('crSfx'))}
      ${line(t('crFonts'), 'Lilita One · Nunito · Orbitron (Google Fonts)')}
      ${line(t('crChallenge'), 'NASA Space Apps Challenge 2026')}
      ${line(t('crEvent'), 'Salamanca')}
      <p class="cr-thanks">${esc(t('crThanks'))}</p>
    </div>
    <button class="btn grey small skip" data-action="end-credits">${esc(t('skip'))} ⏭</button>
  </section>`;
}

function roverRibbon() {
  const rv = game.mode === 'escape' && game.rover;
  if (!rv || rv.status === 'home') return '';
  if (rv.status === 'out') return `<button class="ribbon rover-out" data-term="Parts">${icon('gear')}<span>${esc(t(rv.daysLeft > 1 ? 'roverOutDays' : 'roverOutTonight', { n: rv.daysLeft }))}</span></button>`;
  const problem = roverRepairProblem(game, freeEnergy());
  return `<button class="ribbon rover-broken" data-action="repair-rover" ${problem || busy ? 'disabled' : ''}>${icon('warning')}<span>${esc(t('roverBrokenFix'))}</span><span class="price">${icon('energy')}${ESCAPE.roverRepair}</span></button>`;
}

function debrisWindow() {
  const d = game.debris.find(x => x.id === ui.id);
  if (!d || d.collected) { ui = null; return dock(); }
  const cost = roverCost(d), problem = roverProblem(game, d, freeEnergy());
  const dist = Math.round(Math.hypot(d.x - ESCAPE.landing[0], d.z - ESCAPE.landing[1]));
  const warned = forecast(game).warned;
  return windowHtml(`${icon('gear')} ${esc(t('partTitle'))}`, `
    <p class="effect">${esc(t('partText', { m: dist }))}</p>
    <p class="effect next">${esc(t('roverCostText', { e: cost, o: ESCAPE.suitOxygen, d: roverDays(d) }))}</p>
    ${warned ? `<p class="notice bad">${icon('warning')} ${esc(t('roverStormWarn'))}</p>` : ''}
    ${problem && problem !== 'collected' ? `<p class="notice bad">${icon('warning')} ${esc(t('rover_' + problem, { n: game.rover.daysLeft }))}</p>` : ''}
    <div class="sel-actions">
      <button class="btn green" data-action="send-rover" ${problem || busy ? 'disabled' : ''}><span>${esc(t('sendRover'))}</span><span class="price">${icon('energy')}${cost}</span></button>
    </div>`, { cls: 'sel-win' });
}

function syncScene() {
  if (!has3d || !game) return;
  syncBuildings(game.buildings.map(b => ({ ...b, radius: BUILDINGS[b.type].radius })));
  setDebris(game.mode === 'escape' ? game.debris : null);
  if (game.mode === 'escape') setRover(game.rover);
  setSelected(ui?.kind === 'selected' ? ui.id : null);
}

// ---------- dialogs ----------

function reportHtml(r) {
  const map = MAPS[game.map];
  const items = [];
  if (r.storm > 0) {
    const full = r.blocked >= r.storm;
    items.push(['shield', full ? t('stormBlocked', { s: r.storm }) : t('stormPartial', { s: r.storm, b: r.blocked, d: r.stormDose }), full ? 'good' : 'bad']);
    if (r.flare) items.push(['sun', t('realFlare', { cls: r.flare.cls, date: fmtDate(r.flare.t) }), 'nasa']);
    if (!r.warned) items.push(['warning', t('surprise'), '']);
  } else {
    items.push(['sun', t('stormNone'), 'good']);
    if (r.warned) items.push(['shield', t('falseAlarm'), 'good']);
    if (r.shield > 0) items.push(['shield', t('shieldUnused', { n: r.shield }), '']);
  }
  if (r.outsideDose) items.push(['radiation', t('outsideStorm', { d: r.outsideDose }), 'bad']);
  if (r.partBack) items.push(['gear', t('partBackReport', { n: partsCollected(game), m: partsNeeded() }), 'good']);
  if (r.roverHit) items.push(['warning', t('roverHitReport'), 'bad']);
  if (r.roverBroken) items.push(['warning', t('roverBrokenReport', { e: ESCAPE.roverRepair }), 'bad']);
  if (r.roverDaysLeft) items.push(['gear', t('roverStillOut', { n: r.roverDaysLeft }), '']);
  if (game.mode === 'escape' && r.status === 'playing') {
    const left = escapeDeadline(game) - game.day + 1;
    if (left <= 4) items.push(['warning', t('escapeDaysLeft', { n: left }), 'bad']);
  }
  if (r.spent) items.push(['hammer', t(game.mode === 'escape' ? 'spentMsgEscape' : 'spentMsg', { n: r.spent }), '']);
  if (r.baseDose) items.push(['radiation', t('baseDoseMsg', { d: r.baseDose }), '']);
  items.push(['oxygen', t('oxygenMsg', { use: map.oxygenUse, left: game.oxygen }), game.oxygen <= map.oxygenUse ? 'bad' : '']);
  if (r.oxygenLost > 0) items.push(['oxygen', t('oxygenTankFull', { n: r.oxygenLost }), 'bad']);
  if (r.wasted > 0) items.push(['battery', t('wastedMsg', { n: r.wasted }), 'bad']);
  if (r.status === 'playing' && !r.night && isNight(map, r.day + 1)) items.push(['moon', t('nightComing'), 'bad']);
  if (r.dustStarted) items.push(['warning', t('dustStarted', { n: game.dust }), 'bad']);
  const done = r.status !== 'playing';
  return windowHtml(esc(t('reportTitle', { day: r.day })),
    `<ul class="report">${items.map(([i, l, c]) => `<li class="${c}">${icon(i)}<span>${esc(l)}</span></li>`).join('')}</ul>
    <button class="btn green" data-action="close-report"><span>${esc(t(done ? 'seeResult' : 'nextDay'))}</span>${icon('play')}</button>`,
    { close: null });
}

// Tutorial: one thing at a time. Text (with a button to hear it), a short animation, then "Next".
function tutorialSteps() {
  const map = MAPS[game.map], mars = game.map === 'mars';
  return [
    { icon: 'energy', title: t('tutEnergy'), text: t('help1'), demo: 'energy', cls: 'c-energy' },
    { icon: 'oxygen', title: t('tutOxygen'), text: t('help2', { n: map.oxygenUse }) + (mars ? ' ' + t('moxieNote') : ''), demo: 'oxygen', cls: 'c-o2' },
    { icon: 'shield', title: t('tutShield'), text: t('help3'), demo: 'shield', cls: 'c-shield' },
    { icon: 'battery', title: t(mars ? 'tutDust' : 'tutBattery'), text: mars ? t('help4mars') : t('help4', { day: map.nightStart }), demo: mars ? 'dust' : 'battery', cls: 'c-bat' },
    { icon: 'hammer', title: t('tutBuild'), text: t('help6'), demo: 'build', cls: 'c-build' },
    ...(game.mode === 'escape' ? [{ icon: 'gear', title: t('tutParts'), text: t('helpParts', { n: ESCAPE.parts }), demo: 'rover', cls: 'c-energy' }] : []),
    { icon: 'sun', title: t('tutReal'), text: t('sunHowGame'), demo: 'real', cls: 'c-energy' },
  ];
}

function helpHtml() {
  const steps = tutorialSteps(), s = steps[helpStep], last = helpStep === steps.length - 1;
  const words = { sun: t('demoSun'), energy: t('energyLabel'), machine: t('demoMachine'), shield: t('shieldLabel'), battery: t('battery'),
    day: t('demoDay'), night: t('night'), dust: t('termDust'), build: t('build'), trip: t('demoTrip'), ship: t('demoShip') };
  const dots = steps.map((_, i) => `<i class="${i === helpStep ? 'on' : i < helpStep ? 'done' : ''}"></i>`).join('');
  return windowHtml(`${icon(s.icon)} ${esc(s.title)} <span class="tut-count">${helpStep + 1}/${steps.length}</span>`, `
    <div class="tut ${s.cls}">
      <div class="tut-text"><p>${esc(s.text)}</p>
        <button class="round-btn speak" data-action="speak" aria-label="${esc(t('readAloud'))}" title="${esc(t('readAloud'))}">${icon('sound')}</button></div>
      <div class="demo">${DEMOS[s.demo](words)}<div class="demo-bar"><i></i></div></div>
      <div class="tut-dots">${dots}</div>
      <div class="tut-nav">
        ${helpStep > 0 ? `<button class="btn grey" data-action="tut-back"><span>←</span></button>` : ''}
        <button class="btn green" data-action="${last ? 'close-help' : 'tut-next'}"><span>${esc(t(last ? 'letsGo' : 'next'))}</span>${icon('play')}</button>
      </div>
    </div>`, { close: 'close-help', cls: 'tut-win' });
}

function termHtml(key) {
  return windowHtml(esc(t('term' + key)), `<p>${esc(t('term' + key + 'Text'))}</p>
    ${key === 'Night' ? `<p class="small">${esc(t('gameNote'))}</p>` : ''}
    ${key === 'Dose' || key === 'Storm' ? `<p class="nasa-fact">${icon('radiation')}<span>${esc(t('term' + key + 'Data'))}</span></p>` : ''}
    <button class="btn green" data-action="close-term"><span>${esc(t('close'))}</span></button>`, { close: 'close-term' });
}

// ---------- render & events ----------

// Which music fits what is on screen now.
function musicFor() {
  if (cinematic === 'landing') return 'landing';
  if (cinematic === 'launch' || screen === 'roll') return 'credits';
  if (cinematic === 'lose') return null; // silence, only the alarm
  if (screen === 'game') return showHelp ? 'tutorial' : 'game';
  if (screen === 'end' && game?.status === 'won') return 'credits';
  return 'menu';
}

function render() {
  const screens = { menu: menuScreen, map: mapScreen, difficulty: difficultyScreen, game: gameScreen,
    end: endScreen, settings: settingsScreen, credits: creditsScreen, ranking: rankingScreen, data: dataScreen, mode: modeScreen, roll: () => gameScreen() + creditsRoll() };
  const keep = app.dataset.screen === screen ? app.querySelector('.win-body')?.scrollTop : 0;
  app.innerHTML = screens[screen]();
  app.dataset.screen = screen;
  if (keep) { const wb = app.querySelector('.win-body'); if (wb) wb.scrollTop = keep; }
  app.className = 'screen-' + screen;
  const modal = openTerm ? termHtml(openTerm) : showSun ? sunHtml() : showHelp ? helpHtml() : lastReport ? reportHtml(lastReport) : '';
  modalRoot.innerHTML = modal;
  modalRoot.hidden = !modal;
  document.title = t('title');
  playMusic(musicFor());
  narrateTutorial();
  document.body.classList.toggle('cinematic-on', !!cinematic || screen === 'roll');
  if (!has3d) return;
  setLabels({ shield: t('lblShield'), home: t('lblHome') });
  const inGame = (screen === 'game' || screen === 'roll') && game;
  if (!cinematic && screen !== 'roll' && screen !== 'end') setMode(inGame ? 'game' : 'menu');
  if (inGame) {
    const map = MAPS[game.map];
    const left = available(game) - choice.oxygen - choice.shield;
    updateScene({ night: isNight(map, game.day), dust: game.dust > 0, oxygen: choice.oxygen, shield: choice.shield,
      battery: Math.min(batteryMax(game), left), batteryMax: batteryMax(game) });
    syncScene();
  }
}

// The tutorial reads each card aloud once, when it appears (Next or Back reads the new card).
// The speaker button on the card reads it again.
let spokenCard = null;
function narrateTutorial() {
  const showing = screen === 'game' && game && showHelp && !openTerm && !showSun && !cinematic;
  if (!showing) { spokenCard = null; return; }
  const key = [game.map, game.mode, helpStep, lang()].join('|');
  if (key === spokenCard) return;
  spokenCard = key;
  const s = tutorialSteps()[helpStep];
  if (s) speak(s.title + '. ' + s.text, lang());
}

function defaultChoice() {
  return { oxygen: Math.min(MAPS[game.map].oxygenUse, available(game)), shield: 0 };
}

function startGame() {
  const w = getWeather();
  game = newGame({ map: pick.map, difficulty: pick.difficulty, mode: pick.mode, flares: w ? w.pool : [], activity: w ? w.activity.factor : 1 });
  choice = defaultChoice();
  ui = null; endInfo = {}; warnedDay = 0;
  if (!has3d) { showHelp = true; helpStep = 0; return go('game'); }
  stopPlacing(); resetLander(); setPlanet(game.map);
  setDebris(game.mode === 'escape' ? game.debris : null);
  setCrashed(false);
  cinematic = 'landing';
  screen = 'game';
  playMusic('landing', { restart: true });
  // Captions during the landing (updated every frame without redrawing the screen)
  let lastPhase = '';
  // Mission radio: the crew and Mission Control talk during the landing; subtitles show who speaks.
  let subtitle = null;
  const showLine = l => {
    subtitle = l;
    const p = document.getElementById('cap-phase'), who = document.getElementById('cap-who');
    if (!p) return;
    p.textContent = l.text; p.classList.remove('pop'); void p.offsetWidth; p.classList.add('pop');
    if (who) who.textContent = t(l.who === 'crew' ? 'radioCrew' : 'radioControl');
  };
  const said = new Set();
  const mars = game.map === 'mars', crash = game.mode === 'escape';
  let engine = null;
  const onProgress = ({ phase }) => {
    if (subtitle && !document.getElementById('cap-phase')?.textContent) showLine(subtitle); // screen was redrawn
    if (said.has(phase)) return;
    said.add(phase);
    if (phase === 'approach') engine = sfx('engine', { loop: true, vol: .5 });
    if (phase === 'crash') { engine?.(); sfx('crash'); }
    if (phase === 'landed') { engine?.(); sfx('touchdown'); }
    const lines = radioScript(phase, mars);
    if (lines.length) radio(lines, lang(), showLine);
  };
  // Every shot lasts as long as what is said in it, so the voices always match the picture.
  const len = ph => radioTime(radioScript(ph, mars), lang());
  const S = 5;                                                        // last metres to the ground
  const T1 = Math.max(12, len('approach') + .8);
  const T2 = T1 + Math.max(7, len('braking') + .6);
  const T3 = T2 + Math.max(S, crash ? 0 : len('final') + .4);
  const after = crash ? len('crash') - .2 * S : len('landed');       // the crash happens at 80% of the last shot
  const fly = 3;
  const T4 = T3 + Math.max(fly + .5, after + .3 + fly);
  const startPlaying = () => { cinematic = null; engine?.(); showHelp = true; helpStep = 0; if (crash) setCrashed(true); render(); };
  const waitRadio = (tries = 0) => (radioBusy() && tries < 60 && cinematic === 'landing' ? setTimeout(() => waitRadio(tries + 1), 300) : startPlaying());
  playLanding(() => waitRadio(), onProgress, { crash, times: { T1, T2, T3, T4, fly }, hold: () => radioBusy() });
  render();
}

// What the crew (C) and Mission Control (M) say in each part of the landing.
function radioScript(phase, mars) {
  const L = (who, key) => ({ who, text: t(key) });
  switch (phase) {
    case 'approach': return [L('control', mars ? 'r_ctrl_hello_mars' : 'r_ctrl_hello'),
      { who: 'control', text: t('r_brief_' + game.mode + (mars && game.mode === 'survival' ? '_mars' : ''), { n: MAPS[game.map].missionDays, p: ESCAPE.parts }) },
      ...(mars ? [L('control', 'r_ctrl_mars_storms')] : []),
      L('crew', mars ? 'r_crew_see_mars' : 'r_crew_see')];
    case 'braking': return [L('crew', 'r_crew_engine'), L('control', 'r_ctrl_go')];
    case 'final': return game.mode === 'escape' ? [] : [L('crew', 'r_crew_final')];
    case 'crash': return [L('crew', 'r_crew_mayday'), L('control', 'r_ctrl_mayday')];
    case 'landed': return [L('crew', mars ? 'r_crew_landed_mars' : 'r_crew_landed'), { who: 'control', text: t('r_welcome_' + game.mode, { n: MAPS[game.map].missionDays }) }];
    default: return [];
  }
}

// Small radio subtitle during the game (bottom of the 3D view).
function showRadioLine(l) {
  let el = document.getElementById('radio-sub');
  if (!el) { el = document.createElement('div'); el.id = 'radio-sub'; document.body.appendChild(el); }
  el.innerHTML = `<b>${esc(t(l.who === 'crew' ? 'radioCrew' : 'radioControl'))}</b> ${esc(l.text)}${l.note ? ` <i class="rs-note">(${esc(l.note)})</i>` : ''}`;
  el.classList.add('on');
  clearTimeout(showRadioLine.timer);
  showRadioLine.timer = setTimeout(() => el.classList.remove('on'), 2500 + l.text.length * 70);
}

// Mission Control warns the base when scientists see a flare (once per day).
let warnedDay = 0;
function warnOverRadio() {
  if (!game || game.status !== 'playing' || warnedDay === game.day) return;
  const fc = forecast(game);
  if (!fc.warned) return;
  warnedDay = game.day;
  sfx('alarm');
  radio([{ who: 'control', text: t('r_warn', { c: fc.hint || 'M' }) }], lang(), showRadioLine);
}

function beginPlacing(type) {
  if (!has3d) return;
  ui = { kind: 'placing', type };
  startPlacing({ type, level: 1, radius: BUILDINGS[type].radius,
    valid: (x, z) => validSpot(game, type, x, z),
    done: (x, z) => {
      const b = build(game, type, x, z, freeEnergy());
      if (b) sfx('build');
      ui = { kind: 'selected', id: b.id };
      render();
    } });
  render();
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.lang) return setLang(d.lang);
  if (d.rankMap) return (loadRank(d.rankMap, rank.difficulty), render());
  if (d.rankDiff) return (loadRank(rank.map, d.rankDiff), render());
  if (d.term) { openTerm = d.term; return render(); }
  if (d.go) return go(d.go);
  if (d.map) { pick.map = d.map; return go('mode'); }
  if (d.mode) { pick.mode = d.mode; return go('difficulty'); }
  if (d.build) return beginPlacing(d.build);
  if (d.difficulty) { pick.difficulty = d.difficulty; return startGame(); }
  if (d.step) {
    const total = available(game);
    const other = d.step === 'oxygen' ? choice.shield : choice.oxygen;
    choice[d.step] = Math.max(0, Math.min(total - other, choice[d.step] + Number(d.d)));
    return render();
  }
  switch (d.action) {
    case 'end-day': {
      if (busy) return;
      ui = null;
      const strength = game.today.strength; // the storm (if any) that hits at the end of today
      if (strength > 0) { // the crew tells Earth, and Mission Control says which real flare it was
        const held = shieldBlocks(game, choice.shield) >= strength;
        const fl = game.today.flare;
        radio([{ who: 'crew', text: t(held ? 'r_storm_held' : 'r_storm_hurt') },
          { who: 'control', text: fl ? t('r_storm_real', { cls: fl.cls[0] }) : t('r_storm_copy'), note: fl ? `${fl.cls} · ${fmtDate(fl.t)}` : '' }], lang(), showRadioLine);
      }
      const finish = () => {
        busy = false;
        lastReport = playDay(game, choice);
        if (game.status === 'playing') choice = defaultChoice();
        const r = lastReport;
        if (has3d && r.roverHit && !r.partBack) setRover(game.rover);
        if (has3d && r.partBack) returnRover(r.partBack, { withPart: true, broken: !!r.roverBroken }, () => render());
        if (r.roverHit) radio([{ who: 'crew', text: t('r_rover_broken') }], lang(), showRadioLine);
        if (r.partBack) radio([{ who: 'crew', text: t('r_rover_back', { n: partsCollected(game), m: partsNeeded() }) }], lang(), showRadioLine);
        if (r.warned && !r.storm) radio([{ who: 'control', text: t('r_ctrl_false_alarm') }], lang(), showRadioLine);
        if (r.dustStarted) radio([{ who: 'control', text: t('r_dust_start', { n: game.dust }) }], lang(), showRadioLine);
        render();
      };
      if (strength > 0 && has3d) {
        busy = true;                                  // watch the storm hit the base first
        playStorm(strength, Math.min(shieldBlocks(game, choice.shield), strength));
        sfx('storm');
        render();
        return setTimeout(finish, 2800);
      }
      return finish();
    }
    case 'close-report':
      lastReport = null;
      warnOverRadio();
      if (game.status === 'playing') return render();
      return finishGame();
    case 'close-term': openTerm = null; return render();
    case 'help': showHelp = true; helpStep = 0; return render();
    case 'close-help': warnOverRadio(); showHelp = false; helpSeen = true; stopSpeaking(); return render();
    case 'tut-next': helpStep++; stopSpeaking(); return render();
    case 'tut-back': helpStep = Math.max(0, helpStep - 1); stopSpeaking(); return render();
    case 'speak': { const s = tutorialSteps()[helpStep]; speak(s.title + '. ' + s.text, lang()); return; }
    case 'mute': toggleMute(); return render();
    case 'send-rover': {
      const id = ui.id;
      sfx('rover');
      sendRover(game, id, freeEnergy());
      ui = null;
      driveRover(id, () => render());
      return render();
    }
    case 'repair-rover': {
      repairRover(game, freeEnergy());
      sfx('build');
      return render();
    }
    case 'repair': {
      repairAndLaunch(game, freeEnergy());
      setCrashed(false);
      return finishGame();
    }
    case 'skip': stopRadio(); if (has3d) skipAnimation(); return;
    case 'end-credits': return go('end');
    case 'toggle-unlock': setUnlockAll(!unlockAll()); return render();
    case 'sun': showSun = true; return render();
    case 'close-sun': showSun = false; return render();
    case 'open-build': ui = { kind: 'build' }; return render();
    case 'close-ui': ui = null; return render();
    case 'cancel-place': if (has3d) stopPlacing(); ui = null; return render();
    case 'reset-view': if (has3d) resetView(); return;
    case 'upgrade': if (upgrade(game, ui.id, freeEnergy())) sfx('upgrade'); return render();
    case 'move': {
      const b = game.buildings.find(x => x.id === ui.id);
      ui = { kind: 'placing', type: b.type, moveId: b.id };
      startPlacing({ type: b.type, level: b.level, radius: BUILDINGS[b.type].radius, moveId: b.id,
        valid: (x, z) => validSpot(game, b.type, x, z, b.id),
        done: (x, z) => { moveBuilding(game, b.id, x, z); ui = { kind: 'selected', id: b.id }; render(); } });
      return render();
    }
    case 'again': return startGame();
    case 'rank-skip': endInfo.rank = { state: 'skipped' }; return render();
    case 'rank-send': {
      const days = game.day - 1;
      endInfo.rank = { state: 'sending' }; render();
      submitScore(game.map, game.difficulty, days)
        .then(() => { endInfo.rank = { state: 'sent' }; loadRank(game.map, game.difficulty); })
        .catch(() => { endInfo.rank = { state: 'error' }; })
        .finally(() => render());
      return;
    }
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (openTerm) openTerm = null; else if (showSun) showSun = false; else if (showHelp) { showHelp = false; helpSeen = true; stopSpeaking(); }
  else if (ui) { if (has3d) stopPlacing(); ui = null; } else return;
  render();
});

// End of a game: records, unlocks, and in story mode the escape + credits.
function finishGame() {
  if (game.mode === 'infinite') endInfo.newRecord = saveBest(game.map, game.difficulty, game.day - 1);
  if (game.status === 'won' && game.map === 'moon') endInfo.unlocked = unlock('mars');
  if (game.status === 'won' && has3d) {
    cinematic = 'launch';
    playMusic('credits', { restart: true });
    render();
    const lines = [{ who: 'control', text: t('r_launch_ctrl') }, { who: 'crew', text: t('r_launch_crew') }];
    radio(lines, lang(), showRadioLine);
    setTimeout(() => sfx('launch'), 900);
    playLaunch(() => { cinematic = null; go('roll'); }, { length: Math.max(6.5, radioTime(lines, lang()) + .5) });
    return;
  }
  if (has3d) return playLoseScene();
  go('end');
}

// You lost: alarm, the screen turns red, the camera slowly pulls away from the base, and a big banner says why.
function playLoseScene() {
  cinematic = 'lose';
  stopRadio();
  render();
  sfx('lose');
  const key = { 'lost-oxygen': 'lostOxygen', 'lost-dose': 'lostDose', 'lost-time': 'lostTime' }[game.status];
  const ico = { 'lost-oxygen': 'oxygen', 'lost-dose': 'radiation', 'lost-time': 'gear' }[game.status];
  const fx = document.createElement('div');
  fx.className = 'lose-fx';
  fx.innerHTML = `<div class="lf-box"><span class="lf-ico">${icon(ico)}</span>
    <span class="lf-big">${esc(t(game.mode === 'infinite' ? 'gameOver' : 'loseBanner'))}</span>
    <span class="lf-why">${esc(t(key + 'Title'))}</span></div>`;
  document.body.appendChild(fx);
  let done = false;
  const end = () => { if (done) return; done = true; fx.remove(); cinematic = null; go('end'); };
  fx.addEventListener('click', end);
  playLose(() => {});
  setTimeout(end, 5200);
}

if (has3d) onPickDebris(id => {
  if (screen !== 'game' || busy || cinematic || ui?.kind === 'placing') return;
  ui = { kind: 'debris', id };
  render();
});

if (has3d) onPickBuilding(id => {
  if (screen !== 'game' || busy || cinematic || ui?.kind === 'placing') return;
  ui = id != null ? { kind: 'selected', id } : null;
  render();
});

document.addEventListener('input', e => { if (e.target.matches('[data-volume]')) setVolume(Number(e.target.value)); });

// When the credits finish rolling, show the end screen.
document.addEventListener('animationend', e => { if (e.target.classList?.contains('cr-scroll') && screen === 'roll') go('end'); });

onLangChange(render);
onWeather(render);
loadSpaceWeather();
render();

// Game title in a space-agency style: wide capitals, an orbit ring with a satellite, a red mission stripe.
function brandTitle() {
  const words = t('logoMain').split(' ');
  const top = words.length > 1 ? words.slice(0, -1).join(' ') : '';
  const main = words[words.length - 1];
  const ring = 'M20,80 a280,52 0 1,0 560,0 a280,52 0 1,0 -560,0';
  return `<div class="brand" role="heading" aria-level="1" aria-label="${esc(t('logoMain'))}">
    <svg class="brand-orbit" viewBox="0 0 600 160" aria-hidden="true">
      <path d="${ring}" transform="rotate(-8 300 80)" />
      <g transform="rotate(-8 300 80)"><circle r="7" class="sat"><animateMotion dur="9s" repeatCount="indefinite" path="${ring}" /></circle></g>
    </svg>
    ${top ? `<span class="brand-top">${esc(top)}</span>` : ''}
    <span class="brand-main">${esc(main)}</span>
    <span class="brand-stripe"></span>
  </div>`;
}

// Opening: "tap to start" (browsers only play sound after a tap), then the camera flies in from space
// with the music, and the menu buttons appear when it arrives. Another tap skips the flight.
if (has3d) {
  document.body.classList.add('intro');
  const gate = document.createElement('button');
  gate.className = 'tap-start';
  gate.innerHTML = `${brandTitle()}<span class="ts-tap">${esc(t('tapToStart'))}</span>`;
  document.body.appendChild(gate);
  const endIntro = () => {
    document.body.classList.remove('intro');
    document.body.classList.add('intro-lock');
    setTimeout(() => document.body.classList.remove('intro-lock'), 500);
    window.removeEventListener('pointerdown', skipIntro);
  };
  const skipIntro = () => { skipAnimation(); };
  gate.addEventListener('click', () => {
    gate.remove();
    playMusic('menu', { restart: true });
    setTimeout(() => window.addEventListener('pointerdown', skipIntro), 200);
    playIntro(endIntro);
  }, { once: true });
  onLangChange(() => { const s = gate.querySelector('.ts-tap'); if (s) s.textContent = t('tapToStart'); });
}
