/* The tools and the documents, as one list the whole window reads.
 *
 * What a view is called, which mark it wears, which key reaches it and where
 * it goes was written down nine times: the rail's list, its icons and its
 * home rows, the dock's titles, components and regions, the keymap's order
 * and the header menu's labels. Nine lists drift apart one entry at a time.
 * This is the one they are read from.
 *
 * A tool is a window at an edge of the dock — the file tree, what has
 * changed, the inbox — shown and hidden, never closed. A document lives in
 * main and closes like any tab. The edge a tool sits on is his to change; the
 * edge written here is only where it starts.
 *
 * Everything below the lists is pure and held in tools.test.mjs.
 */
import { bindingOf, caption, type Action } from "./keymap";
import type { IconName } from "./icons";

export type Edge = "left" | "right" | "bottom";
export const EDGES: readonly Edge[] = ["left", "right", "bottom"];

export type ToolId = "files" | "changes" | "search" | "review" | "inbox" | "usage" | "ports" | "archive" | "notes";

export type ToolDef = {
  id: ToolId;
  icon: IconName;
  key: string;
  fallback: string;
  /* A project tool looks at the project being worked in, a global one at the
     whole control room. */
  scope: "project" | "global";
  // The edge it starts on, before anybody moves it.
  edge: Edge;
  // The body stays mounted while hidden: a tree's open folders, unsaved text.
  keepMounted: boolean;
};

/* In the order they stand on their edges. The file tree wears the folder's
   mark until the icon packs draw one of its own. */
export const TOOLS: readonly ToolDef[] = [
  { id: "files", icon: "folder", key: "tool.files", fallback: "Files", scope: "project", edge: "left", keepMounted: true },
  { id: "changes", icon: "changes", key: "tool.changes", fallback: "Changes", scope: "project", edge: "left", keepMounted: false },
  { id: "search", icon: "search", key: "tool.search", fallback: "Search", scope: "project", edge: "left", keepMounted: false },
  { id: "review", icon: "review", key: "tool.review", fallback: "Review", scope: "project", edge: "left", keepMounted: false },
  { id: "inbox", icon: "inbox", key: "tool.inbox", fallback: "Inbox", scope: "global", edge: "right", keepMounted: false },
  { id: "usage", icon: "usage", key: "tool.usage", fallback: "Usage", scope: "global", edge: "right", keepMounted: false },
  { id: "ports", icon: "ports", key: "tool.ports", fallback: "Ports", scope: "global", edge: "right", keepMounted: false },
  { id: "archive", icon: "archive", key: "tool.archive", fallback: "Archive", scope: "global", edge: "right", keepMounted: false },
  { id: "notes", icon: "notes", key: "tool.notes", fallback: "Notes", scope: "global", edge: "right", keepMounted: true },
];

/* The documents that have a name of their own. Sessions, editors, diffs and
   previews are documents too, named after what they show. */
export const DOCS = {
  overview: { icon: "overview", key: "doc.overview", fallback: "Overview" },
  folders: { icon: "folder", key: "doc.folders", fallback: "Folders" },
  settings: { icon: "settings", key: "doc.settings", fallback: "Settings" },
} as const satisfies Record<string, { icon: IconName; key: string; fallback: string }>;

export type DocId = keyof typeof DOCS;

/* His placement and order of the tools, per edge. Every tool is in it exactly
   once; the edge a tool is on is read from here and kept nowhere else. */
export type ToolLayout = { v: 1; order: Record<Edge, ToolId[]> };

/* What ⌘1…9 reach, in that order. Search came last, so the seven keys people
   already knew kept their views, and the notes came after it. The third key
   still reaches the folders: it moves to the file tree when the keys are
   given to the tools, not before. */
export const CHORD_ORDER = ["overview", "inbox", "folders", "changes", "ports", "usage", "archive", "search", "notes"] as const;

const byId = new Map<string, ToolDef>(TOOLS.map((t) => [t.id, t]));

export const isTool = (id: string): id is ToolId => byId.has(id);

const isEdge = (v: unknown): v is Edge => v === "left" || v === "right" || v === "bottom";

/* What a tool or a document is called and which mark it wears. */
export function viewDef(id: ToolId | DocId): { icon: IconName; key: string; fallback: string } {
  return isTool(id) ? (byId.get(id) as ToolDef) : DOCS[id];
}

const emptyOrder = (): Record<Edge, ToolId[]> => ({ left: [], right: [], bottom: [] });

export function defaultToolLayout(): ToolLayout {
  const order = emptyOrder();
  for (const t of TOOLS) order[t.edge].push(t.id);
  return { v: 1, order };
}

/* normalizeToolLayout makes whatever was saved into a layout that holds every
   tool exactly once. An id that is not a tool is dropped, a tool named twice
   stays where it was named first (left, then right, then bottom), and a tool
   named nowhere is added at the end of its own edge. Anything that is not a
   layout of this version is the default. */
export function normalizeToolLayout(raw: unknown): ToolLayout {
  const order = emptyOrder();
  const seen = new Set<string>();
  const saved = raw && typeof raw === "object" && (raw as { v?: unknown }).v === 1 ? (raw as { order?: unknown }).order : undefined;
  if (saved && typeof saved === "object") {
    for (const edge of EDGES) {
      const ids = (saved as Record<string, unknown>)[edge];
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id !== "string" || !isTool(id) || seen.has(id)) continue;
        seen.add(id);
        order[edge].push(id);
      }
    }
  }
  for (const t of TOOLS) if (!seen.has(t.id)) order[t.edge].push(t.id);
  return { v: 1, order };
}

/* fromRegions reads the region choices the window used to keep under
   prefs.dockRegions, once, into a layout. A tool he put left, right or bottom
   goes to that edge, after the tools that start there; a tool kept in main,
   or never moved, starts on its own edge. The entries for kinds of document —
   "editor:", "session:" — name no tool and are passed over. */
export function fromRegions(dockRegions: unknown): ToolLayout {
  const saved = dockRegions && typeof dockRegions === "object" ? (dockRegions as Record<string, unknown>) : {};
  const order = emptyOrder();
  const moved: [ToolId, Edge][] = [];
  for (const t of TOOLS) {
    const region = Object.prototype.hasOwnProperty.call(saved, t.id) ? saved[t.id] : undefined;
    if (isEdge(region) && region !== t.edge) moved.push([t.id, region]);
    else order[t.edge].push(t.id);
  }
  for (const [id, edge] of moved) order[edge].push(id);
  return { v: 1, order };
}

export function edgeOf(layout: ToolLayout, id: ToolId): Edge {
  return EDGES.find((e) => layout.order[e].includes(id)) ?? byId.get(id)?.edge ?? "left";
}

/* moveInLayout takes a tool off whatever edge it is on and puts it on `to` at
   `index` — an index among the icons already there without it, which is what
   dropIndex measures. Reordering within one edge is the same move. The layout
   passed in is not changed. */
export function moveInLayout(layout: ToolLayout, id: ToolId, to: Edge, index: number): ToolLayout {
  const order = emptyOrder();
  for (const e of EDGES) order[e] = layout.order[e].filter((t) => t !== id);
  const at = Number.isFinite(index) ? Math.max(0, Math.min(Math.trunc(index), order[to].length)) : order[to].length;
  order[to].splice(at, 0, id);
  return { v: 1, order };
}

/* dropIndex says where an icon let go at `pointer` lands among the other
   icons of a stripe: the number of their centres before it, along the
   stripe's axis. */
export function dropIndex(centres: number[], pointer: number): number {
  return centres.filter((c) => c < pointer).length;
}

/* The chord that reaches a tool or a document, as the keyboard help prints it
   — read from the live binding, so a rebound key shows. Empty when no key
   reaches it. */
export function chordOf(id: ToolId | DocId): string {
  if (id === "settings") return caption(bindingOf("settings"));
  const at = (CHORD_ORDER as readonly string[]).indexOf(id);
  return at < 0 ? "" : caption(bindingOf(`view${at + 1}` as Action));
}
