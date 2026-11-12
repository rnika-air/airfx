import { audioBus, SILENCE } from '../engine/audio';
import { OfflineBands, decodeAudio, encodeFrames, fitAudio, type CodecChoice, type ExportProgress } from '../export/offline';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { CompPlayer } from './compositor';
import type { Composition } from './model';

export interface CompExportOptions {
  comp: Composition;
  /** output size = composition size × scale */
  scale: number;
  fps: number;
  bitrate: number;
  choice: CodecChoice;
  audioBitrate: number;
  songUrl: string | null;
  soundtrack: 'song' | 'none';
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}

/** PNG of one composition frame at full (or scaled) resolution. */
export async function exportCompFrame(comp: Composition, time: number, scale = 1): Promise<Blob> {
  const player = new CompPlayer();
  const c = createCanvas(Math.round(comp.width * scale), Math.round(comp.height * scale));
  try {
    await player.prepare(comp, time);
    player.render(get2d(c), comp, time, scale);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode PNG.'))), 'image/png'));
  } finally {
    player.dispose();
    c.width = c.height = 1;
  }
}

/** Every frame is rendered in order, with video layers seeked to it. See export/offline.ts. */
export async function exportComposition(o: CompExportOptions): Promise<Blob> {
  const W = Math.round((o.comp.width * o.scale) / 2) * 2, H = Math.round((o.comp.height * o.scale) / 2) * 2;
  const scale = W / o.comp.width;
  const player = new CompPlayer();
  try {
    const song = o.songUrl ? await decodeAudio(o.songUrl) : null;
    const audio = song && o.soundtrack === 'song' ? await fitAudio(song, o.comp.duration, false) : null;
    const bands = song ? new OfflineBands(song) : null;
    audioBus.offline = SILENCE;
    return await encodeFrames({
      width: W, height: H, fps: o.fps, bitrate: o.bitrate, choice: o.choice, duration: o.comp.duration, audioBitrate: o.audioBitrate,
      audio, keepAlpha: false, signal: o.signal, onProgress: o.onProgress, decoder: 'Timeline',
      draw: async (_i, t, canvas, dt) => {
        await player.prepare(o.comp, t);
        const ctx = get2d(canvas);
        ctx.clearRect(0, 0, W, H);
        const sound = bands ? bands.frame(t, dt) : SILENCE;
        audioBus.offline = sound;
        player.render(ctx, o.comp, t, scale, sound.bands);
      },
    });
  } finally {
    player.dispose();
  }
}
