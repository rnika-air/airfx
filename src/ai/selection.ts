import { ai, frameData, MapTrack, type Detection, type GrayMap } from './client';
import type { LoadedMedia } from '../hooks/useMedia';

/**
 * The selection: one or more objects, each with a mask per analysed frame.
 * Key, Cleanup, Depth and any stack step read it, so a subject is selected
 * once and reused. Slider changes never re-run the model.
 */

export type FrameFlag = 'ok' | 'weak' | 'occluded' | 'lost';
export interface PromptPoint { x: number; y: number; label: 1 | 0 }

export interface SelObject {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  track: MapTrack;
  /** Clicks and box of the frame being refined, in 0..1. */
  points: PromptPoint[];
  box: number[] | null;
  promptFrame: number;
  /** Per-frame tracking health, in step with track.frames. */
  flags: FrameFlag[];
}

const COLORS = ['#c6ff2e', '#2ee6ff', '#ff5ca8', '#ffb02e', '#a77bff', '#5cff9d'];
const MASK_EDGE = 1024;
let counter = 0;

export const sourceKeyOf = (m: LoadedMedia) => `${m.name}:${m.size}`;

/** Keeps only regions touching a keep point (or the box centre). Stray specks go. */
export function keepConnected(data: Float32Array, w: number, h: number, seeds: [number, number][]) {
  if (!seeds.length) return data;
  const seen = new Uint8Array(w * h), stack: number[] = [];
  for (const [sx, sy] of seeds) {
    const x0 = Math.round(sx * (w - 1)), y0 = Math.round(sy * (h - 1));
    // A click can land just outside a thin object; search nearby for the region.
    let hit = -1;
    for (let r = 0; r <= 12 && hit < 0; r += 2)
      for (let dy = -r; dy <= r && hit < 0; dy += Math.max(1, r))
        for (let dx = -r; dx <= r; dx += Math.max(1, r)) {
          const x = x0 + dx, y = y0 + dy;
          if (x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] > 0.5) { hit = y * w + x; break; }
        }
    if (hit >= 0 && !seen[hit]) { seen[hit] = 1; stack.push(hit); }
  }
  if (!stack.length) return data;
  while (stack.length) {
    const i = stack.pop()!, x = i % w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (j >= 0 && j < w * h && !seen[j] && data[j] > 0.3) { seen[j] = 1; stack.push(j); }
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = seen[i] ? data[i] : Math.min(data[i], 0.02);
  return out;
}

/**
 * Fills gaps fully enclosed by the mask. On dark or glossy objects the model is
 * unsure inside the object, which would leave pinholes in the cutout. Gaps larger
 * than 15% of the mask are left alone: they may be real openings.
 */
export function fillHoles(data: Float32Array, w: number, h: number) {
  const n = w * h, outside = new Uint8Array(n), stack: number[] = [];
  const reach = (i: number) => { if (!outside[i] && data[i] <= 0.5) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { reach(x); reach((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { reach(y * w); reach(y * w + w - 1); }
  const spread = (i: number, visit: (j: number) => void) => {
    const x = i % w;
    if (x > 0) visit(i - 1);
    if (x < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < n - w) visit(i + w);
  };
  while (stack.length) spread(stack.pop()!, reach);
  let area = 0;
  for (let i = 0; i < n; i++) if (data[i] > 0.5) area++;
  const out = data.slice(), done = new Uint8Array(n), limit = area * 0.15;
  for (let i = 0; i < n; i++) {
    if (data[i] > 0.5 || outside[i] || done[i]) continue;
    const hole = [i];
    done[i] = 1;
    for (let k = 0; k < hole.length; k++)
      spread(hole[k], (j) => { if (data[j] <= 0.5 && !outside[j] && !done[j]) { done[j] = 1; hole.push(j); } });
    if (hole.length <= limit) for (const j of hole) out[j] = 1;
  }
  return out;
}

/** Keeps `earlier` alongside `next` when `next` has lost most of it. */
function mergeIfDropped(next: Float32Array, earlier: Float32Array) {
  let had = 0, kept = 0;
  for (let i = 0; i < earlier.length; i++) if (earlier[i] > 0.5) { had++; if (next[i] > 0.5) kept++; }
  if (!had || kept >= had * 0.5) return next;
  const out = next.slice();
  for (let i = 0; i < out.length; i++) if (earlier[i] > out[i]) out[i] = earlier[i];
  return out;
}

/**
 * Share of a mask that survives a small morphological opening. A real object
 * keeps most of its area. A mask that has leaked along mortar lines, wires or
 * other hairlines loses it.
 */
export function solidity(data: Float32Array, w: number, h: number) {
  const area = data.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0);
  if (!area) return 0;
  const r = Math.max(2, Math.round(Math.sqrt(area) * 0.02)), W = w + 1;
  const sumOf = (on: (i: number) => boolean) => {
    const s = new Int32Array(W * (h + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
      s[(y + 1) * W + x + 1] = (on(y * w + x) ? 1 : 0) + s[y * W + x + 1] + s[(y + 1) * W + x] - s[y * W + x];
    return s;
  };
  const inBox = (s: Int32Array, x: number, y: number) => {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
    return s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
  };
  const mask = sumOf((i) => data[i] > 0.5), full = (2 * r + 1) ** 2;
  const eroded = new Uint8Array(w * h);
  for (let y = r; y < h - r; y++) for (let x = r; x < w - r; x++) if (inBox(mask, x, y) === full) eroded[y * w + x] = 1;
  const grown = sumOf((i) => eroded[i] === 1);
  let kept = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] > 0.5 && inBox(grown, x, y) > 0) kept++;
  return kept / area;
}

/** Undo restores the clicks as well as the mask, or the next click re-sends the undone one. */
interface UndoStep extends Pick<SelObject, 'id' | 'points' | 'box'> { frame: number; data: Float32Array }

class Selection {
  objects: SelObject[] = [];
  activeId: string | null = null;
  detections: Detection[] = [];
  /** The video time those boxes belong to, or null for a still image. */
  detectedAt: number | null = null;
  /** Why the last action could not finish, shown in the panel. */
  warning: string | null = null;
  version = 0;
  private listeners = new Set<() => void>();
  /** The model's other readings of the last click, smallest first. */
  private alternatives: GrayMap[] = [];
  private altIndex = 0;
  private altTime = 0;
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];
  /** The prompt as it was before the click being decoded. */
  private promptBefore: Pick<SelObject, 'points' | 'box'> | null = null;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  getVersion = () => this.version;
  bump() { this.version++; this.listeners.forEach((f) => f()); }

  get active() { return this.objects.find((o) => o.id === this.activeId) ?? null; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  clear() {
    this.objects = [];
    this.activeId = null;
    this.detections = [];
    this.warning = null;
    this.undoStack = [];
    this.redoStack = [];
    this.alternatives = [];
    this.altIndex = 0;
    this.bump();
  }

  add(name = `Object ${this.objects.length + 1}`) {
    const o: SelObject = { id: `o${++counter}`, name, color: COLORS[this.objects.length % COLORS.length], visible: true, track: new MapTrack(), points: [], box: null, promptFrame: -1, flags: [] };
    this.objects = [...this.objects, o];
    this.activeId = o.id;
    this.bump();
    return o;
  }
  remove(id: string) {
    this.objects = this.objects.filter((o) => o.id !== id);
    if (this.activeId === id) this.activeId = this.objects[0]?.id ?? null;
    this.bump();
  }
  select(id: string) { this.activeId = id; this.bump(); }
  toggle(id: string) { this.objects = this.objects.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)); this.bump(); }

  frameIndex(o: SelObject, time: number) {
    if (o.track.frames.length <= 1 || !o.track.fps) return 0;
    return Math.min(o.track.frames.length - 1, Math.round(time * o.track.fps));
  }

  hasMask() { return this.objects.some((o) => o.track.frames.length > 0); }

  /** Union of the visible objects at a time, at the size of the largest. */
  union(time: number): GrayMap | null {
    const maps = this.objects.filter((o) => o.visible).map((o) => o.track.at(time)).filter((m): m is GrayMap => !!m);
    if (!maps.length) return null;
    if (maps.length === 1) return maps[0];
    const base = maps.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)), data = new Float32Array(base.data);
    for (const m of maps) {
      if (m === base) continue;
      for (let y = 0; y < base.h; y++)
        for (let x = 0; x < base.w; x++) {
          const v = m.data[Math.floor((y / base.h) * m.h) * m.w + Math.floor((x / base.w) * m.w)];
          if (v > data[y * base.w + x]) data[y * base.w + x] = v;
        }
    }
    return { w: base.w, h: base.h, data };
  }

  private frameKey(media: LoadedMedia, time: number) { return `${sourceKeyOf(media)}@${media.kind === 'video' ? time.toFixed(3) : 0}`; }

  private async encode(media: LoadedMedia, time: number) {
    const image = frameData(media.element, media.width, media.height, MASK_EDGE);
    const key = this.frameKey(media, time);
    await ai.samEncode(key, image);
    return { key, w: image.width, h: image.height };
  }

  private store(o: SelObject, map: GrayMap, time: number, media: LoadedMedia) {
    const i = this.frameIndex(o, time);
    if (o.track.frames.length > 1) {
      this.remember(o, i);
      o.track.frames[i] = map;
      o.flags[i] = 'ok';
      o.track.version++;
    } else {
      if (o.track.frames.length) this.remember(o, 0);
      o.track.setStill(map, sourceKeyOf(media));
      o.flags = ['ok'];
    }
  }

  private remember(o: SelObject, frame: number) {
    const m = o.track.frames[frame];
    if (!m) return;
    const prompt = this.promptBefore ?? o;
    this.promptBefore = null;
    this.undoStack.push({ id: o.id, frame, data: m.data.slice(), points: prompt.points, box: prompt.box });
    if (this.undoStack.length > 24) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Ask the model for a mask from the object's current points and box. */
  private async decode(o: SelObject, media: LoadedMedia, time: number) {
    const f = await this.encode(media, time);
    const points = o.points.map((p) => [p.x * f.w, p.y * f.h]);
    const r = await ai.samDecode({
      frameKey: f.key,
      points: points.length ? points : undefined,
      labels: points.length ? o.points.map((p) => p.label) : undefined,
      box: o.box ? [o.box[0] * f.w, o.box[1] * f.h, o.box[2] * f.w, o.box[3] * f.h] : undefined,
    });
    const seeds: [number, number][] = o.points.filter((p) => p.label === 1).map((p) => [p.x, p.y]);
    if (o.box && !seeds.length) seeds.push([(o.box[0] + o.box[2]) / 2, (o.box[1] + o.box[3]) / 2]);
    // The model answers with one object. If a + click comes back without the earlier
    // selection, the user meant both (a hand and what it holds), so merge them.
    const had = o.track.frames[this.frameIndex(o, time)];
    const adding = o.points.length > 1 && o.points[o.points.length - 1].label === 1 && had?.w === r.w && had.h === r.h ? had.data : null;
    const clean = r.planes.map((pl) => {
      const kept = keepConnected(pl, r.w, r.h, o.box && !o.points.length ? [] : seeds);
      return fillHoles(adding ? mergeIfDropped(kept, adding) : kept, r.w, r.h);
    });
    const areas = clean.map((pl) => pl.reduce((a, v) => a + (v > 0.5 ? 1 : 0), 0));
    const top = Math.max(...r.scores);
    // A click can mean a part or the whole. The first mask is the model's whole
    // object, and its confidence scores favour tiny parts: a shirt patch scored
    // 0.86 against 0.53 for the player. So take the first mask unless it is
    // empty or nearly the entire frame. If it is mostly hairlines it has leaked
    // (a ball on a brick wall spread along the mortar), so take the largest
    // reading that is solid. Thin objects have no solid reading and keep the
    // first. Smaller / Larger reach the others.
    const usable = clean.map((_, i) => i).filter((i) => areas[i] > 0).sort((a, b) => areas[a] - areas[b]);
    let best = 0;
    if (!areas[0] || areas[0] > r.w * r.h * 0.7) best = r.scores.indexOf(top);
    else if (solidity(clean[0], r.w, r.h) < 0.8) {
      const solid = [...usable].reverse().find((i) => solidity(clean[i], r.w, r.h) >= 0.8);
      if (solid !== undefined) best = solid;
    }
    this.alternatives = usable.map((i) => ({ w: r.w, h: r.h, data: clean[i] }));
    this.altIndex = Math.max(0, usable.indexOf(best));
    this.altTime = time;
    this.store(o, { w: r.w, h: r.h, data: clean[best] }, time, media);
    this.promptBefore = null;
    this.warning = r.objectScore < 0 ? 'The model is unsure an object is there. Try another point.' : null;
  }

  get canSmaller() { return this.altIndex > 0; }
  get canLarger() { return this.altIndex < this.alternatives.length - 1; }

  /** Step between the model's readings of the last click. */
  stepSize(dir: 1 | -1, media: LoadedMedia) {
    const o = this.active, next = this.alternatives[this.altIndex + dir];
    if (!o || !next) return;
    this.altIndex += dir;
    this.store(o, { ...next, data: next.data.slice() }, this.altTime, media);
    this.bump();
  }

  /** label 1 adds to the selection, 0 subtracts from it. */
  async click(media: LoadedMedia, time: number, nx: number, ny: number, label: 1 | 0, fresh: boolean) {
    let o = fresh ? null : this.active;
    if (!o) o = this.add();
    const frame = media.kind === 'video' ? Math.round(time * 1000) : 0;
    this.promptBefore = { points: o.points, box: o.box };
    if (o.promptFrame !== frame) { o.points = []; o.box = null; o.promptFrame = frame; }
    o.points = [...o.points, { x: nx, y: ny, label }];
    await this.decode(o, media, time);
    this.bump();
  }

  /** box is [x0, y0, x1, y1] in 0..1. */
  async boxSelect(media: LoadedMedia, time: number, box: number[], name?: string, fresh = true) {
    let o = fresh ? null : this.active;
    if (!o) o = this.add(name);
    this.promptBefore = { points: o.points, box: o.box };
    o.points = [];
    o.box = box;
    o.promptFrame = media.kind === 'video' ? Math.round(time * 1000) : 0;
    await this.decode(o, media, time);
    this.bump();
  }

  /** Runs the detector once per media time; results stay until media changes. */
  async detect(media: LoadedMedia) {
    const image = frameData(media.element, media.width, media.height, 800);
    const raw = await ai.detect(image);
    // The detector can return duplicates of one object. Keep the strongest.
    const iou = (a: number[], b: number[]) => {
      const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])), i = ix * iy;
      return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i);
    };
    const kept: Detection[] = [];
    for (const d of raw.sort((a, b) => b.score - a.score)) if (!kept.some((k) => k.label === d.label && iou(k.box, d.box) > 0.5)) kept.push(d);
    this.detections = kept;
    this.detectedAt = media.element instanceof HTMLVideoElement ? media.element.currentTime : null;
    this.warning = kept.length ? null : 'No objects found. YOLOS knows 80 everyday things, such as people, cars and animals, so try Auto Subject or a click instead.';
    this.bump();
    return kept;
  }

  /** Boxes describe one frame, so they are not shown on any other. */
  detectionsAt(time: number) {
    return this.detectedAt === null || Math.abs(time - this.detectedAt) < 0.1 ? this.detections : [];
  }

  /** The most prominent detection, preferring people, becomes the selection. */
  async autoSubject(media: LoadedMedia, time: number, onlyPeople: boolean) {
    const dets = await this.detect(media);
    const area = (d: Detection) => (d.box[2] - d.box[0]) * (d.box[3] - d.box[1]);
    const pool = onlyPeople ? dets.filter((d) => d.label === 'person') : dets.filter((d) => area(d) < 0.92);
    const pick = pool.slice().sort((a, b) => area(b) * (b.label === 'person' ? 1.6 : 1) * b.score - area(a) * (a.label === 'person' ? 1.6 : 1) * a.score)[0];
    if (!pick) {
      this.warning = onlyPeople ? 'No person found. Click the subject instead.' : 'No known object found. Click the subject instead.';
      this.bump();
      return false;
    }
    await this.boxSelect(media, time, pick.box.map((v) => Math.min(1, Math.max(0, v))), pick.label);
    return true;
  }

  /** Start a brush stroke, making an empty mask if nothing is selected yet. */
  beginStroke(media: LoadedMedia, time: number) {
    let o = this.active;
    if (!o) o = this.add('Brush Selection');
    if (!o.track.frames.length) {
      const k = MASK_EDGE / Math.max(media.width, media.height), w = Math.round(media.width * Math.min(1, k)), h = Math.round(media.height * Math.min(1, k));
      o.track.setStill({ w, h, data: new Float32Array(w * h) }, sourceKeyOf(media));
      o.flags = ['ok'];
    }
    this.remember(o, this.frameIndex(o, time));
    return o;
  }

  /** value 1 adds, 0 erases. Works on the mask at this frame only. */
  dab(o: SelObject, time: number, nx: number, ny: number, radius: number, soft: number, value: number) {
    const m = o.track.frames[this.frameIndex(o, time)];
    if (!m) return;
    const cx = nx * m.w, cy = ny * m.h, r = Math.max(1, radius * Math.max(m.w, m.h));
    for (let y = Math.max(0, (cy - r) | 0); y <= Math.min(m.h - 1, cy + r); y++)
      for (let x = Math.max(0, (cx - r) | 0); x <= Math.min(m.w - 1, cx + r); x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d >= 1) continue;
        const k = d <= 1 - soft ? 1 : (1 - d) / Math.max(0.001, soft), i = y * m.w + x;
        m.data[i] += (value - m.data[i]) * k;
      }
    o.track.version++;
  }

  undo() { this.swap(this.undoStack, this.redoStack); }
  redo() { this.swap(this.redoStack, this.undoStack); }
  private swap(from: Selection['undoStack'], to: Selection['undoStack']) {
    const e = from.pop();
    if (!e) return;
    const o = this.objects.find((x) => x.id === e.id), m = o?.track.frames[e.frame];
    if (!o || !m) return;
    to.push({ id: e.id, frame: e.frame, data: m.data, points: o.points, box: o.box });
    m.data = e.data;
    o.points = e.points;
    o.box = e.box;
    // Smaller / Larger belonged to the click that was just undone.
    this.alternatives = [];
    this.altIndex = 0;
    o.track.version++;
    this.bump();
  }
}

export const selection = new Selection();
