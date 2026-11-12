import type { EffectDefinition, ParamDef } from './types';
import { parseIds } from './types';
import { assetStore } from '../engine/assets';
import { gradientRamp, parseStops } from './adjust/core';
import {
  BLEND_OPTIONS, blendChannel, boxBlur, createCanvas, createRng, fbm, get2d, hash2, hexToRgb, sampleBilinear, toLuma, type BlendMode,
} from '../utils/imageProcessing';

/* ───────────── Reusable displacement core ───────────── */

export interface DisplaceOptions {
  /** Writes the source offset for an output pixel into v[0], v[1]. */
  field: (x: number, y: number, v: number[]) => void;
  /** Per-channel multiplier of the offset (e.g. [1, 0, -1] splits channels). */
  channels?: [number, number, number];
  wrap?: boolean;
}

/** Inverse-mapping displacement with bilinear sampling. Any effect can build on it. */
export function displacePixels(src: ImageData, ctx: CanvasRenderingContext2D, o: DisplaceOptions) {
  const { width: w, height: h, data: d } = src;
  const out = ctx.createImageData(w, h), od = out.data, v = [0, 0], tmp = new Uint8ClampedArray(4);
  const ch = o.channels, wrap = !!o.wrap;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      o.field(x, y, v);
      const i = (y * w + x) * 4;
      if (!ch) sampleBilinear(d, w, h, x + v[0], y + v[1], od, i, wrap);
      else {
        for (let c = 0; c < 3; c++) {
          sampleBilinear(d, w, h, x + v[0] * ch[c], y + v[1] * ch[c], tmp, 0, wrap);
          od[i + c] = tmp[c];
        }
        od[i + 3] = d[i + 3];
      }
    }
  ctx.putImageData(out, 0, 0);
}

const edges: ParamDef = { key: 'edges', label: 'Edges', type: 'select', group: 'Output', default: 'clamp', options: [{ value: 'clamp', label: 'Clamp' }, { value: 'wrap', label: 'Wrap' }] };

/* ───────────── Displacement Map (your own image) ───────────── */

export const displaceMap: EffectDefinition = {
  id: 'displaceMap',
  name: 'Displacement Map',
  category: 'distortion',
  description: 'Bend the image with another image’s brightness, or with its own.',
  audioDefaults: { strength: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'map', label: 'Map Image', type: 'images', group: 'Map', default: '', max: 1, hint: 'Empty = the image displaces itself.' },
    { key: 'strength', label: 'Strength', type: 'range', group: 'Map', min: -300, max: 300, step: 1, default: 60 },
    { key: 'direction', label: 'Direction', type: 'range', group: 'Map', min: 0, max: 359, step: 1, default: 35, unit: '°' },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Map', min: 0.1, max: 4, step: 0.01, default: 1, unit: '×', visibleWhen: (v) => !!v.map },
    { key: 'smooth', label: 'Smoothing', type: 'range', group: 'Map', min: 0, max: 40, step: 0.5, default: 4 },
    edges,
  ],
  render({ src, ctx, width, height, params: p, unit }) {
    const asset = assetStore.get(parseIds(p.map)[0] ?? '');
    let plane: Float32Array;
    if (asset) {
      const c = createCanvas(width, height), g = get2d(c, true), sc = p.scale as number;
      const pat = createCanvas(Math.max(1, width * sc), Math.max(1, height * sc));
      get2d(pat).drawImage(asset.el, 0, 0, pat.width, pat.height);
      g.fillStyle = g.createPattern(pat, 'repeat')!;
      g.fillRect(0, 0, width, height);
      const m = g.getImageData(0, 0, width, height);
      plane = toLuma(m);
      c.width = c.height = pat.width = pat.height = 1;
    } else plane = toLuma(src);
    const blur = boxBlur(plane, width, height, ((p.smooth as number) * unit) / 2, 2);
    const a = ((p.direction as number) * Math.PI) / 180, s = (p.strength as number) * unit * 2;
    const cx = Math.cos(a) * s, cy = Math.sin(a) * s;
    displacePixels(src, ctx, { wrap: p.edges === 'wrap', field: (x, y, v) => { const m = blur[y * width + x] - 0.5; v[0] = m * cx; v[1] = m * cy; } });
  },
};

/* ───────────── Liquify ───────────── */

export const liquify: EffectDefinition = {
  id: 'liquify',
  name: 'Liquify',
  category: 'distortion',
  description: 'Soft pushes and twirls at seeded points, like dragging a liquify brush.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { strength: { band: 'bass', amount: 0.25 } },
  params: [
    { key: 'count', label: 'Brush Points', type: 'range', group: 'Liquify', min: 1, max: 24, step: 1, default: 7 },
    { key: 'scale', label: 'Brush Scale', type: 'range', group: 'Liquify', min: 30, max: 700, step: 1, default: 260 },
    { key: 'strength', label: 'Strength', type: 'range', group: 'Liquify', min: 0, max: 300, step: 1, default: 90 },
    { key: 'twirl', label: 'Twirl', type: 'range', group: 'Liquify', min: -1, max: 1, step: 0.01, default: 0.4 },
    { key: 'direction', label: 'Push Direction', type: 'range', group: 'Liquify', min: 0, max: 359, step: 1, default: 20, unit: '°' },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Liquify', min: 0, max: 2, step: 0.01, default: 0 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Liquify', default: 14 },
    edges,
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const rng = createRng(p.seed as number), R = (p.scale as number) * unit, S = (p.strength as number) * unit;
    const a0 = ((p.direction as number) * Math.PI) / 180, twirl = p.twirl as number, sp = p.speed as number;
    const pts = Array.from({ length: p.count as number }, () => {
      const ph = rng() * 6.28, x = rng() * width, y = rng() * height, ang = a0 + (rng() - 0.5) * 2.2, m = 0.5 + rng();
      return { x: x + Math.sin(time * sp + ph) * R * 0.35, y: y + Math.cos(time * sp * 0.8 + ph) * R * 0.35, dx: Math.cos(ang) * S * m, dy: Math.sin(ang) * S * m };
    });
    const R2 = R * R;
    displacePixels(src, ctx, {
      wrap: p.edges === 'wrap',
      field: (x, y, v) => {
        v[0] = v[1] = 0;
        for (const q of pts) {
          const ex = x - q.x, ey = y - q.y, d2 = ex * ex + ey * ey;
          if (d2 >= R2) continue;
          const f = (1 - d2 / R2) ** 2;
          v[0] -= q.dx * f + (-ey * twirl * f);
          v[1] -= q.dy * f + (ex * twirl * f);
        }
      },
    });
  },
};

/* ───────────── Turbulence ───────────── */

export const turbulence: EffectDefinition = {
  id: 'turbulence',
  name: 'Turbulence',
  category: 'distortion',
  description: 'Domain-warped fractal noise: the image churns like ink in water.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { strength: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'strength', label: 'Strength', type: 'range', group: 'Turbulence', min: 0, max: 300, step: 1, default: 60 },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Turbulence', min: 20, max: 800, step: 1, default: 240 },
    { key: 'complexity', label: 'Complexity', type: 'range', group: 'Turbulence', min: 1, max: 6, step: 1, default: 4 },
    { key: 'warp', label: 'Domain Warp', type: 'range', group: 'Turbulence', min: 0, max: 3, step: 0.01, default: 1 },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Turbulence', min: 0, max: 2, step: 0.01, default: 0.25 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Turbulence', default: 6 },
    edges,
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const sc = (p.scale as number) * unit, S = (p.strength as number) * unit, oct = p.complexity as number, warp = p.warp as number, seed = p.seed as number;
    const t = time * (p.speed as number) * 0.3;
    // Coarse field, bilinearly read: this runs per pixel otherwise.
    const step = Math.max(2, Math.round(4 * unit)), gw = Math.ceil(width / step) + 2, gh = Math.ceil(height / step) + 2;
    const fx = new Float32Array(gw * gh), fy = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const u = (x * step) / sc, v = (y * step) / sc;
        const qx = fbm(u + t, v, seed, oct), qy = fbm(u, v - t, seed + 7, oct);
        fx[y * gw + x] = fbm(u + warp * qx + 1.7, v + warp * qy + t, seed + 3, oct) - 0.5;
        fy[y * gw + x] = fbm(u + warp * qx + 8.3, v + warp * qy - t, seed + 5, oct) - 0.5;
      }
    const inv = 1 / step, s2 = S * 2;
    displacePixels(src, ctx, {
      wrap: p.edges === 'wrap',
      field: (x, y, v) => {
        const gx = x * inv, gy = y * inv, x0 = gx | 0, y0 = gy | 0, u = gx - x0, w = gy - y0, i = y0 * gw + x0;
        v[0] = ((fx[i] + (fx[i + 1] - fx[i]) * u) * (1 - w) + (fx[i + gw] + (fx[i + gw + 1] - fx[i + gw]) * u) * w) * s2;
        v[1] = ((fy[i] + (fy[i + 1] - fy[i]) * u) * (1 - w) + (fy[i + gw] + (fy[i + gw + 1] - fy[i + gw]) * u) * w) * s2;
      },
    });
  },
};

/* ───────────── Color channel displacement ───────────── */

export const channelDisplace: EffectDefinition = {
  id: 'channelDisplace',
  name: 'Channel Displacement',
  category: 'distortion',
  description: 'Each colour channel rides a different wave.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { strength: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'strength', label: 'Strength', type: 'range', group: 'Wave', min: 0, max: 120, step: 0.5, default: 18 },
    { key: 'frequency', label: 'Frequency', type: 'range', group: 'Wave', min: 0.2, max: 30, step: 0.1, default: 5 },
    { key: 'direction', label: 'Direction', type: 'range', group: 'Wave', min: 0, max: 179, step: 1, default: 0, unit: '°' },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Wave', min: 0, max: 3, step: 0.01, default: 0.4 },
    { key: 'r', label: 'Red Amount', type: 'range', group: 'Channels', min: -2, max: 2, step: 0.01, default: 1 },
    { key: 'g', label: 'Green Amount', type: 'range', group: 'Channels', min: -2, max: 2, step: 0.01, default: 0 },
    { key: 'b', label: 'Blue Amount', type: 'range', group: 'Channels', min: -2, max: 2, step: 0.01, default: -1 },
    edges,
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const S = (p.strength as number) * unit, k = ((p.frequency as number) * Math.PI * 2) / Math.max(width, height);
    const a = ((p.direction as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), t = time * (p.speed as number) * 2;
    displacePixels(src, ctx, {
      wrap: p.edges === 'wrap',
      channels: [p.r as number, p.g as number, p.b as number],
      field: (x, y, v) => {
        const off = Math.sin((-x * sa + y * ca) * k + t) * S;
        v[0] = ca * off; v[1] = sa * off;
      },
    });
  },
};

/* ───────────── JPEG artifacts: a real 8×8 DCT codec ───────────── */

const COS = new Float32Array(64);
for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) COS[x * 8 + u] = Math.cos(((2 * x + 1) * u * Math.PI) / 16) * (u === 0 ? Math.SQRT1_2 : 1) * 0.5;
const QL = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const QC = [17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, ...new Array(32).fill(99)];

function codeBlock(px: Float32Array, q: number[], k: number) {
  const f = new Float32Array(64), t = new Float32Array(64);
  // Forward DCT on rows then columns, quantise, inverse.
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += px[y * 8 + x] * COS[x * 8 + u]; t[y * 8 + u] = s; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let s = 0; for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[y * 8 + v]; f[v * 8 + u] = s; }
  for (let i = 0; i < 64; i++) { const st = Math.max(1, q[i] * k); f[i] = Math.round(f[i] / st) * st; }
  for (let u = 0; u < 8; u++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += f[v * 8 + u] * COS[y * 8 + v]; t[y * 8 + u] = s; }
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += t[y * 8 + u] * COS[x * 8 + u]; px[y * 8 + x] = s; }
}

export const jpegArtifacts: EffectDefinition = {
  id: 'jpegArtifacts',
  name: 'JPEG Artifacts',
  category: 'distortion',
  description: 'A real DCT quantisation pass: blocking, ringing and chroma smear.',
  audioDefaults: { quality: { band: 'beat', amount: -0.3 } },
  params: [
    { key: 'quality', label: 'Quality', type: 'range', group: 'Codec', min: 1, max: 60, step: 1, default: 8, hint: 'Lower is worse.' },
    { key: 'block', label: 'Block Scale', type: 'range', group: 'Codec', min: 1, max: 12, step: 0.5, default: 3, unit: '×' },
    { key: 'chroma', label: 'Chroma Subsampling', type: 'range', group: 'Codec', min: 1, max: 4, step: 1, default: 2 },
    { key: 'generations', label: 'Generations', type: 'range', group: 'Codec', min: 1, max: 4, step: 1, default: 1 },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit }) {
    const scale = Math.max(1, (p.block as number) * unit);
    const w = Math.max(8, Math.floor(width / scale / 8) * 8), h = Math.max(8, Math.floor(height / scale / 8) * 8);
    const c = createCanvas(w, h), g = get2d(c, true);
    g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h), d = img.data, n = w * h;
    const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      Y[i] = 0.299 * r + 0.587 * gg + 0.114 * b - 128;
      Cb[i] = -0.1687 * r - 0.3313 * gg + 0.5 * b;
      Cr[i] = 0.5 * r - 0.4187 * gg - 0.0813 * b;
    }
    const sub = p.chroma as number;
    if (sub > 1)
      for (let y = 0; y < h; y += sub)
        for (let x = 0; x < w; x += sub) {
          let a = 0, b = 0, k = 0;
          for (let j = y; j < Math.min(h, y + sub); j++) for (let i = x; i < Math.min(w, x + sub); i++) { a += Cb[j * w + i]; b += Cr[j * w + i]; k++; }
          a /= k; b /= k;
          for (let j = y; j < Math.min(h, y + sub); j++) for (let i = x; i < Math.min(w, x + sub); i++) { Cb[j * w + i] = a; Cr[j * w + i] = b; }
        }
    const q = p.quality as number, k = q < 50 ? 50 / q : (100 - q) / 50;
    const block = new Float32Array(64);
    // Each generation is re-cut on a shifted grid, as when a saved JPEG gets cropped and re-saved.
    for (let gen = 0; gen < (p.generations as number); gen++)
      for (const [plane, table] of [[Y, QL], [Cb, QC], [Cr, QC]] as [Float32Array, number[]][])
        for (let by = gen * 3 % 8; by + 8 <= h; by += 8)
          for (let bx = gen * 5 % 8; bx + 8 <= w; bx += 8) {
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) block[y * 8 + x] = plane[(by + y) * w + bx + x];
            codeBlock(block, table, k);
            for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) plane[(by + y) * w + bx + x] = block[y * 8 + x];
          }
    for (let i = 0; i < n; i++) {
      const yy = Y[i] + 128;
      d[i * 4] = yy + 1.402 * Cr[i];
      d[i * 4 + 1] = yy - 0.34414 * Cb[i] - 0.71414 * Cr[i];
      d[i * 4 + 2] = yy + 1.772 * Cb[i];
    }
    g.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, 0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    c.width = c.height = 1;
  },
};

/* ───────────── Posterized gradient ───────────── */

export const posterGradient: EffectDefinition = {
  id: 'posterGradient',
  name: 'Posterized Gradient',
  category: 'adjust',
  description: 'Hard tone bands, each filled with its own directional gradient.',
  params: [
    { key: 'bands', label: 'Bands', type: 'range', group: 'Bands', min: 2, max: 16, step: 1, default: 6 },
    { key: 'stops', label: 'Gradient', type: 'custom', editor: 'gradient', group: 'Bands', default: '' },
    { key: 'strength', label: 'Band Gradient', type: 'range', group: 'Bands', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Bands', min: 0.2, max: 4, step: 0.01, default: 1 },
    { key: 'direction', label: 'Direction', type: 'range', group: 'Bands', min: 0, max: 359, step: 1, default: 60, unit: '°' },
    { key: 'grain', label: 'Grain', type: 'range', group: 'Bands', min: 0, max: 1, step: 0.01, default: 0.15 },
  ],
  render(input) {
    const { src, ctx, width, height, params: p } = input;
    const stops = cachedRamp(p.stops as string);
    const n = p.bands as number, s = p.strength as number, sc = p.scale as number, gr = (p.grain as number) * 40;
    const a = ((p.direction as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), L = Math.max(width, height);
    const d = src.data, out = ctx.createImageData(width, height), o = out.data;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const band = Math.min(n - 1, Math.floor(l * n));
        const ramp = (((x * ca + y * sa) / L) * sc * n) % 1;
        const t = (band + 0.5 + (ramp - 0.5) * s) / n;
        const k = Math.max(0, Math.min(255, Math.round(t * 255))) * 3;
        const g = gr ? (hash2(x, y, 3) - 0.5) * gr : 0;
        o[i] = stops[k] + g; o[i + 1] = stops[k + 1] + g; o[i + 2] = stops[k + 2] + g; o[i + 3] = d[i + 3];
      }
    ctx.putImageData(out, 0, 0);
  },
};

let lastRamp: { s: string; r: Uint8ClampedArray } | null = null;
function cachedRamp(s: string) {
  if (lastRamp?.s !== s) lastRamp = { s, r: gradientRamp(parseStops(s)) };
  return lastRamp.r;
}

/* ───────────── Procedural texture overlay ───────────── */

export const textureOverlay: EffectDefinition = {
  id: 'textureOverlay',
  name: 'Texture Overlay',
  category: 'texture',
  description: 'Generated paper, concrete, canvas, scratches and dust.',
  animated: (p) => p.animate === true,
  audioDefaults: { strength: { band: 'level', amount: 0.25 } },
  params: [
    {
      key: 'kind', label: 'Texture', type: 'select', group: 'Texture', default: 'paper',
      options: [{ value: 'paper', label: 'Paper Fibre' }, { value: 'concrete', label: 'Concrete' }, { value: 'canvas', label: 'Canvas Weave' }, { value: 'scratches', label: 'Scratches' }, { value: 'dust', label: 'Dust & Hair' }],
    },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Texture', min: 0.2, max: 6, step: 0.01, default: 1 },
    { key: 'strength', label: 'Strength', type: 'range', group: 'Texture', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'blend', label: 'Blend Mode', type: 'select', group: 'Texture', default: 'overlay', options: BLEND_OPTIONS },
    { key: 'tint', label: 'Tint', type: 'color', group: 'Texture', default: '#f4efe4' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Texture', default: 3 },
    { key: 'animate', label: 'Animate (Film Weave)', type: 'toggle', group: 'Texture', default: false },
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const kind = p.kind as string, sc = (p.scale as number) * unit, seed = (p.seed as number) + (p.animate ? Math.floor(time * 12) * 17 : 0);
    const c = createCanvas(width, height), g = get2d(c, true);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, width, height);
    if (kind === 'scratches' || kind === 'dust') {
      const rng = createRng(seed);
      g.lineCap = 'round';
      const n = kind === 'dust' ? 260 : 46;
      for (let i = 0; i < n; i++) {
        const x = rng() * width, y = rng() * height, light = rng() > 0.35;
        g.strokeStyle = g.fillStyle = light ? '#fff' : '#000';
        g.globalAlpha = 0.25 + rng() * 0.75;
        if (kind === 'scratches') {
          g.lineWidth = (0.4 + rng()) * sc;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + (rng() - 0.5) * 40 * sc, y + (0.2 + rng()) * height * 0.6);
          g.stroke();
        } else if (rng() > 0.1) {
          g.beginPath();
          g.arc(x, y, (0.4 + rng() * 1.6) * sc, 0, 7);
          g.fill();
        } else {
          g.lineWidth = 0.7 * sc;
          g.beginPath();
          g.moveTo(x, y);
          g.bezierCurveTo(x + (rng() - 0.5) * 60 * sc, y + (rng() - 0.5) * 60 * sc, x + (rng() - 0.5) * 60 * sc, y + (rng() - 0.5) * 60 * sc, x + (rng() - 0.5) * 80 * sc, y + (rng() - 0.5) * 80 * sc);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
    } else {
      const im = g.getImageData(0, 0, width, height), o = im.data;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          let v: number;
          if (kind === 'paper') v = fbm(x / (60 * sc), y / (6 * sc), seed, 3) * 0.6 + fbm(x / (5 * sc), y / (50 * sc), seed + 3, 2) * 0.4;
          else if (kind === 'concrete') v = fbm(x / (40 * sc), y / (40 * sc), seed, 5) * 0.75 + hash2(x, y, seed) * 0.25;
          else {
            const px = 3.2 * sc, wx = Math.sin((x / px) * Math.PI), wy = Math.sin((y / px) * Math.PI);
            // Over/under weave: alternate threads rise on opposite axes.
            const over = (Math.floor(x / px) + Math.floor(y / px)) % 2 === 0;
            v = 0.5 + 0.28 * (over ? wx * wx : -wy * wy) + (hash2(x, y, seed) - 0.5) * 0.08;
          }
          const k = Math.max(0, Math.min(255, 128 + (v - 0.5) * 340)), i = (y * width + x) * 4;
          o[i] = o[i + 1] = o[i + 2] = k;
        }
      g.putImageData(im, 0, 0);
    }
    const tx = g.getImageData(0, 0, width, height).data;
    c.width = c.height = 1;
    const tint = hexToRgb(p.tint as string), blend = p.blend as BlendMode, s = p.strength as number;
    const d = src.data, out = ctx.createImageData(width, height), o = out.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const top = (tx[i] * tint[k]) / 255;
        o[i + k] = d[i + k] + (blendChannel(blend, d[i + k], top) - d[i + k]) * s;
      }
      o[i + 3] = d[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const DISPLACEMENT = [displaceMap, liquify, turbulence, channelDisplace, jpegArtifacts, posterGradient, textureOverlay];
