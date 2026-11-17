import type { AudioBands } from '../types';
import { ZERO_BANDS } from '../types';
import { audioBus } from '../../engine/audio';

/** Choices for "follows": a part of the sound, or nothing. */
export const BANDS: [string, string][] = [['none', 'Nothing'], ['level', 'Loudness'], ['bass', 'Bass'], ['mid', 'Mids'], ['treble', 'Highs'], ['beat', 'Beat'], ['hit', 'Hits']];

/** A steady stand-in rhythm (≈96 bpm), so a sound effect shows what it does before any song is loaded. */
export function idleBands(t: number): AudioBands {
  const beat = (t * 1.6) % 1, hit = (t * 3.2 + 0.5) % 1;
  return { level: 0.45 + 0.25 * Math.sin(t * 1.3), bass: 0.5 + 0.4 * Math.sin(t * 1.9), mid: 0.5 + 0.35 * Math.sin(t * 0.8 + 1), treble: 0.4 + 0.3 * Math.sin(t * 3.7), beat: beat < 0.3 ? 1 - beat / 0.3 : 0, hit: hit < 0.15 ? 1 - hit / 0.15 : 0 };
}

/** The sound at this moment: the export's own analysis, the live analyser, or the stand-in. */
export function soundNow(time: number, idle: boolean): AudioBands {
  if (audioBus.offline) return audioBus.offline.bands;
  const live = audioBus.reactor;
  if (live?.analyser && live.isLive) return live.analyser.sample();
  return idle ? idleBands(time) : ZERO_BANDS;
}

export const sig = (b: AudioBands, k: unknown) => (k === 'none' ? 0 : b[k as keyof AudioBands] ?? 0);
