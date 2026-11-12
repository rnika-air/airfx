import { RevealControls, SpeechControls, VisionControls } from './LiveControls';
import { AUDIO_ACCEPT, audioBus } from '../engine/audio';
import { useSyncExternalStore } from 'react';
import { fonts, BUILTIN_FONTS } from '../content/fonts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CustomParam } from '../effects/types';
import {
  GRADIENT_PRESETS, IDENTITY_CURVES, SEL_RANGES, curveSampler, decodeLut, encodeLut, gradientRamp, parseCube, parseCurves,
  parseSel, parseStops, type CurveSet, type Pt, type SelRange, type Stop,
} from '../effects/adjust/core';
import { VHS_FONTS, newVhsText, parseTexts, type VhsText } from '../effects/vhs';

interface EdProps {
  value: string;
  onChange: (v: string) => void;
}

const CH: { key: keyof CurveSet; label: string; color: string }[] = [
  { key: 'rgb', label: 'RGB', color: '#ecebe4' },
  { key: 'r', label: 'Red', color: '#ff5a4d' },
  { key: 'g', label: 'Green', color: '#7dff6a' },
  { key: 'b', label: 'Blue', color: '#5aa2ff' },
];
const S = 248;

/** Interactive curves: click to add, drag to move, double-click (or Del button) to remove. */
function CurvesEditor({ value, onChange }: EdProps) {
  const curves = useMemo(() => parseCurves(value), [value]);
  const [ch, setCh] = useState<keyof CurveSet>('rgb');
  const [sel, setSel] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const pts = curves[ch];

  const write = (next: Pt[]) => onChange(JSON.stringify({ ...curves, [ch]: next }));
  const toPt = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const fn = curveSampler(pts);
  let d = '';
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    d += `${i ? 'L' : 'M'}${x * S} ${(1 - Math.min(1, Math.max(0, fn(x)))) * S}`;
  }
  const color = CH.find((c) => c.key === ch)!.color;

  return (
    <div className="ed">
      <div className="segmented segmented--4 segmented--tiny">
        {CH.map((c) => (
          <button key={c.key} className={ch === c.key ? 'on' : ''} onClick={() => { setCh(c.key); setSel(null); }}>{c.label}</button>
        ))}
      </div>
      <svg
        ref={svg}
        className="curve"
        viewBox={`0 0 ${S} ${S}`}
        data-testid="curve-editor"
        onPointerDown={(e) => {
          if ((e.target as Element).tagName === 'circle') return;
          const p = toPt(e);
          const next = [...pts, p].sort((a, b) => a[0] - b[0]);
          const i = next.indexOf(p);
          write(next);
          setSel(i);
          drag.current = i;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          const p = toPt(e);
          const next = [...pts];
          const lo = i === 0 ? 0 : next[i - 1][0] + 0.01, hi = i === next.length - 1 ? 1 : next[i + 1][0] - 0.01;
          next[i] = [Math.min(hi, Math.max(lo, p[0])), p[1]];
          write(next);
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="curve__grid">
            <line x1={t * S} y1={0} x2={t * S} y2={S} />
            <line x1={0} y1={t * S} x2={S} y2={t * S} />
          </g>
        ))}
        <line className="curve__diag" x1={0} y1={S} x2={S} y2={0} />
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p[0] * S}
            cy={(1 - p[1]) * S}
            r={6}
            className={sel === i ? 'curve__pt curve__pt--on' : 'curve__pt'}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(i);
              drag.current = i;
              svg.current?.setPointerCapture(e.pointerId);
            }}
            onDoubleClick={() => {
              if (pts.length > 2) {
                write(pts.filter((_, k) => k !== i));
                setSel(null);
              }
            }}
          />
        ))}
      </svg>
      <div className="ed__row">
        {sel !== null && pts[sel] ? (
          <>
            <label>In <input className="num" type="number" min={0} max={255} value={Math.round(pts[sel][0] * 255)} onChange={(e) => write(pts.map((p, i) => (i === sel ? [Math.min(1, Math.max(0, Number(e.target.value) / 255)), p[1]] : p)))} /></label>
            <label>Out <input className="num" type="number" min={0} max={255} value={Math.round(pts[sel][1] * 255)} onChange={(e) => write(pts.map((p, i) => (i === sel ? [p[0], Math.min(1, Math.max(0, Number(e.target.value) / 255))] : p)))} /></label>
          </>
        ) : (
          <span className="muted small">Click to add a point. Double-click a point to remove it.</span>
        )}
      </div>
      <div className="ed__row">
        <button className="btn btn--sm" onClick={() => { write([[0, 0], [1, 1]]); setSel(null); }}>Reset {ch === 'rgb' ? 'RGB' : ch.toUpperCase()}</button>
        <button className="btn btn--sm" onClick={() => { onChange(JSON.stringify(IDENTITY_CURVES)); setSel(null); }}>Reset All</button>
      </div>
    </div>
  );
}

function GradientEditor({ value, onChange }: EdProps) {
  const stops = useMemo(() => parseStops(value), [value]);
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const write = (s: Stop[]) => onChange(JSON.stringify(s));
  const ramp = gradientRamp(stops);
  const css = `linear-gradient(90deg, ${stops.map((s) => `${s.c} ${s.p * 100}%`).join(', ')})`;
  const pos = (e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const cur = stops[Math.min(sel, stops.length - 1)];

  return (
    <div className="ed">
      <div
        ref={bar}
        className="gradbar"
        style={{ background: css }}
        data-testid="gradient-bar"
        title="Click to add a stop"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).dataset.stop !== undefined) return;
          const p = pos(e), i = Math.round(p * 255) * 3;
          const c = `#${[ramp[i], ramp[i + 1], ramp[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          const next = [...stops, { p, c }].sort((a, b) => a.p - b.p);
          write(next);
          setSel(next.findIndex((s) => s.p === p));
        }}
        onPointerMove={(e) => {
          const i = drag.current;
          if (i === null) return;
          write(stops.map((s, k) => (k === i ? { ...s, p: pos(e) } : s)));
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {stops.map((s, i) => (
          <span
            key={i}
            data-stop={i}
            className={`gradbar__stop ${i === sel ? 'gradbar__stop--on' : ''}`}
            style={{ left: `${s.p * 100}%`, background: s.c }}
            onPointerDown={(e) => {
              setSel(i);
              drag.current = i;
              bar.current?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </div>
      <div className="ed__row">
        <input type="color" value={cur.c} onChange={(e) => write(stops.map((s) => (s === cur ? { ...s, c: e.target.value } : s)))} aria-label="Stop color" />
        <label>Position <input className="num" type="number" min={0} max={100} value={Math.round(cur.p * 100)} onChange={(e) => write(stops.map((s) => (s === cur ? { ...s, p: Math.min(1, Math.max(0, Number(e.target.value) / 100)) } : s)))} /></label>
        <button className="btn btn--sm" disabled={stops.length <= 2} onClick={() => { write(stops.filter((s) => s !== cur)); setSel(0); }}>Remove</button>
      </div>
      <div className="chips">
        {GRADIENT_PRESETS.map((g) => <button key={g.name} className="chip" onClick={() => write(g.stops)}>{g.name}</button>)}
      </div>
    </div>
  );
}

function LutEditor({ value, onChange }: EdProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const lut = decodeLut(value);
  return (
    <div className="ed">
      <button className="btn btn--sm btn--block" onClick={() => ref.current?.click()}>Load .cube File…</button>
      <input
        ref={ref}
        type="file"
        accept=".cube"
        hidden
        data-testid="lut-input"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setErr(null);
            onChange(encodeLut(parseCube(await f.text(), f.name)));
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      />
      {lut ? <p className="small ok">{lut.name} · {lut.size}³ grid</p> : <p className="small muted">No LUT loaded. The image passes through unchanged.</p>}
      {err && <p className="small error">{err}</p>}
    </div>
  );
}

const SEL_LABEL = ['Cyan', 'Magenta', 'Yellow', 'Black'];
function SelectiveEditor({ value, onChange }: EdProps) {
  const [range, setRange] = useState<SelRange>('reds');
  const vals = useMemo(() => parseSel(value), [value]);
  const cur = vals[range] ?? [0, 0, 0, 0];
  return (
    <div className="ed">
      <select className="select" value={range} onChange={(e) => setRange(e.target.value as SelRange)} aria-label="Color range">
        {SEL_RANGES.map((r) => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}{vals[r]?.some(Boolean) ? ' •' : ''}</option>)}
      </select>
      {SEL_LABEL.map((l, i) => (
        <div className="ctl" key={l}>
          <div className="ctl__row"><span className="label">{l}</span><span className="ctl__num">{cur[i]}%</span></div>
          <input
            type="range"
            className="slider"
            min={-100}
            max={100}
            value={cur[i]}
            aria-label={`${range} ${l}`}
            style={{ ['--pct' as string]: `${(cur[i] + 100) / 2}%` }}
            onChange={(e) => {
              const next = [...cur] as [number, number, number, number];
              next[i] = Number(e.target.value);
              onChange(JSON.stringify({ ...vals, [range]: next }));
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Editable list of VHS text elements. {date}, {time} and {tc} are replaced live. */
function OverlaysEditor({ value, onChange }: EdProps) {
  const list = useMemo(() => parseTexts(value), [value]);
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null);
  const write = (l: VhsText[]) => onChange(JSON.stringify(l));
  const cur = list.find((t) => t.id === sel) ?? null;
  const up = (patch: Partial<VhsText>) => cur && write(list.map((t) => (t.id === cur.id ? { ...t, ...patch } : t)));
  const num = (label: string, key: keyof VhsText, min: number, max: number, step = 1) => (
    <label className="ed__field">
      <span className="label label--dim">{label}</span>
      <input className="num" type="number" min={min} max={max} step={step} value={cur![key] as number} onChange={(e) => up({ [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="ed">
      <ul className="txlist">
        {list.map((t) => (
          <li key={t.id} className={t.id === sel ? 'on' : ''} onClick={() => setSel(t.id)}>
            <button className="tl-eye" aria-label={t.visible ? 'Hide text' : 'Show text'} onClick={(e) => { e.stopPropagation(); write(list.map((x) => (x.id === t.id ? { ...x, visible: !x.visible } : x))); }}>{t.visible ? '●' : '○'}</button>
            <span>{t.text || '(empty)'}</span>
            <button className="tl-mini" aria-label="Delete text" onClick={(e) => { e.stopPropagation(); write(list.filter((x) => x.id !== t.id)); }}>×</button>
          </li>
        ))}
      </ul>
      <button className="btn btn--sm btn--block" onClick={() => { const t = newVhsText(list.length); write([...list, t]); setSel(t.id); }}>+ Add Text</button>
      {cur && (
        <>
          <input className="num num--text" value={cur.text} onChange={(e) => up({ text: e.target.value })} aria-label="Overlay text" />
          <p className="small muted">Use {'{date}'}, {'{time}'} and {'{tc}'} for live values. Drag text on the canvas to move it.</p>
          <div className="ed__grid">
            {num('X %', 'x', -10, 110, 0.5)}
            {num('Y %', 'y', -10, 110, 0.5)}
            {num('Size', 'size', 8, 200)}
            {num('Rotate', 'rotation', -180, 180)}
            {num('Opacity', 'opacity', 0, 100)}
            {num('Spacing', 'spacing', -0.2, 1, 0.01)}
            {num('Glow', 'glow', 0, 1, 0.05)}
            {num('Blink /s', 'blinkRate', 0.1, 8, 0.1)}
          </div>
          <div className="ed__row">
            <select className="select" value={cur.font} onChange={(e) => up({ font: e.target.value })} aria-label="Font">{VHS_FONTS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className="select" value={cur.weight} onChange={(e) => up({ weight: e.target.value })} aria-label="Weight"><option>400</option><option>700</option><option>900</option></select>
            <input type="color" value={cur.color} onChange={(e) => up({ color: e.target.value })} aria-label="Text color" />
          </div>
          <div className="ed__row">
            <select className="select" value={cur.align} onChange={(e) => up({ align: e.target.value as VhsText['align'] })} aria-label="Align"><option>left</option><option>center</option><option>right</option></select>
            <select className="select" value={cur.anim} onChange={(e) => up({ anim: e.target.value as VhsText['anim'] })} aria-label="Animation"><option value="none">No Motion</option><option value="jitter">Jitter</option><option value="drift">Drift</option><option value="typewriter">Typewriter</option></select>
            <label className="ed__check"><input type="checkbox" checked={cur.blink} onChange={(e) => up({ blink: e.target.checked })} /> Blink</label>
          </div>
        </>
      )}
    </div>
  );
}

export function CustomControl({ def, value, onChange }: { def: CustomParam; value: string; onChange: (v: string) => void }) {
  switch (def.editor) {
    case 'curves': return <CurvesEditor value={value} onChange={onChange} />;
    case 'gradient': return <GradientEditor value={value} onChange={onChange} />;
    case 'lut': return <LutEditor value={value} onChange={onChange} />;
    case 'selectiveColor': return <SelectiveEditor value={value} onChange={onChange} />;
    case 'overlays': return <OverlaysEditor value={value} onChange={onChange} />;
    case 'font': return <FontPicker label={def.label} value={value} onChange={onChange} />;
    case 'audioSource': return <AudioSourcePicker />;
    case 'vision': return <VisionControls tasks={def.default} />;
    case 'reveal': return <RevealControls />;
    case 'speech': return <SpeechControls />;
  }
}

/** Chooses what Sound Visualizer listens to, and shows that a signal is really arriving. */
function AudioSourcePicker() {
  const reactor = audioBus.reactor;
  const audio = useSyncExternalStore((f) => { const off = reactor?.subscribe(f); return () => { off?.(); }; }, () => reactor?.state ?? null);
  const file = useRef<HTMLInputElement>(null), bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id = 0;
    const loop = () => {
      if (bar.current) bar.current.style.width = `${Math.round((audioBus.read()?.bands.level ?? 0) * 100)}%`;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  if (!reactor || !audio) return null;
  const video = audioBus.video;
  const status = audio.loading ? 'Waiting for permission…'
    : audio.kind === 'mic' ? 'Listening to the microphone.'
    : audio.kind === 'video' ? (audio.playing ? 'Listening to this video.' : 'Press play to hear this video.')
    : audio.kind ? (audio.playing ? `Listening to ${audio.name}.` : `${audio.name} is loaded. Press play.`)
    : 'No sound yet. Choose a source.';
  return (
    <div className="audiosrc">
      <input ref={file} type="file" accept={AUDIO_ACCEPT} hidden aria-label="Audio file" onChange={(e) => { const f = e.target.files?.[0]; if (f) reactor.loadFile(f); e.target.value = ''; }} />
      <div className="audio__buttons">
        <button className={`btn btn--sm ${audio.kind === 'file' ? 'btn--on' : ''}`} onClick={() => file.current?.click()}>Audio File</button>
        <button className={`btn btn--sm ${audio.kind === 'video' ? 'btn--on' : ''}`} disabled={!video} title={video ? 'Use the sound of this video' : 'Load a video first'} onClick={() => video && reactor.useVideo(video, 'Video audio')}>Video Audio</button>
        <button className={`btn btn--sm ${audio.kind === 'mic' ? 'btn--on' : ''}`} title="The browser asks for permission first" onClick={() => (audio.kind === 'mic' ? reactor.clear() : reactor.useMic())}>{audio.kind === 'mic' ? 'Stop Mic' : 'Microphone'}</button>
      </div>
      <div className="meter__track"><div className="meter__fill" ref={bar} /></div>
      <p className="small muted">{status}</p>
      {audio.error && <p className="small error">{audio.error}</p>}
    </div>
  );
}

/** System fonts plus any font file loaded this session. */
function FontPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  useSyncExternalStore(fonts.subscribe, fonts.getVersion);
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const known = [...BUILTIN_FONTS.map(([v, l]) => [v, l] as [string, string]), ...fonts.loaded.map((f) => [`"${f.family}"`, f.name] as [string, string])];
  return (
    <div className="ctl">
      <label className="label" htmlFor="font-pick">{label}</label>
      <select id="font-pick" className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known.some(([v]) => v === value) && <option value={value}>Not loaded: {value}</option>}
        {known.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <button className="btn btn--sm btn--block" onClick={() => file.current?.click()}>Load Font File…</button>
      <input ref={file} type="file" accept=".ttf,.otf,.woff,.woff2" hidden data-testid="font-input" onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try { setError(null); onChange(await fonts.add(f)); } catch (x) { setError((x as Error).message); }
      }} />
      {error && <p className="small error">{error}</p>}
    </div>
  );
}
