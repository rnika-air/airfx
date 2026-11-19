import type { RenderInput } from '../types';

/**
 * Fast paths for colour effects whose result depends only on each pixel's own
 * colour (no neighbours, no position, no randomness). Both are exact: the output
 * is bit-for-bit what the per-pixel maths gives.
 *
 * colorMap: remembers the result for every colour it has already worked out.
 * A photo repeats its colours many times and the frames of a video share most of
 * theirs, so the maths runs once per distinct colour instead of once per pixel.
 * The memory is kept per setting (effect + parameters) and reused across frames.
 *
 * channelMap: for per-channel tone tables (Levels, Curves, Exposure), applied
 * without a function call per pixel.
 */

export type ColorFn = (r: number, g: number, b: number, o: ArrayLike<number> & { [i: number]: number }, i: number) => void;

/** Open-addressed table of colour → result, 1M slots (8 MB). */
const BITS = 20, CAP = 1 << BITS, MASK = CAP - 1, FULL = CAP * 0.6;
interface Memo { keys: Int32Array; vals: Uint32Array; used: number }
const memos = new Map<string, Memo>();
const MAX_MEMOS = 3;
/** Off: always run the per-pixel maths directly (used to check the memo against it). */
export const colorTables = { enabled: true };

function memoFor(key: string): Memo {
  let m = memos.get(key);
  if (m) { memos.delete(key); memos.set(key, m); return m; }
  // Reuse the oldest table's memory rather than allocating another 8 MB.
  if (memos.size >= MAX_MEMOS) { const k = memos.keys().next().value!; m = memos.get(k)!; memos.delete(k); m.keys.fill(-1); m.used = 0; }
  else m = { keys: new Int32Array(CAP).fill(-1), vals: new Uint32Array(CAP), used: 0 };
  memos.set(key, m);
  return m;
}

function direct(input: RenderInput, fn: ColorFn) {
  const { src, ctx, width, height } = input;
  const d = src.data, out = ctx.createImageData(width, height), o = out.data;
  for (let i = 0; i < d.length; i += 4) { fn(d[i], d[i + 1], d[i + 2], o, i); o[i + 3] = d[i + 3]; }
  ctx.putImageData(out, 0, 0);
}

/**
 * Runs a per-pixel colour function over the picture. `key` must identify the
 * function's settings completely (the same key must always mean the same colours).
 */
export function colorMap(input: RenderInput, key: string, fn: ColorFn) {
  if (!colorTables.enabled) { direct(input, fn); return; }
  const { src, ctx, width, height } = input;
  const m = memoFor(key), keys = m.keys, vals = m.vals;
  // A clamped scratch gives exactly the rounding the per-pixel path would.
  const t = new Uint8ClampedArray(3);
  const d = src.data, out = ctx.createImageData(width, height), o = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], c = (r << 16) | (g << 8) | b;
    let h = Math.imul(c, 0x9e3779b1) >>> (32 - BITS), v: number;
    for (;;) {
      const k = keys[h];
      if (k === c) { v = vals[h]; break; }
      if (k === -1) {
        fn(r, g, b, t, 0);
        v = (t[0] << 16) | (t[1] << 8) | t[2];
        if (m.used < FULL) { keys[h] = c; vals[h] = v; m.used++; }
        break;
      }
      h = (h + 1) & MASK;
    }
    o[i] = v >>> 16; o[i + 1] = (v >>> 8) & 255; o[i + 2] = v & 255; o[i + 3] = d[i + 3];
  }
  ctx.putImageData(out, 0, 0);
}

/** Per-channel 256-entry tables, applied exactly. `g` and `b` default to `r`. */
export function channelMap(input: RenderInput, r: ArrayLike<number>, g: ArrayLike<number> = r, b: ArrayLike<number> = r) {
  const { src, ctx, width, height } = input;
  const d = src.data, out = ctx.createImageData(width, height), o = out.data;
  for (let i = 0; i < d.length; i += 4) { o[i] = r[d[i]]; o[i + 1] = g[d[i + 1]]; o[i + 2] = b[d[i + 2]]; o[i + 3] = d[i + 3]; }
  ctx.putImageData(out, 0, 0);
}

/** A stable key for an effect's settings. */
export const keyOf = (id: string, params: Record<string, unknown>) => `${id}|${JSON.stringify(params)}`;
