import type { HandFull } from '../ai/vision';
import type { Painter } from './painter';

/**
 * Turns two tracked hands into drawing. Pure logic over landmarks, so it can be
 * tested without a camera: give it hands and a time, it drives the painter.
 *
 * Right hand: point to draw, pinch and move up or down to change the size, open
 * palm to wipe. Left hand: fist stops drawing, open hand resumes, a V sign
 * changes colour.
 */

export type Gesture = 'none' | 'point' | 'fist' | 'open' | 'pinch' | 'victory' | 'other';
type Pt = { x: number; y: number };

export const GESTURE_LABEL: Record<Gesture, string> = {
  none: 'Not seen', point: 'Pointing', fist: 'Fist', open: 'Open Hand', pinch: 'Pinch', victory: 'V Sign', other: 'Other',
};

/**
 * Reads a hand pose from its 21 points (normalised, as the model gives them).
 * Uses distances from the wrist, so it works at any angle in the picture.
 * `aspect` is width / height, so distances are measured in real proportions.
 */
export function classify(pts: Pt[], aspect = 1, pinchHeld = false): Gesture {
  if (pts.length < 21) return 'none';
  const d = (a: number, b: number) => Math.hypot((pts[a].x - pts[b].x) * aspect, pts[a].y - pts[b].y);
  const palm = d(0, 9) || 1e-6;
  // A finger is out when its tip is clearly further from the wrist than its middle joint.
  const ext = (tip: number, pip: number) => d(0, tip) > d(0, pip) * 1.12;
  const idx = ext(8, 6), mid = ext(12, 10), ring = ext(16, 14), pinky = ext(20, 18);
  // Pinch: thumb and index tips together, with the index reaching forward (in a fist they can touch too).
  const gap = d(4, 8) / palm;
  if (gap < (pinchHeld ? 0.42 : 0.28) && d(0, 8) > palm * 1.05) return 'pinch';
  const count = +idx + +mid + +ring + +pinky;
  if (count >= 4) return 'open';
  if (count === 0) return 'fist';
  if (idx && !mid && !ring && !pinky) return 'point';
  if (idx && mid && !ring && !pinky) return 'victory';
  return 'other';
}

/** A pose counts once it has held for a few frames, so passing shapes do nothing. */
class Stable {
  cur: Gesture = 'none';
  private cand: Gesture = 'none';
  private n = 0;
  push(g: Gesture, need: number) {
    if (g === this.cand) this.n++;
    else { this.cand = g; this.n = 1; }
    if (this.n >= need) this.cur = g;
    return this.cur;
  }
  reset() { this.cur = this.cand = 'none'; this.n = 0; }
}

/** One Euro filter: steady when the hand is still, quick when it moves. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(public minCutoff = 1.2, public beta = 0.004) {}
  filter(v: number, t: number) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1 / 240, t - this.t);
    this.t = t;
    const alpha = (fc: number) => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
    this.dx += alpha(1) * ((v - this.x) / dt - this.dx);
    this.x += alpha(this.minCutoff + this.beta * Math.abs(this.dx)) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}

export interface StudioSettings {
  /** 0..1: higher reacts to a pose sooner and finds hands more eagerly. */
  sensitivity: number;
  /** 0..1: higher removes more jitter from the fingertip. */
  smoothing: number;
  /** 0..1: how quickly the brush catches up with the fingertip. 1 is at once. */
  speed: number;
  /** The view is shown mirrored, like a mirror. */
  mirror: boolean;
  /** Swap which hand is which (set by calibration if the camera reports them the other way). */
  swapHands: boolean;
}

export interface HandView { side: 'left' | 'right'; gesture: Gesture; points: Pt[]; palm: number }

export interface EngineStatus {
  left: Gesture;
  right: Gesture;
  paused: boolean;
  mode: 'idle' | 'draw' | 'size' | 'erase' | 'paused';
  cursor: Pt | null;
  eraser: (Pt & { r: number }) | null;
  hands: HandView[];
  /** Times the colour gesture has fired, so the interface can react. */
  colorChanges: number;
  frames: number;
}

const freshStatus = (): EngineStatus => ({ left: 'none', right: 'none', paused: false, mode: 'idle', cursor: null, eraser: null, hands: [], colorChanges: 0, frames: 0 });

export class GestureEngine {
  settings: StudioSettings = { sensitivity: 0.6, smoothing: 0.55, speed: 0.75, mirror: true, swapHands: false };
  status: EngineStatus = freshStatus();
  /** False until drawing is allowed (camera on, tutorial past its first steps). */
  enabled = true;
  /** Called when the left hand asks for the next colour. */
  onColor: (() => void) | null = null;
  private stable = { left: new Stable(), right: new Stable() };
  private fx = new OneEuro();
  private fy = new OneEuro();
  private brush: Pt | null = null;
  private lastTip: Pt | null = null;
  private lastT = 0;
  private seenRight = -1;
  private sizeGrab: { y: number; size: number } | null = null;
  private wasVictory = false;
  private colorAt = -10;
  private erasing = false;

  constructor(public painter: Painter) {}

  reset() {
    this.painter.end();
    if (this.erasing) this.painter.endErase();
    this.erasing = false;
    this.stable.left.reset(); this.stable.right.reset();
    this.fx.reset(); this.fy.reset();
    this.brush = this.lastTip = null;
    this.sizeGrab = null;
    const paused = this.status.paused, changes = this.status.colorChanges;
    this.status = { ...freshStatus(), paused, colorChanges: changes };
  }

  /** Assigns hands to sides in view space. Two hands named the same are told apart by position. */
  private sides(hands: HandFull[], w: number, h: number) {
    const s = this.settings;
    const views = hands.map((hd) => {
      const side = s.swapHands ? (hd.side === 'left' ? 'right' : 'left') : hd.side;
      const points = hd.points.map((p) => ({ x: (s.mirror ? 1 - p.x : p.x) * w, y: p.y * h }));
      return { side, raw: hd.points, points, rawX: hd.points[0].x, score: hd.score } as { side: 'left' | 'right'; raw: Pt[]; points: Pt[]; rawX: number; score: number };
    });
    if (views.length === 2 && views[0].side === views[1].side) {
      // Facing the camera, a person's right hand is on the left of the camera's own picture.
      const [a, b] = views[0].rawX < views[1].rawX ? [views[0], views[1]] : [views[1], views[0]];
      a.side = s.swapHands ? 'left' : 'right';
      b.side = s.swapHands ? 'right' : 'left';
    }
    return { left: views.find((v) => v.side === 'left') ?? null, right: views.find((v) => v.side === 'right') ?? null, all: views };
  }

  /** One camera frame. `t` in seconds, `w`×`h` the view size in pixels. */
  step(hands: HandFull[], t: number, w: number, h: number) {
    const s = this.settings, st = this.status, p = this.painter;
    const need = Math.max(2, Math.round(5 - 3 * s.sensitivity));
    const aspect = w / h;
    const dt = this.lastT ? Math.min(0.2, Math.max(0.001, t - this.lastT)) : 1 / 30;
    this.lastT = t;
    st.frames++;
    const { left: L, right: R, all } = this.sides(hands, w, h);

    // Left hand: stop, resume, next colour.
    const lg = this.stable.left.push(L ? classify(L.raw, aspect) : 'none', need);
    if (lg === 'fist') st.paused = true;
    else if (lg === 'open') st.paused = false;
    const v = lg === 'victory';
    if (v && !this.wasVictory && t - this.colorAt > 0.6) { this.colorAt = t; st.colorChanges++; this.onColor?.(); }
    this.wasVictory = v;

    // Right hand. A short dropout keeps the current pose, so a stroke does not break.
    if (R) this.seenRight = t;
    const held = !R && this.seenRight >= 0 && t - this.seenRight < 0.25;
    const rg = held ? this.stable.right.cur : this.stable.right.push(R ? classify(R.raw, aspect, this.stable.right.cur === 'pinch') : 'none', need);

    // Fingertip, filtered all the time so it is settled when drawing starts.
    let tip: Pt | null = null;
    if (R) {
      const sm = s.smoothing;
      this.fx.minCutoff = this.fy.minCutoff = 3.2 - 2.8 * sm;
      this.fx.beta = this.fy.beta = 0.006 - 0.004 * sm;
      tip = { x: this.fx.filter(R.points[8].x, t), y: this.fy.filter(R.points[8].y, t) };
    } else if (!held) { this.fx.reset(); this.fy.reset(); }

    st.cursor = null; st.eraser = null;
    let mode: EngineStatus['mode'] = st.paused ? 'paused' : 'idle';

    // Pinch: grab the size, move up for bigger and down for smaller.
    if (rg === 'pinch' && R) {
      p.end();
      const mid = { x: (R.points[4].x + R.points[8].x) / 2, y: (R.points[4].y + R.points[8].y) / 2 };
      if (!this.sizeGrab) this.sizeGrab = { y: mid.y, size: p.size };
      if (this.enabled) p.setSize(this.sizeGrab.size * Math.exp((this.sizeGrab.y - mid.y) / (h * 0.22)));
      st.cursor = mid;
      mode = 'size';
    } else this.sizeGrab = null;

    // Open palm: wipe.
    if (rg === 'open' && R && this.enabled) {
      p.end();
      const ids = [0, 5, 9, 13, 17];
      const c = { x: ids.reduce((a, i) => a + R.points[i].x, 0) / 5, y: ids.reduce((a, i) => a + R.points[i].y, 0) / 5 };
      const palm = Math.hypot(R.points[0].x - R.points[9].x, R.points[0].y - R.points[9].y);
      const r = Math.max(p.radius() * 1.5, palm * 0.95);
      if (!this.erasing) { p.beginErase(); this.erasing = true; }
      p.eraseTo(c.x, c.y, r);
      st.eraser = { ...c, r };
      mode = 'erase';
    } else if (this.erasing) { p.endErase(); this.erasing = false; }

    // Point: draw, unless stopped by the left hand.
    if (rg === 'point' && !st.paused && this.enabled) {
      if (tip) {
        const jump = this.lastTip && Math.hypot(tip.x - this.lastTip.x, tip.y - this.lastTip.y) > 0.22 * Math.max(w, h);
        if (jump) p.end();
        if (!p.active) {
          // Start exactly at the fingertip: if the filter is still catching up, settle it there.
          const raw = R!.points[8];
          if (Math.hypot(raw.x - tip.x, raw.y - tip.y) > p.radius()) { this.fx.reset(); this.fy.reset(); tip = { x: this.fx.filter(raw.x, t), y: this.fy.filter(raw.y, t) }; }
          this.brush = { ...tip };
          p.begin(tip.x, tip.y);
        }
        else {
          // Drawing speed: how quickly the brush follows the fingertip.
          const rate = 4 + 76 * s.speed * s.speed;
          const k = s.speed >= 0.999 ? 1 : 1 - Math.exp(-dt * rate);
          this.brush = { x: this.brush!.x + (tip.x - this.brush!.x) * k, y: this.brush!.y + (tip.y - this.brush!.y) * k };
          p.to(this.brush.x, this.brush.y, dt);
        }
        st.cursor = this.brush;
        mode = 'draw';
      }
    } else {
      p.end();
      if (rg === 'point' && tip) st.cursor = tip;
    }
    if (!st.cursor && tip && rg !== 'open') st.cursor = tip;
    this.lastTip = tip ?? (held ? this.lastTip : null);

    st.left = lg;
    st.right = rg;
    st.mode = mode;
    st.hands = all.map((a) => ({ side: a.side, gesture: a.side === 'left' ? lg : rg, points: a.points, palm: Math.hypot(a.points[0].x - a.points[9].x, a.points[0].y - a.points[9].y) / h }));
  }
}
