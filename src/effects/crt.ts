import type { EffectDefinition } from './types';
import { boxBlur, clamp255, hash2, sampleBilinear } from '../utils/imageProcessing';

/**
 * CRT: barrel curvature, convergence error (chroma offset), phosphor mask,
 * scanlines, bloom, vignette, plus optional flicker, noise and a rolling bar.
 */
export const crt: EffectDefinition = {
  id: 'crt',
  name: 'CRT',
  category: 'analog',
  description: 'Cathode-ray monitor: curvature, phosphor mask, scanlines, bloom.',
  animated: (p) => (p.flicker as number) > 0 || p.roll === true || (p.noise as number) > 0,
  audioDefaults: { bloom: { band: 'bass', amount: 0.35 }, chroma: { band: 'beat', amount: 0.25 } },
  params: [
    { key: 'curvature', label: 'Curvature', type: 'range', group: 'Tube', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'chroma', label: 'Convergence', type: 'range', group: 'Tube', min: 0, max: 10, step: 0.05, default: 1.5 },
    { key: 'vignette', label: 'Vignette', type: 'range', group: 'Tube', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'bloom', label: 'Bloom', type: 'range', group: 'Tube', min: 0, max: 1.5, step: 0.01, default: 0.35 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tube', min: 0.5, max: 2, step: 0.01, default: 1.25 },
    {
      key: 'mask', label: 'Phosphor Mask', type: 'select', group: 'Phosphor', default: 'grille',
      options: [{ value: 'none', label: 'None' }, { value: 'grille', label: 'Aperture' }, { value: 'slot', label: 'Slot' }, { value: 'dots', label: 'Dots' }],
    },
    { key: 'maskStrength', label: 'Mask Strength', type: 'range', group: 'Phosphor', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'maskScale', label: 'Mask Scale', type: 'range', group: 'Phosphor', min: 1, max: 8, step: 0.1, default: 2 },
    { key: 'scanlines', label: 'Scanlines', type: 'range', group: 'Phosphor', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'lineSize', label: 'Line Size', type: 'range', group: 'Phosphor', min: 1, max: 12, step: 0.1, default: 3 },
    { key: 'noise', label: 'Noise', type: 'range', group: 'Signal', min: 0, max: 0.5, step: 0.005, default: 0.04 },
    { key: 'flicker', label: 'Flicker', type: 'range', group: 'Signal', min: 0, max: 0.3, step: 0.005, default: 0.03 },
    { key: 'roll', label: 'Rolling Bar', type: 'toggle', group: 'Signal', default: true },
  ],
  render({ src, ctx, width, height, params, unit, time, frame }) {
    const curv = params.curvature as number;
    const chroma = (params.chroma as number) * unit;
    const vig = params.vignette as number;
    const bloomAmt = params.bloom as number;
    const bright = params.brightness as number;
    const mask = params.mask as string;
    const maskS = params.maskStrength as number;
    const mScale = Math.max(1, (params.maskScale as number) * unit);
    const scan = params.scanlines as number;
    const lineSize = Math.max(1, (params.lineSize as number) * unit);
    const noise = params.noise as number;
    const flicker = 1 - (params.flicker as number) * (0.5 + 0.5 * Math.sin(time * 61.7)) ;
    const rollPos = params.roll ? (time * 0.18) % 1.3 - 0.15 : -10;
    const d = src.data;
    const n = width * height;

    // Bloom source: blurred brightness-weighted copy of each channel.
    let bR: Float32Array | null = null, bG: Float32Array | null = null, bB: Float32Array | null = null;
    if (bloomAmt > 0) {
      bR = new Float32Array(n); bG = new Float32Array(n); bB = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        const w = Math.max(0, (r + g + b) / 765 - 0.45) * 2;
        bR[i] = r * w; bG[i] = g * w; bB[i] = b * w;
      }
      const rad = 8 * unit;
      bR = boxBlur(bR, width, height, rad); bG = boxBlur(bG, width, height, rad); bB = boxBlur(bB, width, height, rad);
    }

    const out = ctx.createImageData(width, height);
    const op = out.data;
    const tmp = new Uint8ClampedArray(4);
    const k = curv * 0.25;
    const seed = frame * 131 + 7;
    for (let y = 0; y < height; y++) {
      const ny = (y / height) * 2 - 1;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const nx = (x / width) * 2 - 1;
        // barrel distortion
        const r2 = nx * nx + ny * ny;
        const fx = nx * (1 + k * r2), fy = ny * (1 + k * r2);
        if (Math.abs(fx) > 1 || Math.abs(fy) > 1) {
          op[o] = op[o + 1] = op[o + 2] = 0;
          op[o + 3] = 255;
          continue;
        }
        const sx = ((fx + 1) / 2) * width, sy = ((fy + 1) / 2) * height;
        sampleBilinear(d, width, height, sx + chroma, sy, tmp, 0);
        let r = tmp[0];
        sampleBilinear(d, width, height, sx, sy, tmp, 0);
        let g = tmp[1];
        sampleBilinear(d, width, height, sx - chroma, sy, tmp, 0);
        let b = tmp[2];

        if (bR) {
          const bi = Math.min(height - 1, Math.max(0, sy | 0)) * width + Math.min(width - 1, Math.max(0, sx | 0));
          r += bR[bi] * bloomAmt; g += bG![bi] * bloomAmt; b += bB![bi] * bloomAmt;
        }

        // phosphor mask
        if (mask !== 'none' && maskS > 0) {
          const col = Math.floor(sx / mScale);
          let sub = col % 3;
          if (mask === 'slot' && Math.floor(sy / (mScale * 3)) % 2 === 1) sub = (sub + 1) % 3;
          let m = 1;
          if (mask === 'dots') {
            const cxp = (sx / mScale) % 1 - 0.5, cyp = (sy / mScale) % 1 - 0.5;
            m = 1 - Math.min(1, (cxp * cxp + cyp * cyp) * 3);
          }
          const lo = 1 - maskS;
          r *= (sub === 0 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
          g *= (sub === 1 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
          b *= (sub === 2 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
        }

        // scanlines follow the curved geometry
        let s = 1;
        if (scan > 0) s = 1 - scan * (0.5 - 0.5 * Math.cos((sy / lineSize) * Math.PI * 2));
        // vignette in tube space
        const v = 1 - vig * Math.pow(Math.max(Math.abs(fx), Math.abs(fy)), 6) - vig * 0.35 * r2;
        // rolling bar
        const bar = Math.abs((sy / height) - rollPos) < 0.06 ? 1.08 : 1;
        let gain = s * Math.max(0, v) * bright * flicker * bar;
        if (noise > 0) gain *= 1 + (hash2(x, y, seed) - 0.5) * noise * 2;

        op[o] = clamp255(r * gain);
        op[o + 1] = clamp255(g * gain);
        op[o + 2] = clamp255(b * gain);
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
