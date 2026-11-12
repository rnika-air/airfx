/**
 * Where the pointer is over the preview, for effects that react to it.
 * Coordinates are 0..1 of the picture. Effects read this during render, and
 * the app re-renders on movement only while such an effect is in the stack.
 */
export interface PointerSample { x: number; y: number; down: boolean; t: number }

class StagePointer {
  x = 0.5;
  y = 0.5;
  inside = false;
  down = false;
  /** Samples since an effect last read them, so fast strokes do not leave gaps. */
  private queue: PointerSample[] = [];
  private listeners = new Set<() => void>();
  version = 0;

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };

  move(x: number, y: number, down: boolean) {
    this.x = x; this.y = y; this.down = down; this.inside = true;
    this.queue.push({ x, y, down, t: performance.now() });
    if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 400);
    this.version++;
    this.listeners.forEach((f) => f());
  }

  leave() {
    this.inside = false;
    this.down = false;
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** Asks for a new frame without moving: for timed transitions started by a button. */
  kick() {
    this.version++;
    this.listeners.forEach((f) => f());
  }

  /** Takes the samples gathered since the last call. */
  take(): PointerSample[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}

export const stagePointer = new StagePointer();

/** Effects that read the pointer (or hands) and need a new frame when it moves. */
export const INTERACTIVE = new Set(['reveal', 'particleSim']);
