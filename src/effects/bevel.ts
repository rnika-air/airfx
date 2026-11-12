import type { EffectDefinition } from './types';
import { boxBlur, clamp255, hexToRgb, toLuma } from '../utils/imageProcessing';

/**
 * Bevel: treats smoothed luminance as a height field, derives surface
 * normals and lights them with a directional light (Lambert + Blinn
 * specular). Turns flat images into embossed, chrome or clay reliefs.
 */
export const bevel: EffectDefinition = {
  id: 'bevel',
  name: 'Bevel',
  category: 'texture',
  description: 'Light the image as a 3D relief: emboss, chrome, clay.',
  animated: (p) => (p.spin as number) > 0,
  audioDefaults: { depth: { band: 'bass', amount: 0.3 }, lightAngle: { band: 'mid', amount: 0.15 } },
  params: [
    {
      key: 'mode', label: 'Material', type: 'select', group: 'Surface', default: 'lit',
      options: [
        { value: 'lit', label: 'Lit Image' },
        { value: 'emboss', label: 'Emboss (grey)' },
        { value: 'chrome', label: 'Chrome' },
        { value: 'clay', label: 'Clay (tinted)' },
      ],
    },
    { key: 'depth', label: 'Depth', type: 'range', group: 'Surface', min: 0, max: 20, step: 0.05, default: 5 },
    { key: 'smooth', label: 'Smoothness', type: 'range', group: 'Surface', min: 0, max: 20, step: 0.1, default: 2.5 },
    { key: 'invertHeight', label: 'Invert Height', type: 'toggle', group: 'Surface', default: false },
    { key: 'lightAngle', label: 'Light Angle', type: 'range', group: 'Light', min: 0, max: 360, step: 1, default: 135, unit: '°' },
    { key: 'elevation', label: 'Light Elevation', type: 'range', group: 'Light', min: 5, max: 85, step: 1, default: 40, unit: '°' },
    { key: 'specular', label: 'Specular', type: 'range', group: 'Light', min: 0, max: 1.5, step: 0.01, default: 0.4 },
    { key: 'spin', label: 'Light Spin', type: 'range', group: 'Light', min: 0, max: 2, step: 0.01, default: 0, hint: 'Rotates the light over time (rev/sec).' },
    { key: 'tint', label: 'Clay / Chrome Tint', type: 'color', group: 'Color', default: '#d9d4c7', visibleWhen: (v) => v.mode === 'clay' || v.mode === 'chrome' },
    { key: 'ambient', label: 'Ambient', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 0.35 },
  ],
  render({ src, ctx, width, height, params, unit, time }) {
    const mode = params.mode as string;
    const depth = (params.depth as number) * (params.invertHeight ? -1 : 1);
    const h = boxBlur(toLuma(src), width, height, (params.smooth as number) * unit, 2);
    const la = (((params.lightAngle as number) + time * (params.spin as number) * 360) * Math.PI) / 180;
    const el = ((params.elevation as number) * Math.PI) / 180;
    const L = [Math.cos(la) * Math.cos(el), Math.sin(la) * Math.cos(el), Math.sin(el)];
    const H = [L[0], L[1], L[2] + 1];
    const hn = Math.hypot(H[0], H[1], H[2]);
    H[0] /= hn; H[1] /= hn; H[2] /= hn;
    const spec = params.specular as number;
    const amb = params.ambient as number;
    const tint = hexToRgb(params.tint as string);
    const shininess = mode === 'chrome' ? 60 : 24;
    // Slope per unit, not per pixel: a pixel covers less of the picture at 4K.
    // 4.3 keeps the look the 1080 px preview always had.
    const k = depth * 4.3 * unit;

    const d = src.data;
    const out = ctx.createImageData(width, height);
    const op = out.data;
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1) * width, y1 = Math.min(height - 1, y + 1) * width;
      for (let x = 0; x < width; x++) {
        const i = y * width + x, o = i * 4;
        const dx = (h[y * width + Math.min(width - 1, x + 1)] - h[y * width + Math.max(0, x - 1)]) * k;
        const dy = (h[y1 + x] - h[y0 + x]) * k;
        const nl = Math.hypot(dx, dy, 1);
        const nx = -dx / nl, ny = -dy / nl, nz = 1 / nl;
        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const sp = Math.pow(Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]), shininess) * spec * 255;
        const shade = amb + (1 - amb) * diff;
        let r: number, g: number, b: number;
        if (mode === 'emboss') {
          r = g = b = 255 * shade * 0.9;
        } else if (mode === 'chrome') {
          // reflective: contrast-boosted banding from the normal
          const band = 0.5 + 0.5 * Math.sin((nx * 2.2 + ny * 1.3) * Math.PI + diff * 3);
          r = tint[0] * (0.25 + band * 0.75) * shade;
          g = tint[1] * (0.25 + band * 0.75) * shade;
          b = tint[2] * (0.25 + band * 0.75) * shade;
        } else if (mode === 'clay') {
          r = tint[0] * shade; g = tint[1] * shade; b = tint[2] * shade;
        } else {
          r = d[o] * shade * 1.1; g = d[o + 1] * shade * 1.1; b = d[o + 2] * shade * 1.1;
        }
        op[o] = clamp255(r + sp);
        op[o + 1] = clamp255(g + sp);
        op[o + 2] = clamp255(b + sp);
        op[o + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
