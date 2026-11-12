import type { EffectDefinition } from './types';
import { BLEND_OPTIONS, blendChannel, hexToRgb, luminance, type BlendMode } from '../utils/imageProcessing';

/**
 * Moiré: two algorithmic gratings are overlaid like printed transparencies
 * (multiplied). Their slight difference in angle / centre creates the
 * low-frequency interference bands. The source luminance can warp the phase
 * of the gratings so the image is "engraved" into the pattern itself.
 */
export const moire: EffectDefinition = {
  id: 'moire',
  name: 'Moiré',
  category: 'pattern',
  description: 'Overlaid gratings that interfere into shimmering bands.',
  animated: (p) => p.animate === true,
  audioDefaults: { rotation: { band: 'bass', amount: 0.08 }, frequency: { band: 'mid', amount: 0.1 } },
  params: [
    {
      key: 'pattern',
      label: 'Pattern Type',
      type: 'select',
      group: 'Pattern',
      default: 'lines',
      options: [
        { value: 'lines', label: 'Lines' },
        { value: 'circles', label: 'Circles' },
        { value: 'radial', label: 'Radial' },
        { value: 'interference', label: 'Interference' },
      ],
    },
    { key: 'frequency', label: 'Frequency', type: 'range', group: 'Pattern', min: 1, max: 30, step: 0.1, default: 7 },
    { key: 'scale', label: 'Pattern Scale', type: 'range', group: 'Pattern', min: 0.25, max: 4, step: 0.01, default: 1, unit: '×' },
    { key: 'angle', label: 'Angle', type: 'range', group: 'Geometry', min: 0, max: 180, step: 0.5, default: 30, unit: '°' },
    {
      key: 'rotation',
      label: 'Rotation',
      type: 'range',
      group: 'Geometry',
      min: -45,
      max: 45,
      step: 0.1,
      default: 3,
      unit: '°',
      hint: 'Rotation of the second layer. Small values produce wide moiré bands.',
    },
    {
      key: 'offset',
      label: 'Layer Offset',
      type: 'range',
      group: 'Geometry',
      min: 0,
      max: 300,
      step: 1,
      default: 40,
      hint: 'Distance between the two pattern centres (circles / radial / interference).',
      visibleWhen: (v) => v.pattern !== 'lines',
    },
    {
      key: 'influence',
      label: 'Image Influence',
      type: 'range',
      group: 'Pattern',
      min: 0,
      max: 3,
      step: 0.01,
      default: 0.6,
      hint: 'How strongly image brightness warps the pattern phase.',
    },
    { key: 'duty', label: 'Line Width', type: 'range', group: 'Pattern', min: 0.1, max: 0.9, step: 0.01, default: 0.5, hint: 'Share of each line that is ink.' },
    { key: 'second', label: 'Second Layer Frequency', type: 'range', group: 'Pattern', min: 0.5, max: 2, step: 0.005, default: 1, unit: '×', hint: 'Slightly different spacing makes wider bands.' },
    { key: 'waver', label: 'Line Waver', type: 'range', group: 'Pattern', min: 0, max: 40, step: 0.5, default: 0, hint: 'Bends straight lines into waves.' },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.2, max: 8, step: 0.05, default: 2.5 },
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Tone', min: 0, max: 1, step: 0.01, default: 0.9 },
    { key: 'blend', label: 'Blend Mode', type: 'select', group: 'Tone', default: 'multiply', options: BLEND_OPTIONS },
    { key: 'invert', label: 'Invert Pattern', type: 'toggle', group: 'Tone', default: false },
    { key: 'color1', label: 'Color 1', type: 'color', group: 'Color', default: '#101110' },
    { key: 'color2', label: 'Color 2', type: 'color', group: 'Color', default: '#f1efe6' },
    { key: 'opacity', label: 'Original Opacity', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'animate', label: 'Animate (video)', type: 'toggle', group: 'Motion', default: false },
    {
      key: 'speed',
      label: 'Drift Speed',
      type: 'range',
      group: 'Motion',
      min: 0,
      max: 5,
      step: 0.05,
      default: 1,
      visibleWhen: (v) => v.animate === true,
    },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const pattern = params.pattern as string;
    const k = (Math.PI * 2 * (params.frequency as number)) / (100 * (params.scale as number) * unit);
    const a1 = ((params.angle as number) * Math.PI) / 180;
    const rot = ((params.rotation as number) * Math.PI) / 180;
    const a2 = a1 + rot;
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const c2 = Math.cos(a2), s2 = Math.sin(a2);
    const offset = (params.offset as number) * unit;
    const influence = (params.influence as number) * Math.PI * 2;
    const contrast = params.contrast as number;
    const intensity = params.intensity as number;
    const blend = params.blend as BlendMode;
    const invert = params.invert as boolean;
    const col1 = hexToRgb(params.color1 as string);
    const col2 = hexToRgb(params.color2 as string);
    const opacity = params.opacity as number;
    const drift = params.animate ? time * (params.speed as number) * 2 : 0;

    const cx = width / 2, cy = height / 2;
    // Second centre is displaced along the rotation direction.
    const dx = Math.cos(a2) * offset, dy = Math.sin(a2) * offset;
    const raysK = Math.max(2, Math.round((params.frequency as number) * 4));

    const duty = 1 - 2 * Math.sin(((params.duty as number) * Math.PI) / 2) ** 2;
    const k2 = k * (params.second as number), waver = (params.waver as number) * unit, wf = 0.012 / unit;
    const shape = (v: number) => {
      // v is a sine in -1..1 → 0..1 with contrast-controlled sharpness
      const s = ((v + duty) * 0.5 * contrast) + 0.5;
      return s < 0 ? 0 : s > 1 ? 1 : s;
    };

    const sp = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;

    for (let y = 0; y < height; y++) {
      const py = y - cy;
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = sp[i], g = sp[i + 1], b = sp[i + 2];
        const phase = luminance(r, g, b) * influence + drift;
        const px = x - cx + (waver ? Math.sin(py * wf) * waver : 0);
        let g1: number, g2: number;
        if (pattern === 'lines') {
          g1 = Math.sin(k * (px * c1 + py * s1) + phase);
          g2 = Math.sin(k2 * (px * c2 + py * s2) + phase * 0.5);
        } else if (pattern === 'circles') {
          g1 = Math.sin(k * Math.hypot(px + dx / 2, py + dy / 2) + phase);
          g2 = Math.sin(k2 * Math.hypot(px - dx / 2, py - dy / 2) + phase * 0.5);
        } else if (pattern === 'radial') {
          g1 = Math.sin(raysK * Math.atan2(py + dy / 2, px + dx / 2) + a1 + phase);
          g2 = Math.sin(raysK * Math.atan2(py - dy / 2, px - dx / 2) + a1 + phase * 0.5);
        } else {
          g1 = Math.sin(k * (px * c1 + py * s1) + phase);
          g2 = Math.sin(k2 * Math.hypot(px - dx, py - dy) + phase * 0.5);
        }
        // Two transparencies laid on top of each other → multiply.
        let p = shape(g1) * shape(g2);
        if (invert) p = 1 - p;

        const tr = col1[0] + (col2[0] - col1[0]) * p;
        const tg = col1[1] + (col2[1] - col1[1]) * p;
        const tb = col1[2] + (col2[2] - col1[2]) * p;

        const br = r + (blendChannel(blend, r, tr) - r) * intensity;
        const bg = g + (blendChannel(blend, g, tg) - g) * intensity;
        const bb = b + (blendChannel(blend, b, tb) - b) * intensity;

        op[i] = tr + (br - tr) * opacity;
        op[i + 1] = tg + (bg - tg) * opacity;
        op[i + 2] = tb + (bb - tb) * opacity;
        op[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
