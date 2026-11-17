import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams } from '../effects/types';

/**
 * A video or GIF with real AirFx effects running on it live, switching effect
 * every few seconds. Renders small (it is a preview), at most ~20 frames a
 * second, and only while it is on screen. If the media cannot load, shows
 * `fallback` instead.
 */

const W = 360, H = 450;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const LIVE_EFFECTS = ['glitch2', 'pixelArt', 'thermal', 'moire', 'halftone', 'dreamy', 'ascii', 'nightVision'];

export function LiveFx({ src, kind, effects = LIVE_EFFECTS, every = 2800, offset = 0, caption, fallback, className = '' }: {
  src: string; kind: 'video' | 'gif'; effects?: string[]; every?: number; offset?: number;
  caption?: (name: string, i: number, n: number) => ReactNode; fallback?: ReactNode; className?: string;
}) {
  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const media = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [i, setI] = useState(offset % effects.length);
  const list = effects.map(getEffect).filter((e): e is NonNullable<typeof e> => !!e);
  const fx = list[i % Math.max(1, list.length)];

  // Next effect every few seconds.
  useEffect(() => {
    if (list.length < 2 || reduced()) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), every);
    return () => clearInterval(t);
  }, [list.length, every]);

  // The render loop: only while visible and the tab is in front.
  useEffect(() => {
    const c = canvas.current, m = media.current, box = wrap.current;
    if (!c || !m || !box || !fx || failed || !ready) return;
    c.width = W; c.height = H;
    const renderer = new FrameRenderer();
    const params = defaultParams(fx);
    // Cover-crop the source into the 4:5 frame, like object-fit: cover.
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const g = src.getContext('2d', { willReadFrequently: true })!;
    // At most 15 frames a second; a slow device gets fewer, so the page stays responsive.
    let visible = true, raf = 0, last = 0, frame = 0, gap = 66;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(box);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden || now - last < gap) return;
      last = now;
      const mw = (m as HTMLVideoElement).videoWidth || m.naturalWidth, mh = (m as HTMLVideoElement).videoHeight || m.naturalHeight;
      if (!mw || !mh) return;
      const k = Math.max(W / mw, H / mh);
      g.drawImage(m, (W - mw * k) / 2, (H - mh * k) / 2, mw * k, mh * k);
      const t0 = performance.now();
      try { renderer.render({ source: src, target: c, width: W, height: H, layers: [{ effect: fx, params }], time: now / 1000, frame: frame++ }); }
      catch { /* a frame that fails is skipped */ }
      gap = Math.min(250, Math.max(66, (performance.now() - t0) * 3));
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); renderer.dispose(); };
  }, [fx, failed, ready]);

  if (failed) return <>{fallback}</>;
  const onReady = () => setReady(true);
  return (
    <figure ref={wrap} className={`livefx ${className}`}>
      {kind === 'video'
        ? <video ref={media} className="livefx__src" src={src} muted loop playsInline autoPlay={!reduced()} preload="auto" onLoadedData={onReady} onError={() => setFailed(true)} aria-hidden />
        : <img ref={media} className="livefx__src" src={src} alt="" onLoad={onReady} onError={() => setFailed(true)} draggable={false} />}
      <canvas key={fx?.id} ref={canvas} className="livefx__fx" aria-label={fx ? `${fx.name}, running live` : undefined} />
      {fx && <span key={`e${fx.id}`} className="livefx__edge" />}
      {fx && caption?.(fx.name, i % list.length, list.length)}
    </figure>
  );
}
