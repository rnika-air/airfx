import { useCallback, useEffect, useState } from 'react';
import type { LoadedMedia } from './useMedia';

export interface VideoState {
  playing: boolean;
  time: number;
  duration: number;
  muted: boolean;
}

/** Mirrors the preview video's playback state into React and exposes controls. */
export function useVideoState(media: LoadedMedia | null) {
  const video = media?.kind === 'video' ? (media.element as HTMLVideoElement) : null;
  const [state, setState] = useState<VideoState>({ playing: false, time: 0, duration: 0, muted: false });

  useEffect(() => {
    if (!video) return;
    const sync = () =>
      setState({ playing: !video.paused, time: video.currentTime, duration: video.duration || 0, muted: video.muted });
    const events = ['play', 'pause', 'timeupdate', 'seeked', 'durationchange', 'volumechange', 'ended'];
    events.forEach((e) => video.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => video.removeEventListener(e, sync));
  }, [video]);

  const toggle = useCallback(() => {
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  }, [video]);

  const seek = useCallback(
    (t: number) => {
      if (video && Number.isFinite(t)) video.currentTime = Math.max(0, Math.min(video.duration || 0, t));
    },
    [video],
  );

  const toggleMute = useCallback(() => {
    if (video) video.muted = !video.muted;
  }, [video]);

  const pause = useCallback(() => video?.pause(), [video]);

  return { video, state, toggle, seek, toggleMute, pause };
}
