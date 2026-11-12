/**
 * Core effect contract. Every effect is a pure description (id, name, params)
 * plus a render function that draws into a target canvas context.
 * The UI never touches pixels directly; it only edits parameter values.
 */

export type EffectCategory =
  | 'pattern' | 'distortion' | 'texture' | 'light' | 'adjust' | 'analog' | 'key' | 'depth' | 'type'
  | 'animate' | 'stacks';

/** Which media an effect gives a meaningful result on. */
export type MediaCompat = 'both' | 'image' | 'video';

/** Audio features an effect parameter can follow. */
export type Band = 'level' | 'bass' | 'mid' | 'treble' | 'beat';
export type AudioBands = Record<Band, number>;
export const ZERO_BANDS: AudioBands = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0 };

/** A link from one numeric parameter to an audio band. amount ∈ [-1, 1] of the param range. */
export interface AudioMod {
  band: Band;
  amount: number;
}
export type ModMap = Record<string, AudioMod>;

export type ParamValue = number | string | boolean;
export type ParamValues = Record<string, ParamValue>;

interface BaseParam {
  key: string;
  label: string;
  group?: string;
  /** Short explanation shown as a tooltip. */
  hint?: string;
  /** Hide the control unless this predicate passes for the current values. */
  visibleWhen?: (values: ParamValues) => boolean;
}

export interface RangeParam extends BaseParam {
  type: 'range';
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface SelectParam extends BaseParam {
  type: 'select';
  options: { value: string; label: string }[];
  default: string;
}

export interface ColorParam extends BaseParam {
  type: 'color';
  default: string;
}

export interface ToggleParam extends BaseParam {
  type: 'toggle';
  default: boolean;
}

export interface SeedParam extends BaseParam {
  type: 'seed';
  default: number;
}

export interface TextParam extends BaseParam {
  type: 'text';
  default: string;
  maxLength: number;
  multiline?: boolean;
}

/** An ordered list of asset ids from the asset bin, stored as "id1,id2,…". */
export interface ImagesParam extends BaseParam {
  type: 'images';
  default: string;
  max: number;
  /** Also offer video assets. */
  video?: boolean;
}

/** A value edited by a dedicated widget (curves, gradient, LUT…), stored as a string. */
export interface CustomParam extends BaseParam {
  type: 'custom';
  editor: 'curves' | 'gradient' | 'lut' | 'overlays' | 'selectiveColor' | 'font' | 'audioSource' | 'vision' | 'reveal' | 'speech';
  default: string;
}

export type ParamDef = RangeParam | SelectParam | ColorParam | ToggleParam | SeedParam | TextParam | ImagesParam | CustomParam;

/** One entry of a non-destructive effect stack. */
export interface StackItem {
  id: string;
  effectId: string;
  enabled: boolean;
  params: ParamValues;
  /** 0..100: how much of this step is mixed over the previous result. */
  mix: number;
  blend: GlobalCompositeOperation;
  mods: ModMap;
  /** Where this step applies: everywhere, or limited by the selection or the depth map. */
  scope?: StepScope;
}

export type StepScope = 'all' | 'subject' | 'background' | 'depthNear' | 'depthFar';

/** A resolved stack entry, ready to render. */
export interface RenderLayer {
  effect: EffectDefinition;
  params: ParamValues;
  mix?: number;
  blend?: GlobalCompositeOperation;
  scope?: StepScope;
}

export function parseIds(v: ParamValue | undefined): string[] {
  return typeof v === 'string' && v ? v.split(',').filter(Boolean) : [];
}

export interface RenderInput {
  /** Source pixels, already scaled to width × height. Never mutate. */
  src: ImageData;
  /** Same pixels as a canvas (handy for drawImage-based effects). */
  srcCanvas: HTMLCanvasElement | OffscreenCanvas;
  /** Output context sized width × height. Starts cleared (transparent). */
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  params: ParamValues;
  /**
   * Resolution-independent length unit: 1 unit = longEdge / 1000 px.
   * Spatial parameters are expressed in units so preview and export match.
   */
  unit: number;
  /** Media time in seconds (0 for still images). */
  time: number;
  /** Monotonic frame counter, used for animated noise. */
  frame: number;
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: EffectCategory;
  description: string;
  params: ParamDef[];
  /** Accepts custom text, icons and uploaded graphics through the content system. */
  supportsContent?: boolean;
  /** True when the effect can leave transparent pixels (affects PNG export). */
  supportsTransparency?: boolean;
  /**
   * Whether the effect changes over time with these params. Still images get
   * a play/pause clock and animation export when this returns true.
   */
  animated?: (params: ParamValues) => boolean;
  /** Suggested audio links used by "Auto-map" in the Audio panel. */
  audioDefaults?: ModMap;
  /** Defaults to 'both'. */
  compat?: MediaCompat;
  /** Not listed in the library: used by a panel of its own (the Adjust tab). */
  hidden?: boolean;
  /** Editable starting points shown as one-click buttons. */
  presets?: { name: string; values: ParamValues }[];
  render: (input: RenderInput) => void;
}

/** Library entries that are on the roadmap but not implemented yet. */
export interface PlannedEffect {
  id: string;
  name: string;
  category: EffectCategory;
}

export const CATEGORY_LABELS: Record<EffectCategory, string> = {
  pattern: 'Pattern & Generative',
  distortion: 'Distortion & Glitch',
  texture: 'Texture & Print',
  light: 'Light & Optical',
  adjust: 'Color & Image Adjustments',
  analog: 'VHS & Analog',
  key: 'Background Removal',
  depth: 'Depth & Focus',
  type: 'Typography & ASCII',
  animate: 'Animate',
  stacks: 'Stacks',
};

export function defaultParams(effect: EffectDefinition): ParamValues {
  return defaultsOf(effect.params);
}

export function defaultsOf(defs: ParamDef[]): ParamValues {
  const out: ParamValues = {};
  for (const p of defs) out[p.key] = p.default;
  return out;
}

/** Coerce arbitrary values into something the renderer can safely use. */
export function sanitizeParams(effect: EffectDefinition, values: ParamValues): ParamValues {
  return sanitizeDefs(effect.params, values);
}

export function sanitizeDefs(defs: ParamDef[], values: ParamValues): ParamValues {
  const out: ParamValues = {};
  for (const p of defs) {
    const v = values[p.key];
    switch (p.type) {
      case 'range': {
        const n = typeof v === 'number' ? v : Number(v);
        out[p.key] = Number.isFinite(n) ? Math.min(p.max, Math.max(p.min, n)) : p.default;
        break;
      }
      case 'seed': {
        const n = typeof v === 'number' ? v : Number(v);
        out[p.key] = Number.isFinite(n) ? Math.abs(Math.floor(n)) % 100000 : p.default;
        break;
      }
      case 'select':
        out[p.key] = p.options.some((o) => o.value === v) ? (v as string) : p.default;
        break;
      case 'color':
        out[p.key] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : p.default;
        break;
      case 'toggle':
        out[p.key] = typeof v === 'boolean' ? v : p.default;
        break;
      case 'text':
        out[p.key] = typeof v === 'string' ? v.slice(0, p.maxLength) : p.default;
        break;
      case 'images':
        out[p.key] = parseIds(v).slice(0, p.max).join(',');
        break;
      case 'custom':
        out[p.key] = typeof v === 'string' ? v : p.default;
        break;
    }
  }
  return out;
}

/**
 * Applies audio links: each linked range param is pushed by
 * band × amount × (max − min) and clamped to its range.
 */
export function modulateParams(effect: EffectDefinition, values: ParamValues, mods: ModMap | undefined, bands: AudioBands): ParamValues {
  return modulateDefs(effect.params, values, mods, bands);
}

export function modulateDefs(defs: ParamDef[], values: ParamValues, mods: ModMap | undefined, bands: AudioBands): ParamValues {
  if (!mods) return values;
  let out: ParamValues | null = null;
  for (const p of defs) {
    const m = mods[p.key];
    if (!m || p.type !== 'range' || !m.amount) continue;
    out ??= { ...values };
    const base = typeof values[p.key] === 'number' ? (values[p.key] as number) : p.default;
    const v = base + bands[m.band] * m.amount * (p.max - p.min);
    out[p.key] = Math.min(p.max, Math.max(p.min, v));
  }
  return out ?? values;
}

export function hasActiveMods(mods: ModMap | undefined): boolean {
  return !!mods && Object.values(mods).some((m) => m.amount !== 0);
}
