import type { EffectDefinition, ParamValues, RenderInput } from '../types';
import { contentOf, withContent } from '../../content/content';
import { boxBlur, createCanvas, createRng, fbm, get2d, hexToRgb, toLuma, valueNoise } from '../../utils/imageProcessing';
import { C, R, S, SEED } from '../generative';

/**
 * Ink that the picture's own movement pours in. Each frame is compared with
 * the last to measure where things moved and which way (Lucas-Kanade flow on a
 * small copy). Ink is stamped there, then carried by a small fluid simulation.
 * The simulation has a fixed grid, so preview size does not change its look.
 */

const LONG = 300;
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
}

let sim: Sim | null = null;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function fresh(w: number, h: number): Sim {
  const k = LONG / Math.max(w, h), gw = Math.max(16, Math.round(w * k)), gh = Math.max(16, Math.round(h * k)), n = gw * gh;
  const tooth = new Float32Array(n);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) tooth[y * gw + x] = fbm(x * 0.09, y * 0.09, 5, 4) - 0.5;
  return {
    tooth, gw, gh, aspect: w / h, prev: null, ink: Array.from({ length: LAYERS }, () => new Float32Array(n)), vx: new Float32Array(n), vy: new Float32Array(n),
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
  } else g.arc(0, 0, r, 0, 6.2832);
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
      for (let i = 0; i < n; i++) if (d[i * 4 + 3] && ink[i] < cap) ink[i] = Math.min(cap, ink[i] + (d[i * 4 + 3] / 255) * k);
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
  for (let l = 0; l < layers; l++) {
    const src = s.ink[l], next = new Float32Array(n), ox = l === 1 ? sep : l === 2 ? -sep * 0.6 : 0, oy = l === 2 ? sep : l === 1 ? -sep * 0.6 : 0;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x, px = x - (vx[i] + s.hx[i] + bx + ox) * dt, py = y - (vy[i] + s.hy[i] + by + oy) * dt;
        const qx = px < 0 ? 0 : px > gw - 1.001 ? gw - 1.001 : px, qy = py < 0 ? 0 : py > gh - 1.001 ? gh - 1.001 : py, x0 = qx | 0, y0 = qy | 0, fx = qx - x0, fy = qy - y0, j = y0 * gw + x0;
        const top = src[j] + (src[j + 1] - src[j]) * fx, bot = src[j + gw] + (src[j + gw + 1] - src[j + gw]) * fx;
        next[i] = (top + (bot - top) * fy) * keep;
      }
    if (bleed > 0) { const b = boxBlur(next, gw, gh, rad, 1); for (let i = 0; i < n; i++) next[i] += (b[i] - next[i]) * bleed; }
    s.ink[l] = next;
  }
  s.steps++;
}

/** Feeds the sim without movement: for stills and shots with none. */
function staticDrive(L: Float32Array, gw: number, gh: number, mode: string) {
  const o = new Float32Array(gw * gh);
  for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
    const i = y * gw + x;
    o[i] = mode === 'bright' ? L[i] ** 2 * 0.6 : mode === 'dark' ? (1 - L[i]) ** 2 * 0.6 : Math.min(1, Math.hypot(L[i + 1] - L[i - 1], L[i + gw] - L[i - gw]) * 5);
  }
  return o;
}

function composite({ src, srcCanvas, ctx, width: w, height: h, params: p, unit }: RenderInput, s: Sim) {
  const { gw, gh } = s, n = gw * gh, layers = p.layers as number, cols = [p.ink1, p.ink2, p.ink3].map((c) => hexToRgb(c as string));
  const edge = p.edge as number, lo = 0.5 * edge * 0.9, hi = Math.max(lo + 0.02, 1.15 - edge * 0.65), strength = p.opacity as number;
  const small = createCanvas(gw, gh), g = get2d(small, true), im = g.createImageData(gw, gh), d = im.data, total = new Float32Array(n), grit = (p.texture as number) * 0.9, pool = p.pooling as number;
  for (let i = 0; i < n; i++) {
    // Painted in order, each colour over the last, with its own wet edge.
    let r = 0, gr = 0, b = 0, cover = 0, sum = 0;
    for (let l = 0; l < layers; l++) {
      const v = s.ink[l][i];
      sum += v;
      if (v <= 0.001) continue;
      const t = clamp01((v + s.tooth[i] * grit * Math.min(1, v * 6) - lo) / (hi - lo)), a = t * t * (3 - 2 * t);
      if (a <= 0) continue;
      // Thin ink is a wash you can see through. Only dense ink goes opaque.
      const wash = 0.2 + 0.8 * Math.min(1, v * v), rim = pool * (1 - Math.abs(a * 2 - 1)), c = cols[l], dark = 1 - rim * 0.55, al = Math.min(1, a * wash + rim * 0.4);
      r = r * (1 - al) + c[0] * dark * al; gr = gr * (1 - al) + c[1] * dark * al; b = b * (1 - al) + c[2] * dark * al;
      cover += al * (1 - cover);
    }
    const q = i * 4;
    if (cover > 0) { d[q] = r / cover; d[q + 1] = gr / cover; d[q + 2] = b / cover; }
    d[q + 3] = cover * 255 * strength;
    total[i] = sum;
  }
  g.putImageData(im, 0, 0);

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
  ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
}

const SIM_KEYS = ['drive', 'stillDrive', 'sensitivity', 'threshold', 'flow', 'strength', 'brush', 'brushSize', 'layers', 'speed', 'direction', 'turbulence', 'swirlSize', 'fade', 'bleed', 'bleedSize', 'separation', 'seed', 'followMotion', 'cMode', 'cIcon', 'cText'];

const base: EffectDefinition = {
  id: 'inkBleed', name: 'Ink Bleed', category: 'distortion',
  description: 'Real movement pours ink into the picture: it follows the motion, spreads, swirls, and fades.',
  animated: () => true,
  audioDefaults: { strength: { band: 'beat', amount: 0.3 } },
  params: [
    S('drive', 'Ink Follows', 'motion', [['motion', 'Movement'], ['edges', 'Edges'], ['bright', 'Bright Areas'], ['dark', 'Dark Areas']], 'Motion'),
    R('sensitivity', 'Motion Sensitivity', 0.5, 30, 0.1, 9, 'Motion', 'How little movement it takes to release ink.'),
    R('threshold', 'Motion Threshold', 0, 1, 0.005, 0.2, 'Motion', 'Movement below this is ignored, such as camera noise.'),
    R('followMotion', 'Follow Motion', 0, 2, 0.01, 1, 'Motion', 'How strongly ink is thrown along the direction things move.'),
    { ...S('stillDrive', 'On A Still Image', 'edges', [['edges', 'Seed From Edges'], ['dark', 'Seed From Dark Areas'], ['bright', 'Seed From Bright Areas'], ['off', 'No Ink']], 'Motion'), hint: 'A photo has no movement to measure, so ink starts from the picture instead.' },
    R('flow', 'Ink Amount', 0.05, 1, 0.01, 0.3, 'Ink'),
    R('strength', 'Ink Strength', 0.05, 2, 0.01, 0.4, 'Ink'),
    R('layers', 'Color Layers', 1, 3, 1, 3, 'Ink'),
    C('ink1', 'Ink 1', '#0b1b8f', 'Ink'),
    C('ink2', 'Ink 2', '#e8195f', 'Ink'),
    C('ink3', 'Ink 3', '#10b8a8', 'Ink'),
    R('separation', 'Layer Separation', 0, 4, 0.01, 0.8, 'Ink', 'Pushes the colours apart as they flow.'),
    S('brush', 'Ink Shape', 'round', [['round', 'Round Drop'], ['splat', 'Splatter'], ['streak', 'Motion Streak'], ['dots', 'Fine Dots'], ['square', 'Square'], ['content', 'Custom Content']], 'Brush'),
    R('brushSize', 'Shape Size', 2, 60, 0.5, 12, 'Brush'),
    R('bleed', 'Bleed Spread', 0, 1, 0.01, 0.4, 'Bleed'),
    R('bleedSize', 'Bleed Radius', 1, 6, 1, 2, 'Bleed'),
    R('edge', 'Edge Hardness', 0, 1, 0.01, 0.55, 'Bleed'),
    R('texture', 'Edge Texture', 0, 1, 0.01, 0.6, 'Bleed', 'Feathers the edges like ink in paper fibres.'),
    R('pooling', 'Wet Edge', 0, 1, 0.01, 0.5, 'Bleed', 'Ink gathers and darkens where it stops.'),
    R('fade', 'Fade Time', 0.2, 30, 0.1, 2.5, 'Bleed', 'Seconds for ink to thin out.'),
    R('direction', 'Direction', 0, 359, 1, 90, 'Flow'),
    R('speed', 'Flow Speed', 0, 3, 0.01, 0.5, 'Flow'),
    R('turbulence', 'Turbulence', 0, 3, 0.01, 0.9, 'Flow'),
    R('swirlSize', 'Swirl Detail', 0.2, 4, 0.01, 1, 'Flow'),
    R('distort', 'Fluid Distortion', 0, 40, 0.1, 8, 'Flow'),
    { key: 'blend', label: 'Ink Blend', type: 'select', group: 'Finish', default: 'source-over', options: [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['lighter', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']].map(([value, label]) => ({ value, label })) },
    R('opacity', 'Ink Opacity', 0, 1, 0.01, 0.9, 'Finish'),
    S('background', 'Background', 'image', [['image', 'Image'], ['paper', 'Paper']], 'Finish'),
    { ...C('paper', 'Paper', '#f5f1e8', 'Finish'), visibleWhen: (v) => v.background === 'paper' },
    SEED('Finish'),
  ],
  presets: [
    { name: 'Motion Ink', values: { drive: 'motion' } },
    { name: 'Sumi On Paper', values: { background: 'paper', layers: 1, ink1: '#0c0c10', blend: 'multiply', bleed: 0.8, edge: 0.2, fade: 12, distort: 0, strength: 1 } },
    { name: 'Neon Trails', values: { ink1: '#c6ff2e', ink2: '#ff2fb0', ink3: '#26d9ff', blend: 'lighter', brush: 'streak', fade: 1.6, followMotion: 1.6 } },
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
      drive = staticDrive(L, s.gw, s.gh, p.stillDrive as string);
      if (s.steps === 0) {
        // Settle first, so a photo shows the look straight away.
        const hold = { ...p, sensitivity: 1, threshold: 0.2, strength: (p.strength as number) * 0.3 };
        for (let i = 0; i < 16; i++) step(s, hold, 1 / 12, drive, null, null, frame + i);
      }
      step(s, { ...p, sensitivity: 1, threshold: 0.2, strength: (p.strength as number) * 0.3 }, dt, drive, null, null, frame);
    } else step(s, p, dt, drive, U, V, frame);
    s.prev = L;
    s.t = time;
    s.frame = frame;
    s.key = key;
    composite(input, s);
  },
};

export const inkBleed = withContent(base);
