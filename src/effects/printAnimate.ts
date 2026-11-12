import type { EffectDefinition } from './types';
import { adjust, clamp255, hash2, hexToRgb, type RGB } from '../utils/imageProcessing';

const INK_SETS: Record<string, { inks: string[] }> = {
  riso: { inks: ['#0078bf', '#ff48b0', '#ffe800'] },
  duo: { inks: ['#0078bf', '#ff48b0'] },
  cmy: { inks: ['#00aeef', '#ec008c', '#fff200'] },
  fluo: { inks: ['#00a95c', '#ff6c2f'] },
  mono: { inks: ['#1b1b1b'] },
};

/**
 * PrintAnimate: a risograph / offset print that never sits still. Each ink
 * plate is screened separately, slightly mis-registered, and the
 * registration "boils" a few times a second — like flipping through prints.
 */
export const printAnimate: EffectDefinition = {
  id: 'printAnimate',
  name: 'PrintAnimate',
  category: 'texture',
  description: 'Risograph-style ink plates with living mis-registration.',
  animated: (p) => (p.rate as number) > 0 && (p.jitter as number) > 0,
  audioDefaults: { misreg: { band: 'beat', amount: 0.25 } },
  params: [
    {
      key: 'inks', label: 'Ink Set', type: 'select', group: 'Inks', default: 'riso',
      options: [
        { value: 'riso', label: 'Riso 3' }, { value: 'duo', label: 'Riso Duo' }, { value: 'cmy', label: 'CMY' },
        { value: 'fluo', label: 'Fluo' }, { value: 'mono', label: 'Mono' },
      ],
    },
    { key: 'cell', label: 'Dot Size', type: 'range', group: 'Screen', min: 2, max: 40, step: 0.5, default: 6 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Screen', min: 0.3, max: 3, step: 0.01, default: 1.2 },
    { key: 'density', label: 'Ink Density', type: 'range', group: 'Screen', min: 0.4, max: 1, step: 0.01, default: 0.9, hint: 'Lower = patchy, under-inked print.' },
    { key: 'misreg', label: 'Mis-registration', type: 'range', group: 'Motion', min: 0, max: 40, step: 0.5, default: 5 },
    { key: 'jitter', label: 'Jitter', type: 'range', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'rate', label: 'Boil Rate', type: 'range', group: 'Motion', min: 0, max: 24, step: 1, default: 8, unit: 'fps' },
    { key: 'paper', label: 'Paper Color', type: 'color', group: 'Paper', default: '#f4f0e6' },
    { key: 'grain', label: 'Paper Grain', type: 'range', group: 'Paper', min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const set = INK_SETS[params.inks as string] ?? INK_SETS.riso;
    const inks: RGB[] = set.inks.map(hexToRgb);
    const paper = hexToRgb(params.paper as string);
    const cell = Math.max(1.5, (params.cell as number) * unit);
    const contrast = params.contrast as number;
    const density = params.density as number;
    const step = Math.floor(time * (params.rate as number));
    const mis = (params.misreg as number) * unit;
    const jit = (params.jitter as number) * mis;
    const grain = params.grain as number;
    const k = Math.PI / cell;
    // per-ink: plate offset, screen angle
    const plates = inks.map((_, i) => {
      const a = (15 + i * 30) * (Math.PI / 180);
      return {
        ox: Math.cos(i * 2.1) * mis + (hash2(step, i, 7) - 0.5) * 2 * jit,
        oy: Math.sin(i * 2.1) * mis + (hash2(step, i, 13) - 0.5) * 2 * jit,
        ca: Math.cos(a), sa: Math.sin(a),
      };
    });
    const d = src.data;
    const out = ctx.createImageData(width, height);
    const o = out.data;
    const n = inks.length;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oi = (y * width + x) * 4;
        let r = paper[0], g = paper[1], b = paper[2];
        for (let p = 0; p < n; p++) {
          const pl = plates[p];
          const sx = Math.min(width - 1, Math.max(0, Math.round(x - pl.ox)));
          const sy = Math.min(height - 1, Math.max(0, Math.round(y - pl.oy)));
          const si = (sy * width + sx) * 4;
          // how much of this plate's ink this pixel needs
          let tone: number;
          if (n === 1) tone = 1 - (0.2126 * d[si] + 0.7152 * d[si + 1] + 0.0722 * d[si + 2]) / 255;
          else if (n === 2) tone = p === 0 ? 1 - (d[si] * 0.6 + d[si + 1] * 0.4) / 255 : 1 - (d[si + 1] * 0.7 + d[si + 2] * 0.3) / 255;
          else tone = 1 - d[si + p] / 255;
          tone = adjust(tone, 0, contrast);
          const u = x * pl.ca + y * pl.sa, v = -x * pl.sa + y * pl.ca;
          const screen = (Math.sin(u * k) * Math.sin(v * k) + 1) / 2;
          let cov = Math.min(1, Math.max(0, (tone - screen) * 3 + 0.5));
          if (hash2(x, y, p * 31 + 3) > density) cov *= 0.25;
          const ink = inks[p];
          r *= 1 - cov * (1 - ink[0] / 255);
          g *= 1 - cov * (1 - ink[1] / 255);
          b *= 1 - cov * (1 - ink[2] / 255);
        }
        const gn = grain ? (hash2(x >> 1, y >> 1, 99) - 0.5) * grain * 40 : 0;
        o[oi] = clamp255(r + gn);
        o[oi + 1] = clamp255(g + gn);
        o[oi + 2] = clamp255(b + gn);
        o[oi + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
