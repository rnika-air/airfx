import type { EffectDefinition, RenderInput } from './types';
import { adjust, boxBlur, clamp255, hash2, hexToRgb, luminance } from '../utils/imageProcessing';

/** Helper for simple per-pixel colour mappings. */
function mapPixels(
  { src, ctx, width, height }: RenderInput,
  fn: (r: number, g: number, b: number, out: Uint8ClampedArray, i: number) => void,
) {
  const sp = src.data;
  const out = ctx.createImageData(width, height);
  const op = out.data;
  for (let i = 0; i < sp.length; i += 4) {
    fn(sp[i], sp[i + 1], sp[i + 2], op, i);
    op[i + 3] = sp[i + 3];
  }
  ctx.putImageData(out, 0, 0);
}

export const invert: EffectDefinition = {
  id: 'invert',
  name: 'Invert',
  category: 'adjust',
  description: 'Negative image with adjustable mix.',
  params: [
    { key: 'amount', label: 'Amount', type: 'range', group: 'Invert', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'lumaOnly', label: 'Luminance Only', type: 'toggle', group: 'Invert', default: false },
  ],
  render(input) {
    const a = input.params.amount as number;
    const lumaOnly = input.params.lumaOnly as boolean;
    mapPixels(input, (r, g, b, o, i) => {
      if (lumaOnly) {
        const l = luminance(r, g, b) * 255;
        const d = (255 - 2 * l) * a; // shift every channel by the luma inversion delta
        o[i] = clamp255(r + d);
        o[i + 1] = clamp255(g + d);
        o[i + 2] = clamp255(b + d);
      } else {
        o[i] = r + (255 - 2 * r) * a;
        o[i + 1] = g + (255 - 2 * g) * a;
        o[i + 2] = b + (255 - 2 * b) * a;
      }
    });
  },
};

const copyOnly = (v: Record<string, unknown>) => v.mode === 'photocopy';
const PHOTOCOPY: EffectDefinition['params'] = [
  { key: 'copyContrast', label: 'Copy Contrast', type: 'range', group: 'Photocopy', min: 0.5, max: 4, step: 0.01, default: 1.8, visibleWhen: copyOnly },
  { key: 'density', label: 'Ink Density', type: 'range', group: 'Photocopy', min: 0.2, max: 1, step: 0.01, default: 0.92, visibleWhen: copyOnly },
  { key: 'toner', label: 'Toner Grain', type: 'range', group: 'Photocopy', min: 0, max: 1, step: 0.01, default: 0.5, visibleWhen: copyOnly },
  { key: 'tonerSize', label: 'Grain Size', type: 'range', group: 'Photocopy', min: 0.5, max: 6, step: 0.1, default: 1.4, visibleWhen: copyOnly },
  { key: 'spread', label: 'Toner Spread', type: 'range', group: 'Photocopy', min: 0, max: 1, step: 0.01, default: 0.3, hint: 'Toner bleeding past the edges of dark shapes.', visibleWhen: copyOnly },
  { key: 'paper', label: 'Paper Texture', type: 'range', group: 'Photocopy', min: 0, max: 1, step: 0.01, default: 0.35, visibleWhen: copyOnly },
  { key: 'streaks', label: 'Copier Streaks', type: 'range', group: 'Photocopy', min: 0, max: 1, step: 0.01, default: 0.3, hint: 'Drum lines, uneven toner and a slight skew.', visibleWhen: copyOnly },
  { key: 'dust', label: 'Dust & Noise', type: 'range', group: 'Photocopy', min: 0, max: 1, step: 0.01, default: 0.3, visibleWhen: copyOnly },
  { key: 'generations', label: 'Copy Of A Copy', type: 'range', group: 'Photocopy', min: 1, max: 6, step: 1, default: 1, hint: 'Each generation spreads toner and loses mid-tones again.', visibleWhen: copyOnly },
  { key: 'seed', label: 'Seed', type: 'seed', group: 'Photocopy', default: 3, visibleWhen: copyOnly },
];

/**
 * A copier is not a threshold. It flattens tone with a steep curve, toner
 * clumps and spreads past edges, the drum leaves lines, paper shows through
 * thin toner, and dust lands on the glass.
 */
function photocopy(input: RenderInput) {
  const { src, ctx, width: w, height: h, params: p, unit } = input, n = w * h, d = src.data;
  const seed = p.seed as number, lv = p.level as number, ct = p.copyContrast as number, soft = Math.max(0.02, (p.softness as number) + 0.04 / ct);
  let L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = luminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
  // Uneven exposure across the glass, and drum streaks down the page.
  const st = p.streaks as number, skew = (hash2(1, 2, seed) - 0.5) * st * 0.012;
  const band = (x: number) => (hash2(Math.floor(x / Math.max(1, 3 * unit)), 7, seed) - 0.5) * 0.18 * st + Math.sin((x / w) * 6.28 * (1 + hash2(3, 3, seed) * 2)) * 0.05 * st;
  const gens = p.generations as number, spread = p.spread as number;
  let T = new Float32Array(n);
  for (let g = 0; g < gens; g++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, sx = Math.min(w - 1, Math.max(0, Math.round(x + (y - h / 2) * skew)));
      const v = L[y * w + sx] + band(x) - (y / h) * 0.04 * st;
      T[i] = 1 - Math.min(1, Math.max(0, (v - lv) / soft + 0.5));
    }
    // Toner spreads into its surroundings: darker areas grow a little.
    if (spread > 0) {
      const B = boxBlur(T, w, h, Math.max(1, spread * 2.2 * unit), 1);
      for (let i = 0; i < n; i++) T[i] = Math.min(1, Math.max(T[i], B[i] * (1 + spread * 0.9)));
    }
    if (g < gens - 1) { const next = new Float32Array(n); for (let i = 0; i < n; i++) next[i] = 1 - T[i]; L = next; }
  }
  const out = ctx.createImageData(w, h), o = out.data, dk = hexToRgb(p.dark as string), lt = hexToRgb(p.light as string);
  const dens = p.density as number, tg = p.toner as number, cell = Math.max(1, (p.tonerSize as number) * unit), pap = p.paper as number, dust = p.dust as number;
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell);
    for (let x = 0; x < w; x++) {
      const i = y * w + x, q = i * 4, gx = Math.floor(x / cell);
      // Toner sits in clumps: solid in the middle of a dark shape, broken at its edges.
      const clump = hash2(gx, gy, seed) * 0.6 + hash2(x >> 2, y >> 2, seed + 5) * 0.4, t = T[i];
      let ink = t >= 1 ? 1 - tg * 0.25 * clump : t <= 0 ? 0 : Math.min(1, Math.max(0, (t - clump * tg) / Math.max(0.05, 1 - tg) ));
      ink *= dens * (1 - st * 0.12 * hash2(Math.floor(x / Math.max(1, 6 * unit)), 1, seed + 9));
      // Paper fibre and tooth showing through thin toner and on blank areas.
      const fibre = (hash2(x, y >> 1, seed + 11) - 0.5) * pap * 0.16 + (hash2(x >> 3, y >> 3, seed + 12) - 0.5) * pap * 0.1;
      let paper = 1 + fibre;
      if (dust > 0) {
        const r = hash2(x >> 1, y >> 1, seed + 21);
        if (r > 1 - dust * 0.004) ink = 1; // specks on the glass
        else if (r < dust * 0.0012) ink = 0; // dropouts in solid toner
        ink = Math.min(1, ink + (hash2(x, y, seed + 22) - 0.5) * dust * 0.12);
      }
      for (let c = 0; c < 3; c++) o[q + c] = clamp255((lt[c] * paper) + (dk[c] - lt[c] * paper) * Math.max(0, ink));
      o[q + 3] = d[q + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
}

export const threshold: EffectDefinition = {
  id: 'threshold',
  name: 'Threshold',
  category: 'adjust',
  description: 'Two-tone hard cut at a luminance level, or a photocopy with toner, paper and copier faults.',
  params: [
    { key: 'mode', label: 'Mode', type: 'select', group: 'Threshold', default: 'clean', options: [{ value: 'clean', label: 'Clean Threshold' }, { value: 'photocopy', label: 'Photocopy / Toner Print' }] },
    { key: 'level', label: 'Level', type: 'range', group: 'Threshold', min: 0, max: 1, step: 0.005, default: 0.5, hint: 'In Photocopy mode this is the black and white balance.' },
    { key: 'softness', label: 'Softness', type: 'range', group: 'Threshold', min: 0, max: 0.5, step: 0.005, default: 0 },
    ...PHOTOCOPY,
    { key: 'dark', label: 'Dark Color', type: 'color', group: 'Color', default: '#0c0c0c' },
    { key: 'light', label: 'Light Color', type: 'color', group: 'Color', default: '#f3f1ea' },
  ],
  presets: [
    { name: 'Clean', values: { mode: 'clean' } },
    { name: 'Office Copier', values: { mode: 'photocopy' } },
    { name: 'Fifth Generation Copy', values: { mode: 'photocopy', copyContrast: 2.4, spread: 0.7, toner: 0.7, streaks: 0.6, dust: 0.6, generations: 4, density: 0.85 } },
    { name: 'Zine Toner', values: { mode: 'photocopy', copyContrast: 1.6, toner: 0.85, spread: 0.35, paper: 0.55, streaks: 0.2, dust: 0.25, light: '#efe9dc', dark: '#16130f' } },
    { name: 'Low Toner', values: { mode: 'photocopy', density: 0.45, toner: 0.9, streaks: 0.8, dust: 0.15 } },
  ],
  render(input) {
    if (input.params.mode === 'photocopy') { photocopy(input); return; }
    const lv = input.params.level as number;
    const soft = Math.max(0.0001, input.params.softness as number);
    const d = hexToRgb(input.params.dark as string);
    const l = hexToRgb(input.params.light as string);
    mapPixels(input, (r, g, b, o, i) => {
      const t = Math.min(1, Math.max(0, (luminance(r, g, b) - lv) / soft + 0.5));
      o[i] = d[0] + (l[0] - d[0]) * t;
      o[i + 1] = d[1] + (l[1] - d[1]) * t;
      o[i + 2] = d[2] + (l[2] - d[2]) * t;
    });
  },
};

export const posterize: EffectDefinition = {
  id: 'posterize',
  name: 'Posterize',
  category: 'adjust',
  description: 'Quantise colour into flat bands.',
  params: [
    { key: 'levels', label: 'Levels', type: 'range', group: 'Posterize', min: 2, max: 16, step: 1, default: 4 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  render(input) {
    const n = (input.params.levels as number) - 1;
    const c = input.params.contrast as number;
    const br = input.params.brightness as number;
    const q = (v: number) => (Math.round(adjust(v / 255, br, c) * n) / n) * 255;
    mapPixels(input, (r, g, b, o, i) => {
      o[i] = q(r);
      o[i + 1] = q(g);
      o[i + 2] = q(b);
    });
  },
};

export const duotone: EffectDefinition = {
  id: 'duotone',
  name: 'Duotone',
  category: 'adjust',
  description: 'Map tones between two inks.',
  params: [
    { key: 'shadow', label: 'Shadow Color', type: 'color', group: 'Color', default: '#1b0f3a' },
    { key: 'highlight', label: 'Highlight Color', type: 'color', group: 'Color', default: '#c6ff2e' },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.5, max: 0.5, step: 0.01, default: 0 },
  ],
  render(input) {
    const s = hexToRgb(input.params.shadow as string);
    const h = hexToRgb(input.params.highlight as string);
    const c = input.params.contrast as number;
    const br = input.params.brightness as number;
    mapPixels(input, (r, g, b, o, i) => {
      const t = adjust(luminance(r, g, b), br, c);
      o[i] = s[0] + (h[0] - s[0]) * t;
      o[i + 1] = s[1] + (h[1] - s[1]) * t;
      o[i + 2] = s[2] + (h[2] - s[2]) * t;
    });
  },
};

export const rgbShift: EffectDefinition = {
  id: 'rgbShift',
  name: 'RGB Shift',
  category: 'distortion',
  description: 'Offset colour channels along a direction.',
  params: [
    { key: 'distance', label: 'Distance', type: 'range', group: 'Shift', min: 0, max: 100, step: 0.5, default: 12 },
    { key: 'angle', label: 'Angle', type: 'range', group: 'Shift', min: 0, max: 359, step: 1, default: 0, unit: '°' },
    { key: 'greenShift', label: 'Shift Green', type: 'toggle', group: 'Shift', default: false },
  ],
  render(input) {
    const { src, width, height, unit, params } = input;
    const dist = (params.distance as number) * unit;
    const a = ((params.angle as number) * Math.PI) / 180;
    const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist;
    const g = params.greenShift ? 0.5 : 0;
    const sp = src.data;
    const at = (x: number, y: number, c: number) => {
      const xi = Math.min(width - 1, Math.max(0, Math.round(x)));
      const yi = Math.min(height - 1, Math.max(0, Math.round(y)));
      return sp[(yi * width + xi) * 4 + c];
    };
    const out = input.ctx.createImageData(width, height);
    const op = out.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        op[i] = at(x - dx, y - dy, 0);
        op[i + 1] = at(x - dx * g, y - dy * g, 1);
        op[i + 2] = at(x + dx, y + dy, 2);
        op[i + 3] = 255;
      }
    }
    input.ctx.putImageData(out, 0, 0);
  },
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const dithering: EffectDefinition = {
  id: 'dithering',
  name: 'Dithering',
  category: 'texture',
  description: 'Ordered or error-diffusion 1-bit style dithering.',
  params: [
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      group: 'Dither',
      default: 'floyd',
      options: [
        { value: 'floyd', label: 'Floyd–Steinberg' },
        { value: 'bayer', label: 'Bayer 4×4' },
      ],
    },
    { key: 'pixel', label: 'Pixel Size', type: 'range', group: 'Dither', min: 1, max: 12, step: 0.5, default: 2 },
    { key: 'levels', label: 'Levels', type: 'range', group: 'Dither', min: 2, max: 8, step: 1, default: 2 },
    { key: 'colorDither', label: 'Per-Channel Color', type: 'toggle', group: 'Dither', default: false },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: 'dark', label: 'Dark Color', type: 'color', group: 'Color', default: '#0c0c0c', visibleWhen: (v) => !v.colorDither },
    { key: 'light', label: 'Light Color', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => !v.colorDither },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const px = Math.max(1, Math.round((params.pixel as number) * unit));
    const w = Math.ceil(width / px), h = Math.ceil(height / px);
    const n = (params.levels as number) - 1;
    const color = params.colorDither as boolean;
    const contrast = params.contrast as number;
    const chans = color ? 3 : 1;
    const buf = new Float32Array(w * h * chans);
    const sp = src.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const si = (Math.min(height - 1, y * px) * width + Math.min(width - 1, x * px)) * 4;
        const o = (y * w + x) * chans;
        if (color) {
          for (let c = 0; c < 3; c++) buf[o + c] = adjust(sp[si + c] / 255, 0, contrast);
        } else {
          buf[o] = adjust(luminance(sp[si], sp[si + 1], sp[si + 2]), 0, contrast);
        }
      }
    }
    if (params.method === 'bayer') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const t = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5;
          for (let c = 0; c < chans; c++) {
            const o = (y * w + x) * chans + c;
            buf[o] = Math.min(n, Math.max(0, Math.round(buf[o] * n + t))) / n;
          }
        }
    } else {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          for (let c = 0; c < chans; c++) {
            const o = (y * w + x) * chans + c;
            const old = buf[o];
            const nv = Math.round(Math.min(1, Math.max(0, old)) * n) / n;
            const err = old - nv;
            buf[o] = nv;
            if (x + 1 < w) buf[o + chans] += (err * 7) / 16;
            if (y + 1 < h) {
              if (x > 0) buf[o + (w - 1) * chans] += (err * 3) / 16;
              buf[o + w * chans] += (err * 5) / 16;
              if (x + 1 < w) buf[o + (w + 1) * chans] += err / 16;
            }
          }
    }
    const dk = hexToRgb(params.dark as string);
    const lt = hexToRgb(params.light as string);
    const out = ctx.createImageData(width, height);
    const op = out.data;
    for (let y = 0; y < height; y++) {
      const by = Math.floor(y / px);
      for (let x = 0; x < width; x++) {
        const o = (by * w + Math.floor(x / px)) * chans;
        const i = (y * width + x) * 4;
        if (color) {
          op[i] = buf[o] * 255;
          op[i + 1] = buf[o + 1] * 255;
          op[i + 2] = buf[o + 2] * 255;
        } else {
          const t = buf[o];
          op[i] = dk[0] + (lt[0] - dk[0]) * t;
          op[i + 1] = dk[1] + (lt[1] - dk[1]) * t;
          op[i + 2] = dk[2] + (lt[2] - dk[2]) * t;
        }
        op[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
