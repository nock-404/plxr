"use client";

/* What a click, a chord, a button or a carried icon does to a tool window.
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
 * Where a tool stands is his: an icon carried to another stripe, or moved from
 * a menu, changes his placement first, and the windows follow it.
 *
 * All of it goes through ToolHost; nothing here knows what an edge group is.
 */
import { EDGES, defaultToolLayout, edgeOf as edgeIn, moveInLayout, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";
import { focusTool, focusedTool, type ToolHost } from "./toolHost";

export type ToolOps = {
  toggleTool: (id: ToolId) => void;
  revealTool: (id: ToolId) => void;
  chordTool: (id: ToolId) => void;
  toggleEdge: (edge: Edge) => void;
  // True when the keyboard was in a tool window and that window is hidden now.
  hideFocusedTool: () => boolean;
  // A tool put on an edge, at a place among the icons already there.
  moveTool: (id: ToolId, to: Edge, index: number) => void;
  // Every tool back on the edge it started on, in the order it started in.
  resetTools: () => void;
};

/* followLayout puts every tool where a placement says, and keeps what was
   showing showing: a tool whose window showed shows on its new edge, an edge
   whose tool went elsewhere is hidden, and a tool that was hidden stays
   hidden. Where two tools that showed end up on one edge, the one asked for
   wins — the tool that was carried there — and otherwise the later edge's. */
export function followLayout(host: ToolHost, next: ToolLayout, prefer?: ToolId): void {
  const before = EDGES.map((edge) => host.shown(edge)).filter((id): id is ToolId => id !== null);
  host.reconcile(next);
  const want = new Map<Edge, ToolId>();
  for (const id of before) want.set(edgeIn(next, id), id);
  if (prefer && before.includes(prefer)) want.set(edgeIn(next, prefer), prefer);
  for (const edge of EDGES) {
    const id = want.get(edge);
    if (id) {
      if (host.shown(edge) !== id) host.show(id, false);
    } else if (host.shown(edge)) {
      host.hide(edge);
    }
  }
}

export function toolOps(
  host: () => ToolHost | null,
  layout: () => ToolLayout,
  flash: (edge: Edge) => void,
  // His new placement, to keep and write down; null is the one he started with.
  keep: (next: ToolLayout | null) => void = () => undefined,
): ToolOps {
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
    /* Moving within one stripe is the same move: only the order changes, and
       no window does. A tool that was showing shows on its new edge in place
       of what showed there; one that was hidden stays hidden. */
    moveTool(id, to, index) {
      const was = layout();
      const next = moveInLayout(was, id, to, index);
      if (JSON.stringify(next.order) === JSON.stringify(was.order)) return;
      keep(next);
      const h = host();
      if (!h) return;
      const from = h.edgeOf(id);
      followLayout(h, next, from && h.shown(from) === id ? id : undefined);
    },
    resetTools() {
      keep(null);
      const h = host();
      if (h) followLayout(h, defaultToolLayout());
    },
  };
}
