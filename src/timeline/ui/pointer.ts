/** Capture the pointer for a drag; harmless if the pointer is already gone. */
export function capture(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* pointer no longer active */
  }
}
