import { contentOf, withContent } from '../content/content';
import type { EffectDefinition } from './types';
import { adjust, cellAverages, hexToRgb, luminance } from '../utils/imageProcessing';

/**
 * Dots: an upright dot-matrix / LED grid. Each cell averages the pixels it
 * covers and draws one mark sized and coloured by that average.
 */
export const dots: EffectDefinition = withContent({
  id: 'dots',
  name: 'Dots',
  category: 'pattern',
  description: 'Dot-matrix grid — LED boards, perforation, pop-art dots.',
  supportsTransparency: true,
  audioDefaults: { scale: { band: 'bass', amount: 0.35 } },
  params: [
    { key: 'cell', label: 'Cell Size', type: 'range', group: 'Grid', min: 3, max: 80, step: 0.5, default: 12 },
    { key: 'scale', label: 'Dot Scale', type: 'range', group: 'Grid', min: 0.1, max: 1.5, step: 0.01, default: 0.9 },
    { key: 'hex', label: 'Offset Rows', type: 'toggle', group: 'Grid', default: false },
    {
      key: 'shape', label: 'Shape', type: 'select', group: 'Grid', default: 'circle',
      options: [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'diamond', label: 'Diamond' },
        { value: 'ring', label: 'Ring' },
        { value: 'plus', label: 'Plus' },
      ],
    },
    { key: 'sizeByBrightness', label: 'Size by Brightness', type: 'toggle', group: 'Tone', default: true },
    { key: 'minSize', label: 'Minimum Size', type: 'range', group: 'Tone', min: 0, max: 1, step: 0.01, default: 0.05 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: 'invert', label: 'Invert Size', type: 'toggle', group: 'Tone', default: false },
    {
      key: 'colorMode', label: 'Color Mode', type: 'select', group: 'Color', default: 'original',
      options: [{ value: 'original', label: 'Original' }, { value: 'mono', label: 'Mono' }, { value: 'custom', label: 'Custom' }],
    },
    { key: 'color', label: 'Dot Color', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => v.colorMode === 'custom' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0b0b0b' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ srcCanvas, ctx, width, height, params, unit }) {
    const cell = Math.max(2, (params.cell as number) * unit);
    const { data: avg, cols, rows } = cellAverages(srcCanvas, width, height, cell);

    const scale = params.scale as number;
    const shape = params.shape as string;
    const bySize = params.sizeByBrightness as boolean;
    const minSize = params.minSize as number;
    const contrast = params.contrast as number;
    const invert = params.invert as boolean;
    const mode = params.colorMode as string;
    const hex = params.hex as boolean;
    const bgDark = luminance(...hexToRgb(params.background as string)) < 0.5;

    ctx.clearRect(0, 0, width, height);
    if (!params.transparent) {
      ctx.fillStyle = params.background as string;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = params.color as string;
    ctx.strokeStyle = params.color as string;
    const stamps = contentOf(params, unit), base = hexToRgb(params.color as string);
    stamps?.begin(ctx);

    for (let r = 0; r < rows; r++) {
      const off = hex && r % 2 ? cell / 2 : 0;
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        const lum = adjust(luminance(avg[i], avg[i + 1], avg[i + 2]), 0, contrast);
        // On dark backgrounds bright areas get big dots, and vice versa.
        let t = bgDark ? lum : 1 - lum;
        if (invert) t = 1 - t;
        const k = bySize ? minSize + (1 - minSize) * t : 1;
        const size = cell * scale * k;
        if (size < 0.4) continue;
        const x = c * cell + cell / 2 + off, y = r * cell + cell / 2;
        if (mode === 'original') ctx.fillStyle = ctx.strokeStyle = `rgb(${avg[i]},${avg[i + 1]},${avg[i + 2]})`;
        else if (mode === 'mono') {
          const v = Math.round(lum * 255);
          ctx.fillStyle = ctx.strokeStyle = `rgb(${v},${v},${v})`;
        }
        const h = size / 2;
        if (stamps) {
          const v = Math.round(lum * 255);
          stamps.stamp(ctx, r * cols + c, x, y, size, mode === 'original' ? [avg[i], avg[i + 1], avg[i + 2]] : mode === 'mono' ? [v, v, v] : base);
          continue;
        }
        ctx.beginPath();
        switch (shape) {
          case 'square':
            ctx.rect(x - h, y - h, size, size);
            ctx.fill();
            break;
          case 'diamond':
            ctx.moveTo(x, y - h * 1.2); ctx.lineTo(x + h * 1.2, y); ctx.lineTo(x, y + h * 1.2); ctx.lineTo(x - h * 1.2, y);
            ctx.fill();
            break;
          case 'ring':
            ctx.lineWidth = Math.max(0.6, size * 0.18);
            ctx.arc(x, y, h * 0.85, 0, Math.PI * 2);
            ctx.stroke();
            break;
          case 'plus':
            ctx.rect(x - h, y - h * 0.28, size, h * 0.56);
            ctx.rect(x - h * 0.28, y - h, h * 0.56, size);
            ctx.fill();
            break;
          default:
            ctx.arc(x, y, h, 0, Math.PI * 2);
            ctx.fill();
        }
      }
    }
    stamps?.end(ctx);
  },
});
