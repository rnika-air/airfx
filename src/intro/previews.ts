import { FrameRenderer } from '../engine/FrameRenderer';
import { getEffect } from '../effects/registry';
import { defaultParams, type ParamValues } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';

/**
 * Media for the intro, the log-in screen and the About page.
 *
 * public/showcase/showcase.json lists two sets:
 *   media   photos, videos and GIFs for the live showcase (LiveFx), each with
 *           its own effect running on it live;
 *   stills  photos for the still tiles, each with its own effect, rendered by
 *           the real AirFx renderers in the background.
 * No picture is shown with two effects, and no effect is shown twice.
 * Without the list, the bundled CC0 sample photo is used.
 */

export interface ShowcaseItem { type: 'photo' | 'video' | 'gif'; src: string; focus?: [number, number]; zoom?: number; effect?: string }
/** A still tile: one photo with one effect. */
export interface StillItem { src: string; effect: string; focus?: [number, number]; zoom?: number; params?: ParamValues; frames?: number }
export interface Preview { id: string; name: string; url: string; media: ShowcaseItem['type'] }

const BASE = '/showcase/';
const SAMPLE: ShowcaseItem = { type: 'photo', src: '/samples/portrait.jpg', focus: [0.5, 0.35] };
/** Used only when showcase.json is missing: the sample photo with a few effects. */
const FALLBACK_STILLS: StillItem[] = ['pixelCrusher', 'moire', 'halftone', 'ascii'].map((effect) => ({ src: SAMPLE.src, effect, focus: SAMPLE.focus }));

/* ── The media list ── */

let media: ShowcaseItem[] = [];
let stills: StillItem[] = [];
let mediaStarted = false;
const mediaListeners = new Set<() => void>();
let mediaReady: Promise<ShowcaseItem[]> | null = null;
const at = (src: string) => (/^(\/|https?:)/.test(src) ? src : BASE + src);

function loadMedia() {
  if (mediaReady) return mediaReady;
  mediaStarted = true;
  mediaReady = fetch(`${BASE}showcase.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { media?: ShowcaseItem[]; stills?: StillItem[] }) => {
      stills = (j.stills ?? [])
        .filter((s) => s && typeof s.src === 'string' && typeof s.effect === 'string')
        .map((s) => ({ ...s, src: at(s.src) }));
      return (j.media ?? [])
        .filter((m) => m && (m.type === 'photo' || m.type === 'video' || m.type === 'gif') && typeof m.src === 'string')
        .map((m) => ({ ...m, src: at(m.src) }));
    })
    .catch(() => [] as ShowcaseItem[])
    .then((list) => {
      media = list.length ? list : [SAMPLE];
      if (!stills.length) stills = FALLBACK_STILLS;
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

const W = 360, H = 450;
const done: Preview[] = [];
const listeners = new Set<() => void>();
let started = false;
let snapshot: Preview[] = [];
function emit() { snapshot = [...done]; listeners.forEach((f) => f()); }

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function frame(item: { src: string; focus?: [number, number]; zoom?: number }): Promise<HTMLCanvasElement | null> {
  const img = await loadImage(item.src);
  if (!img || !img.naturalWidth) return null;
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
  await loadMedia();
  const renderer = new FrameRenderer();
  for (const s of stills) {
    const e = getEffect(s.effect);
    if (!e) continue;
    try {
      const src = await frame(s);
      if (!src) continue;
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
