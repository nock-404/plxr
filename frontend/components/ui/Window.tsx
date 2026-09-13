"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { remToPx, rootToken } from "@/lib/units";

/* A floating window inside the window.
 *
 * Not a dialog: a dialog stops everything under it, and what this holds —
 * the settings — is looked at while the window underneath is being changed.
 * Not a dock panel either: dockview's floating groups are glass and sit in
 * the dock's own stacking, and the settings must be readable over a terminal
 * whatever the solidity slider says. So it hangs on <body> like the menu and
 * the palette, on the opaque --surface, and it can be dragged by its title
 * bar and resized by its corner.
 *
 * It opens where the docked settings panel used to sit — snapped to the right
 * edge, as tall as the work area — so somebody who knew the old place finds
 * the new one there. Where it is then put is remembered for this window's
 * life, so closing and reopening it does not snap it back.
 *
 * A window that is read rather than worked in — the keyboard list — opens
 * fitted instead: centred, as big as what it holds and never bigger than the
 * screen less a margin, the body scrolling what does not fit. The stylesheet
 * does that sizing, so a skin with a wider typeface or a longer language gets
 * a window to match. It takes numbers of its own only once it is dragged or
 * resized, and forgets them when it closes: it opens fitted to whatever it
 * holds the next time.
 */
type Geometry = { x: number; y: number; w: number; h: number };

const remembered = new Map<string, Geometry>();

// Where a window first opens: the right edge, below the header, the width
// the settings column had, as tall as the work area.
function firstPlace(width?: number): Geometry {
  const gap = remToPx(0.5);
  const body = typeof document === "undefined" ? null : document.querySelector(".body");
  const top = body ? Math.max(0, Math.round(body.getBoundingClientRect().top)) : Math.round(remToPx(5.5));
  const w = Math.round(width ?? remToPx(rootToken("--settings-w") || "26rem"));
  const h = Math.max(remToPx(12), window.innerHeight - top - gap);
  return {
    x: Math.max(gap, window.innerWidth - w - gap),
    y: top,
    w: Math.min(w, Math.max(remToPx(18), window.innerWidth - gap * 2)),
    h: Math.round(h),
  };
}

// Keep the whole window inside the viewport. Only the title bar used to be
// kept reachable, so a window could be dragged until most of it hung below
// the bottom edge, where nothing in it could be read or reached.
function clamp(g: Geometry): Geometry {
  const minW = remToPx(18);
  const minH = remToPx(12);
  const w = Math.max(minW, Math.min(g.w, window.innerWidth));
  const h = Math.max(minH, Math.min(g.h, window.innerHeight));
  const x = Math.max(0, Math.min(g.x, window.innerWidth - w));
  const y = Math.max(0, Math.min(g.y, window.innerHeight - h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export default function Window({
  id,
  heading,
  onClose,
  children,
  width,
  fit = false,
}: {
  /* Names the window, so its place is remembered across open and close. */
  id: string;
  /* What the title bar says. Not "title": that word on an element is the
     system's own tooltip, and this window has none of those. */
  heading: string;
  onClose: () => void;
  children: ReactNode;
  /* A first width in px, computed by the caller; without one the settings
     column's width is used. */
  width?: number;
  /* Centred and sized by what it holds, up to the screen less a margin. */
  fit?: boolean;
}) {
  // null while a fitted window is still placed and sized by the stylesheet.
  const [geo, setGeo] = useState<Geometry | null>(() => (fit ? null : (remembered.get(id) ?? clamp(firstPlace(width)))));
  const box = useRef<HTMLElement | null>(null);
  const drag = useRef<{ kind: "move" | "size"; px: number; py: number; from: Geometry } | null>(null);

  useEffect(() => {
    if (geo && !fit) remembered.set(id, geo);
  }, [id, geo, fit]);

  // A window that is made smaller must not leave this one stranded outside.
  useEffect(() => {
    const fitIn = () => setGeo((g) => (g ? clamp(g) : g));
    window.addEventListener("resize", fitIn);
    return () => window.removeEventListener("resize", fitIn);
  }, []);

  const start = useCallback(
    (kind: "move" | "size") => (e: ReactPointerEvent<HTMLElement>) => {
      // The close button lives in the title bar; a press on it is not a drag.
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.button !== 0) return;
      // A fitted window has no numbers yet: it starts from where the
      // stylesheet put it, rounded up so no line of it wraps on the way.
      const r = box.current?.getBoundingClientRect();
      const from = geo ?? (r ? { x: r.left, y: r.top, w: Math.ceil(r.width), h: Math.ceil(r.height) } : null);
      if (!from) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser does not hold — the moves still arrive while it stays over the bar */
      }
      drag.current = { kind, px: e.clientX, py: e.clientY, from };
      if (!geo) setGeo(clamp(from));
    },
    [geo],
  );

  const move = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.kind === "move") setGeo(clamp({ ...d.from, x: d.from.x + dx, y: d.from.y + dy }));
    // A corner pulled past the screen's edge stops there, rather than pushing
    // the window off the other side.
    else setGeo(clamp({ ...d.from, w: Math.min(d.from.w + dx, window.innerWidth - d.from.x), h: Math.min(d.from.h + dy, window.innerHeight - d.from.y) }));
  }, []);

  const end = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <section
      ref={box}
      className="window"
      role="dialog"
      aria-label={heading}
      data-window={id}
      data-fit={geo ? "no" : "yes"}
      style={geo ? { left: `${geo.x}px`, top: `${geo.y}px`, width: `${geo.w}px`, height: `${geo.h}px` } : undefined}
    >
      <header
        className="windowHead"
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <b className="windowTitle">{heading}</b>
        <span className="spacer" />
        <Button bare className="windowClose" aria-label={tr("common.close", "Close")} onClick={onClose}>
          ✕
        </Button>
      </header>
      <div className="windowBody">{children}</div>
      <div
        className="windowGrip"
        role="presentation"
        onPointerDown={start("size")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </section>,
    document.body,
  );
}
