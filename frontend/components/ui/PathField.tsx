"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Input from "@/components/ui/Input";
import { api } from "@/lib/api";

// A field for a folder.
//
// Nobody types `/Volumes/M2mini/WORK/NYO/projects/plxr3` by hand. The daemon can
// already complete a path — it reads the directory and offers what is in it —
// and this is the field that asks it. Type a few letters, pick, keep going.
//
// The list hangs in the body like every other one here, so nothing that scrolls
// can cut it off.
export default function PathField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const el = anchor.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = list.current?.offsetHeight ?? 0;
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
  }, [open, options, place]);

  // Asked on every change, because the answer depends on what has been typed so
  // far — the directory being read is part of the input.
  useEffect(() => {
    let dropped = false;
    api
      .paths(value)
      .then((p) => {
        if (dropped) return;
        setOptions(p ?? []);
        setActive(0);
      })
      .catch(() => setOptions([]));
    return () => {
      dropped = true;
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  // Picking a folder leaves the separator on, so the next keystroke starts
  // inside it rather than replacing it.
  function pick(path: string) {
    onChange(path.endsWith("/") ? path : `${path}/`);
    setOpen(true);
  }

  return (
    <div className="pathfield" ref={anchor}>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        /* Not on focus alone.
           The window coming to the front hands the first field the focus, and
           the list then covered half the window before anybody had asked for
           anything. It opens when there is an intention behind it: a key, or a
           click in the field. */
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!open || options.length === 0) return;
          if (e.key === "ArrowDown") {
            setActive((i) => Math.min(options.length - 1, i + 1));
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setActive((i) => Math.max(0, i - 1));
            e.preventDefault();
          } else if (e.key === "Tab" || e.key === "Enter") {
            // Enter only completes while the list is open; a second Enter is
            // then free to mean "start it".
            if (options[active]) {
              pick(options[active]);
              e.preventDefault();
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />

      {open && options.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <div
              className="selectList pathList"
              role="listbox"
              ref={list}
              style={box ? { left: `${box.left}px`, top: `${box.top}px`, minWidth: `${box.width}px` } : undefined}
            >
              {options.map((path, i) => (
                <button
                  key={path}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  data-picked={i === active ? "" : undefined}
                  className="selectRow"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(path)}
                >
                  {path}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
