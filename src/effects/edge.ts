import type { EffectDefinition } from './types';
import { boxBlur, clamp255, createCanvas, get2d, hexToRgb, toLuma } from '../utils/imageProcessing';

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
  render({ src, srcCanvas, ctx, width, height, params, unit }) {
    const mode = params.mode as string;
    const strength = params.strength as number;
    const thr = params.threshold as number;
    // Edges are found on a copy at a fixed size, one pixel per unit (1000 px on
    // the long side), then scaled to the output. Lines then have the same
    // weight in the preview and in a 4K export, and fine texture that only a
    // large export contains does not add lines the preview lacks.
    const aw = Math.max(8, Math.round(width / unit)), ah = Math.max(8, Math.round(height / unit));
    const soft = createCanvas(aw, ah), sg = get2d(soft, true);
    sg.filter = `blur(${(Math.max(0.6, params.blur as number) * 0.6).toFixed(2)}px)`;
    sg.imageSmoothingQuality = 'high';
    sg.drawImage(srcCanvas as HTMLCanvasElement, 0, 0, aw, ah);
    const lum = toLuma(sg.getImageData(0, 0, aw, ah));
    soft.width = soft.height = 1;
    let ea = new Float32Array(aw * ah);
    let ga: Float32Array | null = mode === 'emboss' ? new Float32Array(aw * ah) : null;
    for (let y = 1; y < ah - 1; y++) {
      for (let x = 1; x < aw - 1; x++) {
        const i = y * aw + x;
        const tl = lum[i - aw - 1], t = lum[i - aw], tr = lum[i - aw + 1];
        const l = lum[i - 1], r = lum[i + 1];
        const bl = lum[i + aw - 1], b = lum[i + aw], br = lum[i + aw + 1];
        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        ea[i] = Math.hypot(gx, gy) / 1.08;
        if (ga) ga[i] = (gx + gy) / 1.08;
      }
    }
    const thick = params.thickness as number;
    if (thick > 0.3) {
      ea = boxBlur(ea, aw, ah, thick, 1);
      for (let i = 0; i < ea.length; i++) ea[i] *= 1 + thick;
    }
    // Back to the output size, smoothly.
    const up = (A: Float32Array) => {
      const o = new Float32Array(width * height), kx = aw / width, ky = ah / height;
      for (let y = 0; y < height; y++) {
        const sy = Math.min(ah - 1.001, Math.max(0, (y + 0.5) * ky - 0.5)), y0 = sy | 0, fy = sy - y0;
        for (let x = 0; x < width; x++) {
          const sx = Math.min(aw - 1.001, Math.max(0, (x + 0.5) * kx - 0.5)), x0 = sx | 0, fx = sx - x0, i = y0 * aw + x0;
          o[y * width + x] = (A[i] + (A[i + 1] - A[i]) * fx) * (1 - fy) + (A[i + aw] + (A[i + aw + 1] - A[i + aw]) * fx) * fy;
        }
      }
      return o;
    };
    const e = up(ea), gxMap = ga ? up(ga) : null;

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
