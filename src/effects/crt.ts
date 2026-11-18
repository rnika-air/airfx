import type { EffectDefinition } from './types';
import { boxBlur, clamp255, hash2, sampleBilinear } from '../utils/imageProcessing';
import { GLSL_COMMON, gpu, type Tex } from '../engine/gpu';

/* ── The same tube on the GPU: bloom (weight, box blur ×2), then the tube pass. ── */
const BLOOM_W = GLSL_COMMON + `
uniform sampler2D u_tex0;
void main() { vec4 s = texelFetch(u_tex0, px(), 0) * 255.0; float w = max(0.0, (s.r + s.g + s.b) / 765.0 - 0.45) * 2.0; outColor = vec4(s.rgb * w, 1.0); }`;
// One box pass of imageProcessing.boxBlur (radius r, edges clamped), across or down.
const BOX = GLSL_COMMON + `
uniform sampler2D u_tex0; uniform float u_r; uniform bool u_down;
void main() { ivec2 p = px(); int r = int(u_r); vec3 acc = vec3(0.0);
  for (int i = -64; i <= 64; i++) { if (i < -r || i > r) continue; acc += u_down ? at(u_tex0, p.x, p.y + i).rgb : at(u_tex0, p.x + i, p.y).rgb; }
  outColor = vec4(acc / float(2 * r + 1), 1.0); }`;
const TUBE = GLSL_COMMON + `
uniform sampler2D u_tex0; uniform sampler2D u_tex1;
uniform float u_k, u_chroma, u_vig, u_bloom, u_bright, u_mask, u_maskS, u_mScale, u_scan, u_lineSize, u_noise, u_flicker, u_roll, u_seed; uniform bool u_hasBloom;
void main() {
  ivec2 p = px(); float W = u_size.x, H = u_size.y;
  float nx = (float(p.x) / W) * 2.0 - 1.0, ny = (float(p.y) / H) * 2.0 - 1.0;
  float r2 = nx * nx + ny * ny, fx = nx * (1.0 + u_k * r2), fy = ny * (1.0 + u_k * r2);
  if (abs(fx) > 1.0 || abs(fy) > 1.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float sx = ((fx + 1.0) / 2.0) * W, sy = ((fy + 1.0) / 2.0) * H;
  float r = bilinear(u_tex0, sx + u_chroma, sy).r, g = bilinear(u_tex0, sx, sy).g, b = bilinear(u_tex0, sx - u_chroma, sy).b;
  if (u_hasBloom) { vec3 bl = at(u_tex1, int(sx), int(sy)).rgb; r += bl.r * u_bloom; g += bl.g * u_bloom; b += bl.b * u_bloom; }
  int mask = int(u_mask);
  if (mask > 0 && u_maskS > 0.0) {
    int sub = int(floor(sx / u_mScale)) % 3;
    if (mask == 2 && int(floor(sy / (u_mScale * 3.0))) % 2 == 1) sub = (sub + 1) % 3;
    float m = 1.0;
    if (mask == 3) { float cxp = fract(sx / u_mScale) - 0.5, cyp = fract(sy / u_mScale) - 0.5; m = 1.0 - min(1.0, (cxp * cxp + cyp * cyp) * 3.0); }
    float lo = 1.0 - u_maskS, dm = mask == 3 ? 0.6 + 0.4 * m : 1.0;
    r *= (sub == 0 ? 1.0 : lo) * dm * 1.25; g *= (sub == 1 ? 1.0 : lo) * dm * 1.25; b *= (sub == 2 ? 1.0 : lo) * dm * 1.25;
  }
  float s = u_scan > 0.0 ? 1.0 - u_scan * (0.5 - 0.5 * cos((sy / u_lineSize) * 6.283185307179586)) : 1.0;
  float m6 = max(abs(fx), abs(fy)); m6 = m6 * m6 * m6; m6 *= m6;
  float v = 1.0 - u_vig * m6 - u_vig * 0.35 * r2;
  float bar = abs(sy / H - u_roll) < 0.06 ? 1.08 : 1.0;
  float gain = s * max(0.0, v) * u_bright * u_flicker * bar;
  if (u_noise > 0.0) gain *= 1.0 + (hash2(p.x, p.y, int(u_seed)) - 0.5) * u_noise * 2.0;
  outColor = vec4(floor(clamp(vec3(r, g, b) * gain, 0.0, 255.0)) / 255.0, 1.0);
}`;
const MASKS: Record<string, number> = { none: 0, grille: 1, slot: 2, dots: 3 };

/** The CRT on the GPU; false when it cannot run there. */
function crtGpu(srcCanvas: TexImageSource, ctx: CanvasRenderingContext2D, w: number, h: number, u: Record<string, number | boolean>, bloomR: number) {
  if (!gpu.can(w, h, u.u_hasBloom === true)) return false;
  const used: (Tex | null)[] = [];
  try {
    const src = gpu.upload(srcCanvas, w, h); used.push(src);
    if (!src) return false;
    let bloom: Tex | null = null;
    if (u.u_hasBloom) {
      const a = gpu.target(w, h, true), b = gpu.target(w, h, true); used.push(a, b);
      if (!a || !b) return false;
      gpu.run(BLOOM_W, w, h, [src], {}, a);
      if (bloomR > 0) for (let n = 0; n < 2; n++) { gpu.run(BOX, w, h, [a], { u_r: bloomR, u_down: false }, b); gpu.run(BOX, w, h, [b], { u_r: bloomR, u_down: true }, a); }
      bloom = a;
    }
    const out = gpu.run(TUBE, w, h, bloom ? [src, bloom] : [src, src], u);
    if (!out) return false;
    ctx.drawImage(out, 0, 0);
    return true;
  } catch (e) { console.warn('CRT fell back to CPU:', e); return false; }
  finally { gpu.release(...used); }
}

/**
 * CRT: barrel curvature, convergence error (chroma offset), phosphor mask,
 * scanlines, bloom, vignette, plus optional flicker, noise and a rolling bar.
 */
export const crt: EffectDefinition = {
  id: 'crt',
  name: 'CRT',
  category: 'analog',
  description: 'Cathode-ray monitor: curvature, phosphor mask, scanlines, bloom.',
  animated: (p) => (p.flicker as number) > 0 || p.roll === true || (p.noise as number) > 0,
  audioDefaults: { bloom: { band: 'bass', amount: 0.35 }, chroma: { band: 'beat', amount: 0.25 } },
  params: [
    { key: 'curvature', label: 'Curvature', type: 'range', group: 'Tube', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'chroma', label: 'Convergence', type: 'range', group: 'Tube', min: 0, max: 10, step: 0.05, default: 1.5 },
    { key: 'vignette', label: 'Vignette', type: 'range', group: 'Tube', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'bloom', label: 'Bloom', type: 'range', group: 'Tube', min: 0, max: 1.5, step: 0.01, default: 0.35 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tube', min: 0.5, max: 2, step: 0.01, default: 1.25 },
    {
      key: 'mask', label: 'Phosphor Mask', type: 'select', group: 'Phosphor', default: 'grille',
      options: [{ value: 'none', label: 'None' }, { value: 'grille', label: 'Aperture' }, { value: 'slot', label: 'Slot' }, { value: 'dots', label: 'Dots' }],
    },
    { key: 'maskStrength', label: 'Mask Strength', type: 'range', group: 'Phosphor', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'maskScale', label: 'Mask Scale', type: 'range', group: 'Phosphor', min: 1, max: 8, step: 0.1, default: 2 },
    { key: 'scanlines', label: 'Scanlines', type: 'range', group: 'Phosphor', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'lineSize', label: 'Line Size', type: 'range', group: 'Phosphor', min: 1, max: 12, step: 0.1, default: 3 },
    { key: 'noise', label: 'Noise', type: 'range', group: 'Signal', min: 0, max: 0.5, step: 0.005, default: 0.04 },
    { key: 'flicker', label: 'Flicker', type: 'range', group: 'Signal', min: 0, max: 0.3, step: 0.005, default: 0.03 },
    { key: 'roll', label: 'Rolling Bar', type: 'toggle', group: 'Signal', default: true },
  ],
  render(input) {
    const { ctx, width, height, params, unit, time, frame } = input;
    const curv = params.curvature as number;
    const chroma = (params.chroma as number) * unit;
    const vig = params.vignette as number;
    const bloomAmt = params.bloom as number;
    const bright = params.brightness as number;
    const mask = params.mask as string;
    const maskS = params.maskStrength as number;
    const mScale = Math.max(1, (params.maskScale as number) * unit);
    const scan = params.scanlines as number;
    const lineSize = Math.max(1, (params.lineSize as number) * unit);
    const noise = params.noise as number;
    const flicker = 1 - (params.flicker as number) * (0.5 + 0.5 * Math.sin(time * 61.7)) ;
    const rollPos = params.roll ? (time * 0.18) % 1.3 - 0.15 : -10;
    // On the GPU when it can (the same maths per pixel; the blur radius is capped at 64 px there).
    const bloomR = Math.max(0, Math.round(8 * unit));
    if (bloomR <= 64 && crtGpu(input.srcCanvas, ctx, width, height, {
      u_k: curv * 0.25, u_chroma: chroma, u_vig: vig, u_bloom: bloomAmt, u_bright: bright, u_mask: MASKS[mask] ?? 0, u_maskS: maskS, u_mScale: mScale,
      u_scan: scan, u_lineSize: lineSize, u_noise: noise, u_flicker: flicker, u_roll: rollPos, u_seed: frame * 131 + 7, u_hasBloom: bloomAmt > 0,
    }, bloomR)) return;
    const d = input.src.data;
    const n = width * height;

    // Bloom source: blurred brightness-weighted copy of each channel.
    let bR: Float32Array | null = null, bG: Float32Array | null = null, bB: Float32Array | null = null;
    if (bloomAmt > 0) {
      bR = new Float32Array(n); bG = new Float32Array(n); bB = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        const w = Math.max(0, (r + g + b) / 765 - 0.45) * 2;
        bR[i] = r * w; bG[i] = g * w; bB[i] = b * w;
      }
      const rad = 8 * unit;
      bR = boxBlur(bR, width, height, rad); bG = boxBlur(bG, width, height, rad); bB = boxBlur(bB, width, height, rad);
    }

    const out = ctx.createImageData(width, height);
    const op = out.data;
    const tmp = new Uint8ClampedArray(4);
    const k = curv * 0.25;
    const seed = frame * 131 + 7;
    for (let y = 0; y < height; y++) {
      const ny = (y / height) * 2 - 1;
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        const nx = (x / width) * 2 - 1;
        // barrel distortion
        const r2 = nx * nx + ny * ny;
        const fx = nx * (1 + k * r2), fy = ny * (1 + k * r2);
        if (Math.abs(fx) > 1 || Math.abs(fy) > 1) {
          op[o] = op[o + 1] = op[o + 2] = 0;
          op[o + 3] = 255;
          continue;
        }
        const sx = ((fx + 1) / 2) * width, sy = ((fy + 1) / 2) * height;
        sampleBilinear(d, width, height, sx + chroma, sy, tmp, 0);
        let r = tmp[0];
        sampleBilinear(d, width, height, sx, sy, tmp, 0);
        let g = tmp[1];
        sampleBilinear(d, width, height, sx - chroma, sy, tmp, 0);
        let b = tmp[2];

        if (bR) {
          const bi = Math.min(height - 1, Math.max(0, sy | 0)) * width + Math.min(width - 1, Math.max(0, sx | 0));
          r += bR[bi] * bloomAmt; g += bG![bi] * bloomAmt; b += bB![bi] * bloomAmt;
        }

        // phosphor mask
        if (mask !== 'none' && maskS > 0) {
          const col = Math.floor(sx / mScale);
          let sub = col % 3;
          if (mask === 'slot' && Math.floor(sy / (mScale * 3)) % 2 === 1) sub = (sub + 1) % 3;
          let m = 1;
          if (mask === 'dots') {
            const cxp = (sx / mScale) % 1 - 0.5, cyp = (sy / mScale) % 1 - 0.5;
            m = 1 - Math.min(1, (cxp * cxp + cyp * cyp) * 3);
          }
          const lo = 1 - maskS;
          r *= (sub === 0 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
          g *= (sub === 1 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
          b *= (sub === 2 ? 1 : lo) * (mask === 'dots' ? 0.6 + 0.4 * m : 1) * 1.25;
        }

        // scanlines follow the curved geometry
        let s = 1;
        if (scan > 0) s = 1 - scan * (0.5 - 0.5 * Math.cos((sy / lineSize) * Math.PI * 2));
        // vignette in tube space
        const v = 1 - vig * Math.pow(Math.max(Math.abs(fx), Math.abs(fy)), 6) - vig * 0.35 * r2;
        // rolling bar
        const bar = Math.abs((sy / height) - rollPos) < 0.06 ? 1.08 : 1;
        let gain = s * Math.max(0, v) * bright * flicker * bar;
        if (noise > 0) gain *= 1 + (hash2(x, y, seed) - 0.5) * noise * 2;

        op[o] = clamp255(r * gain);
        op[o + 1] = clamp255(g * gain);
        op[o + 2] = clamp255(b * gain);
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
