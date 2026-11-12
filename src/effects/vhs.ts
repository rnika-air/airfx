import type { EffectDefinition, ParamDef, ParamValues } from './types';
import { clamp255, hash2, hexToRgb, valueNoise } from '../utils/imageProcessing';

/**
 * VHS: a full tape-playback model plus an editable on-screen display. All
 * randomness is a pure function of time (hashed on a fixed 30 fps step), so a
 * given moment looks identical in the preview and in every export.
 */

export interface VhsText {
  id: string;
  text: string;
  /** centre/anchor, percent of the frame */
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  font: string;
  size: number;
  weight: string;
  color: string;
  opacity: number;
  spacing: number;
  rotation: number;
  glow: number;
  blink: boolean;
  blinkRate: number;
  anim: 'none' | 'jitter' | 'drift' | 'typewriter';
  visible: boolean;
}

const base = { align: 'left', font: 'mono', size: 36, weight: '700', color: '#ffffff', opacity: 92, spacing: 0.04, rotation: 0, glow: 0.35, blink: false, blinkRate: 1, anim: 'none', visible: true } as const;

export const DEFAULT_TEXTS: VhsText[] = [
  { ...base, id: 't1', text: 'PLAY ▶', x: 5, y: 6, blink: true },
  { ...base, id: 't2', text: 'SP  {tc}', x: 95, y: 6, align: 'right' },
  { ...base, id: 't3', text: '{date}', x: 5, y: 88 },
  { ...base, id: 't4', text: '{time}', x: 5, y: 80 },
];
export const newVhsText = (n: number): VhsText => ({ ...base, id: `t${Date.now().toString(36)}${n}`, text: 'MY TEXT', x: 50, y: 50, align: 'center' });

export function parseTexts(s: string): VhsText[] {
  if (!s) return DEFAULT_TEXTS;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : DEFAULT_TEXTS;
  } catch {
    return DEFAULT_TEXTS;
  }
}

const FONTS: Record<string, string> = {
  mono: "'VT323', 'OCR A Extended', Consolas, 'Courier New', monospace",
  sans: "'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  condensed: "Impact, 'Arial Narrow', sans-serif",
};
export const VHS_FONTS = Object.keys(FONTS);

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatDate(d: Date, f: string) {
  const Y = d.getFullYear(), M = d.getMonth(), D = d.getDate();
  switch (f) {
    case 'mdy': return `${MONTHS[M]}. ${pad(D)} ${Y}`;
    case 'dmy': return `${pad(D)} ${MONTHS[M]} ${Y}`;
    case 'numus': return `${pad(M + 1)}/${pad(D)}/${String(Y).slice(2)}`;
    case 'numeu': return `${pad(D)}.${pad(M + 1)}.${String(Y).slice(2)}`;
    default: return `${Y}-${pad(M + 1)}-${pad(D)}`;
  }
}
function formatTime(d: Date, f: string) {
  const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
  if (f === '12') return `${pad(h % 12 || 12)}:${pad(m)}:${pad(s)} ${h < 12 ? 'AM' : 'PM'}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Resolve {date} {time} {tc} from the user's own date/time (never the system clock). */
function tokens(text: string, p: ParamValues, time: number) {
  const running = p.clockMode === 'running';
  const d = new Date(`${p.date || '1994-10-07'}T${p.clock || '21:42:06'}`);
  const valid = !Number.isNaN(d.getTime()) ? d : new Date(1994, 9, 7, 21, 42, 6);
  const at = new Date(valid.getTime() + (running ? time * 1000 : 0));
  const s = Math.floor(time);
  const tc = `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  const date = p.stampMode === 'custom' ? String(p.stampText ?? '') : formatDate(at, p.dateFormat as string);
  return text.split('{date}').join(date).split('{time}').join(formatTime(at, p.timeFormat as string)).split('{tc}').join(tc);
}

const r = (key: string, label: string, min: number, max: number, step: number, def: number, group: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, type: 'range', min, max, step, default: def, group, ...extra } as ParamDef);

export const vhs: EffectDefinition = {
  id: 'vhs',
  name: 'VHS',
  category: 'analog',
  description: 'Tape playback model with a fully editable on-screen display. Drag text on the canvas.',
  animated: () => true,
  audioDefaults: { tracking: { band: 'beat', amount: 0.4 }, jitter: { band: 'bass', amount: 0.2 } },
  presets: [
    { name: 'Clean VHS', values: { chromaShift: 2, chromaBleed: 3, softness: 0.8, desaturate: 0.05, rgbSep: 0, tracking: 0.08, bars: 0, jitter: 0.08, vJitter: 0, noise: 0.05, damage: 0, staticAmt: 0, flicker: 0.02, scanlines: 0.14, interlace: 0.05, vignette: 0.15, interference: 0 } },
    { name: '1990s Camcorder', values: { chromaShift: 5, chromaBleed: 7, softness: 1.6, desaturate: 0.12, rgbSep: 1, tracking: 0.25, bars: 0, jitter: 0.3, vJitter: 0.1, noise: 0.14, damage: 0.05, staticAmt: 0, flicker: 0.05, scanlines: 0.2, interlace: 0.2, vignette: 0.3, interference: 0.05, stampNoise: 0.3 } },
    { name: 'Degraded Tape', values: { chromaShift: 10, chromaBleed: 16, softness: 2.6, desaturate: 0.4, rgbSep: 3, tracking: 0.75, bars: 0.6, jitter: 0.6, vJitter: 0.35, noise: 0.35, damage: 0.55, staticAmt: 0.25, flicker: 0.14, scanlines: 0.3, interlace: 0.35, vignette: 0.45, interference: 0.35, stampNoise: 0.7 } },
    { name: 'CRT Playback', values: { chromaShift: 3, chromaBleed: 4, softness: 1, desaturate: 0, rgbSep: 2, tracking: 0.1, bars: 0.2, jitter: 0.1, vJitter: 0.05, noise: 0.08, damage: 0, staticAmt: 0, flicker: 0.1, scanlines: 0.6, interlace: 0.3, vignette: 0.6, interference: 0.08 } },
    { name: 'Found Footage', values: { chromaShift: 7, chromaBleed: 12, softness: 2.2, desaturate: 0.55, rgbSep: 2, tracking: 0.55, bars: 0.45, jitter: 0.5, vJitter: 0.25, noise: 0.3, damage: 0.35, staticAmt: 0.12, flicker: 0.16, scanlines: 0.25, interlace: 0.3, vignette: 0.6, interference: 0.25, stampNoise: 0.5 } },
    { name: 'Night Recording', values: { chromaShift: 4, chromaBleed: 8, softness: 1.8, desaturate: 0.7, rgbSep: 1, tracking: 0.2, bars: 0, jitter: 0.2, vJitter: 0.08, noise: 0.5, damage: 0.08, staticAmt: 0.04, flicker: 0.06, scanlines: 0.2, interlace: 0.2, vignette: 0.7, interference: 0.1, tintOn: true, tint: '#7dff9a', lift: 0.12 } },
  ],
  params: [
    { key: 'texts', label: 'Text Elements', type: 'custom', editor: 'overlays', group: 'On-Screen Display', default: '' },
    { key: 'osd', label: 'Show Overlay', type: 'toggle', group: 'On-Screen Display', default: true },
    r('stampNoise', 'Timestamp Noise', 0, 1, 0.01, 0.2, 'On-Screen Display'),

    { key: 'stampMode', label: 'Date Shows', type: 'select', group: 'Timestamp', default: 'date', options: [{ value: 'date', label: 'Date' }, { value: 'custom', label: 'Custom Text' }] },
    { key: 'date', label: 'Date (YYYY-MM-DD)', type: 'text', group: 'Timestamp', default: '1994-10-07', maxLength: 10, visibleWhen: (v) => v.stampMode !== 'custom' },
    { key: 'stampText', label: 'Custom Stamp', type: 'text', group: 'Timestamp', default: 'SUMMER TAPE 03', maxLength: 40, visibleWhen: (v) => v.stampMode === 'custom' },
    { key: 'dateFormat', label: 'Date Format', type: 'select', group: 'Timestamp', default: 'mdy', visibleWhen: (v) => v.stampMode !== 'custom', options: [{ value: 'mdy', label: 'OCT. 07 1994' }, { value: 'dmy', label: '07 OCT 1994' }, { value: 'numus', label: '10/07/94' }, { value: 'numeu', label: '07.10.94' }, { value: 'iso', label: '1994-10-07' }] },
    { key: 'clock', label: 'Time (HH:MM:SS)', type: 'text', group: 'Timestamp', default: '21:42:06', maxLength: 8 },
    { key: 'timeFormat', label: 'Time Format', type: 'select', group: 'Timestamp', default: '12', options: [{ value: '12', label: '12 Hour' }, { value: '24', label: '24 Hour' }] },
    { key: 'clockMode', label: 'Clock', type: 'select', group: 'Timestamp', default: 'running', options: [{ value: 'running', label: 'Runs With Playback' }, { value: 'fixed', label: 'Fixed' }] },

    r('chromaShift', 'Chroma Shift', 0, 30, 0.5, 4, 'Color'),
    r('chromaBleed', 'Color Bleeding', 0, 30, 0.5, 6, 'Color'),
    r('rgbSep', 'RGB Separation', 0, 20, 0.5, 1, 'Color'),
    r('desaturate', 'Desaturation', 0, 1, 0.01, 0.15, 'Color'),
    r('softness', 'Analog Softness', 0, 6, 0.1, 1.2, 'Color'),
    r('lift', 'Black Lift', 0, 0.4, 0.01, 0.03, 'Color'),
    { key: 'tintOn', label: 'Color Cast', type: 'toggle', group: 'Color', default: false },
    { key: 'tint', label: 'Cast Color', type: 'color', group: 'Color', default: '#7dff9a', visibleWhen: (v) => v.tintOn === true },

    r('tracking', 'Tracking Distortion', 0, 1, 0.01, 0.35, 'Tape Motion'),
    r('trackSpeed', 'Tracking Speed', 0, 2, 0.01, 0.2, 'Tape Motion'),
    r('trackScale', 'Tracking Band Size', 0.02, 0.4, 0.005, 0.07, 'Tape Motion'),
    r('bars', 'Tracking Bars', 0, 1, 0.01, 0, 'Tape Motion'),
    r('jitter', 'Line Wobble', 0, 1, 0.01, 0.25, 'Tape Motion'),
    r('jitterFreq', 'Wobble Frequency', 0.01, 0.4, 0.005, 0.04, 'Tape Motion'),
    r('vJitter', 'Vertical Jitter', 0, 1, 0.01, 0.05, 'Tape Motion'),
    { key: 'headSwitch', label: 'Head-Switch Noise', type: 'toggle', group: 'Tape Motion', default: true },

    r('noise', 'Tape Noise', 0, 1, 0.01, 0.12, 'Signal'),
    r('staticAmt', 'Static', 0, 1, 0.01, 0, 'Signal'),
    r('interference', 'Signal Interference', 0, 1, 0.01, 0, 'Signal'),
    r('damage', 'Tape Damage', 0, 1, 0.01, 0, 'Signal'),
    { key: 'seed', label: 'Damage Seed', type: 'seed', group: 'Signal', default: 19, visibleWhen: (v) => (v.damage as number) > 0 },
    r('flicker', 'Flicker', 0, 0.5, 0.005, 0.03, 'Signal'),

    r('scanlines', 'Scanlines', 0, 1, 0.01, 0.2, 'Display'),
    r('interlace', 'Interlacing', 0, 1, 0.01, 0.1, 'Display'),
    r('vignette', 'Vignette', 0, 1, 0.01, 0.25, 'Display'),
    { key: 'animate', label: 'Animate Signal', type: 'toggle', group: 'Display', default: true },
  ],
  render({ src, ctx, width, height, params: p, unit, time: rawTime }) {
    const time = p.animate ? rawTime : 0;
    const tick = Math.floor(time * 30);
    const shift = (p.chromaShift as number) * unit;
    const br = Math.max(0, Math.round((p.chromaBleed as number) * unit));
    const sat = 1 - (p.desaturate as number);
    const rgbSep = Math.round((p.rgbSep as number) * unit);
    const soft = Math.round((p.softness as number) * unit);
    const jitter = (p.jitter as number) * 3 * unit;
    const jf = p.jitterFreq as number;
    const track = p.tracking as number;
    const noise = p.noise as number;
    const stat = p.staticAmt as number;
    const inter = p.interference as number;
    const damage = p.damage as number;
    const bars = p.bars as number;
    const scan = p.scanlines as number;
    const lace = p.interlace as number;
    const vig = p.vignette as number;
    const lift = (p.lift as number) * 255;
    const seedD = p.seed as number;
    const flick = 1 - (p.flicker as number) * hash2(tick, 1, 3);
    const bandH = Math.max(2, height * (p.trackScale as number));
    const bandY = (((time * (p.trackSpeed as number) * 0.35) % 1.2) - 0.1) * height;
    const head = p.headSwitch ? Math.round(height * 0.035) : 0;
    const vOff = Math.round((hash2(tick, 2, 9) - 0.5) * (p.vJitter as number) * 10 * unit);
    const tint = p.tintOn ? hexToRgb(p.tint as string).map((c) => c / 255) : null;
    const cx = width / 2, cy = height / 2, maxR = Math.hypot(cx, cy);

    // Long dropouts: a seeded list of damaged scan regions that appear briefly.
    const drops: { y: number; h: number; x: number; w: number }[] = [];
    for (let i = 0; i < Math.round(damage * 14); i++) {
      if (hash2(tick >> 2, i, seedD) > 0.55) continue;
      drops.push({
        y: hash2(tick >> 2, i + 40, seedD) * height, h: (1 + hash2(i, tick >> 2, seedD) * 3) * unit,
        x: hash2(i, 77, tick >> 2) * width, w: (0.1 + hash2(i, 78, tick >> 2) * 0.5) * width,
      });
    }

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const o = out.data;
    const Y = new Float32Array(width + 1), I = new Float32Array(width), Q = new Float32Array(width);
    const py = new Float32Array(width + 1), pi = new Float32Array(width + 1), pq = new Float32Array(width + 1);

    for (let y = 0; y < height; y++) {
      const sy = Math.min(height - 1, Math.max(0, y + vOff + (lace > 0 && y % 2 ? Math.round(lace * 2 * unit) : 0)));
      let dx = (valueNoise(y * jf, time * 6, 3) - 0.5) * jitter * 2;
      const inBand = Math.abs(y - bandY) < bandH;
      if (inBand) dx += (valueNoise(y * 0.3, time * 20, 5) - 0.3) * track * 40 * unit;
      if (lace > 0 && y % 2) dx += lace * 1.5 * unit * Math.sin(time * 11);
      const inHead = y >= height - head;
      if (inHead) dx += (hash2(y, 0, tick) * 0.5 + 0.5) * 60 * unit;
      const row = y * width, srow = sy * width;
      for (let x = 0; x < width; x++) {
        const sx = Math.min(width - 1, Math.max(0, Math.round(x - dx)));
        const i = (srow + sx) * 4;
        const a = d[i], g = d[i + 1], b = d[i + 2];
        Y[x] = 0.299 * a + 0.587 * g + 0.114 * b;
        I[x] = 0.596 * a - 0.274 * g - 0.322 * b;
        Q[x] = 0.211 * a - 0.523 * g + 0.312 * b;
      }
      for (let x = 0; x < width; x++) {
        py[x + 1] = py[x] + Y[x];
        pi[x + 1] = pi[x] + I[x];
        pq[x + 1] = pq[x] + Q[x];
      }
      const barLine = bars > 0 ? Math.sin(y * (0.02 / unit) + time * 9) > 0.985 - bars * 0.03 : false;
      const interWave = inter > 0 ? Math.sin(y * 0.11 / unit + time * 37) * Math.sin(y * 0.013 / unit - time * 5) * inter * 30 : 0;
      for (let x = 0; x < width; x++) {
        const a0 = Math.max(0, x - soft), b0 = Math.min(width, x + soft + 1);
        let yy = soft ? (py[b0] - py[a0]) / (b0 - a0) : Y[x];
        const cx0 = Math.min(width - 1, Math.max(0, Math.round(x - shift)));
        const a = Math.max(0, cx0 - br), b2 = Math.min(width, cx0 + br + 1);
        const ci = ((pi[b2] - pi[a]) / (b2 - a)) * sat;
        const cq = ((pq[b2] - pq[a]) / (b2 - a)) * sat;
        const h = noise > 0 || stat > 0 ? hash2(x, y, tick) : 0.5;
        if (noise > 0) {
          if (h > 1 - noise * 0.03) yy = 255;
          yy += (h - 0.5) * noise * 60;
        }
        if (stat > 0 && hash2(x >> 1, y >> 1, tick + 5) < stat) yy = hash2(x, y, tick + 8) * 255;
        if (inBand) yy += 18 * track;
        if (barLine) yy = yy * 0.5 + 110 * bars;
        yy += interWave;
        if (inHead) yy = yy * 0.6 + hash2(x >> 2, y, tick + 1) * 100;
        for (const dr of drops) if (y >= dr.y && y < dr.y + dr.h && x >= dr.x && x < dr.x + dr.w) yy = 235;
        let sl = scan > 0 && y % 2 ? 1 - scan * 0.35 : 1;
        if (vig > 0) {
          const nx = (x - cx) / maxR, ny = (y - cy) / maxR;
          sl *= 1 - vig * Math.min(1, (nx * nx + ny * ny) * 1.2);
        }
        sl *= flick;
        const oi = (row + x) * 4;
        let R = (yy + 0.956 * ci + 0.621 * cq) * sl + lift;
        let G = (yy - 0.272 * ci - 0.647 * cq) * sl + lift;
        let B = (yy - 1.106 * ci + 1.703 * cq) * sl + lift;
        if (tint) { R *= tint[0]; G *= tint[1]; B *= tint[2]; }
        o[oi] = clamp255(R); o[oi + 1] = clamp255(G); o[oi + 2] = clamp255(B); o[oi + 3] = 255;
      }
    }
    if (rgbSep > 0) {
      // Real channel offset, applied after the chroma model.
      const copy = new Uint8ClampedArray(o);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          o[i] = copy[(y * width + Math.min(width - 1, x + rgbSep)) * 4];
          o[i + 2] = copy[(y * width + Math.max(0, x - rgbSep)) * 4 + 2];
        }
    }
    ctx.putImageData(out, 0, 0);
    if (p.osd) drawTexts(ctx, parseTexts(p.texts as string), p, rawTime, width, height, unit);
  },
};

function drawTexts(ctx: CanvasRenderingContext2D, list: VhsText[], p: ParamValues, time: number, W: number, H: number, unit: number) {
  const noise = p.stampNoise as number;
  const tick = Math.floor(time * 30);
  for (const t of list) {
    if (!t.visible) continue;
    if (t.blink && Math.floor(time * t.blinkRate * 2) % 2 === 1) continue;
    let text = tokens(t.text, p, time);
    let x = (t.x / 100) * W, y = (t.y / 100) * H;
    if (t.anim === 'typewriter') text = text.slice(0, Math.floor((time * 12) % (text.length + 18)));
    if (t.anim === 'drift') x += Math.sin(time * 0.8) * 12 * unit;
    if (t.anim === 'jitter') { x += (hash2(tick, 1, 5) - 0.5) * 6 * unit; y += (hash2(tick, 2, 5) - 0.5) * 4 * unit; }
    if (noise > 0) x += (hash2(tick, 3, y | 0) - 0.5) * noise * 5 * unit;
    const size = t.size * unit;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((t.rotation * Math.PI) / 180);
    ctx.font = `${t.weight} ${size}px ${FONTS[t.font] ?? FONTS.mono}`;
    (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${t.spacing * size}px`;
    ctx.textAlign = t.align;
    ctx.textBaseline = 'top';
    ctx.globalAlpha = (t.opacity / 100) * (1 - noise * 0.25 * hash2(tick, 7, 2));
    ctx.fillStyle = t.color;
    if (t.glow > 0) {
      ctx.shadowColor = t.color;
      ctx.shadowBlur = t.glow * 18 * unit;
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}

/** Hit-test for dragging text on the canvas; x/y in percent. */
export function hitVhsText(list: VhsText[], px: number, py: number, unit: number, W: number, H: number): VhsText | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i];
    if (!t.visible) continue;
    const size = t.size * unit, w = t.text.length * size * 0.62;
    const x = (t.x / 100) * W, y = (t.y / 100) * H;
    const left = t.align === 'left' ? x : t.align === 'right' ? x - w : x - w / 2;
    const X = (px / 100) * W, Y = (py / 100) * H;
    if (X >= left - 8 && X <= left + w + 8 && Y >= y - 8 && Y <= y + size + 8) return t;
  }
  return null;
}
