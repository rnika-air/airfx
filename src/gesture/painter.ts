import { createCanvas, get2d } from '../utils/imageProcessing';

export type BrushKind = 'spray' | 'soft' | 'solid';

const HISTORY = 25;

/**
 * The drawing. Finished paint lives on `canvas` (transparent, view space). The
 * stroke being drawn builds up on its own layer at full strength and is laid
 * down at the brush opacity when it ends, so a stroke never darkens where it
 * crosses itself, and spray can still build up while the hand holds still.
 */
export class Painter {
  canvas: HTMLCanvasElement;
  private live: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  kind: BrushKind = 'spray';
  color = '#c6ff2e';
  /** Brush radius as a share of the picture's short side. */
  size = 0.022;
  opacity = 1;
  /** Spray: how much paint comes out per second. */
  flow = 0.6;
  active = false;
  private last: { x: number; y: number } | null = null;
  private mid: { x: number; y: number } | null = null;
  private eraseLast: { x: number; y: number } | null = null;
  private undoStack: HTMLCanvasElement[] = [];
  private redoStack: HTMLCanvasElement[] = [];
  private seed = 1;
  private stampKey = '';
  private stamp: HTMLCanvasElement | null = null;
  /** Bumped on every change, for the interface. */
  version = 0;

  constructor(w = 1280, h = 720) {
    this.canvas = createCanvas(w, h);
    this.live = createCanvas(w, h);
    this.ctx = get2d(this.canvas);
    this.lctx = get2d(this.live);
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  /** Match the camera. Paint already there is scaled to fit. */
  resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    const old = createCanvas(this.width, this.height);
    get2d(old).drawImage(this.canvas, 0, 0);
    this.canvas.width = this.live.width = w;
    this.canvas.height = this.live.height = h;
    this.ctx.drawImage(old, 0, 0, w, h);
    this.undoStack = []; this.redoStack = [];
    this.version++;
  }

  radius() { return Math.max(1, this.size * Math.min(this.width, this.height)); }
  setSize(s: number) { this.size = Math.min(0.15, Math.max(0.003, s)); this.version++; }

  private rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  private snapshot() {
    const c = this.undoStack.length >= HISTORY ? this.undoStack.shift()! : createCanvas(this.width, this.height);
    if (c.width !== this.width || c.height !== this.height) { c.width = this.width; c.height = this.height; }
    const g = get2d(c);
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(this.canvas, 0, 0);
    this.undoStack.push(c);
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private swap(from: HTMLCanvasElement[], to: HTMLCanvasElement[]) {
    const prev = from.pop();
    if (!prev) return;
    const cur = createCanvas(this.width, this.height);
    get2d(cur).drawImage(this.canvas, 0, 0);
    to.push(cur);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.drawImage(prev, 0, 0);
    this.version++;
  }
  undo() { this.end(); this.swap(this.undoStack, this.redoStack); }
  redo() { this.end(); this.swap(this.redoStack, this.undoStack); }

  clear(keepHistory = true) {
    this.end();
    if (keepHistory) this.snapshot(); else { this.undoStack = []; this.redoStack = []; }
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.version++;
  }

  /** True if any pixel has paint (cheap: reads a small copy). */
  hasPaint() {
    const s = createCanvas(64, 36), g = get2d(s, true);
    g.drawImage(this.canvas, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  }

  begin(x: number, y: number) {
    this.end();
    this.snapshot();
    this.active = true;
    this.lctx.clearRect(0, 0, this.width, this.height);
    this.last = { x, y };
    this.mid = { x, y };
    this.paint(x, y, x, y, 1 / 30);
  }

  to(x: number, y: number, dt: number) {
    if (!this.active || !this.last) return this.begin(x, y);
    this.paint(this.last.x, this.last.y, x, y, dt);
    this.last = { x, y };
  }

  end() {
    if (!this.active) return;
    this.ctx.save();
    this.ctx.globalAlpha = this.opacity;
    this.ctx.drawImage(this.live, 0, 0);
    this.ctx.restore();
    this.lctx.clearRect(0, 0, this.width, this.height);
    this.active = false;
    this.last = this.mid = null;
    this.version++;
  }

  private softStamp(r: number) {
    const key = `${this.color}|${Math.round(r)}`;
    if (this.stamp && this.stampKey === key) return this.stamp;
    const s = Math.ceil(r * 2) + 2, c = createCanvas(s, s), g = get2d(c);
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r);
    grad.addColorStop(0, this.color);
    grad.addColorStop(0.45, this.color + 'aa');
    grad.addColorStop(1, this.color + '00');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    this.stamp = c; this.stampKey = key;
    return c;
  }

  /** Paint the segment from (x0,y0) to (x1,y1) onto the stroke layer. */
  private paint(x0: number, y0: number, x1: number, y1: number, dt: number) {
    const g = this.lctx, r = this.radius(), len = Math.hypot(x1 - x0, y1 - y0);
    if (this.kind === 'solid') {
      // Curves through segment midpoints: smooth, with no corners at each frame.
      const m = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      g.strokeStyle = this.color;
      g.lineWidth = r * 2;
      g.lineCap = g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(this.mid!.x, this.mid!.y);
      if (len < 0.5) g.lineTo(m.x + 0.01, m.y);
      else g.quadraticCurveTo(x0, y0, m.x, m.y);
      g.stroke();
      this.mid = m;
      return;
    }
    if (this.kind === 'soft') {
      const st = this.softStamp(r), step = Math.max(1, r * 0.22), n = Math.max(1, Math.ceil(len / step));
      g.globalAlpha = 0.18 + 0.3 * this.flow;
      for (let i = 1; i <= n; i++) {
        const k = len < 0.5 ? 1 : i / n;
        g.drawImage(st, x0 + (x1 - x0) * k - st.width / 2, y0 + (y1 - y0) * k - st.height / 2);
      }
      g.globalAlpha = 1;
      return;
    }
    // Spray: droplets scattered round the line, densest in the middle. Holding still builds paint up.
    g.fillStyle = this.color;
    const area = (r * r) / 400;
    const count = Math.round(this.flow * (1500 * dt * area + (len / r) * 150 * Math.sqrt(area))) + 3;
    const dot = Math.max(0.55, r * 0.032);
    for (let i = 0; i < count; i++) {
      const k = this.rand(), a = this.rand() * Math.PI * 2;
      // Sum of two randoms: a soft centre falling to a ragged edge.
      const d = r * Math.min(1, Math.abs(this.rand() + this.rand() - 1) * 1.15);
      const x = x0 + (x1 - x0) * k + Math.cos(a) * d, y = y0 + (y1 - y0) * k + Math.sin(a) * d;
      g.globalAlpha = 0.35 + 0.65 * this.rand();
      const s = dot * (0.6 + this.rand() * 0.9);
      g.fillRect(x - s / 2, y - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }

  beginErase() { this.end(); this.snapshot(); this.eraseLast = null; }

  eraseTo(x: number, y: number, r: number) {
    const g = this.ctx;
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = g.fillStyle = '#000';
    g.lineWidth = r * 2;
    g.lineCap = 'round';
    g.beginPath();
    if (this.eraseLast) { g.moveTo(this.eraseLast.x, this.eraseLast.y); g.lineTo(x, y); g.stroke(); }
    else { g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
    g.restore();
    this.eraseLast = { x, y };
    this.version++;
  }

  endErase() { this.eraseLast = null; }

  /** The drawing as the viewer sees it right now, onto `g`. */
  drawInto(g: CanvasRenderingContext2D, w: number, h: number) {
    g.drawImage(this.canvas, 0, 0, w, h);
    if (this.active) {
      g.save();
      g.globalAlpha = this.opacity;
      g.drawImage(this.live, 0, 0, w, h);
      g.restore();
    }
  }

  toBlob(): Promise<Blob> {
    this.end();
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('The drawing could not be saved.'))), 'image/png'));
  }
}
