import type { EffectDefinition } from './types';
import { boxBlur, clamp255, hexToRgb, toLuma } from '../utils/imageProcessing';

/**
 * Edge: Sobel gradient magnitude of a pre-smoothed luminance plane, with
 * threshold, thickness (blur-and-boost of the edge map) and several looks.
 */
export const edge: EffectDefinition = {
  id: 'edge',
  name: 'Edge',
  category: 'texture',
  description: 'Contour detection — ink line art, neon outlines, sketches.',
  supportsTransparency: true,
  audioDefaults: { strength: { band: 'level', amount: 0.4 }, thickness: { band: 'bass', amount: 0.2 } },
  params: [
    {
      key: 'mode', label: 'Look', type: 'select', group: 'Edges', default: 'neon',
      options: [
        { value: 'neon', label: 'Neon (original colour)' },
        { value: 'lines', label: 'Line Art' },
        { value: 'overlay', label: 'Overlay on Image' },
        { value: 'emboss', label: 'Relief' },
      ],
    },
    { key: 'strength', label: 'Strength', type: 'range', group: 'Edges', min: 0.1, max: 10, step: 0.05, default: 3 },
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Edges', min: 0, max: 1, step: 0.005, default: 0.12 },
    { key: 'blur', label: 'Pre-Smooth', type: 'range', group: 'Edges', min: 0, max: 10, step: 0.1, default: 1 },
    { key: 'thickness', label: 'Thickness', type: 'range', group: 'Edges', min: 0, max: 6, step: 0.1, default: 0.5 },
    { key: 'lineColor', label: 'Line Color', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => v.mode !== 'neon' && v.mode !== 'emboss' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0a0a0a', visibleWhen: (v) => v.mode !== 'overlay' && v.mode !== 'emboss' },
    { key: 'imageMix', label: 'Image Mix', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 0, visibleWhen: (v) => v.mode === 'neon' || v.mode === 'lines' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false, visibleWhen: (v) => v.mode === 'neon' || v.mode === 'lines' },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const mode = params.mode as string;
    const strength = params.strength as number;
    const thr = params.threshold as number;
    const lum = boxBlur(toLuma(src), width, height, (params.blur as number) * unit, 2);
    const slope = unit / 1.08;
    let e = new Float32Array(width * height);
    let gxMap: Float32Array | null = null;
    if (mode === 'emboss') gxMap = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const tl = lum[i - width - 1], t = lum[i - width], tr = lum[i - width + 1];
        const l = lum[i - 1], r = lum[i + 1];
        const bl = lum[i + width - 1], b = lum[i + width], br = lum[i + width + 1];
        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        // Per unit, not per pixel: the same edge spans more pixels at 4K.
        e[i] = Math.hypot(gx, gy) * slope;
        if (gxMap) gxMap[i] = (gx + gy) * slope;
      }
    }
    const thick = (params.thickness as number) * unit;
    if (thick > 0.3) {
      e = boxBlur(e, width, height, thick, 1);
      for (let i = 0; i < e.length; i++) e[i] *= 1 + thick;
    }

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    const line = hexToRgb(params.lineColor as string);
    const bg = hexToRgb(params.background as string);
    const mix = params.imageMix as number;
    const transparent = params.transparent as boolean;
    for (let i = 0, o = 0; i < e.length; i++, o += 4) {
      let v = (e[i] - thr) * strength;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (mode === 'emboss') {
        const g = clamp255(128 + gxMap![i] * strength * 90);
        op[o] = op[o + 1] = op[o + 2] = g;
        op[o + 3] = 255;
        continue;
      }
      if (mode === 'overlay') {
        op[o] = d[o] + (line[0] - d[o]) * v;
        op[o + 1] = d[o + 1] + (line[1] - d[o + 1]) * v;
        op[o + 2] = d[o + 2] + (line[2] - d[o + 2]) * v;
        op[o + 3] = 255;
        continue;
      }
      const fr = mode === 'neon' ? Math.min(255, d[o] * 1.4 + 30) : line[0];
      const fg = mode === 'neon' ? Math.min(255, d[o + 1] * 1.4 + 30) : line[1];
      const fb = mode === 'neon' ? Math.min(255, d[o + 2] * 1.4 + 30) : line[2];
      const br = bg[0] + (d[o] - bg[0]) * mix, bgc = bg[1] + (d[o + 1] - bg[1]) * mix, bb = bg[2] + (d[o + 2] - bg[2]) * mix;
      if (transparent) {
        op[o] = fr; op[o + 1] = fg; op[o + 2] = fb;
        op[o + 3] = Math.max(v * 255, mix * 255);
      } else {
        op[o] = br + (fr - br) * v;
        op[o + 1] = bgc + (fg - bgc) * v;
        op[o + 2] = bb + (fb - bb) * v;
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
