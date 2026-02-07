// Color extraction — median-cut from canvas pixels
// Pure functions, zero DOM framework dependency

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const SZ = 32;
canvas.width = SZ;
canvas.height = SZ;

export function extractPalette(img) {
  ctx.drawImage(img, 0, 0, SZ, SZ);
  const px = ctx.getImageData(0, 0, SZ, SZ).data;

  const pool = [];
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum < 20 || lum > 235) continue;
    pool.push([r, g, b]);
  }

  if (pool.length < 10) return null;

  const buckets = medianCut(pool, 3);
  buckets.sort((a, b) => b.n - a.n);
  const picks = [buckets[0].avg];

  for (let i = 1; i < buckets.length && picks.length < 3; i++) {
    const c = buckets[i].avg;
    if (picks.every(p => colorDist(p, c) > 50)) picks.push(c);
  }
  while (picks.length < 3) picks.push(picks[picks.length - 1]);

  return picks;
}

function medianCut(pixels, depth) {
  if (depth === 0 || pixels.length < 2) {
    const s = [0, 0, 0];
    pixels.forEach(p => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; });
    const n = pixels.length || 1;
    return [{ avg: [s[0] / n | 0, s[1] / n | 0, s[2] / n | 0], n }];
  }

  let best = 0, bestRange = 0;
  for (let ch = 0; ch < 3; ch++) {
    let lo = 255, hi = 0;
    for (const p of pixels) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
    if (hi - lo > bestRange) { bestRange = hi - lo; best = ch; }
  }

  pixels.sort((a, b) => a[best] - b[best]);
  const mid = pixels.length >> 1;
  return [
    ...medianCut(pixels.slice(0, mid), depth - 1),
    ...medianCut(pixels.slice(mid), depth - 1),
  ];
}

function colorDist(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// Palette → CSS helpers

export function rgb(c) {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function gradient(pal) {
  if (!pal) return 'linear-gradient(135deg, #8a8078, #6b635a, #a09889)';
  return `linear-gradient(135deg, ${rgb(pal[0])}, ${rgb(pal[1])}, ${rgb(pal[2])})`;
}

export function toHSL(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  const d = max - min;
  if (d === 0) { h = 0; s = 0; }
  else {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function tint(pal) {
  if (!pal) return 'hsl(30,8%,94%)';
  const [h, s] = toHSL(pal[0]);
  return `hsl(${h}, ${Math.min(s, 30)}%, 94%)`;
}

export function dark(pal) {
  if (!pal) return 'hsl(30,12%,28%)';
  const [h, s] = toHSL(pal[0]);
  return `hsl(${h}, ${Math.min(s + 10, 45)}%, 30%)`;
}
