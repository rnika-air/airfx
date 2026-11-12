import type { AudioBands } from '../effects/types';
import { ZERO_BANDS } from '../effects/types';

/**
 * Turns an AnalyserNode into smoothed 0..1 band envelopes plus a beat pulse.
 * Envelopes use separate attack/release so hits feel punchy but don't flicker.
 */
/** The shared band response. The live analyser and offline export both feed it, so they match. */
export class Envelope {
  private env: AudioBands = { ...ZERO_BANDS };
  /** Slowly decaying per-band peaks used for automatic normalisation. */
  private peak = { bass: 1e-4, mid: 1e-4, treble: 1e-4, level: 1e-4 };
  private bassAvg = 0;
  private lastBeatAt = -1;
  /** Input gain (sensitivity). */
  gain = 1;
  /** 0 = raw, 1 = very smooth. */
  smoothing = 0.35;

  /** Band levels (linear), the clock in seconds, and the step since the last call. */
  push(bass: number, mid: number, treble: number, t: number, dt: number): AudioBands {
    const raw = { bass, mid, treble, level: bass * 0.5 + mid * 0.35 + treble * 0.15 };
    // Normalise each band to its recent peak (half-life ≈ 4 s) so quiet and
    // loud tracks both use the full 0..1 range; gain then scales the result.
    const decay = Math.pow(0.5, dt / 4);
    const rel = Math.exp(-dt / (0.03 + this.smoothing * 0.4));
    const att = Math.exp(-dt / (0.004 + this.smoothing * 0.04));
    for (const k of ['bass', 'mid', 'treble', 'level'] as const) {
      this.peak[k] = Math.max(raw[k], this.peak[k] * decay, 1e-5);
      const v = Math.min(1, Math.pow(Math.min(1, raw[k] / this.peak[k]) * this.gain, 1.6));
      const prev = this.env[k];
      this.env[k] = v > prev ? v + (prev - v) * att : v + (prev - v) * rel;
    }
    // Beat: bass energy jumps clearly above its running average.
    const b = raw.bass / this.peak.bass;
    this.bassAvg = this.bassAvg * Math.pow(0.5, dt / 0.35) + b * (1 - Math.pow(0.5, dt / 0.35));
    if (b > this.bassAvg * 1.25 + 0.05 && b > 0.35 / this.gain && t - this.lastBeatAt > 0.2) this.lastBeatAt = t;
    this.env.beat = this.lastBeatAt < 0 ? 0 : Math.exp(-(t - this.lastBeatAt) / 0.16);
    return { ...this.env };
  }
}

/** One moment of sound, for effects that draw the signal itself. */
export interface AudioFrame {
  bands: AudioBands;
  /** Magnitude of each frequency bin, 0..1 (-90 dB to -20 dB). */
  spectrum: Float32Array;
  /** The last samples, -1..1. */
  wave: Float32Array;
  /** Width of one spectrum bin. */
  binHz: number;
}

const toUnit = (db: number) => (db <= -90 ? 0 : db >= -20 ? 1 : (db + 90) / 70);
export const SILENCE: AudioFrame = { bands: ZERO_BANDS, spectrum: new Float32Array(1024), wave: new Float32Array(2048), binHz: 23.4375 };

/**
 * Where effects read sound from. The preview reads the live analyser. An
 * export sets `offline` for each frame, so it follows the file, not the speakers.
 */
export const audioBus = {
  reactor: null as AudioReactor | null,
  /** The video on screen, for Use Video Audio. */
  video: null as HTMLVideoElement | null,
  offline: null as AudioFrame | null,
  read(): AudioFrame | null {
    if (this.offline) return this.offline;
    return this.reactor?.analyser?.frame() ?? null;
  },
};

export class BandAnalyser {
  private bins: Float32Array;
  private time: Float32Array;
  private spec: Float32Array;
  private frameAt = -1;
  private held: AudioFrame | null = null;
  private envelope = new Envelope();
  private lastAt = 0;
  private cached: AudioBands = { ...ZERO_BANDS };
  get gain() { return this.envelope.gain; }
  set gain(v: number) { this.envelope.gain = v; }
  get smoothing() { return this.envelope.smoothing; }
  set smoothing(v: number) { this.envelope.smoothing = v; }

  constructor(private analyser: AnalyserNode) {
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    this.bins = new Float32Array(analyser.frequencyBinCount);
    this.spec = new Float32Array(analyser.frequencyBinCount);
    this.time = new Float32Array(analyser.fftSize);
  }

  frame(now = performance.now()): AudioFrame {
    if (this.held && now - this.frameAt < 6) return this.held;
    const bands = this.sample(now);
    this.analyser.getFloatTimeDomainData(this.time);
    for (let i = 0; i < this.bins.length; i++) this.spec[i] = toUnit(this.bins[i]);
    this.frameAt = now;
    this.held = { bands, spectrum: this.spec, wave: this.time, binHz: this.analyser.context.sampleRate / this.analyser.fftSize };
    return this.held;
  }

  /** Mean linear magnitude of the bins between two frequencies. */
  private bandAvg(fromHz: number, toHz: number): number {
    const nyquist = this.analyser.context.sampleRate / 2;
    const n = this.bins.length;
    const a = Math.max(1, Math.floor((fromHz / nyquist) * n));
    const b = Math.min(n - 1, Math.ceil((toHz / nyquist) * n));
    let sum = 0;
    for (let i = a; i <= b; i++) {
      const db = this.bins[i];
      if (db > -140) sum += Math.pow(10, db / 20);
    }
    return sum / (b - a + 1);
  }

  sample(now = performance.now()): AudioBands {
    // Several consumers (renderer, meters) may ask in the same frame.
    if (now - this.lastAt < 6) return this.cached;
    const dt = Math.min(0.1, this.lastAt ? (now - this.lastAt) / 1000 : 0.016);
    this.lastAt = now;
    this.analyser.getFloatFrequencyData(this.bins);
    this.cached = this.envelope.push(this.bandAvg(25, 160), this.bandAvg(160, 2200), this.bandAvg(2200, 12000), now / 1000, dt);
    return this.cached;
  }
}

export type AudioSourceKind = 'file' | 'url' | 'mic' | 'video';

export interface AudioState {
  kind: AudioSourceKind | null;
  name: string;
  duration: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
}

const STREAMING_HOSTS = /(youtube\.com|youtu\.be|spotify\.com|soundcloud\.com|music\.apple\.com|instagram\.com|tiktok\.com|deezer\.com|tidal\.com|bandcamp\.com)/i;

export const AUDIO_ACCEPT = '.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.webm,.opus,audio/*';

/**
 * Owns the live audio used for reactive preview: an <audio> element (file or
 * URL) or the microphone, routed through an AnalyserNode. File/URL audio is
 * also routed to the speakers; the microphone is not (to avoid feedback).
 */
export class AudioReactor {
  private ctx: AudioContext | null = null;
  private el: HTMLAudioElement | null = null;
  private node: AudioNode | null = null;
  private mic: MediaStream | null = null;
  private objectUrl: string | null = null;
  private outGain: GainNode | null = null;
  private muted = false;
  private listeners = new Set<() => void>();
  /** A media element can feed one source node, ever, so it is kept for reuse. */
  private videoNodes = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();
  private videoEl: HTMLVideoElement | null = null;
  private videoEvents: AbortController | null = null;

  constructor() {
    audioBus.reactor = this;
  }
  analyser: BandAnalyser | null = null;
  state: AudioState = { kind: null, name: '', duration: 0, playing: false, loading: false, error: null };
  /** A URL other code can use to replay the same audio (for export). */
  sourceUrl: string | null = null;
  /** Original file details (file sources only) — used by project saving. */
  sourceFile: { size: number; mime: string } | null = null;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private set(patch: Partial<AudioState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  get element() {
    return this.el;
  }
  get currentTime() {
    return this.el?.currentTime ?? 0;
  }
  get isLive() {
    return this.state.kind === 'mic' || this.state.playing;
  }

  private ensureCtx() {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  private teardown() {
    if (this.videoEl) {
      // Its sound still has to reach the speakers.
      const node = this.videoNodes.get(this.videoEl);
      node?.disconnect();
      if (node && this.ctx) node.connect(this.ctx.destination);
      this.videoEl.muted = this.muted;
      this.videoEl = null;
      this.videoEvents?.abort();
      this.videoEvents = null;
      this.outGain?.disconnect();
      this.outGain = null;
      this.analyser = null;
      this.node = null;
      return;
    }
    this.el?.pause();
    if (this.el) {
      this.el.removeAttribute('src');
      this.el.load();
    }
    this.node?.disconnect();
    this.outGain?.disconnect();
    this.outGain = null;
    this.mic?.getTracks().forEach((t) => t.stop());
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.el = null;
    this.node = null;
    this.mic = null;
    this.objectUrl = null;
    this.analyser = null;
    this.sourceUrl = null;
    this.sourceFile = null;
  }

  private async attachElement(url: string, name: string, kind: AudioSourceKind, cors: boolean) {
    const ctx = this.ensureCtx();
    const el = new Audio();
    el.preload = 'auto';
    el.loop = true;
    if (cors) el.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const fail = () => {
        cleanup();
        reject(new Error(
          kind === 'url'
            ? 'Could not load audio from that URL. It must be a direct link to an audio file (mp3/wav/ogg/m4a) on a server that allows cross-origin access.'
            : 'This audio file could not be decoded by your browser.',
        ));
      };
      const cleanup = () => { el.removeEventListener('canplay', ok); el.removeEventListener('error', fail); };
      el.addEventListener('canplay', ok);
      el.addEventListener('error', fail);
      el.src = url;
      el.load();
    });
    const src = ctx.createMediaElementSource(el);
    const an = ctx.createAnalyser();
    // Mute happens after the analyser so a muted preview still reacts.
    const out = ctx.createGain();
    out.gain.value = this.muted ? 0 : 1;
    src.connect(an);
    an.connect(out);
    out.connect(ctx.destination);
    this.outGain = out;
    el.addEventListener('play', () => this.set({ playing: true }));
    el.addEventListener('pause', () => this.set({ playing: false }));
    el.addEventListener('durationchange', () => this.set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }));
    this.el = el;
    this.node = src;
    this.analyser = new BandAnalyser(an);
    this.sourceUrl = url;
    this.set({ kind, name, duration: Number.isFinite(el.duration) ? el.duration : 0, playing: false, loading: false, error: null });
  }

  async loadFile(file: File) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(file.name)) {
      this.set({ error: `"${file.name}" is not an audio file.` });
      return;
    }
    this.teardown();
    this.set({ loading: true, error: null });
    const url = URL.createObjectURL(file);
    this.objectUrl = url;
    try {
      await this.attachElement(url, file.name, 'file', false);
      this.objectUrl = url;
      this.sourceFile = { size: file.size, mime: file.type || 'audio/mpeg' };
    } catch (e) {
      URL.revokeObjectURL(url);
      this.objectUrl = null;
      this.set({ kind: null, loading: false, error: (e as Error).message });
    }
  }

  async loadUrl(raw: string) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) {
      this.set({ error: 'Enter a full http(s) URL to an audio file.' });
      return;
    }
    if (STREAMING_HOSTS.test(url)) {
      this.set({
        error:
          'Streaming links (YouTube, Spotify, SoundCloud, Instagram, TikTok…) can’t be analysed in a browser — they don’t expose a raw audio file. Download the track (one you have rights to) as MP3/WAV and drop it here instead.',
      });
      return;
    }
    this.teardown();
    this.set({ loading: true, error: null });
    try {
      const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Audio URL');
      await this.attachElement(url, name, 'url', true);
    } catch (e) {
      this.set({ kind: null, loading: false, error: (e as Error).message });
    }
  }

  async useMic() {
    this.teardown();
    this.set({ loading: true, error: null });
    try {
      const ctx = this.ensureCtx();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      src.connect(an); // not to speakers
      this.mic = stream;
      this.node = src;
      this.analyser = new BandAnalyser(an);
      this.set({ kind: 'mic', name: 'Microphone', duration: 0, playing: true, loading: false, error: null });
    } catch {
      this.set({ kind: null, loading: false, error: 'Microphone access was denied or is unavailable.' });
    }
  }

  /** Reads the sound of the video on screen. It keeps playing to the speakers. */
  useVideo(video: HTMLVideoElement, name: string) {
    this.teardown();
    const ctx = this.ensureCtx();
    let src = this.videoNodes.get(video);
    if (!src) {
      src = ctx.createMediaElementSource(video);
      this.videoNodes.set(video, src);
    }
    src.disconnect();
    const an = ctx.createAnalyser(), out = ctx.createGain();
    // A muted element gives the analyser silence, so mute after it instead.
    this.muted = this.muted || video.muted;
    video.muted = false;
    out.gain.value = this.muted ? 0 : 1;
    src.connect(an);
    an.connect(out);
    out.connect(ctx.destination);
    this.outGain = out;
    this.videoEl = video;
    this.node = src;
    this.analyser = new BandAnalyser(an);
    const events = (this.videoEvents = new AbortController());
    video.addEventListener('play', () => this.set({ playing: true }), { signal: events.signal });
    video.addEventListener('pause', () => this.set({ playing: false }), { signal: events.signal });
    this.set({ kind: 'video', name, duration: 0, playing: !video.paused, loading: false, error: null });
  }

  get readsVideo() {
    return this.videoEl;
  }

  play() {
    if (!this.el) return;
    this.ensureCtx();
    this.el.play().catch(() => undefined);
  }
  pause() {
    this.el?.pause();
  }
  seek(t: number) {
    if (this.el && Number.isFinite(t)) {
      const d = this.el.duration;
      this.el.currentTime = Number.isFinite(d) && d > 0 ? ((t % d) + d) % d : Math.max(0, t);
    }
  }
  setMuted(m: boolean) {
    this.muted = m;
    if (this.outGain) this.outGain.gain.value = m ? 0 : 1;
  }

  sample(): AudioBands {
    return this.analyser ? this.analyser.sample() : ZERO_BANDS;
  }

  clear() {
    this.teardown();
    this.set({ kind: null, name: '', duration: 0, playing: false, loading: false, error: null });
  }

  clearError() {
    this.set({ error: null });
  }

  dispose() {
    this.teardown();
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
