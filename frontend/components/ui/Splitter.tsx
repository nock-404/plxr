"use client";

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

/* The line between two panels, and the handle for moving it.
 *
 * One component for every docked column — the settings, the workbench, the file
 * tree — because they all pose the same question and a panel whose width nobody
 * can change is a panel that is wrong for somebody.
 *
 * It reports rem rather than pixels, like everything else that has a size here,
 * so a change of interface size does not silently make every panel narrower.
 */
export default function Splitter({
  value,
  min,
  max,
  side,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  /* Which side of the handle the panel being sized is on. Dragging left has to
     widen a panel docked on the right and narrow one docked on the left. */
  side: "left" | "right";
  label: string;
  onChange: (rem: number) => void;
}) {
  const from = useRef<{ x: number; rem: number } | null>(null);

  const rootSize = () =>
    parseFloat(getComputedStyle(document.documentElement).fontSize || "16") || 16;

  /* The far end is not a fixed number.
   *
   * A ceiling in rem alone is a ceiling for one window size: at 52rem the panel
   * fitted a wide screen and squeezed the work beside it down to nothing on a
   * narrow one — the gate caught it doing exactly that. So the window has a say:
   * whatever else is set, a docked panel never takes more than three fifths of
   * what there is. */
  const clamp = useCallback(
    (rem: number) => {
      const room = (window.innerWidth / rootSize()) * 0.6;
      return Math.max(min, Math.min(max, room, rem));
    },
    [min, max],
  );

  function onDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { x: e.clientX, rem: value };
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const start = from.current;
    if (!start || e.buttons !== 1) return;
    const moved = (e.clientX - start.x) / rootSize();
    onChange(clamp(side === "right" ? start.rem - moved : start.rem + moved));
  }

  function onUp() {
    from.current = null;
  }

  // The keyboard moves it too: a handle that only answers to a mouse is a
  // setting some people cannot reach at all.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 4 : 1;
    if (e.key === "ArrowLeft") {
      onChange(clamp(side === "right" ? value + step : value - step));
      e.preventDefault();
    }
    if (e.key === "ArrowRight") {
      onChange(clamp(side === "right" ? value - step : value + step));
      e.preventDefault();
    }
  }

  // While dragging, the whole window shows the resize cursor — otherwise it
  // flickers back the moment the pointer leaves the thin handle.
  useEffect(() => {
    return () => {
      document.body.style.removeProperty("cursor");
    };
  }, []);

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onKeyDown={onKey}
    />
  );
}
