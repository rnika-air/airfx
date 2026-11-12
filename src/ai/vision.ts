import { FilesetResolver, HandLandmarker, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Body and hand tracking with MediaPipe, on the main thread (its GPU path).
 * Runs on whatever the preview shows: the webcam, a video file or a photo.
 * Models download only when the user presses Load, then stay in this browser.
 * Calls are synchronous, so the same frame always gets the same answer and an
 * export tracks every frame.
 */

export type VisionTask = 'hands' | 'pose';
export type VisionState = { status: 'idle' | 'cached' } | { status: 'loading'; loaded: number; total: number } | { status: 'ready'; device: string } | { status: 'error'; message: string };

const MODEL: Record<VisionTask, { url: string; mb: number; label: string; license: string; note: string }> = {
  hands: {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    mb: 7.5, label: 'Hand Landmarker (MediaPipe)', license: 'Apache-2.0',
    note: 'Finds up to two hands and 21 points on each, including fingertips.',
  },
  pose: {
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    mb: 5.5, label: 'Pose Landmarker Lite (MediaPipe)', license: 'Apache-2.0',
    note: 'Finds one body: 33 points and a silhouette mask of the person.',
  },
};
export const VISION_MODELS = MODEL;
const CACHE = 'airfx-models';

export interface HandResult { points: { x: number; y: number }[]; tip: { x: number; y: number }; pinch: number }
/** A hand with every point and which of the person's hands it is. */
export interface HandFull { side: 'left' | 'right'; score: number; points: { x: number; y: number; z: number }[] }
interface RawHands { landmarks: { x: number; y: number; z: number }[][]; handed: { name: string; score: number }[] }

export interface PoseResult { points: NormalizedLandmark[]; mask: { w: number; h: number; data: Float32Array } | null }

/**
 * A readable reason for a failed load. A runtime script that fails to load
 * rejects with a bare browser Event, which would otherwise read "[object Event]".
 */
async function explain(e: unknown): Promise<string> {
  if (e instanceof Error && e.message) return e.message;
  let served = false;
  try { served = (await fetch('/mediapipe/vision_wasm_internal.js', { method: 'HEAD', cache: 'no-store' })).ok; } catch { served = false; }
  if (!served) return 'The tracking runtime could not be loaded from AirFx\'s own server. The server may have stopped: start AirFx again (npm run dev), reload this page, then press Retry.';
  if (!navigator.onLine) return 'The model could not be downloaded: this computer looks offline. Connect, then press Retry.';
  return `Hand tracking could not start (${e instanceof Event ? `${e.type} event` : String(e)}). Reload the page and press Retry. If it keeps failing, try another browser such as Chrome or Edge.`;
}

let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;

class Vision {
  private hands: HandLandmarker | null = null;
  private pose: PoseLandmarker | null = null;
  private states: Record<VisionTask, VisionState> = { hands: { status: 'idle' }, pose: { status: 'idle' } };
  private listeners = new Set<() => void>();
  private clock = 0;
  private memo: Record<VisionTask, { key: unknown; at: number; value: unknown }> = { hands: { key: null, at: -1, value: { landmarks: [], handed: [] } }, pose: { key: null, at: -1, value: null } };
  version = 0;
  lastMs = 0;

  constructor() { this.checkCached(); }

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.listeners.forEach((f) => f()); }
  state(t: VisionTask) { return this.states[t]; }
  private set(t: VisionTask, s: VisionState) { this.states[t] = s; this.bump(); }

  private async checkCached() {
    try {
      const c = await caches.open(CACHE);
      for (const t of ['hands', 'pose'] as VisionTask[]) if (this.states[t].status === 'idle' && await c.match(MODEL[t].url)) this.states[t] = { status: 'cached' };
      this.bump();
    } catch { /* no Cache API: models download each session */ }
  }

  private async bytes(t: VisionTask) {
    const url = MODEL[t].url;
    let cache: Cache | null = null;
    try { cache = await caches.open(CACHE); } catch { cache = null; }
    const hit = await cache?.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const res = await fetch(url);
    if (!res.ok) throw new Error(`The model could not be downloaded (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || MODEL[t].mb * 1048576, reader = res.body!.getReader(), parts: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      this.set(t, { status: 'loading', loaded, total });
    }
    const all = new Uint8Array(loaded);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    await cache?.put(url, new Response(all.slice(), { headers: { 'Content-Type': 'application/octet-stream' } })).catch(() => undefined);
    return all;
  }

  async load(t: VisionTask) {
    if (this.states[t].status === 'ready' || this.states[t].status === 'loading') return;
    this.set(t, { status: 'loading', loaded: 0, total: MODEL[t].mb * 1048576 });
    try {
      fileset ??= await FilesetResolver.forVisionTasks('/mediapipe');
      const buf = await this.bytes(t);
      const make = async (delegate: 'GPU' | 'CPU') => t === 'hands'
        ? HandLandmarker.createFromOptions(fileset!, { baseOptions: { modelAssetBuffer: buf, delegate }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.4, minTrackingConfidence: 0.4 })
        : PoseLandmarker.createFromOptions(fileset!, { baseOptions: { modelAssetBuffer: buf, delegate }, runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true });
      let device = 'GPU', model: HandLandmarker | PoseLandmarker;
      try { model = await make('GPU'); } catch { model = await make('CPU'); device = 'CPU'; }
      // Ready means it ran: one detection on a blank frame.
      const probe = document.createElement('canvas');
      probe.width = probe.height = 64;
      probe.getContext('2d')!.fillRect(0, 0, 64, 64);
      if (t === 'hands') (model as HandLandmarker).detectForVideo(probe, this.tick());
      else { const r = (model as PoseLandmarker).detectForVideo(probe, this.tick()); r.segmentationMasks?.forEach((x) => x.close()); }
      if (t === 'hands') this.hands = model as HandLandmarker; else this.pose = model as PoseLandmarker;
      this.set(t, { status: 'ready', device });
    } catch (e) {
      this.set(t, { status: 'error', message: await explain(e) });
    }
  }

  async clear(t: VisionTask) {
    if (t === 'hands') { this.hands?.close(); this.hands = null; } else { this.pose?.close(); this.pose = null; }
    try { await (await caches.open(CACHE)).delete(MODEL[t].url); } catch { /* nothing cached */ }
    this.set(t, { status: 'idle' });
  }

  ready(t: VisionTask) { return this.states[t].status === 'ready'; }

  /** Timestamps must rise for VIDEO mode; real time where possible helps its tracking. */
  private tick() { this.clock = Math.max(this.clock + 1, Math.round(performance.now())); return this.clock; }

  /** One detection per frame, shared by every caller. */
  private detectHands(frame: CanvasImageSource, key: unknown): RawHands {
    if (this.memo.hands.key === key) return this.memo.hands.value as RawHands;
    const t0 = performance.now(), r = this.hands!.detectForVideo(frame as HTMLCanvasElement, this.tick());
    this.lastMs = performance.now() - t0;
    const raw: RawHands = { landmarks: r.landmarks, handed: r.handedness.map((h) => ({ name: h[0]?.categoryName ?? '', score: h[0]?.score ?? 0 })) };
    this.memo.hands = { key, at: t0, value: raw };
    return raw;
  }

  /** Hands in this frame, or [] when the model is not loaded. `key` identifies the frame so repeats are free. */
  handsIn(frame: CanvasImageSource, key: unknown): HandResult[] {
    if (!this.hands) return [];
    return this.detectHands(frame, key).landmarks.map((pts) => {
      const tip = pts[8], thumb = pts[4];
      return { points: pts.map((q) => ({ x: q.x, y: q.y })), tip: { x: tip.x, y: tip.y }, pinch: Math.hypot(tip.x - thumb.x, tip.y - thumb.y) };
    });
  }

  /**
   * Hands with all 21 points and which hand each is, for a picture as the camera
   * gives it (not mirrored). MediaPipe names hands as if the picture were mirrored,
   * so on a camera's own picture its "Left" is the person's right hand.
   */
  handsFull(frame: CanvasImageSource, key: unknown): HandFull[] {
    if (!this.hands) return [];
    const r = this.detectHands(frame, key);
    return r.landmarks.map((pts, i) => ({ side: r.handed[i]?.name === 'Left' ? 'right' : 'left', score: r.handed[i]?.score ?? 0, points: pts.map((q) => ({ x: q.x, y: q.y, z: q.z })) }));
  }

  /** How sure the model must be before it reports a hand, 0.2 (eager) to 0.65 (strict). */
  async setHandConfidence(c: number) {
    await this.hands?.setOptions({ minHandDetectionConfidence: c, minHandPresenceConfidence: c, minTrackingConfidence: c });
    this.memo.hands = { key: null, at: -1, value: { landmarks: [], handed: [] } };
  }

  /** The body in this frame: 33 points and a silhouette, or null. */
  poseIn(frame: CanvasImageSource, key: unknown): PoseResult | null {
    if (!this.pose) return null;
    if (this.memo.pose.key === key) return this.memo.pose.value as PoseResult | null;
    const t0 = performance.now(), r = this.pose.detectForVideo(frame as HTMLCanvasElement, this.tick());
    this.lastMs = performance.now() - t0;
    let mask: PoseResult['mask'] = null;
    const m = r.segmentationMasks?.[0];
    if (m) mask = { w: m.width, h: m.height, data: Float32Array.from(m.getAsFloat32Array()) };
    r.segmentationMasks?.forEach((x) => x.close());
    const out = r.landmarks[0] ? { points: r.landmarks[0], mask } : mask ? { points: [], mask } : null;
    this.memo.pose = { key, at: t0, value: out };
    return out;
  }
}

export const vision = new Vision();

/** Body parts as pose point indices, for "fill selected regions". */
export const BODY_REGIONS: Record<string, [number, number][]> = {
  head: [[0, 7], [0, 8], [7, 8], [9, 10]],
  torso: [[11, 12], [11, 23], [12, 24], [23, 24], [11, 24], [12, 23]],
  arms: [[11, 13], [13, 15], [12, 14], [14, 16], [15, 19], [16, 20]],
  legs: [[23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32]],
};
