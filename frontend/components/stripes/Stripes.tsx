"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import Stripe, { type StripeDrop, type StripeMarks } from "@/components/stripes/Stripe";
import { tr } from "@/lib/i18n";
import { accountName } from "@/lib/format";
import { isHot, useLimits, worst } from "@/lib/useLimits";
import { COUNTED, EDGES, dropIndex, viewDef, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";

/* The three stripes around the dock: left, right and the bottom one under all
 * of it.
 *
 * They replace a wide column of words that stood beside the work: the views,
 * a command, and every session, all in one list. The sessions
 * are in the session switch at the top now, the documents in the MENU and the
 * switches, and what is left are the tools — one icon each, on the edge his
 * layout puts it on. The stripes are plain controls outside the dock, so they
 * never move and never change thickness whatever the dock does inside.
 *
 * An icon is carried to another stripe, or to another place on its own, by
 * the pointer: pressed, and moved further than a quarter of a line. A copy of
 * it follows the pointer, the stripe it would land on is marked and a gap
 * opens there, and letting go puts it there. Letting go anywhere else, the
 * pointer being taken away or Escape put everything back as it was; a press
 * that did not move is a click. The drag is the window's own, not the
 * browser's and not the dock's, so dragging a tab in main is not touched by
 * it and no document can be dropped on a stripe.
 */

type Carry = { id: ToolId; x: number; y: number; drop: StripeDrop } | null;

const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
const tokenPx = (name: string, fallback: string) => {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  return parseFloat(declared) * rootPx();
};

/* Where an icon let go at (x, y) lands: the stripe under the pointer, or else
   the one whose outer edge of the dock is within two stripes' thickness of it,
   and the place among that stripe's other icons the pointer is at. */
function dropAt(x: number, y: number, carried: ToolId): StripeDrop {
  let stripe = document
    .elementsFromPoint(x, y)
    .map((el) => el.closest<HTMLElement>(".stripe[data-edge]"))
    .find((el): el is HTMLElement => el !== null) ?? null;
  if (!stripe) {
    const shell = document.querySelector(".dockShell")?.getBoundingClientRect();
    const reach = 2 * tokenPx("--stripe-w", "2.5rem");
    if (shell && x >= shell.left && x <= shell.right && y >= shell.top && y <= shell.bottom) {
      const near = (
        [
          ["left", x - shell.left],
          ["right", shell.right - x],
          ["bottom", shell.bottom - y],
        ] as [Edge, number][]
      )
        .filter(([, d]) => d <= reach)
        .sort((a, b) => a[1] - b[1])[0];
      if (near) stripe = document.querySelector<HTMLElement>(`.stripe[data-edge="${near[0]}"]`);
    }
  }
  const edge = stripe?.dataset.edge;
  if (!stripe || (edge !== "left" && edge !== "right" && edge !== "bottom")) return null;
  const across = edge === "bottom";
  const centres = [...stripe.querySelectorAll<HTMLElement>(".stripeIcon[data-tool]")]
    .filter((el) => el.dataset.tool !== carried)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return across ? r.left + r.width / 2 : r.top + r.height / 2;
    });
  return { edge, index: dropIndex(centres, across ? x : y) };
}

export default function Stripes({
  layout,
  shown,
  counts,
  flash,
  onToggle,
  onReveal,
  onHide,
  onMove,
  onResetTools,
}: {
  layout: ToolLayout;
  shown: Record<Edge, ToolId | null>;
  // What the tools in COUNTED count; the others carry no number.
  counts: Partial<Record<ToolId, number>>;
  // The edge that was asked to show and has nothing on it, for a moment.
  flash: Edge | null;
  onToggle: (id: ToolId) => void;
  onReveal: (id: ToolId) => void;
  onHide: (edge: Edge) => void;
  onMove: (id: ToolId, to: Edge, index: number) => void;
  onResetTools: () => void;
}) {
  /* Which accounts are close to the end of a window, so the usage says so
     before somebody starts a long run on one of them. Nothing is marked before
     the first answer: quiet because it has not asked looks exactly like quiet
     because it found nothing. */
  const { report, at } = useLimits();
  const nearlyOut = (report?.accounts ?? []).filter((a) => isHot(a, at));
  const usageHot = nearlyOut.length
    ? tr("tool.usageHot", "{names} nearly out: {pct}% of one window used", {
        names: nearlyOut.map((a) => accountName(a)).join(", "),
        pct: Math.max(...nearlyOut.map((a) => worst(a)?.percent ?? 0)),
      })
    : "";
  /* A count is a small mark at the icon's corner, never over the icon, and only
     on the tools that count something to act on (COUNTED): two glyphs at most
     in any skin's type, nine and below as they are and more as "9+". "117" in
     the corner covered most of the archive's mark. The whole number is in the
     tooltip. */
  const count = (n: number) => (n <= 0 ? "" : n <= 9 ? String(n) : "9+");
  const whole = (n: number) => (n > 9 ? String(n) : "");
  const badge: StripeMarks["badge"] = { usage: usageHot ? tr("tool.nearlyOut", "!") : "" };
  const wholeCount: Record<string, string> = {};
  for (const id of COUNTED) {
    const n = counts[id] ?? 0;
    badge[id] = count(n);
    wholeCount[id] = whole(n);
  }
  const marks: StripeMarks = { badge, count: wholeCount, hot: { usage: usageHot } };

  const [carry, setCarry] = useState<Carry>(null);
  // The click a drag ends with is not a click.
  const swallow = useRef(false);
  // Takes the listeners of a carry that is still going away, whatever ends it.
  const stop = useRef<(() => void) | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  useEffect(() => () => stop.current?.(), []);

  const press = useCallback((id: ToolId, _edge: Edge, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    stop.current?.();
    swallow.current = false;
    const pointer = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const threshold = tokenPx("--stripe-drag", "0.25rem");
    let carrying = false;
    let drop: StripeDrop = null;
    const body = document.body;

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      body.removeEventListener("lostpointercapture", lost);
      stop.current = null;
      if (carrying) {
        /* The click that follows a carry is not a click. When one follows at
           all, it comes in the same moment as the release — a release off the
           icon brings none, and a flag left waiting for it swallowed the next
           real click on an icon. So the flag goes right after the release:
           this one when the carry ends with it, the next one when Escape or a
           lost pointer ended it with the button still down. */
        swallow.current = true;
        const clear = () => window.setTimeout(() => (swallow.current = false), 0);
        if (commit) clear();
        else window.addEventListener("pointerup", clear, { capture: true, once: true });
        delete body.dataset.draggingTool;
        try {
          if (body.hasPointerCapture(pointer)) body.releasePointerCapture(pointer);
        } catch {
          /* the pointer is already gone */
        }
        if (commit && drop) moveRef.current(id, drop.edge, drop.index);
      }
      setCarry(null);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      if (!carrying) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= threshold) return;
        carrying = true;
        try {
          body.setPointerCapture(pointer);
        } catch {
          /* a pointer that is not down any more is not carried */
        }
        body.dataset.draggingTool = "yes";
      }
      drop = dropAt(ev.clientX, ev.clientY, id);
      setCarry({ id, x: ev.clientX, y: ev.clientY, drop });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(true);
    };
    const cancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointer) finish(false);
    };
    const lost = (ev: PointerEvent) => {
      if (carrying && ev.pointerId === pointer) finish(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !carrying) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    body.addEventListener("lostpointercapture", lost);
    stop.current = () => finish(false);
  }, []);

  const toggle = useCallback(
    (id: ToolId) => {
      if (swallow.current) {
        swallow.current = false;
        return;
      }
      onToggle(id);
    },
    [onToggle],
  );

  // The copy that follows the pointer, centred on it.
  const half = carry ? tokenPx("--stripe-icon-box", "2rem") / 2 : 0;
  return (
    <>
      {EDGES.map((edge) => (
        <Stripe
          key={edge}
          edge={edge}
          layout={layout}
          shown={shown[edge]}
          flash={flash === edge}
          marks={marks}
          carried={carry?.id ?? null}
          drop={carry?.drop ?? null}
          onPress={press}
          onToggle={toggle}
          onReveal={onReveal}
          onHide={onHide}
          onMove={onMove}
          onResetTools={onResetTools}
        />
      ))}
      {carry
        ? createPortal(
            <div className="stripeGhost" aria-hidden="true" style={{ transform: `translate(${Math.round(carry.x - half)}px, ${Math.round(carry.y - half)}px)` }}>
              <Icon name={viewDef(carry.id).icon} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
