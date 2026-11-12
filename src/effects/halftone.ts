import type { EffectDefinition } from './types';
import { adjust, hexToRgb, sampleIndex } from '../utils/imageProcessing';
import { contentOf, withContent } from '../content/content';

/**
 * Halftone: a rotated screen of dots whose area follows local tone.
 * RGB mode prints three screens at classic offset angles — subtractive
 * (cyan / magenta / yellow on paper) by default, additive (red / green /
 * blue light on black) when inverted.
 */
export const halftone: EffectDefinition = withContent({
  id: 'halftone',
  name: 'Halftone',
  category: 'texture',
  description: 'Print-style rotated dot screens.',
  supportsTransparency: true,
  params: [
    { key: 'spacing', label: 'Grid Spacing', type: 'range', group: 'Screen', min: 3, max: 60, step: 0.5, default: 10 },
    { key: 'dotSize', label: 'Dot Size', type: 'range', group: 'Screen', min: 0.1, max: 2, step: 0.01, default: 1, unit: '×' },
    { key: 'angle', label: 'Angle', type: 'range', group: 'Screen', min: 0, max: 90, step: 0.5, default: 45, unit: '°' },
    {
      key: 'shape',
      label: 'Shape',
      type: 'select',
      group: 'Screen',
      default: 'circle',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'ellipse', label: 'Ellipse' },
      ],
    },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0, max: 3, step: 0.01, default: 1.2 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -1, max: 1, step: 0.01, default: 0 },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Tone', default: false },
    {
      key: 'colorMode',
      label: 'Color Mode',
      type: 'select',
      group: 'Color',
      default: 'bw',
      options: [
        { value: 'bw', label: 'Black & White' },
        { value: 'mono', label: 'Monochrome' },
        { value: 'rgb', label: 'RGB' },
      ],
    },
    {
      key: 'ink',
      label: 'Ink Color',
      type: 'color',
      group: 'Color',
      default: '#1a1aff',
      visibleWhen: (v) => v.colorMode === 'mono',
    },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#f3f1ea' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const spacing = Math.max(2, (params.spacing as number) * unit);
    const dotScale = params.dotSize as number;
    const baseAngle = ((params.angle as number) * Math.PI) / 180;
    const shape = params.shape as string;
    const contrast = params.contrast as number;
    const brightness = params.brightness as number;
    const invert = params.invert as boolean;
    const mode = params.colorMode as string;
    const d = src.data;

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = mode === 'rgb' && invert ? '#000000' : (params.background as string);
      ctx.fillRect(0, 0, width, height);
    }

    // Each screen: an angle, a colour and a function giving coverage 0..1 at a pixel.
    type Screen = { angle: number; color: string; coverage: (i: number) => number };
    const tone = (v: number) => adjust(v / 255, brightness, contrast);
    const lumAt = (i: number) => tone(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);

    let screens: Screen[];
    if (mode === 'rgb') {
      if (invert) {
        ctx.globalCompositeOperation = 'lighter';
        screens = [
          { angle: baseAngle + 0.262, color: '#ff0000', coverage: (i) => tone(d[i]) },
          { angle: baseAngle + 1.309, color: '#00ff00', coverage: (i) => tone(d[i + 1]) },
          { angle: baseAngle, color: '#0000ff', coverage: (i) => tone(d[i + 2]) },
        ];
      } else {
        ctx.globalCompositeOperation = 'multiply';
        screens = [
          { angle: baseAngle + 0.262, color: '#00ffff', coverage: (i) => 1 - tone(d[i]) },
          { angle: baseAngle + 1.309, color: '#ff00ff', coverage: (i) => 1 - tone(d[i + 1]) },
          { angle: baseAngle, color: '#ffff00', coverage: (i) => 1 - tone(d[i + 2]) },
        ];
      }
    } else {
      const ink = mode === 'mono' ? (params.ink as string) : '#000000';
      screens = [{ angle: baseAngle, color: ink, coverage: (i) => (invert ? lumAt(i) : 1 - lumAt(i)) }];
    }

    const cx = width / 2, cy = height / 2;
    const half = Math.hypot(width, height) / 2 + spacing;
    const steps = Math.ceil(half / spacing);
    const quarter = spacing / 4;

    const stamps = contentOf(params, unit);
    stamps?.begin(ctx);
    let dot = 0;
    for (const scr of screens) {
      const rgb = hexToRgb(scr.color);
      ctx.fillStyle = scr.color;
      const ca = Math.cos(scr.angle), sa = Math.sin(scr.angle);
      ctx.beginPath();
      for (let gy = -steps; gy <= steps; gy++) {
        for (let gx = -steps; gx <= steps; gx++) {
          const u = gx * spacing, v = gy * spacing;
          const x = cx + u * ca - v * sa;
          const y = cy + u * sa + v * ca;
          if (x < -spacing || y < -spacing || x > width + spacing || y > height + spacing) continue;
          // Average 5 taps for a smoother tone estimate.
          const cov =
            (scr.coverage(sampleIndex(width, height, x, y)) +
              scr.coverage(sampleIndex(width, height, x - quarter, y - quarter)) +
              scr.coverage(sampleIndex(width, height, x + quarter, y - quarter)) +
              scr.coverage(sampleIndex(width, height, x - quarter, y + quarter)) +
              scr.coverage(sampleIndex(width, height, x + quarter, y + quarter))) /
            5;
          if (cov <= 0.002) continue;
          const s = Math.sqrt(cov) * dotScale;
          if (stamps) { stamps.stamp(ctx, dot++, x, y, spacing * s * 1.3, rgb, scr.angle); continue; }
          if (shape === 'square') {
            const h = (spacing * s) / 2;
            // Rotated square aligned with the screen.
            ctx.moveTo(x + (-h * ca - -h * sa), y + (-h * sa + -h * ca));
            ctx.lineTo(x + (h * ca - -h * sa), y + (h * sa + -h * ca));
            ctx.lineTo(x + (h * ca - h * sa), y + (h * sa + h * ca));
            ctx.lineTo(x + (-h * ca - h * sa), y + (-h * sa + h * ca));
            ctx.closePath();
          } else if (shape === 'ellipse') {
            const r = spacing * 0.7071 * s;
            ctx.moveTo(x + r * 1.35 * ca, y + r * 1.35 * sa);
            ctx.ellipse(x, y, r * 1.35, r * 0.6, scr.angle, 0, Math.PI * 2);
          } else {
            const r = spacing * 0.5642 * s; // area-equivalent radius: full cell at cov=1
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
        }
      }
      ctx.fill();
    }
    stamps?.end(ctx);
    ctx.restore();
  },
});
