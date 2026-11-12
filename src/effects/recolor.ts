import type { EffectDefinition } from './types';
import { adjust, hexToRgb, luminance, type RGB } from '../utils/imageProcessing';

const PALETTES: Record<string, string[]> = {
  acid: ['#0b0c0b', '#2b3a12', '#7fb800', '#c6ff2e', '#f4ffd6'],
  sunset: ['#1a0b2e', '#6b1d5c', '#e0457b', '#ff9e5e', '#ffe3a3'],
  ocean: ['#03121f', '#0b3c5d', '#1d7a8c', '#7fd1c7', '#e9fbf6'],
  riso: ['#1b1b1b', '#0078bf', '#ff48b0', '#ffe800', '#f4f0e6'],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  thermal: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
  cmyk: ['#ffffff', '#00aeef', '#ec008c', '#fff200', '#000000'],
  vapor: ['#1e0336', '#5a189a', '#ff6ec7', '#00f0ff', '#fffbe6'],
};

/**
 * Recolor: remap the image onto a palette — as a continuous gradient map
 * along luminance, as hard nearest-colour quantisation, or by rotating hue.
 */
export const recolor: EffectDefinition = {
  id: 'recolor',
  name: 'Recolor',
  category: 'adjust',
  description: 'Gradient maps, palette quantisation and hue rotation.',
  animated: (p) => (p.cycle as number) > 0,
  audioDefaults: { hue: { band: 'mid', amount: 0.25 }, offset: { band: 'bass', amount: 0.3 } },
  params: [
    {
      key: 'mode', label: 'Mode', type: 'select', group: 'Mapping', default: 'gradient',
      options: [{ value: 'gradient', label: 'Gradient Map' }, { value: 'palette', label: 'Palette' }, { value: 'hue', label: 'Hue Shift' }],
    },
    {
      key: 'palette', label: 'Palette', type: 'select', group: 'Mapping', default: 'acid',
      visibleWhen: (v) => v.mode !== 'hue',
      options: [
        { value: 'acid', label: 'Acid' }, { value: 'sunset', label: 'Sunset' }, { value: 'ocean', label: 'Ocean' },
        { value: 'riso', label: 'Riso' }, { value: 'gameboy', label: 'Handheld' }, { value: 'thermal', label: 'Thermal' },
        { value: 'cmyk', label: 'CMYK' }, { value: 'vapor', label: 'Vapor' }, { value: 'custom', label: 'Custom (4)' },
      ],
    },
    ...(['c1', 'c2', 'c3', 'c4'] as const).map((key, i) => ({
      key, label: `Color ${i + 1}`, type: 'color' as const, group: 'Custom Palette',
      default: ['#101820', '#f2542d', '#f5dfbb', '#0e9594'][i],
      visibleWhen: (v: Record<string, unknown>) => v.mode !== 'hue' && v.palette === 'custom',
    })),
    { key: 'offset', label: 'Map Offset', type: 'range', group: 'Mapping', min: -1, max: 1, step: 0.005, default: 0, visibleWhen: (v) => v.mode === 'gradient' },
    { key: 'cycle', label: 'Cycle Speed', type: 'range', group: 'Mapping', min: 0, max: 2, step: 0.01, default: 0, hint: 'Scrolls the map / hue over time.' },
    { key: 'hue', label: 'Hue Rotate', type: 'range', group: 'Hue', min: -180, max: 180, step: 1, default: 90, unit: '°', visibleWhen: (v) => v.mode === 'hue' },
    { key: 'saturation', label: 'Saturation', type: 'range', group: 'Hue', min: 0, max: 3, step: 0.01, default: 1.2, visibleWhen: (v) => v.mode === 'hue' },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'mix', label: 'Mix', type: 'range', group: 'Tone', min: 0, max: 1, step: 0.01, default: 1 },
  ],
  render({ src, ctx, width, height, params, time }) {
    const mode = params.mode as string;
    const pal: RGB[] = (params.palette === 'custom'
      ? [params.c1, params.c2, params.c3, params.c4].map(String)
      : PALETTES[params.palette as string] ?? PALETTES.acid
    ).map(hexToRgb);
    const contrast = params.contrast as number;
    const brightness = params.brightness as number;
    const mix = params.mix as number;
    const shift = (params.offset as number) + time * (params.cycle as number) * 0.25;

    // Precomputed 256-entry LUT for the gradient map.
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      let t = (adjust(i / 255, brightness, contrast) + shift) % 1;
      if (t < 0) t += 1;
      const f = t * (pal.length - 1);
      const k = Math.min(pal.length - 2, Math.floor(f));
      const u = f - k;
      for (let c = 0; c < 3; c++) lut[i * 3 + c] = pal[k][c] + (pal[k + 1][c] - pal[k][c]) * u;
    }
    const hueRad = (((params.hue as number) + time * (params.cycle as number) * 90) * Math.PI) / 180;
    const cosH = Math.cos(hueRad), sinH = Math.sin(hueRad);
    const sat = params.saturation as number;

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    for (let o = 0; o < d.length; o += 4) {
      const r = d[o], g = d[o + 1], b = d[o + 2];
      let nr: number, ng: number, nb: number;
      if (mode === 'gradient') {
        const li = Math.round(luminance(r, g, b) * 255) * 3;
        nr = lut[li]; ng = lut[li + 1]; nb = lut[li + 2];
      } else if (mode === 'palette') {
        // nearest palette colour after tone adjustment
        const ar = adjust(r / 255, brightness, contrast) * 255, ag = adjust(g / 255, brightness, contrast) * 255, ab = adjust(b / 255, brightness, contrast) * 255;
        let best = 0, bd = Infinity;
        for (let k = 0; k < pal.length; k++) {
          const dr = ar - pal[k][0], dg = ag - pal[k][1], db = ab - pal[k][2];
          const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
          if (dist < bd) { bd = dist; best = k; }
        }
        [nr, ng, nb] = pal[best];
      } else {
        // YIQ hue rotation + saturation
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        const I = (0.596 * r - 0.274 * g - 0.322 * b) * sat;
        const Q = (0.211 * r - 0.523 * g + 0.312 * b) * sat;
        const I2 = I * cosH - Q * sinH, Q2 = I * sinH + Q * cosH;
        const Ya = adjust(Y / 255, brightness, contrast) * 255;
        nr = Ya + 0.956 * I2 + 0.621 * Q2;
        ng = Ya - 0.272 * I2 - 0.647 * Q2;
        nb = Ya - 1.106 * I2 + 1.703 * Q2;
      }
      op[o] = r + (nr - r) * mix;
      op[o + 1] = g + (ng - g) * mix;
      op[o + 2] = b + (nb - b) * mix;
      op[o + 3] = d[o + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};
