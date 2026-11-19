import type { ParamDef } from './types';
import { createCanvas, get2d } from '../utils/imageProcessing';

/**
 * Auto Tone: measures where a picture's tones really sit and stretches them
 * to the full range before a tone-driven effect runs (threshold, dots,
 * halftone, ASCII, dithering…). Without it those effects use fixed brightness
 * cut-offs, so a night shot turns black and a white page turns blank.
 *
 * On video the measurement is eased over time, so the picture does not pump
 * when a bright object crosses the frame. It is a visible switch on every
 * effect that uses it.
 */

export const AUTO_TONE: ParamDef = {
  key: 'autoTone', label: 'Auto Tone', type: 'toggle', group: 'Tone', default: true,
  hint: 'Stretches the picture’s own darkest and brightest tones first, so dark, bright and flat media all give a full result.',
};

export interface ToneLevels { lo: number; hi: number }

const probe = createCanvas(96, 96);

/** 1st and 99th percentile of luminance (0..1), ignoring transparent pixels. */
export function measureLevels(source: CanvasImageSource, w: number, h: number): ToneLevels {
  const k = Math.min(1, 96 / Math.max(w, h)), pw = Math.max(1, Math.round(w * k)), ph = Math.max(1, Math.round(h * k));
  if (probe.width !== pw) probe.width = pw;
  if (probe.height !== ph) probe.height = ph;
  const g = get2d(probe, true);
  g.clearRect(0, 0, pw, ph);
  g.imageSmoothingQuality = 'medium';
  g.drawImage(source, 0, 0, pw, ph);
  const d = g.getImageData(0, 0, pw, ph).data, hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    hist[Math.round(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2])]++;
    n++;
  }
  if (!n) return { lo: 0, hi: 1 };
  const at = (q: number) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * n) return v / 255; } return 1; };
  return { lo: at(0.01), hi: at(0.99) };
}

/**
 * The stretch actually used. It never pushes harder than 3×, keeps a
 * picture that already spans the range as it is, and leaves a little room at
 * both ends so highlights and shadows keep some detail.
 */
export function toneRange({ lo, hi }: ToneLevels): ToneLevels {
  let a = Math.min(lo, 0.4), b = Math.max(hi, a + 0.05);
  const span = b - a;
  if (span < 1 / 3) { const mid = (a + b) / 2; a = mid - 1 / 6; b = mid + 1 / 6; }
  if (a < 0.03) a = 0;
  if (b > 0.97) b = 1;
  return { lo: Math.max(0, a), hi: Math.min(1, b) };
}

export const KEEP_BRIGHTNESS: ParamDef = {
  key: 'keepBrightness', label: 'Keep Brightness', type: 'toggle', group: 'Tone', default: true,
  hint: 'Lifts the result back to the picture’s own overall brightness, so the pattern does not darken it.',
};

/** Mean luminance (0..255) on a sparse grid of pixels. */
function meanLuma(d: Uint8ClampedArray, step = 7) {
  let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * step) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
  return n ? s / n : 0;
}

/**
 * Scales a result so its overall brightness matches the source's. A pattern
 * laid over a picture by multiplying always darkens it; this undoes only that
 * overall loss and keeps the pattern. Never lifts more than 2.2×.
 */
export function matchBrightness(out: ImageData, src: ImageData, strength = 1) {
  const a = meanLuma(src.data), b = meanLuma(out.data);
  if (b < 1 || a <= b) return;
  const k = 1 + (Math.min(2.2, a / b) - 1) * strength, d = out.data;
  for (let i = 0; i < d.length; i += 4) { d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; }
}

export const STEADY: ParamDef = {
  key: 'steady', label: 'Steady On Video', type: 'toggle', group: 'Tone', default: true,
  hint: 'Areas that did not change keep their dots from the frame before, so dithering does not boil on video.',
};

/**
 * Temporal coherence for dithering. Error diffusion turns the tiniest change
 * anywhere into a different dot pattern everywhere after it, so video
 * "boils". Here a cell whose input changed less than `tol` since it was last
 * redrawn keeps its previous output. Moving areas redraw at once; slow drifts
 * redraw once they add up. Same frame, or new settings: everything redraws.
 */
export class Steady {
  private inp: Float32Array | null = null;
  private out: Float32Array | null = null;
  private t = -1;
  private key = '';

  /**
   * `input`: per-cell values before dithering (`per` values a cell), on 0..1.
   * `output`: per-cell results after dithering (`outPer` values a cell), changed in place.
   */
  apply(key: string, time: number, input: Float32Array, per: number, output: Float32Array | Uint8ClampedArray, outPer: number, tol = 0.035) {
    const cells = input.length / per;
    const cont = key === this.key && this.inp?.length === input.length && this.out?.length === output.length && time > this.t && time - this.t <= 0.5;
    if (cont) {
      const pi = this.inp!, po = this.out!;
      for (let c = 0; c < cells; c++) {
        let d = 0;
        for (let k = 0; k < per; k++) d = Math.max(d, Math.abs(input[c * per + k] - pi[c * per + k]));
        if (d < tol) for (let k = 0; k < outPer; k++) output[c * outPer + k] = po[c * outPer + k];
        else for (let k = 0; k < per; k++) pi[c * per + k] = input[c * per + k];
      }
    } else this.inp = Float32Array.from(input);
    this.out = Float32Array.from(output);
    this.key = key;
    this.t = time;
  }
}

interface Memory { t: number; lo: number; hi: number }

/**
 * Keeps one eased measurement per renderer step. The same frame always gives
 * the same answer; consecutive video frames ease towards the new value over
 * about half a second, whatever the frame rate, so preview and export agree.
 */
export class ToneTracker {
  private mem = new Map<string, Memory>();
  private out = createCanvas(1, 1);

  levels(key: string, source: CanvasImageSource, w: number, h: number, time: number): ToneLevels {
    const now = toneRange(measureLevels(source, w, h));
    const m = this.mem.get(key);
    const dt = m ? time - m.t : 0;
    if (!m || dt <= 0 || dt > 0.75) { this.mem.set(key, { t: time, ...now }); return now; }
    const k = 1 - Math.exp(-dt / 0.45);
    const lo = m.lo + (now.lo - m.lo) * k, hi = m.hi + (now.hi - m.hi) * k;
    this.mem.set(key, { t: time, lo, hi });
    return { lo, hi };
  }

  /**
   * The source's pixels with their tones stretched, or null when nothing needs
   * doing. Pixels only: most steps read pixels, so writing them back into a
   * canvas (and reading them out again) is left to toCanvas, for the steps that
   * draw from a canvas.
   */
  stretch(key: string, source: HTMLCanvasElement, w: number, h: number, time: number): ImageData | null {
    const { lo, hi } = this.levels(key, source, w, h, time);
    if (lo <= 0.001 && hi >= 0.999) return null;
    const im = get2d(source, true).getImageData(0, 0, w, h), d = im.data;
    const lut = new Uint8ClampedArray(256), a = lo * 255, k = 1 / Math.max(1e-3, hi - lo);
    for (let v = 0; v < 256; v++) lut[v] = (v - a) * k;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    return im;
  }

  /** Stretched pixels as a canvas, for steps that draw from one. */
  toCanvas(im: ImageData): HTMLCanvasElement {
    const c = this.out;
    if (c.width !== im.width) c.width = im.width;
    if (c.height !== im.height) c.height = im.height;
    get2d(c, true).putImageData(im, 0, 0);
    return c;
  }

  /** The source with its tones stretched, or the source itself when nothing needs doing. */
  apply(key: string, source: HTMLCanvasElement, w: number, h: number, time: number): HTMLCanvasElement {
    const im = this.stretch(key, source, w, h, time);
    return im ? this.toCanvas(im) : source;
  }

  clear() { this.mem.clear(); this.out.width = this.out.height = 1; }
}
