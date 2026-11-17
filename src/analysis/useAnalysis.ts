import { useEffect, useState } from 'react';
import type { LoadedMedia } from '../hooks/useMedia';
import { analyseImage, analyseVideo, type MediaAnalysis } from './media';

/** One analysis per media file, kept while it is open. */
const cache = new Map<string, MediaAnalysis>();

export function useMediaAnalysis(media: LoadedMedia | null) {
  const [result, setResult] = useState<{ url: string; a: MediaAnalysis | null; error: string | null }>({ url: '', a: null, error: null });
  useEffect(() => {
    if (!media) return;
    const hit = cache.get(media.url);
    if (hit) { setResult({ url: media.url, a: hit, error: null }); return; }
    const abort = new AbortController();
    setResult({ url: media.url, a: null, error: null });
    // Off the first paint, so opening a file stays quick.
    const t = setTimeout(async () => {
      try {
        const a = media.kind === 'image'
          ? analyseImage(media.element, media.width, media.height)
          : await analyseVideo(media.url, media.duration, media.width, media.height, abort.signal);
        if (abort.signal.aborted) return;
        if (cache.size > 8) cache.clear();
        cache.set(media.url, a);
        setResult({ url: media.url, a, error: null });
      } catch (e) {
        if (!abort.signal.aborted) setResult({ url: media.url, a: null, error: (e as Error).message });
      }
    }, 250);
    return () => { clearTimeout(t); abort.abort(); };
  }, [media]);
  return media && result.url === media.url ? result : { url: '', a: null, error: null };
}
