/** Live numbers for the monitor. Written by the preview loop, read a few times a second. */

export type PreviewQuality = 'performance' | 'balanced' | 'quality';

/** Longest a preview frame should take while playing. Above it, resolution drops. */
export const QUALITY_BUDGET: Record<PreviewQuality, number> = { performance: 22, balanced: 40, quality: Infinity };

/** The preview mode, for work that runs beside the preview (live depth, tracking). Never read by export. */
export const perfSettings: { mode: PreviewQuality } = { mode: 'balanced' };
/** Shortest gap between live depth maps in each mode, in ms. */
export const LIVE_DEPTH_GAP: Record<PreviewQuality, number> = { performance: 200, balanced: 70, quality: 0 };

export const perf = {
  previewFps: 0,
  sourceFps: 0,
  /** What the stack could do if nothing else ran: 1000 / processing ms. */
  processingFps: 0,
  /** Source frames shown without being processed, since playback started. */
  dropped: 0,
  width: 0, height: 0,
  /** Current share of the full preview size while playing. */
  scale: 1,
  effects: 0,
  ms: 0,
  steps: [] as { name: string; ms: number }[],
  cacheHits: 0,
  acceleration: 'Checking…',
};

let last = performance.now(), frames = 0;
export function countFrame() {
  frames++;
  const now = performance.now();
  if (now - last >= 500) {
    perf.previewFps = (frames * 1000) / (now - last);
    frames = 0;
    last = now;
  }
}

export function resetCounters() {
  perf.dropped = 0;
  perf.previewFps = 0;
  perf.sourceFps = 0;
  frames = 0;
  last = performance.now();
}

/** Says plainly what is and is not accelerated on this machine. */
export async function detectAcceleration() {
  const gl = !!document.createElement('canvas').getContext('webgl2');
  let gpu = false;
  try { gpu = !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter()); } catch { /* none */ }
  const encoder = typeof VideoEncoder !== 'undefined';
  perf.acceleration = `Effects: CPU · AI: ${gpu ? 'WebGPU' : 'CPU'} · Video encode: ${encoder ? 'WebCodecs' : 'none'}${gl ? ' · WebGL2 ready' : ''}`;
}
