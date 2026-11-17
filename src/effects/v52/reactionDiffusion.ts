import type { EffectDefinition, ParamValues } from '../types';
import { createCanvas, get2d, hash2, hexToRgb } from '../../utils/imageProcessing';
import { C, R, S, SEED, T } from '../generative';

/**
 * Reaction Diffusion: two simulated chemicals (Gray-Scott model) spread and
 * react on a grid, growing Turing patterns: spots, stripes, mazes, coral.
 * The picture guides it: its tones change the feed and kill rates locally,
 * so the pattern follows the subject, and the pattern can follow the
 * direction of the picture's edges.
 *
 * The grid has a fixed size, whatever the preview or export size, and the
 * simulation is advanced by time (steps per second), so the export grows
 * exactly as the preview did.
 */

const PATTERNS: Record<string, [number, number]> = {
  spots: [0.035, 0.065],
  leopard: [0.0367, 0.0649],
  maze: [0.029, 0.057],
  coral: [0.0545, 0.062],
  worms: [0.078, 0.061],
  holes: [0.039, 0.058],
  waves: [0.014, 0.045],
};

interface Sim {
  key: string; gw: number; gh: number; a: Float32Array; b: Float32Array; a2: Float32Array; b2: Float32Array;
  F: Float32Array; K: Float32Array; wx: Float32Array; wy: Float32Array;
  steps: number; t: number;
}
let sim: Sim | null = null;

/** Picture tones on the simulation grid. */
function gridLuma(source: CanvasImageSource, gw: number, gh: number) {
  const c = createCanvas(gw, gh), g = get2d(c, true);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, gw, gh);
  const d = g.getImageData(0, 0, gw, gh).data, L = new Float32Array(gw * gh);
  for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  c.width = c.height = 1;
  return L;
}

/** Per-cell feed/kill from the picture, and diffusion weights along its edges. */
function guide(s: Sim, L: Float32Array, p: ParamValues) {
  const [f0, k0] = p.pattern === 'custom' ? [p.feed as number, p.kill as number] : PATTERNS[p.pattern as string] ?? PATTERNS.maze;
  const gd = p.guide as number, inv = p.invertGuide ? -1 : 1, an = p.aniso as number, dir = p.flow as string, ang = ((p.angle as number) * Math.PI) / 180;
  const { gw, gh } = s;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x, t = (L[i] - 0.5) * inv;
      // Darker (or lighter) areas get a slightly richer feed, kept inside the
      // pattern's own regime so it changes character there but never dies out.
      s.F[i] = Math.max(0.005, f0 - t * gd * 0.009);
      s.K[i] = Math.max(0.03, k0 + t * gd * 0.0015);
      let th = ang;
      if (dir === 'edges' && x > 0 && y > 0 && x < gw - 1 && y < gh - 1) {
        const gx = L[i + 1] - L[i - 1], gy = L[i + gw] - L[i - gw];
        if (Math.abs(gx) + Math.abs(gy) > 0.01) th = Math.atan2(gy, gx) + Math.PI / 2; // along the edge
      }
      const c2 = Math.cos(th) ** 2, w = dir === 'none' ? 0 : an;
      s.wx[i] = 1 + w * (c2 * 2 - 1);
      s.wy[i] = 1 - w * (c2 * 2 - 1);
    }
}

function seed(s: Sim, L: Float32Array, p: ParamValues) {
  const sd = p.seed as number, dens = p.seedDensity as number;
  s.a.fill(1); s.b.fill(0);
  for (let y = 0; y < s.gh; y++)
    for (let x = 0; x < s.gw; x++) {
      const i = y * s.gw + x, dark = p.invertGuide ? L[i] : 1 - L[i];
      // Small seeds, more of them where the picture is darker (or lighter, inverted).
      if (hash2(x >> 1, y >> 1, sd) < dens * (0.25 + dark * 0.75) * 0.08) { s.b[i] = 1; s.a[i] = 0.5; }
    }
  s.steps = 0;
}

/**
 * One Gray-Scott step with a 9-point Laplacian (0.2 per side, stretched along
 * the chosen direction, 0.05 per corner; the side weights always sum to 0.8,
 * so the centre weight is 1) and wrap-around edges. The inner cells run
 * without any edge checks; this is the hot loop of the effect.
 */
function step(s: Sim) {
  const { gw, gh, a, b, a2, b2, F, K, wx, wy } = s;
  const cell = (i: number, l: number, r: number, u: number, d: number, ul: number, ur: number, dl: number, dr: number) => {
    const hx = wx[i] * 0.2, vy = wy[i] * 0.2, A = a[i], Bv = b[i];
    const lapA = hx * (a[l] + a[r]) + vy * (a[u] + a[d]) + 0.05 * (a[ul] + a[ur] + a[dl] + a[dr]) - A;
    const lapB = hx * (b[l] + b[r]) + vy * (b[u] + b[d]) + 0.05 * (b[ul] + b[ur] + b[dl] + b[dr]) - Bv;
    const abb = A * Bv * Bv, f = F[i];
    const na = A + lapA - abb + f * (1 - A), nb = Bv + 0.5 * lapB + abb - (K[i] + f) * Bv;
    a2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
    b2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
  };
  for (let y = 0; y < gh; y++) {
    const row = y * gw, up = (y === 0 ? gh - 1 : y - 1) * gw, dn = (y === gh - 1 ? 0 : y + 1) * gw, edge = y === 0 || y === gh - 1;
    // Edge columns (and rows) wrap around.
    for (const x of [0, gw - 1]) {
      const l = x === 0 ? gw - 1 : x - 1, r = x === gw - 1 ? 0 : x + 1;
      cell(row + x, row + l, row + r, up + x, dn + x, up + l, up + r, dn + l, dn + r);
    }
    if (edge) {
      for (let x = 1; x < gw - 1; x++) cell(row + x, row + x - 1, row + x + 1, up + x, dn + x, up + x - 1, up + x + 1, dn + x - 1, dn + x + 1);
      continue;
    }
    for (let i = row + 1, end = row + gw - 1; i < end; i++) {
      const hx = wx[i] * 0.2, vy = wy[i] * 0.2, A = a[i], Bv = b[i], u = i - gw, d = i + gw;
      const lapA = hx * (a[i - 1] + a[i + 1]) + vy * (a[u] + a[d]) + 0.05 * (a[u - 1] + a[u + 1] + a[d - 1] + a[d + 1]) - A;
      const lapB = hx * (b[i - 1] + b[i + 1]) + vy * (b[u] + b[d]) + 0.05 * (b[u - 1] + b[u + 1] + b[d - 1] + b[d + 1]) - Bv;
      const abb = A * Bv * Bv, f = F[i];
      const na = A + lapA - abb + f * (1 - A), nb = Bv + 0.5 * lapB + abb - (K[i] + f) * Bv;
      a2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
      b2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
    }
  }
  s.a = a2; s.a2 = a; s.b = b2; s.b2 = b;
  s.steps++;
}

const SIM_KEYS = ['pattern', 'feed', 'kill', 'detail', 'guide', 'invertGuide', 'aniso', 'flow', 'angle', 'seed', 'seedDensity', 'warmup', 'growth'];

export const reactionDiffusion: EffectDefinition = {
  id: 'reactionDiffusion', name: 'Reaction Diffusion', category: 'pattern',
  description: 'Grows living Turing patterns (spots, mazes, coral, mycelium) that follow the picture’s tones and edges. A real chemical simulation, grown over time.',
  animated: (p) => (p.growth as number) > 0,
  params: [
    S('pattern', 'Pattern', 'maze', [['spots', 'Spots'], ['leopard', 'Leopard'], ['maze', 'Maze / Fingerprint'], ['coral', 'Coral'], ['worms', 'Worms'], ['holes', 'Holes'], ['waves', 'Waves'], ['custom', 'Custom Feed & Kill']], 'Pattern'),
    { ...R('feed', 'Feed Rate', 0.005, 0.1, 0.0005, 0.037, 'Pattern'), visibleWhen: (v) => v.pattern === 'custom' },
    { ...R('kill', 'Kill Rate', 0.03, 0.075, 0.0005, 0.06, 'Pattern'), visibleWhen: (v) => v.pattern === 'custom' },
    R('detail', 'Pattern Scale', 100, 400, 10, 170, 'Pattern', 'Grid size: higher gives finer, smaller cells (and takes longer to grow).'),
    R('guide', 'Follow Picture', 0, 1.5, 0.01, 0.8, 'Pattern', 'How strongly the picture’s tones change the pattern.'),
    T('invertGuide', 'Grow In Light Areas', false, 'Pattern'),
    S('flow', 'Direction', 'none', [['none', 'Even'], ['angle', 'Fixed Angle'], ['edges', 'Along Edges']], 'Pattern'),
    { ...R('aniso', 'Direction Strength', 0, 0.9, 0.01, 0.5, 'Pattern'), visibleWhen: (v) => v.flow !== 'none' },
    { ...R('angle', 'Angle', 0, 180, 1, 30, 'Pattern'), visibleWhen: (v) => v.flow === 'angle' },
    R('seedDensity', 'Seed Density', 0.1, 1, 0.01, 0.5, 'Growth'),
    R('warmup', 'Start Grown', 0, 3000, 50, 900, 'Growth', 'Steps run before the first frame: 0 shows it grow from seeds.'),
    R('growth', 'Growth Speed', 0, 1200, 10, 200, 'Growth', 'Steps per second while playing. 0 keeps it still.'),
    SEED('Growth'),

    S('look', 'Look', 'ink', [['ink', 'Two Inks'], ['image', 'Picture Colors'], ['relief', 'Embossed Relief'], ['overlay', 'Over The Picture']], 'Look'),
    { ...C('c1', 'Ground', '#f2eee4', 'Look'), visibleWhen: (v) => v.look === 'ink' || v.look === 'relief' },
    { ...C('c2', 'Pattern', '#14110f', 'Look'), visibleWhen: (v) => v.look === 'ink' || v.look === 'relief' || v.look === 'overlay' },
    R('sharp', 'Edge Sharpness', 0.5, 8, 0.1, 3.5, 'Look'),
    R('level', 'Thickness', 0.05, 0.45, 0.005, 0.2, 'Look'),
    { ...R('light', 'Relief Light', 0, 2, 0.01, 1, 'Look'), visibleWhen: (v) => v.look === 'relief' },
    R('mix', 'Mix', 0, 1, 0.01, 1, 'Look'),
  ],
  presets: [
    { name: 'Fingerprint Maze', values: { pattern: 'maze', look: 'ink' } },
    { name: 'Cheetah Spots', values: { pattern: 'spots', look: 'image', guide: 0.6, detail: 220 } },
    { name: 'Coral Relief', values: { pattern: 'coral', look: 'relief', c1: '#b8572b', c2: '#3b1406', light: 1.2 } },
    { name: 'Mycelium Network', values: { pattern: 'coral', look: 'ink', c1: '#0a0a0a', c2: '#e8f2d0', level: 0.3, sharp: 5, detail: 220 } },
    { name: 'Edge Flow', values: { pattern: 'maze', flow: 'edges', aniso: 0.7, look: 'overlay', c2: '#ff3b1f' } },
    { name: 'Grow From Seeds', values: { warmup: 0, growth: 400, pattern: 'coral' } },
  ],
  render({ srcCanvas, src, ctx, width: w, height: h, params: p, time }) {
    const long = p.detail as number, k = long / Math.max(w, h), gw = Math.max(24, Math.round(w * k)), gh = Math.max(24, Math.round(h * k)), n = gw * gh;
    const key = SIM_KEYS.map((q) => p[q]).join('|') + `|${gw}x${gh}`;
    const L = gridLuma(srcCanvas, gw, gh);
    if (!sim || sim.key !== key) {
      sim = { key, gw, gh, a: new Float32Array(n), b: new Float32Array(n), a2: new Float32Array(n), b2: new Float32Array(n), F: new Float32Array(n), K: new Float32Array(n), wx: new Float32Array(n), wy: new Float32Array(n), steps: 0, t: -1 };
    }
    const s = sim;
    guide(s, L, p);
    // Steps due at this moment: the head start, then a fixed number per second.
    const due = Math.round((p.warmup as number) + Math.max(0, time) * (p.growth as number));
    if (s.t < 0 || due < s.steps || time < s.t - 1e-6) { seed(s, L, p); }
    // A long jump forward (a seek) is caught up, within a budget per frame.
    const todo = Math.min(due - s.steps, 3200);
    for (let i = 0; i < todo; i++) step(s);
    s.t = time;

    // Draw: the second chemical's concentration, softly thresholded, smoothly upscaled.
    const look = p.look as string, lvl = p.level as number, sh = p.sharp as number, c1 = hexToRgb(p.c1 as string), c2 = hexToRgb(p.c2 as string);
    const small = createCanvas(gw, gh), g = get2d(small, true), im = g.createImageData(gw, gh), d = im.data;
    const gd = (p.guide as number) * (p.invertGuide ? -1 : 1);
    for (let i = 0; i < n; i++) {
      // The picture also sets how thick the pattern is drawn: heavier in its darker areas.
      const v = Math.min(1, Math.max(0, (s.b[i] - lvl + (0.5 - L[i]) * gd * 0.12) * sh * 6 + 0.5));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v * 255; d[i * 4 + 3] = 255;
      if (look === 'relief' && i % gw > 0 && i >= gw) {
        // Height = pattern; light from the top left.
        const sl = ((s.b[i] - s.b[i - 1]) + (s.b[i] - s.b[i - gw])) * 6 * (p.light as number);
        d[i * 4 + 1] = Math.min(255, Math.max(0, 128 + sl * 128));
      }
    }
    g.putImageData(im, 0, 0);
    const big = createCanvas(w, h), bg = get2d(big, true);
    bg.imageSmoothingQuality = 'high';
    bg.drawImage(small, 0, 0, w, h);
    const P = bg.getImageData(0, 0, w, h).data, sd = src.data, out = ctx.createImageData(w, h), o = out.data, mix = p.mix as number;
    for (let i = 0; i < w * h; i++) {
      const q = i * 4, v = P[q] / 255;
      let r: number, gg: number, bb: number;
      // Picture Colors: the pattern is printed as dark ink into the picture's own colours.
      if (look === 'image') { const k2 = 1.08 - v * 0.82; r = sd[q] * k2; gg = sd[q + 1] * k2; bb = sd[q + 2] * k2; }
      else if (look === 'overlay') { r = sd[q] + (c2[0] - sd[q]) * v; gg = sd[q + 1] + (c2[1] - sd[q + 1]) * v; bb = sd[q + 2] + (c2[2] - sd[q + 2]) * v; }
      else {
        r = c1[0] + (c2[0] - c1[0]) * v; gg = c1[1] + (c2[1] - c1[1]) * v; bb = c1[2] + (c2[2] - c1[2]) * v;
        if (look === 'relief') { const l = (P[q + 1] - 128) / 128; r += l * 90; gg += l * 90; bb += l * 90; }
      }
      if (mix < 1) { r = sd[q] + (r - sd[q]) * mix; gg = sd[q + 1] + (gg - sd[q + 1]) * mix; bb = sd[q + 2] + (bb - sd[q + 2]) * mix; }
      o[q] = r; o[q + 1] = gg; o[q + 2] = bb; o[q + 3] = 255;
    }
    small.width = small.height = big.width = big.height = 1;
    ctx.putImageData(out, 0, 0);
  },
};
