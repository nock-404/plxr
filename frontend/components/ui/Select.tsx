"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A custom listbox — never the native <select>.
//
// While open the list hangs in the document body and positions itself over the
// trigger. Anything else gets clipped: the settings card scrolls, and a list
// drawn inside it is cut off at the card's edge — which is exactly what
// happened to the skin picker, where "Pixel" was sliced in half.
export type Option<T extends string> = { value: T; label: string };

export default function Select<T extends string>({
  value,
  options,
  onChange,
  title,
  disabled = false,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  title?: string;
  /* For the moment a choice is being carried out. Without it a second click
     lands while the first is still travelling, and two of whatever it starts
     are on their way. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = list.current?.offsetHeight ?? 0;
    // Below the trigger, unless there is no room down there.
    const below = r.bottom + 4;
    const flip = height > 0 && below + height > window.innerHeight;
    setBox({
      left: Math.round(r.left),
      top: Math.round(flip ? Math.max(4, r.top - height - 4) : below),
      width: Math.round(r.width),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // A list that hangs in the body does not travel with what scrolls beneath
    // it, so it closes rather than pointing at nothing.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const current = options.find((o) => o.value === value);

  return (
    <div
      className="select"
      ref={anchor}
      data-open={open ? "" : undefined}
      data-disabled={disabled ? "yes" : undefined}
      title={title}
    >
      <button
        type="button"
        className="selectButton"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current?.label ?? ""}</span>
        <i className="selectArrow" aria-hidden="true">▾</i>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="selectList"
              role="listbox"
              ref={list}
              data-loose=""
              style={box ? { left: `${box.left}px`, top: `${box.top}px`, minWidth: `${box.width}px` } : undefined}
            >
              {options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  data-picked={o.value === value ? "" : undefined}
                  className="selectRow"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
