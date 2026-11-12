import type { EffectDefinition } from './types';
import { hash2 } from '../utils/imageProcessing';

/**
 * PixDisplace: the image is cut into blocks and a random subset jumps
 * sideways (or up/down) by stepped amounts several times a second — a
 * self-animating digital-corruption look. Optional smear stretches each
 * displaced block into a streak.
 */
export const pixDisplace: EffectDefinition = {
  id: 'pixDisplace',
  name: 'PixDisplace',
  category: 'distortion',
  description: 'Blocks of pixels jump and smear on their own — animated corruption.',
  animated: (p) => (p.rate as number) > 0,
  audioDefaults: { coverage: { band: 'beat', amount: 0.4 }, amount: { band: 'bass', amount: 0.2 } },
  params: [
    { key: 'block', label: 'Block Size', type: 'range', group: 'Blocks', min: 3, max: 160, step: 1, default: 28 },
    { key: 'coverage', label: 'Coverage', type: 'range', group: 'Blocks', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'mixed', label: 'Mixed Sizes', type: 'toggle', group: 'Blocks', default: true },
    { key: 'amount', label: 'Displacement', type: 'range', group: 'Motion', min: 0, max: 600, step: 1, default: 90 },
    {
      key: 'direction', label: 'Direction', type: 'select', group: 'Motion', default: 'horizontal',
      options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }, { value: 'both', label: 'Both' }],
    },
    { key: 'smear', label: 'Smear', type: 'range', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.2, hint: 'Stretch displaced blocks into streaks.' },
    { key: 'rate', label: 'Steps / sec', type: 'range', group: 'Motion', min: 0, max: 30, step: 0.5, default: 8, hint: '0 = frozen.' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Motion', default: 21 },
  ],
  render({ srcCanvas, ctx, width, height, params, unit, time }) {
    const base = Math.max(2, (params.block as number) * unit);
    const coverage = params.coverage as number;
    const amount = (params.amount as number) * unit;
    const dir = params.direction as string;
    const smear = params.smear as number;
    const step = Math.floor(time * (params.rate as number));
    const seed = (params.seed as number) + step * 977;
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const cols = Math.ceil(width / base), rows = Math.ceil(height / base);
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        if (hash2(bx, by, seed) > coverage) continue;
        const big = params.mixed && hash2(bx, by, seed + 5) > 0.7 ? 2 + Math.floor(hash2(bx, by, seed + 6) * 3) : 1;
        const bw = base * (dir === 'vertical' ? 1 : big), bh = base * (dir === 'vertical' ? big : 1);
        const x = bx * base, y = by * base;
        const r1 = hash2(bx, by, seed + 1) - 0.5, r2 = hash2(bx, by, seed + 2) - 0.5;
        const dx = dir === 'vertical' ? 0 : r1 * 2 * amount;
        const dy = dir === 'horizontal' ? 0 : (dir === 'both' ? r2 : r1) * 2 * amount;
        const sx = Math.max(0, Math.min(width - bw, x + dx)), sy = Math.max(0, Math.min(height - bh, y + dy));
        const stretch = smear > 0 && hash2(bx, by, seed + 3) < smear ? 1 + hash2(bx, by, seed + 4) * 6 : 1;
        const dw = dir === 'vertical' ? bw : bw * stretch, dh = dir === 'vertical' ? bh * stretch : bh;
        ctx.drawImage(srcCanvas, sx, sy, Math.max(1, bw / (dir === 'vertical' ? 1 : stretch)), Math.max(1, bh / (dir === 'vertical' ? stretch : 1)), x, y, dw, dh);
      }
    }
    ctx.imageSmoothingEnabled = true;
  },
};
