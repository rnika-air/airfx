import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ModelKey } from '../ai/models';
import { ai, edits, frameData, tracks, type GrayMap } from '../ai/client';
import { selection, sourceKeyOf, type FrameFlag } from '../ai/selection';
import { trackObject } from '../ai/track';
import { cleanup, METHOD_INFO, reconstruct, reconstructVideo, loadReference, type CleanSettings, type FillMethod } from '../cleanup/engine';
import type { FillSource } from '../cleanup/inpaint';
import { depthField, suggestFocus } from '../effects/airDepth';
import { SAMPLES, loadSampleFile } from '../depth/samples';

const openGuide = () => window.dispatchEvent(new Event('airfx:depth-guide'));
import type { ParamValue, ParamValues, RenderLayer } from '../effects/types';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { Brush, JobBar, ModelCard, Runner, Tool, savePng, useJob, useModels, useSelection, type WsProps } from './Workspaces';

/* Shared selection tools */

const Field = ({ title, children }: { title: string; children: ReactNode }) => (
  <fieldset className="group"><legend className="group__title">{title}</legend>{children}</fieldset>
);

function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, unit = '%', hint }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; unit?: string; hint?: string }) {
  const shown = unit === '%' ? `${Math.round(value * 100)}%` : `${Math.round(value * 100) / 100}${unit}`;
  return (
    <div className="ctl" title={hint}>
      <div className="ctl__row"><span className="label">{label}</span><span className="ctl__num">{shown}</span></div>
      <input type="range" className="slider" min={min} max={max} step={step} value={value} aria-label={label} style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const FLAG_COLOR: Record<FrameFlag, string> = { ok: '#c6ff2e', weak: '#ffb02e', occluded: '#7a8cff', lost: '#ff4d4d' };

/** One tick per frame, coloured by tracking health. Click to go to a frame. */
function TrackStrip({ flags, fps, onSeek }: { flags: FrameFlag[]; fps: number; onSeek: (t: number) => void }) {
  return (
    <div className="trackstrip" role="group" aria-label="Tracking result per frame">
      {flags.map((f, i) => <button key={i} style={{ background: FLAG_COLOR[f] }} title={`${(i / fps).toFixed(2)} s · ${f}`} onClick={() => onSeek(i / fps)} />)}
    </div>
  );
}

/** Subject selection. Key and Cleanup share it, so one selection serves both. */
function SelectTools(p: WsProps & { title: string; helper: string }) {
  useModels();
  useSelection();
  const job = useJob();
  const [rate, setRate] = useState(12);
  const [smooth, setSmooth] = useState(0.2);
  const samReady = ai.state('sam').status === 'ready', detReady = ai.state('detect').status === 'ready';
  const { media, tool, setTool } = p;
  const video = media?.kind === 'video';
  const active = selection.active;
  const multi = !!active && active.track.frames.length > 1;
  const nowAi = (fn: () => Promise<unknown>, note: string) => job.run(note, async () => { await fn(); p.refresh(); });

  const track = (resume: boolean) => job.run('Tracking', async (signal, prog) => {
    await trackObject({ media: media!, object: active!, fps: rate, fromTime: p.time(), resume, smooth, signal, onProgress: prog });
    p.refresh();
  });

  return (
    <>
      <Field title={p.title}>
        <p className="small muted">{p.helper}</p>
        <ModelCard model="sam" />
        <div className="toolgrid">
          <Tool on={tool.kind === 'select' && tool.label === 1 && !tool.fresh} onClick={() => setTool({ kind: 'select', label: 1, fresh: false })} title="Click what you want. Each click adds to the current object.">+ Click</Tool>
          <Tool on={tool.kind === 'select' && tool.label === 0} onClick={() => setTool({ kind: 'select', label: 0, fresh: false })} title="Click a part that should not be selected">− Click</Tool>
          <Tool on={tool.kind === 'box'} onClick={() => setTool({ kind: 'box' })} title="Drag a box around an object">Box</Tool>
          <Tool on={tool.kind === 'selBrush' && tool.value === 1} onClick={() => setTool({ kind: 'selBrush', value: 1 })} title="Paint onto the selection. Needs no model.">Brush</Tool>
          <Tool on={tool.kind === 'selBrush' && tool.value === 0} onClick={() => setTool({ kind: 'selBrush', value: 0 })} title="Erase from the selection">Eraser</Tool>
          <Tool on={tool.kind === 'none'} onClick={() => setTool({ kind: 'none' })}>Off</Tool>
        </div>
        <div className="audio__buttons">
          <button className="btn btn--sm" disabled={!selection.canSmaller} onClick={() => selection.stepSize(-1, media!)} title="A click can mean a part or the whole. Try the smaller reading.">Smaller</button>
          <button className="btn btn--sm" disabled={!selection.canLarger} onClick={() => selection.stepSize(1, media!)} title="Try the larger reading of your click.">Larger</button>
        </div>
        <Brush brush={p.brush} setBrush={p.setBrush} plane={null} refresh={p.refresh} />
        <div className="audio__buttons">
          <button className="btn btn--sm" disabled={!selection.canUndo} onClick={() => { selection.undo(); p.refresh(); }}>Undo</button>
          <button className="btn btn--sm" disabled={!selection.canRedo} onClick={() => { selection.redo(); p.refresh(); }}>Redo</button>
          <button className="btn btn--sm" disabled={!selection.objects.length} onClick={() => { selection.clear(); p.refresh(); }}>Clear All</button>
        </div>
        {selection.warning && <p className="small warn">{selection.warning}</p>}
      </Field>

      <Field title="Find Subjects">
        <ModelCard model="detect" />
        <div className="audio__buttons">
          <button className="btn btn--sm" disabled={!detReady || !samReady || !media || !!job.busy} onClick={() => nowAi(() => selection.autoSubject(media!, p.time(), false), 'Finding the main subject')} title="Needs both the detector and EdgeTAM">Auto Subject</button>
          <button className="btn btn--sm" disabled={!detReady || !samReady || !media || !!job.busy} onClick={() => nowAi(() => selection.autoSubject(media!, p.time(), true), 'Finding a person')}>Find Person</button>
          <button className="btn btn--sm" disabled={!detReady || !media || !!job.busy} onClick={() => nowAi(() => selection.detect(media!), 'Listing objects')}>List Objects</button>
        </div>
        {selection.detections.length > 0 && (
          <div className="chips">
            {selection.detections.map((d, i) => <button key={i} className="chip" disabled={!samReady || !!job.busy} title="Select this object" onClick={() => nowAi(() => selection.boxSelect(media!, p.time(), d.box.map((v) => Math.min(1, Math.max(0, v))), d.label), `Selecting ${d.label}`)}>{d.label} {Math.round(d.score * 100)}%</button>)}
          </div>
        )}
      </Field>

      <Field title={`Selected Objects · ${selection.objects.length}`}>
        {!selection.objects.length && <p className="small muted">Nothing selected yet.</p>}
        <ul className="objlist">
          {selection.objects.map((o) => (
            <li key={o.id} className={o.id === selection.activeId ? 'on' : ''} onClick={() => selection.select(o.id)}>
              <span className="objlist__dot" style={{ background: o.color }} />
              <button className="tl-eye" aria-label={o.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); selection.toggle(o.id); p.refresh(); }}>{o.visible ? '●' : '○'}</button>
              <span className="objlist__name">{o.name}{o.track.frames.length > 1 ? ` · ${o.track.frames.length} frames` : ''}</span>
              <button className="tl-mini" aria-label={`Remove ${o.name}`} onClick={(e) => { e.stopPropagation(); selection.remove(o.id); p.refresh(); }}>×</button>
            </li>
          ))}
        </ul>
        <button className="btn btn--sm btn--block" disabled={!samReady} onClick={() => setTool({ kind: 'select', label: 1, fresh: true })} title="The next click starts a separate object">+ New Object</button>
      </Field>

      {video && (
        <Field title="Track Through Video">
          <div className="ctl__row"><span className="label">Analyse</span>
            <select className="select select--compact" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Tracking rate" disabled={!!job.busy}>
              {[6, 8, 12, 15, 24].map((n) => <option key={n} value={n}>{n} per second</option>)}
            </select>
          </div>
          <Slider label="Mask Stability" value={smooth} max={0.6} onChange={setSmooth} hint="Blends each mask with the last one along the motion, to reduce flicker." />
          <button className="btn btn--sm btn--block btn--accent" disabled={!samReady || !active || !!job.busy} onClick={() => track(false)}>Track Selected Object</button>
          <button className="btn btn--sm btn--block" disabled={!samReady || !multi || !!job.busy} onClick={() => track(true)} title="Keeps everything before this frame and tracks forward from your correction">Resume From Here</button>
          {active && active.flags.length > 1 && (
            <>
              <TrackStrip flags={active.flags} fps={active.track.fps} onSeek={p.seek} />
              <p className="small muted">Green good · amber weak · blue hidden · red lost. Click a tick, fix the mask, then Resume From Here.</p>
            </>
          )}
        </Field>
      )}
      <JobBar job={job} />
    </>
  );
}

/* AirFx Key */

export function KeyPanel(p: WsProps) {
  const [model, setModel] = useState<ModelKey>('matteQuality');
  const [smooth, setSmooth] = useState(0.5);
  const [note, setNote] = useState<string | null>(null);
  useSelection();
  const mode = p.fx.params.mode as string, intent = p.fx.params.intent as string;
  const stem = (p.media?.name ?? 'airfx').replace(/\.[^.]+$/, '');
  const withView = (view: string, bgMode?: string): RenderLayer[] =>
    p.chain().map((l) => (l.effect.id === 'airKey' ? { ...l, params: { ...l.params, view, ...(bgMode ? { bgMode } : {}) } } : l));
  const save = async (layers: RenderLayer[], suffix: string) => {
    if (!p.media) return;
    await savePng(p.media, layers, `${stem}_${suffix}.png`, p.time());
    setNote(`Saved ${stem}_${suffix}.png`);
  };
  const quickView = ['final', 'subject', 'mask', 'alpha', 'original'] as const;
  const viewName = { final: 'Final', subject: 'Subject', mask: 'Mask', alpha: 'Alpha', original: 'Original' };

  return (
    <aside className="sidebar sidebar--left" aria-label="AirFx Key">
      <div className="panel-head">
        <div><span className="label label--dim">Workspace</span><h2 className="panel-title">AirFx Key</h2></div>
        <button className="btn btn--sm" onClick={p.onBack}>Done</button>
      </div>
      <div className="sidebar__scroll">
        <Field title="What Do You Want">
          <div className="segmented segmented--2 segmented--compact">
            <button className={intent === 'keep' ? 'on' : ''} onClick={() => p.fx.setParam('intent', 'keep')}>Keep Subject</button>
            <button className={intent === 'remove' ? 'on' : ''} onClick={() => p.fx.setParam('intent', 'remove')}>Remove Subject</button>
          </div>
          <p className="small muted">{intent === 'keep' ? 'Select what to preserve. Everything else goes.' : 'Select what to take out. The background stays, with a hole until you reconstruct it.'}</p>
          {intent === 'remove' && <button className="btn btn--sm btn--block btn--accent" disabled={!selection.hasMask()} onClick={() => p.onOpen('cleanup')}>Reconstruct Behind Subject →</button>}
          <div className="chips">
            {quickView.map((v) => <button key={v} className={`chip ${p.fx.params.view === v ? 'chip--on' : ''}`} onClick={() => p.fx.setParam('view', v)}>{viewName[v]}</button>)}
          </div>
        </Field>

        {mode === 'select' && <SelectTools {...p} title="Select" helper="Click the subject, or drag a box. Add or subtract until the mask is right." />}

        {mode === 'select' && (
          <Field title="Hair &amp; Fine Detail">
            <p className="small muted">Optional. Runs a matting model, then uses it only near your selection's edge. Results on hair are good, not perfect.</p>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value as ModelKey)} aria-label="Matting model">
              <option value="matteQuality">ISNet · any subject</option>
              <option value="matteFast">MODNet · people</option>
            </select>
            <ModelCard model={model} />
            <Runner model={model} track={tracks.matte} media={p.media} smoothing={smooth} align={false} refresh={() => { p.fx.setParam('fineDetail', 0.8); p.refresh(); }} label="Find Fine Detail" />
          </Field>
        )}

        {mode === 'ai' && (
          <Field title="Auto Matte">
            <p className="small muted">Guesses the main subject by itself, frame by frame. Use Selection when you need to choose the subject or follow it through a video.</p>
            <select className="select" value={model} onChange={(e) => setModel(e.target.value as ModelKey)} aria-label="Segmentation model">
              <option value="matteQuality">ISNet · any subject</option>
              <option value="matteFast">MODNet · people</option>
            </select>
            <ModelCard model={model} />
            {p.media?.kind === 'video' && <Slider label="Temporal Smoothing" value={smooth} max={0.9} onChange={setSmooth} />}
            <Runner model={model} track={tracks.matte} media={p.media} smoothing={smooth} align={false} refresh={p.refresh} label="Run Auto Matte" />
          </Field>
        )}

        {(mode === 'green' || mode === 'blue' || mode === 'color') && (
          <Field title="Chroma Key">
            <p className="small muted">A colour key, not AI. It needs an evenly lit screen.</p>
            <Tool on={p.tool.kind === 'pick'} onClick={() => p.setTool(p.tool.kind === 'pick' ? { kind: 'none' } : { kind: 'pick' })}>Pick Key Color from Preview</Tool>
            <div className="audio__buttons">
              <Tool on={p.tool.kind === 'hint' && p.tool.value > 0} onClick={() => p.setTool({ kind: 'hint', value: 1 })} title="Paint areas to keep">Keep</Tool>
              <Tool on={p.tool.kind === 'hint' && p.tool.value < 0} onClick={() => p.setTool({ kind: 'hint', value: -1 })} title="Paint areas to remove">Remove</Tool>
              <Tool on={p.tool.kind === 'none'} onClick={() => p.setTool({ kind: 'none' })}>Off</Tool>
            </div>
            <Brush brush={p.brush} setBrush={p.setBrush} plane={edits.hint} refresh={p.refresh} />
          </Field>
        )}

        <Field title="Export Stills">
          <div className="exportgrid">
            <button className="btn btn--sm" disabled={!p.media} onClick={() => save(withView('final', 'transparent'), 'transparent')}>Transparent PNG</button>
            <button className="btn btn--sm" disabled={!p.media} onClick={() => save(withView('alpha'), 'matte')}>Alpha Matte</button>
            <button className="btn btn--sm" disabled={!p.media} onClick={() => save(withView('foreground'), 'foreground')}>Foreground</button>
            <button className="btn btn--sm" disabled={!p.media} onClick={() => save(withView('background'), 'background')}>Background Plate</button>
          </div>
          <p className="small muted">Video exports from the main Export button. A transparent background survives only in WebM · VP9 (tested in Chrome and Edge). MP4 turns it black, and some video editors ignore WebM alpha.</p>
          {note && <p className="small ok">{note}</p>}
        </Field>
      </div>
    </aside>
  );
}

/* AirFx Cleanup */

function useCleanup() {
  useSyncExternalStore(cleanup.subscribe, cleanup.getVersion);
}

export function CleanupPanel(p: WsProps) {
  useModels();
  useCleanup();
  useSelection();
  const job = useJob();
  const [method, setMethod] = useState<FillMethod>('patch');
  const [s, setS] = useState<CleanSettings>({ expand: 6, feather: 2, continuity: 0.5, detail: 0.5, preserve: 0.3, perspective: 0 });
  const [reference, setReference] = useState<(FillSource & { name: string }) | null>(null);
  const [rate, setRate] = useState(12);
  const refInput = useRef<HTMLInputElement>(null);
  const { media, tool } = p;
  const video = media?.kind === 'video';
  const set = (patch: Partial<CleanSettings>) => setS({ ...s, ...patch });
  const methods: FillMethod[] = ['march', 'patch', 'lama', 'reference'];
  const needsModel = method === 'lama' && ai.state('lama').status !== 'ready';
  const usesPatches = method === 'patch' || method === 'reference';
  const ready = !!media && !needsModel && !(method === 'reference' && !reference);
  const stem = (media?.name ?? 'airfx').replace(/\.[^.]+$/, '');

  const go = () => job.run(METHOD_INFO[method].label, async (_s, prog) => {
    await reconstruct(media!, p.time(), method, s, reference, (f) => prog(f));
    p.fx.setParam('view', 'final');
    p.refresh();
  });
  const goVideo = () => job.run('Video reconstruction', async (signal, prog) => {
    await reconstructVideo(media!, method, s, reference, rate, signal, prog);
    p.fx.setParam('view', 'final');
    p.refresh();
  });

  return (
    <aside className="sidebar sidebar--left" aria-label="AirFx Cleanup">
      <div className="panel-head">
        <div><span className="label label--dim">Workspace</span><h2 className="panel-title">AirFx Cleanup</h2></div>
        <button className="btn btn--sm" onClick={p.onBack}>Done</button>
      </div>
      <div className="sidebar__scroll">
        <SelectTools {...p} title="1 · Select What To Remove" helper="An object, a person, a logo, text. Click it, or paint over it in step 2." />
        <Field title="2 · Refine The Mask">
          <div className="audio__buttons">
            <Tool on={tool.kind === 'cleanBrush' && tool.value === 1} onClick={() => p.setTool({ kind: 'cleanBrush', value: 1 })} title="Paint a region to remove. Needs no model.">Mask Brush</Tool>
            <Tool on={tool.kind === 'cleanBrush' && tool.value === 0} onClick={() => p.setTool({ kind: 'cleanBrush', value: 0 })}>Erase</Tool>
          </div>
          <Brush brush={p.brush} setBrush={p.setBrush} plane={edits.clean} refresh={p.refresh} />
          <Slider label="Mask Expansion" value={s.expand} max={40} step={0.5} unit="" onChange={(v) => set({ expand: v })} hint="Grow the mask past the object's soft edge and shadow." />
          <Slider label="Feathering" value={s.feather} max={20} step={0.5} unit="" onChange={(v) => set({ feather: v })} hint="Soft blend just outside the mask. Pixels further out are not touched." />
        </Field>
        <Field title="3 · Reconstruct">
          <div className="methodlist">
            {methods.map((m) => (
              <button key={m} className={`method ${method === m ? 'method--on' : ''}`} onClick={() => setMethod(m)}>
                <strong>{METHOD_INFO[m].label}</strong><em>{METHOD_INFO[m].kind}</em><span>{METHOD_INFO[m].note}</span>
              </button>
            ))}
          </div>
          {method === 'lama' && <ModelCard model="lama" />}
          {method === 'reference' && (
            <>
              <button className="btn btn--sm btn--block" onClick={() => refInput.current?.click()}>{reference ? `Reference: ${reference.name}` : 'Choose Reference Image…'}</button>
              <input ref={refInput} type="file" accept="image/*" hidden data-testid="ref-input" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setReference({ ...(await loadReference(f)), name: f.name }); }} />
            </>
          )}
          {usesPatches && <Slider label="Texture Continuity" value={s.continuity} onChange={(v) => set({ continuity: v })} hint="Larger patches keep lines and structure running through the fill." />}
          {method !== 'march' && <Slider label="Detail Preservation" value={s.detail} onChange={(v) => set({ detail: v })} hint={method === 'lama' ? 'Uses a tighter crop, giving more pixels to the fill and less context.' : 'Smaller patches and more passes keep fine grain.'} />}
          {usesPatches && <Slider label="Preserve Surroundings" value={s.preserve} onChange={(v) => set({ preserve: v })} hint="Prefer source patches close to the hole, so the fill matches what is next to it." />}
          {usesPatches && <Slider label="Perspective Consistency" value={s.perspective} onChange={(v) => set({ perspective: v })} hint="Lets patches scale, which helps on receding walls and ground." />}
          <button className="btn btn--sm btn--block btn--accent" disabled={!ready || !!job.busy} onClick={go}>{cleanup.attempts.length ? 'New Attempt' : video ? 'Reconstruct This Frame' : 'Reconstruct'}</button>
          {video && (
            <>
              <div className="ctl__row"><span className="label">Video Rate</span>
                <select className="select select--compact" value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Video reconstruction rate" disabled={!!job.busy}>
                  {[6, 12, 15, 24].map((n) => <option key={n} value={n}>{n} per second</option>)}
                </select>
              </div>
              <button className="btn btn--sm btn--block" disabled={!ready || !!job.busy} onClick={goVideo}>Reconstruct Whole Clip</button>
              <p className="small muted">Offline. Reveals the background from other frames, then fills only what no frame shows, once, so the fill stays steady. Track the object first. Works best when the background is rigid.</p>
            </>
          )}
          <JobBar job={job} />
        </Field>
        <Field title={`Results · ${cleanup.attempts.length}`}>
          {!cleanup.attempts.length && <p className="small muted">Nothing reconstructed yet.</p>}
          <ul className="objlist">
            {cleanup.attempts.map((a) => (
              <li key={a.id} className={a.id === cleanup.activeId ? 'on' : ''} onClick={() => { cleanup.choose(a.id); p.refresh(); }}>
                <span className="objlist__name">#{a.n} {METHOD_INFO[a.method].label}{media && a.sourceKey !== sourceKeyOf(media) ? ' · other media' : ''}</span>
                <button className="tl-mini" aria-label={`Delete result ${a.n}`} onClick={(e) => { e.stopPropagation(); cleanup.remove(a.id); p.refresh(); }}>×</button>
              </li>
            ))}
          </ul>
          {cleanup.active?.note && <p className="small muted">{cleanup.active.note}</p>}
          {cleanup.active && <p className="small muted">{METHOD_INFO[cleanup.active.method].kind}. Use Split in the toolbar to compare with the original.</p>}
          <button className="btn btn--sm btn--block" disabled={!cleanup.active} onClick={() => { cleanup.choose(null); p.refresh(); }}>Show Original</button>
          <div className="audio__buttons">
            <Tool on={tool.kind === 'clone'} onClick={() => p.setTool(tool.kind === 'clone' ? { kind: 'none' } : { kind: 'clone', source: null })} title="Manual patch: click a source, then paint">Manual Patch</Tool>
            <button className="btn btn--sm" disabled={!media} onClick={() => savePng(media!, p.chain(), `${stem}_cleaned.png`, p.time())}>Save PNG</button>
          </div>
          {tool.kind === 'clone' && <p className="small muted">{tool.source ? 'Paint over the area to repair.' : 'Click a clean area to copy from.'} This copies pixels. It is not reconstruction.</p>}
        </Field>
      </div>
    </aside>
  );
}

/* AirFx Depth */

/** Splits the depth range into far, middle and near groups with 1-D k-means. */
function depthBands(depth: Float32Array) {
  const v: number[] = [];
  for (let i = 0; i < depth.length; i += 7) v.push(depth[i]);
  v.sort((a, b) => a - b);
  let c = [v[Math.floor(v.length * 0.15)], v[v.length >> 1], v[Math.floor(v.length * 0.85)]];
  for (let it = 0; it < 12; it++) {
    const sum = [0, 0, 0], num = [0, 0, 0];
    for (const x of v) {
      const k = Math.abs(x - c[0]) < Math.abs(x - c[1]) ? (Math.abs(x - c[0]) < Math.abs(x - c[2]) ? 0 : 2) : Math.abs(x - c[1]) < Math.abs(x - c[2]) ? 1 : 2;
      sum[k] += x; num[k]++;
    }
    c = c.map((o, k) => (num[k] ? sum[k] / num[k] : o));
  }
  c.sort((a, b) => a - b);
  const a = (c[0] + c[1]) / 2, b = (c[1] + c[2]) / 2;
  return { far: [0, a], mid: [a, b], near: [b, 1] } as Record<'far' | 'mid' | 'near', [number, number]>;
}

export function DepthPanel(p: WsProps) {
  const [model, setModel] = useState<ModelKey>('depth');
  const [quality, setQuality] = useState(518);
  const [smooth, setSmooth] = useState(0.6);
  const [note, setNote] = useState<string | null>(null);
  useSelection();
  useModels();
  const file = useRef<HTMLInputElement>(null);
  const { params, setParam, setParams } = p.fx;
  const hasModelMap = tracks.depth.frames.length > 0;
  const usingModel = params.source === 'model' && hasModelMap;
  const stem = (p.media?.name ?? 'airfx').replace(/\.[^.]+$/, '');
  const viewLayers = (view: string): RenderLayer[] => p.chain().map((l) => (l.effect.id === 'airDepth' ? { ...l, params: { ...l.params, view } } : l));
  const set = (k: string, v: ParamValue) => setParam(k, v);
  const focus = params.focus as number, range = params.focusRange as number;
  const lowEdge = Math.max(0, focus - range / 2), highEdge = Math.min(1, focus + range / 2);
  const band = (lo: number, hi: number, extra: ParamValues = {}) => setParams({ focus: (lo + hi) / 2, focusRange: Math.max(0.01, hi - lo), ...extra });

  const field = () => {
    const small = frameData(p.media!.element, p.media!.width, p.media!.height, 256);
    return { small, depth: depthField(small, params as ParamValues, p.time()).depth };
  };
  const region = (r: 'far' | 'mid' | 'near') => {
    if (!p.media) return;
    const b = depthBands(field().depth)[r];
    band(b[0], b[1], { view: 'overlay' });
    setNote(null);
  };
  /** The subject need not be the nearest thing: a selection decides if there is one. */
  const mainSubject = () => {
    if (!p.media) return;
    const { small, depth } = field();
    const sel = selection.union(p.time()), vals: number[] = [];
    if (sel) {
      for (let y = 0; y < small.height; y += 2)
        for (let x = 0; x < small.width; x += 2) {
          if (sel.data[Math.floor((y / small.height) * sel.h) * sel.w + Math.floor((x / small.width) * sel.w)] > 0.5) vals.push(depth[y * small.width + x]);
        }
    }
    const fromSel = vals.length >= 8;
    if (!fromSel) {
      // No selection: favour what fills the middle of the frame.
      for (let y = small.height >> 2; y < small.height * 0.75; y += 2) for (let x = small.width >> 2; x < small.width * 0.75; x += 2) vals.push(depth[y * small.width + x]);
    }
    vals.sort((a, b) => a - b);
    band(vals[Math.floor(vals.length * 0.1)], vals[Math.floor(vals.length * 0.9)], { view: 'overlay' });
    setNote(fromSel ? 'Main subject taken from your selection.' : 'Main subject guessed from the frame centre. Select the subject in Key for an exact answer.');
  };

  const loadPng = async (f: File) => {
    const bmp = await createImageBitmap(f);
    const c = createCanvas(bmp.width, bmp.height), g = get2d(c, true);
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data, data = new Float32Array(bmp.width * bmp.height);
    for (let i = 0; i < data.length; i++) data[i] = d[i * 4] / 255;
    const map: GrayMap = { w: bmp.width, h: bmp.height, data };
    tracks.depth.setStill(map, p.media ? sourceKeyOf(p.media) : '', 'file');
    setParams({ source: 'model' });
    p.refresh();
  };

  const views = [['original', 'Original'], ['depth', 'Depth Map'], ['side', 'Side by Side'], ['depthOverlay', 'Overlay'], ['final', 'Final']] as const;

  return (
    <aside className="sidebar sidebar--left" aria-label="AirFx Depth">
      <div className="panel-head">
        <div><span className="label label--dim">Workspace</span><h2 className="panel-title">AirFx Depth</h2></div>
        <div className="audio__buttons">
          <button className="btn btn--sm" aria-label="Open the Depth Map Guide" title="Depth Map Guide" onClick={openGuide}>?</button>
          <button className="btn btn--sm" onClick={p.onBack}>Done</button>
        </div>
      </div>
      <div className="sidebar__scroll">
        <div className={`depthstate ${usingModel ? 'depthstate--ai' : ''}`}>
          {usingModel ? (tracks.depth.kind === 'file' ? 'DEPTH: LOADED MAP' : 'DEPTH: AI MODEL ESTIMATE') : params.source === 'model' ? 'NO DEPTH MAP YET' : 'DEPTH: PROCEDURAL, NOT AI'}
        </div>
        <div className="depthlegend">
          <span>{params.invertDepth ? 'Near' : 'Far'}</span><i /><span>{params.invertDepth ? 'Far' : 'Near'}</span>
        </div>
        <p className="small muted pad-x">{params.invertDepth ? 'Black = near, white = far.' : 'White = near, black = far.'} Values are relative, not metres.</p>
        <Field title="Depth Map">
          <select className="select" value={model} onChange={(e) => setModel(e.target.value as ModelKey)} aria-label="Depth model">
            <option value="depth">Standard model</option>
            <option value="depthLite">Lite model</option>
            <option value="depthV1">V1 model (comparison)</option>
          </select>
          <button className="btn btn--sm btn--block" onClick={openGuide}>Depth Map Guide</button>
          <div data-guide="model"><ModelCard model={model} /></div>
          <div className="ctl__row"><span className="label">Quality</span>
            <select className="select select--compact" value={quality} onChange={(e) => setQuality(Number(e.target.value))} aria-label="Inference resolution">
              <option value={392}>Fast · 392</option>
              <option value={518}>Standard · 518</option>
              <option value={770}>High · 770</option>
              <option value={1022}>Ultra · 1022</option>
            </select>
          </div>
          {p.media?.kind === 'video' && <Slider label="Temporal Smoothing" value={smooth} max={0.9} onChange={setSmooth} hint="Blends along the motion, and only where frames agree." />}
          <Runner model={model} track={tracks.depth} media={p.media} smoothing={smooth} align inputSize={quality} refresh={() => {
            // A fresh map starts focused on the likely subject, not on a fixed number.
            const small = frameData(p.media!.element, p.media!.width, p.media!.height, 320);
            const next = { ...params, source: 'model', view: 'depth' };
            setParams({ source: 'model', view: 'depth', focus: suggestFocus(depthField(small, next, p.time()).depth, small.width, small.height) });
            p.refresh();
          }} label="Generate Depth Map" />
          <button className="btn btn--sm btn--block" onClick={() => p.onOpen('depthlab')}>Open Depth Test Lab</button>
          <div className="chips" data-guide="views">
            {views.map(([v, l]) => <button key={v} className={`chip ${params.view === v ? 'chip--on' : ''}`} onClick={() => set('view', v)}>{l}</button>)}
          </div>
          <button className="btn btn--sm btn--block" onClick={() => set('invertDepth', !params.invertDepth)}>Invert Depth</button>
        </Field>
        <Field title="Regions &amp; Focus">
          <div className="audio__buttons">
            <button className="btn btn--sm" onClick={() => region('near')}>Foreground</button>
            <button className="btn btn--sm" onClick={mainSubject}>Main Subject</button>
          </div>
          <div className="audio__buttons">
            <button className="btn btn--sm" onClick={() => region('mid')}>Middle Ground</button>
            <button className="btn btn--sm" onClick={() => region('far')}>Background</button>
          </div>
          <div className="audio__buttons">
            <Tool on={p.tool.kind === 'inspect'} onClick={() => p.setTool(p.tool.kind === 'inspect' ? { kind: 'none' } : { kind: 'inspect' })} title="Click the image to read its depth">Read Depth</Tool>
            <Tool on={p.tool.kind === 'focus'} onClick={() => p.setTool(p.tool.kind === 'focus' ? { kind: 'none' } : { kind: 'focus' })} title="Click the preview to focus there">Click to Focus</Tool>
          </div>
          {p.reading && (
            <div className="readout">
              <span>Depth <strong>{p.reading.depth.toFixed(3)}</strong> · {p.reading.depth > 0.66 ? 'near' : p.reading.depth > 0.33 ? 'middle' : 'far'}</span>
              <button className="btn btn--sm" onClick={() => set('focus', p.reading!.depth)}>Set as Focus</button>
            </div>
          )}
          <Slider label="Band Near Edge" value={highEdge} onChange={(v) => band(Math.min(lowEdge, v - 0.01), v)} unit="" step={0.005} />
          <Slider label="Band Far Edge" value={lowEdge} onChange={(v) => band(v, Math.max(highEdge, v + 0.01))} unit="" step={0.005} />
          <button className="btn btn--sm btn--block" onClick={() => set('view', params.view === 'overlay' ? 'final' : 'overlay')}>{params.view === 'overlay' ? 'Hide Band Highlight' : 'Highlight Selected Band'}</button>
          {note && <p className="small muted">{note}</p>}
        </Field>
        <Field title="Samples">
          <p className="small muted">Open a sample to practise on. Its depth map is generated by the model, like any image.</p>
          <div className="guide__samples">
            {SAMPLES.map((s) => <button key={s.id} className="guide__sample" onClick={async () => p.onFile(await loadSampleFile(s.id))} title={`${s.credit}, ${s.license}`}><img src={s.url} alt="" /><span>{s.type}</span></button>)}
          </div>
        </Field>
        <Field title="Depth Correction">
          <div className="toolgrid" data-guide="correction">
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'add' && p.tool.value > 0} onClick={() => p.setTool({ kind: 'depth', mode: 'add', value: 0.06 })} title="Brush: bring this closer">Nearer</Tool>
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'add' && p.tool.value < 0} onClick={() => p.setTool({ kind: 'depth', mode: 'add', value: -0.06 })} title="Brush: push this away">Farther</Tool>
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'smooth'} onClick={() => p.setTool({ kind: 'depth', mode: 'smooth', value: 0 })} title="Even out harsh steps">Smooth</Tool>
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'set' && p.tool.value > 0} onClick={() => p.setTool({ kind: 'depth', mode: 'set', value: 1 })} title="Force near">Near Mask</Tool>
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'set' && p.tool.value < 0} onClick={() => p.setTool({ kind: 'depth', mode: 'set', value: -1 })} title="Force far">Far Mask</Tool>
            <Tool on={p.tool.kind === 'depth' && p.tool.mode === 'erase'} onClick={() => p.setTool({ kind: 'depth', mode: 'erase', value: 0 })}>Depth Eraser</Tool>
            <Tool on={p.tool.kind === 'protect' && p.tool.value > 0} onClick={() => p.setTool({ kind: 'protect', value: 1 })} title="Paint areas that the other brushes must not change">Protect</Tool>
            <Tool on={p.tool.kind === 'protect' && p.tool.value === 0} onClick={() => p.setTool({ kind: 'protect', value: 0 })}>Unprotect</Tool>
            <Tool on={p.tool.kind === 'none'} onClick={() => p.setTool({ kind: 'none' })}>Off</Tool>
          </div>
          <Brush brush={p.brush} setBrush={p.setBrush} plane={edits.depth} refresh={p.refresh} />
        </Field>
        <Field title="Export &amp; Reuse">
          <div className="exportgrid" data-guide="exports">
            <button data-guide="export-gray" className="btn btn--sm" disabled={!p.media} onClick={async () => { await savePng(p.media!, viewLayers('depth'), `${stem}_depth.png`, p.time()); setNote('Saved depth map. Load it again to reuse your corrections.'); }}>Depth Map PNG</button>
            <button data-guide="export-color" className="btn btn--sm" disabled={!p.media} onClick={async () => { await savePng(p.media!, viewLayers('color'), `${stem}_depth_color.png`, p.time()); setNote('Saved colorized depth map.'); }}>Colorized PNG</button>
            <button className="btn btn--sm" disabled={!p.media} onClick={async () => { await savePng(p.media!, viewLayers('mask'), `${stem}_focusmask.png`, p.time()); setNote('Saved focus mask.'); }}>Focus Mask PNG</button>
            <button data-guide="export-final" className="btn btn--sm" disabled={!p.media} onClick={async () => { await savePng(p.media!, viewLayers('final'), `${stem}_focus.png`, p.time()); setNote('Saved processed image.'); }}>Processed PNG</button>
            <button className="btn btn--sm" onClick={() => file.current?.click()}>Load Depth PNG</button>
          </div>
          <input ref={file} type="file" accept="image/png,image/*" hidden data-testid="depth-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadPng(f).catch((x) => setNote((x as Error).message)); }} />
        </Field>
      </div>
    </aside>
  );
}
