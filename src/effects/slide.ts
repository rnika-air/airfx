import type { EffectDefinition } from './types';
import { EASE_OPTIONS, TEXTURE_PARAMS, cardTextures, drawCard, ease } from './cards';

/**
 * Slide: a carousel of image planes orbiting in faux-3D. Planes travel an
 * elliptical orbit, scale with depth, turn edge-on at the sides (ring mode)
 * and are depth-sorted. Motion loops every `duration` seconds.
 */
export const slide: EffectDefinition = {
  id: 'slide',
  name: 'Slide',
  category: 'animate',
  description: 'Image planes orbiting in a looping 3D carousel.',
  animated: () => true,
  audioDefaults: { orbitRadius: { band: 'bass', amount: 0.15 }, planeSize: { band: 'beat', amount: 0.08 } },
  params: [
    { key: 'planes', label: 'Planes', type: 'range', group: 'Orbit', min: 2, max: 24, step: 1, default: 8 },
    { key: 'planeSize', label: 'Plane Size', type: 'range', group: 'Orbit', min: 40, max: 700, step: 1, default: 260 },
    { key: 'orbitRadius', label: 'Orbit Radius', type: 'range', group: 'Orbit', min: 0, max: 700, step: 1, default: 340 },
    { key: 'tilt', label: 'Orbit Tilt', type: 'range', group: 'Orbit', min: -1, max: 1, step: 0.01, default: 0.18 },
    {
      key: 'direction', label: 'Orbit Direction', type: 'select', group: 'Orbit', default: 'cw',
      options: [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter' }],
    },
    {
      key: 'facing', label: 'Plane Facing', type: 'select', group: 'Orbit', default: 'ring',
      options: [{ value: 'ring', label: 'Ring (turns)' }, { value: 'camera', label: 'Face camera' }],
    },
    { key: 'cycles', label: 'Cycles', type: 'range', group: 'Timing', min: 0, max: 8, step: 0.25, default: 2 },
    { key: 'duration', label: 'Duration', type: 'range', group: 'Timing', min: 2, max: 60, step: 0.5, default: 16, unit: 's' },
    { key: 'curve', label: 'Curve', type: 'select', group: 'Timing', default: 'smooth', options: EASE_OPTIONS },
    { key: 'stepped', label: 'Step Plane by Plane', type: 'toggle', group: 'Timing', default: true },
    ...TEXTURE_PARAMS,
    { key: 'radius', label: 'Corner Radius', type: 'range', group: 'Look', min: 0, max: 80, step: 0.5, default: 6 },
    { key: 'depthFog', label: 'Depth Fade', type: 'range', group: 'Look', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'shadow', label: 'Shadow', type: 'range', group: 'Look', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Look', default: '#f9f8f5' },
  ],
  render({ srcCanvas, ctx, width, height, params, unit, time }) {
    const n = params.planes as number;
    const size = (params.planeSize as number) * unit;
    const R = (params.orbitRadius as number) * unit;
    const tilt = params.tilt as number;
    const dir = params.direction === 'ccw' ? -1 : 1;
    const ring = params.facing === 'ring';
    const cycles = params.cycles as number;
    const duration = params.duration as number;
    const curve = params.curve as string;
    const bg = params.background as string;
    const tex = cardTextures(params, srcCanvas, width, height, n);

    // progress in "plane steps"
    const loopT = ((time % duration) + duration) % duration / duration;
    let progress: number;
    if (params.stepped) {
      const s = loopT * cycles * n;
      progress = (Math.floor(s) + ease(curve, s - Math.floor(s))) / n;
    } else progress = ease(curve, loopT) * cycles;
    const offset = progress * Math.PI * 2 * dir;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    const cx = width / 2, cy = height / 2;
    const cards = Array.from({ length: n }, (_, i) => {
      const th = (i / n) * Math.PI * 2 + offset;
      const z = Math.cos(th); // 1 = front
      const depth = 0.55 + 0.45 * ((z + 1) / 2);
      return {
        i, z,
        draw: {
          x: cx + Math.sin(th) * R,
          y: cy - z * R * tilt * 0.5,
          w: size * (tex[i].sw / tex[i].sh >= 1 ? 1 : tex[i].sw / tex[i].sh),
          h: size * (tex[i].sw / tex[i].sh >= 1 ? tex[i].sh / tex[i].sw : 1),
          rot: 0,
          scaleX: ring ? Math.cos(th) * 0.85 + Math.sign(Math.cos(th) || 1) * 0.15 : 1,
          scale: depth,
          radius: (params.radius as number) * unit,
          fog: (params.depthFog as number) * (1 - (z + 1) / 2),
          shadow: params.shadow as number,
        },
      };
    });
    cards.sort((a, b) => a.z - b.z);
    for (const c of cards) drawCard(ctx, tex[c.i], c.draw, bg);
  },
};
