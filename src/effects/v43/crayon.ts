import type { EffectDefinition } from '../types';
import { selection } from '../../ai/selection';
import { tracks } from '../../ai/client';
import { boxBlur, clamp255, hash2, hexToRgb, toLuma } from '../../utils/imageProcessing';
import { resample } from '../airKey';
import { extractPalette } from '../ditherLab';
import { C, R, S, T } from '../generative';

/**
 * Wax crayon on paper, not a pencil sketch. Colour is laid down in many short
 * strokes from a small box of crayons; wax only sticks to the raised tooth of
 * the paper, so colour breaks into specks where pressure is light, and edges
 * get a firmer, darker outline in the same colour family.
 */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A box of wax crayons: clean pigments, as in a real box. */
const BOX = ['#e8382b', '#f26b21', '#f7a72c', '#f5e03a', '#a3cf45', '#3aa655', '#22745a', '#2bb5c9', '#2f74c0', '#3b3f9f', '#8a4fbf', '#e66fb2', '#f6a9c6', '#9b5b34', '#d9a066', '#7a7a7a', '#2a2a2a', '#fbfbf8'].map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);

export const crayon: EffectDefinition = {
  id: 'crayon', name: 'Crayon', category: 'texture',
  description: 'Wax crayon on textured paper: a small box of colours, layered strokes, speckled wax and firm outlines.',
  animated: (p) => (p.boil as number) > 0,
  params: [
    S('box', 'Crayon Colors', 'classic', [['classic', 'Classic Crayon Box'], ['image', 'Taken From The Picture']], 'Color'),
    { ...R('colors', 'Crayons In The Box', 3, 24, 1, 9, 'Color'), visibleWhen: (v) => v.box === 'image' },
    R('blend', 'Color Blending', 0, 1, 0.01, 0.15, 'Color', 'Mixes the crayon colours toward the picture\'s real colours.'),
    R('saturation', 'Saturation', 0, 2, 0.01, 1.35, 'Color'),
    R('variation', 'Color Variation', 0, 1, 0.01, 0.35, 'Color', 'Each stroke picks a slightly different crayon.'),
    R('density', 'Stroke Density', 0.1, 3, 0.01, 1.1, 'Strokes'),
    R('strokeLength', 'Stroke Length', 3, 120, 0.5, 26, 'Strokes'),
    R('strokeWidth', 'Stroke Width', 1, 24, 0.1, 5, 'Strokes'),
    S('directionMode', 'Stroke Direction', 'angle', [['angle', 'One Direction'], ['edges', 'Follow Edges'], ['cross', 'Cross-Hatched'], ['scribble', 'Scribble']], 'Strokes'),
    R('direction', 'Direction', 0, 180, 1, 35, 'Strokes', '°'),
    R('jitter', 'Direction Jitter', 0, 1, 0.01, 0.25, 'Strokes'),
    R('pressure', 'Pressure', 0, 1, 0.01, 0.78, 'Wax', 'Light pressure leaves more paper showing.'),
    R('texture', 'Crayon Texture', 0, 1, 0.01, 0.62, 'Wax'),
    R('textureScale', 'Texture Scale', 0.3, 6, 0.05, 1.1, 'Wax'),
    R('edges', 'Edge Preservation', 0, 1, 0.01, 0.65, 'Outline'),
    R('outlineWidth', 'Outline Width', 0.5, 8, 0.1, 2.4, 'Outline'),
    R('outlineDark', 'Outline Darkness', 0, 1, 0.01, 0.55, 'Outline'),
    R('outlineBreak', 'Broken Outline', 0, 1, 0.01, 0.45, 'Outline'),
    S('backdrop', 'Background', 'light', [['all', 'Color Everything'], ['light', 'Leave Light Areas As Paper'], ['subject', 'Selected Subject Only']], 'Paper'),
    R('leaveLight', 'Paper Threshold', 0, 1, 0.01, 0.82, 'Paper'),
    C('paper', 'Paper Color', '#f2f0ea', 'Paper'),
    R('paperTexture', 'Paper Texture', 0, 1, 0.01, 0.5, 'Paper'),
    R('boil', 'Hand-Drawn Boil', 0, 12, 0.5, 0, 'Paper', 'Redraws the strokes this many times a second, like animation drawn frame by frame.'),
    T('keepImage', 'Show Image Under Paper', false, 'Paper'),
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Paper' },
  ],
  presets: [
    { name: 'Crayon Drawing', values: {} },
    { name: 'Heavy Wax', values: { pressure: 0.9, density: 1.8, texture: 0.5, outlineDark: 0.35, backdrop: 'all' } },
    { name: 'Light Sketchy Fill', values: { pressure: 0.45, density: 0.5, outlineBreak: 0.7 } },
    { name: 'Picture Colors', values: { box: 'image', colors: 10, blend: 0.3 } },
    { name: 'Kids Box', values: { box: 'classic', blend: 0, saturation: 1.8, variation: 0.6, directionMode: 'scribble', strokeLength: 24 } },
    { name: 'Cross-Hatched', values: { directionMode: 'cross', strokeWidth: 3, density: 1.5 } },
    { name: 'Kraft Paper', values: { paper: '#c9a77a', paperTexture: 0.8, saturation: 1.1 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const n = w * h, d = src.data, seed = (p.seed as number) + ((p.boil as number) > 0 ? Math.floor(time * (p.boil as number)) * 101 : 0);
    // The box of crayons: a few colours taken from the picture, pushed brighter.
    const pal = p.box === 'classic' ? BOX : extractPalette(d, p.colors as number).map((c) => { const l = (c[0] + c[1] + c[2]) / 3, s = p.saturation as number; return c.map((v) => clamp255(l + (v - l) * s)); });
    const L = toLuma(src), Ls = boxBlur(L, w, h, 1.5 * unit, 1), sat = p.saturation as number, blend = p.blend as number;
    const near = (r: number, g: number, b: number, skip = -1) => {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < pal.length; i++) { if (i === skip) continue; const c = pal[i], dist = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (dist < bd) { bd = dist; bi = i; } }
      return bi;
    };
    // Where crayon goes at all.
    const back = p.backdrop as string, sel = back === 'subject' ? selection.union(time) ?? tracks.matte.at(time) : null, mask = sel ? resample(sel, w, h) : null, cut = p.leaveLight as number;
    const cover = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), s0 = mx ? (mx - mn) / mx : 0;
      let c = 1;
      if (back === 'light') c = clamp01((cut - Ls[i]) / 0.12 + s0 * 1.4);
      else if (back === 'subject') c = mask ? mask[i] : 1;
      cover[i] = c;
    }

    // Strokes: crayon is pushed back and forth, so pressure varies in long bands
    // along the stroke direction. Wax then only catches the raised paper tooth.
    const out = ctx.createImageData(w, h), o = out.data, paper = hexToRgb(p.paper as string), tex = p.texture as number, ts = Math.max(0.5, (p.textureScale as number) * unit);
    const pt = p.paperTexture as number, keep = p.keepImage as boolean, mode = p.directionMode as string, baseA = ((p.direction as number) * Math.PI) / 180, jit = p.jitter as number, vary = p.variation as number;
    const len = (p.strokeLength as number) * unit, sw = (p.strokeWidth as number) * unit, dens = p.density as number, press0 = p.pressure as number;
    const edges = p.edges as number, ow = (p.outlineWidth as number) * unit, od = p.outlineDark as number, ob = p.outlineBreak as number;
    const E = edges > 0 ? boxBlur(L, w, h, Math.max(1, ow * 0.6), 1) : null;
    const angleAt = (x: number, y: number, i: number, pass: number) => {
      let a = baseA + (pass ? Math.PI / 2 : 0);
      if (mode === 'edges' && x > 0 && y > 0 && x < w - 1 && y < h - 1) { const gx = Ls[i + 1] - Ls[i - 1], gy = Ls[i + w] - Ls[i - w]; if (Math.abs(gx) + Math.abs(gy) > 0.004) a = Math.atan2(gy, gx) + Math.PI / 2; }
      // Patches of strokes lean a little differently, as a hand would.
      a += (hash2((x / (len * 2)) | 0, (y / (len * 2)) | 0, seed + 31) - 0.5) * jit * Math.PI * (mode === 'scribble' ? 3 : 1);
      return a;
    };
    const band = (x: number, y: number, a: number) => {
      const ca = Math.cos(a), sa = Math.sin(a), u = (x * ca + y * sa) / len, v = (-x * sa + y * ca) / sw, row = Math.floor(v);
      // One stroke per row of width sw, of random length and pressure.
      const off = hash2(row, 3, seed) * 7, seg = Math.floor(u + off), f = u + off - seg;
      const on = hash2(seg, row, seed + 1) < Math.min(0.97, 0.45 + dens * 0.32);
      const taper = 0.6 + 0.4 * Math.min(1, f * 4, (1 - f) * 4), edge = 1 - 0.6 * Math.abs((v - row) * 2 - 1) ** 6;
      const stroke = (0.55 + hash2(seg, row, seed + 2) * 0.45) * taper * edge;
      // Density decides how often the paper shows between strokes.
      return on ? 0.35 + 0.65 * stroke : Math.max(0, 0.35 - (1 - Math.min(1, dens)) * 0.5) * edge;
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, q = i * 4;
      const grain = 1 + (hash2(x, y, seed + 5) - 0.5) * pt * 0.12 + (hash2(x >> 2, y >> 2, seed + 6) - 0.5) * pt * 0.08;
      let r = paper[0] * grain, gg = paper[1] * grain, b = paper[2] * grain;
      if (keep) { r = r * 0.6 + d[q] * 0.4; gg = gg * 0.6 + d[q + 1] * 0.4; b = b * 0.6 + d[q + 2] * 0.4; }
      const cv = cover[i];
      if (cv > 0.01) {
        const a1 = angleAt(x, y, i, 0);
        let pressure = band(x, y, a1);
        if (mode === 'cross') pressure = Math.max(pressure, band(x, y, a1 + Math.PI / 2) * 0.85);
        pressure *= press0 * (0.7 + (1 - L[i]) * 0.6) * cv * 1.25;
        // Paper tooth: fine grain, a little stretched along the stroke.
        const ca = Math.cos(a1), sa = Math.sin(a1), tu = (x * ca + y * sa) / (ts * 2), tv = (-x * sa + y * ca) / ts;
        const tooth = hash2(tu | 0, tv | 0, seed + 3) * 0.6 + hash2((x / (ts * 2.6)) | 0, (y / (ts * 2.6)) | 0, seed + 4) * 0.4;
        const waxed = clamp01((pressure - tooth * tex) / Math.max(0.1, 1 - tex * 0.75));
        if (waxed > 0) {
          // Two neighbouring crayons, speckled together: that mix is what reads as wax colour.
          const r0 = d[q], g0 = d[q + 1], b0 = d[q + 2], l0 = (r0 + g0 + b0) / 3, R = l0 + (r0 - l0) * sat, G = l0 + (g0 - l0) * sat, B = l0 + (b0 - l0) * sat;
          const c1i = near(R, G, B), c2i = near(R, G, B, c1i), pick = hash2(x >> 1, y >> 1, seed + 7) < vary * 0.5 ? c2i : c1i, c = pal[pick];
          const cr = c[0] + (R - c[0]) * blend, cg = c[1] + (G - c[1]) * blend, cb = c[2] + (B - c[2]) * blend;
          r = r * (1 - waxed) + clamp255(cr) * (0.62 + 0.38 * r / 255) * waxed; gg = gg * (1 - waxed) + clamp255(cg) * (0.62 + 0.38 * gg / 255) * waxed; b = b * (1 - waxed) + clamp255(cb) * (0.62 + 0.38 * b / 255) * waxed;
        }
        if (E && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
          const e = Math.hypot(E[i + 1] - E[i - 1], E[i + w] - E[i - w]) * 9 * (unit / 1.08) * 2;
          if (e > 0.18) {
            // Outlines: harder-pressed crayon of the local colour, skipping in places.
            const k = clamp01((e - 0.18) * 3) * edges * (hash2((x / (ow * 2.5)) | 0, (y / (ow * 2.5)) | 0, seed + 8) < 1 - ob * 0.6 ? 1 : 0.15) * (tooth < 0.8 + press0 * 0.15 ? 1 : 0.35);
            const c = pal[near(d[q], d[q + 1], d[q + 2])], dk = 1 - od * 0.7;
            r += (c[0] * dk - r) * k; gg += (c[1] * dk - gg) * k; b += (c[2] * dk - b) * k;
          }
        }
      }
      o[q] = clamp255(r); o[q + 1] = clamp255(gg); o[q + 2] = clamp255(b); o[q + 3] = d[q + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};
