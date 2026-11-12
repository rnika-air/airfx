/**
 * Motion estimation on small grey frames: pyramidal Lucas-Kanade at sparse
 * points. Used to carry masks between frames, stabilise depth over time, and
 * line up frames for video object removal.
 */

export interface Gray { w: number; h: number; data: Float32Array }

export function grayOf(img: ImageData, width: number): Gray {
  const k = img.width / width, w = width, h = Math.max(2, Math.round(img.height / k)), data = new Float32Array(w * h), d = img.data;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((Math.min(img.height - 1, (y * k) | 0) * img.width + Math.min(img.width - 1, (x * k) | 0)) * 4);
      data[y * w + x] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    }
  return { w, h, data };
}

function half(g: Gray): Gray {
  const w = g.w >> 1, h = g.h >> 1, data = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const a = (y * 2 * g.w + x * 2);
      data[y * w + x] = (g.data[a] + g.data[a + 1] + g.data[a + g.w] + g.data[a + g.w + 1]) / 4;
    }
  return { w, h, data };
}

function bil(g: Gray, x: number, y: number) {
  const x0 = Math.max(0, Math.min(g.w - 2, x | 0)), y0 = Math.max(0, Math.min(g.h - 2, y | 0));
  const u = x - x0, v = y - y0, i = y0 * g.w + x0, d = g.data;
  return (d[i] * (1 - u) + d[i + 1] * u) * (1 - v) + (d[i + g.w] * (1 - u) + d[i + g.w + 1] * u) * v;
}

function pyramid(g: Gray, levels: number) {
  const p = [g];
  while (p.length < levels && p[p.length - 1].w > 24 && p[p.length - 1].h > 24) p.push(half(p[p.length - 1]));
  return p;
}

export interface Tracked { x: number; y: number; dx: number; dy: number; ok: boolean }

/** Follow points from a to b. Points are in a's pixel coordinates. */
export function trackPoints(a: Gray, b: Gray, pts: [number, number][], win = 5): Tracked[] {
  const pa = pyramid(a, 4), pb = pyramid(b, 4), out: Tracked[] = [];
  for (const [px, py] of pts) {
    let gx = 0, gy = 0, ok = true;
    for (let l = pa.length - 1; l >= 0; l--) {
      const A = pa[l], B = pb[l], s = 1 << l, x = px / s, y = py / s;
      if (x < win + 1 || y < win + 1 || x >= A.w - win - 1 || y >= A.h - win - 1) { if (l === 0) ok = false; gx *= l ? 2 : 1; gy *= l ? 2 : 1; continue; }
      let gxx = 0, gyy = 0, gxy = 0;
      const n = (win * 2 + 1) ** 2, Ix = new Float32Array(n), Iy = new Float32Array(n), I = new Float32Array(n);
      let k = 0;
      for (let dy = -win; dy <= win; dy++)
        for (let dx = -win; dx <= win; dx++) {
          const ix = (bil(A, x + dx + 1, y + dy) - bil(A, x + dx - 1, y + dy)) / 2, iy = (bil(A, x + dx, y + dy + 1) - bil(A, x + dx, y + dy - 1)) / 2;
          Ix[k] = ix; Iy[k] = iy; I[k] = bil(A, x + dx, y + dy); k++;
          gxx += ix * ix; gyy += iy * iy; gxy += ix * iy;
        }
      const det = gxx * gyy - gxy * gxy;
      if (det < 1e-3 * n) { if (l === 0) ok = false; gx *= l ? 2 : 1; gy *= l ? 2 : 1; continue; }
      let vx = 0, vy = 0;
      for (let it = 0; it < 5; it++) {
        let bx = 0, by = 0;
        k = 0;
        for (let dy = -win; dy <= win; dy++)
          for (let dx = -win; dx <= win; dx++) {
            const e = I[k] - bil(B, x + dx + gx + vx, y + dy + gy + vy);
            bx += e * Ix[k]; by += e * Iy[k]; k++;
          }
        const ux = (gyy * bx - gxy * by) / det, uy = (gxx * by - gxy * bx) / det;
        vx += ux; vy += uy;
        if (Math.abs(ux) + Math.abs(uy) < 0.02) break;
      }
      gx += vx; gy += vy;
      if (l > 0) { gx *= 2; gy *= 2; }
    }
    out.push({ x: px, y: py, dx: gx, dy: gy, ok: ok && Number.isFinite(gx) && Number.isFinite(gy) });
  }
  return out;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = v.slice().sort((p, q) => p - q);
  return s[s.length >> 1];
};

export interface Similarity { dx: number; dy: number; scale: number; inliers: number }

/**
 * Robust shift + zoom from a to b, about (cx, cy). `use` limits the grid to
 * a region: inside a mask for tracking, outside it for camera motion.
 */
export function estimateMotion(a: Gray, b: Gray, use: (x: number, y: number) => boolean, cx = a.w / 2, cy = a.h / 2, step = 8): Similarity {
  const pts: [number, number][] = [];
  for (let y = step; y < a.h - step; y += step) for (let x = step; x < a.w - step; x += step) if (use(x, y)) pts.push([x, y]);
  if (pts.length < 4) return { dx: 0, dy: 0, scale: 1, inliers: 0 };
  const t = trackPoints(a, b, pts).filter((p) => p.ok);
  if (t.length < 4) return { dx: 0, dy: 0, scale: 1, inliers: 0 };
  const mdx = median(t.map((p) => p.dx)), mdy = median(t.map((p) => p.dy));
  // Zoom: how distances from the centre change, measured by a median of ratios.
  const ratios: number[] = [];
  for (const p of t) {
    const r0 = Math.hypot(p.x - cx, p.y - cy);
    if (r0 < 12) continue;
    ratios.push(Math.hypot(p.x + p.dx - mdx - cx, p.y + p.dy - mdy - cy) / r0);
  }
  const scale = ratios.length > 6 ? median(ratios) : 1;
  const inliers = t.filter((p) => Math.hypot(p.dx - mdx, p.dy - mdy) < 2.5).length / t.length;
  return { dx: mdx, dy: mdy, scale, inliers };
}

/** Coarse dense flow from a to b: LK on a grid, then bilinear between grid points. */
export function flowField(a: Gray, b: Gray, step = 8): { gw: number; gh: number; step: number; fx: Float32Array; fy: Float32Array } {
  const gw = Math.ceil(a.w / step) + 1, gh = Math.ceil(a.h / step) + 1, fx = new Float32Array(gw * gh), fy = new Float32Array(gw * gh);
  const pts: [number, number][] = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) pts.push([Math.min(a.w - 1, x * step), Math.min(a.h - 1, y * step)]);
  const t = trackPoints(a, b, pts, 4);
  t.forEach((p, i) => { if (p.ok) { fx[i] = p.dx; fy[i] = p.dy; } });
  return { gw, gh, step, fx, fy };
}

/** Pull a map (any size) from the previous frame into this one, along a flow field. */
export function warpByFlow(src: Float32Array, w: number, h: number, flow: ReturnType<typeof flowField>, flowW: number) {
  const out = new Float32Array(w * h), k = flowW / w, { gw, gh, step, fx, fy } = flow;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1.001, (x * k) / step), gy = Math.min(gh - 1.001, (y * k) / step), i0 = gx | 0, j0 = gy | 0, u = gx - i0, v = gy - j0, q = j0 * gw + i0;
      const dx = ((fx[q] * (1 - u) + fx[q + 1] * u) * (1 - v) + (fx[q + gw] * (1 - u) + fx[q + gw + 1] * u) * v) / k;
      const dy = ((fy[q] * (1 - u) + fy[q + 1] * u) * (1 - v) + (fy[q + gw] * (1 - u) + fy[q + gw + 1] * u) * v) / k;
      const sx = Math.max(0, Math.min(w - 1, Math.round(x - dx))), sy = Math.max(0, Math.min(h - 1, Math.round(y - dy)));
      out[y * w + x] = src[sy * w + sx];
    }
  return out;
}
