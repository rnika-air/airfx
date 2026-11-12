import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH,
  WebMOutputFormat, canEncodeAudio, canEncodeVideo, type AudioCodec, type InputVideoTrack, type VideoCodec, type WrappedCanvas,
} from 'mediabunny';
import type { AudioBands, StackItem } from '../effects/types';
import { audioBus, SILENCE, type AudioFrame } from '../engine/audio';
import { Envelope } from '../engine/audio';
import { renderClock } from '../engine/clock';
import { FrameRenderer } from '../engine/FrameRenderer';
import { layersOf } from '../hooks/useEffectState';
import { assetStore } from '../engine/assets';
import { parseIds } from '../effects/types';
import { ensureContentReady } from '../content/content';
import { createCanvas } from '../utils/imageProcessing';
import { disposeVideo, loadVideo, seekVideo } from '../utils/videoProcessing';

/**
 * Offline export. Every output frame is rendered, in order, from the frame at
 * its exact timestamp, then handed to the encoder. Nothing plays in real time,
 * so a slow effect makes the export take longer. It cannot drop frames.
 *
 * MediaRecorder (the old path) recorded whatever the canvas showed while the
 * video played on the wall clock, so an effect taking 200 ms gave 5 fps.
 */

export const offlineSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** Yields to the UI. Not throttled in hidden tabs, unlike setTimeout. */
const yieldNow = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

/* ── Codecs ─────────────────────────────────────────────────────── */

export interface CodecChoice { id: string; label: string; codec: VideoCodec; container: 'mp4' | 'webm'; alpha: boolean; audio: AudioCodec }

export const CODECS: CodecChoice[] = [
  { id: 'h264', label: 'MP4 · H.264 (most compatible)', codec: 'avc', container: 'mp4', alpha: false, audio: 'aac' },
  { id: 'hevc', label: 'MP4 · HEVC / H.265', codec: 'hevc', container: 'mp4', alpha: false, audio: 'aac' },
  { id: 'av1', label: 'MP4 · AV1', codec: 'av1', container: 'mp4', alpha: false, audio: 'aac' },
  { id: 'vp9', label: 'WebM · VP9 (keeps transparency)', codec: 'vp9', container: 'webm', alpha: true, audio: 'opus' },
  { id: 'av1w', label: 'WebM · AV1', codec: 'av1', container: 'webm', alpha: false, audio: 'opus' },
];

/** Which codecs this browser can really encode at this size and bitrate. */
export async function usableCodecs(width: number, height: number, bitrate: number) {
  const out: CodecChoice[] = [];
  await Promise.all(CODECS.map(async (c) => {
    try { if (await canEncodeVideo(c.codec, { width, height, bitrate })) out.push(c); } catch { /* unsupported */ }
  }));
  return CODECS.filter((c) => out.includes(c));
}

/* ── Quality ────────────────────────────────────────────────────── */

export type QualityPreset = 'draft' | 'standard' | 'high' | 'maximum' | 'custom';

/** Mbps at 30 fps for each preset, anchored on pixel count. */
const LADDER: [number, Record<Exclude<QualityPreset, 'custom'>, number>][] = [
  [921600, { draft: 3, standard: 5, high: 8, maximum: 14 }],
  [2073600, { draft: 8, standard: 12, high: 16, maximum: 30 }],
  [3686400, { draft: 16, standard: 22, high: 30, maximum: 50 }],
  [8294400, { draft: 35, standard: 45, high: 60, maximum: 100 }],
];

export function presetMbps(preset: Exclude<QualityPreset, 'custom'>, w: number, h: number, fps: number) {
  const px = w * h;
  let v = LADDER[0][1][preset] * (px / LADDER[0][0]);
  for (let i = 1; i < LADDER.length; i++) {
    const [a, A] = LADDER[i - 1], [b, B] = LADDER[i];
    if (px <= b && px >= a) v = A[preset] + (B[preset] - A[preset]) * ((px - a) / (b - a));
  }
  if (px > LADDER[LADDER.length - 1][0]) v = LADDER[LADDER.length - 1][1][preset] * (px / LADDER[LADDER.length - 1][0]);
  // More frames need more bits, but not proportionally.
  return Math.round(v * Math.max(0.8, Math.pow(fps / 30, 0.6)));
}

/* ── Reading the source ─────────────────────────────────────────── */

export interface VideoProbe { width: number; height: number; duration: number; fps: number; codec: string | null; hasAudio: boolean; decodable: boolean }

export async function probeVideo(url: string): Promise<VideoProbe | null> {
  let input: Input | null = null;
  try {
    input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await (await fetch(url)).blob()) });
    const v = await input.getPrimaryVideoTrack();
    if (!v) return null;
    const stats = await v.computePacketStats(240);
    const a = await input.getPrimaryAudioTrack();
    return { width: v.displayWidth, height: v.displayHeight, duration: await input.computeDuration(), fps: stats.averagePacketRate, codec: v.codec, hasAudio: !!a, decodable: await v.canDecode() };
  } catch {
    return null;
  } finally {
    input?.dispose();
  }
}

/** Gives the source frame for a timestamp, for the frames of one export in order. */
export interface FrameSource { at(t: number): Promise<CanvasImageSource>; decoder: string; close(): void }

/**
 * Decodes with WebCodecs. The sink reads timestamps ahead of what it has
 * returned, so it must be given the whole sequence at the start.
 */
async function decodedSource(url: string, times: number[]): Promise<FrameSource | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await (await fetch(url)).blob()) });
  let track: InputVideoTrack | null = null;
  try {
    track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) { input.dispose(); return null; }
  } catch {
    input.dispose();
    return null;
  }
  const sink = new CanvasSink(track, { poolSize: 3 });
  const end = await track.computeDuration(), first = await track.getFirstTimestamp();
  const gen = sink.canvasesAtTimestamps(times.map((t) => Math.min(end - 1e-3, Math.max(first, t))));
  let last: WrappedCanvas | null = null;
  return {
    decoder: 'WebCodecs',
    async at() {
      const r = await gen.next();
      if (r.value) last = r.value;
      if (!last) throw new Error('The source video returned no frame.');
      return last.canvas as CanvasImageSource;
    },
    close() {
      gen.return?.(undefined).catch(() => undefined);
      input.dispose();
    },
  };
}

/** Slower fallback for files WebCodecs cannot read: seek the element to each frame. */
async function seekingSource(url: string): Promise<FrameSource> {
  const v = await loadVideo(url);
  v.loop = false;
  v.muted = true;
  return {
    decoder: 'Video element',
    async at(t) { await seekVideo(v, Math.min(Math.max(0, v.duration - 0.01), t)); return v; },
    close() { disposeVideo(v); },
  };
}

/** `times` is every frame the export will ask for, in order. */
export async function openFrames(url: string, times: number[]): Promise<FrameSource> {
  try {
    const d = await decodedSource(url, times);
    if (d) return d;
  } catch { /* fall through */ }
  return seekingSource(url);
}

/* ── Audio ──────────────────────────────────────────────────────── */

const RATE = 48000;

/** Decoded audio, placed at its real timestamps so it stays in sync with the picture. */
async function decodeAudio(url: string): Promise<AudioBuffer | null> {
  const blob = await (await fetch(url)).blob();
  try {
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
      if (await track.canDecode()) {
        const end = await track.computeDuration();
        const off = new OfflineAudioContext(2, Math.max(1, Math.ceil(end * RATE)), RATE);
        const sink = new AudioBufferSink(track);
        for await (const { buffer, timestamp } of sink.buffers()) {
          const n = off.createBufferSource();
          n.buffer = buffer;
          n.connect(off.destination);
          n.start(Math.max(0, timestamp));
        }
        return await off.startRendering();
      }
    } finally {
      input.dispose();
    }
  } catch { /* try the browser's own decoder */ }
  try {
    return await new OfflineAudioContext(2, 1, RATE).decodeAudioData(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/** Fits a buffer to the export: trims, or loops when `loop` is set. */
async function fitAudio(buffer: AudioBuffer, duration: number, loop: boolean) {
  const off = new OfflineAudioContext(2, Math.max(1, Math.round(duration * RATE)), RATE);
  const n = off.createBufferSource();
  n.buffer = buffer;
  n.loop = loop;
  n.connect(off.destination);
  n.start(0);
  return off.startRendering();
}

/** Audio bands at a moment of a decoded song: the live analyser's response, computed offline. */
export class OfflineBands {
  private env = new Envelope();
  private data: Float32Array;
  private rate: number;
  constructor(buffer: AudioBuffer) {
    const a = buffer.getChannelData(0), b = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : a;
    this.data = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) this.data[i] = (a[i] + b[i]) / 2;
    this.rate = buffer.sampleRate;
  }
  private window = (() => { const N = 2048, w = new Float32Array(N); for (let i = 0; i < N; i++) w[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N); return w; })();
  at(t: number, dt: number): AudioBands {
    return this.frame(t, dt).bands;
  }
  frame(t: number, dt: number): AudioFrame {
    const N = 2048, end = Math.round(t * this.rate), re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) { const j = end - N + i; re[i] = (j >= 0 && j < this.data.length ? this.data[j] : 0) * this.window[i]; }
    fft(re, im);
    const avg = (from: number, to: number) => {
      const bin = this.rate / N, a = Math.max(1, Math.floor(from / bin)), b = Math.min(N / 2 - 1, Math.ceil(to / bin));
      let s = 0;
      for (let i = a; i <= b; i++) s += Math.hypot(re[i], im[i]) / N;
      return s / (b - a + 1);
    };
    const bands = this.env.push(avg(25, 160), avg(160, 2200), avg(2200, 12000), t, dt);
    const spectrum = new Float32Array(N / 2), wave = new Float32Array(N);
    for (let i = 0; i < N / 2; i++) spectrum[i] = Math.min(1, Math.max(0, (20 * Math.log10(Math.hypot(re[i], im[i]) / N + 1e-9) + 90) / 70));
    for (let i = 0; i < N; i++) { const j = end - N + i; wave[i] = j >= 0 && j < this.data.length ? this.data[j] : 0; }
    return { bands, spectrum, wave, binHz: this.rate / N };
  }
}

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2, tr = re[v] * cr - im[v] * ci, ti = re[v] * ci + im[v] * cr;
        re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/* ── The render loop ────────────────────────────────────────────── */

export interface ExportProgress {
  frame: number; total: number; time: number;
  /** Frames rendered per wall-clock second. */
  fps: number;
  etaSeconds: number;
  /** Stage for the status line. */
  stage: string;
  decoder: string;
  encoderConfig?: string;
}

export interface EncodeOptions {
  width: number; height: number; fps: number; bitrate: number;
  choice: CodecChoice;
  /** Seconds. */
  duration: number;
  audioBitrate: number;
  /** Decoded soundtrack, already fitted to `duration`. */
  audio: AudioBuffer | null;
  keepAlpha: boolean;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
  decoder: string;
  /** Draws output frame i into the canvas. */
  draw: (i: number, t: number, canvas: HTMLCanvasElement, dt: number) => Promise<void>;
}

export async function encodeFrames(o: EncodeOptions): Promise<Blob> {
  const w = Math.round(o.width / 2) * 2, h = Math.round(o.height / 2) * 2;
  const total = Math.max(1, Math.round(o.duration * o.fps));
  const target = new BufferTarget();
  const output = new Output({ format: o.choice.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
  const canvas = createCanvas(w, h);
  let encoderConfig = '';
  const video = new CanvasSource(canvas, {
    codec: o.choice.codec,
    bitrate: o.bitrate,
    keyFrameInterval: 2,
    alpha: o.keepAlpha && o.choice.alpha ? 'keep' : 'discard',
    latencyMode: 'quality',
    bitrateMode: 'variable',
    onEncoderConfig: (c) => { encoderConfig = `${c.codec} · ${c.hardwareAcceleration ?? 'auto'}`; },
  });
  // Frame rate metadata makes players report the exact rate.
  output.addVideoTrack(video, { frameRate: o.fps });
  let audio: AudioBufferSource | null = null;
  if (o.audio && await canEncodeAudio(o.choice.audio, { numberOfChannels: 2, sampleRate: RATE, bitrate: o.audioBitrate })) {
    audio = new AudioBufferSource({ codec: o.choice.audio, bitrate: o.audioBitrate });
    output.addAudioTrack(audio);
  }
  await output.start();
  const started = performance.now();
  try {
    if (audio && o.audio) await audio.add(o.audio);
    audio?.close();
    let lastYield = performance.now();
    for (let i = 0; i < total; i++) {
      if (o.signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / o.fps;
      await o.draw(i, t, canvas, 1 / o.fps);
      await video.add(t, 1 / o.fps);
      const now = performance.now(), rate = (i + 1) / ((now - started) / 1000);
      if (now - lastYield > 80 || i === total - 1) {
        o.onProgress({ frame: i + 1, total, time: t, fps: rate, etaSeconds: (total - i - 1) / Math.max(1e-3, rate), stage: 'Rendering', decoder: o.decoder, encoderConfig });
        await yieldNow();
        lastYield = performance.now();
      }
    }
    video.close();
    o.onProgress({ frame: total, total, time: o.duration, fps: total / ((performance.now() - started) / 1000), etaSeconds: 0, stage: 'Finishing file', decoder: o.decoder, encoderConfig });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => undefined);
    if (/not supported/i.test((e as Error).message)) throw new Error(`This PC's ${o.choice.label.split(' (')[0]} encoder cannot do ${w}×${h} at ${Math.round(o.fps)} fps. Try H.264, a lower frame rate or a lower resolution.`);
    throw e;
  } finally {
    canvas.width = canvas.height = 1;
  }
  return new Blob([target.buffer!], { type: o.choice.container === 'mp4' ? 'video/mp4' : 'video/webm' });
}

export type SoundtrackChoice = 'none' | 'original' | 'song';

export interface OfflineExportOptions {
  source: { kind: 'video'; url: string; duration: number } | { kind: 'image'; element: CanvasImageSource };
  items: StackItem[];
  width: number; height: number; fps: number; bitrate: number;
  choice: CodecChoice;
  duration: number;
  soundtrack: SoundtrackChoice;
  songUrl: string | null;
  audioBitrate: number;
  keepAlpha: boolean;
  signal: AbortSignal;
  onProgress: (p: ExportProgress) => void;
}

/** Video assets that effects read at a moment in time (Key background, displacement maps). */
function timedAssets(items: StackItem[]) {
  const out: HTMLVideoElement[] = [];
  for (const i of items) for (const k of ['bgMedia', 'map']) {
    const a = assetStore.get(parseIds(i.params[k])[0] ?? '');
    if (a?.kind === 'video') out.push(a.el as HTMLVideoElement);
  }
  return out;
}

export async function exportOffline(o: OfflineExportOptions): Promise<Blob> {
  o.onProgress({ frame: 0, total: 0, time: 0, fps: 0, etaSeconds: 0, stage: 'Preparing', decoder: '' });
  const source = o.source;
  const count = Math.max(1, Math.round(o.duration * o.fps));
  const span = source.kind === 'video' ? Math.max(1e-3, source.duration) : 1;
  const frames = source.kind === 'video' ? await openFrames(source.url, Array.from({ length: count }, (_, i) => (i / o.fps) % span)) : null;
  const renderer = new FrameRenderer();
  const items = o.items;
  const assets = timedAssets(items);
  await ensureContentReady(items);
  const hasLinks = items.some((i) => i.enabled && Object.values(i.mods ?? {}).some((m) => m.amount));
  let song: AudioBuffer | null = null, audio: AudioBuffer | null = null;
  try {
    // The picture follows the sound the preview was following: a song, or the clip's own audio.
    const drawsSound = items.some((i) => i.enabled && i.effectId === 'soundViz');
    const fromClip = source.kind === 'video' && !!audioBus.reactor?.readsVideo;
    if (o.songUrl && (o.soundtrack === 'song' || hasLinks || drawsSound)) song = await decodeAudio(o.songUrl);
    else if (fromClip && (hasLinks || drawsSound)) song = await decodeAudio(source.url);
    if (o.soundtrack === 'song' && song) audio = await fitAudio(song, o.duration, false);
    if (o.soundtrack === 'original' && source.kind === 'video') {
      const a = await decodeAudio(source.url);
      if (a) audio = await fitAudio(a, o.duration, o.duration > source.duration + 0.05);
    }
    const bands = song ? new OfflineBands(song) : null;
    renderClock.offline = true;
    audioBus.offline = SILENCE;
    return await encodeFrames({
      width: o.width, height: o.height, fps: o.fps, bitrate: o.bitrate, choice: o.choice, duration: o.duration,
      audioBitrate: o.audioBitrate, audio, keepAlpha: o.keepAlpha, signal: o.signal, onProgress: o.onProgress,
      decoder: frames?.decoder ?? 'Still image',
      draw: async (i, t, canvas, dt) => {
        const st = source.kind === 'video' ? t % span : t;
        const image = frames ? await frames.at(st) : (source as { element: CanvasImageSource }).element;
        await Promise.all(assets.map((v) => seekVideo(v, v.duration ? t % v.duration : 0)));
        const sound = bands ? bands.frame(t, dt) : SILENCE;
        audioBus.offline = sound;
        renderer.render({ source: image, target: canvas, width: canvas.width, height: canvas.height, layers: layersOf(items, sound.bands), time: st, frame: i });
      },
    });
  } finally {
    renderClock.offline = false;
    audioBus.offline = null;
    frames?.close();
    renderer.dispose();
  }
}

export { decodeAudio, fitAudio, QUALITY_HIGH };

/** Reads a finished file back and reports what is actually in it. */
export async function inspectFile(blob: Blob) {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
    if (!v) return null;
    const stats = await v.computePacketStats();
    return {
      width: v.displayWidth, height: v.displayHeight, duration: await input.computeDuration(), codec: v.codec,
      frames: stats.packetCount, fps: stats.averagePacketRate, mbps: (blob.size * 8) / (await input.computeDuration()) / 1e6,
      audio: a ? a.codec : null, mb: blob.size / 1048576,
    };
  } finally {
    input.dispose();
  }
}
