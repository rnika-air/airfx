import { contentOf, withContent } from '../content/content';
﻿import type { EffectDefinition } from './types';
import { createRng, luminance, sampleIndex } from '../utils/imageProcessing';

/**
 * Stars: twinkling star glints on the bright parts of the image. Candidate
 * points sit on a seeded jittered grid; where the image is brighter than the
 * threshold a star appears, scaled by brightness and pulsing over time.
 */
export const stars: EffectDefinition = withContent({
  id: 'stars',
  name: 'Stars',
  category: 'light',
  description: 'Twinkling star glints on highlights.',
  animated: (p) => (p.twinkle as number) > 0 || (p.spin as number) > 0,
  audioDefaults: { size: { band: 'bass', amount: 0.2 }, threshold: { band: 'level', amount: -0.15 } },
  params: [
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Placement', min: 0, max: 1, step: 0.005, default: 0.72 },
    { key: 'spacing', label: 'Spacing', type: 'range', group: 'Placement', min: 6, max: 160, step: 1, default: 34 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Placement', default: 5 },
    { key: 'size', label: 'Star Size', type: 'range', group: 'Star', min: 4, max: 300, step: 1, default: 46 },
    {
      key: 'rays', label: 'Rays', type: 'select', group: 'Star', default: '4',
      options: [{ value: '4', label: '4' }, { value: '6', label: '6' }, { value: '8', label: '8' }],
    },
    { key: 'thin', label: 'Ray Thickness', type: 'range', group: 'Star', min: 0.02, max: 0.4, step: 0.01, default: 0.1 },
    { key: 'glow', label: 'Glow', type: 'range', group: 'Star', min: 0, max: 1, step: 0.01, default: 0.5 },
    {
      key: 'colorMode', label: 'Color', type: 'select', group: 'Star', default: 'white',
      options: [{ value: 'white', label: 'White' }, { value: 'original', label: 'Original' }, { value: 'custom', label: 'Custom' }],
    },
    { key: 'color', label: 'Star Color', type: 'color', group: 'Star', default: '#c6ff2e', visibleWhen: (v) => v.colorMode === 'custom' },
    { key: 'twinkle', label: 'Twinkle Speed', type: 'range', group: 'Motion', min: 0, max: 6, step: 0.05, default: 1.2 },
    { key: 'spin', label: 'Spin', type: 'range', group: 'Motion', min: 0, max: 2, step: 0.01, default: 0.1 },
    { key: 'dim', label: 'Dim Image', type: 'range', group: 'Image', min: 0, max: 1, step: 0.01, default: 0 },
  ],
  render({ src, srcCanvas, ctx, width, height, params, unit, time }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const dim = params.dim as number;
    if (dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dim})`;
      ctx.fillRect(0, 0, width, height);
    }
    const thr = params.threshold as number;
    const sp = Math.max(4, (params.spacing as number) * unit);
    const maxSize = (params.size as number) * unit;
    const rays = parseInt(params.rays as string, 10) || 4;
    const thin = params.thin as number;
    const glow = params.glow as number;
    const mode = params.colorMode as string;
    const tw = params.twinkle as number;
    const spin = (params.spin as number) * time * Math.PI;
    const rng = createRng(params.seed as number);
    const d = src.data;
    const stamps = contentOf(params, unit);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let placed = 0;
    for (let gy = 0; gy * sp < height; gy++) {
      for (let gx = 0; gx * sp < width; gx++) {
        const x = (gx + rng()) * sp, y = (gy + rng()) * sp;
        const phase = rng() * Math.PI * 2, keep = rng(), rot = rng() * Math.PI;
        const i = sampleIndex(width, height, x, y);
        const l = luminance(d[i], d[i + 1], d[i + 2]);
        if (l < thr || keep > 0.7) continue;
        const strength = thr >= 1 ? 1 : (l - thr) / (1 - thr);
        const pulse = tw > 0 ? 0.35 + 0.65 * Math.max(0, Math.sin(time * tw * Math.PI * 2 + phase)) : 1;
        const s = maxSize * (0.3 + 0.7 * strength) * pulse;
        if (s < 1) continue;
        const col = mode === 'original' ? `${Math.min(255, d[i] + 60)},${Math.min(255, d[i + 1] + 60)},${Math.min(255, d[i + 2] + 60)}` : mode === 'custom' ? hexRgbStr(params.color as string) : '255,255,255';
        if (stamps) {
          stamps.stamp(ctx, placed++, x, y, s * 0.7, col.split(',').map(Number), rot + spin);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          continue;
        }
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot + spin);
        if (glow > 0) {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.45);
          g.addColorStop(0, `rgba(${col},${0.8 * glow})`);
          g.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${col},1)`;
        for (let r = 0; r < rays / 2; r++) {
          const len = s / 2 * (r % 2 ? 0.6 : 1);
          const w = s * thin * 0.5;
          ctx.beginPath();
          ctx.moveTo(0, -len); ctx.lineTo(w, 0); ctx.lineTo(0, len); ctx.lineTo(-w, 0);
          ctx.closePath();
          ctx.fill();
          ctx.rotate(Math.PI / (rays / 2));
        }
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  },
});

function hexRgbStr(hex: string) {
  const n = parseInt(hex.slice(1), 16) || 0;
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
