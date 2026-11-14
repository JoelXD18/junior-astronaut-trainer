// Screens and controls. Every text comes from t() so the language can change at any moment.
// The 3D Moon base (scene.js) is always behind; the screens are drawn on top of it.
import { t, setLang, lang, onLangChange, LANGUAGES } from './i18n.js';
import { MAPS, DOSE_LIMIT, newGame, playDay, available, energyToday, isNight, forecast } from './game.js';
import { initScene, setMode, setLabels, updateScene, playStorm } from './scene.js';

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

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const info = key => `<button class="info" data-term="${key}" aria-label="${esc(t('term' + key))}">?</button>`;

function go(next) { screen = next; render(); }

function langPicker() {
  return `<div class="lang-picker" role="group" aria-label="${esc(t('language'))}">
    ${Object.entries(LANGUAGES).map(([code, L]) =>
      `<button data-lang="${code}" class="${code === lang() ? 'on' : ''}">${esc(L.langName)}</button>`).join('')}
  </div>`;
}

// ---------- menu screens (glass panels over the 3D Moon) ----------

function menuScreen() {
  return `<section class="menu">
    <h1>${esc(t('title'))}</h1>
    <p class="subtitle">${esc(t('subtitle'))}</p>
    <div class="stack">
      <button class="big primary" data-go="map">${esc(t('play'))}</button>
      <button class="big" data-go="settings">${esc(t('settings'))}</button>
      <button class="big" data-go="credits">${esc(t('credits'))}</button>
    </div>
    ${langPicker()}
  </section>`;
}

function mapScreen() {
  return `<section class="panel-screen">
    <h2>${esc(t('chooseMap'))}</h2>
    <div class="cards">
      <button class="card" data-map="moon"><span class="icon">🌕</span><strong>${esc(t('moon'))}</strong><span>${esc(t('moonDesc'))}</span></button>
      <button class="card locked" disabled><span class="icon">🔒</span><strong>${esc(t('mars'))}</strong><span>${esc(t('marsLocked'))}</span></button>
    </div>
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

function difficultyScreen() {
  return `<section class="panel-screen">
    <h2>${esc(t('chooseDifficulty'))}</h2>
    <div class="cards">
      ${['easy', 'normal', 'hard'].map(d => `<button class="card" data-difficulty="${d}">
        <strong>${esc(t(d))}</strong><span>${esc(t(d + 'Desc'))}</span></button>`).join('')}
    </div>
    <button class="link" data-go="map">← ${esc(t('back'))}</button>
  </section>`;
}

function settingsScreen() {
  return `<section class="panel-screen">
    <h2>${esc(t('settings'))}</h2>
    <h3>${esc(t('language'))}</h3>
    ${langPicker()}
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

function creditsScreen() {
  return `<section class="panel-screen credits">
    <h2>${esc(t('credits'))}</h2>
    <p>${esc(t('creditsText'))}</p>
    <p>${esc(t('creditsGame'))}</p>
    <h3>${esc(t('creditsData'))}</h3>
    <ul>
      <li>${esc(t('creditsModels'))}</li>
      <li>${esc(t('creditsEarth'))}</li>
      <li>${esc(t('creditsDataSoon'))}</li>
    </ul>
    <p class="small">${esc(t('creditsTools'))}</p>
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

// ---------- game HUD ----------

function gauge(icon, label, value, max, text, cls, term) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="gauge ${cls}">
    <div class="g-head"><span class="g-icon">${icon}</span><span class="g-label">${esc(label)}</span>${term ? info(term) : ''}<b>${text}</b></div>
    <div class="bar"><div style="width:${pct}%"></div></div>
  </div>`;
}

function dayStrip() {
  const map = MAPS[game.map];
  let html = '';
  for (let d = 1; d <= map.missionDays; d++) {
    html += `<span class="${isNight(map, d) ? 'n' : 's'} ${d < game.day ? 'past' : ''} ${d === game.day ? 'now' : ''}"></span>`;
  }
  return `<div class="strip" aria-hidden="true">${html}</div>`;
}

function allocCard(field, icon, name, sub, max, term) {
  const v = choice[field];
  return `<div class="alloc ${field}">
    <div class="a-head"><span class="a-icon">${icon}</span><strong>${esc(name)}</strong>${info(term)}</div>
    <div class="stepper">
      <button data-step="${field}" data-d="-1" ${v <= 0 || busy ? 'disabled' : ''} aria-label="−">−</button>
      <output>${v}</output>
      <button data-step="${field}" data-d="1" ${v >= max || busy ? 'disabled' : ''} aria-label="+">+</button>
    </div>
    <small>${esc(sub)}</small>
  </div>`;
}

function gameScreen() {
  const map = MAPS[game.map];
  const total = available(game);
  const sun = energyToday(game);
  const left = total - choice.oxygen - choice.shield;
  const toBattery = Math.min(map.batteryMax, left);
  const lost = left - toBattery;
  const night = isNight(map, game.day);
  const fc = forecast(game);

  return `<section class="hud ${night ? 'is-night' : ''}">
    <header class="hud-top">
      <div class="day-box">
        <div class="day-line"><strong>${esc(t('dayOf', { day: game.day, total: map.missionDays }))}</strong>
          <span class="badge">${night ? '🌑 ' + esc(t('night')) + ' ' + info('Night') : '☀️ ' + esc(t('sunny'))}</span></div>
        ${dayStrip()}
      </div>
      <div class="gauges">
        ${gauge('💨', t('oxygen'), game.oxygen, map.oxygenMax, `${game.oxygen}`, 'o2')}
        ${gauge('☢️', t('dose'), game.dose, DOSE_LIMIT, `${game.dose}%`, 'dose', 'Dose')}
        ${gauge('🔋', t('battery'), game.battery, map.batteryMax, `${game.battery}`, 'bat', 'Battery')}
      </div>
      <div class="hud-actions">
        ${langPicker()}
        <button class="icon-btn" data-action="help" aria-label="${esc(t('howToPlay'))}">?</button>
        <button class="icon-btn" data-go="menu" aria-label="${esc(t('mainMenu'))}">☰</button>
      </div>
      <div class="alert ${fc.warned ? 'warn' : 'calm'}">
        ${fc.warned ? `<span>⚠️ <strong>${esc(t('warnShort'))}</strong> <span class="long">${esc(t('warnYes'))}</span></span>` : `<span>📡 ${esc(t('warnNo'))}</span>`} ${info('Storm')}
      </div>
    </header>

    <div class="hud-bottom">
      <div class="energy">
        <div class="e-num">⚡ <span>${total}</span></div>
        <div class="e-text"><strong>${esc(t('energyToShare'))}</strong><small>${esc(t('fromSun', { n: sun }))} · ${esc(t('fromBattery', { n: game.battery }))}</small></div>
        <div class="tokens" aria-hidden="true">${tokenRow(total)}</div>
      </div>
      <div class="allocs">
        ${allocCard('oxygen', '💨', t('oxygenMachine'), t('oxygenNeed', { n: map.oxygenUse }), total - choice.shield, 'Oxygen')}
        ${allocCard('shield', '🛡️', t('shield'), t('shieldShort'), total - choice.oxygen, 'Shield')}
        <div class="alloc battery">
          <div class="a-head"><span class="a-icon">🔋</span><strong>${esc(t('toBattery'))}</strong>${info('Battery')}</div>
          <div class="stepper"><output>${toBattery}</output></div>
          <small class="${lost > 0 ? 'bad' : ''}">${esc(lost > 0 ? t('batteryFullWarn', { n: lost }) : t('batteryShort'))}</small>
        </div>
      </div>
      <button class="big primary end-day" data-action="end-day" ${busy ? 'disabled' : ''}>${esc(t('endDay'))} ▶</button>
    </div>
  </section>`;
}

function tokenRow(total) {
  const out = [];
  for (let i = 0; i < total; i++) {
    const cls = i < choice.oxygen ? 'o2' : i < choice.oxygen + choice.shield ? 'sh' : 'bat';
    out.push(`<i class="${cls}"></i>`);
  }
  return out.join('');
}

function endScreen() {
  const map = MAPS[game.map];
  const key = { won: 'won', 'lost-oxygen': 'lostOxygen', 'lost-dose': 'lostDose' }[game.status];
  const done = game.status === 'won' ? map.missionDays : game.day - 1;
  return `<section class="panel-screen end ${game.status}">
    <div class="end-icon">${game.status === 'won' ? '🏆' : game.status === 'lost-oxygen' ? '💨' : '☢️'}</div>
    <h2>${esc(t(key + 'Title'))}</h2>
    <p>${esc(t(key + 'Text'))}</p>
    <ul class="facts">
      <li>${esc(t('daysSurvived', { n: done }))}</li>
      <li>${esc(t('finalDose', { d: game.dose }))}</li>
    </ul>
    <div class="stack">
      <button class="big primary" data-action="again">${esc(t('playAgain'))}</button>
      <button class="big" data-go="menu">${esc(t('mainMenu'))}</button>
    </div>
  </section>`;
}

// ---------- dialogs ----------

function reportHtml(r) {
  const map = MAPS[game.map];
  const items = [];
  if (r.storm > 0) {
    const full = r.blocked >= r.storm;
    items.push([full ? '🛡️' : '☢️', full ? t('stormBlocked', { s: r.storm }) : t('stormPartial', { s: r.storm, b: r.blocked, d: r.stormDose }), full ? 'good' : 'bad']);
    if (!r.warned) items.push(['❗', t('surprise'), '']);
  } else {
    items.push(['☀️', t('stormNone'), 'good']);
    if (r.warned) items.push(['📡', t('falseAlarm'), '']);
    if (r.shield > 0) items.push(['🛡️', t('shieldUnused', { n: r.shield }), '']);
  }
  items.push(['☢️', t('baseDoseMsg', { d: r.baseDose }), '']);
  items.push(['💨', t('oxygenMsg', { use: map.oxygenUse, left: game.oxygen }), game.oxygen <= map.oxygenUse ? 'bad' : '']);
  if (r.oxygenLost > 0) items.push(['💨', t('oxygenTankFull', { n: r.oxygenLost }), 'bad']);
  if (r.wasted > 0) items.push(['🔋', t('wastedMsg', { n: r.wasted }), 'bad']);
  if (r.status === 'playing' && !r.night && isNight(map, r.day + 1)) items.push(['🌑', t('nightComing'), 'bad']);
  const done = r.status !== 'playing';
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(t('reportTitle', { day: r.day }))}</h2>
    <ul class="report">${items.map(([i, l, c]) => `<li class="${c}"><span>${i}</span>${esc(l)}</li>`).join('')}</ul>
    <button class="big primary" data-action="close-report">${esc(t(done ? 'seeResult' : 'nextDay'))} ▶</button>
  </div>`;
}

function helpHtml() {
  const map = MAPS[game.map];
  return `<div class="dialog help" role="dialog" aria-modal="true">
    <h2>${esc(t('howToPlay'))}</h2>
    <ol class="steps">
      <li><span>⚡</span>${esc(t('help1'))}</li>
      <li><span>💨</span>${esc(t('help2', { n: map.oxygenUse }))}</li>
      <li><span>🛡️</span>${esc(t('help3'))}</li>
      <li><span>🔋</span>${esc(t('help4', { day: map.nightStart }))}</li>
    </ol>
    <p class="small">${esc(t('help5'))}</p>
    <button class="big primary" data-action="close-help">${esc(t('letsGo'))} ▶</button>
  </div>`;
}

function termHtml(key) {
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(t('term' + key))}</h2>
    <p>${esc(t('term' + key + 'Text'))}</p>
    ${key === 'Night' ? `<p class="small">${esc(t('gameNote'))}</p>` : ''}
    <button class="big primary" data-action="close-term">${esc(t('close'))}</button>
  </div>`;
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
  setLabels({ solar: t('lblSolar'), oxygen: t('lblOxygen'), battery: t('lblBattery'), shield: t('lblShield'), home: t('lblHome') });
  const inGame = screen === 'game' && game;
  setMode(inGame ? 'game' : 'menu');
  if (inGame) {
    const map = MAPS[game.map];
    const left = available(game) - choice.oxygen - choice.shield;
    updateScene({ night: isNight(map, game.day), oxygen: choice.oxygen, shield: choice.shield,
      battery: Math.min(map.batteryMax, left), batteryMax: map.batteryMax });
  }
}

function defaultChoice() {
  return { oxygen: Math.min(MAPS[game.map].oxygenUse, available(game)), shield: 0 };
}

function startGame() {
  game = newGame({ map: pick.map, difficulty: pick.difficulty });
  choice = defaultChoice();
  showHelp = true;
  go('game');
}

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const d = b.dataset;
  if (d.lang) return setLang(d.lang);
  if (d.term) { openTerm = d.term; return render(); }
  if (d.go) return go(d.go);
  if (d.map) { pick.map = d.map; return go('difficulty'); }
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
      const strength = game.today.strength; // the storm (if any) that hits at the end of today
      const finish = () => {
        busy = false;
        lastReport = playDay(game, choice);
        if (game.status === 'playing') choice = defaultChoice();
        render();
      };
      if (strength > 0 && has3d) {
        busy = true;                                  // watch the storm hit the base first
        playStorm(strength, Math.min(choice.shield, strength));
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
    case 'again': return startGame();
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (openTerm) openTerm = null; else if (showHelp) showHelp = false; else return;
  render();
});

onLangChange(render);
render();
