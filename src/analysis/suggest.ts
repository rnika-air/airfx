import type { EffectDefinition, ParamDef, ParamValue, ParamValues, RangeParam } from '../effects/types';
import type { MediaAnalysis } from './media';

/**
 * Turns a media analysis into suggested settings for one effect. Each
 * suggestion names the control, the value and the reason. Nothing is changed
 * until the person applies it, and every control stays editable after.
 */

export interface Suggestion { key: string; label: string; value: ParamValue; shown: string; reason: string }

const clamp = (p: RangeParam, v: number) => {
  const s = Math.min(p.max, Math.max(p.min, v));
  return p.step ? Math.round(s / p.step) * p.step : s;
};
const fmt = (p: ParamDef, v: ParamValue) => (typeof v === 'number' ? (Math.abs(v) < 10 ? v.toFixed(2).replace(/\.?0+$/, '') : String(Math.round(v))) + ((p as RangeParam).unit ?? '') : typeof v === 'boolean' ? (v ? 'On' : 'Off') : String(v));
const find = (e: EffectDefinition, key: string) => e.params.find((p) => p.key === key);
const range = (e: EffectDefinition, key: string) => { const p = find(e, key); return p && p.type === 'range' ? p : null; };

/** Dark / light colour slots an effect uses, which can take the picture's own colours. */
const COLOR_PAIRS: [string, string][] = [['shadow', 'highlight'], ['c1', 'c2'], ['dark', 'light'], ['color1', 'color2'], ['ink', 'paper']];
/** Size of a grid or pattern cell, by effect. */
const SIZE_KEYS = ['cell', 'spacing', 'size', 'pixel', 'pixelW', 'step', 'pitch', 'detail'];
/** Effects whose `threshold` / `level` cuts the picture into light and dark. */
const CUTS = new Set(['threshold', 'stencil', 'speechType', 'stackMultiThreshold']);
/** Effects that place a light or a centre somewhere. */
const LIGHTS: Record<string, [string, string]> = { lensFlare: ['x1', 'y1'], lightRays: ['x1', 'y1'] };
const CENTRES: Record<string, [string, string]> = { chromaticAb: ['cx', 'cy'], lensWarp: ['cx', 'cy'], radialArray: ['cx', 'cy'] };

const darker = (hex: string, k: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
const lum = (hex: string) => (0.2126 * parseInt(hex.slice(1, 3), 16) + 0.7152 * parseInt(hex.slice(3, 5), 16) + 0.0722 * parseInt(hex.slice(5, 7), 16)) / 255;

export function suggest(e: EffectDefinition, values: ParamValues, a: MediaAnalysis): Suggestion[] {
  const out: Suggestion[] = [];
  const add = (key: string, value: ParamValue, reason: string) => {
    const p = find(e, key);
    // Only controls the person can see right now.
    if (!p || values[key] === value || (p.visibleWhen && !p.visibleWhen(values))) return;
    if (typeof value === 'number' && typeof values[key] === 'number' && Math.abs((values[key] as number) - value) < ((p as RangeParam).step ?? 0.01) * 1.5) return;
    if (out.some((s) => s.key === key)) return;
    out.push({ key, label: p.label, value, shown: fmt(p, value), reason });
  };
  const dark = a.brightness < 0.28, bright = a.brightness > 0.68, flat = a.contrast < 0.14;

  // Tones.
  if (find(e, 'autoTone') && values.autoTone === false && (dark || bright || flat)) add('autoTone', true, dark ? 'The picture is dark: stretching its tones gives the effect the full range.' : bright ? 'The picture is very bright: stretching its tones keeps detail in the effect.' : 'The picture is flat: stretching its tones gives the effect more to work with.');
  const ct = range(e, 'contrast');
  if (ct && typeof values.contrast === 'number') {
    if (flat && (values.contrast as number) < 1.35) add('contrast', clamp(ct, Math.max(1.35, (values.contrast as number) * 1.25)), 'Low contrast picture.');
    else if (a.contrast > 0.3 && (values.contrast as number) > 1.25) add('contrast', clamp(ct, 1), 'Already high contrast: more would clip shadows and highlights.');
  }
  const br = range(e, 'brightness');
  if (br && typeof values.brightness === 'number' && br.min < 0) {
    if (dark && !find(e, 'autoTone')) add('brightness', clamp(br, 0.12), 'Dark picture.');
    else if (bright && !find(e, 'autoTone')) add('brightness', clamp(br, -0.08), 'Bright picture.');
  }
  if (CUTS.has(e.id)) {
    for (const k of ['level', 'threshold']) { const p = range(e, k); if (p && p.max <= 1) { add(k, clamp(p, a.median), 'Set at the picture’s middle tone, so it splits into even light and dark.'); break; } }
  }
  if (find(e, 'trueHighlights') && a.hi < 0.72) {
    const th = range(e, 'threshold');
    if (th) add('threshold', clamp(th, Math.max(th.min, a.hi - 0.12)), 'The picture has no real highlights: a lower threshold lets its brightest parts glow.');
  }

  // Scale: busy pictures read better with finer cells, simple ones with bigger.
  for (const k of SIZE_KEYS) {
    const p = range(e, k), v = values[k];
    if (!p || typeof v !== 'number' || k === 'detail') continue;
    if (a.detail > 0.55) add(k, clamp(p, v * 0.8), 'Lots of fine detail: smaller cells keep it readable.');
    else if (a.detail < 0.15) add(k, clamp(p, v * 1.25), 'Simple, flat picture: bigger cells read more clearly.');
    break;
  }

  // Placement: lights on the brightest spot, centres on the subject.
  const lp = LIGHTS[e.id];
  if (lp && a.brightest.level > 0.6) { add(lp[0], +a.brightest.x.toFixed(3), 'Placed on the brightest spot in the picture.'); add(lp[1], +a.brightest.y.toFixed(3), 'Placed on the brightest spot in the picture.'); }
  const cp = CENTRES[e.id];
  if (cp) { add(cp[0], +a.subject.x.toFixed(3), a.subject.from === 'selection' ? 'Centred on your selected subject.' : 'Centred on the likely subject.'); add(cp[1], +a.subject.y.toFixed(3), a.subject.from === 'selection' ? 'Centred on your selected subject.' : 'Centred on the likely subject.'); }

  // Colours from the picture itself.
  for (const [lo, hi] of COLOR_PAIRS) {
    const pl = find(e, lo), ph = find(e, hi);
    if (pl?.type !== 'color' || ph?.type !== 'color' || a.colors.length < 2) continue;
    const byLum = [...a.colors].sort((x, y) => lum(x) - lum(y));
    const darkC = darker(byLum[0], 0.55), lightC = a.vivid && lum(a.vivid) > lum(byLum[0]) + 0.2 ? a.vivid : byLum[byLum.length - 1];
    const loIsDark = lum(String(values[lo] ?? '#000000')) <= lum(String(values[hi] ?? '#ffffff'));
    add(loIsDark ? lo : hi, darkC, 'Uses the picture’s own darkest colour.');
    add(loIsDark ? hi : lo, lightC, a.vivid ? 'Uses the picture’s most vivid colour.' : 'Uses the picture’s lightest colour.');
    break;
  }
  if (e.id === 'glyphArray' && values.select === 'color' && a.vivid) add('target', a.vivid, 'The picture’s most vivid colour.');

  // Video.
  if (a.kind === 'video') {
    const st = range(e, 'stability');
    if (st && a.motion > 0.05 && (values.stability as number) < 0.7) add('stability', clamp(st, 0.75), 'Lots of movement: more stability stops glyphs flickering.');
    if (find(e, 'autoTone') && values.autoTone === false && a.flicker > 0.04) add('autoTone', true, 'The light changes during the clip; Auto Tone evens it out smoothly.');
  }
  if (e.id === 'thermal' && a.subject.from === 'selection' && values.heatFrom !== 'subject') add('heatFrom', 'subject', 'You selected a subject: it can run hot.');
  if (e.id === 'imageReactor' && a.backgroundBusy > 0.55 && values.scene === 'smear') add('feedback', 0.6, 'Busy picture: shorter trails keep it from turning to mud.');
  return out;
}
