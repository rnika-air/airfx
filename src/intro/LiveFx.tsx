import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams } from '../effects/types';
import { showcase, type ShowcaseItem } from './previews';

/**
 * The showcase: photos, videos and GIFs from public/showcase, one after
 * another, each with a different real AirFx effect running on it live. It
 * shows that every effect works on every kind of media.
 *
 * Renders small (it is a preview), at most 15 frames a second (fewer on slow
 * devices), and only while it is on screen.
 */

const W = 360, H = 450;
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const LIVE_EFFECTS = ['glitch2', 'pixelArt', 'thermal', 'moire', 'halftone', 'dreamy', 'ascii', 'nightVision'];
export const TYPE_NAME: Record<ShowcaseItem['type'], string> = { photo: 'Photo', video: 'Video', gif: 'GIF' };

export interface Slide { item: ShowcaseItem; effectName: string; index: number; count: number }

export function LiveFx({ effects = LIVE_EFFECTS, every = 3200, offset = 0, only, caption, className = '' }: {
  effects?: string[]; every?: number; offset?: number;
  /** Limit to some media types, e.g. ['gif']. */
  only?: ShowcaseItem['type'][];
  caption?: (s: Slide) => ReactNode; className?: string;
}) {
  const all = useSyncExternalStore(showcase.subscribe, showcase.get);
  useEffect(() => { showcase.load(); }, []);
  const media = only ? all.filter((m) => only.includes(m.type)) : all;
  const fxList = effects.map(getEffect).filter((e): e is NonNullable<typeof e> => !!e);

  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const el = useRef<HTMLVideoElement & HTMLImageElement>(null);
  const [step, setStep] = useState(offset);
  const [ready, setReady] = useState(false);

  const item = media.length ? media[step % media.length] : null;
  // Each picture, clip and GIF has its own effect (showcase.json), so none is shown twice.
  const own = item?.effect ? getEffect(item.effect) : undefined;
  const fx = own ?? (fxList.length ? fxList[step % fxList.length] : null);
  const next = media.length ? media[(step + 1) % media.length] : null;

  // Next slide every few seconds.
  useEffect(() => {
    if (media.length + fxList.length < 3 || reduced()) return;
    const t = setInterval(() => setStep((n) => n + 1), every);
    return () => clearInterval(t);
  }, [media.length, fxList.length, every]);
  useEffect(() => { setReady(false); }, [item?.src]);
  // Warm the cache for the next slide, so it starts at once.
  useEffect(() => { if (next && next.src !== item?.src) fetch(next.src).catch(() => undefined); }, [next?.src]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = canvas.current, m = el.current, box = wrap.current;
    if (!c || !m || !box || !fx || !item || !ready) return;
    c.width = W; c.height = H;
    const renderer = new FrameRenderer();
    const params = defaultParams(fx);
    const still = item.type === 'photo' && !fx.animated?.(params);
    const src = document.createElement('canvas');
    src.width = W; src.height = H;
    const g = src.getContext('2d', { willReadFrequently: true })!;
    const [fx0, fy0] = item.focus ?? [0.5, 0.5];
    let visible = true, raf = 0, last = 0, frame = 0, gap = 66, drawn = false;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.05 });
    io.observe(box);
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible || document.hidden || now - last < gap || (still && drawn)) return;
      last = now;
      const mw = (m as HTMLVideoElement).videoWidth || m.naturalWidth, mh = (m as HTMLVideoElement).videoHeight || m.naturalHeight;
      if (!mw || !mh) return;
      // Cover-crop into the 4:5 frame around the focus point.
      const k = Math.max(W / mw, H / mh) * (item.zoom ?? 1), w = mw * k, h = mh * k;
      g.drawImage(m, Math.min(0, Math.max(W - w, W / 2 - fx0 * w)), Math.min(0, Math.max(H - h, H / 2 - fy0 * h)), w, h);
      const t0 = performance.now();
      try { renderer.render({ source: src, target: c, width: W, height: H, layers: [{ effect: fx, params }], time: now / 1000, frame: frame++ }); drawn = true; }
      catch { /* a frame that fails is skipped */ }
      gap = Math.min(250, Math.max(66, (performance.now() - t0) * 3));
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); io.disconnect(); renderer.dispose(); };
  }, [fx, item, ready]);

  if (!item || !fx) return <figure className={`livefx livefx--wait ${className}`} />;
  const slide: Slide = { item, effectName: fx.name, index: step % media.length, count: media.length };
  const pos = item.focus ? `${item.focus[0] * 100}% ${item.focus[1] * 100}%` : undefined;
  return (
    <figure ref={wrap} className={`livefx ${className}`} data-type={item.type}>
      {item.type === 'video'
        ? <video key={item.src} ref={el} className="livefx__src" src={item.src} muted loop playsInline autoPlay={!reduced()} preload="auto" onLoadedData={() => setReady(true)} aria-hidden />
        : <img key={item.src} ref={el} className="livefx__src" src={item.src} alt="" style={{ objectPosition: pos }} onLoad={() => setReady(true)} draggable={false} />}
      <canvas key={`${item.src}|${fx.id}`} ref={canvas} className="livefx__fx" aria-label={`${fx.name} on a ${TYPE_NAME[item.type].toLowerCase()}, running live`} />
      <span key={`e${step}`} className="livefx__edge" />
      {caption?.(slide)}
    </figure>
  );
}
