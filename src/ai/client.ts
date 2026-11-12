import { createCanvas, fitWithin, get2d } from '../utils/imageProcessing';
import { disposeVideo, loadVideo, seekVideo } from '../utils/videoProcessing';
import { flowField, grayOf, warpByFlow, type Gray } from './motion';
import { MODELS, type ModelKey } from './models';
import workerUrl from './worker?worker&url';

export interface GrayMap {
  w: number;
  h: number;
  data: Float32Array;
}

export type LoadStage = 'worker' | 'download' | 'init' | 'verify';
export type ModelState =
  | { status: 'idle' }
  | { status: 'loading'; stage: LoadStage; loaded: number; total: number }
  | { status: 'ready'; device: string; fallback?: string; testMs?: number }
  | { status: 'error'; message: string; kind: FailureKind; detail: string };

export type FailureKind = 'server' | 'worker' | 'download' | 'webgpu' | 'wasm' | 'memory' | 'browser' | 'model';
export type WorkerStatus = 'off' | 'starting' | 'running' | 'failed';

const CPU_KEY = 'airfx.ai.cpuOnly';
const SERVER_DOWN = "AirFx's local server is not running, so the AI files cannot load. The page stays on screen after the server stops. Double-click Start AirFx.bat (or run npm run dev). The page reloads when it is back. If it does not, press Retry.";

/** Why the worker script could not start, found by asking for the same files it needs. */
async function whyNoWorker(eventMessage: string): Promise<{ message: string; kind: FailureKind; retry: boolean }> {
  if (eventMessage) return { message: `The AI worker crashed while starting: ${eventMessage}`, kind: 'worker', retry: false };
  const noServer = { message: SERVER_DOWN, kind: 'server' as const, retry: false };
  let res: Response;
  try {
    res = await fetch(workerUrl, { cache: 'no-store' });
  } catch {
    return noServer;
  }
  if (res.status === 504) return { message: 'The dev server was rebuilding its files. Press Retry.', kind: 'worker', retry: true };
  if (!res.ok) return { message: `The server answered ${res.status} for the AI worker file. Press Retry. If it stays, restart AirFx.`, kind: 'worker', retry: false };
  if (/html/i.test(res.headers.get('content-type') ?? '')) return { message: 'The server sent a web page instead of the AI worker file. AirFx is probably being served by the wrong program. Use Start AirFx.bat, npm run dev or npm run preview.', kind: 'browser', retry: false };
  const text = await res.text();
  for (const m of text.matchAll(/from\s+"(\/[^"]+)"/g)) {
    try {
      const dep = await fetch(m[1], { cache: 'no-store' });
      if (dep.status === 504) return { message: 'The dev server was rebuilding its files. Press Retry.', kind: 'worker', retry: true };
      if (!dep.ok) return { message: `A file the AI worker needs failed to load: ${m[1].split('?')[0]} (HTTP ${dep.status}). Restart AirFx.`, kind: 'worker', retry: false };
    } catch {
      return noServer;
    }
  }
  return { message: 'The AI worker file downloaded, but the browser refused to run it. A browser extension or security setting may be blocking workers. Try another Chrome or Edge profile.', kind: 'browser', retry: false };
}

function classify(m: string): { message: string; kind: FailureKind } {
  if (/no available backend|wasm|WebAssembly/i.test(m)) return { message: 'WebAssembly could not start, so the AI runtime has nothing to run on. Check that the /ort files are being served and use a recent Chrome or Edge.', kind: 'wasm' };
  if (/fetch|network|Failed to load|Could not locate|Unauthorized|\b40[0-9]\b|\b50[0-9]\b/i.test(m)) return { message: 'The model could not be downloaded. Check your connection, then press Retry.', kind: 'download' };
  if (/out of memory|bad_alloc|Aborted|memory/i.test(m)) return { message: 'There was not enough memory for this model. Close other tabs, or use a lighter model.', kind: 'memory' };
  if (/webgpu|GPU|Device/i.test(m)) return { message: 'WebGPU failed and CPU could not take over. Press Retry, or turn on Use CPU Only in AI Models.', kind: 'webgpu' };
  return { message: 'The model failed to load.', kind: 'model' };
}

/** Which files mean a model is in the browser's cache. */
const FILE_TAG: Record<string, RegExp> = { fp16: /_fp16\.onnx/, q8: /_(quantized|q8|uint8|int8)\.onnx/, q4f16: /_q4f16\.onnx/, q4: /_q4\.onnx/, fp32: /[/_](model|encoder|vision_encoder)\.onnx/ };

export interface Diagnostics {
  worker: WorkerStatus; runtime: { transformers: string; ort: string } | null;
  webgpuApi: boolean; adapter: string | null; simd: boolean; threads: boolean; isolated: boolean;
  server: boolean; storageUsedMb: number | null; storageQuotaMb: number | null; cacheNames: string[]; lastError: string | null;
}

/** Talks to the inference worker. One worker, one queue, one model running at a time. */
class AiClient {
  private worker: Worker | null = null;
  private booting: Promise<Worker> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
  private states = new Map<ModelKey, ModelState>();
  private loads = new Map<ModelKey, Promise<void>>();
  private listeners = new Set<() => void>();
  private version = 0;
  private busy = new Map<ModelKey, number>();
  workerStatus: WorkerStatus = 'off';
  runtime: { transformers: string; ort: string } | null = null;
  lastError: string | null = null;
  cached = new Set<ModelKey>();
  /** How many workers this page has started. There should be one, unless one crashed. */
  workersStarted = 0;
  cpuOnly = (() => { try { return localStorage.getItem(CPU_KEY) === '1'; } catch { return false; } })();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  state(key: ModelKey): ModelState {
    return this.states.get(key) ?? { status: 'idle' };
  }
  isBusy(key: ModelKey) { return (this.busy.get(key) ?? 0) > 0; }
  private bump() { this.version++; this.listeners.forEach((f) => f()); }
  private set(key: ModelKey, s: ModelState) {
    this.states.set(key, s);
    this.bump();
  }
  private fail(text: string) {
    this.lastError = `${new Date().toLocaleTimeString()} · ${text}`;
    this.bump();
  }

  /** The worker has gone: nothing it held is ready any more. */
  private lost(reason: string) {
    // A worker that reported an error may still be alive. Only one may ever run.
    this.worker?.terminate();
    this.worker = null;
    this.workerStatus = 'failed';
    this.fail(reason);
    const err = new Error(reason);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    // Models that were loaded went with it. Say so on their cards, with Retry.
    for (const [k, s] of this.states) if (s.status === 'ready') this.states.set(k, { status: 'error', message: reason, kind: 'worker', detail: reason });
    this.bump();
  }

  private listen(w: Worker) {
    w.onmessage = (e) => {
      const { id, type } = e.data;
      if (type === 'progress') {
        // Files already cached report full size at once, which is not a download.
        const done = e.data.total > 0 && e.data.loaded >= e.data.total;
        this.set(e.data.key, { status: 'loading', stage: done ? 'init' : 'download', loaded: e.data.loaded, total: e.data.total });
        return;
      }
      if (type === 'stage') {
        const s = this.state(e.data.key);
        this.set(e.data.key, { status: 'loading', stage: e.data.stage, loaded: s.status === 'loading' ? s.loaded : 0, total: s.status === 'loading' ? s.total : 0 });
        return;
      }
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data as never);
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      this.lost(`The AI worker crashed: ${e.message || 'no reason given by the browser, often running out of memory'}.`);
    };
    w.onmessageerror = () => this.lost('The AI worker sent a message the app could not read.');
  }

  /** Starts the single worker and waits until it says it is really running. */
  private boot(attempt = 0): Promise<Worker> {
    this.workerStatus = 'starting';
    this.workersStarted++;
    this.bump();
    return new Promise<Worker>((resolve, reject) => {
      const w = new Worker(workerUrl, { type: 'module', name: 'airfx-ai' });
      const timer = setTimeout(() => {
        w.terminate();
        reject(Object.assign(new Error('The AI worker loaded but did not answer within 45 seconds. Press Retry.'), { kind: 'worker' }));
      }, 45000);
      w.onerror = async (e) => {
        e.preventDefault();
        clearTimeout(timer);
        w.terminate();
        const why = await whyNoWorker(e.message);
        // Once only: a failed worker must never restart in a loop.
        if (why.retry && attempt === 0) {
          setTimeout(() => this.boot(1).then(resolve, reject), 1500);
          return;
        }
        reject(Object.assign(new Error(why.message), { kind: why.kind }));
      };
      w.onmessage = (e) => {
        if (e.data.type !== 'hello') return;
        clearTimeout(timer);
        this.runtime = { transformers: e.data.transformers, ort: e.data.ort };
        this.worker = w;
        this.workerStatus = 'running';
        this.listen(w);
        this.bump();
        resolve(w);
      };
    });
  }

  private start(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker);
    this.booting ??= this.boot().finally(() => { this.booting = null; });
    return this.booting;
  }

  private async call<T>(msg: object, transfer: Transferable[] = []): Promise<T> {
    let w: Worker;
    try {
      w = await this.start();
    } catch (e) {
      this.workerStatus = 'failed';
      this.fail((e as Error).message);
      throw e;
    }
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject });
      w.postMessage({ id, ...msg }, transfer);
    });
  }

  private async during<T>(key: ModelKey, run: () => Promise<T>): Promise<T> {
    this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
    this.bump();
    try {
      return await run();
    } finally {
      this.busy.set(key, (this.busy.get(key) ?? 1) - 1);
      this.bump();
    }
  }

  /** Explicit user action: downloads the model (once), prepares it and proves it runs. */
  load(key: ModelKey): Promise<void> {
    if (this.state(key).status === 'ready') return Promise.resolve();
    const running = this.loads.get(key);
    if (running) return running;
    const job = (async () => {
      this.set(key, { status: 'loading', stage: 'worker', loaded: 0, total: 0 });
      try {
        const test = (import.meta.env.DEV && (window as unknown as { __airfxFailGpu?: boolean }).__airfxFailGpu) === true;
        const r = await this.call<{ device: string; fallback?: string; testMs?: number }>({ type: 'load', key, cpuOnly: this.cpuOnly, failGpu: test });
        this.set(key, { status: 'ready', device: r.device, fallback: r.fallback, testMs: r.testMs });
        this.cached.add(key);
      } catch (e) {
        const detail = (e as Error).message || String(e), named = (e as { kind?: FailureKind }).kind;
        // A worker already in the browser cache starts without the server, then its runtime
        // files fail. Check this first, or that gets blamed on WebAssembly.
        const up = named ? true : await fetch(workerUrl, { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok, () => false);
        const f = named ? { message: detail, kind: named } : up ? classify(detail) : { message: SERVER_DOWN, kind: 'server' as const };
        this.set(key, { status: 'error', ...f, detail });
        this.fail(`${MODELS[key].label}: ${detail}`);
        throw e;
      } finally {
        this.loads.delete(key);
        this.refreshCached();
      }
    })();
    this.loads.set(key, job);
    return job;
  }

  /** Frees the model, then loads it again from the cache. */
  async reload(key: ModelKey) {
    await this.unload(key);
    return this.load(key);
  }

  async unload(key: ModelKey) {
    if (this.worker) await this.call({ type: 'unload', key }).catch(() => undefined);
    this.states.delete(key);
    this.bump();
  }

  /** Removes this model's files from the browser, so the next load downloads them again. */
  async clearCache(key: ModelKey) {
    await this.unload(key);
    const m = MODELS[key];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) if (req.url.includes(`/${m.repo}/`)) await cache.delete(req);
    }
    await this.refreshCached();
  }

  async refreshCached() {
    try {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        if (!/transformers|airfx-models/.test(name)) continue;
        for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
      }
      const next = new Set<ModelKey>();
      for (const k of Object.keys(MODELS) as ModelKey[]) {
        const m = MODELS[k], dtype = m.cpuOnly || this.cpuOnly ? m.wasm.dtype : m.webgpu.dtype, tag = FILE_TAG[dtype];
        if (urls.some((u) => u.includes(`/${m.repo}/`) && /\.onnx/.test(u) && (k === 'lama' || !tag || tag.test(u)))) next.add(k);
      }
      this.cached = next;
      this.bump();
    } catch { /* cache access is optional */ }
  }

  setCpuOnly(on: boolean) {
    this.cpuOnly = on;
    try { localStorage.setItem(CPU_KEY, on ? '1' : '0'); } catch { /* preference only */ }
    this.refreshCached();
  }

  async diagnostics(): Promise<Diagnostics> {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ info?: Record<string, string> } | null> } }).gpu;
    let adapter: string | null = null;
    try {
      const a = await gpu?.requestAdapter();
      if (a) adapter = [a.info?.vendor, a.info?.architecture].filter(Boolean).join(' ') || 'Available';
    } catch { /* reported as unavailable */ }
    // The smallest module using a SIMD instruction: valid only if the browser has SIMD.
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    let server = false;
    try { server = (await fetch(workerUrl, { method: 'HEAD', cache: 'no-store' })).ok; } catch { /* stopped */ }
    const est = await navigator.storage?.estimate?.().catch(() => null);
    return {
      worker: this.workerStatus, runtime: this.runtime, webgpuApi: !!gpu, adapter, simd, threads: typeof SharedArrayBuffer !== 'undefined', isolated: self.crossOriginIsolated, server,
      storageUsedMb: est?.usage != null ? est.usage / 1048576 : null, storageQuotaMb: est?.quota != null ? est.quota / 1048576 : null, cacheNames: await caches.keys().catch(() => []), lastError: this.lastError,
    };
  }

  private noteDevice(key: ModelKey, device: string, fallback?: string) {
    // The worker may have moved a model to the CPU if the GPU rejected it.
    const s = this.state(key);
    if (s.status !== 'ready' || s.device !== device) this.set(key, { status: 'ready', device, fallback: fallback ?? (s.status === 'ready' ? s.fallback : undefined), testMs: s.status === 'ready' ? s.testMs : undefined });
  }

  infer(key: ModelKey, image: ImageData, inputSize?: number): Promise<GrayMap> {
    return this.during(key, async () => {
      const pixels = new Uint8ClampedArray(image.data);
      const r = await this.call<GrayMap & { device: string; fallback?: string }>({ type: 'run', key, width: image.width, height: image.height, pixels, inputSize }, [pixels.buffer]);
      this.noteDevice(key, r.device, r.fallback);
      return { w: r.w, h: r.h, data: r.data };
    });
  }

  /** Prepare a frame for prompts. Slow once per frame; repeat calls are free. */
  samEncode(frameKey: string, image: ImageData) {
    return this.during('sam', async () => {
      const pixels = new Uint8ClampedArray(image.data);
      await this.call({ type: 'sam-encode', frameKey, width: image.width, height: image.height, pixels }, [pixels.buffer]);
    });
  }

  /** Points and box are in pixels of the encoded image. */
  samDecode(prompt: SamPrompt) {
    return this.during('sam', () => this.call<SamResult>({ type: 'sam-decode', prompt }));
  }

  detect(image: ImageData): Promise<Detection[]> {
    return this.during('detect', async () => {
      const pixels = new Uint8ClampedArray(image.data);
      const r = await this.call<{ items: { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]; device: string }>({ type: 'run', key: 'detect', width: image.width, height: image.height, pixels }, [pixels.buffer]);
      this.noteDevice('detect', r.device);
      return r.items.map((d) => ({ label: d.label, score: d.score, box: [d.box.xmin / image.width, d.box.ymin / image.height, d.box.xmax / image.width, d.box.ymax / image.height] }));
    });
  }

  classify(image: ImageData, labels: string[]) {
    return this.during('scene', async () => {
      const pixels = new Uint8ClampedArray(image.data);
      const r = await this.call<{ items: { label: string; score: number }[]; device: string }>({ type: 'run', key: 'scene', width: image.width, height: image.height, pixels, labels }, [pixels.buffer]);
      this.noteDevice('scene', r.device);
      return r.items;
    });
  }

  /** 512×512 RGBA plus a 512×512 mask (255 = fill). Returns the filled RGBA. */
  /** Speech to text on this machine. Audio is 16 kHz mono. */
  transcribe(audio: Float32Array, timestamps: boolean) {
    return this.during('asr', async () => {
      const r = await this.call<{ text: string; chunks: { text: string; timestamp: [number, number | null] }[] | null; device: string }>({ type: 'asr', key: 'asr', audio, timestamps }, [audio.buffer]);
      this.noteDevice('asr', r.device);
      return r;
    });
  }

  inpaint(rgba: Uint8ClampedArray, mask: Uint8Array) {
    return this.during('lama', async () => {
      const p = new Uint8ClampedArray(rgba), m = new Uint8Array(mask);
      const r = await this.call<{ data: Uint8ClampedArray; device: string }>({ type: 'lama', pixels: p, mask: m }, [p.buffer, m.buffer]);
      this.noteDevice('lama', r.device);
      return r.data;
    });
  }
}

export interface SamPrompt { frameKey: string; points?: number[][]; labels?: number[]; box?: number[] }
export interface SamResult { w: number; h: number; planes: Float32Array[]; scores: number[]; objectScore: number }
/** box is [x0, y0, x1, y1] in 0..1 of the frame. */
export interface Detection { label: string; score: number; box: number[] }

export const ai = new AiClient();
ai.refreshCached();

/** Scale a frame down for inference. */
export function frameData(source: CanvasImageSource, w: number, h: number, maxEdge: number): ImageData {
  const f = fitWithin(w, h, maxEdge);
  const c = createCanvas(f.width, f.height), g = get2d(c, true);
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, f.width, f.height);
  const d = g.getImageData(0, 0, f.width, f.height);
  c.width = c.height = 1;
  return d;
}

/** Sparse per-time maps: one entry for stills, many for a processed clip. */
export class MapTrack {
  frames: GrayMap[] = [];
  fps = 0;
  /** What these maps were computed from, so stale results are never applied. */
  sourceKey = '';
  kind: 'model' | 'file' | 'none' = 'none';
  version = 0;

  clear() {
    this.frames = [];
    this.fps = 0;
    this.sourceKey = '';
    this.kind = 'none';
    this.version++;
  }
  setStill(map: GrayMap, sourceKey: string, kind: 'model' | 'file' = 'model') {
    this.frames = [map];
    this.fps = 0;
    this.sourceKey = sourceKey;
    this.kind = kind;
    this.version++;
  }
  at(time: number): GrayMap | null {
    if (!this.frames.length) return null;
    if (this.frames.length === 1 || !this.fps) return this.frames[0];
    return this.frames[Math.min(this.frames.length - 1, Math.round(time * this.fps))];
  }
}

export const tracks = { matte: new MapTrack(), depth: new MapTrack() };

/** Signed brush edits, in map coordinates (hint for Key, depth delta for Depth). */
export class EditPlane {
  w = 0;
  h = 0;
  data = new Float32Array(0);
  version = 0;
  private undoStack: Float32Array[] = [];
  private redoStack: Float32Array[] = [];

  ensure(w: number, h: number) {
    if (this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.data = new Float32Array(w * h);
    this.undoStack = [];
    this.redoStack = [];
    this.version++;
  }
  checkpoint() {
    this.undoStack.push(this.data.slice());
    if (this.undoStack.length > 16) this.undoStack.shift();
    this.redoStack = [];
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  undo() {
    const p = this.undoStack.pop();
    if (p) { this.redoStack.push(this.data); this.data = p; this.version++; }
  }
  redo() {
    const p = this.redoStack.pop();
    if (p) { this.undoStack.push(this.data); this.data = p; this.version++; }
  }
  clear() {
    this.checkpoint();
    this.data.fill(0);
    this.version++;
  }
  /**
   * Soft round dab. 'add' pushes by value; 'set' moves toward value; 'erase'
   * fades to 0; 'smooth' evens out base + edit, for softening depth steps.
   * Pixels painted on `guard` are left alone.
   */
  dab(nx: number, ny: number, radius: number, soft: number, value: number, mode: 'add' | 'set' | 'erase' | 'smooth', guard?: EditPlane, base?: Float32Array) {
    const cx = nx * this.w, cy = ny * this.h, r = Math.max(1, radius * Math.max(this.w, this.h));
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    const shield = guard && guard.w === this.w && guard.h === this.h ? guard.data : null;
    const val = (i: number) => this.data[i] + (base ? base[i] : 0);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const i = y * this.w + x;
        if (shield && shield[i] > 0.5) continue;
        const k = d <= 1 - soft ? 1 : (1 - d) / Math.max(0.001, soft);
        if (mode === 'add') this.data[i] += value * k;
        else if (mode === 'set') this.data[i] += (value - this.data[i]) * k;
        else if (mode === 'erase') this.data[i] *= 1 - k;
        else {
          let sum = 0, c = 0;
          for (let dy = -4; dy <= 4; dy += 2)
            for (let dx = -4; dx <= 4; dx += 2) {
              const px = x + dx, py = y + dy;
              if (px >= 0 && py >= 0 && px < this.w && py < this.h) { sum += val(py * this.w + px); c++; }
            }
          this.data[i] += (sum / c - val(i)) * k * 0.6;
        }
      }
    this.version++;
  }
}

export const edits = { hint: new EditPlane(), depth: new EditPlane(), protect: new EditPlane(), clean: new EditPlane() };

/** Robust range of raw depth values, so a few extreme pixels cannot flatten the map. */
function depthRange(maps: GrayMap[]) {
  const sample: number[] = [];
  for (const m of maps) for (let i = 0; i < m.data.length; i += 37) sample.push(m.data[i]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.005)] ?? 0, hi = sample[Math.floor(sample.length * 0.995)] ?? 1;
  return { lo, k: 1 / Math.max(1e-6, hi - lo) };
}

/** Maps raw values to 0 far … 1 near, once for the whole set. */
export function normalizeDepth(maps: GrayMap[]) {
  const { lo, k } = depthRange(maps);
  for (const m of maps) for (let i = 0; i < m.data.length; i++) m.data[i] = Math.min(1, Math.max(0, (m.data[i] - lo) * k));
}

/**
 * Run a model across a clip at a fixed rate. Depth is aligned to the frames
 * before it (scale + shift), blended along optical flow where the frames
 * agree, and normalised once for the whole clip, so near and far keep their
 * brightness throughout playback. Mattes get a plain temporal blend.
 */
export async function processClip(opts: {
  url: string; key: ModelKey; track: MapTrack; sourceKey: string; fps: number; maxEdge: number; smoothing: number; align: boolean; inputSize?: number;
  signal: AbortSignal; onProgress: (f: number) => void;
}) {
  const v = await loadVideo(opts.url);
  v.loop = false;
  v.muted = true;
  try {
    const frames: GrayMap[] = [];
    const count = Math.max(1, Math.floor(v.duration * opts.fps));
    let prev: GrayMap | null = null, prevGray: Gray | null = null;
    for (let i = 0; i < count; i++) {
      if (opts.signal.aborted) throw new DOMException('cancelled', 'AbortError');
      await seekVideo(v, Math.min(v.duration - 0.01, i / opts.fps));
      const image = frameData(v, v.videoWidth, v.videoHeight, opts.maxEdge);
      const gray = opts.align ? grayOf(image, 240) : null;
      const map = await ai.infer(opts.key, image, opts.inputSize);
      if (prev && prev.data.length === map.data.length) {
        const s = opts.smoothing, d = map.data;
        if (opts.align && gray && prevGray) {
          alignTo(map, prev);
          const warped = warpByFlow(prev.data, map.w, map.h, flowField(prevGray, gray), 240);
          // Trust the past only where it agrees: fast movers keep this frame's value.
          const range = Math.max(1e-6, Math.abs(depthRange([map]).k) ** -1);
          for (let k = 0; k < d.length; k++) {
            const agree = Math.max(0, 1 - Math.abs(d[k] - warped[k]) / (range * 0.15));
            d[k] = warped[k] * s * agree + d[k] * (1 - s * agree);
          }
        } else {
          const p = prev.data;
          for (let k = 0; k < d.length; k++) d[k] = p[k] * s + d[k] * (1 - s);
        }
      }
      frames.push(map);
      prev = map;
      prevGray = gray;
      opts.onProgress((i + 1) / count);
    }
    if (opts.align) normalizeDepth(frames);
    opts.track.frames = frames;
    opts.track.fps = opts.fps;
    opts.track.sourceKey = opts.sourceKey;
    opts.track.kind = 'model';
    opts.track.version++;
  } finally {
    disposeVideo(v);
  }
}

/** Least-squares scale + shift so this frame's depth matches the previous one. Outliers (movers) are dropped. */
function alignTo(map: GrayMap, ref: GrayMap) {
  const d = map.data, r = ref.data;
  let a = 1, b = 0;
  for (let pass = 0; pass < 3; pass++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0, err = 0;
    if (pass) { for (let i = 0; i < d.length; i += 11) err += Math.abs(a * d[i] + b - r[i]); err /= d.length / 11; }
    for (let i = 0; i < d.length; i += 11) {
      if (pass && Math.abs(a * d[i] + b - r[i]) > err * 1.5) continue;
      sx += d[i]; sy += r[i]; sxx += d[i] * d[i]; sxy += d[i] * r[i]; n++;
    }
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-9) return;
    a = (n * sxy - sx * sy) / den;
    b = (sy - a * sx) / n;
  }
  for (let i = 0; i < d.length; i++) d[i] = a * d[i] + b;
}
