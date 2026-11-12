import { useEffect, useRef, useState } from 'react';
import { formatTime } from '../../utils/videoProcessing';
import { keyTimes } from '../animate';
import type { Composition, Layer } from '../model';
import type { CompositionApi } from '../useComposition';
import { capture } from './pointer';

interface Props {
  comp: Composition;
  api: CompositionApi;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  toggle: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  song: { name: string; url: string; duration: number } | null;
}

const KIND_GLYPH: Record<Layer['kind'], string> = { media: '▣', text: 'T', shape: '◆', effect: 'ƒ' };

type ClipDrag = { id: string; mode: 'move' | 'in' | 'out'; x0: number; start0: number; end0: number };

/** Peaks of the song for a waveform strip (decoded once per song). */
function useWaveform(url: string | null, buckets = 1200) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!url) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new OfflineAudioContext(1, 1, 44100);
        const audio = await ctx.decodeAudioData(buf);
        const ch = audio.getChannelData(0);
        const out = new Float32Array(buckets);
        const step = Math.max(1, Math.floor(ch.length / buckets));
        for (let b = 0; b < buckets; b++) {
          let m = 0;
          for (let i = b * step, end = Math.min(ch.length, i + step); i < end; i += 4) m = Math.max(m, Math.abs(ch[i]));
          out[b] = m;
        }
        if (!cancelled) setPeaks(out);
      } catch {
        /* waveform is decorative; ignore decode failures (e.g. CORS) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, buckets]);
  return peaks;
}

/** `fraction` = how much of the song is visible (it may be longer than the composition). */
function Waveform({ peaks, width, height, fraction }: { peaks: Float32Array; width: number; height: number; fraction: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = Math.max(1, Math.round(width));
    c.height = height;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(198,255,46,0.55)';
    for (let x = 0; x < c.width; x++) {
      const v = peaks[Math.floor((x / c.width) * peaks.length * fraction)] ?? 0;
      const hh = Math.max(1, v * (height - 4));
      g.fillRect(x, (height - hh) / 2, 1, hh);
    }
  }, [peaks, width, height, fraction]);
  return <canvas ref={ref} className="tl-wave" />;
}

export function TimelinePanel({ comp, api, time, setTime, playing, toggle, selectedId, onSelect, song }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [renaming, setRenaming] = useState<string | null>(null);
  const clipDrag = useRef<ClipDrag | null>(null);
  const scrubbing = useRef(false);
  const peaks = useWaveform(song?.url ?? null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setViewW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = Math.max(8, ((viewW - 24) / Math.max(1, comp.duration)) * zoom);
  const trackW = comp.duration * pps;
  const rows = [...comp.layers].reverse();

  const snap = (t: number, exclude?: string) => {
    const targets = [0, comp.duration, time];
    for (const l of comp.layers) if (l.id !== exclude) targets.push(l.start, l.end);
    for (const s of targets) if (Math.abs(s - t) * pps < 7) return s;
    return Math.round(t * 20) / 20;
  };

  const timeAt = (clientX: number) => {
    const r = scroller.current!.getBoundingClientRect();
    return Math.max(0, Math.min(comp.duration, (clientX - r.left + scroller.current!.scrollLeft) / pps));
  };

  const onClipMove = (e: React.PointerEvent) => {
    const d = clipDrag.current;
    if (!d) return;
    const dt = (e.clientX - d.x0) / pps;
    api.updateLayer(
      d.id,
      (l) => {
        if (d.mode === 'move') {
          const len = d.end0 - d.start0;
          let s = snap(d.start0 + dt, d.id);
          // also allow the clip end to snap
          const se = snap(d.start0 + dt + len, d.id);
          if (Math.abs(se - (d.start0 + dt + len)) < Math.abs(s - (d.start0 + dt))) s = se - len;
          s = Math.max(0, Math.min(comp.duration - len, s));
          return { ...l, start: s, end: s + len };
        }
        if (d.mode === 'in') {
          const s = Math.max(0, Math.min(d.end0 - 0.1, snap(d.start0 + dt, d.id)));
          // keep keyframes at the same absolute time when trimming the head
          const shift = s - l.start;
          const keys = Object.fromEntries(Object.entries(l.keys).map(([k, ks]) => [k, ks.map((kf) => ({ ...kf, t: kf.t - shift }))]));
          return { ...l, start: s, keys };
        }
        const en = Math.min(comp.duration, Math.max(d.start0 + 0.1, snap(d.end0 + dt, d.id)));
        return { ...l, end: en };
      },
      `clip:${d.id}:${d.mode}`,
    );
  };

  const move = (id: string, dir: 1 | -1) =>
    api.apply((c) => {
      const i = c.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.layers.length) return c;
      const layers = [...c.layers];
      [layers[i], layers[j]] = [layers[j], layers[i]];
      return { ...c, layers };
    });

  const ticks: number[] = [];
  const step = pps > 120 ? 0.5 : pps > 40 ? 1 : pps > 15 ? 2 : 5;
  for (let t = 0; t <= comp.duration + 1e-6; t += step) ticks.push(t);

  return (
    <section className="tl-panel" aria-label="Timeline">
      <div className="tl-head">
        <div className="tl-transport">
          <button className="btn btn--icon btn--sm" onClick={() => setTime(0)} aria-label="Go to start" title="Go to start (Home)">⏮</button>
          <button className="btn btn--icon btn--sm btn--on" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play / Pause (Space)">
            {playing ? '❚❚' : '▶'}
          </button>
          <span className="tl-time">{formatTime(time)} <span className="muted">/ {formatTime(comp.duration)}</span></span>
        </div>
        <span className="label label--dim">{comp.layers.length} layers · drag clips to move, edges to trim</span>
        <div className="tl-zoom">
          <span className="label label--dim">Zoom</span>
          <input type="range" className="slider" min={1} max={8} step={0.1} value={zoom} style={{ ['--pct' as string]: `${((zoom - 1) / 7) * 100}%` }} onChange={(e) => setZoom(parseFloat(e.target.value))} aria-label="Timeline zoom" />
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-labels">
          <div className="tl-ruler-spacer" />
          {rows.map((l) => {
            const i = comp.layers.indexOf(l);
            return (
              <div key={l.id} className={`tl-label ${selectedId === l.id ? 'tl-label--on' : ''}`} onClick={() => onSelect(l.id)}>
                <button
                  className={`tl-eye ${l.hidden ? 'tl-eye--off' : ''}`}
                  onClick={(e) => { e.stopPropagation(); api.updateLayer(l.id, (x) => ({ ...x, hidden: !x.hidden })); }}
                  aria-label={l.hidden ? 'Show layer' : 'Hide layer'}
                  title={l.hidden ? 'Show' : 'Hide'}
                >
                  {l.hidden ? '○' : '●'}
                </button>
                <span className={`tl-kind tl-kind--${l.kind}`}>{KIND_GLYPH[l.kind]}</span>
                {renaming === l.id ? (
                  <input
                    className="num num--text tl-rename"
                    autoFocus
                    defaultValue={l.name}
                    onBlur={(e) => { api.updateLayer(l.id, (x) => ({ ...x, name: e.target.value || x.name })); setRenaming(null); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="tl-name" onDoubleClick={() => setRenaming(l.id)} title="Double-click to rename">{l.name}</span>
                )}
                <button className="tl-mini" onClick={(e) => { e.stopPropagation(); move(l.id, 1); }} disabled={i === comp.layers.length - 1} aria-label="Bring forward" title="Bring forward">▲</button>
                <button className="tl-mini" onClick={(e) => { e.stopPropagation(); move(l.id, -1); }} disabled={i === 0} aria-label="Send backward" title="Send backward">▼</button>
                <button
                  className="tl-mini"
                  onClick={(e) => { e.stopPropagation(); api.apply((c) => ({ ...c, layers: c.layers.filter((x) => x.id !== l.id) })); if (selectedId === l.id) onSelect(null); }}
                  aria-label={`Delete ${l.name}`}
                  title="Delete (Del)"
                >
                  ×
                </button>
              </div>
            );
          })}
          {song && (
            <div className="tl-label tl-label--song">
              <span className="tl-kind tl-kind--song">♪</span>
              <span className="tl-name" title={song.name}>{song.name}</span>
            </div>
          )}
        </div>

        <div className="tl-tracks" ref={scroller}>
          <div className="tl-inner" style={{ width: trackW + 24 }}>
            <div
              className="tl-ruler"
              onPointerDown={(e) => {
                scrubbing.current = true;
                capture(e);
                setTime(timeAt(e.clientX));
              }}
              onPointerMove={(e) => scrubbing.current && setTime(timeAt(e.clientX))}
              onPointerUp={() => (scrubbing.current = false)}
            >
              {ticks.map((t) => (
                <span key={t} className="tl-tick" style={{ left: t * pps }}>{Number.isInteger(t) ? `${t}s` : ''}</span>
              ))}
            </div>
            {rows.map((l) => {
              const kts = keyTimes(l);
              const inD = l.anim.animIn !== 'none' ? Math.min(l.end - l.start, l.anim.inDur as number) : 0;
              const outD = l.anim.animOut !== 'none' ? Math.min(l.end - l.start, l.anim.outDur as number) : 0;
              return (
                <div key={l.id} className="tl-row" onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
                  <div
                    className={`tl-clip tl-clip--${l.kind} ${selectedId === l.id ? 'tl-clip--on' : ''} ${l.hidden ? 'tl-clip--hidden' : ''}`}
                    style={{ left: l.start * pps, width: Math.max(4, (l.end - l.start) * pps) }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect(l.id);
                      const target = e.target as HTMLElement;
                      const mode = target.dataset.edge === 'in' ? 'in' : target.dataset.edge === 'out' ? 'out' : 'move';
                      clipDrag.current = { id: l.id, mode, x0: e.clientX, start0: l.start, end0: l.end };
                      capture(e);
                    }}
                    onPointerMove={onClipMove}
                    onPointerUp={() => (clipDrag.current = null)}
                    title={`${l.name} · ${l.start.toFixed(2)}s → ${l.end.toFixed(2)}s`}
                  >
                    {inD > 0 && <span className="tl-ramp tl-ramp--in" style={{ width: inD * pps }} />}
                    {outD > 0 && <span className="tl-ramp tl-ramp--out" style={{ width: outD * pps }} />}
                    <span className="tl-clip__name">{l.name}</span>
                    {kts.map((t) => (
                      <span
                        key={t}
                        className="tl-key"
                        style={{ left: t * pps }}
                        onPointerDown={(e) => { e.stopPropagation(); onSelect(l.id); setTime(l.start + t); }}
                        title={`Keyframe at ${(l.start + t).toFixed(2)}s`}
                      >
                        ◆
                      </span>
                    ))}
                    <span className="tl-edge tl-edge--in" data-edge="in" />
                    <span className="tl-edge tl-edge--out" data-edge="out" />
                  </div>
                </div>
              );
            })}
            {song && (
              <div className="tl-row tl-row--song">
                <div className="tl-songclip" style={{ width: Math.min(song.duration, comp.duration) * pps }}>
                  {peaks ? <Waveform peaks={peaks} width={Math.min(song.duration, comp.duration) * pps} height={26} fraction={Math.min(1, comp.duration / song.duration)} /> : <span className="muted small">♪ {song.name}</span>}
                </div>
              </div>
            )}
            <div className="tl-playhead" style={{ left: time * pps }} />
          </div>
        </div>
      </div>
    </section>
  );
}
