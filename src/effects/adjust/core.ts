/** Shared maths for image adjustments: curves, gradients, LUTs, colour spaces. */

export type Pt = [number, number];
export interface CurveSet { rgb: Pt[]; r: Pt[]; g: Pt[]; b: Pt[] }
export const IDENTITY_CURVES: CurveSet = { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] };

export function parseCurves(s: string): CurveSet {
  try {
    const c = JSON.parse(s);
    return { rgb: c.rgb ?? IDENTITY_CURVES.rgb, r: c.r ?? IDENTITY_CURVES.r, g: c.g ?? IDENTITY_CURVES.g, b: c.b ?? IDENTITY_CURVES.b };
  } catch {
    return IDENTITY_CURVES;
  }
}

/** Monotone cubic (Fritsch–Carlson) through the points, sampled at x ∈ [0, 1]. */
export function curveSampler(input: Pt[]): (x: number) => number {
  const pts = [...input].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n < 2) return (x) => x;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d: number[] = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** 256-entry byte LUT from a 0..1 → 0..1 function. */
export function byteLut(fn: (x: number) => number): Uint8ClampedArray {
  const l = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) l[i] = fn(i / 255) * 255;
  return l;
}

export interface Stop { p: number; c: string }
export const DEFAULT_GRADIENT: Stop[] = [{ p: 0, c: '#0b0b12' }, { p: 0.5, c: '#d6336c' }, { p: 1, c: '#ffe9a8' }];
export const GRADIENT_PRESETS: { name: string; stops: Stop[] }[] = [
  { name: 'Infra', stops: DEFAULT_GRADIENT },
  { name: 'Acid', stops: [{ p: 0, c: '#0b0c0b' }, { p: 0.55, c: '#5e8c00' }, { p: 1, c: '#c6ff2e' }] },
  { name: 'Ice', stops: [{ p: 0, c: '#04121f' }, { p: 0.5, c: '#2a7fae' }, { p: 1, c: '#eefcff' }] },
  { name: 'Thermal', stops: [{ p: 0, c: '#000004' }, { p: 0.33, c: '#7a1d7a' }, { p: 0.66, c: '#ee5a3a' }, { p: 1, c: '#fcfdbf' }] },
  { name: 'Sepia', stops: [{ p: 0, c: '#1c120a' }, { p: 0.5, c: '#8d6238' }, { p: 1, c: '#f4e7cf' }] },
  { name: 'Riso', stops: [{ p: 0, c: '#0078bf' }, { p: 0.5, c: '#ff48b0' }, { p: 1, c: '#ffe800' }] },
];

export function parseStops(s: string): Stop[] {
  try {
    const v = JSON.parse(s) as Stop[];
    if (Array.isArray(v) && v.length >= 2) return [...v].sort((a, b) => a.p - b.p);
  } catch { /* fall through */ }
  return DEFAULT_GRADIENT;
}

export const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.slice(1), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** 256 × RGB ramp through the stops. */
export function gradientRamp(stops: Stop[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(768);
  const cols = stops.map((s) => hex(s.c));
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1].p) k++;
    const a = stops[k], b = stops[k + 1];
    const u = Math.min(1, Math.max(0, (t - a.p) / Math.max(1e-5, b.p - a.p)));
    for (let c = 0; c < 3; c++) out[i * 3 + c] = cols[k][c] + (cols[k + 1][c] - cols[k][c]) * u;
  }
  return out;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1) + 1e-6);
  let h: number;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** Six hue families, as weights that sum to ≤1 for a hue in degrees. */
export const HUE_CENTERS = [0, 60, 120, 180, 240, 300];
export function hueWeight(h: number, center: number, width = 60): number {
  let d = Math.abs(h - center) % 360;
  if (d > 180) d = 360 - d;
  return d >= width ? 0 : 1 - d / width;
}

/* ───────────────────────── 3D LUT ───────────────────────── */

export interface Lut3D { size: number; data: Uint8Array; name: string }

/** Parse a .cube file (LUT_3D_SIZE, floating RGB rows, red varying fastest). */
export function parseCube(text: string, name: string): Lut3D {
  let size = 0, domMin = [0, 0, 0], domMax = [1, 1, 1];
  const vals: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('TITLE')) continue;
    if (line.startsWith('LUT_1D_SIZE')) throw new Error('1D .cube LUTs are not supported — use a 3D LUT.');
    if (line.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (line.startsWith('DOMAIN_MIN')) { domMin = line.split(/\s+/).slice(1).map(Number); continue; }
    if (line.startsWith('DOMAIN_MAX')) { domMax = line.split(/\s+/).slice(1).map(Number); continue; }
    if (/^[A-Z_]/.test(line)) continue;
    const p = line.split(/\s+/).map(Number);
    if (p.length >= 3 && p.every(Number.isFinite)) vals.push(p[0], p[1], p[2]);
  }
  if (size < 2 || size > 65) throw new Error('This file has no valid LUT_3D_SIZE.');
  if (vals.length !== size ** 3 * 3) throw new Error(`Expected ${size ** 3} colour rows, found ${vals.length / 3}.`);
  const data = new Uint8Array(vals.length);
  for (let i = 0; i < vals.length; i++) {
    const c = i % 3;
    data[i] = Math.round(Math.min(1, Math.max(0, (vals[i] - domMin[c]) / (domMax[c] - domMin[c]))) * 255);
  }
  return { size, data, name };
}

export function encodeLut(l: Lut3D): string {
  let bin = '';
  for (let i = 0; i < l.data.length; i += 8192) bin += String.fromCharCode(...l.data.subarray(i, i + 8192));
  return JSON.stringify({ name: l.name, size: l.size, b64: btoa(bin) });
}

const lutCache = new Map<string, Lut3D | null>();
export function decodeLut(s: string): Lut3D | null {
  if (!s) return null;
  if (lutCache.has(s)) return lutCache.get(s)!;
  let out: Lut3D | null = null;
  try {
    const j = JSON.parse(s);
    const bin = atob(j.b64);
    const data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    out = { name: j.name, size: j.size, data };
  } catch { /* not a LUT */ }
  if (lutCache.size > 8) lutCache.clear();
  lutCache.set(s, out);
  return out;
}

/** Trilinear lookup; r,g,b in 0..255, writes 0..255 floats into o. */
export function sampleLut(l: Lut3D, r: number, g: number, b: number, o: number[]) {
  const n = l.size - 1, S = l.size, d = l.data;
  const fx = (r / 255) * n, fy = (g / 255) * n, fz = (b / 255) * n;
  const x = Math.min(n - 1, fx | 0), y = Math.min(n - 1, fy | 0), z = Math.min(n - 1, fz | 0);
  const u = fx - x, v = fy - y, w = fz - z;
  for (let c = 0; c < 3; c++) {
    const at = (i: number, j: number, k: number) => d[(k * S * S + j * S + i) * 3 + c];
    const c00 = at(x, y, z) + (at(x + 1, y, z) - at(x, y, z)) * u;
    const c10 = at(x, y + 1, z) + (at(x + 1, y + 1, z) - at(x, y + 1, z)) * u;
    const c01 = at(x, y, z + 1) + (at(x + 1, y, z + 1) - at(x, y, z + 1)) * u;
    const c11 = at(x, y + 1, z + 1) + (at(x + 1, y + 1, z + 1) - at(x, y + 1, z + 1)) * u;
    const c0 = c00 + (c10 - c00) * v, c1 = c01 + (c11 - c01) * v;
    o[c] = c0 + (c1 - c0) * w;
  }
}

/** Selective Color ranges and their CMYK-style shifts. */
export const SEL_RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas', 'whites', 'neutrals', 'blacks'] as const;
export type SelRange = (typeof SEL_RANGES)[number];
export type SelValues = Partial<Record<SelRange, [number, number, number, number]>>;
export function parseSel(s: string): SelValues {
  try { return JSON.parse(s) ?? {}; } catch { return {}; }
}
