"use client";

import { useCallback, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

// The phosphor colour: a strip of every hue. Not a list of four themes, because
// measured they were one theme with four hues.
export default function HuePicker({ value, onChange }: { value: number; onChange: (hue: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  const fromX = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      onChange(Math.round(t * 359));
    },
    [onChange],
  );

  function onDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    fromX(e.clientX);
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 1) fromX(e.clientX);
  }
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft") { onChange((value + 359) % 360); e.preventDefault(); }
    if (e.key === "ArrowRight") { onChange((value + 1) % 360); e.preventDefault(); }
  }

  return (
    <div
      className="hue"
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Phosphor colour"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={359}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onKeyDown={onKey}
    >
      <div className="hue-knob" style={{ left: `${(value / 359) * 100}%` }} />
    </div>
  );
}
