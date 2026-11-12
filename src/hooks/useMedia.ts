import { useCallback, useEffect, useRef, useState } from 'react';
import { disposeVideo, loadVideo } from '../utils/videoProcessing';

export type MediaKind = 'image' | 'video';

export interface LoadedMedia {
  kind: MediaKind;
  name: string;
  size: number;
  mime: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  element: HTMLImageElement | HTMLVideoElement;
}

export const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
];
/** Media plus audio (audio files are routed to the Audio panel). */
export const ACCEPT_ATTR =
  '.jpg,.jpeg,.png,.webp,.mp4,.webm,.mov,image/jpeg,image/png,image/webp,video/mp4,video/webm,.mp3,.wav,.ogg,.m4a,.aac,.flac,audio/*';

const EXT_KIND: Record<string, MediaKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
};

function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return ACCEPTED_TYPES.includes(file.type) ? 'image' : null;
  if (file.type.startsWith('video/')) return 'video';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be decoded. Supported: JPG, PNG, WEBP.'));
    img.src = url;
  });
}

/**
 * Owns the imported media: object URL lifecycle, decoding, and cleanup.
 * Everything stays in-browser; files are never uploaded.
 */
export function useMedia() {
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<LoadedMedia | null>(null);
  const loadToken = useRef(0);

  const release = (m: LoadedMedia | null) => {
    if (!m) return;
    if (m.kind === 'video') disposeVideo(m.element as HTMLVideoElement);
    URL.revokeObjectURL(m.url);
  };

  const load = useCallback(async (file: File) => {
    setError(null);
    const kind = detectKind(file);
    if (!kind) {
      setError(`"${file.name}" is not a supported file. Use JPG, PNG, WEBP, MP4 or WEBM.`);
      return;
    }
    const token = ++loadToken.current;
    const url = URL.createObjectURL(file);
    setLoading(true);
    try {
      let next: LoadedMedia;
      if (kind === 'image') {
        const img = await loadImage(url);
        next = {
          kind, name: file.name, size: file.size, mime: file.type, url,
          width: img.naturalWidth, height: img.naturalHeight, duration: 0, element: img,
        };
      } else {
        const v = await loadVideo(url);
        next = {
          kind, name: file.name, size: file.size, mime: file.type, url,
          width: v.videoWidth, height: v.videoHeight, duration: v.duration, element: v,
        };
      }
      if (token !== loadToken.current) {
        release(next); // a newer load superseded this one
        return;
      }
      release(current.current);
      current.current = next;
      setMedia(next);
    } catch (e) {
      URL.revokeObjectURL(url);
      if (token === loadToken.current) setError((e as Error).message);
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    loadToken.current++;
    release(current.current);
    current.current = null;
    setMedia(null);
    setError(null);
  }, []);

  useEffect(() => () => release(current.current), []);

  return { media, loading, error, setError, load, clear };
}
