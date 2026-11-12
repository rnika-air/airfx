import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AudioReactor } from '../engine/audio';

/** One AudioReactor for the app's lifetime, with its state mirrored into React. */
export function useAudio() {
  const ref = useRef<AudioReactor | null>(null);
  if (!ref.current) ref.current = new AudioReactor();
  const reactor = ref.current;
  const state = useSyncExternalStore(
    (cb) => reactor.subscribe(cb),
    () => reactor.state,
  );
  useEffect(() => () => reactor.dispose(), [reactor]);
  return { reactor, state };
}
