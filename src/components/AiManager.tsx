import { useEffect, useState } from 'react';
import { ai, type Diagnostics } from '../ai/client';
import { MODELS, type ModelKey } from '../ai/models';
import { ModelCard, useModels } from './Workspaces';

const WORKER: Record<Diagnostics['worker'], string> = { off: 'Not started', starting: 'Starting', running: 'Running', failed: 'Failed' };

/** Every model, its real state, and what the browser can do. For when something stops working. */
export function AiManager({ onClose }: { onClose: () => void }) {
  useModels();
  const [d, setD] = useState<Diagnostics | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = () => ai.diagnostics().then(setD).catch(() => undefined);
  useEffect(() => { refresh(); ai.refreshCached(); }, []);
  useEffect(() => { refresh(); }, [ai.workerStatus, ai.lastError]);
  const clear = async (k: ModelKey) => { await ai.clearCache(k); setNote(`Removed ${MODELS[k].label} from this browser.`); refresh(); };
  const rows: [string, string, boolean?][] = d ? [
    ['AI Worker', WORKER[d.worker], d.worker !== 'failed'],
    ['Local Server', d.server ? 'Reachable' : 'Not reachable', d.server],
    ['Transformers.js', d.runtime?.transformers || 'Known once the worker starts'],
    ['ONNX Runtime', d.runtime?.ort || 'Known once the worker starts'],
    ['WebGPU', d.webgpuApi ? (d.adapter ? `Available · ${d.adapter}` : 'In this browser, but no usable GPU') : 'Not in this browser', !!d.adapter],
    ['WebAssembly', `${d.simd ? 'SIMD on' : 'No SIMD'} · ${d.threads && d.isolated ? 'threads on' : 'one thread, so CPU models are slower'}`, d.simd],
    ['Browser Storage', d.storageUsedMb != null ? `${Math.round(d.storageUsedMb)} MB used of ${Math.round((d.storageQuotaMb ?? 0) / 1024)} GB` : 'Unknown'],
    ['Model Cache', `${ai.cached.size} of ${Object.keys(MODELS).length} models downloaded`],
  ] : [];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="ai-title">
        <div className="modal__head">
          <h2 id="ai-title" className="panel-title">AI Models</h2>
          <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close (Esc)">×</button>
        </div>
        <label className="ctl ctl--inline"><span className="label">Use CPU Only</span><input type="checkbox" checked={ai.cpuOnly} onChange={(e) => ai.setCpuOnly(e.target.checked)} /></label>
        <p className="small muted">Slower, but avoids GPU driver problems. It applies to the next model you load or reload.</p>
        <div className="modelgrid">
          {(Object.keys(MODELS) as ModelKey[]).map((k) => (
            <div key={k} className="modelgrid__cell">
              <ModelCard model={k} compact />
              {ai.state(k).status === 'ready' && <button className="btn btn--sm btn--block" disabled={ai.isBusy(k)} onClick={() => ai.reload(k).catch(() => undefined)}>Reload Model</button>}
              {ai.cached.has(k) && <button className="btn btn--sm btn--block" disabled={ai.isBusy(k)} onClick={() => clear(k)}>Clear From Cache</button>}
            </div>
          ))}
        </div>
        {note && <p className="small ok">{note}</p>}
        <details className="diag" open={ai.workerStatus === 'failed' || undefined}>
          <summary className="label">AI Diagnostics</summary>
          <dl className="diag__list">
            {rows.map(([k, v, good]) => <div key={k}><dt>{k}</dt><dd className={good === false ? 'error' : undefined}>{v}</dd></div>)}
          </dl>
          <p className="small"><strong>Last error:</strong> <span className={d?.lastError ? 'error' : 'muted'}>{d?.lastError ?? 'None'}</span></p>
          <button className="btn btn--sm" onClick={refresh}>Check Again</button>
        </details>
      </div>
    </div>
  );
}
