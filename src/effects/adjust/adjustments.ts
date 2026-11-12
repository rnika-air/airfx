import type { EffectDefinition, ParamDef, RenderInput } from '../types';
import { toLuma, boxBlur } from '../../utils/imageProcessing';
import {
  SEL_RANGES, byteLut, curveSampler, decodeLut, gradientRamp, hex, hslToRgb, hueWeight, HUE_CENTERS, parseCurves,
  parseSel, parseStops, rgbToHsl, sampleLut, type Lut3D,
} from './core';

/** Per-pixel helper; alpha is preserved. fn receives 0..255 floats and writes rgb. */
function map(input: RenderInput, fn: (r: number, g: number, b: number, o: Uint8ClampedArray, i: number) => void) {
  const { src, ctx, width, height } = input;
  const d = src.data, out = ctx.createImageData(width, height), o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    fn(d[i], d[i + 1], d[i + 2], o, i);
    o[i + 3] = d[i + 3];
  }
  ctx.putImageData(out, 0, 0);
}

const range = (key: string, label: string, min: number, max: number, step: number, def: number, group?: string, unit?: string): ParamDef =>
  ({ key, label, type: 'range', min, max, step, default: def, group, unit });
const A = (id: string, name: string, description: string, params: ParamDef[], render: EffectDefinition['render'], extra: Partial<EffectDefinition> = {}): EffectDefinition =>
  ({ id, name, category: 'adjust', description, params, render, ...extra });

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const light = A('adjLight', 'Light', 'Exposure, contrast, and independent highlight / shadow / white / black recovery.', [
  range('exposure', 'Exposure', -3, 3, 0.01, 0, 'Light', 'EV'),
  range('brightness', 'Brightness', -100, 100, 1, 0, 'Light'),
  range('contrast', 'Contrast', -100, 100, 1, 0, 'Light'),
  range('highlights', 'Highlights', -100, 100, 1, 0, 'Tone'),
  range('shadows', 'Shadows', -100, 100, 1, 0, 'Tone'),
  range('whites', 'Whites', -100, 100, 1, 0, 'Tone'),
  range('blacks', 'Blacks', -100, 100, 1, 0, 'Tone'),
], (input) => {
  const p = input.params;
  const ex = 2 ** (p.exposure as number), br = (p.brightness as number) / 200, ct = 1 + (p.contrast as number) / 100;
  const hi = (p.highlights as number) / 100, sh = (p.shadows as number) / 100, wh = (p.whites as number) / 100, bl = (p.blacks as number) / 100;
  // Tone is applied as a luminance gain, so hue is kept when pushing shadows.
  const tone = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y = x * ex + br;
    y = (y - 0.5) * ct + 0.5;
    y += sh * 0.45 * (1 - x) ** 3 * x * 6.75 * 0.6;
    y += hi * 0.45 * x ** 3 * (1 - x) * 6.75 * 0.6;
    y += wh * 0.25 * x ** 4;
    y += bl * 0.25 * (1 - x) ** 4;
    tone[i] = Math.max(0, Math.min(1.2, y));
  }
  map(input, (r, g, b, o, i) => {
    const l = Math.round(Math.min(255, lum(r, g, b)));
    const k = l > 0 ? (tone[l] * 255) / l : 1;
    const add = l === 0 ? tone[0] * 255 : 0;
    o[i] = r * k + add; o[i + 1] = g * k + add; o[i + 2] = b * k + add;
  });
});

export const colorVibrance = A('adjColor', 'Color & Vibrance', 'White balance, saturation, and vibrance that protects already-vivid colours.', [
  range('temperature', 'Temperature', -100, 100, 1, 0, 'White Balance'),
  range('tint', 'Tint', -100, 100, 1, 0, 'White Balance'),
  range('saturation', 'Saturation', -100, 100, 1, 0, 'Color'),
  range('vibrance', 'Vibrance', -100, 100, 1, 0, 'Color'),
  range('red', 'Red Intensity', -100, 100, 1, 0, 'Individual Colors'),
  range('green', 'Green Intensity', -100, 100, 1, 0, 'Individual Colors'),
  range('blue', 'Blue Intensity', -100, 100, 1, 0, 'Individual Colors'),
], (input) => {
  const p = input.params;
  const t = (p.temperature as number) / 100, ti = (p.tint as number) / 100, sat = 1 + (p.saturation as number) / 100, vib = (p.vibrance as number) / 100;
  const rm = 1 + t * 0.25 + ti * 0.1 + (p.red as number) / 200, gm = 1 - ti * 0.2 + (p.green as number) / 200, bm = 1 - t * 0.25 + ti * 0.1 + (p.blue as number) / 200;
  map(input, (r0, g0, b0, o, i) => {
    const r = r0 * rm, g = g0 * gm, b = b0 * bm;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = lum(r, g, b);
    const s = max > 0 ? (max - min) / max : 0;
    const k = sat * (1 + vib * (1 - s) * (vib > 0 ? 1.4 : 1));
    o[i] = l + (r - l) * k; o[i + 1] = l + (g - l) * k; o[i + 2] = l + (b - l) * k;
  });
});

export const clarity = A('adjClarity', 'Clarity & Dehaze', 'Clarity boosts mid-frequency local contrast. Dehaze estimates and removes atmospheric veil.', [
  range('clarity', 'Clarity', -100, 100, 1, 0, 'Clarity'),
  { ...range('radius', 'Radius', 2, 80, 1, 24, 'Clarity'), visibleWhen: (v) => v.clarity !== 0 },
  range('dehaze', 'Dehaze', -100, 100, 1, 0, 'Dehaze'),
  { ...range('patch', 'Haze Patch Size', 4, 60, 1, 16, 'Dehaze'), visibleWhen: (v) => v.dehaze !== 0 },
], (input) => {
  const { src, width, height, unit, params: p } = input;
  const cl = (p.clarity as number) / 100, dz = (p.dehaze as number) / 100;
  const L = toLuma(src);
  const blur = boxBlur(L, width, height, (p.radius as number) * unit, 2);
  // Dark-channel prior: haze lifts the minimum channel, so its local minimum estimates the veil.
  let veil: Float32Array | null = null, air = 1;
  if (dz !== 0) {
    const d = src.data, dark = new Float32Array(width * height);
    for (let i = 0; i < dark.length; i++) dark[i] = Math.min(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]) / 255;
    const r = Math.max(1, Math.round((p.patch as number) * unit / 2));
    const small = erodeRows(dark, width, height, r);
    veil = boxBlur(small, width, height, r * 2, 2);
    let hi = 0;
    for (let i = 0; i < veil.length; i += 7) if (veil[i] > hi) hi = veil[i];
    air = Math.max(0.5, Math.min(1, hi + 0.05));
  }
  let idx = 0;
  map(input, (r, g, b, o, i) => {
    const l = L[idx], detail = l - blur[idx];
    // Midtone mask: clarity leaves pure blacks and whites alone.
    const k = 1 + (cl * detail * 3.2 * (1 - Math.abs(2 * l - 1) ** 2)) / Math.max(0.05, l);
    let R = r * k, G = g * k, B = b * k;
    if (veil) {
      const t = Math.max(0.15, 1 - 0.95 * Math.max(0, dz) * (veil[idx] / air));
      const A255 = air * 255;
      if (dz > 0) {
        R = (R - A255) / t + A255; G = (G - A255) / t + A255; B = (B - A255) / t + A255;
      } else {
        const a = -dz * 0.6 * (0.4 + 0.6 * l);
        R += (A255 - R) * a; G += (A255 - G) * a; B += (A255 - B) * a;
      }
    }
    o[i] = R; o[i + 1] = G; o[i + 2] = B;
    idx++;
  });
});

/** Fast approximate min filter (row + column minimum). */
function erodeRows(s: Float32Array, w: number, h: number, r: number): Float32Array {
  const a = new Float32Array(s.length), b = new Float32Array(s.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = 1;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += Math.max(1, r >> 1)) if (s[y * w + k] < m) m = s[y * w + k];
      a[y * w + x] = m;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let m = 1;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += Math.max(1, r >> 1)) if (a[k * w + x] < m) m = a[k * w + x];
      b[y * w + x] = m;
    }
  return b;
}

export const levels = A('adjLevels', 'Levels', 'Input black, gamma and white points, plus output levels.', [
  range('black', 'Black Point', 0, 253, 1, 0, 'Input'),
  range('gamma', 'Midtone (Gamma)', 0.1, 5, 0.01, 1, 'Input'),
  range('white', 'White Point', 2, 255, 1, 255, 'Input'),
  range('outBlack', 'Output Black', 0, 255, 1, 0, 'Output'),
  range('outWhite', 'Output White', 0, 255, 1, 255, 'Output'),
], (input) => {
  const p = input.params;
  const b0 = p.black as number, w0 = Math.max(b0 + 1, p.white as number), g = 1 / (p.gamma as number);
  const ob = p.outBlack as number, ow = p.outWhite as number;
  const l = byteLut((x) => {
    const n = Math.min(1, Math.max(0, (x * 255 - b0) / (w0 - b0)));
    return (ob + (ow - ob) * n ** g) / 255;
  });
  map(input, (r, g2, b, o, i) => { o[i] = l[r]; o[i + 1] = l[g2]; o[i + 2] = l[b]; });
});

export const curves = A('adjCurves', 'Curves', 'Editable tone curves for RGB, red, green and blue.', [
  { key: 'curves', label: 'Curves', type: 'custom', editor: 'curves', group: 'Curves', default: '' },
], (input) => {
  const c = parseCurves(input.params.curves as string);
  const m = byteLut(curveSampler(c.rgb)), lr = byteLut(curveSampler(c.r)), lg = byteLut(curveSampler(c.g)), lb = byteLut(curveSampler(c.b));
  map(input, (r, g, b, o, i) => { o[i] = lr[m[r]]; o[i + 1] = lg[m[g]]; o[i + 2] = lb[m[b]]; });
});

export const exposure = A('adjExposure', 'Exposure', 'Linear-light exposure, offset and gamma correction.', [
  range('exposure', 'Exposure', -5, 5, 0.01, 0, 'Exposure', 'EV'),
  range('offset', 'Offset', -0.5, 0.5, 0.001, 0, 'Exposure'),
  range('gamma', 'Gamma Correction', 0.1, 4, 0.01, 1, 'Exposure'),
], (input) => {
  const ex = 2 ** (input.params.exposure as number), of = input.params.offset as number, g = 1 / (input.params.gamma as number);
  // Work in linear light, as a camera exposure change does.
  const l = byteLut((x) => {
    const lin = x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    const v = Math.max(0, lin * ex + of) ** g;
    return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  });
  map(input, (r, g2, b, o, i) => { o[i] = l[r]; o[i + 1] = l[g2]; o[i + 2] = l[b]; });
});

const HUES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
const HUE_LABEL = ['Reds', 'Yellows', 'Greens', 'Cyans', 'Blues', 'Magentas'];

export const hueSat = A('adjHueSat', 'Hue / Saturation', 'Master hue, saturation and lightness, plus per-colour ranges.', [
  range('hue', 'Hue', -180, 180, 1, 0, 'Master', '°'),
  range('saturation', 'Saturation', -100, 100, 1, 0, 'Master'),
  range('lightness', 'Lightness', -100, 100, 1, 0, 'Master'),
  ...HUES.flatMap((h, i) => [
    range(`${h}H`, `${HUE_LABEL[i]} Hue`, -180, 180, 1, 0, 'Color Ranges', '°'),
    range(`${h}S`, `${HUE_LABEL[i]} Saturation`, -100, 100, 1, 0, 'Color Ranges'),
  ]),
], (input) => {
  const p = input.params;
  const mh = p.hue as number, ms = 1 + (p.saturation as number) / 100, ml = (p.lightness as number) / 100;
  const rh = HUES.map((h) => p[`${h}H`] as number), rs = HUES.map((h) => (p[`${h}S`] as number) / 100);
  const anyRange = rh.some(Boolean) || rs.some(Boolean);
  map(input, (r, g, b, o, i) => {
    let [h, s, l] = rgbToHsl(r / 255, g / 255, b / 255);
    let dh = mh, sm = ms;
    if (anyRange && s > 0.01) {
      for (let k = 0; k < 6; k++) {
        const w = hueWeight(h, HUE_CENTERS[k]);
        if (w > 0) { dh += rh[k] * w; sm *= 1 + rs[k] * w; }
      }
    }
    h += dh; s = Math.min(1, s * sm);
    l = ml > 0 ? l + (1 - l) * ml : l * (1 + ml);
    const [R, G, B] = hslToRgb(h, s, l);
    o[i] = R * 255; o[i + 1] = G * 255; o[i + 2] = B * 255;
  });
});

const tonesParams = (['shadows', 'midtones', 'highlights'] as const).flatMap((t) => {
  const g = t[0].toUpperCase() + t.slice(1);
  return [
    range(`${t}CR`, 'Cyan ↔ Red', -100, 100, 1, 0, g),
    range(`${t}MG`, 'Magenta ↔ Green', -100, 100, 1, 0, g),
    range(`${t}YB`, 'Yellow ↔ Blue', -100, 100, 1, 0, g),
  ];
});

export const colorBalance = A('adjBalance', 'Color Balance', 'Push shadows, midtones and highlights independently along three colour axes.', [
  ...tonesParams,
  { key: 'preserve', label: 'Preserve Luminosity', type: 'toggle', group: 'Options', default: true },
], (input) => {
  const p = input.params;
  const v = (t: string, k: string) => ((p[`${t}${k}`] as number) / 100) * 60;
  const preserve = p.preserve as boolean;
  const sh = [v('shadows', 'CR'), v('shadows', 'MG'), v('shadows', 'YB')];
  const mi = [v('midtones', 'CR'), v('midtones', 'MG'), v('midtones', 'YB')];
  const hi = [v('highlights', 'CR'), v('highlights', 'MG'), v('highlights', 'YB')];
  map(input, (r, g, b, o, i) => {
    const l = lum(r, g, b) / 255;
    const ws = Math.max(0, 1 - l * 2.2), wh = Math.max(0, l * 2.2 - 1.2), wm = Math.max(0, 1 - ws - wh);
    let R = r + sh[0] * ws + mi[0] * wm + hi[0] * wh;
    let G = g + sh[1] * ws + mi[1] * wm + hi[1] * wh;
    let B = b + sh[2] * ws + mi[2] * wm + hi[2] * wh;
    if (preserve) {
      const d = lum(r, g, b) - lum(R, G, B);
      R += d; G += d; B += d;
    }
    o[i] = R; o[i + 1] = G; o[i + 2] = B;
  });
});

export const blackWhite = A('adjBW', 'Black & White', 'Mono conversion with a separate contribution for each colour.', [
  range('reds', 'Reds', -200, 300, 1, 40, 'Mix', '%'),
  range('yellows', 'Yellows', -200, 300, 1, 60, 'Mix', '%'),
  range('greens', 'Greens', -200, 300, 1, 40, 'Mix', '%'),
  range('cyans', 'Cyans', -200, 300, 1, 60, 'Mix', '%'),
  range('blues', 'Blues', -200, 300, 1, 20, 'Mix', '%'),
  range('magentas', 'Magentas', -200, 300, 1, 80, 'Mix', '%'),
  { key: 'tintOn', label: 'Tint', type: 'toggle', group: 'Tint', default: false },
  { key: 'tint', label: 'Tint Color', type: 'color', group: 'Tint', default: '#d9b98c', visibleWhen: (v) => v.tintOn === true },
], (input) => {
  const p = input.params;
  const w = HUES.map((h) => (p[h] as number) / 100);
  const tint = p.tintOn ? hex(p.tint as string).map((c) => c / 255) : [1, 1, 1];
  map(input, (r, g, b, o, i) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const chroma = max > 0 ? (max - min) / max : 0;
    const [h] = rgbToHsl(r / 255, g / 255, b / 255);
    let weight = 0;
    for (let k = 0; k < 6; k++) weight += hueWeight(h, HUE_CENTERS[k]) * w[k];
    // Neutrals keep their luminance; coloured pixels take their colour's slider.
    const v = lum(r, g, b) * (1 - chroma) + max * weight * chroma;
    o[i] = v * tint[0]; o[i + 1] = v * tint[1]; o[i + 2] = v * tint[2];
  });
});

export const photoFilter = A('adjPhotoFilter', 'Photo Filter', 'Simulates a coloured lens filter.', [
  {
    key: 'preset', label: 'Filter', type: 'select', group: 'Filter', default: 'warm',
    options: [{ value: 'warm', label: 'Warming' }, { value: 'cool', label: 'Cooling' }, { value: 'sepia', label: 'Sepia' }, { value: 'deepred', label: 'Deep Red' }, { value: 'underwater', label: 'Underwater' }, { value: 'custom', label: 'Custom' }],
  },
  { key: 'color', label: 'Filter Color', type: 'color', group: 'Filter', default: '#ec8a00', visibleWhen: (v) => v.preset === 'custom' },
  range('density', 'Density', 0, 100, 1, 25, 'Filter', '%'),
  { key: 'preserve', label: 'Preserve Luminosity', type: 'toggle', group: 'Filter', default: true },
], (input) => {
  const P: Record<string, string> = { warm: '#ec8a00', cool: '#006dff', sepia: '#ac7a33', deepred: '#d9200f', underwater: '#00c1b1' };
  const c = hex(input.params.preset === 'custom' ? (input.params.color as string) : P[input.params.preset as string]);
  const d = (input.params.density as number) / 100, keep = input.params.preserve as boolean;
  map(input, (r, g, b, o, i) => {
    // A filter passes its own colour: multiply, mixed by density.
    let R = r + ((r * c[0]) / 255 - r) * d, G = g + ((g * c[1]) / 255 - g) * d, B = b + ((b * c[2]) / 255 - b) * d;
    if (keep) {
      const l0 = lum(r, g, b), l1 = Math.max(1, lum(R, G, B)), k = l0 / l1;
      R *= k; G *= k; B *= k;
    }
    o[i] = R; o[i + 1] = G; o[i + 2] = B;
  });
});

const mixParams = (['R', 'G', 'B'] as const).flatMap((out) => [
  range(`${out}r`, 'From Red', -200, 200, 1, out === 'R' ? 100 : 0, `Output ${out}`, '%'),
  range(`${out}g`, 'From Green', -200, 200, 1, out === 'G' ? 100 : 0, `Output ${out}`, '%'),
  range(`${out}b`, 'From Blue', -200, 200, 1, out === 'B' ? 100 : 0, `Output ${out}`, '%'),
  range(`${out}c`, 'Constant', -100, 100, 1, 0, `Output ${out}`, '%'),
]);

export const channelMixer = A('adjMixer', 'Channel Mixer', 'Build each output channel from the original red, green and blue.', [
  ...mixParams,
  { key: 'mono', label: 'Monochrome', type: 'toggle', group: 'Options', default: false },
], (input) => {
  const p = input.params;
  const c = (k: string) => (p[k] as number) / 100;
  const m = [c('Rr'), c('Rg'), c('Rb'), c('Rc') * 255, c('Gr'), c('Gg'), c('Gb'), c('Gc') * 255, c('Br'), c('Bg'), c('Bb'), c('Bc') * 255];
  const mono = p.mono as boolean;
  map(input, (r, g, b, o, i) => {
    const R = m[0] * r + m[1] * g + m[2] * b + m[3];
    o[i] = R;
    o[i + 1] = mono ? R : m[4] * r + m[5] * g + m[6] * b + m[7];
    o[i + 2] = mono ? R : m[8] * r + m[9] * g + m[10] * b + m[11];
  });
});

/** Built-in looks are generated, so Color Lookup works before you load a file. */
function builtinLut(name: string): Lut3D | null {
  const S = 17, data = new Uint8Array(S ** 3 * 3);
  const f: Record<string, (r: number, g: number, b: number) => [number, number, number]> = {
    tealOrange: (r, g, b) => {
      const l = 0.3 * r + 0.6 * g + 0.1 * b, k = l - 0.5;
      return [r + k * 0.28, g + k * 0.02, b - k * 0.32];
    },
    bleach: (r, g, b) => {
      const l = 0.3 * r + 0.6 * g + 0.1 * b, c = (x: number) => (x - 0.5) * 1.35 + 0.5;
      return [c(l + (r - l) * 0.45), c(l + (g - l) * 0.45), c(l + (b - l) * 0.45)];
    },
    cross: (r, g, b) => [r ** 0.8, g * (2 - g) * 0.92, b ** 1.35 + 0.06],
    faded: (r, g, b) => [0.08 + r * 0.82, 0.07 + g * 0.82, 0.1 + b * 0.78],
  };
  const fn = f[name];
  if (!fn) return null;
  for (let z = 0; z < S; z++)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const v = fn(x / (S - 1), y / (S - 1), z / (S - 1));
        const i = (z * S * S + y * S + x) * 3;
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(1, v[c])) * 255;
      }
  return { size: S, data, name };
}
const builtins = new Map<string, Lut3D | null>();

export const colorLookup = A('adjLookup', 'Color Lookup', 'Grade through a 3D LUT: load your own .cube file or use a built-in look.', [
  {
    key: 'source', label: 'Look', type: 'select', group: 'LUT', default: 'tealOrange',
    options: [{ value: 'tealOrange', label: 'Teal & Orange' }, { value: 'bleach', label: 'Bleach Bypass' }, { value: 'cross', label: 'Cross Process' }, { value: 'faded', label: 'Faded Film' }, { value: 'file', label: 'My .cube File' }],
  },
  { key: 'lut', label: '.cube File', type: 'custom', editor: 'lut', group: 'LUT', default: '', visibleWhen: (v) => v.source === 'file' },
  range('intensity', 'Intensity', 0, 100, 1, 100, 'LUT', '%'),
], (input) => {
  const s = input.params.source as string;
  let lut: Lut3D | null;
  if (s === 'file') lut = decodeLut(input.params.lut as string);
  else {
    if (!builtins.has(s)) builtins.set(s, builtinLut(s));
    lut = builtins.get(s)!;
  }
  if (!lut) { input.ctx.putImageData(input.src, 0, 0); return; }
  const a = (input.params.intensity as number) / 100, t = [0, 0, 0];
  map(input, (r, g, b, o, i) => {
    sampleLut(lut!, r, g, b, t);
    o[i] = r + (t[0] - r) * a; o[i + 1] = g + (t[1] - g) * a; o[i + 2] = b + (t[2] - b) * a;
  });
});

export const selectiveColor = A('adjSelective', 'Selective Color', 'Shift cyan, magenta, yellow and black inside one colour family or tone range.', [
  { key: 'values', label: 'Ranges', type: 'custom', editor: 'selectiveColor', group: 'Selective Color', default: '{}' },
  { key: 'method', label: 'Method', type: 'select', group: 'Selective Color', default: 'relative', options: [{ value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Absolute' }] },
], (input) => {
  const vals = parseSel(input.params.values as string);
  const rel = input.params.method === 'relative';
  const list = SEL_RANGES.map((n, k) => ({ k, v: vals[n] })).filter((x) => x.v && x.v.some(Boolean));
  if (!list.length) { input.ctx.putImageData(input.src, 0, 0); return; }
  map(input, (r, g, b, o, i) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), [h] = rgbToHsl(r / 255, g / 255, b / 255);
    const chroma = (max - min) / 255, l = (max + min) / 510;
    let R = r, G = g, B = b;
    for (const { k, v } of list) {
      let w: number;
      if (k < 6) w = hueWeight(h, HUE_CENTERS[k]) * chroma;
      else if (k === 6) w = Math.max(0, (l - 0.5) * 2) * (1 - chroma);
      else if (k === 7) w = (1 - Math.abs(2 * l - 1)) * (1 - chroma);
      else w = Math.max(0, (0.5 - l) * 2) * (1 - chroma);
      if (w <= 0) continue;
      const [c, m, y, kk] = v as [number, number, number, number];
      const scale = (x: number) => (rel ? (255 - x) / 255 + 0.15 : 1) * 2.55 * w;
      R -= (c + kk) * scale(R) * (rel ? 1 : 0.6);
      G -= (m + kk) * scale(G) * (rel ? 1 : 0.6);
      B -= (y + kk) * scale(B) * (rel ? 1 : 0.6);
    }
    o[i] = R; o[i + 1] = G; o[i + 2] = B;
  });
});

export const gradientMap = A('adjGradientMap', 'Gradient Map', 'Map image brightness onto your own multi-stop gradient.', [
  { key: 'stops', label: 'Gradient', type: 'custom', editor: 'gradient', group: 'Gradient', default: '' },
  { key: 'reverse', label: 'Reverse', type: 'toggle', group: 'Gradient', default: false },
  range('mix', 'Intensity', 0, 100, 1, 100, 'Gradient', '%'),
], (input) => {
  const ramp = gradientRamp(parseStops(input.params.stops as string));
  const rev = input.params.reverse as boolean, a = (input.params.mix as number) / 100;
  map(input, (r, g, b, o, i) => {
    const l = Math.round(lum(r, g, b)), k = (rev ? 255 - l : l) * 3;
    o[i] = r + (ramp[k] - r) * a; o[i + 1] = g + (ramp[k + 1] - g) * a; o[i + 2] = b + (ramp[k + 2] - b) * a;
  });
});

export const ADJUSTMENTS = [light, colorVibrance, clarity, levels, curves, exposure, hueSat, colorBalance, blackWhite, photoFilter, channelMixer, colorLookup, selectiveColor, gradientMap];

/** The Image Adjustments panel. Grain, Invert, Posterize and Threshold reuse existing effects, so they share one code path. */
export const ADJUSTMENT_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'Light', ids: ['adjLight', 'adjColor', 'adjClarity', 'filmGrain'] },
  { title: 'Tonal Adjustments', ids: ['adjLevels', 'adjCurves', 'adjExposure'] },
  { title: 'Color Adjustments', ids: ['adjHueSat', 'adjBalance', 'adjBW', 'adjPhotoFilter', 'adjMixer', 'adjLookup', 'adjSelective'] },
  { title: 'Special Adjustments', ids: ['invert', 'posterize', 'threshold', 'adjGradientMap'] },
];
