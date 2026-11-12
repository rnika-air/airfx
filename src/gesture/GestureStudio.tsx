import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { TopBar, type AppMode } from '../components/TopBar';
import { VisionCard } from '../components/LiveControls';
import { vision } from '../ai/vision';
import { camera, LiveRecorder } from '../live/camera';
import { downloadBlob } from '../utils/exportUtils';
import { createCanvas, get2d } from '../utils/imageProcessing';
import { GESTURE_LABEL, GestureEngine, type EngineStatus } from './engine';
import { Painter, type BrushKind } from './painter';
import { HandGlyph } from './HandGlyph';
import { Tutorial } from './Tutorial';

const SEEN_KEY = 'airfx.gesture.tutorialSeen';
const PALETTE = ['#c6ff2e', '#ff3b6b', '#2ec5ff', '#ffd23d', '#ffffff', '#9b5cff'];
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];
type Backdrop = 'camera' | 'black' | 'white';

interface Props {
  onMode: (m: AppMode) => void;
  projectName: string;
  onProjectName: (n: string) => void;
  projectMenu?: ReactNode;
  /** Opens the drawing in the Effects workspace as a new picture. */
  onUseInEffects: (file: File) => void;
}

function readSeen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } }
function writeSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: it shows again next time */ } }

function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, hint, fmt }: { label: string; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; hint?: string; fmt?: (v: number) => string }) {
  return (
    <div className="ctl" title={hint}>
      <div className="ctl__row"><span className="label">{label}</span><span className="ctl__num">{fmt ? fmt(value) : Math.round(((value - min) / (max - min)) * 100)}</span></div>
      <input type="range" className="slider" aria-label={label} min={min} max={max} step={step} value={value} style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

export function GestureStudio(p: Props) {
  useSyncExternalStore(camera.subscribe, camera.getVersion);
  useSyncExternalStore(vision.subscribe, vision.getVersion);
  const painter = useRef(new Painter()).current;
  const engine = useRef(new GestureEngine(painter)).current;
  const view = useRef<HTMLCanvasElement>(null);
  const clean = useRef(createCanvas(1280, 720)).current;
  const recorder = useRef<LiveRecorder | null>(null);
  const [status, setStatus] = useState<EngineStatus>(engine.status);
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const [tutorial, setTutorial] = useState(() => !readSeen());
  const [palette, setPalette] = useState(PALETTE);
  const [colorIndex, setColorIndex] = useState(0);
  const [brush, setBrush] = useState({ kind: 'spray' as BrushKind, size: painter.size, opacity: 1, flow: 0.6 });
  const [settings, setSettings] = useState(engine.settings);
  const [look, setLook] = useState({ backdrop: 'camera' as Backdrop, camOpacity: 0.85, skeleton: true });
  const [rec, setRec] = useState<{ on: boolean; t0: number }>({ on: false, t0: 0 });
  const [note, setNote] = useState('');
  const on = camera.status === 'on' || camera.status === 'paused';
  const handsReady = vision.ready('hands');
  /** A recorded clip used instead of the camera, to rehearse or to test gestures. */
  const [clip, setClip] = useState<{ video: HTMLVideoElement; name: string } | null>(null);
  const clipInput = useRef<HTMLInputElement>(null);
  const srcEl = clip?.video ?? ((camera.media?.element as HTMLVideoElement | undefined) ?? null);
  const live = on || !!clip;

  if (import.meta.env.DEV) (window as unknown as { __gesture: unknown }).__gesture = { engine, painter, vision, camera };
  const latest = useRef({ look, rec, palette, colorIndex, srcEl });
  latest.current = { look, rec, palette, colorIndex, srcEl };

  // Settings into the engine and painter.
  useEffect(() => { engine.settings = settings; }, [engine, settings]);
  useEffect(() => { painter.kind = brush.kind; painter.opacity = brush.opacity; painter.flow = brush.flow; painter.setSize(brush.size); }, [painter, brush]);
  useEffect(() => { painter.color = palette[colorIndex]; }, [painter, palette, colorIndex]);
  useEffect(() => {
    engine.onColor = () => setColorIndex((i) => (i + 1) % latest.current.palette.length);
    return () => { engine.onColor = null; };
  }, [engine]);
  // Sensitivity also tells the model how sure it must be.
  useEffect(() => {
    if (!handsReady) return;
    const id = setTimeout(() => { vision.setHandConfidence(0.65 - 0.45 * settings.sensitivity).catch(() => undefined); }, 200);
    return () => clearTimeout(id);
  }, [handsReady, settings.sensitivity]);

  // The camera stops when this workspace closes.
  useEffect(() => () => { recorder.current?.cancel(); camera.stop(); }, []);
  useEffect(() => () => { if (clip) { clip.video.pause(); URL.revokeObjectURL(clip.video.src); } }, [clip]);
  const openClip = (f: File) => {
    camera.stop();
    const v = document.createElement('video');
    v.src = URL.createObjectURL(f);
    v.muted = true; v.loop = true; v.playsInline = true;
    v.play().then(() => setClip({ video: v, name: f.name })).catch((e) => setNote(`The clip could not play: ${(e as Error).message}`));
  };

  /** One camera frame: track, draw, show, record. */
  const frame = useRef(0);
  const process = useCallback(() => {
    const v = latest.current.srcEl, out = view.current;
    if (!v || !out) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    painter.resize(w, h);
    for (const c of [out, clean]) { if (c.width !== w) c.width = w; if (c.height !== h) c.height = h; }
    const hands = vision.ready('hands') ? vision.handsFull(v, ++frame.current) : [];
    engine.step(hands, performance.now() / 1000, w, h);
    const st = engine.status, { look, rec } = latest.current, mirror = engine.settings.mirror;

    // Clean picture: what a recording contains.
    const g = get2d(clean);
    g.globalAlpha = 1;
    g.fillStyle = look.backdrop === 'white' ? '#fff' : '#000';
    g.fillRect(0, 0, w, h);
    if (look.backdrop === 'camera') {
      g.save();
      g.globalAlpha = look.camOpacity;
      if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
      g.drawImage(v, 0, 0, w, h);
      g.restore();
    }
    painter.drawInto(g, w, h);
    if (rec.on) recorder.current?.add(clean);

    // On screen: the clean picture, then hands, cursor and state.
    const o = get2d(out);
    o.drawImage(clean, 0, 0);
    const u = Math.max(w, h) / 1000;
    if (look.skeleton) for (const hd of st.hands) {
      o.strokeStyle = hd.side === 'right' ? 'rgba(198,255,46,0.75)' : 'rgba(236,235,228,0.7)';
      o.lineWidth = 2 * u;
      o.beginPath();
      for (const [a, b] of BONES) { o.moveTo(hd.points[a].x, hd.points[a].y); o.lineTo(hd.points[b].x, hd.points[b].y); }
      o.stroke();
      o.fillStyle = o.strokeStyle;
      o.font = `600 ${14 * u}px ui-monospace, monospace`;
      o.fillText(`${hd.side === 'right' ? 'R' : 'L'} · ${GESTURE_LABEL[hd.gesture].toUpperCase()}`, hd.points[0].x - 30 * u, hd.points[0].y + 26 * u);
    }
    if (st.eraser) {
      o.setLineDash([6 * u, 5 * u]); o.strokeStyle = '#fff'; o.lineWidth = 2 * u;
      o.beginPath(); o.arc(st.eraser.x, st.eraser.y, st.eraser.r, 0, Math.PI * 2); o.stroke(); o.setLineDash([]);
    } else if (st.cursor) {
      const r = painter.radius(), stopped = st.paused;
      o.lineWidth = 2 * u;
      o.strokeStyle = stopped ? '#ff5a36' : st.mode === 'size' ? '#ffffff' : painter.color;
      o.beginPath(); o.arc(st.cursor.x, st.cursor.y, r, 0, Math.PI * 2); o.stroke();
      o.fillStyle = stopped ? '#ff5a36' : painter.color;
      o.beginPath(); o.arc(st.cursor.x, st.cursor.y, Math.max(2 * u, Math.min(r * 0.3, 5 * u)), 0, Math.PI * 2); o.fill();
      if (st.mode === 'size') { o.fillStyle = '#fff'; o.font = `600 ${15 * u}px ui-monospace, monospace`; o.fillText(`${Math.round(r * 2)} px`, st.cursor.x + r + 8 * u, st.cursor.y + 5 * u); }
    }
  }, [engine, painter, clean]);

  if (import.meta.env.DEV) (window as unknown as { __gesture: Record<string, unknown> }).__gesture.process = process;

  // Runs once per camera frame, only while the camera is on.
  useEffect(() => {
    const v = srcEl;
    if (!live || !v) return;
    let stopped = false, id = 0;
    const rvfc = 'requestVideoFrameCallback' in v;
    const loop = () => { if (stopped) return; process(); id = rvfc ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop); };
    id = rvfc ? v.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    return () => { stopped = true; if (rvfc) v.cancelVideoFrameCallback(id); else cancelAnimationFrame(id); engine.reset(); };
  }, [live, srcEl, process, engine]);

  // The panel reads the engine ten times a second, not every frame.
  useEffect(() => {
    const id = setInterval(() => {
      setStatus({ ...engine.status });
      setBrush((b) => (Math.abs(b.size - painter.size) > 1e-4 ? { ...b, size: painter.size } : b));
    }, 100);
    return () => clearInterval(id);
  }, [engine, painter]);

  // Undo, redo and stop without the hands too.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) painter.redo(); else painter.undo(); refresh(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); painter.redo(); refresh(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [painter]);

  const finishTutorial = () => { writeSeen(); setTutorial(false); painter.clear(false); engine.reset(); refresh(); };
  const savePng = async () => { downloadBlob(await painter.toBlob(), `${p.projectName || 'airfx'}-drawing.png`); setNote('Saved a transparent PNG of the drawing.'); };
  const useInEffects = async () => p.onUseInEffects(new File([await painter.toBlob()], `${p.projectName || 'gesture'}-drawing.png`, { type: 'image/png' }));

  const toggleRecord = async () => {
    if (rec.on) {
      setRec((r) => ({ ...r, on: false }));
      const r = recorder.current;
      recorder.current = null;
      try {
        const blob = await r!.stop();
        downloadBlob(blob, `${p.projectName || 'airfx'}-gesture.${r!.mp4 ? 'mp4' : 'webm'}`);
        setNote(`Saved a recording: ${r!.frames} frames${r!.skipped ? `, ${r!.skipped} skipped while the encoder was busy` : ''}.`);
      } catch (e) { setNote(`Recording failed: ${(e as Error).message}`); }
      return;
    }
    if (!srcEl) return;
    const r = new LiveRecorder(clean.width, clean.height, 8_000_000);
    try { await r.start(false); } catch (e) { setNote(`Recording could not start: ${(e as Error).message}`); return; }
    recorder.current = r;
    setRec((x) => ({ ...x, on: true, t0: performance.now() }));
    setNote('');
  };

  const st = status;
  const stateText = !live ? 'Camera off' : !handsReady ? 'Load hand tracking' : st.paused ? 'Stopped (left fist)' : st.mode === 'draw' ? 'Drawing' : st.mode === 'erase' ? 'Erasing' : st.mode === 'size' ? 'Changing size' : 'Ready';

  return (
    <div className="app app--gesture">
      <TopBar mode="gesture" onMode={p.onMode} projectName={p.projectName} onProjectName={p.onProjectName} canExport={false} canNew={painter.canUndo}
        canUndo={painter.canUndo} canRedo={painter.canRedo} onImport={() => p.onMode('effects')} onUndo={() => { painter.undo(); refresh(); }} onRedo={() => { painter.redo(); refresh(); }}
        onNewProject={() => { painter.clear(); refresh(); }} onExport={() => undefined} projectMenu={p.projectMenu} />

      <aside className="sidebar sidebar--left" aria-label="Gesture Studio">
        <div className="panel-head">
          <div><span className="label label--dim">Workspace</span><h2 className="panel-title">Gesture Studio</h2></div>
          {on && <span className="camlight" role="status"><i />Camera On</span>}{clip && <span className="camlight" role="status"><i />Video File</span>}
        </div>
        <div className="sidebar__scroll">
          <input ref={clipInput} type="file" accept="video/*" hidden aria-label="Video clip to use instead of the camera" onChange={(e) => { const f = e.target.files?.[0]; if (f) openClip(f); e.target.value = ''; }} />
          {!live && (
            <fieldset className="group">
              <legend className="group__title">Camera</legend>
              <p className="small muted">Paint with your hands in front of the webcam. The browser asks for permission first. Nothing is uploaded, and the camera stops when you leave this workspace.</p>
              <button className="btn btn--accent btn--lg btn--block" disabled={camera.status === 'asking'} onClick={() => camera.start()}>{camera.status === 'asking' ? 'Waiting For Permission…' : 'Enable Camera'}</button>
              {camera.message && <p className="small error">{camera.message}</p>}
              <button className="btn btn--sm btn--block" style={{ marginTop: 8 }} onClick={() => clipInput.current?.click()} title="Rehearse or test with a recording of your hands">Use A Video File Instead</button>
            </fieldset>
          )}
          {clip && (
            <fieldset className="group">
              <legend className="group__title">Video File</legend>
              <p className="small muted">Painting from <b>{clip.name}</b>, looping. Turn Mirror View off if the clip was not filmed as a selfie.</p>
              <div className="toolgrid">
                <button className="btn btn--sm" onClick={() => clipInput.current?.click()}>Another File</button>
                <button className="btn btn--sm" onClick={() => setClip(null)}>Back To Camera</button>
              </div>
            </fieldset>
          )}
          <fieldset className="group">
            <legend className="group__title">Hand Tracking</legend>
            <VisionCard task="hands" />
            <div className="gs-state" role="status">
              <span><b>L</b> {GESTURE_LABEL[st.left]}</span><span><b>R</b> {GESTURE_LABEL[st.right]}</span><span className={st.paused ? 'error' : 'ok'}>{stateText}</span>
            </div>
          </fieldset>

          <fieldset className="group">
            <legend className="group__title">Brush</legend>
            <div className="segmented segmented--3 segmented--compact">
              {(['spray', 'soft', 'solid'] as BrushKind[]).map((k) => <button key={k} className={brush.kind === k ? 'on' : ''} onClick={() => setBrush({ ...brush, kind: k })}>{k === 'spray' ? 'Spray' : k === 'soft' ? 'Soft' : 'Solid'}</button>)}
            </div>
            <div className="ctl" style={{ marginTop: 10 }}>
              <span className="label">Colours · left V sign for next</span>
              <div className="gs-swatches">
                {palette.map((c, i) => <button key={i} className={i === colorIndex ? 'on' : ''} style={{ background: c }} aria-label={`Colour ${i + 1}`} onClick={() => setColorIndex(i)} />)}
              </div>
            </div>
            <div className="ctl ctl--inline"><label className="label" htmlFor="gs-color">Custom Colour</label>
              <span className="color"><input id="gs-color" type="color" value={palette[colorIndex]} onChange={(e) => setPalette(palette.map((c, i) => (i === colorIndex ? e.target.value : c)))} /></span></div>
            <Slider label="Size" value={brush.size} min={0.003} max={0.15} step={0.001} fmt={() => `${Math.round(painter.radius() * 2)} px`} onChange={(v) => setBrush({ ...brush, size: v })} hint="Or pinch with your right hand and move up or down" />
            <Slider label="Opacity" value={brush.opacity} min={0.05} onChange={(v) => setBrush({ ...brush, opacity: v })} />
            {brush.kind !== 'solid' && <Slider label={brush.kind === 'spray' ? 'Spray Flow' : 'Softness Build-Up'} value={brush.flow} min={0.05} onChange={(v) => setBrush({ ...brush, flow: v })} hint="How fast paint builds up while the brush stays in one place" />}
          </fieldset>

          <fieldset className="group">
            <legend className="group__title">Tracking</legend>
            <Slider label="Sensitivity" value={settings.sensitivity} onChange={(v) => setSettings({ ...settings, sensitivity: v })} hint="Higher finds hands more eagerly and reacts to a gesture sooner. Lower ignores passing shapes." />
            <Slider label="Stroke Smoothness" value={settings.smoothing} onChange={(v) => setSettings({ ...settings, smoothing: v })} hint="Higher removes more fingertip jitter" />
            <Slider label="Drawing Speed" value={settings.speed} min={0.05} onChange={(v) => setSettings({ ...settings, speed: v })} hint="How quickly the brush catches up with your fingertip. Lower gives slow, flowing lines." />
            <div className="ctl ctl--inline"><span className="label">Mirror View</span><button role="switch" aria-checked={settings.mirror} className={`switch ${settings.mirror ? 'switch--on' : ''}`} onClick={() => setSettings({ ...settings, mirror: !settings.mirror })}><span className="switch__knob" /><span className="switch__txt">{settings.mirror ? 'ON' : 'OFF'}</span></button></div>
            <div className="ctl ctl--inline" title="Calibration sets this. Turn it on if your hands are labelled the wrong way round."><span className="label">Swap Left / Right</span><button role="switch" aria-checked={settings.swapHands} className={`switch ${settings.swapHands ? 'switch--on' : ''}`} onClick={() => setSettings({ ...settings, swapHands: !settings.swapHands })}><span className="switch__knob" /><span className="switch__txt">{settings.swapHands ? 'ON' : 'OFF'}</span></button></div>
            <div className="ctl ctl--inline"><span className="label">Show Hands</span><button role="switch" aria-checked={look.skeleton} className={`switch ${look.skeleton ? 'switch--on' : ''}`} onClick={() => setLook({ ...look, skeleton: !look.skeleton })}><span className="switch__knob" /><span className="switch__txt">{look.skeleton ? 'ON' : 'OFF'}</span></button></div>
          </fieldset>

          <fieldset className="group">
            <legend className="group__title">Background</legend>
            <div className="segmented segmented--3 segmented--compact">
              {(['camera', 'black', 'white'] as Backdrop[]).map((b) => <button key={b} className={look.backdrop === b ? 'on' : ''} onClick={() => setLook({ ...look, backdrop: b })}>{b[0].toUpperCase() + b.slice(1)}</button>)}
            </div>
            {look.backdrop === 'camera' && <Slider label="Camera Brightness" value={look.camOpacity} min={0.1} onChange={(v) => setLook({ ...look, camOpacity: v })} />}
          </fieldset>

          <fieldset className="group">
            <legend className="group__title">Drawing</legend>
            <div className="toolgrid">
              <button className="btn btn--sm" disabled={!painter.canUndo} onClick={() => { painter.undo(); refresh(); }}>Undo</button>
              <button className="btn btn--sm" disabled={!painter.canRedo} onClick={() => { painter.redo(); refresh(); }}>Redo</button>
              <button className="btn btn--sm" onClick={() => { painter.clear(); refresh(); }}>Clear Canvas</button>
              <button className="btn btn--sm" onClick={savePng}>Save PNG</button>
              <button className={`btn btn--sm ${rec.on ? 'btn--danger' : ''}`} disabled={!live} onClick={toggleRecord}>{rec.on ? `Stop · ${Math.floor((performance.now() - rec.t0) / 1000)} s` : 'Record Video'}</button>
              <button className="btn btn--sm" onClick={useInEffects} title="Open the drawing in Effects as a new picture">Use In Effects</button>
            </div>
            <p className="small muted">The PNG is the paint only, on a transparent background. The video records what the stage shows, without the hand outlines and cursor.</p>
            {note && <p className="small ok">{note}</p>}
          </fieldset>

          <fieldset className="group">
            <legend className="group__title">Gestures</legend>
            <ul className="gs-gestures">
              <li><HandGlyph pose="point" size={26} /><span>Draw</span></li>
              <li><HandGlyph pose="pinch" size={26} /><span>Pinch, move up / down: size</span></li>
              <li><HandGlyph pose="open" size={26} /><span>Erase</span></li>
              <li><HandGlyph pose="fist" side="left" size={26} /><span>Stop drawing</span></li>
              <li><HandGlyph pose="open" side="left" size={26} /><span>Resume</span></li>
              <li><HandGlyph pose="victory" side="left" size={26} /><span>Next colour</span></li>
            </ul>
            <button className="btn btn--sm btn--block" onClick={() => setTutorial(true)}>Replay Tutorial</button>
          </fieldset>
        </div>
      </aside>

      <main className="workspace gs-stage">
        <canvas ref={view} className="gs-view" aria-label="Gesture Studio stage" />
        {!live && !tutorial && <div className="gs-empty"><HandGlyph pose="point" size={64} /><p>Enable the camera to start painting.</p></div>}
        {live && !handsReady && !tutorial && <div className="gs-empty"><p>Load Hand Tracking in the panel to start painting.</p></div>}
        {rec.on && <span className="gs-rec">● REC</span>}
        {tutorial && <Tutorial engine={engine} status={st} cameraOn={live} handsReady={handsReady} onSwap={(s) => setSettings((x) => ({ ...x, swapHands: s }))} onClearPractice={() => painter.clear(false)} onDone={finishTutorial} />}
      </main>
    </div>
  );
}
