import { selection } from '../ai/selection';
import { createCanvas, get2d, rgbToHex } from '../utils/imageProcessing';

/**
 * Looks at a picture or a video before effects are applied: how bright and
 * contrasty it is, its colours, how busy it is, where the subject probably
 * is, and (for video) how much it moves. All measured from the pixels, in the
 * browser; nothing is uploaded and no AI model is involved.
 *
 * The result only feeds suggestions the person can apply or ignore.
 */

export interface MediaAnalysis {
  kind: 'image' | 'video';
  /** Mean brightness 0..1. */
  brightness: number;
  /** Spread of brightness (standard deviation) 0..~0.5. */
  contrast: number;
  /** 2nd and 98th percentile of brightness. */
  lo: number; hi: number;
  median: number;
  saturation: number;
  /** −1 cool … +1 warm. */
  warmth: number;
  /** Dominant colours, most common first. */
  colors: string[];
  /** The most vivid of them. */
  vivid: string | null;
  /** Edge density 0..1. */
  detail: number;
  /** Where the subject is, as fractions of the frame. */
  subject: { x: number; y: number; w: number; h: number; from: 'selection' | 'estimate' };
  /** Edge density outside the subject 0..1. */
  backgroundBusy: number;
  brightest: { x: number; y: number; level: number };
  /** Video only: mean change between frames 0..1, and brightness changes. */
  motion: number;
  flicker: number;
  /** Plain-language findings. */
  tags: string[];
}

const N = 96;

interface Sample { L: Float32Array; d: Uint8ClampedArray; w: number; h: number }

function grab(source: CanvasImageSource, sw: number, sh: number): Sample {
  const k = N / Math.max(sw, sh), w = Math.max(8, Math.round(sw * k)), h = Math.max(8, Math.round(sh * k));
  const c = createCanvas(w, h), g = get2d(c, true);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, L = new Float32Array(w * h);
  for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  return { L, d, w, h };
}

/** Small k-means on the colours, seeded from a spread of the pixels. */
function dominant(d: Uint8ClampedArray, k = 5) {
  const px: number[][] = [];
  for (let i = 0; i < d.length; i += 4 * 3) px.push([d[i], d[i + 1], d[i + 2]]);
  const cent = Array.from({ length: k }, (_, j) => [...px[Math.floor((j + 0.5) * px.length / k)]]);
  const count = new Array(k).fill(0);
  for (let it = 0; it < 8; it++) {
    const sum = cent.map(() => [0, 0, 0]);
    count.fill(0);
    for (const p of px) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < k; j++) { const dd = (p[0] - cent[j][0]) ** 2 + (p[1] - cent[j][1]) ** 2 + (p[2] - cent[j][2]) ** 2; if (dd < bd) { bd = dd; best = j; } }
      sum[best][0] += p[0]; sum[best][1] += p[1]; sum[best][2] += p[2]; count[best]++;
    }
    for (let j = 0; j < k; j++) if (count[j]) cent[j] = sum[j].map((v) => v / count[j]);
  }
  return cent.map((c, j) => ({ c: c.map(Math.round) as [number, number, number], n: count[j] })).filter((x) => x.n).sort((a, b) => b.n - a.n);
}

const sat = ([r, g, b]: number[]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };

function blur(F: Float32Array, w: number, h: number, r: number) {
  const o = new Float32Array(F.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, y - r); j <= Math.min(h - 1, y + r); j += 2) for (let i = Math.max(0, x - r); i <= Math.min(w - 1, x + r); i += 2) { s += F[j * w + i]; n++; }
      o[y * w + x] = s / n;
    }
  return o;
}

export function analyseSample(s: Sample, kind: 'image' | 'video', time = 0): MediaAnalysis {
  const { L, d, w, h } = s, n = w * h;
  let sum = 0, sum2 = 0, ssum = 0, warm = 0;
  for (let i = 0; i < n; i++) {
    sum += L[i]; sum2 += L[i] * L[i];
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    ssum += sat([r, g, b]);
    warm += (r - b) / 255;
  }
  const brightness = sum / n, contrast = Math.sqrt(Math.max(0, sum2 / n - brightness * brightness));
  const sorted = Float32Array.from(L).sort(), at = (q: number) => sorted[Math.min(n - 1, Math.floor(q * n))];

  // Edges, and a saliency estimate: how much each spot differs from its surroundings.
  const E = new Float32Array(n);
  let edges = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, e = Math.hypot(L[i + 1] - L[i - 1], L[i + w] - L[i - w]); E[i] = e; if (e > 0.08) edges++; }
  const surround = blur(L, w, h, 10), Ec = blur(E, w, h, 2);
  const sal = new Float32Array(n);
  let smax = 1e-6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, dx = x / w - 0.5, dy = y / h - 0.5, centre = 1 - Math.min(1, (dx * dx + dy * dy) * 1.6);
    const v = (Math.abs(L[i] - surround[i]) * 2 + Ec[i] * 3 + sat([d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]) * 0.3) * (0.55 + 0.45 * centre);
    sal[i] = v; if (v > smax) smax = v;
  }
  let subject: MediaAnalysis['subject'];
  const mask = selection.union(time);
  if (mask) {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0, any = false;
    for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) if (mask.data[y * mask.w + x] > 0.5) { any = true; x0 = Math.min(x0, x / mask.w); y0 = Math.min(y0, y / mask.h); x1 = Math.max(x1, x / mask.w); y1 = Math.max(y1, y / mask.h); }
    subject = any ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, from: 'selection' } : { x: 0.5, y: 0.5, w: 0.4, h: 0.5, from: 'estimate' };
  } else {
    // The most salient sixth of the frame: its weighted centre and extent.
    const cut = Float32Array.from(sal).sort()[Math.floor(n * 0.83)];
    let sx = 0, sy = 0, sw = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = sal[y * w + x]; if (v < cut) continue; sx += x * v; sy += y * v; sw += v; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    subject = sw ? { x: sx / sw / w, y: sy / sw / h, w: (x1 - x0) / w, h: (y1 - y0) / h, from: 'estimate' } : { x: 0.5, y: 0.5, w: 0.5, h: 0.5, from: 'estimate' };
  }
  // Busy background: edges away from the subject box.
  let bgE = 0, bgN = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const fx = x / w, fy = y / h;
    if (Math.abs(fx - subject.x) < subject.w / 2 && Math.abs(fy - subject.y) < subject.h / 2) continue;
    bgN++; if (E[y * w + x] > 0.08) bgE++;
  }
  // Brightest spot, smoothed so one hot pixel does not win.
  const Lb = blur(L, w, h, 2);
  let bi = 0;
  for (let i = 0; i < n; i++) if (Lb[i] > Lb[bi]) bi = i;

  const dom = dominant(d);
  const vividC = dom.filter((x) => sat(x.c) > 0.35 && x.n > n * 0.015).sort((a, b) => sat(b.c) * Math.sqrt(b.n) - sat(a.c) * Math.sqrt(a.n))[0];
  const a: MediaAnalysis = {
    kind, brightness, contrast, lo: at(0.02), hi: at(0.98), median: at(0.5), saturation: ssum / n, warmth: Math.max(-1, Math.min(1, (warm / n) * 4)),
    colors: dom.map((x) => rgbToHex(x.c)), vivid: vividC ? rgbToHex(vividC.c) : null,
    detail: Math.min(1, edges / n * 3), subject, backgroundBusy: bgN ? Math.min(1, (bgE / bgN) * 3) : 0,
    brightest: { x: (bi % w) / w, y: Math.floor(bi / w) / h, level: Lb[bi] }, motion: 0, flicker: 0, tags: [],
  };
  return a;
}

export function describe(a: MediaAnalysis): string[] {
  const t: string[] = [];
  if (a.brightness < 0.28) t.push('Dark'); else if (a.brightness > 0.68) t.push('Bright');
  if (a.contrast < 0.14) t.push('Low contrast'); else if (a.contrast > 0.3) t.push('High contrast');
  if (a.saturation < 0.12) t.push('Nearly colourless'); else if (a.saturation > 0.45) t.push('Vivid colour');
  if (a.warmth > 0.25) t.push('Warm'); else if (a.warmth < -0.2) t.push('Cool');
  if (a.detail > 0.55) t.push('Highly detailed'); else if (a.detail < 0.15) t.push('Simple, flat areas');
  if (a.backgroundBusy > 0.5) t.push('Busy background');
  const third = a.subject.x < 0.4 ? 'left' : a.subject.x > 0.6 ? 'right' : 'centre';
  t.push(a.subject.from === 'selection' ? `Selected subject, ${third}` : `Subject likely ${third}`);
  if (a.hi < 0.72) t.push('No real highlights');
  if (a.kind === 'video') {
    if (a.motion > 0.06) t.push('Lots of movement'); else if (a.motion < 0.015) t.push('Little movement');
    if (a.flicker > 0.04) t.push('Changing light');
  }
  return t;
}

/** Analyses a still. */
export function analyseImage(img: CanvasImageSource, w: number, h: number): MediaAnalysis {
  const a = analyseSample(grab(img, w, h), 'image');
  a.tags = describe(a);
  return a;
}

/**
 * Analyses a video from a few frames spread over its length, using its own
 * hidden copy so playback is not disturbed.
 */
export async function analyseVideo(url: string, duration: number, w: number, h: number, signal?: AbortSignal): Promise<MediaAnalysis> {
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  await new Promise<void>((ok, no) => { v.onloadeddata = () => ok(); v.onerror = () => no(new Error('The video could not be read.')); });
  const count = 6, samples: Sample[] = [], pairs: number[] = [];
  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error('aborted');
      const t = Math.min(Math.max(0, duration - 0.1), (duration * (i + 0.5)) / count);
      for (const dt of [0, 1 / 12]) {
        v.currentTime = t + dt;
        await new Promise((ok) => { v.onseeked = ok; });
        const s = grab(v, w, h);
        if (dt === 0) samples.push(s);
        else {
          // Movement: change over 1/12 s, against the frame just before.
          const a = samples[samples.length - 1].L;
          let m = 0;
          for (let k = 0; k < a.length; k++) m += Math.abs(a[k] - s.L[k]);
          pairs.push(m / a.length);
        }
      }
    }
  } finally {
    v.removeAttribute('src'); v.load();
  }
  const mid = samples[Math.floor(samples.length / 2)];
  const out = analyseSample(mid, 'video');
  const means = samples.map((s) => s.L.reduce((a, b) => a + b, 0) / s.L.length);
  const avg = means.reduce((a, b) => a + b, 0) / means.length;
  out.brightness = avg;
  out.motion = pairs.reduce((a, b) => a + b, 0) / Math.max(1, pairs.length);
  out.flicker = Math.sqrt(means.reduce((a, b) => a + (b - avg) ** 2, 0) / means.length);
  out.tags = describe(out);
  return out;
}
