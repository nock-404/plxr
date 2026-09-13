/* A saved arrangement from before the tools had edges, made into one where
 * they do.
 *
 * Until now a tool was a panel like any other: it sat in the grid, tabbed
 * beside the overview, split under the inbox, or in a column he had dragged it
 * to. Now the grid holds documents only and every tool lives at an edge. The
 * arrangement saved in prefs.dock is dockview's own JSON, and anyone who
 * upgrades has one full of tools where tools no longer go. Loaded as it is, it
 * would put them back into the grid.
 *
 * So the saved JSON is taken apart before it is loaded, as data and nothing
 * else — pure, JSON in and JSON out, and held in layoutMigrate.test.mjs
 * against arrangements the old window really wrote:
 *
 *   1. the old menu panel "rail" goes;
 *   2. every tool and every folder tree ("files:<rootId>") leaves the grid,
 *      the floating groups and the popout windows, and a tool that was in
 *      front of its group is named in openTools so it can be shown at its
 *      edge instead — a folder tree as the Files tool;
 *   3. a group left empty goes, and a split left with one side is that side;
 *   4. a document found at an edge goes into the first group of the grid.
 *
 * A tool at an edge keeps its panel. An arrangement with nothing of the above
 * in it comes back exactly as it was, so a second run changes nothing.
 */
import type { SerializedDockview } from "dockview-core";
import { isTool, type ToolId } from "./tools";

type Json = Record<string, unknown>;
type Group = Json & { id: string; views: string[]; activeView?: string; tabGroups?: unknown };
type Leaf = Json & { type: "leaf"; data: Group; size?: number };
type Branch = Json & { type: "branch"; data: GridNode[]; size?: number };
type GridNode = Leaf | Branch;
type Grid = Json & { root: GridNode; orientation?: string; width?: number; height?: number };
type Layout = Json & {
  grid: Grid;
  panels: Record<string, unknown>;
  activeGroup?: string;
  floatingGroups?: unknown[];
  popoutGroups?: unknown[];
  edgeGroups?: Record<string, unknown>;
};

export type Migrated = { layout: SerializedDockview | null; openTools: ToolId[] };

const RAIL = "rail";

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const isGroup = (v: unknown): v is Group => isObject(v) && typeof v.id === "string" && Array.isArray(v.views);
const isNode = (v: unknown): v is GridNode =>
  isObject(v) && ((v.type === "leaf" && isGroup(v.data)) || (v.type === "branch" && Array.isArray(v.data)));
const isGrid = (v: unknown): v is Grid => isObject(v) && isNode(v.root);

// The tool a panel stands for: itself, or Files for a folder tree.
function toolOf(id: string): ToolId | null {
  if (isTool(id)) return id;
  return id.startsWith("files:") ? "files" : null;
}

// A panel that may no longer sit in the grid, a floating group or a popout.
const leavesGrid = (id: unknown) => typeof id === "string" && (id === RAIL || toolOf(id) !== null);

// A panel that may no longer sit at an edge: anything that is not a tool.
const leavesEdge = (id: unknown) => typeof id === "string" && !isTool(id);

// The groups under a grid node, in the order dockview walks them.
function groupsOf(node: GridNode): Group[] {
  return node.type === "leaf" ? [node.data] : node.data.filter(isNode).flatMap(groupsOf);
}

// Every group outside the edges: the grid's, the floating ones', the popouts'.
function gridGroups(layout: Layout): Group[] {
  const hosted = (h: unknown): Group[] => {
    if (!isObject(h)) return [];
    if (isGroup(h.data)) return [h.data];
    return isGrid(h.grid) ? groupsOf(h.grid.root) : [];
  };
  return [
    ...groupsOf(layout.grid.root),
    ...(Array.isArray(layout.floatingGroups) ? layout.floatingGroups.flatMap(hosted) : []),
    ...(Array.isArray(layout.popoutGroups) ? layout.popoutGroups.flatMap(hosted) : []),
  ];
}

function edgeGroupsOf(layout: Layout): Group[] {
  const edges = isObject(layout.edgeGroups) ? Object.values(layout.edgeGroups) : [];
  return edges.flatMap((e) => (isObject(e) && isGroup(e.group) ? [e.group] : []));
}

function needsWork(layout: Layout): boolean {
  if (gridGroups(layout).some((g) => g.views.some(leavesGrid))) return true;
  const atEdges = edgeGroupsOf(layout);
  if (atEdges.some((g) => g.views.some(leavesEdge))) return true;
  const edgeViews = new Set(atEdges.flatMap((g) => g.views));
  return Object.keys(layout.panels).some((id) => leavesGrid(id) && !(isTool(id) && edgeViews.has(id)));
}

/* takeOut removes the views `goes` picks from a group. When the view in front
   went, the first view left is put in front and `wasInFront` hears which one
   it was. Tab groups keep only the panels still in the group. */
function takeOut(g: Group, goes: (id: unknown) => boolean, wasInFront: (id: string) => void): void {
  if (!g.views.some(goes)) return;
  const active = g.activeView;
  g.views = g.views.filter((v) => !goes(v));
  if (typeof active === "string" && goes(active)) {
    wasInFront(active);
    if (g.views.length) g.activeView = g.views[0];
    else delete g.activeView;
  }
  if (Array.isArray(g.tabGroups)) {
    g.tabGroups = g.tabGroups
      .filter(isObject)
      .map((t) => ({ ...t, panelIds: Array.isArray(t.panelIds) ? t.panelIds.filter((id) => g.views.includes(id as string)) : [] }))
      .filter((t) => t.panelIds.length > 0);
  }
}

/* prune takes the leaving views out of every group under a node, drops the
   groups left empty and the splits left with nothing in them, and folds a
   split left with one side into its parent. Null when nothing is left. */
function prune(node: GridNode, wasInFront: (id: string) => void): GridNode | null {
  if (node.type === "leaf") {
    takeOut(node.data, leavesGrid, wasInFront);
    return node.data.views.length ? node : null;
  }
  const children: GridNode[] = [];
  for (const child of node.data) {
    if (!isNode(child)) continue;
    const kept = prune(child, wasInFront);
    if (!kept) continue;
    if (kept.type === "branch" && kept.data.length === 1) {
      /* A split with one side left is that side. A group takes the split's
         place and size in this parent; a split inside it runs the way this
         parent runs, so its parts join this parent's. */
      const only = kept.data[0];
      if (only.type === "leaf") {
        const leaf: Leaf = { ...only };
        if (kept.size === undefined) delete leaf.size;
        else leaf.size = kept.size;
        children.push(leaf);
      } else {
        children.push(...only.data);
      }
    } else {
      children.push(kept);
    }
  }
  return children.length ? { ...node, data: children } : null;
}

/* pruneGrid does that to a whole grid. Its root stays a split, even an empty
   one; a root left holding one split becomes that split, and the grid turns
   to run the way that split ran. */
function pruneGrid(grid: Grid, wasInFront: (id: string) => void): void {
  const kept = prune(grid.root, wasInFront);
  if (!kept) {
    grid.root = { type: "branch", data: [], ...(grid.root.size === undefined ? {} : { size: grid.root.size }) };
    return;
  }
  if (kept.type === "branch" && kept.data.length === 1 && kept.data[0].type === "branch") {
    grid.root = { ...kept, data: kept.data[0].data };
    if (grid.orientation === "HORIZONTAL") grid.orientation = "VERTICAL";
    else if (grid.orientation === "VERTICAL") grid.orientation = "HORIZONTAL";
    return;
  }
  grid.root = kept;
}

// A group id no other group uses; dockview numbers its groups.
function freshGroupId(layout: Layout): string {
  const used = new Set([...gridGroups(layout), ...edgeGroupsOf(layout)].map((g) => g.id));
  let n = Math.max(0, ...[...used].map(Number).filter(Number.isFinite)) + 1;
  while (used.has(String(n))) n++;
  return String(n);
}

/* The first group of the grid, made when the grid has none, so a document
   taken off an edge has somewhere to go. */
function firstGridGroup(layout: Layout): Group {
  const first = groupsOf(layout.grid.root)[0];
  if (first) return first;
  const group: Group = { id: freshGroupId(layout), views: [] };
  const size = layout.grid.orientation === "VERTICAL" ? layout.grid.height : layout.grid.width;
  const leaf: Leaf = { type: "leaf", data: group, ...(typeof size === "number" ? { size } : {}) };
  const root = layout.grid.root;
  layout.grid.root = { ...root, type: "branch", data: [leaf] };
  return group;
}

export function migrateLayout(dock: unknown): Migrated {
  if (!isObject(dock) || !isGrid(dock.grid) || !isObject(dock.panels)) return { layout: null, openTools: [] };
  const layout = structuredClone(dock) as Layout;
  if (!needsWork(layout)) return { layout: layout as unknown as SerializedDockview, openTools: [] };

  const openTools: ToolId[] = [];
  const wasInFront = (id: string) => {
    const tool = toolOf(id);
    if (tool && !openTools.includes(tool)) openTools.push(tool);
  };

  // 1–3: out of the grid, the floating groups and the popout windows.
  pruneGrid(layout.grid, wasInFront);
  for (const key of ["floatingGroups", "popoutGroups"] as const) {
    const hosts = layout[key];
    if (!Array.isArray(hosts)) continue;
    layout[key] = hosts.filter((h) => {
      if (!isObject(h)) return true;
      if (isGroup(h.data)) {
        takeOut(h.data, leavesGrid, wasInFront);
        return h.data.views.length > 0;
      }
      if (isGrid(h.grid)) {
        pruneGrid(h.grid, wasInFront);
        return groupsOf(h.grid.root).length > 0;
      }
      return true;
    });
  }

  // 4: a document at an edge goes into the first group of the grid; a folder
  // tree or the old menu found there goes altogether.
  const documents: string[] = [];
  for (const g of edgeGroupsOf(layout)) {
    for (const v of g.views) if (leavesEdge(v) && !leavesGrid(v) && !documents.includes(v)) documents.push(v);
    takeOut(g, leavesEdge, () => undefined);
  }
  if (documents.length) {
    const first = firstGridGroup(layout);
    for (const d of documents) if (!first.views.includes(d)) first.views.push(d);
    if (first.activeView === undefined) first.activeView = first.views[0];
  }

  // What left is no longer a panel, unless it is a tool that lives at an edge.
  const atEdges = new Set(edgeGroupsOf(layout).flatMap((g) => g.views));
  for (const id of Object.keys(layout.panels)) {
    if (leavesGrid(id) && !(isTool(id) && atEdges.has(id))) delete layout.panels[id];
  }

  // The group that was in front may have been one that went.
  const ids = new Set([...gridGroups(layout), ...edgeGroupsOf(layout)].map((g) => g.id));
  if (typeof layout.activeGroup === "string" && !ids.has(layout.activeGroup)) {
    const first = groupsOf(layout.grid.root)[0];
    if (first) layout.activeGroup = first.id;
    else delete layout.activeGroup;
  }
  return { layout: layout as unknown as SerializedDockview, openTools };
}
