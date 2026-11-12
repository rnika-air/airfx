/// <reference lib="webworker" />
import { fastMarch, patchFill, type FillOptions, type FillSource } from './inpaint';

/** Classical fills run here so long jobs never freeze the interface. */
self.onmessage = (e: MessageEvent) => {
  const { id, method, rgba, width, height, mask, opts, reference } = e.data as {
    id: number; method: 'march' | 'patch'; rgba: Uint8ClampedArray; width: number; height: number; mask: Uint8Array; opts: FillOptions; reference?: FillSource | null;
  };
  try {
    if (method === 'march') fastMarch(rgba, width, height, mask, opts.patchRadius);
    else patchFill(rgba, width, height, mask, opts, reference, (f) => self.postMessage({ id, type: 'progress', f }));
    (self as unknown as Worker).postMessage({ id, type: 'done', rgba }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: (err as Error).message });
  }
};
