import type { EffectDefinition, ParamDef, ParamValues, RenderInput } from '../types';
import { defaultParams } from '../types';
import { boxBlur, clamp255, createCanvas, get2d, toLuma } from '../../utils/imageProcessing';
import { blackWhite, clarity, colorBalance, colorVibrance, curves, hueSat, levels, light } from './adjustments';
import { invert } from '../colorEffects';
import { filmGrain } from '../filmGrain';
import { parseCurves } from './core';

/**
 * The Adjust tab: one always-available adjustment pass that sits before or
 * after the effect stack. It reuses the existing adjustment renderers, so a
 * slider here does exactly what the same slider does as a stack step.
 */

const r = (key: string, label: string, min: number, max: number, step: number, def: number, group: string, unit?: string): ParamDef => ({ key, label, type: 'range', min, max, step, default: def, group, unit });
const BAL = (['shadows', 'midtones', 'highlights'] as const).flatMap((t) => {
  const g = `Color Balance · ${t[0].toUpperCase()}${t.slice(1)}`;
  return [r(`${t}CR`, 'Cyan ↔ Red', -100, 100, 1, 0, g), r(`${t}MG`, 'Magenta ↔ Green', -100, 100, 1, 0, g), r(`${t}YB`, 'Yellow ↔ Blue', -100, 100, 1, 0, g)];
});

export const ADJUST_PARAMS: ParamDef[] = [
  r('exposure', 'Exposure', -3, 3, 0.01, 0, 'Light', 'EV'),
  r('brightness', 'Brightness', -100, 100, 1, 0, 'Light'),
  r('contrast', 'Contrast', -100, 100, 1, 0, 'Light'),
  r('highlights', 'Highlights', -100, 100, 1, 0, 'Light'),
  r('shadows', 'Shadows', -100, 100, 1, 0, 'Light'),
  r('whites', 'Whites', -100, 100, 1, 0, 'Light'),
  r('blacks', 'Blacks', -100, 100, 1, 0, 'Light'),
  r('gamma', 'Gamma', 0.1, 5, 0.01, 1, 'Tone'),
  r('lvBlack', 'Levels Black Point', 0, 253, 1, 0, 'Tone'),
  r('lvWhite', 'Levels White Point', 2, 255, 1, 255, 'Tone'),
  { key: 'curves', label: 'Curves', type: 'custom', editor: 'curves', group: 'Tone', default: '' },
  r('temperature', 'Temperature', -100, 100, 1, 0, 'Color'),
  r('tint', 'Tint', -100, 100, 1, 0, 'Color'),
  r('saturation', 'Saturation', -100, 100, 1, 0, 'Color'),
  r('vibrance', 'Vibrance', -100, 100, 1, 0, 'Color'),
  r('hue', 'Hue', -180, 180, 1, 0, 'Color', '°'),
  r('sharpness', 'Sharpness', 0, 200, 1, 0, 'Detail'),
  { ...r('sharpRadius', 'Sharpen Radius', 0.5, 6, 0.1, 1.2, 'Detail'), visibleWhen: (v) => (v.sharpness as number) > 0 },
  r('clarity', 'Clarity', -100, 100, 1, 0, 'Detail'),
  ...BAL,
  { key: 'preserve', label: 'Preserve Luminosity', type: 'toggle', default: true, group: 'Color Balance · Highlights' },
  { key: 'bw', label: 'Black & White', type: 'toggle', default: false, group: 'Black & White' },
  { ...r('bwReds', 'Reds', -200, 300, 1, 40, 'Black & White', '%'), visibleWhen: (v) => v.bw === true },
  { ...r('bwYellows', 'Yellows', -200, 300, 1, 60, 'Black & White', '%'), visibleWhen: (v) => v.bw === true },
  { ...r('bwGreens', 'Greens', -200, 300, 1, 40, 'Black & White', '%'), visibleWhen: (v) => v.bw === true },
  { ...r('bwBlues', 'Blues', -200, 300, 1, 20, 'Black & White', '%'), visibleWhen: (v) => v.bw === true },
  { key: 'bwTintOn', label: 'Tint The Mono', type: 'toggle', default: false, group: 'Black & White', visibleWhen: (v) => v.bw === true },
  { key: 'bwTint', label: 'Tint Color', type: 'color', default: '#d9b98c', group: 'Black & White', visibleWhen: (v) => v.bw === true && v.bwTintOn === true },
  r('invert', 'Invert', 0, 100, 1, 0, 'Invert & Grain', '%'),
  r('grain', 'Grain', 0, 100, 1, 0, 'Invert & Grain'),
  { ...r('grainSize', 'Grain Size', 0.5, 8, 0.1, 1.2, 'Invert & Grain'), visibleWhen: (v) => (v.grain as number) > 0 },
];

const isFlatCurve = (s: string) => {
  if (!s) return true;
  const c = parseCurves(s);
  return ['rgb', 'r', 'g', 'b'].every((k) => (c as unknown as Record<string, number[][]>)[k].every(([x, y]) => Math.abs(x - y) < 1e-3));
};

/** True when these values change nothing. The pass is then skipped entirely. */
export function adjustIsNeutral(p: ParamValues) {
  const d = defaultParams(adjustMaster);
  return ADJUST_PARAMS.every((def) => def.key === 'curves' ? isFlatCurve(p.curves as string) : def.key === 'preserve' || def.key.startsWith('bw') && !p.bw ? true : p[def.key] === d[def.key]);
}

function sharpen(input: RenderInput, amount: number, radius: number) {
  const { src, ctx, width: w, height: h, unit } = input, L = toLuma(src), B = boxBlur(L, w, h, Math.max(1, radius * unit), 2), d = src.data, out = ctx.createImageData(w, h), o = out.data, k = amount / 100 * 2.2;
  for (let i = 0, q = 0; q < L.length; i += 4, q++) {
    const add = (L[q] - B[q]) * 255 * k;
    o[i] = clamp255(d[i] + add); o[i + 1] = clamp255(d[i + 1] + add); o[i + 2] = clamp255(d[i + 2] + add); o[i + 3] = d[i + 3];
  }
  ctx.putImageData(out, 0, 0);
}

export const adjustMaster: EffectDefinition = {
  id: 'adjMaster', name: 'Adjust', category: 'adjust', hidden: true,
  description: 'The Adjust tab: light, tone, colour and detail for the whole image, alongside the effect stack.',
  params: ADJUST_PARAMS,
  animated: (p) => (p.grain as number) > 0,
  render(input) {
    const p = input.params, steps: ((i: RenderInput) => void)[] = [];
    const run = (e: EffectDefinition, v: ParamValues) => (i: RenderInput) => e.render({ ...i, params: { ...defaultParams(e), ...v } });
    if (['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].some((k) => p[k] !== 0))
      steps.push(run(light, { exposure: p.exposure, brightness: p.brightness, contrast: p.contrast, highlights: p.highlights, shadows: p.shadows, whites: p.whites, blacks: p.blacks }));
    if (p.gamma !== 1 || p.lvBlack !== 0 || p.lvWhite !== 255) steps.push(run(levels, { black: p.lvBlack, white: p.lvWhite, gamma: p.gamma }));
    if (!isFlatCurve(p.curves as string)) steps.push(run(curves, { curves: p.curves }));
    if (['temperature', 'tint', 'saturation', 'vibrance'].some((k) => p[k] !== 0)) steps.push(run(colorVibrance, { temperature: p.temperature, tint: p.tint, saturation: p.saturation, vibrance: p.vibrance }));
    if (p.hue !== 0) steps.push(run(hueSat, { hue: p.hue }));
    if (p.clarity !== 0) steps.push(run(clarity, { clarity: p.clarity }));
    if ((p.sharpness as number) > 0) steps.push((i) => sharpen(i, p.sharpness as number, p.sharpRadius as number));
    const bal = BAL.map((d) => d.key);
    if (bal.some((k) => p[k] !== 0)) steps.push(run(colorBalance, { ...Object.fromEntries(bal.map((k) => [k, p[k]])), preserve: p.preserve }));
    if (p.bw) steps.push(run(blackWhite, { reds: p.bwReds, yellows: p.bwYellows, greens: p.bwGreens, cyans: p.bwGreens, blues: p.bwBlues, magentas: p.bwReds, tintOn: p.bwTintOn, tint: p.bwTint }));
    if ((p.invert as number) > 0) steps.push(run(invert, { amount: (p.invert as number) / 100 }));
    if ((p.grain as number) > 0) steps.push(run(filmGrain, { amount: (p.grain as number) / 100, size: p.grainSize, contrast: 1, brightness: 0, vignette: 0 }));
    if (!steps.length) { input.ctx.putImageData(input.src, 0, 0); return; }
    // Each step reads the last one's pixels, through two buffers.
    let src = input.src, srcCanvas = input.srcCanvas;
    const bufs = [createCanvas(input.width, input.height), createCanvas(input.width, input.height)];
    steps.forEach((step, n) => {
      const last = n === steps.length - 1, c = bufs[n % 2], g = get2d(c, true);
      g.clearRect(0, 0, input.width, input.height);
      step({ ...input, src, srcCanvas, ctx: last ? input.ctx : g });
      if (!last) { src = g.getImageData(0, 0, input.width, input.height); srcCanvas = c; }
    });
  },
};
