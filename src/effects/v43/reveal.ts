import type { EffectDefinition, ParamValues } from '../types';
import { parseIds } from '../types';
import { selection } from '../../ai/selection';
import { tracks } from '../../ai/client';
import { vision } from '../../ai/vision';
import { assetStore } from '../../engine/assets';
import { stagePointer } from '../../engine/interaction';
import { boxBlur, createCanvas, get2d, hexToRgb, toLuma } from '../../utils/imageProcessing';
import { resample } from '../airKey';
import { C, R, S, T } from '../generative';

/**
 * Make parts of the picture disappear, or appear, by interaction: a button
 * that hides or reveals everything with a fade, the mouse as a brush or a
 * spotlight, or a fingertip seen by the hand tracker. Its Invisible mode is
 * the "cloak": a person becomes see-through, with the room behind them and a
 * refracting edge, using the existing selection or body tracking for the shape.
 */

const GRID = 320;

export const revealStore = {
  mask: new Float32Array(0), gw: 0, gh: 0,
  level: 0, target: 0,
  plate: null as HTMLCanvasElement | null,
  captureNext: false,
  lastT: -1, lastWall: 0,
  /** Hide or reveal everything, with the fade set in the effect. */
  setAll(on: boolean) { this.target = on ? 1 : 0; this.animate(); },
  clear() { this.mask.fill(0); this.level = 0; this.target = 0; stagePointer.kick(); },
  capture() { this.captureNext = true; stagePointer.kick(); },
  forgetPlate() { this.plate = null; stagePointer.kick(); },
  animating: false,
  animate() {
    if (this.animating) return;
    this.animating = true;
    const step = () => {
      stagePointer.kick();
      if (Math.abs(this.level - this.target) > 0.002) requestAnimationFrame(step);
      else { this.level = this.target; this.animating = false; stagePointer.kick(); }
    };
    requestAnimationFrame(step);
  },
};

function ensureGrid(w: number, h: number) {
  const k = GRID / Math.max(w, h), gw = Math.max(8, Math.round(w * k)), gh = Math.max(8, Math.round(h * k));
  if (gw !== revealStore.gw || gh !== revealStore.gh) { revealStore.mask = new Float32Array(gw * gh); revealStore.gw = gw; revealStore.gh = gh; }
}

function stamp(x: number, y: number, radius: number, soft: number, value: number) {
  const { mask, gw, gh } = revealStore, cx = x * gw, cy = y * gh, r = radius * gw;
  for (let j = Math.max(0, Math.floor(cy - r)); j < Math.min(gh, Math.ceil(cy + r)); j++)
    for (let i = Math.max(0, Math.floor(cx - r)); i < Math.min(gw, Math.ceil(cx + r)); i++) {
      const d = Math.hypot(i - cx, j - cy) / r;
      if (d >= 1) continue;
      const a = soft > 0 ? Math.min(1, (1 - d) / soft) : 1, q = j * gw + i;
      mask[q] = value > 0 ? Math.max(mask[q], a) : Math.min(mask[q], 1 - a);
    }
}

/** Fills a region from what surrounds it, when there is no clean background yet. */
function fillAround(src: HTMLCanvasElement, w: number, h: number, hole: Float32Array) {
  const k = Math.max(1, Math.round(Math.max(w, h) / 160)), sw = Math.ceil(w / k), sh = Math.ceil(h / k), c = createCanvas(sw, sh), g = get2d(c, true);
  g.drawImage(src, 0, 0, sw, sh);
  const im = g.getImageData(0, 0, sw, sh), d = im.data, n = sw * sh, wt = new Float32Array(n), ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = y * sw + x, keep = 1 - hole[Math.min(h - 1, y * k) * w + Math.min(w - 1, x * k)];
    wt[i] = keep; for (let c2 = 0; c2 < 3; c2++) ch[c2][i] = d[i * 4 + c2] * keep;
  }
  const W = boxBlur(wt, sw, sh, 6, 3), Cb = ch.map((p) => boxBlur(p, sw, sh, 6, 3));
  for (let i = 0; i < n; i++) { const s = Math.max(1e-3, W[i]); for (let c2 = 0; c2 < 3; c2++) d[i * 4 + c2] = Cb[c2][i] / s; d[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  const out = createCanvas(w, h);
  get2d(out).drawImage(c, 0, 0, w, h);
  return out;
}

function subjectMask(p: ParamValues, frame: HTMLCanvasElement, w: number, h: number, time: number, key: unknown): Float32Array | null {
  const from = p.subject as string;
  if (from === 'selection') { const m = selection.union(time) ?? tracks.matte.at(time); return m ? resample(m, w, h) : null; }
  if (from === 'body') { const r = vision.poseIn(frame, key); return r?.mask ? resample({ w: r.mask.w, h: r.mask.h, data: r.mask.data }, w, h) : null; }
  return null;
}

export const reveal: EffectDefinition = {
  id: 'reveal', name: 'Invisible / Reveal', category: 'key',
  description: 'Hide or reveal parts of the picture with a button, the mouse or a fingertip. Invisible mode turns a person see-through.',
  supportsTransparency: true,
  animated: (p) => (p.fadeBack as number) > 0 || (p.wobble as number) > 0,
  params: [
    { key: 'controls', label: 'Activation', type: 'custom', editor: 'reveal', default: '', group: 'Activation' },
    S('mode', 'Mode', 'paint', [['paint', 'Paint To Hide'], ['scratch', 'Paint To Reveal (Scratch Card)'], ['cloak', 'Invisible Subject']], 'Activation'),
    { ...S('subject', 'Subject From', 'selection', [['selection', 'Selection Or Matte (Key)'], ['body', 'Body Tracking (Live Person)']], 'Activation'), visibleWhen: (v) => v.mode === 'cloak' },
    { ...T('startHidden', 'Start Hidden', false, 'Activation'), hint: 'The subject is invisible without pressing Hide All. Paint with Brush Restores to bring parts back.', visibleWhen: (v) => v.mode === 'cloak' },
    S('input', 'Interaction', 'drag', [['drag', 'Mouse: Drag To Paint'], ['hover', 'Mouse: Spotlight Follows Pointer'], ['hand', 'Hand: Index Fingertip'], ['none', 'Button Only']], 'Interaction'),
    { ...T('pinch', 'Paint Only While Pinching', false, 'Interaction'), visibleWhen: (v) => v.input === 'hand' },
    { ...T('erase', 'Brush Restores Instead', false, 'Interaction'), visibleWhen: (v) => v.input === 'drag' || v.input === 'hand' },
    R('brush', 'Brush Size', 0.01, 0.4, 0.005, 0.08, 'Interaction'),
    R('softness', 'Brush Softness', 0, 1, 0.01, 0.5, 'Interaction'),
    R('smooth', 'Smoothness', 0, 12, 0.5, 3, 'Look', 'Softens the edge of hidden areas.'),
    R('fade', 'Fade Transition', 0.05, 4, 0.05, 0.8, 'Look', 'Seconds the Hide All and Reveal All buttons take.'),
    R('fadeBack', 'Painted Areas Return After', 0, 20, 0.1, 0, 'Look', 'Seconds. 0 keeps painting until you clear it.'),
    S('behind', 'Hidden Areas Show', 'background', [['background', 'Background Behind'], ['color', 'Reveal Color'], ['blur', 'Frosted Blur'], ['image', 'Uploaded Image'], ['clear', 'Transparent']], 'Look'),
    { ...C('color', 'Reveal Color', '#c6ff2e', 'Look'), visibleWhen: (v) => v.behind === 'color' },
    { key: 'image', label: 'Image Underneath', type: 'images', default: '', max: 1, group: 'Look', visibleWhen: (v) => v.behind === 'image' },
    { ...T('learn', 'Learn Background Automatically', true, 'Look'), visibleWhen: (v) => v.behind === 'background' },
    R('distort', 'Distortion', 0, 40, 0.1, 10, 'Distortion', 'Bends what shows through, like looking through glass.'),
    R('edge', 'Edge Glow', 0, 1, 0.01, 0.35, 'Distortion'),
    C('edgeColor', 'Edge Color', '#bfefff', 'Distortion'),
    R('wobble', 'Shimmer', 0, 1, 0.01, 0.3, 'Distortion'),
  ],
  presets: [
    { name: 'Erase With Mouse', values: { mode: 'paint', input: 'drag', behind: 'background' } },
    { name: 'Scratch Card', values: { mode: 'scratch', input: 'drag', behind: 'color', color: '#c6ff2e', distort: 0, edge: 0 } },
    { name: 'Spotlight', values: { mode: 'scratch', input: 'hover', brush: 0.15, softness: 0.9, fadeBack: 0.6, behind: 'blur', distort: 0 } },
    { name: 'Invisible Person', values: { mode: 'cloak', subject: 'body', startHidden: true, input: 'none', distort: 14, edge: 0.4, wobble: 0.5 } },
    { name: 'Finger Painter', values: { mode: 'paint', input: 'hand', brush: 0.05, fadeBack: 4, behind: 'color', color: '#ff2fb0' } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const frameC = srcCanvas as HTMLCanvasElement, st = revealStore, mode = p.mode as string;
    ensureGrid(w, h);
    const now = performance.now(), dt = Math.min(0.25, st.lastWall ? (now - st.lastWall) / 1000 : 0);
    st.lastWall = now;
    // The button fade runs on the wall clock, so it works on a paused photo too.
    if (st.level !== st.target) { const step = dt / Math.max(0.05, p.fade as number); st.level = st.target > st.level ? Math.min(st.target, st.level + step) : Math.max(st.target, st.level - step); }
    if ((p.fadeBack as number) > 0 && dt > 0) { const k = Math.exp(-dt / (p.fadeBack as number)); for (let i = 0; i < st.mask.length; i++) st.mask[i] *= k; }

    // Input
    const input = p.input as string, rad = p.brush as number, soft = p.softness as number, sign = p.erase ? -1 : 1;
    const samples = stagePointer.take();
    if (input === 'drag') { let prev: { x: number; y: number } | null = null; for (const s of samples) { if (s.down) { if (prev) { const n2 = Math.ceil(Math.hypot(s.x - prev.x, s.y - prev.y) / (rad * 0.3)); for (let k = 1; k <= n2; k++) stamp(prev.x + ((s.x - prev.x) * k) / n2, prev.y + ((s.y - prev.y) * k) / n2, rad, soft, sign); } else stamp(s.x, s.y, rad, soft, sign); prev = s; } else prev = null; } }
    let spot: Float32Array | null = null;
    if (input === 'hover' && stagePointer.inside) { spot = new Float32Array(st.mask.length); const keep = st.mask; st.mask = spot; stamp(stagePointer.x, stagePointer.y, rad, soft, 1); st.mask = keep; }
    let tips: { x: number; y: number }[] = [];
    if (input === 'hand' && vision.ready('hands')) {
      const hands = vision.handsIn(frameC, `${time}|${frame}|${w}`);
      tips = hands.filter((hd) => !p.pinch || hd.pinch < 0.06).map((hd) => hd.tip);
      for (const t of tips) stamp(t.x, t.y, rad, soft, sign);
    }

    // Final hidden amount per pixel.
    const { gw, gh } = st, G = new Float32Array(gw * gh);
    for (let i = 0; i < G.length; i++) G[i] = Math.min(1, st.mask[i] + st.level + (spot ? spot[i] : 0));
    const Gs = (p.smooth as number) > 0 ? boxBlur(G, gw, gh, (p.smooth as number) * 0.5, 2) : G;
    const sub = mode === 'cloak' ? subjectMask(p, frameC, w, h, time, `${time}|${frame}|${w}`) : null;
    const hide = new Float32Array(w * h), kx = gw / w, ky = gh / h;
    for (let y = 0; y < h; y++) {
      const gy = Math.min(gh - 1, y * ky), y0 = gy | 0, y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = Math.min(gw - 1, x * kx), x0 = gx | 0, x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0;
        const a = Gs[y0 * gw + x0] + (Gs[y0 * gw + x1] - Gs[y0 * gw + x0]) * fx, b = Gs[y1 * gw + x0] + (Gs[y1 * gw + x1] - Gs[y1 * gw + x0]) * fx;
        let v = a + (b - a) * fy;
        if (mode === 'scratch') v = 1 - v;
        // Invisible: only the subject can vanish: where painted, after Hide All, or from the start.
        if (mode === 'cloak') v = sub ? sub[y * w + x] * Math.min(1, v + (p.startHidden ? 1 : 0)) : 0;
        hide[y * w + x] = Math.max(0, Math.min(1, v));
      }
    }

    // What shows through.
    const behind = p.behind as string;
    if (st.captureNext || (!st.plate || st.plate.width !== w || st.plate.height !== h) && behind === 'background') {
      const plate = st.captureNext ? (() => { const c = createCanvas(w, h); get2d(c).drawImage(frameC, 0, 0); return c; })() : fillAround(frameC, w, h, sub ?? hide);
      st.plate = plate;
      st.captureNext = false;
    } else if (behind === 'background' && p.learn && st.plate) {
      // Where nothing is hidden, the background is visible: blend it in slowly.
      const pg = get2d(st.plate, true), pd = pg.getImageData(0, 0, w, h), od = pd.data, sd = src.data, blocker = sub ?? hide;
      for (let i = 0; i < blocker.length; i++) { if (blocker[i] > 0.15) continue; const q = i * 4; for (let c = 0; c < 3; c++) od[q + c] += (sd[q + c] - od[q + c]) * 0.12; }
      pg.putImageData(pd, 0, 0);
    }
    let under: ImageData | null = null;
    if (behind === 'background' && st.plate) under = get2d(st.plate, true).getImageData(0, 0, w, h);
    else if (behind === 'blur') { const c = createCanvas(Math.ceil(w / 8), Math.ceil(h / 8)), g = get2d(c, true); g.filter = 'blur(3px)'; g.drawImage(frameC, 0, 0, c.width, c.height); const big = createCanvas(w, h), bg = get2d(big, true); bg.drawImage(c, 0, 0, w, h); under = bg.getImageData(0, 0, w, h); }
    else if (behind === 'image') { const a = assetStore.get(parseIds(p.image)[0] ?? ''); if (a) { const c = createCanvas(w, h), g = get2d(c, true); const s = Math.max(w / a.width, h / a.height); g.drawImage(a.el, (w - a.width * s) / 2, (h - a.height * s) / 2, a.width * s, a.height * s); under = g.getImageData(0, 0, w, h); } }
    const col = hexToRgb(p.color as string), ec = hexToRgb(p.edgeColor as string), sd = src.data, out = ctx.createImageData(w, h), o = out.data;
    const dist = (p.distort as number) * unit, edgeK = p.edge as number, wob = (p.wobble as number) * 2 * unit;
    const L = dist > 0 || edgeK > 0 ? boxBlur(sub ?? hide, w, h, 2 * unit, 1) : null;
    const Ls = dist > 0 ? boxBlur(toLuma(src), w, h, 3 * unit, 1) : null;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, q = i * 4, a = hide[i];
      if (a <= 0.001) { o[q] = sd[q]; o[q + 1] = sd[q + 1]; o[q + 2] = sd[q + 2]; o[q + 3] = sd[q + 3]; continue; }
      // Glass: what shows through is pushed by the hidden shape and its shading.
      let sx = x, sy = y;
      if (L && Ls && x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const gx = (L[i + 1] - L[i - 1]) * 6 + (Ls[i + 1] - Ls[i - 1]) * 3, gy = (L[i + w] - L[i - w]) * 6 + (Ls[i + w] - Ls[i - w]) * 3;
        sx = Math.round(x + gx * dist + Math.sin(y * 0.08 + time * 5) * wob * a); sy = Math.round(y + gy * dist + Math.cos(x * 0.07 + time * 4) * wob * a);
        sx = sx < 0 ? 0 : sx >= w ? w - 1 : sx; sy = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
      }
      const j = (sy * w + sx) * 4;
      let r: number, g: number, b: number, al = 255;
      if (behind === 'color') { r = col[0]; g = col[1]; b = col[2]; }
      else if (behind === 'clear') { r = sd[j]; g = sd[j + 1]; b = sd[j + 2]; al = 255 * (1 - a); }
      else if (under) { r = under.data[j]; g = under.data[j + 1]; b = under.data[j + 2]; }
      else { r = sd[j]; g = sd[j + 1]; b = sd[j + 2]; }
      const rim = L ? Math.min(1, Math.abs(L[i] - 0.5) < 0.35 ? (1 - Math.abs(L[i] - 0.5) / 0.35) * edgeK : 0) : 0;
      o[q] = sd[q] + (r - sd[q]) * a + (ec[0] - r) * rim * a;
      o[q + 1] = sd[q + 1] + (g - sd[q + 1]) * a + (ec[1] - g) * rim * a;
      o[q + 2] = sd[q + 2] + (b - sd[q + 2]) * a + (ec[2] - b) * rim * a;
      o[q + 3] = behind === 'clear' ? sd[q + 3] * (1 - a) + al * 0 : sd[q + 3];
    }
    ctx.putImageData(out, 0, 0);
    // Show where the brush is, so the hover and finger modes are usable.
    const show = input === 'hover' ? null : input === 'hand' ? tips : stagePointer.inside && input === 'drag' ? [{ x: stagePointer.x, y: stagePointer.y }] : [];
    if (show && show.length) {
      ctx.strokeStyle = 'rgba(198,255,46,.8)';
      ctx.lineWidth = Math.max(1, 1.2 * unit);
      for (const t of show) { ctx.beginPath(); ctx.arc(t.x * w, t.y * h, rad * w, 0, 6.2832); ctx.stroke(); }
    }
  },
};
