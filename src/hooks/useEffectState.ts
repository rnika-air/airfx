import { useCallback, useMemo, useReducer } from 'react';
import type { AudioMod, EffectDefinition, ModMap, ParamValue, ParamValues, RenderLayer, StackItem, AudioBands } from '../effects/types';
import { defaultParams, modulateParams } from '../effects/types';
import { getEffect } from '../effects/registry';
import { adjustMaster, adjustIsNeutral } from '../effects/adjust/master';

/** The Adjust tab: one adjustment pass, kept apart from the stack's steps. */
export interface AdjustState { params: ParamValues; place: 'before' | 'after'; enabled: boolean }
export const freshAdjust = (): AdjustState => ({ params: defaultParams(adjustMaster), place: 'before', enabled: true });

export interface StackSnapshot {
  items: StackItem[];
  selectedId: string | null;
  adjust?: AdjustState;
}
/** Older projects stored one active effect. */
interface LegacySnapshot {
  activeId: string | null;
  values: Record<string, ParamValues>;
  legacyMods?: Record<string, ModMap>;
}
export type EffectSnapshot = StackSnapshot;

interface State extends StackSnapshot {
  past: StackSnapshot[];
  future: StackSnapshot[];
  /** Used to merge rapid edits of the same control (slider drags) into one undo step. */
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: 'apply'; fn: (s: StackSnapshot) => StackSnapshot; key: string | null; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'restore'; snapshot: StackSnapshot | LegacySnapshot };

const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 700;

let n = 0;
export const stackId = () => `s${Date.now().toString(36)}${(n++).toString(36)}`;

export function newItem(effect: EffectDefinition, params?: ParamValues): StackItem {
  return { id: stackId(), effectId: effect.id, enabled: true, params: { ...defaultParams(effect), ...(params ?? {}) }, mix: 100, blend: 'source-over', mods: {} };
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'apply': {
      const next = a.fn(s);
      if (next === s || (next.items === s.items && next.selectedId === s.selectedId && next.adjust === s.adjust)) return s;
      const merge = a.key !== null && a.key === s.lastKey && a.at - s.lastAt < MERGE_WINDOW_MS;
      const onlySelection = next.items === s.items && next.adjust === s.adjust;
      return {
        ...s,
        items: next.items,
        selectedId: next.selectedId,
        adjust: next.adjust ?? s.adjust,
        past: merge || onlySelection ? s.past : [...s.past, { items: s.items, selectedId: s.selectedId, adjust: s.adjust }].slice(-HISTORY_LIMIT),
        future: onlySelection ? s.future : [],
        lastKey: a.key,
        lastAt: a.at,
      };
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { ...s, ...prev, adjust: prev.adjust ?? s.adjust, past: s.past.slice(0, -1), future: [{ items: s.items, selectedId: s.selectedId, adjust: s.adjust }, ...s.future], lastKey: null };
    }
    case 'redo': {
      const next = s.future[0];
      if (!next) return s;
      return { ...s, ...next, past: [...s.past, { items: s.items, selectedId: s.selectedId }], future: s.future.slice(1), lastKey: null };
    }
    case 'restore':
      return { ...migrate(a.snapshot), past: [], future: [], lastKey: null, lastAt: 0 };
  }
}

/** Accepts current snapshots and pre-stack projects (one active effect). */
function migrate(snap: StackSnapshot | LegacySnapshot): StackSnapshot {
  if ('items' in snap && Array.isArray(snap.items)) {
    const items = snap.items
      .map((i) => {
        const eff = getEffect(i.effectId);
        return eff ? { ...newItem(eff), ...i, params: { ...defaultParams(eff), ...i.params } } : null;
      })
      .filter(Boolean) as StackItem[];
    const adjust = snap.adjust ? { ...freshAdjust(), ...snap.adjust, params: { ...defaultParams(adjustMaster), ...snap.adjust.params } } : freshAdjust();
    return { items, selectedId: items.some((i) => i.id === snap.selectedId) ? snap.selectedId : items[0]?.id ?? null, adjust };
  }
  const legacy = snap as LegacySnapshot;
  const eff = legacy.activeId ? getEffect(legacy.activeId) : undefined;
  if (!eff) return { items: [], selectedId: null, adjust: freshAdjust() };
  const item = { ...newItem(eff, legacy.values?.[eff.id]), mods: legacy.legacyMods?.[eff.id] ?? {} };
  return { items: [item], selectedId: item.id, adjust: freshAdjust() };
}

/** The current chain as renderer layers, with audio links applied. */
export function layersOf(items: StackItem[], bands?: AudioBands): RenderLayer[] {
  const out: RenderLayer[] = [];
  for (const i of items) {
    if (!i.enabled) continue;
    const effect = getEffect(i.effectId);
    if (!effect) continue;
    out.push({ effect, params: bands ? modulateParams(effect, i.params, i.mods, bands) : i.params, mix: i.mix, blend: i.blend, scope: i.scope });
  }
  return out;
}

/** Non-destructive effect stack with undo/redo. */
export function useEffectState() {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({ items: [], selectedId: null, adjust: freshAdjust(), past: [], future: [], lastKey: null, lastAt: 0 }));
  const selected = state.items.find((i) => i.id === state.selectedId) ?? null;
  const effect = selected ? getEffect(selected.effectId) ?? null : null;
  const params = useMemo(() => selected?.params ?? {}, [selected]);
  const snapshot = useMemo<EffectSnapshot>(() => ({ items: state.items, selectedId: state.selectedId, adjust: state.adjust }), [state.items, state.selectedId, state.adjust]);
  const adjust = state.adjust ?? freshAdjust();
  /** The Adjust tab as a step, placed before or after the stack. Null when it does nothing. */
  const withAdjust = useCallback((items: StackItem[]) => {
    if (!adjust.enabled || adjustIsNeutral(adjust.params)) return items;
    const step: StackItem = { id: 'adjust', effectId: 'adjMaster', enabled: true, params: adjust.params, mix: 100, blend: 'source-over', mods: {} };
    return adjust.place === 'before' ? [step, ...items] : [...items, step];
  }, [adjust]);

  const apply = useCallback((fn: (s: StackSnapshot) => StackSnapshot, key: string | null = null) => {
    dispatch({ type: 'apply', fn, key, at: performance.now() });
  }, []);

  const patchSelected = useCallback(
    (patch: (i: StackItem) => StackItem, key: string | null) =>
      apply((s) => ({ ...s, items: s.items.map((i) => (i.id === s.selectedId ? patch(i) : i)) }), key),
    [apply],
  );

  return {
    items: state.items,
    selectedId: state.selectedId,
    selected,
    effect,
    params,
    mods: selected?.mods,
    snapshot,
    adjust,
    withAdjust,
    /** Change the Adjust tab. A key merges a slider drag into one undo step. */
    setAdjust: useCallback((patch: Partial<AdjustState>, key: string | null = null) => apply((s) => ({ ...s, adjust: { ...(s.adjust ?? freshAdjust()), ...patch } }), key), [apply]),
    resetAdjust: useCallback(() => apply((s) => ({ ...s, adjust: { ...freshAdjust(), place: s.adjust?.place ?? 'before' } })), [apply]),
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,

    /** Library click: try this effect in the selected slot (or start the stack). */
    select: useCallback(
      (id: string | null) =>
        apply((s) => {
          if (!id) return { ...s, items: s.items.filter((i) => i.id !== s.selectedId), selectedId: null };
          const eff = getEffect(id);
          if (!eff) return s;
          const sel = s.items.find((i) => i.id === s.selectedId);
          if (sel?.effectId === id) return s;
          const item = newItem(eff);
          if (!sel) return { items: [...s.items, item], selectedId: item.id };
          return { items: s.items.map((i) => (i.id === sel.id ? item : i)), selectedId: item.id };
        }),
      [apply],
    ),
    /** Add a new step at the end of the stack. */
    add: useCallback(
      (id: string, params?: ParamValues) =>
        apply((s) => {
          const eff = getEffect(id);
          if (!eff) return s;
          const item = newItem(eff, params);
          return { items: [...s.items, item], selectedId: item.id };
        }),
      [apply],
    ),
    selectItem: useCallback((id: string) => apply((s) => ({ ...s, selectedId: id })), [apply]),
    setParam: useCallback(
      (key: string, value: ParamValue) => patchSelected((i) => (i.params[key] === value ? i : { ...i, params: { ...i.params, [key]: value } }), `p:${key}`),
      [patchSelected],
    ),
    /** Apply several values at once (a preset). */
    setParams: useCallback((values: ParamValues) => patchSelected((i) => ({ ...i, params: { ...i.params, ...values } }), null), [patchSelected]),
    setMod: useCallback(
      (key: string, mod: AudioMod | null) =>
        patchSelected((i) => {
          const mods: ModMap = { ...i.mods };
          if (mod) mods[key] = mod;
          else delete mods[key];
          return { ...i, mods };
        }, `m:${key}`),
      [patchSelected],
    ),
    setMods: useCallback((mods: ModMap) => patchSelected((i) => ({ ...i, mods }), null), [patchSelected]),
    resetEffect: useCallback(
      () =>
        patchSelected((i) => {
          const eff = getEffect(i.effectId);
          return eff ? { ...i, params: defaultParams(eff), mix: 100, blend: 'source-over' } : i;
        }, null),
      [patchSelected],
    ),
    updateItem: useCallback(
      (id: string, patch: Partial<StackItem>, key: string | null = null) =>
        apply((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }), key),
      [apply],
    ),
    removeItem: useCallback(
      (id: string) =>
        apply((s) => {
          const idx = s.items.findIndex((i) => i.id === id);
          const items = s.items.filter((i) => i.id !== id);
          const selectedId = s.selectedId === id ? items[Math.min(idx, items.length - 1)]?.id ?? null : s.selectedId;
          return { items, selectedId };
        }),
      [apply],
    ),
    duplicateItem: useCallback(
      (id: string) =>
        apply((s) => {
          const idx = s.items.findIndex((i) => i.id === id);
          if (idx < 0) return s;
          const copy = { ...structuredClone(s.items[idx]), id: stackId() };
          const items = [...s.items];
          items.splice(idx + 1, 0, copy);
          return { items, selectedId: copy.id };
        }),
      [apply],
    ),
    moveItem: useCallback(
      (from: number, to: number) =>
        apply((s) => {
          if (from === to || to < 0 || to >= s.items.length) return s;
          const items = [...s.items];
          const [it] = items.splice(from, 1);
          items.splice(to, 0, it);
          return { ...s, items };
        }),
      [apply],
    ),
    resetItem: useCallback(
      (id: string) =>
        apply((s) => ({
          ...s,
          items: s.items.map((i) => {
            const eff = i.id === id ? getEffect(i.effectId) : undefined;
            return eff ? { ...i, params: defaultParams(eff), mix: 100, blend: 'source-over' as GlobalCompositeOperation, enabled: true } : i;
          }),
        })),
      [apply],
    ),
    clearStack: useCallback(() => apply((s) => ({ ...s, items: [], selectedId: null })), [apply]),
    /** Replace the whole stack (loading a saved stack). */
    loadStack: useCallback(
      (items: StackItem[], selectIndex = 0) => apply((s) => {
        const m = migrate({ items: items.map((i) => ({ ...i, id: stackId() })), selectedId: null });
        return { ...s, items: m.items, selectedId: (m.items[selectIndex] ?? m.items[0])?.id ?? null };
      }),
      [apply],
    ),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    restore: useCallback((snapshot: StackSnapshot) => dispatch({ type: 'restore', snapshot }), []),
  };
}

export type EffectStackApi = ReturnType<typeof useEffectState>;
