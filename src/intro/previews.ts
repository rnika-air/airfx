import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams, type ParamValues } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';

/**
 * Previews for the intro, the log-in screen and the About page: the real
 * AirFx renderers run on the showcase photo (public/showcase/photo.jpg, or the
 * bundled CC0 sample if it is missing), so what
 * a visitor sees is exactly what the effect does. Rendered once, in the
 * background, one effect at a time, and shared by every screen.
 */

export interface Preview { id: string; name: string; url: string }

/** Effects shown, in order, with settings that read well at a small size. */
const SHOWCASE: { id: string; params?: ParamValues; frames?: number }[] = [
  { id: 'glitch2' },
  { id: 'moire' },
  { id: 'pixelArt' },
  { id: 'inkBleed', frames: 16 },
  { id: 'dreamy' },
  { id: 'scatter' },
  { id: 'liquify' },
  { id: 'thermal' },
  { id: 'halftone' },
  { id: 'crayon' },
  { id: 'ascii' },
  { id: 'nightVision' },
];

const W = 360, H = 450;
const done: Preview[] = [];
const listeners = new Set<() => void>();
let started = false;
let snapshot: Preview[] = [];

function emit() { snapshot = [...done]; listeners.forEach((f) => f()); }

export const SHOWCASE_PHOTO = '/showcase/photo.jpg';
export const SHOWCASE_VIDEO = '/showcase/video.mp4';
export const SHOWCASE_GIF = '/showcase/animation.gif';
const SAMPLE = '/samples/portrait.jpg';
let original = SHOWCASE_PHOTO;

async function load(url: string) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

async function source(): Promise<HTMLCanvasElement> {
  let img: HTMLImageElement;
  try { img = await load(SHOWCASE_PHOTO); } catch { original = SAMPLE; img = await load(SAMPLE); }
  // Cover-crop to 4:5, zoomed in on the subject (the showcase photo has them small, in the middle).
  const c = createCanvas(W, H), g = get2d(c, true);
  const zoom = original === SHOWCASE_PHOTO ? 1.35 : 1, fx = 0.48, fy = original === SHOWCASE_PHOTO ? 0.6 : 0.35;
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  const x = Math.min(0, Math.max(W - w, W / 2 - fx * w)), y = Math.min(0, Math.max(H - h, H / 2 - fy * h));
  g.drawImage(img, x, y, w, h);
  return c;
}

async function run() {
  if (started) return;
  started = true;
  let src: HTMLCanvasElement;
  try { src = await source(); } catch { return; }
  const renderer = new FrameRenderer();
  for (const s of SHOWCASE) {
    const e = getEffect(s.id);
    if (!e) continue;
    try {
      const target = createCanvas(W, H);
      const layers = [{ effect: e, params: { ...defaultParams(e), ...s.params } }];
      const n = s.frames ?? (e.compat === 'video' ? 12 : 1);
      for (let f = 0; f < n; f++) renderer.render({ source: src, target, width: W, height: H, layers, time: 0.8 + f / 24, frame: f + 10 });
      const url = await new Promise<string>((r) => target.toBlob((b) => r(b ? URL.createObjectURL(b) : target.toDataURL()), 'image/jpeg', 0.86));
      done.push({ id: e.id, name: e.name, url });
      emit();
    } catch { /* one effect failing never stops the rest */ }
    // Leave the main thread free between effects, so the page stays smooth.
    await new Promise((r) => setTimeout(r, 30));
  }
  renderer.dispose();
}

export const previews = {
  start: () => { void run(); },
  subscribe: (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; },
  get: () => snapshot,
  /** The untouched photo, for a before/after. */
  get original() { return original; },
};
