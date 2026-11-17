import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams, type ParamValues } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';

/**
 * Previews for the intro, the log-in screen and the About page: the real
 * AirFx renderers run on a bundled sample photo (public/samples, CC0), so what
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

async function source(): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = '/samples/portrait.jpg';
  await img.decode();
  // Cover-crop to 4:5, a little above centre so the face stays in frame.
  const c = createCanvas(W, H), g = get2d(c, true);
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, (W - w) / 2, (H - h) * 0.35, w, h);
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
  /** The untouched sample, for a before/after. */
  original: '/samples/portrait.jpg',
};
