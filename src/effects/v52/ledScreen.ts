import type { EffectDefinition } from '../types';
import { cellAverages, createCanvas, get2d } from '../../utils/imageProcessing';
import { R, S } from '../generative';

/**
 * LED Screen: the picture as seen on a screen up close. Each pixel of a
 * coarse grid becomes its red, green and blue sub-pixels, lit by that
 * colour, with dark gaps between them and a glow that spills over the gaps.
 *
 * Sub-pixels cover only part of a pixel, so each layout is measured once and
 * lit brighter by exactly what it loses: at Brightness 1× the screen keeps
 * the picture's own overall brightness, whatever the layout and gap.
 */

/** How much of sub-pixel c lights at (fx, fy) inside one screen pixel, 0..1. */
function maskAt(layout: string, gap: number, fx: number, fy: number, c: number) {
  if (layout === 'stripe' || layout === 'delta') {
    // Three tall bars per pixel, each with soft ends and a gap around it.
    const sub = Math.min(2, (fx * 3) | 0);
    if (sub !== c) return 0;
    const sx = fx * 3 - sub, inX = Math.abs(sx - 0.5) * 2, inY = Math.abs(fy - 0.5) * 2;
    return Math.max(0, 1 - Math.max(0, inX - (1 - gap * 1.6)) / Math.max(0.01, gap * 1.6)) * Math.max(0, 1 - Math.max(0, inY - (1 - gap)) / Math.max(0.01, gap));
  }
  if (layout === 'led') {
    // A cluster of three round LEDs in a triangle.
    const pts = [[0.3, 0.32], [0.7, 0.32], [0.5, 0.7]], rad = 0.21 * (1 - gap * 0.6), [px, py] = pts[c];
    return Math.max(0, Math.min(1, (rad - Math.hypot(fx - px, fy - py)) / (rad * 0.35) + 0.5));
  }
  const rad = 0.5 * (1 - gap);
  return Math.max(0, Math.min(1, (rad - Math.hypot(fx - 0.5, fy - 0.5)) / (rad * 0.3) + 0.5));
}

/** Average lit share of each sub-pixel over a whole screen pixel. */
function coverage(layout: string, gap: number) {
  const cov = [0, 0, 0], n = 24;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let c = 0; c < 3; c++) cov[c] += maskAt(layout, gap, (x + 0.5) / n, (y + 0.5) / n, c);
  return cov.map((v) => Math.max(0.02, v / (n * n)));
}

export const ledScreen: EffectDefinition = {
  id: 'ledScreen', name: 'LED Screen', category: 'light',
  description: 'Close up on a screen: every pixel splits into glowing red, green and blue sub-pixels.',
  animated: (p) => (p.refresh as number) > 0,
  params: [
    R('pitch', 'Pixel Pitch', 3, 60, 0.5, 12, 'Screen', 'Size of one screen pixel.'),
    S('layout', 'Sub-Pixels', 'stripe', [['stripe', 'RGB Stripes'], ['led', 'Round LEDs'], ['delta', 'Delta (Staggered)'], ['mono', 'Single Color Dots']], 'Screen'),
    R('gap', 'Gap', 0, 0.6, 0.01, 0.22, 'Screen'),
    R('glow', 'Glow', 0, 1.5, 0.01, 0.55, 'Light'),
    R('gain', 'Brightness', 0.3, 2, 0.01, 1, 'Light', '1× keeps the picture’s own brightness.'),
    R('black', 'Black Level', 0, 0.3, 0.005, 0.03, 'Light', 'How grey the screen is when a pixel is off.'),
    R('refresh', 'Refresh Flicker', 0, 1, 0.01, 0, 'Light'),
  ],
  presets: [
    { name: 'Phone Up Close', values: { pitch: 9, layout: 'stripe', gap: 0.18, glow: 0.4 } },
    { name: 'Stadium LEDs', values: { pitch: 22, layout: 'led', gap: 0.3, glow: 0.9, gain: 1.2 } },
    { name: 'Old TV', values: { pitch: 7, layout: 'delta', gap: 0.25, glow: 0.7, refresh: 0.3 } },
    { name: 'Dot Matrix', values: { pitch: 16, layout: 'mono', gap: 0.3, glow: 0.8 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const pitch = Math.max(2, (p.pitch as number) * unit), layout = p.layout as string, gap = p.gap as number, blk = (p.black as number) * 255;
    const { data, cols, rows } = cellAverages(srcCanvas, w, h, pitch);
    // Each channel is lit by what its sub-pixel loses (a third for stripes, more for round LEDs).
    const cov = coverage(layout, gap), gain = p.gain as number, k3 = cov.map((c) => gain / c);
    // The sub-pixel shapes, tabulated once per frame (a 4K frame asks for them 25 million times).
    const T = 64, tab = [0, 1, 2].map((c) => { const t = new Float32Array(T * T); for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) t[y * T + x] = maskAt(layout, gap, (x + 0.5) / T, (y + 0.5) / T, layout === 'mono' ? 0 : c) * k3[layout === 'mono' ? 0 : c]; return t; });
    const out = ctx.createImageData(w, h), o = out.data;
    const flick = (p.refresh as number) * 0.25;
    for (let y = 0; y < h; y++) {
      const cyf = y / pitch, cy = Math.min(rows - 1, cyf | 0), fy = cyf - (cyf | 0);
      // A refresh band rolling down the screen.
      const wave = flick ? 1 - flick * (0.5 + 0.5 * Math.sin((y / h) * 6.28 * 2 - time * 40)) : 1;
      const odd = layout === 'delta' && cy % 2 ? 0.5 : 0;
      for (let x = 0; x < w; x++) {
        const cxf = x / pitch + odd, cx = Math.min(cols - 1, Math.max(0, cxf | 0)), fx = cxf - (cxf | 0), i = (cy * cols + cx) * 4, q = (y * w + x) * 4;
        const ti = Math.min(T - 1, (fy * T) | 0) * T + Math.min(T - 1, (fx * T) | 0);
        o[q] = blk + data[i] * tab[0][ti] * wave;
        o[q + 1] = blk + data[i + 1] * tab[1][ti] * wave;
        o[q + 2] = blk + data[i + 2] * tab[2][ti] * wave;
        o[q + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    const glow = p.glow as number;
    if (glow > 0) {
      // Light spills over the gaps, as it does from a real screen.
      const c = createCanvas(w, h), g2 = get2d(c);
      g2.filter = `blur(${(pitch * 0.6).toFixed(2)}px)`;
      g2.drawImage(ctx.canvas, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, glow * 0.35);
      ctx.drawImage(c, 0, 0);
      if (glow > 1) { ctx.globalAlpha = (glow - 1) * 0.35; ctx.drawImage(c, 0, 0); }
      ctx.restore();
      c.width = c.height = 1;
    }
  },
};
