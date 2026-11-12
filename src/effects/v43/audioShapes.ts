import type { EffectDefinition, ParamValues } from '../types';
import { audioBus, SILENCE, type AudioFrame } from '../../engine/audio';
import { contentOf, withContent } from '../../content/content';
import { boxBlur, clamp255, createCanvas, get2d, hexToRgb } from '../../utils/imageProcessing';
import { C, R, S, T, rgbCss } from '../generative';

/**
 * Shapes, letters and the picture itself, moved by sound. Each property
 * (size, turn, travel, fill, bend) is wired to a band of the audio, and every
 * outline is deformed point by point by the spectrum and the waveform.
 * Works over the picture or the webcam, or on its own as a visualizer.
 */

const BANDS: [string, string][] = [['off', 'Nothing'], ['level', 'Loudness'], ['bass', 'Bass'], ['mid', 'Mids'], ['treble', 'Highs'], ['beat', 'Beat']];
const band = (f: AudioFrame, k: string) => (k === 'off' ? 0 : (f.bands as unknown as Record<string, number>)[k] ?? 0);

const memo = { t: -1, env: { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 } as Record<string, number>, spin: 0 };

function testFrame(t: number): AudioFrame {
  const beat = (t * 2) % 1, kick = Math.exp(-beat * 7), N = 1024, spectrum = new Float32Array(N), wave = new Float32Array(2048);
  for (let i = 1; i < N; i++) { const f = Math.log(i + 1) / Math.log(N); spectrum[i] = Math.min(1, Math.exp(-((f - 0.3) ** 2) * 50) * (0.4 + kick * 0.6) + Math.exp(-((f - 0.65) ** 2) * 40) * (0.4 + 0.3 * Math.sin(t * 6 + f * 40))); }
  for (let i = 0; i < 2048; i++) wave[i] = Math.sin(i * 0.03 + t * 20) * (0.3 + kick * 0.5);
  return { bands: { level: 0.4 + kick * 0.4, bass: kick, mid: 0.5 + 0.3 * Math.sin(t * 3), treble: 0.4 + 0.3 * Math.sin(t * 8), beat: beat < 0.15 ? 1 - beat * 6 : 0 }, spectrum, wave, binHz: 23.4375 };
}

/** Spectrum value for a fraction 0..1 along a log scale from 40 Hz to 12 kHz. */
const specAt = (f: AudioFrame, u: number) => { const hz = 40 * Math.pow(300, u), i = Math.min(f.spectrum.length - 1, Math.max(1, Math.round(hz / f.binHz))); return f.spectrum[i]; };

function outline(kind: string, n: number, u: number) {
  // Radius of the base shape at angle fraction u (0..1).
  const a = u * Math.PI * 2;
  if (kind === 'circle' || kind === 'ring') return 1;
  if (kind === 'polygon') { const k = n, seg = Math.PI * 2 / k, t = ((a % seg) + seg) % seg - seg / 2; return Math.cos(seg / 2) / Math.cos(t); }
  if (kind === 'star') { const t = (u * n * 2) % 2; return t < 1 ? 1 - 0.5 * t : 0.5 + 0.5 * (t - 1); }
  if (kind === 'blob') return 0.85 + 0.12 * Math.sin(a * 3 + 1) + 0.08 * Math.sin(a * 5);
  if (kind === 'flower') return 0.65 + 0.35 * Math.abs(Math.cos(a * n / 2));
  return 1;
}

const base: EffectDefinition = {
  id: 'audioShapes', name: 'Audio Shapes & Distortion', category: 'animate',
  description: 'Shapes, kinetic type and the picture bend, scale, turn and fill with sound: bass, mids, highs, waveform and spectrum.',
  animated: () => true,
  supportsTransparency: true,
  params: [
    { key: 'audioSrc', label: 'Audio Source', type: 'custom', editor: 'audioSource', default: '', group: 'Sound' },
    { ...T('testSignal', 'Test Signal', false, 'Sound'), hint: 'A made-up beat for setting up without sound. Not your audio.' },
    R('sensitivity', 'Sensitivity', 0.2, 4, 0.01, 1.3, 'Sound'),
    R('smoothing', 'Smoothing', 0, 0.95, 0.01, 0.6, 'Sound'),
    S('element', 'Element', 'shape', [['shape', 'Shape'], ['text', 'Kinetic Text'], ['content', 'Custom Content'], ['none', 'Picture Only']], 'Elements'),
    { ...S('shape', 'Shape', 'flower', [['circle', 'Circle'], ['ring', 'Ring'], ['polygon', 'Polygon'], ['star', 'Star'], ['flower', 'Flower'], ['blob', 'Blob']], 'Elements'), visibleWhen: (v) => v.element === 'shape' },
    { ...R('sides', 'Points / Petals', 3, 16, 1, 6, 'Elements'), visibleWhen: (v) => v.element === 'shape' && ['polygon', 'star', 'flower'].includes(v.shape as string) },
    { key: 'text', label: 'Text', type: 'text', default: 'SOUND', maxLength: 60, group: 'Elements', visibleWhen: (v) => v.element === 'text' },
    { key: 'font', label: 'Font', type: 'custom', editor: 'font', default: '"Arial Black", Impact, sans-serif', group: 'Elements', visibleWhen: (v) => v.element === 'text' },
    R('count', 'Copies', 1, 16, 1, 1, 'Elements'),
    S('layout', 'Layout', 'center', [['center', 'Centered, Nested'], ['ring', 'Around A Ring'], ['row', 'In A Row'], ['grid', 'Grid']], 'Elements'),
    R('size', 'Size', 20, 900, 1, 320, 'Elements'),
    R('posX', 'Position X', 0, 1, 0.005, 0.5, 'Elements'),
    R('posY', 'Position Y', 0, 1, 0.005, 0.5, 'Elements'),
    R('deform', 'Shape Deformation', 0, 2, 0.01, 0.6, 'Deformation', 'Each point of the outline moves with its part of the spectrum.'),
    R('waveDeform', 'Waveform Deformation', 0, 2, 0.01, 0.25, 'Deformation'),
    S('scaleBy', 'Scale Follows', 'bass', BANDS, 'Audio Mapping'), R('scaleAmt', 'Scale Amount', 0, 2, 0.01, 0.5, 'Audio Mapping'),
    S('rotateBy', 'Rotation Follows', 'mid', BANDS, 'Audio Mapping'), R('rotateAmt', 'Rotation Amount', 0, 4, 0.01, 0.8, 'Audio Mapping'),
    S('moveBy', 'Movement Follows', 'treble', BANDS, 'Audio Mapping'), R('moveAmt', 'Movement Amount', 0, 200, 1, 30, 'Audio Mapping'),
    S('fillBy', 'Fill Follows', 'level', BANDS, 'Audio Mapping'), R('fillAmt', 'Fill Amount', 0, 1, 0.01, 0.7, 'Audio Mapping'),
    S('bendBy', 'Picture Bend Follows', 'bass', BANDS, 'Audio Mapping'), R('bendAmt', 'Bend Amount', 0, 80, 0.5, 18, 'Audio Mapping'),
    S('bendStyle', 'Bend Style', 'ripple', [['ripple', 'Ripple From Center'], ['wave', 'Waveform Rows'], ['bulge', 'Bulge'], ['twist', 'Twist']], 'Picture'),
    S('look', 'Look', 'fill', [['fill', 'Solid'], ['outline', 'Outline'], ['relief', 'Embossed Relief'], ['glow', 'Neon Glow']], 'Look'),
    C('color', 'Color', '#c6ff2e', 'Look'),
    C('color2', 'Second Color', '#ff3fa4', 'Look'),
    R('lineWidth', 'Line Width', 0.5, 30, 0.1, 5, 'Look'),
    S('background', 'Show On', 'image', [['image', 'Picture Or Webcam'], ['dim', 'Dimmed Picture'], ['color', 'Plain Color (Standalone)'], ['clear', 'Transparent']], 'Look'),
    { ...R('dim', 'Dim Picture', 0, 1, 0.01, 0.5, 'Look'), visibleWhen: (v) => v.background === 'dim' },
    { ...C('bgColor', 'Background Color', '#4b5360', 'Look'), visibleWhen: (v) => v.background === 'color' },
  ],
  presets: [
    { name: 'Pulse Flower', values: {} },
    { name: 'Relief Ornament', values: { look: 'relief', background: 'color', bgColor: '#4b5360', color: '#b9c0cc', color2: '#ffffff', shape: 'flower', sides: 8, count: 4, layout: 'center', lineWidth: 10, bendAmt: 0 } },
    { name: 'Kinetic Type', values: { element: 'text', text: 'LOUDER', look: 'fill', size: 260, bendAmt: 10 } },
    { name: 'Bass Bend', values: { element: 'none', bendAmt: 40, bendStyle: 'ripple' } },
    { name: 'Neon Rings', values: { shape: 'ring', count: 6, layout: 'center', look: 'glow', background: 'color', bgColor: '#05060a', lineWidth: 4 } },
    { name: 'Spectrum Row', values: { shape: 'circle', count: 8, layout: 'row', size: 160, scaleBy: 'level', look: 'fill' } },
  ],
  render({ src, srcCanvas, ctx, width: w, height: h, params: p, unit, time }) {
    const f = p.testSignal ? testFrame(time) : audioBus.read() ?? SILENCE, gain = p.sensitivity as number;
    const dt = memo.t < 0 || time < memo.t || time - memo.t > 1 ? 0 : time - memo.t;
    if (memo.t < 0 || time < memo.t - 1e-3 || time - memo.t > 1) { memo.spin = 0; for (const k in memo.env) memo.env[k] = 0; }
    memo.t = time;
    const keep = dt ? (p.smoothing as number) ** (dt * 30) : 1;
    for (const k of Object.keys(memo.env)) { const v = Math.min(1, band(f, k) * gain); memo.env[k] = v > memo.env[k] ? v : memo.env[k] * keep + v * (1 - keep); }
    const env = memo.env, get = (k: string) => (k === 'off' ? 0 : env[k] ?? 0);
    memo.spin += dt * get(p.rotateBy as string) * (p.rotateAmt as number) * 2;

    // The picture, bent by sound.
    const bg = p.background as string, bend = get(p.bendBy as string) * (p.bendAmt as number) * unit;
    if (bg === 'color') { ctx.fillStyle = p.bgColor as string; ctx.fillRect(0, 0, w, h); }
    else if (bg !== 'clear') {
      if (bend > 0.3) {
        const o = ctx.createImageData(w, h), od = new Uint32Array(o.data.buffer), sd = new Uint32Array(src.data.buffer), cx = w / 2, cy = h / 2, style = p.bendStyle as string, wave = f.wave, R0 = Math.hypot(cx, cy);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy) || 1;
          let sx = x, sy = y;
          if (style === 'ripple') { const k = Math.sin(r / (24 * unit) - time * 8) * bend; sx = x + (dx / r) * k; sy = y + (dy / r) * k; }
          else if (style === 'wave') { sx = x + wave[Math.floor((y / h) * (wave.length - 1))] * bend * 3; }
          else if (style === 'bulge') { const k = 1 - (bend / (60 * unit)) * Math.max(0, 1 - r / R0) ** 2; sx = cx + dx * k; sy = cy + dy * k; }
          else { const a = (bend / (200 * unit)) * Math.max(0, 1 - r / R0) ** 2 * 3, c = Math.cos(a), s = Math.sin(a); sx = cx + dx * c - dy * s; sy = cy + dx * s + dy * c; }
          const X = sx < 0 ? 0 : sx >= w ? w - 1 : sx | 0, Y = sy < 0 ? 0 : sy >= h ? h - 1 : sy | 0;
          od[y * w + x] = sd[Y * w + X];
        }
        ctx.putImageData(o, 0, 0);
      } else ctx.drawImage(srcCanvas as HTMLCanvasElement, 0, 0);
      if (bg === 'dim') { ctx.fillStyle = `rgba(0,0,0,${p.dim})`; ctx.fillRect(0, 0, w, h); }
    }
    const el = p.element as string;
    if (el === 'none') return;

    // Where each copy goes.
    const count = p.count as number, size = (p.size as number) * unit, cx0 = (p.posX as number) * w, cy0 = (p.posY as number) * h, layout = p.layout as string;
    const scale = 1 + get(p.scaleBy as string) * (p.scaleAmt as number), move = get(p.moveBy as string) * (p.moveAmt as number) * unit, fill = Math.min(1, 0.15 + get(p.fillBy as string) * (p.fillAmt as number) + (1 - (p.fillAmt as number)) * 0.85);
    const spots: { x: number; y: number; s: number; i: number }[] = [];
    for (let i = 0; i < count; i++) {
      const u = count > 1 ? i / count : 0;
      if (layout === 'center') spots.push({ x: cx0, y: cy0, s: 1 - u * 0.75, i });
      else if (layout === 'ring') spots.push({ x: cx0 + Math.cos(u * 6.2832 + memo.spin * 0.3) * size * 0.9, y: cy0 + Math.sin(u * 6.2832 + memo.spin * 0.3) * size * 0.9, s: 0.4, i });
      else if (layout === 'row') spots.push({ x: w * (0.5 + i) / count, y: cy0, s: Math.min(1, 1.6 / count + 0.2), i });
      else { const cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols); spots.push({ x: w * ((i % cols) + 0.5) / cols, y: h * (Math.floor(i / cols) + 0.5) / rows, s: 1 / cols, i }); }
    }
    const c1 = hexToRgb(p.color as string), c2 = hexToRgb(p.color2 as string), look = p.look as string, lw = (p.lineWidth as number) * unit;
    const layer = look === 'relief' ? createCanvas(w, h) : null, g = layer ? get2d(layer, true) : ctx;
    const deform = p.deform as number, wd = p.waveDeform as number, kind = p.shape as string, sides = p.sides as number, stamper = el === 'content' ? contentOf(p, unit) : null;
    for (const sp of spots) {
      // Each copy listens to a different part of the spectrum, low to high.
      const own = count > 1 ? specAt(f, sp.i / (count - 1)) * gain : 0;
      const jx = Math.sin(time * 7 + sp.i * 2.1) * move, jy = Math.cos(time * 5.3 + sp.i * 1.7) * move;
      const x = sp.x + jx, y = sp.y + jy, rad = (size / 2) * sp.s * scale * (1 + own * 0.25), rot = memo.spin + sp.i * 0.4;
      const t = count > 1 ? sp.i / (count - 1) : 0, col = c1.map((v, k) => v + (c2[k] - v) * t);
      g.save();
      if (look === 'glow') { g.shadowColor = rgbCss(col); g.shadowBlur = 18 * unit * (0.5 + fill); }
      if (el === 'text') {
        const text = (p.text as string) || ' ', letters = [...text], fs = rad * 0.9;
        g.font = `900 ${fs}px ${p.font}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const widths = letters.map((l) => g.measureText(l).width), total = widths.reduce((a, b) => a + b, 0);
        let px = x - total / 2;
        letters.forEach((l, k) => {
          // Each letter takes its own band, so the word moves like an equaliser.
          const v = specAt(f, k / Math.max(1, letters.length - 1)) * gain, ls = 1 + v * deform, ly = -v * (p.moveAmt as number) * unit + Math.sin(time * 6 + k) * f.wave[(k * 97) % f.wave.length] * wd * fs * 0.3;
          g.save();
          g.translate(px + widths[k] / 2, y + ly);
          g.rotate(Math.sin(rot + k) * 0.08 * (p.rotateAmt as number));
          g.scale(ls, ls);
          if (look === 'outline') { g.strokeStyle = rgbCss(col); g.lineWidth = lw / ls; g.strokeText(l, 0, 0); }
          else { g.fillStyle = rgbCss(col, look === 'relief' ? 1 : fill); g.fillText(l, 0, 0); }
          g.restore();
          px += widths[k];
        });
      } else if (stamper) {
        stamper.begin(g as CanvasRenderingContext2D);
        stamper.stamp(g as CanvasRenderingContext2D, sp.i, x, y, rad * 2, col, rot, look === 'relief' ? 1 : fill);
        stamper.end(g as CanvasRenderingContext2D);
      } else {
        const N = 160;
        g.beginPath();
        for (let k = 0; k <= N; k++) {
          const u = k / N, base0 = outline(kind, sides, u + rot / 6.2832), mirror = u < 0.5 ? u * 2 : (1 - u) * 2;
          const r = rad * base0 * (1 + deform * specAt(f, mirror) * gain * 0.6 + wd * f.wave[Math.floor(u * (f.wave.length - 1))] * 0.5);
          const a = u * Math.PI * 2 + rot;
          if (k) g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        g.closePath();
        if (look === 'outline' || look === 'glow' || kind === 'ring' || look === 'relief') { g.strokeStyle = rgbCss(col, look === 'relief' ? 1 : fill); g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
        else { g.fillStyle = rgbCss(col, fill); g.fill(); }
      }
      g.restore();
    }
    if (layer) {
      // Relief: the drawing becomes a raised surface lit from the top left.
      const m = (layer.getContext('2d')!).getImageData(0, 0, w, h).data, n = w * h, Hm = new Float32Array(n);
      for (let i = 0; i < n; i++) Hm[i] = m[i * 4 + 3] / 255;
      // The shape stays crisp; a blurred copy of it gives the rounded height used for light.
      const A = boxBlur(Hm, w, h, 1, 1), B = boxBlur(Hm, w, h, Math.max(1.5, lw * 0.5), 3), out = ctx.getImageData(0, 0, w, h), o = out.data, s = Math.max(2, lw * 0.9);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, q = i * 4, nx = (B[i - 1] - B[i + 1]) * s, ny = (B[i - w] - B[i + w]) * s, light = Math.max(-1, Math.min(1, nx * 0.75 + ny * 0.75));
        const a = A[i];
        // A soft shadow below and right, then the lit surface on top.
        const sh = Math.max(0, B[Math.min(Hm.length - 1, i + Math.round(lw * 0.35) * (w + 1))] - a) * 0.55;
        for (let c = 0; c < 3; c++) {
          let v = o[q + c] * (1 - sh);
          if (a > 0.01) v += (c1[c] + light * 110 + (light > 0.55 ? (light - 0.55) * 160 : 0) - v) * Math.min(1, a * 1.2);
          o[q + c] = clamp255(v);
        }
      }
      ctx.putImageData(out, 0, 0);
    }
  },
};

export const audioShapes = withContent(base);
void ({} as ParamValues);
