import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioReactor, AudioState } from '../engine/audio';
import type { LoadedMedia } from './useMedia';
import { useVideoState } from './useVideoState';

export interface TransportState {
  /** Whether a play/pause transport makes sense right now. */
  visible: boolean;
  playing: boolean;
  time: number;
  duration: number;
  muted: boolean;
  /** Mic input keeps the preview live regardless of play state. */
  live: boolean;
}

/**
 * One play/pause/seek clock for everything time-based:
 *  • video media → the video element's clock (song, if any, plays alongside);
 *  • still + song → the song's clock;
 *  • still + animated effect → an internal clock looping every `loopLength` s.
 */
export function useTransport(media: LoadedMedia | null, reactor: AudioReactor, audio: AudioState, animated: boolean, loopLength: number) {
  const video = useVideoState(media);
  const hasSong = audio.kind === 'file' || audio.kind === 'url';
  const isVideo = media?.kind === 'video';
  const clock = useRef({ playing: false, start: 0, offset: 0 });
  const [clockPlaying, setClockPlaying] = useState(false);
  const [, setTick] = useState(0); // forces a re-render so `time` refreshes
  const loopRef = useRef(loopLength);
  loopRef.current = loopLength;

  const clockTime = () => {
    const c = clock.current;
    const t = c.playing ? c.offset + (performance.now() - c.start) / 1000 : c.offset;
    const L = loopRef.current;
    return L > 0 ? t % L : t;
  };

  const getTime = useCallback((): number => {
    if (isVideo && video.video) return video.video.currentTime;
    if (hasSong) return reactor.currentTime;
    return clockTime();
  }, [isVideo, video.video, hasSong, reactor]);

  const playing = isVideo ? video.state.playing : hasSong ? audio.playing : clockPlaying;

  const toggle = useCallback(() => {
    if (isVideo && video.video) {
      if (video.video.paused) {
        video.video.play().catch(() => undefined);
        if (hasSong) reactor.play();
      } else {
        video.video.pause();
        reactor.pause();
      }
      return;
    }
    if (hasSong) {
      if (audio.playing) reactor.pause();
      else reactor.play();
      return;
    }
    if (!media) return;
    const c = clock.current;
    if (c.playing) {
      c.offset = clockTime();
      c.playing = false;
    } else {
      c.start = performance.now();
      c.playing = true;
    }
    setClockPlaying(c.playing);
  }, [isVideo, video.video, hasSong, audio.playing, reactor, media]);

  const pause = useCallback(() => {
    video.video?.pause();
    reactor.pause();
    const c = clock.current;
    if (c.playing) {
      c.offset = clockTime();
      c.playing = false;
      setClockPlaying(false);
    }
  }, [video.video, reactor]);

  const seek = useCallback(
    (t: number) => {
      if (isVideo) video.seek(t);
      if (hasSong) reactor.seek(t);
      if (!isVideo && !hasSong) {
        clock.current.offset = t;
        clock.current.start = performance.now();
      }
      setTick((n) => n + 1);
    },
    [isVideo, hasSong, video, reactor],
  );

  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => {
    const m = !muted;
    setMuted(m);
    // While its sound is being analysed, the element itself must stay unmuted.
    if (video.video && reactor.readsVideo !== video.video) video.video.muted = m;
    reactor.setMuted(m);
  }, [muted, video.video, reactor]);

  // Refresh the displayed time ~10×/s while anything is playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [playing]);

  // Stop the internal clock when media goes away.
  useEffect(() => {
    if (!media) {
      clock.current = { playing: false, start: 0, offset: 0 };
      setClockPlaying(false);
    }
  }, [media]);

  const duration = isVideo ? video.state.duration : hasSong ? audio.duration : loopLength;
  const state: TransportState = {
    visible: !!media && (isVideo || hasSong || audio.kind === 'mic' || animated),
    playing,
    time: getTime(),
    duration,
    muted,
    live: audio.kind === 'mic',
  };

  return { state, toggle, pause, seek, toggleMute, getTime, videoPlaying: isVideo && video.state.playing };
}
