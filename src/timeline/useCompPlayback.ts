import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioReactor, AudioState } from '../engine/audio';

/**
 * Composition clock. Free-running when there's no song; when a song is
 * loaded it follows the song (starting at composition time 0), so edits line
 * up with the music. Loops at the composition's end.
 */
export function useCompPlayback(duration: number, reactor: AudioReactor, audio: AudioState) {
  const [time, setTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef({ start: 0, offset: 0 });
  const timeRef = useRef(0);
  const hasSong = audio.kind === 'file' || audio.kind === 'url';

  const setTime = useCallback(
    (t: number) => {
      const v = Math.max(0, Math.min(duration, t));
      timeRef.current = v;
      clock.current = { start: performance.now(), offset: v };
      if (hasSong) reactor.seek(v);
      setTimeState(v);
    },
    [duration, hasSong, reactor],
  );

  const play = useCallback(() => {
    if (timeRef.current >= duration - 0.01) setTime(0);
    clock.current = { start: performance.now(), offset: timeRef.current };
    if (hasSong) {
      // The composition is the master clock; a shorter song just ends instead of wrapping.
      if (reactor.element) reactor.element.loop = false;
      reactor.seek(timeRef.current);
      reactor.play();
    }
    setPlaying(true);
  }, [duration, hasSong, reactor, setTime]);

  const pause = useCallback(() => {
    reactor.pause();
    if (reactor.element) reactor.element.loop = true;
    setPlaying(false);
  }, [reactor]);

  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      let t: number;
      const el = reactor.element;
      if (hasSong && el && !el.paused && el.currentTime < (el.duration || Infinity) - 0.05) t = el.currentTime;
      else t = clock.current.offset + (performance.now() - clock.current.start) / 1000;
      if (t >= duration) {
        t = 0;
        clock.current = { start: performance.now(), offset: 0 };
        if (hasSong) {
          reactor.seek(0);
          reactor.play();
        }
      }
      timeRef.current = t;
      setTimeState(t);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, duration, hasSong, reactor]);

  // Keep the playhead inside a shortened composition.
  useEffect(() => {
    if (timeRef.current > duration) setTime(duration);
  }, [duration, setTime]);

  return { time, playing, setTime, play, pause, toggle, timeRef };
}
