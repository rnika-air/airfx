import type { EffectDefinition, ParamDef } from '../types';
import { boxBlur, clamp255, createCanvas, createRng, fbm, get2d, hash2, hexToRgb, toLuma } from '../../utils/imageProcessing';
import { C, R, S } from '../generative';

/**
 * A soft, surreal treatment. The reference has two faces, so both are here:
 * photographic haze and bloom, and a grainy pigment that bleeds out of the
 * subject into paper. Every stage below runs in either look.
 */

const pigmentOnly = (d: ParamDef): ParamDef => ({ ...d, visibleWhen: (v) => v.look === 'pigment' });
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };

/** Blurs at a reduced size, so a huge radius costs the same as a small one. */
function softCopy(source: CanvasImageSource, w: number, h: number, radius: number, keep?: (l: number) => number) {
  const k = Math.max(1, Math.floor(radius / 4)), sw = Math.max(2, Math.round(w / k)), sh = Math.max(2, Math.round(h / k));
  const c = createCanvas(sw, sh), g = get2d(c, true);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, sw, sh);
  const im = g.getImageData(0, 0, sw, sh), d = im.data, n = sw * sh, P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], gr = d[i * 4 + 1], b = d[i * 4 + 2], m = keep ? keep((0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255) : 1;
    P[0][i] = r * m; P[1][i] = gr * m; P[2][i] = b * m;
  }
  const rad = radius / k, Q = P.map((p) => boxBlur(p, sw, sh, rad, 3));
  for (let i = 0; i < n; i++) { d[i * 4] = Q[0][i]; d[i * 4 + 1] = Q[1][i]; d[i * 4 + 2] = Q[2][i]; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  return c;
}

/** Ink that settles dark in the subject and thins out, speck by speck, into the paper. */
function pigment(src: ImageData, p: Record<string, unknown>, unit: number, target: CanvasRenderingContext2D, time: number) {
  const { width: w, height: h } = src, L = toLuma(src), n = w * h, th = p.threshold as number, inv = p.invertPigment as boolean;
  const D = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = inv ? L[i] : 1 - L[i]; D[i] = smooth(1 - th - 0.18, 1 - th + 0.18, v); }
  const rad = (p.spread as number) * unit, k = Math.max(1, Math.floor(rad / 6)), sw = Math.ceil(w / k), sh = Math.ceil(h / k), S0 = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) S0[y * sw + x] = D[Math.min(h - 1, y * k) * w + Math.min(w - 1, x * k)];
  const B = boxBlur(S0, sw, sh, rad / k, 3);
  const a = hexToRgb(p.ink3 as string), b = hexToRgb(p.ink1 as string), c = hexToRgb(p.ink2 as string), paper = hexToRgb(p.paper as string);
  const out = target.createImageData(w, h), o = out.data, d = src.data, cell = Math.max(1, (p.grainSize as number) * unit), dens = p.density as number, keepC = p.pigmentSat as number, seed = p.seed as number;
  const moved = (p.grainMove as number) > 0 ? Math.floor(time * (p.grainMove as number) * 24) : 0;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, (y / k) | 0), gy = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, q = i * 4;
      const halo = B[sy * sw + Math.min(sw - 1, (x / k) | 0)], cov = clamp01(Math.max(D[i], halo * (0.75 + dens)) * (0.55 + dens)), speck = hash2(((x / cell) | 0) + moved * 7, gy, seed);
      // Dense pigment is solid. Thin pigment breaks up into grains.
      const on = smooth(speck - 0.12, speck + 0.12, cov ** 1.3);
      const t = cov * 2, m = t < 1 ? t : t - 1, A = t < 1 ? a : b, Z = t < 1 ? b : c;
      for (let ch = 0; ch < 3; ch++) {
        const ink = A[ch] + (Z[ch] - A[ch]) * m, tinted = ink + (d[q + ch] - ink) * keepC;
        o[q + ch] = paper[ch] + (tinted - paper[ch]) * on;
      }
      o[q + 3] = 255;
    }
  }
  target.putImageData(out, 0, 0);
}

export const dreamy: EffectDefinition = {
  id: 'dreamy', name: 'Dreamy', category: 'light',
  description: 'Bloom, soft blur, light leaks, haze and colour fringing, or a grainy pigment that bleeds into paper.',
  animated: (p) => (p.leakSpeed as number) > 0 || (p.hazeDrift as number) > 0 || (p.grainMove as number) > 0,
  audioDefaults: { bloom: { band: 'bass', amount: 0.25 }, chroma: { band: 'beat', amount: 0.2 } },
  params: [
    S('look', 'Look', 'soft', [['soft', 'Soft Dream'], ['pigment', 'Pigment Bloom']], 'Look'),
    R('intensity', 'Intensity', 0, 1, 0.01, 0.85, 'Look'),
    pigmentOnly(C('paper', 'Paper', '#f3f9ff', 'Pigment')),
    pigmentOnly(C('ink2', 'Deep Pigment', '#0a0730', 'Pigment')),
    pigmentOnly(C('ink1', 'Mid Pigment', '#1600ee', 'Pigment')),
    pigmentOnly(C('ink3', 'Thin Pigment', '#8c92e8', 'Pigment')),
    pigmentOnly(R('threshold', 'Subject Threshold', 0, 1, 0.01, 0.5, 'Pigment', 'Which tones count as the subject.')),
    pigmentOnly(R('spread', 'Bleed', 0, 200, 1, 60, 'Pigment', 'How far pigment travels from the subject.')),
    pigmentOnly(R('density', 'Pigment Density', 0, 1, 0.01, 0.45, 'Pigment')),
    pigmentOnly(R('grainSize', 'Pigment Grain', 0.5, 8, 0.1, 1.4, 'Pigment')),
    pigmentOnly(R('pigmentSat', 'Keep Image Color', 0, 1, 0.01, 0, 'Pigment')),
    pigmentOnly({ key: 'invertPigment', label: 'Light Subject', type: 'toggle', default: false, group: 'Pigment', hint: 'Use for a bright subject on a dark background.' }),
    R('bloom', 'Bloom', 0, 2, 0.01, 0.75, 'Bloom & Glow'),
    R('bloomThreshold', 'Bloom Threshold', 0, 1, 0.01, 0.5, 'Bloom & Glow'),
    R('bloomSize', 'Bloom Size', 4, 200, 1, 55, 'Bloom & Glow'),
    R('blur', 'Dreamy Blur', 0, 1, 0.01, 0.35, 'Blur'),
    R('blurSize', 'Blur Size', 1, 100, 0.5, 16, 'Blur'),
    R('leak', 'Light Leaks', 0, 1, 0.01, 0.4, 'Light Leaks'),
    R('leakCount', 'Leak Count', 1, 6, 1, 3, 'Light Leaks'),
    R('leakSize', 'Leak Size', 0.1, 1.5, 0.01, 0.65, 'Light Leaks'),
    R('leakSpeed', 'Leak Drift', 0, 2, 0.01, 0.15, 'Light Leaks'),
    C('leakA', 'Leak Color A', '#ff5a36', 'Light Leaks'),
    C('leakB', 'Leak Color B', '#ff3fa4', 'Light Leaks'),
    R('haze', 'Haze', 0, 1, 0.01, 0.25, 'Haze'),
    R('hazeSize', 'Haze Size', 50, 900, 5, 380, 'Haze'),
    R('hazeDrift', 'Haze Drift', 0, 2, 0.01, 0, 'Haze'),
    C('hazeColor', 'Haze Color', '#ffe6f2', 'Haze'),
    R('chroma', 'Chromatic Distortion', 0, 40, 0.1, 4, 'Chromatic'),
    S('chromaMode', 'Fringe Shape', 'radial', [['radial', 'From Center'], ['linear', 'Along An Angle']], 'Chromatic'),
    { ...R('chromaAngle', 'Fringe Angle', 0, 359, 1, 0, 'Chromatic'), visibleWhen: (v) => v.chromaMode === 'linear' },
    R('grade', 'Color Grade', 0, 1, 0.01, 0.4, 'Color Grade'),
    C('shadowTint', 'Shadows', '#27195e', 'Color Grade'),
    C('midTint', 'Midtones', '#d07ab0', 'Color Grade'),
    C('highTint', 'Highlights', '#fff0d6', 'Color Grade'),
    R('saturation', 'Saturation', 0, 2, 0.01, 1.05, 'Color Grade'),
    R('lift', 'Lifted Blacks', 0, 0.5, 0.005, 0.06, 'Color Grade'),
    R('grain', 'Film Grain', 0, 1, 0.01, 0.1, 'Finish'),
    R('grainMove', 'Grain Motion', 0, 1, 0.01, 0, 'Finish'),
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Finish' },
  ],
  presets: [
    { name: 'Soft Dream', values: { look: 'soft' } },
    { name: 'Pigment Bloom', values: { look: 'pigment', bloom: 0, blur: 0, leak: 0, haze: 0, chroma: 0, grade: 0, grain: 0.05, lift: 0, saturation: 1 } },
    { name: 'Ultraviolet', values: { look: 'soft', shadowTint: '#12005e', midTint: '#6a2bff', highTint: '#ffd0f4', grade: 0.75, leakA: '#7a2bff', leakB: '#ff2fb0', chroma: 10, bloom: 1.1 } },
    { name: 'Faded Memory', values: { look: 'soft', blur: 0.55, haze: 0.5, lift: 0.18, saturation: 0.7, grain: 0.3, bloom: 0.5, chroma: 1.5 } },
    { name: 'Red Pigment', values: { look: 'pigment', paper: '#fbf1e8', ink1: '#e8200c', ink2: '#2a0300', ink3: '#f3a48e', bloom: 0, blur: 0, leak: 0, haze: 0, chroma: 0, grade: 0, lift: 0, saturation: 1 } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const out = createCanvas(w, h), g = get2d(out, true);
    const base = createCanvas(w, h), bg = get2d(base, true);
    if (p.look === 'pigment') pigment(src, p, unit, bg, time);
    else bg.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);

    // Colour fringing: each channel is drawn on its own, then added back together.
    const shift = (p.chroma as number) * unit;
    if (shift > 0.05) {
      const a = ((p.chromaAngle as number) * Math.PI) / 180, radial = p.chromaMode === 'radial', k = shift / (Math.max(w, h) / 2);
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const layer = createCanvas(w, h), lg = get2d(layer);
      ['#ff0000', '#00ff00', '#0000ff'].forEach((color, i) => {
        lg.globalCompositeOperation = 'source-over';
        lg.drawImage(base, 0, 0);
        lg.globalCompositeOperation = 'multiply';
        lg.fillStyle = color;
        lg.fillRect(0, 0, w, h);
        const s = i - 1;
        if (radial) { const z = 1 + s * k; g.drawImage(layer, (w - w * z) / 2, (h - h * z) / 2, w * z, h * z); }
        else g.drawImage(layer, Math.cos(a) * shift * s, Math.sin(a) * shift * s);
      });
      g.globalCompositeOperation = 'source-over';
    } else g.drawImage(base, 0, 0);

    const blur = p.blur as number;
    if (blur > 0) {
      g.globalAlpha = blur;
      g.drawImage(softCopy(out, w, h, (p.blurSize as number) * unit), 0, 0, w, h);
      g.globalAlpha = 1;
    }
    const bloom = p.bloom as number;
    if (bloom > 0) {
      const th = p.bloomThreshold as number, halo = softCopy(out, w, h, (p.bloomSize as number) * unit, (l) => smooth(th, th + 0.25, l));
      g.globalCompositeOperation = 'lighter';
      for (let left = bloom; left > 0; left -= 1) { g.globalAlpha = Math.min(1, left); g.drawImage(halo, 0, 0, w, h); }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    const haze = p.haze as number;
    if (haze > 0) {
      const sw = Math.max(16, Math.round(w / 12)), sh = Math.max(16, Math.round(h / 12)), c = createCanvas(sw, sh), cg = get2d(c, true), im = cg.createImageData(sw, sh), tint = hexToRgb(p.hazeColor as string);
      const s = 12 / ((p.hazeSize as number) * unit), seed = p.seed as number, t = time * (p.hazeDrift as number) * 0.25;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        im.data[i] = tint[0]; im.data[i + 1] = tint[1]; im.data[i + 2] = tint[2];
        im.data[i + 3] = 255 * clamp01(haze * (0.35 + 1.3 * fbm(x * s + t, y * s - t * 0.6, seed + 40, 3)));
      }
      cg.putImageData(im, 0, 0);
      g.globalCompositeOperation = 'screen';
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    const leak = p.leak as number;
    if (leak > 0) {
      const rng = createRng((p.seed as number) + 11), t = time * (p.leakSpeed as number), R0 = Math.max(w, h) * (p.leakSize as number), A = hexToRgb(p.leakA as string), B = hexToRgb(p.leakB as string);
      g.globalCompositeOperation = 'screen';
      for (let i = 0; i < (p.leakCount as number); i++) {
        const a = rng(), b = rng(), ph = rng() * 6.28, c = i % 2 ? B : A;
        // Leaks enter from the frame edge, as they do on film.
        const edge = a < 0.5 ? (a < 0.25 ? 0 : 1) : a * 2 - 1, side = b;
        const x = (a < 0.5 ? edge : side) * w + Math.sin(t * 0.8 + ph) * w * 0.12, y = (a < 0.5 ? side : b < 0.5 ? 0 : 1) * h + Math.cos(t * 0.6 + ph) * h * 0.12;
        const grad = g.createRadialGradient(x, y, 0, x, y, R0 * (0.5 + rng()));
        grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${leak})`);
        grad.addColorStop(0.45, `rgba(${c[0]},${c[1]},${c[2]},${leak * 0.35})`);
        grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }
      g.globalCompositeOperation = 'source-over';
    }

    // Grade through a table: one lookup per pixel, whatever the settings.
    const im = g.getImageData(0, 0, w, h), o = im.data, S0 = hexToRgb(p.shadowTint as string), M = hexToRgb(p.midTint as string), H = hexToRgb(p.highTint as string);
    const lut = new Float32Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const l = i / 255, a = l < 0.5 ? S0 : M, b = l < 0.5 ? M : H, t = l < 0.5 ? l * 2 : l * 2 - 1;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = a[c] + (b[c] - a[c]) * t;
    }
    const grade = p.grade as number, sat = p.saturation as number, lift = (p.lift as number) * 255, grain = (p.grain as number) * 60, seed = p.seed as number, mv = Math.floor(time * (p.grainMove as number) * 24), tick = (p.grainMove as number) > 0 ? mv : 0, liftK = 1 - lift / 255;
    for (let i = 0, q = 0; i < o.length; i += 4, q++) {
      const r = o[i], gr = o[i + 1], b = o[i + 2], l = 0.2126 * r + 0.7152 * gr + 0.0722 * b, li = (l | 0) * 3;
      // Soft blend: the tint moves colour, the image keeps its light and shade.
      const n = grain ? (hash2(q % w, ((q / w) | 0) + tick * 13, seed) - 0.5) * grain : 0;
      for (let c = 0; c < 3; c++) {
        const v = c === 0 ? r : c === 1 ? gr : b, sa = l + (v - l) * sat, gd = sa + (lut[li + c] - l) * grade;
        o[i + c] = clamp255(gd * liftK + lift + n);
      }
    }
    g.putImageData(im, 0, 0);

    const amt = p.intensity as number;
    if (amt < 1) ctx.putImageData(src, 0, 0);
    ctx.globalAlpha = amt;
    ctx.drawImage(out, 0, 0);
    ctx.globalAlpha = 1;
  },
};
