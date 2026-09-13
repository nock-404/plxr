"use client";

/* Where the tool windows live — and the only code that knows it.
 *
 * A tool is a window at an edge of the dock: the file tree, what has changed,
 * the inbox. It is shown and hidden, never closed, and it comes back at the
 * width it had. Everything else in the window asks for that through this
 * interface and never touches the dock's edges itself, so the place the
 * windows are kept can change without the stripes, the keys, the header or
 * the gates noticing.
 *
 * The windows are dockview's own edge groups, one per edge, measured before
 * anything was built on them (step 0 of the tool-stripes spec, §12.1): a
 * hidden edge takes no room, a shown one comes back at its size, the size and
 * the visibility travel in the saved layout, and splitting, floating or
 * maximising in main cannot change their shape. What the measuring found that
 * the library does not do by itself is done here:
 *
 *   - a loaded layout brings the edges back with their tab strip showing and
 *     drops allowed, so both are put right after every load (ensure);
 *   - an edge emptied by a move collapses to a blank strip and ignores its
 *     size until it is expanded, so an empty edge is hidden and a collapsed one
 *     expanded before it is shown;
 *   - a size set while hidden is kept and applied when the edge is shown.
 *
 * The bottom window runs under all of it — under the left window, main and the
 * right window — the way he described the frame (translated): "left - main -
 * right. under everything, the bottom". dockview keeps its bottom edge inside the column
 * between the two side edges, so the shell is rebuilt once, before any edge is
 * made (shellNesting.ts), and nothing below this line knows the difference.
 */
import type { DockviewApi, DockviewGroupPanel, IDockviewPanel } from "dockview-react";
import { spanBottom } from "@/components/dock/shellNesting";
import { tr } from "@/lib/i18n";
import { EDGES, isTool, viewDef, type Edge, type ToolId, type ToolLayout } from "@/lib/tools";

export interface ToolHost {
  // Every edge exists, with its tab strip hidden and drops refused.
  ensure(): void;
  // Every tool exactly once, on its edge, in order; an edge left empty is hidden.
  reconcile(layout: ToolLayout): void;
  // The tool showing at an edge — null when the edge is hidden or empty.
  shown(edge: Edge): ToolId | null;
  // The tool in front at an edge whether the edge is showing or not.
  active(edge: Edge): ToolId | null;
  // The edge a tool stands on now, null when it is at none.
  edgeOf(id: ToolId): Edge | null;
  // Brings the tool to the front of its edge and shows the edge.
  show(id: ToolId, focus?: boolean): void;
  // Hides the edge; nothing in it is closed.
  hide(edge: Edge): void;
  move(id: ToolId, to: Edge, index: number): void;
  // Pixels of the window along the axis it is sized in, the stripe not counted.
  size(edge: Edge): number;
  setSize(edge: Edge, px: number): void;
  // Shown or hidden, the tool in front, a size: whatever a stripe or a saved
  // layout has to hear about.
  onChange(fn: () => void): () => void;
  toState(): unknown;
  fromState(state: unknown): void;
}

export type HostOptions = {
  // The remembered size of an edge, in pixels, if there is one.
  size: (edge: Edge) => number | undefined;
  // A length the frame declares, in the pixels dockview counts in.
  px: (token: string, fallback: string) => number;
  // A panel that is not a tool found at an edge, handed back to main.
  stray: (panel: IDockviewPanel) => void;
  // The group of main the keyboard goes back to when a tool is put away.
  main: () => DockviewGroupPanel | undefined;
};

const edgeOfLocation = (g: DockviewGroupPanel): Edge | null => {
  const at = g.api.location;
  return at.type === "edge" && at.position !== "top" ? at.position : null;
};

/* focusTool puts the keyboard in a tool window: on the first thing in its body
   that takes it, or on the window itself when its body has nothing to type
   into or click. The body of a hidden tool is not rendered, so after a show it
   is waited for — a frame at a time, never longer than half a second. */
export function focusTool(id: ToolId): void {
  let frames = 0;
  const step = () => {
    const win = document.querySelector<HTMLElement>(`.toolWindow[data-tool="${id}"]`);
    const body = win?.querySelector<HTMLElement>(".toolBody");
    if (win && body && body.childElementCount > 0 && win.offsetParent !== null) {
      const first = [...body.querySelectorAll<HTMLElement>('input, textarea, select, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')].find(
        (el) => el.offsetParent !== null,
      );
      (first ?? win).focus({ preventScroll: true });
      return;
    }
    if (++frames < 30) window.requestAnimationFrame(step);
    else win?.focus({ preventScroll: true });
  };
  window.requestAnimationFrame(step);
}

// The tool whose window holds the keyboard, if any.
export function focusedTool(): ToolId | null {
  const el = document.activeElement as HTMLElement | null;
  const id = el?.closest?.(".toolWindow[data-tool]")?.getAttribute("data-tool") ?? "";
  return isTool(id) ? id : null;
}

export function edgeHost(dv: DockviewApi, options: HostOptions): ToolHost {
  // First, before an edge exists or a layout is loaded: the bottom edge under
  // both side edges instead of between them.
  spanBottom(dv);
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const fn of [...listeners]) fn();
  };
  // Each edge group heard once: a load makes new ones, which are heard again.
  const heard = new WeakSet<object>();

  const groupOf = (edge: Edge): DockviewGroupPanel | undefined => dv.groups.find((g) => edgeOfLocation(g) === edge);

  dv.onDidActivePanelChange((e) => {
    if (e.panel && e.panel.group.api.location.type === "edge") emit();
  });

  function dress(edge: Edge): void {
    const group = groupOf(edge);
    if (!group) return;
    group.model.header.hidden = true;
    group.api.locked = "no-drop-target";
    if (!heard.has(group.api)) {
      heard.add(group.api);
      group.api.onDidDimensionsChange(emit);
    }
  }

  function ensure(): void {
    for (const edge of EDGES) {
      if (!dv.getEdgeGroup(edge)) {
        const side = edge !== "bottom";
        const minimumSize = options.px(side ? "--side-min" : "--bottom-min", side ? "11rem" : "5rem");
        const declared = options.px(side ? "--side-w" : "--bottom-h", side ? "20rem" : "18rem");
        const initialSize = Math.max(minimumSize, Math.round(options.size(edge) ?? declared));
        dv.addEdgeGroup(edge, { id: edge, initialSize, minimumSize });
        dv.setEdgeGroupVisible(edge, false);
      }
      dress(edge);
    }
  }

  function reconcile(layout: ToolLayout): void {
    for (const edge of EDGES) {
      const group = groupOf(edge);
      if (!group) continue;
      layout.order[edge].forEach((id, index) => {
        const panel = dv.getPanel(id);
        if (panel && panel.group === group) return;
        if (panel && panel.group.api.location.type === "edge") {
          panel.api.moveTo({ group, position: "center", index });
          return;
        }
        // A copy in main, a floating group or a popout goes; the tool is made
        // again where it belongs.
        if (panel) panel.api.close();
        const def = viewDef(id);
        dv.addPanel({ id, component: id, title: tr(def.key, def.fallback), position: { referenceGroup: group, index }, inactive: true });
      });
      for (const p of [...group.panels]) if (!isTool(p.id)) options.stray(p);
    }
    for (const edge of EDGES) {
      const group = groupOf(edge);
      if (!group || !dv.isEdgeGroupVisible(edge)) continue;
      // An edge with nothing in it shows a blank strip; one collapsed while it
      // was emptied ignores its size until it is opened out again.
      if (group.panels.length === 0) dv.setEdgeGroupVisible(edge, false);
      else if (group.api.isCollapsed()) group.api.expand();
    }
    emit();
  }

  function shown(edge: Edge): ToolId | null {
    const group = groupOf(edge);
    if (!group || !dv.isEdgeGroupVisible(edge) || group.api.isCollapsed()) return null;
    return active(edge);
  }

  function active(edge: Edge): ToolId | null {
    const id = groupOf(edge)?.activePanel?.id ?? "";
    return isTool(id) ? id : null;
  }

  function edgeOf(id: ToolId): Edge | null {
    const panel = dv.getPanel(id);
    return panel ? edgeOfLocation(panel.group) : null;
  }

  function show(id: ToolId, focus = true): void {
    const panel = dv.getPanel(id);
    const edge = panel ? edgeOfLocation(panel.group) : null;
    if (!panel || !edge) return;
    if (dv.hasMaximizedGroup()) dv.exitMaximizedGroup();
    if (panel.group.activePanel !== panel || focus) panel.api.setActive();
    if (panel.group.api.isCollapsed()) panel.group.api.expand();
    dv.setEdgeGroupVisible(edge, true);
    emit();
    if (focus) focusTool(id);
  }

  function hide(edge: Edge): void {
    if (!dv.isEdgeGroupVisible(edge)) return;
    const group = groupOf(edge);
    const had = Boolean(group && document.activeElement && group.element.contains(document.activeElement));
    if (had) (document.activeElement as HTMLElement).blur();
    dv.setEdgeGroupVisible(edge, false);
    // The keyboard was in the tool, or the tool was the group in front: either
    // way what ⌘W and the arrows act on next is the work, not a hidden window.
    if (had || (group && dv.activeGroup === group)) options.main()?.api.setActive();
    emit();
  }

  function move(id: ToolId, to: Edge, index: number): void {
    const panel = dv.getPanel(id);
    const group = groupOf(to);
    if (!panel || !group) return;
    const from = edgeOfLocation(panel.group);
    panel.api.moveTo({ group, position: "center", index });
    if (from && from !== to && (groupOf(from)?.panels.length ?? 0) === 0) dv.setEdgeGroupVisible(from, false);
    emit();
  }

  function size(edge: Edge): number {
    const api = dv.getEdgeGroup(edge);
    return api ? Math.round(edge === "bottom" ? api.height : api.width) : 0;
  }

  function setSize(edge: Edge, px: number): void {
    dv.getEdgeGroup(edge)?.setSize(edge === "bottom" ? { height: px } : { width: px });
  }

  return {
    ensure,
    reconcile,
    shown,
    active,
    edgeOf,
    show,
    hide,
    move,
    size,
    setSize,
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    toState: () => dv.toJSON(),
    fromState(state) {
      dv.fromJSON(state as Parameters<DockviewApi["fromJSON"]>[0]);
      ensure();
    },
  };
}
