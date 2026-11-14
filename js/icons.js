// Game icons drawn as SVG (glossy, outlined), so they look the same on every device (emojis don't).
let uid = 0;
const wrap = (body, defs = '') => `<svg class="ico" viewBox="0 0 64 64" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const shine = '<ellipse cx="26" cy="20" rx="12" ry="6" fill="#fff" opacity=".45"/>';

export const ICONS = {
  oxygen() {
    const g = 'o' + uid++;
    return wrap(`<circle cx="32" cy="34" r="24" fill="url(#${g})" stroke="#0b3550" stroke-width="4"/>
      <circle cx="22" cy="26" r="6" fill="#fff" opacity=".5"/><circle cx="40" cy="42" r="4" fill="#fff" opacity=".35"/>
      <text x="32" y="42" text-anchor="middle" font-family="Lilita One, sans-serif" font-size="22" fill="#fff" stroke="#0b3550" stroke-width="3" paint-order="stroke">O₂</text>`,
      grad(g, '#9be7ff', '#1e88e5'));
  },
  radiation() {
    const g = 'r' + uid++;
    const blade = a => `<path d="M32 32 L${32 + 20 * Math.cos(a - .5)} ${32 + 20 * Math.sin(a - .5)} A20 20 0 0 1 ${32 + 20 * Math.cos(a + .5)} ${32 + 20 * Math.sin(a + .5)} Z" fill="#1d1d1d"/>`;
    return wrap(`<circle cx="32" cy="32" r="26" fill="url(#${g})" stroke="#5a3a00" stroke-width="4"/>
      ${[-Math.PI / 2, Math.PI / 6, 5 * Math.PI / 6].map(blade).join('')}
      <circle cx="32" cy="32" r="6" fill="#ffd54f" stroke="#1d1d1d" stroke-width="3"/>${shine}`,
      grad(g, '#ffe082', '#ff9800'));
  },
  battery() {
    const g = 'b' + uid++;
    return wrap(`<rect x="10" y="16" width="40" height="32" rx="6" fill="url(#${g})" stroke="#0d3b24" stroke-width="4"/>
      <rect x="50" y="26" width="6" height="12" rx="2" fill="#0d3b24"/>
      <path d="M33 20 L22 35 H30 L27 45 L39 29 H31 Z" fill="#fffde7" stroke="#0d3b24" stroke-width="2.5" stroke-linejoin="round"/>
      <rect x="14" y="19" width="32" height="6" rx="3" fill="#fff" opacity=".35"/>`,
      grad(g, '#b9f6ca', '#00a152'));
  },
  energy() {
    const g = 'e' + uid++;
    return wrap(`<path d="M36 4 L12 36 H29 L24 60 L52 24 H35 Z" fill="url(#${g})" stroke="#6b3d00" stroke-width="4" stroke-linejoin="round"/>
      <path d="M33 10 L19 31 H27" fill="none" stroke="#fff" stroke-width="3" opacity=".6" stroke-linecap="round"/>`,
      grad(g, '#fff59d', '#ffa000'));
  },
  shield() {
    const g = 'sh' + uid++;
    return wrap(`<path d="M32 4 L54 12 V30 C54 46 44 55 32 60 C20 55 10 46 10 30 V12 Z" fill="url(#${g})" stroke="#1a237e" stroke-width="4" stroke-linejoin="round"/>
      <path d="M32 12 L46 17 V30 C46 41 40 47 32 51 Z" fill="#fff" opacity=".25"/>
      <path d="M24 31 L30 37 L41 25" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
      grad(g, '#b39ddb', '#3949ab'));
  },
  sun() {
    const g = 's' + uid++;
    const rays = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return `<path d="M${32 + 18 * Math.cos(a - .18)} ${32 + 18 * Math.sin(a - .18)} L${32 + 29 * Math.cos(a)} ${32 + 29 * Math.sin(a)} L${32 + 18 * Math.cos(a + .18)} ${32 + 18 * Math.sin(a + .18)} Z" fill="#ffb300" stroke="#8a4b00" stroke-width="2.5" stroke-linejoin="round"/>`; }).join('');
    return wrap(`${rays}<circle cx="32" cy="32" r="16" fill="url(#${g})" stroke="#8a4b00" stroke-width="3.5"/><ellipse cx="27" cy="26" rx="6" ry="3.5" fill="#fff" opacity=".55"/>`,
      grad(g, '#fff176', '#ff9800'));
  },
  moon() {
    const g = 'm' + uid++;
    return wrap(`<path d="M42 8 A26 26 0 1 0 56 44 A20 20 0 1 1 42 8 Z" fill="url(#${g})" stroke="#1a1f4a" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="22" cy="40" r="3" fill="#7986cb"/><circle cx="30" cy="50" r="2" fill="#7986cb"/>`,
      grad(g, '#e8eaf6', '#7986cb'));
  },
  hammer() {
    const g = 'h' + uid++;
    return wrap(`<rect x="28" y="22" width="9" height="38" rx="3" transform="rotate(-35 32 40)" fill="#a1662f" stroke="#3e2108" stroke-width="3.5"/>
      <path d="M14 18 L34 6 L46 20 L40 24 L34 18 L22 28 Z" fill="url(#${g})" stroke="#263238" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M18 18 L33 9" stroke="#fff" stroke-width="2.5" opacity=".6" stroke-linecap="round"/>`,
      grad(g, '#eceff1', '#78909c'));
  },
  tank() {
    const g = 't' + uid++;
    return wrap(`<rect x="12" y="10" width="40" height="46" rx="14" fill="url(#${g})" stroke="#0b3550" stroke-width="4"/>
      <rect x="12" y="28" width="40" height="7" fill="#4fc3f7" stroke="#0b3550" stroke-width="3"/>
      <rect x="18" y="14" width="8" height="34" rx="4" fill="#fff" opacity=".45"/>`,
      grad(g, '#ffffff', '#90a4ae'));
  },
  warning() {
    return wrap(`<path d="M32 5 L60 56 H4 Z" fill="#ffca28" stroke="#5d1a00" stroke-width="4.5" stroke-linejoin="round"/>
      <rect x="29" y="22" width="6" height="19" rx="3" fill="#5d1a00"/><circle cx="32" cy="48" r="3.6" fill="#5d1a00"/>`);
  },
  play() { return wrap('<path d="M18 10 L52 32 L18 54 Z" fill="#fff" stroke="#1b5e20" stroke-width="5" stroke-linejoin="round"/>'); },
  gear() {
    const teeth = Array.from({ length: 8 }, (_, i) => `<rect x="28" y="4" width="8" height="12" rx="2" transform="rotate(${i * 45} 32 32)" fill="#cfd8dc" stroke="#263238" stroke-width="3"/>`).join('');
    return wrap(`${teeth}<circle cx="32" cy="32" r="18" fill="#cfd8dc" stroke="#263238" stroke-width="4"/><circle cx="32" cy="32" r="7" fill="#263238"/>`);
  },
  target() { return wrap('<circle cx="32" cy="32" r="22" fill="none" stroke="#fff" stroke-width="5"/><circle cx="32" cy="32" r="9" fill="#ff7043" stroke="#fff" stroke-width="4"/><path d="M32 2 V14 M32 50 V62 M2 32 H14 M50 32 H62" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'); },
  question() { return wrap('<text x="32" y="47" text-anchor="middle" font-family="Lilita One, sans-serif" font-size="44" fill="#fff" stroke="#0d1b3d" stroke-width="5" paint-order="stroke">?</text>'); },
  menu() { return wrap('<path d="M12 18 H52 M12 32 H52 M12 46 H52" stroke="#fff" stroke-width="7" stroke-linecap="round"/>'); },
  close() { return wrap('<path d="M16 16 L48 48 M48 16 L16 48" stroke="#fff" stroke-width="8" stroke-linecap="round"/>'); },
  home() {
    const g = 'hm' + uid++;
    return wrap(`<path d="M8 34 C8 16 56 16 56 34 V54 H8 Z" fill="url(#${g})" stroke="#37474f" stroke-width="4"/><rect x="26" y="38" width="12" height="16" rx="3" fill="#455a64"/>`,
      grad(g, '#ffffff', '#b0bec5'));
  },
  trophy() {
    const g = 'tr' + uid++;
    return wrap(`<path d="M18 8 H46 V24 C46 34 40 40 32 40 C24 40 18 34 18 24 Z" fill="url(#${g})" stroke="#6b3d00" stroke-width="4"/>
      <path d="M18 14 H8 C8 26 14 30 20 30 M46 14 H56 C56 26 50 30 44 30" fill="none" stroke="#6b3d00" stroke-width="4"/>
      <rect x="28" y="40" width="8" height="10" fill="#ffb300" stroke="#6b3d00" stroke-width="3"/><rect x="18" y="50" width="28" height="8" rx="2" fill="#8d6e63" stroke="#3e2723" stroke-width="3"/>${shine}`,
      grad(g, '#fff176', '#ff8f00'));
  },
};

export const icon = name => ICONS[name]();
