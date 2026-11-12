import type { EffectDefinition } from '../types';
import { boxBlur, clamp255, hash2, hexToRgb } from '../../utils/imageProcessing';
import { C, R, S, T } from '../generative';

/**
 * An image intensifier, imitated in steps: light is amplified, highlights
 * bloom, the phosphor shows its colour and grain, and the tube adds a soft
 * edge and lines. Infrared variants swap which surfaces read as bright.
 */

const PHOSPHOR: Record<string, [string, string, string]> = {
  green: ['#020a02', '#2fd23a', '#d9ffc9'],
  white: ['#05070a', '#9fb2bf', '#f2fbff'],
  amber: ['#0a0500', '#e08a1c', '#ffe7b0'],
  blue: ['#00040c', '#2d7dff', '#d4ecff'],
};

export const nightVision: EffectDefinition = {
  id: 'nightVision', name: 'Night Vision', category: 'analog',
  description: 'Amplified light with phosphor colour, bloom, grain, scanlines and a tube vignette. Green, white phosphor or infrared.',
  animated: (p) => (p.noiseMove as boolean) || (p.flicker as number) > 0,
  audioDefaults: { gain: { band: 'bass', amount: 0.15 } },
  params: [
    S('phosphor', 'Phosphor', 'green', [['green', 'Classic Green'], ['white', 'White Phosphor'], ['amber', 'Amber'], ['blue', 'Blue Tint'], ['custom', 'Custom Color']], 'Look'),
    { ...C('tint', 'Phosphor Color', '#38ff6a', 'Look'), visibleWhen: (v) => v.phosphor === 'custom' },
    S('infrared', 'Infrared Variation', 'off', [['off', 'Off'], ['foliage', 'Bright Foliage'], ['warm', 'Warm Surfaces Glow'], ['false', 'False Color IR']], 'Look', ),
    R('gain', 'Light Amplification', 0.5, 8, 0.01, 1.7, 'Exposure'),
    R('brightness', 'Brightness', -0.5, 0.5, 0.01, 0, 'Exposure'),
    R('contrast', 'Contrast', 0.3, 3, 0.01, 1.25, 'Exposure'),
    R('glow', 'Glow', 0, 2, 0.01, 0.45, 'Glow'),
    R('glowSize', 'Glow Size', 2, 120, 1, 26, 'Glow'),
    R('glowThreshold', 'Glow Threshold', 0, 1, 0.01, 0.7, 'Glow'),
    R('softness', 'Phosphor Softness', 0, 6, 0.1, 1.2, 'Glow'),
    R('noise', 'Noise', 0, 1, 0.01, 0.35, 'Noise & Grain'),
    R('grainSize', 'Grain Size', 0.5, 6, 0.1, 1.3, 'Noise & Grain'),
    T('noiseMove', 'Animate Noise', true, 'Noise & Grain'),
    R('sparkle', 'Sensor Sparkle', 0, 1, 0.01, 0.15, 'Noise & Grain', 'Bright single-pixel hits, as on a real tube.'),
    R('scanlines', 'Scanlines', 0, 1, 0.01, 0.25, 'Tube'),
    R('scanSize', 'Scanline Size', 1, 10, 0.5, 2.5, 'Tube'),
    R('vignette', 'Vignette', 0, 1, 0.01, 0.6, 'Tube'),
    S('mask', 'Tube Shape', 'none', [['none', 'Full Frame'], ['circle', 'Single Tube'], ['binocular', 'Binocular']], 'Tube'),
    R('flicker', 'Flicker', 0, 1, 0.01, 0.1, 'Tube'),
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Tube' },
  ],
  presets: [
    { name: 'Gen 3 Green', values: {} },
    { name: 'White Phosphor', values: { phosphor: 'white', glow: 0.5, noise: 0.25 } },
    { name: 'Binocular Scope', values: { mask: 'binocular', vignette: 0.8, scanlines: 0.1 } },
    { name: 'Infrared Foliage', values: { phosphor: 'white', infrared: 'foliage', gain: 2 } },
    { name: 'False Color IR', values: { infrared: 'false', gain: 1.6, noise: 0.15, glow: 0.4, scanlines: 0 } },
    { name: 'Low Light Grain', values: { gain: 6, noise: 0.85, grainSize: 1.8, sparkle: 0.5, glow: 1.2 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const d = src.data, n = w * h, ir = p.infrared as string;
    // Sensor response: what each surface looks like to a near-infrared sensor.
    let L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
      L[i] = ir === 'foliage' || ir === 'false' ? Math.min(1, g * 0.55 + r * 0.45 + Math.max(0, g - b) * 0.9) : ir === 'warm' ? Math.min(1, r * 0.7 + g * 0.25 + Math.max(0, r - b) * 0.6) : 0.3 * r + 0.59 * g + 0.11 * b;
    }
    const soft = (p.softness as number) * unit;
    if (soft >= 0.5) L = boxBlur(L, w, h, soft, 1);
    const gain = p.gain as number, ct = p.contrast as number, br = p.brightness as number, flick = (p.flicker as number) * (Math.sin(time * 37) * 0.5 + Math.sin(time * 91) * 0.5) * 0.08;
    // Amplification saturates like a tube: a curve, not a straight multiply.
    for (let i = 0; i < n; i++) { const a = 1 - Math.exp(-L[i] * gain); L[i] = Math.min(1, Math.max(0, (a - 0.5) * ct + 0.5 + br + flick)); }
    const glow = p.glow as number;
    if (glow > 0) {
      const k = Math.max(1, Math.floor((p.glowSize as number) * unit / 6)), sw = Math.ceil(w / k), sh = Math.ceil(h / k), S0 = new Float32Array(sw * sh), th = p.glowThreshold as number;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const v = L[Math.min(h - 1, y * k) * w + Math.min(w - 1, x * k)]; S0[y * sw + x] = Math.max(0, v - th) / Math.max(0.05, 1 - th); }
      const B = boxBlur(S0, sw, sh, (p.glowSize as number) * unit / k, 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; L[i] = Math.min(1.4, L[i] + B[Math.min(sh - 1, (y / k) | 0) * sw + Math.min(sw - 1, (x / k) | 0)] * glow); }
    }
    const pal = p.phosphor === 'custom' ? (() => { const c = hexToRgb(p.tint as string); return [c.map((v) => v * 0.05), c, c.map((v) => v + (255 - v) * 0.75)]; })() : PHOSPHOR[p.phosphor as string].map(hexToRgb);
    const out = ctx.createImageData(w, h), o = out.data, noise = p.noise as number, cell = Math.max(1, (p.grainSize as number) * unit), seed = (p.seed as number) + ((p.noiseMove as boolean) ? frame * 7 : 0);
    const sparkle = (p.sparkle as number) * 0.004, scan = p.scanlines as number, sp = Math.max(1, (p.scanSize as number) * unit), vig = p.vignette as number, mask = p.mask as string, cx = w / 2, cy = h / 2, R0 = Math.min(w, h) * 0.48;
    for (let y = 0; y < h; y++) {
      const line = scan > 0 && y % (sp * 2) >= sp ? 1 - scan * 0.6 : 1, gy = (y / cell) | 0;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, q = i * 4;
        let v = L[i];
        // Grain is stronger in the dark, as in real intensifier footage.
        if (noise > 0) v += (hash2((x / cell) | 0, gy, seed) - 0.5) * noise * (0.55 + (1 - Math.min(1, v)) * 0.6);
        if (sparkle > 0 && hash2(x, y, seed + 3) < sparkle) v = 1.3;
        let edge = 1;
        if (vig > 0 || mask !== 'none') {
          let dd: number;
          if (mask === 'circle') dd = Math.hypot(x - cx, y - cy) / R0;
          else if (mask === 'binocular') { const off = Math.min(w * 0.22, R0 * 0.78); dd = Math.min(Math.hypot(x - cx + off, y - cy), Math.hypot(x - cx - off, y - cy)) / (R0 * 0.92); }
          else dd = Math.hypot((x - cx) / cx, (y - cy) / cy) * 0.75;
          edge = mask === 'none' ? 1 - vig * Math.max(0, dd - 0.35) ** 1.6 * 1.3 : Math.max(0, 1 - Math.max(0, dd - (1 - vig * 0.35)) / Math.max(0.02, vig * 0.35 + 0.02));
        }
        v = Math.max(0, v * line * edge);
        if (ir === 'false') {
          // False colour: the sensor value runs through red, magenta and cyan.
          const t = Math.min(1, v);
          o[q] = clamp255(255 * Math.min(1, t * 1.6)); o[q + 1] = clamp255(255 * Math.max(0, t * 1.4 - 0.6)); o[q + 2] = clamp255(255 * (0.25 + Math.sin(t * 3.1) * 0.5));
        } else {
          const t = Math.min(1, v), a = t < 0.6 ? pal[0] : pal[1], b = t < 0.6 ? pal[1] : pal[2], k = t < 0.6 ? t / 0.6 : (t - 0.6) / 0.4, over = Math.max(0, v - 1) * 255;
          o[q] = clamp255(a[0] + (b[0] - a[0]) * k + over); o[q + 1] = clamp255(a[1] + (b[1] - a[1]) * k + over); o[q + 2] = clamp255(a[2] + (b[2] - a[2]) * k + over);
        }
        o[q + 3] = d[q + 3];
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
