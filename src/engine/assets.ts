import { createCanvas, fitWithin, get2d } from '../utils/imageProcessing';
import { disposeVideo, loadVideo } from '../utils/videoProcessing';
import { isSvg, sanitizeSvg } from '../content/svg';

/**
 * Shared asset bin: images and videos imported for card textures (Slide /
 * Stack) and for timeline media layers. Lives for the session; every file
 * stays local as an object URL.
 */
export interface Asset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  url: string;
  el: HTMLImageElement | HTMLVideoElement;
  width: number;
  height: number;
  duration: number;
  /** small data-URL preview for the UI */
  thumb: string;
  /** original file bytes, kept so projects can be saved */
  blob: Blob;
  mime: string;
}

let counter = 0;
const uid = () => `a${Date.now().toString(36)}${(counter++).toString(36)}`;

function makeThumb(el: CanvasImageSource, w: number, h: number): string {
  const { width, height } = fitWithin(w, h, 160);
  const c = createCanvas(width, height);
  get2d(c).drawImage(el, 0, 0, width, height);
  const url = c.toDataURL('image/jpeg', 0.7);
  c.width = c.height = 1;
  return url;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be decoded.'));
    img.src = url;
  });
}

class AssetStore {
  private items = new Map<string, Asset>();
  private listeners = new Set<() => void>();
  private snapshot: Asset[] = [];

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snapshot;
  private emit() {
    this.snapshot = [...this.items.values()];
    this.listeners.forEach((f) => f());
  }

  get(id: string): Asset | undefined {
    return this.items.get(id);
  }

  /** `id` is given when restoring a saved project so layer references still match. */
  async addFile(file: File | Blob, name = (file as File).name ?? 'asset', id?: string): Promise<Asset> {
    if (id && this.items.has(id)) return this.items.get(id)!;
    const type = file.type;
    const isVideo = type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(name);
    const isImage = type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(name);
    if (!isVideo && !isImage) throw new Error(`"${name}" is not an image or video.`);
    // SVGs are cleaned before anything draws them. The cleaned copy is what gets kept.
    if (isSvg(file, name)) file = new Blob([sanitizeSvg(await file.text())], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(file);
    try {
      let asset: Asset;
      if (isVideo) {
        const v = await loadVideo(url);
        v.muted = true;
        v.loop = false;
        asset = { id: id ?? uid(), kind: 'video', name, url, el: v, width: v.videoWidth, height: v.videoHeight, duration: v.duration, thumb: makeThumb(v, v.videoWidth, v.videoHeight), blob: file, mime: type };
      } else {
        const img = await loadImage(url);
        asset = { id: id ?? uid(), kind: 'image', name, url, el: img, width: img.naturalWidth, height: img.naturalHeight, duration: 0, thumb: makeThumb(img, img.naturalWidth, img.naturalHeight), blob: file, mime: type };
      }
      this.items.set(asset.id, asset);
      this.emit();
      return asset;
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
  }

  /** Copy media from another object URL (e.g. the Effects studio's current file). */
  async addFromUrl(url: string, name: string, type: string): Promise<Asset> {
    const blob = await (await fetch(url)).blob();
    return this.addFile(new File([blob], name, { type: type || blob.type }), name);
  }

  all(): Asset[] {
    return this.snapshot;
  }

  /** Empty the bin (used when opening another project). */
  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  remove(id: string) {
    const a = this.items.get(id);
    if (!a) return;
    if (a.kind === 'video') disposeVideo(a.el as HTMLVideoElement);
    URL.revokeObjectURL(a.url);
    this.items.delete(id);
    this.emit();
  }
}

export const assetStore = new AssetStore();
