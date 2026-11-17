import type { EffectDefinition } from '../types';
import { cellAverages, hexToRgb } from '../../utils/imageProcessing';
import { C, R, S, T } from '../generative';

/**
 * Voxel Cubes: the picture rebuilt from isometric cubes. Each cube takes the
 * colour under it, and can rise with the brightness (or darkness) of the
 * picture, so the image becomes a small 3D relief of voxels. Three faces per
 * cube, lit from the upper left, drawn back to front.
 */

export const voxelCubes: EffectDefinition = {
  id: 'voxelCubes', name: 'Voxel Cubes', category: 'pattern',
  description: 'The picture rebuilt from isometric 3D cubes that rise with its light.',
  audioDefaults: { height: { band: 'bass', amount: 0.4 } },
  params: [
    R('size', 'Cube Size', 3, 60, 0.5, 18, 'Cubes'),
    R('height', 'Height', 0, 3, 0.01, 1, 'Cubes', 'How far bright cubes rise.'),
    S('from', 'Rise With', 'light', [['light', 'Brightness'], ['dark', 'Darkness'], ['none', 'Flat']], 'Cubes'),
    R('steps', 'Height Steps', 0, 12, 1, 6, 'Cubes', 'Stacks heights in whole blocks. 0 = smooth.'),
    R('levels', 'Color Levels', 0, 16, 1, 0, 'Color', 'Fewer colours, like voxel art. 0 = all.'),
    R('top', 'Top Light', 0, 0.6, 0.01, 0.12, 'Light'),
    R('side', 'Side Shade', 0, 0.8, 0.01, 0.3, 'Light'),
    R('line', 'Edge Lines', 0, 3, 0.05, 0.3, 'Edges'),
    C('lineColor', 'Edge Color', '#0b0c0b', 'Edges'),
    C('bg', 'Background', '#0b0c0b', 'Color'),
    T('flip', 'Light From Right', false, 'Light'),
  ],
  presets: [
    { name: 'Voxel City', values: { size: 14, height: 1.6, from: 'light', steps: 8, levels: 8, line: 0.3 } },
    { name: 'Flat Isometric', values: { size: 16, height: 0, from: 'none', line: 0.6, levels: 0 } },
    { name: 'Deep Relief', values: { size: 12, height: 2.6, steps: 0, line: 0, side: 0.45 } },
    { name: 'Chunky Blocks', values: { size: 30, height: 1, steps: 4, levels: 6, line: 1.2 } },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit }) {
    const a = Math.max(2, (p.size as number) * unit), ah = a / 2; // rhombus half-width and half-height
    const { data, cols, rows } = cellAverages(srcCanvas, w, h, a, ah);
    ctx.fillStyle = p.bg as string;
    ctx.fillRect(0, 0, w, h);
    const from = p.from as string, maxH = (p.height as number) * a * 2.2, steps = Math.round(p.steps as number);
    const levels = Math.round(p.levels as number), q = levels > 1 ? 255 / (levels - 1) : 0;
    const top = p.top as number, side = p.side as number, flip = p.flip === true;
    const line = (p.line as number) * unit, lc = hexToRgb(p.lineColor as string);
    const sample = (x: number, y: number) => {
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(x / a))), cy = Math.min(rows - 1, Math.max(0, Math.floor(y / ah)));
      const i = (cy * cols + cx) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // Tops lighten towards white (never past it); sides darken.
    const toWhite = (c: number[], t: number) => c.map((v) => v + (255 - v) * t);
    const css = (c: number[], k: number) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
    if (line > 0) { ctx.lineWidth = line; ctx.strokeStyle = `rgb(${lc[0]},${lc[1]},${lc[2]})`; ctx.lineJoin = 'round'; }
    // Rows from the back (top of the picture) to the front, so nearer cubes cover farther ones.
    const nRows = Math.ceil(h / ah) + Math.ceil(maxH / ah) + 2, nCols = Math.ceil(w / (2 * a)) + 2;
    for (let j = 0; j < nRows; j++) {
      const y = j * ah;
      for (let i = -1; i < nCols; i++) {
        const x = i * 2 * a + (j % 2 ? a : 0);
        let c = sample(x, Math.min(h - 1, y));
        if (q) c = c.map((v) => Math.round(v / q) * q);
        const l = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
        let lift = from === 'light' ? l : from === 'dark' ? 1 - l : 0;
        if (steps > 0) lift = Math.round(lift * steps) / steps;
        const H = lift * maxH, ty = y - H;
        if (ty - ah > h || y + ah + a < 0) continue;
        // Faces: left and right sides down to the base, then the top.
        const L = flip ? 1 - side * 0.5 : 1 - side, Rr = flip ? 1 - side : 1 - side * 0.5;
        ctx.fillStyle = css(c, L);
        ctx.beginPath(); ctx.moveTo(x - a, ty); ctx.lineTo(x, ty + ah); ctx.lineTo(x, y + ah + ah); ctx.lineTo(x - a, y + ah); ctx.closePath();
        ctx.fill(); if (line > 0) ctx.stroke();
        ctx.fillStyle = css(c, Rr);
        ctx.beginPath(); ctx.moveTo(x + a, ty); ctx.lineTo(x, ty + ah); ctx.lineTo(x, y + ah + ah); ctx.lineTo(x + a, y + ah); ctx.closePath();
        ctx.fill(); if (line > 0) ctx.stroke();
        ctx.fillStyle = css(toWhite(c, top * 0.6), 1);
        ctx.beginPath(); ctx.moveTo(x, ty - ah); ctx.lineTo(x + a, ty); ctx.lineTo(x, ty + ah); ctx.lineTo(x - a, ty); ctx.closePath();
        ctx.fill(); if (line > 0) ctx.stroke();
      }
    }
  },
};
