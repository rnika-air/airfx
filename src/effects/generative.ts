import type { EffectDefinition, ParamDef, ParamValues } from './types';
import { boxBlur, clamp255, createRng, fbm, hexToRgb, toLuma } from '../utils/imageProcessing';
import { contentOf, withContent } from '../content/content';
import { editedDepth } from './airDepth';

/** Generative patterns driven by the image underneath. Original implementations. */

export const R = (key: string, label: string, min: number, max: number, step: number, def: number, group?: string, hint?: string): ParamDef => ({ key, label, type: 'range', min, max, step, default: def, group, hint });
export const C = (key: string, label: string, def: string, group = 'Color'): ParamDef => ({ key, label, type: 'color', default: def, group });
export const S = (key: string, label: string, def: string, options: [string, string][], group?: string): ParamDef => ({ key, label, type: 'select', default: def, group, options: options.map(([value, l]) => ({ value, label: l })) });
export const T = (key: string, label: string, def: boolean, group?: string): ParamDef => ({ key, label, type: 'toggle', default: def, group });
export const SEED = (group?: string): ParamDef => ({ key: 'seed', label: 'Seed', type: 'seed', default: 7, group });

export const rgbCss = (c: number[], a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Field that decides where things go: 'light', 'dark' or 'edges'. */
export function driveField(src: ImageData, drive: string, unit: number) {
  const { width: w, height: h } = src, L = boxBlur(toLuma(src), w, h, Math.max(1, unit), 1);
  if (drive === 'dark') return L.map((v) => 1 - v);
  if (drive === 'edges') {
    const o = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; o[i] = Math.min(1, Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]) * 5 * (unit / 1.08)); }
    return o;
  }
  return L;
}

const px = (s: ImageData, x: number, y: number) => {
  const i = (Math.min(s.height - 1, Math.max(0, y | 0)) * s.width + Math.min(s.width - 1, Math.max(0, x | 0))) * 4;
  return [s.data[i], s.data[i + 1], s.data[i + 2]];
};

function ground(ctx: CanvasRenderingContext2D, src: ImageData, w: number, h: number, bg: string, keep: number) {
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (keep > 0) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d')!.putImageData(src, 0, 0);
    ctx.globalAlpha = keep;
    ctx.drawImage(c, 0, 0);
    ctx.globalAlpha = 1;
    c.width = c.height = 1;
  }
}

export const nodeNetwork: EffectDefinition = withContent({
  id: 'nodeNetwork',
  name: 'Node Network',
  category: 'pattern',
  description: 'Scatters points where the image says, then links close neighbours into a web.',
  animated: (p) => (p.turbulence as number) > 0,
  params: [
    R('count', 'Node Count', 50, 3000, 10, 700, 'Network'),
    R('reach', 'Link Distance', 4, 160, 1, 42, 'Network', 'How far apart two nodes can be and still link.'),
    R('maxLinks', 'Links Per Node', 1, 12, 1, 5, 'Network'),
    S('drive', 'Nodes Follow', 'light', [['light', 'Highlights'], ['dark', 'Shadows'], ['edges', 'Edges']], 'Network'),
    R('turbulence', 'Turbulence', 0, 40, 0.5, 0, 'Network', 'Animates the nodes.'),
    SEED('Network'),
    R('line', 'Line Width', 0.2, 6, 0.1, 1, 'Style'),
    R('dot', 'Node Size', 0, 10, 0.1, 2, 'Style'),
    S('color', 'Color Mode', 'gradient', [['fixed', 'Fixed'], ['image', 'From Image'], ['gradient', 'Gradient By Distance']], 'Style'),
    C('colA', 'Color A', '#36e0ff', 'Style'),
    C('colB', 'Color B', '#1a3dff', 'Style'),
    C('bg', 'Background', '#050608', 'Style'),
    R('keep', 'Original Opacity', 0, 1, 0.01, 0.12, 'Style'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    ground(ctx, src, w, h, p.bg as string, p.keep as number);
    const F = driveField(src, p.drive as string, unit), rng = createRng(p.seed as number), count = p.count as number, tb = (p.turbulence as number) * unit;
    const xs: number[] = [], ys: number[] = [];
    for (let t = 0; t < count * 40 && xs.length < count; t++) {
      const x = rng() * w, y = rng() * h;
      if (rng() < F[(y | 0) * w + (x | 0)] ** 1.5) {
        const k = xs.length;
        xs.push(x + Math.sin(time * 1.3 + k) * tb);
        ys.push(y + Math.cos(time * 1.1 + k * 1.7) * tb);
      }
    }
    const reach = (p.reach as number) * unit, n = xs.length, cell = Math.max(1, reach), grid = new Map<number, number[]>();
    const key = (x: number, y: number) => (((y / cell) | 0) + 1) * 65536 + ((x / cell) | 0) + 1;
    for (let i = 0; i < n; i++) { const k = key(xs[i], ys[i]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); }
    const a = hexToRgb(p.colA as string), b = hexToRgb(p.colB as string), mode = p.color as string, limit = p.maxLinks as number;
    ctx.lineWidth = (p.line as number) * unit;
    for (let i = 0; i < n; i++) {
      const near: [number, number][] = [];
      for (let dy = -cell; dy <= cell; dy += cell) for (let dx = -cell; dx <= cell; dx += cell) {
        for (const j of grid.get(key(xs[i] + dx, ys[i] + dy)) ?? []) {
          if (j <= i) continue;
          const d = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
          if (d < reach) near.push([d, j]);
        }
      }
      near.sort((q, r) => q[0] - r[0]);
      for (const [d, j] of near.slice(0, limit)) {
        const f = d / reach;
        const col = mode === 'image' ? px(src, xs[i], ys[i]) : mode === 'fixed' ? a : a.map((v, c) => v + (b[c] - v) * f);
        ctx.strokeStyle = rgbCss(col, 1 - f * 0.7);
        ctx.beginPath(); ctx.moveTo(xs[i], ys[i]); ctx.lineTo(xs[j], ys[j]); ctx.stroke();
      }
    }
    const r = (p.dot as number) * unit, stamps = contentOf(p, unit);
    stamps?.begin(ctx);
    if (r > 0) for (let i = 0; i < n; i++) {
      if (stamps) { stamps.stamp(ctx, i, xs[i], ys[i], r * 4, mode === 'image' ? px(src, xs[i], ys[i]) : a); continue; }
      ctx.fillStyle = rgbCss(mode === 'image' ? px(src, xs[i], ys[i]) : a);
      ctx.beginPath(); ctx.arc(xs[i], ys[i], r, 0, 7); ctx.fill();
    }
    stamps?.end(ctx);
  },
});

export const circuitBoard: EffectDefinition = withContent({
  id: 'circuitBoard',
  name: 'Circuit Board',
  category: 'pattern',
  description: 'Grows circuit traces, pads and vias from the areas of the image you choose.',
  params: [
    R('pitch', 'Grid Pitch', 4, 40, 1, 12, 'Routing'),
    R('traces', 'Traces', 10, 2000, 10, 420, 'Routing'),
    R('length', 'Trace Length', 3, 90, 1, 24, 'Routing'),
    S('routing', 'Routing', 'free', [['free', 'Free'], ['strict', 'Strict (No Crossings)'], ['dir', 'Directional'], ['rings', 'Rings']], 'Routing'),
    R('threshold', 'Threshold', 0, 1, 0.01, 0.45, 'Routing', 'Which tones feed the circuit.'),
    T('invert', 'Use Dark Areas', false, 'Routing'),
    SEED('Routing'),
    R('line', 'Trace Width', 0.3, 6, 0.1, 1.4, 'Style'),
    R('pad', 'Pad Size', 0, 12, 0.1, 3, 'Style'),
    R('glow', 'Glow', 0, 30, 0.5, 8, 'Style'),
    S('color', 'Color Mode', 'gradient', [['fixed', 'Fixed'], ['image', 'From Image'], ['gradient', 'Gradient By Length']], 'Style'),
    C('colA', 'Color A', '#b06cff', 'Style'),
    C('colB', 'Color B', '#36e0ff', 'Style'),
    C('bg', 'Background', '#07050f', 'Style'),
    R('keep', 'Original Opacity', 0, 1, 0.01, 0.25, 'Style'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    ground(ctx, src, w, h, p.bg as string, p.keep as number);
    const pitch = Math.max(2, (p.pitch as number) * unit), gw = Math.ceil(w / pitch) + 1, gh = Math.ceil(h / pitch) + 1;
    const L = boxBlur(toLuma(src), w, h, pitch / 2, 1), th = p.threshold as number, inv = p.invert as boolean;
    const allowed = (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return false;
      const v = L[Math.min(h - 1, (gy * pitch) | 0) * w + Math.min(w - 1, (gx * pitch) | 0)];
      return inv ? v < th : v > th;
    };
    const rng = createRng(p.seed as number), used = new Uint8Array(gw * gh), mode = p.routing as string, strict = mode === 'strict';
    const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const a = hexToRgb(p.colA as string), b = hexToRgb(p.colB as string), cm = p.color as string, pad = (p.pad as number) * unit, len = p.length as number;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = (p.line as number) * unit;
    ctx.shadowBlur = (p.glow as number) * unit;
    const cx = gw / 2, cy = gh / 2, stamps = contentOf(p, unit), pads: [number, number, number[]][] = [];
    for (let t = 0; t < (p.traces as number); t++) {
      let gx = (rng() * gw) | 0, gy = (rng() * gh) | 0;
      if (!allowed(gx, gy) || (strict && used[gy * gw + gx])) continue;
      let d = ((rng() * 8) | 0);
      const path: [number, number][] = [[gx, gy]];
      used[gy * gw + gx] = 1;
      for (let s = 0; s < len; s++) {
        if (mode === 'rings') {
          // Walk around the frame centre, turning only by 45°.
          const want = Math.round(((Math.atan2(gy - cy, gx - cx) + Math.PI / 2) / (Math.PI * 2)) * 8);
          d = ((want % 8) + 8) % 8;
        } else if (mode === 'dir') { if (rng() < 0.25) d = rng() < 0.5 ? 0 : 1; } else if (rng() < 0.3) d = (d + (rng() < 0.5 ? 1 : 7)) % 8;
        const nx = gx + dirs[d][0], ny = gy + dirs[d][1];
        if (!allowed(nx, ny) || (strict && used[ny * gw + nx])) break;
        gx = nx; gy = ny;
        used[gy * gw + gx] = 1;
        path.push([gx, gy]);
      }
      if (path.length < 3) continue;
      const f = Math.min(1, path.length / len);
      const col = cm === 'image' ? px(src, path[0][0] * pitch, path[0][1] * pitch) : cm === 'fixed' ? a : a.map((v, c) => v + (b[c] - v) * f);
      ctx.strokeStyle = ctx.shadowColor = ctx.fillStyle = rgbCss(col);
      ctx.beginPath();
      path.forEach(([x, y], i) => (i ? ctx.lineTo(x * pitch, y * pitch) : ctx.moveTo(x * pitch, y * pitch)));
      ctx.stroke();
      if (pad > 0) for (const [x, y] of [path[0], path[path.length - 1]]) {
        if (stamps) { pads.push([x * pitch, y * pitch, col]); continue; }
        ctx.beginPath(); ctx.arc(x * pitch, y * pitch, pad, 0, 7); ctx.fill();
        ctx.fillStyle = p.bg as string;
        ctx.beginPath(); ctx.arc(x * pitch, y * pitch, pad * 0.4, 0, 7); ctx.fill();
        ctx.fillStyle = rgbCss(col);
      }
    }
    ctx.shadowBlur = 0;
    if (stamps) {
      stamps.begin(ctx);
      pads.forEach(([x, y, col], i) => stamps.stamp(ctx, i, x, y, pad * 3.5, col));
      stamps.end(ctx);
    }
  },
});

function shapeAt(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, r: number, a: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(0, 0, r, 0, 7);
  else if (shape === 'square') ctx.rect(-r, -r, r * 2, r * 2);
  else if (shape === 'tri') { ctx.moveTo(0, -r); ctx.lineTo(r, r); ctx.lineTo(-r, r); ctx.closePath(); }
  else if (shape === 'petal') ctx.ellipse(0, 0, r * 1.8, r * 0.55, 0, 0, 7);
  else ctx.rect(-r * 2, -r * 0.18, r * 4, r * 0.36);
  ctx.fill();
  ctx.restore();
}

export const radialArray: EffectDefinition = withContent({
  id: 'radialArray',
  name: 'Radial Array',
  category: 'pattern',
  description: 'Rebuilds the image from rings of shapes around a centre, sized by brightness.',
  animated: (p) => (p.spin as number) !== 0,
  params: [
    R('rings', 'Rings', 4, 120, 1, 42, 'Array'),
    R('spokes', 'Spokes', 6, 240, 1, 90, 'Array'),
    R('cx', 'Centre X', 0, 1, 0.01, 0.5, 'Array'),
    R('cy', 'Centre Y', 0, 1, 0.01, 0.5, 'Array'),
    R('twist', 'Twist', -3, 3, 0.01, 0, 'Array', 'Spirals the rings.'),
    R('spin', 'Spin', -1, 1, 0.01, 0, 'Array'),
    S('shape', 'Shape', 'circle', [['circle', 'Circle'], ['square', 'Square'], ['tri', 'Triangle'], ['petal', 'Petal'], ['line', 'Line']], 'Shape'),
    R('size', 'Max Size', 0.1, 1.5, 0.01, 0.8, 'Shape'),
    R('min', 'Min Size', 0, 0.6, 0.01, 0.05, 'Shape'),
    T('invert', 'Invert Tone', false, 'Shape'),
    S('color', 'Color Mode', 'image', [['image', 'From Image'], ['ink', 'Ink']], 'Color'),
    { ...C('ink', 'Ink', '#e8e6df'), visibleWhen: (v) => v.color === 'ink' },
    C('bg', 'Background', '#0b0c0b'),
  ],
  render({ src, ctx, width: w, height: h, params: p, time, unit }) {
    ctx.fillStyle = p.bg as string;
    ctx.fillRect(0, 0, w, h);
    const stamps = contentOf(p, unit), inkRgb = hexToRgb(p.ink as string);
    stamps?.begin(ctx);
    let placed = 0;
    const cx = (p.cx as number) * w, cy = (p.cy as number) * h, rings = p.rings as number, spokes = p.spokes as number;
    const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)), L = toLuma(src), inv = p.invert as boolean, ink = p.ink as string, img = p.color === 'image';
    for (let r = 0; r < rings; r++) {
      const rad = ((r + 0.5) / rings) * maxR, step = (maxR / rings) * 0.5;
      const n = Math.max(3, Math.round(spokes * ((r + 1) / rings)));
      for (let s = 0; s < n; s++) {
        const a = (s / n) * Math.PI * 2 + (r / rings) * (p.twist as number) * Math.PI + time * (p.spin as number);
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        if (x < -step || y < -step || x > w + step || y > h + step) continue;
        const v = L[Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))], t = inv ? 1 - v : v;
        const size = step * ((p.min as number) + t * ((p.size as number) - (p.min as number))) * 2;
        if (size < 0.2) continue;
        if (stamps) { stamps.stamp(ctx, placed++, x, y, size * 2, img ? px(src, x, y) : inkRgb, a); continue; }
        ctx.fillStyle = img ? rgbCss(px(src, x, y)) : ink;
        shapeAt(ctx, p.shape as string, x, y, size, a);
      }
    }
    stamps?.end(ctx);
  },
});

export const waveLines: EffectDefinition = {
  id: 'waveLines',
  name: 'Wave Lines',
  category: 'pattern',
  description: 'Redraws the image as horizontal lines pushed up by the brightness beneath them.',
  animated: (p) => (p.drift as number) > 0,
  params: [
    R('spacing', 'Line Spacing', 3, 40, 0.5, 11, 'Lines'),
    R('width', 'Line Width', 0.3, 12, 0.1, 1.6, 'Lines'),
    R('amp', 'Displacement', 0, 120, 1, 34, 'Lines'),
    R('soft', 'Softness', 0, 20, 0.5, 4, 'Lines', 'Blurs the image first, for rounder waves.'),
    R('drift', 'Drift', 0, 3, 0.01, 0, 'Lines', 'Rolls a slow wave through the lines.'),
    T('fade', 'Thin In Shadows', true, 'Lines'),
    T('invert', 'Invert', false, 'Lines'),
    R('glow', 'Glow', 0, 30, 0.5, 8, 'Style'),
    C('line', 'Line Color', '#9dff5c', 'Style'),
    R('accentEvery', 'Accent Every', 0, 20, 1, 0, 'Style', '0 turns accents off.'),
    { ...C('accent', 'Band Accent', '#ffffff', 'Style'), visibleWhen: (v) => (v.accentEvery as number) > 0 },
    C('bg', 'Background', '#07130a', 'Style'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.fillStyle = p.bg as string;
    ctx.fillRect(0, 0, w, h);
    let L = toLuma(src);
    const so = (p.soft as number) * unit;
    if (so > 0.5) L = boxBlur(L, w, h, so, 2);
    const gap = Math.max(1.5, (p.spacing as number) * unit), amp = (p.amp as number) * unit, inv = p.invert as boolean, dr = p.drift as number, thin = p.fade as boolean, lw = (p.width as number) * unit;
    const step = Math.max(1, Math.round(2 * unit)), every = p.accentEvery as number, n = Math.ceil(w / step) + 1;
    const top = new Float32Array(n), low = new Float32Array(n);
    // Each line is one filled ribbon, so a row costs one draw call.
    let row = 0;
    for (let y0 = -amp; y0 < h + amp; y0 += gap, row++) {
      const yy = Math.min(h - 1, Math.max(0, y0 | 0));
      for (let k = 0; k < n; k++) {
        const x = Math.min(w - 1, k * step);
        let v = L[yy * w + x];
        if (inv) v = 1 - v;
        const y = y0 - v * amp + (dr ? Math.sin(x * 0.01 / unit + time * dr * 3 + y0 * 0.02 / unit) * 6 * unit : 0);
        const half = (thin ? lw * (0.25 + v * 1.1) : lw) / 2;
        top[k] = y - half; low[k] = y + half;
      }
      ctx.fillStyle = every > 0 && row % every === 0 ? (p.accent as string) : (p.line as string);
      ctx.beginPath();
      ctx.moveTo(0, top[0]);
      for (let k = 1; k < n; k++) ctx.lineTo(k * step, top[k]);
      for (let k = n - 1; k >= 0; k--) ctx.lineTo(k * step, low[k]);
      ctx.closePath();
      ctx.fill();
    }
    const glow = (p.glow as number) * unit;
    if (glow > 0.3) {
      // One blurred pass over the whole image costs far less than a shadow per line.
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${glow}px)`;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(c, 0, 0);
      ctx.restore();
      c.width = c.height = 1;
    }
  },
};

export const metaballs: EffectDefinition = {
  id: 'metaballs',
  name: 'Metaballs',
  category: 'pattern',
  description: 'A grid of blobs sized by the image. Neighbours fuse into liquid shapes.',
  animated: (p) => (p.wobble as number) > 0,
  supportsTransparency: true,
  params: [
    S('drive', 'Drive Region', 'light', [['light', 'Highlights'], ['dark', 'Shadows'], ['edges', 'Edges']], 'Blobs'),
    R('pitch', 'Blob Pitch', 8, 100, 1, 34, 'Blobs'),
    R('merge', 'Merge', 0, 1, 0.01, 0.55, 'Blobs', 'Higher fuses neighbours into thick bands.'),
    R('spread', 'Spread', 0.3, 2, 0.01, 1, 'Blobs'),
    R('wobble', 'Wobble', 0, 1, 0.01, 0, 'Blobs'),
    C('color', 'Blob Color', '#7dff3c'),
    T('sample', 'Color From Image', false, 'Color'),
    C('bg', 'Background', '#050a06'),
    T('transparent', 'Transparent Background', false, 'Color'),
    T('invert', 'Invert', false, 'Color'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const pitch = Math.max(3, (p.pitch as number) * unit), F = driveField(src, p.drive as string, unit), gain = 0.55 + (p.merge as number) * 0.9;
    const field = new Float32Array(w * h), wob = (p.wobble as number) * pitch * 0.4;
    for (let gy = 0; gy * pitch < h + pitch; gy++)
      for (let gx = 0; gx * pitch < w + pitch; gx++) {
        const cx = gx * pitch + Math.sin(time * 2 + gy * 1.3 + gx) * wob, cy = gy * pitch + Math.cos(time * 1.7 + gx * 1.1) * wob;
        const v = F[Math.min(h - 1, Math.max(0, cy | 0)) * w + Math.min(w - 1, Math.max(0, cx | 0))];
        const r = pitch * 0.62 * Math.sqrt(v) * (p.spread as number);
        if (r < 0.6) continue;
        const R2 = r * r, ext = Math.ceil(r * 2.2);
        for (let y = Math.max(0, (cy - ext) | 0); y < Math.min(h, cy + ext); y++)
          for (let x = Math.max(0, (cx - ext) | 0); x < Math.min(w, cx + ext); x++) {
            const d = (x - cx) ** 2 + (y - cy) ** 2;
            field[y * w + x] += R2 / (d + R2 * 0.12);
          }
      }
    const out = ctx.createImageData(w, h), o = out.data, c = hexToRgb(p.color as string), b = hexToRgb(p.bg as string), tr = p.transparent as boolean, inv = p.invert as boolean, smp = p.sample as boolean;
    const th = 2.6 / gain;
    for (let i = 0; i < w * h; i++) {
      let a = Math.min(1, Math.max(0, (field[i] - th) * 2.5));
      if (inv) a = 1 - a;
      const k = i * 4, col = smp ? [src.data[k], src.data[k + 1], src.data[k + 2]] : c;
      if (tr) { o[k] = col[0]; o[k + 1] = col[1]; o[k + 2] = col[2]; o[k + 3] = a * 255; } else { for (let q = 0; q < 3; q++) o[k + q] = b[q] + (col[q] - b[q]) * a; o[k + 3] = 255; }
    }
    ctx.putImageData(out, 0, 0);
  },
};

interface Blob { x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number }

/** Connected regions above a cutoff, largest first. */
export function findBlobs(F: Float32Array, w: number, h: number, cutoff: number, gridStep: number): Blob[] {
  const gw = Math.ceil(w / gridStep), gh = Math.ceil(h / gridStep), seen = new Uint8Array(gw * gh), out: Blob[] = [];
  const on = (x: number, y: number) => F[Math.min(h - 1, y * gridStep) * w + Math.min(w - 1, x * gridStep)] > cutoff;
  for (let sy = 0; sy < gh; sy++)
    for (let sx = 0; sx < gw; sx++) {
      if (seen[sy * gw + sx] || !on(sx, sy)) continue;
      const b: Blob = { x0: sx, y0: sy, x1: sx, y1: sy, area: 0, cx: 0, cy: 0 }, stack = [sy * gw + sx];
      seen[sy * gw + sx] = 1;
      while (stack.length) {
        const i = stack.pop()!, x = i % gw, y = (i / gw) | 0;
        b.area++; b.cx += x; b.cy += y;
        if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          if (!seen[j] && on(nx, ny)) { seen[j] = 1; stack.push(j); }
        }
      }
      out.push(b);
    }
  return out.sort((a, c) => c.area - a.area).map((b) => ({ x0: b.x0 * gridStep, y0: b.y0 * gridStep, x1: (b.x1 + 1) * gridStep, y1: (b.y1 + 1) * gridStep, area: b.area, cx: (b.cx / b.area) * gridStep, cy: (b.cy / b.area) * gridStep }));
}

/**
 * Keeps blobs identified between frames, so a word or image stays on the same
 * blob and moves with it, instead of jumping as blobs change size order.
 */
interface Tracked { id: number; x: number; y: number; r: number; dx: number; dy: number; seen: number; angle: number }
let tracked: { frame: number; list: Tracked[]; next: number } = { frame: -1, list: [], next: 0 };

function trackBlobs(blobs: Blob[], frame: number, unit: number, ease: number) {
  if (frame < tracked.frame || frame > tracked.frame + 4) tracked = { frame, list: [], next: 0 };
  if (frame === tracked.frame && tracked.list.length) return tracked.list.filter((t) => t.seen === 0);
  tracked.frame = frame;
  const free = [...tracked.list], out: Tracked[] = [], reach = 90 * unit;
  for (const b of blobs) {
    let best = -1, bd = reach;
    free.forEach((t, i) => { const d = Math.hypot(t.x - b.cx, t.y - b.cy); if (d < bd) { bd = d; best = i; } });
    const r = Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2;
    if (best >= 0) {
      const t = free.splice(best, 1)[0], nx = t.x + (b.cx - t.x) * ease, ny = t.y + (b.cy - t.y) * ease;
      t.dx = nx - t.x; t.dy = ny - t.y; t.x = nx; t.y = ny; t.r += (r - t.r) * ease; t.seen = 0;
      if (Math.hypot(t.dx, t.dy) > 0.5 * unit) t.angle = Math.atan2(t.dy, t.dx);
      out.push(t);
    } else out.push({ id: tracked.next++, x: b.cx, y: b.cy, r, dx: 0, dy: 0, seen: 0, angle: 0 });
  }
  // A blob that vanished for a moment keeps its identity for a few frames.
  for (const t of free) if (++t.seen < 6) out.push(t);
  tracked.list = out;
  return out.filter((t) => t.seen === 0);
}

let lastLuma: { w: number; h: number; L: Float32Array } | null = null;

/** The field blobs are found in. Motion compares with the last frame; Nearest reads the depth map. */
function blobField(src: ImageData, p: ParamValues, unit: number, time: number): Float32Array {
  const { width: w, height: h } = src, drive = p.drive as string;
  if (drive === 'motion') {
    const L = boxBlur(toLuma(src), w, h, 2 * unit, 1), prev = lastLuma?.w === w && lastLuma.h === h ? lastLuma.L : L, o = new Float32Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = Math.min(1, Math.abs(L[i] - prev[i]) * 8);
    lastLuma = { w, h, L };
    return boxBlur(o, w, h, 6 * unit, 2);
  }
  if (drive === 'color') {
    const t = hexToRgb(p.target as string), tol = p.tolerance as number, d = src.data, o = new Float32Array(w * h);
    for (let i = 0; i < o.length; i++) o[i] = Math.max(0, 1 - Math.hypot(d[i * 4] - t[0], d[i * 4 + 1] - t[1], d[i * 4 + 2] - t[2]) / (tol * 2));
    return boxBlur(o, w, h, 3 * unit, 1);
  }
  if (drive === 'near') return editedDepth(w, h, time) ?? driveField(src, 'light', unit);
  return driveField(src, drive, unit);
}

export const blobTracker: EffectDefinition = withContent({
  id: 'blobTracker',
  name: 'Blob Tracker',
  category: 'pattern',
  description: 'Finds bright, dark or edgy regions in every frame and marks them with tracking boxes.',
  params: [
    S('drive', 'Detect', 'light', [['light', 'Bright Areas'], ['dark', 'Dark Areas'], ['edges', 'Edges'], ['motion', 'Motion'], ['color', 'Target Color'], ['near', 'Nearest (Depth)']], 'Detection'),
    { ...C('target', 'Target Color', '#e02020', 'Detection'), visibleWhen: (v) => v.drive === 'color' },
    { ...R('tolerance', 'Color Tolerance', 5, 120, 1, 45, 'Detection'), visibleWhen: (v) => v.drive === 'color' },
    R('cutoff', 'Threshold', 0.05, 0.95, 0.01, 0.6, 'Detection'),
    R('targets', 'Targets', 1, 64, 1, 16, 'Detection'),
    S('marker', 'Marker', 'brackets', [['box', 'Box'], ['brackets', 'Corner Brackets'], ['cross', 'Crosshair']], 'Style'),
    S('links', 'Connect Lines', 'nearest', [['none', 'None'], ['nearest', 'Nearest'], ['chain', 'Chain'], ['mesh', 'Mesh']], 'Style'),
    T('labels', 'Numbered Labels', true, 'Style'),
    R('line', 'Line Width', 0.3, 5, 0.1, 1.2, 'Style'),
    C('color', 'Target Color', '#ff2a2a', 'Style'),
    R('dim', 'Dim Image', 0, 1, 0.01, 0.1, 'Style'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, frame, time }) {
    ctx.putImageData(src, 0, 0);
    if ((p.dim as number) > 0) { ctx.fillStyle = `rgba(0,0,0,${p.dim})`; ctx.fillRect(0, 0, w, h); }
    const blobs = findBlobs(blobField(src, p, unit, time), w, h, p.cutoff as number, Math.max(1, Math.round(3 * unit))).slice(0, p.targets as number);
    const stamps = contentOf(p, unit);
    if (stamps) {
      const list = trackBlobs(blobs, frame, unit, 1 - (p.cEase as number)), rgb = hexToRgb(p.color as string);
      stamps.begin(ctx);
      for (const t of list) stamps.stamp(ctx, t.id, t.x, t.y, p.cFit === 'blob' ? Math.max(14 * unit, t.r * 1.6) : 60 * unit, rgb, p.cFace === 'motion' ? t.angle : 0);
      stamps.end(ctx);
      return;
    }
    const col = p.color as string, lw = (p.line as number) * unit;
    ctx.strokeStyle = ctx.fillStyle = col;
    ctx.lineWidth = lw;
    const links = p.links as string;
    if (links !== 'none') {
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      blobs.forEach((b, i) => {
        if (links === 'chain') { if (i) { ctx.moveTo(blobs[i - 1].cx, blobs[i - 1].cy); ctx.lineTo(b.cx, b.cy); } }
        else if (links === 'mesh') for (let j = 0; j < i; j++) { ctx.moveTo(blobs[j].cx, blobs[j].cy); ctx.lineTo(b.cx, b.cy); }
        else {
          let best = -1, bd = 1e12;
          blobs.forEach((c, j) => { const d = (b.cx - c.cx) ** 2 + (b.cy - c.cy) ** 2; if (j !== i && d < bd) { bd = d; best = j; } });
          if (best >= 0) { ctx.moveTo(b.cx, b.cy); ctx.lineTo(blobs[best].cx, blobs[best].cy); }
        }
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.font = `${Math.round(11 * unit)}px monospace`;
    blobs.forEach((b, i) => {
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0, k = Math.min(bw, bh) * 0.25, m = p.marker as string;
      if (m === 'box') ctx.strokeRect(b.x0, b.y0, bw, bh);
      else if (m === 'brackets') {
        ctx.beginPath();
        for (const [x, y, dx, dy] of [[b.x0, b.y0, 1, 1], [b.x1, b.y0, -1, 1], [b.x0, b.y1, 1, -1], [b.x1, b.y1, -1, -1]]) { ctx.moveTo(x + dx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * k); }
        ctx.stroke();
      } else {
        const r = Math.max(bw, bh) / 2;
        ctx.beginPath(); ctx.moveTo(b.cx - r, b.cy); ctx.lineTo(b.cx + r, b.cy); ctx.moveTo(b.cx, b.cy - r); ctx.lineTo(b.cx, b.cy + r); ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(b.cx, b.cy, 2 * unit, 0, 7); ctx.fill();
      if (p.labels) ctx.fillText(String(i + 1).padStart(2, '0'), b.x0, b.y0 - 3 * unit);
    });
  },
}, {
  extra: [
    { ...S('cFit', 'Content Size', 'blob', [['blob', 'Fit To Blob'], ['fixed', 'Same Size']], 'Content Transform'), visibleWhen: (v) => v.cMode !== 'default' },
    { ...S('cFace', 'Orientation', 'fixed', [['fixed', 'Fixed'], ['motion', 'Follow Motion']], 'Content Transform'), visibleWhen: (v) => v.cMode !== 'default' },
    { ...R('cEase', 'Smooth Motion', 0, 0.95, 0.01, 0.5, 'Content Transform'), visibleWhen: (v) => v.cMode !== 'default' },
  ],
});

export const GENERATIVE: EffectDefinition[] = [nodeNetwork, circuitBoard, radialArray, waveLines, metaballs, blobTracker];

export type { ParamValues };
export { clamp255, fbm };
