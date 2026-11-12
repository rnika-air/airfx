import type { EffectDefinition } from './types';
import { cellAverages, createCanvas, get2d, hash2, hexToRgb, type RGB } from '../utils/imageProcessing';

/** Error-diffusion kernels: [dx, dy, weight], with a divisor. */
const KERNELS: Record<string, { div: number; k: [number, number, number][] }> = {
  floyd: { div: 16, k: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]] },
  jarvis: { div: 48, k: [[1, 0, 7], [2, 0, 5], [-2, 1, 3], [-1, 1, 5], [0, 1, 7], [1, 1, 5], [2, 1, 3], [-2, 2, 1], [-1, 2, 3], [0, 2, 5], [1, 2, 3], [2, 2, 1]] },
  stucki: { div: 42, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2], [-2, 2, 1], [-1, 2, 2], [0, 2, 4], [1, 2, 2], [2, 2, 1]] },
  // Atkinson deliberately diffuses only 6/8 of the error, which keeps its clean highlights.
  atkinson: { div: 8, k: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]] },
  burkes: { div: 32, k: [[1, 0, 8], [2, 0, 4], [-2, 1, 2], [-1, 1, 4], [0, 1, 8], [1, 1, 4], [2, 1, 2]] },
  sierra: { div: 32, k: [[1, 0, 5], [2, 0, 3], [-2, 1, 2], [-1, 1, 4], [0, 1, 5], [1, 1, 4], [2, 1, 2], [-1, 2, 2], [0, 2, 3], [1, 2, 2]] },
};

function bayer(n: number): Float32Array {
  // Recursive construction, normalised to −0.5..0.5.
  let m = [[0]];
  for (let s = 1; s < n; s *= 2) {
    const size = m.length, next = Array.from({ length: size * 2 }, () => new Array(size * 2).fill(0));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    m = next;
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = (m[y][x] + 0.5) / (n * n) - 0.5;
  return out;
}
const BAYER8 = bayer(8);

export const PALETTES: Record<string, string[]> = {
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'],
  pico: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  zx: ['#000000', '#0000d7', '#d70000', '#d700d7', '#00d700', '#00d7d7', '#d7d700', '#d7d7d7'],
  riso: ['#f4f0e6', '#ff48b0', '#0078bf', '#1b1b1b'],
};

/** Median-cut palette extraction: splits the colour box with the widest range. */
export function extractPalette(d: Uint8ClampedArray, n: number): RGB[] {
  const pts: RGB[] = [];
  const stride = Math.max(4, Math.floor(d.length / 4 / 6000) * 4);
  for (let i = 0; i < d.length; i += stride) pts.push([d[i], d[i + 1], d[i + 2]]);
  let boxes: RGB[][] = [pts];
  while (boxes.length < n) {
    let bi = -1, bestR = -1, bc = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { lo = Math.min(lo, p[c]); hi = Math.max(hi, p[c]); }
        if (hi - lo > bestR) { bestR = hi - lo; bi = i; bc = c; }
      }
    });
    if (bi < 0) break;
    const b = [...boxes[bi]].sort((x, y) => x[bc] - y[bc]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return [s[0] / b.length, s[1] / b.length, s[2] / b.length] as RGB;
  });
}

function nearest(pal: RGB[], r: number, g: number, b: number): RGB {
  let best = pal[0], bd = Infinity;
  for (const p of pal) {
    const dr = r - p[0], dg = g - p[1], db = b - p[2];
    const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (dist < bd) { bd = dist; best = p; }
  }
  return best;
}

export const ditherLab: EffectDefinition = {
  id: 'ditherLab',
  name: 'Dithering Lab',
  category: 'texture',
  description: 'Six error-diffusion kernels, ordered, random, dot and hatch screens, with palette extraction.',
  supportsTransparency: true,
  audioDefaults: { contrast: { band: 'bass', amount: 0.1 } },
  params: [
    {
      key: 'algorithm', label: 'Algorithm', type: 'select', group: 'Algorithm', default: 'floyd',
      options: [
        { value: 'floyd', label: 'Floyd–Steinberg' }, { value: 'atkinson', label: 'Atkinson' }, { value: 'jarvis', label: 'Jarvis–Judice–Ninke' },
        { value: 'stucki', label: 'Stucki' }, { value: 'burkes', label: 'Burkes' }, { value: 'sierra', label: 'Sierra' },
        { value: 'bayer', label: 'Ordered Bayer 8×8' }, { value: 'random', label: 'Random' }, { value: 'dot', label: 'Dot Screen' },
        { value: 'hatch', label: 'Crosshatch' }, { value: 'pattern', label: 'Brightness Pattern' },
      ],
    },
    { key: 'intensity', label: 'Dither Intensity', type: 'range', group: 'Algorithm', min: 0, max: 1.5, step: 0.01, default: 1 },
    { key: 'cell', label: 'Cell Size', type: 'range', group: 'Algorithm', min: 1, max: 24, step: 0.5, default: 3 },
    { key: 'angle', label: 'Pattern Angle', type: 'range', group: 'Algorithm', min: 0, max: 90, step: 1, default: 45, unit: '°', visibleWhen: (v) => ['bayer', 'dot', 'hatch', 'pattern'].includes(v.algorithm as string) },
    { key: 'scale', label: 'Pattern Scale', type: 'range', group: 'Algorithm', min: 2, max: 24, step: 0.5, default: 6, visibleWhen: (v) => ['dot', 'hatch', 'pattern'].includes(v.algorithm as string) },
    { key: 'seed', label: 'Random Seed', type: 'seed', group: 'Algorithm', default: 8, visibleWhen: (v) => v.algorithm === 'random' },
    {
      key: 'palette', label: 'Palette', type: 'select', group: 'Color', default: 'mono',
      options: [
        { value: 'mono', label: 'Two-Tone Ramp' }, { value: 'color', label: 'RGB Levels (Color)' }, { value: 'extract', label: 'Extract from Image' },
        { value: 'gameboy', label: 'Handheld' }, { value: 'cga', label: 'CGA' }, { value: 'pico', label: '16-Color Fantasy' },
        { value: 'zx', label: '8-Bit Home' }, { value: 'riso', label: 'Riso' }, { value: 'custom', label: 'Custom List' },
      ],
    },
    { key: 'colors', label: 'Color Count', type: 'range', group: 'Color', min: 2, max: 16, step: 1, default: 2, visibleWhen: (v) => ['mono', 'color', 'extract'].includes(v.palette as string) },
    { key: 'custom', label: 'Custom Palette', type: 'text', group: 'Color', default: '#101820,#f2542d,#f5dfbb,#0e9594', maxLength: 200, hint: 'Hex colours separated by commas.', visibleWhen: (v) => v.palette === 'custom' },
    { key: 'ink', label: 'Ink', type: 'color', group: 'Color', default: '#c6ff2e', visibleWhen: (v) => v.palette === 'mono' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#0b0b0b', visibleWhen: (v) => v.palette === 'mono' },
    { key: 'clearBg', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false, visibleWhen: (v) => v.palette === 'mono' },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 3, step: 0.01, default: 1.1 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.6, max: 0.6, step: 0.01, default: 0 },
    { key: 'gamma', label: 'Gamma', type: 'range', group: 'Tone', min: 0.3, max: 3, step: 0.01, default: 1 },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Tone', default: false },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit }) {
    const cell = Math.max(1, (p.cell as number) * unit);
    const { data, cols: w, rows: h } = cellAverages(srcCanvas, width, height, cell);
    const contrast = p.contrast as number, bright = p.brightness as number, gi = 1 / (p.gamma as number);
    const inv = p.invert as boolean;
    const mode = p.palette as string, count = p.colors as number;
    const toneLut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let v = Math.max(0, Math.min(1, (i / 255 - 0.5) * contrast + 0.5 + bright)) ** gi;
      if (inv) v = 1 - v;
      toneLut[i] = v * 255;
    }
    // Working buffer in 0..255 float RGB.
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, n = w * h; i < n; i++) for (let c = 0; c < 3; c++) buf[i * 3 + c] = toneLut[data[i * 4 + c]];

    let pal: RGB[] | null = null;
    let rampA: RGB = [0, 0, 0], rampB: RGB = [255, 255, 255];
    const mono = mode === 'mono';
    if (mono) {
      rampA = hexToRgb(p.background as string);
      rampB = hexToRgb(p.ink as string);
      for (let i = 0, n = w * h; i < n; i++) {
        const l = 0.2126 * buf[i * 3] + 0.7152 * buf[i * 3 + 1] + 0.0722 * buf[i * 3 + 2];
        buf[i * 3] = buf[i * 3 + 1] = buf[i * 3 + 2] = l;
      }
    } else if (mode === 'extract') pal = extractPalette(data, count);
    else if (mode === 'custom') {
      const list = String(p.custom).split(',').map((s) => s.trim()).filter((s) => /^#[0-9a-f]{6}$/i.test(s));
      pal = (list.length >= 2 ? list : PALETTES.gameboy).map(hexToRgb);
    } else if (mode !== 'color') pal = (PALETTES[mode] ?? PALETTES.gameboy).map(hexToRgb);

    const levels = mono || mode === 'color' ? count : Math.max(2, pal?.length ?? 2);
    const step = 255 / (levels - 1);
    const quant = (r: number, g: number, b: number): RGB => {
      if (pal) return nearest(pal, r, g, b);
      const q = (v: number) => Math.round(Math.max(0, Math.min(255, v)) / step) * step;
      return [q(r), q(g), q(b)];
    };

    const alg = p.algorithm as string;
    const intensity = p.intensity as number;
    const out = new Uint8ClampedArray(w * h * 4);
    const kernel = KERNELS[alg];
    const clear = mono && (p.clearBg as boolean);
    const put = (i: number, q: RGB) => {
      const o = i * 4;
      if (mono) {
        const t = q[0] / 255;
        out[o] = rampA[0] + (rampB[0] - rampA[0]) * t;
        out[o + 1] = rampA[1] + (rampB[1] - rampA[1]) * t;
        out[o + 2] = rampA[2] + (rampB[2] - rampA[2]) * t;
        out[o + 3] = clear ? t * 255 : 255;
      } else {
        out[o] = q[0]; out[o + 1] = q[1]; out[o + 2] = q[2]; out[o + 3] = 255;
      }
    };

    if (kernel) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
          const q = quant(r, g, b);
          put(i, q);
          const er = (r - q[0]) * intensity, eg = (g - q[1]) * intensity, eb = (b - q[2]) * intensity;
          for (const [dx, dy, wt] of kernel.k) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny >= h) continue;
            const j = (ny * w + nx) * 3, f = wt / kernel.div;
            buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
          }
        }
    } else {
      const a = ((p.angle as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const sc = (p.scale as number) / Math.max(1, cell / unit);
      const seed = p.seed as number;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const u = x * ca + y * sa, v = -x * sa + y * ca;
          let t: number;
          if (alg === 'random') t = hash2(x, y, seed) - 0.5;
          else if (alg === 'bayer') t = BAYER8[(((Math.round(v) % 8) + 8) % 8) * 8 + ((Math.round(u) % 8) + 8) % 8];
          else if (alg === 'dot') t = Math.cos((u / sc) * Math.PI * 2) * Math.cos((v / sc) * Math.PI * 2) * 0.5;
          else if (alg === 'hatch') {
            const l = (buf[i * 3] + buf[i * 3 + 1] + buf[i * 3 + 2]) / 765;
            const a1 = Math.abs(((u / sc) % 1 + 1) % 1 - 0.5) * 2;
            const a2 = Math.abs(((v / sc) % 1 + 1) % 1 - 0.5) * 2;
            t = l > 0.55 ? a1 - 0.5 : Math.max(a1, a2) - 0.5;
          } else {
            // Line period itself follows tone, so the pattern is generated from brightness.
            const l = (buf[i * 3] + buf[i * 3 + 1] + buf[i * 3 + 2]) / 765;
            const period = sc * (0.6 + l * 1.6);
            t = Math.abs(((u / period) % 1 + 1) % 1 - 0.5) - 0.25;
          }
          const k = t * step * intensity;
          put(i, quant(buf[i * 3] + k, buf[i * 3 + 1] + k, buf[i * 3 + 2] + k));
        }
    }

    const small = createCanvas(w, h);
    get2d(small).putImageData(new ImageData(out, w, h), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, w * cell, h * cell);
    ctx.imageSmoothingEnabled = true;
    small.width = small.height = 1;
  },
};
