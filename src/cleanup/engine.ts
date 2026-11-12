import { ai, edits, frameData, type GrayMap } from '../ai/client';
import { estimateMotion, grayOf, type Gray } from '../ai/motion';
import { selection, sourceKeyOf } from '../ai/selection';
import { resample } from '../effects/airKey';
import type { LoadedMedia } from '../hooks/useMedia';
import { boxBlur, createCanvas, get2d } from '../utils/imageProcessing';
import { disposeVideo, loadVideo, seekVideo } from '../utils/videoProcessing';
import type { FillOptions, FillSource } from './inpaint';

/**
 * AirFx Cleanup. A result ("plate") holds only the reconstructed region: its
 * alpha is the feathered mask, so everything outside the mask stays exactly
 * the source. The airCleanup stack step lays it over the image.
 */

export type FillMethod = 'march' | 'patch' | 'lama' | 'reference' | 'manual' | 'temporal';

export const METHOD_INFO: Record<FillMethod, { label: string; kind: string; note: string }> = {
  march: { label: 'Local Inpaint', kind: 'Local inpainting', note: 'Grows the edges inward. Best for scratches, wires, small specks.' },
  patch: { label: 'Patch Reconstruction', kind: 'Local inpainting', note: 'Copies matching patches from elsewhere in this image. Best for walls, grass, repeating texture.' },
  lama: { label: 'AI Reconstruction', kind: 'AI-generated reconstruction', note: 'LaMa rebuilds structure from the surrounding image. Larger holes. Softer detail.' },
  reference: { label: 'Reference Guided', kind: 'Reference-guided reconstruction', note: 'Patches may also come from a reference image you supply.' },
  manual: { label: 'Manual Patch', kind: 'Manual patching', note: 'Paints pixels from a source point you choose.' },
  temporal: { label: 'Video Reconstruction', kind: 'Temporal reconstruction', note: 'Reveals the background from other frames, then fills only what no frame shows.' },
};

export interface CleanSettings {
  expand: number; feather: number; continuity: number; detail: number; preserve: number; perspective: number; radius?: number;
}

export interface PlateFrame { x: number; y: number; w: number; h: number; bitmap: ImageBitmap }

export interface Attempt {
  id: string;
  n: number;
  method: FillMethod;
  /** Tied to one source and one mask: a stale result is never shown as current. */
  sourceKey: string;
  maskSig: string;
  /** Size the plate coordinates refer to. */
  width: number;
  height: number;
  /** One entry for a still. */
  frames: PlateFrame[];
  fps: number;
  note?: string;
}

class CleanupStore {
  attempts: Attempt[] = [];
  activeId: string | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  bump() { this.version++; this.listeners.forEach((f) => f()); }
  get active() { return this.attempts.find((a) => a.id === this.activeId) ?? null; }
  add(a: Attempt) { this.attempts = [...this.attempts, a]; this.activeId = a.id; this.bump(); }
  choose(id: string | null) { this.activeId = id; this.bump(); }
  remove(id: string) {
    const a = this.attempts.find((x) => x.id === id);
    a?.frames.forEach((f) => f.bitmap.close());
    this.attempts = this.attempts.filter((x) => x.id !== id);
    if (this.activeId === id) this.activeId = this.attempts[this.attempts.length - 1]?.id ?? null;
    this.bump();
  }
  clear() { this.attempts.forEach((a) => a.frames.forEach((f) => f.bitmap.close())); this.attempts = []; this.activeId = null; this.bump(); }
  /** The plate to draw at a time. */
  at(time: number): PlateFrame | null {
    const a = this.active;
    if (!a) return null;
    if (a.frames.length === 1 || !a.fps) return a.frames[0] ?? null;
    return a.frames[Math.min(a.frames.length - 1, Math.round(time * a.fps))] ?? null;
  }
}

export const cleanup = new CleanupStore();

/* ── Fill worker ────────────────────────────────────────────────── */

let worker: Worker | null = null;
let seq = 0;
const jobs = new Map<number, { resolve: (d: Uint8ClampedArray) => void; reject: (e: Error) => void; progress?: (f: number) => void }>();

function fillWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./fillWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const j = jobs.get(e.data.id);
    if (!j) return;
    if (e.data.type === 'progress') return j.progress?.(e.data.f);
    jobs.delete(e.data.id);
    if (e.data.type === 'error') j.reject(new Error(e.data.message));
    else j.resolve(e.data.rgba);
  };
  return worker;
}

let dropModelFill: ((e: Error) => void) | null = null;

/**
 * Stops the running fill. A classical fill is killed and its worker restarts on
 * the next job. A model run cannot be interrupted, and killing its worker would
 * unload every model, so its answer is discarded instead.
 */
export function cancelFill() {
  worker?.terminate();
  worker = null;
  const cancelled = new DOMException('cancelled', 'AbortError');
  for (const j of jobs.values()) j.reject(cancelled);
  jobs.clear();
  dropModelFill?.(cancelled);
}

function runFill(method: 'march' | 'patch', rgba: Uint8ClampedArray, width: number, height: number, mask: Uint8Array, opts: FillOptions, reference: FillSource | null, progress?: (f: number) => void) {
  const id = ++seq;
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    jobs.set(id, { resolve, reject, progress });
    fillWorker().postMessage({ id, method, rgba, width, height, mask, opts, reference }, [rgba.buffer, mask.buffer]);
  });
}

/* ── Masks ──────────────────────────────────────────────────────── */

/** Selection plus the Cleanup brush, as a hard mask at w × h. */
export function removalMask(w: number, h: number, time: number, expand: number) {
  const n = w * h, m = new Uint8Array(n);
  const sel: GrayMap | null = selection.union(time);
  if (sel) {
    const s = resample(sel, w, h);
    for (let i = 0; i < n; i++) if (s[i] > 0.45) m[i] = 1;
  }
  const b = edits.clean;
  if (b.w) {
    const e = resample({ w: b.w, h: b.h, data: b.data }, w, h);
    for (let i = 0; i < n; i++) { if (e[i] > 0.4) m[i] = 1; }
  }
  return expand > 0 ? grow(m, w, h, Math.round(expand)) : m;
}

function grow(m: Uint8Array, w: number, h: number, r: number) {
  // Round dilation: a square one leaves corners of the object's halo behind.
  const d = new Float32Array(w * h).fill(1e9), o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; d[y * w + x] = Math.min(d[y * w + x], (x - last) ** 2); }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; d[y * w + x] = Math.min(d[y * w + x], (last - x) ** 2); }
  }
  const r2 = r * r, col = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = d[y * w + x];
    for (let y = 0; y < h; y++) {
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h && col[yy] + k * k <= r2) { o[y * w + x] = 1; break; }
      }
    }
  }
  return o;
}

function boundsOf(m: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const signature = (m: Uint8Array) => {
  let h = 2166136261;
  for (let i = 0; i < m.length; i += 13) h = Math.imul(h ^ m[i], 16777619);
  return (h >>> 0).toString(36);
};

/** The feathered alpha, confined so an edge never bleeds far from the mask. */
function featherAlpha(m: Uint8Array, w: number, h: number, feather: number) {
  const a = new Float32Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = m[i];
  if (feather < 0.5) return a;
  const b = boxBlur(a, w, h, feather, 2);
  // The hole itself stays fully filled; only the rim outside it fades.
  for (let i = 0; i < a.length; i++) b[i] = m[i] ? 1 : Math.min(1, b[i] * 2);
  return b;
}

async function makePlate(full: Uint8ClampedArray, w: number, h: number, m: Uint8Array, feather: number): Promise<PlateFrame> {
  const a = featherAlpha(m, w, h, feather), bx = boundsOf(a.reduce<Uint8Array>((o, v, i) => { o[i] = v > 0.003 ? 1 : 0; return o; }, new Uint8Array(w * h)), w, h)!;
  const cw = bx.x1 - bx.x0 + 1, ch = bx.y1 - bx.y0 + 1, out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const s = ((y + bx.y0) * w + x + bx.x0), t = (y * cw + x) * 4;
      out.data[t] = full[s * 4]; out.data[t + 1] = full[s * 4 + 1]; out.data[t + 2] = full[s * 4 + 2]; out.data[t + 3] = a[s] * 255;
    }
  return { x: bx.x0, y: bx.y0, w: cw, h: ch, bitmap: await createImageBitmap(out) };
}

function fillOptions(s: CleanSettings, seed: number): FillOptions {
  return {
    patchRadius: Math.round(3 + s.continuity * 9 - s.detail * 2),
    iterations: Math.round(3 + s.detail * 3),
    nearby: s.preserve,
    scaleRange: s.perspective * 0.4,
    seed,
  };
}

/** Crops a square around the hole, runs LaMa at its 512 size, and returns full-size pixels. */
async function lamaFill(img: ImageData, m: Uint8Array, detail: number) {
  const { width: w, height: h } = img, b = boundsOf(m, w, h)!;
  // More context helps structure; a tighter crop keeps more pixels per hole.
  const span = Math.max(b.x1 - b.x0, b.y1 - b.y0) + 1, side = Math.min(Math.max(w, h), Math.max(256, Math.round(span * (2.4 - detail * 1.1))));
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, sw = Math.min(w, side), sh = Math.min(h, side);
  const sx = Math.round(Math.min(w - sw, Math.max(0, cx - sw / 2))), sy = Math.round(Math.min(h - sh, Math.max(0, cy - sh / 2)));
  const src = createCanvas(w, h), sg = get2d(src, true);
  sg.putImageData(img, 0, 0);
  const S = 512, c = createCanvas(S, S), g = get2d(c, true);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, sx, sy, sw, sh, 0, 0, S, S);
  const rgba = g.getImageData(0, 0, S, S).data, mask = new Uint8Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Any touch counts as a hole, so no object pixels reach the model.
      let on = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const px = Math.min(w - 1, sx + ((x + dx * 0.99) * sw) / S) | 0, py = Math.min(h - 1, sy + ((y + dy * 0.99) * sh) / S) | 0;
        if (m[py * w + px]) on = 1;
      }
      mask[y * S + x] = on ? 255 : 0;
    }
  const res = await new Promise<Awaited<ReturnType<typeof ai.inpaint>>>((resolve, reject) => {
    dropModelFill = reject;
    ai.inpaint(rgba, mask).then(resolve, reject);
  }).finally(() => { dropModelFill = null; });
  const rc = createCanvas(S, S);
  get2d(rc).putImageData(new ImageData(new Uint8ClampedArray(res), S, S), 0, 0);
  const out = createCanvas(w, h), og = get2d(out, true);
  og.putImageData(img, 0, 0);
  og.imageSmoothingQuality = 'high';
  og.drawImage(rc, 0, 0, S, S, sx, sy, sw, sh);
  return og.getImageData(0, 0, w, h).data;
}

async function spatialFill(method: FillMethod, img: ImageData, m: Uint8Array, s: CleanSettings, seed: number, reference: FillSource | null, progress?: (f: number) => void) {
  if (method === 'lama') return lamaFill(img, m, s.detail);
  const rgba = new Uint8ClampedArray(img.data), mask = new Uint8Array(m);
  if (method === 'march') return runFill('march', rgba, img.width, img.height, mask, { ...fillOptions(s, seed), patchRadius: 6 }, null);
  return runFill('patch', rgba, img.width, img.height, mask, fillOptions(s, seed), method === 'reference' ? reference : null, progress);
}

/* ── Stills ─────────────────────────────────────────────────────── */

export async function loadReference(file: File, maxEdge = 1024): Promise<FillSource> {
  const bmp = await createImageBitmap(file);
  const img = frameData(bmp, bmp.width, bmp.height, maxEdge);
  bmp.close();
  return { rgba: img.data, width: img.width, height: img.height };
}

export function hasRemovalMask(media: LoadedMedia, time: number) {
  const m = removalMask(64, Math.max(2, Math.round((64 * media.height) / media.width)), time, 0);
  return m.some((v) => v);
}

export async function reconstruct(media: LoadedMedia, time: number, method: FillMethod, s: CleanSettings, reference: FillSource | null, progress: (f: number) => void) {
  const img = frameData(media.element, media.width, media.height, 1600);
  const { width: w, height: h } = img, unit = Math.max(w, h) / 1000;
  const m = removalMask(w, h, time, s.expand * unit);
  if (!m.some((v) => v)) throw new Error('Select or paint what to remove first.');
  const n = cleanup.attempts.length + 1;
  const full = await spatialFill(method, img, m, s, n * 7919, reference, progress);
  const plate = await makePlate(full, w, h, m, s.feather * unit);
  cleanup.add({ id: `a${Date.now()}`, n, method, sourceKey: sourceKeyOf(media), maskSig: signature(m), width: w, height: h, frames: [plate], fps: 0 });
}

export const maskSignature = (media: LoadedMedia, time: number, expand: number) => {
  const w = Math.min(1600, media.width), h = Math.round((w * media.height) / media.width);
  return signature(removalMask(w, h, time, 0)) + expand;
};

/** Manual patch: paint from a source offset into the active plate, or a new one. */
export class ManualPatch {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private src: HTMLCanvasElement;
  w: number;
  h: number;
  constructor(media: LoadedMedia, time: number) {
    const img = frameData(media.element, media.width, media.height, 1600);
    this.w = img.width; this.h = img.height;
    this.src = createCanvas(img.width, img.height);
    get2d(this.src, true).putImageData(img, 0, 0);
    this.canvas = createCanvas(img.width, img.height);
    this.ctx = get2d(this.canvas, true);
    const cur = cleanup.at(time);
    if (cur) {
      // Continue from the current result, so repairs can follow a reconstruction.
      get2d(this.src).drawImage(cur.bitmap, cur.x, cur.y);
      this.ctx.drawImage(cur.bitmap, cur.x, cur.y);
    }
  }
  /** nx, ny = target; ox, oy = offset to the source, all 0..1. */
  dab(nx: number, ny: number, ox: number, oy: number, radius: number, soft: number) {
    const r = Math.max(2, radius * Math.max(this.w, this.h)), x = nx * this.w, y = ny * this.h;
    const brush = createCanvas(Math.ceil(r * 2), Math.ceil(r * 2)), b = get2d(brush);
    b.drawImage(this.src, x + ox * this.w - r, y + oy * this.h - r, r * 2, r * 2, 0, 0, r * 2, r * 2);
    b.globalCompositeOperation = 'destination-in';
    const grad = b.createRadialGradient(r, r, r * Math.max(0, 1 - soft), r, r, r);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    b.fillStyle = grad;
    b.fillRect(0, 0, r * 2, r * 2);
    this.ctx.drawImage(brush, x - r, y - r);
  }
  async commit(media: LoadedMedia) {
    const bitmap = await createImageBitmap(this.canvas);
    cleanup.add({ id: `a${Date.now()}`, n: cleanup.attempts.length + 1, method: 'manual', sourceKey: sourceKeyOf(media), maskSig: 'manual', width: this.w, height: this.h, frames: [{ x: 0, y: 0, w: this.w, h: this.h, bitmap }], fps: 0 });
  }
  get preview() { return this.canvas; }
}

/* ── Video ──────────────────────────────────────────────────────── */

interface WorldStep { sx: number; tx: number; ty: number }

/**
 * Video removal. Frames are aligned to one coordinate system, so a pixel
 * hidden by the object in one frame can be read from a frame that shows it.
 * The median of those readings forms one background plate, and only what no
 * frame ever shows is filled once, spatially. Every frame then samples that
 * one plate, so the fill does not change from frame to frame.
 */
export async function reconstructVideo(media: LoadedMedia, method: FillMethod, s: CleanSettings, reference: FillSource | null, fps: number, signal: AbortSignal, progress: (f: number, note: string) => void) {
  const v = await loadVideo(media.url);
  v.loop = false;
  v.muted = true;
  const stop = () => { if (signal.aborted) throw new DOMException('cancelled', 'AbortError'); };
  try {
    const count = Math.max(1, Math.floor(v.duration * fps));
    const k = 854 / Math.max(media.width, media.height), w = Math.round(media.width * Math.min(1, k)), h = Math.round(media.height * Math.min(1, k));
    const unit = Math.max(w, h) / 1000, expand = s.expand * unit;
    const frames: ImageData[] = [], masks: Uint8Array[] = [], grays: Gray[] = [];
    for (let i = 0; i < count; i++) {
      stop();
      await seekVideo(v, Math.min(v.duration - 0.01, i / fps));
      const c = createCanvas(w, h), g = get2d(c, true);
      g.drawImage(v, 0, 0, w, h);
      const img = g.getImageData(0, 0, w, h);
      frames.push(img);
      masks.push(removalMask(w, h, i / fps, expand));
      grays.push(grayOf(img, 320));
      progress((i / count) * 0.25, `Reading frame ${i + 1} of ${count}`);
    }
    // Camera motion from the unmasked area only, chained into one world frame.
    const q = w / 320, world: WorldStep[] = [{ sx: 1, tx: 0, ty: 0 }];
    for (let i = 1; i < count; i++) {
      stop();
      const m0 = masks[i - 1], m1 = masks[i];
      const e = estimateMotion(grays[i - 1], grays[i], (x, y) => {
        const p = Math.min(h - 1, Math.round(y * q)) * w + Math.min(w - 1, Math.round(x * q));
        return !m0[p] && !m1[p];
      });
      const p = world[i - 1], sc = e.inliers > 0.4 ? e.scale : 1;
      // Frame i coordinate = sc * (world position in i-1) + shift
      world.push({ sx: p.sx * sc, tx: p.tx * sc + e.dx * q + (w / 2) * (1 - sc), ty: p.ty * sc + e.dy * q + (h / 2) * (1 - sc) });
      progress(0.25 + (i / count) * 0.15, 'Measuring camera motion');
    }
    // World canvas: every position any frame covers, capped for memory.
    let wx0 = 0, wy0 = 0, wx1 = w, wy1 = h;
    for (const t of world) {
      wx0 = Math.min(wx0, -t.tx / t.sx); wy0 = Math.min(wy0, -t.ty / t.sx);
      wx1 = Math.max(wx1, (w - t.tx) / t.sx); wy1 = Math.max(wy1, (h - t.ty) / t.sx);
    }
    const margin = 2, ww = Math.min(1800, Math.ceil(wx1 - wx0) + margin), wh = Math.min(1800, Math.ceil(wy1 - wy0) + margin);
    const pick = Math.max(1, Math.floor(count / 24)), used = frames.filter((_, i) => i % pick === 0).length;
    const samples = new Uint8Array(ww * wh * 3 * used), hits = new Uint8Array(ww * wh);
    let row = 0;
    for (let i = 0; i < count; i += pick) {
      stop();
      const t = world[i], d = frames[i].data, m = masks[i];
      for (let y = 0; y < wh; y++)
        for (let x = 0; x < ww; x++) {
          const fx = Math.round((x + wx0) * t.sx + t.tx), fy = Math.round((y + wy0) * t.sx + t.ty);
          if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
          const p = fy * w + fx;
          if (m[p]) continue;
          const c = hits[y * ww + x]++, o = (y * ww + x) * used * 3 + c * 3;
          samples[o] = d[p * 4]; samples[o + 1] = d[p * 4 + 1]; samples[o + 2] = d[p * 4 + 2];
        }
      row++;
      progress(0.4 + (row / used) * 0.2, 'Building the background plate');
    }
    const plate = new ImageData(ww, wh), never = new Uint8Array(ww * wh);
    const tmp: number[] = [];
    for (let i = 0; i < ww * wh; i++) {
      const c = hits[i];
      if (!c) { never[i] = 1; plate.data[i * 4 + 3] = 255; continue; }
      for (let ch = 0; ch < 3; ch++) {
        tmp.length = 0;
        for (let k2 = 0; k2 < c; k2++) tmp.push(samples[i * used * 3 + k2 * 3 + ch]);
        tmp.sort((a, b) => a - b);
        plate.data[i * 4 + ch] = tmp[c >> 1];
      }
      plate.data[i * 4 + 3] = 255;
    }
    // Unseen pixels that fall inside some frame's hole need a real fill.
    const need = new Uint8Array(ww * wh);
    for (let i = 0; i < count; i += Math.max(1, pick >> 1)) {
      const t = world[i], m = masks[i];
      for (let y = 0; y < wh; y++)
        for (let x = 0; x < ww; x++) {
          if (!never[y * ww + x]) continue;
          const fx = Math.round((x + wx0) * t.sx + t.tx), fy = Math.round((y + wy0) * t.sx + t.ty);
          if (fx >= 0 && fy >= 0 && fx < w && fy < h && m[fy * w + fx]) need[y * ww + x] = 1;
        }
    }
    const unseen = need.reduce((a, b) => a + b, 0);
    let filled: Uint8ClampedArray = plate.data;
    if (unseen) {
      progress(0.62, `No frame shows ${unseen} pixels. Filling them once.`);
      const fillMask = new Uint8Array(ww * wh);
      for (let i = 0; i < ww * wh; i++) fillMask[i] = never[i] ? 1 : 0;
      const seenAny = fillMask.some((b) => !b);
      filled = seenAny ? await spatialFill(method === 'temporal' ? 'patch' : method, plate, fillMask, s, 11, reference, (f) => progress(0.62 + f * 0.2, 'Filling what no frame shows')) : plate.data;
    }
    // Every frame samples the one plate, with a small exposure match to its own rim.
    const out: PlateFrame[] = [];
    const feather = s.feather * unit;
    for (let i = 0; i < count; i++) {
      stop();
      const t = world[i], m = masks[i], img = frames[i], d = new Uint8ClampedArray(img.data);
      if (m.some((b) => b)) {
        const rim = grow(m, w, h, Math.max(2, Math.round(6 * unit)));
        let ao = 0, bo = 0, go = 0, ap = 0, bp = 0, gp = 0, c = 0;
        const read = (x: number, y: number) => {
          const px = Math.round((x - t.tx) / t.sx - wx0), py = Math.round((y - t.ty) / t.sx - wy0);
          return px < 0 || py < 0 || px >= ww || py >= wh ? -1 : py * ww + px;
        };
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (!rim[p] || m[p]) continue;
            const q2 = read(x, y);
            if (q2 < 0) continue;
            ao += img.data[p * 4]; go += img.data[p * 4 + 1]; bo += img.data[p * 4 + 2];
            ap += filled[q2 * 4]; gp += filled[q2 * 4 + 1]; bp += filled[q2 * 4 + 2];
            c++;
          }
        const gain = c ? [ao / Math.max(1, ap), go / Math.max(1, gp), bo / Math.max(1, bp)].map((g) => Math.min(1.4, Math.max(0.7, g))) : [1, 1, 1];
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const p = y * w + x;
            if (!m[p]) continue;
            const q2 = read(x, y);
            if (q2 < 0) continue;
            d[p * 4] = filled[q2 * 4] * gain[0]; d[p * 4 + 1] = filled[q2 * 4 + 1] * gain[1]; d[p * 4 + 2] = filled[q2 * 4 + 2] * gain[2];
          }
        out.push(await makePlate(d, w, h, m, feather));
      } else {
        const empty = new ImageData(1, 1);
        out.push({ x: 0, y: 0, w: 1, h: 1, bitmap: await createImageBitmap(empty) });
      }
      progress(0.82 + (i / count) * 0.18, `Writing frame ${i + 1} of ${count}`);
    }
    cleanup.add({ id: `a${Date.now()}`, n: cleanup.attempts.length + 1, method: 'temporal', sourceKey: sourceKeyOf(media), maskSig: 'video', width: w, height: h, frames: out, fps, note: unseen ? `${Math.round((unseen / Math.max(1, ww * wh)) * 1000) / 10}% of the plate was never visible and was filled with ${METHOD_INFO[method === 'temporal' ? 'patch' : method].label}.` : 'All hidden pixels were visible in other frames.' });
  } finally {
    disposeVideo(v);
  }
}
