import { useSyncExternalStore } from 'react';
import { assetStore } from '../engine/assets';

/** Reactive list of everything in the shared asset bin. */
export function useAssets() {
  return useSyncExternalStore(assetStore.subscribe, assetStore.getSnapshot);
}
