import type { EffectDefinition, ParamDef, ParamValues, StackItem } from '../effects/types';
import { parseIds } from '../effects/types';
import { assetStore } from '../engine/assets';
import { createCanvas, get2d, hexToRgb } from '../utils/imageProcessing';
import { BUILTIN_FONTS, ensureFont, fontMissing } from './fonts';

/**
 * The universal content system. One parameter block and one stamper shared by
 * every compatible effect: an effect decides where things go and how big, and
 * this decides what is drawn there. Because it is plain parameters, presets,
 * undo, projects and the Timeline inspector all work without extra code.
 */

export const ICONS: Record<string, [string, string]> = {
  star: ['Star', 'M50 4l14 31 34 4-25 23 7 34-30-17-30 17 7-34L2 39l34-4z'],
  heart: ['Heart', 'M50 90C20 66 4 50 4 30 4 15 16 6 28 6c9 0 17 5 22 14C55 11 63 6 72 6c12 0 24 9 24 24 0 20-16 36-46 60z'],
  bolt: ['Bolt', 'M58 2L14 56h28l-8 42 48-58H52z'],
  drop: ['Drop', 'M50 4c18 26 34 42 34 60a34 34 0 0 1-68 0C16 46 32 30 50 4z'],
  eye: ['Eye', 'M50 22C26 22 8 40 2 50c6 10 24 28 48 28s42-18 48-28c-6-10-24-28-48-28zm0 46a18 18 0 1 1 0-36 18 18 0 0 1 0 36z'],
  smile: ['Smile', 'M50 4a46 46 0 1 0 0 92 46 46 0 0 0 0-92zM32 30a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm36 0a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM50 80c-14 0-25-9-28-21h56c-3 12-14 21-28 21z'],
  flower: ['Flower', 'M50 36a18 18 0 1 1 13-30c4 15-1 22-13 30zm0 0c12-8 19-13 33-6a18 18 0 1 1-20 27c-6-8-9-13-13-21zm0 0c4 8 5 17-3 29a18 18 0 1 1-24-23c10-6 18-6 27-6zm0 0c-9 0-17 0-27 6a18 18 0 1 1-6-33c13-4 23 19 33 27z'],
  sparkle: ['Sparkle', 'M50 0c5 30 15 40 50 50-35 10-45 20-50 50-5-30-15-40-50-50 35-10 45-20 50-50z'],
  arrow: ['Arrow', 'M50 4l44 44H66v48H34V48H6z'],
  cross: ['Cross', 'M36 4h28v32h32v28H64v32H36V64H4V36h32z'],
  hex: ['Hexagon', 'M50 2l42 24v48L50 98 8 74V26z'],
  ring: ['Ring', 'M50 2a48 48 0 1 0 0 96 48 48 0 0 0 0-96zm0 22a26 26 0 1 1 0 52 26 26 0 0 1 0-52z'],
  moon: ['Moon', 'M62 2a48 48 0 1 0 36 66A40 40 0 0 1 62 2z'],
  flame: ['Flame', 'M52 2c6 22 34 34 34 62 0 19-16 34-36 34S14 83 14 64c0-16 10-24 18-34 2 10 6 14 12 16C42 30 44 14 52 2z'],
  note: ['Music Note', 'M84 4v66a16 16 0 1 1-10-15V26L38 34v48a16 16 0 1 1-10-15V14z'],
  globe: ['Globe', 'M50 2a48 48 0 1 0 0 96 48 48 0 0 0 0-96zm0 8c7 0 14 15 15 34H35c1-19 8-34 15-34zM26 44H11C13 28 23 16 37 12c-6 8-10 19-11 32zm9 12h30c-1 19-8 34-15 34s-14-15-15-34zm39 0h15c-2 16-12 28-26 32 6-8 10-19 11-32zm0-12c-1-13-5-24-11-32 14 4 24 16 26 32zM11 56h15c1 13 5 24 11 32-14-4-24-16-26-32z'],
};

const on = (v: ParamValues) => v.cMode !== 'default';
const isText = (v: ParamValues) => v.cMode === 'text' || v.cMode === 'typography';
const isType = (v: ParamValues) => v.cMode === 'typography';
const isAsset = (v: ParamValues) => v.cMode === 'svg' || v.cMode === 'png' || v.cMode === 'image';
const G = 'Custom Content', GT = 'Typography', GS = 'Content Style', GX = 'Content Transform';

const select = (key: string, label: string, def: string, options: [string, string][], group: string, visibleWhen?: (v: ParamValues) => boolean): ParamDef =>
  ({ key, label, type: 'select', default: def, group, visibleWhen, options: options.map(([value, l]) => ({ value, label: l })) });
const range = (key: string, label: string, min: number, max: number, step: number, def: number, group: string, visibleWhen: (v: ParamValues) => boolean, unit?: string): ParamDef =>
  ({ key, label, type: 'range', min, max, step, default: def, group, visibleWhen, unit });
const color = (key: string, label: string, def: string, group: string, visibleWhen: (v: ParamValues) => boolean): ParamDef => ({ key, label, type: 'color', default: def, group, visibleWhen });

export const CONTENT_PARAMS: ParamDef[] = [
  select('cMode', 'Content', 'default', [['default', 'Default Shape'], ['text', 'Custom Text'], ['typography', 'Custom Typography'], ['icon', 'Built-in Icon'], ['svg', 'Uploaded SVG'], ['png', 'Uploaded PNG'], ['image', 'Uploaded Image'], ['vector', 'Custom Vector Shape']], G),
  { key: 'cText', label: 'Text', type: 'text', default: 'AIRFX', maxLength: 500, multiline: true, group: G, visibleWhen: isText },
  select('cSplit', 'Elements', 'words', [['words', 'Each Word'], ['letters', 'Each Letter'], ['lines', 'Each Line'], ['block', 'Whole Text']], G, isText),
  select('cCase', 'Case', 'none', [['none', 'As Typed'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']], G, isText),
  select('cIcon', 'Icon', 'star', Object.entries(ICONS).map(([k, [l]]) => [k, l]), G, (v) => v.cMode === 'icon'),
  { key: 'cAssets', label: 'Files', type: 'images', default: '', max: 12, group: G, visibleWhen: isAsset },
  range('cSides', 'Points', 3, 24, 1, 5, G, (v) => v.cMode === 'vector'),
  range('cInner', 'Inner Radius', 0.1, 1, 0.01, 0.5, G, (v) => v.cMode === 'vector'),
  { key: 'cPath', label: 'SVG Path (0 to 100)', type: 'text', default: '', maxLength: 2000, multiline: true, group: G, hint: 'Optional. A path "d" string on a 100 × 100 box. It replaces the points above.', visibleWhen: (v) => v.cMode === 'vector' },
  select('cOrder', 'Element Order', 'sequence', [['sequence', 'In Sequence'], ['random', 'Random']], G, on),

  { key: 'cFont', label: 'Font', type: 'custom', editor: 'font', default: BUILTIN_FONTS[1][0], group: GT, visibleWhen: isType },
  range('cWeight', 'Weight', 100, 900, 100, 800, GT, isType),
  range('cLetter', 'Letter Spacing', -0.1, 1, 0.01, 0, GT, isType, 'em'),
  range('cLine', 'Line Spacing', 0.7, 2.5, 0.01, 1.1, GT, (v) => isType(v) && v.cSplit === 'block'),
  select('cAlign', 'Alignment', 'center', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], GT, (v) => isType(v) && v.cSplit === 'block'),
  range('cWrap', 'Wrap After Letters', 0, 60, 1, 0, GT, (v) => isType(v) && v.cSplit === 'block'),

  select('cColor', 'Color', 'effect', [['effect', 'Follow Effect'], ['fill', 'Fixed Fill']], GS, on),
  color('cFill', 'Fill', '#c6ff2e', GS, (v) => on(v) && v.cColor === 'fill'),
  { key: 'cFilled', label: 'Fill Shape', type: 'toggle', default: true, group: GS, visibleWhen: (v) => on(v) && !isAsset(v) },
  range('cStroke', 'Outline', 0, 30, 0.5, 0, GS, (v) => on(v) && !isAsset(v), '%'),
  color('cStrokeColor', 'Outline Color', '#0b0c0b', GS, (v) => on(v) && !isAsset(v) && (v.cStroke as number) > 0),
  select('cLook', 'Treatment', 'original', [['original', 'Original Colors'], ['tint', 'Tint'], ['mono', 'Monochrome'], ['silhouette', 'Silhouette'], ['outline', 'Outline']], GS, isAsset),
  range('cBright', 'Brightness', 0, 2, 0.01, 1, GS, isAsset),
  range('cContrast', 'Contrast', 0, 3, 0.01, 1, GS, isAsset),

  range('cScale', 'Scale', 0.1, 6, 0.01, 1, GX, on, '×'),
  range('cWidth', 'Width', 0.2, 3, 0.01, 1, GX, on, '×'),
  range('cHeight', 'Height', 0.2, 3, 0.01, 1, GX, on, '×'),
  range('cRotate', 'Rotation', -180, 180, 1, 0, GX, on, '°'),
  range('cRotRand', 'Random Rotation', 0, 180, 1, 0, GX, on, '°'),
  range('cOpacity', 'Opacity', 0, 1, 0.01, 1, GX, on),
  range('cOffX', 'Offset X', -200, 200, 1, 0, GX, on),
  range('cOffY', 'Offset Y', -200, 200, 1, 0, GX, on),
  select('cBlend', 'Blend', 'source-over', [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['lighter', 'Add'], ['overlay', 'Overlay'], ['difference', 'Difference']], GX, on),
];

export const LAYOUT_PARAMS: ParamDef[] = [
  select('cLayout', 'Distribution', 'random', [['random', 'Random'], ['grid', 'Grid'], ['circle', 'Circular'], ['radial', 'Radial']], 'Distribution'),
];

export const CONTENT_PRESETS: { name: string; values: ParamValues }[] = [
  { name: 'Poster Type', values: { cMode: 'typography', cFont: '"Arial Black", Impact, sans-serif', cWeight: 900, cCase: 'upper', cLetter: -0.02 } },
  { name: 'Editorial Serif', values: { cMode: 'typography', cFont: 'Georgia, serif', cWeight: 400, cCase: 'lower', cLetter: 0 } },
  { name: 'Terminal', values: { cMode: 'typography', cFont: 'Consolas, monospace', cWeight: 400, cCase: 'upper', cLetter: 0.08 } },
  { name: 'Wide Outline', values: { cMode: 'typography', cFont: 'Verdana, Geneva, sans-serif', cWeight: 700, cCase: 'upper', cLetter: 0.25, cFilled: false, cStroke: 6, cStrokeColor: '#c6ff2e' } },
];

/** Adds the content block to an effect. Its default look is unchanged. */
export function withContent(effect: EffectDefinition, options: { layout?: boolean; extra?: ParamDef[] } = {}): EffectDefinition {
  return { ...effect, supportsContent: true, params: [...effect.params, ...(options.layout ? LAYOUT_PARAMS : []), ...CONTENT_PARAMS, ...(options.extra ?? [])] };
}

/* ── Elements ───────────────────────────────────────────────────── */

type Elem = { kind: 'text'; text: string } | { kind: 'path'; path: Path2D } | { kind: 'asset'; el: CanvasImageSource; w: number; h: number; id: string };

function wrapText(text: string, limit: number) {
  if (limit <= 0) return text.split('\n');
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    let line = '';
    for (const word of raw.split(/\s+/)) {
      if (line && line.length + word.length + 1 > limit) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines;
}

function elementsOf(p: ParamValues): Elem[] {
  const mode = p.cMode as string;
  if (mode === 'text' || mode === 'typography') {
    let text = (p.cText as string) || 'AIRFX';
    if (p.cCase === 'upper') text = text.toUpperCase();
    if (p.cCase === 'lower') text = text.toLowerCase();
    const split = p.cSplit as string;
    // Segmenter keeps emoji and accented letters whole.
    const letters = () => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment).filter((s) => s.trim());
    const parts = split === 'letters' ? letters() : split === 'lines' ? text.split('\n').filter((s) => s.trim()) : split === 'block' ? [text] : text.split(/\s+/).filter(Boolean);
    return (parts.length ? parts : ['AIRFX']).map((t) => ({ kind: 'text', text: t }));
  }
  if (mode === 'icon') return [{ kind: 'path', path: new Path2D(ICONS[p.cIcon as string]?.[1] ?? ICONS.star[1]) }];
  if (mode === 'vector') {
    const d = (p.cPath as string).trim();
    if (d) { const path = new Path2D(d); return [{ kind: 'path', path }]; }
    const n = p.cSides as number, inner = p.cInner as number, path = new Path2D();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? 48 * inner : 48, a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, x = 50 + Math.cos(a) * r, y = 50 + Math.sin(a) * r;
      if (i) path.lineTo(x, y); else path.moveTo(x, y);
    }
    path.closePath();
    return [{ kind: 'path', path }];
  }
  const out: Elem[] = [];
  for (const id of parseIds(p.cAssets)) {
    const a = assetStore.get(id);
    if (a) out.push({ kind: 'asset', el: a.el, w: a.width, h: a.height, id });
  }
  return out;
}

/* ── Stamping ───────────────────────────────────────────────────── */

const fontOf = (p: ParamValues, px: number) => `${p.cMode === 'typography' ? p.cWeight : 700} ${px}px ${p.cMode === 'typography' ? p.cFont : BUILTIN_FONTS[0][0]}`;

export class Stamper {
  private sprites = new Map<string, HTMLCanvasElement>();
  private spritePixels = 0;
  private rot: number; private spread: number; private w: number; private h: number; private op: number; private ox: number; private oy: number;
  private order: boolean; private fixed: number[] | null; private blend: string; private scale: number;
  private measure = get2d(createCanvas(4, 4));

  constructor(private p: ParamValues, public elems: Elem[], unit: number) {
    this.rot = ((p.cRotate as number) * Math.PI) / 180;
    this.spread = ((p.cRotRand as number) * Math.PI) / 180;
    this.scale = p.cScale as number;
    this.w = p.cWidth as number; this.h = p.cHeight as number;
    this.op = p.cOpacity as number;
    this.ox = (p.cOffX as number) * unit; this.oy = (p.cOffY as number) * unit;
    this.order = p.cOrder === 'random';
    this.fixed = p.cColor === 'fill' ? hexToRgb(p.cFill as string) : null;
    this.blend = p.cBlend as string;
  }

  private textLines(e: Elem & { kind: 'text' }) {
    return this.p.cSplit === 'block' && this.p.cMode === 'typography' ? wrapText(e.text, this.p.cWrap as number) : [e.text];
  }

  /** Renders one element at a size bucket, so large stamps are sharp and small ones are cheap. */
  private sprite(index: number, px: number, rgb: number[]): HTMLCanvasElement {
    const e = this.elems[index];
    const look = e.kind === 'asset' ? (this.p.cLook as string) : 'tint';
    const keepColors = e.kind === 'asset' && (look === 'original' || look === 'mono');
    // Small stamps need few colours: nobody sees 8 levels per channel at 20 px, and
    // one sprite per exact colour would rebuild thousands of them on every frame.
    const q = px <= 64 ? 5 : 3, low = (1 << q) - 1;
    const c = keepColors ? 0 : ((rgb[0] >> q) << 10) | ((rgb[1] >> q) << 5) | (rgb[2] >> q);
    const key = `${index}|${px}|${c}`;
    let s = this.sprites.get(key);
    if (s) return s;
    if (this.spritePixels > 80e6) { this.sprites.clear(); this.spritePixels = 0; }
    const fill = `rgb(${rgb[0] | (low >> 1)},${rgb[1] | (low >> 1)},${rgb[2] | (low >> 1)})`;
    const p = this.p;
    if (e.kind === 'text') {
      const m = this.measure;
      m.font = fontOf(p, px);
      const spacing = p.cMode === 'typography' ? (p.cLetter as number) * px : 0;
      (m as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
      const lines = this.textLines(e), lh = px * (p.cMode === 'typography' ? (p.cLine as number) : 1.1);
      const widths = lines.map((l) => m.measureText(l).width), bw = Math.max(...widths), pad = Math.ceil(px * 0.25 + ((p.cStroke as number) / 100) * px);
      s = createCanvas(Math.ceil(bw + pad * 2), Math.ceil(lh * lines.length + pad * 2));
      const g = get2d(s);
      g.font = m.font;
      (g as unknown as { letterSpacing: string }).letterSpacing = `${spacing}px`;
      g.textBaseline = 'middle';
      g.lineJoin = 'round';
      lines.forEach((l, i) => {
        const x = pad + (p.cAlign === 'right' && p.cSplit === 'block' ? bw - widths[i] : p.cAlign === 'left' || p.cSplit !== 'block' ? (p.cSplit === 'block' ? 0 : (bw - widths[i]) / 2) : (bw - widths[i]) / 2), y = pad + lh * (i + 0.5);
        if (p.cFilled) { g.fillStyle = fill; g.fillText(l, x, y); }
        if ((p.cStroke as number) > 0) { g.strokeStyle = p.cStrokeColor as string; g.lineWidth = ((p.cStroke as number) / 100) * px; g.strokeText(l, x, y); }
      });
    } else if (e.kind === 'path') {
      s = createCanvas(px, px);
      const g = get2d(s), k = px / 100, inset = Math.min(0.2, (p.cStroke as number) / 200);
      g.translate(px * inset, px * inset);
      g.scale(k * (1 - inset * 2), k * (1 - inset * 2));
      g.lineJoin = 'round';
      if (p.cFilled) { g.fillStyle = fill; g.fill(e.path); }
      if ((p.cStroke as number) > 0) { g.strokeStyle = p.cStrokeColor as string; g.lineWidth = p.cStroke as number; g.stroke(e.path); }
    } else {
      const aspect = e.w / e.h, w = Math.max(1, Math.round(aspect >= 1 ? px : px * aspect)), h = Math.max(1, Math.round(aspect >= 1 ? px / aspect : px));
      s = createCanvas(w, h);
      const g = get2d(s);
      g.imageSmoothingQuality = 'high';
      const f = `brightness(${p.cBright}) contrast(${p.cContrast})${look === 'mono' ? ' grayscale(1)' : ''}`;
      if (f !== 'brightness(1) contrast(1)') g.filter = f;
      g.drawImage(e.el, 0, 0, w, h);
      g.filter = 'none';
      if (look === 'tint') {
        g.globalCompositeOperation = 'color';
        g.fillStyle = fill;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(e.el, 0, 0, w, h);
      } else if (look === 'silhouette') {
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = fill;
        g.fillRect(0, 0, w, h);
      } else if (look === 'outline') {
        const t = createCanvas(w, h), q = get2d(t), d = Math.max(1, Math.round(px * 0.03));
        for (let a = 0; a < 8; a++) q.drawImage(e.el, Math.cos(a * 0.785) * d, Math.sin(a * 0.785) * d, w, h);
        q.globalCompositeOperation = 'source-in';
        q.fillStyle = fill;
        q.fillRect(0, 0, w, h);
        q.globalCompositeOperation = 'destination-out';
        q.drawImage(e.el, 0, 0, w, h);
        s.width = w;
        get2d(s).drawImage(t, 0, 0);
      }
    }
    this.sprites.set(key, s);
    this.spritePixels += s.width * s.height;
    return s;
  }

  begin(ctx: CanvasRenderingContext2D) {
    if (this.blend !== 'source-over') ctx.globalCompositeOperation = this.blend as GlobalCompositeOperation;
  }

  /** Draws element i centred at x, y, `size` px tall. */
  stamp(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, size: number, rgb: number[], angle = 0, alpha = 1) {
    const n = this.elems.length;
    if (!n) return;
    const index = this.order ? Math.abs((i * 2654435761) >>> 0) % n : i % n;
    const s = size * this.scale;
    if (s < 0.3) return;
    // Half-octave size steps: never scaled up by more than 1.4×, never more than 1.4× too big.
    const bucket = Math.min(2048, Math.max(12, Math.round(2 ** (Math.ceil(Math.log2(s) * 2) / 2))));
    const sp = this.sprite(index, bucket, this.fixed ?? rgb), k = s / bucket;
    const a = angle + this.rot + (this.spread ? ((Math.sin(i * 12.9898) * 43758.5453) % 1) * this.spread : 0);
    const cos = Math.cos(a), sin = Math.sin(a), w = sp.width * k, h = sp.height * k;
    ctx.globalAlpha = alpha * this.op;
    ctx.setTransform(cos * this.w, sin * this.w, -sin * this.h, cos * this.h, x + this.ox, y + this.oy);
    ctx.drawImage(sp, -w / 2, -h / 2, w, h);
  }

  end(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

/* One stamper per content setup and size, so sprites survive between frames. */
const pool = new Map<string, Stamper>();

/** The stamper for these params, or null when the effect should draw its own shape. */
export function contentOf(p: ParamValues, unit: number): Stamper | null {
  if (!p.cMode || p.cMode === 'default') return null;
  const key = JSON.stringify([CONTENT_PARAMS.map((d) => p[d.key]), unit]);
  let s = pool.get(key);
  if (s) return s;
  const elems = elementsOf(p);
  if (!elems.length) return null;
  if (pool.size > 12) pool.clear();
  s = new Stamper(p, elems, unit);
  pool.set(key, s);
  return s;
}

/** Positions for a chosen distribution, inside w × h. */
export function layoutPoints(layout: string, n: number, w: number, h: number) {
  const pts: [number, number][] = [];
  if (layout === 'grid') {
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h))), rows = Math.max(1, Math.ceil(n / cols));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push([((c + 0.5) / cols) * w, ((r + 0.5) / rows) * h]);
  } else if (layout === 'circle') {
    const R = Math.min(w, h) * 0.42;
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([w / 2 + Math.cos(a) * R, h / 2 + Math.sin(a) * R]); }
  } else {
    // Sunflower spiral: even radial coverage from the centre out.
    const R = Math.hypot(w, h) / 2;
    for (let i = 0; i < n; i++) { const r = Math.sqrt((i + 0.5) / n) * R, a = i * 2.39996; pts.push([w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r]); }
  }
  return pts;
}

/** Waits for fonts in a stack, so the first exported frame is right. */
export async function ensureContentReady(items: StackItem[]) {
  await Promise.all(items.flatMap((i) => [
    ...(i.params.cMode === 'typography' ? [ensureFont(i.params.cFont as string, i.params.cWeight as number)] : []),
    // Effects with their own type setting, in each weight they might use.
    ...(typeof i.params.font === 'string' ? [100, 400, 700, 900].map((w) => ensureFont(i.params.font as string, w)) : []),
  ]));
}

/** Plain-language warnings for the panel. */
export function contentWarning(p: ParamValues) {
  if (p.cMode === 'typography' && fontMissing(p.cFont as string)) return 'This uploaded font is not loaded, so a fallback is used. Load the font file again.';
  if ((p.cMode === 'svg' || p.cMode === 'png' || p.cMode === 'image') && !elementsOf(p).length) return 'Add a file below. Until then the effect uses its default shape.';
  if (p.cMode === 'vector' && (p.cPath as string).trim() && !/^[\s\dMmLlHhVvCcSsQqTtAaZz.,+-eE]+$/.test(p.cPath as string)) return 'That path has characters SVG paths do not use, so it may not draw.';
  return null;
}
