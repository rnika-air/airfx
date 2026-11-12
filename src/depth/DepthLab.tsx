import { useEffect, useRef, useState } from 'react';
import { ai } from '../ai/client';
import { MODELS, type ModelKey } from '../ai/models';
import { ModelCard, useModels } from '../components/Workspaces';
import { depthColor } from '../effects/airDepth';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { downloadBlob } from '../utils/exportUtils';
import { FIXTURES } from './fixtures';
import { focusPreview, mapSignature, matchBaseline, measureFocus, reportMarkdown, runFixture, type Baseline, type LabResult } from './lab';
import { SAMPLES, sampleFixture } from './samples';

/** Paints once per result. Repainting on every update would block the page. */
function Paint({ result, kind }: { result: LabResult; kind: 'image' | 'gray' | 'color' | 'overlay' | 'focus' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (kind === 'image') paintImage(result)(ref.current);
    else if (kind === 'focus') { const f = SAMPLES.find((s) => s.id === result.id); if (f) { const im = focusPreview(result.image, result.raw, sampleFixture(f)); ref.current.width = im.width; ref.current.height = im.height; get2d(ref.current).putImageData(im, 0, 0); } }
    else if (kind === 'overlay') paintOverlay(result, ref.current);
    else paintMap(result, kind === 'color')(ref.current);
  }, [result, kind]);
  return <canvas ref={ref} className="labcard__img" />;
}

const paintImage = (r: LabResult) => (c: HTMLCanvasElement) => { c.width = r.image.width; c.height = r.image.height; get2d(c).putImageData(r.image, 0, 0); };
const paintMap = (r: LabResult, color: boolean) => (c: HTMLCanvasElement) => {
  c.width = r.map.w; c.height = r.map.h;
  const g = get2d(c), im = g.createImageData(r.map.w, r.map.h);
  for (let i = 0; i < r.map.data.length; i++) {
    const [a, b, d] = color ? depthColor(r.map.data[i]) : [r.map.data[i] * 255, r.map.data[i] * 255, r.map.data[i] * 255];
    im.data[i * 4] = a; im.data[i * 4 + 1] = b; im.data[i * 4 + 2] = d; im.data[i * 4 + 3] = 255;
  }
  g.putImageData(im, 0, 0);
};

/** The image under the map: warm is near, cool is far. */
function paintOverlay(r: LabResult, c: HTMLCanvasElement) {
  c.width = r.map.w; c.height = r.map.h;
  const out = new ImageData(r.map.w, r.map.h);
  for (let i = 0; i < r.map.data.length; i++) {
    const [a, b, d] = depthColor(r.map.data[i]), k = i * 4;
    out.data[k] = r.image.data[k] * 0.45 + a * 0.55; out.data[k + 1] = r.image.data[k + 1] * 0.45 + b * 0.55; out.data[k + 2] = r.image.data[k + 2] * 0.45 + d * 0.55; out.data[k + 3] = 255;
  }
  get2d(c).putImageData(out, 0, 0);
}

function saveMap(r: LabResult, color: boolean) {
  const c = createCanvas(1, 1);
  paintMap(r, color)(c);
  c.toBlob((b) => b && downloadBlob(b, `depthlab_${r.id}_${color ? 'color' : 'gray'}_${r.inputSize}.png`), 'image/png');
}

/** Runs every test scene through the same path the app uses, and reports what it measures. */
export function DepthLab({ onOpenSample }: { onOpenSample: (id: string) => void }) {
  useModels();
  const [samples, setSamples] = useState<(LabResult & { match: number | null })[]>([]);
  const [model, setModel] = useState<ModelKey>('depth');
  const [inputSize, setInputSize] = useState(518);
  const [rows, setRows] = useState<LabResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);
  const ready = ai.state(model).status === 'ready';
  const run = async () => {
    setError(null);
    setRows([]);
    stop.current = false;
    try {
      for (const f of FIXTURES) {
        if (stop.current) break;
        setBusy(f.title);
        const r = await runFixture(f, { model, inputSize }, measureFocus);
        setRows((p) => [...p, r]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  /** The sample project: real maps every time, compared with the stored baseline. */
  const runSamples = async () => {
    setError(null);
    setSamples([]);
    stop.current = false;
    try {
      const base: Baseline | null = await fetch('/samples/baseline.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      for (const s of SAMPLES) {
        if (stop.current) break;
        setBusy(s.title);
        const r = await runFixture(sampleFixture(s), { model, inputSize }, measureFocus);
        const stored = base && base.model === model && base.inputSize === inputSize ? base.maps[s.id] : undefined;
        setSamples((p) => [...p, { ...r, match: stored ? matchBaseline(r.map, stored) : null }]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const saveBaseline = () => {
    const maps = Object.fromEntries(samples.map((s) => [s.id, mapSignature(s.map)]));
    downloadBlob(new Blob([JSON.stringify({ model, inputSize, maps } satisfies Baseline)], { type: 'application/json' }), 'baseline.json');
  };
  const report = () => downloadBlob(new Blob([reportMarkdown(rows, FIXTURES, (k) => MODELS[k as ModelKey]?.label ?? k)], { type: 'text/markdown' }), 'airfx_depth_report.md');
  const passed = rows.filter((r) => r.passed).length;
  return (
    <>
      <aside className="sidebar sidebar--left" aria-label="Depth Test Lab">
        <div className="panel-head"><div><span className="label label--dim">Workspace</span><h2 className="panel-title">Depth Test Lab</h2></div></div>
        <div className="sidebar__scroll">
          <p className="small muted">Runs one model over seven kinds of scene and measures the result. Six photos are fetched from public sample sets when you press Run. Nothing of yours is sent anywhere.</p>
          <fieldset className="group">
            <legend className="group__title">Test Settings</legend>
            <select className="select" value={model} aria-label="Depth model" disabled={!!busy} onChange={(e) => setModel(e.target.value as ModelKey)}>
              <option value="depth">V2 Small · recommended</option>
              <option value="depthLite">V2 Small · lite</option>
              <option value="depthV1">V1 Small · comparison</option>
            </select>
            <ModelCard model={model} />
            <div className="ctl__row"><span className="label">Input</span>
              <select className="select select--compact" value={inputSize} aria-label="Test input resolution" disabled={!!busy} onChange={(e) => setInputSize(Number(e.target.value))}>
                {[392, 518, 770, 1022].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {busy ? <button className="btn btn--sm btn--block" onClick={() => { stop.current = true; }}>Stop · {busy}</button> : <button className="btn btn--sm btn--block btn--accent" disabled={!ready} onClick={run}>Run All Tests</button>}
            <button className="btn btn--sm btn--block" disabled={!rows.length} onClick={report}>Save Report</button>
            <button className="btn btn--sm btn--block" disabled={!ready || !!busy} onClick={runSamples}>Run Sample Project</button>
            <button className="btn btn--sm btn--block" disabled={!samples.length} onClick={saveBaseline} title="After an intended model change, save this to public/samples/baseline.json">Save New Baseline</button>
            {error && <p className="small error">{error}</p>}
          </fieldset>
          {rows.length > 0 && <p className="small">{passed} of {rows.length} scenes passed.</p>}
          <fieldset className="group">
            <legend className="group__title">What Is Measured</legend>
            <p className="small muted"><strong>Near − Far:</strong> depth of a known near area minus a known far one. <strong>Truth:</strong> rank match to real depth, where the scene has it. <strong>Bits:</strong> depth levels in use. <strong>Edges:</strong> depth steps that sit on a visible edge. <strong>Focus:</strong> how much sharper the near area stays than the far one.</p>
          </fieldset>
        </div>
      </aside>
      <main className="lab">
        {!rows.length && !samples.length && !busy && <div className="lab__empty"><p className="label">Load a model, then press Run All Tests or Run Sample Project.</p></div>}
        {samples.map((r) => (
          <article key={r.id} className={`labcard labcard--wide ${r.passed && (r.match === null || r.match >= 0.97) ? '' : 'labcard--fail'}`} data-sample={r.id}>
            <header className="labcard__head"><strong>{r.title}</strong><span className={r.match !== null && r.match < 0.97 ? 'warn small' : 'ok small'}>{r.match === null ? 'No baseline for these settings' : `Baseline match ${r.match.toFixed(3)}`}</span></header>
            <div className="labcard__row labcard__row--4">
              <figure><Paint result={r} kind="image" /><figcaption>Original</figcaption></figure>
              <figure><Paint result={r} kind="gray" /><figcaption>Depth Map</figcaption></figure>
              <figure><Paint result={r} kind="overlay" /><figcaption>Depth Overlay</figcaption></figure>
              <figure><Paint result={r} kind="focus" /><figcaption>Focus Effect</figcaption></figure>
            </div>
            <p className="small muted">{SAMPLES.find((s) => s.id === r.id)?.credit}, {SAMPLES.find((s) => s.id === r.id)?.license}. Near − Far {r.separation.toFixed(2)} · focus {r.focusRatio?.toFixed(1)}× · {(r.ms / 1000).toFixed(2)} s</p>
            {r.issues.map((t) => <p key={t} className="small warn">{t}</p>)}
            <button className="btn btn--sm" onClick={() => onOpenSample(r.id)}>Open In Depth Workspace</button>
          </article>
        ))}
        {rows.map((r) => (
          <article key={r.id} className={`labcard ${r.passed ? '' : 'labcard--fail'}`}>
            <header className="labcard__head"><strong>{r.type}</strong><span className={r.passed ? 'ok small' : 'warn small'}>{r.passed ? 'Pass' : 'Check'}</span></header>
            <div className="labcard__row">
              <Paint result={r} kind="image" />
              <Paint result={r} kind="gray" />
              <Paint result={r} kind="color" />
            </div>
            <dl className="labcard__stats">
              <div><dt>Near − Far</dt><dd>{r.separation.toFixed(2)}</dd></div>
              <div><dt>Bits</dt><dd>{r.entropy.toFixed(1)}</dd></div>
              <div><dt>Truth</dt><dd>{r.truthRank === null ? '–' : r.truthRank.toFixed(3)}</dd></div>
              <div><dt>Edges</dt><dd>{Math.round(r.edgeFit * 100)}%</dd></div>
              <div><dt>Focus</dt><dd>{r.focusRatio === null ? '–' : `${r.focusRatio.toFixed(1)}×`}</dd></div>
              <div><dt>Time</dt><dd>{(r.ms / 1000).toFixed(2)} s</dd></div>
            </dl>
            {r.issues.map((t) => <p key={t} className="small warn">{t}</p>)}
            <div className="audio__buttons"><button className="btn btn--sm" onClick={() => saveMap(r, false)}>Gray PNG</button><button className="btn btn--sm" onClick={() => saveMap(r, true)}>Color PNG</button></div>
          </article>
        ))}
      </main>
    </>
  );
}
