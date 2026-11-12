import type { EffectDefinition, ParamValues } from '../types';
import { audioBus } from '../../engine/audio';
import { clamp255, createCanvas, createRng, get2d, hash2 } from '../../utils/imageProcessing';
import { C, R, S } from '../generative';

/**
 * A conductor for glitch, not a single trick. A timing stage decides when a
 * burst fires and how hard. All the damage stages then read from one pattern,
 * so the tears, sort and colour shifts land on the same bands together, as a
 * real signal failure does. The base Glitch effect stays as the simple option.
 */

let held: { w: number; h: number; t: number; buf: Uint32Array } | null = null;

interface Span { a: number; b: number; shift: number; pick: number }

/** Bands of the frame that this tick damages. Everything reads the same list. */
function pattern(kind: string, count: number, size: number, rng: () => number, tick: number, len: number): Span[] {
  const out: Span[] = [];
  if (kind === 'sweep') {
    const at = ((tick * 0.07) % 1.2) - 0.1, span = Math.max(4, size * 1.4);
    for (let i = 0; i < count; i++) { const a = (at + (i / count) * 0.25) * len; out.push({ a, b: a + span * (0.3 + rng()), shift: rng() * 2 - 1, pick: rng() }); }
  } else if (kind === 'bands') {
    const b = Math.max(2, Math.round(len / Math.max(1, count)));
    for (let a = 0; a < len; a += b) if (rng() < 0.55) out.push({ a, b: a + b, shift: rng() * 2 - 1, pick: rng() });
  } else {
    for (let i = 0; i < count; i++) { const a = rng() * len; out.push({ a, b: a + size * (0.2 + rng() * rng() * 3), shift: rng() * 2 - 1, pick: rng() }); }
  }
  return out;
}

const shiftRow = (b: Uint32Array, t: Uint32Array, w: number, y: number, d: number) => { const r = y * w; d = ((d % w) + w) % w; for (let x = 0; x < w; x++) t[x] = b[r + ((x - d + w) % w)]; b.set(t.subarray(0, w), r); };
const shiftCol = (b: Uint32Array, t: Uint32Array, w: number, h: number, x: number, d: number) => { d = ((d % h) + h) % h; for (let y = 0; y < h; y++) t[y] = b[((y - d + h) % h) * w + x]; for (let y = 0; y < h; y++) b[y * w + x] = t[y]; };

/** Sorts a run of pixels by brightness. */
function sortRun(b: Uint32Array, idx: (i: number) => number, from: number, to: number, reverse: boolean, lo: number, hi: number) {
  const key = (v: number) => (v & 255) * 0.3 + ((v >> 8) & 255) * 0.59 + ((v >> 16) & 255) * 0.11;
  let start = -1;
  const flush = (end: number) => {
    if (end - start > 2) {
      const a: number[] = [];
      for (let i = start; i < end; i++) a.push(b[idx(i)]);
      a.sort((x, y) => (reverse ? key(y) - key(x) : key(x) - key(y)));
      for (let i = start; i < end; i++) b[idx(i)] = a[i - start];
    }
    start = -1;
  };
  for (let i = from; i < to; i++) {
    const k = key(b[idx(i)]);
    if (k >= lo && k <= hi) { if (start < 0) start = i; } else if (start >= 0) flush(i);
  }
  if (start >= 0) flush(to);
}

const needs = (k: string) => (v: ParamValues) => (v[k] as number) > 0;

export const glitch2: EffectDefinition = {
  id: 'glitch2', name: 'Glitch 2.0', category: 'distortion',
  description: 'Timed bursts of digital failure: RGB split, displacement, pixel sort, tearing, mosh, frame damage, noise and scanlines.',
  animated: () => true,
  audioDefaults: { intensity: { band: 'beat', amount: 0.3 } },
  params: [
    R('intensity', 'Glitch Intensity', 0, 1, 0.01, 0.65, 'Master'),
    S('timing', 'Timing', 'bursts', [['always', 'Always On'], ['bursts', 'Random Bursts'], ['pulse', 'Even Pulse'], ['beat', 'On The Beat']], 'Timing'),
    R('speed', 'Glitch Speed', 0.5, 60, 0.5, 14, 'Timing', 'New patterns per second.'),
    { ...R('frequency', 'Burst Frequency', 0.1, 12, 0.05, 2, 'Timing', 'Bursts per second.'), visibleWhen: (v) => v.timing === 'bursts' || v.timing === 'pulse' },
    { ...R('burstLength', 'Burst Length', 0.02, 1, 0.01, 0.4, 'Timing', 'Share of each cycle that is damaged.'), visibleWhen: (v) => v.timing === 'bursts' || v.timing === 'pulse' },
    S('direction', 'Direction', 'horizontal', [['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['both', 'Both']], 'Pattern'),
    S('pattern', 'Glitch Pattern', 'random', [['random', 'Random Spans'], ['bands', 'Even Bands'], ['sweep', 'Rolling Sweep']], 'Pattern'),
    R('spans', 'Glitch Frequency', 1, 60, 1, 7, 'Pattern', 'How many damaged spans per pattern.'),
    R('spanSize', 'Span Size', 2, 300, 1, 34, 'Pattern'),
    { key: 'seed', label: 'Seed', type: 'seed', default: 7, group: 'Pattern' },
    R('rgb', 'RGB Separation', 0, 100, 0.5, 10, 'RGB & Color'),
    { ...R('rgbAngle', 'Separation Angle', 0, 359, 1, 0, 'RGB & Color'), visibleWhen: needs('rgb') },
    R('channelShift', 'Color Channel Shift', 0, 1, 0.01, 0.25, 'RGB & Color', 'Swaps the colour channels inside damaged spans.'),
    R('burn', 'Signal Burn', 0, 1, 0.01, 0.15, 'RGB & Color', 'Crushes contrast and clips highlights, like an overdriven feed.'),
    R('displace', 'Digital Displacement', 0, 300, 1, 55, 'Displacement'),
    R('tearH', 'Horizontal Tearing', 0, 200, 1, 14, 'Tearing'),
    R('tearV', 'Vertical Tearing', 0, 200, 1, 0, 'Tearing'),
    R('tearSize', 'Tear Detail', 1, 40, 0.5, 6, 'Tearing'),
    R('sort', 'Pixel Sorting', 0, 1, 0.01, 0.25, 'Pixel Sorting'),
    { ...R('sortLow', 'Sort From Tone', 0, 1, 0.01, 0.18, 'Pixel Sorting'), visibleWhen: needs('sort') },
    { ...R('sortHigh', 'Sort To Tone', 0, 1, 0.01, 0.92, 'Pixel Sorting'), visibleWhen: needs('sort') },
    R('mosh', 'Datamosh Melt', 0, 1, 0.01, 0.3, 'Datamosh', 'Blocks stick to earlier frames and drift.'),
    { ...R('moshBlock', 'Mosh Block Size', 4, 100, 1, 24, 'Datamosh'), visibleWhen: needs('mosh') },
    R('frameDamage', 'Frame Distortion', 0, 1, 0.01, 0.2, 'Frame', 'Knocks the whole frame: roll, skew and zoom.'),
    R('noise', 'Digital Noise', 0, 1, 0.01, 0.08, 'Noise & Lines'),
    C('noiseColor', 'Noise Tint', '#ffffff', 'Noise & Lines'),
    R('scan', 'Scanlines', 0, 1, 0.01, 0.22, 'Noise & Lines', 'Stays on between bursts.'),
    { ...R('scanSize', 'Scanline Size', 1, 12, 0.5, 2.5, 'Noise & Lines'), visibleWhen: needs('scan') },
  ],
  presets: [
    { name: 'Signal Fail', values: {} },
    { name: 'Burnt Feed', values: { timing: 'always', burn: 0.75, rgb: 34, scan: 0.75, scanSize: 2, sort: 0.15, displace: 26, tearH: 12, noise: 0.1, mosh: 0, channelShift: 0.2 } },
    { name: 'Pixel Melt', values: { sort: 1, mosh: 0.8, displace: 20, rgb: 8, scan: 0, direction: 'vertical', timing: 'always', speed: 4 } },
    { name: 'Hard Tear', values: { tearH: 150, tearV: 60, direction: 'both', pattern: 'bands', spans: 18, rgb: 40, frameDamage: 0.5 } },
    { name: 'Beat Hit', values: { timing: 'beat', intensity: 1, speed: 24 } },
    { name: 'Slow Roll', values: { pattern: 'sweep', timing: 'always', speed: 8, displace: 120, spans: 5, spanSize: 80, noise: 0.05 } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const tick = Math.floor(time * (p.speed as number)), seed = p.seed as number, timing = p.timing as string, freq = p.frequency as number, len = p.burstLength as number;
    let env = 1;
    if (timing === 'pulse') env = (time * freq) % 1 < len ? 1 : 0;
    else if (timing === 'bursts') {
      // Each cycle decides for itself, so bursts feel irregular but replay exactly.
      const cyc = Math.floor(time * freq), ph = (time * freq) % 1;
      env = (cyc === 0 || hash2(cyc, 17, seed) < 0.72) && ph < len * (0.4 + hash2(cyc, 5, seed) * 1.2) ? 1 : 0;
    } else if (timing === 'beat') env = audioBus.read()?.bands.beat ?? 0;
    const k = (p.intensity as number) * env, rng = createRng(seed * 7919 + tick * 131);
    // Earlier frames only count while time runs forward, so an export starts clean.
    if (held && (time < held.t || time - held.t > 1)) held = null;
    const scan = p.scan as number;
    if (k <= 0.001 && scan <= 0) { ctx.putImageData(src, 0, 0); if (held) held = null; return; }

    // Frame distortion happens first, so everything after it tears the knocked frame.
    let base: ImageData = src;
    const fd = (p.frameDamage as number) * k;
    if (fd > 0.003) {
      const c = createCanvas(w, h), g = get2d(c, true);
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      const roll = (rng() - 0.5) * h * 0.5 * fd, skew = (rng() - 0.5) * 0.3 * fd, zoom = 1 + rng() * fd * 0.25;
      g.setTransform(zoom, 0, skew, zoom, (w - w * zoom) / 2, (h - h * zoom) / 2 + roll);
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, roll > 0 ? -h : h);
      g.setTransform(1, 0, 0, 1, 0, 0);
      base = g.getImageData(0, 0, w, h);
    }
    const buf = new Uint32Array(base.data.buffer.slice(0)), dirn = p.direction as string, vert = dirn === 'vertical', both = dirn === 'both', tmp = new Uint32Array(Math.max(w, h));
    const spanPx = (p.spanSize as number) * unit, n = p.spans as number, L = vert ? w : h, spans = k > 0.001 ? pattern(p.pattern as string, n, spanPx, rng, tick, L) : [];
    const cross = both ? pattern(p.pattern as string, n, spanPx, rng, tick + 7, w) : [];

    // Datamosh: chunks hold on to the previous output and slip sideways.
    const mosh = (p.mosh as number) * k;
    if (mosh > 0.003 && held && held.w === w && held.h === h) {
      const bs = Math.max(2, Math.round((p.moshBlock as number) * unit)), past = held.buf, gx = (hash2(tick, 1, seed) - 0.5) * bs * 2 | 0, gy = (hash2(tick, 2, seed) - 0.5) * bs * 2 | 0;
      for (let by = 0; by < h; by += bs) for (let bx = 0; bx < w; bx += bs) {
        if (hash2(bx / bs, by / bs + tick, seed + 3) > mosh) continue;
        for (let y = by; y < Math.min(h, by + bs); y++) for (let x = bx; x < Math.min(w, bx + bs); x++) {
          const sx = x - gx, sy = y - gy;
          if (sx >= 0 && sx < w && sy >= 0 && sy < h) buf[y * w + x] = past[sy * w + sx];
        }
      }
    }

    // Displacement along the chosen direction.
    const dp = (p.displace as number) * unit * k;
    if (dp >= 1) {
      for (const s of spans) { const d = Math.round(s.shift * dp); for (let i = Math.max(0, s.a | 0); i < Math.min(L, s.b | 0); i++) { if (vert) shiftCol(buf, tmp, w, h, i, d); else shiftRow(buf, tmp, w, i, d); } }
      for (const s of cross) { const d = Math.round(s.shift * dp); for (let i = Math.max(0, s.a | 0); i < Math.min(w, s.b | 0); i++) shiftCol(buf, tmp, w, h, i, d); }
    }

    // Tearing: thin lines pulled apart, more of them than the bands above.
    const th = (p.tearH as number) * unit * k, tv = (p.tearV as number) * unit * k, ts = Math.max(1, Math.round((p.tearSize as number) * unit));
    if (th >= 1) for (let y = 0; y < h; y += ts) { if (hash2(y, tick, seed + 11) > 0.35) continue; const d = Math.round((hash2(y, tick, seed + 12) - 0.5) * 2 * th); for (let j = y; j < Math.min(h, y + ts); j++) shiftRow(buf, tmp, w, j, d); }
    if (tv >= 1) for (let x = 0; x < w; x += ts) { if (hash2(x, tick, seed + 13) > 0.35) continue; const d = Math.round((hash2(x, tick, seed + 14) - 0.5) * 2 * tv); for (let j = x; j < Math.min(w, x + ts); j++) shiftCol(buf, tmp, w, h, j, d); }

    // Pixel sorting inside damaged spans, across the direction they tear.
    const sort = (p.sort as number) * k;
    if (sort > 0.003) {
      const lo = Math.min(p.sortLow as number, p.sortHigh as number) * 255, hi = Math.max(p.sortLow as number, p.sortHigh as number) * 255, spanLen = Math.round((vert ? h : w) * Math.min(1, sort * 1.4));
      const list = both ? [...spans, ...cross.map((s) => ({ ...s, pick: -1 - s.pick }))] : spans;
      for (const s of list) {
        const col = vert || s.pick < 0, top = col ? w : h;
        for (let i = Math.max(0, s.a | 0); i < Math.min(top, s.b | 0); i++) {
          if (col) { const from = (Math.abs(s.pick) * Math.max(1, h - spanLen)) | 0; sortRun(buf, (j) => j * w + i, from, Math.min(h, from + Math.round(h * Math.min(1, sort * 1.4))), s.shift < 0, lo, hi); }
          else { const from = (s.pick * Math.max(1, w - spanLen)) | 0, row = i * w; sortRun(buf, (j) => row + j, from, Math.min(w, from + spanLen), s.shift < 0, lo, hi); }
        }
      }
    }

    // RGB split, thrown further inside damaged spans.
    const out = ctx.createImageData(w, h), o = new Uint32Array(out.data.buffer), ang = ((p.rgbAngle as number) * Math.PI) / 180, split = (p.rgb as number) * unit * k, ca = Math.cos(ang), sa = Math.sin(ang);
    const boost = new Float32Array(L).fill(1);
    for (const s of spans) for (let i = Math.max(0, s.a | 0); i < Math.min(L, s.b | 0); i++) boost[i] = 1 + Math.abs(s.shift) * 1.6;
    if (split >= 0.5) {
      for (let y = 0; y < h; y++) {
        const by = boost[vert ? 0 : y];
        for (let x = 0; x < w; x++) {
          const m = vert ? boost[x] : by, dx = Math.round(ca * split * m), dy = Math.round(sa * split * m);
          const rx = x + dx, ry = y + dy, bx = x - dx, b2 = y - dy;
          const R0 = buf[(ry < 0 ? 0 : ry >= h ? h - 1 : ry) * w + (rx < 0 ? 0 : rx >= w ? w - 1 : rx)], B0 = buf[(b2 < 0 ? 0 : b2 >= h ? h - 1 : b2) * w + (bx < 0 ? 0 : bx >= w ? w - 1 : bx)], G0 = buf[y * w + x];
          o[y * w + x] = (G0 & 0xff00ff00) | (R0 & 0xff) | (B0 & 0xff0000);
        }
      }
    } else o.set(buf);

    // Whole-span colour swaps.
    const cs = (p.channelShift as number) * k;
    if (cs > 0.003) {
      for (const s of spans) {
        if (Math.abs(s.shift) > cs * 1.4) continue;
        const mode = (s.pick * 3) | 0;
        for (let i = Math.max(0, s.a | 0); i < Math.min(L, s.b | 0); i++) {
          const count = vert ? h : w;
          for (let j = 0; j < count; j++) {
            const q = vert ? j * w + i : i * w + j, v = o[q], r = v & 255, g = (v >> 8) & 255, b = (v >> 16) & 255, a = v & 0xff000000;
            o[q] = (mode === 0 ? g | (b << 8) | (r << 16) : mode === 1 ? b | (r << 8) | (g << 16) : (255 - r) | (g << 8) | ((255 - b) << 16)) | a;
          }
        }
      }
    }

    // Finish: burn, noise, then scanlines. Scanlines stay between bursts.
    const burn = (p.burn as number) * k, nz = (p.noise as number) * k, d = out.data;
    if (burn > 0.003) {
      const c = 1 + burn * 5, lift = burn * 40;
      for (let i = 0; i < d.length; i += 4) { d[i] = clamp255((d[i] - 110) * c + 110 + lift); d[i + 1] = clamp255((d[i + 1] - 110) * c + 110 - lift * 0.6); d[i + 2] = clamp255((d[i + 2] - 110) * c + 110 - lift * 0.3); }
    }
    if (nz > 0.003) {
      const cell = Math.max(1, Math.round(3 * unit)), tint = p.noiseColor as string, r0 = parseInt(tint.slice(1, 3), 16), g0 = parseInt(tint.slice(3, 5), 16), b0 = parseInt(tint.slice(5, 7), 16);
      for (const s of spans) for (let i = Math.max(0, s.a | 0); i < Math.min(L, s.b | 0); i += cell) {
        const count = vert ? h : w;
        for (let j = 0; j < count; j += cell * 3) {
          if (hash2(i, j + tick, seed + 21) > nz) continue;
          const v = hash2(j, i + tick, seed + 22);
          for (let a = 0; a < cell * 3 && j + a < count; a++) for (let b = 0; b < cell && i + b < L; b++) { const q = (vert ? (j + a) * w + i + b : (i + b) * w + j + a) * 4; d[q] = r0 * v; d[q + 1] = g0 * v; d[q + 2] = b0 * v; }
        }
      }
    }
    if (scan > 0) {
      const sz = Math.max(1, (p.scanSize as number) * unit), period = sz * 2, keep = 1 - scan * 0.85;
      for (let y = 0; y < h; y++) {
        if ((y % period) < sz) continue;
        for (let x = 0; x < w; x++) { const q = (y * w + x) * 4; d[q] *= keep; d[q + 1] *= keep; d[q + 2] *= keep; }
      }
    }
    ctx.putImageData(out, 0, 0);
    if (mosh > 0.003) held = { w, h, t: time, buf: new Uint32Array(o) };
  },
};
