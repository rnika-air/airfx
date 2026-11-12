import type { EffectDefinition } from './types';
import { BLEND_OPTIONS, blendChannel, fbm, hash2, hexToRgb, type BlendMode } from '../utils/imageProcessing';

/**
 * Noise: procedural fractal noise (smooth, ridged, turbulent or static)
 * generated at a reduced grid and interpolated, then blended over the image.
 */
export const noise: EffectDefinition = {
  id: 'noise',
  name: 'Noise',
  category: 'texture',
  description: 'Procedural fractal noise fields blended over the image.',
  animated: (p) => (p.speed as number) > 0 || p.type === 'static',
  audioDefaults: { amount: { band: 'level', amount: 0.4 }, scale: { band: 'bass', amount: -0.1 } },
  params: [
    {
      key: 'type', label: 'Type', type: 'select', group: 'Noise', default: 'fbm',
      options: [
        { value: 'fbm', label: 'Smooth (fBm)' },
        { value: 'ridged', label: 'Ridged' },
        { value: 'turbulence', label: 'Turbulence' },
        { value: 'contour', label: 'Contours' },
        { value: 'static', label: 'TV Static' },
      ],
    },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Noise', min: 2, max: 800, step: 1, default: 120 },
    { key: 'octaves', label: 'Octaves', type: 'range', group: 'Noise', min: 1, max: 7, step: 1, default: 4 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Noise', min: 0.2, max: 4, step: 0.01, default: 1.3 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Noise', default: 11 },
    { key: 'speed', label: 'Animation Speed', type: 'range', group: 'Noise', min: 0, max: 3, step: 0.01, default: 0 },
    { key: 'amount', label: 'Amount', type: 'range', group: 'Mix', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'blend', label: 'Blend Mode', type: 'select', group: 'Mix', default: 'overlay', options: BLEND_OPTIONS },
    {
      key: 'colorMode', label: 'Colors', type: 'select', group: 'Mix', default: 'mono',
      options: [{ value: 'mono', label: 'Mono' }, { value: 'rgb', label: 'RGB' }, { value: 'duo', label: 'Two-Color' }],
    },
    { key: 'colorA', label: 'Color A', type: 'color', group: 'Mix', default: '#0b0b0b', visibleWhen: (v) => v.colorMode === 'duo' },
    { key: 'colorB', label: 'Color B', type: 'color', group: 'Mix', default: '#c6ff2e', visibleWhen: (v) => v.colorMode === 'duo' },
  ],
  render({ src, ctx, width, height, params, unit, time, frame }) {
    const type = params.type as string;
    const sc = Math.max(0.5, (params.scale as number) * unit);
    const oct = params.octaves as number;
    const contrast = params.contrast as number;
    const seed = params.seed as number;
    const t = time * (params.speed as number) * 0.5;
    const amount = params.amount as number;
    const blend = params.blend as BlendMode;
    const colorMode = params.colorMode as string;
    const A = hexToRgb(params.colorA as string), B = hexToRgb(params.colorB as string);

    const field = (u: number, v: number, s: number) => {
      let n = fbm(u + t, v - t * 0.7, s, oct);
      if (type === 'ridged') n = 1 - Math.abs(n * 2 - 1);
      else if (type === 'turbulence') n = Math.abs(n * 2 - 1);
      else if (type === 'contour') n = 0.5 + 0.5 * Math.sin(n * 40);
      n = (n - 0.5) * contrast + 0.5;
      return n < 0 ? 0 : n > 1 ? 1 : n;
    };

    // Coarse grid (≈2px) + bilinear lookup keeps fBm affordable at full res.
    const step = type === 'static' ? 1 : Math.max(1, Math.min(4, Math.floor(sc / 8)));
    const gw = Math.ceil(width / step) + 1, gh = Math.ceil(height / step) + 1;
    const chans = colorMode === 'rgb' ? 3 : 1;
    const grid = new Float32Array(gw * gh * chans);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++)
        for (let c = 0; c < chans; c++) {
          const gi = (y * gw + x) * chans + c;
          if (type === 'static') {
            const v = hash2(x, y, frame * 977 + seed + c * 41);
            grid[gi] = Math.min(1, Math.max(0, (v - 0.5) * contrast + 0.5));
          } else grid[gi] = field((x * step) / sc, (y * step) / sc, seed + c * 1009);
        }

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    for (let y = 0; y < height; y++) {
      const gy = y / step, y0 = gy | 0, fy = gy - y0;
      for (let x = 0; x < width; x++) {
        const gx = x / step, x0 = gx | 0, fx = gx - x0;
        const o = (y * width + x) * 4;
        for (let c = 0; c < 3; c++) {
          const ch = chans === 3 ? c : 0;
          const i00 = (y0 * gw + x0) * chans + ch;
          const a = grid[i00], b = grid[i00 + chans], cc = grid[i00 + gw * chans], dd = grid[i00 + gw * chans + chans];
          const n = (a + (b - a) * fx) * (1 - fy) + (cc + (dd - cc) * fx) * fy;
          const top = colorMode === 'duo' ? A[c] + (B[c] - A[c]) * n : n * 255;
          const base = d[o + c];
          op[o + c] = base + (blendChannel(blend, base, top) - base) * amount;
        }
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
