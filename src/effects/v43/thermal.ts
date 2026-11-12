import type { EffectDefinition } from '../types';
import { selection } from '../../ai/selection';
import { tracks } from '../../ai/client';
import { boxBlur, clamp255, hash2, toLuma } from '../../utils/imageProcessing';
import { editedDepth } from '../airDepth';
import { resample } from '../airKey';
import { C, R, S, T } from '../generative';

/**
 * An artistic thermal camera. A normal camera cannot see heat, so "heat" here
 * is built from what the picture does show: nearness (a depth map), a selected
 * or matted subject, warm colours, or brightness. The on-screen scale says
 * "simulated" so nobody reads it as a measurement.
 */

const PALETTES: Record<string, string[]> = {
  iron: ['#000000', '#1d0638', '#4b0c7a', '#2a2cc4', '#c21f8f', '#f0461b', '#ff9a14', '#ffe14d', '#fffbe6'],
  rainbow: ['#05001a', '#1f0aa8', '#007bff', '#00e0c8', '#3fe03a', '#f2e310', '#ff8a00', '#ff1e00', '#ffffff'],
  whiteHot: ['#000000', '#ffffff'],
  blackHot: ['#ffffff', '#000000'],
  arctic: ['#000014', '#09306b', '#1d76c4', '#8fd6ff', '#ffffff', '#ffd27a', '#ff8a1e'],
  lava: ['#000000', '#3a0000', '#9a0b00', '#ff3d00', '#ffa600', '#ffffd0'],
};

const hexes = (list: string[]) => list.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

/** Nearness without a model: lower in the frame and near the centre usually means closer. A guess, labelled as one. */
function guessNear(w: number, h: number, L: Float32Array) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; o[i] = 0.55 * (y / h) + 0.25 * (1 - Math.abs(x / w - 0.5) * 2) + 0.2 * L[i]; }
  return o;
}

export const thermal: EffectDefinition = {
  id: 'thermal', name: 'Thermal Vision', category: 'analog',
  description: 'A simulated heat camera. Heat comes from nearness, a subject, warm colours or brightness, not from real temperature.',
  animated: (p) => (p.shimmer as number) > 0 || (p.noise as number) > 0,
  params: [
    S('heatFrom', 'Heat Comes From', 'proximity', [['proximity', 'Nearness (Depth)'], ['subject', 'Selected Subject'], ['warmth', 'Warm Colors'], ['brightness', 'Brightness'], ['mix', 'Mix Of All']], 'Heat', ),
    { ...R('mixDepth', 'Nearness Weight', 0, 1, 0.01, 0.5, 'Heat'), visibleWhen: (v) => v.heatFrom === 'mix' },
    { ...R('mixSubject', 'Subject Weight', 0, 1, 0.01, 0.5, 'Heat'), visibleWhen: (v) => v.heatFrom === 'mix' },
    { ...R('mixWarm', 'Warm Color Weight', 0, 1, 0.01, 0.3, 'Heat'), visibleWhen: (v) => v.heatFrom === 'mix' },
    { ...R('mixBright', 'Brightness Weight', 0, 1, 0.01, 0.3, 'Heat'), visibleWhen: (v) => v.heatFrom === 'mix' },
    T('bodyHeat', 'Subject Runs Warm', true, 'Heat'),
    R('intensity', 'Temperature', -1, 1, 0.01, 0.1, 'Heat', 'Shifts the whole scene hotter or cooler.'),
    R('heatContrast', 'Heat Contrast', 0.3, 4, 0.01, 1.4, 'Heat'),
    R('sensitivity', 'Sensitivity', 0.2, 3, 0.01, 1, 'Heat', 'Low values show only the hottest areas.'),
    R('rangeLow', 'Color Range Low', 0, 0.95, 0.01, 0.05, 'Heat'),
    R('rangeHigh', 'Color Range High', 0.05, 1, 0.01, 0.95, 'Heat'),
    S('palette', 'Heat Palette', 'iron', [['iron', 'Iron (Black-Purple-Red-Yellow)'], ['rainbow', 'Rainbow'], ['whiteHot', 'White Hot'], ['blackHot', 'Black Hot'], ['arctic', 'Arctic'], ['lava', 'Lava'], ['custom', 'Custom']], 'Palette'),
    ...[C('c1', 'Coldest', '#000000', 'Palette'), C('c2', 'Cool', '#4b0c7a', 'Palette'), C('c3', 'Warm', '#f0461b', 'Palette'), C('c4', 'Hottest', '#ffe14d', 'Palette')].map((d) => ({ ...d, visibleWhen: (v: Record<string, unknown>) => v.palette === 'custom' })),
    R('glow', 'Heat Glow', 0, 2, 0.01, 0.6, 'Look'),
    R('blur', 'Sensor Softness', 0, 20, 0.1, 4, 'Look'),
    R('pixel', 'Sensor Resolution', 0, 30, 0.5, 0, 'Look', 'Bigger blocks look like a low-resolution thermal sensor. 0 is off.'),
    R('edges', 'Edge Detection', 0, 1, 0.01, 0.25, 'Look'),
    C('edgeColor', 'Edge Color', '#ffffff', 'Look'),
    R('noise', 'Sensor Noise', 0, 1, 0.01, 0.1, 'Look'),
    R('shimmer', 'Heat Shimmer', 0, 1, 0.01, 0, 'Look'),
    T('scale', 'Show Heat Scale', true, 'Overlay'),
    T('crosshair', 'Show Crosshair', false, 'Overlay'),
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Overlay' },
  ],
  presets: [
    { name: 'Proximity Heat', values: { heatFrom: 'proximity' } },
    { name: 'Body Heat (Subject)', values: { heatFrom: 'subject', palette: 'iron', glow: 0.9 } },
    { name: 'White Hot', values: { palette: 'whiteHot', edges: 0, glow: 0.3 } },
    { name: 'Rainbow Scan', values: { palette: 'rainbow', heatContrast: 1.8, crosshair: true } },
    { name: 'Low-Res Sensor', values: { pixel: 10, blur: 0, noise: 0.25 } },
    { name: 'Lava Glow', values: { palette: 'lava', glow: 1.4, shimmer: 0.4 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const n = w * h, d = src.data, L = toLuma(src), from = p.heatFrom as string;
    const depth = from === 'proximity' || from === 'mix' ? editedDepth(w, h, time) : null;
    const sel = selection.union(time) ?? tracks.matte.at(time);
    const subject = sel ? resample(sel, w, h) : null;
    const near = depth ?? (from === 'proximity' || from === 'mix' ? guessNear(w, h, L) : null);
    const H = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], warm = Math.max(0, Math.min(1, (r - b) / 255 * 1.4 + (r + g * 0.5) / 765));
      let v: number;
      if (from === 'proximity') v = near![i];
      else if (from === 'subject') v = subject ? 0.25 + subject[i] * 0.6 + L[i] * 0.15 : L[i];
      else if (from === 'warmth') v = warm;
      else if (from === 'brightness') v = L[i];
      else {
        const ws = [p.mixDepth as number, subject ? p.mixSubject as number : 0, p.mixWarm as number, p.mixBright as number], sum = ws.reduce((a, c) => a + c, 0) || 1;
        v = (near![i] * ws[0] + (subject ? subject[i] : 0) * ws[1] + warm * ws[2] + L[i] * ws[3]) / sum;
      }
      // People are warmer than their surroundings: a selected subject is pushed up in every mode.
      if (p.bodyHeat && subject && from !== 'subject') v = v * 0.75 + subject[i] * 0.35;
      H[i] = v;
    }
    let F = boxBlur(H, w, h, Math.max(0, (p.blur as number) * unit), 2);
    const blk = Math.round((p.pixel as number) * unit);
    if (blk >= 2) {
      const G = new Float32Array(n);
      for (let y = 0; y < h; y += blk) for (let x = 0; x < w; x += blk) {
        let s = 0, c = 0;
        for (let j = y; j < Math.min(h, y + blk); j++) for (let i = x; i < Math.min(w, x + blk); i++) { s += F[j * w + i]; c++; }
        for (let j = y; j < Math.min(h, y + blk); j++) for (let i = x; i < Math.min(w, x + blk); i++) G[j * w + i] = s / c;
      }
      F = G;
    }
    const glow = p.glow as number;
    if (glow > 0) {
      const B = boxBlur(F, w, h, 18 * unit, 3);
      for (let i = 0; i < n; i++) F[i] = F[i] + Math.max(0, B[i] - 0.45) * glow;
    }
    const pal = hexes(p.palette === 'custom' ? [p.c1, p.c2, p.c3, p.c4] as string[] : PALETTES[p.palette as string]), last = pal.length - 1;
    const lo = Math.min(p.rangeLow as number, (p.rangeHigh as number) - 0.02), hi = Math.max(p.rangeHigh as number, lo + 0.02), ct = p.heatContrast as number, sens = p.sensitivity as number, off = p.intensity as number;
    const edges = p.edges as number, ec = [parseInt((p.edgeColor as string).slice(1, 3), 16), parseInt((p.edgeColor as string).slice(3, 5), 16), parseInt((p.edgeColor as string).slice(5, 7), 16)];
    const El = edges > 0 ? boxBlur(L, w, h, Math.max(1, unit), 1) : null, noise = p.noise as number, sh = (p.shimmer as number) * 6 * unit, seed = (p.seed as number) + frame;
    const out = ctx.createImageData(w, h), o = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let i = y * w + x;
      if (sh > 0) { const dx = Math.round(Math.sin(y * 0.09 + time * 6) * sh * F[i]); i = y * w + Math.min(w - 1, Math.max(0, x + dx)); }
      let v = (F[i] - 0.5) * ct + 0.5 + off;
      v = Math.max(0, Math.min(1, (v - lo) / (hi - lo))) ** (1 / sens);
      if (noise > 0) v = Math.max(0, Math.min(1, v + (hash2(x >> 1, y >> 1, seed) - 0.5) * noise * 0.15));
      const t = v * last, k = Math.min(last - 1, Math.floor(t)), f = t - k, a = pal[k], b = pal[k + 1], q = (y * w + x) * 4;
      let r = a[0] + (b[0] - a[0]) * f, g = a[1] + (b[1] - a[1]) * f, bl = a[2] + (b[2] - a[2]) * f;
      if (El && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const j = y * w + x, e = Math.min(1, Math.hypot(El[j + 1] - El[j - 1], El[j + w] - El[j - w]) * 6 * (unit / 1.08) * 2) * edges;
        r += (ec[0] - r) * e; g += (ec[1] - g) * e; bl += (ec[2] - bl) * e;
      }
      o[q] = clamp255(r); o[q + 1] = clamp255(g); o[q + 2] = clamp255(bl); o[q + 3] = d[q + 3];
    }
    ctx.putImageData(out, 0, 0);

    const s = unit;
    ctx.font = `${Math.round(11 * s)}px monospace`;
    ctx.textBaseline = 'middle';
    if (p.scale) {
      // A relative scale only. There are no degrees to show, so none are shown.
      const bw = 14 * s, bh = Math.min(h * 0.5, 260 * s), x0 = w - bw - 26 * s, y0 = (h - bh) / 2, grad = ctx.createLinearGradient(0, y0 + bh, 0, y0);
      pal.forEach((c, i) => grad.addColorStop(i / last, `rgb(${c[0]},${c[1]},${c[2]})`));
      ctx.fillStyle = grad;
      ctx.fillRect(x0, y0, bw, bh);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = Math.max(1, s);
      ctx.strokeRect(x0, y0, bw, bh);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText('HOT', x0 - 5 * s, y0 + 6 * s);
      ctx.fillText('COLD', x0 - 5 * s, y0 + bh - 6 * s);
      ctx.save();
      ctx.translate(x0 + bw + 12 * s, y0 + bh / 2);
      ctx.rotate(Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText('SIMULATED · RELATIVE', 0, 0);
      ctx.restore();
    }
    if (p.crosshair) {
      const cx = w / 2, cy = h / 2, r = 18 * s;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.6, cy); ctx.lineTo(cx - r * 0.5, cy); ctx.moveTo(cx + r * 0.5, cy); ctx.lineTo(cx + r * 1.6, cy);
      ctx.moveTo(cx, cy - r * 1.6); ctx.lineTo(cx, cy - r * 0.5); ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy + r * 1.6);
      ctx.stroke();
      const v = Math.round(Math.max(0, Math.min(1, F[Math.round(cy) * w + Math.round(cx)])) * 100);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.fillText(`HEAT ${v}%`, cx + r * 0.7, cy - r * 0.9);
    }
    if ((from === 'proximity' || from === 'mix') && !depth) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText('NO DEPTH MAP · NEARNESS GUESSED', 12 * s, h - 14 * s);
    }
  },
};
