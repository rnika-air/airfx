import type { EffectDefinition } from './types';
import { adjust, createRng, luminance, sampleIndex } from '../utils/imageProcessing';

/**
 * Stippling: pen-and-ink dot shading. Candidates sit on a jittered grid
 * (an even, blue-noise-like spread) and survive with probability equal to
 * local darkness, so tone is carried by dot density rather than dot size.
 */
export const stippling: EffectDefinition = {
  id: 'stippling',
  name: 'Stippling',
  category: 'pattern',
  description: 'Ink-dot shading where density carries the tone.',
  supportsTransparency: true,
  audioDefaults: { dotSize: { band: 'bass', amount: 0.25 }, jitter: { band: 'treble', amount: 0.4 } },
  params: [
    { key: 'spacing', label: 'Spacing', type: 'range', group: 'Distribution', min: 1.5, max: 20, step: 0.1, default: 3.5 },
    { key: 'jitter', label: 'Jitter', type: 'range', group: 'Distribution', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Distribution', default: 7 },
    { key: 'dotSize', label: 'Dot Size', type: 'range', group: 'Dots', min: 0.3, max: 10, step: 0.05, default: 1.6 },
    { key: 'sizeVar', label: 'Size Variation', type: 'range', group: 'Dots', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.3 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.6, max: 0.6, step: 0.01, default: 0.05 },
    { key: 'gamma', label: 'Tone Curve', type: 'range', group: 'Tone', min: 0.3, max: 3, step: 0.01, default: 1.4, hint: 'Higher values clear the highlights.' },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Tone', default: false },
    {
      key: 'colorMode', label: 'Color Mode', type: 'select', group: 'Color', default: 'ink',
      options: [{ value: 'ink', label: 'Ink' }, { value: 'original', label: 'Original' }],
    },
    { key: 'ink', label: 'Ink Color', type: 'color', group: 'Color', default: '#121212', visibleWhen: (v) => v.colorMode === 'ink' },
    { key: 'paper', label: 'Paper Color', type: 'color', group: 'Color', default: '#f2efe6' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const s = Math.max(1.2, (params.spacing as number) * unit);
    const jitter = params.jitter as number;
    const rng = createRng(params.seed as number);
    const r0 = ((params.dotSize as number) * unit) / 2;
    const sizeVar = params.sizeVar as number;
    const contrast = params.contrast as number;
    const brightness = params.brightness as number;
    const gamma = params.gamma as number;
    const invert = params.invert as boolean;
    const original = params.colorMode === 'original';
    const d = src.data;

    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = params.paper as string;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = params.ink as string;
    if (!original) ctx.beginPath();

    for (let gy = 0; gy * s < height; gy++) {
      for (let gx = 0; gx * s < width; gx++) {
        const x = (gx + 0.5 + (rng() - 0.5) * jitter) * s;
        const y = (gy + 0.5 + (rng() - 0.5) * jitter) * s;
        const keep = rng();
        const sz = rng();
        const i = sampleIndex(width, height, x, y);
        let tone = 1 - adjust(luminance(d[i], d[i + 1], d[i + 2]), brightness, contrast);
        if (invert) tone = 1 - tone;
        if (keep > Math.pow(tone, gamma)) continue;
        const r = r0 * (1 - sizeVar * 0.5 + sizeVar * sz);
        if (original) {
          ctx.fillStyle = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
    }
    if (!original) ctx.fill();
  },
};
