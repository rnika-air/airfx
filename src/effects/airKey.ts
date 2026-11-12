import type { EffectDefinition } from './types';
import { parseIds } from './types';
import { edits, tracks, type GrayMap } from '../ai/client';
import { selection } from '../ai/selection';
import { assetStore } from '../engine/assets';
import { renderClock } from '../engine/clock';
import { boxBlur, clamp255, createCanvas, get2d, hexToRgb, toLuma } from '../utils/imageProcessing';

const isChroma = (m: unknown) => m === 'green' || m === 'blue' || m === 'color';

/** Bilinear resample of a map to the frame size. */
export function resample(m: GrayMap, w: number, h: number): Float32Array {
  if (m.w === w && m.h === h) return m.data;
  const out = new Float32Array(w * h), sx = (m.w - 1) / Math.max(1, w - 1), sy = (m.h - 1) / Math.max(1, h - 1), d = m.data;
  for (let y = 0; y < h; y++) {
    const fy = y * sy, y0 = fy | 0, y1 = Math.min(m.h - 1, y0 + 1), v = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = x * sx, x0 = fx | 0, x1 = Math.min(m.w - 1, x0 + 1), u = fx - x0;
      const a = d[y0 * m.w + x0], b = d[y0 * m.w + x1], c = d[y1 * m.w + x0], e = d[y1 * m.w + x1];
      out[y * w + x] = (a + (b - a) * u) * (1 - v) + (c + (e - c) * u) * v;
    }
  }
  return out;
}

/** Chroma matte: distance from the key colour in Cb/Cr, so shadows on the screen still key. */
function chromaMatte(d: Uint8ClampedArray, n: number, key: number[], sim: number, tol: number, preserve: number): Float32Array {
  const cb = (r: number, g: number, b: number) => -0.1687 * r - 0.3313 * g + 0.5 * b;
  const cr = (r: number, g: number, b: number) => 0.5 * r - 0.4187 * g - 0.0813 * b;
  const kb = cb(key[0], key[1], key[2]), kr = cr(key[0], key[1], key[2]);
  const keyLen = Math.hypot(kb, kr) || 1;
  const a = new Float32Array(n), lo = sim * 180, hi = lo + Math.max(1, tol * 180);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const db = cb(r, g, b), dr = cr(r, g, b);
    const dist = Math.hypot(db - kb, dr - kr);
    let v = Math.min(1, Math.max(0, (dist - lo) / (hi - lo)));
    if (preserve > 0) {
      // Pixels whose chroma does not point toward the key colour are foreground.
      const along = (db * kb + dr * kr) / keyLen;
      if (along < keyLen * 0.25) v = Math.max(v, preserve);
    }
    a[i] = v;
  }
  return a;
}

/** Erode (<0) or dilate (>0) a matte. */
function morph(a: Float32Array, w: number, h: number, amount: number): Float32Array {
  const r = Math.round(Math.abs(amount));
  if (!r) return a;
  const grow = amount > 0, b = new Float32Array(a.length), c = new Float32Array(a.length);
  const pick = grow ? Math.max : Math.min;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let m = a[y * w + x];
      for (let k = 1; k <= r; k++) m = pick(m, a[y * w + Math.max(0, x - k)], a[y * w + Math.min(w - 1, x + k)]);
      b[y * w + x] = m;
    }
  for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++) {
      let m = b[y * w + x];
      for (let k = 1; k <= r; k++) m = pick(m, b[Math.max(0, y - k) * w + x], b[Math.min(h - 1, y + k) * w + x]);
      c[y * w + x] = m;
    }
  return c;
}

function grayOut(ctx: CanvasRenderingContext2D, a: Float32Array, w: number, h: number) {
  const out = ctx.createImageData(w, h), o = out.data;
  for (let i = 0; i < w * h; i++) { const v = a[i] * 255; o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255; }
  ctx.putImageData(out, 0, 0);
}

/** Edge-aware refinement: a guided filter, using image luminance as the guide. */
export function guided(p: Float32Array, guide: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const mean = (a: Float32Array) => boxBlur(a, w, h, r, 1);
  const n = p.length, ip = new Float32Array(n), ii = new Float32Array(n);
  for (let i = 0; i < n; i++) { ip[i] = guide[i] * p[i]; ii[i] = guide[i] * guide[i]; }
  const mI = mean(guide), mP = mean(p), mIP = mean(ip), mII = mean(ii);
  const a = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i];
    a[i] = (mIP[i] - mI[i] * mP[i]) / (v + eps);
    b[i] = mP[i] - a[i] * mI[i];
  }
  const ma = mean(a), mb = mean(b), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = ma[i] * guide[i] + mb[i];
  return out;
}

export const airKey: EffectDefinition = {
  id: 'airKey',
  name: 'AirFx Key',
  category: 'key',
  description: 'Select a subject, then keep it or remove it. Also auto matte and chroma key, with matte refinement and background replacement.',
  supportsTransparency: true,
  params: [
    {
      key: 'mode', label: 'Key Mode', type: 'select', group: 'Key', default: 'select',
      options: [{ value: 'select', label: 'Selection' }, { value: 'ai', label: 'Auto Matte' }, { value: 'green', label: 'Green Screen' }, { value: 'blue', label: 'Blue Screen' }, { value: 'color', label: 'Custom Color' }],
    },
    {
      key: 'intent', label: 'What To Do', type: 'select', group: 'Key', default: 'keep',
      options: [{ value: 'keep', label: 'Keep Subject' }, { value: 'remove', label: 'Remove Subject' }],
      hint: 'Keep removes everything else. Remove leaves a hole; AirFx Cleanup can rebuild what was behind it.',
    },
    { key: 'keyColor', label: 'Key Color', type: 'color', group: 'Key', default: '#2bd14a', hint: 'Or use Pick Key Color and click the screen in the preview.', visibleWhen: (v) => v.mode === 'color' },
    { key: 'similarity', label: 'Similarity', type: 'range', group: 'Key', min: 0, max: 1, step: 0.005, default: 0.16, visibleWhen: (v) => isChroma(v.mode) },
    { key: 'tolerance', label: 'Tolerance', type: 'range', group: 'Key', min: 0.01, max: 1, step: 0.005, default: 0.42, visibleWhen: (v) => isChroma(v.mode) },
    { key: 'preserve', label: 'Foreground Preservation', type: 'range', group: 'Key', min: 0, max: 1, step: 0.01, default: 0.6, visibleWhen: (v) => isChroma(v.mode) },
    { key: 'matteContrast', label: 'Matte Contrast', type: 'range', group: 'Matte', min: 0.5, max: 6, step: 0.01, default: 1.2 },
    { key: 'expand', label: 'Expand / Contract', type: 'range', group: 'Matte', min: -20, max: 20, step: 0.5, default: 0, hint: 'Positive grows the subject, negative shrinks it.' },
    { key: 'feather', label: 'Feather', type: 'range', group: 'Matte', min: 0, max: 40, step: 0.25, default: 1 },
    { key: 'smooth', label: 'Edge Smoothing', type: 'range', group: 'Matte', min: 0, max: 20, step: 0.25, default: 0, hint: 'Rounds jagged edges, then re-sharpens the matte.' },
    { key: 'refine', label: 'Refine Edges', type: 'range', group: 'Matte', min: 0, max: 1, step: 0.01, default: 0.7, hint: 'Snaps the mask to image edges with a guided filter. It sharpens outlines but cannot invent fine hair.', visibleWhen: (v) => v.mode === 'select' },
    { key: 'fineDetail', label: 'Fine Detail From Matte', type: 'range', group: 'Matte', min: 0, max: 1, step: 0.01, default: 0, hint: 'Near the edge, use the Auto Matte model for hair and thin shapes. Run Find Fine Detail first.', visibleWhen: (v) => v.mode === 'select' },
    { key: 'spill', label: 'Spill Suppression', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 0.8 },
    { key: 'decontaminate', label: 'Edge Decontamination', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 0.7, hint: 'Un-mixes background colour from semi-transparent edges.' },
    {
      key: 'bgMode', label: 'Background', type: 'select', group: 'Background', default: 'transparent',
      options: [{ value: 'transparent', label: 'Transparent' }, { value: 'color', label: 'Solid Color' }, { value: 'media', label: 'Image / Video' }, { value: 'blur', label: 'Blur Original' }],
    },
    { key: 'bgColor', label: 'Background Color', type: 'color', group: 'Background', default: '#101210', visibleWhen: (v) => v.bgMode === 'color' },
    { key: 'bgMedia', label: 'Background Media', type: 'images', group: 'Background', default: '', max: 1, video: true, visibleWhen: (v) => v.bgMode === 'media' },
    { key: 'bgBlur', label: 'Background Blur', type: 'range', group: 'Background', min: 0, max: 60, step: 0.5, default: 8, visibleWhen: (v) => v.bgMode === 'blur' || (v.bgMode === 'media' && !!v.bgMedia) },
    {
      key: 'view', label: 'View', type: 'select', group: 'View', default: 'final',
      options: [{ value: 'final', label: 'Final Composite' }, { value: 'subject', label: 'Selected Subject' }, { value: 'mask', label: 'Selection Mask' }, { value: 'alpha', label: 'Alpha Matte' }, { value: 'foreground', label: 'Foreground' }, { value: 'background', label: 'Background Plate' }, { value: 'original', label: 'Original' }],
    },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const n = w * h, d = src.data, mode = p.mode as string;
    if (p.view === 'original') { ctx.putImageData(src, 0, 0); return; }
    let a: Float32Array;
    let keyRgb = hexToRgb(p.keyColor as string) as number[];
    if (mode === 'select') {
      const m = selection.union(time);
      // Nothing selected yet: show the image untouched rather than a wrong cut-out.
      if (!m) { ctx.putImageData(src, 0, 0); return; }
      a = new Float32Array(resample(m, w, h));
      if (p.view === 'mask') { grayOut(ctx, a, w, h); return; }
    } else if (mode === 'ai') {
      const m = tracks.matte.at(time);
      if (!m) { ctx.putImageData(src, 0, 0); return; }
      a = new Float32Array(resample(m, w, h));
    } else {
      if (mode === 'green') keyRgb = [40, 210, 70];
      if (mode === 'blue') keyRgb = [30, 70, 220];
      a = chromaMatte(d, n, keyRgb, p.similarity as number, p.tolerance as number, p.preserve as number);
    }
    // Levels on the matte: pulls near-0 and near-1 values flat without moving the midpoint.
    const c = p.matteContrast as number;
    if (c !== 1) for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, (a[i] - 0.5) * c + 0.5));
    // Brush hints (white = keep, black = remove), applied before refinement.
    const hint = edits.hint;
    if (hint.w) {
      const H = resample({ w: hint.w, h: hint.h, data: hint.data }, w, h);
      for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, a[i] + H[i]));
    }
    const fine = p.fineDetail as number, fm = mode === 'select' && fine > 0 ? tracks.matte.at(time) : null;
    if (fm) {
      // Only near the selection's edge: the selection still decides what the subject is.
      const reach = Math.max(2, 14 * unit), core = morph(a, w, h, -reach), halo = morph(a, w, h, reach), M = resample(fm, w, h);
      for (let i = 0; i < n; i++) {
        if (halo[i] <= 0.5) continue;
        const v = Math.max(core[i], M[i]);
        a[i] += (v - a[i]) * fine;
      }
    }
    const rf = p.refine as number;
    if (mode === 'select' && rf > 0) {
      const r = Math.max(2, Math.round(6 * unit)), g = guided(a, toLuma(src), w, h, r, 0.0002 + (1 - rf) * 0.01);
      for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, a[i] + (g[i] - a[i]) * rf));
    }
    a = morph(a, w, h, ((p.expand as number) * unit));
    const sm = (p.smooth as number) * unit;
    if (sm > 0.5) {
      a = boxBlur(a, w, h, sm, 2);
      for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, (a[i] - 0.5) * 3 + 0.5));
    }
    const fe = (p.feather as number) * unit;
    if (fe > 0.4) a = boxBlur(a, w, h, fe, 2);
    if (p.intent === 'remove') for (let i = 0; i < n; i++) a[i] = 1 - a[i];

    if (p.view === 'subject') {
      // The subject in colour over a dimmed version of everything else.
      const out = ctx.createImageData(w, h), o = out.data;
      for (let i = 0; i < n; i++) {
        const k = i * 4, v = a[i], dim = 0.22 + 0.78 * v;
        o[k] = d[k] * dim + (1 - v) * 30; o[k + 1] = d[k + 1] * dim + (1 - v) * 40; o[k + 2] = d[k + 2] * dim + (1 - v) * 10; o[k + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    if (p.view === 'alpha' || p.view === 'mask') {
      const out = ctx.createImageData(w, h), o = out.data;
      for (let i = 0; i < n; i++) {
        const v = a[i] * 255;
        o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v;
        o[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }

    // Estimate what is behind each edge pixel: the key colour, or (for AI) nearby background.
    const dec = p.decontaminate as number, spill = p.spill as number;
    let bgEst: Float32Array[] | null = null;
    const learned = mode === 'ai' || mode === 'select';
    if (dec > 0 && learned) {
      const rad = 24 * unit, wt = new Float32Array(n);
      for (let i = 0; i < n; i++) wt[i] = 1 - a[i];
      const wb = boxBlur(wt, w, h, rad, 1);
      bgEst = [0, 1, 2].map((c2) => {
        const pl = new Float32Array(n);
        for (let i = 0; i < n; i++) pl[i] = d[i * 4 + c2] * wt[i];
        const b = boxBlur(pl, w, h, rad, 1);
        for (let i = 0; i < n; i++) b[i] /= Math.max(0.02, wb[i]);
        return b;
      });
    }
    const keyDom = keyRgb.indexOf(Math.max(...keyRgb));
    const others = [0, 1, 2].filter((x) => x !== keyDom);
    const out = ctx.createImageData(w, h), o = out.data;
    const bgPlate = p.view === 'background';
    for (let i = 0; i < n; i++) {
      const oi = i * 4, al = a[i];
      let r = d[oi], g = d[oi + 1], b = d[oi + 2];
      if (bgPlate) {
        o[oi] = r; o[oi + 1] = g; o[oi + 2] = b; o[oi + 3] = (1 - al) * 255;
        continue;
      }
      if (dec > 0 && al > 0.01 && al < 0.99) {
        // C = αF + (1−α)B ⇒ F = (C − (1−α)B) / α
        const br = bgEst ? bgEst[0][i] : keyRgb[0], bg = bgEst ? bgEst[1][i] : keyRgb[1], bb = bgEst ? bgEst[2][i] : keyRgb[2];
        const inv = 1 - al;
        r += ((r - inv * br) / al - r) * dec;
        g += ((g - inv * bg) / al - g) * dec;
        b += ((b - inv * bb) / al - b) * dec;
      }
      if (spill > 0 && !learned) {
        // Limit the screen's channel to the mean of the other two.
        const v = [r, g, b], lim = (v[others[0]] + v[others[1]]) / 2;
        if (v[keyDom] > lim) v[keyDom] += (lim - v[keyDom]) * spill;
        [r, g, b] = v;
      }
      o[oi] = clamp255(r); o[oi + 1] = clamp255(g); o[oi + 2] = clamp255(b); o[oi + 3] = al * 255;
    }
    if (p.view === 'foreground' || p.bgMode === 'transparent' || bgPlate) {
      ctx.putImageData(out, 0, 0);
      return;
    }
    // Composite: paint the background first, then the keyed foreground.
    const fg = createCanvas(w, h);
    get2d(fg).putImageData(out, 0, 0);
    const blur = (p.bgBlur as number) * unit;
    if (p.bgMode === 'color') {
      ctx.fillStyle = p.bgColor as string;
      ctx.fillRect(0, 0, w, h);
    } else {
      const asset = assetStore.get(parseIds(p.bgMedia)[0] ?? '');
      let bg: CanvasImageSource = srcCanvas;
      if (p.bgMode === 'media' && asset) {
        bg = asset.el;
        if (asset.kind === 'video') {
          const v = asset.el as HTMLVideoElement;
          v.muted = true;
          v.loop = true;
          if (v.paused && !renderClock.offline) v.play().catch(() => undefined);
          if (!v.paused && renderClock.offline) v.pause();
        }
      }
      if (p.bgMode === 'media' && !asset) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.save();
        if (blur > 0.2) ctx.filter = `blur(${blur}px)`;
        ctx.drawImage(bg, 0, 0, w, h);
        ctx.restore();
      }
    }
    ctx.drawImage(fg, 0, 0);
    fg.width = fg.height = 1;
  },
};
