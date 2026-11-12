import type { EffectDefinition, ParamValues, RenderLayer } from '../effects/types';
import { sanitizeParams } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';
import type { StepScope } from '../effects/types';
import { editedDepth } from '../effects/airDepth';
import { selection } from '../ai/selection';
import { resample } from '../effects/airKey';
import { perf } from './perf';

/** Read analysis or earlier frames, so their output cannot be reused by parameters alone. */
const UNCACHEABLE = new Set(['airKey', 'airDepth', 'airCleanup', 'datamosh', 'stutter', 'motionTrails', 'lineScan', 'blobTracker', 'inkBleed', 'soundViz', 'glitch2', 'reveal', 'particleSim', 'speechType', 'audioShapes', 'thermal', 'crayon']);
const stepKey = (l: RenderLayer) => `${l.effect.id}|${JSON.stringify(l.params)}|${l.mix ?? 100}|${l.blend ?? ''}`;

/** Reads analysis results already in memory. Never runs a model. */
export function scopeMask(scope: StepScope, w: number, h: number, time: number): Float32Array | null {
  if (scope === 'subject' || scope === 'background') {
    const m = selection.union(time);
    if (!m) return null;
    const s = resample(m, w, h);
    if (scope === 'subject') return s;
    const o = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) o[i] = 1 - s[i];
    return o;
  }
  if (scope === 'depthNear' || scope === 'depthFar') {
    // Includes brush edits, so painting changes every step that follows depth.
    const s = editedDepth(w, h, time);
    if (!s) return null;
    const o = new Float32Array(s.length), near = scope === 'depthNear';
    for (let i = 0; i < s.length; i++) { const k = Math.min(1, Math.max(0, (s[i] - 0.4) / 0.2)); o[i] = near ? k : 1 - k; }
    return o;
  }
  return null;
}

export interface FrameRequest {
  /** Any drawable: HTMLImageElement, HTMLVideoElement, canvas, ImageBitmap. */
  source: CanvasImageSource;
  target: HTMLCanvasElement;
  width: number;
  height: number;
  /** The processing chain, run in order. Takes priority over effect / params. */
  layers?: RenderLayer[];
  effect?: EffectDefinition | null;
  params?: ParamValues;
  time?: number;
  frame?: number;
  /**
   * Identifies this exact source frame. When set, finished steps are kept, so
   * moving a slider on the last step does not re-run the steps before it.
   */
  cacheKey?: string;
}

/**
 * Renders one frame: scales the source into a work buffer, then runs each
 * layer of the chain on the previous result and writes the final image to the
 * target. The same class drives the interactive preview and full-resolution
 * export, so the two can never diverge. The source is never modified.
 */
export class FrameRenderer {
  private a = createCanvas(1, 1);
  private b = createCanvas(1, 1);
  private kept = new Map<string, HTMLCanvasElement>();
  /** Time of each step in the last frame. */
  steps: { name: string; ms: number }[] = [];

  private fit(c: HTMLCanvasElement, w: number, h: number) {
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
  }

  render(req: FrameRequest): number {
    const t0 = performance.now();
    const w = Math.max(1, Math.round(req.width));
    const h = Math.max(1, Math.round(req.height));
    this.fit(req.target, w, h);
    const out = get2d(req.target);
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.clearRect(0, 0, w, h);

    const layers = req.layers ?? (req.effect ? [{ effect: req.effect, params: req.params ?? {} }] : []);
    if (!layers.length) {
      out.imageSmoothingQuality = 'high';
      out.drawImage(req.source, 0, 0, w, h);
      return performance.now() - t0;
    }

    let cur = this.a, next = this.b;
    this.fit(cur, w, h);
    this.fit(next, w, h);
    const first = get2d(cur, true);
    first.setTransform(1, 0, 0, 1, 0, 0);
    first.globalCompositeOperation = 'source-over';
    first.globalAlpha = 1;
    first.clearRect(0, 0, w, h);
    first.imageSmoothingQuality = 'high';
    first.drawImage(req.source, 0, 0, w, h);

    // Resume after the last step whose result is already known.
    const keys: (string | null)[] = [];
    let chain = req.cacheKey ? `${req.cacheKey}|${w}x${h}|${req.frame ?? 0}` : null;
    for (const l of layers) {
      chain = chain && !UNCACHEABLE.has(l.effect.id) && (l.scope ?? 'all') === 'all' && l.effect.compat !== 'video' ? `${chain}>${stepKey(l)}` : null;
      keys.push(chain);
    }
    let start = 0;
    for (let i = layers.length - 1; i >= 0; i--) {
      const hit = keys[i] && this.kept.get(keys[i]!);
      if (hit) {
        first.clearRect(0, 0, w, h);
        first.drawImage(hit, 0, 0);
        start = i + 1;
        perf.cacheHits++;
        break;
      }
    }
    this.steps = [];

    for (let n = start; n < layers.length; n++) {
      const layer = layers[n], stepStart = performance.now();
      const ctx = get2d(next, true);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);
      // Pixels are read only if the step asks for them: many steps only draw the canvas.
      const from = cur;
      let src: ImageData | null = null;
      const input = {
        get src() { return (src ??= get2d(from, true).getImageData(0, 0, w, h)); },
        srcCanvas: cur,
        ctx,
        width: w,
        height: h,
        params: sanitizeParams(layer.effect, layer.params),
        unit: Math.max(w, h) / 1000,
        time: req.time ?? 0,
        frame: req.frame ?? 0,
      };
      layer.effect.render(input);
      ctx.restore();

      const mix = layer.mix ?? 100;
      const blend = layer.blend ?? 'source-over';
      const scope = layer.scope ?? 'all';
      const limit = scope === 'all' ? null : scopeMask(scope, w, h, req.time ?? 0);
      if (limit) {
        // The step keeps its pixels only inside the mask; the rest stays as it was.
        const o = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < limit.length; i++) o.data[i * 4 + 3] *= limit[i];
        ctx.putImageData(o, 0, 0);
        const c = get2d(cur, true);
        c.save();
        c.globalAlpha = Math.max(0, mix) / 100;
        c.globalCompositeOperation = blend;
        c.drawImage(next, 0, 0);
        c.restore();
      } else if (mix >= 100 && blend === 'source-over') {
        [cur, next] = [next, cur];
      } else {
        // Partial mix / blend: lay this step over the previous result.
        const c = get2d(cur, true);
        c.save();
        c.globalAlpha = Math.max(0, mix) / 100;
        c.globalCompositeOperation = blend;
        c.drawImage(next, 0, 0);
        c.restore();
      }
      const spent = performance.now() - stepStart;
      this.steps.push({ name: layer.effect.name, ms: spent });
      // Worth keeping only if redoing it would cost more than copying it, and something follows.
      const key = keys[n];
      if (key && n < layers.length - 1 && spent > 6) {
        let copy: HTMLCanvasElement | undefined;
        if (this.kept.size >= 5) { const old = this.kept.keys().next().value!; copy = this.kept.get(old); this.kept.delete(old); }
        copy ??= createCanvas(w, h);
        this.fit(copy, w, h);
        const cc = get2d(copy);
        cc.clearRect(0, 0, w, h);
        cc.drawImage(cur, 0, 0);
        this.kept.set(key, copy);
      }
    }
    out.drawImage(cur, 0, 0);
    return performance.now() - t0;
  }

  /** Release the work buffer memory. */
  dispose() {
    this.kept.clear();
    this.a.width = this.a.height = this.b.width = this.b.height = 1;
  }
}
