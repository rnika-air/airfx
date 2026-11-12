import type { EffectDefinition, ParamValues } from '../types';
import { contentOf, ICONS, withContent } from '../../content/content';
import { cellAverages, clamp255, createCanvas, get2d, hexToRgb } from '../../utils/imageProcessing';
import { extractPalette, PALETTES } from '../ditherLab';
import { C, R, S, T } from '../generative';

/**
 * Photo to pixel art. Unlike a plain mosaic it decides like a pixel artist:
 * a limited palette, dither, crisp edges and an outline. A second, coarser
 * pixel layer can cut the picture into a drawn shape, as in the reference.
 */

const PAL: Record<string, string[]> = {
  handheld: PALETTES.gameboy,
  fantasy: PALETTES.pico,
  computer: PALETTES.zx,
  cga: PALETTES.cga,
  console8: ['#000000', '#fcfcfc', '#bcbcbc', '#7c7c7c', '#3cbcfc', '#0078f8', '#0000fc', '#0000bc', '#6888fc', '#6844fc', '#4428bc', '#f878f8', '#d800cc', '#940084', '#f85898', '#e40058', '#a80020', '#f0d0b0', '#f87858', '#f83800', '#a81000', '#fca044', '#e45c10', '#881400', '#f8b800', '#ac7c00', '#503000', '#b8f818', '#00b800', '#007800', '#58d854', '#00a800', '#006800', '#58f898', '#00a844', '#005800', '#00e8d8', '#008888', '#004058'],
  sepia: ['#1b1009', '#4a2c17', '#7d5230', '#b18550', '#dcc08a', '#f6ecc9'],
  dusk: ['#0d0221', '#241346', '#541388', '#d90368', '#f75c03', '#f1c40f', '#f6f7d7'],
  mono: ['#000000', '#555555', '#aaaaaa', '#ffffff'],
};

const pal = (v: ParamValues) => v.palette as string;

const bayer = (n: number): Float32Array => {
  let m = [[0]];
  while (m.length < n) {
    const s = m.length, q = Array.from({ length: s * 2 }, () => new Array(s * 2).fill(0) as number[]);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const v = m[y][x] * 4; q[y][x] = v; q[y][x + s] = v + 2; q[y + s][x] = v + 3; q[y + s][x + s] = v + 1; }
    m = q;
  }
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) out[y * n + x] = (m[y][x] + 0.5) / (n * n) - 0.5;
  return out;
};
const BAYER: Record<string, { n: number; m: Float32Array }> = { bayer2: { n: 2, m: bayer(2) }, bayer4: { n: 4, m: bayer(4) }, bayer8: { n: 8, m: bayer(8) } };

let locked: { key: string; pal: number[][]; t: number } | null = null;

function drawCell(g: CanvasRenderingContext2D, shape: string, x: number, y: number, c: number, s: number) {
  const cx = x + c / 2, cy = y + c / 2, r = s / 2;
  if (shape === 'circle') { g.beginPath(); g.arc(cx, cy, r, 0, 6.2832); g.fill(); }
  else if (shape === 'diamond') { g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill(); }
  else if (shape === 'rounded') { g.beginPath(); g.roundRect(cx - r, cy - r, s, s, s * 0.28); g.fill(); }
  else if (shape === 'plus') { const t = s / 3; g.fillRect(cx - r, cy - t / 2, s, t); g.fillRect(cx - t / 2, cy - r, t, s); }
  else if (shape === 'brick') g.fillRect(cx - r, cy - r * 0.7, s, s * 0.7);
  else if (shape === 'led') { g.fillRect(cx - r, cy - r, s / 3.4, s); g.globalAlpha = 0.85; g.fillRect(cx - r + s / 3, cy - r, s / 3.4, s); g.globalAlpha = 0.7; g.fillRect(cx - r + (2 * s) / 3, cy - r, s / 3.4, s); g.globalAlpha = 1; }
  else g.fillRect(cx - r, cy - r, s, s);
}

/** Lays a shape on a coarse grid, so it comes out stair-stepped like a drawn sprite. */
function stencilMask(p: ParamValues, w: number, h: number, unit: number) {
  const cell = Math.max(2, (p.stencilCell as number) * unit), cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), c = createCanvas(cols, rows), g = get2d(c, true);
  const size = (p.stencilSize as number) * Math.min(cols, rows), cx = (p.stencilX as number) * cols, cy = (p.stencilY as number) * rows, shape = p.stencilShape as string;
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  g.lineJoin = 'round';
  const stamper = shape === 'content' ? contentOf(p, 1) : null;
  if (shape === 'spiral') {
    const turns = p.spiralTurns as number, R0 = size / 2;
    g.lineWidth = Math.max(1, p.stencilLine as number);
    g.beginPath();
    for (let i = 0; i <= 900; i++) { const t = i / 900, a = t * turns * Math.PI * 2, r = t * R0, x = cx + Math.cos(a) * r * 1.2, y = cy + Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  } else if (stamper) {
    stamper.begin(g);
    stamper.stamp(g, 0, cx, cy, size, [255, 255, 255]);
    stamper.end(g);
  } else {
    const k = size / 100;
    g.translate(cx - size / 2, cy - size / 2);
    g.scale(k, k);
    const path = new Path2D(ICONS[shape]?.[1] ?? ICONS.star[1]);
    if (p.stencilFill) g.fill(path);
    else { g.lineWidth = Math.max(1, (p.stencilLine as number) / k); g.stroke(path); }
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  const im = g.getImageData(0, 0, cols, rows), d = im.data, inv = p.stencilInvert as boolean;
  for (let i = 3; i < d.length; i += 4) { const on = d[i] > 110 !== inv; d[i - 3] = d[i - 2] = d[i - 1] = 255; d[i] = on ? 255 : 0; }
  g.putImageData(im, 0, 0);
  return { canvas: c, cols, rows, cell };
}

const base: EffectDefinition = {
  id: 'pixelArt', name: 'Image To Pixel Art', category: 'texture',
  description: 'Turns a photo into pixel art: resolution, pixel shape, palette, dither, edges and outline, with sprite-style cutouts.',
  animated: () => false,
  audioDefaults: { pixelSize: { band: 'bass', amount: 0.1 } },
  params: [
    S('sizing', 'Resolution By', 'pixel', [['pixel', 'Pixel Size'], ['width', 'Sprite Width']], 'Resolution'),
    { ...R('pixelSize', 'Pixel Size', 2, 80, 0.5, 9, 'Resolution'), visibleWhen: (v) => v.sizing === 'pixel' },
    { ...R('spriteWidth', 'Sprite Width', 16, 480, 1, 128, 'Resolution', 'Art pixels across the frame.'), visibleWhen: (v) => v.sizing === 'width' },
    R('density', 'Pixel Density', 0.25, 1, 0.01, 1, 'Pixels', 'How much of each cell the pixel fills.'),
    S('shape', 'Pixel Shape', 'square', [['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle'], ['diamond', 'Diamond'], ['plus', 'Plus'], ['brick', 'Brick'], ['led', 'LED Triad'], ['content', 'Custom Content']], 'Pixels'),
    C('gapColor', 'Gap Color', '#0b0c0b', 'Pixels'),
    S('palette', 'Color Palette', 'auto', [['auto', 'From This Image'], ['levels', 'Levels Per Channel'], ['handheld', 'Handheld, 4 Greens'], ['console8', '8-Bit Console'], ['fantasy', 'Fantasy 16'], ['computer', 'Home Computer'], ['cga', 'Four Color CGA'], ['dusk', 'Synth Dusk'], ['sepia', 'Sepia Print'], ['mono', 'Four Grays'], ['custom', 'Custom List']], 'Color'),
    { ...R('colors', 'Colors', 2, 64, 1, 16, 'Color'), visibleWhen: (v) => pal(v) === 'auto' },
    { ...R('levels', 'Levels', 2, 16, 1, 5, 'Color'), visibleWhen: (v) => pal(v) === 'levels' },
    { key: 'custom', label: 'Custom Palette', type: 'text', default: '#101820,#f2542d,#f5dfbb,#0e9594', maxLength: 400, group: 'Color', hint: 'Hex colours separated by commas.', visibleWhen: (v) => pal(v) === 'custom' },
    { ...T('lockPal', 'Lock Palette On Video', false, 'Color'), visibleWhen: (v) => pal(v) === 'auto' },
    R('contrast', 'Contrast', 0.5, 2, 0.01, 1.1, 'Color'),
    R('saturation', 'Saturation', 0, 2, 0.01, 1.15, 'Color'),
    R('brightness', 'Brightness', -0.4, 0.4, 0.01, 0, 'Color'),
    S('dither', 'Dithering', 'bayer4', [['none', 'None'], ['bayer2', 'Ordered 2×2'], ['bayer4', 'Ordered 4×4'], ['bayer8', 'Ordered 8×8'], ['floyd', 'Error Diffusion'], ['atkinson', 'Light Diffusion'], ['noise', 'Noise']], 'Dither'),
    { ...R('ditherAmount', 'Dither Strength', 0, 1, 0.01, 0.45, 'Dither'), visibleWhen: (v) => v.dither !== 'none' },
    R('edges', 'Edge Preservation', 0, 1, 0.01, 0.6, 'Edges', 'Picks a real colour from each cell instead of an average, so edges stay crisp.'),
    R('outline', 'Sprite Outline', 0, 1, 0.01, 0, 'Edges'),
    R('outlineLevel', 'Outline Threshold', 0.02, 0.6, 0.01, 0.18, 'Edges'),
    C('outlineColor', 'Outline Color', '#10101a', 'Edges'),
    S('stencil', 'Pixel Cutout', 'none', [['none', 'Off'], ['cutout', 'Show Image Through Shape'], ['overlay', 'Draw Shape Over Image']], 'Cutout'),
    ...[
      S('stencilShape', 'Cutout Shape', 'spiral', [['spiral', 'Spiral'], ['heart', 'Heart'], ['star', 'Star'], ['sparkle', 'Sparkle'], ['ring', 'Ring'], ['flower', 'Flower'], ['content', 'Custom Content']], 'Cutout'),
      R('stencilCell', 'Cutout Pixel Size', 3, 60, 0.5, 16, 'Cutout'),
      R('stencilSize', 'Cutout Size', 0.2, 2, 0.01, 0.85, 'Cutout'),
      R('stencilX', 'Position X', 0, 1, 0.005, 0.5, 'Cutout'),
      R('stencilY', 'Position Y', 0, 1, 0.005, 0.5, 'Cutout'),
      R('stencilLine', 'Line Thickness', 1, 8, 0.1, 2.2, 'Cutout'),
      R('spiralTurns', 'Spiral Turns', 1, 8, 0.1, 3.5, 'Cutout'),
      T('stencilFill', 'Filled Shape', false, 'Cutout'),
      T('stencilInvert', 'Invert Shape', false, 'Cutout'),
      T('stencilPixel', 'Pixelate Image Too', false, 'Cutout'),
      C('stencilPaper', 'Paper', '#f0efec', 'Cutout'),
    ].map((d) => ({ ...d, visibleWhen: (v: ParamValues) => v.stencil !== 'none' })),
  ],
  presets: [
    { name: 'Handheld', values: { sizing: 'width', spriteWidth: 160, palette: 'handheld', dither: 'bayer4', ditherAmount: 0.5, edges: 0.7, saturation: 1 } },
    { name: '8-Bit Console', values: { sizing: 'width', spriteWidth: 256, palette: 'console8', dither: 'bayer2', ditherAmount: 0.35, outline: 0.5, edges: 0.8 } },
    { name: '16-Bit Console', values: { sizing: 'width', spriteWidth: 320, palette: 'levels', levels: 8, dither: 'bayer2', ditherAmount: 0.2, edges: 0.5 } },
    { name: 'Fantasy Console', values: { sizing: 'width', spriteWidth: 128, palette: 'fantasy', dither: 'floyd', ditherAmount: 0.5, outline: 0.35 } },
    { name: 'Home Computer', values: { sizing: 'width', spriteWidth: 256, palette: 'computer', dither: 'bayer8', ditherAmount: 0.8, edges: 0.3 } },
    { name: 'LED Wall', values: { sizing: 'pixel', pixelSize: 12, shape: 'led', density: 0.9, palette: 'levels', levels: 6, dither: 'none', edges: 0 } },
    { name: 'Pixel Cutout', values: { stencil: 'cutout', stencilShape: 'spiral', stencilPixel: false, palette: 'auto' } },
    { name: 'Pixel Doodle Over Photo', values: { stencil: 'overlay', stencilShape: 'spiral', stencilPixel: false, stencilPaper: '#f4f4f0' } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const cut = p.stencil as string;
    if (cut !== 'none' && !p.stencilPixel) ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    else {
      const cell = Math.max(1, p.sizing === 'width' ? w / (p.spriteWidth as number) : (p.pixelSize as number) * unit);
      const { data: avg, cols, rows } = cellAverages(srcCanvas as HTMLCanvasElement, w, h, cell);
      const n = cols * rows, F = new Float32Array(n * 3), sd = src.data, edges = p.edges as number, ct = p.contrast as number, sat = p.saturation as number, br = (p.brightness as number) * 255;
      const vals: { l: number; i: number }[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c, q = i * 4;
          let a = avg[q], b = avg[q + 1], d = avg[q + 2];
          if (edges > 0) {
            // The median of a few real samples: a pixel that belongs to one side of an edge.
            vals.length = 0;
            for (let s = 0; s < 9; s++) {
              const sx = Math.min(w - 1, ((c + ((s % 3) + 0.5) / 3) * cell) | 0), sy = Math.min(h - 1, ((r + (((s / 3) | 0) + 0.5) / 3) * cell) | 0), k = (sy * w + sx) * 4;
              vals.push({ l: sd[k] * 0.3 + sd[k + 1] * 0.59 + sd[k + 2] * 0.11, i: k });
            }
            vals.sort((x, y) => x.l - y.l);
            const k = vals[4].i;
            a += (sd[k] - a) * edges; b += (sd[k + 1] - b) * edges; d += (sd[k + 2] - d) * edges;
          }
          const l = 0.3 * a + 0.59 * b + 0.11 * d;
          F[i * 3] = (l + (a - l) * sat - 127.5) * ct + 127.5 + br;
          F[i * 3 + 1] = (l + (b - l) * sat - 127.5) * ct + 127.5 + br;
          F[i * 3 + 2] = (l + (d - l) * sat - 127.5) * ct + 127.5 + br;
        }

      // Palette
      const mode = p.palette as string;
      let palette: number[][] | null = null, levels = 0;
      if (mode === 'levels') levels = p.levels as number;
      else if (mode === 'auto') {
        const key = `${p.colors}`;
        if (p.lockPal && locked && locked.key === key && time >= locked.t) palette = locked.pal;
        else {
          const u = new Uint8ClampedArray(n * 4);
          for (let i = 0; i < n; i++) { u[i * 4] = F[i * 3]; u[i * 4 + 1] = F[i * 3 + 1]; u[i * 4 + 2] = F[i * 3 + 2]; }
          palette = extractPalette(u, p.colors as number);
          locked = { key, pal: palette, t: time };
        }
      } else if (mode === 'custom') {
        const list = (p.custom as string).split(/[,\s]+/).filter((s) => /^#[0-9a-f]{6}$/i.test(s));
        palette = (list.length >= 2 ? list : PAL.handheld).map(hexToRgb);
      } else palette = (PAL[mode] ?? PAL.handheld).map(hexToRgb);

      // Nearest colour, remembered per 5-bit colour: most cells repeat.
      const memo = new Int16Array(32768).fill(-1);
      const pick = (r: number, g: number, b: number): number[] => {
        const R0 = clamp255(r), G = clamp255(g), B = clamp255(b);
        if (levels) { const s = 255 / (levels - 1); return [Math.round(R0 / s) * s, Math.round(G / s) * s, Math.round(B / s) * s]; }
        const k = ((R0 >> 3) << 10) | ((G >> 3) << 5) | (B >> 3);
        let bi = memo[k];
        if (bi < 0) {
          let bd = Infinity;
          palette!.forEach((c, i) => { const dr = R0 - c[0], dg = G - c[1], db = B - c[2], dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11; if (dist < bd) { bd = dist; bi = i; } });
          memo[k] = bi;
        }
        return palette![bi];
      };

      const dither = p.dither as string, amt = p.ditherAmount as number, spread = levels ? (255 / (levels - 1)) * amt : (palette!.length > 24 ? 44 : 150 / Math.max(2, Math.sqrt(palette!.length))) * amt;
      const B = BAYER[dither], O = new Uint8ClampedArray(n * 3);
      const diffuse = dither === 'floyd' ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]] : dither === 'atkinson' ? [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]] : null;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          let d = 0;
          if (B) d = B.m[(r % B.n) * B.n + (c % B.n)] * spread;
          else if (dither === 'noise') d = (((Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1) - 0.0) * 0.5 * spread;
          const a = F[i * 3] + d, b = F[i * 3 + 1] + d, e = F[i * 3 + 2] + d, q = pick(a, b, e);
          O[i * 3] = q[0]; O[i * 3 + 1] = q[1]; O[i * 3 + 2] = q[2];
          if (diffuse && amt > 0) {
            for (const [dx, dy, w0] of diffuse) {
              const x = c + dx, y = r + dy;
              if (x < 0 || x >= cols || y >= rows) continue;
              const j = (y * cols + x) * 3, k = w0 * amt;
              F[j] += (a - q[0]) * k; F[j + 1] += (b - q[1]) * k; F[j + 2] += (e - q[2]) * k;
            }
          }
        }

      // Outline: a dark line where the art changes tone sharply, drawn on the darker side.
      const outline = p.outline as number;
      if (outline > 0) {
        const lum = new Float32Array(n), ol = hexToRgb(p.outlineColor as string), th = (p.outlineLevel as number) * 255, S0 = new Uint8ClampedArray(O);
        for (let i = 0; i < n; i++) lum[i] = S0[i * 3] * 0.3 + S0[i * 3 + 1] * 0.59 + S0[i * 3 + 2] * 0.11;
        for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) {
          const i = r * cols + c, l = lum[i];
          if (Math.max(lum[i + 1], lum[i - 1], lum[i + cols], lum[i - cols]) - l > th) for (let k = 0; k < 3; k++) O[i * 3 + k] += (ol[k] - O[i * 3 + k]) * outline;
        }
      }

      const shape = p.shape as string, density = p.density as number, stamper = shape === 'content' ? contentOf(p, unit) : null;
      if (shape === 'square' && density >= 1) {
        const c = createCanvas(cols, rows), g = get2d(c, true), im = g.createImageData(cols, rows);
        for (let i = 0; i < n; i++) { im.data[i * 4] = O[i * 3]; im.data[i * 4 + 1] = O[i * 3 + 1]; im.data[i * 4 + 2] = O[i * 3 + 2]; im.data[i * 4 + 3] = 255; }
        g.putImageData(im, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(c, 0, 0, cols * cell, rows * cell);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.fillStyle = p.gapColor as string;
        ctx.fillRect(0, 0, w, h);
        const s = cell * density;
        stamper?.begin(ctx);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          if (stamper) { stamper.stamp(ctx, i, (c + 0.5) * cell, (r + 0.5) * cell, s, [O[i * 3], O[i * 3 + 1], O[i * 3 + 2]]); continue; }
          ctx.fillStyle = `rgb(${O[i * 3]},${O[i * 3 + 1]},${O[i * 3 + 2]})`;
          drawCell(ctx, shape, c * cell, r * cell, cell, s);
        }
        stamper?.end(ctx);
      }
    }
    if (cut === 'none') return;

    const m = stencilMask(p, w, h, unit), paper = p.stencilPaper as string, tint = createCanvas(m.cols, m.rows), tg = get2d(tint);
    tg.drawImage(m.canvas, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = paper;
    tg.fillRect(0, 0, m.cols, m.rows);
    if (cut === 'cutout') {
      // Paper everywhere except where the shape lets the picture through.
      const inv = createCanvas(m.cols, m.rows), ig = get2d(inv);
      ig.fillStyle = paper;
      ig.fillRect(0, 0, m.cols, m.rows);
      ig.globalCompositeOperation = 'destination-out';
      ig.drawImage(m.canvas, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(inv, 0, 0, m.cols * m.cell, m.rows * m.cell);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tint, 0, 0, m.cols * m.cell, m.rows * m.cell);
    }
    ctx.imageSmoothingEnabled = true;
  },
};

export const pixelArt = withContent(base);
