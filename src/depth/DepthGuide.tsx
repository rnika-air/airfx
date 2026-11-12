import { useEffect, useState } from 'react';
import { ai, edits, tracks } from '../ai/client';
import { ModelCard, useModels, type CanvasTool, type WsProps } from '../components/Workspaces';
import { SAMPLES, loadSampleFile } from './samples';

const HIDE_KEY = 'airfx.depthGuide.hide';
export const guideHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return true; } };

interface Props extends WsProps {
  onClose: () => void;
  onImport: () => void;
  onFile: (f: File) => void;
  onExport: () => void;
}

const STEPS = ['Import An Image', 'Choose A Depth Model', 'Generate The Depth Map', 'Read The Grayscale Map', 'Select Your Focus', 'Apply Depth Effects', 'Refine The Map', 'Export'];

/** Which control a step points at. Panels mark these with data-guide. */
const SPOT = ['', 'model', 'generate', 'views', '', '', 'correction', 'exports'];

const press = (name: string) => (document.querySelector(`[data-guide="${name}"]`) as HTMLElement | null)?.click();

function GrayLegend({ inverted }: { inverted: boolean }) {
  const near = inverted ? '#141414' : '#f2f2f2', mid = '#7d7d7d', far = inverted ? '#f2f2f2' : '#141414';
  return (
    <svg viewBox="0 0 240 92" className="guide__art" role="img" aria-label="A person drawn in the shade of near objects, against a background in the shade of far objects">
      <rect width="240" height="92" fill={far} />
      <path d="M0 92 40 58 96 72 150 50 240 74V92Z" fill={mid} />
      <circle cx="120" cy="30" r="15" fill={near} />
      <path d="M92 92c0-26 12-42 28-42s28 16 28 42Z" fill={near} />
      <g fontFamily="monospace" fontSize="9" fill={inverted ? '#000' : '#fff'} stroke={inverted ? '#fff' : '#000'} strokeWidth="2.4" paintOrder="stroke">
        <text x="8" y="14">Far</text><text x="8" y="84">Middle</text><text x="154" y="42">Near (person)</text>
      </g>
    </svg>
  );
}

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="guide__range">
      <span>{label}</span>
      <input type="range" className="slider" aria-label={label} min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      <em>{value.toFixed(step < 1 ? 2 : 0)}</em>
    </label>
  );
}

const LOOKS: [string, string, Record<string, number | string>][] = [
  ['Background Blur', 'Keeps what you focused on sharp and blurs what is behind it.', { view: 'final', fgBlur: 0, bgBlur: 1, blur: 30, displace: 0, glow: 0, bokeh: '0' }],
  ['Foreground Blur', 'Blurs what is in front of the focus, like shooting past a leaf.', { view: 'final', fgBlur: 1, bgBlur: 0, blur: 30, displace: 0, glow: 0, bokeh: '0' }],
  ['Subject Focus', 'A narrow focus band, so only the subject is sharp.', { view: 'final', fgBlur: 1, bgBlur: 1, blur: 34, focusRange: 0.16, falloff: 0.12, displace: 0, glow: 0, bokeh: '0' }],
  ['Depth Of Field', 'A gentle falloff, closer to a real lens.', { view: 'final', fgBlur: 1, bgBlur: 1, blur: 24, focusRange: 0.24, falloff: 0.45, displace: 0, glow: 0, bokeh: '0' }],
  ['Bokeh', 'Bright spots bloom into aperture shapes.', { view: 'final', fgBlur: 1, bgBlur: 1, blur: 44, highlight: 4, bokeh: '6', displace: 0, glow: 0 }],
  ['Depth Displacement', 'Pushes near pixels further than far ones.', { view: 'final', blur: 0, displace: 40, glow: 0, bokeh: '0' }],
  ['Depth Glow', 'Lights up the depth you focused on.', { view: 'final', blur: 0, displace: 0, glow: 0.7, bokeh: '0' }],
];

/**
 * Sits beside the preview, not over it, because every step uses the real
 * controls on the real image. Nothing here is a mock-up of the workspace.
 */
export function DepthGuide(p: Props) {
  useModels();
  const [step, setStep] = useState(0);
  const [look, setLook] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hide, setHide] = useState(guideHidden());
  const { params, setParam, setParams } = p.fx;
  const mapReady = tracks.depth.frames.length > 0 && tracks.depth.sourceKey !== 'live';
  const state = ai.state('depth');

  // Point at the real control for this step.
  useEffect(() => {
    const name = SPOT[step];
    const el = name ? document.querySelector(`[data-guide="${name}"]`) : null;
    el?.classList.add('guide-spot');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return () => el?.classList.remove('guide-spot');
  }, [step, mapReady, state.status]);

  // Each step shows the view it talks about.
  useEffect(() => {
    if (step === 2 && mapReady) p.fx.setParam('view', 'side');
    if (step === 3) p.fx.setParam('view', 'depth');
    if (step === 4) { p.fx.setParam('view', 'overlay'); p.setTool({ kind: 'focus' }); }
    if (step === 6) p.fx.setParam('view', 'final');
    if (step !== 4 && step !== 6 && p.tool.kind !== 'none') p.setTool({ kind: 'none' });
  }, [step, mapReady]);

  const useSample = async (id: string) => {
    setBusy(id);
    try { p.onFile(await loadSampleFile(id)); } finally { setBusy(null); }
  };
  const close = () => { p.setTool({ kind: 'none' }); p.onClose(); };
  const setDontShow = (on: boolean) => { setHide(on); try { localStorage.setItem(HIDE_KEY, on ? '1' : '0'); } catch { /* preference only */ } };
  const tool = (t: CanvasTool) => p.setTool(t);
  const isDepthTool = (mode: string, sign = 0) => p.tool.kind === 'depth' && p.tool.mode === mode && (!sign || Math.sign(p.tool.value) === sign);
  const inverted = params.invertDepth === true;

  const blocked = step === 0 ? (!p.media ? 'Import an image or pick a sample to continue.' : null)
    : step === 1 ? (state.status === 'error' ? 'The model failed. The card above says why. Fix that first, then press Retry.' : state.status !== 'ready' ? 'Load the model to continue.' : null)
    : step === 2 ? (!mapReady ? 'Generate the map to continue.' : null) : null;

  return (
    <aside className="guide" aria-label="Depth Map Guide" data-guide-step={step + 1}>
      <header className="guide__head">
        <div><span className="label label--dim">Depth Map Guide · Step {step + 1} of {STEPS.length}</span><h2 className="panel-title">{STEPS[step]}</h2></div>
        <button className="btn btn--icon btn--sm" aria-label="Close Depth Map Guide" onClick={close}>×</button>
      </header>
      <div className="guide__bar" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
        {STEPS.map((s, i) => <button key={s} className={i < step ? 'done' : i === step ? 'on' : ''} title={s} aria-label={`Go to step ${i + 1}: ${s}`} disabled={i > step} onClick={() => setStep(i)} />)}
      </div>
      <div className="guide__body">
        {step === 0 && (
          <>
            <p>Import an image that contains objects at different distances. Portraits, architecture, and landscape images are good starting points.</p>
            <button className="btn btn--sm btn--block btn--accent" onClick={p.onImport}>Import Image</button>
            <p className="small muted">Or learn on a sample:</p>
            <div className="guide__samples">
              {SAMPLES.map((s) => <button key={s.id} className="guide__sample" disabled={!!busy} onClick={() => useSample(s.id)} title={s.credit}><img src={s.url} alt="" /><span>{busy === s.id ? 'Loading…' : s.type}</span></button>)}
            </div>
            {p.media && <p className="small ok">Loaded: {p.media.name}</p>}
          </>
        )}
        {step === 1 && (
          <>
            <p>Depth Anything estimates the relative distance of objects in your image. It creates a grayscale map that AirFx uses to understand foreground, middle ground, and background.</p>
            <ModelCard model="depth" compact />
          </>
        )}
        {step === 2 && (
          <>
            <p>AirFx analyzes your image and generates a grayscale depth map. This process may take a few seconds depending on your hardware.</p>
            <button className="btn btn--sm btn--block btn--accent" disabled={ai.isBusy('depth') || !p.media} onClick={() => press('generate')}>{ai.isBusy('depth') ? 'Generating…' : mapReady ? 'Generate Again' : 'Generate Depth Map'}</button>
            {ai.isBusy('depth') && <div className="progress"><div className="progress__bar guide__busy" /><span className="progress__txt">Analyzing the image…</span></div>}
            {mapReady && <p className="small ok">Done. The preview now shows your original and its depth map side by side.</p>}
          </>
        )}
        {step === 3 && (
          <>
            <GrayLegend inverted={inverted} />
            <ul className="guide__list">
              <li><b>{inverted ? 'Black' : 'White'}:</b> nearer regions</li>
              <li><b>Grey:</b> middle-distance regions</li>
              <li><b>{inverted ? 'White' : 'Black'}:</b> farther regions</li>
            </ul>
            <p className="small muted">Values show relative distance, not metres.</p>
            <button className="btn btn--sm btn--block" onClick={() => setParam('invertDepth', !inverted)}>{inverted ? 'Back To Normal' : 'Invert Depth Map'}</button>
          </>
        )}
        {step === 4 && (
          <>
            <p>Click an area in the original image to select its estimated depth. AirFx will use this as your focus distance.</p>
            <p className="small muted">The preview colours the map: green is in focus, red is in front of it, blue is behind it.</p>
            <button className={`btn btn--sm btn--block ${p.tool.kind === 'focus' ? 'btn--on' : ''}`} onClick={() => tool(p.tool.kind === 'focus' ? { kind: 'none' } : { kind: 'focus' })}>{p.tool.kind === 'focus' ? 'Click The Preview…' : 'Click To Focus'}</button>
            <Range label="Focus Distance" value={params.focus as number} min={0} max={1} step={0.002} onChange={(v) => setParam('focus', v)} />
            <Range label="Focus Range" value={params.focusRange as number} min={0} max={1} step={0.005} onChange={(v) => setParam('focusRange', v)} />
            <Range label="Near Range" value={params.nearDepth as number} min={0.05} max={1} step={0.005} onChange={(v) => setParam('nearDepth', v)} />
            <Range label="Far Range" value={params.farDepth as number} min={0} max={0.95} step={0.005} onChange={(v) => setParam('farDepth', v)} />
          </>
        )}
        {step === 5 && (
          <>
            <p>Try each look on your image. The depth map decides what each one touches.</p>
            <div className="chips">
              {LOOKS.map(([name, , values]) => <button key={name} className={`chip ${look === name ? 'chip--on' : ''}`} onClick={() => { setLook(name); setParams(values); }}>{name}</button>)}
            </div>
            {look && <p className="small muted">{LOOKS.find((l) => l[0] === look)?.[1]}</p>}
            {look === 'Depth Displacement' ? <Range label="Displacement" value={params.displace as number} min={-80} max={80} step={0.5} onChange={(v) => setParam('displace', v)} />
              : look === 'Depth Glow' ? <Range label="Glow" value={params.glow as number} min={0} max={1} step={0.01} onChange={(v) => setParam('glow', v)} />
              : look ? <Range label="Blur Strength" value={params.blur as number} min={0} max={80} step={0.5} onChange={(v) => setParam('blur', v)} /> : null}
          </>
        )}
        {step === 6 && (
          <>
            <p>If part of the map is wrong, paint over it. The preview updates as you paint, so you can see the correction change the effect.</p>
            <div className="toolgrid">
              <button className={`btn btn--sm ${isDepthTool('add', 1) ? 'btn--on' : ''}`} onClick={() => tool({ kind: 'depth', mode: 'add', value: 0.06 })}>Nearer</button>
              <button className={`btn btn--sm ${isDepthTool('add', -1) ? 'btn--on' : ''}`} onClick={() => tool({ kind: 'depth', mode: 'add', value: -0.06 })}>Farther</button>
              <button className={`btn btn--sm ${isDepthTool('smooth') ? 'btn--on' : ''}`} onClick={() => tool({ kind: 'depth', mode: 'smooth', value: 0 })}>Smooth</button>
              <button className={`btn btn--sm ${isDepthTool('erase') ? 'btn--on' : ''}`} onClick={() => tool({ kind: 'depth', mode: 'erase', value: 0 })}>Eraser</button>
              <button className="btn btn--sm" onClick={() => { edits.depth.undo(); p.refresh(); }}>Undo</button>
              <button className={`btn btn--sm ${params.view === 'depth' ? 'btn--on' : ''}`} onClick={() => setParam('view', params.view === 'depth' ? 'final' : 'depth')}>See Map</button>
            </div>
            <Range label="Brush Size" value={p.brush.size} min={0.005} max={0.3} step={0.005} onChange={(v) => p.setBrush({ ...p.brush, size: v })} />
            <Range label="Softness" value={p.brush.soft} min={0} max={1} step={0.01} onChange={(v) => p.setBrush({ ...p.brush, soft: v })} />
          </>
        )}
        {step === 7 && (
          <>
            <p>Save what you made. Maps can be loaded again later with your corrections included.</p>
            <div className="exportgrid">
              <button className="btn btn--sm" onClick={() => press('export-gray')}>Grayscale Depth PNG</button>
              <button className="btn btn--sm" onClick={() => press('export-color')}>Colorized Depth PNG</button>
              <button className="btn btn--sm" onClick={() => press('export-final')}>Processed Image</button>
              <button className="btn btn--sm" onClick={p.onExport}>{p.media?.kind === 'video' ? 'Processed Video' : 'More Formats'}</button>
            </div>
            {p.media?.kind !== 'video' && <p className="small muted">Processed Video appears here for video files. Clips need Process Whole Clip first.</p>}
          </>
        )}
      </div>
      {blocked && <p className="small warn guide__block">{blocked}</p>}
      <footer className="guide__foot">
        <label className="guide__hide"><input type="checkbox" checked={hide} onChange={(e) => setDontShow(e.target.checked)} /> Don't show automatically again</label>
        <div className="guide__nav">
          <button className="btn btn--sm" onClick={close}>Skip Tutorial</button>
          <button className="btn btn--sm" disabled={step === 0} onClick={() => setStep(step - 1)}>Previous</button>
          {step < STEPS.length - 1
            ? <button className="btn btn--sm btn--accent" disabled={!!blocked} onClick={() => setStep(step + 1)}>Next</button>
            : <button className="btn btn--sm btn--accent" onClick={() => { setDontShow(true); close(); }}>Finish Tutorial</button>}
        </div>
      </footer>
    </aside>
  );
}
