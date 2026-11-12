import type { EffectDefinition } from './types';
import { boxBlur, fbm, sampleBilinear, toLuma } from '../utils/imageProcessing';

/**
 * Displace: offsets pixels using a displacement map — the image's own
 * luminance or a colour channel, its luminance gradient (a refraction-like
 * look), or procedural fractal noise. Optional per-channel split.
 */
export const displace: EffectDefinition = {
  id: 'displace',
  name: 'Displace',
  category: 'distortion',
  description: 'Push pixels by a map: the image itself or fractal noise.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { strength: { band: 'bass', amount: 0.3 }, chroma: { band: 'treble', amount: 0.3 } },
  params: [
    {
      key: 'map', label: 'Map Source', type: 'select', group: 'Map', default: 'noise',
      options: [
        { value: 'noise', label: 'Fractal Noise' },
        { value: 'luma', label: 'Luminance' },
        { value: 'gradient', label: 'Gradient (Refract)' },
        { value: 'red', label: 'Red Channel' },
        { value: 'green', label: 'Green Channel' },
        { value: 'blue', label: 'Blue Channel' },
      ],
    },
    { key: 'strength', label: 'Strength', type: 'range', group: 'Map', min: 0, max: 200, step: 0.5, default: 40 },
    { key: 'angle', label: 'Direction', type: 'range', group: 'Map', min: 0, max: 359, step: 1, default: 0, unit: '°', visibleWhen: (v) => v.map !== 'noise' && v.map !== 'gradient' },
    { key: 'smooth', label: 'Map Smoothing', type: 'range', group: 'Map', min: 0, max: 40, step: 0.5, default: 6 },
    { key: 'scale', label: 'Noise Scale', type: 'range', group: 'Noise', min: 5, max: 600, step: 1, default: 160, visibleWhen: (v) => v.map === 'noise' },
    { key: 'octaves', label: 'Octaves', type: 'range', group: 'Noise', min: 1, max: 6, step: 1, default: 3, visibleWhen: (v) => v.map === 'noise' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Noise', default: 3, visibleWhen: (v) => v.map === 'noise' },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Noise', min: 0, max: 3, step: 0.01, default: 0 },
    { key: 'chroma', label: 'Channel Split', type: 'range', group: 'Output', min: 0, max: 1, step: 0.01, default: 0 },
    {
      key: 'edges', label: 'Edges', type: 'select', group: 'Output', default: 'clamp',
      options: [{ value: 'clamp', label: 'Clamp' }, { value: 'wrap', label: 'Wrap' }],
    },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const mapType = params.map as string;
    const strength = (params.strength as number) * unit;
    const a = ((params.angle as number) * Math.PI) / 180;
    const dirX = Math.cos(a), dirY = Math.sin(a);
    const smooth = (params.smooth as number) * unit;
    const wrap = params.edges === 'wrap';
    const chroma = params.chroma as number;
    const d = src.data;
    const n = width * height;

    // Build two map planes mx, my in −0.5..0.5
    let mx: Float32Array, my: Float32Array;
    if (mapType === 'noise') {
      // Evaluated on a coarse grid then interpolated by the blur — much cheaper.
      const step = Math.max(1, Math.floor(unit * 2));
      const gw = Math.ceil(width / step), gh = Math.ceil(height / step);
      const sc = (params.scale as number) * unit;
      const oct = params.octaves as number;
      const seed = params.seed as number;
      const t = time * (params.speed as number) * 0.4;
      const gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          const u = (x * step) / sc + t, v = (y * step) / sc - t * 0.6;
          gx[y * gw + x] = fbm(u, v, seed, oct) - 0.5;
          gy[y * gw + x] = fbm(u + 31.7, v + 17.3, seed + 9, oct) - 0.5;
        }
      mx = new Float32Array(n);
      my = new Float32Array(n);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const g = Math.min(gh - 1, (y / step) | 0) * gw + Math.min(gw - 1, (x / step) | 0);
          mx[y * width + x] = gx[g];
          my[y * width + x] = gy[g];
        }
      if (step > 1) {
        mx = boxBlur(mx, width, height, step, 1);
        my = boxBlur(my, width, height, step, 1);
      }
      if (smooth > 0) {
        mx = boxBlur(mx, width, height, smooth / 2, 2);
        my = boxBlur(my, width, height, smooth / 2, 2);
      }
    } else {
      let plane: Float32Array;
      if (mapType === 'luma' || mapType === 'gradient') plane = toLuma(src);
      else {
        const c = mapType === 'red' ? 0 : mapType === 'green' ? 1 : 2;
        plane = new Float32Array(n);
        for (let i = 0; i < n; i++) plane[i] = d[i * 4 + c] / 255;
      }
      plane = boxBlur(plane, width, height, smooth / 2, 2);
      mx = new Float32Array(n);
      my = new Float32Array(n);
      if (mapType === 'gradient') {
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = y * width + x;
            const l = plane[y * width + Math.max(0, x - 1)], r = plane[y * width + Math.min(width - 1, x + 1)];
            const t = plane[Math.max(0, y - 1) * width + x], b = plane[Math.min(height - 1, y + 1) * width + x];
            mx[i] = (r - l) * 4;
            my[i] = (b - t) * 4;
          }
      } else {
        for (let i = 0; i < n; i++) {
          const m = plane[i] - 0.5;
          mx[i] = m * dirX;
          my[i] = m * dirY;
        }
      }
    }

    const out = ctx.createImageData(width, height);
    const op = out.data;
    const tmp = new Uint8ClampedArray(4);
    const s2 = strength * 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const o = i * 4;
        const dx = mx[i] * s2, dy = my[i] * s2;
        sampleBilinear(d, width, height, x + dx, y + dy, op, o, wrap);
        if (chroma > 0) {
          sampleBilinear(d, width, height, x + dx * (1 + chroma), y + dy * (1 + chroma), tmp, 0, wrap);
          op[o] = tmp[0];
          sampleBilinear(d, width, height, x + dx * (1 - chroma), y + dy * (1 - chroma), tmp, 0, wrap);
          op[o + 2] = tmp[2];
        }
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
