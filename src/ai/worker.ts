/// <reference lib="webworker" />
import { AutoProcessor, EdgeTamModel, RawImage, env, pipeline } from '@huggingface/transformers';
import * as ort from 'onnxruntime-web/webgpu';
import { MODELS, type ModelKey } from './models';

/**
 * AI inference runs here, off the UI thread. Images arrive as RGBA pixels and
 * results go back as plain arrays: nothing leaves this machine. The only
 * network use is the model download, which the user starts.
 */
env.allowLocalModels = false;
env.useBrowserCache = true;
// Served with the app ('/ort/'), or from jsDelivr on hosts with a per-file size limit (see vite.config.ts).
if (env.backends.onnx.wasm) env.backends.onnx.wasm.wasmPaths = __ORT_BASE__;
ort.env.wasm.wasmPaths = __ORT_BASE__;
declare const __ORT_BASE__: string;

type Reply = (m: object) => void;
type Pipe = ((img: unknown, opts?: unknown) => Promise<unknown>) & { dispose?: () => Promise<void>; processor?: { image_processor?: { size?: unknown } } };
interface Entry { run: Pipe; device: string; fallback?: string; testMs?: number }
const loaded = new Map<ModelKey, Entry>();
/** Models that failed on the GPU at run time; they stay on the CPU from then on. */
const gpuFailed = new Set<ModelKey>();
/** Set by the app: the user chose CPU, or a developer test wants a GPU failure. */
let cpuOnly = false, failGpu = false;

async function hasWebGpu() {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

const progressFor = (key: ModelKey, reply: Reply) => {
  const files = new Map<string, { loaded: number; total: number }>();
  return (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'initiate') reply({ type: 'stage', key, stage: 'init' });
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let a = 0, b = 0;
      for (const f of files.values()) { a += f.loaded; b += f.total; }
      reply({ type: 'progress', key, loaded: a, total: b });
    }
  };
};

async function order(key: ModelKey) {
  return MODELS[key].cpuOnly || cpuOnly || gpuFailed.has(key) || !(await hasWebGpu()) ? (['wasm'] as const) : (['webgpu', 'wasm'] as const);
}

/** A small drawn picture: enough to prove a model really runs, without using the user's media. */
function testImage(size: number) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, inside = Math.hypot(x - size / 2, y - size / 2) < size / 4;
      px[i] = inside ? 220 : (x / size) * 120; px[i + 1] = inside ? 60 : 90; px[i + 2] = inside ? 50 : (y / size) * 200; px[i + 3] = 255;
    }
  return px;
}

const finite = (d: ArrayLike<number>) => { for (let i = 0; i < d.length; i += 7) if (!Number.isFinite(d[i])) return false; return d.length > 0; };

/** Ready has to mean it ran. Loading can succeed on a GPU that then fails or returns NaN. */
async function selfTest(key: ModelKey, entry: Entry) {
  const t0 = performance.now(), task = MODELS[key].task, image = new RawImage(testImage(224), 224, 224, 4);
  if (task === 'automatic-speech-recognition') {
    // A short tone: proves the model runs and returns text, without any real speech.
    const pcm = new Float32Array(16000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i * 0.12) * 0.05;
    const out = (await entry.run(pcm)) as { text?: unknown };
    if (typeof out?.text !== 'string') throw new Error('The speech model did not return text.');
  } else if (task === 'object-detection') {
    const out = await entry.run(image, { threshold: 0.9, percentage: false });
    if (!Array.isArray(out)) throw new Error('The detector did not return a list.');
  } else if (task === 'zero-shot-image-classification') {
    const out = await (entry.run as unknown as (i: unknown, l: string[]) => Promise<unknown>)(image.rgb(), ['a photo', 'a drawing']);
    if (!Array.isArray(out)) throw new Error('The classifier did not return scores.');
  } else {
    const plane = toPlane(key, await entry.run(image));
    if (!finite(plane.data)) throw new Error('The model returned invalid numbers. This usually means the GPU cannot run it correctly.');
  }
  entry.testMs = performance.now() - t0;
}

async function load(key: ModelKey, reply: Reply) {
  const hit = loaded.get(key);
  if (hit) return hit;
  const m = MODELS[key];
  let lastErr: unknown, gpuReason: string | undefined;
  for (const device of await order(key)) {
    let run: Pipe | null = null;
    try {
      reply({ type: 'stage', key, stage: 'init' });
      run = (await pipeline(m.task as never, m.repo, { device, dtype: m[device].dtype as never, progress_callback: progressFor(key, reply) } as never)) as unknown as Pipe;
      const entry: Entry = { run, device, fallback: gpuReason };
      reply({ type: 'stage', key, stage: 'verify' });
      if (device === 'webgpu' && failGpu) throw new Error('Simulated GPU failure.');
      await selfTest(key, entry);
      loaded.set(key, entry);
      return entry;
    } catch (e) {
      lastErr = e;
      await run?.dispose?.().catch(() => undefined);
      if (device === 'webgpu') { gpuReason = (e as Error).message || String(e); gpuFailed.add(key); }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/* ── Promptable segmentation ────────────────────────────────────── */

interface Tensorish { data: ArrayLike<number>; dims: number[] }
interface Encoded { embeddings: Record<string, unknown>; originalSizes: unknown; reshapedSizes: unknown }
interface SamState {
  model: ((inputs: unknown) => Promise<{ iou_scores: Tensorish; pred_masks: unknown; object_score_logits?: Tensorish }>) & { get_image_embeddings: (i: unknown) => Promise<Record<string, unknown>> };
  processor: ((img: unknown) => Promise<{ pixel_values: unknown; original_sizes: [number, number][]; reshaped_input_sizes: [number, number][] }>) & {
    image_processor: { reshape_input_points: (p: unknown, o: unknown, r: unknown, box?: boolean) => unknown; add_input_labels: (l: unknown, p: unknown) => unknown };
    post_process_masks: (m: unknown, o: unknown, r: unknown, opts: unknown) => Promise<Tensorish[]>;
  };
  device: string;
  fallback?: string;
  testMs?: number;
}
let sam: SamState | null = null;
/** Recent frame embeddings. Encoding is the slow part, so repeat clicks reuse it. */
const embedded = new Map<string, Encoded>();

async function loadSam(reply: Reply) {
  if (sam) return sam;
  const m = MODELS.sam;
  let lastErr: unknown, gpuReason: string | undefined;
  for (const device of await order('sam')) {
    const held: { model?: { dispose?: () => Promise<void> } } = {};
    try {
      reply({ type: 'stage', key: 'sam', stage: 'init' });
      const opts = {
        // The small decoder runs fastest on the CPU: GPU upload costs more than it saves.
        device: { vision_encoder: device, prompt_encoder_mask_decoder: 'wasm' },
        dtype: { vision_encoder: m.wasm.dtype, prompt_encoder_mask_decoder: m.wasm.dtype },
        progress_callback: progressFor('sam', reply),
      };
      const [loadedModel, processor] = await Promise.all([EdgeTamModel.from_pretrained(m.repo, opts as never), AutoProcessor.from_pretrained(m.repo, {})]);
      held.model = loadedModel as never;
      const state: SamState = { model: loadedModel as never, processor: processor as never, device, fallback: gpuReason };
      reply({ type: 'stage', key: 'sam', stage: 'verify' });
      if (device === 'webgpu' && failGpu) throw new Error('Simulated GPU failure.');
      // A real encode and a real click on the test picture.
      const t0 = performance.now();
      sam = state;
      await samEncode('selftest', 224, 224, testImage(224), reply);
      const out = await samDecode({ frameKey: 'selftest', points: [[112, 112]], labels: [1] });
      embedded.delete('selftest');
      if (!out.planes.length || !finite(out.planes[0])) throw new Error('EdgeTAM returned an invalid mask.');
      state.testMs = performance.now() - t0;
      return state;
    } catch (e) {
      sam = null;
      lastErr = e;
      await held.model?.dispose?.().catch(() => undefined);
      if (device === 'webgpu') { gpuReason = (e as Error).message || String(e); gpuFailed.add('sam'); }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function samEncode(frameKey: string, width: number, height: number, pixels: Uint8ClampedArray, reply: Reply) {
  const s = sam ?? (await loadSam(reply));
  if (embedded.has(frameKey)) return;
  const image = new RawImage(pixels, width, height, 4).rgb();
  const inputs = await s.processor(image);
  const embeddings = await s.model.get_image_embeddings(inputs);
  embedded.set(frameKey, { embeddings, originalSizes: inputs.original_sizes, reshapedSizes: inputs.reshaped_input_sizes });
  while (embedded.size > 3) embedded.delete(embedded.keys().next().value as string);
}

interface SamPrompt { frameKey: string; points?: number[][]; labels?: number[]; box?: number[] }

async function samDecode(p: SamPrompt) {
  const s = sam;
  const e = embedded.get(p.frameKey);
  if (!s || !e) throw new Error('Encode the frame before selecting.');
  const ip = s.processor.image_processor;
  const inputs: Record<string, unknown> = { ...e.embeddings };
  if (p.points?.length) {
    const pts = ip.reshape_input_points([[p.points]], e.originalSizes, e.reshapedSizes);
    inputs.input_points = pts;
    inputs.input_labels = ip.add_input_labels([[p.labels ?? p.points.map(() => 1)]], pts);
  }
  if (p.box) inputs.input_boxes = ip.reshape_input_points([[p.box]], e.originalSizes, e.reshapedSizes, true);
  const out = await s.model(inputs);
  const [masks] = await s.processor.post_process_masks(out.pred_masks, e.originalSizes, e.reshapedSizes, { binarize: false });
  const d = masks.dims, h = d[d.length - 2], w = d[d.length - 1], count = d[d.length - 3], src = masks.data as Float32Array;
  const planes: Float32Array[] = [], scores: number[] = [];
  for (let k = 0; k < count; k++) {
    const pl = new Float32Array(w * h);
    // Steeper than a plain sigmoid: weak logits on similar objects must not read as half-selected.
    for (let i = 0; i < w * h; i++) pl[i] = 1 / (1 + Math.exp(-3 * src[k * w * h + i]));
    planes.push(pl);
    scores.push(Number(out.iou_scores.data[k]));
  }
  return { w, h, planes, scores, objectScore: out.object_score_logits ? Number(out.object_score_logits.data[0]) : 1 };
}

/* ── Inpainting ─────────────────────────────────────────────────── */

let lama: { session: ort.InferenceSession; device: string; fallback?: string } | null = null;

async function fetchCached(url: string, key: ModelKey, reply: Reply) {
  const cache = await caches.open('airfx-models');
  const hit = await cache.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Failed to fetch model (${res.status}).`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader(), chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    reply({ type: 'progress', key, loaded: got, total });
  }
  const buf = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  await cache.put(url, new Response(buf));
  return buf;
}

async function loadLama(reply: Reply) {
  if (lama) return lama;
  const bytes = await fetchCached(`https://huggingface.co/${MODELS.lama.repo}/resolve/main/inpainting_lama_2025jan.onnx`, 'lama', reply);
  let lastErr: unknown;
  for (const device of await order('lama')) {
    try {
      const session = await ort.InferenceSession.create(bytes, { executionProviders: [device], logSeverityLevel: 3 });
      lama = { session, device };
      return lama;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** rgba and mask are 512×512; the model answers with the whole filled image. */
async function runLama(rgba: Uint8ClampedArray, mask: Uint8Array, reply: Reply) {
  const { session } = await loadLama(reply);
  const S = 512, n = S * S, img = new Float32Array(n * 3), msk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const hole = mask[i] > 127;
    msk[i] = hole ? 1 : 0;
    for (let c = 0; c < 3; c++) img[c * n + i] = hole ? 0 : rgba[i * 4 + c] / 255;
  }
  const [imgName, maskName] = session.inputNames;
  const out = await session.run({ [imgName]: new ort.Tensor('float32', img, [1, 3, S, S]), [maskName]: new ort.Tensor('float32', msk, [1, 1, S, S]) });
  const t = out[session.outputNames[0]];
  const d = t.data as Float32Array, res = new Uint8ClampedArray(n * 4);
  let peak = 0;
  for (let i = 0; i < d.length; i += 97) if (d[i] > peak) peak = d[i];
  const k = peak > 2 ? 1 : 255; // some exports answer 0..1, others 0..255
  for (let i = 0; i < n; i++) {
    res[i * 4] = d[i] * k; res[i * 4 + 1] = d[n + i] * k; res[i * 4 + 2] = d[2 * n + i] * k; res[i * 4 + 3] = 255;
  }
  return res;
}

/* ── Results ────────────────────────────────────────────────────── */

function toPlane(key: ModelKey, out: unknown): { w: number; h: number; data: Float32Array } {
  if (MODELS[key].task === 'background-removal') {
    const one = (Array.isArray(out) ? out[0] : out) as { data: Uint8ClampedArray; width: number; height: number; channels: number };
    const n = one.width * one.height, data = new Float32Array(n), ch = one.channels;
    for (let i = 0; i < n; i++) data[i] = one.data[i * ch + ch - 1] / 255;
    return { w: one.width, h: one.height, data };
  }
  // Raw model values (larger = closer). Normalising happens later, once per
  // still or once per clip, so a video cannot change brightness frame to frame.
  const r = out as { predicted_depth: { data: Float32Array; dims: number[] } };
  const dims = r.predicted_depth.dims;
  return { w: dims[dims.length - 1], h: dims[dims.length - 2], data: Float32Array.from(r.predicted_depth.data) };
}

async function runModel(key: ModelKey, entry: { run: Pipe }, image: RawImage, inputSize: number | undefined, extra: unknown) {
  if (MODELS[key].task === 'depth-estimation' && inputSize) {
    const ip = entry.run.processor?.image_processor;
    if (ip) ip.size = { height: inputSize, width: inputSize };
  }
  return extra ? entry.run(image, extra) : entry.run(image);
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type, key, width, height, pixels, frameKey, prompt, inputSize, labels, mask } = e.data;
  if (typeof e.data.cpuOnly === 'boolean') cpuOnly = e.data.cpuOnly;
  if (typeof e.data.failGpu === 'boolean') failGpu = e.data.failGpu;
  const reply: Reply = (m) => self.postMessage({ id, ...m });
  const post = (m: object, transfer: Transferable[]) => (self as unknown as Worker).postMessage({ id, ...m }, transfer);
  try {
    if (type === 'unload') {
      const entry = loaded.get(key as ModelKey);
      loaded.delete(key as ModelKey);
      gpuFailed.delete(key as ModelKey);
      await entry?.run.dispose?.().catch(() => undefined);
      if (key === 'sam' && sam) { embedded.clear(); await (sam.model as unknown as { dispose?: () => Promise<void> }).dispose?.().catch(() => undefined); sam = null; }
      if (key === 'lama' && lama) { await lama.session.release().catch(() => undefined); lama = null; }
      return reply({ type: 'unloaded' });
    }
    if (type === 'gpu-info') {
      const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<{ info?: Record<string, string>; isFallbackAdapter?: boolean } | null> } }).gpu;
      const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
      return reply({ type: 'gpu', api: !!gpu, adapter: adapter ? [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.description].filter(Boolean).join(' ') || 'Available' : null, loaded: [...loaded.keys(), ...(sam ? ['sam'] : []), ...(lama ? ['lama'] : [])] });
    }
    if (type === 'load' && key === 'sam') {
      const s = await loadSam(reply);
      return reply({ type: 'loaded', device: s.device, fallback: s.fallback, testMs: s.testMs });
    }
    if (type === 'load' && key === 'lama') {
      const l = await loadLama(reply);
      return reply({ type: 'loaded', device: l.device, fallback: l.fallback });
    }
    if (type === 'sam-encode') {
      await samEncode(frameKey, width, height, pixels, reply);
      return reply({ type: 'result', device: sam?.device });
    }
    if (type === 'sam-decode') {
      const r = await samDecode(prompt as SamPrompt);
      return post({ type: 'result', ...r }, r.planes.map((p) => p.buffer));
    }
    if (type === 'lama') {
      const data = await runLama(pixels, mask, reply);
      return post({ type: 'result', data, device: lama?.device }, [data.buffer]);
    }
    let entry = await load(key, reply);
    if (type === 'load') return reply({ type: 'loaded', device: entry.device, fallback: entry.fallback, testMs: entry.testMs });
    if (type === 'asr') {
      const out = (await entry.run(e.data.audio as Float32Array, e.data.timestamps ? { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true } : { chunk_length_s: 30 })) as { text: string; chunks?: { text: string; timestamp: [number, number | null] }[] };
      return reply({ type: 'result', text: out.text, chunks: out.chunks ?? null, device: entry.device });
    }
    const image = new RawImage(pixels as Uint8ClampedArray, width, height, 4);
    const task = MODELS[key as ModelKey].task;
    const extra = task === 'object-detection' ? { threshold: 0.45, percentage: false } : undefined;
    const input = task === 'zero-shot-image-classification' ? image.rgb() : image;
    let out: unknown;
    try {
      out = task === 'zero-shot-image-classification' ? await (entry.run as unknown as (i: unknown, l: string[]) => Promise<unknown>)(input, labels) : await runModel(key, entry, input, inputSize, extra);
    } catch (err) {
      // Some GPUs load a model and then reject it when it runs.
      if (entry.device !== 'webgpu') throw err;
      gpuFailed.add(key);
      loaded.delete(key);
      await entry.run.dispose?.().catch(() => undefined);
      entry = await load(key, reply);
      entry.fallback = (err as Error).message || String(err);
      out = await runModel(key, entry, input, inputSize, extra);
    }
    if (task === 'object-detection' || task === 'zero-shot-image-classification') return reply({ type: 'result', items: out, device: entry.device });
    const plane = toPlane(key, out);
    post({ type: 'result', ...plane, device: entry.device, fallback: entry.fallback }, [plane.data.buffer]);
  } catch (err) {
    reply({ type: 'error', message: (err as Error).message || String(err) });
  }
};

// Reaching this line means every import loaded and ran. The app waits for it.
self.postMessage({ type: 'hello', transformers: env.version, ort: ort.env.versions?.web ?? '' });
