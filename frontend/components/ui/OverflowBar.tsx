"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";

/* A row of controls that never wraps and never hides anything.
 *
 * The session bar had a fixed set of buttons and a title, in a strip whose
 * width somebody else decides — and once the window manager lands, decides
 * again at every drag. Left to flex-wrap it broke onto four lines even with
 * room to spare, because the spacer took the first line for itself. So this
 * measures what actually fits and moves the rest under a single "⋯": the row
 * stays one line at any width, and everything is still one click away.
 *
 * left grows and shrinks (its text ellipsises); the items keep their size and
 * spill into the menu from the end, the way a real toolbar does.
 *
 * The "⋯" menu is rendered through a portal to <body>, not inline in the bar.
 * Inline, it was a descendant of the session panel and sat UNDER the terminal's
 * own compositing layer (xterm's WebGL canvas), so the terminal painted straight
 * over it — the menu was opaque, it was simply behind the terminal. Portalled to
 * the top of the document with position:fixed it clears the terminal, the same
 * way the context menu does.
 */
export default function OverflowBar({
  className = "",
  left,
  items,
  moreLabel = "⋯",
  moreTitle,
}: {
  className?: string;
  left?: ReactNode;
  items: { key: string; node: ReactNode }[];
  moreLabel?: string;
  moreTitle?: string;
}) {
  const outer = useRef<HTMLDivElement | null>(null);
  const measure = useRef<HTMLDivElement | null>(null);
  const moreWrap = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(items.length);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  const recompute = useCallback(() => {
    const o = outer.current;
    const m = measure.current;
    if (!o || !m) return;
    const cs = getComputedStyle(o);
    // clientWidth includes the bar's own padding; the flex content is laid out
    // inside it, so the padding has to come off — without it the row was judged
    // to fit and then spilled past its edge by exactly that padding.
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const total = o.clientWidth - pad - 1; // and a pixel of slack for rounding
    if (total <= 0) return;

    // The natural width of every item, read from a copy that is laid out but
    // not shown — the real row's widths change as things move to the menu, so
    // they cannot be measured there.
    const cells = Array.from(m.querySelectorAll<HTMLElement>("[data-obar-cell]"));
    const moreEl = m.querySelector<HTMLElement>("[data-obar-more]");
    const gap = parseFloat(cs.columnGap || cs.gap || "0") || 0;
    // The left slot's own resolved min-width, in px — reading the custom
    // property gives "3rem", and parseFloat of that is 3, not 48, which let one
    // item too many through and pushed the row past its edge.
    const leftEl = o.querySelector<HTMLElement>(".obarLeft");
    const leftMin = leftEl ? parseFloat(getComputedStyle(leftEl).minWidth) || 0 : 0;
    const moreW = moreEl ? moreEl.getBoundingClientRect().width : 0;

    const widths = cells.map((c) => c.getBoundingClientRect().width);
    const all = widths.reduce((s, w) => s + w, 0) + gap * widths.length;
    if (all <= total - leftMin) {
      setShown(items.length);
      return;
    }
    // Not everything fits: keep room for the "⋯" as well.
    const budget = total - leftMin - moreW - gap;
    let used = 0;
    let fit = 0;
    for (const w of widths) {
      used += w + gap;
      if (used > budget) break;
      fit++;
    }
    setShown(Math.max(0, Math.min(items.length, fit)));
  }, [items.length]);

  useLayoutEffect(recompute, [recompute, items]);

  useEffect(() => {
    const o = outer.current;
    if (!o || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(recompute);
    ro.observe(o);
    return () => ro.disconnect();
  }, [recompute]);

  // Place the menu under the "⋯", right-aligned to it, in viewport coordinates
  // (position:fixed): the menu lives on <body>, so it is positioned against the
  // viewport, not the bar.
  const place = useCallback(() => {
    const b = moreWrap.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setPos({ top: Math.round(r.bottom + 4), right: Math.round(window.innerWidth - r.right) });
  }, []);

  // Close the menu on a click outside it OR the button, on Escape, and when the
  // window is resized/scrolled (its anchor has moved). The menu is portalled, so
  // "outside" must also spare the menu itself, or the mousedown that lands on a
  // menu item would close it before the click fires.
  useEffect(() => {
    if (!open) return;
    const shut = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || moreWrap.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const move = () => setOpen(false);
    window.addEventListener("mousedown", shut, true);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", move);
    window.addEventListener("blur", move);
    return () => {
      window.removeEventListener("mousedown", shut, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", move);
      window.removeEventListener("blur", move);
    };
  }, [open]);

  const overflowing = shown < items.length;
  const visible = items.slice(0, shown);
  const hidden = items.slice(shown);

  return (
    <div className={`obar ${className}`.trim()} ref={outer}>
      {left != null ? <div className="obarLeft">{left}</div> : null}
      <div className="obarItems">
        {visible.map((it) => (
          <span key={it.key}>{it.node}</span>
        ))}
        {overflowing ? (
          <div className="obarMoreWrap" ref={moreWrap}>
            <Tooltip text={moreTitle}>
              <Button
                className="obarMore"
                on={open}
                onClick={() => {
                  if (!open) place();
                  setOpen((v) => !v);
                }}
              >
                {moreLabel}
              </Button>
            </Tooltip>
            {open
              ? createPortal(
                  <div
                    className="obarMenu"
                    ref={menuRef}
                    style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
                    onClick={() => setOpen(false)}
                  >
                    {hidden.map((it) => (
                      <div className="obarMenuItem" key={it.key}>
                        {it.node}
                      </div>
                    ))}
                  </div>,
                  document.body,
                )
              : null}
          </div>
        ) : null}
      </div>

      {/* The measuring copy: laid out so widths are real, but inside a box that
          is zero-sized and clips its overflow, so it never adds to the bar's
          own scroll width — an absolutely placed max-content row otherwise
          reads as the whole bar overflowing even when the visible row fits. */}
      <div className="obarMeasureBox" aria-hidden="true">
        <div className="obarMeasure" ref={measure}>
          {items.map((it) => (
            <span data-obar-cell key={it.key}>
              {it.node}
            </span>
          ))}
          <span data-obar-more>
            <Button className="obarMore">{moreLabel}</Button>
          </span>
        </div>
      </div>
    </div>
  );
}
