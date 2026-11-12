import type { AudioBands } from '../effects/types';
import { modulateDefs, ZERO_BANDS } from '../effects/types';
import { hash2 } from '../utils/imageProcessing';
import type { Keyframe, Layer } from './model';
import { TRANSFORM_DEFS } from './model';

export interface LayerState {
  /** centre, as a fraction of composition width / height */
  x: number;
  y: number;
  scale: number;
  /** radians */
  rotation: number;
  opacity: number;
  /** 0..1 portion revealed (wipe / typewriter) */
  reveal: number;
  typewriter: boolean;
  /** changes ~boilFps times a second when boil > 0; drives hand-drawn re-randomising */
  boilStep: number;
}

const KEY_EPS = 1 / 60;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const backOut = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

/** Interpolated value of a keyframe track at local time t. */
export function sampleKeys(keys: Keyframe[], t: number): number {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      if (a.ease === 'hold') return a.v;
      const u = (t - a.t) / (b.t - a.t || 1);
      const k = a.ease === 'ease' ? easeInOut(u) : u;
      return a.v + (b.v - a.v) * k;
    }
  }
  return last.v;
}

/** Current (un-modulated) value of a transform property at composition time. */
export function propAt(layer: Layer, key: string, time: number): number {
  const keys = layer.keys[key];
  if (keys && keys.length) return sampleKeys(keys, time - layer.start);
  return layer.transform[key] as number;
}

/** Evaluate a layer at composition time: keyframes → audio links → presets → boil. */
export function evalLayer(layer: Layer, time: number, bands: AudioBands = ZERO_BANDS): LayerState {
  const local = time - layer.start;
  const dur = Math.max(0.001, layer.end - layer.start);
  const raw: Record<string, number> = {};
  for (const d of TRANSFORM_DEFS) raw[d.key] = propAt(layer, d.key, time);
  const v = modulateDefs(TRANSFORM_DEFS, raw, layer.tmods, bands) as Record<string, number>;

  let x = v.x / 100, y = v.y / 100, scale = v.scale, rot = (v.rotation * Math.PI) / 180, op = v.opacity / 100;
  let reveal = 1;
  let typewriter = false;
  const a = layer.anim;

  const applyPreset = (preset: string, p: number, entering: boolean) => {
    if (preset === 'none' || p >= 1) return;
    // Same preset name on the way out mirrors the entrance (from left → back to left).
    const e = easeOut(Math.max(0, p));
    switch (preset) {
      case 'fade': op *= e; break;
      case 'pop': scale *= Math.max(0, entering ? backOut(Math.max(0, p)) : e); op *= Math.min(1, p * 3); break;
      case 'slideLeft': x -= (1 - e) * 0.6; op *= Math.min(1, p * 2); break;
      case 'slideRight': x += (1 - e) * 0.6; op *= Math.min(1, p * 2); break;
      case 'slideUp': y += (1 - e) * 0.5; op *= Math.min(1, p * 2); break;
      case 'slideDown': y -= (1 - e) * 0.5; op *= Math.min(1, p * 2); break;
      case 'zoom': scale *= 0.4 + 0.6 * e; op *= e; break;
      case 'spin': rot += (1 - e) * Math.PI * (entering ? -1 : 1); scale *= e; break;
      case 'wipe': reveal = Math.min(reveal, e); break;
      case 'typewriter': reveal = Math.min(reveal, Math.max(0, p)); typewriter = true; break;
    }
  };
  applyPreset(a.animIn as string, local / (a.inDur as number), true);
  applyPreset(a.animOut as string, (dur - local) / (a.outDur as number), false);

  const boil = a.boil as number;
  let boilStep = 0;
  if (boil > 0) {
    boilStep = Math.floor(time * (a.boilFps as number));
    const h = (k: number) => hash2(boilStep, k, layer.id.length * 31 + 7) - 0.5;
    x += h(1) * boil * 0.008;
    y += h(2) * boil * 0.008;
    rot += h(3) * boil * 0.05;
    scale *= 1 + h(4) * boil * 0.02;
  }
  return { x, y, scale, rotation: rot, opacity: Math.max(0, Math.min(1, op)), reveal, typewriter, boilStep };
}

/* ───────────────────────── keyframe editing ───────────────────────── */

export function keyState(layer: Layer, key: string, time: number): 'none' | 'animated' | 'on' {
  const keys = layer.keys[key];
  if (!keys || !keys.length) return 'none';
  const t = time - layer.start;
  return keys.some((k) => Math.abs(k.t - t) < KEY_EPS) ? 'on' : 'animated';
}

function upsert(keys: Keyframe[], t: number, v: number): Keyframe[] {
  const out = keys.filter((k) => Math.abs(k.t - t) >= KEY_EPS);
  out.push({ t, v, ease: 'ease' });
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Set a transform property. If it is keyframed, this writes a keyframe at the
 * playhead (the After Effects behaviour); otherwise it changes the static value.
 */
export function setTransformProp(layer: Layer, key: string, value: number, time: number): Layer {
  const keys = layer.keys[key];
  if (keys && keys.length) {
    const t = Math.max(0, Math.min(layer.end - layer.start, time - layer.start));
    return { ...layer, keys: { ...layer.keys, [key]: upsert(keys, t, value) } };
  }
  return { ...layer, transform: { ...layer.transform, [key]: value } };
}

/** ◆ button: add a key with the current value here, or remove the key here. */
export function toggleKey(layer: Layer, key: string, time: number): Layer {
  const t = Math.max(0, Math.min(layer.end - layer.start, time - layer.start));
  const keys = layer.keys[key] ?? [];
  const existing = keys.find((k) => Math.abs(k.t - t) < KEY_EPS);
  if (existing) {
    const rest = keys.filter((k) => k !== existing);
    const next = { ...layer.keys };
    if (rest.length) next[key] = rest;
    else delete next[key];
    // keep the last value as the static value when the track disappears
    return { ...layer, keys: next, transform: rest.length ? layer.transform : { ...layer.transform, [key]: existing.v } };
  }
  return { ...layer, keys: { ...layer.keys, [key]: upsert(keys, t, propAt(layer, key, time)) } };
}

/** All distinct key times of a layer (local seconds), for drawing diamonds. */
export function keyTimes(layer: Layer): number[] {
  const set = new Set<number>();
  for (const k of Object.values(layer.keys)) for (const kf of k) set.add(Math.round(kf.t * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
}
