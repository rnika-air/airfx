import type { EffectDefinition, ParamValues } from '../types';
import { hash2, hexToRgb, valueNoise } from '../../utils/imageProcessing';
import { BANDS, sig, soundNow } from './sound';
import { C, R, S, T } from '../generative';

/**
 * Image Reactor: any picture becomes an audio-reactive visual.
 *
 * The picture is resampled through a chain of coordinate transforms (lens,
 * symmetry, twist, a "scene" warp, tiling), mixed with a feedback buffer
 * (the previous frame, zoomed and turned), recoloured through a palette, and
 * every stage can follow a part of the sound: by default bass drives the
 * distortion, mids the shapes, highs the fine detail, and the beat zooms,
 * flashes or shifts colour. With no sound playing it moves on its own, so a
 * preview never sits still.
 */

const PALETTES: Record<string, string[]> = {
  gold: ['#000000', '#2b1400', '#8a5200', '#e0a21a', '#ffe27a', '#fff8e0'],
  ice: ['#02040a', '#0b2a5c', '#2f7fd1', '#9fe3ff', '#ffffff'],
  acid: ['#050505', '#123000', '#4fcc00', '#c6ff2e', '#f6ffd0'],
  infrared: ['#120015', '#5a0057', '#ff2a6d', '#ffb36b', '#fff1d6'],
  ember: ['#000000', '#3a0500', '#b3240a', '#ff7a1a', '#ffd38a'],
  mono: ['#000000', '#ffffff'],
};

function paletteLut(p: ParamValues) {
  const stops = (p.palette === 'duo' ? [p.c1, p.c2] : PALETTES[p.palette as string] ?? PALETTES.mono).map((h) => hexToRgb(h as string)), lut = new Uint8ClampedArray(256 * 3), n = stops.length - 1;
  for (let v = 0; v < 256; v++) {
    const t = (v / 255) * n, k = Math.min(n - 1, Math.floor(t)), f = t - k;
    for (let c = 0; c < 3; c++) lut[v * 3 + c] = stops[k][c] + (stops[k + 1][c] - stops[k][c]) * f;
  }
  return lut;
}

/** Previous output, for feedback. Kept between frames like any video effect. */
let mem: { w: number; h: number; t: number; prev: Uint8ClampedArray | null; last: Uint8ClampedArray | null; bufs: Uint8ClampedArray[] } | null = null;

export const imageReactor: EffectDefinition = {
  id: 'imageReactor', name: 'Image Reactor', category: 'animate',
  description: 'Turns any picture into an audio-reactive visual: bass bends it, mids reshape it, highs add detail, the beat zooms or flashes. Load a song or use the microphone in the Audio tab.',
  animated: () => true,
  params: [
    S('scene', 'Scene', 'tunnel', [['tunnel', 'Infinite Tunnel'], ['kaleido', 'Kaleidoscope'], ['echo', 'Contour Echo'], ['smear', 'Flow Smear'], ['melt', 'Melt'], ['shatter', 'Shatter'], ['breathe', 'Breathe'], ['prism', 'Prism']], 'Scene'),
    R('amount', 'Scene Strength', 0, 1, 0.01, 0.6, 'Scene'),
    R('complexity', 'Complexity', 1, 8, 0.1, 3, 'Scene', 'More repeats, segments, cells or ripples.'),
    R('speed', 'Motion Speed', 0, 3, 0.01, 0.6, 'Scene'),
    T('idle', 'Move Without Sound', true, 'Scene'),

    S('symmetry', 'Symmetry', '1', [['1', 'None'], ['2', 'Mirror'], ['3', '3-Fold'], ['4', '4-Fold'], ['6', '6-Fold'], ['8', '8-Fold'], ['12', '12-Fold']], 'Shape'),
    R('twist', 'Twist', -3, 3, 0.01, 0, 'Shape'),
    R('tiles', 'Tiles', 1, 6, 1, 1, 'Shape'),
    S('lens', 'Lens', 'none', [['none', 'None'], ['ribs', 'Glass Ribs'], ['fisheye', 'Fisheye'], ['pinch', 'Pinch']], 'Shape'),
    { ...R('lensAmt', 'Lens Strength', 0, 1, 0.01, 0.5, 'Shape'), visibleWhen: (v) => v.lens !== 'none' },
    { ...R('ribs', 'Rib Count', 3, 60, 1, 16, 'Shape'), visibleWhen: (v) => v.lens === 'ribs' },

    R('feedback', 'Trails', 0, 0.97, 0.01, 0.45, 'Feedback', 'How much of the last frame stays: long trails, echoes and smears.'),
    R('fbZoom', 'Trail Zoom', -0.1, 0.1, 0.001, 0.015, 'Feedback'),
    R('fbTurn', 'Trail Turn', -10, 10, 0.1, 0, 'Feedback'),

    S('palette', 'Palette', 'original', [['original', 'Original Colors'], ['gold', 'Gold'], ['ice', 'Ice'], ['acid', 'Acid'], ['infrared', 'Infrared'], ['ember', 'Ember'], ['mono', 'Mono'], ['duo', 'Two Colors']], 'Color'),
    { ...C('c1', 'Dark Color', '#0d0221', 'Color'), visibleWhen: (v) => v.palette === 'duo' },
    { ...C('c2', 'Light Color', '#ff5ad1', 'Color'), visibleWhen: (v) => v.palette === 'duo' },
    { ...R('paletteMix', 'Palette Amount', 0, 1, 0.01, 1, 'Color'), visibleWhen: (v) => v.palette !== 'original' },
    R('hueDrift', 'Hue Drift', -180, 180, 1, 0, 'Color', 'Degrees per second.'),
    R('contrast', 'Contrast', 0.5, 2, 0.01, 1.1, 'Color'),
    R('vignette', 'Vignette', 0, 1, 0.01, 0.25, 'Color'),
    R('mix', 'Dry / Wet', 0, 1, 0.01, 1, 'Color'),

    S('distortFrom', 'Distortion Follows', 'bass', BANDS, 'Audio'),
    R('distortReact', 'Distortion Reaction', 0, 2, 0.01, 1, 'Audio'),
    S('shapeFrom', 'Shape Follows', 'mid', BANDS, 'Audio'),
    R('shapeReact', 'Shape Reaction', 0, 2, 0.01, 0.8, 'Audio'),
    S('detailFrom', 'Detail Follows', 'treble', BANDS, 'Audio'),
    R('detailReact', 'Detail Reaction', 0, 2, 0.01, 0.6, 'Audio'),
    S('beatFrom', 'Pulse Follows', 'beat', BANDS, 'Audio'),
    S('beatDoes', 'Pulse Does', 'zoom', [['zoom', 'Zoom'], ['flash', 'Flash'], ['hue', 'Color Shift'], ['shake', 'Shake'], ['invert', 'Invert'], ['none', 'Nothing']], 'Audio'),
    R('beatReact', 'Pulse Reaction', 0, 2, 0.01, 1, 'Audio'),
  ],
  presets: [
    { name: 'Infinite Tunnel', values: { scene: 'tunnel', feedback: 0.35, palette: 'original' } },
    { name: 'Gold Echo', values: { scene: 'echo', palette: 'gold', feedback: 0.9, fbZoom: -0.02, amount: 0.75, beatDoes: 'flash' } },
    { name: 'Kaleido Bloom', values: { scene: 'kaleido', symmetry: '6', twist: 0.6, feedback: 0.5, hueDrift: 20 } },
    { name: 'Liquid Smear', values: { scene: 'smear', feedback: 0.88, amount: 0.7, fbZoom: 0.01, palette: 'ice', paletteMix: 0.6 } },
    { name: 'Glass Ribs', values: { scene: 'breathe', lens: 'ribs', lensAmt: 0.7, ribs: 22, feedback: 0.2 } },
    { name: 'Meltdown', values: { scene: 'melt', amount: 0.8, feedback: 0.6, palette: 'ember', paletteMix: 0.7 } },
    { name: 'Shatter On The Beat', values: { scene: 'shatter', beatDoes: 'shake', complexity: 4, feedback: 0.2 } },
    { name: 'Prism Split', values: { scene: 'prism', detailReact: 1.4, feedback: 0.3 } },
  ],
  render({ src, ctx, width: w, height: h, params: p, time, unit }) {
    const b = soundNow(time, p.idle as boolean);
    const D = sig(b, p.distortFrom) * (p.distortReact as number), Sg = sig(b, p.shapeFrom) * (p.shapeReact as number);
    const Tq = sig(b, p.detailFrom) * (p.detailReact as number), B = sig(b, p.beatFrom) * (p.beatReact as number);
    const scene = p.scene as string, amt = p.amount as number, cx = (p.complexity as number), spd = p.speed as number, tt = time * spd;
    const beatDoes = p.beatDoes as string;

    // Feedback memory: the frame before this one, or nothing after a jump.
    if (!mem || mem.w !== w || mem.h !== h) mem = { w, h, t: -1, prev: null, last: null, bufs: [] };
    if (time !== mem.t) {
      const jump = mem.t < 0 || time < mem.t || time - mem.t > 0.5;
      mem.prev = jump ? null : mem.last;
      mem.t = time;
    }
    const prev = mem.prev, fb = prev ? (p.feedback as number) : 0;

    const d = src.data, out = ctx.createImageData(w, h), o = out.data;
    const ccx = w / 2, ccy = h / 2, Rn = Math.min(w, h) / 2, ax = w / 2 / Rn, ay = h / 2 / Rn;
    let N = Number(p.symmetry) || 1;
    if (scene === 'kaleido' && N < 2) N = Math.max(3, Math.round(cx * 2));
    const seg = (Math.PI * 2) / N, twist = (p.twist as number) * (1 + Sg * 0.6);
    const lens = p.lens as string, la = p.lensAmt as number, ribs = p.ribs as number, tiles = p.tiles as number;
    let zoom = 1;
    if (beatDoes === 'zoom') zoom = 1 / (1 + 0.22 * B);
    if (scene === 'breathe') zoom /= 1 + amt * 0.35 * D + 0.04 * Math.sin(tt * 2);
    const shake = beatDoes === 'shake' ? B * 0.06 : 0, shx = (hash2(Math.floor(time * 24), 1, 7) - 0.5) * shake, shy = (hash2(Math.floor(time * 24), 2, 7) - 0.5) * shake;
    const spin = scene === 'kaleido' ? tt * 0.25 + D * 0.4 * amt : 0;
    // Tunnel: nested copies, one inside the next, with a rectangular frame.
    const kRatio = 1.6 + cx * 0.35, L = Math.log(kRatio), phase = tt * 0.35 + D * 0.3 * amt;
    const cells = Math.round(2 + cx * 2), shatterK = amt * (0.12 + 0.25 * D) + B * 0.08;
    const meltK = amt * (0.12 + 0.35 * D), wob = Sg * 0.02;
    const jitter = Tq * 0.006, prismK = scene === 'prism' ? amt * (0.012 + 0.05 * Tq) : 0;
    const smearK = amt * (0.015 + 0.06 * D), freq = 0.8 + cx * 0.5, flowT = tt * 0.25;

    // Coordinates are worked out on a coarse grid and interpolated: the warps are smooth.
    // Shatter has hard cell edges, so it is worked out at every pixel.
    const G = scene === 'shatter' ? 1 : Math.max(1, Math.round(2 * unit)), gw = Math.ceil(w / G) + 2, gh = Math.ceil(h / G) + 2, U = new Float32Array(gw * gh), V = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        let u = ((gx * G - ccx) / Rn) * zoom + shx, v = ((gy * G - ccy) / Rn) * zoom + shy;
        // Each rib is a small cylinder lens: it shifts what is behind it by up to a rib's width.
        if (lens === 'ribs') { const q = (u + 10) * ribs * 0.5; u += (q - Math.floor(q) - 0.5) * (2 / ribs) * la * 2.2 * (1 + Sg * 0.5); }
        else if (lens === 'fisheye') { const r2 = u * u + v * v, f = 1 + la * 0.5 * r2; u *= f; v *= f; }
        else if (lens === 'pinch') { const r2 = u * u + v * v, f = 1 - la * 0.55 * Math.exp(-r2 * 2.5); u *= f; v *= f; }
        if (N > 1 || twist || spin) {
          const r = Math.hypot(u, v);
          let a = Math.atan2(v, u) + spin + twist * r;
          if (N > 1) { a = ((a % seg) + seg) % seg; if (a > seg / 2) a = seg - a; }
          u = Math.cos(a) * r; v = Math.sin(a) * r;
        }
        if (scene === 'tunnel') {
          const r = Math.max(Math.abs(u) / ax, Math.abs(v) / ay, 1e-4), rho = Math.log(r) - phase, rr = Math.exp(((rho % L) + L) % L - L);
          // Scene Strength blends from the plain picture into the full tunnel.
          const s = 1 + (rr / r - 1) * Math.min(1, amt * 1.6);
          u *= s; v *= s;
        } else if (scene === 'melt') {
          const n = valueNoise((u + 3) * freq * 2, flowT, 11) - 0.3;
          v -= Math.max(0, n) * meltK * (v / ay + 1.2);
          u += Math.sin(v * 9 + tt * 2) * wob;
        } else if (scene === 'shatter') {
          const ci = Math.floor((u + 4) * cells * 0.5), cj = Math.floor((v + 4) * cells * 0.5), sd = Math.floor(B > 0.5 ? time * 4 : 0);
          u += (hash2(ci, cj, 3 + sd) - 0.5) * shatterK; v += (hash2(cj, ci, 5 + sd) - 0.5) * shatterK;
        } else if (scene === 'breathe') {
          const r = Math.hypot(u, v), f = 1 + Math.sin(r * cx * 6 - tt * 4) * 0.025 * (0.3 + Sg) * amt;
          u *= f; v *= f;
        } else if (scene === 'smear') {
          const ang = valueNoise((u + 5) * freq, (v + 5) * freq + flowT, 4) * Math.PI * 4;
          u += Math.cos(ang) * smearK; v += Math.sin(ang) * smearK;
        }
        const i = gy * gw + gx;
        U[i] = u; V[i] = v;
      }

    // Mirror-repeat into the picture.
    const fold = (s: number, n: number) => { const q = ((s % (2 * n)) + 2 * n) % (2 * n); return q > n ? 2 * n - q : q; };
    // Bilinear sample of all three channels at once (the position is worked out once).
    const px3 = new Float32Array(3);
    const sample3 = (u: number, v: number) => {
      let sx = (u * Rn + ccx) / w, sy = (v * Rn + ccy) / h;
      if (tiles > 1) { sx *= tiles; sy *= tiles; }
      sx = fold(sx, 1) * (w - 1); sy = fold(sy, 1) * (h - 1);
      const x0 = sx | 0, y0 = sy | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0, fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const a = d[i00 + c], bb = d[i10 + c], e = d[i01 + c], f = d[i11 + c];
        px3[c] = (a + (bb - a) * fx) * (1 - fy) + (e + (f - e) * fx) * fy;
      }
      return px3;
    };
    const sample = (u: number, v: number, c: number) => sample3(u, v)[c];

    // Contour Echo starts from the picture's outlines.
    let edge: Float32Array | null = null;
    if (scene === 'echo') {
      edge = new Float32Array(w * h);
      const s = Math.max(1, Math.round(unit * 1.2));
      for (let y = s; y < h - s; y++)
        for (let x = s; x < w - s; x++) {
          const q = (y * w + x) * 4, lx = (d[q + 4 * s] - d[q - 4 * s]) + (d[q + 4 * s + 1] - d[q - 4 * s + 1]), ly = (d[q + 4 * s * w] - d[q - 4 * s * w]) + (d[q + 4 * s * w + 1] - d[q - 4 * s * w + 1]);
          edge[y * w + x] = Math.min(1, Math.max(0, Math.hypot(lx, ly) / 255 - 0.18) * (1.6 + D));
        }
    }

    const pal = p.palette === 'original' ? null : paletteLut(p), pm = p.paletteMix as number;
    const hue = ((p.hueDrift as number) * time + (beatDoes === 'hue' ? B * 140 : 0)) * (Math.PI / 180);
    const ch = Math.cos(hue), sh = Math.sin(hue), doHue = Math.abs(hue % (Math.PI * 2)) > 1e-3;
    const ct = p.contrast as number, vig = p.vignette as number, mix = p.mix as number;
    const flash = beatDoes === 'flash' ? Math.min(1, B * 0.55) : 0, inv = beatDoes === 'invert' ? Math.min(1, B) : 0;
    const fz = 1 - (p.fbZoom as number) * (1 + D * 0.8) - (scene === 'echo' ? 0.006 * (1 + D) : 0), ft = ((p.fbTurn as number) * Math.PI) / 180, fc = Math.cos(ft) * fz, fs = Math.sin(ft) * fz;
    const echo = scene === 'echo';

    for (let y = 0; y < h; y++) {
      const gy = y / G, y0 = gy | 0, ty = gy - y0;
      for (let x = 0; x < w; x++) {
        const gx = x / G, x0 = gx | 0, tx = gx - x0, i0 = y0 * gw + x0;
        let u = (U[i0] + (U[i0 + 1] - U[i0]) * tx) * (1 - ty) + (U[i0 + gw] + (U[i0 + gw + 1] - U[i0 + gw]) * tx) * ty;
        let v = (V[i0] + (V[i0 + 1] - V[i0]) * tx) * (1 - ty) + (V[i0 + gw] + (V[i0 + gw + 1] - V[i0 + gw]) * tx) * ty;
        if (jitter) { u += (hash2(x, y, (time * 30) | 0) - 0.5) * jitter; v += (hash2(y, x, (time * 30) | 0) - 0.5) * jitter; }
        const q = (y * w + x) * 4;
        let r: number, g: number, bl: number;
        if (prismK) { r = sample(u * (1 + prismK), v * (1 + prismK), 0); g = sample(u, v, 1); bl = sample(u * (1 - prismK), v * (1 - prismK), 2); }
        else { const s3 = sample3(u, v); r = s3[0]; g = s3[1]; bl = s3[2]; }
        if (echo) {
          // The picture dims and its outlines glow; the glow then expands frame after frame.
          const e = edge![Math.min(h - 1, Math.max(0, Math.round(v * Rn + ccy))) * w + Math.min(w - 1, Math.max(0, Math.round(u * Rn + ccx)))];
          const dim = 1 - amt * 0.75;
          r = r * dim + 255 * e; g = g * dim + 255 * e; bl = bl * dim + 255 * e;
        }
        if (pal) {
          const l = Math.min(255, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * bl))) | 0;
          r += (pal[l * 3] - r) * pm; g += (pal[l * 3 + 1] - g) * pm; bl += (pal[l * 3 + 2] - bl) * pm;
        }
        if (fb > 0) {
          // The previous frame, turned and zoomed about the centre.
          const px = ccx + (x - ccx) * fc - (y - ccy) * fs, py = ccy + (x - ccx) * fs + (y - ccy) * fc;
          const X = px < 0 ? 0 : px > w - 1 ? w - 1 : px | 0, Y = py < 0 ? 0 : py > h - 1 ? h - 1 : py | 0, j = (Y * w + X) * 4;
          if (echo) { r = Math.max(r, prev![j] * fb); g = Math.max(g, prev![j + 1] * fb); bl = Math.max(bl, prev![j + 2] * fb); }
          else { r += (prev![j] - r) * fb; g += (prev![j + 1] - g) * fb; bl += (prev![j + 2] - bl) * fb; }
        }
        if (doHue) {
          // Hue rotation in YIQ.
          const Y = 0.299 * r + 0.587 * g + 0.114 * bl, I = 0.596 * r - 0.274 * g - 0.322 * bl, Qv = 0.211 * r - 0.523 * g + 0.312 * bl;
          const I2 = I * ch - Qv * sh, Q2 = I * sh + Qv * ch;
          r = Y + 0.956 * I2 + 0.621 * Q2; g = Y - 0.272 * I2 - 0.647 * Q2; bl = Y - 1.106 * I2 + 1.703 * Q2;
        }
        r = (r - 128) * ct + 128; g = (g - 128) * ct + 128; bl = (bl - 128) * ct + 128;
        if (flash) { r += (255 - r) * flash; g += (255 - g) * flash; bl += (255 - bl) * flash; }
        if (inv) { r += (255 - 2 * r) * inv; g += (255 - 2 * g) * inv; bl += (255 - 2 * bl) * inv; }
        if (vig) { const dx = (x - ccx) / ccx, dy = (y - ccy) / ccy, f = 1 - vig * Math.max(0, dx * dx + dy * dy - 0.25) * 0.8; r *= f; g *= f; bl *= f; }
        if (mix < 1) { r = d[q] + (r - d[q]) * mix; g = d[q + 1] + (g - d[q + 1]) * mix; bl = d[q + 2] + (bl - d[q + 2]) * mix; }
        o[q] = r; o[q + 1] = g; o[q + 2] = bl; o[q + 3] = 255;
      }
    }
    // Two buffers take turns, so long exports do not allocate a frame each time.
    const keep = mem.bufs.find((x) => x !== prev && x.length === o.length) ?? new Uint8ClampedArray(o.length);
    keep.set(o);
    if (!mem.bufs.includes(keep)) mem.bufs = [...mem.bufs.filter((x) => x.length === o.length).slice(-1), keep];
    mem.last = keep;
    ctx.putImageData(out, 0, 0);
  },
};
