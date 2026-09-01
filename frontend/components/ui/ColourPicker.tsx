"use client";

import { useCallback, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import HuePicker from "@/components/ui/HuePicker";
import { hsv } from "@/lib/crtPalette";

// Picking a colour, the way a colour is picked everywhere: a strip of hues, and
// a square where across is how much colour and down is how much light. The point
// in the square is the colour — not a target, not a ratio, the colour itself.
//
// Two sliders labelled brightness and saturation stood here before, and neither
// did what it said: brightness aimed at a contrast ratio with a floor beneath
// it, so the screen could never actually go dark. A square makes the model
// visible — the bottom edge is black, the left edge is grey — and leaves no room
// for a control to mean something other than its name.
export default function ColourPicker({
  hue,
  saturation,
  brightness,
  onChange,
  label,
}: {
  hue: number;
  saturation: number;
  brightness: number;
  onChange: (next: { hue?: number; saturation?: number; brightness?: number }) => void;
  label: string;
}) {
  const square = useRef<HTMLDivElement>(null);

  const fromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = square.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
      onChange({ saturation: Math.round(x * 100), brightness: Math.round((1 - y) * 100) });
    },
    [onChange],
  );

  function onDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    fromPoint(e.clientX, e.clientY);
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (e.buttons === 1) fromPoint(e.clientX, e.clientY);
  }
  // A held arrow key moves in ones; with shift, in tens.
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => onChange({ saturation: Math.max(0, saturation - step) }),
      ArrowRight: () => onChange({ saturation: Math.min(100, saturation + step) }),
      ArrowDown: () => onChange({ brightness: Math.max(0, brightness - step) }),
      ArrowUp: () => onChange({ brightness: Math.min(100, brightness + step) }),
    };
    const move = moves[e.key];
    if (move) {
      move();
      e.preventDefault();
    }
  }

  return (
    <span className="colourPicker">
      <div
        className="sv"
        ref={square}
        role="application"
        tabIndex={0}
        aria-label={label}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onKeyDown={onKey}
        style={{ "--sv-hue": hsv(hue, 100, 100) } as React.CSSProperties}
      >
        <div
          className="sv-knob"
          style={{ left: `${saturation}%`, top: `${100 - brightness}%`, background: hsv(hue, saturation, brightness) }}
        />
      </div>
      <HuePicker value={hue} onChange={(h) => onChange({ hue: h })} />
    </span>
  );
}
