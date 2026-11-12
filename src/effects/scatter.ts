import type { EffectDefinition } from './types';
import { createRng, hexToRgb, luminance, sampleIndex } from '../utils/imageProcessing';
import { contentOf, layoutPoints, withContent } from '../content/content';

/**
 * Scatter: rebuilds the image from randomly placed shapes. Each candidate
 * point samples the source; tone decides whether it survives (importance
 * sampling) and how large it is drawn. The seed fixes the layout, so video
 * frames stay temporally coherent — only colours and sizes follow the footage.
 */
export const scatter: EffectDefinition = withContent({
  id: 'scatter',
  name: 'Scatter',
  category: 'distortion',
  description: 'Rebuild the image from thousands of scattered shapes.',
  supportsTransparency: true,
  params: [
    { key: 'density', label: 'Point Density', type: 'range', group: 'Distribution', min: 1, max: 100, step: 1, default: 45 },
    { key: 'scatter', label: 'Scatter Amount', type: 'range', group: 'Distribution', min: 0, max: 60, step: 0.5, default: 4 },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Distribution', default: 1337 },
    { key: 'minSize', label: 'Minimum Size', type: 'range', group: 'Shape', min: 0.2, max: 20, step: 0.1, default: 1 },
    { key: 'maxSize', label: 'Maximum Size', type: 'range', group: 'Shape', min: 0.5, max: 40, step: 0.1, default: 7 },
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      group: 'Shape',
      default: 'circle',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'triangle', label: 'Triangle' },
      ],
    },
    { key: 'sizeByBrightness', label: 'Size by Brightness', type: 'toggle', group: 'Shape', default: true },
    {
      key: 'colorMode',
      label: 'Color Mode',
      type: 'select',
      group: 'Color',
      default: 'original',
      options: [
        { value: 'original', label: 'Original Colors' },
        { value: 'mono', label: 'Monochrome' },
        { value: 'custom', label: 'Custom Color' },
      ],
    },
    {
      key: 'color',
      label: 'Shape Color',
      type: 'color',
      group: 'Color',
      default: '#c6ff2e',
      visibleWhen: (v) => v.colorMode === 'custom',
    },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0c0c0c' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const rng = createRng(params.seed as number);
    const count = Math.round((params.density as number) * 500);
    let minS = (params.minSize as number) * unit;
    let maxS = (params.maxSize as number) * unit;
    if (minS > maxS) [minS, maxS] = [maxS, minS];
    const spread = (params.scatter as number) * unit;
    const shape = params.shape as string;
    const bySize = params.sizeByBrightness as boolean;
    const mode = params.colorMode as string;
    const bg = hexToRgb(params.background as string);
    const custom = params.color as string;
    // On dark backgrounds shapes carry light; on light backgrounds they carry ink.
    const darkBg = params.transparent ? true : luminance(bg[0], bg[1], bg[2]) < 0.5;

    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = params.background as string;
      ctx.fillRect(0, 0, width, height);
    }

    const d = src.data;
    if (mode === 'custom') ctx.fillStyle = custom;
    const stamps = contentOf(params, unit), customRgb = hexToRgb(custom);
    const placed = params.cLayout !== 'random' ? layoutPoints(params.cLayout as string, Math.min(count, 4000), width, height) : null;
    stamps?.begin(ctx);
    const total = placed ? placed.length : count;

    for (let n = 0; n < total; n++) {
      // Always consume the same number of random values per point so the
      // layout is stable as tone changes (important for video).
      const rx = rng(), ry = rng();
      const sx = placed ? placed[n][0] : rx * width;
      const sy = placed ? placed[n][1] : ry * height;
      const accept = rng();
      const sizeJitter = rng();
      const ox = (rng() - 0.5) * 2 * spread;
      const oy = (rng() - 0.5) * 2 * spread;
      const rotJ = rng();

      const i = sampleIndex(width, height, sx, sy);
      if (d[i + 3] < 8) continue;
      const lum = luminance(d[i], d[i + 1], d[i + 2]);
      const weight = darkBg ? lum : 1 - lum;
      // Keep a small floor so flat areas are not completely empty.
      if (accept > weight * 0.92 + 0.04) continue;

      const t = bySize ? weight : sizeJitter;
      const size = minS + (maxS - minS) * t;
      if (size < 0.15) continue;

      if (mode === 'original') {
        ctx.fillStyle = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
      } else if (mode === 'mono') {
        const v = Math.round(lum * 255);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
      }

      const x = sx + ox;
      const y = sy + oy;
      const r = size / 2;
      if (stamps) {
        const v = Math.round(lum * 255);
        stamps.stamp(ctx, n, x, y, size * 2.5, mode === 'original' ? [d[i], d[i + 1], d[i + 2]] : mode === 'mono' ? [v, v, v] : customRgb, 0);
        continue;
      }
      if (shape === 'square') {
        ctx.fillRect(x - r, y - r, size, size);
      } else if (shape === 'triangle') {
        const a = rotJ * Math.PI * 2;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = a + (k * Math.PI * 2) / 3;
          const px = x + Math.cos(ang) * r * 1.2;
          const py = y + Math.sin(ang) * r * 1.2;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    stamps?.end(ctx);
  },
}, { layout: true });
