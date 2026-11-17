import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams, type ParamValues } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';

/**
 * Media for the intro, the log-in screen and the About page.
 *
 * public/showcase/showcase.json lists the photos, videos and GIFs. The live
 * showcase (LiveFx) plays them all; the still tiles below are made by running
 * the real AirFx renderers on the photos, one effect at a time, in the
 * background. Without the list, the bundled CC0 sample photo is used.
 */

export interface ShowcaseItem { type: 'photo' | 'video' | 'gif'; src: string; focus?: [number, number]; zoom?: number }
export interface Preview { id: string; name: string; url: string; media: ShowcaseItem['type'] }

const BASE = '/showcase/';
const SAMPLE: ShowcaseItem = { type: 'photo', src: '/samples/portrait.jpg', focus: [0.5, 0.35] };

/* ── The media list ── */

let media: ShowcaseItem[] = [];
let mediaStarted = false;
const mediaListeners = new Set<() => void>();
let mediaReady: Promise<ShowcaseItem[]> | null = null;

function loadMedia() {
  if (mediaReady) return mediaReady;
  mediaStarted = true;
  mediaReady = fetch(`${BASE}showcase.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { media?: ShowcaseItem[] }) => (j.media ?? [])
      .filter((m) => m && (m.type === 'photo' || m.type === 'video' || m.type === 'gif') && typeof m.src === 'string')
      .map((m) => ({ ...m, src: /^(\/|https?:)/.test(m.src) ? m.src : BASE + m.src })))
    .catch(() => [] as ShowcaseItem[])
    .then((list) => {
      media = list.length ? list : [SAMPLE];
      mediaListeners.forEach((f) => f());
      return media;
    });
  return mediaReady;
}

export const showcase = {
  load: () => { if (!mediaStarted) void loadMedia(); },
  subscribe: (f: () => void) => { mediaListeners.add(f); return () => { mediaListeners.delete(f); }; },
  get: () => media,
};

/* ── Still tiles ── */

/** Effects shown on the photos, in order, with settings that read well at a small size. */
const STILLS: { id: string; params?: ParamValues; frames?: number }[] = [
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

async function frame(item: ShowcaseItem): Promise<HTMLCanvasElement | null> {
  const img = new Image();
  img.decoding = 'async';
  img.src = item.src;
  try { await img.decode(); } catch { return null; }
  // Cover-crop to 4:5 around the focus point.
  const c = createCanvas(W, H), g = get2d(c, true);
  const [fx, fy] = item.focus ?? [0.5, 0.5];
  const k = Math.max(W / img.naturalWidth, H / img.naturalHeight) * (item.zoom ?? 1);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  g.drawImage(img, Math.min(0, Math.max(W - w, W / 2 - fx * w)), Math.min(0, Math.max(H - h, H / 2 - fy * h)), w, h);
  return c;
}

async function run() {
  if (started) return;
  started = true;
  const photos = (await loadMedia()).filter((m) => m.type === 'photo');
  const sources = (await Promise.all((photos.length ? photos : [SAMPLE]).map(frame))).filter((c): c is HTMLCanvasElement => !!c);
  if (!sources.length) { const s = await frame(SAMPLE); if (s) sources.push(s); else return; }
  const renderer = new FrameRenderer();
  for (let n = 0; n < STILLS.length; n++) {
    const s = STILLS[n], e = getEffect(s.id);
    if (!e) continue;
    try {
      // Each effect on the next photo, so every photo appears.
      const src = sources[n % sources.length];
      const target = createCanvas(W, H);
      const layers = [{ effect: e, params: { ...defaultParams(e), ...s.params } }];
      const count = s.frames ?? (e.compat === 'video' ? 12 : 1);
      for (let f = 0; f < count; f++) renderer.render({ source: src, target, width: W, height: H, layers, time: 0.8 + f / 24, frame: f + 10 });
      const url = await new Promise<string>((r) => target.toBlob((b) => r(b ? URL.createObjectURL(b) : target.toDataURL()), 'image/jpeg', 0.86));
      done.push({ id: e.id, name: e.name, url, media: 'photo' });
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
  /** An untouched photo, for the fallback before/after. */
  get original() { return (media.find((m) => m.type === 'photo') ?? SAMPLE).src; },
};
