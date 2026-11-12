/**
 * Classical reconstruction, written from the published methods. Nothing here
 * invents content: every filled pixel is copied or blended from real pixels.
 *
 * fastMarch  Fast-marching fill (Telea 2004): grows inward from the hole's edge.
 * patchFill  Multi-scale PatchMatch completion (Barnes 2009, Wexler 2007):
 *            finds matching patches elsewhere and votes them into the hole.
 */

export interface FillOptions {
  /** Patch radius in pixels at full size. Larger keeps structure, smaller keeps fine detail. */
  patchRadius: number;
  /** EM passes per pyramid level. */
  iterations: number;
  /** 0..1: prefer patches close to the hole, so fills match their surroundings. */
  nearby: number;
  /** 0..0.5: patches may be scaled by ±this, which follows perspective on receding surfaces. */
  scaleRange: number;
  /** Changes the random search, so another attempt gives another result. */
  seed: number;
}

export interface FillSource {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

function makeRng(seed: number) {
  let s = (seed * 2654435761 + 1) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ── Fast marching ──────────────────────────────────────────────── */

class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() { return this.k.length; }
  push(key: number, val: number) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop(): number {
    const k = this.k, v = this.v, top = v[0], lk = k.pop()!, lv = v.pop()!, n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

/** Fills the hole in place. Good for thin scratches, wires and small specks. */
export function fastMarch(rgba: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, radius = 5) {
  const n = w * h, KNOWN = 0, BAND = 1, HOLE = 2;
  const flag = new Uint8Array(n), T = new Float32Array(n).fill(1e6), heap = new Heap();
  for (let i = 0; i < n; i++) if (mask[i]) flag[i] = HOLE; else T[i] = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (flag[i] !== HOLE) continue;
      if ((x > 0 && !flag[i - 1]) || (x < w - 1 && !flag[i + 1]) || (y > 0 && !flag[i - w]) || (y < h - 1 && !flag[i + w])) {
        flag[i] = BAND;
        T[i] = 1;
        heap.push(1, i);
      }
    }
  const r = Math.max(2, radius | 0);
  const eik = (i: number, j: number) => {
    const a = flag[i] !== HOLE ? T[i] : 1e6, b = flag[j] !== HOLE ? T[j] : 1e6;
    const s = 2 - (a - b) * (a - b);
    if (s > 0) {
      const q = Math.sqrt(s), m = (a + b - q) / 2;
      return m >= Math.min(a, b) ? m : (a + b + q) / 2;
    }
    return Math.min(a, b) + 1;
  };
  while (heap.size) {
    const i = heap.pop();
    if (flag[i] === KNOWN) continue;
    const x = i % w, y = (i / w) | 0;
    let R = 0, G = 0, B = 0, W = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (flag[j] !== KNOWN) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r || d2 === 0) continue;
        // Nearer pixels on the same level-set line count most.
        const lev = 1 / (1 + Math.abs(T[j] - T[i])), wt = (lev / d2) * (1 / Math.sqrt(d2));
        R += rgba[j * 4] * wt; G += rgba[j * 4 + 1] * wt; B += rgba[j * 4 + 2] * wt; W += wt;
      }
    }
    if (W > 0) { rgba[i * 4] = R / W; rgba[i * 4 + 1] = G / W; rgba[i * 4 + 2] = B / W; }
    rgba[i * 4 + 3] = 255;
    flag[i] = KNOWN;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || flag[j] !== HOLE) continue;
      const jx = j % w, jy = (j / w) | 0;
      const l = jx > 0 ? j - 1 : j, rr = jx < w - 1 ? j + 1 : j, u = jy > 0 ? j - w : j, dd = jy < h - 1 ? j + w : j;
      const t = Math.min(eik(l, u), eik(rr, u), eik(l, dd), eik(rr, dd));
      T[j] = t;
      flag[j] = BAND;
      heap.push(t, j);
    }
  }
}

/* ── PatchMatch completion ──────────────────────────────────────── */

interface Level { w: number; h: number; img: Float32Array; hole: Uint8Array }

function toLevel(rgba: Uint8ClampedArray, w: number, h: number, mask: Uint8Array): Level {
  const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    img[i * 3] = rgba[i * 4]; img[i * 3 + 1] = rgba[i * 4 + 1]; img[i * 3 + 2] = rgba[i * 4 + 2];
    hole[i] = mask[i] ? 1 : 0;
  }
  return { w, h, img, hole };
}

/** Half size. Colours come from known pixels only, so the hole never leaks out. */
function shrink(l: Level): Level {
  const w = Math.max(1, l.w >> 1), h = Math.max(1, l.h >> 1);
  const img = new Float32Array(w * h * 3), hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, c = 0, any = 0;
      for (let k = 0; k < 4; k++) {
        const sx = Math.min(l.w - 1, x * 2 + (k & 1)), sy = Math.min(l.h - 1, y * 2 + (k >> 1)), i = sy * l.w + sx;
        if (l.hole[i]) { any = 1; continue; }
        r += l.img[i * 3]; g += l.img[i * 3 + 1]; b += l.img[i * 3 + 2]; c++;
      }
      const i = y * w + x;
      hole[i] = any;
      if (c) { img[i * 3] = r / c; img[i * 3 + 1] = g / c; img[i * 3 + 2] = b / c; }
    }
  return { w, h, img, hole };
}

function dilate(src: Uint8Array, w: number, h: number, r: number) {
  // Two 1-D passes give a square dilation, which matches square patches.
  const a = new Uint8Array(src.length), b = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) { if (src[y * w + x]) last = x; if (x - last <= r) a[y * w + x] = 1; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (src[y * w + x]) last = x; if (last - x <= r) a[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) { if (a[y * w + x]) last = y; if (y - last <= r) b[y * w + x] = 1; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (a[y * w + x]) last = y; if (last - y <= r) b[y * w + x] = 1; }
  }
  return b;
}

/**
 * Fills the hole of `rgba`. With `reference`, patches come from that image
 * as well as from the surroundings. Pixels outside the hole are not changed.
 */
export function patchFill(
  rgba: Uint8ClampedArray, width: number, height: number, mask: Uint8Array, opts: FillOptions,
  reference?: FillSource | null, onProgress?: (f: number) => void,
) {
  // Pyramids for the image and for the optional reference.
  const pyr: Level[] = [toLevel(rgba, width, height, mask)];
  let holeArea = 0, x0 = width, x1 = 0, y0 = height, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { holeArea++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!holeArea) return;
  const span = Math.max(x1 - x0, y1 - y0);
  while (pyr.length < 7 && Math.min(pyr[pyr.length - 1].w, pyr[pyr.length - 1].h) > 48 && span >> pyr.length > 14) pyr.push(shrink(pyr[pyr.length - 1]));
  const refPyr: (Level | null)[] = [];
  if (reference) {
    let l: Level = toLevel(reference.rgba, reference.width, reference.height, new Uint8Array(reference.width * reference.height));
    // Same pixels-per-object as the image, as far as sizes allow.
    for (let k = 0; k < pyr.length; k++) { refPyr.push(l); l = shrink(l); }
  }

  const rng = makeRng(opts.seed + 1);
  // Start the coarsest level from a smooth fill: patches then have something to match against.
  {
    const top = pyr[pyr.length - 1], px = new Uint8ClampedArray(top.w * top.h * 4), m = new Uint8Array(top.w * top.h);
    for (let i = 0; i < top.w * top.h; i++) {
      px[i * 4] = top.img[i * 3]; px[i * 4 + 1] = top.img[i * 3 + 1]; px[i * 4 + 2] = top.img[i * 3 + 2]; px[i * 4 + 3] = 255;
      m[i] = top.hole[i];
    }
    fastMarch(px, top.w, top.h, m, 4);
    for (let i = 0; i < top.w * top.h; i++) if (m[i]) { top.img[i * 3] = px[i * 4]; top.img[i * 3 + 1] = px[i * 4 + 1]; top.img[i * 3 + 2] = px[i * 4 + 2]; }
  }

  let prevNx: Float32Array | null = null, prevNy: Float32Array | null = null, prevNs: Float32Array | null = null, prevW = 0, prevH = 0;
  const levels = pyr.length;

  for (let li = levels - 1; li >= 0; li--) {
    const L = pyr[li], { w, h, img, hole } = L;
    const R = refPyr[li] ?? null;
    const r = Math.max(2, Math.round(opts.patchRadius / Math.pow(1.35, li)));
    // A source patch must be fully known. Target patches are any that touch the hole.
    const bad = dilate(hole, w, h, r);
    const target = dilate(hole, w, h, r);
    const srcList: number[] = [];
    for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) if (!bad[y * w + x]) srcList.push(y * w + x);
    const refCount = R ? (R.w - r * 2) * (R.h - r * 2) : 0;
    if (!srcList.length && !refCount) break;

    const n = w * h;
    const nx = new Float32Array(n), ny = new Float32Array(n), ns = new Float32Array(n).fill(1);
    const inRef = new Uint8Array(n);
    const cost = new Float32Array(n).fill(1e12);
    const ids: number[] = [];
    for (let i = 0; i < n; i++) if (target[i]) ids.push(i);

    const validSrc = (sx: number, sy: number, s: number, ref: boolean) => {
      const m = r * s + 1;
      if (ref) return !!R && sx >= m && sy >= m && sx < R.w - m && sy < R.h - m;
      if (sx < m || sy < m || sx >= w - m || sy >= h - m) return false;
      return !bad[(sy | 0) * w + (sx | 0)];
    };
    const near = opts.nearby;
    const dist = (tx: number, ty: number, sx: number, sy: number, s: number, ref: boolean, cut: number) => {
      const S = ref ? R!.img : img, sw = ref ? R!.w : w;
      let d = 0, wt = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = ty + dy;
        if (yy < 0 || yy >= h) continue;
        const sy2 = (sy + dy * s) | 0;
        for (let dx = -r; dx <= r; dx++) {
          const xx = tx + dx;
          if (xx < 0 || xx >= w) continue;
          const t = (yy * w + xx) * 3, q = (sy2 * sw + ((sx + dx * s) | 0)) * 3;
          const a = img[t] - S[q], b = img[t + 1] - S[q + 1], c = img[t + 2] - S[q + 2];
          // Known pixels at the rim anchor the match to the real surroundings.
          const k = hole[yy * w + xx] ? 1 : 2;
          d += k * (a * a + b * b + c * c);
          wt += k;
        }
        if (d > cut * (wt + 1)) return 1e12;
      }
      let e = d / Math.max(1, wt);
      if (near > 0 && !ref) {
        const dd = Math.hypot(sx - tx, sy - ty) / Math.max(w, h);
        e *= 1 + near * near * 40 * dd;
      }
      return e;
    };
    const randomSource = (i: number) => {
      const useRef = refCount > 0 && (!srcList.length || rng() < 0.5);
      const s = 1 + (rng() * 2 - 1) * opts.scaleRange;
      if (useRef) {
        nx[i] = r + rng() * (R!.w - r * 2 - 1);
        ny[i] = r + rng() * (R!.h - r * 2 - 1);
        inRef[i] = 1;
      } else {
        const j = srcList[(rng() * srcList.length) | 0];
        nx[i] = j % w;
        ny[i] = (j / w) | 0;
        inRef[i] = 0;
      }
      ns[i] = s;
    };

    // Initial field: scaled up from the coarser level where possible.
    for (const i of ids) {
      if (prevNx && prevNy && prevNs) {
        const x = i % w, y = (i / w) | 0;
        const px = Math.min(prevW - 1, x >> 1), py = Math.min(prevH - 1, y >> 1), pi = py * prevW + px;
        const sx = prevNx[pi] * 2 + (x & 1), sy = prevNy[pi] * 2 + (y & 1), s = prevNs[pi] || 1;
        if (validSrc(sx, sy, s, false)) { nx[i] = sx; ny[i] = sy; ns[i] = s; inRef[i] = 0; continue; }
      }
      randomSource(i);
      if (!validSrc(nx[i], ny[i], ns[i], !!inRef[i])) { ns[i] = 1; }
    }

    const tryMatch = (i: number, tx: number, ty: number, sx: number, sy: number, s: number, ref: boolean) => {
      if (!validSrc(sx, sy, s, ref)) return;
      const e = dist(tx, ty, sx, sy, s, ref, cost[i]);
      if (e < cost[i]) { cost[i] = e; nx[i] = sx; ny[i] = sy; ns[i] = s; inRef[i] = ref ? 1 : 0; }
    };

    const em = li === 0 ? Math.max(2, opts.iterations - 1) : opts.iterations + (levels - li > 2 ? 2 : 0);
    for (let it = 0; it < em; it++) {
      for (const i of ids) {
        const x = i % w, y = (i / w) | 0;
        cost[i] = validSrc(nx[i], ny[i], ns[i], !!inRef[i]) ? dist(x, y, nx[i], ny[i], ns[i], !!inRef[i], 1e12) : 1e12;
      }
      for (let pass = 0; pass < 2; pass++) {
        const fwd = pass % 2 === 0, dir = fwd ? 1 : -1;
        const list = fwd ? ids : ids.slice().reverse();
        for (const i of list) {
          const x = i % w, y = (i / w) | 0;
          // Propagate: a good neighbour's match, shifted by one pixel, is probably good here.
          const a = x - dir, b = y - dir;
          if (a >= 0 && a < w && target[y * w + a]) { const j = y * w + a; tryMatch(i, x, y, nx[j] + dir * ns[j], ny[j], ns[j], !!inRef[j]); }
          if (b >= 0 && b < h && target[b * w + x]) { const j = b * w + x; tryMatch(i, x, y, nx[j], ny[j] + dir * ns[j], ns[j], !!inRef[j]); }
          // Random search at shrinking radii around the current best.
          const ref = !!inRef[i], mw = ref ? R!.w : w, mh = ref ? R!.h : h;
          for (let rad = Math.max(mw, mh) * 0.5; rad >= 1; rad *= 0.5) {
            tryMatch(i, x, y, nx[i] + (rng() * 2 - 1) * rad, ny[i] + (rng() * 2 - 1) * rad, Math.min(1 + opts.scaleRange, Math.max(1 - opts.scaleRange, ns[i] + (rng() * 2 - 1) * opts.scaleRange * 0.4)), ref);
          }
          if (cost[i] > 1e11 || rng() < 0.02) {
            const ox = nx[i], oy = ny[i], os = ns[i], or = inRef[i];
            randomSource(i);
            const sx = nx[i], sy = ny[i], s = ns[i], rf = !!inRef[i];
            nx[i] = ox; ny[i] = oy; ns[i] = os; inRef[i] = or;
            tryMatch(i, x, y, sx, sy, s, rf);
          }
        }
      }
      // Vote: each hole pixel becomes the average of all patches covering it.
      const acc = new Float32Array(n * 4);
      for (const i of ids) {
        if (cost[i] > 1e11) continue;
        const tx = i % w, ty = (i / w) | 0, sx = nx[i], sy = ny[i], s = ns[i], ref = !!inRef[i];
        const S = ref ? R!.img : img, sw = ref ? R!.w : w;
        const conf = 1 / (1 + cost[i] / 900);
        for (let dy = -r; dy <= r; dy++) {
          const yy = ty + dy;
          if (yy < 0 || yy >= h) continue;
          const sy2 = (sy + dy * s) | 0;
          for (let dx = -r; dx <= r; dx++) {
            const xx = tx + dx;
            if (xx < 0 || xx >= w) continue;
            const t = yy * w + xx;
            if (!hole[t]) continue;
            const q = (sy2 * sw + ((sx + dx * s) | 0)) * 3;
            acc[t * 4] += S[q] * conf; acc[t * 4 + 1] += S[q + 1] * conf; acc[t * 4 + 2] += S[q + 2] * conf; acc[t * 4 + 3] += conf;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        if (!hole[i] || acc[i * 4 + 3] <= 0) continue;
        const k = 1 / acc[i * 4 + 3];
        img[i * 3] = acc[i * 4] * k; img[i * 3 + 1] = acc[i * 4 + 1] * k; img[i * 3 + 2] = acc[i * 4 + 2] * k;
      }
      onProgress?.((levels - 1 - li + (it + 1) / em) / levels);
    }

    prevNx = nx; prevNy = ny; prevNs = ns; prevW = w; prevH = h;
    // Seed the next finer level's hole with this result.
    if (li > 0) {
      const F = pyr[li - 1];
      for (let y = 0; y < F.h; y++)
        for (let x = 0; x < F.w; x++) {
          const i = y * F.w + x;
          if (!F.hole[i]) continue;
          const cx = Math.min(w - 1, x >> 1), cy = Math.min(h - 1, y >> 1), c = (cy * w + cx) * 3;
          F.img[i * 3] = img[c]; F.img[i * 3 + 1] = img[c + 1]; F.img[i * 3 + 2] = img[c + 2];
        }
    }
  }
  const out = pyr[0];
  for (let i = 0; i < width * height; i++) {
    if (!mask[i]) continue;
    rgba[i * 4] = out.img[i * 3]; rgba[i * 4 + 1] = out.img[i * 3 + 1]; rgba[i * 4 + 2] = out.img[i * 3 + 2]; rgba[i * 4 + 3] = 255;
  }
}
