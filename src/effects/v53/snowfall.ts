import type { EffectDefinition } from '../types';
import { createCanvas, createRng, get2d, hexToRgb } from '../../utils/imageProcessing';
import { C, R, S, SEED } from '../generative';

/**
 * Snowfall: snow falling in front of the picture, in depth. Far flakes are
 * small, slow and faint; near flakes are big, fast and out of focus. Each
 * flake sways and drifts with the wind. Positions come from the seed and
 * the media time only, so an export falls exactly like the preview, and a
 * video and its snow stay in step.
 */

function sprite(soft: number, crystal: boolean, rgb: number[]) {
  const S2 = 64, c = createCanvas(S2, S2), g = get2d(c);
  const col = `${rgb[0]},${rgb[1]},${rgb[2]}`;
  if (crystal) {
    // A six-armed flake with a soft halo.
    g.translate(S2 / 2, S2 / 2);
    g.strokeStyle = `rgba(${col},1)`;
    g.lineCap = 'round';
    g.lineWidth = 3;
    for (let a = 0; a < 6; a++) {
      g.save(); g.rotate((a * Math.PI) / 3);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26);
      g.moveTo(0, -14); g.lineTo(-7, -21); g.moveTo(0, -14); g.lineTo(7, -21);
      g.stroke(); g.restore();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const grad = g.createRadialGradient(S2 / 2, S2 / 2, 0, S2 / 2, S2 / 2, S2 / 2);
  const core = Math.max(0.05, 1 - soft);
  grad.addColorStop(0, `rgba(${col},${crystal ? 0.35 : 1})`);
  grad.addColorStop(core * 0.6, `rgba(${col},${crystal ? 0.2 : 0.9})`);
  grad.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S2, S2);
  return c;
}

export const snowfall: EffectDefinition = {
  id: 'snowfall', name: 'Snowfall', category: 'light',
  description: 'Snow falling in depth: far flakes small and slow, near flakes big and out of focus, drifting with the wind.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { wind: { band: 'mid', amount: 0.3 } },
  params: [
    R('density', 'Amount', 0, 3, 0.01, 1, 'Snow'),
    R('size', 'Flake Size', 0.2, 4, 0.01, 1, 'Snow'),
    S('shape', 'Flakes', 'soft', [['soft', 'Soft Dots'], ['crystal', 'Crystals']], 'Snow'),
    R('depth', 'Depth Of Field', 0, 1, 0.01, 0.6, 'Snow', 'How blurred the nearest flakes are.'),
    R('speed', 'Fall Speed', 0, 3, 0.01, 1, 'Motion', '0 = frozen in the air.'),
    R('wind', 'Wind', -2, 2, 0.01, 0.25, 'Motion'),
    R('sway', 'Sway', 0, 2, 0.01, 0.6, 'Motion'),
    C('color', 'Snow Color', '#ffffff', 'Look'),
    R('opacity', 'Opacity', 0, 1, 0.01, 0.9, 'Look'),
    R('haze', 'Winter Haze', 0, 1, 0.01, 0.15, 'Look', 'Cools and lifts the picture behind the snow.'),
    SEED('Snow'),
  ],
  presets: [
    { name: 'Gentle Snow', values: { density: 0.8, size: 0.9, speed: 0.6, wind: 0.1, haze: 0.12 } },
    { name: 'Blizzard', values: { density: 2.6, size: 1.2, speed: 2.2, wind: 1.5, sway: 0.3, haze: 0.45, depth: 0.8 } },
    { name: 'Crystal Close-Up', values: { shape: 'crystal', density: 0.35, size: 2.4, depth: 0.25, speed: 0.4 } },
    { name: 'Ash', values: { color: '#9a9590', density: 1.2, speed: 0.35, wind: -0.3, haze: 0.25 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const rgb = hexToRgb(p.color as string);
    const haze = p.haze as number;
    if (haze > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = `rgba(150,175,205,${haze * 0.55})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    const n = Math.round((p.density as number) * 900 * ((w * h) / (unit * unit)) / 562500);
    if (n <= 0) return;
    const crystal = p.shape === 'crystal', dof = p.depth as number;
    const sharpS = sprite(0.35, crystal, rgb), softS = sprite(0.95, crystal, rgb);
    const rng = createRng((p.seed as number) * 7919 + 13);
    const speed = p.speed as number, wind = p.wind as number, sway = p.sway as number, size = (p.size as number) * unit, op = p.opacity as number;
    const t = time;
    // Back to front, so near flakes cover far ones.
    const flakes: { x: number; y: number; z: number; ph: number; f: number }[] = [];
    for (let i = 0; i < n; i++) flakes.push({ x: rng(), y: rng(), z: rng() ** 2.2, ph: rng() * 6.283, f: 0.6 + rng() * 0.9 });
    flakes.sort((a, b) => a.z - b.z);
    ctx.save();
    for (const fl of flakes) {
      const z = 0.15 + fl.z * 0.85;
      const r = size * (1.2 + z * 7);
      const fall = speed * (40 + z * 160) * unit, margin = r * 2;
      const y = ((fl.y * (h + margin * 2) + fall * t) % (h + margin * 2)) - margin;
      const drift = wind * fall * t * 0.6 + Math.sin(t * fl.f * 1.3 + fl.ph) * sway * (6 + z * 22) * unit;
      const x = ((((fl.x * (w + margin * 2) + drift) % (w + margin * 2)) + (w + margin * 2)) % (w + margin * 2)) - margin;
      // Near flakes blur into soft discs; far ones stay small and faint.
      const blur = Math.max(0, z - (1 - dof)) / Math.max(0.05, dof);
      const rr = r * (1 + blur * 1.6);
      ctx.globalAlpha = op * (0.35 + z * 0.65) * (1 - blur * 0.55);
      ctx.drawImage(blur > 0.3 ? softS : sharpS, x - rr, y - rr, rr * 2, rr * 2);
    }
    ctx.restore();
    sharpS.width = sharpS.height = softS.width = softS.height = 1;
  },
};
