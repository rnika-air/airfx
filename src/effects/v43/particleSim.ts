import type { EffectDefinition } from '../types';
import { audioBus } from '../../engine/audio';
import { stagePointer } from '../../engine/interaction';
import { vision } from '../../ai/vision';
import { contentOf, withContent } from '../../content/content';
import { createCanvas, createRng, get2d, hexToRgb, valueNoise } from '../../utils/imageProcessing';
import { C, R, S, T, rgbCss } from '../generative';

/**
 * A particle system. Particles are born from the picture (taking its colours),
 * from movement in a video, or from an emitter, then pushed by a flow field,
 * gravity, turbulence, the pointer or a hand, sound, and a pull back to where
 * they came from. Dissolve releases them a few at a time, so a picture can
 * break apart into dust and gather again.
 */

const MAX = 24000;

interface Sim {
  n: number; x: Float32Array; y: Float32Array; vx: Float32Array; vy: Float32Array; hx: Float32Array; hy: Float32Array;
  r: Uint8Array; g: Uint8Array; b: Uint8Array; size: Float32Array; seed: Float32Array; age: Float32Array; life: Float32Array;
  w: number; h: number; t: number; frame: number; key: string; trail: HTMLCanvasElement | null; prev: Float32Array | null; rng: () => number;
}

let sim: Sim | null = null;

function make(w: number, h: number, key: string, seed: number): Sim {
  const f = () => new Float32Array(MAX), u = () => new Uint8Array(MAX);
  return { n: 0, x: f(), y: f(), vx: f(), vy: f(), hx: f(), hy: f(), r: u(), g: u(), b: u(), size: f(), seed: f(), age: f(), life: f(), w, h, t: -1, frame: -1, key, trail: null, prev: null, rng: createRng(seed) };
}

/** Born from the picture: brighter (or darker) pixels are picked more often, and keep their colour. */
function seedFromImage(s: Sim, src: ImageData, count: number, th: number, invert: boolean) {
  const { width: w, height: h, data: d } = src;
  let tries = 0;
  while (s.n < count && tries < count * 12) {
    tries++;
    const x = s.rng() * w, y = s.rng() * h, q = ((y | 0) * w + (x | 0)) * 4, l = (d[q] * 0.3 + d[q + 1] * 0.59 + d[q + 2] * 0.11) / 255, v = invert ? 1 - l : l;
    if (v < th || s.rng() > 0.25 + v) continue;
    add(s, x, y, 0, 0, d[q], d[q + 1], d[q + 2], Infinity);
  }
}

function add(s: Sim, x: number, y: number, vx: number, vy: number, r: number, g: number, b: number, life: number) {
  if (s.n >= MAX) return;
  const i = s.n++;
  s.x[i] = s.hx[i] = x; s.y[i] = s.hy[i] = y; s.vx[i] = vx; s.vy[i] = vy;
  s.r[i] = r; s.g[i] = g; s.b[i] = b; s.size[i] = 0.5 + s.rng(); s.seed[i] = s.rng(); s.age[i] = 0; s.life[i] = life;
}

const SIM_KEYS = ['source', 'count', 'threshold', 'invertSource', 'seed'];

const base: EffectDefinition = {
  id: 'particleSim', name: 'Particle Simulation', category: 'animate',
  description: 'Particles from the picture, movement or an emitter, moved by flow, gravity, turbulence, the pointer, a hand and sound.',
  animated: () => true,
  supportsTransparency: true,
  audioDefaults: { flow: { band: 'level', amount: 0.25 } },
  params: [
    S('source', 'Particles Come From', 'image', [['image', 'The Picture'], ['motion', 'Movement In Video'], ['emitter', 'An Emitter Point'], ['rain', 'Top Edge (Rain)']], 'Birth'),
    R('count', 'Density', 200, 24000, 100, 7000, 'Birth'),
    { ...R('threshold', 'Pick Pixels Above', 0, 1, 0.01, 0.2, 'Birth'), visibleWhen: (v) => v.source === 'image' },
    { ...T('invertSource', 'Prefer Dark Pixels', false, 'Birth'), visibleWhen: (v) => v.source === 'image' },
    { ...R('emitX', 'Emitter X', 0, 1, 0.005, 0.5, 'Birth'), visibleWhen: (v) => v.source === 'emitter' },
    { ...R('emitY', 'Emitter Y', 0, 1, 0.005, 0.5, 'Birth'), visibleWhen: (v) => v.source === 'emitter' },
    { ...R('rate', 'Birth Rate', 10, 4000, 10, 600, 'Birth', 'Particles per second.'), visibleWhen: (v) => v.source !== 'image' },
    { ...R('life', 'Lifetime', 0.3, 12, 0.1, 4, 'Birth', 'Seconds.'), visibleWhen: (v) => v.source !== 'image' },
    { ...R('dissolve', 'Dissolve', 0, 1, 0.01, 0.6, 'Birth', 'Share of the picture that breaks free.'), visibleWhen: (v) => v.source === 'image' },
    { ...S('dissolveFrom', 'Breaks From', 'noise', [['noise', 'Everywhere'], ['left', 'Left Side'], ['right', 'Right Side'], ['top', 'Top'], ['bottom', 'Bottom']], 'Birth'), visibleWhen: (v) => v.source === 'image' },
    R('speed', 'Speed', 0, 4, 0.01, 1, 'Motion'),
    R('flow', 'Flow Field', 0, 3, 0.01, 1, 'Motion'),
    R('flowScale', 'Flow Detail', 0.1, 4, 0.01, 1, 'Motion'),
    R('gravity', 'Gravity', -2, 2, 0.01, 0, 'Motion'),
    R('gravityAngle', 'Gravity Direction', 0, 359, 1, 90, 'Motion', '°'),
    R('turbulence', 'Turbulence', 0, 3, 0.01, 0.4, 'Motion'),
    R('home', 'Return To Picture', 0, 3, 0.01, 0, 'Motion', 'Pulls particles back to where they were born, so the picture re-forms.'),
    R('drag', 'Drag', 0, 1, 0.01, 0.25, 'Motion'),
    S('edges', 'At The Frame Edge', 'wrap', [['wrap', 'Wrap Around'], ['bounce', 'Bounce'], ['vanish', 'Leave']], 'Motion'),
    T('collide', 'Particles Push Apart', false, 'Motion'),
    S('pointer', 'Pointer', 'repel', [['off', 'Ignore'], ['attract', 'Attracts'], ['repel', 'Repels'], ['swirl', 'Swirls']], 'Interaction'),
    R('pointerForce', 'Pointer Strength', 0, 4, 0.01, 1.4, 'Interaction'),
    R('pointerRadius', 'Pointer Radius', 0.02, 0.6, 0.005, 0.16, 'Interaction'),
    T('useHands', 'Hands Act As Pointers', false, 'Interaction'),
    { key: 'handModel', label: 'Hand Tracking', type: 'custom', editor: 'vision', default: 'hands', group: 'Interaction', visibleWhen: (v) => v.useHands === true },
    T('useMotion', 'Video Movement Pushes Particles', true, 'Interaction'),
    R('audioBurst', 'Sound Bursts', 0, 3, 0.01, 0, 'Interaction', 'Each beat throws particles outward.'),
    S('shape', 'Particle Shape', 'dot', [['dot', 'Dot'], ['square', 'Square'], ['streak', 'Streak'], ['star', 'Sparkle'], ['content', 'Custom Content']], 'Look'),
    R('size', 'Particle Size', 0.3, 20, 0.1, 2.2, 'Look'),
    S('colorMode', 'Color', 'image', [['image', 'From Picture'], ['fixed', 'One Color'], ['speed', 'By Speed']], 'Look'),
    C('color', 'Particle Color', '#f4f8ff', 'Look'),
    { ...C('color2', 'Fast Color', '#7fd6ff', 'Look'), visibleWhen: (v) => v.colorMode === 'speed' },
    R('trails', 'Trails', 0, 0.98, 0.01, 0.6, 'Look'),
    T('additive', 'Glow (Add Light)', true, 'Look'),
    S('background', 'Background', 'dim', [['image', 'Picture'], ['dim', 'Dimmed Picture'], ['color', 'Color'], ['clear', 'Transparent']], 'Look'),
    { ...R('dim', 'Dim Picture', 0, 1, 0.01, 0.75, 'Look'), visibleWhen: (v) => v.background === 'dim' },
    { ...C('bgColor', 'Background Color', '#061033', 'Look'), visibleWhen: (v) => v.background === 'color' },
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Look' },
  ],
  presets: [
    { name: 'Dust Dissolve', values: { source: 'image', dissolve: 0.6, flow: 1.2, trails: 0.75, shape: 'streak', background: 'color', bgColor: '#061033', colorMode: 'fixed', color: '#f4f8ff' } },
    { name: 'Re-Form Picture', values: { source: 'image', dissolve: 1, home: 1.2, flow: 0.6, pointer: 'repel', pointerForce: 2.5, trails: 0.3, background: 'color', bgColor: '#000000' } },
    { name: 'Mouse Magnet', values: { source: 'image', dissolve: 1, pointer: 'attract', pointerForce: 2.5, flow: 0.3, home: 0.4 } },
    { name: 'Flow Field', values: { source: 'emitter', rate: 1500, life: 5, flow: 2.2, flowScale: 0.6, trails: 0.9, colorMode: 'speed', background: 'color', bgColor: '#000000' } },
    { name: 'Rain', values: { source: 'rain', rate: 1800, gravity: 1.4, flow: 0.1, shape: 'streak', colorMode: 'fixed', color: '#cfe8ff', edges: 'vanish', trails: 0.4 } },
    { name: 'Movement Sparks', values: { source: 'motion', rate: 2000, life: 1.5, flow: 0.8, shape: 'star', colorMode: 'image', trails: 0.5 } },
    { name: 'Beat Burst', values: { source: 'image', dissolve: 1, home: 0.9, audioBurst: 2, flow: 0.4 } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const key = SIM_KEYS.map((k) => p[k]).join('|');
    let s = sim;
    const jumped = !s || s.key !== key || Math.abs(s.w - w) > 1 || Math.abs(s.h - h) > 1 || time < s.t - 1e-3 || time - s.t > 1;
    if (jumped) { s = sim = make(w, h, key, p.seed as number); if (p.source === 'image') seedFromImage(s, src, p.count as number, p.threshold as number, p.invertSource as boolean); }
    const S0 = s!, same = S0.t === time && S0.frame === frame, dt = same ? 0 : S0.t < 0 ? 1 / 30 : Math.min(0.1, Math.max(0.001, time - S0.t || 1 / 30));
    S0.t = time; S0.frame = frame;
    const sp = p.speed as number, d = src.data;

    // Motion between frames, measured on a coarse grid.
    let motion: Float32Array | null = null;
    const mg = 64, mh = Math.max(4, Math.round((mg * h) / w));
    if ((p.useMotion || p.source === 'motion') && dt > 0) {
      const c = createCanvas(mg, mh), g = get2d(c, true);
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0, mg, mh);
      const im = g.getImageData(0, 0, mg, mh).data, cur = new Float32Array(mg * mh);
      for (let i = 0; i < cur.length; i++) cur[i] = (im[i * 4] + im[i * 4 + 1] + im[i * 4 + 2]) / 765;
      if (S0.prev) { motion = new Float32Array(cur.length); for (let i = 0; i < cur.length; i++) motion[i] = Math.abs(cur[i] - S0.prev[i]); }
      S0.prev = cur;
    }

    // Births for the continuous sources.
    if (dt > 0 && p.source !== 'image') {
      let born = Math.round((p.rate as number) * dt * (0.8 + S0.rng() * 0.4));
      const life = p.life as number;
      // Drop the oldest when full, so the stream never stops.
      if (S0.n + born > MAX) { const keep = Math.max(0, MAX - born); const off = S0.n - keep; for (const arr of [S0.x, S0.y, S0.vx, S0.vy, S0.hx, S0.hy, S0.size, S0.seed, S0.age, S0.life, S0.r, S0.g, S0.b] as (Float32Array | Uint8Array)[]) arr.copyWithin(0, off, S0.n); S0.n = keep; }
      for (let tries = 0; born > 0 && tries < born * 20; tries++) {
        let x: number, y: number;
        if (p.source === 'emitter') { const a = S0.rng() * 6.2832, r = S0.rng() * 6 * unit; x = (p.emitX as number) * w + Math.cos(a) * r; y = (p.emitY as number) * h + Math.sin(a) * r; }
        else if (p.source === 'rain') { x = S0.rng() * w; y = -2; }
        else {
          x = S0.rng() * w; y = S0.rng() * h;
          const m = motion ? motion[Math.min(mh - 1, ((y / h) * mh) | 0) * mg + Math.min(mg - 1, ((x / w) * mg) | 0)] : 0;
          if (m < 0.04 || S0.rng() > m * 8) continue;
        }
        const q = (Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))) * 4, a = S0.rng() * 6.2832, v = (p.source === 'emitter' ? 90 : 10) * unit * sp;
        add(S0, x, y, Math.cos(a) * v, Math.sin(a) * v, d[q], d[q + 1], d[q + 2], life * (0.6 + S0.rng() * 0.8));
        born--;
      }
    }

    // Forces.
    const sound = audioBus.read(), beat = sound?.bands.beat ?? 0, burst = (p.audioBurst as number) * (beat > 0.6 ? beat : 0) * 900 * unit;
    const flow = (p.flow as number) * 120 * unit * sp, fs = 0.004 * (p.flowScale as number) / unit, grav = (p.gravity as number) * 400 * unit, ga = ((p.gravityAngle as number) * Math.PI) / 180, gx = Math.cos(ga) * grav, gy = Math.sin(ga) * grav;
    const turb = (p.turbulence as number) * 260 * unit * sp, homeK = (p.home as number) * 3, drag = Math.exp(-dt * (0.3 + (p.drag as number) * 4)), seed = p.seed as number;
    const pointers: { x: number; y: number }[] = [];
    if (p.pointer !== 'off' && stagePointer.inside) pointers.push({ x: stagePointer.x * w, y: stagePointer.y * h });
    if (p.useHands && vision.ready('hands') && p.pointer !== 'off') for (const hd of vision.handsIn(srcCanvas as HTMLCanvasElement, `${time}|${frame}|${w}`)) pointers.push({ x: hd.tip.x * w, y: hd.tip.y * h });
    const pr = (p.pointerRadius as number) * Math.max(w, h), pf = (p.pointerForce as number) * 2600 * unit, pmode = p.pointer as string, edges = p.edges as string;
    const dis = p.dissolve as number, from = p.dissolveFrom as string, tt = time * 0.15;
    const isImage = p.source === 'image';
    if (dt > 0) {
      let live = 0;
      for (let i = 0; i < S0.n; i++) {
        S0.age[i] += dt;
        if (S0.age[i] > S0.life[i]) continue;
        let x = S0.x[i], y = S0.y[i], vx = S0.vx[i], vy = S0.vy[i];
        // A particle of the picture stays put until Dissolve releases it.
        let free = 1;
        if (isImage) {
          const hxN = S0.hx[i] / w, hyN = S0.hy[i] / h, at = from === 'left' ? hxN : from === 'right' ? 1 - hxN : from === 'top' ? hyN : from === 'bottom' ? 1 - hyN : S0.seed[i];
          free = at < dis ? 1 : 0;
        }
        if (free) {
          const n1 = valueNoise(x * fs, y * fs + tt, seed), n2 = valueNoise(x * fs + 7.3, y * fs - tt, seed + 3), a = (n1 * 2 + n2) * Math.PI * 2;
          vx += (Math.cos(a) * flow + gx) * dt; vy += (Math.sin(a) * flow + gy) * dt;
          if (turb > 0) { vx += (S0.rng() - 0.5) * turb * dt * 4; vy += (S0.rng() - 0.5) * turb * dt * 4; }
          if (motion) { const m = motion[Math.min(mh - 1, Math.max(0, ((y / h) * mh) | 0)) * mg + Math.min(mg - 1, Math.max(0, ((x / w) * mg) | 0))]; if (m > 0.03) { vx += (S0.rng() - 0.5) * m * 6000 * unit * dt; vy += (S0.rng() - 0.6) * m * 6000 * unit * dt; } }
          for (const q of pointers) {
            const dx = x - q.x, dy = y - q.y, dd = Math.hypot(dx, dy);
            if (dd > pr || dd < 0.5) continue;
            const k = (1 - dd / pr) * pf * dt / dd;
            if (pmode === 'attract') { vx -= dx * k; vy -= dy * k; } else if (pmode === 'repel') { vx += dx * k; vy += dy * k; } else { vx += -dy * k; vy += dx * k; }
          }
          if (burst > 0) { const dx = x - w / 2, dy = y - h / 2, dd = Math.max(1, Math.hypot(dx, dy)); vx += (dx / dd) * burst * dt * 4; vy += (dy / dd) * burst * dt * 4; }
          if (homeK > 0) { vx += (S0.hx[i] - x) * homeK * dt * 4; vy += (S0.hy[i] - y) * homeK * dt * 4; }
          vx *= drag; vy *= drag;
          x += vx * dt; y += vy * dt;
        } else { x = S0.hx[i]; y = S0.hy[i]; vx = vy = 0; }
        if (edges === 'wrap') { if (x < 0) x += w; else if (x >= w) x -= w; if (y < 0) y += h; else if (y >= h) y -= h; }
        else if (edges === 'bounce') { if (x < 0 || x >= w) { vx = -vx * 0.7; x = Math.max(0, Math.min(w - 1, x)); } if (y < 0 || y >= h) { vy = -vy * 0.7; y = Math.max(0, Math.min(h - 1, y)); } }
        else if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
        // Keep the live ones packed at the front.
        if (live !== i) {
          S0.hx[live] = S0.hx[i]; S0.hy[live] = S0.hy[i]; S0.r[live] = S0.r[i]; S0.g[live] = S0.g[i]; S0.b[live] = S0.b[i];
          S0.size[live] = S0.size[i]; S0.seed[live] = S0.seed[i]; S0.age[live] = S0.age[i]; S0.life[live] = S0.life[i];
        }
        S0.x[live] = x; S0.y[live] = y; S0.vx[live] = vx; S0.vy[live] = vy;
        live++;
      }
      S0.n = live;
      if (p.collide) {
        // Neighbours on a coarse grid push each other apart.
        const cell = Math.max(2, (p.size as number) * unit * 3), cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), head = new Int32Array(cols * rows).fill(-1), next = new Int32Array(S0.n);
        for (let i = 0; i < S0.n; i++) { const c = Math.min(rows - 1, Math.max(0, (S0.y[i] / cell) | 0)) * cols + Math.min(cols - 1, Math.max(0, (S0.x[i] / cell) | 0)); next[i] = head[c]; head[c] = i; }
        for (let c = 0; c < head.length; c++) for (let a = head[c]; a >= 0; a = next[a]) for (let b = next[a]; b >= 0; b = next[b]) {
          const dx = S0.x[b] - S0.x[a], dy = S0.y[b] - S0.y[a], dd = Math.hypot(dx, dy);
          if (dd > 0 && dd < cell) { const push = (cell - dd) * 0.5 / dd; S0.x[a] -= dx * push; S0.y[a] -= dy * push; S0.x[b] += dx * push; S0.y[b] += dy * push; }
        }
      }
    }

    // Draw: the trail layer fades a little each frame, then particles go on top.
    if (!S0.trail || S0.trail.width !== w || S0.trail.height !== h) S0.trail = createCanvas(w, h);
    const tg = get2d(S0.trail);
    const tr = p.trails as number;
    if (!same) {
      tg.globalCompositeOperation = 'destination-out';
      tg.fillStyle = `rgba(0,0,0,${1 - tr})`;
      tg.fillRect(0, 0, w, h);
      tg.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
      const shape = p.shape as string, sz = (p.size as number) * unit, cm = p.colorMode as string, c1 = hexToRgb(p.color as string), c2 = hexToRgb(p.color2 as string), stamper = shape === 'content' ? contentOf(p, unit) : null;
      stamper?.begin(tg);
      for (let i = 0; i < S0.n; i++) {
        const x = S0.x[i], y = S0.y[i], spd = Math.hypot(S0.vx[i], S0.vy[i]), fade = S0.life[i] === Infinity ? 1 : Math.min(1, (S0.life[i] - S0.age[i]) * 2, S0.age[i] * 6);
        let col: number[] = [S0.r[i], S0.g[i], S0.b[i]];
        if (cm === 'fixed') col = c1; else if (cm === 'speed') { const k = Math.min(1, spd / (300 * unit)); col = c1.map((v, j) => v + (c2[j] - v) * k); }
        const r = sz * S0.size[i];
        if (stamper) { stamper.stamp(tg, i, x, y, r * 2.4, col, Math.atan2(S0.vy[i], S0.vx[i]), fade); continue; }
        tg.fillStyle = rgbCss(col, fade);
        if (shape === 'square') tg.fillRect(x - r, y - r, r * 2, r * 2);
        else if (shape === 'streak' && spd > 1) {
          const k = Math.min(8, spd * 0.03) * r;
          tg.strokeStyle = rgbCss(col, fade); tg.lineWidth = r; tg.lineCap = 'round';
          tg.beginPath(); tg.moveTo(x, y); tg.lineTo(x - (S0.vx[i] / spd) * k, y - (S0.vy[i] / spd) * k); tg.stroke();
        } else if (shape === 'star') {
          tg.beginPath(); tg.moveTo(x, y - r * 2); tg.lineTo(x + r * 0.4, y - r * 0.4); tg.lineTo(x + r * 2, y); tg.lineTo(x + r * 0.4, y + r * 0.4); tg.lineTo(x, y + r * 2); tg.lineTo(x - r * 0.4, y + r * 0.4); tg.lineTo(x - r * 2, y); tg.lineTo(x - r * 0.4, y - r * 0.4); tg.closePath(); tg.fill();
        } else if (r < 1.2) tg.fillRect(x - r, y - r, r * 2, r * 2);
        else { tg.beginPath(); tg.arc(x, y, r, 0, 6.2832); tg.fill(); }
      }
      stamper?.end(tg);
      tg.globalCompositeOperation = 'source-over';
    }
    const bg = p.background as string;
    if (bg === 'color') { ctx.fillStyle = p.bgColor as string; ctx.fillRect(0, 0, w, h); }
    else if (bg !== 'clear') {
      ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      if (bg === 'dim') { ctx.fillStyle = `rgba(0,0,0,${p.dim})`; ctx.fillRect(0, 0, w, h); }
    }
    ctx.drawImage(S0.trail, 0, 0);
  },
};

export const particleSim = withContent(base);
