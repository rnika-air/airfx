import type { ParamValues } from '../effects/types';
import type { Asset } from '../engine/assets';
import { createCanvas, createRng, get2d, valueNoise } from '../utils/imageProcessing';
import { FONT_STACKS, type Composition } from './model';

/* All drawing happens in composition pixels, centred on (0, 0). */

const measure = get2d(createCanvas(4, 4));
type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };

/* ───────────────────────── text ───────────────────────── */

function fontOf(p: ParamValues) {
  return `${p.italic ? 'italic ' : ''}${p.weight} ${p.size}px ${FONT_STACKS[p.font as string] ?? FONT_STACKS.sans}`;
}

export function textLayout(p: ParamValues) {
  const raw = String(p.text ?? '');
  const text = p.upper ? raw.toUpperCase() : raw;
  const lines = text.split('\n');
  const m = measure as Ctx;
  m.font = fontOf(p);
  if ('letterSpacing' in m) m.letterSpacing = `${(p.tracking as number) * (p.size as number)}px`;
  const width = Math.max(1, ...lines.map((l) => m.measureText(l).width));
  const lineH = (p.size as number) * (p.leading as number);
  return { lines, width, height: lineH * lines.length, lineH };
}

export function textBounds(p: ParamValues) {
  const { width, height } = textLayout(p);
  const pad = p.boxOn ? (p.boxPad as number) : 0;
  return { w: width + pad * 2, h: height + pad * 2 };
}

export function drawText(c: CanvasRenderingContext2D, p: ParamValues, reveal: number, typewriter: boolean) {
  const ctx = c as Ctx;
  const { lines, width, height, lineH } = textLayout(p);
  if (p.boxOn) {
    const pad = p.boxPad as number;
    ctx.fillStyle = p.boxColor as string;
    ctx.beginPath();
    ctx.roundRect(-width / 2 - pad, -height / 2 - pad, width + pad * 2, height + pad * 2, Math.min(8, pad / 2));
    ctx.fill();
  }
  ctx.font = fontOf(p);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(p.tracking as number) * (p.size as number)}px`;
  ctx.textBaseline = 'middle';
  const align = p.align as CanvasTextAlign;
  ctx.textAlign = align;
  const ax = align === 'left' ? -width / 2 : align === 'right' ? width / 2 : 0;
  const shadow = p.shadow as number;
  if (shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${0.6 * shadow})`;
    ctx.shadowBlur = 40 * shadow;
    ctx.shadowOffsetY = 12 * shadow;
  }
  let budget = typewriter ? Math.floor(reveal * lines.reduce((s, l) => s + l.length, 0)) : Infinity;
  const stroke = p.stroke as number;
  lines.forEach((line, i) => {
    if (budget <= 0) return;
    const shown = budget === Infinity ? line : line.slice(0, budget);
    budget -= line.length;
    const y = -height / 2 + lineH * (i + 0.5);
    if (stroke > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke * 2;
      ctx.strokeStyle = p.strokeColor as string;
      ctx.strokeText(shown, ax, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = p.color as string;
    ctx.fillText(shown, ax, y);
  });
}

/* ───────────────────────── shapes ───────────────────────── */

type Pt = [number, number];

function polygon(n: number, rx: number, ry: number, inner = 1): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = inner !== 1 && i % 2 ? inner : 1;
    pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
  }
  return pts;
}

/** Densify a path so hand-drawn wobble looks smooth rather than faceted. */
function densify(pts: Pt[], closed: boolean, step: number): Pt[] {
  const out: Pt[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}

function wobble(pts: Pt[], amount: number, seed: number, freq: number): Pt[] {
  if (amount <= 0) return pts;
  return pts.map(([x, y], i) => [
    x + (valueNoise(i * freq, 0.5, seed) - 0.5) * amount,
    y + (valueNoise(i * freq, 7.5, seed + 3) - 0.5) * amount,
  ]);
}

function pathLength(pts: Pt[], closed: boolean) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) len += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return len;
}

function shapeGeometry(p: ParamValues, seed: number): { paths: Pt[][]; closed: boolean } {
  const w = p.w as number, h = p.h as number;
  const rx = w / 2, ry = h / 2;
  const rng = createRng(seed);
  switch (p.shape as string) {
    case 'ellipse':
      return { paths: [polygon(72, rx, ry)], closed: true };
    case 'star':
      return { paths: [polygon((p.points as number) * 2, rx, ry, 0.45)], closed: true };
    case 'burst':
      return { paths: [polygon((p.points as number) * 4, rx, ry, 0.78)], closed: true };
    case 'line':
      return { paths: [[[-rx, 0], [rx, 0]]], closed: false };
    case 'arrow': {
      const head = Math.min(w * 0.25, Math.max(h * 1.4, (p.strokeWidth as number) * 4));
      return { paths: [[[-rx, 0], [rx, 0]], [[rx - head, -head * 0.6], [rx, 0], [rx - head, head * 0.6]]], closed: false };
    }
    case 'underline': {
      const pts: Pt[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push([-rx + w * t, Math.sin(t * Math.PI * 2.5 + rng()) * ry * 0.35 + (t - 0.5) * ry * 0.4]);
      }
      return { paths: [pts], closed: false };
    }
    case 'scribbleCircle': {
      const pts: Pt[] = [];
      const turns = 2.15;
      const start = rng() * Math.PI * 2;
      for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const a = start + t * turns * Math.PI * 2;
        const r = 1 + (rng() - 0.5) * 0.04 + Math.sin(t * 9) * 0.03 - t * 0.06;
        pts.push([Math.cos(a) * rx * r, Math.sin(a) * ry * r]);
      }
      return { paths: [pts], closed: false };
    }
    case 'scribble': {
      const rows = Math.max(3, Math.round(h / ((p.strokeWidth as number) * 1.8)));
      const pts: Pt[] = [];
      for (let i = 0; i <= rows; i++) {
        const y = -ry + (h * i) / rows;
        const jx = (rng() - 0.5) * w * 0.08;
        pts.push(i % 2 ? [rx + jx, y] : [-rx + jx, y]);
      }
      return { paths: [pts], closed: false };
    }
    default: {
      if ((p.radius as number) > 0 && !(p.rough as number)) return { paths: [], closed: true }; // drawn with roundRect
      return { paths: [[[-rx, -ry], [rx, -ry], [rx, ry], [-rx, ry]]], closed: true };
    }
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, p: ParamValues, reveal: number, boilStep: number) {
  const seed = (p.seed as number) + boilStep * 101;
  const rough = p.rough as number;
  const { paths, closed } = shapeGeometry(p, p.seed as number);
  const amt = rough * Math.min(p.w as number, p.h as number, 400) * 0.08 + rough * 6;
  const fill = p.fillOn && closed;
  const stroke = p.strokeOn || !closed;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = p.strokeWidth as number;
  ctx.strokeStyle = (p.strokeOn ? p.strokeColor : p.fill) as string;
  ctx.fillStyle = p.fill as string;

  if (!paths.length) {
    // smooth rounded box
    const w = p.w as number, h = p.h as number;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, p.radius as number);
    if (fill) ctx.fill();
    if (p.strokeOn) ctx.stroke();
    return;
  }

  const passes = rough > 0 && stroke ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    const shaped = paths.map((pts) => wobble(densify(pts, closed, 12), amt * (pass ? 0.7 : 1), seed + pass * 17, 0.18));
    const total = shaped.reduce((s, pts) => s + pathLength(pts, closed), 0);
    ctx.beginPath();
    for (const pts of shaped) {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      if (closed) ctx.closePath();
    }
    if (fill && pass === 0) ctx.fill();
    if (stroke) {
      // Wipe / typewriter on a stroke = draw-on animation.
      if (reveal < 1) ctx.setLineDash([total * reveal, total + 1]);
      ctx.globalAlpha *= pass ? 0.55 : 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** Open strokes animate "draw-on" themselves; everything else uses a wipe clip. */
export function shapeHandlesReveal(p: ParamValues) {
  return ['line', 'arrow', 'underline', 'scribbleCircle', 'scribble'].includes(p.shape as string) || (!p.fillOn && !!p.strokeOn);
}

/* ───────────────────────── media ───────────────────────── */

export function mediaSize(asset: Pick<Asset, 'width' | 'height'>, fit: string, comp: Pick<Composition, 'width' | 'height'>) {
  if (fit === 'original') return { w: asset.width, h: asset.height };
  const s = fit === 'cover' ? Math.max(comp.width / asset.width, comp.height / asset.height) : Math.min(comp.width / asset.width, comp.height / asset.height);
  return { w: asset.width * s, h: asset.height * s };
}

const outlineCache = new Map<string, HTMLCanvasElement>();

/** Silhouette-dilation outline: works on transparent PNG cut-outs (sticker look). */
function outlined(img: CanvasImageSource, key: string | null, w: number, h: number, o: number, color: string): HTMLCanvasElement {
  const ck = key ? `${key}|${w | 0}|${h | 0}|${o}|${color}` : null;
  if (ck && outlineCache.has(ck)) return outlineCache.get(ck)!;
  // Work at a capped resolution; outlines don't need full detail.
  const s = Math.min(1, 1600 / Math.max(w, h));
  const W = Math.ceil((w + o * 2) * s), H = Math.ceil((h + o * 2) * s);
  const sil = createCanvas(W, H);
  const sg = get2d(sil);
  sg.drawImage(img, o * s, o * s, w * s, h * s);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = color;
  sg.fillRect(0, 0, W, H);
  const out = createCanvas(W, H);
  const og = get2d(out);
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    og.drawImage(sil, Math.cos(a) * o * s, Math.sin(a) * o * s);
  }
  og.drawImage(img, o * s, o * s, w * s, h * s);
  if (ck) {
    if (outlineCache.size > 24) outlineCache.delete(outlineCache.keys().next().value!);
    outlineCache.set(ck, out);
  }
  return out;
}

export function drawMedia(ctx: CanvasRenderingContext2D, img: CanvasImageSource, assetKey: string | null, w: number, h: number, p: ParamValues) {
  const shadow = p.shadow as number;
  if (shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${0.55 * shadow})`;
    ctx.shadowBlur = 50 * shadow;
    ctx.shadowOffsetY = 18 * shadow;
  }
  const corner = p.corner as number;
  const o = p.outline as number;
  if (corner > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, corner);
    ctx.clip();
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  } else if (o > 0) {
    const c = outlined(img, assetKey, w, h, o, p.outlineColor as string);
    ctx.drawImage(c, -w / 2 - o, -h / 2 - o, w + o * 2, h + o * 2);
  } else {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }
}
