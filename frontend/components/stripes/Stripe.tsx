"use client";

import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip, { type TipPlace } from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { chordOf, edgeChordOf, viewDef, type Edge, type ToolId } from "@/lib/tools";

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
 * A stripe with nothing on it is still drawn: the bottom starts empty, and it
 * is an edge a tool can be put on all the same. */

// Where a tooltip goes: beside the icon, towards the work.
const PLACE: Record<Edge, TipPlace> = { left: "right", right: "left", bottom: "above" };

export type StripeMarks = {
  // A number or a mark on the icon, empty for none.
  badge: Partial<Record<ToolId, string>>;
  // What the usage has to warn about, empty when nothing is nearly out.
  hot: Partial<Record<ToolId, string>>;
};

export default function Stripe({
  edge,
  ids,
  shown,
  flash,
  marks,
  onToggle,
  onReveal,
  onHide,
  onResetLayout,
}: {
  edge: Edge;
  // The tools on this edge, in his order.
  ids: ToolId[];
  // The tool whose window shows at this edge, or null.
  shown: ToolId | null;
  // The edge was asked to show and has nothing to show.
  flash: boolean;
  marks: StripeMarks;
  onToggle: (id: ToolId) => void;
  onReveal: (id: ToolId) => void;
  onHide: (edge: Edge) => void;
  onResetLayout?: () => void;
}) {
  const ctx = useContextMenu();
  const names: Record<Edge, string> = {
    left: tr("stripe.left", "Tools on the left"),
    right: tr("stripe.right", "Tools on the right"),
    bottom: tr("stripe.bottom", "Tools at the bottom"),
  };

  /* Under the right button: the same show or hide the click does, said with
     the key that does it, and the way back to the arrangement he started from. */
  const menuOf = (id: ToolId): MenuItem[] => {
    const lit = shown === id;
    const edgeKey = edgeChordOf(edge);
    const toolKey = chordOf(id);
    return [
      lit
        ? { label: tr("tool.hide", "Hide"), hint: edgeKey || undefined, do: "tool-hide", onClick: () => onHide(edge) }
        : { label: tr("tile.menuOpen", "Open"), hint: toolKey || undefined, do: "tool-open", onClick: () => onReveal(id) },
      ...(onResetLayout
        ? [{ separator: true as const }, { label: tr("palette.resetLayout", "Reset the panel layout"), onClick: onResetLayout }]
        : []),
    ];
  };

  return (
    <div
      className="stripe"
      data-edge={edge}
      data-flash={flash ? "yes" : undefined}
      role="toolbar"
      aria-orientation={edge === "bottom" ? "horizontal" : "vertical"}
      aria-label={names[edge]}
    >
      {ids.map((id) => {
        const def = viewDef(id);
        const name = tr(def.key, def.fallback);
        const key = chordOf(id);
        const lit = shown === id;
        const badge = marks.badge[id] ?? "";
        const hot = marks.hot[id] ?? "";
        const tip = [key ? `${name} ${key}` : name, hot].filter(Boolean).join(" — ");
        const label = [name, badge && !hot ? badge : "", hot].filter(Boolean).join(" · ");
        return (
          <Tooltip key={id} text={tip} place={PLACE[edge]}>
            <Button
              bare
              className="stripeIcon"
              data-tool={id}
              data-lit={lit ? "yes" : "no"}
              data-nearly-out={hot ? "yes" : undefined}
              aria-pressed={lit}
              aria-label={label}
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
      })}
    </div>
  );
}
