import type { EffectDefinition } from './types';
import { hash2, hexToRgb } from '../utils/imageProcessing';

/**
 * Stutter: beat-synced repeat / freeze / gate / strobe, so a clip can be
 * "edited" to the music without cuts. The beat grid comes from BPM +
 * division; a pattern string ("x" = hit, "-" = rest) picks which steps fire.
 *
 * Repeat needs past frames, so a small buffer keeps the frames of the
 * current step's repeat window (only those — memory stays small).
 */

interface Frame { t: number; data: ImageData }
let buf: { w: number; h: number; step: number; frames: Frame[]; lastT: number } | null = null;

export const stutter: EffectDefinition = {
  id: 'stutter',
  name: 'Stutter',
  category: 'animate',
  description: 'Beat-synced repeat, freeze, gate and strobe — edits to the music without cuts.',
  supportsTransparency: true,
  animated: () => true,
  compat: 'video',
  audioDefaults: { chance: { band: 'beat', amount: 0.5 } },
  params: [
    { key: 'bpm', label: 'BPM', type: 'range', group: 'Beat Grid', min: 40, max: 220, step: 0.5, default: 120 },
    {
      key: 'division', label: 'Division', type: 'select', group: 'Beat Grid', default: '2',
      options: [{ value: '0.5', label: '1/2' }, { value: '1', label: '1/4' }, { value: '2', label: '1/8' }, { value: '4', label: '1/16' }, { value: '8', label: '1/32' }],
    },
    { key: 'offset', label: 'Beat Offset', type: 'range', group: 'Beat Grid', min: 0, max: 2, step: 0.005, default: 0, unit: 's', hint: 'Slide the grid to line up with the first beat of your song.' },
    { key: 'pattern', label: 'Pattern', type: 'text', group: 'Beat Grid', default: 'x-x-xx-x', maxLength: 32, hint: 'x = effect on this step, - = play normally. Loops.' },
    {
      key: 'mode', label: 'Mode', type: 'select', group: 'Effect', default: 'repeat',
      options: [
        { value: 'repeat', label: 'Repeat' }, { value: 'freeze', label: 'Freeze' },
        { value: 'gate', label: 'Gate' }, { value: 'strobe', label: 'Strobe' }, { value: 'mixed', label: 'Mixed' },
      ],
    },
    { key: 'repeatLen', label: 'Repeat Length', type: 'range', group: 'Effect', min: 0.05, max: 1, step: 0.01, default: 0.25, hint: 'Fraction of a step that loops (Repeat).', visibleWhen: (v) => v.mode === 'repeat' || v.mode === 'mixed' },
    { key: 'chance', label: 'Chance', type: 'range', group: 'Effect', min: 0, max: 1, step: 0.01, default: 1, hint: 'Probability that an "x" step actually fires.' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Effect', default: 9 },
    { key: 'gateColor', label: 'Gate Color', type: 'color', group: 'Gate', default: '#000000', visibleWhen: (v) => v.mode === 'gate' || v.mode === 'mixed' },
    { key: 'gateClear', label: 'Gate to Transparent', type: 'toggle', group: 'Gate', default: false, visibleWhen: (v) => v.mode === 'gate' || v.mode === 'mixed' },
  ],
  render({ src, ctx, width, height, params, time }) {
    const perBeat = parseFloat(params.division as string) || 2;
    const stepDur = 60 / (params.bpm as number) / perBeat;
    const t = time + (params.offset as number);
    const step = Math.floor(t / stepDur);
    const stepStart = step * stepDur;
    const local = t - stepStart;
    const pattern = ((params.pattern as string) || 'x').replace(/[^x\-.]/gi, '') || 'x';
    const ch = pattern[((step % pattern.length) + pattern.length) % pattern.length];
    const seed = params.seed as number;
    const hit = (ch === 'x' || ch === 'X') && hash2(step, 3, seed) < (params.chance as number);
    let mode = params.mode as string;
    if (mode === 'mixed') mode = ['repeat', 'freeze', 'gate', 'strobe'][Math.floor(hash2(step, 11, seed) * 4)];
    const repeatWin = Math.max(1 / 60, (params.repeatLen as number) * stepDur);

    // Frame buffer: reset on resize, new step, or seeking backwards.
    if (!buf || buf.w !== width || buf.h !== height || buf.step !== step || time < buf.lastT - 1e-3) {
      buf = { w: width, h: height, step, frames: [], lastT: time };
    }
    if (local <= repeatWin + 1e-3 && (!buf.frames.length || time - buf.frames[buf.frames.length - 1].t > 1e-4)) {
      buf.frames.push({ t: local, data: new ImageData(new Uint8ClampedArray(src.data), width, height) });
      if (buf.frames.length > 40) buf.frames.shift();
    }
    buf.lastT = time;

    if (!hit) {
      ctx.putImageData(src, 0, 0);
      return;
    }
    if (mode === 'gate') {
      ctx.clearRect(0, 0, width, height);
      if (!params.gateClear) {
        ctx.fillStyle = params.gateColor as string;
        ctx.fillRect(0, 0, width, height);
      }
      return;
    }
    if (mode === 'strobe') {
      const out = ctx.createImageData(width, height);
      const d = src.data, o = out.data;
      const flash = Math.floor(local / (stepDur / 4)) % 2 === 0;
      const [gr, gg, gb] = hexToRgb(params.gateColor as string);
      for (let i = 0; i < d.length; i += 4) {
        o[i] = flash ? 255 - d[i] : gr;
        o[i + 1] = flash ? 255 - d[i + 1] : gg;
        o[i + 2] = flash ? 255 - d[i + 2] : gb;
        o[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    // repeat / freeze: pick a buffered frame from the start of this step
    const want = mode === 'freeze' ? 0 : local % repeatWin;
    let best: Frame | null = null;
    for (const f of buf.frames) if (f.t <= want + 1e-4) best = f;
    ctx.putImageData(best ? best.data : src, 0, 0);
  },
};
