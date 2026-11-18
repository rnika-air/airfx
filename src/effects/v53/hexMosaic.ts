import type { EffectDefinition } from '../types';
import { createCanvas, get2d, hexToRgb, sampleBilinear } from '../../utils/imageProcessing';
import { C, R, S, T } from '../generative';

/**
 * Hex Mosaic: the picture through a honeycomb. Each cell can be a flat tile
 * of its average colour, a bevelled tile lit from one side, or a small lens
 * that magnifies and bulges its own piece of the picture (a compound eye or
 * bubble wrap), with a glossy highlight and a dark rim.
 *
 * For every pixel the cell is found exactly (hex grid rounding), so the
 * borders stay sharp at any size.
 */

const SQ3 = Math.sqrt(3);

export const hexMosaic: EffectDefinition = {
  id: 'hexMosaic', name: 'Hex Mosaic', category: 'pattern',
  description: 'A honeycomb of flat tiles, bevelled tiles or tiny lenses that each bend their own piece of the picture.',
  audioDefaults: { bulge: { band: 'bass', amount: 0.3 } },
  params: [
    S('style', 'Cell Style', 'lens', [['lens', 'Lens'], ['flat', 'Flat Tile'], ['bevel', 'Bevelled Tile']], 'Cells'),
    R('size', 'Cell Size', 4, 120, 0.5, 18, 'Cells'),
    S('orient', 'Orientation', 'pointy', [['pointy', 'Pointy Top'], ['flat', 'Flat Top']], 'Cells'),
    R('zoom', 'Lens Zoom', 0.2, 2, 0.01, 0.75, 'Lens', 'Below 1 magnifies each cell’s piece of the picture.'),
    R('bulge', 'Bulge', 0, 1, 0.01, 0.45, 'Lens'),
    R('gloss', 'Gloss', 0, 1, 0.01, 0.35, 'Light'),
    { ...R('bevel', 'Bevel Depth', 0, 1, 0.01, 0.5, 'Light'), visibleWhen: (v) => v.style === 'bevel' },
    R('light', 'Light Angle', 0, 360, 1, 225, 'Light', 'Where the light comes from.'),
    R('line', 'Rim Width', 0, 8, 0.05, 1.2, 'Rim'),
    C('lineColor', 'Rim Color', '#0b0c0b', 'Rim'),
    R('rimShade', 'Rim Shadow', 0, 1, 0.01, 0.35, 'Rim', 'Darkens each cell towards its rim.'),
    T('jitter', 'Uneven Cells', false, 'Cells'),
  ],
  presets: [
    { name: 'Compound Eye', values: { style: 'lens', size: 14, zoom: 0.55, bulge: 0.7, gloss: 0.25, line: 0.8 } },
    { name: 'Bubble Wrap', values: { style: 'lens', size: 26, zoom: 0.9, bulge: 0.6, gloss: 0.7, line: 0.4, lineColor: '#d8d8d8', rimShade: 0.2 } },
    { name: 'Honeycomb Tiles', values: { style: 'bevel', size: 20, bevel: 0.6, line: 2, lineColor: '#1a1206' } },
    { name: 'Flat Hex Pixels', values: { style: 'flat', size: 12, line: 0, rimShade: 0 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const s = Math.max(2, (p.size as number) * unit), style = p.style as string, flatTop = p.orient === 'flat';
    const inr = (s * SQ3) / 2, lineW = (p.line as number) * unit, rim = hexToRgb(p.lineColor as string);
    const zoom = p.zoom as number, bulge = p.bulge as number, gloss = p.gloss as number, bev = p.bevel as number, rimShade = p.rimShade as number;
    const la = ((p.light as number) * Math.PI) / 180, lx = Math.cos(la), ly = Math.sin(la);
    const jitter = p.jitter === true;
    const d = src.data, out = ctx.createImageData(w, h), o = out.data;
    // Average colours: the picture shrunk so one pixel covers about one cell.
    const sw = Math.max(1, Math.round(w / s)), sh = Math.max(1, Math.round(h / s));
    const small = createCanvas(sw, sh), sg = get2d(small, true);
    sg.imageSmoothingQuality = 'high';
    const tmp = createCanvas(w, h), tg = get2d(tmp);
    tg.putImageData(src, 0, 0);
    sg.drawImage(tmp, 0, 0, sw, sh);
    tmp.width = tmp.height = 1;
    const avg = sg.getImageData(0, 0, sw, sh).data;
    small.width = small.height = 1;
    const px = new Uint8ClampedArray(4);
    const bevW = inr * 0.35 * bev + 0.5;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Work in pointy-top hex space; flat-top swaps the axes.
        const X = flatTop ? y : x, Y = flatTop ? x : y;
        const q = ((SQ3 / 3) * X - Y / 3) / s, r = ((2 / 3) * Y) / s;
        // Cube rounding to the nearest cell.
        let rq = Math.round(q), rr = Math.round(r);
        const rs = Math.round(-q - r), dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs + q + r);
        if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
        let cX = s * SQ3 * (rq + rr / 2), cY = s * 1.5 * rr;
        if (jitter) { const hsh = Math.sin(rq * 127.1 + rr * 311.7) * 43758.5453; const j = (hsh - Math.floor(hsh) - 0.5) * s * 0.3; cX += j; cY -= j * 0.6; }
        const lX = X - cX, lY = Y - cY, ax = Math.abs(lX), ay = Math.abs(lY);
        // Distance from this pixel to the cell's edge, in px.
        const edge = inr - Math.max(ax, ax * 0.5 + ay * (SQ3 / 2));
        const cx = flatTop ? cY : cX, cy = flatTop ? cX : cY, ox = flatTop ? lY : lX, oy = flatTop ? lX : lY;
        const k = (y * w + x) * 4;
        let R0: number, G0: number, B0: number;
        if (style === 'lens') {
          // Magnify around the cell centre, bulging most in the middle.
          const rr2 = Math.min(1, (ox * ox + oy * oy) / (inr * inr));
          const m = zoom * (1 - bulge * 0.6 * (1 - rr2));
          sampleBilinear(d, w, h, cx + ox * m, cy + oy * m, px, 0);
          R0 = px[0]; G0 = px[1]; B0 = px[2];
          if (gloss > 0) {
            // A soft highlight towards the light, like a glass bead.
            const gx = ox / inr + lx * 0.4, gy = oy / inr + ly * 0.4, gl = Math.max(0, 1 - (gx * gx + gy * gy) * 5) * gloss * 180;
            R0 += gl; G0 += gl; B0 += gl;
          }
        } else {
          const sx = Math.min(sw - 1, Math.max(0, Math.floor((cx * sw) / w))), sy = Math.min(sh - 1, Math.max(0, Math.floor((cy * sh) / h)));
          const a = (sy * sw + sx) * 4;
          R0 = avg[a]; G0 = avg[a + 1]; B0 = avg[a + 2];
          if (style === 'bevel' && edge < bevW) {
            // The bevel faces outward: lit where its face turns to the light.
            const len = Math.hypot(ox, oy) || 1, f = (1 - edge / bevW) * ((ox / len) * -lx + (oy / len) * -ly) * 90;
            R0 += f; G0 += f; B0 += f;
          }
        }
        if (rimShade > 0) { const v = 1 - rimShade * Math.max(0, 1 - edge / (inr * 0.45)) ** 2; R0 *= v; G0 *= v; B0 *= v; }
        // The rim, anti-aliased over one pixel.
        const a = lineW > 0 ? Math.min(1, Math.max(0, lineW - edge + 0.5)) : 0;
        o[k] = R0 + (rim[0] - R0) * a;
        o[k + 1] = G0 + (rim[1] - G0) * a;
        o[k + 2] = B0 + (rim[2] - B0) * a;
        o[k + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};
