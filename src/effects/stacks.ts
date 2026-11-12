import type { EffectDefinition, ParamDef, ParamValues, RenderInput } from './types';
import { defaultParams, sanitizeParams } from './types';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { glitch } from './glitch';
import { pixDisplace } from './pixDisplace';
import { recolor } from './recolor';
import { ascii } from './ascii';
import { dithering, posterize } from './colorEffects';
import { stars } from './stars';
import { printAnimate } from './printAnimate';
import { airbrush, glyphArray } from './referenceFx';

/**
 * Stacks: ready-made looks built from two effects layered with tuned
 * settings. A stack exposes a few friendly controls and maps them onto the
 * underlying effects' parameters.
 */
interface Step {
  effect: EffectDefinition;
  /** fixed overrides on top of the effect's defaults */
  base: ParamValues;
  /** stack controls → this step's params */
  map?: (p: ParamValues) => ParamValues;
}

const buffers = [createCanvas(1, 1), createCanvas(1, 1)];

function makeStack(def: { id: string; name: string; description: string; params: ParamDef[]; steps: Step[]; animated?: EffectDefinition['animated']; audioDefaults?: EffectDefinition['audioDefaults'] }): EffectDefinition {
  return {
    id: def.id,
    name: def.name,
    category: 'stacks',
    description: def.description,
    params: def.params,
    animated: def.animated,
    audioDefaults: def.audioDefaults,
    render(input: RenderInput) {
      const { width, height } = input;
      let srcCanvas = input.srcCanvas;
      let src = input.src;
      def.steps.forEach((step, i) => {
        const last = i === def.steps.length - 1;
        let ctx = input.ctx;
        if (!last) {
          const c = buffers[i % 2];
          if (c.width !== width) c.width = width;
          if (c.height !== height) c.height = height;
          ctx = get2d(c, true);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, width, height);
        const params = sanitizeParams(step.effect, { ...defaultParams(step.effect), ...step.base, ...(step.map?.(input.params) ?? {}) });
        step.effect.render({ ...input, src, srcCanvas, ctx, params });
        if (!last) {
          srcCanvas = ctx.canvas;
          src = ctx.getImageData(0, 0, width, height);
        }
      });
    },
  };
}

export const hyperGlitch = makeStack({
  id: 'stackHyperGlitch',
  name: 'Hyper Glitch',
  description: 'PixDisplace + Glitch: jumping blocks torn by RGB-split bands.',
  animated: () => true,
  audioDefaults: { intensity: { band: 'beat', amount: 0.4 } },
  params: [
    { key: 'intensity', label: 'Intensity', type: 'range', group: 'Stack', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'block', label: 'Block Size', type: 'range', group: 'Stack', min: 4, max: 120, step: 1, default: 24 },
    { key: 'split', label: 'RGB Split', type: 'range', group: 'Stack', min: 0, max: 60, step: 0.5, default: 14 },
    { key: 'rate', label: 'Speed', type: 'range', group: 'Stack', min: 1, max: 24, step: 0.5, default: 10, unit: 'fps' },
    { key: 'seed', label: 'Seed', type: 'seed', group: 'Stack', default: 7 },
  ],
  steps: [
    { effect: pixDisplace, base: { direction: 'horizontal', mixed: true }, map: (p) => ({ block: p.block, coverage: 0.1 + (p.intensity as number) * 0.5, amount: 40 + (p.intensity as number) * 260, smear: 0.35, rate: p.rate, seed: p.seed }) },
    { effect: glitch, base: { animate: true, scanlines: 0.2 }, map: (p) => ({ intensity: p.intensity, rgbSplit: p.split, bands: 10 + Math.round((p.intensity as number) * 30), seed: p.seed }) },
  ],
});

export const redData = makeStack({
  id: 'stackRedData',
  name: 'Red Data',
  description: 'Red gradient map + binary ASCII: the image as streams of red data.',
  audioDefaults: { size: { band: 'bass', amount: 0.1 } },
  params: [
    { key: 'size', label: 'Character Size', type: 'range', group: 'Stack', min: 4, max: 40, step: 0.5, default: 10 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Stack', min: 0.3, max: 3, step: 0.01, default: 1.4 },
    { key: 'charset', label: 'Characters', type: 'select', group: 'Stack', default: 'binary', options: [{ value: 'binary', label: 'Binary' }, { value: 'standard', label: 'Standard' }, { value: 'blocks', label: 'Blocks' }] },
    { key: 'red', label: 'Red', type: 'color', group: 'Stack', default: '#ff1f1f' },
  ],
  steps: [
    { effect: recolor, base: { mode: 'gradient', palette: 'custom', c1: '#000000', c2: '#2a0000' }, map: (p) => ({ contrast: p.contrast, c3: p.red, c4: '#ffd9d0' }) },
    { effect: ascii, base: { colorMode: 'original', background: '#060000', bold: true }, map: (p) => ({ size: p.size, charset: p.charset }) },
  ],
});

export const pixelStars = makeStack({
  id: 'stackPixelStars',
  name: 'Pixel Stars',
  description: 'Chunky colour dither + twinkling star glints on the highlights.',
  animated: () => true,
  audioDefaults: { starSize: { band: 'bass', amount: 0.2 } },
  params: [
    { key: 'pixel', label: 'Pixel Size', type: 'range', group: 'Stack', min: 1, max: 12, step: 0.5, default: 4 },
    { key: 'threshold', label: 'Star Threshold', type: 'range', group: 'Stack', min: 0.3, max: 1, step: 0.005, default: 0.68 },
    { key: 'starSize', label: 'Star Size', type: 'range', group: 'Stack', min: 10, max: 200, step: 1, default: 54 },
    { key: 'twinkle', label: 'Twinkle', type: 'range', group: 'Stack', min: 0, max: 5, step: 0.05, default: 1.5 },
  ],
  steps: [
    { effect: dithering, base: { method: 'bayer', levels: 3, colorDither: true }, map: (p) => ({ pixel: p.pixel }) },
    { effect: stars, base: { rays: '4', glow: 0.6, colorMode: 'white' }, map: (p) => ({ threshold: p.threshold, size: p.starSize, twinkle: p.twinkle }) },
  ],
});

export const multiThreshold = makeStack({
  id: 'stackMultiThreshold',
  name: 'Multi Threshold',
  description: 'Posterize into hard tone steps, then snap each step to a flat colour.',
  audioDefaults: { contrast: { band: 'bass', amount: 0.15 } },
  params: [
    { key: 'levels', label: 'Levels', type: 'range', group: 'Stack', min: 2, max: 6, step: 1, default: 4 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Stack', min: 0.3, max: 3, step: 0.01, default: 1.3 },
    { key: 'c1', label: 'Shadow', type: 'color', group: 'Colors', default: '#14110f' },
    { key: 'c2', label: 'Low Mid', type: 'color', group: 'Colors', default: '#3d2bff' },
    { key: 'c3', label: 'High Mid', type: 'color', group: 'Colors', default: '#ff4f2e' },
    { key: 'c4', label: 'Highlight', type: 'color', group: 'Colors', default: '#f3efe2' },
  ],
  steps: [
    { effect: posterize, base: { levels: 4, brightness: 0 }, map: (p) => ({ levels: p.levels, contrast: p.contrast }) },
    { effect: recolor, base: { mode: 'gradient', palette: 'custom', contrast: 1 }, map: (p) => ({ c1: p.c1, c2: p.c2, c3: p.c3, c4: p.c4 }) },
  ],
});

export const gameboy = makeStack({
  id: 'stackGameboy',
  name: 'Gameboy',
  description: 'Ordered dither to four tones, then the classic green handheld palette.',
  params: [
    { key: 'pixel', label: 'Pixel Size', type: 'range', group: 'Stack', min: 1, max: 12, step: 0.5, default: 3.5 },
    { key: 'contrast', label: 'Contrast', type: 'range', group: 'Stack', min: 0.3, max: 3, step: 0.01, default: 1.2 },
    { key: 'method', label: 'Dither', type: 'select', group: 'Stack', default: 'bayer', options: [{ value: 'bayer', label: 'Bayer' }, { value: 'floyd', label: 'Floyd–Steinberg' }] },
  ],
  steps: [
    { effect: dithering, base: { levels: 4, colorDither: false, dark: '#000000', light: '#ffffff' }, map: (p) => ({ pixel: p.pixel, contrast: p.contrast, method: p.method }) },
    { effect: recolor, base: { mode: 'palette', palette: 'gameboy', contrast: 1 } },
  ],
});

const glyphControls: ParamDef[] = [
  { key: 'cell', label: 'Cell Size', type: 'range', group: 'Stack', min: 8, max: 80, step: 1, default: 24 },
  { key: 'target', label: 'Target Color', type: 'color', group: 'Stack', default: '#d6246e' },
  { key: 'tolerance', label: 'Tolerance', type: 'range', group: 'Stack', min: 2, max: 180, step: 1, default: 60, unit: '°' },
  { key: 'tile', label: 'Tile Color', type: 'color', group: 'Stack', default: '#ff4fa8' },
  { key: 'rate', label: 'Motion', type: 'range', group: 'Stack', min: 0, max: 16, step: 0.5, default: 4, unit: 'fps' },
];
const glyphMap = (p: ParamValues) => ({ cell: p.cell, target: p.target, tolerance: p.tolerance, tile: p.tile, rate: p.rate });

/** Reference 2: Array, then Risoprint, with colours that animate. */
export const arrayRiso = makeStack({
  id: 'stackArrayRiso',
  name: 'Array Riso',
  description: 'Glyph Array over a chosen colour, then a living risograph print.',
  animated: () => true,
  params: glyphControls,
  steps: [
    { effect: glyphArray, base: { select: 'color', mixed: true }, map: glyphMap },
    { effect: printAnimate, base: { inks: 'riso', cell: 4, misreg: 4 } },
  ],
});

/** Reference 5: Array, then Airbrush. */
export const arrayAirbrush = makeStack({
  id: 'stackArrayAirbrush',
  name: 'Array Airbrush',
  description: 'Shape tiles matched to the photo, sprayed over with airbrush grain.',
  animated: () => true,
  params: [
    { key: 'cell', label: 'Cell Size', type: 'range', group: 'Stack', min: 8, max: 80, step: 1, default: 22 },
    { key: 'coverage', label: 'Coverage', type: 'range', group: 'Stack', min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: 'glyph', label: 'Shape Color', type: 'color', group: 'Stack', default: '#f7f5ee' },
    { key: 'rate', label: 'Motion', type: 'range', group: 'Stack', min: 0, max: 16, step: 0.5, default: 4, unit: 'fps' },
  ],
  steps: [
    { effect: glyphArray, base: { select: 'all', colorMode: 'source', glyphs: 'x+os' }, map: (p) => ({ cell: p.cell, rate: p.rate, coverage: p.coverage, glyph: p.glyph }) },
    { effect: airbrush, base: { levels: 7, saturation: 1.4, dropWhite: 1, animate: true } },
  ],
});

export const STACKS = [hyperGlitch, redData, pixelStars, multiThreshold, gameboy, arrayRiso, arrayAirbrush];
