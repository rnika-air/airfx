import { useEffect, useRef, useSyncExternalStore } from 'react';
import { edits } from '../ai/client';
import { selection } from '../ai/selection';
import { cleanup } from '../cleanup/engine';
import { createCanvas, get2d, hexToRgb } from '../utils/imageProcessing';

interface Props {
  /** Show masks and prompts (Key and Cleanup). */
  active: boolean;
  getTime: () => number;
  /** Rubber band while dragging a box, in 0..1. */
  box: number[] | null;
  /** Cleanup's painted region is included. */
  cleanMask: boolean;
  /** Bumped whenever a brush has painted. */
  tick: number;
  /** A canvas tool is in use, so show the masks even over a result. */
  toolOn: boolean;
}

/** Draws the selection on top of the preview, so what is selected is always visible. */
export function SelectionOverlay({ active, getTime, box, cleanMask, tick, toolOn }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(selection.subscribe, selection.getVersion);
  const cleaned = useSyncExternalStore(cleanup.subscribe, cleanup.getVersion);

  useEffect(() => {
    if (!active) return;
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const g = get2d(c);
      g.clearRect(0, 0, w, h);
      // A reconstruction is the thing to look at: the mask must not cover it.
      if (cleanMask && cleanup.active && !toolOn) return;
      const time = getTime();
      for (const o of selection.objects) {
        if (!o.visible) continue;
        const m = o.track.at(time);
        if (!m) continue;
        const t = createCanvas(m.w, m.h), tg = get2d(t, true), im = tg.createImageData(m.w, m.h), [r, gr, b] = hexToRgb(o.color);
        for (let y = 0; y < m.h; y++)
          for (let x = 0; x < m.w; x++) {
            const i = y * m.w + x, on = m.data[i] > 0.5;
            if (!on) continue;
            // A solid line at the mask edge, a light tint inside it.
            const edge = x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1 || m.data[i - 1] <= 0.5 || m.data[i + 1] <= 0.5 || m.data[i - m.w] <= 0.5 || m.data[i + m.w] <= 0.5;
            im.data[i * 4] = r; im.data[i * 4 + 1] = gr; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = edge ? 255 : o.id === selection.activeId ? 70 : 40;
          }
        tg.putImageData(im, 0, 0);
        g.imageSmoothingEnabled = false;
        g.drawImage(t, 0, 0, w, h);
        for (const p of o.points) {
          g.beginPath();
          g.arc(p.x * w, p.y * h, 5, 0, 7);
          g.fillStyle = p.label ? '#c6ff2e' : '#ff4d4d';
          g.fill();
          g.lineWidth = 1.5;
          g.strokeStyle = '#0d0e0d';
          g.stroke();
        }
      }
      if (cleanMask && edits.clean.w) {
        const e = edits.clean, t = createCanvas(e.w, e.h), tg = get2d(t, true), im = tg.createImageData(e.w, e.h);
        for (let i = 0; i < e.data.length; i++) if (e.data[i] > 0.4) { im.data[i * 4] = 255; im.data[i * 4 + 1] = 77; im.data[i * 4 + 2] = 77; im.data[i * 4 + 3] = 120; }
        tg.putImageData(im, 0, 0);
        g.drawImage(t, 0, 0, w, h);
      }
      g.font = '10px monospace';
      for (const d of selection.detectionsAt(time)) {
        g.strokeStyle = 'rgba(198,255,46,.7)';
        g.lineWidth = 1;
        g.strokeRect(d.box[0] * w, d.box[1] * h, (d.box[2] - d.box[0]) * w, (d.box[3] - d.box[1]) * h);
        g.fillStyle = '#c6ff2e';
        const tag = `${d.label} ${Math.round(d.score * 100)}%`, tx = d.box[0] * w, ty = Math.max(0, d.box[1] * h);
        g.fillStyle = 'rgba(13,14,13,.8)';
        g.fillRect(tx, ty, g.measureText(tag).width + 6, 13);
        g.fillStyle = '#c6ff2e';
        g.fillText(tag, tx + 3, ty + 10);
      }
      if (box) {
        g.setLineDash([5, 4]);
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.strokeRect(box[0] * w, box[1] * h, (box[2] - box[0]) * w, (box[3] - box[1]) * h);
        g.setLineDash([]);
      }
    };
    draw();
    // Videos: follow the playhead without a render per animation frame.
    const id = window.setInterval(draw, 120);
    return () => clearInterval(id);
  }, [active, getTime, box, cleanMask, tick, version, cleaned, toolOn]);

  if (!active) return null;
  return <canvas ref={ref} className="stage__overlay" />;
}
