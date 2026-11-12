import type { AudioBands } from '../effects/types';
import { modulateDefs, ZERO_BANDS } from '../effects/types';
import { getEffect } from '../effects/registry';
import { assetStore } from '../engine/assets';
import { FrameRenderer } from '../engine/FrameRenderer';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { evalLayer, type LayerState } from './animate';
import { drawMedia, drawShape, drawText, mediaSize, shapeHandlesReveal, textBounds } from './draw';
import { propDefsFor, type Composition, type Layer } from './model';

/** Untransformed content size of a layer in composition pixels. */
export function layerSize(layer: Layer, comp: Composition): { w: number; h: number } {
  switch (layer.kind) {
    case 'text':
      return textBounds(layer.props);
    case 'shape':
      return { w: layer.props.w as number, h: layer.props.h as number };
    case 'media': {
      const a = layer.assetId ? assetStore.get(layer.assetId) : undefined;
      return a ? mediaSize(a, layer.props.fit as string, comp) : { w: 100, h: 100 };
    }
    default:
      return { w: comp.width, h: comp.height };
  }
}

export function isActive(layer: Layer, time: number) {
  return !layer.hidden && time >= layer.start && time < layer.end;
}

/** Topmost visible, non-effect layer under a composition-space point. */
export function hitTest(comp: Composition, time: number, px: number, py: number): Layer | null {
  for (let i = comp.layers.length - 1; i >= 0; i--) {
    const l = comp.layers[i];
    if (l.kind === 'effect' || !isActive(l, time)) continue;
    const st = evalLayer(l, time);
    const { w, h } = layerSize(l, comp);
    const dx = px - st.x * comp.width, dy = py - st.y * comp.height;
    const c = Math.cos(-st.rotation), s = Math.sin(-st.rotation);
    const lx = (dx * c - dy * s) / st.scale, ly = (dx * s + dy * c) / st.scale;
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return l;
  }
  return null;
}

/**
 * Plays a composition: owns one <video> per video layer (kept in sync with
 * the composition clock) and renders frames. Used by the preview and by export.
 */
export class CompPlayer {
  private videos = new Map<string, { el: HTMLVideoElement; assetId: string }>();
  private renderer = new FrameRenderer();
  private tmp = createCanvas(1, 1);
  private fx = createCanvas(1, 1);

  /** onFrame is called when a paused video finishes seeking, so the caller can redraw. */
  constructor(private onFrame: () => void = () => undefined) {}

  private videoFor(layer: Layer): HTMLVideoElement | null {
    const a = layer.assetId ? assetStore.get(layer.assetId) : undefined;
    if (!a || a.kind !== 'video') return null;
    const cur = this.videos.get(layer.id);
    if (cur && cur.assetId === a.id) return cur.el;
    cur?.el.pause();
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = a.url;
    el.addEventListener('seeked', () => this.onFrame());
    el.addEventListener('loadeddata', () => this.onFrame());
    this.videos.set(layer.id, { el, assetId: a.id });
    return el;
  }

  /** Where a video layer's source should be at composition time. */
  private sourceTime(layer: Layer, el: HTMLVideoElement, time: number) {
    const d = el.duration || 0;
    let t = time - layer.start + (layer.props.offset as number);
    if (d > 0) t = layer.props.loop ? t % d : Math.min(t, d - 0.01);
    return Math.max(0, t);
  }

  /** Bring every video element to the right position / play state. */
  sync(comp: Composition, time: number, playing: boolean) {
    const live = new Set<string>();
    for (const l of comp.layers) {
      if (l.kind !== 'media') continue;
      const el = this.videoFor(l);
      if (!el) continue;
      live.add(l.id);
      if (!isActive(l, time)) {
        if (!el.paused) el.pause();
        continue;
      }
      if (el.readyState < 1) continue;
      const want = this.sourceTime(l, el, time);
      if (playing) {
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
        if (el.paused) el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - want) > 0.03 && !el.seeking) el.currentTime = want;
      }
    }
    for (const [id, v] of this.videos) {
      if (!live.has(id)) {
        v.el.pause();
        v.el.removeAttribute('src');
        v.el.load();
        this.videos.delete(id);
      }
    }
  }

  /** Resolve once all video layers active at `time` have a decodable frame. */
  async prepare(comp: Composition, time: number, timeoutMs = 4000) {
    this.sync(comp, time, false);
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      const pending = comp.layers.some((l) => {
        if (l.kind !== 'media' || !isActive(l, time)) return false;
        const v = this.videos.get(l.id);
        return v ? v.el.readyState < 2 || v.el.seeking : false;
      });
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 50));
      this.sync(comp, time, false);
    }
  }

  /** Draw the composition at `time` into ctx, whose canvas is comp size × scale. */
  render(ctx: CanvasRenderingContext2D, comp: Composition, time: number, scale: number, bands: AudioBands = ZERO_BANDS) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = comp.background;
    ctx.fillRect(0, 0, W, H);

    for (const layer of comp.layers) {
      if (!isActive(layer, time)) continue;
      const st = evalLayer(layer, time, bands);
      if (st.opacity <= 0.001) continue;
      if (layer.kind === 'effect') {
        this.applyEffect(ctx, layer, st, time, bands);
        continue;
      }
      ctx.save();
      ctx.globalCompositeOperation = (layer.anim.blend as GlobalCompositeOperation) || 'source-over';
      ctx.globalAlpha = st.opacity;
      ctx.translate(st.x * W, st.y * H);
      ctx.rotate(st.rotation);
      ctx.scale(st.scale * scale, st.scale * scale);
      const props = modulateDefs(propDefsFor(layer), layer.props, layer.pmods, bands);
      const { w, h } = layerSize({ ...layer, props }, comp);
      const selfReveal = layer.kind === 'shape' && shapeHandlesReveal(props);
      if (st.reveal < 1 && !selfReveal && !st.typewriter) {
        ctx.beginPath();
        ctx.rect(-w / 2 - 200, -h / 2 - 200, (w + 400) * st.reveal, h + 400);
        ctx.clip();
      }
      if (layer.kind === 'text') drawText(ctx, props, st.reveal, st.typewriter);
      else if (layer.kind === 'shape') drawShape(ctx, props, selfReveal ? st.reveal : 1, st.boilStep);
      else if (layer.kind === 'media') {
        const a = layer.assetId ? assetStore.get(layer.assetId) : undefined;
        if (a) {
          const src = a.kind === 'video' ? this.videos.get(layer.id)?.el : a.el;
          if (src && (a.kind === 'image' || (src as HTMLVideoElement).readyState >= 2)) {
            drawMedia(ctx, src, a.kind === 'image' ? a.id : null, w, h, props);
          }
        }
      }
      ctx.restore();
    }
  }

  /** Adjustment layer: run the effect on everything drawn so far. */
  private applyEffect(ctx: CanvasRenderingContext2D, layer: Layer, st: LayerState, time: number, bands: AudioBands) {
    const eff = getEffect(layer.effectId ?? '');
    if (!eff) return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (this.tmp.width !== W || this.tmp.height !== H) {
      this.tmp.width = W;
      this.tmp.height = H;
    }
    const tg = get2d(this.tmp);
    tg.clearRect(0, 0, W, H);
    tg.drawImage(ctx.canvas, 0, 0);
    const params = modulateDefs(eff.params, layer.props, layer.pmods, bands);
    this.renderer.render({ source: this.tmp, target: this.fx, width: W, height: H, effect: eff, params, time, frame: Math.floor(time * 24) });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = st.opacity;
    ctx.globalCompositeOperation = (layer.anim.blend as GlobalCompositeOperation) || 'source-over';
    if (st.reveal < 1) {
      ctx.beginPath();
      ctx.rect(0, 0, W * st.reveal, H);
      ctx.clip();
    }
    ctx.drawImage(this.fx, 0, 0);
    ctx.restore();
  }

  /** Dashed selection frame with scale / rotate handles (preview only). */
  drawSelection(ctx: CanvasRenderingContext2D, comp: Composition, layer: Layer, time: number, scale: number) {
    if (layer.kind === 'effect' || !isActive(layer, time)) return;
    const st = evalLayer(layer, time);
    const { w, h } = layerSize(layer, comp);
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = st.scale * scale;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(st.x * W, st.y * H);
    ctx.rotate(st.rotation);
    ctx.strokeStyle = '#c6ff2e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect((-w / 2) * k, (-h / 2) * k, w * k, h * k);
    ctx.setLineDash([]);
    ctx.fillStyle = '#c6ff2e';
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ctx.fillRect((sx * w * k) / 2 - 5, (sy * h * k) / 2 - 5, 10, 10);
    ctx.beginPath();
    ctx.moveTo(0, (-h * k) / 2);
    ctx.lineTo(0, (-h * k) / 2 - 28);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, (-h * k) / 2 - 34, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  dispose() {
    for (const v of this.videos.values()) {
      v.el.pause();
      v.el.removeAttribute('src');
      v.el.load();
    }
    this.videos.clear();
    this.renderer.dispose();
    this.tmp.width = this.tmp.height = this.fx.width = this.fx.height = 1;
  }
}
