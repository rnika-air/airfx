import type { RenderLayer } from '../effects/types';
import { FrameRenderer } from '../engine/FrameRenderer';
import { createCanvas, get2d } from './imageProcessing';

export const MAX_EXPORT_EDGE = 8192;
export const MAX_EXPORT_PIXELS = 40_000_000;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || 'airfx';
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image — try a smaller size.'))),
      type,
      quality,
    );
  });
}

/* ───────────────────────── Image export ───────────────────────── */

export interface ImageExportOptions {
  source: CanvasImageSource;
  layers: RenderLayer[];
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  /** Fill colour used to flatten transparency for JPEG. */
  matte: string;
  time?: number;
}

export async function exportImage(o: ImageExportOptions): Promise<Blob> {
  const w = Math.round(o.width), h = Math.round(o.height);
  if (!(w > 0 && h > 0)) throw new Error('Invalid output size.');
  if (w > MAX_EXPORT_EDGE || h > MAX_EXPORT_EDGE || w * h > MAX_EXPORT_PIXELS) {
    throw new Error(`Output too large. Max ${MAX_EXPORT_EDGE}px per side and ${MAX_EXPORT_PIXELS / 1e6} MP total.`);
  }
  // Yield so the UI can show the "rendering" state before the heavy work.
  await new Promise((r) => setTimeout(r, 30));

  const renderer = new FrameRenderer();
  const canvas = createCanvas(w, h);
  try {
    const time = o.time ?? 0;
    renderer.render({ source: o.source, target: canvas, width: w, height: h, layers: o.layers, time, frame: Math.floor(time * 24) });
    if (o.format === 'jpeg') {
      const flat = createCanvas(w, h);
      const ctx = get2d(flat);
      ctx.fillStyle = o.matte;
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(canvas, 0, 0);
      const blob = await canvasToBlob(flat, 'image/jpeg', o.quality);
      flat.width = flat.height = 1;
      return blob;
    }
    if (o.format === 'webp') {
      const blob = await canvasToBlob(canvas, 'image/webp', o.quality);
      if (blob.type !== 'image/webp') throw new Error('This browser cannot encode WebP. Use PNG or JPEG.');
      return blob;
    }
    return await canvasToBlob(canvas, 'image/png');
  } finally {
    canvas.width = canvas.height = 1;
    renderer.dispose();
  }
}
