import type { EffectDefinition } from './types';
import { createCanvas, get2d, hash2 } from '../utils/imageProcessing';

/**
 * PixDisplace: the image is cut into blocks and a random subset jumps
 * sideways (or up/down) by stepped amounts several times a second — a
 * self-animating digital-corruption look. Optional smear stretches each
 * displaced block into a streak.
 *
 * Explode breaks the picture outward from a centre: blocks fly out further the
 * farther they are from it, leaving dark holes where they were, each with a
 * red/blue colour fringe (the shattered-face look). Area keeps it to a circle.
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
      options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }, { value: 'both', label: 'Both' }, { value: 'explode', label: 'Explode Outward' }],
    },
    { key: 'smear', label: 'Smear', type: 'range', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.2, hint: 'Stretch displaced blocks into streaks.' },
    { key: 'rate', label: 'Steps / sec', type: 'range', group: 'Motion', min: 0, max: 30, step: 0.5, default: 8, hint: '0 = frozen.' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Motion', default: 21 },
    { key: 'fringe', label: 'Color Fringe', type: 'range', group: 'Color', min: 0, max: 20, step: 0.1, default: 0, hint: 'Red and blue edges on the moved blocks.' },
    { key: 'holes', label: 'Dark Holes', type: 'range', group: 'Blocks', min: 0, max: 1, step: 0.01, default: 0, hint: 'Leave the place a block came from dark.' },
    { key: 'area', label: 'Area', type: 'range', group: 'Area', min: 0.05, max: 1, step: 0.005, default: 1, hint: '1 = the whole picture.' },
    { key: 'cx', label: 'Center X', type: 'range', group: 'Area', min: 0, max: 1, step: 0.005, default: 0.5, visibleWhen: (v) => v.direction === 'explode' || (v.area as number) < 1 },
    { key: 'cy', label: 'Center Y', type: 'range', group: 'Area', min: 0, max: 1, step: 0.005, default: 0.4, visibleWhen: (v) => v.direction === 'explode' || (v.area as number) < 1 },
  ],
  presets: [
    { name: 'Shattered Face', values: { direction: 'explode', block: 22, coverage: 0.75, amount: 70, mixed: true, smear: 0, fringe: 5, holes: 0.35, area: 0.32, cx: 0.5, cy: 0.32, rate: 2 } },
    { name: 'Signal Tear', values: { direction: 'horizontal', block: 18, coverage: 0.35, amount: 160, smear: 0.5, fringe: 3, rate: 10 } },
    { name: 'Data Rain', values: { direction: 'vertical', block: 10, coverage: 0.4, amount: 220, smear: 0.7, rate: 6 } },
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
    const explode = dir === 'explode', fringe = (params.fringe as number) * unit, holes = params.holes as number;
    const area = params.area as number, cxp = (params.cx as number) * width, cyp = (params.cy as number) * height;
    const long = Math.max(width, height), areaR = area * long * 0.75;
    // Red-only and blue-only copies for the fringe, made once per frame.
    const tint = (col: string) => { const c = createCanvas(width, height), g = get2d(c); g.drawImage(srcCanvas, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = col; g.fillRect(0, 0, width, height); return c; };
    const red = fringe > 0 ? tint('#ff0000') : null, blue = fringe > 0 ? tint('#0040ff') : null;
    const moved: number[] = [];
    const cols = Math.ceil(width / base), rows = Math.ceil(height / base);
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        if (hash2(bx, by, seed) > coverage) continue;
        if (area < 1 && Math.hypot((bx + 0.5) * base - cxp, (by + 0.5) * base - cyp) > areaR * (0.75 + hash2(bx, by, seed + 9) * 0.5)) continue;
        if (explode) {
          // Fly outward from the centre, further the farther out, leaving a hole behind.
          const x = bx * base, y = by * base, ox = x + base / 2 - cxp, oy = y + base / 2 - cyp, dist = Math.hypot(ox, oy) || 1;
          const push = amount * (0.3 + hash2(bx, by, seed + 1) * 0.9) * Math.min(1.6, dist / (areaR * 0.5 + 1));
          const dx = (ox / dist) * push + (hash2(bx, by, seed + 2) - 0.5) * base, dy = (oy / dist) * push + (hash2(bx, by, seed + 7) - 0.5) * base;
          moved.push(x, y, x + dx, y + dy, hash2(bx, by, seed + 8) < holes ? 1 : 0);
          continue;
        }
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
        if (red && blue) fringeAt(sx, sy, bw, bh, x, y);
        if (holes > 0 && hash2(bx, by, seed + 8) < holes) { ctx.fillStyle = '#050505'; ctx.fillRect(sx, sy, bw, bh); }
      }
    }
    if (explode) {
      // Holes first, then the pieces on top, nearest the centre last.
      ctx.fillStyle = '#050505';
      for (let k = 0; k < moved.length; k += 5) if (moved[k + 4]) ctx.fillRect(moved[k], moved[k + 1], base, base);
      for (let k = 0; k < moved.length; k += 5) {
        ctx.drawImage(srcCanvas, moved[k], moved[k + 1], base, base, moved[k + 2], moved[k + 3], base, base);
        if (red && blue) fringeAt(moved[k], moved[k + 1], base, base, moved[k + 2], moved[k + 3]);
      }
    }
    ctx.imageSmoothingEnabled = true;
    if (red) red.width = red.height = 1;
    if (blue) blue.width = blue.height = 1;
    function fringeAt(sx: number, sy: number, bw: number, bh: number, x: number, y: number) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.85;
      ctx.drawImage(red!, sx, sy, bw, bh, x + fringe, y, bw, bh);
      ctx.drawImage(blue!, sx, sy, bw, bh, x - fringe, y + fringe * 0.3, bw, bh);
      ctx.restore();
    }
  },
};
