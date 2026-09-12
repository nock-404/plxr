"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  DockviewReact,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

import pkg from "@/package.json";
import { InlineStrip } from "@/components/ui/TopStrip";

import Overview from "@/components/views/Overview";
import Inbox from "@/components/views/Inbox";
import Folders from "@/components/views/Folders";
import Ports from "@/components/views/Ports";
import Usage from "@/components/views/Usage";
import Archive from "@/components/views/Archive";
import Session from "@/components/views/Session";
import Rail, { type View } from "@/components/Rail";
import Preview from "@/components/Preview";
import ChangesPanel from "@/components/ChangesPanel";
import SearchPanel from "@/components/SearchPanel";
import Difference from "@/components/Difference";
import Files from "@/components/Files";
import Viewer from "@/components/Viewer";
import CommandPalette, { type Command } from "@/components/CommandPalette";
import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { Tile } from "@/lib/types";
import { tabTitle } from "@/lib/state";
import { errText } from "@/lib/i18n";

/* The window as dockable panels.
 *
 * Every view and every session is a panel you can split, tab, drag and float,
 * and the arrangement is saved and comes back at the next start — so usage and
 * a terminal can be on screen at once, the way a real editor lays things out.
 * The rail stays as the launcher: clicking one opens or focuses its panel.
 *
 * The panels render inside DockviewReact, which keeps them in the React tree,
 * so the live data — the tiles, which folder you are in, the callbacks — comes
 * to them through a context provided just above the dock rather than through
 * dockview's own params, which are frozen at the moment a panel is made.
 */

/* Where an editor should land, for a panel that is already open.
 *
 * A panel's params are frozen when it is made, so a second jump into a file
 * that is already on screen — a search hit on another line — cannot travel
 * through them. It travels through the context instead, stamped with a nonce
 * so the same line asked for twice still moves the cursor. */
export type EditorTarget = { id: string; line: number; nonce: number } | null;

/* Which file's difference is on screen, and from which folder: two folders
   can hold a file of the same name, so the folder is part of the identity —
   of the panel's id as well (diff:<root>:<s|u>:<path>). */
export type ShownDiff = { rootId: string; path: string; staged: boolean } | null;

const diffId = (rootId: string, path: string, staged: boolean) => `diff:${rootId}:${staged ? "s" : "u"}:${path}`;

type DockData = {
  tiles: Tile[];
  shown: Tile[];
  here: string;
  connected: boolean;
  counts: { inbox: number; ports: number; archive: number };
  /* The active dock panel, whatever kind it is. */
  activeId: string;
  /* The session that was focused last — sticky. Focusing the editor, the
     changes or the usage panel does not clear it, so anything that follows
     "the session you are working in" keeps following it while you look at
     something beside it. Empty until a session panel has ever been active,
     which on a restore is a moment longer than it takes the layout to appear:
     a follower has to tolerate that, and never blank or close itself over it. */
  lastActiveSessionId: string;
  editorTarget: EditorTarget;
  /* The diff that was opened last, while its panel is open — so the row it
     came from stays lit in the changes list, and goes dark when the panel
     closes, whichever way it is closed. */
  shownDiff: ShownDiff;
  openSession: (id: string) => void;
  openPreview: (url: string, title: string) => void;
  openDiff: (rootId: string, path: string, staged: boolean, title: string) => void;
  onDiffClosed: (rootId: string, path: string, staged: boolean) => void;
  openPanel: (view: string) => void;
  /* An editor for one file, as a panel beside the session — one panel per
     path, so every file keeps its own undo history. `path` is the path the
     tree reports for the file, which is what the file API reads. */
  openEditor: (rootId: string, path: string, line?: number, title?: string) => void;
  /* The file tree of a session or a folder, as a panel of its own. */
  openFiles: (rootId: string, root: string, title: string) => void;
  /* Whether an editor panel holds unsaved edits, by panel id — written by the
     editor as that changes, read by its tab, so the tab's close cannot throw
     them away without a word. */
  setDirty: (panelId: string, dirty: boolean) => void;
  isDirty: (panelId: string) => boolean;
  onReplaced: (id: string) => void;
};

const Ctx = createContext<DockData | null>(null);
const useDock = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("a dock panel was rendered outside the dock");
  return v;
};

// The panels, each reading the live data from the context.
function OverviewPanel() {
  const d = useDock();
  return <Overview tiles={d.shown} onOpen={d.openSession} />;
}
function InboxPanel() {
  const d = useDock();
  return <Inbox tiles={d.tiles} onOpen={d.openSession} />;
}
function FoldersPanel() {
  const d = useDock();
  return <Folders place={d.here} onOpenFile={d.openEditor} />;
}
function PortsPanel() {
  const d = useDock();
  return <Ports onPreview={d.openPreview} />;
}
function UsagePanel() {
  return <Usage />;
}
function ArchivePanel() {
  const d = useDock();
  return <Archive onOpen={d.openSession} />;
}
function SessionPanel(props: IDockviewPanelProps<{ id: string }>) {
  const d = useDock();
  const id = props.params.id;
  const tile = d.tiles.find((t) => t.id === id);
  if (tile) {
    return (
      <Session
        tile={tile}
        others={d.tiles.filter((t) => t.id !== id)}
        onBack={() => props.api.close()}
        onReplaced={(nextId) => {
          props.api.close();
          d.onReplaced(nextId);
        }}
        onOpenFile={(path) => d.openEditor(tile.id, path)}
        /* The changes panel follows the session focused last, and the click
           that asks for it lands in this panel — so it is this session's
           folder the panel comes up on. */
        onChanges={() => d.openPanel("changes")}
      />
    );
  }
  /* No tile — but a panel must never close itself on that alone.
   *
   * On a restore the layout comes back before the tiles have loaded, so the
   * session is missing for a moment; a panel that closed then would delete
   * itself from the saved layout and never come back. So while the tiles are
   * still on their way this waits, and only once they are in and the session
   * is genuinely not among them does it offer to close — the session ended, or
   * the service was restarted and this id is from before. */
  return <GonePanel id={id} onClose={() => props.api.close()} />;
}

/* The note for a session the service does not list.
 *
 * It offers the way back before the way out: RESTART asks the service to
 * start the id again — it still knows an ended session for hours, and an
 * orphaned one until somebody clears it — and when even that is gone, the
 * archive has the conversation, which is the other path to the same place. */
function GonePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useDock();
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  if (!d.connected) {
    return (
      <div className="emptyNote">
        <b>{tr("dock.sessionLoading", "opening…")}</b>
      </div>
    );
  }
  return (
    <div className="emptyNote">
      <b>{tr("dock.sessionGone", "this session is not running")}</b>
      {tr("dock.sessionGoneRestart", "It ended, or plxr was restarted since. RESTART brings it back under the same id when plxr still knows it; otherwise the archive has the conversation.")}
      <span className="rowInline">
        <Button
          primary
          busy={restarting}
          onClick={() => {
            setRestarting(true);
            setRestartError("");
            api
              .resume(id)
              .catch((e) => setRestartError(errText(e)))
              .finally(() => setRestarting(false));
          }}
        >
          {tr("session.restart", "RESTART")}
        </Button>
        <Button onClick={() => d.openPanel("archive")}>{tr("rail.archive", "Archive")}</Button>
        <Button onClick={onClose}>{tr("common.close", "CLOSE")}</Button>
      </span>
      {restartError ? <span className="notice warn">{restartError}</span> : null}
    </div>
  );
}

function PreviewPanel(props: IDockviewPanelProps<{ url: string }>) {
  return <Preview url={props.params.url} />;
}

/* The one changes panel follows the session focused last — its id is a git
   id as far as the service is concerned. The path field's folder is only the
   fallback for a layout in which no session has ever been active. */
function ChangesDockPanel() {
  const d = useDock();
  const id = d.lastActiveSessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  /* A session the service no longer knows — plxr was restarted since this
     layout was saved — cannot be followed, and is not: the panel falls back
     to the path field's folder rather than reading for ever. Only once the
     tiles are connected, though; before that the session is merely not here
     yet, and the panel's own debounce rides over the moment. */
  const gone = Boolean(id) && d.connected && !followed;
  return (
    <ChangesPanel
      here={d.here}
      sessionId={gone ? undefined : id || undefined}
      label={followed ? followed.name || followed.cwd : gone ? undefined : id || undefined}
      shown={d.shownDiff}
      onDiff={d.openDiff}
      onEdit={(rootId, path) => d.openEditor(rootId, path)}
    />
  );
}

/* The one search panel follows the same session the changes panel does, with
   the same tolerance for a session the service does not know yet or any
   more. A hit opens the editor at its line, beside the terminal. */
function SearchDockPanel() {
  const d = useDock();
  const id = d.lastActiveSessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  const gone = Boolean(id) && d.connected && !followed;
  return (
    <SearchPanel
      here={d.here}
      sessionId={gone ? undefined : id || undefined}
      label={followed ? followed.name || followed.cwd : gone ? undefined : id || undefined}
      onOpen={(rootId, path, line) => d.openEditor(rootId, path, line)}
    />
  );
}

function DiffPanel(props: IDockviewPanelProps<{ rootId: string; path: string; staged: boolean }>) {
  const d = useDock();
  const p = props.params;
  // Difference is an overlay (position: absolute; inset: 0). On its own it fills
  // the nearest positioned ancestor, which in a dock is not reliably this panel.
  // This wrapper is that ancestor, so the diff fills exactly its panel.
  return (
    <div className="diffPanel">
      <Difference
        rootId={p.rootId}
        path={p.path}
        staged={p.staged}
        onClose={() => {
          d.onDiffClosed(p.rootId, p.path, p.staged);
          props.api.close();
        }}
        onEdit={(path, line) => d.openEditor(p.rootId, path, line || undefined)}
      />
    </div>
  );
}

/* One file, editable, in a panel of its own beside the terminal.
 *
 * The file is fixed for the life of the panel (it is in the id), so nothing
 * here ever switches files under an unsaved buffer. A later jump to a line in
 * this same file arrives through the context, not the frozen params. */
function EditorPanel(props: IDockviewPanelProps<{ rootId: string; path: string; line?: number }>) {
  const d = useDock();
  const p = props.params;
  const target = d.editorTarget && d.editorTarget.id === props.api.id ? d.editorTarget : null;
  return (
    <div className="editorPanel">
      <Viewer
        rootId={p.rootId}
        path={p.path}
        line={target ? target.line : p.line}
        jump={target ? target.nonce : 0}
        onClose={() => props.api.close()}
        onDirty={(v) => d.setDirty(props.api.id, v)}
      />
    </div>
  );
}

/* The tab of an editor panel: its close refuses to drop unsaved edits.
 *
 * Dockview's own tab closes the panel outright and offers no way to be asked
 * first, so an editor with edits in it was gone on a click, edits and all. This
 * tab asks the dock whether the panel is dirty; if it is, the click brings the
 * panel to the front instead — where the editor's own CLOSE says what is at
 * stake and offers SAVE, DISCARD or CANCEL. A clean panel closes as before. */
function EditorTab(props: IDockviewPanelHeaderProps) {
  const d = useDock();
  return (
    <div className="editorTab">
      <span className="editorTabName">{props.api.title}</span>
      {/* The glyph is drawn by the skin (::after), not written here: a tab's
          text is its title, and everything that reads tab titles — the gates,
          the layout's own bookkeeping — must not find a ✕ appended to it. */}
      <Button
        bare
        className="editorTabClose"
        aria-label={tr("common.close", "CLOSE")}
        onClick={(e) => {
          e.stopPropagation();
          if (d.isDirty(props.api.id)) {
            props.api.setActive();
            return;
          }
          props.api.close();
        }}
      >
        {""}
      </Button>
    </div>
  );
}

/* The file tree of one root, as a panel. A row opens its file as an editor
   panel beside whatever is on screen — the terminal stays where it is. */
function FilesPanel(props: IDockviewPanelProps<{ rootId: string; root: string }>) {
  const d = useDock();
  const p = props.params;
  return (
    <div className="filesPanel">
      <Files rootId={p.rootId} root={p.root} onPick={(path) => d.openEditor(p.rootId, path)} />
    </div>
  );
}

function RailPanel() {
  const d = useDock();
  // The active dock panel decides what the rail highlights: a view name, or a
  // session when a "session:" panel is active.
  const activeView = (d.activeId.startsWith("session:") ? "session" : d.activeId) as View;
  const activeSession = d.activeId.startsWith("session:") ? d.activeId.slice("session:".length) : null;
  return (
    <Rail
      view={activeView}
      tiles={d.tiles}
      openId={activeSession}
      counts={d.counts}
      onView={(v) => d.openPanel(v)}
      onOpen={d.openSession}
    />
  );
}

const components = {
  rail: RailPanel,
  overview: OverviewPanel,
  preview: PreviewPanel,
  changes: ChangesDockPanel,
  search: SearchDockPanel,
  diff: DiffPanel,
  editor: EditorPanel,
  files: FilesPanel,
  inbox: InboxPanel,
  folders: FoldersPanel,
  ports: PortsPanel,
  usage: UsagePanel,
  archive: ArchivePanel,
  session: SessionPanel,
};

export const VIEW_TITLES: Record<string, string> = {
  overview: "Overview",
  inbox: "Inbox",
  folders: "Folders",
  ports: "Ports",
  usage: "Usage",
  archive: "Archive",
  changes: "Changes",
  search: "Search",
};

/* The dockview major this build lays panels out with. A saved arrangement is
   dockview's own JSON; a preset saved under one major is not trusted under the
   next, because the shape may have moved. Read from the dependency, not typed
   here, so a bump in package.json is the one place it changes. */
export const DV_MAJOR = parseInt(String(pkg.dependencies["dockview-react"]).replace(/^[^\d]*/, ""), 10);

/* A named arrangement the user saved, and the list of them as it sits in prefs
   under `dockPresets`. */
export type Preset = { name: string; layout: object };
export type PresetStore = { dvMajor: number; items: Preset[] };

// readPresets takes the saved list out of a prefs blob, or nothing when the
// list was saved under another dockview major.
export function readPresets(prefs: Record<string, unknown>): Preset[] {
  const store = prefs.dockPresets as Partial<PresetStore> | undefined;
  if (!store || store.dvMajor !== DV_MAJOR || !Array.isArray(store.items)) return [];
  return store.items.filter((p) => p && typeof p.name === "string" && p.layout && typeof p.layout === "object");
}

// The activities a fresh window can be arranged for; 'focus' is the first-run
// fallback and what a reset returns to unless another was chosen.
export type Activity = "focus" | "code" | "review" | "monitor";
export const ACTIVITIES: Activity[] = ["focus", "code", "review", "monitor"];

// A change from the rail: open or focus a view, or a session.
export type Focus = { kind: "view"; view: string } | { kind: "session"; id: string; name: string } | null;

/* What the shell asks of the dock, imperatively. One channel for everything
   that used to be a nonce per verb: `seq` makes each request new, `type` says
   what it is. */
export type LayoutRequest =
  | { type: "reset" }
  | { type: "apply"; arg: object }
  | { type: "save"; arg: string }
  | { type: "activity"; arg: Activity };
export type LayoutAction = LayoutRequest & { seq: number };

// The tabs that are not dockview's default: the editor's, whose close is guarded.
const tabComponents = { editorTab: EditorTab };

export default function Dock({
  tiles,
  shown,
  here,
  connected,
  counts,
  openSession,
  onReplaced,
  focus,
  layoutAction,
  onLayoutSaved,
  appCommands,
  paletteOpen,
  onClosePalette,
}: Omit<
  DockData,
  | "openPreview"
  | "openDiff"
  | "onDiffClosed"
  | "openPanel"
  | "openEditor"
  | "openFiles"
  | "activeId"
  | "lastActiveSessionId"
  | "editorTarget"
  | "shownDiff"
  | "setDirty"
  | "isDirty"
> & {
  focus: Focus;
  layoutAction: LayoutAction | null;
  /* The dock's answer to a 'save': the arrangement as dockview writes it, for
     the shell to keep under the name it asked for. */
  onLayoutSaved: (name: string, layout: object) => void;
  appCommands: Command[];
  /* Whether the palette is up is the shell's: it owns the keyboard and the
     typing guard, so ⌘K cannot toggle the palette while a field is being
     typed in. The dock only builds the commands and draws it. */
  paletteOpen: boolean;
  onClosePalette: () => void;
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const restored = useRef(false);
  const activity = useRef<Activity>("focus");
  const [activeId, setActiveId] = useState("overview");
  const [lastActiveSessionId, setLastActiveSessionId] = useState("");
  const [editorTarget, setEditorTarget] = useState<EditorTarget>(null);
  const [shownDiff, setShownDiff] = useState<ShownDiff>(null);

  const openPreview = useCallback((url: string, title: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, `preview:${url}`, "preview", title, { url }, "companion");
  }, []);

  const openDiff = useCallback((rootId: string, path: string, staged: boolean, title: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, diffId(rootId, path, staged), "diff", title, { rootId, path, staged }, "companion");
    setShownDiff({ rootId, path, staged });
  }, []);

  // Only the diff that is lit goes dark — a stale close must not unlight a
  // newer one.
  const onDiffClosed = useCallback((rootId: string, path: string, staged: boolean) => {
    setShownDiff((s) => (s && s.rootId === rootId && s.path === path && s.staged === staged ? null : s));
  }, []);

  const openPanel = useCallback((view: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, view, view, VIEW_TITLES[view] ?? view, {}, "view");
  }, []);

  /* One file, one panel — whichever way it was reached.
   *
   * The tree hands over the file's resolved absolute path, a changes row and
   * a diff line its path relative to the folder; keyed on the raw string, the
   * same file opened as up to three editors with three undo histories and
   * three save paths, and a dirty buffer could be re-based on another panel's
   * save. So the path is brought to one form — relative to the root — before
   * it becomes the id. The file API reads either form. */
  // The roots the editors resolve their paths against, read at call time so
  // openEditor stays stable while the tiles change every second.
  const rootDirRef = useRef({ tiles, here });
  rootDirRef.current = { tiles, here };

  // Unsaved edits per editor panel: a ref, because it is read at the moment a
  // tab is clicked and never needs a render of its own.
  const dirtyRef = useRef(new Map<string, boolean>());
  const setDirty = useCallback((panelId: string, dirty: boolean) => {
    if (dirty) dirtyRef.current.set(panelId, true);
    else dirtyRef.current.delete(panelId);
  }, []);
  const isDirty = useCallback((panelId: string) => dirtyRef.current.get(panelId) === true, []);

  const openEditor = useCallback((rootId: string, rawPath: string, line?: number, title?: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    const { tiles: ts, here: h } = rootDirRef.current;
    const rootDir = ts.find((t) => t.id === rootId)?.cwd ?? h;
    let path = rawPath;
    if (rootDir && (rawPath === rootDir || rawPath.startsWith(rootDir + "/"))) path = rawPath.slice(rootDir.length + 1);
    const id = `editor:${rootId}:${path}`;
    const name = title || path.split("/").pop() || path;
    const made = openOrFocus(dv, id, "editor", name, { rootId, path, line }, "companion");
    // A panel that was already there keeps its frozen params; the line it is
    // asked for now goes through the context instead.
    if (!made && line) setEditorTarget((t) => ({ id, line, nonce: (t?.nonce ?? 0) + 1 }));
  }, []);

  const openFiles = useCallback((rootId: string, root: string, title: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, `files:${rootId}`, "files", title, { rootId, root }, "companion");
  }, []);

  const data = useMemo<DockData>(
    () => ({
      tiles, shown, here, connected, counts, activeId, lastActiveSessionId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openPanel, openEditor, openFiles, setDirty, isDirty, onReplaced,
    }),
    [
      tiles, shown, here, connected, counts, activeId, lastActiveSessionId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openPanel, openEditor, openFiles, setDirty, isDirty, onReplaced,
    ],
  );

  const commands = useMemo<Command[]>(() => {
    const views: Command[] = Object.entries(VIEW_TITLES).map(([id, title]) => ({
      id: `view:${id}`,
      group: tr("palette.view", "View"),
      label: tr("palette.openThing", "Open {name}", { name: title }),
      run: () => openPanel(id),
    }));
    const sessions: Command[] = tiles.flatMap((t) => {
      const name = t.name || t.id;
      const rows: Command[] = [
        { id: `open:${t.id}`, group: tr("palette.session", "Session"), label: tr("palette.openThing", "Open {name}", { name }), run: () => openSession(t.id) },
        {
          id: `files:${t.id}`,
          group: tr("palette.session", "Session"),
          label: tr("palette.filesOf", "Files of {name}", { name }),
          run: () => openFiles(t.id, t.cwd, name),
        },
      ];
      if (t.alive) {
        rows.push({
          id: `pause:${t.id}`,
          group: tr("palette.session", "Session"),
          label: (t.frozen ? tr("palette.resume", "Resume {name}", { name }) : tr("palette.pause", "Pause {name}", { name })),
          run: () => void (t.frozen ? api.unfreeze(t.id) : api.freeze(t.id)).catch(() => undefined),
        });
        rows.push({
          id: `kill:${t.id}`,
          group: tr("palette.session", "Session"),
          label: tr("palette.terminate", "Terminate {name}", { name }),
          run: () => void api.kill(t.id).catch(() => undefined),
        });
      }
      return rows;
    });
    return [...appCommands, ...views, ...sessions];
  }, [appCommands, tiles, openPanel, openSession, openFiles]);

  /* What the shell asks for: a reset, a preset to apply, a name to save the
     arrangement under, or an activity to arrange for. Each request is new by
     its seq; the initial null is not a request. */
  useEffect(() => {
    const dv = apiRef.current;
    if (!dv || !layoutAction) return;
    switch (layoutAction.type) {
      case "reset":
        rebuild(dv, activity.current);
        break;
      case "activity":
        activity.current = layoutAction.arg;
        void api.setPrefs({ dockActivity: layoutAction.arg }).catch(() => undefined);
        rebuild(dv, layoutAction.arg);
        break;
      case "apply":
        applyLayout(dv, layoutAction.arg, activity.current);
        break;
      case "save":
        onLayoutSaved(layoutAction.arg, dv.toJSON());
        break;
    }
    // onLayoutSaved is the shell's; only a new action is a reason to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutAction]);

  /* The state on the tab. A session panel's tab is named when it opens and
     never heard from the tiles again; it said "plxr3" while the agent inside
     was waiting for an answer. Kept current here, from every snapshot, so the
     tab strip reads like the rail does. */
  useEffect(() => {
    const dv = apiRef.current;
    if (!dv) return;
    for (const t of tiles) {
      const panel = dv.getPanel(`session:${t.id}`);
      if (!panel) continue;
      const title = tabTitle(t);
      if (panel.title !== title) panel.api.setTitle(title);
    }
  }, [tiles]);

  // Open or focus whatever the rail asked for.
  useEffect(() => {
    const dv = apiRef.current;
    if (!dv || !focus) return;
    if (focus.kind === "view") {
      openOrFocus(dv, focus.view, focus.view, VIEW_TITLES[focus.view] ?? focus.view, {}, "view");
    } else {
      openOrFocus(dv, `session:${focus.id}`, "session", focus.name || focus.id, { id: focus.id }, "session");
    }
  }, [focus]);

  function onReady(event: DockviewReadyEvent) {
    apiRef.current = event.api;
    event.api.onDidActivePanelChange((e) => {
      const id = e.panel?.id ?? "";
      setActiveId(id);
      // Sticky: only a session panel moves it, and nothing clears it.
      if (id.startsWith("session:")) setLastActiveSessionId(id.slice("session:".length));
    });
    // A diff closed from its tab never passes through Difference's BACK, so
    // the lit row is put out here, for every way a panel can go.
    event.api.onDidRemovePanel((p) => {
      if (p.id.startsWith("diff:")) setShownDiff((s) => (s && diffId(s.rootId, s.path, s.staged) === p.id ? null : s));
    });
    // Bring back the arrangement from last time; if there is none, or it does
    // not load, arrange for the chosen activity so the window is never blank.
    api
      .prefs()
      .then((p) => {
        const chosen = (p as { dockActivity?: string }).dockActivity;
        if (chosen && (ACTIVITIES as string[]).includes(chosen)) activity.current = chosen as Activity;
        const saved = (p as { dock?: object }).dock;
        if (saved && !restored.current) {
          try {
            event.api.fromJSON(saved as never);
            restored.current = true;
          } catch {
            /* a layout from an older shape: start fresh */
          }
        }
        settle(event.api, activity.current);
      })
      .catch(() => settle(event.api, activity.current));

    // Save the arrangement whenever it changes — debounced, because a drag
    // fires many times.
    let timer: number | undefined;
    event.api.onDidLayoutChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          void api.setPrefs({ dock: event.api.toJSON() });
        } catch {
          /* nothing to lose but the saved arrangement */
        }
      }, 400);
    });
  }

  return (
    <Ctx.Provider value={data}>
      <InlineStrip.Provider value={true}>
        <DockviewReact className="plxrDock" components={components} tabComponents={tabComponents} onReady={onReady} />
      </InlineStrip.Provider>
      {paletteOpen ? <CommandPalette commands={commands} onClose={onClosePalette} /> : null}
    </Ctx.Provider>
  );
}

/* ---------- arrangements ---------- */

/* LAYOUTS holds one builder per activity. Each starts from the rail and places
   its panels explicitly: the stage — sessions and the overview — right of the
   rail, and whatever belongs beside the work in an aside lane right of that.
   'focus' is the bare slate: rail and overview, and what a first start shows. */
const LAYOUTS: Record<Activity, (dv: DockviewApi) => void> = {
  focus(dv) {
    addRail(dv);
    addView(dv, "overview", { referencePanel: "rail", direction: "right" });
  },
  code(dv) {
    addRail(dv);
    addView(dv, "overview", { referencePanel: "rail", direction: "right" });
    addView(dv, "folders", { referencePanel: "overview", direction: "right" });
    dv.getPanel("overview")?.api.setActive();
  },
  review(dv) {
    addRail(dv);
    addView(dv, "overview", { referencePanel: "rail", direction: "right" });
    addView(dv, "changes", { referencePanel: "overview", direction: "right" });
    dv.getPanel("overview")?.api.setActive();
  },
  monitor(dv) {
    addRail(dv);
    addView(dv, "overview", { referencePanel: "rail", direction: "right" });
    addView(dv, "inbox", { referencePanel: "overview", direction: "right" });
    addView(dv, "usage", { referencePanel: "inbox", direction: "below" });
    dv.getPanel("overview")?.api.setActive();
  },
};

function addView(dv: DockviewApi, view: string, position: AddPanelPositionOptions) {
  dv.addPanel({ id: view, component: view, title: VIEW_TITLES[view] ?? view, ...sized(dv, position) });
}

// rebuild drops everything and arranges for the activity — a reset.
function rebuild(dv: DockviewApi, which: Activity) {
  dv.clear();
  LAYOUTS[which](dv);
  sizeRail(dv);
}

// settle is what happens after a load: whatever came back, or nothing, the
// window ends up with a rail of the right width and something on stage.
function settle(dv: DockviewApi, which: Activity) {
  if (dv.panels.length === 0) {
    LAYOUTS[which](dv);
  } else {
    ensureRail(dv);
  }
  sizeRail(dv);
}

/* applyLayout brings a saved preset up in place of what is on screen. A preset
   that no longer loads — saved by another build, edited by hand — is not half
   applied: the window is rebuilt for the activity instead, never left blank. */
function applyLayout(dv: DockviewApi, layout: object, fallback: Activity) {
  try {
    dv.fromJSON(layout as never);
  } catch {
    dv.clear();
  }
  settle(dv, fallback);
}

/* ---------- the rail ---------- */

/* remToPx turns a rem length into the pixels dockview measures in — the one
   place a pixel is allowed, and it is computed, not written. Resolved against
   the root's font size, the same way the terminal resolves its own. */
function remToPx(rem: string): number {
  return parseFloat(rem) * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
}

// railPx is the rail's width as the layout declares it, in dockview's unit.
function railPx(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue("--rail-w").trim();
  return Math.round(remToPx(declared || "12.1875rem"));
}

// addRail puts the rail panel at the left edge, as wide as --rail-w says.
function addRail(dv: DockviewApi) {
  dv.addPanel({ id: "rail", component: "rail", title: "plxr", position: { direction: "left" }, initialWidth: railPx() });
}

/* sizeRail re-asserts the declared width on a rail that is already there.
   A saved layout carries the rail in pixels, frozen at whatever the font size
   was when it was saved; the stylesheet's rem is the truth, so it wins on load. */
function sizeRail(dv: DockviewApi) {
  dv.getPanel("rail")?.api.setSize({ width: railPx() });
}

/* ensureRail guarantees the launcher is on screen.
 *
 * A layout saved before the rail was a panel — anyone who upgrades — comes back
 * without it, and then there is no menu and no obvious way to reach one. So on
 * every load, if the restored arrangement has no rail, one is put back at the
 * left. The rail is the way to everything else; it is allowed to be moved, not
 * to be lost. */
function ensureRail(dv: DockviewApi) {
  if (!dv.getPanel("rail")) {
    addRail(dv);
  }
}

/* ---------- placing panels ---------- */

/* What a panel is for decides where it goes.
   session   — a terminal; lives on the stage.
   view      — a rail view; the overview joins the stage, the rest go aside.
   companion — something that belongs beside the work. The tree and the
               changes list go aside with the utilities; a document — an
               editor, a diff, a preview — goes on the desk, a group of its
               own beside the aside, so it never covers the list it was
               opened from. */
export type Role = "session" | "view" | "companion";
type Lane = "stage" | "aside" | "desk";

const isStagePanel = (id: string) => id.startsWith("session:") || id === "overview";
const isDocument = (id: string) => id.startsWith("editor:") || id.startsWith("diff:") || id.startsWith("preview:");
const isAsidePanel = (id: string) => id !== "rail" && !isStagePanel(id) && !isDocument(id);

function laneOf(role: Role, id: string): Lane {
  if (role === "session") return "stage";
  if (role === "view" && id === "overview") return "stage";
  if (isDocument(id)) return "desk";
  return "aside";
}

// The group a lane lives in, if one exists: the active group when it
// qualifies, else the first that does. A group that holds a stage panel is
// never an aside or a desk, whatever else was tabbed into it — the user put
// something over a terminal on purpose, and the lanes must not grow into it.
function groupOf(dv: DockviewApi, lane: Lane): DockviewGroupPanel | undefined {
  const holds = (g: DockviewGroupPanel) => {
    if (lane === "stage") return g.panels.some((p) => isStagePanel(p.id));
    if (g.panels.some((p) => isStagePanel(p.id))) return false;
    return lane === "aside" ? g.panels.some((p) => isAsidePanel(p.id)) : g.panels.some((p) => isDocument(p.id));
  };
  const active = dv.activeGroup;
  if (active && holds(active)) return active;
  return dv.groups.find(holds);
}

/* place decides where a new panel of this lane goes.
 *
 * The stage is where the terminals are, right of the rail; the aside is a
 * group to the right of the stage where everything that is looked at beside a
 * terminal collects; the desk is right of the aside, for what those lists
 * open. A new panel tabs into its lane's group, or opens that group beside
 * the lane before it when there is none yet. Nothing ever tabs over the
 * terminal because it happened to be the active group, and a file never
 * tabs over the tree it was picked from. */
function place(dv: DockviewApi, lane: Lane): AddPanelPositionOptions {
  const stage = groupOf(dv, "stage");
  const aside = groupOf(dv, "aside");
  const desk = groupOf(dv, "desk");
  if (lane === "stage") {
    if (stage) return { referenceGroup: stage };
    if (aside) return { referenceGroup: aside, direction: "left" };
    if (desk) return { referenceGroup: desk, direction: "left" };
    if (dv.getPanel("rail")) return { referencePanel: "rail", direction: "right" };
    return { direction: "right" };
  }
  if (lane === "aside") {
    if (aside) return { referenceGroup: aside };
    if (desk) return { referenceGroup: desk, direction: "left" };
    if (stage) return { referenceGroup: stage, direction: "right" };
    return { direction: "right" };
  }
  if (desk) return { referenceGroup: desk };
  if (aside) return { referenceGroup: aside, direction: "right" };
  if (stage) return { referenceGroup: stage, direction: "right" };
  return { direction: "right" };
}

/* sized gives a split its size: half of the group it splits off from.
 *
 * Without one, dockview hands the new group an equal share of the whole row —
 * a third group made the rail, the stage and itself 480px each, the rail
 * included. With a size, the space comes out of the group being split and its
 * neighbours keep theirs, the way a drop onto a group's edge behaves. */
function sized(dv: DockviewApi, position: AddPanelPositionOptions): { position: AddPanelPositionOptions; initialWidth?: number; initialHeight?: number } {
  const direction = position.direction;
  if (!direction || direction === "within") return { position };
  const ref =
    "referenceGroup" in position
      ? typeof position.referenceGroup === "string"
        ? dv.getGroup(position.referenceGroup)
        : position.referenceGroup
      : "referencePanel" in position
        ? typeof position.referencePanel === "string"
          ? dv.getPanel(position.referencePanel)?.group
          : position.referencePanel.group
        : undefined;
  if (!ref) return { position };
  if (direction === "left" || direction === "right") {
    // Splitting off the rail — the first panel of a fresh arrangement — takes
    // everything but the rail's own width, not half the window.
    const offRail = ref.panels.some((p) => p.id === "rail");
    return { position, initialWidth: offRail ? Math.max(1, ref.api.width - railPx()) : Math.floor(ref.api.width / 2) };
  }
  return { position, initialHeight: Math.floor(ref.api.height / 2) };
}

// openOrFocus makes the panel where its role says if it is not there, and
// brings it to the front. Returns whether it was made now.
function openOrFocus(
  dv: DockviewApi,
  id: string,
  component: string,
  title: string,
  params: object,
  role: Role,
): boolean {
  const existing = dv.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return false;
  }
  // An editor gets its own tab, whose close will not drop unsaved edits.
  const tab = component === "editor" ? { tabComponent: "editorTab" } : {};
  dv.addPanel({ id, component, title, params, ...tab, ...sized(dv, place(dv, laneOf(role, id))) });
  return true;
}
