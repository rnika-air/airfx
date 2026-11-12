import type { ModMap, ParamDef, ParamValues } from '../effects/types';
import { defaultParams, defaultsOf } from '../effects/types';
import { getEffect } from '../effects/registry';
import type { Asset } from '../engine/assets';

/**
 * Composition model for Timeline mode. Layers are stacked bottom → top
 * (index 0 is drawn first). Every layer has:
 *   • transform — position / scale / rotation / opacity (keyframable)
 *   • anim      — one-click in/out presets and "boil" wobble
 *   • props     — kind-specific settings described by a ParamDef schema
 * Effect layers act like adjustment layers: they process everything below.
 */

export type LayerKind = 'media' | 'text' | 'shape' | 'effect';
export type Ease = 'linear' | 'ease' | 'hold';

export interface Keyframe {
  /** seconds from the layer's start, so keys move with the clip */
  t: number;
  v: number;
  ease: Ease;
}

export interface Layer {
  id: string;
  kind: LayerKind;
  name: string;
  start: number;
  end: number;
  hidden: boolean;
  transform: ParamValues;
  keys: Record<string, Keyframe[]>;
  anim: ParamValues;
  props: ParamValues;
  effectId?: string;
  assetId?: string;
  /** audio links on transform params / on props */
  tmods: ModMap;
  pmods: ModMap;
}

export interface Composition {
  width: number;
  height: number;
  duration: number;
  background: string;
  layers: Layer[];
}

export const COMP_PRESETS = [
  { label: '16:9', width: 1920, height: 1080 },
  { label: '9:16', width: 1080, height: 1920 },
  { label: '1:1', width: 1080, height: 1080 },
  { label: '4:5', width: 1080, height: 1350 },
];

export function newComposition(): Composition {
  return { width: 1920, height: 1080, duration: 10, background: '#0e0f0e', layers: [] };
}

/* ───────────────────────── schemas ───────────────────────── */

export const TRANSFORM_DEFS: ParamDef[] = [
  { key: 'x', label: 'Position X', type: 'range', group: 'Transform', min: -50, max: 150, step: 0.1, default: 50, unit: '%' },
  { key: 'y', label: 'Position Y', type: 'range', group: 'Transform', min: -50, max: 150, step: 0.1, default: 50, unit: '%' },
  { key: 'scale', label: 'Scale', type: 'range', group: 'Transform', min: 0.01, max: 6, step: 0.01, default: 1, unit: '×' },
  { key: 'rotation', label: 'Rotation', type: 'range', group: 'Transform', min: -360, max: 360, step: 0.5, default: 0, unit: '°' },
  { key: 'opacity', label: 'Opacity', type: 'range', group: 'Transform', min: 0, max: 100, step: 1, default: 100, unit: '%' },
];
export const ANIMATABLE = TRANSFORM_DEFS.map((d) => d.key);

const IN_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'pop', label: 'Pop' },
  { value: 'slideLeft', label: 'Slide from Left' },
  { value: 'slideRight', label: 'Slide from Right' },
  { value: 'slideUp', label: 'Slide from Bottom' },
  { value: 'slideDown', label: 'Slide from Top' },
  { value: 'zoom', label: 'Zoom' },
  { value: 'spin', label: 'Spin' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'typewriter', label: 'Typewriter (text)' },
];

export const ANIM_DEFS: ParamDef[] = [
  { key: 'animIn', label: 'In', type: 'select', group: 'Animation', default: 'fade', options: IN_OPTIONS },
  { key: 'inDur', label: 'In Duration', type: 'range', group: 'Animation', min: 0.05, max: 4, step: 0.05, default: 0.4, unit: 's', visibleWhen: (v) => v.animIn !== 'none' },
  { key: 'animOut', label: 'Out', type: 'select', group: 'Animation', default: 'fade', options: IN_OPTIONS },
  { key: 'outDur', label: 'Out Duration', type: 'range', group: 'Animation', min: 0.05, max: 4, step: 0.05, default: 0.4, unit: 's', visibleWhen: (v) => v.animOut !== 'none' },
  { key: 'boil', label: 'Boil (stop-motion wobble)', type: 'range', group: 'Animation', min: 0, max: 1, step: 0.01, default: 0, hint: 'Hand-made jitter at 12 fps — the cut-out / scribble look.' },
  { key: 'boilFps', label: 'Boil Rate', type: 'range', group: 'Animation', min: 2, max: 24, step: 1, default: 10, unit: 'fps', visibleWhen: (v) => (v.boil as number) > 0 },
  {
    key: 'blend', label: 'Blend Mode', type: 'select', group: 'Animation', default: 'source-over',
    options: [
      { value: 'source-over', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' },
      { value: 'overlay', label: 'Overlay' }, { value: 'difference', label: 'Difference' }, { value: 'lighter', label: 'Add' },
    ],
  },
];

export const FONT_STACKS: Record<string, string> = {
  sans: "'Inter', 'Helvetica Neue', 'Segoe UI', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', Consolas, 'Courier New', monospace",
  condensed: "Impact, 'Haettenschweiler', 'Arial Narrow Bold', 'Arial Black', sans-serif",
  hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive",
};

export const TEXT_DEFS: ParamDef[] = [
  { key: 'text', label: 'Text', type: 'text', group: 'Text', default: 'YOUR TEXT', maxLength: 400, multiline: true },
  {
    key: 'font', label: 'Font', type: 'select', group: 'Text', default: 'sans',
    options: [{ value: 'sans', label: 'Sans' }, { value: 'serif', label: 'Serif' }, { value: 'mono', label: 'Mono' }, { value: 'condensed', label: 'Poster' }, { value: 'hand', label: 'Hand' }],
  },
  { key: 'size', label: 'Size', type: 'range', group: 'Text', min: 8, max: 600, step: 1, default: 120, unit: 'px' },
  {
    key: 'weight', label: 'Weight', type: 'select', group: 'Text', default: '800',
    options: [{ value: '400', label: 'Regular' }, { value: '700', label: 'Bold' }, { value: '800', label: 'Heavy' }],
  },
  { key: 'italic', label: 'Italic', type: 'toggle', group: 'Text', default: false },
  { key: 'upper', label: 'Uppercase', type: 'toggle', group: 'Text', default: false },
  {
    key: 'align', label: 'Align', type: 'select', group: 'Text', default: 'center',
    options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }],
  },
  { key: 'tracking', label: 'Letter Spacing', type: 'range', group: 'Text', min: -0.2, max: 1, step: 0.01, default: 0, unit: 'em' },
  { key: 'leading', label: 'Line Height', type: 'range', group: 'Text', min: 0.6, max: 2.5, step: 0.01, default: 1.05 },
  { key: 'color', label: 'Color', type: 'color', group: 'Style', default: '#f2f0e8' },
  { key: 'stroke', label: 'Outline', type: 'range', group: 'Style', min: 0, max: 40, step: 0.5, default: 0, unit: 'px' },
  { key: 'strokeColor', label: 'Outline Color', type: 'color', group: 'Style', default: '#0b0b0b', visibleWhen: (v) => (v.stroke as number) > 0 },
  { key: 'boxOn', label: 'Background Box', type: 'toggle', group: 'Style', default: false },
  { key: 'boxColor', label: 'Box Color', type: 'color', group: 'Style', default: '#c6ff2e', visibleWhen: (v) => v.boxOn === true },
  { key: 'boxPad', label: 'Box Padding', type: 'range', group: 'Style', min: 0, max: 200, step: 1, default: 24, unit: 'px', visibleWhen: (v) => v.boxOn === true },
  { key: 'shadow', label: 'Shadow', type: 'range', group: 'Style', min: 0, max: 1, step: 0.01, default: 0 },
];

export const SHAPE_DEFS: ParamDef[] = [
  {
    key: 'shape', label: 'Shape', type: 'select', group: 'Shape', default: 'box',
    options: [
      { value: 'box', label: 'Box' }, { value: 'ellipse', label: 'Ellipse' }, { value: 'star', label: 'Star' },
      { value: 'burst', label: 'Burst' }, { value: 'line', label: 'Line' }, { value: 'arrow', label: 'Arrow' },
      { value: 'underline', label: 'Underline' }, { value: 'scribbleCircle', label: 'Scribble Circle' }, { value: 'scribble', label: 'Scribble Fill' },
    ],
  },
  { key: 'w', label: 'Width', type: 'range', group: 'Shape', min: 2, max: 4000, step: 1, default: 600, unit: 'px' },
  { key: 'h', label: 'Height', type: 'range', group: 'Shape', min: 2, max: 4000, step: 1, default: 400, unit: 'px' },
  { key: 'radius', label: 'Corner Radius', type: 'range', group: 'Shape', min: 0, max: 600, step: 1, default: 0, unit: 'px', visibleWhen: (v) => v.shape === 'box' },
  { key: 'points', label: 'Points', type: 'range', group: 'Shape', min: 3, max: 32, step: 1, default: 5, visibleWhen: (v) => v.shape === 'star' || v.shape === 'burst' },
  { key: 'fillOn', label: 'Fill', type: 'toggle', group: 'Style', default: true },
  { key: 'fill', label: 'Fill Color', type: 'color', group: 'Style', default: '#c6ff2e', visibleWhen: (v) => v.fillOn === true },
  { key: 'strokeOn', label: 'Stroke', type: 'toggle', group: 'Style', default: false },
  { key: 'strokeColor', label: 'Stroke Color', type: 'color', group: 'Style', default: '#0b0b0b', visibleWhen: (v) => v.strokeOn === true },
  { key: 'strokeWidth', label: 'Stroke Width', type: 'range', group: 'Style', min: 0.5, max: 120, step: 0.5, default: 10, unit: 'px', visibleWhen: (v) => v.strokeOn === true },
  { key: 'rough', label: 'Hand-Drawn', type: 'range', group: 'Style', min: 0, max: 1, step: 0.01, default: 0, hint: 'Marker-style wobble. Combine with Boil for animated lines.' },
  { key: 'seed', label: 'Seed', type: 'seed', group: 'Style', default: 4 },
];

export const MEDIA_DEFS: ParamDef[] = [
  {
    key: 'fit', label: 'Fit', type: 'select', group: 'Media', default: 'contain',
    options: [{ value: 'contain', label: 'Contain' }, { value: 'cover', label: 'Cover' }, { value: 'original', label: 'Original Size' }],
  },
  { key: 'outline', label: 'Sticker Outline', type: 'range', group: 'Media', min: 0, max: 80, step: 0.5, default: 0, unit: 'px', hint: 'Cut-out border that follows transparent PNG edges.' },
  { key: 'outlineColor', label: 'Outline Color', type: 'color', group: 'Media', default: '#ffffff', visibleWhen: (v) => (v.outline as number) > 0 },
  { key: 'shadow', label: 'Drop Shadow', type: 'range', group: 'Media', min: 0, max: 1, step: 0.01, default: 0 },
  { key: 'corner', label: 'Corner Radius', type: 'range', group: 'Media', min: 0, max: 400, step: 1, default: 0, unit: 'px' },
  { key: 'offset', label: 'Video Start Offset', type: 'range', group: 'Video', min: 0, max: 600, step: 0.05, default: 0, unit: 's' },
  { key: 'loop', label: 'Loop Video', type: 'toggle', group: 'Video', default: true },
];

export function propDefsFor(layer: Pick<Layer, 'kind' | 'effectId'>): ParamDef[] {
  switch (layer.kind) {
    case 'text':
      return TEXT_DEFS;
    case 'shape':
      return SHAPE_DEFS;
    case 'media':
      return MEDIA_DEFS;
    case 'effect':
      return getEffect(layer.effectId ?? '')?.params ?? [];
  }
}

/* ───────────────────────── factories ───────────────────────── */

let n = 0;
export const layerId = () => `L${Date.now().toString(36)}${(n++).toString(36)}`;

function base(kind: LayerKind, name: string, comp: Composition, at: number, len = 4): Layer {
  const start = Math.max(0, Math.min(at, comp.duration - 0.5));
  return {
    id: layerId(),
    kind,
    name,
    start,
    end: Math.min(comp.duration, start + len),
    hidden: false,
    transform: defaultsOf(TRANSFORM_DEFS),
    keys: {},
    anim: defaultsOf(ANIM_DEFS),
    props: {},
    tmods: {},
    pmods: {},
  };
}

export const TEXT_PRESETS: { id: string; label: string; props: ParamValues; anim?: ParamValues }[] = [
  { id: 'headline', label: 'Headline', props: { text: 'HEADLINE', font: 'condensed', size: 220, weight: '800', upper: true, tracking: 0.01 }, anim: { animIn: 'pop' } },
  { id: 'subtitle', label: 'Subtitle', props: { text: 'A short subtitle', font: 'sans', size: 72, weight: '700' }, anim: { animIn: 'slideUp' } },
  { id: 'caption', label: 'Caption', props: { text: 'caption text here', font: 'mono', size: 44, weight: '400', boxOn: true, boxColor: '#0b0b0b', boxPad: 18, color: '#f2f0e8' }, anim: { animIn: 'typewriter', inDur: 1.2 } },
  { id: 'tag', label: 'Tag', props: { text: 'NEW', font: 'mono', size: 56, weight: '800', upper: true, boxOn: true, boxColor: '#c6ff2e', color: '#0b0b0b', boxPad: 22 }, anim: { animIn: 'pop', boil: 0.4 } },
  { id: 'hand', label: 'Handwritten', props: { text: 'hello!', font: 'hand', size: 140, weight: '700', color: '#ffe347' }, anim: { animIn: 'wipe', inDur: 0.8, boil: 0.5 } },
];

export function newTextLayer(comp: Composition, at: number, presetId = 'headline'): Layer {
  const p = TEXT_PRESETS.find((x) => x.id === presetId) ?? TEXT_PRESETS[0];
  const l = base('text', p.label, comp, at);
  l.props = { ...defaultsOf(TEXT_DEFS), ...p.props };
  l.anim = { ...l.anim, ...(p.anim ?? {}) };
  return l;
}

export function newShapeLayer(comp: Composition, at: number, shape: string): Layer {
  const l = base('shape', shape.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), comp, at);
  const scribbly = shape === 'scribbleCircle' || shape === 'underline' || shape === 'scribble';
  const lineish = shape === 'line' || shape === 'arrow' || scribbly;
  l.props = {
    ...defaultsOf(SHAPE_DEFS),
    shape,
    w: shape === 'underline' || shape === 'line' || shape === 'arrow' ? 700 : shape === 'box' ? 600 : 460,
    h: shape === 'underline' ? 60 : shape === 'line' || shape === 'arrow' ? 40 : shape === 'box' ? 360 : 460,
    fillOn: !lineish,
    strokeOn: lineish,
    strokeColor: lineish ? '#ff4d2e' : '#0b0b0b',
    strokeWidth: lineish ? 14 : 10,
    rough: scribbly ? 0.6 : 0,
  };
  if (scribbly) l.anim = { ...l.anim, animIn: 'wipe', inDur: 0.6, boil: 0.5 };
  return l;
}

export function newMediaLayer(comp: Composition, at: number, asset: Asset): Layer {
  const len = asset.kind === 'video' && asset.duration > 0 ? Math.min(asset.duration, comp.duration) : 5;
  const l = base('media', asset.name, comp, at, len);
  l.assetId = asset.id;
  l.props = { ...defaultsOf(MEDIA_DEFS), loop: asset.kind === 'video' };
  l.anim = { ...l.anim, animIn: 'none', animOut: 'none' };
  return l;
}

/** Effect (adjustment) layers span the whole composition by default; trim them on the timeline. */
export function newEffectLayer(comp: Composition, effectId: string): Layer | null {
  const eff = getEffect(effectId);
  if (!eff) return null;
  const l = base('effect', eff.name, comp, 0, comp.duration);
  l.effectId = effectId;
  l.props = defaultParams(eff);
  l.anim = { ...l.anim, animIn: 'none', animOut: 'none' };
  return l;
}

export function cloneLayer(l: Layer): Layer {
  return { ...structuredClone(l), id: layerId(), name: `${l.name} copy` };
}
