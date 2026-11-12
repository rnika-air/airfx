import { ai, frameData, type GrayMap } from './client';
import { estimateMotion, flowField, grayOf, warpByFlow, type Gray } from './motion';
import { fillHoles, keepConnected, selection, sourceKeyOf, type FrameFlag, type SelObject } from './selection';
import { resample } from '../effects/airKey';
import { disposeVideo, loadVideo, seekVideo } from '../utils/videoProcessing';
import type { LoadedMedia } from '../hooks/useMedia';

const TRACK_EDGE = 640;
const GRAY_W = 240;

interface Box { x0: number; y0: number; x1: number; y1: number; area: number; cx: number; cy: number }

function boxOf(d: Float32Array, w: number, h: number): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0, sx = 0, sy = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (d[y * w + x] <= 0.5) continue;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  return area ? { x0, y0, x1, y1, area, cx: sx / area, cy: sy / area } : null;
}

function iou(a: Float32Array, b: Float32Array) {
  let i = 0, u = 0;
  for (let k = 0; k < a.length; k++) { const p = a[k] > 0.5, q = b[k] > 0.5; if (p && q) i++; if (p || q) u++; }
  return u ? i / u : 0;
}

/** Move a mask by a shift and zoom about (cx, cy). */
function moved(d: Float32Array, w: number, h: number, dx: number, dy: number, scale: number, cx: number, cy: number) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.round((x - dx - cx) / scale + cx), sy = Math.round((y - dy - cy) / scale + cy);
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) o[y * w + x] = d[sy * w + sx];
    }
  return o;
}

function meanColor(img: ImageData, mask: Float32Array) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 0.5) { r += img.data[i * 4]; g += img.data[i * 4 + 1]; b += img.data[i * 4 + 2]; n++; }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

const colorDistance = (a: number[], b: number[]) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;

/** Centre of the object's colour near an expected position, if enough of it shows. */
function findByColor(img: ImageData, color: number[], cx: number, cy: number, b: Box, refArea: number, w: number, h: number): [number, number] | null {
  const rx = (b.x1 - b.x0) * 0.7 + 4, ry = (b.y1 - b.y0) * 0.7 + 4, step = 3;
  let sx = 0, sy = 0, n = 0;
  for (let y = Math.max(0, (cy - ry) | 0); y < Math.min(h, cy + ry); y += step)
    for (let x = Math.max(0, (cx - rx) | 0); x < Math.min(w, cx + rx); x += step) {
      const i = (y * w + x) * 4, d = (Math.abs(img.data[i] - color[0]) + Math.abs(img.data[i + 1] - color[1]) + Math.abs(img.data[i + 2] - color[2])) / 3;
      if (d < 38) { sx += x; sy += y; n++; }
    }
  return n * step * step > refArea * 0.2 ? [sx / n, sy / n] : null;
}

/** Up to three prompt points well inside the mask and spread apart. */
function innerPoints(d: Float32Array, w: number, h: number, b: Box) {
  const pts: [number, number][] = [], step = Math.max(2, Math.round(Math.max(b.x1 - b.x0, b.y1 - b.y0) / 14));
  const cand: { x: number; y: number; s: number }[] = [];
  const clear = step * 2;
  for (let y = b.y0; y <= b.y1; y += step)
    for (let x = b.x0; x <= b.x1; x += step) {
      if (d[y * w + x] <= 0.5) continue;
      let ok = 0;
      for (const [ax, ay] of [[clear, 0], [-clear, 0], [0, clear], [0, -clear]]) {
        const px = x + ax, py = y + ay;
        if (px >= 0 && py >= 0 && px < w && py < h && d[py * w + px] > 0.5) ok++;
      }
      cand.push({ x, y, s: ok });
    }
  cand.sort((p, q) => q.s - p.s || Math.hypot(p.x - b.cx, p.y - b.cy) - Math.hypot(q.x - b.cx, q.y - b.cy));
  for (const c of cand) {
    if (pts.every(([x, y]) => Math.hypot(x - c.x, y - c.y) > Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.2)) pts.push([c.x, c.y]);
    if (pts.length === 3) break;
  }
  return pts;
}

/**
 * Share of the masked pixels that look the same as last frame, once the motion
 * is taken out. This tells occlusion from under-segmentation: something moving
 * in front changes the pixels, and the model leaving part out does not.
 */
function unchangedShare(now: ImageData, before: ImageData, mask: Float32Array, w: number, h: number, dx: number, dy: number) {
  let same = 0, seen = 0;
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      if (mask[y * w + x] <= 0.5) continue;
      const px = Math.round(x - dx), py = Math.round(y - dy);
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const a = (y * w + x) * 4, b = (py * w + px) * 4;
      seen++;
      if (Math.abs(now.data[a] - before.data[b]) + Math.abs(now.data[a + 1] - before.data[b + 1]) + Math.abs(now.data[a + 2] - before.data[b + 2]) < 60) same++;
    }
  return seen ? same / seen : 0;
}

/** Marks every pixel within a square of radius r of the mask. */
function grown(mask: Float32Array, w: number, h: number, r: number) {
  const W = w + 1, sum = new Int32Array(W * (h + 1)), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sum[(y + 1) * W + x + 1] = (mask[y * w + x] > 0.5 ? 1 : 0) + sum[y * W + x + 1] + sum[(y + 1) * W + x] - sum[y * W + x];
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      if (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0] > 0) out[y * w + x] = 1;
    }
  }
  return out;
}

export interface TrackResult { lost: number[]; stoppedAt: number | null }

/**
 * Follows one object. Each frame's prompts come from where the object moved
 * to, and the answer is compared with that prediction, so the tracker cannot
 * jump to a different object. When the object is hidden it keeps a prediction
 * going, picks the object up again when it returns, and stops with a warning
 * if it stays lost.
 */
export async function trackObject(opts: {
  media: LoadedMedia; object: SelObject; fps: number; fromTime: number; resume: boolean; smooth: number;
  signal: AbortSignal; onProgress: (f: number, note: string) => void;
}): Promise<TrackResult> {
  const { media, object: o, fps, signal } = opts;
  const anchorMap = o.track.at(opts.fromTime);
  if (!anchorMap) throw new Error('Select the object first.');
  const v = await loadVideo(media.url);
  v.loop = false;
  v.muted = true;
  try {
    const count = Math.max(1, Math.floor(v.duration * fps));
    const a = Math.min(count - 1, Math.round(opts.fromTime * fps));
    const k = TRACK_EDGE / Math.max(media.width, media.height), w = Math.round(media.width * Math.min(1, k)), h = Math.round(media.height * Math.min(1, k));
    const anchor = new Float32Array(resample(anchorMap, w, h));
    const frames: GrayMap[] = new Array(count);
    const flags: FrameFlag[] = new Array(count).fill('weak');
    // On resume, keep what came before the corrected frame.
    const kept = opts.resume && o.track.frames.length === count && o.track.fps === fps;
    if (kept) for (let i = 0; i < a; i++) { frames[i] = o.track.frames[i]; flags[i] = o.flags[i] ?? 'ok'; }
    frames[a] = { w, h, data: anchor };
    flags[a] = 'ok';

    const grayAtImage = async (i: number) => {
      await seekVideo(v, Math.min(v.duration - 0.01, i / fps));
      return frameData(v, v.videoWidth, v.videoHeight, TRACK_EDGE);
    };
    let total = count - a - 1 + (kept ? 0 : a), done = 0;
    let stoppedAt: number | null = null, shrunk = 0;
    const lost: number[] = [];

    const run = async (dir: 1 | -1) => {
      const firstImage = await grayAtImage(a);
      // What the object looks like: its size and colour. Answers are checked against these.
      const startBox = boxOf(anchor, w, h);
      if (!startBox) throw new Error('The selection is empty on this frame.');
      let refArea = startBox.area, refColor = meanColor(firstImage, anchor);
      let mem = anchor, shown = anchor, missed = 0, vx = 0, vy = 0;
      // The last time the whole object was seen. A half-hidden shape's centre lags
      // behind the real object, so predictions start from here and not from it.
      let whole = anchor, wholeBox = startBox;
      const history: [number, number, number][] = [[a, startBox.cx, startBox.cy]];
      let prevGray: Gray = grayOf(firstImage, GRAY_W), prevImage = firstImage;
      for (let i = a + dir; i >= 0 && i < count; i += dir) {
        if (signal.aborted) throw new DOMException('cancelled', 'AbortError');
        const image = await grayAtImage(i), gray = grayOf(image, GRAY_W), s = w / GRAY_W;
        const memBox = boxOf(mem, w, h);
        let predicted = mem, pure = mem, shiftX = 0, shiftY = 0;
        const last = history[history.length - 1], steps = Math.abs(i - last[0]);
        const expectX = last[1] + vx * steps, expectY = last[2] + vy * steps;
        if (memBox) {
          if (missed === 0) {
            const m = estimateMotion(prevGray, gray, (x, y) => mem[Math.min(h - 1, Math.round(y * s)) * w + Math.min(w - 1, Math.round(x * s))] > 0.5, memBox.cx / s, memBox.cy / s, Math.max(4, Math.round(Math.sqrt(memBox.area) / s / 8)));
            shiftX = m.dx * s;
            shiftY = m.dy * s;
            predicted = moved(mem, w, h, m.dx * s, m.dy * s, m.inliers > 0.4 ? Math.min(1.25, Math.max(0.8, m.scale)) : 1, memBox.cx, memBox.cy);
          } else {
            // Hidden: keep moving at the last known speed, and look nearby for its colour.
            pure = moved(whole, w, h, expectX - wholeBox.cx, expectY - wholeBox.cy, 1, wholeBox.cx, wholeBox.cy);
            const seen = findByColor(image, refColor, expectX, expectY, wholeBox, refArea, w, h);
            predicted = seen ? moved(whole, w, h, seen[0] - wholeBox.cx, seen[1] - wholeBox.cy, 1, wholeBox.cx, wholeBox.cy) : pure;
          }
        }
        const box = boxOf(predicted, w, h);
        let flag: FrameFlag = 'lost', out: Float32Array = predicted, accepted: Float32Array | null = null;
        if (box) {
          const key = `${sourceKeyOf(media)}#t${i}`;
          await ai.samEncode(key, image);
          const padX = (box.x1 - box.x0) * 0.08 + 4, padY = (box.y1 - box.y0) * 0.08 + 4;
          const points = innerPoints(predicted, w, h, box);
          // Neither prompt wins everywhere: one point fits most frames, several hold
          // objects made of parts. Ask both ways and keep what fits the prediction.
          const prompts = points.length > 1 ? [points.slice(0, 1), points] : [points.length ? points : [[box.cx, box.cy]]];
          let soft: Float32Array = predicted, sourcePoints: number[][] = prompts[0], objectScore = 0, bestScore = -1, bestIou = 0;
          for (const prompt of prompts) {
            const r = await ai.samDecode({
              frameKey: key,
              points: prompt,
              labels: prompt.map(() => 1),
              box: [Math.max(0, box.x0 - padX), Math.max(0, box.y0 - padY), Math.min(w - 1, box.x1 + padX), Math.min(h - 1, box.y1 + padY)],
            });
            r.planes.forEach((pl, n) => {
              const ov = iou(pl, predicted), score = ov * 0.75 + Math.max(0, r.scores[n]) * 0.25;
              if (score > bestScore) { bestScore = score; bestIou = ov; soft = pl; sourcePoints = prompt; objectScore = r.objectScore; }
            });
          }
          const seeds = sourcePoints.map(([x, y]) => [x / w, y / h] as [number, number]);
          const kept = keepConnected(soft, w, h, seeds).slice();
          if (missed === 0) {
            // The model can leak onto plain background, and the next prompt box would
            // then be built from the leak. Only motion can move the object, so a mask
            // may not spread further past the prediction than motion can explain.
            const reachOut = Math.round(Math.max(6, Math.hypot(shiftX, shiftY) * 1.5 + Math.sqrt(refArea) * 0.03));
            const near = grown(predicted, w, h, reachOut);
            for (let q = 0; q < kept.length; q++) if (!near[q]) kept[q] = 0;
          }
          // Is the object still where it should be? If the pixels there have not
          // changed, a small answer means the model left part out, not that it is hidden.
          const present = missed === 0 && unchangedShare(image, prevImage, predicted, w, h, shiftX, shiftY) >= 0.6;
          // Where the model is unsure, trust the prediction. Wall pixels score near zero, so this cannot creep.
          if (missed === 0) for (let q = 0; q < kept.length; q++) if (kept[q] <= 0.5 && predicted[q] > 0.5 && soft[q] > 0.2) kept[q] = 0.6;
          let cand = fillHoles(kept, w, h), candBox = boxOf(cand, w, h);
          if (present && (candBox?.area ?? 0) < refArea * 0.65) {
            // Still too small: carry the prediction across this frame.
            cand = cand.slice();
            for (let q = 0; q < cand.length; q++) if (predicted[q] > cand[q]) cand[q] = predicted[q];
            candBox = boxOf(cand, w, h);
          }
          const area = candBox?.area ?? 0, ratio = area / refArea;
          const colorOk = !!candBox && colorDistance(meanColor(image, cand), refColor) < 42;
          let overlap = 0;
          if (candBox) { for (let q = 0; q < cand.length; q++) if (cand[q] > 0.5 && predicted[q] > 0.5) overlap++; overlap /= area; }
          // After being hidden, the object must come back where its motion says it should.
          // The allowance grows slowly with time hidden, because speed is only an estimate.
          const size = Math.sqrt(refArea), reach = size * 0.35 + Math.hypot(vx, vy) * steps * 0.15;
          const inPlace = missed === 0 || (!!candBox && Math.hypot(candBox.cx - expectX, candBox.cy - expectY) < reach);
          if (present && candBox && objectScore >= 0 && ratio <= 1.6 && overlap > 0.5) {
            flag = ratio >= 0.65 && bestIou >= 0.55 && colorOk ? 'ok' : 'weak';
            out = cand;
            accepted = cand;
          } else if (objectScore < 0 || !candBox || !colorOk || !inPlace) {
            // Nothing there that looks like the object: it is behind something.
            flag = 'occluded';
            out = new Float32Array(w * h);
          } else if (ratio >= 0.65 && ratio <= 1.6 && bestIou >= (missed ? 0.55 : 0.3)) {
            // Coming back from hidden takes a confident match: a weak one is more
            // often something next to the occluder than the object itself.
            flag = bestIou < 0.55 ? 'weak' : 'ok';
            out = cand;
            accepted = cand;
          } else if (ratio < 0.65 && overlap > 0.5) {
            // A visible part of the object: show it, but keep the whole shape in memory.
            flag = 'occluded';
            out = cand;
          } else if (missed) {
            flag = 'occluded';
            out = new Float32Array(w * h);
          } else {
            // Too big, or somewhere else: a different object. Refuse it.
            flag = 'lost';
            out = predicted;
          }
        }
        if (accepted) {
          const b0 = boxOf(accepted, w, h)!;
          // Speed comes from whole views only: a half-hidden shape's centre sits in the wrong place.
          if (b0.area > refArea * 0.85 && flag === 'ok') {
            whole = accepted;
            wholeBox = b0;
            history.push([i, b0.cx, b0.cy]);
            if (history.length > 8) history.shift();
            const f0 = history[0], f1 = history[history.length - 1], span = Math.abs(f1[0] - f0[0]);
            if (span) { vx = (f1[1] - f0[1]) / span; vy = (f1[2] - f0[2]) / span; }
          }
          refArea = refArea * 0.9 + b0.area * 0.1;
          const col = meanColor(image, accepted);
          refColor = refColor.map((v, c) => v * 0.9 + col[c] * 0.1);
          mem = accepted;
          missed = 0;
          if (opts.smooth > 0) {
            const f = flowField(prevGray, gray), warped = warpByFlow(shown, w, h, f, GRAY_W);
            const blended = new Float32Array(w * h);
            for (let q = 0; q < blended.length; q++) blended[q] = out[q] * (1 - opts.smooth) + warped[q] * opts.smooth;
            out = blended;
          }
        } else {
          // Stay on the motion path, not on anything a guess was drawn to.
          mem = missed === 0 ? predicted : pure;
          missed++;
          lost.push(i);
        }
        // Size memory adapts as an object moves, so a mask that slowly loses a part
        // can still look normal. Measure against the size the user selected too.
        if (flag === 'ok' && accepted && (boxOf(accepted, w, h)?.area ?? 0) < startBox.area * 0.7) { flag = 'weak'; shrunk++; }
        shown = out;
        frames[i] = { w, h, data: out };
        flags[i] = flag;
        prevGray = gray;
        prevImage = image;
        done++;
        opts.onProgress(done / Math.max(1, total), `Frame ${i + 1} of ${count}`);
        if (missed > Math.max(6, fps * 3)) {
          // Point at where it went missing, not at where the tracker gave up.
          stoppedAt = i - dir * (missed - 1);
          total = done;
          for (let q = i + dir; q >= 0 && q < count; q += dir) { frames[q] = { w, h, data: new Float32Array(w * h) }; flags[q] = 'lost'; }
          return;
        }
      }
    };
    await run(1);
    if (!kept && stoppedAt === null) await run(-1);
    else if (!kept) { const stop = stoppedAt; await run(-1); stoppedAt = stop; }

    o.track.frames = frames;
    o.track.fps = fps;
    o.track.sourceKey = sourceKeyOf(media);
    o.track.kind = 'model';
    o.track.version++;
    o.flags = flags;
    const lostCount = flags.filter((f) => f === 'lost').length, hiddenCount = flags.filter((f) => f === 'occluded').length;
    selection.warning = stoppedAt !== null
      ? `Tracking lost the object at ${(stoppedAt / fps).toFixed(2)} s. Go to that frame, correct the selection, then press Resume From Here.`
      : lostCount ? `${lostCount} frame${lostCount === 1 ? ' needs' : 's need'} checking (red below).${hiddenCount ? ` Hidden for ${hiddenCount} frames.` : ''}`
      : hiddenCount ? `The object was hidden for ${hiddenCount} frames (blue below). Check that it was picked up correctly afterwards.`
      : shrunk > count * 0.1 ? `The mask is much smaller than your selection on ${shrunk} frames (amber below). It may have lost part of the object. If the subject has separate parts, such as a hand and what it holds, select each with + New Object and track them one at a time.`
      : null;
    selection.bump();
    return { lost, stoppedAt };
  } finally {
    disposeVideo(v);
  }
}
