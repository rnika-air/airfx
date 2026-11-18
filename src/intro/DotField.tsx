import { useEffect, useRef } from 'react';
import { GLSL_COMMON, gpu } from '../engine/gpu';

/**
 * The splash background, and its opening.
 *
 * Opening (about 1.9 s), on black:
 *   1. a round cluster of lime halftone dots appears in the middle;
 *   2. the dots swell and melt together (metaballs) into wavy diagonal bands,
 *      edged with thin pink and cyan rims;
 *   3. the bands spread to the edges until only small black holes are left,
 *      and those close: the screen is lime;
 *   4. the lime breaks back up into the same dots, which shrink to the quiet
 *      dot grid the page keeps. The page content arrives as they shrink.
 * Resting: small lime dots on black that swell and brighten around the
 * pointer (a slow drifting swell on touch screens, where there is no pointer).
 *
 * The dots sit on one staggered diagonal lattice throughout, so the opening
 * ends exactly on the resting grid. The opening is worked out on a copy at
 * most 640 px wide and scaled up (soft edges suit the melting look), so it
 * runs smoothly on phones; the resting dots are drawn at full resolution.
 * Under reduced motion there is no opening and nothing moves.
 */

const LIME = [198, 255, 46], PINK = [255, 62, 165], CYAN = [54, 214, 255];
const GROW = 1.1, HOLD = 0.12, SHRINK = 0.8;
// A dot of radius r reaches 2 r; its field at distance r is 0.42 (the edge).
const EDGE = 0.42;
export const DOT_INTRO_SECONDS = GROW + HOLD + SHRINK;
// Band direction (up to the right) and across it.
const AX = 0.8, AY = -0.6, BX = 0.6, BY = 0.8;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const REST = 0.085;
// The lattice: rows along the band direction, every other row shifted half
// a step, each dot nudged across the row in turn so the bands come out wavy.
const zig = (i: number) => ((i & 1) ? 0.09 : -0.09);
const shift = (j: number) => ((j & 1) ? 0.5 : 0);
/** Dot spacing for a screen size: about s along the bands, 2.1 s across them. */
export const dotStep = (w: number, h: number) => Math.max(16, Math.min(34, Math.min(w, h) / 22));

/** Working copy for the opening, reused between frames. */
export interface OpeningScratch { canvas: HTMLCanvasElement; img: ImageData | null; w: number; h: number }
export const openingScratch = (): OpeningScratch => ({ canvas: document.createElement('canvas'), img: null, w: 0, h: 0 });

/** Metaball field of the lattice, drawn into g (w × h CSS px). radius(dn) gives each dot's radius from its distance to the centre. */
function drawField(g: CanvasRenderingContext2D, sc: OpeningScratch, w: number, h: number, radius: (dn: number) => number, rim: number, alpha: number) {
  // At most about 120k working pixels, so the opening stays smooth on phones.
  const k = Math.min(1, Math.sqrt(120000 / Math.max(1, w * h))), fw = Math.max(1, Math.round(w * k)), fh = Math.max(1, Math.round(h * k));
  if (!sc.img || sc.w !== fw || sc.h !== fh) { sc.canvas.width = fw; sc.canvas.height = fh; sc.img = sc.canvas.getContext('2d')!.createImageData(fw, fh); sc.w = fw; sc.h = fh; }
  const s = dotStep(w, h), sa = s * 0.9, sb = s * 2.1;
  const d = sc.img.data, cx = w / 2, cy = h / 2, R = Math.hypot(cx, cy);
  for (let y = 0; y < fh; y++) {
    const py = y / k - cy;
    for (let x = 0; x < fw; x++) {
      const px = x / k - cx;
      const ua = (px * AX + py * AY) / sa, ub = (px * BX + py * BY) / sb;
      const j0 = Math.round(ub);
      let f = 0;
      for (let j = j0 - 1; j <= j0 + 1; j++) {
        const sh = shift(j), i0 = Math.round(ua - sh);
        for (let i = i0 - 1; i <= i0 + 1; i++) {
          const ca = i + sh, cb = j + zig(i);
          const da = (ua - ca) * sa, db = (ub - cb) * sb;
          const r = radius(Math.hypot(ca * sa, cb * sb) / R);
          // A compact falloff (Wyvill): neighbours only melt together once they nearly touch,
          // so dots along a band join first and the bands join later.
          const q = (da * da + db * db) / (4 * r * r);
          if (q < 1) { const u = 1 - q; f += u * u * u; }
        }
      }
      const o = (y * fw + x) * 4;
      // Inside: lime, anti-aliased over a narrow band of the field.
      const inside = clamp01((f - EDGE + 0.04) / 0.08);
      let cr = 5, cg = 6, cbl = 5, a = 0;
      if (inside > 0) { cr = LIME[0]; cg = LIME[1]; cbl = LIME[2]; a = inside; }
      if (rim > 0 && inside < 1 && f > 0.12) {
        // Thin rims just outside the lime: pink further out, cyan nearer.
        const col = f < 0.25 ? PINK : CYAN, ra = rim * (f < 0.25 ? smooth((f - 0.12) / 0.05) : 1) * (1 - inside);
        cr = cr * (1 - ra) + col[0] * ra; cg = cg * (1 - ra) + col[1] * ra; cbl = cbl * (1 - ra) + col[2] * ra; a = Math.max(a, ra);
      }
      d[o] = cr; d[o + 1] = cg; d[o + 2] = cbl; d[o + 3] = a * 255 * alpha;
    }
  }
  sc.canvas.getContext('2d')!.putImageData(sc.img, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(sc.canvas, 0, 0, w, h);
  g.restore();
}

/** The same field on the GPU, at full device resolution: sharp edges on any screen. */
const OPENING_GLSL = GLSL_COMMON + `
uniform float u_dpr, u_s, u_sa, u_sb, u_R, u_mode, u_p, u_fill, u_q, u_rim, u_alpha, u_rest;
float radius(float dn) {
  if (u_mode < 0.5) return u_s * (u_rest * 0.8 + clamp((u_p * 1.7 - dn) / 0.5, 0.0, 1.0) * 0.55 + u_fill * 0.8);
  return u_s * (1.4 + (u_rest - 1.4) * u_q);
}
void main() {
  ivec2 p = px();
  vec2 c = (vec2(p) + 0.5) / u_dpr - u_size / u_dpr * 0.5;
  float ua = (c.x * 0.8 - c.y * 0.6) / u_sa, ub = (c.x * 0.6 + c.y * 0.8) / u_sb;
  int j0 = int(floor(ub + 0.5));
  float f = 0.0;
  for (int dj = -1; dj <= 1; dj++) {
    int j = j0 + dj; float sh = (j & 1) == 1 ? 0.5 : 0.0;
    int i0 = int(floor(ua - sh + 0.5));
    for (int di = -1; di <= 1; di++) {
      int i = i0 + di; float ca = float(i) + sh, cb = float(j) + ((i & 1) == 1 ? 0.09 : -0.09);
      float da = (ua - ca) * u_sa, db = (ub - cb) * u_sb;
      float r = radius(length(vec2(ca * u_sa, cb * u_sb)) / u_R);
      float q = (da * da + db * db) / (4.0 * r * r);
      if (q < 1.0) { float u = 1.0 - q; f += u * u * u; }
    }
  }
  float inside = clamp((f - 0.38) / 0.08, 0.0, 1.0);
  vec3 col = vec3(5.0, 6.0, 5.0); float a = 0.0;
  if (inside > 0.0) { col = vec3(198.0, 255.0, 46.0); a = inside; }
  if (u_rim > 0.0 && inside < 1.0 && f > 0.12) {
    bool outer = f < 0.25;
    vec3 rc = outer ? vec3(255.0, 62.0, 165.0) : vec3(54.0, 214.0, 255.0);
    float ra = u_rim * (outer ? smoothstep(0.0, 1.0, (f - 0.12) / 0.05) : 1.0) * (1.0 - inside);
    col = col * (1.0 - ra) + rc * ra; a = max(a, ra);
  }
  outColor = vec4(col / 255.0, a * u_alpha);
}`;

/** The field drawn by the GPU when it can; false when the CPU copy must do it. */
function fieldGpu(g: CanvasRenderingContext2D, w: number, h: number, dpr: number, u: Record<string, number>) {
  const dw = Math.max(1, Math.round(w * dpr)), dh = Math.max(1, Math.round(h * dpr));
  if (!gpu.can(dw, dh)) return false;
  try {
    const s = dotStep(w, h);
    const out = gpu.run(OPENING_GLSL, dw, dh, [], { u_dpr: dpr, u_s: s, u_sa: s * 0.9, u_sb: s * 2.1, u_R: Math.hypot(w / 2, h / 2), u_rest: REST, ...u });
    if (!out) return false;
    g.drawImage(out, 0, 0, w, h);
    return true;
  } catch { return false; }
}

/**
 * One frame of the opening at time t (seconds), drawn into g over w × h.
 * Returns false once the opening is over. Pure: the same t always gives the same frame.
 */
export function paintOpening(g: CanvasRenderingContext2D, sc: OpeningScratch, w: number, h: number, t: number, dpr = 1) {
  if (t >= DOT_INTRO_SECONDS) return false;
  const s = dotStep(w, h);
  if (t < GROW + HOLD) {
    // Grow out from the middle, then swell until the holes close.
    const p = Math.min(1, t / GROW), fill = smooth((p - 0.6) / 0.4);
    if (fieldGpu(g, w, h, dpr, { u_mode: 0, u_p: p, u_fill: fill, u_q: 0, u_rim: (1 - fill) * 0.95, u_alpha: 1 })) return true;
    // Radius over the spacing s: 0.35 joins the dots along a band, 0.85 joins the bands, ~1 closes the holes.
    drawField(g, sc, w, h, (dn) => s * (REST * 0.8 + clamp01((p * 1.7 - dn) / 0.5) * 0.55 + fill * 0.8), (1 - fill) * 0.95, 1);
  } else {
    // Break back into dots and shrink to the resting grid.
    const q = smooth((t - GROW - HOLD) / SHRINK);
    if (fieldGpu(g, w, h, dpr, { u_mode: 1, u_p: 1, u_fill: 0, u_q: q, u_rim: 0, u_alpha: 1 - q * 0.55 })) return true;
    drawField(g, sc, w, h, () => s * (1.4 + (REST - 1.4) * q), 0, 1 - q * 0.55);
  }
  return true;
}
/** When the page content starts to arrive, in seconds. */
export const REVEAL_AT = GROW + HOLD + SHRINK * 0.2;

export function DotField({ intro, onReveal, onDone }: { intro: boolean; onReveal?: () => void; onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cb = useRef({ onReveal, onDone });
  cb.current = { onReveal, onDone };

  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const play = intro && !still;
    const sc = openingScratch();

    let w = 0, h = 0, dpr = 1, s = 24;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = c.clientWidth; h = c.clientHeight;
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      s = dotStep(w, h);
      last = 0;
    };
    let last = 0;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);

    // The pointer: the glow follows with a little lag and fades when it leaves.
    let tx = -9999, ty = -9999, px = -9999, py = -9999, amt = 0, target = 0;
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = c.getBoundingClientRect();
      tx = e.clientX - r.left; ty = e.clientY - r.top;
      if (target === 0) { px = tx; py = ty; }
      target = 1;
    };
    const leave = () => { target = 0; };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.addEventListener('pointerleave', leave);

    /** The resting grid: small lime dots, swelling around the pointer. */
    const drawRest = (t: number) => {
      const cx = w / 2, cy = h / 2, reach = s * 7, sa = s * 0.9, sb = s * 2.1;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [x, y] of [[-cx, -cy], [cx, -cy], [-cx, cy], [cx, cy]]) {
        const ua = (x * AX + y * AY) / sa, ub = (x * BX + y * BY) / sb;
        a0 = Math.min(a0, ua); a1 = Math.max(a1, ua); b0 = Math.min(b0, ub); b1 = Math.max(b1, ub);
      }
      g.fillStyle = `rgb(${LIME[0]},${LIME[1]},${LIME[2]})`;
      for (let j = Math.floor(b0) - 1; j <= Math.ceil(b1) + 1; j++) {
        const sh = shift(j);
        for (let i = Math.floor(a0) - 1; i <= Math.ceil(a1) + 1; i++) {
          const ca = i + sh, cbb = j + zig(i);
          const x = cx + ca * sa * AX + cbb * sb * BX, y = cy + ca * sa * AY + cbb * sb * BY;
          if (x < -s || y < -s || x > w + s || y > h + s) continue;
          let q = amt > 0.01 ? Math.max(0, 1 - Math.hypot(x - px, y - py) / reach) * amt : 0;
          if (coarse && !still) q = Math.max(q, Math.max(0, Math.sin(x * 0.011 + y * 0.007 - t * 0.6)) ** 6 * 0.4);
          q = smooth(q);
          g.globalAlpha = 0.45 + q * 0.55;
          g.beginPath();
          g.arc(x, y, s * (REST + q * 0.3), 0, Math.PI * 2);
          g.fill();
        }
      }
      g.globalAlpha = 1;
    };

    const t0 = performance.now();
    let raf = 0, revealed = !play, done = !play;
    if (!play) { cb.current.onReveal?.(); cb.current.onDone?.(); }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = (now - t0) / 1000;
      const opening = play && t < DOT_INTRO_SECONDS;
      // The opening runs every frame it can; the resting grid at about 30 fps.
      if (document.hidden || (!opening && now - last < 33)) return;
      last = now;
      px += (tx - px) * 0.18; py += (ty - py) * 0.18; amt += (target - amt) * 0.1;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (opening) {
        if (!revealed && t >= REVEAL_AT) { revealed = true; cb.current.onReveal?.(); }
        paintOpening(g, sc, w, h, t, dpr);
        return;
      }
      if (!done) { done = true; if (!revealed) { revealed = true; cb.current.onReveal?.(); } cb.current.onDone?.(); }
      drawRest(t);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', move);
      document.documentElement.removeEventListener('pointerleave', leave);
    };
  }, [intro]);

  return <canvas ref={ref} className="sp__dots" aria-hidden />;
}
