import type { EffectDefinition } from '../types';
import { createCanvas, get2d } from '../../utils/imageProcessing';
import { R, S, T } from '../generative';

/**
 * Blur & Focus: real optical blurs, all done by averaging many shifted,
 * scaled or rotated copies of the picture on the canvas (fast at 4K, and
 * every length is in units so the export matches the preview).
 */

/** The picture with its border rows and columns stretched outward by `pad` px on every side. */
function padded(src: CanvasImageSource, w: number, h: number, pad: number) {
  const pw = w + pad * 2, ph = h + pad * 2;
  const big = createCanvas(pw, ph), b = get2d(big);
  b.drawImage(src, 0, 0, w, h, pad, pad, w, h);
  b.drawImage(src, 0, 0, 1, h, 0, pad, pad, h);
  b.drawImage(src, w - 1, 0, 1, h, pad + w, pad, pad, h);
  b.drawImage(big, 0, pad, pw, 1, 0, 0, pw, pad);
  b.drawImage(big, 0, pad + h - 1, pw, 1, 0, pad + h, pw, pad);
  return big;
}

/**
 * Average of n copies of `src`, each placed by `place(g, t)` with t from -0.5
 * to 0.5. Copies are drawn from a padded picture, so a copy that is shrunk,
 * turned or moved never shows an empty edge.
 */
function accumulate(src: CanvasImageSource, w: number, h: number, n: number, place: (g: CanvasRenderingContext2D, t: number) => void, pad = 0) {
  const c = createCanvas(w, h), g = get2d(c);
  g.imageSmoothingQuality = 'high';
  const from = pad > 0 ? padded(src, w, h, pad) : null;
  for (let i = 0; i < n; i++) {
    // Running mean: copy i keeps 1/(i+1) of the result.
    g.globalAlpha = 1 / (i + 1);
    g.save();
    place(g, n === 1 ? 0 : i / (n - 1) - 0.5);
    if (from) g.drawImage(from, -pad, -pad);
    else g.drawImage(src, 0, 0, w, h);
    g.restore();
  }
  if (from) from.width = from.height = 1;
  return c;
}

/**
 * Gaussian blur whose edges stay bright: the picture is padded with copies of
 * its own border before blurring, then cropped back.
 */
export function gaussian(src: CanvasImageSource, w: number, h: number, sigma: number) {
  const pad = Math.ceil(sigma * 3) + 1;
  const big = padded(src, w, h, pad);
  const out = createCanvas(w, h), g = get2d(out);
  g.filter = `blur(${sigma.toFixed(2)}px)`;
  g.drawImage(big, -pad, -pad);
  g.filter = 'none';
  big.width = big.height = 1;
  return out;
}

/** Bright parts only, for light that streaks further than the rest. */
function highlights(src: CanvasImageSource, w: number, h: number, level: number) {
  const c = createCanvas(w, h), g = get2d(c, true);
  g.drawImage(src, 0, 0, w, h);
  const im = g.getImageData(0, 0, w, h), d = im.data;
  // Only true highlights streak: on a white page or a bright sky the cut-off
  // rises with the picture's own brightest 5%, so the whole frame never glows.
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  let seen = 0, p95 = 255;
  const total = d.length / 16;
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen > total * 0.05) { p95 = v; break; } }
  const lo = Math.max(level * 255, p95 - 12), span = Math.max(1, 255 - lo);
  // When much of the frame is that bright (a white page), streak only a little.
  let above = 0;
  for (let v = Math.ceil(lo); v < 256; v++) above += hist[v];
  const share = above / total, gain = share > 0.12 ? 0.12 / share : 1;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const k = l <= lo ? 0 : ((l - lo) / span) ** 1.5 * gain;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
  }
  g.putImageData(im, 0, 0);
  return c;
}

/** Draw `sharp` over the blurred result through a soft round window. */
function keepCentre(ctx: CanvasRenderingContext2D, sharp: CanvasImageSource, w: number, h: number, cx: number, cy: number, r0: number, r1: number) {
  if (r1 <= 0) return;
  const c = createCanvas(w, h), g = get2d(c);
  g.drawImage(sharp, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  const grad = g.createRadialGradient(cx, cy, Math.max(0, r0), cx, cy, Math.max(r0 + 1, r1));
  grad.addColorStop(0, '#000');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  ctx.drawImage(c, 0, 0);
  c.width = c.height = 1;
}

export const radialBlur: EffectDefinition = {
  id: 'radialBlur', name: 'Radial Blur', category: 'distortion',
  description: 'Zoom or spin blur around a point you choose, with a sharp centre and light that streaks.',
  animated: (p) => (p.pulse as number) > 0,
  audioDefaults: { amount: { band: 'beat', amount: 0.4 } },
  params: [
    S('mode', 'Mode', 'zoom', [['zoom', 'Zoom'], ['spin', 'Spin'], ['both', 'Zoom + Spin']], 'Blur'),
    R('amount', 'Amount', 0, 1, 0.005, 0.35, 'Blur'),
    R('spin', 'Spin Angle', 0, 90, 0.5, 12, 'Blur'),
    R('samples', 'Quality', 6, 64, 1, 28, 'Blur', 'More copies give smoother streaks.'),
    T('outward', 'Streak Outward Only', false, 'Blur'),
    R('cx', 'Center X', 0, 1, 0.005, 0.5, 'Center'),
    R('cy', 'Center Y', 0, 1, 0.005, 0.5, 'Center'),
    R('clear', 'Sharp Center', 0, 1, 0.005, 0.12, 'Center', 'Radius that stays sharp.'),
    R('soft', 'Falloff', 0, 1, 0.005, 0.3, 'Center'),
    R('streaks', 'Light Streaks', 0, 2, 0.01, 0.5, 'Light', 'Bright parts streak further and glow.'),
    R('level', 'Streak Level', 0, 0.95, 0.01, 0.6, 'Light'),
    R('pulse', 'Pulse Speed', 0, 4, 0.01, 0, 'Motion', '0 = still.'),
  ],
  presets: [
    { name: 'Warp Speed', values: { mode: 'zoom', amount: 0.6, clear: 0.05, streaks: 1.2, level: 0.5 } },
    { name: 'Focus Pull', values: { mode: 'zoom', amount: 0.25, clear: 0.22, soft: 0.45, streaks: 0 } },
    { name: 'Vortex', values: { mode: 'spin', spin: 35, clear: 0.08, streaks: 0.4 } },
    { name: 'Impact', values: { mode: 'both', amount: 0.45, spin: 10, streaks: 0.9, pulse: 1.2 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, time }) {
    const mode = p.mode as string, n = Math.round(p.samples as number);
    const pulse = p.pulse as number;
    const k = pulse > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(time * pulse * Math.PI)) : 1;
    const amt = (p.amount as number) * k, ang = (((p.spin as number) * Math.PI) / 180) * k;
    const cx = (p.cx as number) * w, cy = (p.cy as number) * h, out = p.outward === true;
    const zoom = mode !== 'spin', spin = mode !== 'zoom';
    const place = (g: CanvasRenderingContext2D, t: number) => {
      const tt = out ? t + 0.5 : t;
      g.translate(cx, cy);
      if (spin) g.rotate(ang * tt);
      if (zoom) { const s = 1 + amt * 0.5 * tt; g.scale(s, s); }
      g.translate(-cx, -cy);
    };
    // Just enough border for the largest shrink or turn (a fixed half-frame pad would be 46 MP at 4K).
    const reach = (zoom ? amt * 0.26 : 0) + (spin ? Math.sin(Math.abs(ang) / 2) * 1.5 : 0);
    const blurred = accumulate(srcCanvas, w, h, n, place, Math.ceil(Math.max(w, h) * Math.min(0.45, reach + 0.01)));
    ctx.drawImage(blurred, 0, 0);
    const streaks = p.streaks as number;
    if (streaks > 0) {
      // Highlights streak twice as far, and add light rather than replace.
      const hi = highlights(srcCanvas, w, h, p.level as number);
      const far = accumulate(hi, w, h, n, (g, t) => place(g, t * 2));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, streaks);
      ctx.drawImage(far, 0, 0);
      if (streaks > 1) { ctx.globalAlpha = streaks - 1; ctx.drawImage(far, 0, 0); }
      ctx.restore();
      hi.width = hi.height = far.width = far.height = 1;
    }
    const long = Math.max(w, h), r0 = (p.clear as number) * long * 0.5;
    keepCentre(ctx, srcCanvas, w, h, cx, cy, r0, r0 + (p.soft as number) * long * 0.5 + 1);
    blurred.width = blurred.height = 1;
  },
};

export const focusBlur: EffectDefinition = {
  id: 'focusBlur', name: 'Focus & Motion Blur', category: 'distortion',
  description: 'Gaussian, motion and tilt-shift blur: soften, add speed, or turn a scene into a miniature.',
  params: [
    S('mode', 'Mode', 'tiltShift', [['gaussian', 'Gaussian'], ['motion', 'Motion'], ['tiltShift', 'Tilt-Shift']], 'Blur'),
    R('radius', 'Blur', 0, 60, 0.1, 14, 'Blur'),
    R('angle', 'Angle', 0, 180, 0.5, 0, 'Blur', 'Motion direction, or the tilt of the sharp band.'),
    R('samples', 'Quality', 6, 64, 1, 24, 'Blur'),
    R('focus', 'Focus Position', 0, 1, 0.005, 0.55, 'Focus'),
    R('band', 'Sharp Band', 0, 0.8, 0.005, 0.14, 'Focus'),
    R('soft', 'Falloff', 0.02, 1, 0.005, 0.3, 'Focus'),
    R('saturation', 'Saturation', 0, 2, 0.01, 1.35, 'Look', 'Miniatures look brighter and toy-like.'),
    R('contrast', 'Contrast', 0.5, 1.6, 0.01, 1.08, 'Look'),
  ],
  presets: [
    { name: 'Miniature City', values: { mode: 'tiltShift', radius: 16, band: 0.12, soft: 0.28, saturation: 1.5, contrast: 1.12 } },
    { name: 'Dreamy Soft', values: { mode: 'gaussian', radius: 8, saturation: 1.05, contrast: 0.95 } },
    { name: 'Speed', values: { mode: 'motion', radius: 34, angle: 0, saturation: 1, contrast: 1 } },
    { name: 'Diagonal Rush', values: { mode: 'motion', radius: 22, angle: 35, saturation: 1.1, contrast: 1.05 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit }) {
    const mode = p.mode as string, rad = (p.radius as number) * unit, ang = ((p.angle as number) * Math.PI) / 180;
    const look = `saturate(${p.saturation}) contrast(${p.contrast})`;
    if (rad < 0.3) { ctx.filter = look; ctx.drawImage(srcCanvas, 0, 0); ctx.filter = 'none'; return; }
    let blurred: HTMLCanvasElement;
    if (mode === 'motion') {
      const n = Math.round(p.samples as number), dx = Math.cos(ang) * rad * 2, dy = Math.sin(ang) * rad * 2;
      blurred = accumulate(srcCanvas, w, h, n, (g, t) => g.translate(dx * t, dy * t), Math.ceil(rad * 1.2) + 2);
    } else blurred = gaussian(srcCanvas, w, h, rad * 0.5);
    ctx.filter = look;
    ctx.drawImage(blurred, 0, 0);
    if (mode === 'tiltShift') {
      // The sharp band, as a gradient across the picture at the chosen tilt.
      const c = createCanvas(w, h), g = get2d(c);
      g.drawImage(srcCanvas, 0, 0, w, h);
      g.globalCompositeOperation = 'destination-in';
      const nx = -Math.sin(ang), ny = Math.cos(ang), long = Math.hypot(w, h);
      const px = w / 2 + nx * ((p.focus as number) - 0.5) * h, py = h / 2 + ny * ((p.focus as number) - 0.5) * h;
      const grad = g.createLinearGradient(px - nx * long / 2, py - ny * long / 2, px + nx * long / 2, py + ny * long / 2);
      const half = ((p.band as number) * h) / long / 2, soft = ((p.soft as number) * h) / long / 2;
      const at = (v: number) => Math.min(1, Math.max(0, 0.5 + v));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(at(-half - soft), 'rgba(0,0,0,0)');
      grad.addColorStop(at(-half), '#000');
      grad.addColorStop(at(half), '#000');
      grad.addColorStop(at(half + soft), 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      ctx.drawImage(c, 0, 0);
      c.width = c.height = 1;
    }
    ctx.filter = 'none';
    blurred.width = blurred.height = 1;
  },
};
