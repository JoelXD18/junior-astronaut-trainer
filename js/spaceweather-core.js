// Turns raw NASA DONKI data into what the game needs. Pure functions (used by the game and by tools/).

// Solar flare classes go A, B, C, M, X (each letter is 10 times stronger than the one before).
// Game storm strength: C → 1, M1–M4 → 2, M5–M9 → 3, X1–X4 → 4, X5+ → 5. A and B flares are too weak.
export function flareStrength(cls) {
  const m = /^([ABCMX])(\d+(\.\d+)?)?/.exec(cls || '');
  if (!m) return 0;
  const n = parseFloat(m[2] || '1');
  switch (m[1]) {
    case 'C': return 1;
    case 'M': return n < 5 ? 2 : 3;
    case 'X': return n < 5 ? 4 : 5;
    default: return 0;
  }
}

export function normalize({ flr = [], sep = [], gst = [] }) {
  const flares = flr
    .filter(f => f.classType && f.peakTime)
    .map(f => ({ t: f.peakTime, cls: f.classType, region: f.activeRegionNum || null, link: f.link || null }))
    .sort((a, b) => b.t.localeCompare(a.t));
  return {
    flares,
    sep: sep.map(s => ({ t: s.eventTime, link: s.link || null })).sort((a, b) => b.t.localeCompare(a.t)),
    gst: gst.map(g => ({ t: g.startTime, kp: Math.max(0, ...(g.allKpIndex || []).map(k => k.kpIndex || 0)), link: g.link || null }))
      .sort((a, b) => b.t.localeCompare(a.t)),
  };
}

// How busy the Sun has been in the last 7 days (compared with "now").
export function activity(data, now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 864e5).toISOString();
  const week = data.flares.filter(f => f.t >= weekAgo);
  const big = week.filter(f => /^[MX]/.test(f.cls)).length;
  const x = week.filter(f => /^X/.test(f.cls)).length;
  const level = x > 0 || big >= 6 ? 'high' : big >= 1 || week.length >= 10 ? 'medium' : 'low';
  return { level, week: week.length, big, x, factor: { low: .8, medium: 1, high: 1.3 }[level] };
}
