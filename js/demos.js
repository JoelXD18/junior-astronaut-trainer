// Short looping animations ("videos") for the how-to-play tutorial. Pure SVG + CSS, no video files,
// so they load instantly and work in every language. Colours match the game:
// energy yellow, oxygen blue, shield purple, battery green, radiation orange.
const C = { energy: '#ffc107', o2: '#29b6f6', shield: '#8c7cff', bat: '#43d17a', rad: '#ff7043', ink: '#081028', ground: '#8d8a84', mars: '#c0643a' };

const frame = (body, extraCss = '', bg = '#0b1230') => `<svg class="demo-svg" viewBox="0 0 320 180" aria-hidden="true">
  <style>
    .lbl{font:400 13px 'Lilita One',sans-serif;fill:#fff;paint-order:stroke;stroke:${C.ink};stroke-width:3px}
    @keyframes travel{0%{transform:translate(0,0);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translate(var(--dx),var(--dy));opacity:0}}
    @keyframes pulse{50%{transform:scale(1.12)}}
    @keyframes fill{0%{transform:scaleY(.1)}70%,100%{transform:scaleY(1)}}
    @keyframes drain{0%,20%{transform:scaleY(1)}100%{transform:scaleY(.15)}}
    @keyframes blink{50%{opacity:.25}}
    .tok{animation:travel 2.4s linear infinite}
    ${extraCss}
  </style>
  <rect width="320" height="180" fill="${bg}"/>
  ${Array.from({ length: 22 }, (_, i) => `<circle cx="${(i * 47) % 320}" cy="${(i * 29) % 70}" r="${i % 3 ? .8 : 1.3}" fill="#fff" opacity=".7"/>`).join('')}
  ${body}
</svg>`;

const sun = (x, y, r = 22) => `<g transform="translate(${x} ${y})" style="transform-box:fill-box;transform-origin:center;animation:pulse 2s ease-in-out infinite">
  ${Array.from({ length: 8 }, (_, i) => `<rect x="-3" y="${-r - 10}" width="6" height="10" rx="2" fill="#ffb300" transform="rotate(${i * 45})"/>`).join('')}
  <circle r="${r}" fill="#ffd54f" stroke="#8a4b00" stroke-width="3"/></g>`;
const ground = (color = C.ground) => `<rect y="140" width="320" height="40" fill="${color}"/><rect y="140" width="320" height="4" fill="#00000033"/>`;
const tokens = (x0, y0, dx, dy, color, n = 5, dur = 2.4) => Array.from({ length: n }, (_, i) =>
  `<circle class="tok" cx="${x0}" cy="${y0}" r="6" fill="${color}" stroke="${C.ink}" stroke-width="2" style="--dx:${dx}px;--dy:${dy}px;animation-delay:${(i * dur / n).toFixed(2)}s;animation-duration:${dur}s"/>`).join('');
const habitat = (x, y) => `<g transform="translate(${x} ${y})"><path d="M-26 0 V-18 Q-26 -40 0 -40 Q26 -40 26 -18 V0 Z" fill="#eceff1" stroke="${C.ink}" stroke-width="3"/><rect x="-7" y="-18" width="14" height="18" rx="3" fill="#455a64"/></g>`;
const tank = (x, y, color, anim) => `<g transform="translate(${x} ${y})"><rect x="-16" y="-50" width="32" height="50" rx="10" fill="#1b2650" stroke="${C.ink}" stroke-width="3"/>
  <rect x="-12" y="-46" width="24" height="42" rx="7" fill="${color}" style="transform-box:fill-box;transform-origin:bottom;animation:${anim}"/></g>`;

export const DEMOS = {
  energy: (t) => frame(`${ground()}${sun(48, 50)}
    <g transform="translate(250 92)"><circle r="30" fill="#f2a20c" stroke="${C.ink}" stroke-width="4"/><path d="M4 -20 L-10 4 H0 L-4 22 L12 -4 H2 Z" fill="#fff59d" stroke="${C.ink}" stroke-width="2.5"/></g>
    ${tokens(70, 60, 160, 32, C.energy, 6)}
    <text class="lbl" x="48" y="100" text-anchor="middle">${t.sun}</text><text class="lbl" x="250" y="140" text-anchor="middle">${t.energy}</text>`),

  oxygen: (t) => frame(`${ground()}
    <g transform="translate(60 92)"><circle r="24" fill="#f2a20c" stroke="${C.ink}" stroke-width="3"/><path d="M3 -15 L-8 3 H0 L-3 16 L9 -3 H1 Z" fill="#fff59d"/></g>
    <rect x="125" y="96" width="56" height="44" rx="8" fill="#b7b2a6" stroke="${C.ink}" stroke-width="3"/>
    ${tokens(84, 92, 50, 22, C.energy, 4)}
    ${tokens(185, 110, 55, -10, C.o2, 4)}
    ${tank(262, 140, C.o2, 'fill 2.4s ease-in-out infinite')}
    <text class="lbl" x="153" y="88" text-anchor="middle">${t.machine}</text><text class="lbl" x="262" y="78" text-anchor="middle">O₂</text>`),

  shield: (t) => frame(`${ground()}${sun(40, 40, 18)}
    <path d="M90 140 A70 70 0 0 1 230 140" fill="${C.shield}" fill-opacity=".25" stroke="${C.shield}" stroke-width="4" style="animation:blink 1.2s ease-in-out infinite"/>
    ${habitat(160, 140)}
    ${Array.from({ length: 6 }, (_, i) => `<circle class="tok" cx="${60 + i * 6}" cy="${48 + i * 3}" r="4" fill="${C.rad}" style="--dx:${70 + i * 8}px;--dy:${40 - i * 2}px;animation-delay:${i * .35}s;animation-duration:1.4s"/>`).join('')}
    <g transform="translate(250 34)"><rect x="-44" y="-14" width="88" height="26" rx="8" fill="#b3171c" stroke="${C.ink}" stroke-width="3"/><text class="lbl" x="0" y="5" text-anchor="middle">C · M · X</text></g>
    <text class="lbl" x="160" y="168" text-anchor="middle">${t.shield}</text>`),

  battery: (t) => frame(`${ground()}
    <g style="animation:sunset 6s ease-in-out infinite">${sun(70, 50, 18)}</g>
    <rect width="320" height="180" fill="#000" style="animation:dark 6s ease-in-out infinite" opacity="0"/>
    ${habitat(160, 140)}
    <g transform="translate(250 140)"><rect x="-30" y="-56" width="60" height="56" rx="8" fill="#1b2650" stroke="${C.ink}" stroke-width="3"/>
      <rect x="-24" y="-50" width="48" height="44" rx="5" fill="${C.bat}" style="transform-box:fill-box;transform-origin:bottom;animation:batt 6s ease-in-out infinite"/></g>
    <text class="lbl" x="250" y="74" text-anchor="middle">${t.battery}</text><text class="lbl" x="70" y="100" text-anchor="middle" style="animation:dayword 6s infinite">${t.day}</text>
    <text class="lbl" x="70" y="100" text-anchor="middle" style="animation:nightword 6s infinite;opacity:0">${t.night}</text>`,
    `@keyframes sunset{0%,35%{transform:translateY(0)}55%,90%{transform:translateY(130px)}100%{transform:translateY(0)}}
     @keyframes dark{0%,35%{opacity:0}55%,90%{opacity:.55}100%{opacity:0}}
     @keyframes batt{0%{transform:scaleY(.3)}40%{transform:scaleY(1)}90%{transform:scaleY(.15)}100%{transform:scaleY(.3)}}
     @keyframes dayword{0%,40%{opacity:1}50%,95%{opacity:0}100%{opacity:1}}
     @keyframes nightword{0%,45%{opacity:0}55%,90%{opacity:1}100%{opacity:0}}`),

  dust: (t) => frame(`${ground(C.mars)}${sun(70, 50, 16)}
    <rect width="320" height="180" fill="#a0602e" style="animation:dusty 5s ease-in-out infinite" opacity="0"/>
    <g transform="translate(200 140)"><path d="M-50 0 L-40 -26 L40 -26 L50 0 Z" fill="#1d3b8f" stroke="${C.ink}" stroke-width="3"/></g>
    <g transform="translate(200 40)"><rect x="-38" y="-14" width="76" height="26" rx="8" fill="#1b2650" stroke="${C.ink}" stroke-width="3"/>
      <text class="lbl" x="0" y="5" text-anchor="middle" style="animation:full 5s infinite">⚡ 100%</text><text class="lbl" x="0" y="5" text-anchor="middle" style="animation:half 5s infinite;opacity:0">⚡ 50%</text></g>
    <text class="lbl" x="200" y="168" text-anchor="middle">${t.dust}</text>`,
    `@keyframes dusty{0%,30%{opacity:0}50%,85%{opacity:.6}100%{opacity:0}}
     @keyframes full{0%,35%{opacity:1}45%,90%{opacity:0}100%{opacity:1}}
     @keyframes half{0%,40%{opacity:0}50%,85%{opacity:1}95%{opacity:0}}`, '#b98a5c'),

  build: (t) => frame(`${ground()}
    <g transform="translate(110 140)"><rect x="-4" y="-80" width="8" height="80" fill="#c8c8c8"/>
      <g style="transform-box:fill-box;transform-origin:bottom;animation:rise 3s ease-out infinite">${[0, 1, 2].map(i => `<rect x="-22" y="${-78 + i * 24}" width="44" height="20" fill="#16306b" stroke="#d9d9d9" stroke-width="2"/>`).join('')}</g></g>
    <g transform="translate(200 70)" style="animation:hammer .6s ease-in-out infinite;transform-origin:200px 90px"><rect x="-4" y="0" width="8" height="40" rx="3" fill="#a1662f" stroke="${C.ink}" stroke-width="2.5" transform="rotate(-30)"/><rect x="-16" y="-8" width="30" height="14" rx="3" fill="#b0bec5" stroke="${C.ink}" stroke-width="2.5" transform="rotate(-30)"/></g>
    <g transform="translate(250 40)"><rect x="-30" y="-14" width="60" height="26" rx="13" fill="#2b3866" stroke="${C.ink}" stroke-width="3"/><text class="lbl" x="0" y="5" text-anchor="middle">⚡ 6</text></g>
    <text class="lbl" x="110" y="168" text-anchor="middle">${t.build}</text>`,
    `@keyframes rise{0%{transform:scaleY(0)}60%,100%{transform:scaleY(1)}}
     @keyframes hammer{50%{transform:rotate(-25deg)}}`),

  real: (t) => frame(`${sun(160, 80, 34)}
    <path d="M190 62 Q230 30 262 50" fill="none" stroke="${C.rad}" stroke-width="6" stroke-linecap="round" style="animation:blink 1s infinite"/>
    ${['C', 'M', 'X'].map((c, i) => `<g transform="translate(${70 + i * 90} 150)"><rect x="-22" y="-14" width="44" height="26" rx="8" fill="${['#f9a825', '#f4511e', '#b71c1c'][i]}" stroke="${C.ink}" stroke-width="3" style="animation:pulse 1.5s ${i * .3}s infinite;transform-box:fill-box;transform-origin:center"/><text class="lbl" x="0" y="5" text-anchor="middle">${c}</text></g>`).join('')}
    <text class="lbl" x="160" y="24" text-anchor="middle">NASA DONKI</text>`),

  // escape mode: the rover drives out to a ship part, waits there for the day(s) of the trip and brings it back
  rover: (t) => frame(`${ground()}
    <g transform="translate(52 140) rotate(-10)"><path d="M-22 0 L-14 -34 L14 -34 L22 0 Z" fill="#d8a63a" stroke="${C.ink}" stroke-width="3"/><rect x="-12" y="-48" width="24" height="16" rx="4" fill="#cfd8dc" stroke="${C.ink}" stroke-width="3"/></g>
    ${[0, 1, 2].map(i => `<circle cx="${58 + i * 4}" cy="${88 - i * 14}" r="${5 + i * 2}" fill="#9e9e9e" opacity=".5" style="animation:blink 2s ${i * .4}s infinite"/>`).join('')}
    <g class="part"><circle cx="262" cy="132" r="14" fill="none" stroke="#ffb300" stroke-width="3" style="animation:blink 1s infinite"/><text x="262" y="138" text-anchor="middle" font-size="16">⚙️</text></g>
    <g class="car"><g class="face"><rect x="-20" y="-20" width="40" height="10" rx="3" fill="#b0bec5" stroke="${C.ink}" stroke-width="2.5"/><rect x="8" y="-34" width="3" height="14" fill="${C.ink}"/><circle cx="10" cy="-36" r="5" fill="#eceff1" stroke="${C.ink}" stroke-width="2"/>
      <circle cx="-12" cy="-6" r="7" fill="#37474f" stroke="${C.ink}" stroke-width="2.5"/><circle cx="12" cy="-6" r="7" fill="#37474f" stroke="${C.ink}" stroke-width="2.5"/></g>
      <text class="carried" x="0" y="-24" text-anchor="middle" font-size="14">⚙️</text></g>
    <g transform="translate(160 40)"><rect x="-52" y="-15" width="104" height="28" rx="14" fill="#2b3866" stroke="${C.ink}" stroke-width="3"/><text class="lbl" x="0" y="5" text-anchor="middle">${t.trip}</text></g>
    <text class="lbl" x="52" y="168" text-anchor="middle">${t.ship}</text>`,
    `.car{animation:drive 6s ease-in-out infinite}
     .face{animation:turn 6s steps(1) infinite}
     .carried{opacity:0;animation:carry 6s steps(1) infinite}
     .part{animation:gone 6s steps(1) infinite}
     @keyframes drive{0%{transform:translate(85px,140px)}35%,55%{transform:translate(240px,140px)}90%,100%{transform:translate(85px,140px)}}
     @keyframes turn{0%{transform:scaleX(1)}55%{transform:scaleX(-1)}90%{transform:scaleX(1)}}
     @keyframes carry{0%{opacity:0}55%{opacity:1}92%{opacity:0}}
     @keyframes gone{0%{opacity:1}55%{opacity:0}100%{opacity:1}}`),
};
