import { useState } from 'react';
import { baseName, downloadBlob } from '../../utils/exportUtils';
import { offlineSupported, type ExportProgress } from '../../export/offline';
import { ExportStatus, SizePicker, VideoSettingsPanel, useAbortOnUnmount, useSize, useVideoSettings } from '../../export/ExportControls';
import { formatTime } from '../../utils/videoProcessing';
import { exportCompFrame, exportComposition } from '../exportComp';
import type { Composition } from '../model';

interface Props {
  comp: Composition;
  time: number;
  projectName: string;
  song: { url: string; name: string; cors: boolean } | null;
  onBefore: () => void;
  onClose: () => void;
}

export function CompExportDialog({ comp, time, projectName, song, onBefore, onClose }: Props) {
  const stem = baseName(projectName || 'airfx');
  const size = useSize(comp.width, comp.height, true, 'original');
  const { w: W, h: H } = size;
  const v = useVideoSettings(W, H, null, `${stem}_timeline`);
  const [soundtrack, setSoundtrack] = useState<'song' | 'none'>(song ? 'song' : 'none');
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [msg, setMsg] = useState('');
  const abort = useAbortOnUnmount();

  const runVideo = async () => {
    if (!v.choice) return;
    onBefore();
    abort.current = new AbortController();
    setState('running');
    setMsg('');
    setProgress(null);
    try {
      const blob = await exportComposition({
        comp, scale: W / comp.width, fps: v.fps, bitrate: v.mbps * 1e6, choice: v.choice, audioBitrate: v.audioKbps * 1000, soundtrack,
        songUrl: song?.url ?? null, signal: abort.current.signal, onProgress: setProgress,
      });
      const name = `${v.file}.${v.choice.container}`;
      downloadBlob(blob, name);
      setMsg(`Saved ${name} (${(blob.size / 1048576).toFixed(2)} MB)`);
      setState('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') setState('idle');
      else { setMsg((e as Error).message); setState('error'); }
    }
  };

  const runFrame = async () => {
    try {
      const blob = await exportCompFrame(comp, time, Math.min(1, 8192 / Math.max(comp.width, comp.height)));
      const name = `${stem}_frame_${time.toFixed(2)}s.png`;
      downloadBlob(blob, name);
      setMsg(`Saved ${name}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const running = state === 'running';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cexp">
        <div className="modal__head">
          <h2 id="cexp" className="panel-title">Export Timeline</h2>
          <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close (Esc)">×</button>
        </div>
        <p className="muted small">{comp.layers.length} layers · {comp.width}×{comp.height} · {formatTime(comp.duration)}</p>

        {!offlineSupported() ? (
          <p className="error">This browser has no WebCodecs video encoder. Use a recent Chrome or Edge.</p>
        ) : (
          <div className="export">
            <div className="ctl">
              <span className="label">Soundtrack</span>
              <div className="segmented segmented--2">
                <button className={soundtrack === 'none' ? 'on' : ''} disabled={running} onClick={() => setSoundtrack('none')}>Silent</button>
                <button className={soundtrack === 'song' ? 'on' : ''} disabled={running || !song} onClick={() => setSoundtrack('song')}>{song ? `Song · ${song.name}` : 'No song loaded'}</button>
              </div>
            </div>
            <SizePicker sw={comp.width} sh={comp.height} size={size} disabled={running} max={8192} />
            <VideoSettingsPanel v={v} disabled={running} sourceFps={null} audio={soundtrack === 'song'} transparent={false} duration={comp.duration} />
            <ExportStatus p={progress} running={running} />
            {running ? (
              <button className="btn btn--lg btn--block" onClick={() => abort.current?.abort()}>Cancel Export</button>
            ) : (
              <button className="btn btn--accent btn--lg btn--block" disabled={!v.choice} onClick={runVideo}>{state === 'done' ? 'Export Again' : `Render ${Math.round(comp.duration * v.fps)} Frames · ${W} × ${H}`}</button>
            )}
          </div>
        )}
        <button className="btn btn--block" disabled={running} onClick={runFrame}>Save Current Frame as PNG ({formatTime(time)})</button>
        {msg && <p className={state === 'error' ? 'error small' : 'ok small'}>{msg}</p>}
      </div>
    </div>
  );
}
