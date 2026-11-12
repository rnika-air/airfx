import { useEffect, useState } from 'react';
import type { StackItem } from '../effects/types';
import { hasActiveMods } from '../effects/types';
import { getEffect } from '../effects/registry';
import { layersOf } from '../hooks/useEffectState';
import type { LoadedMedia } from '../hooks/useMedia';
import { MAX_EXPORT_EDGE, baseName, downloadBlob, exportImage } from '../utils/exportUtils';
import { ensureContentReady } from '../content/content';
import { exportOffline, inspectFile, offlineSupported, probeVideo, type ExportProgress, type SoundtrackChoice, type VideoProbe } from '../export/offline';
import { ExportStatus, SizePicker, VideoSettingsPanel, useAbortOnUnmount, useSize, useVideoSettings } from '../export/ExportControls';
import { formatTime } from '../utils/videoProcessing';

/** What the export dialog needs to know about the loaded song, if any. */
export interface SongInfo {
  url: string;
  name: string;
  duration: number;
  cors: boolean;
}

interface Props {
  media: LoadedMedia;
  items: StackItem[];
  song: SongInfo | null;
  /** Current transport time — still exports capture this moment. */
  time: number;
  /** Default length for animating a still without a song. */
  loopLength: number;
  micActive: boolean;
  projectName: string;
  onClose: () => void;
  onBeforeVideoExport: () => void;
}

type Tab = 'image' | 'video';

export function ExportDialog(p: Props) {
  const { media, items, projectName, onClose } = p;
  const isVideo = media.kind === 'video';
  const active = items.filter((i) => i.enabled);
  const animated = active.some((i) => getEffect(i.effectId)?.animated?.(i.params));
  const canVideo = isVideo || !!p.song || animated || active.some((i) => hasActiveMods(i.mods));
  const [tab, setTab] = useState<Tab>(isVideo || p.song ? 'video' : 'image');
  const stem = `${baseName(projectName || media.name)}_${active.length ? (active.length > 1 ? 'stack' : active[0].effectId) : 'original'}`;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="modal__head">
          <h2 id="export-title" className="panel-title">Export</h2>
          <button className="btn btn--icon btn--sm" onClick={onClose} aria-label="Close (Esc)">×</button>
        </div>
        <div className="segmented segmented--2" role="tablist">
          <button role="tab" aria-selected={tab === 'image'} className={tab === 'image' ? 'on' : ''} onClick={() => setTab('image')}>
            {isVideo ? 'Still Frame' : 'Image'}
          </button>
          <button
            role="tab"
            aria-selected={tab === 'video'}
            className={tab === 'video' ? 'on' : ''}
            disabled={!canVideo}
            title={canVideo ? undefined : 'Add a song, link audio, or pick an animated effect to export a still as video.'}
            onClick={() => setTab('video')}
          >
            {isVideo ? 'Video' : 'Animation'}
          </button>
        </div>
        <p className="muted small">
          {active.length > 1 ? 'Stack' : 'Effect'}: <strong>{active.length ? active.map((i) => getEffect(i.effectId)?.name).join(' → ') : 'None (original)'}</strong> · rendered at export resolution, independent of the preview.
        </p>
        {tab === 'image' ? (
          <ImageExport media={media} items={active} stem={stem} time={p.time} />
        ) : (
          <VideoExport {...p} stem={stem} />
        )}
      </div>
    </div>
  );
}

function ImageExport({ media, items, stem, time }: { media: LoadedMedia; items: StackItem[]; stem: string; time: number }) {
  const transparency = items.some((i) => getEffect(i.effectId)?.supportsTransparency);
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [quality, setQuality] = useState(0.92);
  const size = useSize(media.width, media.height, false, 'original');
  const { w: width, h: height } = size;
  const [matte, setMatte] = useState('#ffffff');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const tooBig = width > MAX_EXPORT_EDGE || height > MAX_EXPORT_EDGE;

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await ensureContentReady(items);
      const blob = await exportImage({ source: media.element, layers: layersOf(items), width, height, format, quality, matte, time });
      const name = `${stem}_${width}x${height}.${format === 'jpeg' ? 'jpg' : format}`;
      downloadBlob(blob, name);
      setMsg({ kind: 'ok', text: `Saved ${name} (${(blob.size / 1024 / 1024).toFixed(2)} MB)` });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="export">
      <div className="ctl">
        <span className="label">Format</span>
        <div className="segmented segmented--3">
          <button className={format === 'png' ? 'on' : ''} onClick={() => setFormat('png')}>PNG</button>
          <button className={format === 'jpeg' ? 'on' : ''} onClick={() => setFormat('jpeg')}>JPEG</button>
          <button className={format === 'webp' ? 'on' : ''} onClick={() => setFormat('webp')}>WebP</button>
        </div>
      </div>
      {format !== 'png' && (
        <div className="ctl">
          <div className="ctl__row"><span className="label">Quality</span><span className="ctl__num">{Math.round(quality * 100)}</span></div>
          <input type="range" className="slider" aria-label="Image quality" min={0.3} max={1} step={0.01} value={quality} style={{ ['--pct' as string]: `${((quality - 0.3) / 0.7) * 100}%` }} onChange={(e) => setQuality(parseFloat(e.target.value))} />
        </div>
      )}
      {format === 'jpeg' && transparency && (
        <div className="ctl ctl--inline">
          <span className="label">Matte (for transparency)</span>
          <input type="color" value={matte} onChange={(e) => setMatte(e.target.value)} />
        </div>
      )}
      {format !== 'jpeg' && transparency && <p className="muted small">{format.toUpperCase()} keeps transparency when the stack leaves transparent pixels.</p>}
      <SizePicker sw={media.width} sh={media.height} size={size} max={MAX_EXPORT_EDGE} />
      <button className="btn btn--accent btn--lg btn--block" disabled={busy || tooBig} onClick={run}>
        {busy ? 'Rendering…' : `Export ${format.toUpperCase()} · ${width} × ${height}`}
      </button>
      {msg && <p className={msg.kind === 'ok' ? 'ok small' : 'error small'}>{msg.text}</p>}
    </div>
  );
}

type LengthMode = 'media' | 'song' | 'custom';

function VideoExport({ media, items, song, loopLength, micActive, stem, onBeforeVideoExport }: Props & { stem: string }) {
  const isVideo = media.kind === 'video';
  const [probe, setProbe] = useState<VideoProbe | null>(null);
  useEffect(() => {
    if (!isVideo) return;
    let live = true;
    probeVideo(media.url).then((r) => live && setProbe(r));
    return () => { live = false; };
  }, [isVideo, media.url]);
  const size = useSize(media.width, media.height, true, 'original');
  const { w, h } = size;
  const v = useVideoSettings(w, h, probe?.fps ?? null, stem);
  const [lengthMode, setLengthMode] = useState<LengthMode>(song ? 'song' : isVideo ? 'media' : 'custom');
  const [customLen, setCustomLen] = useState(Math.round(loopLength * 10) / 10 || 8);
  const [soundtrack, setSoundtrack] = useState<SoundtrackChoice>(song ? 'song' : isVideo ? 'original' : 'none');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; name: string; size: number; check: Awaited<ReturnType<typeof inspectFile>> } | null>(null);
  const abort = useAbortOnUnmount();

  const duration = lengthMode === 'song' && song ? song.duration : lengthMode === 'media' && isVideo ? media.duration : customLen;
  const linked = items.some((i) => i.enabled && hasActiveMods(i.mods));
  const transparent = items.some((i) => i.enabled && getEffect(i.effectId)?.supportsTransparency && (i.params.transparent === true || i.params.bgMode === 'transparent'));
  const hasSound = soundtrack !== 'none' && (soundtrack !== 'original' || probe?.hasAudio !== false);

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  if (!offlineSupported()) return <p className="error">This browser has no WebCodecs video encoder. Use a recent Chrome or Edge.</p>;

  const run = async () => {
    if (!v.choice) return;
    onBeforeVideoExport();
    abort.current = new AbortController();
    setState('running');
    setError('');
    setResult(null);
    setProgress(null);
    try {
      const blob = await exportOffline({
        source: isVideo ? { kind: 'video', url: media.url, duration: media.duration } : { kind: 'image', element: media.element },
        items: song ? items : items.map((i) => ({ ...i, mods: {} })),
        width: w, height: h, fps: v.fps, bitrate: v.mbps * 1e6, choice: v.choice, duration,
        soundtrack, songUrl: song?.url ?? null, audioBitrate: v.audioKbps * 1000, keepAlpha: v.keepAlpha,
        signal: abort.current.signal, onProgress: setProgress,
      });
      const name = `${v.file}.${v.choice.container}`;
      const check = await inspectFile(blob).catch(() => null);
      setResult({ url: URL.createObjectURL(blob), name, size: blob.size, check });
      downloadBlob(blob, name);
      setState('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setState('idle'); setProgress(null); }
      else { setError((e as Error).message); setState('error'); }
    }
  };

  const running = state === 'running';
  const lengthOptions: { value: LengthMode; label: string }[] = [
    ...(isVideo ? [{ value: 'media' as const, label: `Video ${formatTime(media.duration)}` }] : []),
    ...(song ? [{ value: 'song' as const, label: `Song ${formatTime(song.duration)}` }] : []),
    { value: 'custom', label: 'Custom' },
  ];
  const soundOptions: { value: SoundtrackChoice; label: string }[] = [
    { value: 'none', label: 'Silent' },
    ...(isVideo ? [{ value: 'original' as const, label: 'Original' }] : []),
    ...(song ? [{ value: 'song' as const, label: 'Song' }] : []),
  ];

  return (
    <div className="export">
      {song && <p className="small ok">∿ Audio-reactive: <strong>{song.name}</strong> drives {linked ? 'your linked parameters' : 'nothing yet: link sliders in the Audio tab'} during export.</p>}
      {micActive && !song && <p className="small warn">Microphone input is preview-only. Load a song file to export an audio-reactive video.</p>}
      {probe && <p className="small muted">Source: {probe.width}×{probe.height} · {Math.round(probe.fps * 100) / 100} fps · {probe.codec ?? 'unknown'}{probe.hasAudio ? ' · audio' : ' · no audio'}{probe.decodable ? '' : ' · slower decoding'}</p>}
      <div className="ctl">
        <span className="label">Length</span>
        <div className={`segmented segmented--${lengthOptions.length}`}>
          {lengthOptions.map((o) => <button key={o.value} className={lengthMode === o.value ? 'on' : ''} disabled={running} onClick={() => setLengthMode(o.value)}>{o.label}</button>)}
        </div>
        {lengthMode === 'custom' && (
          <div className="size-row"><label className="size-row__field"><span className="label label--dim">Seconds</span>
            <input className="num" type="number" min={0.5} max={600} step={0.5} value={customLen} disabled={running} onChange={(e) => setCustomLen(Math.min(600, Math.max(0.5, Number(e.target.value) || 1)))} /></label></div>
        )}
        {isVideo && duration > media.duration + 0.05 && <p className="small muted">The video will loop to fill {formatTime(duration)}.</p>}
      </div>
      <div className="ctl">
        <span className="label">Soundtrack</span>
        <div className={`segmented segmented--${soundOptions.length}`}>
          {soundOptions.map((o) => <button key={o.value} className={soundtrack === o.value ? 'on' : ''} disabled={running} onClick={() => setSoundtrack(o.value)}>{o.label}</button>)}
        </div>
        {soundtrack === 'original' && probe && !probe.hasAudio && <p className="small muted">This clip has no audio track.</p>}
      </div>
      <SizePicker sw={media.width} sh={media.height} size={size} disabled={running} max={8192} />
      <VideoSettingsPanel v={v} disabled={running} sourceFps={probe?.fps ?? null} audio={hasSound} transparent={transparent} duration={duration} />
      <ExportStatus p={progress} running={running} />
      {running ? (
        <button className="btn btn--lg btn--block" onClick={() => abort.current?.abort()}>Cancel Export</button>
      ) : (
        <button className="btn btn--accent btn--lg btn--block" disabled={!v.choice || !(duration > 0)} onClick={run}>
          {state === 'done' ? 'Export Again' : `Render ${Math.round(duration * v.fps)} Frames · ${w} × ${h}`}
        </button>
      )}
      {state === 'error' && <p className="error small">{error}</p>}
      {result && (
        <p className="ok small">
          Saved {result.name} ({(result.size / 1024 / 1024).toFixed(2)} MB) · <a href={result.url} download={result.name}>Download again</a>
          {result.check && <><br />Read back: {result.check.width}×{result.check.height} · {result.check.fps.toFixed(2)} fps · {result.check.frames} frames · {result.check.duration.toFixed(2)} s · {result.check.mbps.toFixed(1)} Mbps · {result.check.codec}{result.check.audio ? ` + ${result.check.audio}` : ' · no audio'}</>}
        </p>
      )}
    </div>
  );
}
