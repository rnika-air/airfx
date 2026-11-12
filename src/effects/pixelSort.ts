import type { EffectDefinition } from './types';

/**
 * Pixel Sort: along each row (or column), contiguous spans whose brightness
 * falls inside [low, high] are sorted by the chosen key. Classic data-mosh
 * streaks that follow the image's light.
 */
export const pixelSort: EffectDefinition = {
  id: 'pixelSort',
  name: 'Pixel Sort',
  category: 'distortion',
  description: 'Sort spans of pixels into streaks by brightness or hue.',
  audioDefaults: { low: { band: 'bass', amount: -0.25 } },
  params: [
    {
      key: 'direction', label: 'Direction', type: 'select', group: 'Sort', default: 'horizontal',
      options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }],
    },
    {
      key: 'key', label: 'Sort By', type: 'select', group: 'Sort', default: 'brightness',
      options: [{ value: 'brightness', label: 'Brightness' }, { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' }],
    },
    { key: 'low', label: 'Lower Threshold', type: 'range', group: 'Mask', min: 0, max: 1, step: 0.005, default: 0.25 },
    { key: 'high', label: 'Upper Threshold', type: 'range', group: 'Mask', min: 0, max: 1, step: 0.005, default: 0.85 },
    { key: 'maxSpan', label: 'Max Span', type: 'range', group: 'Mask', min: 2, max: 1000, step: 1, default: 1000, hint: 'Breaks long spans into chunks (in units).' },
    { key: 'reverse', label: 'Reverse Order', type: 'toggle', group: 'Sort', default: false },
    { key: 'showMask', label: 'Show Mask', type: 'toggle', group: 'Mask', default: false },
  ],
  render({ src, ctx, width, height, params, unit }) {
    const vertical = params.direction === 'vertical';
    let low = params.low as number, high = params.high as number;
    if (low > high) [low, high] = [high, low];
    const maxSpan = Math.max(2, Math.round((params.maxSpan as number) * unit));
    const reverse = params.reverse as boolean;
    const sortKey = params.key as string;
    const showMask = params.showMask as boolean;

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    op.set(d);
    const px = new Uint32Array(op.buffer);

    const keyOf = (i: number) => {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (sortKey === 'brightness') return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (sortKey === 'saturation') return max === 0 ? 0 : (max - min) / max;
      if (max === min) return 0;
      let h: number;
      if (max === r) h = (g - b) / (max - min);
      else if (max === g) h = 2 + (b - r) / (max - min);
      else h = 4 + (r - g) / (max - min);
      return ((h * 60 + 360) % 360) / 360;
    };
    const lum = (i: number) => (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;

    const lines = vertical ? width : height;
    const len = vertical ? height : width;
    const idx = (line: number, k: number) => (vertical ? k * width + line : line * width + k);
    const spanIdx: number[] = [];
    const flush = () => {
      if (spanIdx.length > 1) {
        const items = spanIdx.map((i) => ({ k: keyOf(i), p: px[i] }));
        items.sort((a, b) => (reverse ? b.k - a.k : a.k - b.k));
        for (let j = 0; j < spanIdx.length; j++) px[spanIdx[j]] = items[j].p;
      }
      spanIdx.length = 0;
    };

    for (let line = 0; line < lines; line++) {
      for (let k = 0; k < len; k++) {
        const i = idx(line, k);
        const l = lum(i);
        const inMask = l >= low && l <= high;
        if (showMask) {
          const v = inMask ? 255 : 0;
          op[i * 4] = op[i * 4 + 1] = op[i * 4 + 2] = v;
          continue;
        }
        if (inMask) {
          spanIdx.push(i);
          if (spanIdx.length >= maxSpan) flush();
        } else flush();
      }
      flush();
    }
    ctx.putImageData(out, 0, 0);
  },
};
