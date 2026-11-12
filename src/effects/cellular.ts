import type { EffectDefinition, ParamValues } from './types';
import { cellAverages, hexToRgb, luminance } from '../utils/imageProcessing';

/** Birth / survival neighbour sets for the preset rules. */
const RULES: Record<string, { birth: number[]; survive: number[] }> = {
  life: { birth: [3], survive: [2, 3] },
  highlife: { birth: [3, 6], survive: [2, 3] },
  daynight: { birth: [3, 6, 7, 8], survive: [3, 4, 6, 7, 8] },
  seeds: { birth: [2], survive: [] },
  maze: { birth: [3], survive: [1, 2, 3, 4, 5] },
  coral: { birth: [3], survive: [4, 5, 6, 7, 8] },
  anneal: { birth: [4, 6, 7, 8], survive: [3, 5, 6, 7, 8] },
};

function ruleTables(p: ParamValues): { birth: Uint8Array; survive: Uint8Array } {
  const birth = new Uint8Array(9), survive = new Uint8Array(9);
  if (p.rule === 'custom') {
    for (let n = 0; n <= 8; n++) {
      birth[n] = n >= (p.birthLo as number) && n <= (p.birthHi as number) ? 1 : 0;
      survive[n] = n >= (p.surviveLo as number) && n <= (p.surviveHi as number) ? 1 : 0;
    }
  } else {
    const r = RULES[p.rule as string] ?? RULES.life;
    r.birth.forEach((n) => (birth[n] = 1));
    r.survive.forEach((n) => (survive[n] = 1));
  }
  return { birth, survive };
}

function step(cur: Uint8Array, next: Uint8Array, w: number, h: number, birth: Uint8Array, survive: Uint8Array) {
  for (let y = 0; y < h; y++) {
    const ym = (y - 1 + h) % h, yp = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const n =
        cur[ym * w + xm] + cur[ym * w + x] + cur[ym * w + xp] +
        cur[y * w + xm] + cur[y * w + xp] +
        cur[yp * w + xm] + cur[yp * w + x] + cur[yp * w + xp];
      const i = y * w + x;
      next[i] = cur[i] ? survive[n] : birth[n];
    }
  }
}

/**
 * Evolution is cached between frames: while the seed image and settings stay
 * the same (a still being animated), later generations continue from the last
 * computed one instead of restarting — keeps animation cheap.
 */
let cache: { key: string; gen: number; grid: Uint8Array } | null = null;

export const cellular: EffectDefinition = {
  id: 'cellular',
  name: 'Cellular Automata',
  category: 'pattern',
  description: 'The image seeds a Game-of-Life style grid that evolves.',
  supportsTransparency: true,
  animated: (p) => p.animate === true,
  audioDefaults: { threshold: { band: 'bass', amount: 0.25 } },
  params: [
    { key: 'cell', label: 'Cell Size', type: 'range', group: 'Grid', min: 2, max: 40, step: 0.5, default: 4 },
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Grid', min: 0, max: 1, step: 0.005, default: 0.5 },
    { key: 'invertSeed', label: 'Invert Seed', type: 'toggle', group: 'Grid', default: false },
    {
      key: 'rule', label: 'Rule', type: 'select', group: 'Rule', default: 'life',
      options: [
        { value: 'life', label: 'Classic (B3/S23)' },
        { value: 'highlife', label: 'HighLife (B36/S23)' },
        { value: 'daynight', label: 'Day & Night' },
        { value: 'seeds', label: 'Seeds (B2/S)' },
        { value: 'maze', label: 'Maze (B3/S12345)' },
        { value: 'coral', label: 'Coral (B3/S45678)' },
        { value: 'anneal', label: 'Anneal' },
        { value: 'custom', label: 'Custom bounds' },
      ],
    },
    { key: 'birthLo', label: 'Birth Lower Bound', type: 'range', group: 'Rule', min: 0, max: 8, step: 1, default: 3, visibleWhen: (v) => v.rule === 'custom' },
    { key: 'birthHi', label: 'Birth Upper Bound', type: 'range', group: 'Rule', min: 0, max: 8, step: 1, default: 3, visibleWhen: (v) => v.rule === 'custom' },
    { key: 'surviveLo', label: 'Survive Lower Bound', type: 'range', group: 'Rule', min: 0, max: 8, step: 1, default: 2, visibleWhen: (v) => v.rule === 'custom' },
    { key: 'surviveHi', label: 'Survive Upper Bound', type: 'range', group: 'Rule', min: 0, max: 8, step: 1, default: 3, visibleWhen: (v) => v.rule === 'custom' },
    { key: 'steps', label: 'Steps', type: 'range', group: 'Rule', min: 0, max: 200, step: 1, default: 1 },
    { key: 'animate', label: 'Animate', type: 'toggle', group: 'Motion', default: false },
    { key: 'speed', label: 'Generations / sec', type: 'range', group: 'Motion', min: 1, max: 60, step: 1, default: 12, visibleWhen: (v) => v.animate === true },
    {
      key: 'shape', label: 'Cell Shape', type: 'select', group: 'Color', default: 'square',
      options: [{ value: 'square', label: 'Square' }, { value: 'circle', label: 'Circle' }],
    },
    {
      key: 'colorMode', label: 'Alive Color', type: 'select', group: 'Color', default: 'original',
      options: [{ value: 'original', label: 'Original' }, { value: 'custom', label: 'Custom' }],
    },
    { key: 'alive', label: 'Alive Color', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => v.colorMode === 'custom' },
    { key: 'dead', label: 'Dead Color', type: 'color', group: 'Color', default: '#0b0b0b' },
    { key: 'ghost', label: 'Image Ghost', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 0.12, hint: 'How much of the source shows through dead cells.' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ srcCanvas, ctx, width, height, params, unit, time }) {
    const cell = Math.max(2, (params.cell as number) * unit);
    const { data, cols: w, rows: h } = cellAverages(srcCanvas, width, height, cell);
    const thr = params.threshold as number;
    const inv = params.invertSeed as boolean;
    const { birth, survive } = ruleTables(params);
    const target = Math.min(1500, (params.steps as number) + (params.animate ? Math.floor(time * (params.speed as number)) : 0));

    // Cheap content signature so cached evolution is reused only for the same seed.
    let sig = 0;
    for (let i = 0; i < data.length; i += 4 * 7) sig = (sig * 31 + data[i] + data[i + 1] * 3) | 0;
    const key = JSON.stringify([w, h, thr, inv, params.rule, params.birthLo, params.birthHi, params.surviveLo, params.surviveHi, sig]);

    let grid: Uint8Array;
    let gen: number;
    if (cache && cache.key === key && cache.gen <= target) {
      grid = cache.grid;
      gen = cache.gen;
    } else {
      grid = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const l = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
        grid[i] = (l < thr) !== inv ? 1 : 0;
      }
      gen = 0;
    }
    let next = new Uint8Array(w * h);
    for (; gen < target; gen++) {
      step(grid, next, w, h, birth, survive);
      [grid, next] = [next, grid];
    }
    cache = { key, gen, grid };

    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = params.dead as string;
      ctx.fillRect(0, 0, width, height);
    }
    const ghost = params.ghost as number;
    if (ghost > 0) {
      ctx.globalAlpha = ghost;
      ctx.drawImage(srcCanvas, 0, 0);
      ctx.globalAlpha = 1;
    }
    const original = params.colorMode === 'original';
    const circle = params.shape === 'circle';
    const alive = hexToRgb(params.alive as string);
    ctx.fillStyle = `rgb(${alive[0]},${alive[1]},${alive[2]})`;
    if (!original) ctx.beginPath();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!grid[i]) continue;
        if (original) {
          ctx.fillStyle = `rgb(${data[i * 4]},${data[i * 4 + 1]},${data[i * 4 + 2]})`;
          ctx.beginPath();
        }
        if (circle) {
          ctx.moveTo(x * cell + cell, y * cell + cell / 2);
          ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell / 2, 0, Math.PI * 2);
        } else ctx.rect(x * cell, y * cell, cell + 0.5, cell + 0.5);
        if (original) ctx.fill();
      }
    }
    if (!original) ctx.fill();
  },
};
