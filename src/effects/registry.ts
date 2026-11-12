import type { EffectCategory, EffectDefinition, PlannedEffect } from './types';
import { moire } from './moire';
import { scatter } from './scatter';
import { halftone } from './halftone';
import { glitch } from './glitch';
import { filmGrain } from './filmGrain';
import { dithering, duotone, invert, posterize, rgbShift, threshold } from './colorEffects';
import { stippling } from './stippling';
import { dots } from './dots';
import { patterns } from './patterns';
import { ascii } from './ascii';
import { cellular } from './cellular';
import { distort } from './distort';
import { displace } from './displace';
import { pixelSort } from './pixelSort';
import { edge } from './edge';
import { bevel } from './bevel';
import { crt } from './crt';
import { noise } from './noise';
import { recolor } from './recolor';
import { gradients } from './gradients';
import { slide } from './slide';
import { stack } from './stack';
import { stutter } from './stutter';
import { pixDisplace } from './pixDisplace';
import { printAnimate } from './printAnimate';
import { stars } from './stars';
import { datamosh } from './datamosh';
import { vhs } from './vhs';
import { STACKS } from './stacks';
import { ADJUSTMENTS } from './adjust/adjustments';
import { ditherLab } from './ditherLab';
import { OPTICAL } from './optical';
import { DISPLACEMENT } from './displacement';
import { REFERENCE_FX } from './referenceFx';
import { airKey } from './airKey';
import { airDepth } from './airDepth';
import { airCleanup } from './airCleanup';
import { GENERATIVE } from './generative';
import { PRINT_SURFACE } from './printSurface';
import { TRENDS } from './trends';
import { EXPERIMENTAL } from './experimental';
import { adjustMaster } from './adjust/master';
import { V43 } from './v43';

/** The five flagship effects of v0.1. */
export const CORE_EFFECT_IDS = ['moire', 'scatter', 'halftone', 'glitch', 'filmGrain'];

export const EFFECTS: EffectDefinition[] = [
  moire, stippling, dots, patterns, cellular,
  scatter, distort, displace, pixDisplace, datamosh, pixelSort, rgbShift, glitch,
  halftone, ditherLab, dithering, edge, bevel, printAnimate, filmGrain, noise,
  stars, ...OPTICAL,
  ...ADJUSTMENTS, recolor, gradients, duotone, posterize, invert, threshold,
  vhs, crt,
  airKey,
  airCleanup,
  airDepth,
  ascii,
  ...DISPLACEMENT,
  ...REFERENCE_FX,
  ...GENERATIVE,
  ...PRINT_SURFACE,
  ...TRENDS,
  ...EXPERIMENTAL,
  ...V43,
  slide, stack, stutter,
  ...STACKS,
  adjustMaster,
];

/** What the library lists. */
export const LIBRARY = EFFECTS.filter((e) => !e.hidden);

/** Shown greyed-out in the library so the roadmap is visible but honest. */
export const PLANNED_EFFECTS: PlannedEffect[] = [];

export const CATEGORY_ORDER: EffectCategory[] = ['stacks', 'pattern', 'distortion', 'texture', 'light', 'adjust', 'analog', 'key', 'depth', 'type', 'animate'];

const byId = new Map(EFFECTS.map((e) => [e.id, e]));

export function getEffect(id: string): EffectDefinition | undefined {
  return byId.get(id);
}
