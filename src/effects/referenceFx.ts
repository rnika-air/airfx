import { contentOf, withContent } from '../content/content';
import type { EffectDefinition } from './types';
import { curveSampler, byteLut, parseCurves, rgbToHsl } from './adjust/core';
import { adjust, boxBlur, cellAverages, clamp255, createRng, hash2, hexToRgb, luminance, sampleIndex, toLuma } from '../utils/imageProcessing';

/* Original effects built from the techniques in the Synkit reference posts. */

/* ───────────── Topo Survey ───────────── */

export const topoSurvey: EffectDefinition = {
  id: 'topoSurvey',
  name: 'Topo Survey',
  category: 'pattern',
  description: 'Treats brightness as terrain: elevation colour, contour lines and survey marks.',
  animated: (p) => (p.tide as number) > 0,
  audioDefaults: { sea: { band: 'bass', amount: 0.2 } },
  params: [
    { key: 'smooth', label: 'Terrain Smoothing', type: 'range', group: 'Terrain', min: 0, max: 30, step: 0.5, default: 5 },
    { key: 'levels', label: 'Contour Levels', type: 'range', group: 'Terrain', min: 4, max: 60, step: 1, default: 22 },
    { key: 'sea', label: 'Sea Level', type: 'range', group: 'Terrain', min: 0, max: 0.9, step: 0.005, default: 0.14 },
    { key: 'invert', label: 'Invert Terrain', type: 'toggle', group: 'Terrain', default: true },
    { key: 'tide', label: 'Tide Motion', type: 'range', group: 'Terrain', min: 0, max: 0.2, step: 0.002, default: 0 },
    { key: 'water', label: 'Water', type: 'color', group: 'Colors', default: '#a9dcf0' },
    { key: 'low', label: 'Lowland', type: 'color', group: 'Colors', default: '#9cc27a' },
    { key: 'mid', label: 'Upland', type: 'color', group: 'Colors', default: '#e6c88a' },
    { key: 'high', label: 'Peak', type: 'color', group: 'Colors', default: '#b0653a' },
    { key: 'line', label: 'Contour Color', type: 'color', group: 'Colors', default: '#5b3a1e' },
    { key: 'lineStrength', label: 'Contour Strength', type: 'range', group: 'Survey', min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: 'grid', label: 'Survey Grid', type: 'range', group: 'Survey', min: 0, max: 300, step: 1, default: 120, hint: '0 = off.' },
    { key: 'frame', label: 'Map Frame', type: 'toggle', group: 'Survey', default: true },
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const H = boxBlur(toLuma(src), width, height, ((p.smooth as number) * unit) / 2, 2);
    const inv = p.invert as boolean, N = p.levels as number;
    const sea = (p.sea as number) + Math.sin(time * 0.8) * (p.tide as number);
    const cols = [hexToRgb(p.low as string), hexToRgb(p.mid as string), hexToRgb(p.high as string)];
    const water = hexToRgb(p.water as string), line = hexToRgb(p.line as string), ls = p.lineStrength as number;
    const out = ctx.createImageData(width, height), o = out.data;
    const hAt = (i: number) => (inv ? 1 - H[i] : H[i]);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x, oi = i * 4, h = hAt(i);
        const band = Math.floor(h * N);
        let r: number, g: number, b: number;
        if (h < sea) {
          const depth = 1 - (sea - h) / Math.max(0.01, sea) * 0.35;
          r = water[0] * depth; g = water[1] * depth; b = water[2] * depth;
        } else {
          const t = Math.min(1, (band / N - sea) / Math.max(0.01, 1 - sea)) * 2, k = Math.min(1, t | 0), u = t - k;
          const a = cols[k], c = cols[Math.min(2, k + 1)];
          r = a[0] + (c[0] - a[0]) * u; g = a[1] + (c[1] - a[1]) * u; b = a[2] + (c[2] - a[2]) * u;
        }
        // A contour runs wherever the neighbour falls in a different band.
        const nb = Math.max(Math.floor(hAt(Math.min(height - 1, y + 1) * width + x) * N), Math.floor(hAt(y * width + Math.min(width - 1, x + 1)) * N));
        if (nb !== band) {
          const index = Math.max(nb, band) % 5 === 0;
          const k = ls * (index ? 1 : 0.55);
          r += (line[0] - r) * k; g += (line[1] - g) * k; b += (line[2] - b) * k;
        }
        o[oi] = r; o[oi + 1] = g; o[oi + 2] = b; o[oi + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
    const gr = (p.grid as number) * unit;
    ctx.strokeStyle = 'rgba(30,30,30,0.55)';
    ctx.lineWidth = Math.max(1, unit);
    if (gr > 4) {
      const t = gr * 0.1;
      ctx.beginPath();
      for (let y = gr; y < height; y += gr)
        for (let x = gr; x < width; x += gr) {
          ctx.moveTo(x - t, y); ctx.lineTo(x + t, y);
          ctx.moveTo(x, y - t); ctx.lineTo(x, y + t);
        }
      ctx.stroke();
    }
    if (p.frame) {
      const m = 8 * unit, seg = 34 * unit;
      ctx.fillStyle = '#f8f3e4';
      ctx.fillRect(0, 0, width, m * 2); ctx.fillRect(0, height - m * 2, width, m * 2); ctx.fillRect(0, 0, m * 2, height); ctx.fillRect(width - m * 2, 0, m * 2, height);
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 3 * unit;
      ctx.setLineDash([seg, seg]);
      ctx.strokeRect(m * 1.5, m * 1.5, width - m * 3, height - m * 3);
      ctx.setLineDash([]);
    }
  },
};

/* ───────────── Airbrush ───────────── */

export const airbrush: EffectDefinition = {
  id: 'airbrush',
  name: 'Airbrush',
  category: 'texture',
  description: 'Vivid sprayed colour: soft bands of pigment that break into grain at their edges.',
  supportsTransparency: true,
  animated: (p) => p.animate === true,
  audioDefaults: { density: { band: 'level', amount: 0.2 } },
  params: [
    { key: 'levels', label: 'Pigment Levels', type: 'range', group: 'Spray', min: 2, max: 10, step: 1, default: 5 },
    { key: 'softness', label: 'Softness', type: 'range', group: 'Spray', min: 0, max: 24, step: 0.5, default: 3 },
    { key: 'saturation', label: 'Saturation', type: 'range', group: 'Spray', min: 0, max: 3, step: 0.01, default: 1.9 },
    { key: 'overspray', label: 'Overspray', type: 'range', group: 'Spray', min: 0, max: 1, step: 0.01, default: 0.6, hint: 'How far grain scatters past tone edges.' },
    { key: 'grain', label: 'Grain Size', type: 'range', group: 'Grain', min: 0.5, max: 6, step: 0.1, default: 1.2 },
    { key: 'density', label: 'Density', type: 'range', group: 'Grain', min: 0.2, max: 1, step: 0.01, default: 0.82 },
    { key: 'animate', label: 'Animate Grain', type: 'toggle', group: 'Grain', default: false },
    { key: 'dropWhite', label: 'Knock Out Highlights', type: 'range', group: 'Paper', min: 0, max: 1, step: 0.01, default: 0.86, hint: 'Near-white areas become bare paper.' },
    { key: 'paper', label: 'Paper Color', type: 'color', group: 'Paper', default: '#f7f5ee' },
    { key: 'transparent', label: 'Transparent Paper', type: 'toggle', group: 'Paper', default: false },
  ],
  render({ src, ctx, width, height, params: p, unit, frame }) {
    const N = (p.levels as number) - 1, sat = p.saturation as number, over = p.overspray as number;
    const cell = Math.max(1, (p.grain as number) * unit), dens = p.density as number, drop = p.dropWhite as number;
    const paper = hexToRgb(p.paper as string), clear = p.transparent as boolean;
    const seed = p.animate ? frame * 57 : 11;
    const n = width * height, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], d = src.data;
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) ch[c][i] = d[i * 4 + c];
    const rad = ((p.softness as number) * unit) / 2;
    const bl = rad > 0.5 ? ch.map((c) => boxBlur(c, width, height, rad, 2)) : ch;
    const out = ctx.createImageData(width, height), o = out.data;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x, oi = i * 4;
        const h = hash2(Math.floor(x / cell), Math.floor(y / cell), seed);
        const r0 = bl[0][i], g0 = bl[1][i], b0 = bl[2][i], l = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
        // Grain dithers each pixel between neighbouring pigment levels.
        const jitter = (h - 0.5) * over;
        const q = (v: number) => (Math.round((v / 255) * N + jitter) / N) * 255;
        const lq = l * 255;
        const R = lq + (q(r0) - lq) * sat, G = lq + (q(g0) - lq) * sat, B = lq + (q(b0) - lq) * sat;
        // Coverage falls off into highlights, so the spray thins out to bare paper.
        const cov = Math.min(1, Math.max(0, (drop - l) / 0.14 + 0.5)) * (l < drop + 0.08 ? 1 : 0);
        const ink = h < dens * (0.25 + 0.75 * cov) && cov > 0;
        if (ink) {
          o[oi] = clamp255(R); o[oi + 1] = clamp255(G); o[oi + 2] = clamp255(B); o[oi + 3] = 255;
        } else if (!clear) {
          o[oi] = paper[0]; o[oi + 1] = paper[1]; o[oi + 2] = paper[2]; o[oi + 3] = 255;
        }
      }
    ctx.putImageData(out, 0, 0);
  },
};

/* ───────────── Knitwear ───────────── */

export const knitwear: EffectDefinition = {
  id: 'knitwear',
  name: 'Knitwear',
  category: 'pattern',
  description: 'The image knitted stitch by stitch, in a reduced set of yarns.',
  audioDefaults: { stitch: { band: 'bass', amount: 0.05 } },
  params: [
    { key: 'stitch', label: 'Stitch Size', type: 'range', group: 'Knit', min: 5, max: 60, step: 0.5, default: 15 },
    { key: 'ratio', label: 'Stitch Height', type: 'range', group: 'Knit', min: 0.5, max: 1.4, step: 0.01, default: 0.85 },
    { key: 'thread', label: 'Yarn Weight', type: 'range', group: 'Knit', min: 0.15, max: 0.7, step: 0.01, default: 0.42 },
    { key: 'fuzz', label: 'Fuzz', type: 'range', group: 'Knit', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'levels', label: 'Yarn Colors', type: 'range', group: 'Color', min: 2, max: 16, step: 1, default: 6 },
    { key: 'base', label: 'Backing Color', type: 'color', group: 'Color', default: '#2a2622' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Knit', default: 5 },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit }) {
    const w = Math.max(3, (p.stitch as number) * unit), h = w * (p.ratio as number);
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, w, h);
    const lv = (p.levels as number) - 1, q = (v: number) => (Math.round((v / 255) * lv) / lv) * 255;
    const tw = (p.thread as number), fuzz = p.fuzz as number, seed = p.seed as number;
    ctx.fillStyle = p.base as string;
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = 'round';
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        const R = q(data[i]), G = q(data[i + 1]), B = q(data[i + 2]);
        const j = 1 + (hash2(c, r, seed) - 0.5) * fuzz * 0.25;
        const x = c * w + (hash2(c, r, seed + 1) - 0.5) * fuzz * w * 0.08, y = r * h;
        const lw = w * tw;
        // A knit "V": two legs of yarn looping into the row below, lit from above.
        const leg = (x0: number, x1: number, shade: number) => {
          ctx.strokeStyle = `rgb(${R * shade * j | 0},${G * shade * j | 0},${B * shade * j | 0})`;
          ctx.lineWidth = lw;
          ctx.beginPath();
          ctx.moveTo(x0, y - h * 0.15);
          ctx.quadraticCurveTo((x0 + x1) / 2 + (x1 - x0) * 0.1, y + h * 0.55, x1, y + h * 1.15);
          ctx.stroke();
        };
        leg(x + w * 0.05, x + w * 0.5, 0.82);
        leg(x + w * 0.95, x + w * 0.5, 1.02);
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = lw * 0.28;
        ctx.beginPath();
        ctx.moveTo(x + w * 0.8, y + h * 0.1);
        ctx.lineTo(x + w * 0.58, y + h * 0.75);
        ctx.stroke();
      }
  },
};

/* ───────────── Glyph Array ───────────── */

type G = CanvasRenderingContext2D;
const GLYPHS: Record<string, (g: G, s: number) => void> = {
  x: (g, s) => { g.lineWidth = s * 0.18; g.beginPath(); g.moveTo(s * 0.2, s * 0.2); g.lineTo(s * 0.8, s * 0.8); g.moveTo(s * 0.8, s * 0.2); g.lineTo(s * 0.2, s * 0.8); g.stroke(); },
  '+': (g, s) => { g.fillRect(s * 0.4, s * 0.15, s * 0.2, s * 0.7); g.fillRect(s * 0.15, s * 0.4, s * 0.7, s * 0.2); },
  o: (g, s) => { g.lineWidth = s * 0.14; g.beginPath(); g.arc(s / 2, s / 2, s * 0.3, 0, 7); g.stroke(); },
  '.': (g, s) => { g.beginPath(); g.arc(s / 2, s / 2, s * 0.26, 0, 7); g.fill(); },
  s: (g, s) => { g.lineWidth = s * 0.12; g.strokeRect(s * 0.2, s * 0.2, s * 0.6, s * 0.6); g.fillRect(s * 0.4, s * 0.4, s * 0.2, s * 0.2); },
  t: (g, s) => { g.beginPath(); g.moveTo(s * 0.15, s * 0.85); g.lineTo(s * 0.85, s * 0.85); g.lineTo(s * 0.15, s * 0.15); g.fill(); },
  a: (g, s) => { g.lineWidth = s * 0.15; g.beginPath(); g.moveTo(s * 0.2, s * 0.8); g.lineTo(s * 0.8, s * 0.2); g.moveTo(s * 0.35, s * 0.2); g.lineTo(s * 0.8, s * 0.2); g.lineTo(s * 0.8, s * 0.65); g.stroke(); },
  c: (g, s) => { const h = s / 3; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) if ((x + y) % 2 === 0) g.fillRect(x * h, y * h, h, h); },
};

export const glyphArray: EffectDefinition = withContent({
  id: 'glyphArray',
  name: 'Glyph Array',
  category: 'pattern',
  description: 'Tiles of crosses, arrows and nested squares over a chosen colour or tone range.',
  animated: (p) => (p.rate as number) > 0,
  audioDefaults: { coverage: { band: 'beat', amount: 0.3 } },
  params: [
    { key: 'cell', label: 'Cell Size', type: 'range', group: 'Array', min: 6, max: 120, step: 1, default: 26 },
    { key: 'glyphs', label: 'Shapes', type: 'text', group: 'Array', default: 'x+osta.c', maxLength: 16, hint: 'x cross, + plus, o ring, . dot, s nested square, t triangle, a arrow, c checker.' },
    { key: 'mixed', label: 'Mixed Tile Sizes', type: 'toggle', group: 'Array', default: true },
    { key: 'coverage', label: 'Coverage', type: 'range', group: 'Array', min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Array', default: 22 },
    {
      key: 'select', label: 'Apply To', type: 'select', group: 'Selection', default: 'color',
      options: [{ value: 'all', label: 'Everything' }, { value: 'color', label: 'Target Color' }, { value: 'dark', label: 'Shadows' }, { value: 'light', label: 'Highlights' }, { value: 'edges', label: 'Edges' }],
    },
    { key: 'target', label: 'Target Color', type: 'color', group: 'Selection', default: '#d6246e', visibleWhen: (v) => v.select === 'color' },
    { key: 'tolerance', label: 'Tolerance', type: 'range', group: 'Selection', min: 2, max: 180, step: 1, default: 45, unit: '°', visibleWhen: (v) => v.select === 'color' },
    { key: 'threshold', label: 'Threshold', type: 'range', group: 'Selection', min: 0, max: 1, step: 0.01, default: 0.45, visibleWhen: (v) => v.select !== 'all' && v.select !== 'color' },
    {
      key: 'colorMode', label: 'Tile Color', type: 'select', group: 'Color', default: 'palette',
      options: [{ value: 'palette', label: 'Two Colors' }, { value: 'source', label: 'From Image' }],
    },
    { key: 'tile', label: 'Tile', type: 'color', group: 'Color', default: '#ff4fa8', visibleWhen: (v) => v.colorMode === 'palette' },
    { key: 'glyph', label: 'Glyph', type: 'color', group: 'Color', default: '#141014' },
    { key: 'tileMix', label: 'Tile Opacity', type: 'range', group: 'Color', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'rate', label: 'Shuffle Rate', type: 'range', group: 'Motion', min: 0, max: 24, step: 0.5, default: 0, unit: 'fps' },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    ctx.drawImage(srcCanvas, 0, 0);
    const cell = Math.max(4, (p.cell as number) * unit);
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, cell);
    const names = [...((p.glyphs as string) || 'x')].filter((c) => GLYPHS[c]);
    if (!names.length) names.push('x');
    const sel = p.select as string, thr = p.threshold as number, tol = p.tolerance as number, cov = p.coverage as number;
    const tgt = hexToRgb(p.target as string), [th] = rgbToHsl(tgt[0] / 255, tgt[1] / 255, tgt[2] / 255);
    const step = Math.floor(time * (p.rate as number)), seed = p.seed as number;
    const source = p.colorMode === 'source', tileMix = p.tileMix as number;
    const lumAt = (c: number, r: number) => {
      const i = (Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))) * 4;
      return luminance(data[i], data[i + 1], data[i + 2]);
    };
    const taken = new Uint8Array(cols * rows), stamps = contentOf(p, unit), glyphRgb = hexToRgb(p.glyph as string);
    ctx.fillStyle = p.glyph as string;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        if (taken[r * cols + c]) continue;
        const i = (r * cols + c) * 4, R = data[i], G = data[i + 1], B = data[i + 2], l = luminance(R, G, B);
        let on = true;
        if (sel === 'color') {
          const [h, s] = rgbToHsl(R / 255, G / 255, B / 255);
          let dh = Math.abs(h - th);
          if (dh > 180) dh = 360 - dh;
          on = dh < tol && s > 0.15;
        } else if (sel === 'dark') on = l < thr;
        else if (sel === 'light') on = l > thr;
        else if (sel === 'edges') on = Math.abs(lumAt(c + 1, r) - lumAt(c - 1, r)) + Math.abs(lumAt(c, r + 1) - lumAt(c, r - 1)) > thr * 0.6;
        if (!on || hash2(c, r, seed) > cov) continue;
        const span = p.mixed && hash2(c, r, seed + 3) > 0.8 ? 2 : 1;
        const ok = span === 2 && c + 1 < cols && r + 1 < rows;
        const size = ok ? cell * 2 : cell;
        if (ok) taken[r * cols + c + 1] = taken[(r + 1) * cols + c] = taken[(r + 1) * cols + c + 1] = 1;
        ctx.save();
        ctx.translate(c * cell, r * cell);
        ctx.globalAlpha = tileMix;
        ctx.fillStyle = source ? `rgb(${R},${G},${B})` : (p.tile as string);
        ctx.fillRect(0, 0, size, size);
        ctx.globalAlpha = 1;
        if (stamps) {
          ctx.restore();
          stamps.begin(ctx);
          stamps.stamp(ctx, Math.floor(hash2(c, r, seed + 7 + step * 31) * 9973), (c + 0.5) * cell + (size - cell) / 2, (r + 0.5) * cell + (size - cell) / 2, size * 0.8, glyphRgb);
          stamps.end(ctx);
          continue;
        }
        ctx.fillStyle = ctx.strokeStyle = p.glyph as string;
        GLYPHS[names[Math.floor(hash2(c, r, seed + 7 + step * 31) * names.length)]](ctx, size);
        ctx.restore();
      }
  },
});

/* ───────────── Pattern Merge ───────────── */

export const patternMerge: EffectDefinition = {
  id: 'patternMerge',
  name: 'Pattern Merge',
  category: 'texture',
  description: 'Chunky pixel outlines trace the tonal edges of the image, merging a pattern into it.',
  animated: (p) => (p.rate as number) > 0,
  audioDefaults: { threshold: { band: 'bass', amount: -0.15 } },
  params: [
    { key: 'cell', label: 'Pixel Size', type: 'range', group: 'Outline', min: 2, max: 40, step: 0.5, default: 9 },
    { key: 'threshold', label: 'Edge Threshold', type: 'range', group: 'Outline', min: 0.01, max: 0.6, step: 0.005, default: 0.12 },
    { key: 'width', label: 'Outline Width', type: 'range', group: 'Outline', min: 1, max: 4, step: 1, default: 2 },
    { key: 'color', label: 'Outline Color', type: 'color', group: 'Outline', default: '#ff1fb0' },
    {
      key: 'fill', label: 'Inner Pattern', type: 'select', group: 'Pattern', default: 'none',
      options: [{ value: 'none', label: 'None' }, { value: 'dots', label: 'Dots' }, { value: 'stripes', label: 'Stripes' }, { value: 'checker', label: 'Checker' }],
    },
    { key: 'fillTone', label: 'Pattern in Tones Below', type: 'range', group: 'Pattern', min: 0, max: 1, step: 0.01, default: 0.4, visibleWhen: (v) => v.fill !== 'none' },
    { key: 'imageMix', label: 'Image Mix', type: 'range', group: 'Image', min: 0, max: 1, step: 0.01, default: 1 },
    { key: 'pixelate', label: 'Pixelate Image', type: 'toggle', group: 'Image', default: false },
    { key: 'background', label: 'Background', type: 'color', group: 'Image', default: '#0b0b0b', visibleWhen: (v) => (v.imageMix as number) < 1 },
    { key: 'rate', label: 'Crawl Speed', type: 'range', group: 'Motion', min: 0, max: 12, step: 0.5, default: 0 },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    const cell = Math.max(2, (p.cell as number) * unit);
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, cell);
    const L = new Float32Array(cols * rows);
    for (let i = 0; i < L.length; i++) L[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    ctx.fillStyle = p.background as string;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = p.imageMix as number;
    ctx.imageSmoothingEnabled = !p.pixelate;
    if (p.pixelate) {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = (r * cols + c) * 4;
          ctx.fillStyle = `rgb(${data[i]},${data[i + 1]},${data[i + 2]})`;
          ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        }
    } else ctx.drawImage(srcCanvas, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    const thr = p.threshold as number, wd = p.width as number, fill = p.fill as string, tone = p.fillTone as number;
    const crawl = Math.floor(time * (p.rate as number));
    const edge = new Uint8Array(cols * rows);
    for (let r = 1; r < rows - 1; r++)
      for (let c = 1; c < cols - 1; c++) {
        const i = r * cols + c;
        const gx = L[i + 1] - L[i - 1], gy = L[i + cols] - L[i - cols];
        if (Math.hypot(gx, gy) > thr) edge[i] = 1;
      }
    ctx.fillStyle = p.color as string;
    const b = wd - 1;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        let on = false;
        for (let y = -b; y <= b && !on; y++) for (let x = -b; x <= b && !on; x++) {
          const j = (r + y) * cols + c + x;
          if (r + y >= 0 && r + y < rows && c + x >= 0 && c + x < cols && edge[j]) on = true;
        }
        if (on && (!crawl || (c + r + crawl) % 7 !== 0)) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        else if (fill !== 'none' && L[r * cols + c] < tone) {
          if (fill === 'dots') { ctx.beginPath(); ctx.arc(c * cell + cell / 2, r * cell + cell / 2, cell * 0.25, 0, 7); ctx.fill(); }
          else if (fill === 'stripes' && r % 2 === 0) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell * 0.5);
          else if (fill === 'checker' && (r + c) % 2 === 0) ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
        }
      }
  },
};

/* ───────────── Liner Pro ───────────── */

export const linerPro: EffectDefinition = {
  id: 'linerPro',
  name: 'Liner Pro',
  category: 'texture',
  description: 'Engraving lines whose weight follows tone, broken by image-driven shifts.',
  animated: (p) => (p.speed as number) > 0,
  audioDefaults: { shift: { band: 'bass', amount: 0.3 } },
  params: [
    { key: 'spacing', label: 'Line Spacing', type: 'range', group: 'Lines', min: 2, max: 40, step: 0.5, default: 7 },
    { key: 'angle', label: 'Angle', type: 'range', group: 'Lines', min: -90, max: 90, step: 1, default: -8, unit: '°' },
    { key: 'minW', label: 'Minimum Weight', type: 'range', group: 'Lines', min: 0, max: 1, step: 0.01, default: 0.06 },
    { key: 'maxW', label: 'Maximum Weight', type: 'range', group: 'Lines', min: 0.1, max: 1, step: 0.01, default: 0.9 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.3, max: 4, step: 0.01, default: 1.6 },
    { key: 'cut', label: 'Black Cut-Off', type: 'range', group: 'Tone', min: 0, max: 1, step: 0.01, default: 0.14, hint: 'Tones below this leave no line, so the subject cuts out.' },
    { key: 'shift', label: 'Line Shift', type: 'range', group: 'Shift', min: 0, max: 80, step: 0.5, default: 10 },
    { key: 'breakup', label: 'Block Breakup', type: 'range', group: 'Shift', min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: 'colorA', label: 'Line Color', type: 'color', group: 'Color', default: '#f03a3a' },
    { key: 'colorB', label: 'Highlight Color', type: 'color', group: 'Color', default: '#f5f1e6' },
    { key: 'background', label: 'Background', type: 'color', group: 'Color', default: '#0b0b0b' },
    { key: 'speed', label: 'Line Scroll', type: 'range', group: 'Motion', min: 0, max: 3, step: 0.01, default: 0 },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Motion', default: 2 },
  ],
  render({ src, ctx, width, height, params: p, unit, time }) {
    const sp = Math.max(1.5, (p.spacing as number) * unit), a = ((p.angle as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const lo = p.minW as number, hi = p.maxW as number, contrast = p.contrast as number, cut = p.cut as number;
    const sh = (p.shift as number) * unit, br = p.breakup as number, seed = p.seed as number;
    const A = hexToRgb(p.colorA as string), B = hexToRgb(p.colorB as string), bg = hexToRgb(p.background as string);
    const scroll = time * (p.speed as number) * sp * 3;
    const d = src.data, out = ctx.createImageData(width, height), o = out.data, bw = 40 * unit;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const oi = (y * width + x) * 4;
        const u = x * ca + y * sa, v = -x * sa + y * ca + scroll;
        const row = Math.floor(v / sp);
        const blockId = Math.floor(u / bw) + row * 37;
        const off = hash2(blockId, row, seed) < br ? (hash2(row, blockId, seed + 1) - 0.5) * 2 * sh : 0;
        const si = sampleIndex(width, height, x + ca * off, y + sa * off);
        const l = adjust(luminance(d[si], d[si + 1], d[si + 2]), 0, contrast);
        const pos = Math.abs(v / sp - row - 0.5) * 2;
        const weight = l <= cut ? 0 : lo + (hi - lo) * l;
        const cov = Math.min(1, Math.max(0, (weight - pos) * sp * 0.6 + 0.5)) * (l > cut ? 1 : 0);
        const hl = l > 0.72 ? 1 : 0;
        const c = hl ? B : A;
        o[oi] = bg[0] + (c[0] - bg[0]) * cov; o[oi + 1] = bg[1] + (c[1] - bg[1]) * cov; o[oi + 2] = bg[2] + (c[2] - bg[2]) * cov; o[oi + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

/* ───────────── Pixel Crusher ───────────── */

export const pixelCrusher: EffectDefinition = {
  id: 'pixelCrusher',
  name: 'Pixel Crusher',
  category: 'distortion',
  description: 'Crushes bit depth and resolution until the picture collapses into hard data bands.',
  animated: (p) => (p.rate as number) > 0,
  audioDefaults: { pixelW: { band: 'bass', amount: 0.15 } },
  params: [
    { key: 'pixelW', label: 'Pixel Width', type: 'range', group: 'Crush', min: 1, max: 80, step: 0.5, default: 10 },
    { key: 'pixelH', label: 'Pixel Height', type: 'range', group: 'Crush', min: 1, max: 40, step: 0.5, default: 3 },
    { key: 'bits', label: 'Levels per Channel', type: 'range', group: 'Crush', min: 2, max: 8, step: 1, default: 2 },
    { key: 'boost', label: 'Color Boost', type: 'range', group: 'Crush', min: 0, max: 3, step: 0.01, default: 1.6 },
    { key: 'threshold', label: 'Black Threshold', type: 'range', group: 'Crush', min: 0, max: 1, step: 0.01, default: 0.22 },
    { key: 'smear', label: 'Row Smear', type: 'range', group: 'Glitch', min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: 'rowShift', label: 'Row Shift', type: 'range', group: 'Glitch', min: 0, max: 200, step: 1, default: 30 },
    { key: 'scanlines', label: 'Scanlines', type: 'range', group: 'Glitch', min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: 'rate', label: 'Glitch Rate', type: 'range', group: 'Glitch', min: 0, max: 24, step: 0.5, default: 6, unit: 'fps' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Glitch', default: 3 },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    const pw = Math.max(1, (p.pixelW as number) * unit), ph = Math.max(1, (p.pixelH as number) * unit);
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, pw, ph);
    const n = (p.bits as number) - 1, boost = p.boost as number, thr = p.threshold as number, smear = p.smear as number;
    const seed = (p.seed as number) + Math.floor(time * (p.rate as number)) * 13, shiftMax = (p.rowShift as number) * unit, sc = p.scanlines as number;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    for (let r = 0; r < rows; r++) {
      const shift = hash2(r >> 1, 5, seed) < 0.3 ? (hash2(r, 9, seed) - 0.5) * 2 * shiftMax : 0;
      const dim = r % 2 ? 1 - sc * 0.6 : 1;
      let hold = -1;
      for (let c = 0; c < cols; c++) {
        // Smeared runs hold the previous cell's colour, like a stuck decoder.
        if (hash2(c, r, seed) > smear || hold < 0) hold = (r * cols + c) * 4;
        const i = hold, l = luminance(data[i], data[i + 1], data[i + 2]);
        if (l < thr) continue;
        const q = (v: number) => (Math.round(Math.min(1, ((v / 255 - l) * boost + l)) * n) / n) * 255 * dim;
        ctx.fillStyle = `rgb(${q(data[i]) | 0},${q(data[i + 1]) | 0},${q(data[i + 2]) | 0})`;
        ctx.fillRect(c * pw + shift, r * ph, pw + 0.5, ph + 0.5);
      }
    }
  },
};

/* ───────────── Shape Halftone ───────────── */

const SHAPES: Record<string, (g: G, r: number) => void> = {
  pill: (g, r) => { g.roundRect(-r * 1.5, -r * 0.6, r * 3, r * 1.2, r * 0.6); },
  diamond: (g, r) => { g.moveTo(0, -r * 1.3); g.lineTo(r * 1.3, 0); g.lineTo(0, r * 1.3); g.lineTo(-r * 1.3, 0); g.closePath(); },
  cross: (g, r) => { const t = r * 0.42, l = r * 1.3; g.rect(-l, -t, l * 2, t * 2); g.rect(-t, -l, t * 2, l * 2); },
  triangle: (g, r) => { g.moveTo(0, -r * 1.4); g.lineTo(r * 1.25, r * 0.9); g.lineTo(-r * 1.25, r * 0.9); g.closePath(); },
  hexagon: (g, r) => { for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3; const x = Math.cos(a) * r * 1.15, y = Math.sin(a) * r * 1.15; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); },
  star: (g, r) => { for (let i = 0; i < 10; i++) { const a = (i * Math.PI) / 5 - Math.PI / 2, q = i % 2 ? r * 0.6 : r * 1.5; const x = Math.cos(a) * q, y = Math.sin(a) * q; if (i) g.lineTo(x, y); else g.moveTo(x, y); } g.closePath(); },
  circle: (g, r) => { g.moveTo(r, 0); g.arc(0, 0, r, 0, 7); },
};

export const shapeHalftone: EffectDefinition = withContent({
  id: 'shapeHalftone',
  name: 'Shape Halftone',
  category: 'texture',
  description: 'Halftone built from pills, stars or crosses, with its own tone curve.',
  supportsTransparency: true,
  audioDefaults: { spacing: { band: 'bass', amount: 0.08 } },
  params: [
    { key: 'shape', label: 'Shape', type: 'select', group: 'Screen', default: 'pill', options: Object.keys(SHAPES).map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })) },
    { key: 'spacing', label: 'Grid Spacing', type: 'range', group: 'Screen', min: 4, max: 60, step: 0.5, default: 13 },
    { key: 'scale', label: 'Shape Scale', type: 'range', group: 'Screen', min: 0.2, max: 1.5, step: 0.01, default: 0.72 },
    { key: 'angle', label: 'Grid Angle', type: 'range', group: 'Screen', min: 0, max: 90, step: 1, default: 45, unit: '°' },
    { key: 'shapeAngle', label: 'Shape Rotation', type: 'range', group: 'Screen', min: 0, max: 180, step: 1, default: 45, unit: '°' },
    { key: 'curve', label: 'Tone Curve', type: 'custom', editor: 'curves', group: 'Tone', default: '' },
    { key: 'invert', label: 'Invert', type: 'toggle', group: 'Tone', default: false },
    { key: 'colorMode', label: 'Color Mode', type: 'select', group: 'Color', default: 'duo', options: [{ value: 'duo', label: 'Two Inks' }, { value: 'source', label: 'From Image' }] },
    { key: 'ink', label: 'Ink', type: 'color', group: 'Color', default: '#10201c', visibleWhen: (v) => v.colorMode === 'duo' },
    { key: 'ink2', label: 'Highlight Ink', type: 'color', group: 'Color', default: '#7fb8a2', visibleWhen: (v) => v.colorMode === 'duo' },
    { key: 'background', label: 'Background Color', type: 'color', group: 'Color', default: '#efe7cf' },
    { key: 'transparent', label: 'Transparent Background', type: 'toggle', group: 'Color', default: false },
  ],
  render({ src, ctx, width, height, params: p, unit }) {
    const sp = Math.max(3, (p.spacing as number) * unit), a = ((p.angle as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const rot = ((p.shapeAngle as number) * Math.PI) / 180, shape = SHAPES[p.shape as string] ?? SHAPES.pill, sc = p.scale as number;
    const lut = byteLut(curveSampler(parseCurves(p.curve as string).rgb)), inv = p.invert as boolean;
    const d = src.data, duo = p.colorMode === 'duo';
    if (!p.transparent) { ctx.fillStyle = p.background as string; ctx.fillRect(0, 0, width, height); }
    const half = Math.hypot(width, height) / 2 + sp, steps = Math.ceil(half / sp), cx = width / 2, cy = height / 2;
    const ink = hexToRgb(p.ink as string), ink2 = hexToRgb(p.ink2 as string), stamps = contentOf(p, unit);
    stamps?.begin(ctx);
    let placed = 0;
    for (let gy = -steps; gy <= steps; gy++)
      for (let gx = -steps; gx <= steps; gx++) {
        const u = gx * sp, v = gy * sp, x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
        if (x < -sp || y < -sp || x > width + sp || y > height + sp) continue;
        const i = sampleIndex(width, height, x, y);
        const l = lut[Math.round(luminance(d[i], d[i + 1], d[i + 2]) * 255)] / 255;
        const t = inv ? l : 1 - l;
        if (t < 0.01) continue;
        const r = sp * 0.5 * sc * Math.sqrt(t) * 1.25;
        if (stamps) {
          const k = Math.min(1, t * 1.15);
          stamps.stamp(ctx, placed++, x, y, r * 2.4, duo ? ink2.map((q, n) => q + (ink[n] - q) * k) : [d[i], d[i + 1], d[i + 2]], rot);
          continue;
        }
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rot);
        if (duo) {
          const k = Math.min(1, t * 1.15);
          ctx.fillStyle = `rgb(${ink2[0] + (ink[0] - ink2[0]) * k | 0},${ink2[1] + (ink[1] - ink2[1]) * k | 0},${ink2[2] + (ink[2] - ink2[2]) * k | 0})`;
        } else ctx.fillStyle = `rgb(${d[i]},${d[i + 1]},${d[i + 2]})`;
        ctx.beginPath();
        shape(ctx, r);
        ctx.fill();
        ctx.restore();
      }
    stamps?.end(ctx);
  },
});

/* ───────────── CMYK Print ───────────── */

export const cmykPrint: EffectDefinition = {
  id: 'cmykPrint',
  name: 'CMYK Print',
  category: 'texture',
  description: 'Four separated plates (C, M, Y, K) at press angles, with dot gain and misregistration.',
  audioDefaults: { misreg: { band: 'beat', amount: 0.2 } },
  params: [
    { key: 'cell', label: 'Screen Size', type: 'range', group: 'Plates', min: 2, max: 30, step: 0.25, default: 6 },
    { key: 'gain', label: 'Dot Gain', type: 'range', group: 'Plates', min: 0.5, max: 1.6, step: 0.01, default: 1.05 },
    { key: 'gcr', label: 'Black Generation', type: 'range', group: 'Plates', min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: 'misreg', label: 'Misregistration', type: 'range', group: 'Plates', min: 0, max: 20, step: 0.25, default: 1.5 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Tone', min: 0.4, max: 3, step: 0.01, default: 1.15 },
    { key: 'paper', label: 'Paper', type: 'color', group: 'Tone', default: '#f6f2e8' },
    { key: 'cInk', label: 'Cyan Plate', type: 'toggle', group: 'Plate Visibility', default: true },
    { key: 'mInk', label: 'Magenta Plate', type: 'toggle', group: 'Plate Visibility', default: true },
    { key: 'yInk', label: 'Yellow Plate', type: 'toggle', group: 'Plate Visibility', default: true },
    { key: 'kInk', label: 'Black Plate', type: 'toggle', group: 'Plate Visibility', default: true },
  ],
  render({ src, ctx, width, height, params: p, unit }) {
    const k = Math.PI / Math.max(1.5, (p.cell as number) * unit), gain = p.gain as number, gcr = p.gcr as number, mis = (p.misreg as number) * unit;
    const contrast = p.contrast as number, paper = hexToRgb(p.paper as string);
    const angles = [15, 75, 0, 45].map((d) => (d * Math.PI) / 180), offs = [[mis, 0], [-mis, mis * 0.6], [0, -mis], [0, 0]];
    const on = [p.cInk, p.mInk, p.yInk, p.kInk];
    const inks = [[0, 174, 239], [236, 0, 140], [255, 242, 0], [26, 23, 27]];
    const plates = angles.map((a) => [Math.cos(a), Math.sin(a)]);
    const d = src.data, out = ctx.createImageData(width, height), o = out.data, n = width * height;
    // Separate the colours once. Each plate then only reads its own value at its offset.
    const sep = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const q = i * 4, C = 1 - adjust(d[q] / 255, 0, contrast), M = 1 - adjust(d[q + 1] / 255, 0, contrast), Y = 1 - adjust(d[q + 2] / 255, 0, contrast), K = Math.min(C, M, Y) * gcr;
      sep[0][i] = (C - K) * gain; sep[1][i] = (M - K) * gain; sep[2][i] = (Y - K) * gain; sep[3][i] = K * gain;
    }
    const mul = inks.map((c) => [1 - c[0] / 255, 1 - c[1] / 255, 1 - c[2] / 255]);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const oi = (y * width + x) * 4;
        let R = paper[0], G = paper[1], B = paper[2];
        for (let c = 0; c < 4; c++) {
          if (!on[c]) continue;
          const tone = sep[c][sampleIndex(width, height, x + offs[c][0], y + offs[c][1]) >> 2];
          const ca = plates[c][0], sa = plates[c][1], u = x * ca + y * sa, v = -x * sa + y * ca;
          const screen = (Math.sin(u * k) * Math.sin(v * k) + 1) / 2;
          const cov = Math.min(1, Math.max(0, (tone - screen) * 4 + 0.5)), m = mul[c];
          R *= 1 - cov * m[0]; G *= 1 - cov * m[1]; B *= 1 - cov * m[2];
        }
        o[oi] = R; o[oi + 1] = G; o[oi + 2] = B; o[oi + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

/* ───────────── Brick Mosaic ───────────── */

const BRICK_PALETTE = ['#f4f4f4', '#9c9c9c', '#5a5a5a', '#1b1b1b', '#c91a09', '#f2cd37', '#237841', '#0055bf', '#fe8a18', '#5a93db', '#aa7d55', '#e4adc8', '#4b9f4a', '#720e0f'].map(hexToRgb);

export const brickMosaic: EffectDefinition = {
  id: 'brickMosaic',
  name: 'Brick Mosaic',
  category: 'pattern',
  description: 'Rebuilds the image in plastic studs, with gloss, rounding and a build animation.',
  animated: (p) => p.motion !== 'none',
  audioDefaults: { gloss: { band: 'beat', amount: 0.3 } },
  params: [
    { key: 'size', label: 'Stud Size', type: 'range', group: 'Bricks', min: 6, max: 80, step: 0.5, default: 24 },
    { key: 'rounding', label: 'Edge Rounding', type: 'range', group: 'Bricks', min: 0, max: 1, step: 0.01, default: 0.12, hint: '1 = fully round studs on a dark board.' },
    { key: 'gap', label: 'Gap', type: 'range', group: 'Bricks', min: 0, max: 0.3, step: 0.005, default: 0.04 },
    { key: 'stud', label: 'Show Studs', type: 'toggle', group: 'Bricks', default: true },
    { key: 'gloss', label: 'Gloss', type: 'range', group: 'Surface', min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: 'depth', label: 'Shading Depth', type: 'range', group: 'Surface', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'colorMode', label: 'Color Mode', type: 'select', group: 'Color', default: 'source', options: [{ value: 'source', label: 'Source' }, { value: 'palette', label: 'Brick Palette' }, { value: 'mono', label: 'Mono' }] },
    { key: 'levels', label: 'Color Levels', type: 'range', group: 'Color', min: 2, max: 32, step: 1, default: 12, visibleWhen: (v) => v.colorMode !== 'palette' },
    { key: 'board', label: 'Board Color', type: 'color', group: 'Color', default: '#121212' },
    { key: 'motion', label: 'Animation', type: 'select', group: 'Motion', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'build', label: 'Build Up' }, { value: 'wave', label: 'Bounce Wave' }] },
    { key: 'speed', label: 'Speed', type: 'range', group: 'Motion', min: 0.1, max: 3, step: 0.01, default: 1, visibleWhen: (v) => v.motion !== 'none' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Motion', default: 1, visibleWhen: (v) => v.motion !== 'none' },
  ],
  render({ srcCanvas, ctx, width, height, params: p, unit, time }) {
    const s = Math.max(4, (p.size as number) * unit);
    const { data, cols, rows } = cellAverages(srcCanvas, width, height, s);
    const round = p.rounding as number, gap = (p.gap as number) * s, gloss = p.gloss as number, depth = p.depth as number;
    const mode = p.colorMode as string, lv = (p.levels as number) - 1, motion = p.motion as string, sp = p.speed as number, seed = p.seed as number;
    const rng = createRng(seed);
    ctx.fillStyle = p.board as string;
    ctx.fillRect(0, 0, width, height);
    const shade = (c: number[], k: number) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
    const buildLen = 3 / sp;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = (r * cols + c) * 4;
        let col: number[] = [data[i], data[i + 1], data[i + 2]];
        if (mode === 'palette') {
          let best = BRICK_PALETTE[0], bd = Infinity;
          for (const q of BRICK_PALETTE) {
            const dd = (col[0] - q[0]) ** 2 * 0.3 + (col[1] - q[1]) ** 2 * 0.59 + (col[2] - q[2]) ** 2 * 0.11;
            if (dd < bd) { bd = dd; best = q; }
          }
          col = best;
        } else {
          if (mode === 'mono') { const l = luminance(col[0], col[1], col[2]) * 255; col = [l, l, l]; }
          col = col.map((v) => (Math.round((v / 255) * lv) / lv) * 255);
        }
        const x = c * s, y = r * s;
        const order = rng();
        let dy = 0, sc = 1;
        if (motion === 'build') {
          const t0 = ((rows - r) / rows) * 0.7 + order * 0.3;
          const u = (((time % (buildLen * 1.4)) / buildLen) - t0) * 6;
          if (u < 0) continue;
          dy = -(Math.max(0, 1 - u) ** 2) * s * 3;
        } else if (motion === 'wave') {
          const w = Math.sin(time * sp * 3 - (c + r) * 0.35);
          sc = 1 + Math.max(0, w) * 0.1;
          dy = -Math.max(0, w) * s * 0.12;
        }
        const size = (s - gap * 2) * sc, cx = x + s / 2, cy = y + s / 2 + dy, half = size / 2;
        const rad = round * half;
        ctx.fillStyle = shade(col, 1 - depth * 0.45);
        ctx.beginPath();
        ctx.roundRect(cx - half, cy - half, size, size, rad);
        ctx.fill();
        ctx.fillStyle = shade(col, 1);
        ctx.beginPath();
        ctx.roundRect(cx - half, cy - half, size, size - size * 0.06 * depth, rad);
        ctx.fill();
        if (p.stud) {
          const sr = half * 0.62;
          ctx.fillStyle = shade(col, 1 - depth * 0.4);
          ctx.beginPath();
          ctx.arc(cx, cy + sr * 0.1, sr, 0, 7);
          ctx.fill();
          ctx.fillStyle = shade(col, 1 + depth * 0.18);
          ctx.beginPath();
          ctx.arc(cx, cy - sr * 0.04, sr * 0.96, 0, 7);
          ctx.fill();
          if (gloss > 0) {
            ctx.strokeStyle = `rgba(255,255,255,${gloss * 0.8})`;
            ctx.lineWidth = sr * 0.16;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(cx, cy - sr * 0.04, sr * 0.68, Math.PI * 1.1, Math.PI * 1.6);
            ctx.stroke();
          }
        }
      }
  },
};

export const REFERENCE_FX = [topoSurvey, airbrush, knitwear, glyphArray, patternMerge, linerPro, pixelCrusher, shapeHalftone, cmykPrint, brickMosaic];
