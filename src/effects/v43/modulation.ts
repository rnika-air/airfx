import type { EffectDefinition, ParamValues } from '../types';
import { contentOf, withContent } from '../../content/content';
import { boxBlur, clamp255, createCanvas, get2d, hexToRgb, toLuma, valueNoise } from '../../utils/imageProcessing';
import { C, R, S, T } from '../generative';

/**
 * Signal modulation drawn as an image. A carrier wave runs along each line;
 * the picture (or your text or shape) modulates its amplitude, frequency or
 * phase, like a radio signal. The result is drawn as lines, or used to
 * displace the picture itself.
 */

const WAVE: Record<string, (t: number) => number> = {
  sine: (t) => Math.sin(t * Math.PI * 2),
  square: (t) => (((t % 1) + 1) % 1 < 0.5 ? 1 : -1),
  triangle: (t) => { const f = ((t % 1) + 1) % 1; return f < 0.5 ? f * 4 - 1 : 3 - f * 4; },
  saw: (t) => (((t % 1) + 1) % 1) * 2 - 1,
  pulse: (t) => (((t % 1) + 1) % 1 < 0.15 ? 1 : -0.25),
};

/** The modulating signal, 0..1: the image, or text or a shape drawn over a dark frame. */
function modSource(src: ImageData, p: ParamValues, unit: number) {
  const { width: w, height: h } = src, from = p.modSource as string;
  if (from === 'image') return boxBlur(toLuma(src), w, h, (p.smooth as number) * unit, 1);
  const c = createCanvas(w, h), g = get2d(c, true);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  if (from === 'text') {
    const lines = ((p.text as string) || ' ').split('\n'), size = (p.textSize as number) * unit;
    g.font = `900 ${size}px ${p.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.02));
  } else {
    const st = contentOf({ ...p, cMode: p.cMode === 'default' ? 'icon' : p.cMode }, unit);
    if (st) { st.begin(g); st.stamp(g, 0, w / 2, h / 2, Math.min(w, h) * 0.7, [255, 255, 255]); st.end(g); }
  }
  return boxBlur(toLuma(g.getImageData(0, 0, w, h)), w, h, Math.max(1, (p.smooth as number) * unit), 1);
}

const base: EffectDefinition = {
  id: 'modulation', name: 'Modulation', category: 'distortion',
  description: 'A carrier wave whose amplitude, frequency or phase follows the picture, text or a shape. Drawn as lines or used to bend the image.',
  animated: (p) => (p.speed as number) !== 0 || (p.drift as number) > 0,
  audioDefaults: { amplitude: { band: 'bass', amount: 0.3 }, frequency: { band: 'treble', amount: 0.15 } },
  params: [
    S('output', 'Output', 'lines', [['lines', 'Modulated Lines'], ['displace', 'Bend The Image'], ['both', 'Lines Over Bent Image']], 'Signal'),
    S('modType', 'Modulation', 'am', [['am', 'Amplitude (AM)'], ['fm', 'Frequency (FM)'], ['pm', 'Phase (PM)'], ['none', 'None, Plain Carrier']], 'Signal'),
    S('modSource', 'Modulated By', 'image', [['image', 'Image Brightness'], ['text', 'Text'], ['shape', 'Shape Or Uploaded Graphic']], 'Signal'),
    { key: 'text', label: 'Text', type: 'text', default: 'AIRFX', maxLength: 80, multiline: true, group: 'Signal', visibleWhen: (v) => v.modSource === 'text' },
    { key: 'font', label: 'Font', type: 'custom', editor: 'font', default: '"Arial Black", Impact, sans-serif', group: 'Signal', visibleWhen: (v) => v.modSource === 'text' },
    { ...R('textSize', 'Text Size', 40, 800, 1, 300, 'Signal'), visibleWhen: (v) => v.modSource === 'text' },
    T('invertSource', 'Invert Source', false, 'Signal'),
    R('depth', 'Modulation Depth', 0, 1, 0.01, 0.85, 'Signal'),
    R('smooth', 'Source Smoothing', 0, 20, 0.5, 2, 'Signal'),
    S('waveform', 'Waveform', 'sine', [['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'], ['saw', 'Sawtooth'], ['pulse', 'Pulse']], 'Carrier'),
    R('frequency', 'Frequency', 1, 200, 0.5, 40, 'Carrier', 'Cycles across the frame.'),
    R('amplitude', 'Amplitude', 0, 60, 0.1, 12, 'Carrier'),
    R('phase', 'Phase', 0, 360, 1, 0, 'Carrier', '°'),
    R('speed', 'Speed', -4, 4, 0.01, 0.4, 'Carrier'),
    R('direction', 'Direction', 0, 180, 1, 0, 'Carrier', '°'),
    R('repeat', 'Repetition', 10, 400, 1, 90, 'Carrier', 'Number of lines.'),
    R('distortion', 'Distortion', 0, 1, 0.01, 0, 'Carrier', 'Wobbles the carrier with slow noise.'),
    R('drift', 'Distortion Drift', 0, 2, 0.01, 0.3, 'Carrier'),
    R('lineWidth', 'Line Width', 0.3, 10, 0.1, 1.6, 'Lines'),
    T('widthFollows', 'Width Follows Source', true, 'Lines'),
    S('colorMode', 'Color', 'fixed', [['fixed', 'Line Color'], ['image', 'From Image'], ['gradient', 'Two-Color Gradient']], 'Color'),
    C('lineColor', 'Line Color', '#e9f0ea', 'Color'),
    { ...C('lineColor2', 'Second Color', '#c6ff2e', 'Color'), visibleWhen: (v) => v.colorMode === 'gradient' },
    C('background', 'Background', '#0b0c0b', 'Color'),
    R('showImage', 'Show Image Under Lines', 0, 1, 0.01, 0, 'Color'),
  ],
  presets: [
    { name: 'AM Scan Portrait', values: { output: 'lines', modType: 'am' } },
    { name: 'FM Signal', values: { modType: 'fm', amplitude: 6, frequency: 70, repeat: 120 } },
    { name: 'Phase Ripple Image', values: { output: 'displace', modType: 'pm', amplitude: 18, frequency: 24 } },
    { name: 'Square Wave Type', values: { modSource: 'text', waveform: 'square', modType: 'am', repeat: 140, amplitude: 8, frequency: 60, lineColor: '#c6ff2e' } },
    { name: 'Color Signal', values: { colorMode: 'image', lineWidth: 2.2, repeat: 110 } },
    { name: 'Wobble Bend', values: { output: 'displace', modType: 'none', distortion: 0.7, amplitude: 22, frequency: 8, waveform: 'triangle' } },
  ],
  render({ src, ctx, width: w, height: h, params: p, unit, time }) {
    const M = modSource(src, p, unit), inv = p.invertSource as boolean, depth = p.depth as number, wave = WAVE[p.waveform as string] ?? WAVE.sine;
    const ang = ((p.direction as number) * Math.PI) / 180, ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux;
    const span = Math.abs(w * ux) + Math.abs(h * uy), across = Math.abs(w * vx) + Math.abs(h * vy), cx = w / 2, cy = h / 2;
    const freq = (p.frequency as number) / span, amp = (p.amplitude as number) * unit, ph = (p.phase as number) / 360 + time * (p.speed as number), type = p.modType as string;
    const dist = p.distortion as number, drift = time * (p.drift as number), seedN = 13;
    const m = (x: number, y: number) => {
      const xi = Math.min(w - 1, Math.max(0, x | 0)), yi = Math.min(h - 1, Math.max(0, y | 0)), v = M[yi * w + xi];
      return inv ? 1 - v : v;
    };
    // Value of the signal at distance s along a line, with the source value there.
    const signal = (s: number, mv: number, acc: number) => {
      const k = 1 - depth + depth * mv;
      if (type === 'am') return wave(s * freq + ph) * k;
      if (type === 'fm') return wave(acc + ph);
      if (type === 'pm') return wave(s * freq + ph + mv * depth * 2);
      return wave(s * freq + ph);
    };
    const wob = (s: number, l: number) => (dist > 0 ? (valueNoise(s * 0.004 + drift, l * 0.05, seedN) - 0.5) * 2 * dist : 0);
    const out = p.output as string;

    if (out === 'displace' || out === 'both') {
      // Each pixel moves across its line by the signal value there.
      const o = ctx.createImageData(w, h), od = new Uint32Array(o.data.buffer), sd = new Uint32Array(src.data.buffer);
      const lines = p.repeat as number, gap = across / lines;
      for (let y = 0; y < h; y++) {
        let acc = 0, prevS = 0;
        for (let x = 0; x < w; x++) {
          const rx = x - cx, ry = y - cy, s = rx * ux + ry * uy + span / 2, l = (rx * vx + ry * vy) / gap, mv = m(x, y);
          if (type === 'fm') { acc += (s - prevS) * freq * (0.4 + mv * depth * 1.6); prevS = s; }
          const d = (signal(s, mv, type === 'fm' ? acc : 0) + wob(s, l)) * amp;
          const sx = Math.round(x + vx * d), sy = Math.round(y + vy * d);
          od[y * w + x] = sd[(sy < 0 ? 0 : sy >= h ? h - 1 : sy) * w + (sx < 0 ? 0 : sx >= w ? w - 1 : sx)];
        }
      }
      ctx.putImageData(o, 0, 0);
      if (out === 'displace') return;
    } else {
      ctx.fillStyle = p.background as string;
      ctx.fillRect(0, 0, w, h);
      if ((p.showImage as number) > 0) { ctx.globalAlpha = p.showImage as number; ctx.putImageData(src, 0, 0); ctx.globalAlpha = 1; }
      if ((p.showImage as number) > 0) {
        // putImageData ignores alpha, so blend the background back over it.
        ctx.globalAlpha = 1 - (p.showImage as number);
        ctx.fillStyle = p.background as string;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
    }

    const lines = p.repeat as number, gap = across / lines, step = Math.max(1, 1.5 * unit), lw = (p.lineWidth as number) * unit, follow = p.widthFollows as boolean;
    const cm = p.colorMode as string, c1 = hexToRgb(p.lineColor as string), c2 = hexToRgb(p.lineColor2 as string), sd = src.data;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let li = 0; li <= lines; li++) {
      const l = -across / 2 + li * gap, steps = Math.ceil(span / step);
      let acc = 0, px = 0, py = 0;
      // Lines are cut into short runs so width and colour can follow the source.
      for (let k = 0; k <= steps; k++) {
        const s = k * step, bx = cx + ux * (s - span / 2) + vx * l, by = cy + uy * (s - span / 2) + vy * l, mv = m(bx, by);
        if (type === 'fm') acc += step * freq * (0.4 + mv * depth * 1.6);
        const d = (signal(s, mv, acc) + wob(s, li)) * amp, x = bx + vx * d, y = by + vy * d;
        if (k > 0 && (x > -lw && x < w + lw && y > -lw && y < h + lw)) {
          const width = follow ? lw * (0.25 + mv * 1.5) : lw;
          if (width > 0.15) {
            let c: number[] = c1;
            if (cm === 'image') { const xi = Math.min(w - 1, Math.max(0, bx | 0)), yi = Math.min(h - 1, Math.max(0, by | 0)), q = (yi * w + xi) * 4; c = [sd[q], sd[q + 1], sd[q + 2]]; }
            else if (cm === 'gradient') c = c1.map((v, i) => v + (c2[i] - v) * (s / span));
            ctx.strokeStyle = `rgb(${clamp255(c[0])},${clamp255(c[1])},${clamp255(c[2])})`;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
        }
        px = x; py = y;
      }
    }
  },
};

export const modulation = withContent(base);
