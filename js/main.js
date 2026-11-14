// Screens and controls. Every text comes from t() so the language can change at any moment.
import { t, setLang, lang, onLangChange, LANGUAGES } from './i18n.js';
import { MAPS, DOSE_LIMIT, newGame, playDay, available, energyToday, isNight, forecast } from './game.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal');

let screen = 'menu';     // menu | map | difficulty | game | end | settings | credits
let game = null;
let choice = { oxygen: 0, shield: 0 };
let pick = { map: 'moon', difficulty: 'normal' };
let lastReport = null;   // report shown in the modal after ending a day
let openTerm = null;     // glossary word currently open

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A word kids can tap to get it explained.
const term = (key, label) => `<button class="term" data-term="${key}">${esc(label ?? t('term' + key))}</button>`;

function go(next) { screen = next; render(); window.scrollTo(0, 0); }

function langPicker() {
  return `<div class="lang-picker" role="group" aria-label="${esc(t('language'))}">
    ${Object.entries(LANGUAGES).map(([code, L]) =>
      `<button data-lang="${code}" class="${code === lang() ? 'on' : ''}">${esc(L.langName)}</button>`).join('')}
  </div>`;
}

// ---------- screens ----------

function menuScreen() {
  return `<section class="menu">
    <div class="menu-sky" aria-hidden="true"><span class="earth">🌍</span><span class="moon">🌕</span></div>
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
  return `<section>
    <h2>${esc(t('chooseMap'))}</h2>
    <div class="cards">
      <button class="card" data-map="moon"><span class="icon">🌕</span><strong>${esc(t('moon'))}</strong><span>${esc(t('moonDesc'))}</span></button>
      <button class="card locked" disabled><span class="icon">🔒</span><strong>${esc(t('mars'))}</strong><span>${esc(t('marsLocked'))}</span></button>
    </div>
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

function difficultyScreen() {
  return `<section>
    <h2>${esc(t('chooseDifficulty'))}</h2>
    <div class="cards">
      ${['easy', 'normal', 'hard'].map(d => `<button class="card" data-difficulty="${d}">
        <strong>${esc(t(d))}</strong><span>${esc(t(d + 'Desc'))}</span></button>`).join('')}
    </div>
    <button class="link" data-go="map">← ${esc(t('back'))}</button>
  </section>`;
}

function bar(value, max, cls) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="bar ${cls}"><div style="width:${pct}%"></div></div>`;
}

function dayStrip() {
  const map = MAPS[game.map];
  let html = '';
  for (let d = 1; d <= map.missionDays; d++) {
    const cls = [isNight(map, d) ? 'n' : 's', d < game.day ? 'past' : '', d === game.day ? 'now' : ''].join(' ');
    html += `<span class="${cls}">${isNight(map, d) ? '🌑' : '☀️'}</span>`;
  }
  return `<div class="strip" aria-hidden="true">${html}</div>`;
}

function stepper(field, label, hintHtml, max) {
  const v = choice[field];
  return `<div class="row">
    <div class="row-text"><strong>${label}</strong><small>${hintHtml}</small></div>
    <div class="stepper">
      <button data-step="${field}" data-d="-1" ${v <= 0 ? 'disabled' : ''} aria-label="−">−</button>
      <output>${v}</output>
      <button data-step="${field}" data-d="1" ${v >= max ? 'disabled' : ''} aria-label="+">+</button>
    </div>
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

  return `<section class="game ${night ? 'is-night' : ''}">
    <header class="game-top">
      <div>
        <h2>${esc(t('dayOf', { day: game.day, total: map.missionDays }))}</h2>
        <span class="badge">${night ? '🌑 ' + term('Night', t('night')) : '☀️ ' + esc(t('sunny'))}</span>
      </div>
      ${langPicker()}
    </header>
    ${dayStrip()}
    <p class="goal">${esc(t('goal', { total: map.missionDays }))}</p>

    <div class="meters">
      <div class="meter"><span>💨 ${esc(t('oxygen'))}</span>${bar(game.oxygen, map.oxygenMax, 'o2')}<b>${game.oxygen} / ${map.oxygenMax}</b></div>
      <div class="meter"><span>☢️ ${term('Dose', t('dose'))}</span>${bar(game.dose, DOSE_LIMIT, 'dose')}<b>${game.dose}%</b></div>
      <div class="meter"><span>🔋 ${term('Battery', t('battery'))}</span>${bar(game.battery, map.batteryMax, 'bat')}<b>${game.battery} / ${map.batteryMax}</b></div>
    </div>

    <div class="weather ${fc.warned ? 'warn' : ''}">
      <strong>📡 ${esc(t('weatherTitle'))}</strong>
      <p>${fc.warned ? '⚠️ ' : ''}${esc(t(fc.warned ? 'warnYes' : 'warnNo'))} ${term('Storm', 'ⓘ')}</p>
    </div>

    <div class="share">
      <h3>⚡ ${esc(t('energyToShare'))}: <span class="big-num">${total}</span></h3>
      <p class="from">${esc(t('fromSun', { n: sun }))} · ${esc(t('fromBattery', { n: game.battery }))}</p>
      <div class="tokens" aria-hidden="true">${tokenRow(total)}</div>
      ${stepper('oxygen', '💨 ' + esc(t('oxygenMachine')), esc(t('oxygenMachineHint', { n: map.oxygenUse })), total - choice.shield)}
      ${stepper('shield', '🛡️ ' + term('Shield', t('shield')), esc(t('shieldHint')), total - choice.oxygen)}
      <div class="row">
        <div class="row-text"><strong>🔋 ${esc(t('toBattery'))}</strong><small>${esc(t('toBatteryHint', { max: map.batteryMax }))}</small></div>
        <div class="stepper"><output>${toBattery}</output></div>
      </div>
      ${lost > 0 ? `<p class="alert">${esc(t('batteryFullWarn', { n: lost }))}</p>` : ''}
    </div>

    <button class="big primary end-day" data-action="end-day">${esc(t('endDay'))}</button>
    ${night ? `<p class="note">${esc(t('gameNote'))}</p>` : ''}
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
  return `<section class="end ${game.status}">
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

function settingsScreen() {
  return `<section>
    <h2>${esc(t('settings'))}</h2>
    <h3>${esc(t('language'))}</h3>
    ${langPicker()}
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

function creditsScreen() {
  return `<section class="credits">
    <h2>${esc(t('credits'))}</h2>
    <p>${esc(t('creditsText'))}</p>
    <p>${esc(t('creditsGame'))}</p>
    <h3>${esc(t('creditsData'))}</h3>
    <p>${esc(t('creditsDataSoon'))}</p>
    <button class="link" data-go="menu">← ${esc(t('back'))}</button>
  </section>`;
}

// ---------- day report and glossary (modal) ----------

function reportHtml(r) {
  const lines = [];
  if (r.storm > 0) {
    lines.push(r.blocked >= r.storm
      ? t('stormBlocked', { s: r.storm })
      : t('stormPartial', { s: r.storm, b: r.blocked, d: r.stormDose }));
    if (!r.warned) lines.push(t('surprise'));
  } else {
    lines.push(t('stormNone'));
    if (r.warned) lines.push(t('falseAlarm'));
    if (r.shield > 0) lines.push(t('shieldUnused', { n: r.shield }));
  }
  lines.push(t('baseDoseMsg', { d: r.baseDose }));
  const map = MAPS[game.map];
  lines.push(t('oxygenMsg', { use: map.oxygenUse, left: game.oxygen }));
  if (r.oxygenLost > 0) lines.push(t('oxygenTankFull', { n: r.oxygenLost }));
  if (r.wasted > 0) lines.push(t('wastedMsg', { n: r.wasted }));
  if (r.status === 'playing' && !r.night && isNight(map, r.day + 1)) lines.push(t('nightComing'));
  const done = r.status !== 'playing';
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(t('reportTitle', { day: r.day }))}</h2>
    <ul class="report">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <button class="big primary" data-action="close-report">${esc(t(done ? 'seeResult' : 'nextDay'))}</button>
  </div>`;
}

function termHtml(key) {
  return `<div class="dialog" role="dialog" aria-modal="true">
    <h2>${esc(t('term' + key))}</h2>
    <p>${esc(t('term' + key + 'Text'))}</p>
    <button class="big primary" data-action="close-term">${esc(t('close'))}</button>
  </div>`;
}

// ---------- render & events ----------

function render() {
  const screens = { menu: menuScreen, map: mapScreen, difficulty: difficultyScreen, game: gameScreen,
    end: endScreen, settings: settingsScreen, credits: creditsScreen };
  app.innerHTML = screens[screen]();
  const modal = openTerm ? termHtml(openTerm) : lastReport ? reportHtml(lastReport) : '';
  modalRoot.innerHTML = modal;
  modalRoot.hidden = !modal;
  document.title = t('title');
}

function startGame() {
  game = newGame({ map: pick.map, difficulty: pick.difficulty });
  choice = { oxygen: Math.min(MAPS[pick.map].oxygenUse, available(game)), shield: 0 };
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
    case 'end-day':
      lastReport = playDay(game, choice);
      if (game.status === 'playing') {
        const total = available(game);
        choice = { oxygen: Math.min(MAPS[game.map].oxygenUse, total), shield: 0 };
      }
      return render();
    case 'close-report':
      lastReport = null;
      if (game.status !== 'playing') return go('end');
      return render();
    case 'close-term':
      openTerm = null;
      return render();
    case 'again':
      return startGame();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && openTerm) { openTerm = null; render(); }
});

onLangChange(render);
render();
