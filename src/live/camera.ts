import { BufferTarget, CanvasSource, MediaStreamAudioTrackSource, Mp4OutputFormat, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny';
import { ai, frameData, tracks, type GrayMap } from '../ai/client';
import type { LoadedMedia } from '../hooks/useMedia';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { LIVE_DEPTH_GAP, perfSettings } from '../engine/perf';

export type CameraStatus = 'off' | 'asking' | 'on' | 'paused' | 'denied' | 'missing' | 'error' | 'insecure';

export interface CameraSettings { deviceId: string; facing: 'user' | 'environment'; width: number; height: number; fps: number }

const INSTRUCTIONS: Partial<Record<CameraStatus, string>> = {
  denied: 'Camera access was blocked. Click the camera or lock icon in the address bar, allow the camera for this site, then press Enable Camera again.',
  missing: 'No camera was found. Connect one, then press Enable Camera again.',
  insecure: 'Browsers only allow cameras on secure pages. Open AirFx on localhost or HTTPS.',
};

/**
 * The camera. Nothing here runs until Enable Camera is pressed, and every track
 * is stopped when the camera closes or the workspace is left.
 */
class LiveCamera {
  status: CameraStatus = 'off';
  message = '';
  devices: { id: string; label: string }[] = [];
  media: LoadedMedia | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<() => void>();
  version = 0;
  settings: CameraSettings = { deviceId: '', facing: 'user', width: 1280, height: 720, fps: 30 };

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.listeners.forEach((f) => f()); }
  private set(status: CameraStatus, message = '') { this.status = status; this.message = message || INSTRUCTIONS[status] || ''; this.bump(); }

  /** Device names only appear after permission, which is why this runs after start. */
  async listDevices() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.devices = all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      this.bump();
    } catch { /* the list is optional */ }
  }

  async start(next?: Partial<CameraSettings>) {
    if (next) this.settings = { ...this.settings, ...next };
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return this.set('insecure');
    this.stopTracks();
    this.set('asking');
    const s = this.settings;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(s.deviceId ? { deviceId: { exact: s.deviceId } } : { facingMode: s.facing }), width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: s.fps } },
      });
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      if (!v.videoWidth) await new Promise<void>((r) => { v.onloadedmetadata = () => r(); setTimeout(r, 1500); });
      this.stream = stream;
      this.video = v;
      const track = stream.getVideoTracks()[0], real = track.getSettings();
      this.media = { kind: 'video', name: track.label || 'Camera', size: 0, mime: 'video/stream', url: '', width: v.videoWidth || real.width || s.width, height: v.videoHeight || real.height || s.height, duration: 0, element: v };
      track.addEventListener('ended', () => { if (this.stream === stream) { this.stopTracks(); this.set('error', 'The camera was disconnected.'); } });
      this.set('on');
      this.listDevices();
    } catch (e) {
      const name = (e as Error).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') this.set('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') this.set('missing');
      else if (name === 'NotReadableError') this.set('error', 'Another app is using the camera. Close it, then press Enable Camera again.');
      else this.set('error', (e as Error).message);
    }
  }

  get measured() {
    const t = this.stream?.getVideoTracks()[0]?.getSettings();
    return t ? { width: t.width ?? 0, height: t.height ?? 0, fps: t.frameRate ?? 0 } : null;
  }

  pause() {
    if (this.status === 'on') { this.video?.pause(); this.set('paused'); }
    else if (this.status === 'paused') { this.video?.play().catch(() => undefined); this.set('on'); }
  }

  private stopTracks() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
    this.media = null;
  }

  stop() {
    liveDepth.stop();
    this.stopTracks();
    if (this.status !== 'off') this.set('off');
  }

  get live() { return this.status === 'on' || this.status === 'paused'; }
  get trackStates() { return this.stream?.getTracks().map((t) => t.readyState) ?? []; }
}

export const camera = new LiveCamera();

/**
 * Depth from the camera. It runs beside the picture and never holds a frame up:
 * effects use the newest map they have. Range and curve move slowly, so depth
 * does not pulse with each frame.
 */
class LiveDepth {
  running = false;
  mapsPerSecond = 0;
  private range: { lo: number; hi: number } | null = null;
  private prev: GrayMap | null = null;

  async start() {
    if (this.running || !camera.media) return;
    this.running = true;
    this.range = null;
    this.prev = null;
    let count = 0, t0 = performance.now();
    while (this.running && camera.media) {
      const m = camera.media;
      if (camera.status !== 'on') { await new Promise((r) => setTimeout(r, 120)); continue; }
      const asked = performance.now();
      const map = await ai.infer('depth', frameData(m.element, m.width, m.height, 384), 392).catch(() => null);
      if (!map) break;
      const v = Float32Array.from(map.data).sort(), lo = v[Math.floor(v.length * 0.02)], hi = v[Math.floor(v.length * 0.98)];
      this.range = this.range ? { lo: this.range.lo * 0.85 + lo * 0.15, hi: this.range.hi * 0.85 + hi * 0.15 } : { lo, hi };
      const k = 1 / Math.max(1e-6, this.range.hi - this.range.lo);
      const prev = this.prev?.w === map.w && this.prev.h === map.h ? this.prev.data : null;
      for (let i = 0; i < map.data.length; i++) {
        const n = Math.min(1, Math.max(0, (map.data[i] - this.range.lo) * k));
        map.data[i] = prev ? prev[i] * 0.45 + n * 0.55 : n;
      }
      this.prev = map;
      tracks.depth.setStill(map, 'live');
      count++;
      // Depth changes slowly next to the picture: in Performance and Balanced it leaves the main thread room.
      const gap = LIVE_DEPTH_GAP[perfSettings.mode] - (performance.now() - asked);
      if (gap > 0) await new Promise((r) => setTimeout(r, gap));
      const now = performance.now();
      if (now - t0 > 1000) { this.mapsPerSecond = (count * 1000) / (now - t0); count = 0; t0 = now; camera['bump']?.call(camera); }
    }
    this.running = false;
  }

  stop() {
    this.running = false;
    if (tracks.depth.sourceKey === 'live') tracks.depth.clear();
  }
}

export const liveDepth = new LiveDepth();

/**
 * Records what the preview shows, effects included. Each frame is stamped with
 * its real time, so the file plays at the speed it happened, whatever the camera
 * or the effects could manage. A frame that arrives while the encoder is busy is skipped.
 */
export class LiveRecorder {
  private output!: Output;
  private target = new BufferTarget();
  private source!: CanvasSource;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private t0 = 0;
  private busy = false;
  private failed: Error | null = null;
  private mic: MediaStream | null = null;
  private lastT = -1;
  frames = 0;
  skipped = 0;
  mp4 = true;

  constructor(width: number, height: number, private bitrate: number) {
    this.canvas = createCanvas(width & ~1, height & ~1);
    this.ctx = get2d(this.canvas);
  }

  async start(withMic: boolean) {
    this.mp4 = await canEncodeVideo('avc', { width: this.canvas.width, height: this.canvas.height, bitrate: this.bitrate });
    this.output = new Output({ format: this.mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: this.target });
    this.source = new CanvasSource(this.canvas, { codec: this.mp4 ? 'avc' : 'vp9', bitrate: this.bitrate, keyFrameInterval: 2, latencyMode: 'realtime' });
    this.output.addVideoTrack(this.source);
    if (withMic) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audio = new MediaStreamAudioTrackSource(this.mic.getAudioTracks()[0], { codec: this.mp4 ? 'aac' : 'opus', bitrate: 160000 });
        this.output.addAudioTrack(audio);
      } catch { this.mic = null; }
    }
    await this.output.start();
    this.t0 = performance.now();
  }

  /** Called with the preview canvas after each rendered frame. */
  add(preview: HTMLCanvasElement) {
    if (this.busy || this.failed) { this.skipped++; return; }
    const t = (performance.now() - this.t0) / 1000;
    if (t <= this.lastT) return;
    this.lastT = t;
    this.busy = true;
    this.ctx.drawImage(preview, 0, 0, this.canvas.width, this.canvas.height);
    this.frames++;
    this.source.add(t).catch((e) => { this.failed = e; }).finally(() => { this.busy = false; });
  }

  async stop() {
    this.mic?.getTracks().forEach((t) => t.stop());
    this.source.close();
    await this.output.finalize();
    this.canvas.width = this.canvas.height = 1;
    if (this.failed) throw this.failed;
    return new Blob([this.target.buffer!], { type: this.mp4 ? 'video/mp4' : 'video/webm' });
  }

  async cancel() {
    this.mic?.getTracks().forEach((t) => t.stop());
    await this.output.cancel().catch(() => undefined);
  }
}
