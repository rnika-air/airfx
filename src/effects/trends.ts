import type { EffectDefinition, ParamDef } from './types';
import { parseIds } from './types';
import { assetStore } from '../engine/assets';
import { contentOf, withContent } from '../content/content';
import { boxBlur, clamp255, createCanvas, createRng, fbm, get2d, hexToRgb, sampleBilinear, toLuma } from '../utils/imageProcessing';
import { editedDepth } from './airDepth';
import { C, R, S, SEED, T } from './generative';

/** The 4.0 collection: Y2K materials and 2026 motion tools. Original implementations. See docs/TRENDS_2026.md. */

const FONT = (group: string, def = '"Arial Black", Impact, sans-serif'): ParamDef => ({ key: 'font', label: 'Font', type: 'custom', editor: 'font', default: def, group });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** White text on transparent, sized to the frame. */
function textMask(w: number, h: number, text: string, font: string, weight: number, size: number, x: number, y: number, spacing: number) {
  const c = createCanvas(w, h), g = get2d(c, true), lines = text.split('\n');
  g.font = `${weight} ${size}px ${font}`;
  (g as unknown as { letterSpacing: string }).letterSpacing = `${spacing * size}px`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  lines.forEach((l, i) => g.fillText(l, x * w, y * h + (i - (lines.length - 1) / 2) * size * 1.05));
  return { canvas: c, ctx: g };
}

export const chromeType: EffectDefinition = {
  id: 'chromeType', name: 'Chrome Type', category: 'type',
  description: 'Sets your text in liquid metal: the letters become a soft relief that reflects a studio horizon.',
  supportsTransparency: true,
  animated: (p) => (p.flow as number) > 0,
  params: [
    { key: 'text', label: 'Text', type: 'text', default: 'AIRFX', maxLength: 120, multiline: true, group: 'Type' },
    FONT('Type'),
    R('size', 'Size', 20, 600, 1, 220, 'Type'),
    R('x', 'Position X', 0, 1, 0.005, 0.5, 'Type'),
    R('y', 'Position Y', 0, 1, 0.005, 0.5, 'Type'),
    R('spacing', 'Letter Spacing', -0.1, 0.6, 0.01, 0, 'Type'),
    R('soft', 'Bevel Softness', 1, 40, 0.5, 11, 'Metal'),
    R('bands', 'Reflection Bands', 0.5, 6, 0.1, 1.6, 'Metal'),
    R('contrast', 'Contrast', 0.5, 3, 0.01, 1.7, 'Metal'),
    R('flow', 'Flow', 0, 2, 0.01, 0, 'Metal'),
    S('metal', 'Metal', 'chrome', [['chrome', 'Chrome'], ['gold', 'Gold'], ['pearl', 'Pearl'], ['tint', 'Use Tint']], 'Metal'),
    { ...C('tint', 'Metal Tint', '#9fd0ff', 'Metal'), visibleWhen: (v) => v.metal === 'tint' },
    C('dark', 'Shadow', '#10131c', 'Metal'),
    R('dim', 'Dim Image', 0, 1, 0.01, 0.35, 'Image'),
    T('transparent', 'Transparent Background', false, 'Image'),
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    if (!p.transparent) {
      ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      ctx.fillStyle = `rgba(0,0,0,${p.dim})`;
      ctx.fillRect(0, 0, w, h);
    }
    const { ctx: mg } = textMask(w, h, (p.text as string) || ' ', p.font as string, 900, (p.size as number) * unit, p.x as number, p.y as number, p.spacing as number);
    const md = mg.getImageData(0, 0, w, h).data, A = new Float32Array(w * h);
    for (let i = 0; i < A.length; i++) A[i] = md[i * 4 + 3] / 255;
    const H = boxBlur(A, w, h, (p.soft as number) * unit, 3), rel = (p.soft as number) * unit * 3;
    const out = ctx.getImageData(0, 0, w, h), o = out.data, m = p.metal as string;
    const tint = m === 'gold' ? [255, 206, 110] : m === 'pearl' ? [255, 226, 240] : m === 'tint' ? hexToRgb(p.tint as string) : [232, 238, 248];
    const dark = hexToRgb(p.dark as string), bands = p.bands as number, ct = p.contrast as number, fl = time * (p.flow as number);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, a = A[i];
        if (a <= 0) continue;
        const nx = (H[i + 1] - H[i - 1]) * rel, ny = (H[i + w] - H[i - w]) * rel, nz = 1 / Math.hypot(nx, ny, 1);
        const v = (ny * nz + 1) * 0.5 + nx * nz * 0.3 + fl;
        const e = clamp01((0.5 + 0.5 * Math.cos(v * bands * Math.PI * 2) - 0.5) * ct + 0.5), hi = e ** 8 * 0.6, k = i * 4;
        for (let c = 0; c < 3; c++) o[k + c] = lerp(o[k + c], clamp255(lerp(dark[c], tint[c], e) + hi * 255), a);
        o[k + 3] = Math.max(o[k + 3], a * 255);
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const iridescentFilm: EffectDefinition = {
  id: 'iridescentFilm', name: 'Iridescent Film', category: 'light',
  description: 'Thin-film interference, as on a soap bubble or a CD: colour shifts with brightness and surface.',
  animated: (p) => (p.flow as number) > 0,
  params: [
    R('thickness', 'Film Thickness', 100, 1600, 10, 620),
    R('tone', 'Follow Image', 0, 2, 0.01, 0.35),
    R('ripple', 'Surface Ripple', 0, 1, 0.01, 0.35),
    R('scale', 'Ripple Size', 20, 600, 5, 220),
    R('flow', 'Flow', 0, 2, 0.01, 0),
    R('amount', 'Amount', 0, 1, 0.01, 0.5),
    S('blendMode', 'Apply As', 'screen', [['screen', 'Light Film'], ['replace', 'Replace Image'], ['tone', 'Keep Shading']]),
    SEED(),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const out = ctx.createImageData(w, h), o = out.data, d = src.data, L = toLuma(src), th = p.thickness as number, tone = p.tone as number, rip = p.ripple as number, s = 1 / ((p.scale as number) * unit), amt = p.amount as number, seed = p.seed as number, t = time * (p.flow as number), mode = p.blendMode as string, wl = [650, 532, 450], step = Math.max(2, Math.round(4 * unit));
    // Ripple is smooth, so a coarse grid is enough.
    const gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, G = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) G[y * gw + x] = fbm(x * step * s + t, y * step * s, seed, 3);
    for (let y = 0; y < h; y++) {
      const gy = y / step, y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = x / step, x0 = gx | 0, fx = gx - x0, i = y0 * gw + x0;
        const n = lerp(lerp(G[i], G[i + 1], fx), lerp(G[i + gw], G[i + gw + 1], fx), fy), q = y * w + x, k = q * 4;
        const dd = th * (1 + (L[q] - 0.5) * tone + (n - 0.5) * rip * 2);
        for (let c = 0; c < 3; c++) {
          const film = 127.5 + 127.5 * Math.cos((4 * Math.PI * 1.33 * dd) / wl[c] + t * 3), b = d[k + c];
          const v = mode === 'replace' ? film : mode === 'tone' ? (film * L[q] * 1.4) : 255 - ((255 - b) * (255 - film)) / 255;
          o[k + c] = lerp(b, v, amt);
        }
        o[k + 3] = d[k + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const digitalBubbles: EffectDefinition = {
  id: 'digitalBubbles', name: 'Digital Bubbles', category: 'light',
  description: 'Glossy spheres that bend the image inside them, with an iridescent rim and a window highlight.',
  animated: (p) => (p.rise as number) > 0,
  params: [
    R('count', 'Bubbles', 1, 200, 1, 26), R('size', 'Size', 10, 400, 1, 110), R('vary', 'Size Variation', 0, 1, 0.01, 0.6),
    R('refract', 'Refraction', 0, 1.5, 0.01, 0.75), R('rim', 'Iridescent Rim', 0, 1, 0.01, 0.7), R('gloss', 'Highlight', 0, 1, 0.01, 0.8),
    R('rise', 'Rise Speed', 0, 2, 0.01, 0.2), SEED(),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.putImageData(src, 0, 0);
    const out = ctx.getImageData(0, 0, w, h), o = out.data, rng = createRng(p.seed as number), ref = p.refract as number, rim = p.rim as number, gloss = p.gloss as number, tmp = new Uint8ClampedArray(4);
    for (let b = 0; b < (p.count as number); b++) {
      const x0 = rng(), y0 = rng(), sz = rng(), ph = rng(), v = 0.4 + rng();
      const r = (p.size as number) * unit * (1 - (p.vary as number) * sz * 0.8);
      // Wraps past both edges, so a bubble leaves the frame before reappearing.
      const cy = (((y0 - time * (p.rise as number) * 0.1 * v) % 1) + 1) % 1 * (h + r * 2) - r;
      const cx = x0 * w + Math.sin(time * 1.1 * v + ph * 6.28) * r * 0.2;
      for (let y = Math.max(0, (cy - r) | 0); y < Math.min(h, cy + r); y++)
        for (let x = Math.max(0, (cx - r) | 0); x < Math.min(w, cx + r); x++) {
          const nx = (x - cx) / r, ny = (y - cy) / r, d2 = nx * nx + ny * ny;
          if (d2 >= 1) continue;
          const nz = Math.sqrt(1 - d2), k = (y * w + x) * 4, lens = 1 - ref * (1 - nz);
          sampleBilinear(src.data, w, h, cx + nx * r * lens, cy + ny * r * lens, tmp, 0);
          const edge = (1 - nz) ** 3, spec = Math.max(0, 1 - Math.hypot(nx + 0.38, ny + 0.42) / 0.26) ** 2 * gloss, film = (1 - nz) * 9 + ph * 6;
          for (let c = 0; c < 3; c++) {
            const irid = 127 + 127 * Math.cos(film + c * 2.1);
            o[k + c] = clamp255(lerp(tmp[c], irid, edge * rim) + edge * 40 + spec * 255);
          }
          o[k + 3] = 255;
        }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const lensWarp: EffectDefinition = {
  id: 'lensWarp', name: 'Lens Warp', category: 'distortion',
  description: 'Futuristic glass: bulges or pinches the frame around a centre, splitting colour towards the edges.',
  animated: (p) => (p.pulse as number) > 0,
  params: [
    R('amount', 'Warp', -1, 1, 0.01, 0.45), R('cx', 'Center X', 0, 1, 0.005, 0.5), R('cy', 'Center Y', 0, 1, 0.005, 0.5), R('radius', 'Radius', 0.2, 2, 0.01, 1),
    R('split', 'Chromatic Split', 0, 0.2, 0.002, 0.03), R('vignette', 'Vignette', 0, 1, 0.01, 0.35), R('pulse', 'Pulse', 0, 3, 0.01, 0),
  ],
  render({ src, ctx, width: w, height: h, params: p, time }) {
    const out = ctx.createImageData(w, h), o = out.data, cx = (p.cx as number) * w, cy = (p.cy as number) * h, R0 = (Math.hypot(w, h) / 2) * (p.radius as number), split = p.split as number, vg = p.vignette as number, a = (p.amount as number) * (1 + Math.sin(time * (p.pulse as number) * 6.28) * ((p.pulse as number) > 0 ? 0.3 : 0)), t = new Uint8ClampedArray(4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) / R0, k = (y * w + x) * 4, base = 1 - a * clamp01(1 - r * r) * (1 - r * 0.4);
        for (let c = 0; c < 3; c++) {
          const m = base * (1 + (c - 1) * split * r);
          sampleBilinear(src.data, w, h, cx + dx * m, cy + dy * m, t, 0);
          o[k + c] = t[c] * (1 - vg * clamp01(r) ** 2);
        }
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const kineticType: EffectDefinition = {
  id: 'kineticType', name: 'Kinetic Type', category: 'type',
  description: 'Letters ride a wave, change weight and bend the image behind them.',
  supportsTransparency: true,
  animated: (p) => (p.speed as number) > 0,
  params: [
    { key: 'text', label: 'Text', type: 'text', default: 'KINETIC', maxLength: 60, group: 'Type' },
    FONT('Type', 'Arial, Helvetica, sans-serif'),
    R('size', 'Size', 20, 500, 1, 170, 'Type'), R('tracking', 'Tracking', 0.3, 2, 0.01, 1, 'Type'), R('y', 'Position Y', 0, 1, 0.005, 0.5, 'Type'),
    R('wave', 'Wave Height', 0, 200, 1, 46, 'Motion'), R('freq', 'Wave Length', 0.1, 3, 0.01, 0.7, 'Motion'), R('stretch', 'Stretch', 0, 2, 0.01, 0.6, 'Motion'), R('weights', 'Weight Swing', 0, 800, 100, 600, 'Motion', 'Moves between weights. A variable font gives the smoothest change.'), R('speed', 'Speed', 0, 3, 0.01, 0.6, 'Motion'),
    S('style', 'Fill', 'color', [['color', 'Color'], ['image', 'Bend Image'], ['knockout', 'Knock Out']], 'Look'),
    { ...C('color', 'Text Color', '#c6ff2e', 'Look'), visibleWhen: (v) => v.style === 'color' },
    { ...R('bend', 'Bend', 0, 120, 1, 44, 'Look'), visibleWhen: (v) => v.style === 'image' },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const chars = [...((p.text as string) || ' ')], size = (p.size as number) * unit, t = time * (p.speed as number) * 3, m = createCanvas(w, h), g = get2d(m, true), font = p.font as string, swing = p.weights as number;
    const weightOf = (i: number) => Math.round(Math.min(900, Math.max(100, 500 + (swing / 2) * Math.sin(i * (p.freq as number) + t))) / 100) * 100;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = (p.color as string);
    const widths = chars.map((c, i) => { g.font = `${weightOf(i)} ${size}px ${font}`; return g.measureText(c).width * (p.tracking as number); }), total = widths.reduce((a, b) => a + b, 0);
    let x = w / 2 - total / 2;
    chars.forEach((c, i) => {
      const ph = i * (p.freq as number) + t, cw = widths[i];
      g.save();
      g.translate(x + cw / 2, (p.y as number) * h + Math.sin(ph) * (p.wave as number) * unit);
      g.scale(1, 1 + Math.cos(ph) * (p.stretch as number) * 0.5);
      g.font = `${weightOf(i)} ${size}px ${font}`;
      g.fillText(c, 0, 0);
      g.restore();
      x += cw;
    });
    ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    if (p.style === 'color') { ctx.drawImage(m, 0, 0); return; }
    if (p.style === 'knockout') { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(m, 0, 0); ctx.globalCompositeOperation = 'source-over'; return; }
    const md = g.getImageData(0, 0, w, h).data, A = new Float32Array(w * h);
    for (let i = 0; i < A.length; i++) A[i] = md[i * 4 + 3] / 255;
    const H = boxBlur(A, w, h, 7 * unit, 2), out = ctx.createImageData(w, h), o = out.data, s = (p.bend as number) * unit * 7 * unit;
    for (let y = 1; y < h - 1; y++)
      for (let q = 1; q < w - 1; q++) {
        const i = y * w + q;
        sampleBilinear(src.data, w, h, q + (H[i + 1] - H[i - 1]) * s, y + (H[i + w] - H[i - w]) * s, o, i * 4);
        const lift = A[i] * 28;
        o[i * 4] = clamp255(o[i * 4] + lift); o[i * 4 + 1] = clamp255(o[i * 4 + 1] + lift); o[i * 4 + 2] = clamp255(o[i * 4 + 2] + lift);
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const contourField: EffectDefinition = {
  id: 'contourField', name: 'Contour Field', category: 'pattern',
  description: 'Even-width contour lines drawn from the image and a flowing noise field.',
  supportsTransparency: true,
  animated: (p) => (p.flow as number) > 0,
  params: [
    R('levels', 'Levels', 3, 80, 1, 22, 'Field'), R('smooth', 'Smoothness', 0, 40, 0.5, 8, 'Field'), R('noise', 'Noise Mix', 0, 1, 0.01, 0.2, 'Field'), R('scale', 'Noise Size', 40, 800, 10, 320, 'Field'), R('flow', 'Flow', 0, 2, 0.01, 0, 'Field'), SEED('Field'),
    R('width', 'Line Width', 0.3, 12, 0.1, 1.6, 'Stroke'), S('stroke', 'Stroke Style', 'solid', [['solid', 'Solid'], ['dash', 'Dashed'], ['dots', 'Dotted'], ['every', 'Heavy Every Fifth']], 'Stroke'), { ...R('dash', 'Dash Length', 2, 80, 1, 18, 'Stroke'), visibleWhen: (v) => v.stroke === 'dash' || v.stroke === 'dots' },
    S('system', 'Color System', 'gradient', [['fixed', 'One Color'], ['gradient', 'By Height'], ['image', 'From Image']], 'Color'), C('colA', 'Line / Low', '#37f0d0'), { ...C('colB', 'High', '#ff4fa8'), visibleWhen: (v) => v.system === 'gradient' }, C('bg', 'Background', '#07090c'), T('transparent', 'Transparent Background', false, 'Color'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const L = boxBlur(toLuma(src), w, h, (p.smooth as number) * unit, 2), mix = p.noise as number, nz = 1 / ((p.scale as number) * unit), seed = p.seed as number, t = time * (p.flow as number) * 0.4, step = Math.max(2, Math.round(5 * unit)), gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, G = new Float32Array(gw * gh);
    if (mix > 0) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) G[y * gw + x] = fbm(x * step * nz + t, y * step * nz - t, seed, 3);
    const F = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const gy = y / step, y0 = gy | 0, fy = gy - y0; for (let x = 0; x < w; x++) { const gx = x / step, x0 = gx | 0, fx = gx - x0, i = y0 * gw + x0; F[y * w + x] = lerp(L[y * w + x], lerp(lerp(G[i], G[i + 1], fx), lerp(G[i + gw], G[i + gw + 1], fx), fy), mix); } }
    const out = ctx.createImageData(w, h), o = out.data, N = p.levels as number, lw = (p.width as number) * unit, a = hexToRgb(p.colA as string), b = hexToRgb(p.colB as string), bg = hexToRgb(p.bg as string), sys = p.system as string, tr = p.transparent as boolean, st = p.stroke as string, dash = (p.dash as number) * unit, d = src.data;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, v = F[i] * N, gx = (F[i + 1] - F[i - 1]) * 0.5 * N, gy = (F[i + w] - F[i - w]) * 0.5 * N, g = Math.max(1e-4, Math.hypot(gx, gy)), level = Math.round(v), dist = Math.abs(v - level) / g;
        let width = lw;
        if (st === 'every' && level % 5 === 0) width *= 2.6;
        let cov = clamp01(width / 2 + 0.5 - dist);
        if (cov > 0 && (st === 'dash' || st === 'dots')) { const along = (x * -gy + y * gx) / g, m = ((along % (dash * 2)) + dash * 2) % (dash * 2); if (st === 'dash' ? m > dash : Math.abs(m - dash) > lw) cov = 0; }
        const k = i * 4, c = sys === 'image' ? [d[k], d[k + 1], d[k + 2]] : sys === 'gradient' ? a.map((q, n) => lerp(q, b[n], F[i])) : a;
        if (tr) { o[k] = c[0]; o[k + 1] = c[1]; o[k + 2] = c[2]; o[k + 3] = cov * 255; } else { for (let n = 0; n < 3; n++) o[k + n] = lerp(bg[n], c[n], cov); o[k + 3] = 255; }
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const fluidDistort: EffectDefinition = {
  id: 'fluidDistort', name: 'Fluid Distortion', category: 'distortion',
  description: 'Pushes the image along a swirling, liquid-like field that never folds over itself abruptly.',
  animated: (p) => (p.speed as number) > 0,
  params: [R('amount', 'Amount', 0, 300, 1, 70), R('scale', 'Swirl Size', 40, 900, 5, 300), R('passes', 'Turbulence', 1, 4, 1, 2), R('speed', 'Speed', 0, 3, 0.01, 0.3), SEED()],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const out = ctx.createImageData(w, h), s = 1 / ((p.scale as number) * unit), amt = (p.amount as number) * unit, step = Math.max(3, Math.round(6 * unit)), gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, X = new Float32Array(gw * gh), Y = new Float32Array(gw * gh), seed = p.seed as number, t = time * (p.speed as number) * 0.5, passes = p.passes as number, e = 0.02;
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let x = gx * step, y = gy * step;
        // Curl of a noise field has no sources or sinks, which is what reads as liquid.
        for (let q = 0; q < passes; q++) {
          const a = x * s + t, b = y * s - t, f = (u: number, v: number) => fbm(u, v, seed + q, 3);
          const cx = (f(a, b + e) - f(a, b - e)) / (2 * e), cy = -(f(a + e, b) - f(a - e, b)) / (2 * e);
          x += (cx * amt) / passes; y += (cy * amt) / passes;
        }
        X[gy * gw + gx] = x; Y[gy * gw + gx] = y;
      }
    for (let y = 0; y < h; y++) {
      const gy = y / step, y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = x / step, x0 = gx | 0, fx = gx - x0, i = y0 * gw + x0;
        sampleBilinear(src.data, w, h, lerp(lerp(X[i], X[i + 1], fx), lerp(X[i + gw], X[i + gw + 1], fx), fy), lerp(lerp(Y[i], Y[i + 1], fx), lerp(Y[i + gw], Y[i + gw + 1], fx), fy), out.data, (y * w + x) * 4);
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const liquidReveal: EffectDefinition = {
  id: 'liquidReveal', name: 'Liquid Transition', category: 'animate',
  description: 'An organic wipe that melts the image into a colour or another picture, with a glowing edge.',
  supportsTransparency: true,
  animated: (p) => (p.speed as number) > 0,
  params: [
    R('progress', 'Progress', 0, 1, 0.005, 0.5), R('speed', 'Auto Speed', 0, 2, 0.01, 0, undefined, 'Loops the transition on its own.'), R('scale', 'Blob Size', 30, 800, 5, 240), R('soft', 'Edge Softness', 0.002, 0.2, 0.001, 0.02), R('gravity', 'Drip Direction', 0, 1, 0.01, 0.4), R('glow', 'Edge Glow', 0, 1, 0.01, 0.6), SEED(),
    C('edge', 'Edge Color', '#c6ff2e'), C('to', 'Target Color', '#0b0c0b'),
    { key: 'target', label: 'Target Image', type: 'images', default: '', max: 1 }, T('transparent', 'Reveal Transparency', false),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const pr = (p.speed as number) > 0 ? 0.5 - 0.5 * Math.cos(time * (p.speed as number) * Math.PI) : (p.progress as number), s = 1 / ((p.scale as number) * unit), seed = p.seed as number, soft = p.soft as number, gr = p.gravity as number, glow = p.glow as number, edge = hexToRgb(p.edge as string), to = hexToRgb(p.to as string), tr = p.transparent as boolean;
    let other: Uint8ClampedArray | null = null;
    const asset = assetStore.get(parseIds(p.target)[0] ?? '');
    if (asset?.kind === 'image') { const c = createCanvas(w, h), g = get2d(c, true); g.drawImage(asset.el, 0, 0, w, h); other = g.getImageData(0, 0, w, h).data; }
    const out = ctx.createImageData(w, h), o = out.data, d = src.data, step = Math.max(2, Math.round(4 * unit)), gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, G = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) G[y * gw + x] = fbm(x * step * s, y * step * s, seed, 4);
    // Noise fills about .3 to .7: stretch so 0 and 1 are fully one side or the other.
    const lim = pr * (1 + soft * 4) - soft * 2;
    for (let y = 0; y < h; y++) {
      const gy = y / step, y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = x / step, x0 = gx | 0, fx = gx - x0, i = y0 * gw + x0, n = lerp(lerp(G[i], G[i + 1], fx), lerp(G[i + gw], G[i + gw + 1], fx), fy);
        const field = lerp(clamp01((n - 0.3) * 2.5), y / h, gr), a = clamp01((lim - field) / soft + 0.5), k = (y * w + x) * 4, e = 4 * a * (1 - a) * glow;
        for (let c = 0; c < 3; c++) o[k + c] = clamp255(lerp(lerp(d[k + c], other ? other[k + c] : to[c], a), edge[c], e));
        o[k + 3] = tr ? lerp(d[k + 3], 0, a) : 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const quadMosaic: EffectDefinition = withContent({
  id: 'quadMosaic', name: 'Quadtree Mosaic', category: 'texture',
  description: 'Fine cells where the image is busy, big cells where it is calm. Pixels, vector shapes or your own content.',
  params: [
    R('min', 'Smallest Cell', 4, 60, 1, 8), R('max', 'Largest Cell', 40, 400, 5, 160), R('detail', 'Detail', 0.005, 0.3, 0.001, 0.05, undefined, 'Lower splits more.'), S('shape', 'Cell', 'square', [['square', 'Pixel'], ['circle', 'Circle'], ['frame', 'Outlined Pixel'], ['diamond', 'Diamond']]), R('gap', 'Gap', 0, 0.5, 0.01, 0.06), C('bg', 'Background', '#0b0c0b'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    ctx.fillStyle = p.bg as string;
    ctx.fillRect(0, 0, w, h);
    const W = w + 1, S1 = new Float64Array(W * (h + 1)), S2 = new Float64Array(W * (h + 1)), L = toLuma(src);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = L[y * w + x], a = (y + 1) * W + x + 1; S1[a] = v + S1[a - 1] + S1[a - W] - S1[a - W - 1]; S2[a] = v * v + S2[a - 1] + S2[a - W] - S2[a - W - 1]; }
    const sum = (T0: Float64Array, x0: number, y0: number, x1: number, y1: number) => T0[y1 * W + x1] - T0[y0 * W + x1] - T0[y1 * W + x0] + T0[y0 * W + x0];
    const min = Math.max(3, (p.min as number) * unit), max = (p.max as number) * unit, thr = (p.detail as number) ** 2, shape = p.shape as string, gap = p.gap as number, stamps = contentOf(p, unit), d = src.data;
    stamps?.begin(ctx);
    let placed = 0;
    const cell = (x: number, y: number, s: number) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w, Math.ceil(x + s)), y1 = Math.min(h, Math.ceil(y + s));
      if (x1 <= x0 || y1 <= y0) return;
      const n = (x1 - x0) * (y1 - y0), m = sum(S1, x0, y0, x1, y1) / n, va = sum(S2, x0, y0, x1, y1) / n - m * m;
      if (s > min * 1.99 && (va > thr || s > max)) { const h2 = s / 2; cell(x, y, h2); cell(x + h2, y, h2); cell(x, y + h2, h2); cell(x + h2, y + h2, h2); return; }
      const cx = Math.min(w - 1, (x + s / 2) | 0), cy = Math.min(h - 1, (y + s / 2) | 0), k = (cy * w + cx) * 4, rgb = [d[k], d[k + 1], d[k + 2]], c = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, g = s * gap / 2, q = s - g * 2;
      if (stamps) { stamps.stamp(ctx, placed++, x + s / 2, y + s / 2, q, rgb); return; }
      ctx.fillStyle = ctx.strokeStyle = c;
      if (shape === 'circle') { ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, q / 2, 0, 7); ctx.fill(); }
      else if (shape === 'diamond') { ctx.beginPath(); ctx.moveTo(x + s / 2, y + g); ctx.lineTo(x + s - g, y + s / 2); ctx.lineTo(x + s / 2, y + s - g); ctx.lineTo(x + g, y + s / 2); ctx.closePath(); ctx.fill(); }
      else if (shape === 'frame') { ctx.lineWidth = Math.max(1, q * 0.12); ctx.strokeRect(x + g, y + g, q, q); }
      else ctx.fillRect(x + g, y + g, q, q);
    };
    const root = Math.min(max, 2 ** Math.ceil(Math.log2(Math.max(min * 2, max))));
    for (let y = 0; y < h; y += root) for (let x = 0; x < w; x += root) cell(x, y, root);
    stamps?.end(ctx);
  },
});

export const depthParticles: EffectDefinition = withContent({
  id: 'depthParticles', name: 'Depth Particles', category: 'depth',
  description: 'Places particles or your own content through the scene. Near ones grow; far ones shrink and fade. Needs a depth map.',
  animated: (p) => (p.drift as number) > 0,
  params: [
    R('count', 'Particles', 20, 4000, 10, 700, 'Particles'), R('size', 'Size', 2, 120, 0.5, 26, 'Particles'), R('near', 'Near Size', 1, 5, 0.01, 2.6, 'Particles'), R('fade', 'Far Fade', 0, 1, 0.01, 0.75, 'Particles'), S('place', 'Place On', 'all', [['all', 'Everywhere'], ['near', 'Near Half'], ['far', 'Far Half']], 'Particles'), R('drift', 'Drift', 0, 2, 0.01, 0.2, 'Particles'), SEED('Particles'),
    S('color', 'Color', 'image', [['image', 'From Image'], ['fixed', 'Fixed']], 'Particles'), { ...C('ink', 'Particle Color', '#c6ff2e', 'Particles'), visibleWhen: (v) => v.color === 'fixed' }, R('dim', 'Dim Image', 0, 1, 0.01, 0.2, 'Particles'),
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${p.dim})`;
    ctx.fillRect(0, 0, w, h);
    const depth = editedDepth(w, h, time);
    if (!depth) {
      ctx.fillStyle = '#c6ff2e';
      ctx.font = `${Math.round(15 * unit)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('No depth map yet: make one in Depth', w / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }
    const rng = createRng(p.seed as number), base = (p.size as number) * unit, nearK = p.near as number, fade = p.fade as number, place = p.place as string, stamps = contentOf(p, unit), ink = hexToRgb(p.ink as string), d = src.data, list: [number, number, number, number, number][] = [];
    for (let n = 0; n < (p.count as number); n++) {
      const x = rng() * w, y = rng() * h, ph = rng() * 6.28, sp = 0.5 + rng(), dr = (p.drift as number) * 30 * unit, px = x + Math.sin(time * sp + ph) * dr, py = y + Math.cos(time * 0.8 * sp + ph) * dr, q = Math.min(h - 1, Math.max(0, py | 0)) * w + Math.min(w - 1, Math.max(0, px | 0)), v = depth[q];
      if ((place === 'near' && v < 0.5) || (place === 'far' && v >= 0.5)) continue;
      list.push([px, py, v, q, n]);
    }
    // Far first, so near particles cover them.
    list.sort((a, b) => a[2] - b[2]);
    stamps?.begin(ctx);
    for (const [x, y, v, q, n] of list) {
      const k = q * 4, rgb = p.color === 'image' ? [d[k], d[k + 1], d[k + 2]] : ink, s = base * lerp(0.35, nearK, v), a = 1 - fade * (1 - v);
      if (stamps) { stamps.stamp(ctx, n, x, y, s, rgb, 0, a); continue; }
      ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.beginPath(); ctx.arc(x, y, s / 2, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    stamps?.end(ctx);
  },
});

export const dataBars: EffectDefinition = {
  id: 'dataBars', name: 'Data Bars', category: 'pattern',
  description: 'Reads the image as data: columns of bars with live readings of brightness.',
  params: [
    R('cols', 'Columns', 4, 200, 1, 48), R('height', 'Bar Height', 0.1, 1.5, 0.01, 0.9), R('gap', 'Gap', 0, 0.8, 0.01, 0.2), S('metric', 'Measure', 'light', [['light', 'Brightness'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue'], ['edge', 'Detail']]), S('base', 'Grow From', 'bottom', [['bottom', 'Bottom'], ['center', 'Center'], ['top', 'Top']]), T('labels', 'Value Labels', true), T('grid', 'Grid', true), S('color', 'Color', 'image', [['image', 'From Image'], ['fixed', 'Fixed']]), { ...C('ink', 'Bar Color', '#c6ff2e'), visibleWhen: (v) => v.color === 'fixed' }, R('dim', 'Dim Image', 0, 1, 0.01, 0.7), { key: 'font', label: 'Label Font', type: 'custom', editor: 'font', default: 'Consolas, monospace', group: 'Settings' },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit }) {
    ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    ctx.fillStyle = `rgba(0,0,0,${p.dim})`;
    ctx.fillRect(0, 0, w, h);
    const cols = p.cols as number, cw = w / cols, d = src.data, m = p.metric as string, ink = p.ink as string;
    if (p.grid) { ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = unit; ctx.beginPath(); for (let i = 1; i < 5; i++) { const y = (h * i) / 5; ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke(); }
    ctx.font = `${Math.max(7, Math.min(cw * 0.5, 13 * unit))}px ${p.font}`;
    ctx.textAlign = 'center';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * cw), x1 = Math.min(w, Math.floor((c + 1) * cw));
      let s = 0, n = 0, r = 0, g = 0, b = 0, prev = 0, e = 0;
      for (let y = 0; y < h; y += 2) for (let x = x0; x < x1; x += 2) { const k = (y * w + x) * 4, l = (d[k] + d[k + 1] + d[k + 2]) / 765; r += d[k]; g += d[k + 1]; b += d[k + 2]; s += l; e += Math.abs(l - prev); prev = l; n++; }
      const v = m === 'r' ? r / n / 255 : m === 'g' ? g / n / 255 : m === 'b' ? b / n / 255 : m === 'edge' ? Math.min(1, (e / n) * 6) : s / n;
      const bh = Math.min(h, v * h * (p.height as number)), by = p.base === 'top' ? 0 : p.base === 'center' ? (h - bh) / 2 : h - bh, gap = cw * (p.gap as number) / 2;
      ctx.fillStyle = p.color === 'image' ? `rgb(${r / n},${g / n},${b / n})` : ink;
      ctx.fillRect(c * cw + gap, by, cw - gap * 2, bh);
      if (p.labels && cw > 20 * unit) { ctx.fillStyle = '#fff'; ctx.fillText(String(Math.round(v * 100)), c * cw + cw / 2, Math.max(14 * unit, by - 5 * unit)); }
    }
    ctx.textAlign = 'start';
  },
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const pixelGradient: EffectDefinition = {
  id: 'pixelGradient', name: 'Pixel Gradient', category: 'texture',
  description: 'Early-web gradients: a few colours stepped into chunky ordered-dither pixels, led by the image.',
  params: [
    R('pixel', 'Pixel Size', 1, 40, 0.5, 7), R('angle', 'Gradient Angle', 0, 360, 1, 90), R('image', 'Follow Image', 0, 1, 0.01, 0.7), R('spread', 'Dither', 0, 1, 0.01, 0.6),
    C('a', 'Color 1', '#2b00ff'), C('b', 'Color 2', '#ff2fd0'), C('c', 'Color 3', '#ffe14d'), C('d', 'Color 4', '#f6fff0'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    // Not rounded: a whole-pixel size would change the grid between preview and export.
    const px = Math.max(1, (p.pixel as number) * unit), cols = Math.ceil(w / px), rows = Math.ceil(h / px), a = ((p.angle as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), mix = p.image as number, spread = p.spread as number, pal = [p.a, p.b, p.c, p.d].map((c) => `${c}`), d = src.data;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const x = Math.min(w - 1, Math.floor((c + 0.5) * px)), y = Math.min(h - 1, Math.floor((r + 0.5) * px)), k = (y * w + x) * 4, l = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) / 255;
        const g = 0.5 + ((x / w - 0.5) * ca + (y / h - 0.5) * sa), t = lerp(g, l, mix), th = (BAYER[(r % 4) * 4 + (c % 4)] / 16 - 0.47) * spread;
        ctx.fillStyle = pal[Math.min(3, Math.max(0, Math.floor((t + th / 1.5) * 4)))];
        const x0 = Math.floor(c * px), y0 = Math.floor(r * px);
        ctx.fillRect(x0, y0, Math.floor((c + 1) * px) - x0, Math.floor((r + 1) * px) - y0);
      }
  },
};

export const TRENDS: EffectDefinition[] = [chromeType, iridescentFilm, digitalBubbles, lensWarp, kineticType, contourField, fluidDistort, liquidReveal, quadMosaic, depthParticles, dataBars, pixelGradient];
