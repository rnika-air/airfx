import type { EffectDefinition } from './types';
import { sampleBilinear } from '../utils/imageProcessing';

/**
 * Distort: geometric warps by inverse mapping — for every output pixel we
 * compute where to read in the source, then sample bilinearly.
 */
export const distort: EffectDefinition = {
  id: 'distort',
  name: 'Distort',
  category: 'distortion',
  description: 'Waves, ripples, swirls, bulges and grid warps.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { amount: { band: 'bass', amount: 0.35 } },
  params: [
    {
      key: 'mode', label: 'Mode', type: 'select', group: 'Warp', default: 'wave',
      options: [
        { value: 'wave', label: 'Wave' },
        { value: 'ripple', label: 'Ripple' },
        { value: 'swirl', label: 'Swirl' },
        { value: 'bulge', label: 'Bulge / Pinch' },
        { value: 'grid', label: 'Grid Warp' },
        { value: 'shear', label: 'Shear Bands' },
      ],
    },
    { key: 'amount', label: 'Amount', type: 'range', group: 'Warp', min: -1, max: 1, step: 0.005, default: 0.35 },
    { key: 'frequency', label: 'Frequency', type: 'range', group: 'Warp', min: 0.5, max: 40, step: 0.1, default: 6 },
    { key: 'angle', label: 'Direction', type: 'range', group: 'Warp', min: 0, max: 179, step: 0.5, default: 0, unit: '°', visibleWhen: (v) => v.mode === 'wave' || v.mode === 'shear' },
    { key: 'phase', label: 'Phase', type: 'range', group: 'Warp', min: 0, max: 1, step: 0.005, default: 0 },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Warp', min: 0, max: 3, step: 0.01, default: 0 },
    { key: 'cx', label: 'Center X', type: 'range', group: 'Center', min: 0, max: 1, step: 0.005, default: 0.5, visibleWhen: (v) => ['ripple', 'swirl', 'bulge'].includes(v.mode as string) },
    { key: 'cy', label: 'Center Y', type: 'range', group: 'Center', min: 0, max: 1, step: 0.005, default: 0.5, visibleWhen: (v) => ['ripple', 'swirl', 'bulge'].includes(v.mode as string) },
    { key: 'radius', label: 'Radius', type: 'range', group: 'Center', min: 0.05, max: 1.5, step: 0.005, default: 0.6, visibleWhen: (v) => ['ripple', 'swirl', 'bulge'].includes(v.mode as string) },
    {
      key: 'edges', label: 'Edges', type: 'select', group: 'Output', default: 'clamp',
      options: [{ value: 'clamp', label: 'Clamp' }, { value: 'wrap', label: 'Wrap' }],
    },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const mode = params.mode as string;
    const amount = params.amount as number;
    const freq = params.frequency as number;
    const phase = ((params.phase as number) + time * (params.speed as number) * 0.25) * Math.PI * 2;
    const ang = ((params.angle as number) * Math.PI) / 180;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const long = Math.max(width, height);
    const cx = (params.cx as number) * width, cy = (params.cy as number) * height;
    const R = (params.radius as number) * long * 0.5;
    const wrap = params.edges === 'wrap';
    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    const k = (Math.PI * 2 * freq) / long;
    const maxDisp = amount * 60 * unit;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sx = x, sy = y;
        switch (mode) {
          case 'wave': {
            // displace perpendicular to the wave direction
            const u = x * ca + y * sa;
            const off = Math.sin(u * k + phase) * maxDisp;
            sx = x - sa * off;
            sy = y + ca * off;
            break;
          }
          case 'ripple': {
            const dx = x - cx, dy = y - cy;
            const r = Math.hypot(dx, dy) || 1;
            const fall = Math.max(0, 1 - r / R);
            const off = Math.sin(r * k - phase) * maxDisp * fall;
            sx = x + (dx / r) * off;
            sy = y + (dy / r) * off;
            break;
          }
          case 'swirl': {
            const dx = x - cx, dy = y - cy;
            const r = Math.hypot(dx, dy);
            const fall = Math.max(0, 1 - r / R);
            const t = amount * 6 * fall * fall + (fall > 0 ? Math.sin(phase) * 0.2 * fall : 0);
            const c = Math.cos(t), s = Math.sin(t);
            sx = cx + dx * c - dy * s;
            sy = cy + dx * s + dy * c;
            break;
          }
          case 'bulge': {
            const dx = x - cx, dy = y - cy;
            const r = Math.hypot(dx, dy);
            if (r < R && r > 0) {
              const n = r / R;
              const p = Math.pow(n, 1 + amount * 1.6 * (1 + Math.sin(phase) * 0.15)) / n;
              sx = cx + dx * p;
              sy = cy + dy * p;
            }
            break;
          }
          case 'grid': {
            sx = x + Math.sin(y * k + phase) * maxDisp * 0.6 + Math.sin(x * k * 0.5 + phase * 0.7) * maxDisp * 0.4;
            sy = y + Math.sin(x * k + phase) * maxDisp * 0.6 + Math.sin(y * k * 0.5 - phase * 0.7) * maxDisp * 0.4;
            break;
          }
          case 'shear': {
            const v = -x * sa + y * ca;
            const band = Math.floor((v * freq) / long + phase / (Math.PI * 2));
            const off = Math.sin(band * 12.9898) * maxDisp * 2;
            sx = x + ca * off;
            sy = y + sa * off;
            break;
          }
        }
        sampleBilinear(d, width, height, sx, sy, op, (y * width + x) * 4, wrap);
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
