// Screens and controls. Every text comes from t() so the language can change at any moment.
// The 3D Moon base (scene.js) is always behind; the screens are drawn on top of it.
import { t, setLang, lang, onLangChange, LANGUAGES } from './i18n.js';
import { MAPS, DOSE_LIMIT, BUILDINGS, MAX_LEVEL, newGame, playDay, available, energyToday, isNight, forecast,
  batteryMax, oxygenMax, solarEnergy, batteryCap, tankCap, oxygenBonus, shieldBonus, shieldBlocks,
  validSpot, buildProblem, build, upgradeCost, upgradeProblem, upgrade, moveBuilding } from './game.js';
import { initScene, setMode, setLabels, updateScene, playStorm, syncBuildings, setSelected, onPickBuilding,
  startPlacing, stopPlacing, resetView } from './scene.js';
import { icon } from './icons.js';

const has3d = initScene();
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');

let screen = 'menu';     // menu | map | difficulty | game | end | settings | credits
let game = null;
let choice = { oxygen: 0, shield: 0 };
let pick = { map: 'moon', difficulty: 'normal' };
let lastReport = null;   // report shown after ending a day
let openTerm = null;     // glossary word currently open
let showHelp = false;    // "how to play" card at the start of a game
let busy = false;        // true while a solar storm animation is playing
let ui = null;           // null | {kind:'build'} | {kind:'placing', type, moveId} | {kind:'selected', id}

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

function go(next) { screen = next; render(); }

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
      <h1>${esc(t('logoMain'))}</h1>
      <span class="logo-sub">${esc(t('subtitle'))}</span>
    </div>
    <div class="stack">
      <button class="btn green xl" data-go="map">${icon('play')}<span>${esc(t('play'))}</span></button>
      <button class="btn blue" data-go="settings">${icon('gear')}<span>${esc(t('settings'))}</span></button>
      <button class="btn blue" data-go="credits">${icon('trophy')}<span>${esc(t('credits'))}</span></button>
    </div>
    ${langPicker()}
  </section>`;
}

function centered(inner) { return `<section class="centered">${inner}</section>`; }

function mapScreen() {
  return centered(windowHtml(esc(t('chooseMap')), `<div class="choice-cards">
      <button class="choice" data-map="moon"><span class="c-ico">${icon('moon')}</span><strong>${esc(t('moon'))}</strong><small>${esc(t('moonDesc'))}</small></button>
      <button class="choice locked" disabled><span class="c-ico">🔒</span><strong>${esc(t('mars'))}</strong><small>${esc(t('marsLocked'))}</small></button>
    </div>`, { close: null }) + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

function difficultyScreen() {
  const stars = { easy: 1, normal: 2, hard: 3 };
  return centered(windowHtml(esc(t('chooseDifficulty')), `<div class="choice-cards three">
      ${['easy', 'normal', 'hard'].map(d => `<button class="choice ${d}" data-difficulty="${d}">
        <span class="c-stars">${'★'.repeat(stars[d])}${'☆'.repeat(3 - stars[d])}</span>
        <strong>${esc(t(d))}</strong><small>${esc(t(d + 'Desc'))}</small></button>`).join('')}
    </div>`, { close: null }) + `<button class="btn grey back" data-go="map">← ${esc(t('back'))}</button>`);
}

function settingsScreen() {
  return centered(windowHtml(esc(t('settings')), `<h3>${esc(t('language'))}</h3>${langPicker()}`, { close: null })
    + `<button class="btn grey back" data-go="menu">← ${esc(t('back'))}</button>`);
}

function creditsScreen() {
  return centered(windowHtml(esc(t('credits')), `<p>${esc(t('creditsText'))}</p>
    <p>${esc(t('creditsGame'))}</p>
    <h3>${esc(t('creditsData'))}</h3>
    <ul class="credit-list">
      <li>${esc(t('creditsModels'))}</li>
      <li>${esc(t('creditsEarth'))}</li>
      <li>${esc(t('creditsDataSoon'))}</li>
      <li>${esc(t('creditsTools'))}</li>
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
  let strip = '';
  for (let d = 1; d <= map.missionDays; d++) strip += `<i class="${isNight(map, d) ? 'n' : 's'} ${d < game.day ? 'past' : ''} ${d === game.day ? 'now' : ''}"></i>`;
  const bottom = !ui ? dock()
    : ui.kind === 'build' ? buildWindow()
    : ui.kind === 'placing' ? placingBar()
    : selectedWindow();

  return `<section class="hud ${night ? 'is-night' : ''}">
    <div class="top-left">
      <button class="day-plate" data-term="${night ? 'Night' : 'Day'}">
        <span class="day-ico">${icon(night ? 'moon' : 'sun')}</span>
        <span class="day-text"><span class="day-label">${esc(t('dayLabel'))}</span><span class="day-num">${game.day}<small>/${map.missionDays}</small></span></span>
      </button>
      <div class="strip" aria-hidden="true">${strip}</div>
      ${fc.warned
        ? `<button class="ribbon warn" data-term="Storm">${icon('warning')}<span>${esc(t('warnShort'))}</span></button>`
        : `<button class="ribbon calm" data-term="Storm"><span>${esc(t('calmShort'))}</span></button>`}
    </div>

    <div class="top-right">
      ${resBar('o2', 'oxygen', t('oxygen'), game.oxygen, oxygenMax(game), `${game.oxygen}<small>/${oxygenMax(game)}</small>`, 'Oxygen')}
      ${resBar('rad', 'radiation', t('dose'), game.dose, DOSE_LIMIT, `${game.dose}%`, 'Dose')}
      ${resBar('bat', 'battery', t('battery'), game.battery, batteryMax(game), `${game.battery}<small>/${batteryMax(game)}</small>`, 'Battery')}
      <div class="side-btns">
        ${langPicker()}
        <button class="round-btn" data-action="reset-view" title="${esc(t('resetView'))}" aria-label="${esc(t('resetView'))}">${icon('target')}</button>
        <button class="round-btn" data-action="help" aria-label="${esc(t('howToPlay'))}">${icon('question')}</button>
        <button class="round-btn" data-go="menu" aria-label="${esc(t('mainMenu'))}">${icon('menu')}</button>
      </div>
    </div>

    <div class="bottom">${bottom}</div>
  </section>`;
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
      <span class="orb-num">${total}</span>
      <span class="orb-label">${esc(t('energyLabel'))}</span>
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
      <button class="btn orange build" data-action="open-build" ${busy ? 'disabled' : ''}>${icon('hammer')}<span>${esc(t('build'))}</span></button>
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
  const key = { won: 'won', 'lost-oxygen': 'lostOxygen', 'lost-dose': 'lostDose' }[game.status];
  const done = game.status === 'won' ? map.missionDays : game.day - 1;
  const ico = game.status === 'won' ? 'trophy' : game.status === 'lost-oxygen' ? 'oxygen' : 'radiation';
  return centered(windowHtml(esc(t(key + 'Title')), `
    <div class="end-ico">${icon(ico)}</div>
    <p>${esc(t(key + 'Text'))}</p>
    <div class="end-stats">
      <span>${icon('sun')} ${esc(t('daysSurvived', { n: done }))}</span>
      <span>${icon('radiation')} ${esc(t('finalDose', { d: game.dose }))}</span>
    </div>
    <div class="stack">
      <button class="btn green" data-action="again"><span>${esc(t('playAgain'))}</span></button>
      <button class="btn blue" data-go="menu"><span>${esc(t('mainMenu'))}</span></button>
    </div>`, { close: null, cls: 'end ' + game.status }));
}

function syncScene() {
  if (!has3d || !game) return;
  syncBuildings(game.buildings.map(b => ({ ...b, radius: BUILDINGS[b.type].radius })));
  setSelected(ui?.kind === 'selected' ? ui.id : null);
}

// ---------- dialogs ----------

function reportHtml(r) {
  const map = MAPS[game.map];
  const items = [];
  if (r.storm > 0) {
    const full = r.blocked >= r.storm;
    items.push(['shield', full ? t('stormBlocked', { s: r.storm }) : t('stormPartial', { s: r.storm, b: r.blocked, d: r.stormDose }), full ? 'good' : 'bad']);
    if (!r.warned) items.push(['warning', t('surprise'), '']);
  } else {
    items.push(['sun', t('stormNone'), 'good']);
    if (r.warned) items.push(['warning', t('falseAlarm'), '']);
    if (r.shield > 0) items.push(['shield', t('shieldUnused', { n: r.shield }), '']);
  }
  if (r.spent) items.push(['hammer', t('spentMsg', { n: r.spent }), '']);
  items.push(['radiation', t('baseDoseMsg', { d: r.baseDose }), '']);
  items.push(['oxygen', t('oxygenMsg', { use: map.oxygenUse, left: game.oxygen }), game.oxygen <= map.oxygenUse ? 'bad' : '']);
  if (r.oxygenLost > 0) items.push(['oxygen', t('oxygenTankFull', { n: r.oxygenLost }), 'bad']);
  if (r.wasted > 0) items.push(['battery', t('wastedMsg', { n: r.wasted }), 'bad']);
  if (r.status === 'playing' && !r.night && isNight(map, r.day + 1)) items.push(['moon', t('nightComing'), 'bad']);
  const done = r.status !== 'playing';
  return windowHtml(esc(t('reportTitle', { day: r.day })),
    `<ul class="report">${items.map(([i, l, c]) => `<li class="${c}">${icon(i)}<span>${esc(l)}</span></li>`).join('')}</ul>
    <button class="btn green" data-action="close-report"><span>${esc(t(done ? 'seeResult' : 'nextDay'))}</span>${icon('play')}</button>`,
    { close: null });
}

function helpHtml() {
  const map = MAPS[game.map];
  const step = (i, text) => `<li>${icon(i)}<span>${esc(text)}</span></li>`;
  return windowHtml(esc(t('howToPlay')), `<ol class="report steps">
      ${step('energy', t('help1'))}
      ${step('oxygen', t('help2', { n: map.oxygenUse }))}
      ${step('shield', t('help3'))}
      ${step('battery', t('help4', { day: map.nightStart }))}
      ${step('hammer', t('help6'))}
    </ol>
    <button class="btn green" data-action="close-help"><span>${esc(t('letsGo'))}</span>${icon('play')}</button>`, { close: 'close-help' });
}

function termHtml(key) {
  return windowHtml(esc(t('term' + key)), `<p>${esc(t('term' + key + 'Text'))}</p>
    ${key === 'Night' ? `<p class="small">${esc(t('gameNote'))}</p>` : ''}
    <button class="btn green" data-action="close-term"><span>${esc(t('close'))}</span></button>`, { close: 'close-term' });
}

// ---------- render & events ----------

function render() {
  const screens = { menu: menuScreen, map: mapScreen, difficulty: difficultyScreen, game: gameScreen,
    end: endScreen, settings: settingsScreen, credits: creditsScreen };
  app.innerHTML = screens[screen]();
  app.className = 'screen-' + screen;
  const modal = openTerm ? termHtml(openTerm) : showHelp ? helpHtml() : lastReport ? reportHtml(lastReport) : '';
  modalRoot.innerHTML = modal;
  modalRoot.hidden = !modal;
  document.title = t('title');
  if (!has3d) return;
  setLabels({ shield: t('lblShield'), home: t('lblHome') });
  const inGame = screen === 'game' && game;
  setMode(inGame ? 'game' : 'menu');
  if (inGame) {
    const map = MAPS[game.map];
    const left = available(game) - choice.oxygen - choice.shield;
    updateScene({ night: isNight(map, game.day), oxygen: choice.oxygen, shield: choice.shield,
      battery: Math.min(batteryMax(game), left), batteryMax: batteryMax(game) });
    syncScene();
  }
}

function defaultChoice() {
  return { oxygen: Math.min(MAPS[game.map].oxygenUse, available(game)), shield: 0 };
}

function startGame() {
  game = newGame({ map: pick.map, difficulty: pick.difficulty });
  choice = defaultChoice();
  ui = null;
  if (has3d) stopPlacing();
  showHelp = true;
  go('game');
}

function beginPlacing(type) {
  if (!has3d) return;
  ui = { kind: 'placing', type };
  startPlacing({ type, level: 1, radius: BUILDINGS[type].radius,
    valid: (x, z) => validSpot(game, type, x, z),
    done: (x, z) => {
      const b = build(game, type, x, z, freeEnergy());
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
  if (d.term) { openTerm = d.term; return render(); }
  if (d.go) return go(d.go);
  if (d.map) { pick.map = d.map; return go('difficulty'); }
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
      const finish = () => {
        busy = false;
        lastReport = playDay(game, choice);
        if (game.status === 'playing') choice = defaultChoice();
        render();
      };
      if (strength > 0 && has3d) {
        busy = true;                                  // watch the storm hit the base first
        playStorm(strength, Math.min(shieldBlocks(game, choice.shield), strength));
        render();
        return setTimeout(finish, 2800);
      }
      return finish();
    }
    case 'close-report':
      lastReport = null;
      return game.status !== 'playing' ? go('end') : render();
    case 'close-term': openTerm = null; return render();
    case 'help': showHelp = true; return render();
    case 'close-help': showHelp = false; return render();
    case 'open-build': ui = { kind: 'build' }; return render();
    case 'close-ui': ui = null; return render();
    case 'cancel-place': if (has3d) stopPlacing(); ui = null; return render();
    case 'reset-view': if (has3d) resetView(); return;
    case 'upgrade': upgrade(game, ui.id, freeEnergy()); return render();
    case 'move': {
      const b = game.buildings.find(x => x.id === ui.id);
      ui = { kind: 'placing', type: b.type, moveId: b.id };
      startPlacing({ type: b.type, level: b.level, radius: BUILDINGS[b.type].radius,
        valid: (x, z) => validSpot(game, b.type, x, z, b.id),
        done: (x, z) => { moveBuilding(game, b.id, x, z); ui = { kind: 'selected', id: b.id }; render(); } });
      return render();
    }
    case 'again': return startGame();
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (openTerm) openTerm = null; else if (showHelp) showHelp = false;
  else if (ui) { if (has3d) stopPlacing(); ui = null; } else return;
  render();
});

if (has3d) onPickBuilding(id => {
  if (screen !== 'game' || busy || ui?.kind === 'placing') return;
  ui = id != null ? { kind: 'selected', id } : null;
  render();
});

onLangChange(render);
render();
