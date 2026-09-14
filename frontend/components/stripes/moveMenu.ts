import type { MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { EDGES, edgeOf, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";

/* Where a tool can be put, as rows of a menu — the same rows under a tool
 * window's ⋮ and under an icon's right button, so the two cannot say it
 * differently. The edge it stands on is ticked; a row for another edge puts it
 * at the end of that edge's icons, the way carrying it there and letting go
 * after the last one does. */
export function moveRows(id: ToolId, layout: ToolLayout, onMove: (id: ToolId, to: Edge, index: number) => void): MenuItem[] {
  const at = edgeOf(layout, id);
  const names: Record<Edge, string> = {
    left: tr("edge.left", "Left"),
    right: tr("edge.right", "Right"),
    bottom: tr("edge.bottom", "Bottom left"),
    bottomRight: tr("edge.bottomRight", "Bottom right"),
  };
  return [
    { header: true, label: tr("tool.moveTo", "Move to") },
    ...EDGES.map(
      (edge): MenuItem => ({
        label: names[edge],
        checked: edge === at,
        do: `move-${edge}`,
        onClick: () => {
          if (edge !== at) onMove(id, edge, layout.order[edge].length);
        },
      }),
    ),
  ];
}

// Every tool back where it started.
export function resetRow(onReset: () => void): MenuItem {
  return { label: tr("tool.reset", "Reset tool positions"), do: "reset-tools", onClick: onReset };
}
