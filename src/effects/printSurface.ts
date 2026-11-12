import { contentOf, withContent } from '../content/content';
import type { EffectDefinition } from './types';
import { boxBlur, clamp255, createCanvas, createRng, fbm, get2d, hash2, hexToRgb, sampleBilinear, toLuma, valueNoise, coarseField } from '../utils/imageProcessing';
import { C, R, S, SEED, T, rgbCss } from './generative';

/** Print, surface and time-based looks. Original implementations. */

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export const cyanotype: EffectDefinition = {
  id: 'cyanotype',
  name: 'Cyanotype',
  category: 'texture',
  description: 'A sun print: dark pigment washes bleed softly into pale paper.',
  params: [
    R('density', 'Wash Density', 0.3, 2.5, 0.01, 1.2, 'Print'),
    R('bleed', 'Wet Bleed', 0, 30, 0.5, 5, 'Print'),
    R('grain', 'Grain', 0, 1, 0.01, 0.4, 'Print'),
    R('texture', 'Paper Texture', 0, 1, 0.01, 0.35, 'Print'),
    SEED('Print'),
    C('deep', 'Shadow Pigment', '#0c1f6e'),
    C('mid', 'Mid Pigment', '#3a5fd0'),
    C('paper', 'Paper', '#e9ecf2'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const L = boxBlur(toLuma(src), w, h, (p.bleed as number) * unit, 2), out = ctx.createImageData(w, h), o = out.data, seed = p.seed as number;
    const d = hexToRgb(p.deep as string), m = hexToRgb(p.mid as string), pa = hexToRgb(p.paper as string), den = p.density as number, gr = p.grain as number, tx = p.texture as number, u = 1 / unit;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, wash = fbm(x * u * 0.012, y * u * 0.012, seed, 3) - 0.5;
        let t = Math.min(1, Math.max(0, (1 - L[i]) * den + wash * tx * 0.7));
        t += (hash2(x, y, seed) - 0.5) * gr * 0.3;
        t = Math.min(1, Math.max(0, t));
        const a = t < 0.55 ? pa : m, b = t < 0.55 ? m : d, f = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
        for (let c = 0; c < 3; c++) o[i * 4 + c] = lerp(a[c], b[c], f);
        o[i * 4 + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const newspaper: EffectDefinition = {
  id: 'newspaper',
  name: 'Newspaper Print',
  category: 'texture',
  description: 'Two ink plates break through coarse paper grain, with deep shadows and blown highlights.',
  params: [
    R('sep1', 'Plate 1 Coverage', 0, 1, 0.01, 0.42, 'Plates'),
    R('sep2', 'Plate 2 Coverage', 0, 1, 0.01, 0.62, 'Plates'),
    R('contrast', 'Ink Contrast', 0.3, 3, 0.01, 1.5, 'Plates'),
    R('scale', 'Grain Scale', 0.5, 6, 0.1, 1.6, 'Plates'),
    SEED('Plates'),
    C('ink1', 'Ink 1', '#0b0b0d'),
    C('ink2', 'Ink 2', '#1b2340'),
    C('paper', 'Paper', '#efeadd'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const L = toLuma(src), out = ctx.createImageData(w, h), o = out.data, ct = p.contrast as number, s1 = p.sep1 as number, s2 = p.sep2 as number, seed = p.seed as number, sc = Math.max(1, (p.scale as number) * unit);
    const a = hexToRgb(p.ink1 as string), b = hexToRgb(p.ink2 as string), pa = hexToRgb(p.paper as string);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, g = hash2((x / sc) | 0, (y / sc) | 0, seed), g2 = hash2((x / sc) | 0, (y / sc) | 0, seed + 9);
        const v = Math.min(1, Math.max(0, (L[i] - 0.5) * ct + 0.5));
        const ink2 = v < s2 * (0.4 + g2 * 1.2), ink1 = v < s1 * (0.4 + g * 1.2);
        const col = ink1 ? a : ink2 ? b : pa;
        o[i * 4] = col[0]; o[i * 4 + 1] = col[1]; o[i * 4 + 2] = col[2]; o[i * 4 + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const stencil: EffectDefinition = {
  id: 'stencil',
  name: 'Spray Stencil',
  category: 'texture',
  description: 'Simplifies the image to bold shapes, then sprays them with overspray and speckle.',
  supportsTransparency: true,
  params: [
    R('blur', 'Blur Before Cut', 0, 30, 0.5, 6, 'Stencil'),
    R('threshold', 'Threshold', 0, 1, 0.01, 0.45, 'Stencil'),
    R('overspray', 'Overspray', 0, 40, 0.5, 10, 'Stencil'),
    R('speckle', 'Speckle', 0, 1, 0.01, 0.35, 'Stencil'),
    SEED('Stencil'),
    C('paint', 'Paint', '#1c1c1f'),
    C('paper', 'Paper', '#f2f0ea'),
    T('transparent', 'Transparent Background', false, 'Color'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const L = boxBlur(toLuma(src), w, h, (p.blur as number) * unit, 2), th = p.threshold as number, n = w * h, cut = new Float32Array(n), seed = p.seed as number;
    for (let i = 0; i < n; i++) cut[i] = L[i] < th ? 1 : 0;
    const mist = boxBlur(cut, w, h, Math.max(0.5, (p.overspray as number) * unit), 2), out = ctx.createImageData(w, h), o = out.data;
    const pt = hexToRgb(p.paint as string), pa = hexToRgb(p.paper as string), sp = p.speckle as number, tr = p.transparent as boolean, big = Math.max(1, 1.5 * unit);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x, g = hash2((x / big) | 0, (y / big) | 0, seed);
        let a = cut[i];
        if (!a) a = g < mist[i] * mist[i] * 1.6 ? 1 : 0;
        else if (g < sp * 0.08) a = 0;
        if (hash2((x / (big * 3)) | 0, (y / (big * 3)) | 0, seed + 3) < sp * 0.012) a = 1;
        for (let c = 0; c < 3; c++) o[i * 4 + c] = tr ? pt[c] : lerp(pa[c], pt[c], a);
        o[i * 4 + 3] = tr ? a * 255 : 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const tornPaper: EffectDefinition = {
  id: 'tornPaper',
  name: 'Torn Paper Collage',
  category: 'texture',
  description: 'Splits the image into torn sheets of coloured stock, each printed with its own ink screen.',
  params: [
    R('pieces', 'Collage Pieces', 2, 24, 1, 8, 'Collage'),
    R('rough', 'Tear Roughness', 0, 1, 0.01, 0.55, 'Collage'),
    R('fiber', 'Torn Fiber Width', 0, 14, 0.25, 4, 'Collage'),
    R('pitch', 'Screen Pitch', 2, 24, 0.5, 7, 'Print'),
    R('misreg', 'Misregistration', 0, 16, 0.5, 4, 'Print'),
    SEED('Collage'),
    C('inkA', 'Plate Ink A', '#14131a'),
    C('inkB', 'Plate Ink B', '#d9352c'),
    C('inkC', 'Plate Ink C', '#2141b8'),
    C('paper', 'Paper', '#e8dcc2'),
    C('fiberCol', 'Torn Fiber White', '#f7f4ec'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const seed = p.seed as number, rng = createRng(seed), n = p.pieces as number, pts: number[][] = [];
    for (let i = 0; i < n; i++) pts.push([rng() * w, rng() * h]);
    const L = toLuma(src), out = ctx.createImageData(w, h), o = out.data, rough = (p.rough as number) * 70 * unit, fw = (p.fiber as number) * unit, u = 1 / unit;
    const inks = [hexToRgb(p.inkA as string), hexToRgb(p.inkB as string), hexToRgb(p.inkC as string)], paper = hexToRgb(p.paper as string), fib = hexToRgb(p.fiberCol as string);
    const pitch = Math.max(1.5, (p.pitch as number) * unit), mis = (p.misreg as number) * unit;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Warped distance gives each border an irregular torn line.
        const wx = x + (fbm(x * u * 0.02, y * u * 0.02, seed, 4) - 0.5) * rough, wy = y + (fbm(x * u * 0.02 + 9, y * u * 0.02, seed + 2, 4) - 0.5) * rough;
        let d1 = 1e12, d2 = 1e12, id = 0;
        for (let k = 0; k < n; k++) {
          const d = (wx - pts[k][0]) ** 2 + (wy - pts[k][1]) ** 2;
          if (d < d1) { d2 = d1; d1 = d; id = k; } else if (d < d2) d2 = d;
        }
        const edge = Math.sqrt(d2) - Math.sqrt(d1), i = y * w + x, k = i * 4;
        if (edge < fw) {
          for (let c = 0; c < 3; c++) o[k + c] = fib[c] - (hash2(x, y, seed) * 26);
          o[k + 3] = 255;
          continue;
        }
        const ink = inks[id % 3], ang = 0.26 + id * 0.9, sa = Math.sin(ang), ca = Math.cos(ang);
        const sx = x + (id % 2 ? mis : -mis), sy = y + (id % 3 ? mis * 0.6 : -mis * 0.6);
        const u2 = (sx * ca + sy * sa) / pitch, v2 = (-sx * sa + sy * ca) / pitch;
        const dot = Math.hypot(u2 - Math.round(u2), v2 - Math.round(v2)) / 0.72;
        const lum = L[Math.min(h - 1, Math.max(0, sy | 0)) * w + Math.min(w - 1, Math.max(0, sx | 0))];
        const on = dot < Math.sqrt(1 - lum);
        const paperTint = 0.92 + (id % 4) * 0.03;
        for (let c = 0; c < 3; c++) o[k + c] = on ? ink[c] : clamp255(paper[c] * paperTint);
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const pointillism: EffectDefinition = withContent({
  id: 'pointillism',
  name: 'Pointillism',
  category: 'texture',
  description: 'Repaints the image in thick separate dots, large first and fine on top.',
  params: [
    R('count', 'Dots', 500, 40000, 100, 9000, 'Paint'),
    R('size', 'Dot Size', 1, 30, 0.25, 7, 'Paint'),
    R('vary', 'Size Variation', 0, 1, 0.01, 0.5, 'Paint'),
    R('jitter', 'Color Jitter', 0, 80, 1, 24, 'Paint', 'Breaks flat colour into neighbouring hues.'),
    R('sat', 'Saturation Boost', 0, 2, 0.01, 0.4, 'Paint'),
    SEED('Paint'),
    C('canvas', 'Canvas', '#f1ece0'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    ctx.fillStyle = p.canvas as string;
    ctx.fillRect(0, 0, w, h);
    const rng = createRng(p.seed as number), n = p.count as number, base = (p.size as number) * unit, vary = p.vary as number, j = p.jitter as number, sat = p.sat as number, d = src.data, stamps = contentOf(p, unit);
    stamps?.begin(ctx);
    for (let k = 0; k < n; k++) {
      const x = rng() * w, y = rng() * h, i = ((y | 0) * w + (x | 0)) * 4;
      const late = k / n, r0 = d[i], g0 = d[i + 1], b0 = d[i + 2], m = (r0 + g0 + b0) / 3;
      const c = [r0, g0, b0].map((v) => clamp255(m + (v - m) * (1 + sat) + (rng() - 0.5) * j));
      const size = base * (1.4 - late * 0.8) * (1 - vary * 0.6 * rng());
      if (stamps) { stamps.stamp(ctx, k, x, y, size * 2, c); continue; }
      ctx.fillStyle = rgbCss(c);
      ctx.beginPath(); ctx.arc(x, y, size, 0, 7); ctx.fill();
    }
    stamps?.end(ctx);
  },
});

export const textPortrait: EffectDefinition = {
  id: 'textPortrait',
  name: 'Text Portrait',
  category: 'type',
  description: 'Sets your own text in tight rows. Letter weight and size carry the image.',
  params: [
    { key: 'text', label: 'Text', type: 'text', default: 'AIRFX VISUAL EFFECTS ', maxLength: 500, group: 'Type' },
    { key: 'font', label: 'Font', type: 'custom', editor: 'font', default: '"Helvetica Neue", Arial, sans-serif', group: 'Type' },
    R('size', 'Row Height', 4, 40, 0.5, 11, 'Type'),
    R('min', 'Thinnest Letter', 0, 1, 0.01, 0.2, 'Type'),
    T('weight', 'Heavier In Shadows', true, 'Type'),
    T('invert', 'Light Text On Dark', true, 'Type'),
    S('color', 'Color', 'image', [['image', 'From Image'], ['ink', 'Ink']], 'Color'),
    { ...C('ink', 'Ink', '#f0eee6'), visibleWhen: (v) => v.color === 'ink' },
    C('bg', 'Background', '#0a0a0b'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    ctx.fillStyle = p.bg as string;
    ctx.fillRect(0, 0, w, h);
    const row = Math.max(3, (p.size as number) * unit), text = (p.text as string) || 'AIRFX ', L = boxBlur(toLuma(src), w, h, row / 3, 1), inv = p.invert as boolean, min = p.min as number, img = p.color === 'image', d = src.data;
    ctx.textBaseline = 'alphabetic';
    let idx = 0;
    for (let y = row; y < h + row; y += row) {
      let x = 0;
      while (x < w) {
        const i = Math.min(h - 1, (y - row / 2) | 0) * w + Math.min(w - 1, x | 0), v = L[i], t = inv ? v : 1 - v, ch = text[idx++ % text.length];
        const s = row * (min + (1 - min) * t) * 1.25;
        ctx.font = `${p.weight && t > 0.55 ? 800 : 500} ${s.toFixed(1)}px ${p.font}`;
        ctx.fillStyle = img ? `rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})` : (p.ink as string);
        ctx.fillText(ch, x, y);
        x += Math.max(row * 0.2, ctx.measureText(ch).width);
      }
    }
  },
};

/** Normals from a blurred height field of the image. */
function heightNormals(src: ImageData, soft: number) {
  const { width: w, height: h } = src, H = boxBlur(toLuma(src), w, h, soft, 2);
  return { H, nx: (i: number, k: number) => (H[Math.min(w * h - 1, i + 1)] - H[Math.max(0, i - 1)]) * k, ny: (i: number, k: number) => (H[Math.min(w * h - 1, i + w)] - H[Math.max(0, i - w)]) * k };
}

export const chrome: EffectDefinition = {
  id: 'chrome',
  name: 'Liquid Chrome',
  category: 'texture',
  description: 'Treats brightness as height and reflects a studio environment off the surface.',
  animated: (p) => (p.flow as number) > 0,
  params: [
    R('soft', 'Smoothness', 0.5, 30, 0.25, 6, 'Surface'),
    R('relief', 'Relief', 1, 40, 0.5, 14, 'Surface'),
    R('bands', 'Reflection Bands', 1, 8, 0.1, 3, 'Surface'),
    R('contrast', 'Contrast', 0.5, 3, 0.01, 1.5, 'Surface'),
    R('flow', 'Flow', 0, 2, 0.01, 0, 'Surface', 'Slides the reflection over time.'),
    S('metal', 'Metal', 'chrome', [['chrome', 'Chrome'], ['gold', 'Gold'], ['copper', 'Copper'], ['tint', 'Use Tint']], 'Color'),
    { ...C('tint', 'Metal Tint', '#e6ebf2'), visibleWhen: (v) => v.metal === 'tint' },
    C('dark', 'Shadow Tint', '#0a0c12'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const n = w * h, { nx, ny } = heightNormals(src, (p.soft as number) * unit), relief = (p.relief as number) * 4 * (unit / 1.08), out = ctx.createImageData(w, h), o = out.data, bands = p.bands as number, ct = p.contrast as number, fl = time * (p.flow as number);
    const dark = hexToRgb(p.dark as string), m = p.metal as string, tint = m === 'gold' ? [255, 208, 110] : m === 'copper' ? [244, 150, 104] : m === 'tint' ? hexToRgb(p.tint as string) : hexToRgb('#e6ebf2');
    for (let i = 0; i < n; i++) {
      const a = nx(i, relief), b = ny(i, relief), nz = 1 / Math.hypot(a, b, 1);
      // Reflection vector indexed into a horizon-style environment.
      const v = (b * nz + 1) * 0.5 + (a * nz) * 0.25 + fl;
      let e = 0.5 + 0.5 * Math.cos(v * bands * Math.PI * 2);
      e = Math.min(1, Math.max(0, (e - 0.5) * ct + 0.5));
      const hi = Math.pow(e, 6) * 0.5;
      for (let c = 0; c < 3; c++) o[i * 4 + c] = clamp255(lerp(dark[c], tint[c], e) + hi * 255);
      o[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const reededGlass: EffectDefinition = {
  id: 'reededGlass',
  name: 'Reeded Glass',
  category: 'light',
  description: 'Looks through ribbed glass: each reed bends the image and splits light at its edges.',
  params: [
    R('size', 'Reed Size', 4, 120, 1, 34, 'Glass'),
    S('pattern', 'Reed Pattern', 'lines', [['lines', 'Lines'], ['grid', 'Grid'], ['rings', 'Concentric'], ['chevron', 'Chevron']], 'Glass'),
    R('angle', 'Angle', -90, 90, 1, 0, 'Glass'),
    R('bend', 'Refraction', 0, 2, 0.01, 0.8, 'Glass'),
    R('disperse', 'Light Dispersion', 0, 1, 0.01, 0.35, 'Glass'),
    R('blur', 'Frosting', 0, 10, 0.25, 1, 'Glass'),
    R('shade', 'Rib Shading', 0, 1, 0.01, 0.25, 'Glass'),
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit }) {
    let base = src.data;
    const fr = (p.blur as number) * unit;
    if (fr > 0.3) {
      const c = createCanvas(w, h), g = get2d(c, true);
      g.filter = `blur(${fr}px)`;
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      base = g.getImageData(0, 0, w, h).data;
      c.width = c.height = 1;
    }
    const out = ctx.createImageData(w, h), o = out.data, s = Math.max(2, (p.size as number) * unit), a = ((p.angle as number) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const bend = (p.bend as number) * s, dis = (p.disperse as number) * 0.5, shade = p.shade as number, pat = p.pattern as string, cx = w / 2, cy = h / 2, tmp = new Uint8ClampedArray(4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = (x - cx) * ca + (y - cy) * sa, py = -(x - cx) * sa + (y - cy) * ca;
        let u = px / s, u2 = 0;
        if (pat === 'rings') u = Math.hypot(px, py) / s;
        else if (pat === 'chevron') u = (px + Math.abs(((py / s) % 2 + 2) % 2 - 1) * s) / s;
        else if (pat === 'grid') u2 = py / s;
        const f = u - Math.floor(u) - 0.5, f2 = pat === 'grid' ? u2 - Math.floor(u2) - 0.5 : 0;
        const dx = f * bend, dy = f2 * bend, k = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          const sc = 1 + (c - 1) * dis;
          sampleBilinear(base, w, h, x - dx * sc * ca + dy * sc * sa, y - dx * sc * sa - dy * sc * ca, tmp, 0);
          o[k + c] = tmp[c];
        }
        const sh = 1 - shade * (Math.abs(f) * 2) ** 3;
        o[k] *= sh; o[k + 1] *= sh; o[k + 2] *= sh; o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const water: EffectDefinition = {
  id: 'water',
  name: 'Water Surface',
  category: 'light',
  description: 'Refracts the image through moving ripples, with caustic light on top.',
  animated: (p) => (p.speed as number) > 0,
  params: [
    R('scale', 'Ripple Scale', 10, 200, 1, 60, 'Water'),
    R('depth', 'Refraction', 0, 80, 0.5, 18, 'Water'),
    R('caustic', 'Caustics', 0, 1, 0.01, 0.4, 'Water'),
    R('speed', 'Speed', 0, 2, 0.01, 0.5, 'Water'),
    C('tint', 'Water Tint', '#7fd4e6'),
    R('tintAmount', 'Tint', 0, 1, 0.01, 0.15, 'Water'),
    SEED('Water'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const sc = 1 / ((p.scale as number) * unit), dp = (p.depth as number) * unit, t = time * (p.speed as number), seed = p.seed as number, out = ctx.createImageData(w, h), o = out.data;
    const caustic = p.caustic as number, tint = hexToRgb(p.tint as string), ta = p.tintAmount as number, step = 2, gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, H = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const X = x * step * sc, Y = y * step * sc;
      H[y * gw + x] = valueNoise(X + t, Y - t * 0.6, seed) + 0.5 * valueNoise(X * 2.1 - t * 1.3, Y * 2.1 + t, seed + 1) + 0.25 * Math.sin((X + Y) * 6 + t * 3);
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const gx = (x / step) | 0, gy = (y / step) | 0, i = gy * gw + gx, ax = H[i + 1] - H[i], ay = H[i + gw] - H[i], k = (y * w + x) * 4;
        sampleBilinear(src.data, w, h, x + ax * dp * 4, y + ay * dp * 4, o, k);
        const c = Math.pow(Math.max(0, 1 - Math.hypot(ax, ay) * 9), 8) * caustic * 90;
        for (let q = 0; q < 3; q++) o[k + q] = clamp255(lerp(o[k + q], (o[k + q] * tint[q]) / 255, ta) + c);
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

/** Distance to the nearest and second-nearest jittered cell point. */
const cell = { edge: 0, id: 0 };
function voronoi(x: number, y: number, seed: number) {
  const cx = Math.floor(x), cy = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j, px = gx + hash2(gx, gy, seed), py = gy + hash2(gx, gy, seed + 5), d = Math.hypot(x - px, y - py);
      if (d < d1) { d2 = d1; d1 = d; id = hash2(gx, gy, seed + 2); } else if (d < d2) d2 = d;
    }
  // One shared result: this runs per pixel, and an object each time is most of the cost.
  cell.edge = d2 - d1;
  cell.id = id;
  return cell;
}

export const ice: EffectDefinition = {
  id: 'ice',
  name: 'Frozen Ice',
  category: 'texture',
  description: 'Freezes the image under cracked ice: each shard refracts differently, with frost on top.',
  params: [
    R('cell', 'Shard Size', 15, 300, 1, 90, 'Ice'),
    R('refract', 'Refraction', 0, 60, 0.5, 14, 'Ice'),
    R('crack', 'Crack Brightness', 0, 1, 0.01, 0.6, 'Ice'),
    R('frost', 'Frost', 0, 1, 0.01, 0.4, 'Ice'),
    SEED('Ice'),
    C('tint', 'Ice Tint', '#bfe3ff'),
    R('tintAmount', 'Tint', 0, 1, 0.01, 0.35, 'Ice'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const sz = (p.cell as number) * unit, seed = p.seed as number, rf = (p.refract as number) * unit, cr = p.crack as number, fr = p.frost as number, tint = hexToRgb(p.tint as string), ta = p.tintAmount as number, out = ctx.createImageData(w, h), o = out.data, u = 1 / unit;
    const warpAt = coarseField(w, h, Math.max(2, 5 * unit), (x, y) => fbm(x * u * 0.02, y * u * 0.02, seed, 3));
    const frostAt = coarseField(w, h, Math.max(1, 1.5 * unit), (x, y) => fbm(x * u * 0.09, y * u * 0.09, seed + 3, 4));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const warp = (warpAt(x, y) - 0.5) * 0.6, v = voronoi(x / sz + warp, y / sz + warp, seed), a = v.id * 6.28, k = (y * w + x) * 4;
        sampleBilinear(src.data, w, h, x + Math.cos(a) * rf, y + Math.sin(a) * rf, o, k);
        const line = 1 - smooth(0, 0.05, v.edge), f = frostAt(x, y);
        const bright = line * cr * 200 + Math.max(0, f - 0.5) * fr * 260;
        for (let q = 0; q < 3; q++) o[k + q] = clamp255(lerp(o[k + q], (o[k + q] * 0.6 + tint[q] * 0.4), ta) + bright);
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const holographic: EffectDefinition = {
  id: 'holographic',
  name: 'Holographic',
  category: 'analog',
  description: 'Splits edges into rainbow fringes over fine scanlines, with soft wave tears.',
  animated: (p) => (p.speed as number) > 0,
  params: [
    R('spread', 'Chroma Spread', 0, 40, 0.5, 12, 'Signal'),
    R('scan', 'Scanlines', 0, 1, 0.01, 0.5, 'Signal'),
    R('waveAmt', 'Wave Amount', 0, 40, 0.5, 6, 'Signal'),
    R('waveFreq', 'Wave Frequency', 0.5, 30, 0.1, 6, 'Signal'),
    R('speed', 'Speed', 0, 3, 0.01, 0.4, 'Signal'),
    R('sat', 'Saturation', 0, 2, 0.01, 1.2, 'Color'),
    R('contrast', 'Contrast', 0.5, 2.5, 0.01, 1.2, 'Color'),
    C('tint', 'Base Tint', '#40ffc8'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const L = toLuma(src), out = ctx.createImageData(w, h), o = out.data, sp = (p.spread as number) * unit, sc = p.scan as number, am = (p.waveAmt as number) * unit, fq = p.waveFreq as number, t = time * (p.speed as number) * 4, sat = p.sat as number, ct = p.contrast as number, tint = hexToRgb(p.tint as string);
    const line = Math.max(2, Math.round(3 * unit)), tmp = new Uint8ClampedArray(4);
    for (let y = 0; y < h; y++) {
      const off = Math.sin((y / h) * fq * Math.PI * 2 + t) * am;
      for (let x = 0; x < w; x++) {
        const i = y * w + x, k = i * 4, sx = Math.min(w - 1, Math.max(0, Math.round(x + off))), si = y * w + sx;
        const g = Math.min(1, (Math.abs(L[Math.min(w * h - 1, si + 1)] - L[Math.max(0, si - 1)]) + Math.abs(L[Math.min(w * h - 1, si + w)] - L[Math.max(0, si - w)])) * 6 * (unit / 1.08));
        for (let c = 0; c < 3; c++) {
          // Shifted along the row only, so this reads one channel from two neighbours.
          const fxp = Math.min(w - 1, Math.max(0, x + off + (c - 1) * sp * (0.25 + g))), x0 = fxp | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, row = y * w;
          tmp[c] = src.data[(row + x0) * 4 + c] + (src.data[(row + x1) * 4 + c] - src.data[(row + x0) * 4 + c]) * (fxp - x0);
          const hue = 0.5 + 0.5 * Math.sin(L[si] * 10 + c * 2.09 + (x + y) * 0.01 / unit);
          const lum = (L[si] - 0.5) * ct + 0.5;
          const v = lerp(lum * tint[c], tmp[c], 0.5) + g * hue * 255 * sat;
          o[k + c] = clamp255(v);
        }
        const dark = y % (line * 2) < line ? 1 - sc * 0.7 : 1;
        o[k] *= dark; o[k + 1] *= dark; o[k + 2] *= dark; o[k + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  },
};

export const crackedPrint: EffectDefinition = {
  id: 'crackedPrint',
  name: 'Cracked Print',
  category: 'texture',
  description: 'Ages the image like old ink on a surface: dried cracks and worn patches show the base.',
  params: [
    R('cell', 'Crack Size', 8, 200, 1, 44, 'Wear'),
    R('width', 'Crack Width', 0, 0.3, 0.005, 0.06, 'Wear'),
    R('wear', 'Worn Patches', 0, 1, 0.01, 0.35, 'Wear'),
    R('fade', 'Ink Fade', 0, 1, 0.01, 0.15, 'Wear'),
    SEED('Wear'),
    C('base', 'Base Surface', '#e9e2d0'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const sz = (p.cell as number) * unit, cw = p.width as number, wear = p.wear as number, fade = p.fade as number, seed = p.seed as number, base = hexToRgb(p.base as string), out = ctx.createImageData(w, h), o = out.data, u = 1 / unit;
    const warpAt = coarseField(w, h, Math.max(2, 4 * unit), (x, y) => fbm(x * u * 0.03, y * u * 0.03, seed, 3));
    const fineAt = coarseField(w, h, Math.max(1, 1.2 * unit), (x, y) => fbm(x * u * 0.12, y * u * 0.12, seed + 4, 3));
    const patchAt = coarseField(w, h, Math.max(2, 12 * unit), (x, y) => fbm(x * u * 0.008, y * u * 0.008, seed + 7, 3));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const warp = warpAt(x, y) - 0.5, v = voronoi(x / sz + warp, y / sz + warp, seed);
        const fine = fineAt(x, y), patch = patchAt(x, y);
        const crack = v.edge < cw * (0.5 + fine), worn = patch + (fine - 0.5) * 0.4 < wear * 0.6;
        const k = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) o[k + c] = crack || worn ? base[c] : lerp(src.data[k + c], base[c], fade * (0.5 + v.id * 0.5));
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

export const grunge: EffectDefinition = {
  id: 'grunge',
  name: 'Grunge',
  category: 'texture',
  description: 'Crushes shadows to black, lifts contrast and scatters grainy pigment through the mids.',
  params: [
    R('gamma', 'Shadow Crush', 0.3, 3, 0.01, 1.7, 'Grunge'),
    R('contrast', 'Contrast', 0.5, 3, 0.01, 1.5, 'Grunge'),
    R('grain', 'Granulation Scale', 0.5, 12, 0.1, 2.5, 'Grunge'),
    R('amount', 'Pigment Speckle', 0, 1, 0.01, 0.55, 'Grunge'),
    R('spill', 'Spill Reach', 0, 1, 0.01, 0.3, 'Grunge'),
    SEED('Grunge'),
  ],
  render({ src, ctx, width: w, height: h, params: p, unit }) {
    const out = ctx.createImageData(w, h), o = out.data, g = p.gamma as number, ct = p.contrast as number, sc = Math.max(1, (p.grain as number) * unit), am = p.amount as number, sp = p.spill as number, seed = p.seed as number, u = 1 / unit;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4, speck = hash2((x / sc) | 0, (y / sc) | 0, seed), blot = fbm(x * u * 0.01, y * u * 0.01, seed + 2, 3);
        for (let c = 0; c < 3; c++) {
          let v = Math.pow(src.data[k + c] / 255, g);
          v = (v - 0.5) * ct + 0.5;
          const mid = 1 - Math.abs(v - 0.5) * 2;
          v += (speck - 0.5) * am * Math.max(0, mid);
          if (blot < sp * 0.7) v *= 0.35;
          o[k + c] = clamp255(v * 255);
        }
        o[k + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
  },
};

/* Time-based looks keep earlier frames, so they develop during playback. */

let trail: { c: HTMLCanvasElement; w: number; h: number; frame: number } | null = null;

export const motionTrails: EffectDefinition = {
  id: 'motionTrails',
  name: 'Motion Trails',
  category: 'animate',
  compat: 'video',
  description: 'Leaves fading ghosts of whatever moves. Press play: it builds up over time.',
  params: [
    R('decay', 'Trail Length', 0.5, 0.99, 0.005, 0.9, 'Trails'),
    S('mode', 'Trail Mode', 'lighter', [['lighter', 'Brightest Wins'], ['darker', 'Darkest Wins'], ['echo', 'Soft Echo'], ['diff', 'Moving Parts Only']], 'Trails'),
    R('tintAmount', 'Frame Tint', 0, 1, 0.01, 0, 'Trails'),
    { ...C('tint', 'Tint Color', '#7fd4ff'), visibleWhen: (v) => (v.tintAmount as number) > 0 },
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p, frame }) {
    if (!trail || trail.w !== w || trail.h !== h || frame < trail.frame) {
      const c = createCanvas(w, h);
      get2d(c).drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      trail = { c, w, h, frame };
    }
    trail.frame = frame;
    const g = get2d(trail.c), m = p.mode as string;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1 - (p.decay as number);
    g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    if (m === 'lighter' || m === 'darker') {
      g.globalAlpha = 1;
      g.globalCompositeOperation = m === 'lighter' ? 'lighten' : 'darken';
      g.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    ctx.drawImage(trail.c, 0, 0);
    if (m === 'diff') {
      ctx.globalCompositeOperation = 'difference';
      ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    const ta = p.tintAmount as number;
    if (ta > 0) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = ta;
      ctx.fillStyle = p.tint as string;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  },
};

const scanBuf: { frames: HTMLCanvasElement[]; w: number; h: number } = { frames: [], w: 0, h: 0 };

export const lineScan: EffectDefinition = {
  id: 'lineScan',
  name: 'Line Scan',
  category: 'animate',
  compat: 'video',
  description: 'Each band of the picture shows a different moment, so movement smears into ribbons.',
  params: [
    R('depth', 'Time Depth', 2, 60, 1, 24, 'Scan', 'How many past frames the scan reaches back.'),
    R('bands', 'Bands', 4, 120, 1, 48, 'Scan'),
    S('dir', 'Direction', 'down', [['down', 'Top To Bottom'], ['up', 'Bottom To Top'], ['side', 'Left To Right']], 'Scan'),
  ],
  render({ srcCanvas, ctx, width: w, height: h, params: p }) {
    if (scanBuf.w !== w || scanBuf.h !== h) { scanBuf.frames = []; scanBuf.w = w; scanBuf.h = h; }
    const depth = p.depth as number, c = scanBuf.frames.length >= depth ? scanBuf.frames.shift()! : createCanvas(w, h);
    get2d(c).drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
    scanBuf.frames.push(c);
    while (scanBuf.frames.length > depth) scanBuf.frames.shift();
    const n = p.bands as number, dir = p.dir as string, f = scanBuf.frames;
    for (let b = 0; b < n; b++) {
      const t = dir === 'up' ? 1 - (b + 0.5) / n : (b + 0.5) / n, fr = f[Math.max(0, f.length - 1 - Math.round(t * (f.length - 1)))];
      if (dir === 'side') { const x = (b / n) * w, bw = Math.ceil(w / n) + 1; ctx.drawImage(fr, x, 0, bw, h, x, 0, bw, h); } else { const y = (b / n) * h, bh = Math.ceil(h / n) + 1; ctx.drawImage(fr, 0, y, w, bh, 0, y, w, bh); }
    }
  },
};

export const PRINT_SURFACE: EffectDefinition[] = [cyanotype, newspaper, stencil, tornPaper, pointillism, textPortrait, chrome, reededGlass, water, ice, holographic, crackedPrint, grunge, motionTrails, lineScan];
