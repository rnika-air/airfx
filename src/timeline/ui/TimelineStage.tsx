import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioBands } from '../../effects/types';
import { get2d } from '../../utils/imageProcessing';
import { evalLayer, propAt, setTransformProp } from '../animate';
import { CompPlayer, hitTest, layerSize } from '../compositor';
import type { Composition, Layer } from '../model';
import { capture } from './pointer';

interface Props {
  comp: Composition;
  time: number;
  playing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  updateLayer: (id: string, fn: (l: Layer) => Layer, key?: string | null) => void;
  previewEdge: number;
  getBands: () => AudioBands;
  onDropFiles: (files: File[]) => void;
}

type Drag =
  | { mode: 'move'; id: string; px: number; py: number; x0: number; y0: number }
  | { mode: 'scale'; id: string; cx: number; cy: number; d0: number; s0: number }
  | { mode: 'rotate'; id: string; cx: number; cy: number; a0: number; r0: number };

/** Composition preview with direct manipulation of the selected layer. */
export function TimelineStage(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [dragOver, setDragOver] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pending = useRef(0);
  const latest = useRef(p);
  latest.current = p;

  const draw = useCallback(() => {
    pending.current = 0;
    const c = canvas.current;
    const o = latest.current;
    const player = playerRef.current;
    if (!c || !player) return;
    const scale = Math.min(1, o.previewEdge / Math.max(o.comp.width, o.comp.height));
    const W = Math.round(o.comp.width * scale), H = Math.round(o.comp.height * scale);
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    const ctx = get2d(c);
    player.sync(o.comp, o.time, o.playing);
    try {
      player.render(ctx, o.comp, o.time, scale, o.getBands());
      const sel = o.comp.layers.find((l) => l.id === o.selectedId);
      if (sel && !o.playing) player.drawSelection(ctx, o.comp, sel, o.time, scale);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const schedule = useCallback(() => {
    if (!pending.current) pending.current = requestAnimationFrame(draw);
  }, [draw]);

  const playerRef = useRef<CompPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new CompPlayer(() => schedule());
  useEffect(() => () => playerRef.current?.dispose(), []);

  useEffect(schedule, [p.comp, p.time, p.playing, p.selectedId, p.previewEdge, schedule]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 32;
  const disp = Math.max(0.05, Math.min((box.w - pad) / p.comp.width, (box.h - pad) / p.comp.height));

  /** Pointer → composition pixels. */
  const toComp = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * p.comp.width, y: ((e.clientY - r.top) / r.height) * p.comp.height };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = toComp(e);
    const handle = 12 / disp;
    const sel = p.comp.layers.find((l) => l.id === p.selectedId);
    if (sel && sel.kind !== 'effect') {
      const st = evalLayer(sel, p.time);
      const { w, h } = layerSize(sel, p.comp);
      const cx = st.x * p.comp.width, cy = st.y * p.comp.height;
      const c = Math.cos(st.rotation), s = Math.sin(st.rotation);
      const rot = (lx: number, ly: number) => ({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c });
      const k = st.scale;
      const rh = rot(0, (-h * k) / 2 - 34 / disp);
      if (Math.hypot(pt.x - rh.x, pt.y - rh.y) < handle * 1.4) {
        drag.current = { mode: 'rotate', id: sel.id, cx, cy, a0: Math.atan2(pt.y - cy, pt.x - cx), r0: propAt(sel, 'rotation', p.time) };
      } else {
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const cp = rot((sx * w * k) / 2, (sy * h * k) / 2);
          if (Math.hypot(pt.x - cp.x, pt.y - cp.y) < handle) {
            drag.current = { mode: 'scale', id: sel.id, cx, cy, d0: Math.hypot(pt.x - cx, pt.y - cy) || 1, s0: propAt(sel, 'scale', p.time) };
            break;
          }
        }
      }
    }
    if (!drag.current) {
      const hit = hitTest(p.comp, p.time, pt.x, pt.y);
      p.onSelect(hit?.id ?? null);
      if (hit) drag.current = { mode: 'move', id: hit.id, px: pt.x, py: pt.y, x0: propAt(hit, 'x', p.time), y0: propAt(hit, 'y', p.time) };
    }
    if (drag.current) capture(e);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const pt = toComp(e);
    const t = p.time;
    if (d.mode === 'move') {
      const nx = d.x0 + ((pt.x - d.px) / p.comp.width) * 100;
      const ny = d.y0 + ((pt.y - d.py) / p.comp.height) * 100;
      p.updateLayer(d.id, (l) => setTransformProp(setTransformProp(l, 'x', round(nx, 1), t), 'y', round(ny, 1), t), `drag:${d.id}`);
    } else if (d.mode === 'scale') {
      const s = Math.max(0.01, Math.min(6, (d.s0 * Math.hypot(pt.x - d.cx, pt.y - d.cy)) / d.d0));
      p.updateLayer(d.id, (l) => setTransformProp(l, 'scale', round(s, 2), t), `scale:${d.id}`);
    } else {
      let deg = d.r0 + ((Math.atan2(pt.y - d.cy, pt.x - d.cx) - d.a0) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      p.updateLayer(d.id, (l) => setTransformProp(l, 'rotation', round(((deg + 540) % 720) - 360, 1), t), `rot:${d.id}`);
    }
  };

  return (
    <main
      className={`workspace tl-stage ${dragOver ? 'workspace--drag' : ''}`}
      onDragOver={(e) => {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        p.onDropFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="stage" ref={wrap}>
        <div className="tl-stage__center">
          <canvas
            ref={canvas}
            className="tl-stage__canvas"
            style={{ width: p.comp.width * disp, height: p.comp.height * disp }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            data-testid="tl-canvas"
          />
        </div>
        <div className="stage__meta">
          <span>{p.comp.width} × {p.comp.height}</span>
          <span className="muted">{Math.round(disp * 100)}% · drag to move · corners scale · top handle rotates (Shift snaps)</span>
        </div>
        {!p.comp.layers.length && (
          <div className="tl-empty">
            <p><strong>Empty timeline.</strong> Add media, text, shapes or effects from the left panel, drop files here, or load a song.</p>
          </div>
        )}
        {dragOver && <div className="dropzone"><span>Drop to add layers</span></div>}
      </div>
    </main>
  );
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
