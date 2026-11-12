/** Small, dependency-free pixel helpers shared by effects. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Rec. 709 luma, 0..1. */
export function luminance(r: number, g: number, b: number): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Deterministic PRNG (mulberry32). Same seed → same sequence. */
export function createRng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stateless integer hash → 0..1, useful for per-pixel noise without arrays. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Bilinear-free nearest sample of the source with edge clamping. */
export function sampleIndex(width: number, height: number, x: number, y: number): number {
  const xi = x < 0 ? 0 : x >= width ? width - 1 : x | 0;
  const yi = y < 0 ? 0 : y >= height ? height - 1 : y | 0;
  return (yi * width + xi) * 4;
}

/** Applies brightness (-1..1) and contrast (0..3, 1 = neutral) to a 0..1 value. */
export function adjust(v: number, brightness: number, contrast: number): number {
  return clamp01((v - 0.5) * contrast + 0.5 + brightness);
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'difference' | 'add';

export const BLEND_OPTIONS: { value: BlendMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
  { value: 'add', label: 'Add' },
];

/** Blend a single channel, both in 0..255. */
export function blendChannel(mode: BlendMode, base: number, top: number): number {
  switch (mode) {
    case 'multiply':
      return (base * top) / 255;
    case 'screen':
      return 255 - ((255 - base) * (255 - top)) / 255;
    case 'overlay':
      return base < 128 ? (2 * base * top) / 255 : 255 - (2 * (255 - base) * (255 - top)) / 255;
    case 'difference':
      return Math.abs(base - top);
    case 'add':
      return Math.min(255, base + top);
    default:
      return top;
  }
}

/** Luminance plane (0..1) of an ImageData. */
export function toLuma(src: ImageData): Float32Array {
  const d = src.data;
  const out = new Float32Array(src.width * src.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
  }
  return out;
}

/** Separable box blur of a single-channel plane, O(n) per pass regardless of radius. */
export function boxBlur(src: Float32Array, w: number, h: number, radius: number, passes = 2): Float32Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return src;
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    // horizontal a → b
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    // vertical b → a
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** Smooth 2D value noise in 0..1. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal (fBm) value noise in ~0..1. */
export function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 131) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * A smooth function worked out on a coarse grid. Slow-changing noise looks the
 * same from this, at a small share of the cost of computing it per pixel.
 */
export function coarseField(w: number, h: number, step: number, fn: (x: number, y: number) => number) {
  const gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, G = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) G[y * gw + x] = fn(x * step, y * step);
  return (x: number, y: number) => {
    const gx = x / step, gy = y / step, x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, i = y0 * gw + x0;
    const a = G[i] + (G[i + 1] - G[i]) * fx, b = G[i + gw] + (G[i + gw + 1] - G[i + gw]) * fx;
    return a + (b - a) * fy;
  };
}

/**
 * Bilinear sample of RGBA into out[o..o+3]. Coordinates are clamped,
 * or wrapped when wrap = true.
 */
export function sampleBilinear(
  d: Uint8ClampedArray, w: number, h: number, x: number, y: number,
  out: Uint8ClampedArray, o: number, wrap = false,
) {
  if (wrap) {
    x = ((x % w) + w) % w;
    y = ((y % h) + h) % h;
  }
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
    const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
    out[o + c] = top + (bot - top) * fy;
  }
}

/**
 * Average colour of each cell×cell block, computed by letting the browser
 * downscale (box filter). Returns RGBA for cols×rows cells.
 */
export function cellAverages(
  source: CanvasImageSource, width: number, height: number, cellW: number, cellH = cellW,
): { data: Uint8ClampedArray; cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(width / cellW));
  const rows = Math.max(1, Math.ceil(height / cellH));
  const small = createCanvas(cols, rows);
  const sctx = get2d(small, true);
  sctx.imageSmoothingQuality = 'high';
  // Destination is fractional so cell (c, r) maps exactly to source block (c·cellW, r·cellH).
  sctx.drawImage(source, 0, 0, width, height, 0, 0, width / cellW, height / cellH);
  const data = sctx.getImageData(0, 0, cols, rows).data;
  small.width = small.height = 1;
  return { data, cols, rows };
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function get2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently });
  if (!ctx) throw new Error('Canvas 2D is not available in this browser.');
  return ctx;
}

/** Fit (w,h) inside a max long edge, preserving aspect ratio. Never upscales. */
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(w, h);
  if (long <= maxEdge) return { width: Math.round(w), height: Math.round(h) };
  const s = maxEdge / long;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}
