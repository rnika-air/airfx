import type { EffectDefinition, ParamValues, RenderInput } from '../types';
import { contentOf, withContent } from '../../content/content';
import { boxBlur, createCanvas, createRng, fbm, get2d, hexToRgb, toLuma, valueNoise } from '../../utils/imageProcessing';
import { C, R, S, SEED } from '../generative';

/**
 * Ink that the picture's own movement pours in. Each frame is compared with
 * the last to measure where things moved and which way (Lucas-Kanade flow on a
 * small copy). Ink is stamped there, then carried by a small fluid simulation.
 * The simulation has a fixed grid, so preview size does not change its look.
 *
 * Ink behaves like ink in paper: fresh ink is wet and keeps creeping outward
 * along the paper's fibres (faster where the paper is more absorbent), then
 * dries and stays. Density turns into colour the way pigment does (thin ink is
 * a see-through wash, dense ink goes solid), the drying front darkens into a
 * rim, and a full-resolution paper grain breaks up the edges.
 */

const LONG = 360;
const LAYERS = 3;
const MAX_STAMPS = 260;

interface Sim {
  gw: number; gh: number; aspect: number;
  prev: Float32Array | null;
  ink: Float32Array[]; vx: Float32Array; vy: Float32Array;
  t: number; frame: number; steps: number; key: string; still: boolean;
  small: HTMLCanvasElement; stamp: HTMLCanvasElement;
  hx: Float32Array; hy: Float32Array;
  /** Fixed fine noise: makes edges feather like ink in paper fibres. */
  tooth: Float32Array;
  /** How readily each spot of paper soaks up ink, from long criss-crossed fibres. */
  absorb: Float32Array;
  /** Wetness: ink only keeps spreading while it is wet. */
  wet: Float32Array;
}

let sim: Sim | null = null;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fresh(w: number, h: number): Sim {
  const k = LONG / Math.max(w, h), gw = Math.max(16, Math.round(w * k)), gh = Math.max(16, Math.round(h * k)), n = gw * gh;
  const tooth = new Float32Array(n);
  const absorb = new Float32Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const i = y * gw + x;
    tooth[i] = fbm(x * 0.09, y * 0.09, 5, 4) - 0.5;
    // Fibres: noise stretched along two crossing directions, plus a slow cloudiness.
    const a = valueNoise((x + y) * 0.035, (x - y) * 0.42, 11), b = valueNoise((x - y) * 0.035, (x + y) * 0.42, 23), c = fbm(x * 0.018, y * 0.018, 3, 5);
    absorb[i] = 0.35 + 1.3 * clamp01(Math.max(a, b) * 0.7 + c * 0.5 - 0.15);
  }
  return {
    tooth, absorb, wet: new Float32Array(n), gw, gh, aspect: w / h, prev: null, ink: Array.from({ length: LAYERS }, () => new Float32Array(n)), vx: new Float32Array(n), vy: new Float32Array(n),
    t: -1, frame: -1, steps: 0, key: '', still: false, small: createCanvas(gw, gh), stamp: createCanvas(gw, gh), hx: new Float32Array(n), hy: new Float32Array(n),
  };
}

function lumaOf(s: Sim, source: CanvasImageSource) {
  const g = get2d(s.small, true);
  g.imageSmoothingQuality = 'medium';
  g.drawImage(source, 0, 0, s.gw, s.gh);
  return boxBlur(toLuma(g.getImageData(0, 0, s.gw, s.gh)), s.gw, s.gh, 1, 1);
}

/** Where the image moved between two frames, and its direction in grid cells. */
function measureFlow(prev: Float32Array, cur: Float32Array, gw: number, gh: number) {
  const n = gw * gh, Ixx = new Float32Array(n), Iyy = new Float32Array(n), Ixy = new Float32Array(n), Ixt = new Float32Array(n), Iyt = new Float32Array(n), M = new Float32Array(n);
  for (let y = 1; y < gh - 1; y++)
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x, ix = (cur[i + 1] - cur[i - 1] + prev[i + 1] - prev[i - 1]) / 4, iy = (cur[i + gw] - cur[i - gw] + prev[i + gw] - prev[i - gw]) / 4, it = cur[i] - prev[i];
      Ixx[i] = ix * ix; Iyy[i] = iy * iy; Ixy[i] = ix * iy; Ixt[i] = ix * it; Iyt[i] = iy * it; M[i] = Math.abs(it);
    }
  const r = 3, a = boxBlur(Ixx, gw, gh, r, 1), b = boxBlur(Ixy, gw, gh, r, 1), d = boxBlur(Iyy, gw, gh, r, 1), e = boxBlur(Ixt, gw, gh, r, 1), f = boxBlur(Iyt, gw, gh, r, 1);
  const U = new Float32Array(n), V = new Float32Array(n), m = boxBlur(M, gw, gh, 1, 1);
  for (let i = 0; i < n; i++) {
    const det = a[i] * d[i] - b[i] * b[i] + 1e-5;
    U[i] = Math.max(-6, Math.min(6, (-d[i] * e[i] + b[i] * f[i]) / det));
    V[i] = Math.max(-6, Math.min(6, (b[i] * e[i] - a[i] * f[i]) / det));
  }
  return { U, V, m };
}

function stampShape(g: CanvasRenderingContext2D, shape: string, x: number, y: number, r: number, angle: number, rng: () => number) {
  g.setTransform(1, 0, 0, 1, x, y);
  g.rotate(angle);
  g.beginPath();
  if (shape === 'streak') g.ellipse(0, 0, r * 2.4, r * 0.5, 0, 0, 6.2832);
  else if (shape === 'square') g.rect(-r, -r, r * 2, r * 2);
  else if (shape === 'splat') {
    for (let i = 0; i < 7; i++) { const a = rng() * 6.2832, d = r * (0.6 + rng() * 1.5), s = r * (0.2 + rng() * 0.5); g.moveTo(Math.cos(a) * d + s, Math.sin(a) * d); g.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, 6.2832); }
    g.moveTo(r * 0.8, 0); g.arc(0, 0, r * 0.8, 0, 6.2832);
  } else if (shape === 'dots') {
    for (let i = 0; i < 5; i++) { const a = rng() * 6.2832, d = r * rng() * 1.8, s = r * 0.3; g.moveTo(Math.cos(a) * d + s, Math.sin(a) * d); g.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, 6.2832); }
  } else {
    // A soft drop: dense in the middle, thinning out, so it soaks in without a hard disc.
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 1.25);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.arc(0, 0, r * 1.25, 0, 6.2832);
    g.fill();
    g.fillStyle = '#fff';
    g.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  g.fill();
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** Runs one step of the simulation: new ink where there is drive, then flow, spread, fade. */
function step(s: Sim, p: ParamValues, dt: number, drive: Float32Array, U: Float32Array | null, V: Float32Array | null, frame: number) {
  const { gw, gh } = s, n = gw * gh, layers = p.layers as number, seed = p.seed as number;
  const rng = createRng(seed * 977 + frame), th = p.threshold as number, sens = p.sensitivity as number, flowGain = (p.followMotion as number) * 60;
  const dir = ((p.direction as number) * Math.PI) / 180, sp = (p.speed as number) * 22, bx = Math.cos(dir) * sp, by = Math.sin(dir) * sp;
  const size = (p.brushSize as number) * 0.3, stamps = (p.flow as number) * 3, g = get2d(s.stamp, true), shape = p.brush as string, stamper = shape === 'content' ? contentOf(p, 0.3) : null;

  // Deposit. One pass of stamps per colour, each from a different random set.
  for (let l = 0; l < layers; l++) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, gw, gh);
    g.fillStyle = '#fff';
    let count = 0;
    for (let tries = 0; tries < 2600 && count < MAX_STAMPS * dt * 24; tries++) {
      const x = (rng() * gw) | 0, y = (rng() * gh) | 0, i = y * gw + x, m = drive[i] * sens;
      // Later colours only appear in patches, so they stay separate instead of mixing to mud.
      const patch = l === 0 ? 1 : Math.min(1, Math.max(0, (valueNoise(x * 0.02 + l * 31 + frame * 0.012, y * 0.02, seed + l) - 0.52) * 6));
      if (m < th || rng() > stamps * Math.min(1, m) * patch) continue;
      count++;
      const u = U ? U[i] : 0, v = U ? V![i] : 0, a = Math.atan2(v, u), r = size * (0.5 + rng() + Math.min(2, m * 2));
      if (stamper) { stamper.begin(g); stamper.stamp(g, count, x, y, r * 2.4, [255, 255, 255], a); stamper.end(g); }
      else stampShape(g, shape, x, y, r, a, rng);
    }
    if (count) {
      // Strength sets how dense ink can get, so the picture can stay visible through it.
      const d = g.getImageData(0, 0, gw, gh).data, ink = s.ink[l], k = Math.min(1, (p.strength as number) * dt * 12), cap = 0.55 + (p.strength as number) * 0.6;
      for (let i = 0; i < n; i++) {
        const al = d[i * 4 + 3];
        if (!al) continue;
        if (ink[i] < cap) ink[i] = Math.min(cap, ink[i] + (al / 255) * k);
        if (s.wet[i] < al / 255) s.wet[i] = al / 255;
      }
    }
  }

  // Velocity: measured motion, the chosen drift, and slow swirls.
  const vx = s.vx, vy = s.vy, drag = Math.exp(-dt * 3), turb = (p.turbulence as number) * 34, ns = 0.022 * (p.swirlSize as number), tt = (frame / 24) * 0.35, cs = 6;
  for (let y = 0; y < gh; y += cs)
    for (let x = 0; x < gw; x += cs) {
      const a = valueNoise(x * ns, y * ns + tt, seed), b = valueNoise((x + 2) * ns, y * ns + tt, seed), c = valueNoise(x * ns, (y + 2) * ns + tt, seed);
      const cu = (c - a) * 4 * turb, cv = -(b - a) * 4 * turb;
      for (let j = y; j < Math.min(gh, y + cs); j++) for (let i = x; i < Math.min(gw, x + cs); i++) { const q = j * gw + i; s.hx[q] = cu; s.hy[q] = cv; }
    }
  for (let i = 0; i < n; i++) {
    vx[i] = vx[i] * drag + (U ? U[i] * flowGain * dt : 0) * 2;
    vy[i] = vy[i] * drag + (V ? V[i] * flowGain * dt : 0) * 2;
  }

  // Carry each colour along the field, a little apart so layers separate.
  const sep = (p.separation as number) * 8, keep = Math.exp(-dt / (p.fade as number)), bleed = clamp01((p.bleed as number) * dt * 7), rad = Math.max(1, Math.round((p.bleedSize as number)));
  // The wet area creeps outward and dries: ink follows the wet front, faster where paper soaks it up.
  const dry = Math.exp(-dt / Math.max(0.05, p.dry as number)), wetB = boxBlur(s.wet, gw, gh, 1, 1), wet = s.wet, absorb = s.absorb;
  for (let i = 0; i < n; i++) { const w = Math.max(wet[i], wetB[i] * 0.94 * Math.min(1.2, absorb[i])); wet[i] = w * dry; }
  for (let l = 0; l < layers; l++) {
    const src = s.ink[l], next = new Float32Array(n), ox = l === 1 ? sep : l === 2 ? -sep * 0.6 : 0, oy = l === 2 ? sep : l === 1 ? -sep * 0.6 : 0;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x, px = x - (vx[i] + s.hx[i] + bx + ox) * dt, py = y - (vy[i] + s.hy[i] + by + oy) * dt;
        const qx = px < 0 ? 0 : px > gw - 1.001 ? gw - 1.001 : px, qy = py < 0 ? 0 : py > gh - 1.001 ? gh - 1.001 : py, x0 = qx | 0, y0 = qy | 0, fx = qx - x0, fy = qy - y0, j = y0 * gw + x0;
        const top = src[j] + (src[j + 1] - src[j]) * fx, bot = src[j + gw] + (src[j + gw + 1] - src[j + gw]) * fx;
        next[i] = (top + (bot - top) * fy) * keep;
      }
    if (bleed > 0) {
      const b = boxBlur(next, gw, gh, rad, 1);
      // Wet ink spreads; dry ink holds, with a trace of slow spread so nothing looks frozen.
      for (let i = 0; i < n; i++) { const k = bleed * absorb[i] * (0.08 + 0.92 * Math.min(1, wet[i] * 1.6)); next[i] += (b[i] - next[i]) * (k > 1 ? 1 : k); }
    }
    s.ink[l] = next;
  }
  s.steps++;
}

/** Feeds the sim without movement: for stills and shots with none. */
function staticDrive(L: Float32Array, gw: number, gh: number, mode: string) {
  const o = new Float32Array(gw * gh);
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const i = y * gw + x;
    o[i] = mode === 'bright' ? L[i] : mode === 'dark' ? 1 - L[i] : Math.hypot(L[i + 1] - L[i - 1], L[i + gw] - L[i - gw]);
  }
  // Measured against the picture itself, so ink starts only from its strongest
  // parts (the darkest, brightest or sharpest few) whatever the exposure.
  const sorted = Float32Array.from(o).sort(), at = (q: number) => sorted[Math.min(sorted.length - 1, (q * sorted.length) | 0)];
  const lo = at(mode === 'edges' ? 0.82 : 0.72), hi = Math.max(lo + 0.02, at(0.985));
  for (let i = 0; i < o.length; i++) { const t = (o[i] - lo) / (hi - lo); o[i] = t <= 0 ? 0 : t >= 1 ? 1 : t; }
  return o;
}

function composite({ src, srcCanvas, ctx, width: w, height: h, params: p, unit }: RenderInput, s: Sim) {
  const { gw, gh } = s, n = gw * gh, layers = p.layers as number, cols = [p.ink1, p.ink2, p.ink3].map((c) => hexToRgb(c as string));
  const edge = p.edge as number, lo = 0.5 * edge * 0.9, hi = Math.max(lo + 0.02, 1.15 - edge * 0.65), strength = p.opacity as number;
  const small = createCanvas(gw, gh), g = get2d(small, true), im = g.createImageData(gw, gh), d = im.data, total = new Float32Array(n), grit = (p.texture as number) * 0.9, pool = p.pooling as number;
  // Each colour's local average: where ink is denser than its surroundings, at
  // the edge of a bloom, pigment piles up into a darker rim (the coffee-ring effect).
  const near = s.ink.slice(0, layers).map((v) => boxBlur(v, gw, gh, 2, 1));
  for (let i = 0; i < n; i++) {
    // Painted in order, each colour over the last, with its own wet edge.
    let r = 0, gr = 0, b = 0, cover = 0, sum = 0;
    for (let l = 0; l < layers; l++) {
      const v = s.ink[l][i];
      sum += v;
      if (v <= 0.001) continue;
      const vv = v + s.tooth[i] * grit * Math.min(1, v * 6), t = clamp01((vv - lo) / (hi - lo));
      // Pigment: soft see-through density (Beer-Lambert), sharpened by Edge Hardness.
      const soft = vv > 0 ? 1 - Math.exp(-vv * 4.2) : 0, a = soft + (t * t * (3 - 2 * t) - soft) * edge;
      if (a <= 0.002) continue;
      // A pale, even interior and a dense rim where the bloom stopped.
      const ridge = clamp01((v - near[l][i]) * 6) * clamp01(v * 3) * clamp01(0.7 + s.tooth[i] * 2.2), c = cols[l], al = clamp01(a * (1 - 0.18 * pool) + ridge * pool * 0.75);
      r = r * (1 - al) + c[0] * al; gr = gr * (1 - al) + c[1] * al; b = b * (1 - al) + c[2] * al;
      cover += al * (1 - cover);
    }
    const q = i * 4;
    if (cover > 0) { d[q] = r / cover; d[q + 1] = gr / cover; d[q + 2] = b / cover; }
    d[q + 3] = cover * 255 * strength;
    total[i] = sum;
  }
  g.putImageData(im, 0, 0);

  // Full size ink layer, with the paper's grain knocked out of it so edges break up
  // like real pigment instead of a blurred blob. Grain is sized in output units, so
  // preview and export match.
  const layer = layerCanvas(w, h), lg = get2d(layer, true);
  lg.globalCompositeOperation = 'copy';
  lg.imageSmoothingQuality = 'high';
  lg.drawImage(small, 0, 0, w, h);
  if (grit > 0.01) {
    const pat = lg.createPattern(grainTile(), 'repeat');
    if (pat) {
      pat.setTransform(new DOMMatrix().scale(Math.max(0.5, unit * 0.9)));
      lg.globalCompositeOperation = 'destination-out';
      lg.globalAlpha = Math.min(1, grit * 0.5);
      lg.fillStyle = pat;
      lg.fillRect(0, 0, w, h);
      lg.globalAlpha = 1;
    }
  }
  lg.globalCompositeOperation = 'source-over';

  // The picture bends around the ink, as a wet surface would.
  const bend = (p.distort as number) * unit;
  if (p.background === 'paper') { ctx.fillStyle = p.paper as string; ctx.fillRect(0, 0, w, h); }
  else if (bend > 0.01) {
    const out = ctx.createImageData(w, h), o = new Uint32Array(out.data.buffer), a = new Uint32Array(src.data.buffer), T0 = boxBlur(total, gw, gh, 2, 1), kx = gw / w, ky = gh / h;
    for (let y = 0; y < h; y++) {
      const gy = Math.min(gh - 2, (y * ky) | 0) , row = gy * gw;
      for (let x = 0; x < w; x++) {
        const gx = Math.min(gw - 2, (x * kx) | 0), i = row + gx, dx = (T0[i + 1] - T0[i]) * bend * 14, dy = (T0[i + gw] - T0[i]) * bend * 14;
        const sx = x + dx, sy = y + dy, X = sx < 0 ? 0 : sx >= w ? w - 1 : sx | 0, Y = sy < 0 ? 0 : sy >= h ? h - 1 : sy | 0;
        o[y * w + x] = a[Y * w + X];
      }
    }
    ctx.putImageData(out, 0, 0);
  } else ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
  if (p.background === 'wash') {
    // The picture printed faintly onto the paper, so the ink reads on top of it.
    ctx.globalAlpha = 1 - (p.washImage as number);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = p.paper as string;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
}

let layerC: HTMLCanvasElement | null = null;
function layerCanvas(w: number, h: number) {
  if (!layerC) layerC = createCanvas(w, h);
  if (layerC.width !== w) layerC.width = w;
  if (layerC.height !== h) layerC.height = h;
  return layerC;
}

/** Paper tooth: fine speckle and short fibres, as alpha (what the paper keeps clear of ink). */
let grain: HTMLCanvasElement | null = null;
function grainTile() {
  if (grain) return grain;
  const N = 256, c = createCanvas(N, N), g = get2d(c, true), im = g.createImageData(N, N), d = im.data, rng = createRng(4242);
  // Tileable lattice noise: random values on wrapping grids, smoothly interpolated.
  const octave = (cells: number) => {
    const v = Float32Array.from({ length: cells * cells }, rng), k = cells / N, o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const gx = x * k, gy = y * k, x0 = gx | 0, y0 = gy | 0, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      let fx = gx - x0, fy = gy - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = v[y0 * cells + x0] + (v[y0 * cells + x1] - v[y0 * cells + x0]) * fx, b = v[y1 * cells + x0] + (v[y1 * cells + x1] - v[y1 * cells + x0]) * fx;
      o[y * N + x] = a + (b - a) * fy;
    }
    return o;
  };
  const o1 = octave(8), o2 = octave(32), o3 = octave(64);
  for (let i = 0; i < N * N; i++) {
    const fine = o1[i] * 0.35 + o2[i] * 0.4 + o3[i] * 0.25;
    d[i * 4 + 3] = clamp01((fine - 0.5) * 2.6) * 200;
  }
  g.putImageData(im, 0, 0);
  return (grain = c);
}

const SIM_KEYS = ['drive', 'stillDrive', 'sensitivity', 'threshold', 'flow', 'strength', 'brush', 'brushSize', 'layers', 'speed', 'direction', 'turbulence', 'swirlSize', 'fade', 'dry', 'bleed', 'bleedSize', 'separation', 'seed', 'followMotion', 'cMode', 'cIcon', 'cText'];

const base: EffectDefinition = {
  id: 'inkBleed', name: 'Ink Bleed', category: 'distortion',
  description: 'Real movement pours ink into the picture: it follows the motion, spreads, swirls, and fades.',
  animated: () => true,
  audioDefaults: { strength: { band: 'beat', amount: 0.3 } },
  params: [
    S('drive', 'Ink Follows', 'motion', [['motion', 'Movement'], ['edges', 'Edges'], ['bright', 'Bright Areas'], ['dark', 'Dark Areas']], 'Motion'),
    { ...R('sensitivity', 'Motion Sensitivity', 0.5, 30, 0.1, 9, 'Motion', 'How little movement it takes to release ink (video).'), visibleWhen: (v) => v.drive === 'motion' },
    { ...R('threshold', 'Motion Threshold', 0, 1, 0.005, 0.2, 'Motion', 'Movement below this is ignored, such as camera noise (video).'), visibleWhen: (v) => v.drive === 'motion' },
    { ...R('followMotion', 'Follow Motion', 0, 2, 0.01, 1, 'Motion', 'How strongly ink is thrown along the direction things move (video).'), visibleWhen: (v) => v.drive === 'motion' },
    { ...S('stillDrive', 'On A Still Image', 'edges', [['edges', 'Seed From Edges'], ['dark', 'Seed From Dark Areas'], ['bright', 'Seed From Bright Areas'], ['off', 'No Ink']], 'Motion'), hint: 'A photo has no movement to measure, so ink starts from the picture instead.' },
    R('flow', 'Ink Amount', 0.05, 1, 0.01, 0.3, 'Ink'),
    R('strength', 'Ink Strength', 0.05, 2, 0.01, 0.7, 'Ink'),
    R('layers', 'Color Layers', 1, 3, 1, 1, 'Ink'),
    // Real ink colours to start from; any colour can be picked.
    C('ink1', 'Ink 1', '#0e0d0c', 'Ink'),
    { ...C('ink2', 'Ink 2', '#1b2a4a', 'Ink'), visibleWhen: (v) => (v.layers as number) >= 2 },
    { ...C('ink3', 'Ink 3', '#6b1d1a', 'Ink'), visibleWhen: (v) => (v.layers as number) >= 3 },
    { ...R('separation', 'Layer Separation', 0, 4, 0.01, 0.8, 'Ink', 'Pushes the colours apart as they flow.'), visibleWhen: (v) => (v.layers as number) >= 2 },
    S('brush', 'Ink Shape', 'round', [['round', 'Round Drop'], ['splat', 'Splatter'], ['streak', 'Motion Streak'], ['dots', 'Fine Dots'], ['square', 'Square'], ['content', 'Custom Content']], 'Brush'),
    R('brushSize', 'Shape Size', 2, 60, 0.5, 12, 'Brush'),
    R('bleed', 'Bleed Spread', 0, 1, 0.01, 0.6, 'Bleed'),
    R('dry', 'Dry Time', 0.1, 10, 0.05, 1.8, 'Bleed', 'Seconds fresh ink keeps creeping into the paper before it dries.'),
    R('bleedSize', 'Bleed Radius', 1, 6, 1, 3, 'Bleed'),
    R('edge', 'Edge Hardness', 0, 1, 0.01, 0.3, 'Bleed'),
    R('texture', 'Edge Texture', 0, 1, 0.01, 0.6, 'Bleed', 'Feathers the edges like ink in paper fibres.'),
    R('pooling', 'Wet Edge', 0, 1, 0.01, 0.5, 'Bleed', 'Ink gathers and darkens where it stops.'),
    R('fade', 'Fade Time', 0.2, 30, 0.1, 6, 'Bleed', 'Seconds for ink to thin out.'),
    R('direction', 'Direction', 0, 359, 1, 90, 'Flow'),
    R('speed', 'Flow Speed', 0, 3, 0.01, 0.25, 'Flow'),
    R('turbulence', 'Turbulence', 0, 3, 0.01, 0.6, 'Flow'),
    R('swirlSize', 'Swirl Detail', 0.2, 4, 0.01, 1, 'Flow'),
    R('distort', 'Fluid Distortion', 0, 40, 0.1, 2, 'Flow'),
    { key: 'blend', label: 'Ink Blend', type: 'select', group: 'Finish', default: 'multiply', options: [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['lighter', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']].map(([value, label]) => ({ value, label })) },
    R('opacity', 'Ink Opacity', 0, 1, 0.01, 0.9, 'Finish'),
    S('background', 'Background', 'wash', [['wash', 'Image On Paper'], ['image', 'Image'], ['paper', 'Paper Only']], 'Finish'),
    { ...R('washImage', 'Image Strength', 0, 1, 0.01, 0.55, 'Finish', 'How strongly the picture shows through the paper.'), visibleWhen: (v) => v.background === 'wash' },
    { ...C('paper', 'Paper', '#f3eee2', 'Finish'), visibleWhen: (v) => v.background !== 'image' },
    SEED('Finish'),
  ],
  presets: [
    { name: 'Black Ink', values: { layers: 1, ink1: '#0e0d0c', blend: 'multiply' } },
    { name: 'Deep Navy', values: { layers: 1, ink1: '#14213d', blend: 'multiply' } },
    { name: 'Dark Blue', values: { layers: 1, ink1: '#0f2f73', blend: 'multiply' } },
    { name: 'Dark Red', values: { layers: 1, ink1: '#6b1414', blend: 'multiply' } },
    { name: 'Sepia', values: { layers: 1, ink1: '#5a3a1e', blend: 'multiply' } },
    { name: 'Sumi On Paper', values: { background: 'paper', layers: 1, ink1: '#0c0c10', blend: 'multiply', bleed: 0.8, dry: 4, edge: 0.2, fade: 14, distort: 0, strength: 1 } },
    { name: 'Navy + Red', values: { layers: 2, ink1: '#14213d', ink2: '#6b1414', blend: 'multiply' } },
    { name: 'Neon Trails', values: { layers: 3, ink1: '#c6ff2e', ink2: '#ff2fb0', ink3: '#26d9ff', blend: 'lighter', brush: 'streak', fade: 1.6, followMotion: 1.6, edge: 0.55 } },
    { name: 'Long Bleed', values: { fade: 18, bleed: 0.9, turbulence: 1.8, speed: 0.2, edge: 0.3 } },
    { name: 'Splatter', values: { brush: 'splat', brushSize: 20, edge: 0.8, fade: 6, bleed: 0.1, turbulence: 0.3 } },
  ],
  render(input) {
    const { srcCanvas, width: w, height: h, params: p, time, frame } = input;
    const source = srcCanvas as HTMLCanvasElement;
    if (!sim || Math.abs(sim.aspect - w / h) > 0.01) sim = fresh(w, h);
    let s = sim;
    const same = s.t === time && s.frame === frame, key = SIM_KEYS.map((k) => p[k]).join('|');
    if (same && s.key === key) { composite(input, s); return; }
    if (same && !s.still) { s.key = key; composite(input, s); return; } // a paused video: new settings apply when it plays
    // A seek breaks the frame-to-frame comparison, so start clean.
    const jumped = s.t >= 0 && (time < s.t - 1e-3 || time - s.t > 0.6);
    if (jumped || (same && s.still)) { s = sim = fresh(w, h); }
    const L = lumaOf(s, source), dt = s.t < 0 ? 1 / 24 : Math.min(1 / 8, Math.max(1 / 120, time - s.t || 1 / 24));
    let U: Float32Array | null = null, V: Float32Array | null = null, drive: Float32Array;
    let moved = 0;
    if (s.prev && p.drive === 'motion') {
      const f = measureFlow(s.prev, L, s.gw, s.gh);
      U = f.U; V = f.V; drive = f.m;
      for (let i = 0; i < drive.length; i += 7) moved += drive[i];
      moved /= drive.length / 7;
    } else drive = p.drive === 'motion' ? new Float32Array(L.length) : staticDrive(L, s.gw, s.gh, p.drive as string);
    // Exactly equal frames are a photo, or the first frame of a clip.
    s.still = moved === 0 && p.drive === 'motion';
    if (s.still && p.stillDrive !== 'off') {
      const base = staticDrive(L, s.gw, s.gh, p.stillDrive as string), { gw, gh } = s, seed = p.seed as number;
      // On a still, ink keeps arriving in slow drifting patches, so it visibly
      // blooms, spreads and dries instead of sitting frozen.
      const live = (t: number) => {
        const o = new Float32Array(base.length);
        for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
          const i = y * gw + x;
          if (!base[i]) continue;
          const m = (valueNoise(x * 0.018 + 50, y * 0.018 + t * 0.22, seed + 9) - 0.32) * 2.6;
          o[i] = base[i] * (0.25 + 0.75 * (m < 0 ? 0 : m > 1 ? 1 : m));
        }
        return o;
      };
      const still = { ...p, sensitivity: 1, threshold: 0.12, strength: (p.strength as number) * 0.6 };
      if (s.steps === 0) {
        // Settle first, so a photo shows the look straight away.
        for (let i = 0; i < 20; i++) step(s, still, 1 / 12, live(time - (20 - i) / 12), null, null, frame + i);
      }
      drive = live(time);
      step(s, still, dt, drive, null, null, frame);
    } else step(s, p, dt, drive, U, V, frame);
    s.prev = L;
    s.t = time;
    s.frame = frame;
    s.key = key;
    composite(input, s);
  },
};

export const inkBleed = withContent(base, { when: (v) => v.brush === 'content' });
