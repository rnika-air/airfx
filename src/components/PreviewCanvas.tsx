import { stagePointer } from '../engine/interaction';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { LoadedMedia } from '../hooks/useMedia';
import { Wordmark } from './Wordmark';
import type { PreviewQuality } from '../engine/perf';

export type CompareMode = 'processed' | 'original' | 'split';
export type Zoom = number | 'fit';

export const PREVIEW_QUALITY = [
  { value: 640, label: 'Draft' },
  { value: 1080, label: 'Standard' },
  { value: 1600, label: 'High' },
  { value: 2400, label: 'Max' },
];

interface Props {
  media: LoadedMedia | null;
  loading: boolean;
  error: string | null;
  onDismissError: () => void;
  processedRef: RefObject<HTMLCanvasElement>;
  originalRef: RefObject<HTMLCanvasElement>;
  compare: CompareMode;
  onCompare: (m: CompareMode) => void;
  zoom: Zoom;
  onZoom: (z: Zoom) => void;
  previewEdge: number;
  onPreviewEdge: (n: number) => void;
  quality: PreviewQuality;
  onQuality: (q: PreviewQuality) => void;
  monitor: boolean;
  onMonitor: () => void;
  monitorPanel?: ReactNode;
  onImport: () => void;
  onFile: (f: File) => void;
  onStageClick: () => void;
  /** Canvas tools: return true to take over this pointer stroke. nx/ny are 0..1. */
  onCanvasPointer?: (phase: 'down' | 'move' | 'up', nx: number, ny: number, e: React.PointerEvent) => boolean;
  /** Tool active, so show a crosshair. */
  toolActive?: boolean;
  /** Drawn over the image, inside the frame. */
  overlay?: ReactNode;
  /**
   * Phones and tablets: no toolbar row. Two floating buttons sit on the picture
   * instead: hold to see the original, and Fit / 1:1. Pinch zooms.
   */
  touchUi?: boolean;
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export function PreviewCanvas(p: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [dragOver, setDragOver] = useState(false);
  const [split, setSplit] = useState(50);
  const dragging = useRef(false);
  const toolStroke = useRef(false);
  const swallowClick = useRef(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 48;
  const fitScale = p.media ? Math.min((box.w - pad) / p.media.width, (box.h - pad) / p.media.height, 4) : 1;
  const scale = p.zoom === 'fit' ? Math.max(0.01, fitScale) : p.zoom;
  const dispW = p.media ? Math.round(p.media.width * scale) : 0;
  const dispH = p.media ? Math.round(p.media.height * scale) : 0;

  const stepZoom = (dir: 1 | -1) => {
    const idx = dir > 0 ? ZOOM_STEPS.findIndex((z) => z > scale + 1e-3) : ZOOM_STEPS.findLastIndex((z) => z < scale - 1e-3);
    if (idx >= 0) p.onZoom(ZOOM_STEPS[idx]);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!p.media || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? 1 : -1);
  };

  // ctrl+wheel must be non-passive to prevent browser zoom
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const block = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', block, { passive: false });
    return () => el.removeEventListener('wheel', block);
  }, []);

  // Two fingers on the preview zoom it (touch screens). One finger keeps its usual job.
  const touches = useRef(new Map<number, [number, number]>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const spread = () => { const [a, b] = [...touches.current.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  const touchDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch' || !p.media) return;
    touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.current.size === 2) { pinch.current = { dist: spread(), scale }; toolStroke.current = false; dragging.current = false; swallowClick.current = true; }
  };
  const touchMove = (e: React.PointerEvent) => {
    if (!touches.current.has(e.pointerId)) return;
    touches.current.set(e.pointerId, [e.clientX, e.clientY]);
    const pc = pinch.current;
    if (pc && touches.current.size === 2 && pc.dist > 10) p.onZoom(Math.min(8, Math.max(0.05, pc.scale * (spread() / pc.dist))));
  };
  const touchUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (touches.current.size < 2) pinch.current = null;
  };

  const norm = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };

  const setSplitFrom = (clientX: number, target: HTMLElement) => {
    const r = target.getBoundingClientRect();
    setSplit(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  const files = (e: React.DragEvent) => Array.from(e.dataTransfer.items ?? []).some((i) => i.kind === 'file');

  return (
    <main
      className={`workspace ${dragOver ? 'workspace--drag' : ''}`}
      onDragOver={(e) => {
        if (!files(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) p.onFile(f);
      }}
    >
      {!p.touchUi && <div className="toolbar">
        <div className="segmented segmented--3 segmented--compact" role="radiogroup" aria-label="Compare mode">
          {(['processed', 'split', 'original'] as CompareMode[]).map((m) => (
            <button key={m} role="radio" aria-checked={p.compare === m} className={p.compare === m ? 'on' : ''} disabled={!p.media} onClick={() => p.onCompare(m)}>
              {m === 'processed' ? 'Processed' : m === 'split' ? 'Split' : 'Original'}
            </button>
          ))}
        </div>

        <div className="toolbar__group">
          <span className="label label--dim">Preview</span>
          <select className="select select--compact" value={p.previewEdge} onChange={(e) => p.onPreviewEdge(Number(e.target.value))} title="Preview resolution (export is independent)">
            {PREVIEW_QUALITY.map((q) => (
              <option key={q.value} value={q.value}>{q.label} · {q.value}px</option>
            ))}
          </select>
          <select className="select select--compact" value={p.quality} onChange={(e) => p.onQuality(e.target.value as PreviewQuality)} aria-label="Playback priority" title="Performance: preview at most 720 px, and smaller while playing or dragging a control. Balanced: full preview size at rest, smaller only while playing or dragging if a frame is slow. Quality: always full size. Exports always render at full quality.">
            <option value="performance">Performance</option>
            <option value="balanced">Balanced</option>
            <option value="quality">Quality</option>
          </select>
          <button className={`btn btn--sm ${p.monitor ? 'btn--on' : ''}`} onClick={p.onMonitor} title="Show the performance monitor">FPS</button>
        </div>

        <div className="toolbar__group">
          <button className="btn btn--icon btn--sm" disabled={!p.media} onClick={() => stepZoom(-1)} aria-label="Zoom out">−</button>
          <span className="toolbar__zoom">{p.media ? `${Math.round(scale * 100)}%` : '—'}</span>
          <button className="btn btn--icon btn--sm" disabled={!p.media} onClick={() => stepZoom(1)} aria-label="Zoom in">+</button>
          <button className={`btn btn--sm ${p.zoom === 'fit' ? 'btn--on' : ''}`} disabled={!p.media} onClick={() => p.onZoom('fit')} title="Fit to screen (F)">Fit</button>
          <button className={`btn btn--sm ${p.zoom === 1 ? 'btn--on' : ''}`} disabled={!p.media} onClick={() => p.onZoom(1)} title="Actual size (1)">1:1</button>
        </div>
      </div>}

      <div className="stage" ref={stageRef} onWheel={onWheel} tabIndex={-1} onPointerDownCapture={touchDown} onPointerMoveCapture={touchMove} onPointerUpCapture={touchUp} onPointerCancelCapture={touchUp} onDoubleClick={() => p.media && p.onZoom(p.zoom === 'fit' ? 1 : 'fit')}>
        {p.monitorPanel}
        {!p.media && !p.loading && (
          <div className="empty">
            <div className="empty__frame">
              <span className="empty__corner empty__corner--tl" />
              <span className="empty__corner empty__corner--tr" />
              <span className="empty__corner empty__corner--bl" />
              <span className="empty__corner empty__corner--br" />
              <Wordmark size="lg" />
              <p className="empty__lead">Drop an image or video to begin.</p>
              <button className="btn btn--accent btn--lg" onClick={p.onImport}>Import Media</button>
              <p className="empty__formats">JPG · JPEG · PNG · WEBP · MP4 · WEBM</p>
              <p className="empty__note">Processed locally in your browser — files never leave your machine.</p>
            </div>
          </div>
        )}

        {p.loading && (
          <div className="empty">
            <div className="loader" />
            <p className="label">Decoding media…</p>
          </div>
        )}

        {p.media && (
          <div className="stage__scroll">
            <div
              className={`stage__frame ${p.compare === 'split' ? 'stage__frame--split' : ''} ${p.toolActive ? 'stage__frame--tool' : ''}`}
              style={{ width: dispW, height: dispH }}
              onClick={() => {
                if (swallowClick.current) { swallowClick.current = false; return; }
                if (p.compare !== 'split') p.onStageClick();
              }}
              onPointerDown={(e) => {
                const [nx, ny] = norm(e);
                if (p.onCanvasPointer?.('down', nx, ny, e)) {
                  toolStroke.current = true;
                  swallowClick.current = true;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  return;
                }
                if (p.compare !== 'split') return;
                dragging.current = true;
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                setSplitFrom(e.clientX, e.currentTarget);
              }}
              onPointerLeave={() => stagePointer.leave()}
              onPointerMove={(e) => {
                { const [nx, ny] = norm(e); stagePointer.move(nx, ny, e.buttons > 0 && !toolStroke.current && p.compare !== 'split'); }
                if (toolStroke.current) {
                  const [nx, ny] = norm(e);
                  p.onCanvasPointer?.('move', nx, ny, e);
                } else if (dragging.current) setSplitFrom(e.clientX, e.currentTarget);
              }}
              onPointerUp={(e) => {
                if (toolStroke.current) {
                  const [nx, ny] = norm(e);
                  p.onCanvasPointer?.('up', nx, ny, e);
                }
                toolStroke.current = false;
                dragging.current = false;
              }}
            >
              <canvas ref={p.processedRef} className="stage__canvas" style={{ visibility: p.compare === 'original' ? 'hidden' : 'visible' }} />
              <canvas
                ref={p.originalRef}
                className="stage__canvas"
                style={{
                  visibility: p.compare === 'processed' ? 'hidden' : 'visible',
                  clipPath: p.compare === 'split' ? `inset(0 ${100 - split}% 0 0)` : undefined,
                }}
              />
              {p.overlay}
              {p.compare === 'split' && (
                <div className="split-handle" style={{ left: `${split}%` }}>
                  <span className="split-handle__tag split-handle__tag--l">ORIGINAL</span>
                  <span className="split-handle__tag split-handle__tag--r">PROCESSED</span>
                </div>
              )}
            </div>
          </div>
        )}

        {p.media && (
          <div className="stage__meta">
            <span>{p.media.name}</span>
            <span className="muted">{p.media.width} × {p.media.height}</span>
          </div>
        )}

        {p.touchUi && p.media && (
          <div className="pfloat">
            {/* Press and hold to compare with the original; let go to return. */}
            <button
              className={`pfloat__btn ${p.compare !== 'processed' ? 'on' : ''}`}
              aria-label="Hold to see the original"
              onPointerDown={(e) => { e.stopPropagation(); p.onCompare('original'); try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* the release still arrives */ } }}
              onPointerUp={(e) => { e.stopPropagation(); p.onCompare('processed'); }}
              onPointerCancel={() => p.onCompare('processed')}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3v18M4 6h6v12H4zM14 6h6v12h-6z" /></svg>
              <span>{p.compare !== 'processed' ? 'Original' : 'Hold'}</span>
            </button>
            <button className="pfloat__btn" onClick={(e) => { e.stopPropagation(); p.onZoom(p.zoom === 'fit' ? 1 : 'fit'); }} aria-label={p.zoom === 'fit' ? 'Actual size' : 'Fit to screen'}>
              <span>{p.zoom === 'fit' ? 'Fit' : `${Math.round(scale * 100)}%`}</span>
            </button>
          </div>
        )}

        {dragOver && (
          <div className="dropzone">
            <span>Release to import</span>
          </div>
        )}

        {p.error && (
          <div className="toast toast--error" role="alert">
            <span>{p.error}</span>
            <button className="btn btn--icon btn--sm" onClick={p.onDismissError} aria-label="Dismiss">×</button>
          </div>
        )}
      </div>
    </main>
  );
}
