import type { EffectDefinition } from './types';
import { adjust, clamp01, hexToRgb, luminance } from '../utils/imageProcessing';

/**
 * Patterns: tone is translated into a graphic screen. Every pattern is a
 * threshold field p(x, y) ∈ [0, 1]; a pixel is inked where darkness > p,
 * so lines thicken, rings swell and checks grow as the image gets darker.
 * Crosshatch layers extra line directions as tone deepens.
 */
export const patterns: EffectDefinition = {
  id: 'patterns',
  name: 'Patterns',
  category: 'pattern',
  description: 'Tone rendered as lines, hatching, waves, rings, checks.',
  audioDefaults: { amplitude: { band: 'bass', amount: 0.4 }, phase: { band: 'level', amount: 0.3 } },
  animated: (p) => (p.speed as number) > 0,
  params: [
    {
      key: 'pattern', label: 'Pattern', type: 'select', group: 'Pattern', default: 'lines',
      options: [
        { value: 'lines', label: 'Lines' },
        { value: 'crosshatch', label: 'Crosshatch' },
        { value: 'waves', label: 'Waves' },
        { value: 'zigzag', label: 'Zigzag' },
        { value: 'rings', label: 'Rings' },
        { value: 'squares', label: 'Squares' },
        { value: 'diamonds', label: 'Diamonds' },
        { value: 'spiral', label: 'Spiral' },
      ],
    },
    { key: 'scale', label: 'Scale', type: 'range', group: 'Pattern', min: 2, max: 60, step: 0.5, default: 9 },
    { key: 'angle', label: 'Angle', type: 'range', group: 'Pattern', min: 0, max: 180, step: 0.5, default: 35, unit: '°' },
    {
      key: 'amplitude', label: 'Wave Amplitude', type: 'range', group: 'Pattern', min: 0, max: 3, step: 0.01, default: 0.6,
      visibleWhen: (v) => v.pattern === 'waves' || v.pattern === 'zigzag',
    },
    { key: 'phase', label: 'Phase', type: 'range', group: 'Pattern', min: 0, max: 1, step: 0.005, default: 0 },
    { key: 'speed', label: 'Drift Speed', type: 'range', group: 'Pattern', min: 0, max: 3, step: 0.01, default: 0 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.2 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.6, max: 0.6, step: 0.01, default: 0 },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Tone', default: false },
    {
      key: 'colorMode', label: 'Ink Mode', type: 'select', group: 'Color', default: 'ink',
      options: [{ value: 'ink', label: 'Ink' }, { value: 'original', label: 'Original' }],
    },
    { key: 'ink', label: 'Ink Color', type: 'color', group: 'Color', default: '#111111', visibleWhen: (v) => v.colorMode === 'ink' },
    { key: 'paper', label: 'Paper Color', type: 'color', group: 'Color', default: '#efece2' },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const pattern = params.pattern as string;
    const s = Math.max(2, (params.scale as number) * unit);
    const a = ((params.angle as number) * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const amp = (params.amplitude as number) * s;
    const phase = (params.phase as number) + time * (params.speed as number);
    const contrast = params.contrast as number;
    const brightness = params.brightness as number;
    const invert = params.invert as boolean;
    const original = params.colorMode === 'original';
    const ink = hexToRgb(params.ink as string);
    const paper = hexToRgb(params.paper as string);
    const cx = width / 2, cy = height / 2;
    const sharp = s / 1.6; // ≈1px anti-aliased edge

    const tri = (v: number) => {
      const f = v - Math.floor(v);
      return Math.abs(2 * f - 1); // 0 at line centre → 1 between lines
    };
    // Crosshatch layer directions (relative to angle)
    const hatch = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4].map((o) => [Math.cos(a + o), Math.sin(a + o)]);

    const sp = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    for (let y = 0; y < height; y++) {
      const py = y - cy;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        let t = 1 - adjust(luminance(sp[i], sp[i + 1], sp[i + 2]), brightness, contrast);
        if (invert) t = 1 - t;
        const px = x - cx;
        const u = px * ca + py * sa;
        const v = -px * sa + py * ca;
        let cov: number;
        if (pattern === 'crosshatch') {
          cov = 0;
          for (let k = 0; k < 4; k++) {
            const start = k * 0.22;
            if (t <= start) break;
            const d = tri((px * hatch[k][0] + py * hatch[k][1]) / s + phase);
            const width01 = Math.min(1, (t - start) * 2.2) * 0.5;
            cov = Math.max(cov, clamp01((width01 - d) * sharp + 0.5));
          }
        } else {
          let p: number;
          switch (pattern) {
            case 'waves':
              p = tri((v + Math.sin((u / s) * 0.9) * amp) / s + phase);
              break;
            case 'zigzag':
              p = tri((v + tri(u / (s * 2)) * amp * 2) / s + phase);
              break;
            case 'rings':
              p = tri(Math.hypot(px, py) / s - phase);
              break;
            case 'squares':
              p = Math.max(tri(u / s + phase), tri(v / s));
              break;
            case 'diamonds':
              p = (tri(u / s + phase) + tri(v / s)) / 2;
              break;
            case 'spiral':
              p = tri(Math.hypot(px, py) / s + Math.atan2(py, px) / (Math.PI * 2) - phase);
              break;
            default:
              p = tri(v / s + phase);
          }
          cov = clamp01((t - p) * sharp + 0.5);
        }
        const fr = original ? sp[i] : ink[0], fg = original ? sp[i + 1] : ink[1], fb = original ? sp[i + 2] : ink[2];
        op[i] = paper[0] + (fr - paper[0]) * cov;
        op[i + 1] = paper[1] + (fg - paper[1]) * cov;
        op[i + 2] = paper[2] + (fb - paper[2]) * cov;
        op[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
