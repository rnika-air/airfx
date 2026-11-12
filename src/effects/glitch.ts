import type { EffectDefinition } from './types';
import { clamp255, createRng, hash2 } from '../utils/imageProcessing';

/**
 * Glitch: seeded horizontal tearing bands, RGB channel separation, digital
 * noise and CRT scanlines. With "Animate" off the glitch is frozen in place on
 * video; with it on the seed advances ~12 times a second.
 */
export const glitch: EffectDefinition = {
  id: 'glitch',
  name: 'Glitch',
  category: 'distortion',
  description: 'Torn bands, split channels, digital noise.',
  animated: (p) => p.animate === true,
  audioDefaults: { rgbSplit: { band: 'bass', amount: 0.25 }, intensity: { band: 'beat', amount: 0.4 } },
  params: [
    { key: 'intensity', label: 'Glitch Intensity', type: 'range', group: 'Tearing', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'bands', label: 'Glitch Bands', type: 'range', group: 'Tearing', min: 0, max: 60, step: 1, default: 14 },
    { key: 'hShift', label: 'Horizontal Shift', type: 'range', group: 'Tearing', min: 0, max: 300, step: 1, default: 80 },
    { key: 'vShift', label: 'Vertical Shift', type: 'range', group: 'Channels', min: -60, max: 60, step: 0.5, default: 0 },
    { key: 'rgbSplit', label: 'RGB Separation', type: 'range', group: 'Channels', min: 0, max: 80, step: 0.5, default: 10 },
    { key: 'noise', label: 'Noise Amount', type: 'range', group: 'Texture', min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: 'scanlines', label: 'Scanline Intensity', type: 'range', group: 'Texture', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Tearing', default: 42 },
    { key: 'animate', label: 'Animate (video)', type: 'toggle', group: 'Tearing', default: true },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const intensity = params.intensity as number;
    const bandCount = Math.round(params.bands as number);
    const seed = (params.seed as number) + (params.animate ? Math.floor(time * 12) * 7919 : 0);
    const rng = createRng(seed);
    const hMax = (params.hShift as number) * unit;
    const split = (params.rgbSplit as number) * unit;
    const vSplit = (params.vShift as number) * unit;
    const noise = params.noise as number;
    const scan = params.scanlines as number;
    const scanPeriod = Math.max(2, Math.round(3 * unit));

    // Per-row displacement + per-row corruption flags.
    const rowDx = new Float32Array(height);
    const rowSplit = new Float32Array(height).fill(1);
    const rowCorrupt = new Uint8Array(height);
    for (let b = 0; b < bandCount; b++) {
      if (rng() > intensity * 0.9 + 0.1) {
        rng(); rng(); rng(); rng();
        continue;
      }
      const y0 = Math.floor(rng() * height);
      const bh = Math.max(1, Math.floor((0.004 + rng() * rng() * 0.12) * height));
      const dx = (rng() - 0.5) * 2 * hMax * intensity;
      const corrupt = rng() < 0.25 * intensity ? 1 : 0;
      for (let y = y0; y < Math.min(height, y0 + bh); y++) {
        rowDx[y] += dx;
        rowSplit[y] = 1 + intensity * 2;
        rowCorrupt[y] = corrupt;
      }
    }

    const sp = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    const sample = (x: number, y: number, c: number) => {
      // wrap horizontally (classic tearing look), clamp vertically
      let xi = Math.round(x) % width;
      if (xi < 0) xi += width;
      const yi = y < 0 ? 0 : y >= height ? height - 1 : Math.round(y);
      return sp[(yi * width + xi) * 4 + c];
    };

    for (let y = 0; y < height; y++) {
      const dx = rowDx[y];
      const s = split * rowSplit[y];
      const scanDark = scan > 0 && y % scanPeriod === 0 ? 1 - scan * 0.6 : 1;
      const corrupt = rowCorrupt[y];
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let r = sample(x + dx + s, y + vSplit, 0);
        let g = sample(x + dx, y, 1);
        let b = sample(x + dx - s, y - vSplit, 2);
        if (corrupt) {
          // crush to a few levels and swap channels like a broken decoder
          const t = r;
          r = (b >> 6) << 6;
          b = (g >> 6) << 6;
          g = (t >> 5) << 5;
        }
        if (noise > 0) {
          const n = (hash2(x, y, seed) - 0.5) * 255 * noise * (corrupt ? 2 : 1);
          r += n; g += n; b += n;
        }
        op[i] = clamp255(r * scanDark);
        op[i + 1] = clamp255(g * scanDark);
        op[i + 2] = clamp255(b * scanDark);
        op[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
