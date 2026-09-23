"use client";

import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import { tr } from "@/lib/i18n";
import { edgeChordOf, type Edge, type ToolId } from "@/lib/tools";

/* The three edges of the dock, each a button in the top bar.
 *
 * ⌘B ⌥⌘B ⌘J show and hide a whole edge, and a key nobody can see is a key
 * nobody finds: every action has a control on screen. A button is pressed
 * while its edge shows a tool; on an edge with nothing on it the press says so
 * on that edge's stripe instead of doing nothing without a word. In the order
 * the edges lie on screen: left, bottom, right. */
const ORDER: Edge[] = ["left", "bottom", "right"];

export default function EdgeToggles({ shown, onToggle, keep }: { shown: Record<Edge, ToolId | null>; onToggle: (edge: Edge) => void; keep?: string }) {
  /* Three buttons for three edges: the bottom one is the whole section, both
     halves of it, so it needs no fourth. The maps hold every edge all the same,
     because ORDER is what decides what is drawn. */
  const texts: Record<Edge, string> = {
    left: tr("keys.toggleLeft", "Show or hide the left tool window"),
    right: tr("keys.toggleRight", "Show or hide the right tool window"),
    bottom: tr("keys.toggleBottom", "Show or hide the bottom tool window"),
    bottomRight: tr("keys.toggleBottom", "Show or hide the bottom tool window"),
  };
  const icons: Record<Edge, "panel-left" | "panel-right" | "panel-bottom"> = {
    left: "panel-left",
    right: "panel-right",
    bottom: "panel-bottom",
    bottomRight: "panel-bottom",
  };
  return (
    <span className="edgeToggles" data-keep={keep}>
      {ORDER.map((edge) => {
        const on = shown[edge] !== null;
        const key = edgeChordOf(edge);
        return (
          <Tooltip key={edge} text={key ? `${texts[edge]} ${key}` : texts[edge]}>
            <Button icon on={on} data-do={`toggle-${edge}`} aria-pressed={on} aria-label={texts[edge]} onClick={() => onToggle(edge)}>
              <Icon name={icons[edge]} />
            </Button>
          </Tooltip>
        );
      })}
    </span>
  );
}
