import type { EffectDefinition } from './types';
import { createRng, hash2, hexToRgb } from '../utils/imageProcessing';
import { C, R, S, SEED, T } from './generative';
import { GLSL_COMMON, gpu, type Tex } from '../engine/gpu';

/**
 * Finishing passes, after the ASCII Magic post-effect set: Vignette, Scan Lines,
 * Film Dust, Fragment, Sharpen, Reduce Noise and Diffuse. Every length is in
 * units (1/1000 of the long edge), so a 4K export looks like the preview, only
 * sharper.
 */

/* ── A fast blur for the detail passes ─────────────────────────── */

/**
 * Box blur of an RGBA buffer, run three times (close to a Gaussian), with
 * running sums so the cost does not grow with the radius. Edges repeat the
 * border pixel, so the frame never darkens at its sides.
 */
export function blurRGBA(src: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const rad = Math.max(0, Math.round(r));
  if (!rad) return src.slice();
  let a = new Float32Array(src), b = new Float32Array(src.length);
  // One line at a time, copied into a buffer padded with its own end pixels, so the
  // running sum needs no bounds checks.
  const line = new Float32Array((Math.max(w, h) + rad * 2 + 1) * 4);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const outer = horizontal ? h : w, inner = horizontal ? w : h, step = horizontal ? 4 : w * 4, k = 1 / (rad * 2 + 1);
    for (let o = 0; o < outer; o++) {
      const base = horizontal ? o * w * 4 : o * 4;
      for (let i = -rad; i < inner + rad + 1; i++) {
        const s = base + Math.min(inner - 1, Math.max(0, i)) * step, d = (i + rad) * 4;
        line[d] = from[s]; line[d + 1] = from[s + 1]; line[d + 2] = from[s + 2]; line[d + 3] = from[s + 3];
      }
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let i = 0; i <= rad * 2; i++) { const d = i * 4; s0 += line[d]; s1 += line[d + 1]; s2 += line[d + 2]; s3 += line[d + 3]; }
      for (let i = 0; i < inner; i++) {
        const t = base + i * step;
        to[t] = s0 * k; to[t + 1] = s1 * k; to[t + 2] = s2 * k; to[t + 3] = s3 * k;
        const add = (i + rad * 2 + 1) * 4, sub = i * 4;
        s0 += line[add] - line[sub]; s1 += line[add + 1] - line[sub + 1]; s2 += line[add + 2] - line[sub + 2]; s3 += line[add + 3] - line[sub + 3];
      }
    }
  };
  for (let n = 0; n < 3; n++) { pass(a, b, true); pass(b, a, false); }
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < out.length; i++) out[i] = a[i];
  return out;
}

/* ── GPU paths for the detail passes ───────────────────────────── */

// A separable Gaussian; sigma matches blurRGBA (three box passes of radius r: sigma² = r(r + 1)).
const BLUR_GLSL = GLSL_COMMON + `
uniform sampler2D u_tex0; uniform vec2 u_dir; uniform float u_sigma;
void main() {
  ivec2 p = px(); vec4 sum = vec4(0.0); float wsum = 0.0;
  int r = int(min(64.0, ceil(u_sigma * 3.0)));
  for (int i = -64; i <= 64; i++) {
    if (i < -r || i > r) continue;
    float k = exp(-float(i * i) / (2.0 * u_sigma * u_sigma));
    sum += at(u_tex0, p.x + int(u_dir.x) * i, p.y + int(u_dir.y) * i) * k; wsum += k;
  }
  outColor = sum / wsum;
}`;

/** The picture blurred on the GPU, as a texture (the caller releases it), or null. */
function gpuBlur(t: Tex, w: number, h: number, rad: number): Tex | null {
  const sigma = Math.max(0.5, Math.sqrt(rad * (rad + 1)));
  const a = gpu.target(w, h, false), b = gpu.target(w, h, false);
  if (!a || !b) { gpu.release(a, b); return null; }
  gpu.run(BLUR_GLSL, w, h, [t], { u_dir: [1, 0], u_sigma: sigma }, a);
  gpu.run(BLUR_GLSL, w, h, [a], { u_dir: [0, 1], u_sigma: sigma }, b);
  gpu.release(a);
  return b;
}

/** Runs frag over the source and up to two blurs of it; returns false when the GPU is not available. */
function gpuDetail(frag: string, srcCanvas: TexImageSource, ctx: CanvasRenderingContext2D, w: number, h: number, radii: number[], uniforms: Record<string, number | boolean | number[]>) {
  if (!gpu.can(w, h)) return false;
  let src: Tex | null = null;
  const blurs: Tex[] = [];
  try {
    src = gpu.upload(srcCanvas, w, h);
    if (!src) return false;
    for (const rr of radii) { const b = gpuBlur(src, w, h, rr); if (!b) return false; blurs.push(b); }
    const out = gpu.run(frag, w, h, [src, ...blurs], uniforms);
    if (!out) return false;
    ctx.drawImage(out, 0, 0);
    return true;
  } catch (e) {
    console.warn('GPU effect fell back to CPU:', e);
    return false;
  } finally {
    gpu.release(src, ...blurs);
  }
}

const SHARPEN_GLSL = GLSL_COMMON + `
uniform sampler2D u_tex0, u_tex1; uniform float u_amt, u_th; uniform bool u_luma;
float L(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  ivec2 p = px(); vec4 s = texelFetch(u_tex0, p, 0) * 255.0, b = texelFetch(u_tex1, p, 0) * 255.0;
  vec3 o;
  if (u_luma) { float d = L(s.rgb) - L(b.rgb); o = s.rgb + (abs(d) < u_th ? 0.0 : d * u_amt); }
  else { vec3 d = s.rgb - b.rgb; o = s.rgb + mix(d * u_amt, vec3(0.0), vec3(lessThan(abs(d), vec3(u_th)))); }
  outColor = vec4(clamp(o, 0.0, 255.0) / 255.0, s.a / 255.0);
}`;

const DENOISE_GLSL = GLSL_COMMON + `
uniform sampler2D u_tex0, u_tex1, u_tex2; uniform float u_amt, u_sigma, u_cn;
float L(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  ivec2 p = px(); vec4 s = texelFetch(u_tex0, p, 0) * 255.0; vec3 n = texelFetch(u_tex1, p, 0).rgb * 255.0, wd = texelFetch(u_tex2, p, 0).rgb * 255.0;
  float diff = abs(L(s.rgb) - L(n)), k = u_amt * exp(-(diff * diff) / (u_sigma * u_sigma));
  vec3 o = s.rgb + (n - s.rgb) * k;
  if (u_cn > 0.0) { float l0 = L(o), l1 = L(wd), c = u_cn * u_amt; o += (wd - l1 + l0 - o) * c; }
  outColor = vec4(clamp(o, 0.0, 255.0) / 255.0, s.a / 255.0);
}`;

const DIFFUSE_GLSL = GLSL_COMMON + `
uniform sampler2D u_tex0; uniform float u_rad, u_seed; uniform int u_mode;
float L(vec4 c) { return dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); }
ivec2 pick(ivec2 p, int k) {
  int span = int(u_rad) * 2 + 1, seed = int(u_seed);
  int nx = p.x + int(floor(hash2(p.x, p.y, seed + k) * float(span))) - int(u_rad);
  int ny = p.y + int(floor(hash2(p.x, p.y, seed + 7 + k) * float(span))) - int(u_rad);
  return clamp(ivec2(nx, ny), ivec2(0), ivec2(u_size) - 1);
}
void main() {
  ivec2 p = px(); vec4 s = texelFetch(u_tex0, p, 0), c = texelFetch(u_tex0, pick(p, 0), 0);
  if (u_mode == 1) { if (L(c) > L(s)) c = s; }
  else if (u_mode == 2) { if (L(c) < L(s)) c = s; }
  else if (u_mode == 3) {
    float l0 = L(s), best = abs(L(c) - l0);
    for (int k = 1; k < 4; k++) { vec4 q = texelFetch(u_tex0, pick(p, k * 13), 0); float e = abs(L(q) - l0); if (e < best) { best = e; c = q; } }
  }
  outColor = vec4(c.rgb, s.a);
}`;

const lum = (d: ArrayLike<number>, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/* ── Vignette ───────────────────────────────────────────────────── */

export const vignette: EffectDefinition = {
  id: 'vignette', name: 'Vignette', category: 'light',
  description: 'Darken (or tint) the edges of the frame: centre, size, feather, roundness and colour.',
  params: [
    R('intensity', 'Intensity', 0, 1, 0.01, 0.6, 'Vignette'),
    R('size', 'Size', 0, 1, 0.01, 0.5, 'Vignette', 'How much of the picture stays clear.'),
    R('feather', 'Feather', 0, 1, 0.01, 0.55, 'Vignette', 'How soft the edge is.'),
    R('roundness', 'Roundness', 0, 1, 0.01, 0.5, 'Vignette', '0 follows the frame, 1 is a circle.'),
    R('cx', 'Center X', 0, 1, 0.005, 0.5, 'Vignette'),
    R('cy', 'Center Y', 0, 1, 0.005, 0.5, 'Vignette'),
    C('color', 'Color', '#000000', 'Vignette'),
    S('blend', 'Blend', 'source-over', [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen (Light Edges)'], ['overlay', 'Overlay']], 'Vignette'),
  ],
  presets: [
    { name: 'Classic', values: { intensity: 0.6, size: 0.5, feather: 0.55, roundness: 0.5, color: '#000000' } },
    { name: 'Tight Spotlight', values: { intensity: 0.9, size: 0.2, feather: 0.4, roundness: 1 } },
    { name: 'Soft Frame', values: { intensity: 0.35, size: 0.7, feather: 0.9, roundness: 0 } },
    { name: 'White Fade', values: { intensity: 0.8, size: 0.45, feather: 0.7, color: '#ffffff', blend: 'screen' } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const k = p.intensity as number;
    if (k <= 0) return;
    const cx = (p.cx as number) * w, cy = (p.cy as number) * h, round = p.roundness as number;
    // Radii: from the frame's own ellipse (roundness 0) to a circle on the diagonal (1).
    const half = Math.hypot(w, h) / 2, ax = (w / 2) * Math.SQRT2 * (1 - round) + half * round, ay = (h / 2) * Math.SQRT2 * (1 - round) + half * round;
    const edge = 0.25 + (p.size as number) * 0.85, inner = edge * (1 - Math.max(0.02, p.feather as number) * 0.95);
    const [r, g, b] = hexToRgb(p.color as string);
    ctx.save();
    ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;
    ctx.translate(cx, cy);
    ctx.scale(ax, ay);
    const grad = ctx.createRadialGradient(0, 0, inner, 0, 0, Math.max(inner + 0.001, edge));
    grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
    // A smooth (eased) fall-off, not a straight ramp.
    for (let i = 1; i <= 6; i++) { const t = i / 6; grad.addColorStop(t, `rgba(${r},${g},${b},${(k * t * t * (3 - 2 * t)).toFixed(4)})`); }
    ctx.fillStyle = grad;
    // Cover the whole frame in the scaled space.
    const span = Math.max(w / ax, h / ay) * 2 + 2;
    ctx.fillRect(-span, -span, span * 2, span * 2);
    ctx.restore();
  },
};

/* ── Scan Lines ─────────────────────────────────────────────────── */

export const scanLines: EffectDefinition = {
  id: 'scanLines', name: 'Scan Lines', category: 'analog',
  description: 'Horizontal scan lines over the picture: spacing, thickness, colour, softness and roll.',
  animated: (p) => (p.roll as number) !== 0,
  params: [
    R('intensity', 'Intensity', 0, 1, 0.01, 0.45, 'Lines'),
    R('spacing', 'Spacing', 1, 10, 0.1, 3, 'Lines'),
    R('thickness', 'Thickness', 0.5, 6, 0.1, 1.2, 'Lines'),
    T('soft', 'Soft Lines', true, 'Lines'),
    S('direction', 'Direction', 'horizontal', [['horizontal', 'Horizontal'], ['vertical', 'Vertical']], 'Lines'),
    C('color', 'Color', '#000000', 'Lines'),
    S('blend', 'Blend', 'multiply', [['multiply', 'Multiply'], ['source-over', 'Normal'], ['screen', 'Screen'], ['overlay', 'Overlay']], 'Lines'),
    R('roll', 'Roll Speed', -4, 4, 0.01, 0, 'Motion', 'Lines drift up or down over time.'),
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const k = p.intensity as number;
    if (k <= 0) return;
    const vertical = p.direction === 'vertical', len = vertical ? w : h;
    // Spacing and thickness are "pixels at 1000 px", so they scale with the export.
    const sp = Math.max(1, (p.spacing as number) * Math.max(1, unit * 1.5)), th = Math.min(sp, (p.thickness as number) * Math.max(1, unit * 1.5) * 0.5);
    const shift = ((((p.roll as number) * time * sp * 4) % sp) + sp) % sp;
    const [r, g, b] = hexToRgb(p.color as string);
    ctx.save();
    ctx.globalCompositeOperation = p.blend as GlobalCompositeOperation;
    const soft = p.soft === true;
    for (let pos = shift - sp; pos < len + sp; pos += sp) {
      if (soft) {
        // A soft line: full strength in the middle, fading at both sides.
        const grad = vertical ? ctx.createLinearGradient(pos - th, 0, pos + th, 0) : ctx.createLinearGradient(0, pos - th, 0, pos + th);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`); grad.addColorStop(0.5, `rgba(${r},${g},${b},${k})`); grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        if (vertical) ctx.fillRect(pos - th, 0, th * 2, h); else ctx.fillRect(0, pos - th, w, th * 2);
      } else {
        ctx.fillStyle = `rgba(${r},${g},${b},${k})`;
        if (vertical) ctx.fillRect(pos, 0, th, h); else ctx.fillRect(0, pos, w, th);
      }
    }
    ctx.restore();
  },
};

/* ── Film Dust ──────────────────────────────────────────────────── */

export const filmDust: EffectDefinition = {
  id: 'filmDust', name: 'Film Dust', category: 'analog',
  description: 'Dust specks, hairs and scratches on old film, new on every frame or held still.',
  animated: (p) => p.animate === true,
  params: [
    R('density', 'Density', 0, 1, 0.01, 0.4, 'Dust'),
    R('size', 'Speck Size', 0.3, 4, 0.01, 1, 'Dust'),
    R('hairs', 'Hairs', 0, 1, 0.01, 0.3, 'Dust'),
    R('scratches', 'Scratches', 0, 1, 0.01, 0.25, 'Dust', 'Long vertical lines down the frame.'),
    S('tone', 'Dust Color', 'both', [['dark', 'Dark (Print)'], ['light', 'Light (Negative)'], ['both', 'Both']], 'Dust'),
    R('opacity', 'Opacity', 0, 1, 0.01, 0.75, 'Dust'),
    T('animate', 'New Dust Every Frame', true, 'Motion'),
    R('rate', 'Frame Rate', 2, 30, 1, 12, 'Motion', 'How many times a second the dust changes.'),
    SEED('Motion'),
  ],
  presets: [
    { name: 'Old Print', values: { density: 0.45, hairs: 0.35, scratches: 0.3, tone: 'dark' } },
    { name: 'Negative Scan', values: { density: 0.6, hairs: 0.5, scratches: 0.1, tone: 'light' } },
    { name: 'Damaged Reel', values: { density: 0.9, size: 1.6, hairs: 0.8, scratches: 0.8, tone: 'both', opacity: 0.9 } },
    { name: 'Light Dust', values: { density: 0.15, hairs: 0.1, scratches: 0, opacity: 0.5 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const tick = p.animate ? Math.floor(time * (p.rate as number)) : 0;
    const rng = createRng(((p.seed as number) * 7919 + tick * 104729) >>> 0 || 1);
    const tone = p.tone as string, op = p.opacity as number, sz = (p.size as number) * unit;
    const ink = () => (tone === 'dark' ? '12,10,8' : tone === 'light' ? '244,240,228' : rng() < 0.5 ? '12,10,8' : '244,240,228');
    ctx.save();
    // Specks: small irregular blobs.
    const specks = Math.round((p.density as number) * 260 * (w * h) / 1e6 + (p.density as number) * 40);
    for (let i = 0; i < specks; i++) {
      const x = rng() * w, y = rng() * h, r = sz * (0.4 + rng() ** 3 * 4);
      ctx.fillStyle = `rgba(${ink()},${(op * (0.35 + rng() * 0.65)).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.6), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hairs: thin curling strands.
    const hairs = Math.round((p.hairs as number) * 7 + (rng() < (p.hairs as number) ? 1 : 0));
    ctx.lineCap = 'round';
    for (let i = 0; i < hairs; i++) {
      let x = rng() * w, y = rng() * h, a = rng() * Math.PI * 2;
      const len = (40 + rng() * 140) * unit, steps = 14;
      ctx.strokeStyle = `rgba(${ink()},${(op * (0.5 + rng() * 0.5)).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, unit * (0.5 + rng() * 0.8));
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let s = 0; s < steps; s++) { a += (rng() - 0.5) * 0.9; x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // Scratches: long, slightly wandering vertical lines.
    const scr = Math.round((p.scratches as number) * 4 + (rng() < (p.scratches as number) * 0.5 ? 1 : 0));
    for (let i = 0; i < scr; i++) {
      const x0 = rng() * w, y0 = rng() * h * 0.3, y1 = h - rng() * h * 0.3;
      ctx.strokeStyle = `rgba(${ink()},${(op * (0.25 + rng() * 0.45)).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.5, unit * (0.4 + rng() * 0.9));
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.bezierCurveTo(x0 + (rng() - 0.5) * 8 * unit, y0 + (y1 - y0) / 3, x0 + (rng() - 0.5) * 8 * unit, y0 + (2 * (y1 - y0)) / 3, x0 + (rng() - 0.5) * 6 * unit, y1);
      ctx.stroke();
    }
    ctx.restore();
  },
};

/* ── Fragment ───────────────────────────────────────────────────── */

export const fragment: EffectDefinition = {
  id: 'fragment', name: 'Fragment', category: 'distortion',
  description: 'Overlapping offset copies of the picture, averaged into a shaken, multiple-exposure look.',
  animated: (p) => (p.spin as number) !== 0,
  params: [
    R('copies', 'Copies', 2, 8, 1, 4, 'Fragment'),
    R('offset', 'Offset', 1, 40, 0.1, 8, 'Fragment'),
    R('angle', 'Angle', 0, 360, 1, 45, 'Fragment', '°'),
    R('spin', 'Spin Speed', -2, 2, 0.01, 0, 'Fragment', 'The copies circle over time.'),
    S('blend', 'Blend', 'average', [['average', 'Average'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['screen', 'Screen']], 'Fragment'),
  ],
  render({ srcCanvas, ctx, params: p, unit, time }) {
    const n = Math.round(p.copies as number), off = (p.offset as number) * unit, a0 = ((p.angle as number) * Math.PI) / 180 + (p.spin as number) * time * Math.PI;
    const blend = p.blend as string;
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * Math.PI * 2) / n, x = Math.cos(a) * off, y = Math.sin(a) * off;
      if (blend === 'average') {
        // A running mean over the copies. The unmoved picture stays underneath, so the
        // strips a shifted copy leaves empty at the frame edges never show as a border.
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1 / (i + 1);
      } else {
        ctx.globalCompositeOperation = blend as GlobalCompositeOperation;
        ctx.globalAlpha = blend === 'screen' ? 1 / n + 0.15 : 1;
      }
      ctx.drawImage(srcCanvas, x, y);
    }
    ctx.restore();
  },
};

/* ── Sharpen ────────────────────────────────────────────────────── */

export const sharpen: EffectDefinition = {
  id: 'sharpen', name: 'Sharpen', category: 'adjust',
  description: 'Unsharp mask: amount, radius and a threshold that leaves smooth areas and noise alone.',
  params: [
    R('amount', 'Amount', 0, 3, 0.01, 0.8, 'Sharpen'),
    R('radius', 'Radius', 0.5, 10, 0.1, 1.5, 'Sharpen'),
    R('threshold', 'Threshold', 0, 40, 1, 2, 'Sharpen', 'Differences smaller than this are not sharpened.'),
    T('lumaOnly', 'Luminance Only', true, 'Sharpen', ),
  ],
  render(input) {
    const { ctx, width: w, height: h, params: p, unit } = input;
    const amt = p.amount as number, th = p.threshold as number, luma = p.lumaOnly === true;
    const rad = Math.max(0.5, (p.radius as number) * Math.max(1, unit)) * 0.6;
    if (gpuDetail(SHARPEN_GLSL, input.srcCanvas, ctx, w, h, [Math.round(rad) || 1], { u_amt: amt, u_th: th, u_luma: luma })) return;
    const d = input.src.data;
    const out = ctx.createImageData(w, h), o = out.data;
    const bl = blurRGBA(d, w, h, rad);
    for (let i = 0; i < d.length; i += 4) {
      if (luma) {
        const diff = lum(d, i) - lum(bl, i);
        const k = Math.abs(diff) < th ? 0 : diff * amt;
        o[i] = d[i] + k; o[i + 1] = d[i + 1] + k; o[i + 2] = d[i + 2] + k;
      } else {
        for (let c = 0; c < 3; c++) { const diff = d[i + c] - bl[i + c]; o[i + c] = d[i + c] + (Math.abs(diff) < th ? 0 : diff * amt); }
      }
      o[i + 3] = d[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};

/* ── Reduce Noise ───────────────────────────────────────────────── */

export const reduceNoise: EffectDefinition = {
  id: 'reduceNoise', name: 'Reduce Noise', category: 'adjust',
  description: 'Smooths grain and colour noise while keeping edges and detail (edge-aware).',
  params: [
    R('amount', 'Strength', 0, 1, 0.01, 0.6, 'Noise'),
    S('radius', 'Radius', 'medium', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], 'Noise'),
    R('detail', 'Preserve Detail', 0, 1, 0.01, 0.5, 'Noise', 'Higher keeps more texture at edges.'),
    R('color', 'Color Noise', 0, 1, 0.01, 0.6, 'Noise', 'Smooths blotchy colour speckle separately.'),
  ],
  render(input) {
    const { ctx, width: w, height: h, params: p, unit } = input;
    const amt = p.amount as number, rr = { small: 1, medium: 2, large: 3.5 }[p.radius as string] ?? 2;
    const r = rr * Math.max(1, unit), sigma = 6 + (1 - (p.detail as number)) * 40, cn = p.color as number;
    if (gpuDetail(DENOISE_GLSL, input.srcCanvas, ctx, w, h, [Math.round(r), Math.round(r * 3)], { u_amt: amt, u_sigma: sigma, u_cn: cn })) return;
    const d = input.src.data;
    const near = blurRGBA(d, w, h, r), wide = cn > 0 ? blurRGBA(d, w, h, r * 3) : near;
    const out = ctx.createImageData(w, h), o = out.data;
    for (let i = 0; i < d.length; i += 4) {
      // Edge-aware: the further a pixel is from its neighbourhood, the more of it stays.
      const diff = Math.abs(lum(d, i) - lum(near, i)), k = amt * Math.exp(-(diff * diff) / (sigma * sigma));
      let R = d[i] + (near[i] - d[i]) * k, G = d[i + 1] + (near[i + 1] - d[i + 1]) * k, B = d[i + 2] + (near[i + 2] - d[i + 2]) * k;
      if (cn > 0) {
        // Colour noise: keep this pixel's brightness, take colour from a wider average.
        const l0 = 0.2126 * R + 0.7152 * G + 0.0722 * B, l1 = lum(wide, i), c = cn * amt;
        R += (wide[i] - l1 + l0 - R) * c; G += (wide[i + 1] - l1 + l0 - G) * c; B += (wide[i + 2] - l1 + l0 - B) * c;
      }
      o[i] = R; o[i + 1] = G; o[i + 2] = B; o[i + 3] = d[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};

/* ── Diffuse ────────────────────────────────────────────────────── */

export const diffuse: EffectDefinition = {
  id: 'diffuse', name: 'Diffuse', category: 'distortion',
  description: 'Each pixel swaps with a random neighbour: a frosted, sandy scatter. Darken, Lighten and Anisotropic variants.',
  animated: (p) => p.animate === true,
  params: [
    R('amount', 'Amount', 0, 1, 0.01, 0.4, 'Diffuse'),
    S('mode', 'Mode', 'normal', [['normal', 'Normal'], ['darken', 'Darken Only'], ['lighten', 'Lighten Only'], ['anisotropic', 'Anisotropic']], 'Diffuse'),
    T('animate', 'Shimmer', false, 'Diffuse', ),
    SEED('Diffuse'),
  ],
  render(input) {
    const { ctx, width: w, height: h, params: p, unit, frame } = input;
    const rad = Math.max(1, Math.round((p.amount as number) * 6 * Math.max(1, unit))), mode = p.mode as string;
    const seed = (p.seed as number) + (p.animate ? frame * 131 : 0), span = rad * 2 + 1;
    if (gpuDetail(DIFFUSE_GLSL, input.srcCanvas, ctx, w, h, [], { u_rad: rad, u_seed: seed, u_mode: ['normal', 'darken', 'lighten', 'anisotropic'].indexOf(mode) })) return;
    const d = input.src.data, out = ctx.createImageData(w, h), o = out.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const pick = (k: number) => {
        const nx = Math.min(w - 1, Math.max(0, x + Math.floor(hash2(x, y, seed + k) * span) - rad));
        const ny = Math.min(h - 1, Math.max(0, y + Math.floor(hash2(x, y, seed + 7 + k) * span) - rad));
        return (ny * w + nx) * 4;
      };
      let j = pick(0);
      if (mode === 'darken') { if (lum(d, j) > lum(d, i)) j = i; }
      else if (mode === 'lighten') { if (lum(d, j) < lum(d, i)) j = i; }
      else if (mode === 'anisotropic') {
        // Of four candidates, the one closest in tone: smears along edges, not across them.
        const l0 = lum(d, i);
        let best = Math.abs(lum(d, j) - l0);
        for (let k = 1; k < 4; k++) { const c = pick(k * 13), e = Math.abs(lum(d, c) - l0); if (e < best) { best = e; j = c; } }
      }
      o[i] = d[j]; o[i + 1] = d[j + 1]; o[i + 2] = d[j + 2]; o[i + 3] = d[i + 3];
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const POST_EFFECTS = [vignette, scanLines, filmDust, fragment, sharpen, reduceNoise, diffuse];
