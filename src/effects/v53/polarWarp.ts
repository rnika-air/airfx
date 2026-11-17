import type { EffectDefinition } from '../types';
import { sampleBilinear } from '../../utils/imageProcessing';
import { R, S, T } from '../generative';

/**
 * Polar Warp: the picture re-mapped through polar and log-polar coordinates.
 *   Little Planet  the picture bent into a circle (bottom edge in the middle);
 *   Tunnel         the same, inside out (top edge in the middle);
 *   Unwrap         the circle around the centre opened out into a strip;
 *   Infinite Spiral  a Droste spiral: the ring around the centre repeats
 *                    inward forever along a spiral, and can zoom endlessly.
 * Every output pixel looks up its source position, sampled bilinearly.
 */

const TAU = Math.PI * 2;
const mod = (a: number, b: number) => ((a % b) + b) % b;

export const polarWarp: EffectDefinition = {
  id: 'polarWarp', name: 'Polar Warp', category: 'distortion',
  description: 'Little planets, tunnels, unwrapped circles and an endless Droste spiral.',
  animated: (p) => (p.speed as number) !== 0,
  audioDefaults: { twist: { band: 'bass', amount: 0.25 } },
  params: [
    S('mode', 'Mode', 'spiral', [['planet', 'Little Planet'], ['tunnel', 'Tunnel'], ['unwrap', 'Unwrap'], ['spiral', 'Infinite Spiral']], 'Warp'),
    R('cx', 'Center X', 0, 1, 0.005, 0.5, 'Center'),
    R('cy', 'Center Y', 0, 1, 0.005, 0.5, 'Center'),
    R('zoom', 'Size', 0.2, 3, 0.01, 1, 'Warp'),
    R('rotate', 'Rotate', -180, 180, 0.5, 0, 'Warp'),
    R('repeat', 'Repeat', 1, 8, 1, 1, 'Warp', 'Copies around the circle, or spiral arms.'),
    R('scale', 'Spiral Step', 1.5, 8, 0.05, 3, 'Warp', 'How much smaller each turn of the spiral is.'),
    R('twist', 'Twist', -3, 3, 0.01, 0, 'Warp'),
    T('mirror', 'Hide Seam', true, 'Warp'),
    R('speed', 'Animation Speed', -2, 2, 0.01, 0, 'Motion', 'Turns the planet or zooms the spiral. 0 = still.'),
  ],
  presets: [
    { name: 'Tiny Planet', values: { mode: 'planet', zoom: 1, mirror: true } },
    { name: 'Wormhole', values: { mode: 'tunnel', zoom: 1.2, twist: 1.2, speed: 0.3 } },
    { name: 'Droste Spiral', values: { mode: 'spiral', scale: 3, repeat: 1, speed: 0 } },
    { name: 'Endless Zoom', values: { mode: 'spiral', scale: 2.4, speed: 0.4 } },
    { name: 'Ring Strip', values: { mode: 'unwrap', zoom: 1 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, time }) {
    const mode = p.mode as string, d = src.data, out = ctx.createImageData(w, h), o = out.data;
    const cx = (p.cx as number) * w, cy = (p.cy as number) * h, zoom = p.zoom as number;
    const reps = Math.max(1, Math.round(p.repeat as number)), twist = p.twist as number, mirror = p.mirror === true;
    const speed = p.speed as number, rot = ((p.rotate as number) * Math.PI) / 180 + (mode === 'spiral' ? 0 : time * speed);
    const Rr = 0.5 * Math.min(w, h) * zoom;
    // Droste constants.
    // Droste: in log-polar space the ring [r1, r1·S) repeats; z_src = z·(1 − iβ) with β = arms·ln S / 2π
    // keeps one full turn seamless while stepping inward along a spiral.
    const lnS = Math.log(Math.max(1.05, p.scale as number)), beta = (reps * lnS) / TAU, r1 = Rr / Math.exp(lnS);
    const flow = mode === 'spiral' ? time * speed * lnS : 0;
    // A horizontal position across the picture, mirrored so the two edges meet without a seam.
    const px = new Uint8ClampedArray(4);
    const across = (t: number) => { const u = mod(t, 1); return (mirror ? 1 - Math.abs(u * 2 - 1) : u) * (w - 1); };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sx: number, sy: number;
        const dx = x - cx, dy = y - cy;
        if (mode === 'unwrap') {
          // Across = angle, down = distance from the centre.
          const r = (y / h) * Rr, t2 = (x / w) * (TAU / reps) + rot + twist * (y / h);
          sx = cx + Math.cos(t2) * r; sy = cy + Math.sin(t2) * r;
        } else if (mode === 'spiral') {
          const r = Math.hypot(dx, dy) || 1e-6, th = Math.atan2(dy, dx) - rot;
          const lr = Math.log(r / r1);
          const re = lr + beta * th + flow, im = th - beta * lr + twist * lr;
          const m = mod(re, lnS), rs = r1 * Math.exp(m), ux = Math.cos(im + rot), uy = Math.sin(im + rot);
          sx = cx + ux * rs; sy = cy + uy * rs;
          // Near the outer edge of the ring, fade into the next ring in, so the seam disappears.
          const fade = (m / lnS - 0.8) / 0.2;
          if (fade > 0) {
            const k = (y * w + x) * 4;
            sampleBilinear(d, w, h, sx, sy, o, k);
            sampleBilinear(d, w, h, cx + (ux * rs) / Math.exp(lnS), cy + (uy * rs) / Math.exp(lnS), px, 0);
            const f2 = fade * fade * (3 - 2 * fade);
            for (let c = 0; c < 4; c++) o[k + c] += (px[c] - o[k + c]) * f2;
            continue;
          }
        } else {
          const r = Math.hypot(dx, dy) / Rr, th = Math.atan2(dx, -dy) + twist * r;
          const u = ((th - rot) / TAU) * reps + 0.5;
          sx = across(u);
          sy = mode === 'planet' ? (1 - r) * (h - 1) : r * (h - 1);
          sampleBilinear(d, w, h, sx, sy, o, (y * w + x) * 4);
          continue;
        }
        sampleBilinear(d, w, h, sx, sy, o, (y * w + x) * 4);
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
