import type { EffectDefinition } from './types';
import { adjust, cellAverages, clamp255, hash2, hexToRgb, luminance } from '../utils/imageProcessing';

/**
 * Gradients: three ways of turning the image into gradients.
 *  • Cells — the image is cut into a grid; every cell above the threshold
 *    becomes a shape filled with a linear gradient from its colour to the
 *    background, its length set by brightness.
 *  • Mesh — a coarse colour lattice smoothly interpolated (smoothstep), so
 *    the picture dissolves into soft colour fields.
 *  • Bands — a stepped gradient-map (luminance quantised into bands that
 *    each fade internally), poster-like.
 */
export const gradients: EffectDefinition = {
  id: 'gradients',
  name: 'Gradients',
  category: 'adjust',
  description: 'Gradient cells, soft colour meshes and banded ramps.',
  supportsTransparency: true,
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { step: { band: 'bass', amount: 0.15 }, threshold: { band: 'level', amount: -0.25 } },
  params: [
    {
      key: 'mode', label: 'Mode', type: 'select', group: 'Gradient', default: 'cells',
      options: [{ value: 'cells', label: 'Cells' }, { value: 'mesh', label: 'Mesh' }, { value: 'bands', label: 'Bands' }],
    },
    { key: 'step', label: 'Step Size', type: 'range', group: 'Gradient', min: 4, max: 200, step: 0.5, default: 22 },
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Gradient', min: 0, max: 1, step: 0.005, default: 0.15, visibleWhen: (v) => v.mode === 'cells' },
    {
      key: 'shape', label: 'Shape Type', type: 'select', group: 'Gradient', default: 'rect', visibleWhen: (v) => v.mode === 'cells',
      options: [{ value: 'rect', label: 'Rect' }, { value: 'circle', label: 'Circle' }, { value: 'pill', label: 'Pill' }],
    },
    { key: 'angle', label: 'Gradient Angle', type: 'range', group: 'Gradient', min: 0, max: 359, step: 1, default: 90, unit: '°', visibleWhen: (v) => v.mode !== 'mesh' },
    { key: 'bands', label: 'Bands', type: 'range', group: 'Gradient', min: 2, max: 16, step: 1, default: 6, visibleWhen: (v) => v.mode === 'bands' },
    { key: 'speed', label: 'Drift Speed', type: 'range', group: 'Gradient', min: 0, max: 2, step: 0.01, default: 0 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.15 },
    { key: 'saturate', label: 'Saturation Boost', type: 'range', group: 'Tone', min: 0, max: 2, step: 0.01, default: 1.2 },
    { key: 'grain', label: 'Grain', type: 'range', group: 'Tone', min: 0, max: 0.5, step: 0.005, default: 0.06, visibleWhen: (v) => v.mode !== 'cells' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0b0b0b' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false, visibleWhen: (v) => v.mode === 'cells' },
  ],
  render({ src, srcCanvas, ctx, width, height, params, unit, time }) {
    const mode = params.mode as string;
    const step = Math.max(3, (params.step as number) * unit);
    const contrast = params.contrast as number;
    const sat = params.saturate as number;
    const grain = params.grain as number;
    const bg = hexToRgb(params.background as string);
    const drift = time * (params.speed as number);
    const ang = (((params.angle as number) + drift * 60) * Math.PI) / 180;
    const boost = (r: number, g: number, b: number): [number, number, number] => {
      const l = luminance(r, g, b) * 255;
      const t = adjust(l / 255, 0, contrast) * 255 - l;
      return [clamp255(l + (r - l) * sat + t), clamp255(l + (g - l) * sat + t), clamp255(l + (b - l) * sat + t)];
    };

    ctx.clearRect(0, 0, width, height);

    if (mode === 'cells') {
      if (!params.transparent) {
        ctx.fillStyle = params.background as string;
        ctx.fillRect(0, 0, width, height);
      }
      const { data, cols, rows } = cellAverages(srcCanvas, width, height, step);
      const thr = params.threshold as number;
      const shape = params.shape as string;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const bgCss = params.transparent ? 'rgba(0,0,0,0)' : `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 4;
          const l = luminance(data[i], data[i + 1], data[i + 2]);
          if (l < thr) continue;
          const [cr, cg, cb] = boost(data[i], data[i + 1], data[i + 2]);
          const x = c * step, y = r * step, cx = x + step / 2, cy = y + step / 2;
          const len = (step / 2) * (0.35 + l * 0.65);
          const phase = Math.sin(drift * 2 + (c + r) * 0.4) * 0.25;
          const g = ctx.createLinearGradient(cx - dx * len, cy - dy * len, cx + dx * len, cy + dy * len);
          g.addColorStop(0, `rgb(${cr},${cg},${cb})`);
          g.addColorStop(Math.min(1, Math.max(0, 0.75 + phase)), bgCss);
          ctx.fillStyle = g;
          ctx.beginPath();
          if (shape === 'circle') ctx.arc(cx, cy, step / 2, 0, Math.PI * 2);
          else if (shape === 'pill') ctx.roundRect(x + step * 0.08, y, step * 0.84, step, step * 0.42);
          else ctx.rect(x, y, step + 0.5, step + 0.5);
          ctx.fill();
        }
    } else {
      const d = src.data;
      const out = ctx.createImageData(width, height);
      const op = out.data;
      if (mode === 'mesh') {
        const { data, cols, rows } = cellAverages(srcCanvas, width, height, step);
        const s = (t: number) => t * t * (3 - 2 * t);
        for (let y = 0; y < height; y++) {
          let gy = y / step - 0.5 + Math.sin(drift + y / step) * 0.15;
          gy = Math.max(0, Math.min(rows - 1.001, gy));
          const y0 = gy | 0, fy = s(gy - y0);
          for (let x = 0; x < width; x++) {
            let gx = x / step - 0.5 + Math.cos(drift * 0.8 + x / step) * 0.15;
            gx = Math.max(0, Math.min(cols - 1.001, gx));
            const x0 = gx | 0, fx = s(gx - x0);
            const x1 = Math.min(cols - 1, x0 + 1), y1 = Math.min(rows - 1, y0 + 1);
            const o = (y * width + x) * 4;
            const n = grain ? (hash2(x, y, 5) - 0.5) * grain * 255 : 0;
            for (let c = 0; c < 3; c++) {
              const a = data[(y0 * cols + x0) * 4 + c], b = data[(y0 * cols + x1) * 4 + c];
              const e = data[(y1 * cols + x0) * 4 + c], f = data[(y1 * cols + x1) * 4 + c];
              op[o + c] = (a + (b - a) * fx) * (1 - fy) + (e + (f - e) * fx) * fy + n;
            }
            const [r, g, b] = boost(op[o], op[o + 1], op[o + 2]);
            op[o] = r; op[o + 1] = g; op[o + 2] = b; op[o + 3] = 255;
          }
        }
      } else {
        const bands = params.bands as number;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const long = Math.max(width, height);
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            const l = adjust(luminance(d[o], d[o + 1], d[o + 2]), 0, contrast);
            const band = Math.min(bands - 1, Math.floor(l * bands));
            // within each band a directional ramp toward the background
            const ramp = (((x * ca + y * sa) / long) * bands * 0.5 + drift * 0.3) % 1;
            const k = (band + 1) / bands;
            const fade = 0.55 + 0.45 * Math.abs(ramp * 2 - 1);
            const [r, g, b] = boost(d[o], d[o + 1], d[o + 2]);
            const n = grain ? (hash2(x, y, 9) - 0.5) * grain * 255 : 0;
            op[o] = bg[0] + (r * k - bg[0]) * fade + n;
            op[o + 1] = bg[1] + (g * k - bg[1]) * fade + n;
            op[o + 2] = bg[2] + (b * k - bg[2]) * fade + n;
            op[o + 3] = 255;
          }
      }
      ctx.putImageData(out, 0, 0);
    }
  },
};
