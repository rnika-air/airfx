import type { GrayMap } from '../ai/client';
import { ai, frameData, normalizeDepth, tracks } from '../ai/client';
import { FrameRenderer } from '../engine/FrameRenderer';
import { airDepth, depthField } from '../effects/airDepth';
import { defaultParams, type ParamValues } from '../effects/types';
import type { ModelKey } from '../ai/models';
import { resample } from '../effects/airKey';
import { createCanvas, get2d } from '../utils/imageProcessing';
import type { Fixture } from './fixtures';

export interface LabSettings { model: ModelKey; inputSize: number }

export interface LabResult {
  id: string; title: string; type: string;
  model: string; inputSize: number; mapSize: string;
  ms: number;
  /** Share of the 0..1 range used, 10th to 90th percentile. */
  spread: number;
  /** Bits, out of 8: depth levels in use, leaving out the largest flat area such as sky. */
  entropy: number;
  near: number; far: number;
  /** near − far: positive means the scene reads the right way round. */
  separation: number;
  /** Rank correlation with real depth, where the scene has it. −1 to 1. */
  truthRank: number | null;
  /** Share of strong depth edges that sit on an image edge. */
  edgeFit: number;
  /** Detail kept in the near box ÷ detail kept in the far box, focused near. */
  focusRatio: number | null;
  passed: boolean;
  issues: string[];
  image: ImageData;
  /** What the app shows, after balance and edge refinement. */
  map: GrayMap;
  /** The model's normalised output, for rendering. */
  raw: GrayMap;
}

const mean = (m: GrayMap, b: number[]) => {
  let s = 0, n = 0;
  for (let y = Math.floor(b[1] * m.h); y < b[3] * m.h; y++) for (let x = Math.floor(b[0] * m.w); x < b[2] * m.w; x++) { s += m.data[y * m.w + x]; n++; }
  return n ? s / n : 0;
};

function ranks(v: Float32Array) {
  const order = Array.from(v.keys()).sort((a, b) => v[a] - v[b]), r = new Float32Array(v.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && v[order[j + 1]] === v[order[i]]) j++;
    for (let k = i; k <= j; k++) r[order[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** Spearman correlation. Depth models give relative depth, so order is the fair measure. */
export function rankCorrelation(a: Float32Array, b: Float32Array, valid?: (i: number) => boolean) {
  const xs: number[] = [], ys: number[] = [], step = Math.max(1, Math.floor(a.length / 30000));
  for (let i = 0; i < a.length; i += step) if (!valid || valid(i)) { xs.push(a[i]); ys.push(b[i]); }
  const A = ranks(Float32Array.from(xs)), B = ranks(Float32Array.from(ys)), n = A.length, ma = (n - 1) / 2;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const p = A[i] - ma, q = B[i] - ma; c += p * q; va += p * p; vb += q * q; }
  return c / Math.sqrt(va * vb);
}

function stats(m: GrayMap) {
  const v = Float32Array.from(m.data).sort(), hist = new Array(256).fill(0);
  for (const x of m.data) hist[Math.min(255, Math.floor(x * 256))]++;
  const top = Math.max(...hist), rest = m.data.length - top;
  let e = 0;
  for (const c of hist) if (c && c !== top) { const p = c / rest; e -= p * Math.log2(p); }
  return { spread: v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)], entropy: e };
}

/** Of the strongest depth steps, how many land within two pixels of a visible edge. */
function edgeFit(m: GrayMap, image: ImageData) {
  const { w, h } = m, g = new Float32Array(w * h);
  const small = createCanvas(w, h), sg = get2d(small, true), full = createCanvas(image.width, image.height);
  get2d(full).putImageData(image, 0, 0);
  sg.drawImage(full, 0, 0, w, h);
  const d = sg.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) g[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
  const grad = (f: Float32Array, i: number) => Math.hypot(f[i + 1] - f[i - 1], f[i + w] - f[i - w]);
  const dv: number[] = [];
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) dv.push(grad(m.data, y * w + x));
  const cut = Float32Array.from(dv).sort()[Math.floor(dv.length * 0.97)];
  let hit = 0, all = 0;
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const i = y * w + x;
      if (grad(m.data, i) < cut || cut <= 0) continue;
      all++;
      let best = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) best = Math.max(best, grad(g, i + a * w + b));
      if (best > 0.08) hit++;
    }
  return all ? hit / all : 0;
}

export async function loadFixture(f: Fixture): Promise<{ image: ImageData; truth: GrayMap | null }> {
  if (f.draw) {
    const { image, truth } = f.draw(), g = get2d(image, true);
    let hi = 0;
    for (const v of truth) if (v > hi) hi = v;
    return { image: g.getImageData(0, 0, image.width, image.height), truth: { w: image.width, h: image.height, data: truth.map((v) => v / hi) } };
  }
  const read = async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Could not fetch ${f.title} (HTTP ${r.status}).`);
    return createImageBitmap(await r.blob());
  };
  let bmp: CanvasImageSource & { width: number; height: number } = await read(f.url!);
  if (f.crop) {
    const x = Math.round(bmp.width * f.crop), y = Math.round(bmp.height * f.crop), c = createCanvas(bmp.width - x * 2, bmp.height - y * 2);
    get2d(c).drawImage(bmp, -x, -y);
    bmp = c;
  }
  const image = frameData(bmp, bmp.width, bmp.height, 1024);
  let truth: GrayMap | null = null;
  if (f.truthUrl) {
    const t = await read(f.truthUrl), c = createCanvas(t.width, t.height), g = get2d(c, true);
    g.drawImage(t, 0, 0);
    const d = g.getImageData(0, 0, t.width, t.height).data, data = new Float32Array(t.width * t.height);
    for (let i = 0; i < data.length; i++) data[i] = d[i * 4] / 255;
    truth = { w: t.width, h: t.height, data };
  }
  return { image, truth };
}

/**
 * The repeatable test for one scene: infer, normalise exactly as the app does,
 * then measure. `blurAt` renders AirFx Depth focused on the near box.
 */
export async function runFixture(f: Fixture, s: LabSettings, focusTest?: (image: ImageData, map: GrayMap, f: Fixture) => number): Promise<LabResult> {
  const { image, truth } = await loadFixture(f);
  const t0 = performance.now();
  let map = await ai.infer(s.model, image, s.inputSize);
  const ms = performance.now() - t0;
  normalizeDepth([map]);
  const raw = map;
  // Everything below scores what the app shows: balance and edge refinement included.
  map = withMap(raw, () => ({ w: image.width, h: image.height, data: Float32Array.from(depthField(image, { ...defaultParams(airDepth) }, 0).depth) }));
  const st = stats(map), near = mean(map, f.near), far = mean(map, f.far);
  let truthRank: number | null = null;
  if (truth) {
    const r = new Float32Array(resample(map, truth.w, truth.h));
    truthRank = rankCorrelation(r, truth.data, (i) => truth.data[i] > 0);
  }
  const fit = edgeFit(map, image);
  let focusRatio: number | null = null;
  if (focusTest) focusRatio = focusTest(image, raw, f);
  const issues: string[] = [];
  if (near - far < 0.15) issues.push(near < far ? 'Near and far are reversed here.' : 'Near and far barely differ here.');
  if (st.spread < 0.2) issues.push('The map is nearly flat.');
  // Sky is one value and rightly so, so judge the levels in the rest of the picture.
  if (st.entropy < 5) issues.push('Few depth levels in use.');
  if (truthRank !== null && truthRank < 0.8) issues.push(`Weak match to real depth (${truthRank.toFixed(2)}).`);
  if (focusRatio !== null && focusRatio < 1.5) issues.push('Focus does not separate near from far.');
  return { id: f.id, title: f.title, type: f.type, model: s.model, inputSize: s.inputSize, mapSize: `${map.w}×${map.h}`, ms, ...st, near, far, separation: near - far, truthRank, edgeFit: fit, focusRatio, passed: !issues.length, issues, image, map, raw };
}

/** Runs with this map as the live depth, then puts the user's back. */
function withMap<T>(map: GrayMap, run: () => T): T {
  const saved = { frames: tracks.depth.frames, fps: tracks.depth.fps, key: tracks.depth.sourceKey, kind: tracks.depth.kind };
  tracks.depth.setStill(map, 'lab');
  try {
    return run();
  } finally {
    tracks.depth.frames = saved.frames; tracks.depth.fps = saved.fps; tracks.depth.sourceKey = saved.key; tracks.depth.kind = saved.kind; tracks.depth.version++;
  }
}

/** Laplacian energy in a box: how much fine detail is there. */
function detail(d: Uint8ClampedArray, w: number, h: number, b: number[]) {
  const l = (i: number) => d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2];
  let s = 0, n = 0;
  for (let y = Math.max(1, Math.floor(b[1] * h)); y < Math.min(h - 1, b[3] * h); y++)
    for (let x = Math.max(1, Math.floor(b[0] * w)); x < Math.min(w - 1, b[2] * w); x++) {
      const i = y * w + x;
      s += Math.abs(4 * l(i) - l(i - 1) - l(i + 1) - l(i - w) - l(i + w)); n++;
    }
  return n ? s / n : 0;
}

/**
 * Renders the real AirFx Depth effect focused on the near box and compares how
 * much detail each box keeps, near ÷ far. The picture is fine noise, because a
 * plain sky has no detail to lose and would say nothing about the blur.
 */
export function measureFocus(image: ImageData, map: GrayMap, f: Fixture) {
  const { width: w, height: h } = image, r = new FrameRenderer(), source = createCanvas(w, h), target = createCanvas(1, 1), g = get2d(source, true);
  const noise = g.createImageData(w, h);
  let seed = 7;
  for (let i = 0; i < noise.data.length; i += 4) { seed = (seed * 16807) % 2147483647; noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = seed & 255; noise.data[i + 3] = 255; }
  g.putImageData(noise, 0, 0);
  try {
    return withMap(map, () => {
      const params: ParamValues = { ...defaultParams(airDepth), edgeRefine: 0 }, field = depthField(noise, params, 0);
      let s = 0, n = 0;
      for (let y = Math.floor(f.near[1] * h); y < f.near[3] * h; y++) for (let x = Math.floor(f.near[0] * w); x < f.near[2] * w; x++) { s += field.depth[y * w + x]; n++; }
      params.focus = n ? s / n : 0.5;
      r.render({ source, target, width: w, height: h, layers: [{ effect: airDepth, params }], time: 0, frame: 0 });
      const out = get2d(target, true).getImageData(0, 0, w, h).data;
      const kept = (b: number[]) => detail(out, w, h, b) / Math.max(1e-6, detail(noise.data, w, h, b));
      return kept(f.near) / Math.max(0.01, kept(f.far));
    });
  } finally {
    r.dispose();
  }
}

/** The real AirFx Depth effect focused on the near box, for showing what the map does. */
export function focusPreview(image: ImageData, raw: GrayMap, f: Fixture) {
  const { width: w, height: h } = image, r = new FrameRenderer(), source = createCanvas(w, h), target = createCanvas(1, 1);
  get2d(source).putImageData(image, 0, 0);
  try {
    return withMap(raw, () => {
      const params: ParamValues = { ...defaultParams(airDepth) }, field = depthField(image, params, 0);
      const v: number[] = [];
      for (let y = Math.floor(f.near[1] * h); y < f.near[3] * h; y++) for (let x = Math.floor(f.near[0] * w); x < f.near[2] * w; x++) v.push(field.depth[y * w + x]);
      v.sort((a, b) => a - b);
      params.focus = v[v.length >> 1] ?? 0.5;
      r.render({ source, target, width: w, height: h, layers: [{ effect: airDepth, params }], time: 0, frame: 0 });
      return get2d(target, true).getImageData(0, 0, w, h);
    });
  } finally {
    r.dispose();
  }
}

/** A map reduced to a small grid: enough to notice when a model update changes the result. */
export function mapSignature(m: GrayMap) {
  const W = 48, H = 27, out: number[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(Math.round(m.data[Math.floor(((y + 0.5) / H) * m.h) * m.w + Math.floor(((x + 0.5) / W) * m.w)] * 255));
  return out;
}

export interface Baseline { model: string; inputSize: number; maps: Record<string, number[]> }

/** How closely a map still matches the stored one: rank correlation, 1 is identical order. */
export const matchBaseline = (m: GrayMap, stored: number[]) => rankCorrelation(Float32Array.from(mapSignature(m)), Float32Array.from(stored));

export function reportMarkdown(rows: LabResult[], fixtures: Fixture[], modelName: (k: string) => string) {
  const line = (r: LabResult) => `| ${r.type} | ${modelName(r.model)} | ${r.inputSize} | ${r.mapSize} | ${(r.ms / 1000).toFixed(2)} s | ${r.separation.toFixed(2)} | ${r.spread.toFixed(2)} | ${r.entropy.toFixed(1)} | ${r.truthRank === null ? '–' : r.truthRank.toFixed(3)} | ${(r.edgeFit * 100).toFixed(0)}% | ${r.focusRatio === null ? '–' : `${r.focusRatio.toFixed(1)}×`} | ${r.passed ? 'Pass' : r.issues.join(' ')} |`;
  return `# AirFx Depth Test Report\n\n| Scene | Model | Input | Map | Time | Near − Far | Spread | Bits | Truth rank | Edge fit | Focus | Result |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.map(line).join('\n')}\n\n## Scenes\n\n${fixtures.map((f) => `- **${f.type}:** ${f.checks}. ${f.source}.`).join('\n')}\n`;
}
