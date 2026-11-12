import type { EffectDefinition } from './types';
import { cleanup, removalMask } from '../cleanup/engine';

/** Lays the chosen reconstruction over the image. Outside the mask, nothing changes. */
export const airCleanup: EffectDefinition = {
  id: 'airCleanup',
  name: 'AirFx Cleanup',
  category: 'key',
  description: 'Removes a selected object and reconstructs what was behind it, from the image itself.',
  params: [
    { key: 'strength', label: 'Reconstruction Strength', type: 'range', group: 'Result', min: 0, max: 1, step: 0.01, default: 1, hint: 'Lowering this shows the original through the fill.' },
    {
      key: 'view', label: 'View', type: 'select', group: 'Result', default: 'final',
      options: [{ value: 'final', label: 'Reconstructed' }, { value: 'mask', label: 'Removal Mask' }, { value: 'patch', label: 'Filled Region Only' }, { value: 'original', label: 'Original' }],
    },
  ],
  render({ src, ctx, width: w, height: h, params: p, time }) {
    if (p.view === 'mask') {
      const m = removalMask(w, h, time, 0), out = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const k = i * 4;
        if (m[i]) { out.data[k] = 198; out.data[k + 1] = 255; out.data[k + 2] = 46; } else { out.data[k] = src.data[k] * 0.45; out.data[k + 1] = src.data[k + 1] * 0.45; out.data[k + 2] = src.data[k + 2] * 0.45; }
        out.data[k + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    if (p.view !== 'patch') ctx.putImageData(src, 0, 0);
    const a = cleanup.active, f = cleanup.at(time);
    if (!a || !f || p.view === 'original') return;
    const kx = w / a.width, ky = h / a.height;
    ctx.save();
    ctx.globalAlpha = p.strength as number;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.bitmap, f.x * kx, f.y * ky, f.w * kx, f.h * ky);
    ctx.restore();
  },
};
