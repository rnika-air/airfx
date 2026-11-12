/** Shared helpers for the card-based animate effects (Slide, Stack). */
import type { ParamDef, ParamValues } from './types';
import { parseIds } from './types';
import { assetStore } from '../engine/assets';

export type Ease = 'linear' | 'smooth' | 'snappy' | 'back';

/** Texture parameters shared by Slide and Stack. */
export const TEXTURE_PARAMS: ParamDef[] = [
  {
    key: 'texture', label: 'Card Content', type: 'select', group: 'Content', default: 'tiles',
    options: [{ value: 'tiles', label: 'Image Tiles' }, { value: 'same', label: 'Same Image' }, { value: 'custom', label: 'My Images' }],
  },
  {
    key: 'cardImages', label: 'Card Images', type: 'images', group: 'Content', default: '', max: 24,
    hint: 'Images shown on the cards, in order. They repeat if there are more cards than images.',
    visibleWhen: (v) => v.texture === 'custom',
  },
  {
    key: 'includeMedia', label: 'Include Main Media', type: 'toggle', group: 'Content', default: true,
    visibleWhen: (v) => v.texture === 'custom',
  },
];

/**
 * Resolve the texture for each of `count` cards: tiles of the source, the
 * whole source, or the user's own images (optionally with the source first).
 */
export function cardTextures(params: ParamValues, src: CanvasImageSource, width: number, height: number, count: number): Tile[] {
  if (params.texture === 'custom') {
    const pool: Tile[] = [];
    if (params.includeMedia) pool.push({ img: src, sx: 0, sy: 0, sw: width, sh: height });
    for (const id of parseIds(params.cardImages)) {
      const a = assetStore.get(id);
      if (a && a.kind === 'image') pool.push({ img: a.el, sx: 0, sy: 0, sw: a.width, sh: a.height });
    }
    if (!pool.length) pool.push({ img: src, sx: 0, sy: 0, sw: width, sh: height });
    return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  }
  return tiles(width, height, count, params.texture === 'tiles').map((t) => ({ ...t, img: src }));
}

export const EASE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Curve' },
  { value: 'snappy', label: 'Snappy' },
  { value: 'back', label: 'Overshoot' },
];

export function ease(kind: string, t: number): number {
  switch (kind) {
    case 'smooth':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'snappy':
      return 1 - Math.pow(1 - t, 5);
    case 'back': {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    default:
      return t;
  }
}

export interface Tile {
  img?: CanvasImageSource;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Split the source into `count` tiles laid out on a near-square grid. */
export function tiles(width: number, height: number, count: number, split: boolean): Tile[] {
  if (!split) return Array.from({ length: count }, () => ({ sx: 0, sy: 0, sw: width, sh: height }));
  const cols = Math.ceil(Math.sqrt(count * (width / height)));
  const rows = Math.ceil(count / cols);
  const tw = width / cols, th = height / rows;
  return Array.from({ length: count }, (_, i) => ({ sx: (i % cols) * tw, sy: Math.floor(i / cols) * th, sw: tw, sh: th }));
}

export interface CardDraw {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  scaleX: number;
  scale: number;
  radius: number;
  /** 0 = no fog, 1 = fully background-coloured */
  fog: number;
  shadow: number;
}

/** Draw one card: rounded, clipped texture crop with optional shadow and depth fog. */
export function drawCard(ctx: CanvasRenderingContext2D, t: Tile, c: CardDraw, fogColor: string) {
  const img = t.img;
  if (!img) return;
  const w = c.w * c.scale * Math.max(0.02, Math.abs(c.scaleX)), h = c.h * c.scale;
  if (w < 1 || h < 1) return;
  const r = Math.min(c.radius * c.scale, w / 2, h / 2);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.rot);
  if (c.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${0.35 * c.shadow})`;
    ctx.shadowBlur = 24 * c.shadow * c.scale;
    ctx.shadowOffsetY = 10 * c.shadow * c.scale;
    ctx.fillStyle = fogColor;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, r);
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, r);
  ctx.clip();
  // cover-fit the tile into the card
  const ca = w / h, ta = t.sw / t.sh;
  let sx = t.sx, sy = t.sy, sw = t.sw, sh = t.sh;
  if (ta > ca) { sw = t.sh * ca; sx += (t.sw - sw) / 2; } else { sh = t.sw / ca; sy += (t.sh - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
  if (c.fog > 0) {
    ctx.globalAlpha = Math.min(1, c.fog);
    ctx.fillStyle = fogColor;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}
