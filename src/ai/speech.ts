import { ai } from './client';
import { decodeAudio } from '../export/offline';

/**
 * Words for Speech Typography. Four sources:
 *  • Whisper on this machine, from the microphone (nothing leaves the PC);
 *  • Whisper on a file: an uploaded track, the loaded song or the video's sound,
 *    with times, so the words stay in sync in an export;
 *  • the browser's own speech recognition (Chrome sends that audio to Google);
 *  • typed text, which the effect reads from its own parameter.
 */

export interface Word { text: string; t: number }
export type SpeechMode = 'off' | 'mic' | 'browser' | 'file';

type Rec = { start: () => void; stop: () => void; abort: () => void; continuous: boolean; interimResults: boolean; lang: string; onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };

const RATE = 16000;
const split = (s: string) => s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').split(/\s+/).map((w) => w.trim()).filter((w) => w && /[\p{L}\p{N}]/u.test(w));

class Speech {
  mode: SpeechMode = 'off';
  words: Word[] = [];
  partial = '';
  status = '';
  error: string | null = null;
  busy = false;
  version = 0;
  private listeners = new Set<() => void>();
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private rec: Rec | null = null;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private quietFor = 0;
  private sending = false;

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getVersion = () => this.version;
  private bump() { this.version++; this.listeners.forEach((f) => f()); }
  private say(status: string, error: string | null = null) { this.status = status; this.error = error; this.bump(); }

  get browserAvailable() { return typeof window !== 'undefined' && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition); }

  /** Words to show at this moment: everything said so far, or up to `time` for a file. */
  wordsAt(time: number, max = 400) {
    const list = this.mode === 'file' ? this.words.filter((w) => w.t <= time) : this.words;
    const extra = this.partial ? split(this.partial).map((text) => ({ text, t: Infinity })) : [];
    return [...list, ...extra].slice(-max);
  }

  clear() { this.words = []; this.partial = ''; this.bump(); }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.rec?.abort();
    this.rec = null;
    this.pending = []; this.pendingLen = 0;
    if (this.mode === 'mic' || this.mode === 'browser') this.mode = 'off';
    this.partial = '';
    this.say('Stopped.');
  }

  /** Live microphone into Whisper, in short phrases cut at pauses. */
  async startMic() {
    this.stop();
    if (ai.state('asr').status !== 'ready') return this.say('', 'Load the Whisper model first. It runs on this computer.');
    this.say('Waiting for microphone permission…');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return this.say('', 'Microphone access was blocked or no microphone was found.');
    }
    const ctx = new AudioContext({ sampleRate: RATE });
    this.ctx = ctx;
    const src = ctx.createMediaStreamSource(this.stream), node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => this.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(node);
    node.connect(ctx.destination);
    this.mode = 'mic';
    this.say('Listening. Words appear after each phrase.');
  }

  private feed(chunk: Float32Array) {
    let e = 0;
    for (let i = 0; i < chunk.length; i += 4) e += chunk[i] * chunk[i];
    const rms = Math.sqrt(e / (chunk.length / 4)), dur = chunk.length / RATE;
    this.quietFor = rms < 0.012 ? this.quietFor + dur : 0;
    if (this.pendingLen === 0 && rms < 0.012) return; // skip silence between phrases
    this.pending.push(chunk);
    this.pendingLen += chunk.length;
    const secs = this.pendingLen / RATE;
    if ((secs > 1.5 && this.quietFor > 0.45) || secs > 7) this.flush();
  }

  private async flush() {
    if (this.sending || !this.pendingLen) return;
    const all = new Float32Array(this.pendingLen);
    let o = 0;
    for (const c of this.pending) { all.set(c, o); o += c.length; }
    this.pending = []; this.pendingLen = 0;
    this.sending = true;
    this.partial = '…';
    this.bump();
    try {
      const r = await ai.transcribe(all, false);
      const now = performance.now() / 1000;
      this.words.push(...split(r.text).map((text) => ({ text, t: now })));
      if (this.words.length > 2000) this.words.splice(0, this.words.length - 2000);
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.sending = false;
      this.partial = '';
      this.bump();
    }
  }

  /** The browser's recognizer. In Chrome this sends the audio to Google's servers. */
  startBrowser(lang = navigator.language || 'en-US') {
    this.stop();
    const C = (window as unknown as Record<string, new () => Rec>).SpeechRecognition ?? (window as unknown as Record<string, new () => Rec>).webkitSpeechRecognition;
    if (!C) return this.say('', 'This browser has no built-in speech recognition. Use Whisper instead.');
    const rec = new C();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.words.push(...split(r[0].transcript).map((text) => ({ text, t: performance.now() / 1000 })));
        else interim += r[0].transcript;
      }
      this.partial = interim;
      this.bump();
    };
    rec.onerror = (e) => this.say('', e.error === 'not-allowed' ? 'Microphone access was blocked.' : `Speech recognition stopped: ${e.error}.`);
    rec.onend = () => { if (this.mode === 'browser' && this.rec === rec) rec.start(); };
    this.rec = rec;
    this.mode = 'browser';
    rec.start();
    this.say('Listening with the browser recognizer.');
  }

  /** Whole-file transcription with timestamps, so words appear when they are spoken. */
  async transcribeUrl(url: string, name: string) {
    this.stop();
    if (ai.state('asr').status !== 'ready') return this.say('', 'Load the Whisper model first. It runs on this computer.');
    this.busy = true;
    this.say(`Reading the sound of ${name}…`);
    try {
      const buf = await decodeAudio(url);
      if (!buf) throw new Error('This file has no sound the browser can decode.');
      const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * RATE)), RATE), n = off.createBufferSource();
      n.buffer = buf;
      n.connect(off.destination);
      n.start();
      const mono = (await off.startRendering()).getChannelData(0);
      this.say(`Transcribing ${Math.round(buf.duration)} s of audio on this computer…`);
      const r = await ai.transcribe(new Float32Array(mono), true);
      const words: Word[] = [];
      for (const c of r.chunks ?? [{ text: r.text, timestamp: [0, buf.duration] as [number, number | null] }]) {
        const list = split(c.text), a = c.timestamp[0] ?? 0, b = c.timestamp[1] ?? a + list.length * 0.35;
        // Whisper times phrases, not words, so words are spread across their phrase.
        list.forEach((text, i) => words.push({ text, t: a + ((b - a) * i) / Math.max(1, list.length) }));
      }
      this.words = words;
      this.mode = 'file';
      this.say(`${words.length} words from ${name}. They appear in time with playback.`);
    } catch (e) {
      this.say('', (e as Error).message);
    } finally {
      this.busy = false;
      this.bump();
    }
  }
}

export const speech = new Speech();
