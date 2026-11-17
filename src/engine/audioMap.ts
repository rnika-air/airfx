import type { Band, EffectDefinition, ModMap, RangeParam } from '../effects/types';

/**
 * Suggested audio routing by what a parameter does, the way a musician would
 * patch it: bass moves the image (distortion, displacement), mids change
 * shapes, highs drive fine detail and particles, and the beat flashes, zooms
 * or shifts colour. Only a suggestion: every link stays editable.
 */

interface Role { band: Band; amount: number; test: RegExp; label: string }

export const ROLES: Role[] = [
  { band: 'bass', amount: 0.3, label: 'Distortion', test: /distort|displace|warp|bend|strength|amplitude|amount|relief|depth|melt|swirl|turbul|liquify|smear|wave/i },
  { band: 'mid', amount: 0.2, label: 'Shape', test: /shape|size|scale|cell|spacing|rotat|angle|twist|frequency|symmetr|sides|radius|tiles|complex/i },
  { band: 'treble', amount: 0.25, label: 'Detail & Particles', test: /jitter|grain|noise|particle|sparkle|detail|speed|density|count|chroma|split|scatter|shimmer|drift/i },
  { band: 'beat', amount: 0.3, label: 'Flash & Zoom', test: /flash|zoom|bright|exposure|glow|bloom|hue|coverage|chance|intensity|opacity|pulse|punch/i },
];

const ranges = (e: EffectDefinition) => e.params.filter((p): p is RangeParam => p.type === 'range');

/** One link per role at most, never the same parameter twice. */
export function routeByRole(effect: EffectDefinition): ModMap {
  const out: ModMap = {}, used = new Set<string>(), list = ranges(effect);
  for (const r of ROLES) {
    const p = list.find((q) => !used.has(q.key) && (r.test.test(q.key) || r.test.test(q.label)));
    if (!p) continue;
    used.add(p.key);
    out[p.key] = { band: r.band, amount: r.amount };
  }
  return out;
}

/** The effect's own suggestion, else routing by role, else its first slider on the bass. */
export function suggestedLinks(effect: EffectDefinition): ModMap {
  if (effect.audioDefaults && Object.keys(effect.audioDefaults).length) return effect.audioDefaults;
  const byRole = routeByRole(effect);
  if (Object.keys(byRole).length) return byRole;
  const first = ranges(effect)[0];
  return first ? { [first.key]: { band: 'bass', amount: 0.3 } } : {};
}

/** A sensible band for one parameter, used when it is linked by hand. */
export function bandFor(effect: EffectDefinition, key: string): { band: Band; amount: number } {
  const p = ranges(effect).find((q) => q.key === key);
  const fromEffect = effect.audioDefaults?.[key];
  if (fromEffect) return fromEffect;
  const r = p && ROLES.find((x) => x.test.test(p.key) || x.test.test(p.label));
  return r ? { band: r.band, amount: r.amount } : { band: 'bass', amount: 0.3 };
}
