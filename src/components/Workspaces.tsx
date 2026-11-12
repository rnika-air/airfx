import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MODELS, type ModelKey } from '../ai/models';
import { ai, frameData, normalizeDepth, processClip, type EditPlane, type LoadStage, type MapTrack } from '../ai/client';
import { selection, sourceKeyOf } from '../ai/selection';
import { cancelFill } from '../cleanup/engine';
import type { RenderLayer } from '../effects/types';
import type { EffectStackApi } from '../hooks/useEffectState';
import type { LoadedMedia } from '../hooks/useMedia';
import { downloadBlob, exportImage } from '../utils/exportUtils';

export type CanvasTool =
  | { kind: 'none' }
  | { kind: 'pick' }
  | { kind: 'focus' }
  | { kind: 'inspect' }
  | { kind: 'select'; label: 1 | 0; fresh: boolean }
  | { kind: 'box' }
  | { kind: 'selBrush'; value: 1 | 0 }
  | { kind: 'hint'; value: number }
  | { kind: 'cleanBrush'; value: 1 | 0 }
  | { kind: 'clone'; source: [number, number] | null }
  | { kind: 'protect'; value: number }
  | { kind: 'depth'; mode: 'add' | 'set' | 'erase' | 'smooth'; value: number };

export interface WsProps {
  fx: EffectStackApi;
  media: LoadedMedia | null;
  tool: CanvasTool;
  setTool: (t: CanvasTool) => void;
  brush: { size: number; soft: number };
  setBrush: (b: { size: number; soft: number }) => void;
  refresh: () => void;
  time: () => number;
  seek: (t: number) => void;
  /** The chain up to and including this workspace's step. */
  chain: () => RenderLayer[];
  onBack: () => void;
  onOpen: (m: 'cleanup' | 'key' | 'depthlab') => void;
  /** Opens a file as the current media. */
  onFile: (f: File) => void;
  /** Last depth reading from the Inspect tool. */
  reading: { depth: number } | null;
}

const sourceKey = sourceKeyOf;

export function useModels() {
  useSyncExternalStore(ai.subscribe, ai.getVersion);
}

export function useSelection() {
  useSyncExternalStore(selection.subscribe, selection.getVersion);
}

/** A cancellable job with progress, for anything long. */
export function useJob() {
  const [busy, setBusy] = useState<{ f: number; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async (note: string, fn: (signal: AbortSignal, p: (f: number, n?: string) => void) => Promise<unknown>) => {
    abort.current = new AbortController();
    setError(null);
    setBusy({ f: 0, note });
    try {
      await fn(abort.current.signal, (f, n) => setBusy({ f, note: n ?? note }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, setError, run, cancel: () => { abort.current?.abort(); cancelFill(); } };
}

export function JobBar({ job, cancellable = true }: { job: ReturnType<typeof useJob>; cancellable?: boolean }) {
  return (
    <>
      {job.busy && (
        <>
          <div className="progress"><div className="progress__bar" style={{ width: `${Math.max(2, job.busy.f * 100)}%` }} /><span className="progress__txt">{job.busy.note}{job.busy.f > 0 ? ` · ${Math.round(job.busy.f * 100)}%` : ''}</span></div>
          {cancellable && <button className="btn btn--sm btn--block" onClick={job.cancel}>Cancel</button>}
        </>
      )}
      {job.error && <p className="small error">{job.error}</p>}
    </>
  );
}

const STAGE: Record<LoadStage, string> = { worker: 'Starting AI worker', download: 'Downloading', init: 'Loading model', verify: 'Testing model' };
const openManager = () => window.dispatchEvent(new Event('airfx:ai-manager'));

/** Size shown before anything downloads; nothing loads until this is pressed. */
export function ModelCard({ model, compact }: { model: ModelKey; compact?: boolean }) {
  useModels();
  const m = MODELS[model], s = ai.state(model), cached = ai.cached.has(model);
  const useGpu = !!(navigator as unknown as { gpu?: unknown }).gpu && !m.cpuOnly && !ai.cpuOnly;
  const mb = useGpu ? m.webgpu.mb : m.wasm.mb;
  const f = s.status === 'loading' && s.total ? s.loaded / s.total : 0;
  return (
    <div className="model" data-model={model} data-state={s.status}>
      <div className="model__row"><strong>{m.label}</strong><span className="muted small">{m.license}</span></div>
      {!compact && <p className="small muted">{m.note}</p>}
      {s.status === 'idle' && <p className="small muted">{cached ? '○ Downloaded · not loaded' : `○ Not downloaded · about ${mb} MB`}</p>}
      {s.status === 'ready' && (
        <>
          <p className="small ok">● {ai.isBusy(model) ? 'Processing…' : 'Ready'} · {s.device === 'webgpu' ? 'GPU (WebGPU)' : 'CPU (WebAssembly)'}{s.testMs ? ` · passed a test in ${(s.testMs / 1000).toFixed(1)} s` : ''}</p>
          {s.fallback && <p className="small warn">The GPU could not run this model, so it is using the CPU, which is slower. Reason: {s.fallback}</p>}
        </>
      )}
      {s.status === 'loading' && (
        <div className="progress">
          <div className="progress__bar" style={{ width: `${s.stage === 'download' ? Math.max(3, f * 100) : 100}%` }} />
          <span className="progress__txt">{s.stage === 'download' && cached ? 'Reading from cache' : STAGE[s.stage]}{s.stage === 'download' && s.total ? ` ${(s.loaded / 1048576).toFixed(0)} / ${(s.total / 1048576).toFixed(0)} MB` : '…'}</span>
        </div>
      )}
      {s.status === 'error' && (
        <>
          <p className="small error">{s.message}</p>
          {s.detail !== s.message && <details className="small muted"><summary>Details</summary>{s.detail}</details>}
        </>
      )}
      {s.status === 'idle' && <button className="btn btn--sm btn--block btn--accent" onClick={() => ai.load(model).catch(() => undefined)}>{cached ? 'Load Model' : `Download & Load · about ${mb} MB`}</button>}
      {s.status === 'error' && <button className="btn btn--sm btn--block btn--accent" onClick={() => ai.load(model).catch(() => undefined)}>Retry</button>}
      {s.status === 'ready' && !compact && <div className="audio__buttons"><button className="btn btn--sm" disabled={ai.isBusy(model)} onClick={() => ai.reload(model).catch(() => undefined)}>Reload</button><button className="btn btn--sm" onClick={openManager}>AI Status</button></div>}
      {s.status !== 'ready' && !compact && <button className="linkbtn small" onClick={openManager}>AI Status</button>}
      {!compact && s.status === 'idle' && !cached && <p className="small muted">Downloaded once from Hugging Face, then cached in this browser. Your media stays on this computer.</p>}
    </div>
  );
}

/** Runs a loaded model on the current still or the whole clip. */
export function Runner({ model, track, media, smoothing, align, refresh, label, inputSize }: { model: ModelKey; track: MapTrack; media: LoadedMedia | null; smoothing: number; align: boolean; refresh: () => void; label: string; inputSize?: number }) {
  useModels();
  const [busy, setBusy] = useState<number | null>(null);
  const [fps, setFps] = useState(6);
  const [err, setErr] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const ready = ai.state(model).status === 'ready';
  useEffect(() => () => abort.current?.abort(), []);
  if (!media) return <p className="small muted">Import media first.</p>;

  const still = async () => {
    setBusy(0);
    setErr(null);
    try {
      const map = await ai.infer(model, frameData(media.element, media.width, media.height, 1024), inputSize);
      if (align) normalizeDepth([map]);
      track.setStill(map, sourceKey(media));
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const clip = async () => {
    abort.current = new AbortController();
    setBusy(0);
    setErr(null);
    try {
      await processClip({ url: media.url, key: model, track, sourceKey: sourceKey(media), fps, maxEdge: 640, smoothing, align, inputSize, signal: abort.current.signal, onProgress: setBusy });
      refresh();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ctl">
      <button data-guide={inputSize ? 'generate' : undefined} className="btn btn--sm btn--block" disabled={!ready || busy !== null} onClick={still}>{track.frames.length ? 'Regenerate' : label}{media.kind === 'video' ? ' This Frame' : ''}</button>
      {media.kind === 'video' && (
        <>
          <div className="ctl__row"><span className="label">Clip Rate</span>
            <select className="select select--compact" value={fps} onChange={(e) => setFps(Number(e.target.value))} aria-label="Frames analysed per second">
              {[2, 4, 6, 8, 12, 24].map((n) => <option key={n} value={n}>{n} per second</option>)}
            </select>
          </div>
          <button className="btn btn--sm btn--block" disabled={!ready || busy !== null} onClick={clip}>Process Whole Clip</button>
        </>
      )}
      {busy !== null && (
        <>
          <div className="progress"><div className="progress__bar" style={{ width: `${busy * 100}%` }} /><span className="progress__txt">Processing {Math.round(busy * 100)}%</span></div>
          {media.kind === 'video' && <button className="btn btn--sm btn--block" onClick={() => abort.current?.abort()}>Cancel</button>}
        </>
      )}
      {err && <p className="small error">{err}</p>}
      {track.frames.length > 0 && <p className="small ok">{track.frames.length > 1 ? `${track.frames.length} frames analysed` : 'Map ready'}{track.kind === 'file' ? ' (loaded file)' : ''}</p>}
    </div>
  );
}

export function Brush({ brush, setBrush, plane, refresh }: { brush: WsProps['brush']; setBrush: WsProps['setBrush']; plane: EditPlane | null; refresh: () => void }) {
  return (
    <>
      <div className="ctl">
        <div className="ctl__row"><span className="label">Brush Size</span><span className="ctl__num">{Math.round(brush.size * 100)}%</span></div>
        <input type="range" className="slider" aria-label="Brush size" min={0.005} max={0.3} step={0.005} value={brush.size} style={{ ['--pct' as string]: `${(brush.size / 0.3) * 100}%` }} onChange={(e) => setBrush({ ...brush, size: Number(e.target.value) })} />
      </div>
      <div className="ctl">
        <div className="ctl__row"><span className="label">Softness</span><span className="ctl__num">{Math.round(brush.soft * 100)}%</span></div>
        <input type="range" className="slider" aria-label="Brush softness" min={0} max={1} step={0.01} value={brush.soft} style={{ ['--pct' as string]: `${brush.soft * 100}%` }} onChange={(e) => setBrush({ ...brush, soft: Number(e.target.value) })} />
      </div>
      {plane && (
        <div className="audio__buttons">
          <button className="btn btn--sm" onClick={() => { plane.undo(); refresh(); }}>Undo Paint</button>
          <button className="btn btn--sm" onClick={() => { plane.redo(); refresh(); }}>Redo</button>
          <button className="btn btn--sm" onClick={() => { plane.clear(); refresh(); }}>Clear</button>
        </div>
      )}
    </>
  );
}

export const Tool = ({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: string; title?: string }) => (
  <button className={`btn btn--sm ${on ? 'btn--on' : ''}`} onClick={onClick} title={title} aria-pressed={on}>{children}</button>
);

export async function savePng(media: LoadedMedia, layers: RenderLayer[], name: string, time: number) {
  const blob = await exportImage({ source: media.element, layers, width: media.width, height: media.height, format: 'png', quality: 1, matte: '#000', time });
  downloadBlob(blob, name);
}

