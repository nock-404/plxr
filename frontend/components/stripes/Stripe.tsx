"use client";

import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip, { type TipPlace } from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { moveRows, resetRow } from "@/components/stripes/moveMenu";
import { tr } from "@/lib/i18n";
import { chordOf, edgeChordOf, viewDef, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";

/* One stripe: the icons of the tools that stand on one edge of the dock.
 *
 * An icon is the tool's mark and nothing else — no word beside it, so the
 * stripe stays as narrow as a mark and the work keeps the width. Its name and
 * the key that reaches it are in its tooltip, said beside the icon rather than
 * over the next one. The icon is lit while its tool's window shows; a click
 * shows the window, the same click hides it. A number on it counts what waits
 * there — the inbox, the ports, the archive — and the usage says so when an
 * account is nearly out.
 *
 * An icon is carried to another place by pressing it and moving: while it is
 * carried it is gone from its stripe, and a gap opens where it would land.
 *
 * A stripe with nothing on it is still there: the bottom starts empty, and it
 * is an edge a tool can be put on all the same. At rest it is only its line,
 * so it is no dead bar across the window; while an icon is carried it stands
 * up as a whole stripe to be dropped on (layout.css). */

// Where a tooltip goes: beside the icon, towards the work.
const PLACE: Record<Edge, TipPlace> = { left: "right", right: "left", bottom: "above" };

export type StripeMarks = {
  // A number or a mark on the icon, empty for none: two glyphs at most.
  badge: Partial<Record<ToolId, string>>;
  // The whole number where the badge had to shorten it, empty otherwise.
  count: Partial<Record<ToolId, string>>;
  // What the usage has to warn about, empty when nothing is nearly out.
  hot: Partial<Record<ToolId, string>>;
};

// Where a carried icon would land: an edge, and a place among the icons there.
export type StripeDrop = { edge: Edge; index: number } | null;

export default function Stripe({
  edge,
  layout,
  shown,
  flash,
  marks,
  carried,
  drop,
  onPress,
  onToggle,
  onReveal,
  onHide,
  onMove,
  onResetTools,
}: {
  edge: Edge;
  // His placement: this stripe's tools are the ones on this edge, in his order.
  layout: ToolLayout;
  // The tool whose window shows at this edge, or null.
  shown: ToolId | null;
  // The edge was asked to show and has nothing to show.
  flash: boolean;
  marks: StripeMarks;
  // The tool being carried, if any.
  carried: ToolId | null;
  drop: StripeDrop;
  // A pointer went down on an icon: the start of a click, or of carrying it.
  onPress: (id: ToolId, edge: Edge, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onToggle: (id: ToolId) => void;
  onReveal: (id: ToolId) => void;
  onHide: (edge: Edge) => void;
  onMove: (id: ToolId, to: Edge, index: number) => void;
  onResetTools: () => void;
}) {
  const ctx = useContextMenu();
  const ids = layout.order[edge];
  const names: Record<Edge, string> = {
    left: tr("stripe.left", "Tools on the left"),
    right: tr("stripe.right", "Tools on the right"),
    bottom: tr("stripe.bottom", "Tools at the bottom"),
  };

  /* Under the right button: the same show or hide the click does, said with
     the key that does it, where else the tool can stand, and every tool back
     where it started. */
  const menuOf = (id: ToolId): MenuItem[] => {
    const lit = shown === id;
    const edgeKey = edgeChordOf(edge);
    const toolKey = chordOf(id);
    return [
      lit
        ? { label: tr("tool.hide", "Hide"), hint: edgeKey || undefined, do: "tool-hide", onClick: () => onHide(edge) }
        : { label: tr("tile.menuOpen", "Open"), hint: toolKey || undefined, do: "tool-open", onClick: () => onReveal(id) },
      { separator: true },
      ...moveRows(id, layout, onMove),
      { separator: true },
      resetRow(onResetTools),
    ];
  };

  const icon = (id: ToolId) => {
    const def = viewDef(id);
    const name = tr(def.key, def.fallback);
    const key = chordOf(id);
    const lit = shown === id;
    const badge = marks.badge[id] ?? "";
    const whole = marks.count[id] ?? "";
    const hot = marks.hot[id] ?? "";
    // A count the badge had to shorten is said whole in the tooltip.
    const tip = [key ? `${name} ${key}` : name, whole, hot].filter(Boolean).join(" — ");
    const label = [name, badge && !hot ? whole || badge : "", hot].filter(Boolean).join(" · ");
    return (
      <Tooltip key={id} text={carried ? undefined : tip} place={PLACE[edge]}>
        <Button
          bare
          className="stripeIcon"
          data-tool={id}
          data-lit={lit ? "yes" : "no"}
          data-nearly-out={hot ? "yes" : undefined}
          data-dragging={carried === id ? "yes" : undefined}
          aria-pressed={lit}
          aria-label={label}
          onPointerDown={(e) => onPress(id, edge, e)}
          onClick={() => onToggle(id)}
          onContextMenu={ctx(menuOf(id))}
        >
          <Icon name={def.icon} />
          {badge ? (
            <span className="stripeBadge" aria-hidden="true">
              {badge}
            </span>
          ) : null}
        </Button>
      </Tooltip>
    );
  };

  /* The gap stands where the carried icon would land, counted among the icons
     that stay: the carried one is still in the page, out of sight, so the
     pointer it is carried with is not lost with it. */
  const landing = drop && drop.edge === edge ? drop.index : -1;
  const staying = ids.filter((id) => id !== carried);
  const gap = <span key="gap" className="stripeGap" aria-hidden="true" />;
  const items: ReactNode[] = [];
  for (const id of ids) {
    if (landing >= 0 && staying[landing] === id) items.push(gap);
    items.push(icon(id));
  }
  if (landing >= 0 && landing >= staying.length) items.push(gap);

  return (
    <div
      className="stripe"
      data-edge={edge}
      data-flash={flash ? "yes" : undefined}
      data-drop={landing >= 0 ? "yes" : undefined}
      data-empty={ids.length === 0 ? "yes" : undefined}
      role="toolbar"
      aria-orientation={edge === "bottom" ? "horizontal" : "vertical"}
      aria-label={names[edge]}
    >
      {items}
    </div>
  );
}
