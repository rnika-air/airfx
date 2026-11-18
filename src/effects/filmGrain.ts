import type { EffectDefinition } from './types';
import { adjust, clamp255, hash2 } from '../utils/imageProcessing';
import { GLSL_COMMON, gpuEffect } from '../engine/gpu';

/** Film grain, per pixel, as in the loop in render(). */
const GRAIN_GLSL = GLSL_COMMON + `
uniform sampler2D u_tex0; uniform float u_amount, u_cell, u_seed, u_contrast, u_brightness, u_vig; uniform bool u_colored;
float adj(float v) { return clamp((v - 0.5) * u_contrast + 0.5 + u_brightness, 0.0, 1.0); }
void main() {
  ivec2 p = px(); float x = float(p.x), y = float(p.y);
  float cx = u_size.x / 2.0, cy = u_size.y / 2.0, maxR = length(vec2(cx, cy));
  int gx = int(floor(x / u_cell)), gy = int(floor(y / u_cell)), seed = int(u_seed);
  float nx = (x - cx) / maxR, ny = (y - cy) / maxR;
  float v = u_vig > 0.0 ? 1.0 - u_vig * pow(min(1.0, nx * nx + ny * ny), 1.4) : 1.0;
  vec4 s = texelFetch(u_tex0, p, 0);
  float r = adj(s.r), g = adj(s.g), b = adj(s.b);
  float l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  float resp = u_amount * 180.0 * (0.35 + 1.3 * l * (1.0 - l));
  if (u_colored) {
    r = r * 255.0 + (hash2(gx, gy, seed) - 0.5) * resp;
    g = g * 255.0 + (hash2(gx, gy, seed + 101) - 0.5) * resp;
    b = b * 255.0 + (hash2(gx, gy, seed + 211) - 0.5) * resp;
  } else {
    float n = (hash2(gx, gy, seed) - 0.5) * resp;
    r = r * 255.0 + n; g = g * 255.0 + n; b = b * 255.0 + n;
  }
  outColor = vec4(floor(clamp(vec3(r, g, b) * v, 0.0, 255.0)) / 255.0, 1.0);
}`;

/**
 * Film grain: hashed per-cell noise (cell = grain size), applied with a
 * mid-tone weighted response like real emulsion, plus tone and vignette.
 * Noise is stateless (hash of x, y, seed) so there are no large buffers.
 */
export const filmGrain: EffectDefinition = {
  id: 'filmGrain',
  name: 'Film Grain',
  category: 'texture',
  description: 'Analog emulsion grain, tone and vignette.',
  animated: (p) => p.animate === true,
  audioDefaults: { amount: { band: 'level', amount: 0.35 }, brightness: { band: 'beat', amount: 0.12 } },
  params: [
    { key: 'amount', label: 'Grain Amount', type: 'range', group: 'Grain', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'size', label: 'Grain Size', type: 'range', group: 'Grain', min: 0.5, max: 8, step: 0.1, default: 1.2 },
    { key: 'colored', label: 'Colored Grain', type: 'toggle', group: 'Grain', default: false },
    { key: 'animate', label: 'Animate Noise (video)', type: 'toggle', group: 'Grain', default: true },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 2.5, step: 0.01, default: 1.1 },
    { key: 'brightness', label: 'Brightness', type: 'range', group: 'Tone', min: -0.5, max: 0.5, step: 0.01, default: 0 },
    { key: 'vignette', label: 'Vignette', type: 'range', group: 'Tone', min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  render(input) {
    const { ctx, width, height, params, unit, frame } = input;
    const amount = params.amount as number;
    const cell = Math.max(1, (params.size as number) * unit);
    const colored = params.colored as boolean;
    const seed = params.animate ? (frame * 7919) % 100003 : 17;
    const contrast = params.contrast as number;
    const brightness = params.brightness as number;
    const vig = params.vignette as number;

    // On the GPU when it can (the same maths, per pixel); otherwise the loop below.
    if (gpuEffect(GRAIN_GLSL, input.srcCanvas, ctx, width, height, {
      u_amount: amount, u_cell: cell, u_colored: colored, u_seed: seed, u_contrast: contrast, u_brightness: brightness, u_vig: vig,
    })) return;
    const sp = input.src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    const cx = width / 2, cy = height / 2;
    const maxR = Math.hypot(cx, cy);
    const inv = 1 / cell;
    const strength = amount * 180;

    for (let y = 0; y < height; y++) {
      const gy = Math.floor(y * inv);
      const ny = (y - cy) / maxR;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const gx = Math.floor(x * inv);
        const nx = (x - cx) / maxR;
        const v = vig > 0 ? 1 - vig * Math.pow(Math.min(1, nx * nx + ny * ny), 1.4) : 1;

        let r = adjust(sp[i] / 255, brightness, contrast);
        let g = adjust(sp[i + 1] / 255, brightness, contrast);
        let b = adjust(sp[i + 2] / 255, brightness, contrast);
        // Grain is most visible in mid-tones, weaker in deep shadow / highlight.
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const resp = strength * (0.35 + 1.3 * l * (1 - l));
        if (colored) {
          r = r * 255 + (hash2(gx, gy, seed) - 0.5) * resp;
          g = g * 255 + (hash2(gx, gy, seed + 101) - 0.5) * resp;
          b = b * 255 + (hash2(gx, gy, seed + 211) - 0.5) * resp;
        } else {
          const n = (hash2(gx, gy, seed) - 0.5) * resp;
          r = r * 255 + n;
          g = g * 255 + n;
          b = b * 255 + n;
        }
        op[i] = clamp255(r * v);
        op[i + 1] = clamp255(g * v);
        op[i + 2] = clamp255(b * v);
        op[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
