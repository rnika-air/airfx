import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { AudioBands, StackItem } from '../effects/types';
import { FrameRenderer } from '../engine/FrameRenderer';
import { layersOf } from './useEffectState';
import { fitWithin, get2d } from '../utils/imageProcessing';
import { onEachVideoFrame } from '../utils/videoProcessing';
import { QUALITY_BUDGET, countFrame, perf, perfSettings, resetCounters, type PreviewQuality } from '../engine/perf';

/** Preview sizes used while a slider is moving. Fixed steps, so earlier steps' cached results stay valid. */
const DRAG_LEVELS = [1, 0.75, 0.5, 0.375, 0.25];
const DRAG_FLOOR: Record<PreviewQuality, number> = { performance: 0.25, balanced: 0.375, quality: 1 };
/** Kinds of render: settled at full size, a moving frame (playback), or a frame while a control is moving. */
const FULL = 0, MOVING = 1, DRAG = 2;
import type { LoadedMedia } from './useMedia';

export interface RenderStats {
  state: 'idle' | 'rendering' | 'ready' | 'error';
  ms: number;
  width: number;
  height: number;
  error?: string;
}

interface Options {
  media: LoadedMedia | null;
  /** The non-destructive effect stack, run in order. */
  items: StackItem[];
  /** Skip the stack and show the source (compare against the original). */
  bypass: boolean;
  /** Long-edge cap for the interactive preview (export is independent). */
  previewEdge: number;
  showOriginal: boolean;
  processedRef: RefObject<HTMLCanvasElement>;
  originalRef: RefObject<HTMLCanvasElement>;
  /** Current transport time in seconds. */
  getTime: () => number;
  getBands: () => AudioBands;
  /**
   * Keep rendering every animation frame (a still being animated or reacting
   * to audio). Video playback has its own per-frame loop.
   */
  live: boolean;
  /** How hard to work for smooth playback. */
  quality: PreviewQuality;
  /** Called after each rendered frame, with the canvas that holds it. */
  onFrame?: (canvas: HTMLCanvasElement) => void;
}

/**
 * Drives the preview. Stills re-render once per change (coalesced to one
 * render per animation frame), or continuously while live. Videos render on
 * each decoded frame while playing, and only on change / seek while paused.
 */
export function useEffectRenderer(opts: Options) {
  const { media, items, bypass, previewEdge, showOriginal, live } = opts;
  const latest = useRef(opts);
  latest.current = opts;
  const renderer = useRef<FrameRenderer | null>(null);
  const frame = useRef(0);
  const pending = useRef(0);
  const lastStatsAt = useRef(0);
  /** Share of full preview size used while frames are moving. */
  const scale = useRef(1);
  const nextAllowed = useRef(0);
  const source = useRef({ time: -1, frames: -1, seen: 0, elapsed: 0 });
  /** Cost of the last frame at full preview size, measured or estimated from a smaller one. */
  const fullMs = useRef(0);
  const lastChange = useRef(0);
  const refine = useRef(0);
  const nextKind = useRef(FULL);
  const [stats, setStats] = useState<RenderStats>({ state: 'idle', ms: 0, width: 0, height: 0 });

  const renderNow = useCallback((kind: number = FULL) => {
    const o = latest.current;
    const target = o.processedRef.current;
    if (!o.media || !target) return;
    if (!renderer.current) renderer.current = new FrameRenderer();
    perfSettings.mode = o.quality;
    const continuous = kind === MOVING;
    // Performance also keeps the settled preview small. Export never reads this.
    const full = fitWithin(o.media.width, o.media.height, o.quality === 'performance' ? Math.min(720, o.previewEdge) : o.previewEdge);
    // Area scales with cost, so a side of k costs about k² of the full frame.
    const budget = QUALITY_BUDGET[o.quality];
    const k = kind === MOVING ? Math.round(scale.current * 20) / 20
      : kind === DRAG ? DRAG_LEVELS.find((l) => fullMs.current * l * l <= budget || l <= DRAG_FLOOR[o.quality]) ?? 1
      : 1;
    const width = Math.max(16, Math.round(full.width * k)), height = Math.max(16, Math.round(full.height * k));
    const isVideo = o.media.kind === 'video';
    const time = o.getTime();
    try {
      const layers = o.bypass ? [] : layersOf(o.items, o.getBands());
      const ms = renderer.current.render({
        source: o.media.element,
        target,
        width,
        height,
        layers,
        time,
        frame: isVideo ? frame.current++ : Math.floor(time * 24),
        // Only a frame that is holding still can be reused.
        cacheKey: continuous || o.live ? undefined : `${o.media.url}@${time.toFixed(3)}`,
      });
      fullMs.current = ms / Math.max(0.05, k * k);
      if (continuous) {
        // Size follows cost: area scales with time, so the side scales with its root.
        if (budget === Infinity) scale.current = 1;
        else if (ms > budget * 1.15 || ms < budget * 0.6) scale.current = Math.min(1, Math.max(0.3, scale.current * (0.75 + 0.25 * Math.sqrt(budget / Math.max(1, ms)))));
      }
      countFrame();
      perf.ms = ms;
      perf.processingFps = ms > 0 ? 1000 / ms : 0;
      perf.width = width; perf.height = height;
      perf.scale = k;
      perf.effects = layers.length;
      perf.steps = renderer.current.steps;
      o.onFrame?.(target);
      const orig = o.originalRef.current;
      if (o.showOriginal && orig) {
        if (orig.width !== width) orig.width = width;
        if (orig.height !== height) orig.height = height;
        const ctx = get2d(orig);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(o.media.element, 0, 0, width, height);
      }
      const now = performance.now();
      if (!continuous || now - lastStatsAt.current > 300) {
        lastStatsAt.current = now;
        setStats({ state: 'ready', ms, width, height });
      }
    } catch (e) {
      console.error(e);
      setStats({ state: 'error', ms: 0, width, height, error: (e as Error).message });
    }
  }, []);

  const schedule = useCallback((settle = false) => {
    // Changes arriving close together mean a control is being dragged. If a full frame
    // is too slow to keep up, render smaller now and the full frame once it stops.
    const now = performance.now(), rapid = !settle && now - lastChange.current < 400;
    if (!settle) lastChange.current = now;
    const drag = rapid && fullMs.current > QUALITY_BUDGET[latest.current.quality] * 1.2;
    clearTimeout(refine.current);
    if (drag) refine.current = window.setTimeout(() => schedule(true), 260);
    // A render already waiting takes the newest kind.
    nextKind.current = drag ? DRAG : FULL;
    if (pending.current) return;
    setStats((s) => (s.state === 'rendering' ? s : { ...s, state: 'rendering' }));
    // rAF stops while the window is hidden, so a timer guarantees the render.
    let timer = 0;
    const run = () => {
      cancelAnimationFrame(pending.current);
      clearTimeout(timer);
      pending.current = 0;
      renderNow(nextKind.current);
    };
    pending.current = requestAnimationFrame(run);
    timer = window.setTimeout(run, 150);
  }, [renderNow]);

  useEffect(() => {
    if (!media) {
      setStats({ state: 'idle', ms: 0, width: 0, height: 0 });
      return;
    }
    schedule();
  }, [media, items, bypass, previewEdge, showOriginal, schedule, opts.quality]);
  // A new picture or size is not a drag.
  useEffect(() => { fullMs.current = 0; }, [media, previewEdge]);

  // Video frame loop, attached only while playing.
  useEffect(() => {
    if (!media || media.kind !== 'video') return;
    const v = media.element as HTMLVideoElement;
    let stop: (() => void) | null = null;
    const onPlay = () => {
      stop?.();
      resetCounters();
      source.current = { time: -1, frames: -1, seen: 0, elapsed: 0 };
      stop = onEachVideoFrame(v, (meta) => {
        if (meta) {
          const s = source.current;
          if (s.frames >= 0 && meta.presentedFrames > s.frames) {
            s.seen += meta.presentedFrames - s.frames;
            s.elapsed += Math.max(0, meta.mediaTime - s.time);
            if (s.elapsed > 0.2) perf.sourceFps = s.seen / s.elapsed;
            perf.dropped += meta.presentedFrames - s.frames - 1;
          }
          s.frames = meta.presentedFrames;
          s.time = meta.mediaTime;
        }
        // Keep a fifth of the time free so the interface stays responsive.
        const now = performance.now();
        if (now < nextAllowed.current) { perf.dropped++; return; }
        renderNow(MOVING);
        const end = performance.now();
        nextAllowed.current = end + (end - now) * 0.25;
      });
    };
    const onPause = () => {
      stop?.();
      stop = null;
      scale.current = 1;
      schedule();
    };
    const onSeeked = () => {
      if (v.paused) schedule();
    };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    if (!v.paused) onPlay();
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      stop?.();
    };
  }, [media, renderNow, schedule]);

  // Continuous loop for animated stills / audio reaction.
  useEffect(() => {
    if (!media || !live) return;
    let id = 0;
    const loop = () => {
      // Same rule as video: keep a fifth of the time free, so controls answer while it animates.
      const now = performance.now();
      if (now >= nextAllowed.current) {
        renderNow(MOVING);
        const end = performance.now();
        nextAllowed.current = end + (end - now) * 0.25;
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(id);
      schedule(); // settle on a final frame
    };
  }, [media, live, renderNow, schedule]);

  useEffect(
    () => () => {
      cancelAnimationFrame(pending.current);
      clearTimeout(refine.current);
      renderer.current?.dispose();
    },
    [],
  );

  const rerender = useCallback(() => schedule(), [schedule]);
  return { stats, rerender };
}
