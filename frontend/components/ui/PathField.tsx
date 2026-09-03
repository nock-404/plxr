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
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (path: string) => void;
  /* What Enter means when nothing in the list has been picked out: take the
     path as it stands and get on with it. Without this the field had no way to
     say "this one, the folder I just typed". */
  onSubmit?: () => void;
  placeholder?: string;
}) {
  const [options, setOptions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /* Whether the arrows have been used since the last keystroke.
   *
   * Enter used to complete into options[active] unconditionally, and the effect
   * below resets active to 0 on every change — so Enter always opened the first
   * folder inside whatever had been typed, and the next Enter opened the first
   * folder inside that. A path typed out in full could not be accepted at all.
   * Enter now belongs to what is typed unless somebody has actually moved down
   * the list. */
  const [moved, setMoved] = useState(false);
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
        setMoved(false);
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
          // Enter has to work with the list shut and with nothing to suggest:
          // a path typed out in full is the case that matters most.
          if (e.key === "Enter") {
            e.preventDefault();
            if (open && moved && options[active]) {
              pick(options[active]);
              return;
            }
            setOpen(false);
            onSubmit?.();
            return;
          }
          if (!open || options.length === 0) return;
          if (e.key === "ArrowDown") {
            setActive((i) => Math.min(options.length - 1, i + 1));
            setMoved(true);
            e.preventDefault();
          } else if (e.key === "ArrowUp") {
            setActive((i) => Math.max(0, i - 1));
            setMoved(true);
            e.preventDefault();
          } else if (e.key === "Tab") {
            // Tab is the completing key, and it always completes.
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
