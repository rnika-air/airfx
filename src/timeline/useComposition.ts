import { useCallback, useReducer } from 'react';
import { newComposition, type Composition, type Layer } from './model';

interface State {
  comp: Composition;
  past: Composition[];
  future: Composition[];
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: 'apply'; fn: (c: Composition) => Composition; key: string | null; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replace'; comp: Composition };

const LIMIT = 150;
const MERGE_MS = 700;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'replace':
      return { comp: a.comp, past: [], future: [], lastKey: null, lastAt: 0 };
    case 'apply': {
      const next = a.fn(s.comp);
      if (next === s.comp) return s;
      const merge = a.key !== null && a.key === s.lastKey && a.at - s.lastAt < MERGE_MS;
      return {
        comp: next,
        past: merge ? s.past : [...s.past, s.comp].slice(-LIMIT),
        future: [],
        lastKey: a.key,
        lastAt: a.at,
      };
    }
    case 'undo': {
      const prev = s.past[s.past.length - 1];
      if (!prev) return s;
      return { comp: prev, past: s.past.slice(0, -1), future: [s.comp, ...s.future], lastKey: null, lastAt: 0 };
    }
    case 'redo': {
      const next = s.future[0];
      if (!next) return s;
      return { comp: next, past: [...s.past, s.comp], future: s.future.slice(1), lastKey: null, lastAt: 0 };
    }
  }
}

/**
 * Composition state with undo/redo. `key` merges rapid edits of the same
 * thing (a slider drag, a clip drag) into a single undo step.
 */
export function useComposition() {
  const [s, dispatch] = useReducer(reducer, undefined, () => ({ comp: newComposition(), past: [], future: [], lastKey: null, lastAt: 0 }));

  const apply = useCallback((fn: (c: Composition) => Composition, key: string | null = null) => {
    dispatch({ type: 'apply', fn, key, at: performance.now() });
  }, []);

  const updateLayer = useCallback(
    (id: string, fn: (l: Layer) => Layer, key: string | null = null) =>
      apply((c) => ({ ...c, layers: c.layers.map((l) => (l.id === id ? fn(l) : l)) }), key),
    [apply],
  );

  return {
    comp: s.comp,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    apply,
    updateLayer,
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    /** Load a saved composition (clears undo history). */
    replace: useCallback((comp: Composition) => dispatch({ type: 'replace', comp }), []),
  };
}

export type CompositionApi = ReturnType<typeof useComposition>;
