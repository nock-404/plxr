"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";

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
  const [shown, setShown] = useState(items.length);
  const [open, setOpen] = useState(false);

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

  // Close the menu on any click outside it.
  useEffect(() => {
    if (!open) return;
    const shut = (e: MouseEvent) => {
      if (!outer.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", shut);
    return () => window.removeEventListener("mousedown", shut);
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
          <div className="obarMoreWrap">
            <Button className="obarMore" title={moreTitle} on={open} onClick={() => setOpen((v) => !v)}>
              {moreLabel}
            </Button>
            {open ? (
              <div className="obarMenu" onClick={() => setOpen(false)}>
                {hidden.map((it) => (
                  <div className="obarMenuItem" key={it.key}>
                    {it.node}
                  </div>
                ))}
              </div>
            ) : null}
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
