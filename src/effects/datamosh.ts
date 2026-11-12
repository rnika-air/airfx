import type { EffectDefinition } from './types';
import { valueNoise } from '../utils/imageProcessing';

/**
 * Datamosh: imitates a video codec that lost its keyframes. Each frame is
 * rebuilt from the *previous output* pushed along per-block motion vectors,
 * so pixels smear and melt; only a little of the fresh image bleeds in until
 * the next keyframe snaps it back. On video, blocks that change a lot move
 * the most — like real P-frame moshing.
 *
 * It keeps the previous frame between renders, so it needs playback (or an
 * animation export) to develop; a still, paused frame shows the source.
 */
let state: { w: number; h: number; key: number; t: number; out: Uint8ClampedArray; prevSrc: Uint8ClampedArray } | null = null;

export const datamosh: EffectDefinition = {
  id: 'datamosh',
  name: 'Datamosh',
  category: 'distortion',
  description: 'Codec-style melting and smearing. Press play to watch it develop.',
  animated: () => true,
  audioDefaults: { amount: { band: 'bass', amount: 0.3 }, bleed: { band: 'beat', amount: 0.3 } },
  params: [
    { key: 'block', label: 'Block Size', type: 'range', group: 'Motion', min: 4, max: 96, step: 1, default: 16 },
    { key: 'amount', label: 'Smear', type: 'range', group: 'Motion', min: 0, max: 30, step: 0.1, default: 4 },
    { key: 'angle', label: 'Drift Angle', type: 'range', group: 'Motion', min: 0, max: 359, step: 1, default: 0, unit: '°' },
    { key: 'bias', label: 'Drift Strength', type: 'range', group: 'Motion', min: 0, max: 1, step: 0.01, default: 0.3 },
    { key: 'turbulence', label: 'Turbulence', type: 'range', group: 'Motion', min: 0.01, max: 1, step: 0.01, default: 0.25 },
    { key: 'bleed', label: 'Fresh Bleed', type: 'range', group: 'Codec', min: 0, max: 0.6, step: 0.005, default: 0.04, hint: 'How much of the new frame shows through each update.' },
    { key: 'motionOnly', label: 'Mosh Moving Areas Only', type: 'toggle', group: 'Codec', default: false, hint: 'Video: only blocks that changed get smeared.' },
    { key: 'keyframe', label: 'Keyframe Every', type: 'range', group: 'Codec', min: 0, max: 20, step: 0.1, default: 4, unit: 's', hint: '0 = never refresh.' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Codec', default: 2 },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const kf = params.keyframe as number;
    const key = kf > 0 ? Math.floor(time / kf) : 0;
    const n = width * height * 4;
    const fresh = !state || state.w !== width || state.h !== height || state.key !== key || time < state.t - 1e-3;
    if (fresh) {
      state = { w: width, h: height, key, t: time, out: new Uint8ClampedArray(src.data), prevSrc: new Uint8ClampedArray(src.data) };
      ctx.putImageData(src, 0, 0);
      return;
    }
    const st = state!;
    if (Math.abs(time - st.t) < 1e-4) {
      // same frame re-rendered (e.g. a param tweak while paused): show the current state
      ctx.putImageData(new ImageData(new Uint8ClampedArray(st.out), width, height), 0, 0);
      return;
    }
    const bs = Math.max(2, Math.round((params.block as number) * unit));
    const amt = (params.amount as number) * unit;
    const a = ((params.angle as number) * Math.PI) / 180;
    const bias = params.bias as number;
    const turb = params.turbulence as number;
    const bleed = params.bleed as number;
    const motionOnly = params.motionOnly as boolean;
    const seed = params.seed as number;
    const s = src.data, prev = st.out, next = new Uint8ClampedArray(n);
    const cols = Math.ceil(width / bs), rows = Math.ceil(height / bs);
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        // motion vector for this block
        const nx = valueNoise(bx * turb, by * turb + time * 0.7, seed) - 0.5;
        const ny = valueNoise(bx * turb + 40, by * turb - time * 0.7, seed + 9) - 0.5;
        let vx = (nx * 2 * (1 - bias) + Math.cos(a) * bias) * amt;
        let vy = (ny * 2 * (1 - bias) + Math.sin(a) * bias) * amt;
        let mix = bleed;
        if (motionOnly) {
          let diff = 0, cnt = 0;
          for (let y = by * bs; y < Math.min(height, by * bs + bs); y += 2)
            for (let x = bx * bs; x < Math.min(width, bx * bs + bs); x += 2) {
              const i = (y * width + x) * 4;
              diff += Math.abs(s[i] - st.prevSrc[i]) + Math.abs(s[i + 1] - st.prevSrc[i + 1]);
              cnt++;
            }
          const m = Math.min(1, diff / (cnt * 40));
          vx *= m;
          vy *= m;
          mix = bleed + (1 - m) * 0.5; // still areas stay closer to the source
        }
        const ivx = Math.round(vx), ivy = Math.round(vy);
        for (let y = by * bs; y < Math.min(height, by * bs + bs); y++) {
          const sy = Math.min(height - 1, Math.max(0, y - ivy));
          for (let x = bx * bs; x < Math.min(width, bx * bs + bs); x++) {
            const sx = Math.min(width - 1, Math.max(0, x - ivx));
            const i = (y * width + x) * 4, j = (sy * width + sx) * 4;
            next[i] = prev[j] + (s[i] - prev[j]) * mix;
            next[i + 1] = prev[j + 1] + (s[i + 1] - prev[j + 1]) * mix;
            next[i + 2] = prev[j + 2] + (s[i + 2] - prev[j + 2]) * mix;
            next[i + 3] = 255;
          }
        }
      }
    }
    st.out = next;
    st.prevSrc = new Uint8ClampedArray(s);
    st.t = time;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(next), width, height), 0, 0);
  },
};
