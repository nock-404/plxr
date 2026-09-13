"use client";

/* What a click, a chord or a button does to a tool window.
 *
 * Four ways to reach a tool, and they mean four different things. A click on
 * its mark toggles it: the window comes up, and the same click puts it away.
 * Asking for it from somewhere else — the limits on the status row, a
 * session's CHANGES, the archive offered when a session is gone — only ever
 * brings it up, because nobody asking to see the usage means "and hide it if
 * it is already there". A chord works the way JetBrains' do: the first press
 * shows the tool and puts the keyboard in it, a press while it is showing but
 * the keyboard is elsewhere puts the keyboard back in it, and a press from
 * inside it puts it away. An edge chord shows or hides a whole edge with
 * whichever tool was in front there last.
 *
 * All of it goes through ToolHost; nothing here knows what an edge group is.
 */
import type { Edge, ToolId, ToolLayout } from "@/lib/tools";
import { focusTool, focusedTool, type ToolHost } from "./toolHost";

export type ToolOps = {
  toggleTool: (id: ToolId) => void;
  revealTool: (id: ToolId) => void;
  chordTool: (id: ToolId) => void;
  toggleEdge: (edge: Edge) => void;
  // True when the keyboard was in a tool window and that window is hidden now.
  hideFocusedTool: () => boolean;
};

export function toolOps(host: () => ToolHost | null, layout: () => ToolLayout, flash: (edge: Edge) => void): ToolOps {
  return {
    toggleTool(id) {
      const h = host();
      const edge = h?.edgeOf(id);
      if (!h || !edge) return;
      if (h.shown(edge) === id) h.hide(edge);
      else h.show(id);
    },
    revealTool(id) {
      host()?.show(id);
    },
    chordTool(id) {
      const h = host();
      const edge = h?.edgeOf(id);
      if (!h || !edge) return;
      if (h.shown(edge) !== id) h.show(id);
      else if (focusedTool() !== id) focusTool(id);
      else h.hide(edge);
    },
    toggleEdge(edge) {
      const h = host();
      if (!h) return;
      if (h.shown(edge)) {
        h.hide(edge);
        return;
      }
      const id = h.active(edge) ?? layout().order[edge][0];
      // An edge with no tool on it has nothing to show; it says so instead.
      if (!id) flash(edge);
      else h.show(id);
    },
    hideFocusedTool() {
      const h = host();
      const id = focusedTool();
      const edge = id ? h?.edgeOf(id) : null;
      if (!h || !edge) return false;
      h.hide(edge);
      return true;
    },
  };
}
