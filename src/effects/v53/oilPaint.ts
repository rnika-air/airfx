import type { EffectDefinition } from '../types';
import { createCanvas, get2d, valueNoise } from '../../utils/imageProcessing';
import { R, T } from '../generative';
import { Steady } from '../tone';

/**
 * Oil Paint, in three real steps:
 *  1. Paint: a generalized Kuwahara filter. Around every pixel, four
 *     overlapping squares are measured (colour mean and variance, from
 *     summed-area tables); calm squares count far more than busy ones, so
 *     flat areas merge into strokes of paint while edges stay crisp.
 *  2. Strokes: streaky noise stretched along the picture's own contours
 *     (across the brightness gradient), as brush marks would be.
 *  3. Impasto: the paint's thickness lit from one side, plus canvas weave.
 * Step 1 runs on a copy at most 1600 px long (paint has no fine detail to
 * lose); steps 2 and 3 run at full size, so a 4K export keeps sharp texture.
 */

const MAX_WORK = 1600;
const steady = new Steady();

export const oilPaint: EffectDefinition = {
  id: 'oilPaint', name: 'Oil Paint', category: 'texture',
  description: 'Thick oil paint: colours merge into brush strokes that follow the forms, lit like real impasto on canvas.',
  params: [
    R('brush', 'Brush Size', 1, 24, 0.1, 8, 'Paint'),
    R('sharpness', 'Edge Sharpness', 1, 16, 0.1, 8, 'Paint', 'Higher keeps edges crisper.'),
    R('saturation', 'Saturation', 0, 2, 0.01, 1.15, 'Paint'),
    R('strokes', 'Brush Marks', 0, 1, 0.01, 0.65, 'Strokes'),
    R('length', 'Stroke Length', 1, 12, 0.1, 5, 'Strokes'),
    R('relief', 'Impasto', 0, 1.5, 0.01, 0.75, 'Light', 'How thick the paint looks.'),
    R('light', 'Light Angle', 0, 360, 1, 135, 'Light'),
    R('canvas', 'Canvas Weave', 0, 1, 0.01, 0.14, 'Light'),
    { ...T('steady', 'Steady On Video', true, 'Paint'), hint: 'Paint that did not change keeps its strokes from the frame before, so video does not boil.' },
  ],
  presets: [
    { name: 'Gallery Oil', values: { brush: 8, sharpness: 8, strokes: 0.65, relief: 0.75, canvas: 0.14 } },
    { name: 'Palette Knife', values: { brush: 12, sharpness: 10, strokes: 0.3, length: 9, relief: 1.1, canvas: 0.1 } },
    { name: 'Soft Gouache', values: { brush: 4, sharpness: 4, strokes: 0.25, relief: 0.2, canvas: 0.35, saturation: 1.05 } },
    { name: 'Expressionist', values: { brush: 16, sharpness: 9, strokes: 0.9, length: 4, relief: 0.9, saturation: 1.5 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    // 1. Paint, on the working copy.
    const k = Math.min(1, MAX_WORK / Math.max(w, h)), ww = Math.max(1, Math.round(w * k)), wh = Math.max(1, Math.round(h * k));
    const work = createCanvas(ww, wh), wg = get2d(work, true);
    wg.imageSmoothingQuality = 'high';
    wg.drawImage(srcCanvas, 0, 0, ww, wh);
    const im = wg.getImageData(0, 0, ww, wh), d = im.data;
    const W1 = ww + 1, n = W1 * (wh + 1);
    const sr = new Int32Array(n), sg = new Int32Array(n), sb = new Int32Array(n), sl = new Int32Array(n), sq = new Float64Array(n);
    for (let y = 0; y < wh; y++) {
      let ar = 0, ag = 0, ab = 0, al = 0, aq = 0;
      for (let x = 0; x < ww; x++) {
        const i = (y * ww + x) * 4, l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
        ar += d[i]; ag += d[i + 1]; ab += d[i + 2]; al += l; aq += l * l;
        const a = (y + 1) * W1 + x + 1, b = y * W1 + x + 1;
        sr[a] = sr[b] + ar; sg[a] = sg[b] + ag; sb[a] = sb[b] + ab; sl[a] = sl[b] + al; sq[a] = sq[b] + aq;
      }
    }
    const rad = Math.max(1, Math.round((p.brush as number) * unit * k)), q = p.sharpness as number;
    const paint = new Float32Array(ww * wh * 3), lum = new Float32Array(ww * wh);
    const qs = [[-rad, -rad], [0, -rad], [-rad, 0], [0, 0]];
    const sat = p.saturation as number;
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        let tr = 0, tg = 0, tb = 0, tw = 0;
        for (let s = 0; s < 4; s++) {
          const x0 = Math.max(0, x + qs[s][0]), y0 = Math.max(0, y + qs[s][1]);
          const x1 = Math.min(ww, x + qs[s][0] + rad + 1), y1 = Math.min(wh, y + qs[s][1] + rad + 1);
          const A = y0 * W1 + x0, B = y0 * W1 + x1, Cc = y1 * W1 + x0, D = y1 * W1 + x1, cnt = (x1 - x0) * (y1 - y0);
          const ml = (sl[D] - sl[B] - sl[Cc] + sl[A]) / cnt;
          const v = Math.max(0, (sq[D] - sq[B] - sq[Cc] + sq[A]) / cnt - ml * ml);
          // Calm squares win: weight falls steeply with the spread of brightness (as in Papari's generalized Kuwahara).
          const wt = (1 + Math.sqrt(v)) ** -q;
          tr += wt * (sr[D] - sr[B] - sr[Cc] + sr[A]) / cnt;
          tg += wt * (sg[D] - sg[B] - sg[Cc] + sg[A]) / cnt;
          tb += wt * (sb[D] - sb[B] - sb[Cc] + sb[A]) / cnt;
          tw += wt;
        }
        let r = tr / tw, g = tg / tw, b = tb / tw;
        const l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
        const o = y * ww + x;
        paint[o * 3] = r; paint[o * 3 + 1] = g; paint[o * 3 + 2] = b; lum[o] = l;
      }
    }
    if (p.steady === true) {
      // On video, pixels whose source barely changed keep last frame's paint.
      const inp = new Float32Array(ww * wh * 3);
      for (let i = 0, j = 0; i < ww * wh; i++, j += 4) { inp[i * 3] = d[j] / 255; inp[i * 3 + 1] = d[j + 1] / 255; inp[i * 3 + 2] = d[j + 2] / 255; }
      steady.apply(`${ww}x${wh}|${JSON.stringify(p)}`, time, inp, 3, paint, 3, 0.05);
      for (let i = 0; i < ww * wh; i++) lum[i] = 0.299 * paint[i * 3] + 0.587 * paint[i * 3 + 1] + 0.114 * paint[i * 3 + 2];
    }
    // Stroke direction: along the contours of the paint (perpendicular to its gradient).
    const dir = new Float32Array(ww * wh * 2);
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(ww - 1, x + 1), ym = Math.max(0, y - 1), yp = Math.min(wh - 1, y + 1);
        const gx = lum[y * ww + xp] - lum[y * ww + xm], gy = lum[yp * ww + x] - lum[ym * ww + x];
        const len = Math.hypot(gx, gy);
        const o = (y * ww + x) * 2;
        // Flat areas get a gentle diagonal, as a painter fills a background.
        if (len < 2) { dir[o] = 0.8; dir[o + 1] = -0.6; } else { dir[o] = -gy / len; dir[o + 1] = gx / len; }
      }
    }
    for (let i = 0, j = 0; i < ww * wh; i++, j += 4) { d[j] = paint[i * 3]; d[j + 1] = paint[i * 3 + 1]; d[j + 2] = paint[i * 3 + 2]; d[j + 3] = 255; }
    wg.putImageData(im, 0, 0);

    // 2 and 3, at full size: the paint scaled up, then marked and lit.
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work, 0, 0, w, h);
    work.width = work.height = 1;
    const out = ctx.getImageData(0, 0, w, h), o = out.data;
    const strokes = p.strokes as number, relief = p.relief as number, weave = p.canvas as number;
    if (strokes <= 0 && relief <= 0 && weave <= 0) return;
    const sw = Math.max(1.5, (p.brush as number) * 1.1) * unit, sl2 = sw * (p.length as number);
    const la = ((p.light as number) * Math.PI) / 180, lx = Math.cos(la), ly = Math.sin(la);
    const height = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const wy = Math.min(wh - 1, (y * k) | 0);
      for (let x = 0; x < w; x++) {
        const wx = Math.min(ww - 1, (x * k) | 0), di = (wy * ww + wx) * 2, ux = dir[di], uy = dir[di + 1];
        // Coordinates along and across the stroke.
        const a = (x * ux + y * uy) / sl2, b = (-x * uy + y * ux) / sw;
        // One stroke per brush width across, bristle grooves inside it.
        const mark = strokes > 0 ? valueNoise(a, b, 11) * 0.75 + valueNoise(a * 1.7, b * 4, 29) * 0.25 : 0.5;
        const i = (y * w + x) * 4, l = (o[i] * 0.299 + o[i + 1] * 0.587 + o[i + 2] * 0.114) / 255;
        height[y * w + x] = l * 0.6 + (mark - 0.5) * strokes;
      }
    }
    const ws = unit * 2.2;
    for (let y = 0; y < h; y++) {
      const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
      for (let x = 0; x < w; x++) {
        const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1), i = (y * w + x) * 4;
        // Light on the paint's slopes: brighter where it faces the light.
        const nx = (height[y * w + xp] - height[y * w + xm]) / unit, ny = (height[yp * w + x] - height[ym * w + x]) / unit;
        let lit = (nx * -lx + ny * -ly) * (relief + strokes * 0.25) * 70;
        if (weave > 0) {
          // A plain canvas weave: threads crossing over and under.
          const tx = x / ws, ty = y / ws, cell = ((tx | 0) + (ty | 0)) & 1;
          const t = cell ? Math.sin((tx % 1) * Math.PI) : Math.sin((ty % 1) * Math.PI);
          lit += (t - 0.6) * weave * 34;
        }
        o[i] += lit; o[i + 1] += lit; o[i + 2] += lit;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
