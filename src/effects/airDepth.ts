import type { EffectDefinition, ParamValues } from './types';
import { edits, tracks } from '../ai/client';
import { boxBlur, clamp255, createCanvas, get2d, hexToRgb, sampleBilinear, toLuma } from '../utils/imageProcessing';
import { guided, resample } from './airKey';

export type DepthSource = 'model' | 'gradient' | 'luma';

type Field = { key: string; depth: Float32Array; isModel: boolean; hasMap: boolean };
/** A few sizes at once: reading a depth at 320 px must not throw away the preview's map. */
const memos: Field[] = [];
let curve: { key: string; lut: Float32Array } | null = null;
const BINS = 4096;

/** Cumulative share of pixels at each depth, over every frame, so a clip gets one curve and cannot flicker. */
function balanceCurve() {
  const key = `${tracks.depth.version}`;
  if (curve?.key === key) return curve.lut;
  // Fine bins: distant land can sit in a tiny part of the range.
  const hist = new Float64Array(BINS);
  for (const f of tracks.depth.frames) for (let i = 0; i < f.data.length; i += 3) hist[Math.min(BINS - 1, Math.max(0, Math.floor(f.data[i] * BINS)))]++;
  const lut = new Float32Array(BINS);
  let sum = 0, total = 0;
  for (const c of hist) total += c;
  for (let i = 0; i < BINS; i++) { sum += hist[i]; lut[i] = total ? sum / total : i / (BINS - 1); }
  curve = { key, lut };
  return lut;
}

/** Near = warm, far = cool. Reads near and far faster than gray, and is what Colorized shows. */
export function depthColor(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [[0, 26, 18, 80], [0.25, 40, 90, 200], [0.5, 40, 190, 150], [0.75, 240, 200, 60], [1, 225, 50, 40]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], k = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [225, 50, 40];
}

/** A good first focus: what stands nearest in the middle of the frame. */
export function suggestFocus(depth: Float32Array, w: number, h: number) {
  const v: number[] = [];
  for (let y = Math.floor(h * 0.2); y < h * 0.9; y += 2) for (let x = Math.floor(w * 0.2); x < w * 0.8; x += 2) v.push(depth[y * w + x]);
  v.sort((a, b) => a - b);
  return v.length ? Math.round(v[Math.floor(v.length * 0.8)] * 500) / 500 : 0.5;
}

/** Depth with brush edits, for anything that reads the map outside this effect. */
export function editedDepth(w: number, h: number, time: number) {
  const m = tracks.depth.at(time);
  if (!m) return null;
  const s = new Float32Array(resample(m, w, h)), ep = edits.depth;
  if (ep.w) {
    const E = resample({ w: ep.w, h: ep.h, data: ep.data }, w, h);
    for (let i = 0; i < s.length; i++) s[i] = Math.min(1, Math.max(0, s[i] + E[i]));
  }
  return s;
}

/**
 * Depth (0 far … 1 near) at frame size, after brush edits and map controls.
 * The result is cached, so focus and blur sliders never rebuild it. With no
 * map available, hasMap is false and callers must not pretend they have depth.
 */
export function depthField(src: ImageData, p: ParamValues, time: number): { depth: Float32Array; isModel: boolean; hasMap: boolean } {
  const { width: w, height: h } = src, n = w * h;
  const m = p.source === 'model' ? tracks.depth.at(time) : null;
  const ep = edits.depth;
  const key = [w, h, p.source, tracks.depth.version, m ? tracks.depth.frames.indexOf(m) : -1, ep.version, p.nearDepth, p.farDepth, p.depthContrast, p.invertDepth, p.depthSmooth, p.edgeRefine, p.depthBalance, p.source === 'model' ? 0 : src.data[n * 2]].join();
  const hit = memos.find((f) => f.key === key);
  if (hit) return hit;
  let base: Float32Array;
  const isModel = !!m;
  const hasMap = isModel || p.source !== 'model';
  if (m) base = new Float32Array(resample(m, w, h));
  else if (p.source === 'luma') base = toLuma(src);
  else if (p.source === 'gradient') {
    base = new Float32Array(n);
    for (let y = 0; y < h; y++) base.fill(y / Math.max(1, h - 1), y * w, (y + 1) * w);
  } else base = new Float32Array(n).fill(0.5);
  const bal = p.depthBalance as number;
  if (isModel && bal > 0) {
    const lut = balanceCurve();
    for (let i = 0; i < n; i++) base[i] += (lut[Math.min(BINS - 1, Math.max(0, Math.floor(base[i] * BINS)))] - base[i]) * bal;
  }
  if (ep.w) {
    const E = resample({ w: ep.w, h: ep.h, data: ep.data }, w, h);
    for (let i = 0; i < n; i++) base[i] += E[i];
  }
  const near = p.nearDepth as number, far = p.farDepth as number, c = p.depthContrast as number;
  const inv = p.invertDepth as boolean, lo = Math.min(far, near - 0.001), span = Math.max(0.001, near - lo);
  for (let i = 0; i < n; i++) {
    let v = Math.min(1, Math.max(0, (base[i] - lo) / span));
    v = Math.min(1, Math.max(0, (v - 0.5) * c + 0.5));
    base[i] = inv ? 1 - v : v;
  }
  const sm = p.depthSmooth as number;
  if (sm > 0.5) base = boxBlur(base, w, h, (sm * Math.max(w, h)) / 1000, 2);
  const er = p.edgeRefine as number;
  if (er > 0) {
    const r = Math.max(2, Math.round((Math.max(w, h) / 1000) * 12));
    const g = guided(base, toLuma(src), w, h, r, 0.0004 + (1 - er) * 0.02);
    for (let i = 0; i < n; i++) base[i] = Math.min(1, Math.max(0, base[i] + (g[i] - base[i]) * er));
  }
  const made = { key, depth: base, isModel, hasMap };
  memos.unshift(made);
  if (memos.length > 3) memos.pop();
  return made;
}

/** Sharp inside the focus band, blurred by a smooth falloff outside it. */
function cocAt(v: number, focus: number, range: number, falloff: number, fg: number, bg: number) {
  const d = v - focus, out = Math.max(0, Math.abs(d) - range / 2);
  if (out <= 0) return 0;
  const k = Math.min(1, out / Math.max(0.01, falloff));
  return k * k * (3 - 2 * k) * (d > 0 ? fg : bg);
}

const spiral = (n: number) => Array.from({ length: n }, (_, i) => {
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.39996;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
const SPIRAL = spiral(40);
/** Fewer taps for small blurs: nobody can see 40 samples across a 3 px disc. */
const flat = (k: number[][]) => Float32Array.from(k.flatMap(([x, y]) => [x, y, Math.hypot(x, y)]));
/** Pull a disc sample onto a polygon, so the bokeh takes the aperture's shape. */
function kernel(blades: number, n = 40) {
  const base = n === 40 ? SPIRAL : spiral(n);
  if (!blades) return base;
  return base.map(([x, y]) => {
    const a = Math.atan2(y, x), s = (Math.PI * 2) / blades, m = ((a % s) + s) % s - s / 2;
    const k = Math.cos(s / 2) / Math.cos(m);
    return [x * k, y * k];
  });
}

export const airDepth: EffectDefinition = {
  id: 'airDepth',
  name: 'AirFx Depth',
  category: 'depth',
  description: 'Grayscale depth maps from a real depth model, with focus, depth regions, painting and depth-driven looks.',
  animated: (p) => (p.parallax as number) > 0,
  params: [
    {
      key: 'source', label: 'Depth Source', type: 'select', group: 'Depth Map', default: 'model',
      options: [{ value: 'model', label: 'AI Model' }, { value: 'gradient', label: 'Procedural Gradient' }, { value: 'luma', label: 'Procedural Brightness' }],
    },
    { key: 'view', label: 'View', type: 'select', group: 'Depth Map', default: 'final', options: [{ value: 'final', label: 'Final' }, { value: 'original', label: 'Original' }, { value: 'depth', label: 'Depth Map' }, { value: 'color', label: 'Colorized Depth' }, { value: 'side', label: 'Side by Side' }, { value: 'depthOverlay', label: 'Depth Overlay' }, { value: 'overlay', label: 'Focus Overlay' }, { value: 'mask', label: 'Focus Mask' }] },
    { key: 'depthContrast', label: 'Depth Contrast', type: 'range', group: 'Depth Map', min: 0.3, max: 4, step: 0.01, default: 1 },
    { key: 'invertDepth', label: 'Invert Depth', type: 'toggle', group: 'Depth Map', default: false },
    { key: 'nearDepth', label: 'Near Depth', type: 'range', group: 'Depth Map', min: 0.05, max: 1, step: 0.005, default: 1 },
    { key: 'farDepth', label: 'Far Depth', type: 'range', group: 'Depth Map', min: 0, max: 0.95, step: 0.005, default: 0 },
    { key: 'depthSmooth', label: 'Depth Smoothing', type: 'range', group: 'Depth Map', min: 0, max: 40, step: 0.5, default: 0 },
    { key: 'depthBalance', label: 'Depth Balance', type: 'range', group: 'Depth Map', min: 0, max: 1, step: 0.01, default: 0.4, hint: 'Spreads depth evenly, so a big sky or wall does not squeeze everything else into a narrow range. Near stays nearer than far.' },
    { key: 'edgeRefine', label: 'Edge Refinement', type: 'range', group: 'Depth Map', min: 0, max: 1, step: 0.01, default: 0.5, hint: 'Snaps depth edges to image edges.' },
    { key: 'focus', label: 'Focus Distance', type: 'range', group: 'Focus', min: 0, max: 1, step: 0.002, default: 0.75, hint: 'Click the preview to focus there.' },
    { key: 'focusRange', label: 'Focus Range', type: 'range', group: 'Focus', min: 0, max: 1, step: 0.005, default: 0.24 },
    { key: 'falloff', label: 'Focus Falloff', type: 'range', group: 'Focus', min: 0.01, max: 1, step: 0.005, default: 0.3 },
    { key: 'blur', label: 'Blur Strength', type: 'range', group: 'Focus', min: 0, max: 80, step: 0.5, default: 26 },
    { key: 'fgBlur', label: 'Foreground Blur', type: 'range', group: 'Focus', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'bgBlur', label: 'Background Blur', type: 'range', group: 'Focus', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'bokeh', label: 'Bokeh Shape', type: 'select', group: 'Bokeh', default: '0', options: [{ value: '0', label: 'Disc' }, { value: '5', label: 'Pentagon' }, { value: '6', label: 'Hexagon' }, { value: '8', label: 'Octagon' }] },
    { key: 'highlight', label: 'Highlight Boost', type: 'range', group: 'Bokeh', min: 0, max: 6, step: 0.01, default: 1.5 },
    { key: 'glow', label: 'Depth Glow', type: 'range', group: 'Depth Looks', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'glowColor', label: 'Glow Color', type: 'color', group: 'Depth Looks', default: '#c6ff2e', visibleWhen: (v) => (v.glow as number) > 0 },
    { key: 'gradeAmount', label: 'Depth Color Grade', type: 'range', group: 'Depth Looks', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'gradeNear', label: 'Near Tint', type: 'color', group: 'Depth Looks', default: '#ffc48a', visibleWhen: (v) => (v.gradeAmount as number) > 0 },
    { key: 'gradeFar', label: 'Far Tint', type: 'color', group: 'Depth Looks', default: '#3a6cff', visibleWhen: (v) => (v.gradeAmount as number) > 0 },
    { key: 'displace', label: 'Depth Displacement', type: 'range', group: 'Depth Looks', min: -80, max: 80, step: 0.5, default: 0 },
    { key: 'parallax', label: 'Parallax', type: 'range', group: 'Parallax', min: 0, max: 60, step: 0.5, default: 0, hint: 'Moves near pixels more than far ones, over time.' },
    { key: 'parallaxSpeed', label: 'Parallax Speed', type: 'range', group: 'Parallax', min: 0.05, max: 2, step: 0.01, default: 0.4, visibleWhen: (v) => (v.parallax as number) > 0 },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const { depth, hasMap } = depthField(src, p, time);
    const n = w * h, view = p.view as string;
    // No map yet: show the image, never a made-up gradient passed off as depth.
    if (!hasMap || view === 'original') {
      ctx.putImageData(src, 0, 0);
      if (!hasMap && view !== 'original' && view !== 'final') {
        ctx.fillStyle = 'rgba(0,0,0,.72)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#c6ff2e';
        ctx.font = `${Math.round(16 * unit)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText('No depth map yet', w / 2, h / 2);
      }
      return;
    }
    const out = ctx.createImageData(w, h), o = out.data;
    if (view === 'side') {
      const depthImg = ctx.createImageData(w, h);
      for (let i = 0; i < n; i++) { const v = depth[i] * 255; depthImg.data[i * 4] = depthImg.data[i * 4 + 1] = depthImg.data[i * 4 + 2] = v; depthImg.data[i * 4 + 3] = 255; }
      const a = createCanvas(w, h), b = createCanvas(w, h);
      get2d(a).putImageData(src, 0, 0);
      get2d(b).putImageData(depthImg, 0, 0);
      ctx.fillStyle = '#0d0e0d';
      ctx.fillRect(0, 0, w, h);
      const dh = h / 2, y = (h - dh) / 2;
      ctx.drawImage(a, 0, y, w / 2, dh);
      ctx.drawImage(b, w / 2, y, w / 2, dh);
      a.width = b.width = 1;
      return;
    }
    if (view === 'depthOverlay') {
      for (let i = 0; i < n; i++) {
        const k = i * 4, v = depth[i];
        // Warm = near, cool = far, laid over the image so depth reads against it.
        o[k] = src.data[k] * 0.5 + 255 * v * 0.5; o[k + 1] = src.data[k + 1] * 0.5 + 90 * 0.5; o[k + 2] = src.data[k + 2] * 0.5 + 255 * (1 - v) * 0.5; o[k + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    const focus = p.focus as number, range = p.focusRange as number, fall = p.falloff as number;
    const fg = p.fgBlur as number, bg = p.bgBlur as number;

    if (view === 'color') {
      for (let i = 0; i < n; i++) {
        const c = depthColor(depth[i]);
        o[i * 4] = c[0]; o[i * 4 + 1] = c[1]; o[i * 4 + 2] = c[2]; o[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    if (view === 'depth') {
      for (let i = 0; i < n; i++) {
        const v = depth[i] * 255;
        o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v;
        o[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }
    if (view === 'mask') {
      for (let i = 0; i < n; i++) {
        const v = (1 - Math.min(1, cocAt(depth[i], focus, range, fall, 1, 1))) * 255;
        o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v;
        o[i * 4 + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      return;
    }

    let d: Uint8ClampedArray = src.data;
    // Geometry first: parallax and displacement push pixels by depth.
    const px = (p.parallax as number) * unit, dp = (p.displace as number) * unit;
    if (px > 0 || dp !== 0) {
      const sx = Math.sin(time * (p.parallaxSpeed as number) * Math.PI * 2) * px, sy = Math.cos(time * (p.parallaxSpeed as number) * Math.PI) * px * 0.4;
      const moved = new Uint8ClampedArray(n * 4);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = depth[y * w + x] - 0.5;
          sampleBilinear(d, w, h, x + v * sx * 2 + v * dp, y + v * sy * 2 + v * dp * 0.5, moved, (y * w + x) * 4);
        }
      d = moved;
    }

    const maxR = (p.blur as number) * unit;
    const blades = parseInt(p.bokeh as string, 10), K40 = flat(kernel(blades)), K20 = flat(kernel(blades, 20)), K10 = flat(kernel(blades, 10));
    const boost = p.highlight as number;
    const coc = new Float32Array(n);
    for (let i = 0; i < n; i++) coc[i] = cocAt(depth[i], focus, range, fall, fg, bg) * maxR;
    if (maxR >= 0.5) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x, oi = i * 4, r = coc[i];
          if (r < 0.5) { o[oi] = d[oi]; o[oi + 1] = d[oi + 1]; o[oi + 2] = d[oi + 2]; o[oi + 3] = d[oi + 3]; continue; }
          // Alpha blurs with the colour, and is kept: a step before this may have
          // keyed the background out. Hidden pixels add no colour to the edge.
          let R = 0, G = 0, B = 0, W = 0, A = 0, T = 0;
          const K = r < 3 ? K10 : r < 8 ? K20 : K40;
          for (let t = 0; t < K.length; t += 3) {
            const kx = K[t], ky = K[t + 1], sx = x + kx * r, sy = y + ky * r;
            const ix = sx < 0 ? 0 : sx >= w ? w - 1 : sx | 0, iy = sy < 0 ? 0 : sy >= h ? h - 1 : sy | 0;
            const j = iy * w + ix, c = j * 4;
            // Sharp pixels must not bleed into their blurred neighbours.
            const reach = K[t + 2] * r;
            if (coc[j] + 1 < reach && depth[j] > depth[i]) continue;
            const a = d[c], b = d[c + 1], e = d[c + 2];
            const l = (a + b + e) / 765, wt = 1 + boost * l * l * l * l, on = d[c + 3] / 255;
            R += a * wt * on; G += b * wt * on; B += e * wt * on; W += wt * on;
            A += d[c + 3]; T++;
          }
          if (W > 0) { o[oi] = R / W; o[oi + 1] = G / W; o[oi + 2] = B / W; } else { o[oi] = d[oi]; o[oi + 1] = d[oi + 1]; o[oi + 2] = d[oi + 2]; }
          o[oi + 3] = T ? A / T : d[oi + 3];
        }
    } else {
      o.set(d);
    }

    const glow = p.glow as number, grade = p.gradeAmount as number;
    if (glow > 0 || grade > 0) {
      const gc = hexToRgb(p.glowColor as string), na = hexToRgb(p.gradeNear as string), fa = hexToRgb(p.gradeFar as string);
      for (let i = 0; i < n; i++) {
        const oi = i * 4, v = depth[i];
        if (grade > 0) {
          for (let c = 0; c < 3; c++) {
            const tint = fa[c] + (na[c] - fa[c]) * v;
            o[oi + c] = o[oi + c] + ((o[oi + c] * tint) / 255 - o[oi + c]) * grade;
          }
        }
        if (glow > 0) {
          const k = Math.max(0, 1 - Math.abs(v - focus) / Math.max(0.02, fall)) * glow * 0.8;
          for (let c = 0; c < 3; c++) o[oi + c] = clamp255(o[oi + c] + gc[c] * k * 0.6);
        }
      }
    }
    if (view === 'overlay') {
      // Green = in focus, red = in front of the focus band, blue = behind it.
      for (let i = 0; i < n; i++) {
        const oi = i * 4, v = depth[i], inBand = Math.abs(v - focus) <= range / 2;
        const tint = inBand ? [80, 255, 90] : v > focus ? [255, 70, 70] : [70, 110, 255];
        for (let c = 0; c < 3; c++) o[oi + c] = o[oi + c] * 0.55 + tint[c] * 0.45;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
