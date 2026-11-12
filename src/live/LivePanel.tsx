import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { ai } from '../ai/client';
import { EffectSidebar } from '../components/EffectSidebar';
import { ModelCard, useModels } from '../components/Workspaces';
import { presets } from '../presets/store';
import { downloadBlob } from '../utils/exportUtils';
import { formatTime } from '../utils/videoProcessing';
import { LiveRecorder, camera, liveDepth, type CameraSettings } from './camera';

const SIZES: [string, number, number][] = [['640 × 480', 640, 480], ['1280 × 720', 1280, 720], ['1920 × 1080', 1920, 1080], ['3840 × 2160', 3840, 2160]];

export interface LiveProps {
  processedRef: RefObject<HTMLCanvasElement>;
  /** Registers the function called with the preview canvas after each frame. */
  setFrameSink: (f: ((c: HTMLCanvasElement) => void) | null) => void;
  activeEffect: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (id: string) => void;
  /** Next click on the preview picks a colour to track. */
  picking: boolean;
  onPick: () => void;
}

export function LivePanel(p: LiveProps) {
  useSyncExternalStore(camera.subscribe, camera.getVersion);
  useModels();
  const [page, setPage] = useState<'camera' | 'effects'>('camera');
  const [form, setForm] = useState<CameraSettings>(camera.settings);
  const [mic, setMic] = useState(false);
  const [mbps, setMbps] = useState(12);
  const [rec, setRec] = useState<{ r: LiveRecorder; t0: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<LiveRecorder | null>(null);
  const on = camera.live, s = camera.status, media = camera.media;

  useEffect(() => {
    if (!rec) return;
    const id = setInterval(() => setElapsed((performance.now() - rec.t0) / 1000), 200);
    return () => clearInterval(id);
  }, [rec]);
  // Leaving the workspace or unmounting ends a recording cleanly.
  useEffect(() => () => { recorder.current?.cancel(); p.setFrameSink(null); }, []);

  const change = (patch: Partial<CameraSettings>) => {
    const next = { ...form, ...patch };
    setForm(next);
    if (on) camera.start(next);
  };
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const snapshot = () => {
    p.processedRef.current?.toBlob((b) => {
      if (!b) return;
      const name = `airfx_live_${stamp()}.png`;
      downloadBlob(b, name);
      setNote(`Saved ${name}`);
    }, 'image/png');
  };
  const startRec = async () => {
    if (!media) return;
    setError(null);
    setNote(null);
    try {
      const r = new LiveRecorder(media.width, media.height, mbps * 1e6);
      await r.start(mic);
      recorder.current = r;
      p.setFrameSink((c) => r.add(c));
      setRec({ r, t0: performance.now() });
      setElapsed(0);
    } catch (e) { setError((e as Error).message); }
  };
  const stopRec = async () => {
    if (!rec) return;
    p.setFrameSink(null);
    recorder.current = null;
    const r = rec.r;
    setRec(null);
    try {
      const blob = await r.stop();
      const name = `airfx_live_${stamp()}.${r.mp4 ? 'mp4' : 'webm'}`;
      downloadBlob(blob, name);
      setNote(`Saved ${name} · ${(blob.size / 1048576).toFixed(1)} MB · ${r.frames} frames${r.skipped ? ` · ${r.skipped} skipped` : ''}`);
    } catch (e) { setError((e as Error).message); }
  };
  const depthReady = ai.state('depth').status === 'ready';
  const saveCamera = () => { presets.add({ name: `Camera ${form.width}×${form.height} @ ${form.fps}`, kind: 'camera', camera: { ...form } }); setNote('Saved to Presets.'); };

  return (
    <aside className="sidebar sidebar--left" aria-label="AirFx Live">
      <div className="panel-head">
        <div><span className="label label--dim">Workspace</span><h2 className="panel-title">AirFx Live</h2></div>
        {on && <span className="camlight" role="status"><i />{s === 'paused' ? 'Paused' : 'Camera On'}</span>}
      </div>
      {on && (
        <div className="segmented segmented--2 segmented--compact livetabs">
          <button className={page === 'camera' ? 'on' : ''} onClick={() => setPage('camera')}>Camera</button>
          <button className={page === 'effects' ? 'on' : ''} onClick={() => setPage('effects')}>Effects</button>
        </div>
      )}
      {on && page === 'effects' ? (
        <EffectSidebar embedded activeId={p.activeEffect} onSelect={p.onSelect} onAdd={p.onAdd} onWorkspace={() => undefined} />
      ) : (
        <div className="sidebar__scroll">
          {!on && (
            <fieldset className="group">
              <legend className="group__title">Use Your Camera</legend>
              <p className="small muted">AirFx uses your webcam as a live source for effects. Video stays on this computer and is never uploaded or saved unless you record. The browser asks for permission first, and the camera stops when you close it or leave this workspace.</p>
              <button className="btn btn--accent btn--lg btn--block" disabled={s === 'asking'} onClick={() => camera.start(form)}>{s === 'asking' ? 'Waiting For Permission…' : 'Enable Camera'}</button>
              {camera.message && <p className={`small ${s === 'error' || s === 'denied' ? 'error' : 'warn'}`}>{camera.message}</p>}
            </fieldset>
          )}
          <fieldset className="group">
            <legend className="group__title">Camera</legend>
            {camera.devices.length > 0 && (
              <div className="ctl"><label className="label" htmlFor="cam-dev">Device</label>
                <select id="cam-dev" className="select" value={form.deviceId} onChange={(e) => change({ deviceId: e.target.value })}>
                  <option value="">Default</option>
                  {camera.devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                </select></div>
            )}
            <div className="ctl"><span className="label">Facing</span>
              <div className="segmented segmented--2 segmented--compact">
                <button className={form.facing === 'user' ? 'on' : ''} onClick={() => change({ facing: 'user', deviceId: '' })}>Front</button>
                <button className={form.facing === 'environment' ? 'on' : ''} onClick={() => change({ facing: 'environment', deviceId: '' })}>Rear</button>
              </div></div>
            <div className="ctl"><label className="label" htmlFor="cam-res">Resolution</label>
              <select id="cam-res" className="select" value={`${form.width}x${form.height}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); change({ width: w, height: h }); }}>
                {SIZES.map(([l, w, h]) => <option key={l} value={`${w}x${h}`}>{l}</option>)}
              </select></div>
            <div className="ctl"><label className="label" htmlFor="cam-fps">Frame Rate</label>
              <select id="cam-fps" className="select" value={form.fps} onChange={(e) => change({ fps: Number(e.target.value) })}>
                {[24, 30, 60].map((n) => <option key={n} value={n}>{n} fps</option>)}
              </select></div>
            {camera.measured && <p className="small muted">Camera gave {camera.measured.width} × {camera.measured.height} at {Math.round(camera.measured.fps)} fps.</p>}
            <button className="btn btn--sm btn--block" onClick={saveCamera}>Save Camera Preset</button>
          </fieldset>
          {on && (
            <>
              <fieldset className="group">
                <legend className="group__title">Feed</legend>
                <div className="audio__buttons">
                  <button className="btn btn--sm" onClick={() => camera.pause()}>{s === 'paused' ? 'Resume' : 'Pause'}</button>
                  <button className="btn btn--sm" onClick={() => camera.start()}>Restart</button>
                </div>
                <button className="btn btn--sm btn--block" onClick={() => { if (rec) stopRec(); camera.stop(); }}>Close Camera</button>
              </fieldset>
              <fieldset className="group">
                <legend className="group__title">Capture</legend>
                <button className="btn btn--sm btn--block" onClick={snapshot}>Take Snapshot</button>
                {rec ? (
                  <button className="btn btn--sm btn--block btn--accent" onClick={stopRec}>Stop Recording · {formatTime(elapsed).slice(0, 5)}</button>
                ) : (
                  <>
                    <button className="btn btn--sm btn--block" onClick={startRec}>Record</button>
                    <div className="ctl__row"><span className="label">Bitrate</span>
                      <select className="select select--compact" aria-label="Recording bitrate" value={mbps} onChange={(e) => setMbps(Number(e.target.value))}>{[6, 12, 20, 40].map((n) => <option key={n} value={n}>{n} Mbps</option>)}</select>
                    </div>
                    <label className="ctl ctl--inline"><span className="label">Record Microphone</span><input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} /></label>
                  </>
                )}
                <p className="small muted">Records the processed picture you see, with its effects.</p>
                {note && <p className="small ok">{note}</p>}
                {error && <p className="small error">{error}</p>}
              </fieldset>
              <fieldset className="group">
                <legend className="group__title">Tracking</legend>
                <p className="small muted">Add Blob Tracker from Effects, set Custom Content to a word, PNG or icon, then pick what it follows: Motion, Nearest (Depth) or Target Color.</p>
                <button className={`btn btn--sm btn--block ${p.picking ? 'btn--on' : ''}`} onClick={p.onPick}>{p.picking ? 'Click The Preview…' : 'Pick Color To Track'}</button>
              </fieldset>
              <fieldset className="group">
                <legend className="group__title">Live Depth</legend>
                <p className="small muted">Updates depth beside the picture, for AirFx Depth, Depth Particles and tracking the nearest subject.</p>
                <ModelCard model="depth" />
                <button className="btn btn--sm btn--block" disabled={!depthReady} onClick={() => (liveDepth.running ? liveDepth.stop() : liveDepth.start())}>{liveDepth.running ? `Stop · ${liveDepth.mapsPerSecond.toFixed(1)} maps/s` : 'Start Live Depth'}</button>
              </fieldset>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
