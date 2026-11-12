import { useSyncExternalStore } from 'react';
import type { ParamValues, StackItem } from '../effects/types';

/** Presets hold parameters only: never media. */
export interface Preset {
  id: string;
  name: string;
  kind: 'effect' | 'stack' | 'camera';
  effectId?: string;
  params?: ParamValues;
  items?: StackItem[];
  /** Device, resolution and frame rate for AirFx Live. */
  camera?: { deviceId: string; facing: 'user' | 'environment'; width: number; height: number; fps: number };
  savedAt: number;
}

const KEY = 'airfx.presets.v1';

function read(): Preset[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let list = read();
const listeners = new Set<() => void>();

/** Returns an error message if the browser refused to store it. */
function commit(next: Preset[]): string | null {
  list = next;
  listeners.forEach((f) => f());
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    return null;
  } catch {
    return 'Browser storage is full, so this preset will be lost on reload. Export your presets to JSON.';
  }
}

const isPreset = (p: Partial<Preset>) => !!p && typeof p.name === 'string' && (p.kind === 'effect' ? typeof p.effectId === 'string' : p.kind === 'camera' ? typeof p.camera === 'object' : p.kind === 'stack' && Array.isArray(p.items));

export const presets = {
  add: (p: Omit<Preset, 'id' | 'savedAt'>) => commit([{ ...p, id: `p${Date.now().toString(36)}${list.length}`, savedAt: Date.now() }, ...list]),
  rename: (id: string, name: string) => commit(list.map((p) => (p.id === id ? { ...p, name } : p))),
  remove: (id: string) => commit(list.filter((p) => p.id !== id)),
  exportJson: () => JSON.stringify({ app: 'airfx', type: 'presets', version: 1, presets: list }, null, 2),
  /** Returns the number imported; throws on an invalid file. */
  importJson(text: string): number {
    let data: { presets?: Partial<Preset>[] };
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('That file is not valid JSON.');
    }
    const incoming = (data.presets ?? []).filter(isPreset) as Preset[];
    if (!incoming.length) throw new Error('No AirFx presets were found in that file.');
    commit([...incoming.map((p, i) => ({ ...p, id: `p${Date.now().toString(36)}i${i}` })), ...list]);
    return incoming.length;
  },
  /** For account sync: the current list, change notifications, and adding presets that keep their ids. */
  all: () => list,
  subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
  mergeKeepingIds(incoming: Preset[]) {
    const have = new Set(list.map((p) => p.id));
    const add = incoming.filter((p) => isPreset(p) && !have.has(p.id));
    if (add.length) commit([...add, ...list].sort((a, b) => b.savedAt - a.savedAt));
    return add.length;
  },
};

export function usePresets() {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => list);
}
