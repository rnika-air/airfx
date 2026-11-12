import { useEffect, useMemo, useRef, useState } from 'react';
import { CODECS, presetMbps, usableCodecs, type CodecChoice, type ExportProgress, type QualityPreset } from './offline';
import { formatTime } from '../utils/videoProcessing';

/* ── Resolution ─────────────────────────────────────────────────── */

export type SizeKey = 'original' | '1080' | '1440' | '2160' | 'custom';
const BOX: Record<'1080' | '1440' | '2160', [number, number, string]> = { 1080: [1920, 1080, '1080p'], 1440: [2560, 1440, '2K · 1440p'], 2160: [3840, 2160, '4K UHD'] };

/** Fits the source in a landscape or portrait box, keeping its proportions. */
export function fitBox(sw: number, sh: number, key: '1080' | '1440' | '2160') {
  const [a, b] = BOX[key], portrait = sh > sw, bw = portrait ? b : a, bh = portrait ? a : b, s = Math.min(bw / sw, bh / sh);
  return { w: Math.round(sw * s), h: Math.round(sh * s) };
}

export interface SizeState { key: SizeKey; w: number; h: number; lock: boolean }

export function useSize(sw: number, sh: number, even: boolean, initial: SizeKey) {
  const round = (v: number) => (even ? Math.max(2, Math.round(v / 2) * 2) : Math.max(1, Math.round(v)));
  const [s, set] = useState<SizeState>({ key: initial, w: sw, h: sh, lock: true });
  const size = s.key === 'custom' ? { w: s.w, h: s.h } : s.key === 'original' ? { w: sw, h: sh } : fitBox(sw, sh, s.key);
  return { s, set, w: round(size.w), h: round(size.h) };
}

/** Native, downscaled or upscaled, stated plainly. */
export function detailNote(sw: number, sh: number, w: number, h: number) {
  const k = Math.max(w / sw, h / sh);
  if (k > 1.01) return { kind: 'warn', text: `Upscaled ${k.toFixed(2)}× from ${sw}×${sh}. Effects, type and grain render natively at this size, but the source picture has no new detail.` };
  if (k < 0.99) return { kind: 'muted', text: `Downscaled from ${sw}×${sh}.` };
  return { kind: 'ok', text: 'Native source resolution.' };
}

export function SizePicker({ sw, sh, size, disabled, max }: { sw: number; sh: number; size: ReturnType<typeof useSize>; disabled?: boolean; max: number }) {
  const { s, set, w, h } = size;
  const pick = (key: SizeKey) => set({ ...s, key, w, h });
  const setW = (v: number) => set({ ...s, key: 'custom', w: v, h: s.lock ? Math.round((v / sw) * sh) : s.h });
  const setH = (v: number) => set({ ...s, key: 'custom', h: v, w: s.lock ? Math.round((v / sh) * sw) : s.w });
  const note = detailNote(sw, sh, w, h);
  return (
    <div className="ctl">
      <span className="label">Resolution</span>
      <div className="chips">
        {([['original', `Original`], ['1080', '1080p'], ['1440', '2K · 1440p'], ['2160', '4K UHD'], ['custom', 'Custom']] as [SizeKey, string][]).map(([k, l]) => (
          <button key={k} className={`chip ${s.key === k ? 'chip--on' : ''}`} disabled={disabled} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      <div className="size-row">
        <label className="size-row__field"><span className="label label--dim">W</span>
          <input className="num" type="number" min={16} max={max} value={w} disabled={disabled} aria-label="Output width" onChange={(e) => setW(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></label>
        <span className="muted">×</span>
        <label className="size-row__field"><span className="label label--dim">H</span>
          <input className="num" type="number" min={16} max={max} value={h} disabled={disabled} aria-label="Output height" onChange={(e) => setH(Math.max(1, Math.round(Number(e.target.value) || 1)))} /></label>
        <button className={`chip ${s.lock ? 'chip--on' : ''}`} disabled={disabled} onClick={() => set({ ...s, lock: !s.lock, w, h })} title="Keep the source proportions">Aspect</button>
      </div>
      <p className={`small ${note.kind === 'warn' ? 'warn' : note.kind === 'ok' ? 'ok' : 'muted'}`}>{note.text}</p>
      {!s.lock && <p className="small warn">Aspect is unlocked, so the picture will stretch.</p>}
      {(w > max || h > max) && <p className="small error">Maximum is {max} px per side.</p>}
    </div>
  );
}

/* ── Video settings ─────────────────────────────────────────────── */

export interface VideoSettings { choice: CodecChoice | null; fps: number; mbps: number; audioKbps: number; keepAlpha: boolean; name: string }

const QUALITY: [QualityPreset, string][] = [['draft', 'Draft'], ['standard', 'Standard'], ['high', 'High'], ['maximum', 'Maximum'], ['custom', 'Custom']];

export function useVideoSettings(w: number, h: number, sourceFps: number | null, stem: string) {
  const [codecId, setCodecId] = useState('h264');
  const [preset, setPreset] = useState<QualityPreset>('high');
  const [fpsKey, setFpsKey] = useState<string>('source');
  const [customFps, setCustomFps] = useState(30);
  const [customMbps, setCustomMbps] = useState(40);
  const [audioKbps, setAudioKbps] = useState(192);
  const [keepAlpha, setKeepAlpha] = useState(false);
  const [codecs, setCodecs] = useState<CodecChoice[] | null>(null);
  const [name, setName] = useState('');
  const fps = fpsKey === 'source' ? (sourceFps ? Math.round(sourceFps * 1000) / 1000 : 30) : fpsKey === 'custom' ? customFps : Number(fpsKey);
  const mbps = preset === 'custom' ? customMbps : presetMbps(preset, w, h, fps);
  useEffect(() => {
    let live = true;
    usableCodecs(w, h, mbps * 1e6).then((c) => live && setCodecs(c)).catch(() => live && setCodecs([]));
    return () => { live = false; };
  }, [w, h, mbps]);
  const choice = codecs?.find((c) => c.id === codecId) ?? codecs?.[0] ?? null;
  const file = (name.trim() || `${stem}_${w}x${h}_${Math.round(fps)}fps`).replace(/[\\/:*?"<>|]+/g, '_');
  return { codecs, choice, setCodecId, preset, setPreset, fpsKey, setFpsKey, customFps, setCustomFps, customMbps, setCustomMbps, audioKbps, setAudioKbps, keepAlpha, setKeepAlpha, fps, mbps, name, setName, file };
}

export function VideoSettingsPanel({ v, disabled, sourceFps, audio, transparent, duration }: { v: ReturnType<typeof useVideoSettings>; disabled: boolean; sourceFps: number | null; audio: boolean; transparent: boolean; duration: number }) {
  const estimate = useMemo(() => ((v.mbps * 1e6 + (audio ? v.audioKbps * 1000 : 0)) * duration) / 8 / 1048576, [v.mbps, v.audioKbps, audio, duration]);
  const fpsOptions: [string, string][] = [...(sourceFps ? [['source', `Source ${Math.round(sourceFps * 100) / 100}`] as [string, string]] : []), ['24', '24'], ['25', '25'], ['30', '30'], ['50', '50'], ['60', '60'], ['custom', 'Custom']];
  return (
    <>
      <div className="ctl">
        <label className="label" htmlFor="vcodec">Codec</label>
        <select id="vcodec" className="select" value={v.choice?.id ?? ''} disabled={disabled || !v.codecs?.length} onChange={(e) => v.setCodecId(e.target.value)}>
          {(v.codecs ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {v.codecs && v.codecs.length < CODECS.length && <p className="small muted">Not offered by this browser at this size: {CODECS.filter((c) => !v.codecs!.includes(c)).map((c) => c.label.split(' (')[0]).join(', ')}.</p>}
        {v.codecs && !v.codecs.length && <p className="small error">No encoder here can handle this size. Try a lower resolution.</p>}
      </div>
      <div className="ctl">
        <span className="label">Frame Rate</span>
        <div className="chips">
          {fpsOptions.map(([k, l]) => <button key={k} className={`chip ${v.fpsKey === k ? 'chip--on' : ''}`} disabled={disabled} onClick={() => v.setFpsKey(k)}>{l}</button>)}
        </div>
        {v.fpsKey === 'custom' && <div className="size-row"><label className="size-row__field"><span className="label label--dim">FPS</span><input className="num" type="number" min={1} max={120} step={0.001} value={v.customFps} disabled={disabled} aria-label="Custom frame rate" onChange={(e) => v.setCustomFps(Math.min(120, Math.max(1, Number(e.target.value) || 30)))} /></label></div>}
      </div>
      <div className="ctl">
        <span className="label">Quality</span>
        <div className="chips">
          {QUALITY.map(([k, l]) => <button key={k} className={`chip ${v.preset === k ? 'chip--on' : ''}`} disabled={disabled} onClick={() => v.setPreset(k)}>{l}</button>)}
        </div>
        {v.preset === 'custom' ? (
          <div className="size-row"><label className="size-row__field"><span className="label label--dim">Mbps</span><input className="num" type="number" min={1} max={400} value={v.customMbps} disabled={disabled} aria-label="Custom video bitrate" onChange={(e) => v.setCustomMbps(Math.min(400, Math.max(1, Number(e.target.value) || 1)))} /></label></div>
        ) : <p className="small muted">{v.mbps} Mbps target. Variable bitrate, so simple footage can come out smaller.</p>}
      </div>
      {audio && (
        <div className="ctl">
          <label className="label" htmlFor="abit">Audio Bitrate</label>
          <select id="abit" className="select" value={v.audioKbps} disabled={disabled} onChange={(e) => v.setAudioKbps(Number(e.target.value))}>
            {[128, 192, 256, 320].map((n) => <option key={n} value={n}>{n} kbps</option>)}
          </select>
        </div>
      )}
      {transparent && (
        <label className="ctl ctl--inline">
          <span className="label">Keep Transparency</span>
          <input type="checkbox" checked={v.keepAlpha} disabled={disabled || !v.choice?.alpha} onChange={(e) => v.setKeepAlpha(e.target.checked)} />
        </label>
      )}
      {transparent && !v.choice?.alpha && <p className="small warn">This codec has no transparency, so transparent areas become black. WebM · VP9 keeps them.</p>}
      <div className="ctl">
        <label className="label" htmlFor="vname">File Name</label>
        <input id="vname" className="input" value={v.name} placeholder={v.file} disabled={disabled} onChange={(e) => v.setName(e.target.value)} />
      </div>
      <p className="muted small">About {estimate < 1024 ? `${estimate.toFixed(0)} MB` : `${(estimate / 1024).toFixed(2)} GB`} at most · {v.choice?.label.split(' (')[0] ?? 'no codec'} · {Math.round(v.fps * 100) / 100} fps · {v.mbps} Mbps</p>
    </>
  );
}

/* ── Progress ───────────────────────────────────────────────────── */

export function ExportStatus({ p, running }: { p: ExportProgress | null; running: boolean }) {
  if (!p) return null;
  const f = p.total ? p.frame / p.total : 0;
  return (
    <>
      <div className="progress">
        <div className="progress__bar" style={{ width: `${f * 100}%` }} />
        <span className="progress__txt">{running ? p.stage : 'Done'}{p.total ? ` · frame ${p.frame} / ${p.total} · ${Math.round(f * 100)}%` : ''}</span>
      </div>
      {running && p.frame > 0 && <p className="muted small">{p.fps.toFixed(1)} frames/s · {formatTime(p.etaSeconds).slice(0, 5)} left · frame time {formatTime(p.time)} · every frame is rendered, so slow effects only take longer.</p>}
    </>
  );
}

export function useAbortOnUnmount() {
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  return abort;
}
