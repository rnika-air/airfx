import type { EffectDefinition } from './types';
import { createRng } from '../utils/imageProcessing';
import { EASE_OPTIONS, TEXTURE_PARAMS, cardTextures, drawCard, ease } from './cards';

/**
 * Stack: a deck of image cards with seeded random tilts. On each step the
 * top card swings out to the side and tucks back under the deck while the
 * rest move up one place. Loops every `duration` seconds.
 */
export const stack: EffectDefinition = {
  id: 'stack',
  name: 'Stack',
  category: 'animate',
  description: 'A shuffling deck of image cards, looping.',
  animated: () => true,
  audioDefaults: { rotationRange: { band: 'bass', amount: 0.12 }, cardSize: { band: 'beat', amount: 0.06 } },
  params: [
    { key: 'cards', label: 'Cards', type: 'range', group: 'Deck', min: 2, max: 20, step: 1, default: 6 },
    { key: 'cardSize', label: 'Card Size', type: 'range', group: 'Deck', min: 60, max: 900, step: 1, default: 520 },
    { key: 'rotationRange', label: 'Rotation Range', type: 'range', group: 'Deck', min: 0, max: 45, step: 0.5, default: 12, unit: '°' },
    { key: 'rotationSeed', label: 'Rotation Seed', type: 'seed', group: 'Deck', default: 1 },
    { key: 'xShift', label: 'X Shift Scale', type: 'range', group: 'Deck', min: -60, max: 60, step: 0.5, default: 0 },
    { key: 'yShift', label: 'Y Shift Scale', type: 'range', group: 'Deck', min: -60, max: 60, step: 0.5, default: -10 },
    { key: 'depthScale', label: 'Depth Scale', type: 'range', group: 'Deck', min: 0, max: 0.1, step: 0.001, default: 0.025 },
    { key: 'cycles', label: 'Cycles', type: 'range', group: 'Timing', min: 0, max: 8, step: 1, default: 3 },
    { key: 'duration', label: 'Duration', type: 'range', group: 'Timing', min: 2, max: 60, step: 0.5, default: 16, unit: 's' },
    { key: 'curve', label: 'Speed Curve', type: 'select', group: 'Timing', default: 'smooth', options: EASE_OPTIONS },
    {
      key: 'exit', label: 'Exit Direction', type: 'select', group: 'Timing', default: 'right',
      options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }, { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }],
    },
    ...TEXTURE_PARAMS,
    { key: 'radius', label: 'Corner Radius', type: 'range', group: 'Look', min: 0, max: 120, step: 0.5, default: 18 },
    { key: 'shadow', label: 'Shadow', type: 'range', group: 'Look', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Look', default: '#f9f8f5' },
  ],
  render({ srcCanvas, ctx, width, height, params, unit, time }) {
    const n = params.cards as number;
    const size = (params.cardSize as number) * unit;
    const range = ((params.rotationRange as number) * Math.PI) / 180;
    const rng = createRng(params.rotationSeed as number);
    const rots = Array.from({ length: n }, () => (rng() * 2 - 1) * range);
    const xs = (params.xShift as number) * unit, ys = (params.yShift as number) * unit;
    const depthScale = params.depthScale as number;
    const duration = params.duration as number;
    const cycles = params.cycles as number;
    const curve = params.curve as string;
    const bg = params.background as string;
    const tex = cardTextures(params, srcCanvas, width, height, n);
    const exit = params.exit as string;
    const ex = exit === 'right' ? 1 : exit === 'left' ? -1 : 0;
    const ey = exit === 'down' ? 1 : exit === 'up' ? -1 : 0;

    const loopT = ((time % duration) + duration) % duration / duration;
    const steps = loopT * cycles * n; // cards shuffled so far
    const passed = Math.floor(steps);
    const f = ease(curve, steps - passed);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;

    const items = Array.from({ length: n }, (_, i) => {
      const k = (((i - passed) % n) + n) % n; // 0 = top of deck
      let pos: number, x = 0, y = 0, order: number, rot = rots[i];
      if (k === 0) {
        // swing out then tuck under: position goes 0 → n−1
        pos = f * (n - 1);
        const swing = Math.sin(f * Math.PI);
        x = ex * swing * size * 0.95;
        y = ey * swing * size * 0.95;
        rot += ex * swing * 0.35 - ey * swing * 0.1;
        order = f < 0.5 ? n : -1; // on top while leaving, behind once tucking
      } else {
        pos = k - f;
        order = n - k;
      }
      const tile = tex[i];
      const aspect = tile.sw / tile.sh;
      return {
        i, order,
        draw: {
          x: cx + x + pos * xs,
          y: cy + y + pos * ys,
          w: aspect >= 1 ? size : size * aspect,
          h: aspect >= 1 ? size / aspect : size,
          rot,
          scaleX: 1,
          scale: Math.max(0.1, 1 - pos * depthScale),
          radius: (params.radius as number) * unit,
          fog: 0,
          shadow: params.shadow as number,
        },
      };
    });
    items.sort((a, b) => a.order - b.order);
    for (const it of items) drawCard(ctx, tex[it.i], it.draw, bg);
  },
};
