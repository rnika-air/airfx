import { contentOf, withContent } from '../content/content';
import type { EffectDefinition, ParamDef, ParamValues } from './types';
import { boxBlur, createCanvas, createRng, fbm, get2d, hexToRgb, sampleBilinear } from '../utils/imageProcessing';

/* ───────────── shared controls ───────────── */

const BLENDS = [
  { value: 'screen', label: 'Screen' }, { value: 'lighter', label: 'Add' }, { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' }, { value: 'source-over', label: 'Normal' },
];
const output: ParamDef[] = [
  { key: 'blend', label: 'Blend Mode', type: 'select', group: 'Output', default: 'screen', options: BLENDS },
  { key: 'opacity', label: 'Opacity', type: 'range', group: 'Output', min: 0, max: 1, step: 0.01, default: 1 },
];
const sourcePos = (n: 1 | 2 | 3, x: number, y: number): ParamDef[] => [
  { key: `x${n}`, label: `Light ${n} X`, type: 'range', group: 'Light Sources', min: -0.2, max: 1.2, step: 0.005, default: x, visibleWhen: n === 1 ? undefined : (v) => (v.sources as number) >= n },
  { key: `y${n}`, label: `Light ${n} Y`, type: 'range', group: 'Light Sources', min: -0.2, max: 1.2, step: 0.005, default: y, visibleWhen: n === 1 ? undefined : (v) => (v.sources as number) >= n },
];
const sources = (p: ParamValues) => Array.from({ length: p.sources as number }, (_, i) => ({ x: p[`x${i + 1}`] as number, y: p[`y${i + 1}`] as number }));

function begin(ctx: CanvasRenderingContext2D, srcCanvas: CanvasImageSource, p: ParamValues) {
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;
  ctx.globalAlpha = p.opacity as number;
}
function end(ctx: CanvasRenderingContext2D) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
const rgba = ([r, g, b]: number[], a: number) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Bright-pass of the image, blurred, on a canvas at `scale` of the frame. */
function brightPass(src: ImageData, scale: number, threshold: number, radius: number, hStretch = 1): HTMLCanvasElement {
  const sw = src.width, w = Math.max(2, Math.round(sw * scale)), h = Math.max(2, Math.round(src.height * scale));
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  const d = src.data, stepX = sw / w, stepY = src.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (Math.floor(y * stepY) * sw + Math.floor(x * stepX)) * 4;
      const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      const k = Math.max(0, (l - threshold) / Math.max(0.01, 1 - threshold));
      for (let c = 0; c < 3; c++) ch[c][y * w + x] = d[i + c] * k;
    }
  const out = new ImageData(w, h);
  for (let c = 0; c < 3; c++) {
    let plane = ch[c];
    if (hStretch > 1) plane = hBlur(plane, w, h, radius * hStretch);
    plane = boxBlur(plane, w, h, radius, 2);
    for (let i = 0; i < w * h; i++) out.data[i * 4 + c] = plane[i];
  }
  for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
  const cv = createCanvas(w, h);
  get2d(cv).putImageData(out, 0, 0);
  return cv;
}

function hBlur(s: Float32Array, w: number, h: number, r0: number): Float32Array {
  const r = Math.max(1, Math.round(r0)), out = new Float32Array(s.length);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += s[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      out[row + x] = acc / (2 * r + 1);
      acc += s[row + Math.min(w - 1, x + r + 1)] - s[row + Math.max(0, x - r)];
    }
  }
  return out;
}

/* ───────────── Lens Flare ───────────── */

export const lensFlare: EffectDefinition = {
  id: 'lensFlare',
  name: 'Lens Flare',
  category: 'light',
  description: 'Glow, starburst, halo and chromatic ghosts along the lens axis. Up to three lights.',
  audioDefaults: { intensity: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'sources', label: 'Light Sources', type: 'range', group: 'Light Sources', min: 1, max: 3, step: 1, default: 1 },
    ...sourcePos(1, 0.28, 0.25), ...sourcePos(2, 0.75, 0.2), ...sourcePos(3, 0.5, 0.7),
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Flare', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'radius', label: 'Radius', type: 'range', group: 'Flare', min: 20, max: 700, step: 1, default: 220 },
    { key: 'color', label: 'Color', type: 'color', group: 'Flare', default: '#ffd9a8' },
    { key: 'spread', label: 'Glow Spread', type: 'range', group: 'Flare', min: 0.2, max: 3, step: 0.01, default: 1 },
    { key: 'streaks', label: 'Starburst Rays', type: 'range', group: 'Flare', min: 0, max: 16, step: 1, default: 6 },
    { key: 'streakLen', label: 'Streak Length', type: 'range', group: 'Flare', min: 0.1, max: 3, step: 0.01, default: 1.2 },
    { key: 'streakAngle', label: 'Streak Angle', type: 'range', group: 'Flare', min: 0, max: 180, step: 1, default: 20, unit: '°' },
    { key: 'ghosts', label: 'Light Elements', type: 'range', group: 'Ghosts', min: 0, max: 16, step: 1, default: 6 },
    { key: 'chroma', label: 'Chromatic Separation', type: 'range', group: 'Ghosts', min: 0, max: 40, step: 0.5, default: 8 },
    { key: 'halo', label: 'Halo Ring', type: 'range', group: 'Ghosts', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Ghosts', default: 12 },
    ...output,
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit }) {
    begin(ctx, srcCanvas, p);
    const col = hexToRgb(p.color as string);
    const I = p.intensity as number, R = (p.radius as number) * unit;
    const cx = width / 2, cy = height / 2;
    for (const s of sources(p)) {
      const lx = s.x * width, ly = s.y * height;
      const rng = createRng(p.seed as number);
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * (p.spread as number));
      g.addColorStop(0, rgba([255, 255, 255], Math.min(1, I)));
      g.addColorStop(0.08, rgba(col, Math.min(1, 0.8 * I)));
      g.addColorStop(0.4, rgba(col, 0.18 * I));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      const n = p.streaks as number, base = ((p.streakAngle as number) * Math.PI) / 180, L = R * (p.streakLen as number);
      ctx.save();
      ctx.translate(lx, ly);
      for (let i = 0; i < n; i++) {
        ctx.save();
        ctx.rotate(base + (i / n) * Math.PI * 2);
        const len = L * (0.6 + rng() * 0.6), wid = R * 0.012 * (1 + rng());
        const sg = ctx.createLinearGradient(0, 0, len, 0);
        sg.addColorStop(0, rgba([255, 255, 255], 0.7 * Math.min(1, I)));
        sg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(0, -wid); ctx.lineTo(len, 0); ctx.lineTo(0, wid);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      const halo = p.halo as number;
      if (halo > 0) {
        const hr = R * 0.8;
        const hg = ctx.createRadialGradient(lx, ly, hr * 0.86, lx, ly, hr);
        hg.addColorStop(0, rgba(col, 0));
        hg.addColorStop(0.7, rgba([140, 200, 255], 0.3 * halo * I));
        hg.addColorStop(1, rgba([255, 120, 90], 0));
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(lx, ly, hr, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ghosts sit on the line from the light through the lens centre.
      const chroma = (p.chroma as number) * unit;
      const channels: [number[], number][] = chroma > 0 ? [[[255, 60, 60], -chroma], [[60, 255, 90], 0], [[70, 90, 255], chroma]] : [[col, 0]];
      for (let i = 0; i < (p.ghosts as number); i++) {
        const t = -0.4 - rng() * 1.8, r = R * (0.05 + rng() * 0.28), a = (0.05 + rng() * 0.16) * I;
        const hard = rng() > 0.5;
        const gx = cx + (lx - cx) * t, gy = cy + (ly - cy) * t;
        const dirx = gx - cx, diry = gy - cy, dl = Math.hypot(dirx, diry) || 1;
        for (const [c, off] of channels) {
          const x = gx + (dirx / dl) * off, y = gy + (diry / dl) * off;
          const gg = ctx.createRadialGradient(x, y, hard ? r * 0.82 : 0, x, y, r);
          gg.addColorStop(0, rgba(c, a * (hard ? 0.5 : 1)));
          gg.addColorStop(0.9, rgba(c, a));
          gg.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    end(ctx);
  },
};

/* ───────────── Glow / Bloom ───────────── */

export const glowBloom: EffectDefinition = {
  id: 'glowBloom',
  name: 'Glow & Bloom',
  category: 'light',
  description: 'Highlights spill light outward, in two scales.',
  audioDefaults: { intensity: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Bloom', min: 0, max: 0.98, step: 0.01, default: 0.6 },
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Bloom', min: 0, max: 3, step: 0.01, default: 1 },
    { key: 'radius', label: 'Glow Spread', type: 'range', group: 'Bloom', min: 1, max: 120, step: 0.5, default: 26 },
    { key: 'wide', label: 'Wide Halo', type: 'range', group: 'Bloom', min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: 'tintOn', label: 'Tint', type: 'toggle', group: 'Bloom', default: false },
    { key: 'color', label: 'Glow Color', type: 'color', group: 'Bloom', default: '#c6ff2e', visibleWhen: (v) => v.tintOn === true },
    ...output,
  ],
  render({ src, srcCanvas, ctx, width, height, params: p, unit }) {
    begin(ctx, srcCanvas, p);
    const scale = 0.25, rad = Math.max(1, (p.radius as number) * unit * scale);
    const a = brightPass(src, scale, p.threshold as number, rad);
    const b = (p.wide as number) > 0 ? brightPass(src, 0.125, p.threshold as number, rad * 1.5) : null;
    const base = (p.opacity as number);
    const paint = (cv: HTMLCanvasElement, k: number) => {
      for (let i = 0; i < Math.ceil(k); i++) {
        ctx.globalAlpha = base * Math.min(1, k - i);
        ctx.drawImage(cv, 0, 0, width, height);
      }
    };
    paint(a, p.intensity as number);
    if (b) paint(b, (p.wide as number) * (p.intensity as number));
    if (p.tintOn) {
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.5 * base;
      ctx.fillStyle = p.color as string;
      ctx.fillRect(0, 0, width, height);
    }
    end(ctx);
  },
};

/* ───────────── Anamorphic streaks ───────────── */

export const anamorphic: EffectDefinition = {
  id: 'anamorphic',
  name: 'Anamorphic Streaks',
  category: 'light',
  description: 'Long cinema-lens streaks grown from the bright parts of the image.',
  audioDefaults: { intensity: { band: 'beat', amount: 0.4 } },
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Streak', min: 0.2, max: 0.98, step: 0.01, default: 0.7 },
    { key: 'length', label: 'Streak Length', type: 'range', group: 'Streak', min: 10, max: 900, step: 1, default: 320 },
    { key: 'angle', label: 'Streak Angle', type: 'range', group: 'Streak', min: -90, max: 90, step: 1, default: 0, unit: '°' },
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Streak', min: 0, max: 4, step: 0.01, default: 1.4 },
    { key: 'color', label: 'Color', type: 'color', group: 'Streak', default: '#4f8cff' },
    ...output,
  ],
  render({ src, srcCanvas, ctx, width, height, params: p, unit }) {
    begin(ctx, srcCanvas, p);
    const scale = 0.25;
    const cv = brightPass(src, scale, p.threshold as number, 1, Math.max(1, (p.length as number) * unit * scale));
    // Tint: keep only the streak's shape, coloured.
    const g = get2d(cv);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = p.color as string;
    g.fillRect(0, 0, cv.width, cv.height);
    const k = p.intensity as number, base = p.opacity as number, a = ((p.angle as number) * Math.PI) / 180;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(a);
    const grow = 1 + Math.abs(Math.sin(a)) * 0.6;
    for (let i = 0; i < Math.ceil(k * 3); i++) {
      ctx.globalAlpha = base * Math.min(1, k * 3 - i);
      ctx.drawImage(cv, (-width * grow) / 2, (-height * grow) / 2, width * grow, height * grow);
    }
    ctx.restore();
    end(ctx);
  },
};

/* ───────────── Chromatic aberration ───────────── */

export const chromaticAb: EffectDefinition = {
  id: 'chromaticAb',
  name: 'Chromatic Aberration',
  category: 'light',
  description: 'Lens fringing: colour channels scale differently from an optical centre.',
  audioDefaults: { amount: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'amount', label: 'Chromatic Separation', type: 'range', group: 'Lens', min: -40, max: 40, step: 0.25, default: 10 },
    { key: 'cx', label: 'Center X', type: 'range', group: 'Lens', min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: 'cy', label: 'Center Y', type: 'range', group: 'Lens', min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: 'falloff', label: 'Edge Falloff', type: 'range', group: 'Lens', min: 0.2, max: 4, step: 0.01, default: 1.6 },
  ],
  render({ src, ctx, width, height, params: p }) {
    // A fraction of the radius, so the fringe scales with the picture. 0.0516 is the old preview strength.
    const amt = (p.amount as number) * 0.0516;
    const cx = (p.cx as number) * width, cy = (p.cy as number) * height, f = p.falloff as number;
    const R = Math.hypot(width, height) / 2;
    const out = ctx.createImageData(width, height), o = out.data, tmp = new Uint8ClampedArray(4), d = src.data;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, dx = x - cx, dy = y - cy;
        const k = Math.pow(Math.hypot(dx, dy) / R, f) * amt;
        sampleBilinear(d, width, height, cx + dx * (1 + k), cy + dy * (1 + k), tmp, 0);
        o[i] = tmp[0];
        o[i + 1] = d[i + 1];
        sampleBilinear(d, width, height, cx + dx * (1 - k), cy + dy * (1 - k), tmp, 0);
        o[i + 2] = tmp[2];
        o[i + 3] = d[i + 3];
      }
    ctx.putImageData(out, 0, 0);
  },
};

/* ───────────── Light rays ───────────── */

export const lightRays: EffectDefinition = {
  id: 'lightRays',
  name: 'Light Rays',
  category: 'light',
  description: 'Volumetric god rays cast from the image’s own highlights.',
  animated: (p) => (p.shimmer as number) > 0,
  audioDefaults: { intensity: { band: 'level', amount: 0.3 } },
  params: [
    { key: 'sources', label: 'Light Sources', type: 'range', group: 'Light Sources', min: 1, max: 3, step: 1, default: 1 },
    ...sourcePos(1, 0.5, 0.15), ...sourcePos(2, 0.2, 0.2), ...sourcePos(3, 0.8, 0.2),
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Rays', min: 0, max: 0.95, step: 0.01, default: 0.45 },
    { key: 'length', label: 'Ray Length', type: 'range', group: 'Rays', min: 0.1, max: 1, step: 0.01, default: 0.7 },
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Rays', min: 0, max: 3, step: 0.01, default: 1.1 },
    { key: 'color', label: 'Color', type: 'color', group: 'Rays', default: '#ffe7bf' },
    { key: 'shimmer', label: 'Shimmer', type: 'range', group: 'Rays', min: 0, max: 1, step: 0.01, default: 0.2 },
    ...output,
  ],
  render({ src, srcCanvas, ctx, width, height, params: p, time }) {
    begin(ctx, srcCanvas, p);
    const scale = 0.25, w = Math.round(width * scale), h = Math.round(height * scale);
    const d = src.data, plane = new Float32Array(w * h), thr = p.threshold as number;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        plane[y * w + x] = Math.max(0, l - thr) / (1 - thr);
      }
    const col = hexToRgb(p.color as string), N = 28, len = p.length as number, I = p.intensity as number, sh = p.shimmer as number;
    for (const s of sources(p)) {
      const out = new ImageData(w, h), lx = s.x * w, ly = s.y * h;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let acc = 0, wt = 1;
          const dx = ((lx - x) * len) / N, dy = ((ly - y) * len) / N;
          let sx = x, sy = y;
          for (let k = 0; k < N; k++) {
            sx += dx; sy += dy;
            const ix = sx | 0, iy = sy | 0;
            if (ix >= 0 && iy >= 0 && ix < w && iy < h) acc += plane[iy * w + ix] * wt;
            wt *= 0.97;
          }
          let v = (acc / N) * I * 2.2;
          if (sh > 0) v *= 1 - sh * 0.5 + sh * 0.5 * Math.sin(Math.atan2(y - ly, x - lx) * 24 + time * 1.3);
          const o = (y * w + x) * 4;
          out.data[o] = col[0] * v; out.data[o + 1] = col[1] * v; out.data[o + 2] = col[2] * v; out.data[o + 3] = 255;
        }
      const cv = createCanvas(w, h);
      get2d(cv).putImageData(out, 0, 0);
      ctx.drawImage(cv, 0, 0, width, height);
    }
    end(ctx);
  },
};

/* ───────────── Light leak ───────────── */

export const lightLeak: EffectDefinition = {
  id: 'lightLeak',
  name: 'Light Leak',
  category: 'light',
  description: 'Warm film-gate leaks drifting in from the frame edges.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { opacity: { band: 'beat', amount: 0.25 } },
  params: [
    { key: 'count', label: 'Light Elements', type: 'range', group: 'Leak', min: 1, max: 8, step: 1, default: 3 },
    { key: 'radius', label: 'Radius', type: 'range', group: 'Leak', min: 100, max: 1400, step: 1, default: 620 },
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Leak', min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: 'colorA', label: 'Color A', type: 'color', group: 'Leak', default: '#ff4a1c' },
    { key: 'colorB', label: 'Color B', type: 'color', group: 'Leak', default: '#ffb52e' },
    { key: 'speed', label: 'Drift Speed', type: 'range', group: 'Leak', min: 0, max: 2, step: 0.01, default: 0.3 },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Leak', default: 4 },
    ...output,
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    begin(ctx, srcCanvas, p);
    const rng = createRng(p.seed as number), R = (p.radius as number) * unit, I = p.intensity as number;
    const a = hexToRgb(p.colorA as string), b = hexToRgb(p.colorB as string), sp = p.speed as number;
    for (let i = 0; i < (p.count as number); i++) {
      const edge = rng(), along = rng(), ph = rng() * 6.28, sc = 0.5 + rng();
      const t = time * sp + ph;
      const drift = Math.sin(t) * 0.18;
      const left = edge < 0.5;
      const x = (left ? (edge < 0.25 ? -0.05 : 1.05) : along + drift) * width;
      const y = (left ? along + drift : edge < 0.75 ? -0.05 : 1.05) * height;
      const col = i % 2 ? b : a;
      const pulse = 0.65 + 0.35 * Math.sin(t * 1.7);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R * sc);
      g.addColorStop(0, rgba(col, I * pulse));
      g.addColorStop(0.45, rgba(col, 0.35 * I * pulse));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
    end(ctx);
  },
};

/* ───────────── Aurora ───────────── */

export const aurora: EffectDefinition = {
  id: 'aurora',
  name: 'Aurora',
  category: 'light',
  description: 'Curtains of noise-driven light gradients.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { intensity: { band: 'level', amount: 0.3 } },
  params: [
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Aurora', min: 0, max: 2, step: 0.01, default: 1 },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Aurora', min: 0.2, max: 4, step: 0.01, default: 1 },
    { key: 'height', label: 'Curtain Height', type: 'range', group: 'Aurora', min: 0.1, max: 1, step: 0.01, default: 0.55 },
    { key: 'y', label: 'Position Y', type: 'range', group: 'Aurora', min: -0.2, max: 1, step: 0.01, default: 0.45 },
    { key: 'colorA', label: 'Color A', type: 'color', group: 'Aurora', default: '#2bff9a' },
    { key: 'colorB', label: 'Color B', type: 'color', group: 'Aurora', default: '#7a4dff' },
    { key: 'speed', label: 'Speed', type: 'range', group: 'Aurora', min: 0, max: 2, step: 0.01, default: 0.3 },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Aurora', default: 30 },
    ...output,
  ],
  render({ srcCanvas, ctx, width, height, params: p, time }) {
    begin(ctx, srcCanvas, p);
    const w = Math.max(32, Math.round(width / 4)), h = Math.max(32, Math.round(height / 4));
    const out = new ImageData(w, h), a = hexToRgb(p.colorA as string), b = hexToRgb(p.colorB as string);
    const sc = p.scale as number, H = p.height as number, Y = p.y as number, I = p.intensity as number, seed = p.seed as number;
    const t = time * (p.speed as number);
    for (let x = 0; x < w; x++) {
      const u = (x / w) * 3 * sc;
      const baseY = Y + (fbm(u, t * 0.4, seed, 3) - 0.5) * 0.7;
      const col = fbm(u * 2.4, t * 0.3, seed + 4, 3);
      const fold = 0.35 + 1.1 * Math.max(0, fbm(u * 6, t, seed + 8, 2) - 0.25);
      for (let y = 0; y < h; y++) {
        const v = y / h, d = (v - baseY) / H;
        // Sharp lower edge, long fade upward — like a real curtain.
        const e = d > 0 ? Math.exp(-d * d * 60) : Math.exp(d * 3.2);
        const k = Math.min(1.5, e * fold * I);
        const o = (y * w + x) * 4, m = Math.min(1, Math.max(0, col * 1.8 - 0.4 + -d * 0.7));
        out.data[o] = (a[0] + (b[0] - a[0]) * m) * k;
        out.data[o + 1] = (a[1] + (b[1] - a[1]) * m) * k;
        out.data[o + 2] = (a[2] + (b[2] - a[2]) * m) * k;
        out.data[o + 3] = 255;
      }
    }
    const cv = createCanvas(w, h);
    get2d(cv).putImageData(out, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cv, 0, 0, width, height);
    end(ctx);
  },
};

/* ───────────── Light particles ───────────── */

export const lightParticles: EffectDefinition = withContent({
  id: 'lightParticles',
  name: 'Light Particles',
  category: 'light',
  description: 'Drifting specks and bokeh discs of light.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { size: { band: 'bass', amount: 0.15 } },
  params: [
    { key: 'density', label: 'Particle Density', type: 'range', group: 'Particles', min: 10, max: 1500, step: 10, default: 240 },
    { key: 'size', label: 'Size', type: 'range', group: 'Particles', min: 1, max: 120, step: 0.5, default: 14 },
    { key: 'kind', label: 'Shape', type: 'select', group: 'Particles', default: 'spark', options: [{ value: 'spark', label: 'Spark' }, { value: 'bokeh', label: 'Bokeh Disc' }] },
    { key: 'color', label: 'Color', type: 'color', group: 'Particles', default: '#ffd27a' },
    { key: 'speed', label: 'Speed', type: 'range', group: 'Particles', min: 0, max: 3, step: 0.01, default: 0.5 },
    { key: 'angle', label: 'Direction', type: 'range', group: 'Particles', min: 0, max: 359, step: 1, default: 270, unit: '°' },
    { key: 'twinkle', label: 'Twinkle', type: 'range', group: 'Particles', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Particles', default: 16 },
    ...output,
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    begin(ctx, srcCanvas, p);
    const rng = createRng(p.seed as number), col = hexToRgb(p.color as string), base = (p.size as number) * unit;
    const a = ((p.angle as number) * Math.PI) / 180, sp = (p.speed as number) * 0.05, tw = p.twinkle as number;
    const bokeh = p.kind === 'bokeh', stamps = contentOf(p, unit);
    stamps?.begin(ctx);
    for (let i = 0; i < (p.density as number); i++) {
      const x0 = rng(), y0 = rng(), sz = rng(), ph = rng() * 6.28, v = 0.4 + rng();
      const x = (((x0 + Math.cos(a) * sp * time * v) % 1) + 1) % 1, y = (((y0 + Math.sin(a) * sp * time * v) % 1) + 1) % 1;
      const r = base * (0.25 + sz * sz);
      const alpha = (1 - tw + tw * (0.5 + 0.5 * Math.sin(time * 2.4 * v + ph))) * (bokeh ? 0.28 : 0.85);
      const px = x * width, py = y * height;
      if (stamps) { stamps.stamp(ctx, i, px, py, r * 2, col, time * (v - 0.9), Math.min(1, alpha * 1.3)); continue; }
      const g = ctx.createRadialGradient(px, py, bokeh ? r * 0.75 : 0, px, py, r);
      g.addColorStop(0, rgba(col, bokeh ? alpha * 0.6 : alpha));
      g.addColorStop(bokeh ? 0.92 : 0.3, rgba(col, bokeh ? alpha : alpha * 0.35));
      g.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    stamps?.end(ctx);
    end(ctx);
  },
});

export const OPTICAL = [lensFlare, glowBloom, anamorphic, chromaticAb, lightRays, lightLeak, aurora, lightParticles];
