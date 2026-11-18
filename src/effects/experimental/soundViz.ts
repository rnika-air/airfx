import type { EffectDefinition, ParamValues } from '../types';
import { audioBus, SILENCE, type AudioFrame } from '../../engine/audio';
import { contentOf, withContent } from '../../content/content';
import { createCanvas, createRng, get2d, hash2, hexToRgb, valueNoise } from '../../utils/imageProcessing';
import { C, R, rgbCss, S, T } from '../generative';

/**
 * Sound Visualizer 2: a motion-design composition driven by real audio (a file,
 * the video's sound or the microphone), in preview and export alike.
 *
 * One main form, a field behind it (dot matrix, line field or soft orbits),
 * flow particles, kinetic type and a finish. The main forms:
 *   Spectral Strands  stacked glowing strands of pixel blocks, one per band,
 *                     each a scrolling record of its loudness (full frame);
 *   Type Blocks       your text set letter by letter on coloured blocks, rows
 *                     drifting with their band, blocks lighting with the sound;
 *   Spectral Form     an organic outline with echo contours;
 *   Ridgelines        a perspective history of the spectrum;
 *   XY Oscilloscope   and Custom Graphic (your own image or shape).
 * Layout places any form: full frame or sized, position, width and height,
 * rotation, spacing, offset and intensity. Bass and treble have their own response, so lows inflate
 * and push while highs add fine detail. With no sound it rests, unless Test
 * Signal is on, which is clearly a stand-in for setting up.
 */

interface Parts { x: Float32Array; y: Float32Array; px: Float32Array; py: Float32Array; vx: Float32Array; vy: Float32Array; age: Float32Array; life: Float32Array; hue: Float32Array; n: number }
const MAXP = 4000;
const newParts = (): Parts => ({ x: new Float32Array(MAXP), y: new Float32Array(MAXP), px: new Float32Array(MAXP), py: new Float32Array(MAXP), vx: new Float32Array(MAXP), vy: new Float32Array(MAXP), age: new Float32Array(MAXP), life: new Float32Array(MAXP), hue: new Float32Array(MAXP), n: 0 });

const memo = {
  t: -1, frame: -1, beat: 0, hitAge: 9, phase: 0, rot: 0, level: 0, bass: 0, mid: 0, treble: 0, spawn: 1,
  bins: new Float32Array(0),
  /** Spectrum history for the ridgeline, newest last. */
  hist: [] as Float32Array[],
  /** Sideways drift of each Type Blocks row, in letters. */
  drift: new Float64Array(256),
  /** Bumps on each hit, so Type Blocks recolour on the beat. */
  hits: 0,
  pix: null as HTMLCanvasElement | null,
  /** Recent form outlines, for echo contours that trail behind. */
  shapes: [] as Float32Array[],
  parts: newParts(),
  layer: null as HTMLCanvasElement | null,
  glow: null as HTMLCanvasElement | null,
  trail: null as HTMLCanvasElement | null,
  grain: null as HTMLCanvasElement | null,
  widths: new Map<string, number>(),
};

function reset() {
  memo.bins.fill(0); memo.hist = []; memo.shapes = []; memo.parts.n = 0; memo.drift.fill(0); memo.hits = 0;
  memo.phase = memo.rot = memo.level = memo.bass = memo.mid = memo.treble = memo.beat = 0; memo.hitAge = 9; memo.spawn = 1;
  if (memo.trail) get2d(memo.trail).clearRect(0, 0, memo.trail.width, memo.trail.height);
}

function testFrame(t: number): AudioFrame {
  const beat = (t * 2) % 1, kick = Math.exp(-beat * 7), N = 1024, spectrum = new Float32Array(N), wave = new Float32Array(2048);
  for (let i = 1; i < N; i++) {
    const f = Math.log(i + 1) / Math.log(N), low = Math.exp(-((f - 0.3) ** 2) * 60) * (0.45 + kick * 0.55), mid = Math.exp(-((f - 0.58) ** 2) * 50) * (0.5 + 0.3 * Math.sin(t * 5.3 + f * 30)), hi = Math.exp(-((f - 0.8) ** 2) * 40) * (0.3 + 0.25 * Math.sin(t * 9 + f * 70));
    spectrum[i] = Math.min(1, low + mid + hi);
  }
  for (let i = 0; i < 2048; i++) wave[i] = Math.sin(i * 0.02 + t * 18) * (0.3 + kick * 0.5) + Math.sin(i * 0.071 + t * 31) * 0.18 + Math.sin(i * 0.0047 + t * 2) * 0.12;
  return { bands: { level: 0.35 + kick * 0.5, bass: kick, mid: 0.5 + 0.3 * Math.sin(t * 3), treble: 0.4 + 0.3 * Math.sin(t * 7), beat: beat < 0.16 ? Math.exp(-beat * 6) : 0, hit: beat < 0.1 ? 1 - beat * 10 : 0 }, spectrum, wave, binHz: 23.4375 };
}

/** The spectrum on a log scale between two frequencies, in `n` bins, with fast attack and smooth release. */
function logBins(f: AudioFrame, n: number, lo: number, hi: number, gain: number, keep: number, dt: number) {
  if (memo.bins.length !== n) memo.bins = new Float32Array(n);
  const out = memo.bins, top = f.spectrum.length - 1, a = Math.log(Math.max(1, lo)), b = Math.log(Math.max(lo + 1, hi)), fall = dt > 0 ? keep ** (dt * 30) : 1;
  for (let i = 0; i < n; i++) {
    const from = Math.max(1, Math.min(top, Math.exp(a + ((b - a) * i) / n) / f.binHz)), to = Math.max(from + 1, Math.min(top, Math.exp(a + ((b - a) * (i + 1)) / n) / f.binHz));
    let s = 0;
    for (let k = from | 0; k < to; k++) s = Math.max(s, f.spectrum[k]);
    const v = Math.min(1, s ** 1.8 * gain);
    if (dt > 0) out[i] = v > out[i] ? v : out[i] * fall + v * (1 - fall);
  }
  return out;
}

/** Linear read of a 0..1 position in an array. */
const at = (a: Float32Array, u: number) => { const x = Math.max(0, Math.min(a.length - 1, u * (a.length - 1))), i = x | 0, k = x - i; return a[i] * (1 - k) + (a[Math.min(a.length - 1, i + 1)] ?? 0) * k; };
const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const is = (key: string, ...vals: string[]) => (v: ParamValues) => vals.includes(v[key] as string);
const on = (key: string) => (v: ParamValues) => v[key] === true;

const PALETTES: Record<string, { a: string; b: string; c: string; dark: string; paper: string }> = {
  acid: { a: '#c6ff2e', b: '#22d7ff', c: '#ff3fa4', dark: '#0b0c0b', paper: '#f2f0ea' },
  swiss: { a: '#0f8a2c', b: '#2f5bff', c: '#7d3cff', dark: '#101210', paper: '#f4f1ea' },
  mono: { a: '#ecebe4', b: '#ecebe4', c: '#ecebe4', dark: '#0b0c0b', paper: '#f2f0ea' },
  ember: { a: '#ffb347', b: '#ff5a36', c: '#ffe08a', dark: '#120b08', paper: '#f6efe6' },
  ice: { a: '#9fe8ff', b: '#5f7bff', c: '#ffffff', dark: '#070b12', paper: '#eef3f7' },
  ink: { a: '#111111', b: '#3a3a3a', c: '#ff3b1f', dark: '#0b0c0b', paper: '#f4f1ea' },
  riso: { a: '#d7e81f', b: '#2f7bff', c: '#ff2fa0', dark: '#0b0c0b', paper: '#f7f6f1' },
};
/** Block colours for Type Blocks: the palette's three plus a few that sit well with them. */
const SWATCHES: Record<string, string[]> = {
  riso: ['#d7e81f', '#b9c93a', '#9aa0b8', '#ff2fa0', '#2f7bff', '#f2a71b', '#1d1d1f', '#8f8f3a'],
  acid: ['#c6ff2e', '#22d7ff', '#ff3fa4', '#7a7f78', '#f2f2ea', '#1f2a10'],
  swiss: ['#0f8a2c', '#2f5bff', '#7d3cff', '#c8c3b6', '#1b1d1b', '#e8462b'],
  mono: ['#ecebe4', '#9b9a94', '#5b5a55', '#2a2a28'],
  ember: ['#ffb347', '#ff5a36', '#ffe08a', '#7a2e1c', '#2a1610'],
  ice: ['#9fe8ff', '#5f7bff', '#ffffff', '#2b3a66', '#c9d6ff'],
  ink: ['#111111', '#3a3a3a', '#ff3b1f', '#8a8a86', '#d9d4c7'],
};
const lumOf = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Closed smooth path through points, by curves between midpoints. */
function smoothClosed(g: CanvasRenderingContext2D, xs: number[], ys: number[]) {
  const n = xs.length;
  g.beginPath();
  g.moveTo((xs[n - 1] + xs[0]) / 2, (ys[n - 1] + ys[0]) / 2);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; g.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[j]) / 2, (ys[i] + ys[j]) / 2); }
  g.closePath();
}

const base: EffectDefinition = {
  id: 'soundViz', name: 'Sound Visualizer', category: 'animate',
  description: 'A motion-design composition that follows real audio: glowing spectral strands, type on colour blocks, an organic spectral form, ridgelines, an XY scope or your own graphic, with a field, flow particles and kinetic type. Fills the frame, or place it anywhere.',
  animated: () => true,
  params: [
    { key: 'audioSrc', label: 'Audio Source', type: 'custom', editor: 'audioSource', default: '', group: 'Sound' },
    { ...T('testSignal', 'Test Signal', false, 'Sound'), hint: 'A made-up beat for setting up without sound. It is not your audio. Turn it off before exporting.' },
    R('sensitivity', 'Sensitivity', 0.2, 4, 0.01, 1.4, 'Sound'),
    R('bassResp', 'Bass Response', 0, 2, 0.01, 1, 'Sound', 'How much the lows inflate and push.'),
    R('trebleResp', 'Treble Response', 0, 2, 0.01, 1, 'Sound', 'How much the highs add fine detail and jitter.'),
    R('smoothing', 'Release', 0, 0.98, 0.01, 0.8, 'Sound', 'How slowly movement falls back after a sound.'),
    R('freqLow', 'Lowest Frequency', 20, 2000, 1, 35, 'Sound', 'Hz'),
    R('freqHigh', 'Highest Frequency', 200, 20000, 10, 14000, 'Sound', 'Hz'),

    S('palette', 'Palette', 'acid', [['acid', 'Acid'], ['riso', 'Riso Blocks'], ['swiss', 'Swiss Paper'], ['mono', 'Mono'], ['ember', 'Ember'], ['ice', 'Ice'], ['ink', 'Ink And Red'], ['custom', 'Custom']], 'Color'),
    { ...C('colorA', 'Low', '#c6ff2e', 'Color'), visibleWhen: is('palette', 'custom') },
    { ...C('colorB', 'Mid', '#22d7ff', 'Color'), visibleWhen: is('palette', 'custom') },
    { ...C('colorC', 'High', '#ff3fa4', 'Color'), visibleWhen: is('palette', 'custom') },
    S('colorBy', 'Color Follows', 'freq', [['freq', 'Frequency'], ['level', 'Loudness'], ['time', 'Time'], ['solid', 'One Color']], 'Color'),
    R('glow', 'Glow', 0, 1, 0.01, 0.6, 'Color'),

    S('background', 'Background', 'dark', [['dark', 'Dark'], ['paper', 'Paper'], ['dim', 'Dimmed Image'], ['image', 'Image'], ['clear', 'Transparent']], 'Background'),
    { ...R('dim', 'Dim Image', 0, 1, 0.01, 0.6, 'Background'), visibleWhen: is('background', 'dim') },
    { ...C('bgColor', 'Background Color', '#0b0c0b', 'Background'), visibleWhen: (v) => v.background === 'dark' && v.palette === 'custom' },
    { ...C('paper', 'Paper Color', '#f4f1ea', 'Background'), visibleWhen: (v) => v.background === 'paper' && v.palette === 'custom' },
    { ...R('imageReact', 'Image Reacts', 0, 1, 0.01, 0.3, 'Background', 'The picture pumps with the bass and slices on hits.'), visibleWhen: is('background', 'dim', 'image') },

    S('form', 'Main Form', 'strands', [['strands', 'Spectral Strands'], ['typeGrid', 'Type Blocks'], ['blob', 'Spectral Form'], ['ridge', 'Ridgelines'], ['xy', 'XY Oscilloscope'], ['content', 'Custom Graphic'], ['none', 'None']], 'Form'),
    { ...R('strandRows', 'Strands', 1, 24, 1, 6, 'Form'), visibleWhen: is('form', 'strands') },
    { ...S('strandBands', 'Each Strand Shows', 'split', [['split', 'Its Own Band'], ['same', 'Whole Spectrum, Delayed']], 'Form'), visibleWhen: is('form', 'strands') },
    { ...S('strandFlow', 'Flow', 'center', [['center', 'From The Centre'], ['scroll', 'Scroll Left'], ['still', 'Live Spectrum']], 'Form', ), visibleWhen: is('form', 'strands') },
    { ...R('strandPixel', 'Pixel Size', 1, 24, 0.5, 4, 'Form'), visibleWhen: is('form', 'strands') },
    { ...R('strandThick', 'Thickness', 0.1, 2, 0.01, 0.9, 'Form', 'How tall a strand grows on a loud sound.'), visibleWhen: is('form', 'strands') },
    { ...R('strandSpark', 'Stray Pixels', 0, 1, 0.01, 0.35, 'Form', 'Loose blocks thrown off by the highs.'), visibleWhen: is('form', 'strands') },
    { key: 'gridText', label: 'Text', type: 'text', default: 'AIRFX SOUND VISUAL PLAYGROUND', maxLength: 200, group: 'Form', visibleWhen: is('form', 'typeGrid') },
    { key: 'gridFont', label: 'Font', type: 'custom', editor: 'font', default: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', group: 'Form', visibleWhen: is('form', 'typeGrid') },
    { ...R('gridCell', 'Letter Size', 10, 240, 1, 44, 'Form'), visibleWhen: is('form', 'typeGrid') },
    { ...R('gridFill', 'Block Coverage', 0, 1, 0.01, 0.55, 'Form', 'How much of the text sits on colour blocks.'), visibleWhen: is('form', 'typeGrid') },
    { ...R('gridDrift', 'Drift', 0, 4, 0.01, 1, 'Form', 'How fast rows slide; louder bands slide faster.'), visibleWhen: is('form', 'typeGrid') },
    { ...S('gridLetters', 'Letters', 'contrast', [['contrast', 'Light Or Dark'], ['light', 'Light'], ['dark', 'Dark']], 'Form'), visibleWhen: is('form', 'typeGrid') },
    { ...R('deform', 'Frequency Deformation', 0, 2, 0.01, 0.7, 'Form', 'How far each frequency pushes the outline.'), visibleWhen: is('form', 'blob', 'ridge') },
    { ...R('organic', 'Organic Motion', 0, 1, 0.01, 0.45, 'Form', 'Slow, living drift in the outline, even in quiet parts.'), visibleWhen: is('form', 'blob') },
    { ...S('symmetry', 'Symmetry', '2', [['1', 'None'], ['2', 'Mirror'], ['3', '3-Fold'], ['4', '4-Fold'], ['6', '6-Fold'], ['8', '8-Fold']], 'Form'), visibleWhen: is('form', 'blob') },
    { ...R('echoes', 'Echo Contours', 0, 24, 1, 9, 'Form', 'Earlier outlines trail behind, like contour lines.'), visibleWhen: is('form', 'blob', 'content') },
    { ...R('echoSpread', 'Echo Spread', 0, 1, 0.01, 0.35, 'Form'), visibleWhen: is('form', 'blob', 'content') },
    { ...S('formStyle', 'Style', 'both', [['line', 'Lines'], ['fill', 'Filled'], ['both', 'Filled + Lines']], 'Form'), visibleWhen: is('form', 'blob') },
    { ...R('ridgeLines', 'Lines', 6, 90, 1, 42, 'Form'), visibleWhen: is('form', 'ridge') },
    { ...R('ridgeDepth', 'Perspective', 0, 1, 0.01, 0.55, 'Form'), visibleWhen: is('form', 'ridge') },
    { ...T('ridgeFill', 'Hide Lines Behind', true, 'Form'), visibleWhen: is('form', 'ridge') },
    { ...R('xyDelay', 'Phase Offset', 1, 400, 1, 90, 'Form', 'Delay between the X and Y signal. Changes the figure.'), visibleWhen: is('form', 'xy') },
    { ...R('xyTrail', 'Phosphor Trail', 0, 0.97, 0.01, 0.8, 'Form'), visibleWhen: is('form', 'xy') },
    { ...R('lineWidth', 'Line Weight', 0.3, 12, 0.1, 1.6, 'Form'), visibleWhen: is('form', 'blob', 'ridge', 'xy') },
    { ...R('spin', 'Rotation Speed', -2, 2, 0.01, 0.15, 'Form'), visibleWhen: is('form', 'blob', 'xy', 'content') },

    // Layout: where the main form sits and how big it is. Works for every form.
    { ...T('fullFrame', 'Full Frame', true, 'Layout'), hint: 'The form fills the whole picture. Off: it takes the Size below.', visibleWhen: (v) => v.form !== 'none' },
    { ...R('formSize', 'Size', 40, 1600, 1, 420, 'Layout'), visibleWhen: (v) => v.form !== 'none' && v.fullFrame !== true },
    { ...R('formW', 'Width', 0.1, 3, 0.01, 1, 'Layout'), visibleWhen: (v) => v.form !== 'none' },
    { ...R('formH', 'Height', 0.1, 3, 0.01, 1, 'Layout'), visibleWhen: (v) => v.form !== 'none' },
    { ...R('formX', 'Position X', 0, 1, 0.005, 0.5, 'Layout'), visibleWhen: (v) => v.form !== 'none' },
    { ...R('formY', 'Position Y', 0, 1, 0.005, 0.5, 'Layout'), visibleWhen: (v) => v.form !== 'none' },
    { ...R('formRot', 'Rotation', -180, 180, 1, 0, 'Layout', '°'), visibleWhen: (v) => v.form !== 'none' },
    { ...R('spacing', 'Spacing', 0.2, 3, 0.01, 1, 'Layout', 'Room between strands, lines, letter rows or echoes.'), visibleWhen: is('form', 'strands', 'typeGrid', 'ridge', 'blob') },
    { ...R('offset', 'Offset', 0, 3, 0.01, 1, 'Layout', 'Time between strands, lines or echoes; for Type Blocks, how far each row is shifted.'), visibleWhen: is('form', 'strands', 'typeGrid', 'ridge', 'blob') },
    { ...R('intensity', 'Intensity', 0, 3, 0.01, 1, 'Layout', 'How strongly the form reacts to the sound.'), visibleWhen: (v) => v.form !== 'none' },

    S('field', 'Field', 'none', [['dots', 'Dot Matrix'], ['lines', 'Line Field'], ['orbits', 'Soft Orbits'], ['none', 'None']], 'Field'),
    { ...R('fieldDensity', 'Density', 0, 1, 0.01, 0.5, 'Field'), visibleWhen: (v) => v.field !== 'none' },
    { ...R('fieldReact', 'Reaction', 0, 2, 0.01, 1, 'Field', 'How strongly the field follows the spectrum and the bass wave.'), visibleWhen: (v) => v.field !== 'none' },
    { ...R('fieldOpacity', 'Opacity', 0, 1, 0.01, 0.55, 'Field'), visibleWhen: (v) => v.field !== 'none' },

    T('particles', 'Flow Particles', false, 'Particles'),
    { ...R('partCount', 'Particles', 50, MAXP, 10, 700, 'Particles'), visibleWhen: on('particles') },
    { ...R('partSpeed', 'Flow Speed', 0, 3, 0.01, 1, 'Particles'), visibleWhen: on('particles') },
    { ...R('partSize', 'Size', 0.5, 20, 0.1, 2.2, 'Particles'), visibleWhen: on('particles') },
    { ...R('partBurst', 'Beat Burst', 0, 3, 0.01, 0.6, 'Particles', 'Hits push particles out from the form.'), visibleWhen: on('particles') },
    { ...S('partShape', 'Particle Look', 'dot', [['dot', 'Dots'], ['streak', 'Streaks'], ['content', 'Custom Content']], 'Particles'), visibleWhen: on('particles') },

    T('typeOn', 'Kinetic Type', false, 'Type'),
    { key: 'text', label: 'Text', type: 'text', default: 'AIRFX', maxLength: 40, group: 'Type', visibleWhen: on('typeOn') },
    { key: 'font', label: 'Font', type: 'custom', editor: 'font', default: '"Helvetica Neue", Arial, sans-serif', group: 'Type', visibleWhen: on('typeOn') },
    { ...R('typeX', 'Position X', 0, 1, 0.005, 0.5, 'Type'), visibleWhen: on('typeOn') },
    { ...R('typeSize', 'Size', 20, 600, 1, 150, 'Type'), visibleWhen: on('typeOn') },
    { ...R('typeY', 'Position Y', 0, 1, 0.005, 0.86, 'Type'), visibleWhen: on('typeOn') },
    { ...S('typeMotion', 'Motion', 'bounce', [['bounce', 'Letters Jump'], ['stretch', 'Letters Stretch'], ['wave', 'Wave'], ['split', 'Color Split']], 'Type'), visibleWhen: on('typeOn') },
    { ...R('tracking', 'Bass Tracking', 0, 2, 0.01, 0.6, 'Type', 'Letters spread apart on the bass.'), visibleWhen: on('typeOn') },
    { ...S('typeColor', 'Type Color', 'palette', [['palette', 'Palette'], ['light', 'Light'], ['dark', 'Dark']], 'Type'), visibleWhen: on('typeOn') },

    R('speed', 'Animation Speed', 0, 4, 0.01, 1, 'Finish'),
    R('scale', 'Overall Scale', 0.2, 3, 0.01, 1, 'Finish'),
    R('grain', 'Grain', 0, 1, 0.01, 0.2, 'Finish'),
    R('vignette', 'Vignette', 0, 1, 0.01, 0.35, 'Finish'),
  ],
  presets: [
    { name: 'Spectral Strands', values: { palette: 'acid', background: 'dark', form: 'strands', strandRows: 6, strandBands: 'split', strandFlow: 'center', strandPixel: 4, fullFrame: true, field: 'none', particles: false, typeOn: false, glow: 0.6, grain: 0.15, vignette: 0.25 } },
    { name: 'Signal Stack', values: { palette: 'ice', background: 'dark', form: 'strands', strandRows: 14, strandBands: 'same', strandFlow: 'scroll', strandPixel: 3, strandThick: 0.7, offset: 2, fullFrame: true, field: 'none', particles: false, typeOn: false, glow: 0.5 } },
    { name: 'Type Blocks', values: { palette: 'riso', background: 'paper', form: 'typeGrid', gridCell: 44, gridFill: 0.6, gridDrift: 1, fullFrame: true, field: 'none', particles: false, typeOn: false, glow: 0, grain: 0.12, vignette: 0 } },
    { name: 'Type Blocks Night', values: { palette: 'acid', background: 'dark', form: 'typeGrid', gridCell: 36, gridFill: 0.45, gridDrift: 1.6, formRot: -8, formW: 1.2, formH: 1.2, fullFrame: true, field: 'none', particles: false, typeOn: false, glow: 0.35 } },
    { name: 'Liquid Form', values: { palette: 'acid', background: 'dark', form: 'blob', symmetry: '2', echoes: 12, echoSpread: 0.4, formStyle: 'both', fullFrame: true, field: 'dots', particles: true, glow: 0.55 } },
    { name: 'Swiss Orbits', values: { palette: 'swiss', background: 'paper', form: 'blob', symmetry: '1', echoes: 8, formStyle: 'line', fullFrame: true, field: 'orbits', fieldOpacity: 0.8, particles: false, glow: 0, grain: 0.45, vignette: 0.1, lineWidth: 2.4 } },
    { name: 'Ridgelines', values: { palette: 'mono', background: 'dark', form: 'ridge', ridgeLines: 54, ridgeDepth: 0.6, fullFrame: true, field: 'none', particles: false, glow: 0.3, lineWidth: 1.4, formY: 0.5 } },
    { name: 'XY Scope', values: { palette: 'acid', colorBy: 'solid', background: 'dark', form: 'xy', fullFrame: true, xyDelay: 120, xyTrail: 0.86, field: 'lines', fieldOpacity: 0.25, particles: false, glow: 0.8, lineWidth: 1.8 } },
    { name: 'Dot Matrix Type', values: { palette: 'ember', background: 'dark', form: 'none', field: 'dots', fieldDensity: 0.8, fieldReact: 1.4, fieldOpacity: 0.9, particles: false, typeOn: true, typeMotion: 'stretch', typeY: 0.5, typeSize: 220 } },
    { name: 'Over The Picture', values: { palette: 'ice', background: 'dim', dim: 0.5, imageReact: 0.5, form: 'blob', formStyle: 'line', echoes: 16, field: 'none', particles: true, partShape: 'dot' } },
    { name: 'Ink On Paper', values: { palette: 'ink', background: 'paper', form: 'blob', symmetry: '6', formStyle: 'line', echoes: 20, echoSpread: 0.6, field: 'none', particles: true, partShape: 'dot', glow: 0, grain: 0.5 } },
  ],
  supportsTransparency: true,
  render({ srcCanvas, ctx, width: w, height: h, params: p, unit, time, frame }) {
    const src = srcCanvas as HTMLCanvasElement, f = p.testSignal ? testFrame(time) : audioBus.read() ?? SILENCE;
    const same = memo.t === time && memo.frame === frame, jumped = memo.t >= 0 && (time < memo.t - 1e-3 || time - memo.t > 1);
    // Same start, same result: an export must not depend on what the preview did before it.
    if (jumped || memo.t < 0) reset();
    const dt = same ? 0 : memo.t < 0 || jumped ? 1 / 30 : Math.min(0.1, Math.max(0.001, time - memo.t || 1 / 30));
    memo.t = time; memo.frame = frame;

    const gain = p.sensitivity as number, keep = p.smoothing as number, sc = (p.scale as number) * unit, spd = p.speed as number;
    const bR = p.bassResp as number, tR = p.trebleResp as number;
    const sm = dt ? keep ** (dt * 30) : 1, ease = (old: number, v: number) => (dt === 0 ? old : v > old ? v : old * sm + v * (1 - sm));
    memo.level = ease(memo.level, Math.min(1, f.bands.level * gain));
    memo.bass = ease(memo.bass, Math.min(1.5, f.bands.bass * gain * bR));
    memo.mid = ease(memo.mid, Math.min(1, f.bands.mid * gain));
    memo.treble = ease(memo.treble, Math.min(1.5, f.bands.treble * gain * tR));
    memo.phase += dt * spd * (0.35 + memo.level * 1.4);
    memo.rot += dt * spd * (p.spin as number) * (0.6 + memo.mid);
    // A hit is any rise in the beat value, which only falls between hits.
    const beat = f.bands.beat, hit = dt > 0 && beat > 0.2 && beat > memo.beat + 0.02;
    if (dt > 0) { memo.beat = beat; memo.hitAge = hit ? 0 : memo.hitAge + dt; }
    const { level, bass, mid, treble, phase, rot, hitAge } = memo;
    const bins = logBins(f, 96, p.freqLow as number, p.freqHigh as number, gain, keep, dt);

    // Colour.
    const pal = p.palette === 'custom' ? { a: p.colorA as string, b: p.colorB as string, c: p.colorC as string, dark: p.bgColor as string, paper: p.paper as string } : PALETTES[p.palette as string] ?? PALETTES.acid;
    const A = hexToRgb(pal.a), B = hexToRgb(pal.b), D = hexToRgb(pal.c), by = p.colorBy as string;
    const ramp = (t: number) => { const u = by === 'solid' ? 0 : by === 'level' ? level : by === 'time' ? (t * 0.3 + phase * 0.08) % 1 : t; const v = Math.min(1, Math.max(0, u)); return v < 0.5 ? mix(A, B, v * 2) : mix(B, D, v * 2 - 1); };
    const bg = p.background as string, onPaper = bg === 'paper';

    // Background, with the picture pumping and slicing on hits.
    if (bg === 'dark') { ctx.fillStyle = pal.dark; ctx.fillRect(0, 0, w, h); }
    else if (onPaper) { ctx.fillStyle = pal.paper; ctx.fillRect(0, 0, w, h); }
    else if (bg !== 'clear') {
      const react = p.imageReact as number, z = 1 + react * Math.min(1, bass) * 0.08;
      ctx.drawImage(src, (w - w * z) / 2, (h - h * z) / 2, w * z, h * z);
      const slice = react * Math.exp(-hitAge * 7);
      if (slice > 0.03) {
        const rng = createRng(((hash2(Math.floor(time * 30 - hitAge * 30), 7, 3) * 1e6) | 0) + 1), n = 6;
        for (let i = 0; i < n; i++) {
          const y0 = rng() * h, hh = h * (0.02 + rng() * 0.08), dx = (rng() - 0.5) * w * 0.12 * slice;
          ctx.drawImage(ctx.canvas, 0, y0, w, hh, dx, y0, w, hh);
        }
      }
      if (bg === 'dim') { ctx.fillStyle = `rgba(0,0,0,${p.dim})`; ctx.fillRect(0, 0, w, h); }
    }

    // Everything vector is drawn on its own layer, so it can glow as one.
    if (!memo.layer) memo.layer = createCanvas(w, h);
    const L = memo.layer;
    if (L.width !== w || L.height !== h) { L.width = w; L.height = h; }
    const g = get2d(L);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.lineCap = g.lineJoin = 'round';

    // Layout. The form's area: the whole frame, or a square of Size; then stretched
    // by Width and Height. Round forms take the largest circle that fits.
    const cx = (p.formX as number) * w, cy = (p.formY as number) * h, full = p.fullFrame === true;
    const AW = (full ? w : (p.formSize as number) * sc) * (p.formW as number), AH = (full ? h : (p.formSize as number) * sc) * (p.formH as number);
    const R0 = Math.min(AW, AH) * 0.5 * (full ? 0.62 : 0.5), amt = p.intensity as number, spacing = p.spacing as number, offset = p.offset as number;
    const lw = (p.lineWidth as number) * sc;
    const stamper = contentOf(p, unit);

    /* ── Field ── */
    const field = p.field as string, fo = p.fieldOpacity as number, fr = p.fieldReact as number, dens = p.fieldDensity as number;
    if (field === 'dots') {
      const cols = Math.round(18 + dens * 70), cell = w / cols, rows = Math.ceil(h / cell), ring = hitAge * 900 * sc, maxD = Math.hypot(w, h);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = (c + 0.5) * cell, y = (r + 0.5) * cell, u = Math.abs(c / (cols - 1) - 0.5) * 2;
        const d = Math.hypot(x - cx, y - cy), wave = Math.exp(-(((d - ring) / (90 * sc)) ** 2)) * Math.exp(-hitAge * 1.8);
        const v = Math.min(1, at(bins, 1 - u) * fr * 0.8 * (1 - (d / maxD) * 0.6) + wave * fr * 0.9);
        const rad = cell * 0.5 * (0.12 + 0.82 * v);
        g.fillStyle = rgbCss(ramp(1 - u), fo * (0.25 + 0.75 * v));
        g.beginPath(); g.arc(x, y, rad, 0, 6.2832); g.fill();
      }
    } else if (field === 'lines') {
      const n = Math.round(10 + dens * 70), wave = f.wave, N = 160;
      g.lineWidth = Math.max(0.6, lw * 0.6);
      for (let i = 0; i < n; i++) {
        const y0 = ((i + 0.5) / n) * h, band = at(bins, i / (n - 1)), amp = (8 + band * 70 * fr) * sc, off = (i * 37) % wave.length;
        g.strokeStyle = rgbCss(ramp(i / (n - 1)), fo * (0.3 + band * 0.7));
        g.beginPath();
        for (let k = 0; k <= N; k++) {
          const x = (k / N) * w, env = Math.exp(-(((x - cx) / (w * 0.32)) ** 2)), y = y0 + wave[(off + k * 6) % wave.length] * amp * env;
          if (k) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
    } else if (field === 'orbits') {
      // Soft colour circles drifting on the page, as in the paper reference.
      const blobs: [number, number, number, number[]][] = [[0.24, 0.3, 0.2 + bass * 0.18 * fr, A], [0.72, 0.36, 0.16 + mid * 0.14 * fr, B], [0.58, 0.74, 0.13 + treble * 0.12 * fr, D]];
      blobs.forEach(([bx, byy, br, col], i) => {
        const x = (bx + Math.sin(phase * 0.4 + i * 2.1) * 0.04) * w, y = (byy + Math.cos(phase * 0.33 + i) * 0.04) * h, rr = br * Math.min(w, h) * (0.8 + dens * 0.6);
        const gr = g.createRadialGradient(x, y, 0, x, y, rr);
        gr.addColorStop(0, rgbCss(col, fo * 0.85)); gr.addColorStop(0.55, rgbCss(col, fo * 0.35)); gr.addColorStop(1, rgbCss(col, 0));
        g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      });
      const rows = 2 + Math.round(dens * 4), dots = 24 + Math.round(dens * 24);
      for (let r = 0; r < rows; r++) for (let d = 0; d < dots; d++) {
        const v = at(bins, d / (dots - 1)), x = w * (0.1 + 0.8 * (d / (dots - 1))), y = h * (0.12 + 0.07 * r), rad = (1.2 + v * 6 * fr) * sc;
        g.fillStyle = rgbCss(onPaper ? [20, 22, 20] : [236, 235, 228], fo * (0.35 + v * 0.65));
        g.beginPath(); g.arc(x, y, rad, 0, 6.2832); g.fill();
      }
    }

    /* ── Main form ── */
    // Interference Rings were retired; projects that used them get the Spectral Form.
    const form = p.form === 'rings' ? 'blob' : (p.form as string), style = p.formStyle as string, deform = (p.deform as number) * amt, organic = p.organic as number;
    const rot0 = ((p.formRot as number) * Math.PI) / 180;
    // Round forms are stretched by Width and Height; area forms already fill their box.
    const round = form === 'blob' || form === 'xy' || form === 'content', fw = p.formW as number, fh = p.formH as number;
    const kx = round ? fw / Math.min(fw, fh) : 1, ky = round ? fh / Math.min(fw, fh) : 1;
    g.save();
    g.translate(cx, cy); g.rotate(rot0); g.scale(kx, ky); g.translate(-cx, -cy);
    if (dt > 0 && (form === 'ridge' || form === 'strands')) { memo.hist.push(Float32Array.from(bins)); if (memo.hist.length > 600) memo.hist.shift(); }
    if (hit) memo.hits++;
    const gradStroke = () => { const gr = g.createLinearGradient(cx - R0 * 1.5, cy - R0, cx + R0 * 1.5, cy + R0); gr.addColorStop(0, rgbCss(ramp(0))); gr.addColorStop(0.5, rgbCss(ramp(0.5))); gr.addColorStop(1, rgbCss(ramp(1))); return gr; };
    if (form === 'strands') {
      /* Spectral Strands: each strand is a row of pixel blocks, mirrored about its own
         line. Along the row is time (newest in the middle or on the right), and its
         height is how loud its band was then. Drawn one block per pixel on a small
         canvas and scaled up without smoothing, so blocks stay crisp at any size. */
      const pix = Math.max(1, (p.strandPixel as number) * sc), pw = Math.max(2, Math.ceil(AW / pix)), ph = Math.max(2, Math.ceil(AH / pix));
      if (!memo.pix) memo.pix = createCanvas(pw, ph);
      const P = memo.pix;
      if (P.width !== pw || P.height !== ph) { P.width = pw; P.height = ph; }
      const pg = get2d(P, true), im = pg.createImageData(pw, ph), px = new Uint32Array(im.data.buffer);
      const rows = p.strandRows as number, split = p.strandBands === 'split', flow = p.strandFlow as string, thick = (p.strandThick as number) * amt, spark = (p.strandSpark as number) * Math.min(1, treble + 0.15);
      const hist = memo.hist, H = hist.length, span = Math.min(H, Math.round(pw * (flow === 'center' ? 0.5 : 1))), step = Math.max(0, Math.round(offset * 2));
      const rowH = Math.min(ph / rows, (ph / rows) * spacing), top = ph / 2 - (rowH * rows) / 2, light = !onPaper;
      const sliceT = (k: number) => Math.floor(time * 12) + k;
      for (let i = 0; i < rows; i++) {
        const lo = split ? i / rows : 0, hi = split ? (i + 1) / rows : 1, yc = top + (i + 0.5) * rowH, maxH = rowH * 0.5 * thick;
        const col = ramp(split ? (i + 0.5) / rows : i / Math.max(1, rows - 1)), delay = i * step;
        for (let c = 0; c < pw; c++) {
          const u = c / (pw - 1);
          // Which moment this column shows.
          let age: number, frac = u;
          if (flow === 'center') { age = Math.round(Math.abs(u - 0.5) * 2 * span); frac = 0.5 + (u - 0.5); }
          else if (flow === 'scroll') age = Math.round((1 - u) * span);
          else age = 0;
          const row = hist[H - 1 - age - delay] ?? (flow === 'still' || !H ? bins : null);
          const rest = () => { const y = Math.round(yc); if (y >= 0 && y < ph) px[y * pw + c] = light ? 0xff000000 | ((col[2] * 0.3) << 16) | ((col[1] * 0.3) << 8) | (col[0] * 0.3) : 0x55000000 | (col[2] << 16) | (col[1] << 8) | col[0]; };
          // In silence each strand rests as a faint line, so the layout is always visible.
          if (!row) { rest(); continue; }
          // Loudness of this strand's band then (or the spectrum across, for Live Spectrum).
          let a: number;
          if (flow === 'still') a = at(row, lo + (hi - lo) * frac);
          else { let sum = 0; const n = 6; for (let k = 0; k < n; k++) sum += at(row, lo + ((hi - lo) * (k + 0.5)) / n); a = sum / n; }
          const fade = flow === 'still' ? 1 : 1 - (age / Math.max(1, span)) ** 2 * 0.55;
          const streak = 0.55 + 0.45 * hash2(c, i, 41) + (hash2(c, i, 43) > 0.93 ? 0.4 : 0);
          const hh = Math.min(rowH * 0.48, a ** 1.4 * maxH * 1.5 * fade * (0.7 + 0.3 * streak));
          if (hh < 0.5) { rest(); continue; }
          for (let y = Math.max(0, Math.floor(yc - hh)); y <= Math.min(ph - 1, Math.ceil(yc + hh)); y++) {
            const t = Math.abs(y - yc) / hh;
            if (t > 1) continue;
            const flick = 0.65 + 0.35 * hash2(c, y, sliceT(i)), v = (1 - t) ** 1.3 * streak * flick, core = light ? (1 - t) ** 3 * Math.min(1, a * 2.2) : 0;
            const R = Math.min(255, (col[0] + (255 - col[0]) * core) * v), G = Math.min(255, (col[1] + (255 - col[1]) * core) * v), B = Math.min(255, (col[2] + (255 - col[2]) * core) * v);
            const q = y * pw + c;
            // On paper the blocks are ink: strong colour, alpha for density.
            px[q] = light ? 0xff000000 | (B << 16) | (G << 8) | R : (Math.min(255, v * 255) << 24) | (col[2] << 16) | (col[1] << 8) | col[0];
          }
          // Stray blocks above and below, thrown off by the highs.
          if (spark > 0 && hash2(c, i, sliceT(7)) < spark * a * 0.5) {
            const y = Math.round(yc + (hash2(c, i, sliceT(9)) - 0.5) * rowH * 0.95);
            if (y >= 0 && y < ph) px[y * pw + c] = light ? 0xff000000 | ((col[2] * 0.7) << 16) | ((col[1] * 0.7) << 8) | (col[0] * 0.7) : 0x99000000 | (col[2] << 16) | (col[1] << 8) | col[0];
          }
        }
      }
      pg.putImageData(im, 0, 0);
      g.imageSmoothingEnabled = false;
      g.globalCompositeOperation = light ? 'lighter' : 'source-over';
      g.drawImage(P, cx - (pw * pix) / 2, cy - (ph * pix) / 2, pw * pix, ph * pix);
      g.globalCompositeOperation = 'source-over';
      g.imageSmoothingEnabled = true;
    } else if (form === 'typeGrid') {
      /* Type Blocks: the text runs along every row, a letter per cell. Rows slide
         sideways at the pace of their band; letters where the sound is sit on colour
         blocks, which reshuffle on each hit. */
      const text = [...(String(p.gridText ?? '').replace(/\s+/g, ' ').trim() || 'AIRFX')].concat(' ');
      const cell = (p.gridCell as number) * sc, cw = cell * 0.66, chh = cell * spacing, cols = Math.ceil(AW / cw) + 2, rows = Math.max(1, Math.ceil(AH / chh));
      const x0 = cx - AW / 2, y0 = cy - (rows * chh) / 2, fill = (p.gridFill as number) * Math.min(2, amt), sw = (SWATCHES[p.palette as string] ?? [pal.a, pal.b, pal.c]).map(hexToRgb);
      const letters = p.gridLetters as string, driftK = (p.gridDrift as number) * spd;
      g.font = `700 ${cell * 0.8}px ${p.gridFont}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.save();
      g.beginPath(); g.rect(x0, y0, AW, rows * chh); g.clip();
      for (let r = 0; r < rows; r++) {
        const band = at(bins, (r + 0.5) / rows), dir = r % 2 ? -1 : 1;
        if (dt > 0) memo.drift[r % 256] += dt * driftK * dir * (0.25 + band * 3.5);
        const d = memo.drift[r % 256] + r * offset * 5.3, whole = Math.floor(d), frac = d - whole;
        for (let k = -1; k < cols; k++) {
          const idx = k + whole, ch = text[((idx % text.length) + text.length) % text.length], x = x0 + (k - frac + 0.5) * cw, y = y0 + (r + 0.5) * chh;
          if (ch === ' ') continue;
          // Blocks gather where the sound is: this column's band, plus slow drifting clusters.
          const u = Math.min(1, Math.max(0, (x - x0) / AW)), e = at(bins, u) * 1.3 + bass * 0.25, cl = valueNoise(idx * 0.18, r * 0.5 + phase * 0.25, 5);
          const on = e * fill * 1.4 + (cl - 0.5) * 0.9 + fill * 0.45 > 0.62 + hash2(idx, r, 3) * 0.3;
          let tc: number[];
          if (on) {
            const c = sw[Math.floor(hash2(idx, r, memo.hits + 1) * sw.length)];
            g.fillStyle = rgbCss(c);
            const pop = 1 + Math.min(1, band) * 0.08 * Math.exp(-hitAge * 6);
            g.fillRect(x - (cw / 2) * pop - 0.5, y - (chh / 2) * pop * Math.min(1, 1 / spacing) - 0.5, cw * pop + 1, chh * pop * Math.min(1, 1 / spacing) + 1);
            tc = letters === 'light' ? [250, 250, 246] : letters === 'dark' ? [16, 16, 16] : lumOf(c) > 150 ? [16, 16, 16] : [250, 250, 246];
          } else {
            // Letters without a block stay faint, so the blocks carry the picture.
            if (hash2(idx, r, 11) > 0.35 + fill * 0.4) continue;
            tc = onPaper ? [40, 40, 38] : [200, 200, 192];
            g.globalAlpha = 0.35;
          }
          g.fillStyle = rgbCss(tc);
          g.fillText(ch, x, y + cell * 0.03);
          g.globalAlpha = 1;
        }
      }
      g.restore();
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    } else if (form === 'blob') {
      const sym = Number(p.symmetry) || 1, N = 200, radii = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * 6.2832, uu = ((th * sym) / 6.2832) % 1, u = sym === 1 ? uu : uu < 0.5 ? uu * 2 : 2 - uu * 2;
        const drift = Math.sin(th * 3 + phase * 1.3) * 0.5 + Math.sin(th * 5 - phase * 0.9 + 1.7) * 0.3 + Math.sin(th * 2 + phase * 0.6 + 4.1) * 0.2;
        radii[i] = 1 + Math.min(1.2, bass) * 0.32 + deform * 0.55 * at(bins, u) + organic * 0.14 * drift + Math.min(1, treble) * 0.035 * Math.sin(th * 46 + phase * 9);
      }
      if (dt > 0) { memo.shapes.push(radii); if (memo.shapes.length > 48) memo.shapes.shift(); }
      const echoes = p.echoes as number, spread = (p.echoSpread as number) * spacing, stroke = gradStroke(), lag = Math.max(1, Math.round(offset * 2));
      const outline = (rad: Float32Array, k: number) => {
        const xs: number[] = [], ys: number[] = [], grow = 1 + k * spread * 0.09;
        for (let i = 0; i < N; i++) { const th = (i / N) * 6.2832 + rot; xs.push(cx + Math.cos(th) * R0 * rad[i] * grow); ys.push(cy + Math.sin(th) * R0 * rad[i] * grow); }
        smoothClosed(g, xs, ys);
      };
      // Echoes: earlier outlines, further out and fainter.
      for (let k = echoes; k >= 1; k--) {
        const old = memo.shapes[Math.max(0, memo.shapes.length - 1 - k * lag)] ?? radii;
        outline(old, k);
        g.strokeStyle = stroke; g.globalAlpha = 0.85 * (1 - k / (echoes + 1)) ** 1.3; g.lineWidth = lw * (1 - k / (echoes + 2));
        g.stroke();
      }
      g.globalAlpha = 1;
      outline(radii, 0);
      if (style !== 'line') {
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, R0 * 1.6);
        gr.addColorStop(0, rgbCss(ramp(0.15), 0.7)); gr.addColorStop(0.55, rgbCss(ramp(0.5), 0.42)); gr.addColorStop(1, rgbCss(ramp(1), 0.12));
        g.fillStyle = gr; g.fill();
      }
      if (style !== 'fill') { g.strokeStyle = stroke; g.lineWidth = lw * 1.4; g.stroke(); }
    } else if (form === 'ridge') {
      // Lines fill the layout box; Spacing spreads them, Offset sets the time between them.
      const n = p.ridgeLines as number, depth = p.ridgeDepth as number, fill = p.ridgeFill === true, boxH = AH * 0.86, height = (boxH / 2.2) * deform, P = 160;
      const bottom = cy + boxH / 2, top = bottom - boxH * Math.min(1, spacing), gap = Math.max(1, Math.round(offset * 2));
      g.lineWidth = lw;
      for (let i = 0; i < n; i++) {
        const age = (n - 1 - i) * gap, row = memo.hist[memo.hist.length - 1 - age], k = i / Math.max(1, n - 1);
        if (!row) continue;
        const y0 = top + (bottom - top) * k, span = AW * (0.5 + 0.5 * (1 - depth * (1 - k))), x0 = cx - span / 2;
        g.beginPath();
        for (let j = 0; j <= P; j++) {
          const u = j / P, mirror = Math.abs(u - 0.5) * 2, env = Math.exp(-((mirror / 0.62) ** 2) * 1.6), v = at(row, 1 - mirror) * env;
          const y = y0 - v * height * (0.35 + 0.65 * k) - env * Math.min(1, bass) * height * 0.08 * (i === n - 1 ? 1 : 0);
          if (j) g.lineTo(x0 + u * span, y); else g.moveTo(x0 + u * span, y);
        }
        if (fill) {
          g.lineTo(x0 + span, y0 + 2 * sc); g.lineTo(x0, y0 + 2 * sc); g.closePath();
          // Erase what is behind, so near lines hide far ones, then draw the line.
          g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fill(); g.globalCompositeOperation = 'source-over';
        }
        g.strokeStyle = rgbCss(ramp(k), 0.35 + 0.65 * k);
        g.stroke();
      }
    } else if (form === 'xy') {
      if (!memo.trail) memo.trail = createCanvas(w, h);
      const T0 = memo.trail;
      if (T0.width !== w || T0.height !== h) { T0.width = w; T0.height = h; }
      const tg = get2d(T0), wave = f.wave, N = wave.length, delay = p.xyDelay as number, amp = R0 * 1.1 * Math.min(3, gain) * amt;
      if (dt > 0) {
        tg.globalCompositeOperation = 'destination-out';
        tg.fillStyle = `rgba(0,0,0,${1 - (p.xyTrail as number)})`;
        tg.fillRect(0, 0, w, h);
        tg.globalCompositeOperation = 'source-over';
        tg.lineWidth = lw; tg.lineJoin = 'round';
        tg.strokeStyle = rgbCss(ramp(Math.min(1, level)), 0.9);
        tg.beginPath();
        const ca = Math.cos(rot + 0.7854), sa = Math.sin(rot + 0.7854);
        // Stop before the delayed read runs off the end, so the trace never jumps across.
        for (let i = 0; i < N - delay; i += 2) {
          const a = wave[i], b = wave[i + delay], x = a * amp, y = b * amp;
          const qx = cx + x * ca - y * sa, qy = cy + x * sa + y * ca;
          if (i) tg.lineTo(qx, qy); else tg.moveTo(qx, qy);
        }
        tg.stroke();
      }
      g.drawImage(T0, 0, 0);
    } else if (form === 'content') {
      const echoes = p.echoes as number, spread = (p.echoSpread as number) * spacing, size = R0 * 2 * (0.8 + Math.min(1.2, bass) * 0.45 * amt);
      if (stamper) {
        stamper.begin(g);
        for (let k = echoes; k >= 0; k--) stamper.stamp(g, 0, cx, cy, size * (1 + k * spread * 0.12), ramp(k / Math.max(1, echoes)), rot + k * 0.05 * spread, k ? 0.6 * (1 - k / (echoes + 1)) ** 1.5 : 1);
        stamper.end(g);
      } else {
        g.strokeStyle = rgbCss(ramp(0.5)); g.lineWidth = 2 * sc;
        g.beginPath(); g.arc(cx, cy, size / 2, 0, 6.2832); g.stroke();
        g.fillStyle = rgbCss(ramp(0.5)); g.font = `${14 * sc}px ui-monospace, monospace`; g.textAlign = 'center';
        g.fillText('Choose a graphic in Content', cx, cy);
        g.textAlign = 'start';
      }
    }

    g.restore();

    /* ── Flow particles ── */
    if (p.particles) {
      const P0 = memo.parts, want = Math.min(MAXP, p.partCount as number), fs = (p.partSpeed as number) * spd, burst = p.partBurst as number, shape = p.partShape as string;
      if (dt > 0) {
        // Keep the count up; new ones start near the form so the flow reads as coming from it.
        const rng = createRng(((hash2(frame, 13, memo.spawn++) * 1e6) | 0) + 1);
        while (P0.n < want) {
          const i = P0.n++, a = rng() * 6.2832, d = R0 * (0.6 + rng() * 1.4);
          P0.x[i] = P0.px[i] = cx + Math.cos(a) * d; P0.y[i] = P0.py[i] = cy + Math.sin(a) * d;
          P0.vx[i] = P0.vy[i] = 0; P0.age[i] = 0; P0.life[i] = 1.5 + rng() * 3.5; P0.hue[i] = rng();
        }
        const flow = (20 + level * 180) * fs * sc, jitter = Math.min(1, treble) * 60 * sc, drag = Math.exp(-dt * 2.2), kick = hit ? burst * (160 + Math.min(1, bass) * 260) * sc : 0;
        let live = 0;
        for (let i = 0; i < P0.n; i++) {
          let x = P0.x[i], y = P0.y[i];
          const age = P0.age[i] + dt;
          if (age > P0.life[i] || x < -50 || y < -50 || x > w + 50 || y > h + 50) continue;
          // A slow, curling flow field that turns with the music.
          const a = Math.sin(x / (170 * sc) + phase) * 1.8 + Math.cos(y / (150 * sc) - phase * 0.7) * 1.8 + Math.atan2(y - cy, x - cx) * 0.5;
          let vx = P0.vx[i] * drag + Math.cos(a) * flow * dt * 2.4, vy = P0.vy[i] * drag + Math.sin(a) * flow * dt * 2.4;
          if (kick) { const dx = x - cx, dy = y - cy, dd = Math.hypot(dx, dy) || 1; vx += (dx / dd) * kick * (0.5 + P0.hue[i]); vy += (dy / dd) * kick * (0.5 + P0.hue[i]); }
          if (jitter) { vx += (hash2(i, frame, 1) - 0.5) * jitter; vy += (hash2(i, frame, 2) - 0.5) * jitter; }
          P0.px[live] = x; P0.py[live] = y;
          x += vx * dt; y += vy * dt;
          P0.x[live] = x; P0.y[live] = y; P0.vx[live] = vx; P0.vy[live] = vy; P0.age[live] = age; P0.life[live] = P0.life[i]; P0.hue[live] = P0.hue[i];
          live++;
        }
        P0.n = live;
      }
      const size = (p.partSize as number) * sc;
      if (shape === 'content' && stamper) stamper.begin(g);
      g.lineWidth = size;
      for (let i = 0; i < P0.n; i++) {
        const k = P0.age[i] / P0.life[i], alpha = Math.min(1, k * 6) * (1 - k) * 0.85, c = ramp(P0.hue[i]);
        if (shape === 'content' && stamper) { stamper.stamp(g, i, P0.x[i], P0.y[i], size * 4, c, P0.hue[i] * 6 + P0.age[i], alpha); continue; }
        if (shape === 'streak') {
          const dx = P0.x[i] - P0.px[i], dy = P0.y[i] - P0.py[i];
          g.strokeStyle = rgbCss(c, alpha);
          const m = Math.min(1, (18 * sc) / (Math.hypot(dx, dy) || 1)) * 1.6;
          g.beginPath(); g.moveTo(P0.x[i] - dx * m, P0.y[i] - dy * m); g.lineTo(P0.x[i], P0.y[i]); g.stroke();
        } else { g.fillStyle = rgbCss(c, alpha); g.fillRect(P0.x[i] - size / 2, P0.y[i] - size / 2, size, size); }
      }
      if (shape === 'content' && stamper) stamper.end(g);
    } else memo.parts.n = 0;

    /* ── Kinetic type ── */
    if (p.typeOn && String(p.text ?? '').trim()) {
      const text = String(p.text), size = (p.typeSize as number) * sc, font = `700 ${size}px ${p.font}`, motion = p.typeMotion as string, chars = [...text];
      g.font = font; g.textBaseline = 'alphabetic';
      const widthOf = (ch: string) => { const key = font + ch; let v = memo.widths.get(key); if (v === undefined) { v = g.measureText(ch).width; if (memo.widths.size > 2000) memo.widths.clear(); memo.widths.set(key, v); } return v; };
      const track = size * 0.04 + Math.min(1.2, bass) * size * 0.25 * (p.tracking as number), total = chars.reduce((s, ch) => s + widthOf(ch), 0) + track * (chars.length - 1);
      let x = (p.typeX as number) * w - total / 2;
      const y = (p.typeY as number) * h + size * 0.35, tc = p.typeColor as string;
      chars.forEach((ch, i) => {
        const t = chars.length > 1 ? i / (chars.length - 1) : 0.5, v = at(bins, t), cw = widthOf(ch), col = tc === 'light' ? [236, 235, 228] : tc === 'dark' ? [14, 15, 14] : ramp(t);
        g.save();
        g.translate(x + cw / 2, y);
        if (motion === 'bounce') g.translate(0, -v * size * 0.55);
        else if (motion === 'wave') g.translate(0, Math.sin(phase * 4 + i * 0.7) * size * 0.22 * (0.25 + level));
        else if (motion === 'stretch') g.scale(1, 1 + v * 0.75);
        if (motion === 'split') {
          const o = Math.min(1, treble) * size * 0.07 + v * size * 0.04;
          g.globalCompositeOperation = onPaper ? 'multiply' : 'screen';
          g.fillStyle = rgbCss(A); g.fillText(ch, -cw / 2 - o, 0);
          g.fillStyle = rgbCss(B); g.fillText(ch, -cw / 2, 0);
          g.fillStyle = rgbCss(D); g.fillText(ch, -cw / 2 + o, 0);
        } else { g.fillStyle = rgbCss(col); g.fillText(ch, -cw / 2, 0); }
        g.restore();
        x += cw + track;
      });
    }

    /* ── Composite: glow from a small blurred copy, then the sharp layer ── */
    const glow = p.glow as number;
    if (glow > 0.01) {
      if (!memo.glow) memo.glow = createCanvas(1, 1);
      const G = memo.glow, gw = Math.max(16, Math.round(w / 4)), gh = Math.max(16, Math.round(h / 4));
      if (G.width !== gw || G.height !== gh) { G.width = gw; G.height = gh; }
      const gg = get2d(G);
      gg.clearRect(0, 0, gw, gh);
      gg.filter = `blur(${2 + glow * 6}px)`;
      gg.drawImage(L, 0, 0, gw, gh);
      gg.filter = 'none';
      ctx.save();
      ctx.globalCompositeOperation = onPaper ? 'multiply' : 'screen';
      ctx.globalAlpha = Math.min(1, glow * (onPaper ? 0.6 : 1.4));
      ctx.drawImage(G, 0, 0, w, h);
      ctx.restore();
    }
    ctx.drawImage(L, 0, 0);

    const vig = p.vignette as number;
    if (vig > 0) {
      const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${vig * (onPaper ? 0.35 : 0.8)})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    }
    const grain = p.grain as number;
    if (grain > 0) {
      if (!memo.grain) {
        const c = createCanvas(256, 256), gc = get2d(c, true), im = gc.createImageData(256, 256);
        for (let i = 0; i < im.data.length; i += 4) { const v = hash2(i, 5, 2) * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
        gc.putImageData(im, 0, 0);
        memo.grain = c;
      }
      ctx.save();
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = grain * 0.6;
      const t = (frame * 37) % 256;
      ctx.translate(-t, -((t * 3) % 256));
      ctx.fillStyle = ctx.createPattern(memo.grain, 'repeat')!;
      ctx.fillRect(0, 0, w + 256, h + 256);
      ctx.restore();
    }
  },
};

export const soundViz = withContent(base, { when: (v) => v.form === 'content' || (v.particles === true && v.partShape === 'content') });
