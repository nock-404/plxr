"use client";

import { useCallback, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

// A custom slider — never the native range input. Pointer-drag and arrow keys.
export default function Slider({
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const raw = min + t * (max - min);
      const snapped = Math.round(raw / step) * step;
      onChange(Number(snapped.toFixed(4)));
    },
    [min, max, step, onChange],
  );

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 1) setFromClientX(e.clientX);
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      onChange(Math.max(min, Number((value - step).toFixed(4))));
      e.preventDefault();
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      onChange(Math.min(max, Number((value + step).toFixed(4))));
      e.preventDefault();
    }
  }

  return (
    <div
      className="slider"
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="slider-knob" style={{ left: `${pct}%` }} />
    </div>
  );
}
