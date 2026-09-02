"use client";

/* How fast the window is actually drawing.
 *
 * The average alone hides the thing people feel: a window that draws 58 frames
 * in a second and spends 200ms of it on one of them reads as a stutter, not as
 * 58fps. So the worst gap in the window of measurement is carried alongside.
 *
 * Nothing runs until somebody watches. A frame loop that is always on would be
 * a measuring instrument that changes what it measures — and on the very
 * machine somebody is complaining is slow.
 */
export interface Frames {
  fps: number;
  worstMs: number;
}

export function watchFrames(report: (f: Frames) => void, everyMs = 500): () => void {
  let running = true;
  let last = performance.now();
  let started = last;
  let count = 0;
  let worst = 0;

  const tick = (now: number) => {
    if (!running) return;
    const gap = now - last;
    last = now;
    // The first frame after starting measures the wait for it, not a gap
    // between two drawn frames.
    if (count > 0 && gap > worst) worst = gap;
    count++;
    if (now - started >= everyMs) {
      report({
        fps: Math.round((count - 1) / ((now - started) / 1000)),
        worstMs: Math.round(worst),
      });
      started = now;
      count = 1;
      worst = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return () => {
    running = false;
  };
}
