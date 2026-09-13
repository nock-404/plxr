"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DockviewReact,
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type IDockviewPanel,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
  type Position,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

import pkg from "@/package.json";
import { InlineStrip } from "@/components/ui/TopStrip";
import { showFront } from "@/lib/front";

import Overview from "@/components/views/Overview";
import Inbox from "@/components/views/Inbox";
import Folders from "@/components/views/Folders";
import Ports from "@/components/views/Ports";
import Usage from "@/components/views/Usage";
import Archive from "@/components/views/Archive";
import Session from "@/components/views/Session";
import Notes from "@/components/views/Notes";
import Stripes from "@/components/stripes/Stripes";
import { moveRows, resetRow } from "@/components/stripes/moveMenu";
import ToolWindow from "@/components/stripes/ToolWindow";
import { edgeHost, focusedTool, type ToolHost } from "@/components/dock/toolHost";
import { followLayout, toolOps } from "@/components/dock/tools";
import { migrateLayout } from "@/lib/layoutMigrate";
import {
  DOCS,
  EDGES,
  chordOf,
  defaultToolLayout,
  edgeOf,
  fromRegions,
  isTool,
  normalizeToolLayout,
  viewDef,
  type DocId,
  type Edge,
  type ToolId,
  type ToolLayout,
} from "@/lib/tools";
import Preview from "@/components/Preview";
import ChangesPanel from "@/components/ChangesPanel";
import ReviewPanel from "@/components/ReviewPanel";
import SearchPanel from "@/components/SearchPanel";
import Difference from "@/components/Difference";
import Files from "@/components/Files";
import Settings from "@/components/Settings";
import { type LayoutControls } from "@/components/LayoutSettings";
import Viewer from "@/components/Viewer";
import CommandPalette, { type Command } from "@/components/CommandPalette";
import { setCaret } from "@/lib/caret";
import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Ask from "@/components/ui/Ask";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { fileIcon } from "@/lib/fileIcons";
import type { IconName } from "@/lib/icons";
import { bindingOf, caption, hasModifier, matches, type Action } from "@/lib/keymap";
import { PREFS_CHANGED, setDense } from "@/lib/prefsEvents";
import { BELL_CHANGED, clearBell, hasBell } from "@/lib/bell";
import type { Tile } from "@/lib/types";
import { tabTitle } from "@/lib/state";
import { projectLabel, type Project } from "@/lib/project";
import { errText } from "@/lib/i18n";

/* The window as dockable panels.
 *
 * Every document and every session is a panel you can split, tab, drag and
 * float, and the arrangement is saved and comes back at the next start — so
 * usage and a terminal can be on screen at once, the way a real editor lays
 * things out. The tools are not among them: each is a window at an edge of the
 * dock, shown and hidden through ToolHost, and the grid in the middle holds
 * documents only. Around the dock stand the stripes, one icon per tool: a
 * click shows its window, the same click hides it.
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
   of the panel's id as well (diff:<root>:<s|u>:<path>). A range diff from the
   review panel carries its base, and is a panel of its own beside the
   staged/unstaged ones (diff:<root>:r:<base>:<path>). */
export type ShownDiff = { rootId: string; path: string; staged: boolean; base?: string } | null;

const diffId = (rootId: string, path: string, staged: boolean, base = "") =>
  base ? `diff:${rootId}:r:${base}:${path}` : `diff:${rootId}:${staged ? "s" : "u"}:${path}`;

/* What the shell can be asked for from inside a panel's own menu — the board's
   empty space, a stripe's icon. The same verbs the header MENU has, so a
   right-click on nothing in particular is not a dead end. */
export type ShellActions = {
  newSession: () => void;
  newShell: () => void;
  templates: () => void;
  resetLayout: () => void;
};

// Which tool is showing at each edge; null where the edge is hidden or empty.
export type ShownTools = Record<Edge, ToolId | null>;

/* The panel in front of main, for the status bar's breadcrumb: its id, its
   title and what it was opened on. id "" when main is empty. */
export type FrontPanel = { id: string; title: string; params: Record<string, unknown> };
const NONE_SHOWN: ShownTools = { left: null, right: null, bottom: null };

type DockData = {
  tiles: Tile[];
  shown: Tile[];
  here: string;
  connected: boolean;
  // What the tools in COUNTED count.
  counts: Partial<Record<ToolId, number>>;
  /* The active document panel, whatever kind it is — never a tool: a tool in
     front is not where the work is. */
  activeId: string;
  /* The project the tools follow: the session that came to the front last,
     or the folder picked in the project switch, whichever came later — see
     lib/project.ts. Focusing the editor, the changes or the usage panel does
     not move it. On a restore a session's id arrives before the session does:
     a follower has to tolerate that, and never blank or close itself over it. */
  project: Project;
  editorTarget: EditorTarget;
  /* The diff that was opened last, while its panel is open — so the row it
     came from stays lit in the changes list, and goes dark when the panel
     closes, whichever way it is closed. */
  shownDiff: ShownDiff;
  openSession: (id: string) => void;
  openPreview: (url: string, title: string) => void;
  openDiff: (rootId: string, path: string, staged: boolean, title: string, base?: string) => void;
  onDiffClosed: (rootId: string, path: string, staged: boolean, base?: string) => void;
  // A document of main, opened or brought forward; opening one never hides it.
  openDoc: (id: DocId) => void;
  // The ⌘K palette, asked for by main when there is nothing in it.
  openPalette: () => void;
  /* The tools: which one shows at each edge, and the ways to reach one — a
     click that toggles, a request that only ever shows, a hide for an edge. */
  shownTools: ShownTools;
  toggleTool: (id: ToolId) => void;
  revealTool: (id: ToolId) => void;
  hideEdge: (edge: Edge) => void;
  /* His placement of the tools, and the two ways to change it from a menu: a
     tool put on another edge, and every tool back where it started. */
  toolLayout: ToolLayout;
  moveTool: (id: ToolId, to: Edge, index: number) => void;
  resetTools: () => void;
  /* The shell's own verbs, for the menus on the board and the stripes. */
  shell?: ShellActions;
  /* What the settings' layouts page can do — the shell owns the dialogs
     behind it, the dock only hands it to the panel that draws it. */
  layouts: LayoutControls;
  /* An editor for one file, as a panel beside the session — one panel per
     path, so every file keeps its own undo history. `path` is the path the
     tree reports for the file, which is what the file API reads. `from` is the
     id of the panel it was opened from, so the editor stands beside that
     panel instead of over it. */
  openEditor: (rootId: string, path: string, line?: number, title?: string, from?: string) => void;
  /* Whether an editor panel holds unsaved edits, by panel id — written by the
     editor as that changes, read by its tab, so the tab's close cannot throw
     them away without a word. */
  setDirty: (panelId: string, dirty: boolean) => void;
  isDirty: (panelId: string) => boolean;
  onReplaced: (id: string) => void;
  /* The one way a panel is closed by hand — the tab's ✕, its menu, ⌘W: the
     guard asks first when something would be lost, and says what came of it.
     A tool is never closed: asked to close one, the guard hides it. */
  requestClose: (panel: IDockviewPanel) => Promise<CloseResult>;
  /* Several at once, one guard after the other; a cancel stops the run. */
  closeMany: (panels: IDockviewPanel[]) => void;
  /* A plain shell in the project's folder, opened as a session panel of its
     own — the home directory when there is no project. */
  newShell: () => void;
};

/* What a guarded close came to: the panel is gone, it stayed because its
   guard took over (a dirty editor comes to the front instead), or the user
   said no. */
export type CloseResult = "closed" | "kept" | "cancelled";

/* A panel closed by hand, kept so it can be opened again. Only what the
   hand-close path closes lands here — a layout rebuilt is not somebody closing
   a panel, and would bury the one they did close under a dozen they did not.
   A tool never does: it is not closed, only hidden. */
type ClosedPanel = { id: string; component: string; title: string; params: object };

const Ctx = createContext<DockData | null>(null);
const useDock = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("a dock panel was rendered outside the dock");
  return v;
};

// The panels, each reading the live data from the context.
function OverviewPanel() {
  const d = useDock();
  return (
    <Overview
      tiles={d.shown}
      onOpen={d.openSession}
      onNew={d.shell?.newSession}
      onNewShell={d.shell?.newShell}
      onTemplates={d.shell?.templates}
    />
  );
}
function InboxPanel() {
  const d = useDock();
  return <Inbox tiles={d.tiles} onOpen={d.openSession} />;
}
/* A file picked in its tree opens beside the view, never over it: the panel
   says who it is, so the editor knows which group to stand next to. */
function FoldersPanel(props: IDockviewPanelProps) {
  const d = useDock();
  return <Folders place={d.here} onOpenFile={(rootId, path, line) => d.openEditor(rootId, path, line, undefined, props.api.id)} />;
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
function NotesPanel() {
  return <Notes />;
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
        onOpenFile={(path, line, rootId) => d.openEditor(rootId ?? tile.id, path, line, undefined, props.api.id)}
        /* The changes follow the session focused last, and the click that
           asks for them lands in this panel — so it is this session's folder
           the tool comes up on. */
        onChanges={() => d.revealTool("changes")}
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
        <Button onClick={() => d.revealTool("archive")}>{tr("tool.archive", "Archive")}</Button>
        <Button onClick={onClose}>{tr("common.close", "CLOSE")}</Button>
      </span>
      {restartError ? <span className="notice warn">{restartError}</span> : null}
    </div>
  );
}

function PreviewPanel(props: IDockviewPanelProps<{ url: string }>) {
  return <Preview url={props.params.url} />;
}

/* What a project tool says it follows: a session by its name, a session not
   known yet by its id, a picked folder by the folder's own name. */
function followLabel(project: Project, followed: Tile | undefined, gone: boolean): string | undefined {
  if (followed) return followed.name || followed.cwd;
  if (project.sessionId) return gone ? undefined : project.sessionId;
  return projectLabel(project) || undefined;
}

/* The one changes panel follows the project: the session that came to the
   front last, or the folder picked in the project switch, whichever came
   later (lib/project.ts). A session is followed by its id — a git id as far
   as the service is concerned — and a picked folder by its path. */
function ChangesDockPanel() {
  const d = useDock();
  const id = d.project.sessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  /* A session the service no longer knows — plxr was restarted since this
     layout was saved — cannot be followed, and is not: the panel falls back
     to the project's folder rather than reading for ever. Only once the
     tiles are connected, though; before that the session is merely not here
     yet, and the panel's own debounce rides over the moment. */
  const gone = Boolean(id) && d.connected && !followed;
  const folder = d.project.path || d.here;
  return (
    <ChangesPanel
      here={folder}
      sessionId={gone ? undefined : id || undefined}
      label={followLabel(d.project, followed, gone)}
      shown={d.shownDiff}
      onDiff={d.openDiff}
      onEdit={(rootId, path) => d.openEditor(rootId, path)}
      /* The file tree is a tool of its own now, and it follows the same
         project the changes do — so this shows it rather than opening a
         second tree. */
      onOpenFiles={() => d.revealTool("files")}
    />
  );
}

/* The review panel follows the project the changes panel follows, with the
   same tolerance for a session the service does not know yet or any more.
   A file opens as a range diff — the working tree against the branch's
   merge-base — beside the terminal. */
function ReviewDockPanel() {
  const d = useDock();
  const id = d.project.sessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  const gone = Boolean(id) && d.connected && !followed;
  return (
    <ReviewPanel
      here={d.project.path || d.here}
      sessionId={gone ? undefined : id || undefined}
      label={followLabel(d.project, followed, gone)}
      shown={d.shownDiff}
      onDiff={d.openDiff}
      onEdit={(rootId, path) => d.openEditor(rootId, path)}
    />
  );
}

/* The one search panel follows the same project the changes panel does, with
   the same tolerance for a session the service does not know yet or any
   more. A hit opens the editor at its line, beside the terminal. */
function SearchDockPanel() {
  const d = useDock();
  const id = d.project.sessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  const gone = Boolean(id) && d.connected && !followed;
  return (
    <SearchPanel
      here={d.project.path || d.here}
      sessionId={gone ? undefined : id || undefined}
      label={followLabel(d.project, followed, gone)}
      onOpen={(rootId, path, line) => d.openEditor(rootId, path, line)}
    />
  );
}

/* The file tree as a tool: the project's — the session that came to the front
   last or the folder picked at the top, whichever came later — with the same
   tolerance for a session that has not loaded yet or is gone. A file picked in
   it opens in main, never in the tool's own window. */
function FilesToolPanel() {
  const d = useDock();
  const id = d.project.sessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  const gone = Boolean(id) && d.connected && !followed;
  if (id && !followed && !gone) {
    return (
      <div className="emptyNote">
        <b>{tr("dock.sessionLoading", "opening…")}</b>
      </div>
    );
  }
  const folder = d.project.path || d.here;
  const rootId = followed ? followed.id : folder ? `dir:${folder}` : "";
  const root = followed ? followed.cwd : folder;
  if (!rootId) {
    return <div className="emptyNote">{tr("tool.noFolder", "No folder to show: open a session, or pick a project in the project switch at the top.")}</div>;
  }
  return (
    <div className="filesPanel">
      <Files rootId={rootId} root={root} memory="files" onPick={(path, baseId) => d.openEditor(baseId, path, undefined, undefined, "files")} />
    </div>
  );
}

function DiffPanel(props: IDockviewPanelProps<{ rootId: string; path: string; staged: boolean; base?: string }>) {
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
        base={p.base}
        onClose={() => {
          d.onDiffClosed(p.rootId, p.path, p.staged, p.base);
          props.api.close();
        }}
        onEdit={(path, line) => d.openEditor(p.rootId, path, line || undefined, undefined, props.api.id)}
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
        onCaret={(c) => setCaret(props.api.id, c)}
      />
    </div>
  );
}

/* The tab of every panel: its title, a close that asks first, and a menu.
 *
 * Dockview's own tab closes the panel outright and offers no way to be asked
 * first, so an editor with edits in it was gone on a click, edits and all, and
 * a terminal with a process in it the same. This tab hands the close to the
 * dock's guard, which asks when something would be lost. Right-click opens the
 * window's own menu with what a tab can do: close, close the others, close the
 * group, float or dock, split, maximise, copy the title. The middle button
 * closes, the way tabs close everywhere else. */
/* The mark a tab wears.
 *
 * A view carries its stripe's icon, so one thing is one icon wherever it is
 * met; a session the terminal it is; a document the icon of what it is, from
 * the same table the file tree uses. The kind travels beside it as an
 * attribute, because the colour of a mark is the skin's business — and the
 * kinds are the values the stylesheets address, so they stay what they were. */
const FILE_KINDS: Record<string, string> = {
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  go: "code",
  py: "code",
  rs: "code",
  sh: "code",
  css: "style",
  html: "style",
  json: "data",
  yml: "data",
  yaml: "data",
  sql: "data",
  md: "text",
  txt: "text",
};

function tabMark(id: string): { icon: IconName; kind: string } {
  if (id.startsWith("session:")) return { icon: "terminal", kind: "session" };
  if (id.startsWith("diff:")) return { icon: "diff", kind: "diff" };
  if (id.startsWith("preview:")) return { icon: "preview", kind: "preview" };
  if (id.startsWith("editor:")) {
    const path = id.slice("editor:".length);
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return { icon: fileIcon(path), kind: FILE_KINDS[ext] ?? "plain" };
  }
  const named = isTool(id) || Object.prototype.hasOwnProperty.call(DOCS, id);
  return { icon: named ? viewDef(id as ToolId | DocId).icon : "file", kind: "view" };
}

function PanelTab(props: IDockviewPanelHeaderProps) {
  const d = useDock();
  const ctx = useContextMenu();
  const dv = props.containerApi;
  const id = props.api.id;
  /* A tool's tab is never on screen — its window's header takes its place —
     but an old layout can show one for a moment before the tools are put on
     their edges, and that tab must not close anything. */
  const tool = isTool(id);
  const title = props.api.title ?? id;
  const here = () => dv.getPanel(id);
  const bell = useBellMark(id, props.api);

  /* Built when the menu is asked for, not when the tab renders: whether the
     panel is floating or alone in its group is read at that moment. */
  const items = (): MenuItem[] => {
    const p = here();
    if (!p || tool) return [];
    const floating = p.api.location.type === "floating";
    const others = p.group.panels.filter((o) => o.id !== id);
    return [
      { label: tr("tab.close", "Close"), onClick: () => void d.requestClose(p), hint: caption(bindingOf("closePanel")) },
      { label: tr("tab.closeOthers", "Close others in group"), onClick: () => d.closeMany(others), disabled: others.length === 0 },
      { label: tr("tab.closeGroup", "Close group"), onClick: () => d.closeMany([...p.group.panels]) },
      { separator: true },
      floating
        ? { label: tr("tab.dock", "Dock"), onClick: () => dockPanel(dv, p) }
        : { label: tr("tab.float", "Float"), onClick: () => floatPanel(dv, p) },
      { separator: true },
      { label: tr("tab.splitRight", "Split to the right"), onClick: () => splitPanel(dv, p, "right"), disabled: floating || p.group.panels.length < 2 },
      { label: tr("tab.splitDown", "Split downwards"), onClick: () => splitPanel(dv, p, "bottom"), disabled: floating || p.group.panels.length < 2 },
      { separator: true },
      /* One panel over the whole window and back — for reading a long diff or
         a terminal that needs the width, without hiding every tool by hand and
         bringing them back again. Double-clicking the tab does the same. */
      p.api.isMaximized()
        ? { label: tr("tab.restore", "Restore size"), onClick: () => toggleMaximize(p) }
        : { label: tr("tab.maximize", "Maximise"), onClick: () => toggleMaximize(p), disabled: floating },
      { separator: true },
      { label: tr("tab.copyTitle", "Copy title"), onClick: () => void navigator.clipboard?.writeText(title).catch(() => undefined) },
    ];
  };

  const mark = tabMark(id);
  return (
    <div
      className="panelTab"
      data-bell={bell ? "yes" : "no"}
      data-kind={mark.kind}
      data-dirty={d.isDirty(id) ? "yes" : "no"}
      onContextMenu={(e) => ctx(items())(e)}
      onDoubleClick={(e) => {
        if (tool) return;
        e.preventDefault();
        const p = here();
        if (p && p.api.location.type === "grid") toggleMaximize(p);
      }}
      onAuxClick={(e) => {
        if (e.button !== 1 || tool) return;
        e.preventDefault();
        const p = here();
        if (p) void d.requestClose(p);
      }}
    >
      <span className="panelTabIcon" aria-hidden="true"><Icon name={mark.icon} /></span>
      <span className="panelTabName">{title}</span>
      {/* The mark itself stays out of the title text: nothing that reads tab
          titles finds a dot appended to it. */}
      <span className="sessionTabBell" aria-hidden="true" />
      {/* The close is the pack's own close icon, which carries no text: a tab's
          text is its title, and everything that reads tab titles — the gates,
          the layout's own bookkeeping — must not find a ✕ appended to it. When
          it is drawn, and the dot for unsaved work in its place, is the
          stylesheets' business; the square it sits in is always there, so a
          title never moves. A tool has no close at all. */}
      {tool ? null : (
        <Button
          bare
          className="panelTabClose"
          aria-label={tr("common.close", "CLOSE")}
          onClick={(e) => {
            e.stopPropagation();
            const p = here();
            if (p) void d.requestClose(p);
          }}
        >
          <Icon name="close" />
        </Button>
      )}
    </div>
  );
}

/* The bell mark on a session's tab: set when the terminal rang its bell
   while the panel was not in front.
 *
 * A BEL is a program asking for attention — a build that finished, a prompt
 * that came up — and in a panel behind three others it rang into the void.
 * The bell library keeps which sessions have rung and have not been looked at
 * since; the tab reads it here, and the mark goes when the panel comes to the
 * front. A panel that is not a session never rings. */
function useBellMark(panelId: string, api: IDockviewPanelHeaderProps["api"]): boolean {
  const id = panelId.startsWith("session:") ? panelId.slice("session:".length) : "";
  const [marked, setMarked] = useState(() => (id ? hasBell(id) : false));
  useEffect(() => {
    if (!id) return;
    // A panel already in front has been looked at: its flash is enough.
    const follow = () => {
      if (api.isActive) clearBell(id);
      setMarked(hasBell(id));
    };
    window.addEventListener(BELL_CHANGED, follow);
    const active = api.onDidActiveChange((e) => {
      if (e.isActive) clearBell(id);
    });
    return () => {
      window.removeEventListener(BELL_CHANGED, follow);
      active.dispose();
    };
  }, [id, api]);
  return marked;
}

/* The settings, as a panel. Its DONE closes the panel it is in, so the one
   button means the same thing wherever the settings are — in a floating group
   it closes the floating window, docked it closes the tab. */
function SettingsPanel(props: IDockviewPanelProps) {
  const d = useDock();
  return <Settings framed={false} layouts={d.layouts} openSession={d.openSession} onClose={() => props.api.close()} />;
}

/* Main with nothing in it. dockview draws this wherever the grid has no group
   left — the tool windows at the edges do not count — and a blank area is a
   dead end, so it offers the three ways to put something there: the board, a
   new session, and every command. */
function MainWatermark() {
  const d = useDock();
  const said = (label: string, chord: string) => (chord ? `${label} ${chord}` : label);
  return (
    <div className="emptyNote mainWatermark">
      <b>{tr("watermark.empty", "Nothing is open here")}</b>
      <span className="rowInline">
        <Button data-do="watermark-board" onClick={() => d.openDoc("overview")}>
          {said(tr("watermark.board", "Board"), chordOf("overview"))}
        </Button>
        <Button data-do="watermark-new" onClick={() => d.shell?.newSession()}>
          {said(tr("watermark.newSession", "New session"), caption(bindingOf("newSession")))}
        </Button>
        <Button data-do="watermark-commands" onClick={d.openPalette}>
          {said(tr("watermark.commands", "Commands"), caption(bindingOf("palette")))}
        </Button>
      </span>
    </div>
  );
}

/* A tool's panel: the tool under its window's header. Whether it is the one
   showing decides whether its body is rendered at all. */
function tool(id: ToolId, Body: () => ReactNode) {
  function ToolPanel() {
    const d = useDock();
    const edge = EDGES.find((e) => d.shownTools[e] === id) ?? null;
    const home = edge ?? edgeOf(d.toolLayout, id);
    return (
      <ToolWindow
        id={id}
        edge={home}
        lit={edge !== null}
        onHide={() => edge && d.hideEdge(edge)}
        moreRows={(hide) => [...moveRows(id, d.toolLayout, d.moveTool), { separator: true }, hide, resetRow(d.resetTools)]}
      >
        <Body />
      </ToolWindow>
    );
  }
  return ToolPanel;
}

/* Every tool and document of the registry has its component here, under its
   own id — the compiler holds that below. */
const components = {
  overview: OverviewPanel,
  preview: PreviewPanel,
  diff: DiffPanel,
  editor: EditorPanel,
  settings: SettingsPanel,
  folders: FoldersPanel,
  session: SessionPanel,
  files: tool("files", FilesToolPanel),
  changes: tool("changes", ChangesDockPanel),
  review: tool("review", ReviewDockPanel),
  search: tool("search", SearchDockPanel),
  inbox: tool("inbox", InboxPanel),
  usage: tool("usage", UsagePanel),
  ports: tool("ports", PortsPanel),
  archive: tool("archive", ArchivePanel),
  notes: tool("notes", NotesPanel),
} satisfies Record<ToolId | DocId, unknown> & Record<string, unknown>;

/* The tools and documents that open by name, in the order the palette offers
   them, each with the title its tab starts with, read from the registry. */
const PANEL_VIEWS: (ToolId | DocId)[] = ["settings", "overview", "inbox", "folders", "files", "ports", "usage", "archive", "changes", "search", "notes", "review"];
export const VIEW_TITLES: Record<string, string> = Object.fromEntries(PANEL_VIEWS.map((id) => [id, viewDef(id).fallback]));

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

/* A change asked for from outside the dock: a tool — toggled by a click, shown
   by a request, or reached by its chord — a document of main, or a session. */
export type Focus =
  | { kind: "tool"; id: ToolId; how: "toggle" | "reveal" | "chord" }
  | { kind: "doc"; id: DocId }
  | { kind: "session"; id: string; name: string }
  | null;

/* What the shell asks of the dock, imperatively. One channel for everything
   that used to be a nonce per verb: `seq` makes each request new, `type` says
   what it is. */
export type LayoutRequest =
  | { type: "reset" }
  | { type: "apply"; arg: object }
  | { type: "save"; arg: string }
  | { type: "activity"; arg: Activity }
  /* Not arrangements, but asked the same way — from the MENU and the keys,
     which live in the shell while what they need (the focused session, the
     overview panel) lives in the dock. */
  | { type: "newShell" }
  | { type: "grid" }
  // An edge shown or hidden from the top bar, the way its key does it.
  | { type: "toggleEdge"; arg: Edge }
  // Every tool back where it started, from the palette.
  | { type: "resetTools" };
export type LayoutAction = LayoutRequest & { seq: number };

/* Every tab is the PanelTab. "editorTab" and "sessionTab" stay as names
   because a layout saved before every panel had the guarded tab carries them
   per panel, and a name dockview cannot resolve would drop the panel on
   restore. */
const tabComponents = { editorTab: PanelTab, sessionTab: PanelTab };

export default function Dock({
  tiles,
  shown,
  here,
  project,
  onSessionFront,
  connected,
  counts,
  openSession,
  onReplaced,
  shell,
  layouts,
  focus,
  layoutAction,
  onLayoutSaved,
  appCommands,
  paletteOpen,
  onClosePalette,
  onToolsChanged,
  onOpenPalette,
  onFront,
  paletteText = "",
}: Omit<
  DockData,
  | "openPreview"
  | "openDiff"
  | "onDiffClosed"
  | "openDoc"
  | "openPalette"
  | "shownTools"
  | "toggleTool"
  | "revealTool"
  | "hideEdge"
  | "toolLayout"
  | "moveTool"
  | "resetTools"
  | "openEditor"
  | "activeId"
  | "editorTarget"
  | "shownDiff"
  | "setDirty"
  | "isDirty"
  | "requestClose"
  | "closeMany"
  | "newShell"
> & {
  focus: Focus;
  /* A session panel came to the front: the shell's project follows it. */
  onSessionFront: (id: string) => void;
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
  /* Which tool shows at each edge, whenever that changes — for the shell's
     MENU to tick the ones that show. */
  onToolsChanged?: (shown: ShownTools) => void;
  /* The palette is the shell's; main asks for it when it is empty. */
  onOpenPalette: () => void;
  /* The panel that came to the front of main, whenever that changes — a
     tool coming forward is not one — for the status bar. */
  onFront?: (front: FrontPanel) => void;
  /* What the palette opens on: the text typed into the top bar's search. */
  paletteText?: string;
}) {
  const apiRef = useRef<DockviewApi | null>(null);
  const hostRef = useRef<ToolHost | null>(null);
  // His placement of the tools, read from prefs when the dock comes up: a ref
  // for the verbs, which read it when they run, and state for the stripes.
  const layoutRef = useRef<ToolLayout>(defaultToolLayout());
  const [toolLayout, setToolLayout] = useState<ToolLayout>(layoutRef.current);
  // The element the dock is laid out in: the tool windows and main together.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const saveRef = useRef<() => void>(() => undefined);
  const restored = useRef(false);
  const activity = useRef<Activity>("focus");
  const [activeId, setActiveId] = useState("overview");
  // Called from onReady, which dockview calls once: the newest callback, through a ref.
  const sessionFrontRef = useRef(onSessionFront);
  sessionFrontRef.current = onSessionFront;
  const frontRef = useRef(onFront);
  frontRef.current = onFront;
  const [editorTarget, setEditorTarget] = useState<EditorTarget>(null);
  const [shownDiff, setShownDiff] = useState<ShownDiff>(null);
  const [shownTools, setShownTools] = useState<ShownTools>(NONE_SHOWN);
  // The session in the active panel, for the service: a notification about
  // it is held back while this page has focus. Not the sticky last session —
  // with the editor in front, the session beside it is not being looked at.
  useEffect(() => {
    showFront(activeId.startsWith("session:") ? activeId.slice("session:".length) : "");
  }, [activeId]);

  /* The tool verbs, over whatever host the dock has once it is ready. An edge
     asked to show with nothing on it says so on its stripe, for a moment. */
  const [flashing, setFlashing] = useState<Edge | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((edge: Edge) => {
    window.clearTimeout(flashTimer.current);
    setFlashing(edge);
    flashTimer.current = window.setTimeout(() => setFlashing(null), 600);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  /* A new placement is his: kept for the stripes and the verbs, and written
     down — null for the one he started with — so it survives a reload and a
     second window takes it up. What this window wrote lately is remembered for
     a few seconds, so its own write coming back late is not taken for somebody
     else's. */
  const written = useRef<{ json: string; at: number }[]>([]);
  const keepLayout = useCallback((next: ToolLayout | null) => {
    const placed = next ?? defaultToolLayout();
    layoutRef.current = placed;
    setToolLayout(placed);
    const now = Date.now();
    written.current = [...written.current.filter((w) => now - w.at < 5000), { json: JSON.stringify(placed), at: now }];
    void api.setPrefs({ toolLayout: next }).catch(() => undefined);
  }, []);
  const ops = useMemo(() => toolOps(() => hostRef.current, () => layoutRef.current, flash, keepLayout), [flash, keepLayout]);

  /* Two windows, one placement. Another window moved a tool: this one takes
     the new placement up and puts its tools where it says, and a tool showing
     here keeps showing, on its new edge — which tools are open stays each
     window's own. Not while an icon is being carried here. */
  useEffect(() => {
    const onPrefs = (e: Event) => {
      const prefs = ((e as CustomEvent).detail ?? {}) as Record<string, unknown>;
      const next = normalizeToolLayout(prefs.toolLayout);
      const json = JSON.stringify(next);
      if (json === JSON.stringify(layoutRef.current)) return;
      const now = Date.now();
      if (written.current.some((w) => w.json === json && now - w.at < 5000)) return;
      if (document.body.dataset.draggingTool === "yes") return;
      layoutRef.current = next;
      setToolLayout(next);
      const host = hostRef.current;
      if (host) followLayout(host, next);
    };
    window.addEventListener(PREFS_CHANGED, onPrefs);
    return () => window.removeEventListener(PREFS_CHANGED, onPrefs);
  }, []);
  const hideEdge = useCallback((edge: Edge) => hostRef.current?.hide(edge), []);
  const toolsChangedRef = useRef(onToolsChanged);
  toolsChangedRef.current = onToolsChanged;
  useEffect(() => {
    toolsChangedRef.current?.(shownTools);
  }, [shownTools]);

  const openPreview = useCallback((url: string, title: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, `preview:${url}`, "preview", title, { url });
  }, []);

  const openDiff = useCallback((rootId: string, path: string, staged: boolean, title: string, base = "") => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, diffId(rootId, path, staged, base), "diff", title, { rootId, path, staged, base });
    setShownDiff({ rootId, path, staged, base });
  }, []);

  // Only the diff that is lit goes dark — a stale close must not unlight a
  // newer one.
  const onDiffClosed = useCallback((rootId: string, path: string, staged: boolean, base = "") => {
    setShownDiff((s) => (s && s.rootId === rootId && s.path === path && s.staged === staged && (s.base ?? "") === base ? null : s));
  }, []);

  const openDoc = useCallback((id: DocId) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, id, id, VIEW_TITLES[id] ?? id, {});
  }, []);

  // The newest callback, through a ref: the shell hands a new one every render.
  const paletteRef = useRef(onOpenPalette);
  paletteRef.current = onOpenPalette;
  const openPalette = useCallback(() => paletteRef.current(), []);

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
  const rootDirRef = useRef({ tiles, here, project });
  rootDirRef.current = { tiles, here, project };

  // Unsaved edits per editor panel: a ref, because it is read at the moment a
  // tab is clicked and never needs a render of its own.
  const dirtyRef = useRef(new Map<string, boolean>());
  const setDirty = useCallback((panelId: string, dirty: boolean) => {
    if (dirty) dirtyRef.current.set(panelId, true);
    else dirtyRef.current.delete(panelId);
  }, []);
  const isDirty = useCallback((panelId: string) => dirtyRef.current.get(panelId) === true, []);

  /* Where the work has been.
   *
   * Following a diff into an editor and the editor into a terminal left no way
   * back but finding the tab again. Every document that comes to the front is
   * written down; back and forward walk that list the way a browser does, and
   * a panel that has been closed since is stepped over rather than reopened.
   * A tool never enters it: showing the usage is not a place the work was. */
  const history = useRef<{ back: string[]; forward: string[]; moving: boolean }>({ back: [], forward: [], moving: false });
  const stepHistory = useCallback((dir: -1 | 1) => {
    const dv = apiRef.current;
    if (!dv) return;
    const h = history.current;
    const bring = (id: string) => {
      const p = dv.getPanel(id);
      if (!p) return;
      if (dv.activePanel?.id !== id) h.moving = true;
      p.api.setActive();
    };
    if (dir < 0) {
      let i = h.back.length - 2;
      while (i >= 0 && !dv.getPanel(h.back[i])) i--;
      if (i < 0) return;
      const left = h.back.splice(i + 1).filter((id) => dv.getPanel(id));
      h.forward.push(...left.reverse());
      bring(h.back[i]);
      return;
    }
    while (h.forward.length) {
      const next = h.forward.pop() as string;
      if (!dv.getPanel(next)) continue;
      h.back.push(next);
      bring(next);
      return;
    }
  }, []);

  /* Recently closed.
   *
   * ⌘W on the wrong tab used to be final: the panel, and for an editor or a
   * diff which file it was on, all gone. The last twenty panels closed by hand
   * are remembered, ⇧⌘T opens the last one again, and the palette lists them. */
  /* Bookkeeping rather than an answer from anywhere, so it lives in a ref and a
     revision number tells the palette when it changed. */
  const closedRef = useRef<ClosedPanel[]>([]);
  const [closedRev, setClosedRev] = useState(0);
  const setClosed = useCallback((next: (list: ClosedPanel[]) => ClosedPanel[]) => {
    closedRef.current = next(closedRef.current);
    setClosedRev((n) => n + 1);
  }, []);
  const remember = useCallback((panel: IDockviewPanel) => {
    const id = panel.id;
    const entry: ClosedPanel = {
      id,
      component: id.includes(":") ? id.slice(0, id.indexOf(":")) : id,
      title: panel.title ?? id,
      params: (panel.params ?? {}) as object,
    };
    setClosed((list) => [entry, ...list.filter((c) => c.id !== id)].slice(0, 20));
  }, [setClosed]);
  const reopen = useCallback((id?: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    const list = closedRef.current;
    const entry = id ? list.find((c) => c.id === id) : list.find((c) => !dv.getPanel(c.id));
    if (!entry) return;
    openOrFocus(dv, entry.id, entry.component, entry.title, entry.params);
    setClosed((l) => l.filter((c) => c.id !== entry.id));
  }, [setClosed]);

  /* The close guard.
   *
   * A session panel whose process is alive is asked about: keep it running
   * and close only the panel (it stays on the board), terminate it, or leave
   * everything as it is. An editor with unsaved edits is not asked here — it
   * comes to the front, where its own CLOSE says what is at stake and offers
   * SAVE, DISCARD or CANCEL. A tool is never closed: it is hidden, and its mark
   * stays where it was. Anything else just goes. One question at a time: the
   * dialog holds the answer's resolver. */
  const [closeAsk, setCloseAsk] = useState<{ name: string; answer: (r: "keep" | "kill" | "cancel") => void } | null>(null);
  const requestClose = useCallback((panel: IDockviewPanel): Promise<CloseResult> => {
    const id = panel.id;
    if (isTool(id)) {
      const host = hostRef.current;
      const edge = host?.edgeOf(id);
      if (host && edge) host.hide(edge);
      return Promise.resolve("kept");
    }
    if (id.startsWith("editor:") && dirtyRef.current.get(id) === true) {
      panel.api.setActive();
      return Promise.resolve("kept");
    }
    if (id.startsWith("session:")) {
      const sid = id.slice("session:".length);
      const tile = rootDirRef.current.tiles.find((t) => t.id === sid);
      if (tile?.alive) {
        panel.api.setActive();
        return new Promise<CloseResult>((resolve) => {
          setCloseAsk({
            name: tile.name || tile.cwd || sid,
            answer: (r) => {
              setCloseAsk(null);
              if (r === "cancel") return resolve("cancelled");
              if (r === "kill") void api.kill(sid).catch(() => undefined);
              remember(panel);
              panel.api.close();
              resolve("closed");
            },
          });
        });
      }
    }
    remember(panel);
    panel.api.close();
    return Promise.resolve("closed");
  }, []);
  const closeMany = useCallback(
    (panels: IDockviewPanel[]) => {
      void (async () => {
        for (const p of panels) {
          if ((await requestClose(p)) === "cancelled") break;
        }
      })();
    },
    [requestClose],
  );

  /* The dock's own keys, read against the keymap the way the shell reads its
     own: ⌘W closes the active panel through the guard, ⌥⌘←/→ walk the panels
     of the active group, ⌥⌘↑/↓ walk the groups of main, ⌘B ⌥⌘B ⌘J show or
     hide an edge. A field being typed in keeps its keys, and a dialog on
     screen has the keyboard to itself.
   *
   * With the keyboard in a tool window, ⇧⎋ and ⌘W put that window away and
   * its mark stays — from a field in it too, because that is where the
   * keyboard is in a tool. Anywhere else ⇧⎋ is not the dock's: a terminal
   * keeps it. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dv = apiRef.current;
      if (!dv) return;
      if (document.querySelector(".backdrop, .paletteScrim")) return;
      if (focusedTool() && (matches(e, "hideTool") || matches(e, "closePanel"))) {
        e.preventDefault();
        ops.hideFocusedTool();
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;
      const editing = target?.tagName === "TEXTAREA" || Boolean(target?.isContentEditable);
      const fire = (action: Action, run: () => void) => {
        if (!matches(e, action)) return false;
        if (editing && !hasModifier(bindingOf(action))) return false;
        e.preventDefault();
        run();
        return true;
      };
      if (
        fire("closePanel", () => {
          const p = dv.activePanel;
          if (p) void requestClose(p);
        })
      )
        return;
      if (fire("reopenPanel", () => reopen())) return;
      if (fire("historyBack", () => stepHistory(-1))) return;
      if (fire("historyForward", () => stepHistory(1))) return;
      if (fire("panelPrev", () => stepPanel(dv, -1))) return;
      if (fire("panelNext", () => stepPanel(dv, 1))) return;
      if (fire("groupPrev", () => stepGroup(dv, -1))) return;
      if (fire("groupNext", () => stepGroup(dv, 1))) return;
      if (fire("toggleLeft", () => ops.toggleEdge("left"))) return;
      if (fire("toggleRight", () => ops.toggleEdge("right"))) return;
      if (fire("toggleBottom", () => ops.toggleEdge("bottom"))) return;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose, reopen, stepHistory, ops]);

  const openEditor = useCallback((rootId: string, rawPath: string, line?: number, title?: string, from?: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    const { tiles: ts, here: h } = rootDirRef.current;
    const rootDir = ts.find((t) => t.id === rootId)?.cwd ?? (rootId.startsWith("dir:") ? rootId.slice("dir:".length) : h);
    let path = rawPath;
    if (rootDir && (rawPath === rootDir || rawPath.startsWith(rootDir + "/"))) path = rawPath.slice(rootDir.length + 1);
    const id = `editor:${rootId}:${path}`;
    const name = title || path.split("/").pop() || path;
    const origin = from ? dv.getPanel(from)?.group : undefined;
    const made = openOrFocus(dv, id, "editor", name, { rootId, path, line }, origin);
    // A panel that was already there keeps its frozen params; the line it is
    // asked for now goes through the context instead.
    if (!made && line) setEditorTarget((t) => ({ id, line, nonce: (t?.nonce ?? 0) + 1 }));
  }, []);

  /* New shell here.
   *
   * The folder is the project's — the session in front or the folder picked
   * at the top — read at call time through a ref, the way openEditor reads its
   * roots, so the callback stays stable. An empty folder lets the service
   * pick the home directory. An
   * empty command is a plain login shell. The panel opens on the stage beside
   * the session it was asked from, titled the way the service names it. */
  const newShell = useCallback(() => {
    const { here: h, project: pr } = rootDirRef.current;
    const cwd = pr.path || h || "";
    void api
      .create(cwd, [], "", "")
      .then((s) => {
        const dv = apiRef.current;
        if (!dv) return;
        openOrFocus(dv, `session:${s.id}`, "session", s.name || s.cwd.split("/").pop() || s.id, { id: s.id });
      })
      .catch(() => undefined);
  }, []);

  /* Go to file, from the palette: names under the project — the session in
     front, or the folder picked at the top — opened as an editor beside the
     work. A session the service does not know is searched as its folder. */
  const searchFiles = useCallback(
    async (q: string): Promise<Command[]> => {
      const { tiles: ts, here: h, project: pr } = rootDirRef.current;
      const tile = pr.sessionId ? ts.find((t) => t.id === pr.sessionId) : undefined;
      const folder = pr.path || h;
      const rootId = tile ? tile.id : folder ? `dir:${folder}` : "";
      if (!rootId) return [];
      const report = await api.names(rootId, q).catch(() => null);
      if (!report) return [];
      return report.paths.map((path) => ({
        id: `file:${rootId}:${path}`,
        group: tr("palette.file", "File"),
        label: path,
        run: () => openEditor(rootId, path),
      }));
    },
    [openEditor],
  );

  const data = useMemo<DockData>(
    () => ({
      tiles, shown, here, project, connected, counts, activeId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openDoc, openPalette, openEditor, setDirty, isDirty, onReplaced, shell, layouts,
      requestClose, closeMany, newShell, shownTools, toggleTool: ops.toggleTool, revealTool: ops.revealTool, hideEdge,
      toolLayout, moveTool: ops.moveTool, resetTools: ops.resetTools,
    }),
    [
      tiles, shown, here, project, connected, counts, activeId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openDoc, openPalette, openEditor, setDirty, isDirty, onReplaced, shell, layouts,
      requestClose, closeMany, newShell, shownTools, ops, hideEdge, toolLayout,
    ],
  );

  const commands = useMemo<Command[]>(() => {
    const views: Command[] = Object.entries(VIEW_TITLES).map(([id, title]) => ({
      id: `view:${id}`,
      group: tr("palette.view", "View"),
      label: tr("palette.openThing", "Open {name}", { name: title }),
      run: () => (isTool(id) ? ops.revealTool(id) : openDoc(id as DocId)),
    }));
    const sessions: Command[] = tiles.flatMap((t) => {
      const name = t.name || t.id;
      const rows: Command[] = [
        { id: `open:${t.id}`, group: tr("palette.session", "Session"), label: tr("palette.openThing", "Open {name}", { name }), run: () => openSession(t.id) },
        {
          id: `files:${t.id}`,
          group: tr("palette.session", "Session"),
          label: tr("palette.filesOf", "Files of {name}", { name }),
          // The tree follows the session in front, so the session comes first.
          run: () => {
            openSession(t.id);
            ops.revealTool("files");
          },
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
    const recent: Command[] = closedRef.current.slice(0, 10).map((c, i) => ({
      id: `reopen:${c.id}`,
      group: tr("palette.recent", "Recently closed"),
      label: tr("palette.reopen", "Reopen {name}", { name: c.title }),
      hint: i === 0 ? caption(bindingOf("reopenPanel")) : undefined,
      run: () => reopen(c.id),
    }));
    const moves: Command[] = [
      { id: "nav:back", group: tr("palette.action", "Action"), label: tr("keys.historyBack", "Back to the panel that was in front before"), hint: caption(bindingOf("historyBack")), run: () => stepHistory(-1) },
      { id: "nav:forward", group: tr("palette.action", "Action"), label: tr("keys.historyForward", "Forward again"), hint: caption(bindingOf("historyForward")), run: () => stepHistory(1) },
    ];
    return [...appCommands, ...moves, ...recent, ...views, ...sessions];
    // closedRev is read for its change, not its value: the list sits in the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appCommands, tiles, openDoc, openSession, ops, closedRev, reopen, stepHistory]);

  /* What the shell asks for: a reset, a preset to apply, a name to save the
     arrangement under, or an activity to arrange for. Each request is new by
     its seq; the initial null is not a request. */
  useEffect(() => {
    const dv = apiRef.current;
    const host = hostRef.current;
    if (!dv || !host || !layoutAction) return;
    switch (layoutAction.type) {
      case "reset":
        rebuild(dv, host, activity.current, layoutRef.current);
        saveRef.current();
        break;
      case "activity":
        activity.current = layoutAction.arg;
        void api.setPrefs({ dockActivity: layoutAction.arg }).catch(() => undefined);
        rebuild(dv, host, layoutAction.arg, layoutRef.current);
        saveRef.current();
        break;
      case "apply":
        loadArrangement(dv, host, layoutAction.arg, layoutRef.current, activity.current);
        saveRef.current();
        break;
      case "save":
        onLayoutSaved(layoutAction.arg, dv.toJSON());
        break;
      case "newShell":
        newShell();
        break;
      case "grid":
        // The overview, packed tight: the density is announced first, so the
        // panel comes up dense rather than switching after it has drawn.
        setDense(true);
        openDoc("overview");
        break;
      case "toggleEdge":
        ops.toggleEdge(layoutAction.arg);
        break;
      case "resetTools":
        ops.resetTools();
        break;
    }
    // onLayoutSaved is the shell's; only a new action is a reason to act.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutAction]);

  /* The state on the tab. A session panel's tab is named when it opens and
     never heard from the tiles again; it said "plxr3" while the agent inside
     was waiting for an answer. Kept current here, from every snapshot, so the
     tab strip reads like the session switch does. */
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

  // Open, show or focus whatever the shell asked for.
  useEffect(() => {
    const dv = apiRef.current;
    if (!dv || !focus) return;
    if (focus.kind === "tool") {
      if (focus.how === "toggle") ops.toggleTool(focus.id);
      else if (focus.how === "chord") ops.chordTool(focus.id);
      else ops.revealTool(focus.id);
    } else if (focus.kind === "doc") {
      openDoc(focus.id);
    } else {
      openOrFocus(dv, `session:${focus.id}`, "session", focus.name || focus.id, { id: focus.id });
    }
  }, [focus, ops, openDoc]);

  // Nothing is measured against the frame after the dock is gone.
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);

  function onReady(event: DockviewReadyEvent) {
    const dv = event.api;
    apiRef.current = dv;
    const host = edgeHost(dv, {
      size: (edge) => sizes.get(edge),
      px: cssPx,
      stray: (panel) => moveInto(dv, panel, placeDocument(dv, panel.id, undefined, panel.group)),
      main: () => lastGridGroup(dv),
    });
    hostRef.current = host;
    let ready = false;

    dv.onDidActivePanelChange((e) => {
      const panel = e.panel;
      // A tool in front is not where the work is, and not a place to go back to.
      if (panel && panel.group.api.location.type === "edge") return;
      const id = panel?.id ?? "";
      setActiveId(id);
      frontRef.current?.({ id, title: panel?.title ?? "", params: (panel?.params ?? {}) as Record<string, unknown> });
      if (id) {
        const h = history.current;
        if (h.moving) h.moving = false;
        else if (h.back[h.back.length - 1] !== id) {
          h.back.push(id);
          if (h.back.length > 50) h.back.shift();
          h.forward = [];
        }
      }
      // A session panel coming to the front moves the project; nothing else does.
      if (id.startsWith("session:")) sessionFrontRef.current(id.slice("session:".length));
    });
    // The group of main looked at last, and the documents group among them,
    // for the next panel to join.
    dv.onDidActiveGroupChange((g) => {
      if (!g || g.api.location.type !== "grid") return;
      lastGrid = g.id;
      if (holdsOnlyDocuments(g)) lastDocuments = g.id;
    });
    // A diff closed from its tab never passes through Difference's BACK, so
    // the lit row is put out here, for every way a panel can go.
    dv.onDidRemovePanel((p) => {
      if (p.id.startsWith("diff:")) setShownDiff((s) => (s && diffId(s.rootId, s.path, s.staged, s.base) === p.id ? null : s));
    });
    /* A document dragged onto a tool window is refused twice over: the edges
       are locked against drops, and should a drop get past that, it is vetoed
       here before dockview shows where it would land. */
    dv.onWillShowOverlay((e) => {
      if (e.group?.api.location.type === "edge") e.preventDefault();
    });
    dv.onWillDrop((e) => {
      if (e.group?.api.location.type === "edge") e.preventDefault();
    });

    /* The frame's bounds are re-asserted whenever a group comes or goes —
       a drag that makes a new group, a column that is closed. Guarded against
       its own echo: setting a size is itself a layout change. */
    let holding = false;
    const reassert = () => {
      if (holding) return;
      holding = true;
      try {
        hold(dv);
      } finally {
        window.setTimeout(() => {
          holding = false;
        }, 0);
      }
    };
    dv.onDidAddGroup(reassert);
    dv.onDidRemoveGroup(reassert);

    /* Save the arrangement whenever it changes — debounced, because a drag
       fires many times. dockview does not report an edge shown, hidden or
       dragged wider as a layout change, so the tool host's own changes feed
       the same save. Nothing is saved before the saved one has been loaded:
       an empty dock written back over it would lose it. */
    let timer: number | undefined;
    const save = () => {
      if (!ready) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        try {
          void api.setPrefs({ dock: dv.toJSON(), dockSizes: Object.fromEntries(sizes) }).catch(() => undefined);
        } catch {
          /* nothing to lose but the saved arrangement */
        }
      }, 400);
    };
    saveRef.current = save;
    dv.onDidLayoutChange(save);

    /* Main's floor. dockview lets the grid shrink under a tool window when the
       window is narrow, down to a hundred pixels of its own; so after every
       change of the frame the widest side gives way until main has the width
       the frame declares, and grows back towards the width he gave it once
       there is room again.
     *
     * What he gave it is what a sash was dragged to, and nothing else. Every
     * size change used to be written down, so a window made narrow and wide
     * again left both sides at their minimum: the floor had squeezed them, and
     * the squeeze was remembered as his. */
    let dragging = false;
    let queued = false;
    const clampSoon = () => {
      if (queued || !ready) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        if (!dragging) clampMain(host, boxRef.current, dv.minimumWidth);
      });
    };
    /* What main needs changes with main itself: two groups side by side each
       keep their own minimum. A split made while both sides were showing had
       no resize and no edge change after it to bring the floor round, and left
       the second group 247 pixels under the right tool window at 1100. So
       every change of main's layout is a reason to look at the floor again. */
    dv.onDidLayoutChange(clampSoon);
    host.onChange(() => {
      const now = shownOf(host);
      setShownTools((was) => (EDGES.every((e) => was[e] === now[e]) ? was : now));
      if (!ready) return;
      if (dragging) noteSizes(host);
      clampSoon();
      save();
    });
    const box = boxRef.current;
    if (box) {
      box.addEventListener(
        "pointerdown",
        (e) => {
          if ((e.target as Element | null)?.closest?.(".dv-sash")) dragging = true;
        },
        true,
      );
      const letGo = () => {
        if (!dragging) return;
        noteSizes(host);
        dragging = false;
        clampSoon();
        save();
      };
      window.addEventListener("pointerup", letGo, true);
      window.addEventListener("pointercancel", letGo, true);
      if (typeof ResizeObserver !== "undefined") {
        observer.current = new ResizeObserver(clampSoon);
        observer.current.observe(box);
      }
    }

    // Bring back the arrangement from last time; if there is none, or it does
    // not load, arrange for the chosen activity so the window is never blank.
    const finish = () => {
      ready = true;
      setShownTools(shownOf(host));
      clampSoon();
      save();
    };
    api
      .prefs()
      .then((raw) => {
        const p = raw as Record<string, unknown>;
        readSizes(p);
        const chosen = p.dockActivity;
        if (typeof chosen === "string" && (ACTIVITIES as string[]).includes(chosen)) activity.current = chosen as Activity;
        layoutRef.current = readToolLayout(p);
        setToolLayout(layoutRef.current);
        if (!restored.current) {
          restored.current = true;
          loadArrangement(dv, host, p.dock, layoutRef.current, activity.current);
        }
        finish();
      })
      .catch(() => {
        if (!restored.current) {
          restored.current = true;
          loadArrangement(dv, host, undefined, layoutRef.current, activity.current);
        }
        finish();
      });
  }

  return (
    <Ctx.Provider value={data}>
      <InlineStrip.Provider value={true}>
        {/* The stripes are the window's frame, not columns of the dock: a
            grid puts them at the left, at the right and along the bottom, and
            the dock between them holds the tool windows at its edges and main
            in the middle. dockview puts the dock's own class on main alone, so
            the box that holds all of it is a wrapper of its own. */}
        <div className="dockShell" data-bottom={toolLayout.order.bottom.length ? undefined : "empty"}>
          <Stripes
            layout={toolLayout}
            shown={shownTools}
            counts={counts}
            flash={flashing}
            onToggle={ops.toggleTool}
            onReveal={ops.revealTool}
            onHide={hideEdge}
            onMove={ops.moveTool}
            onResetTools={ops.resetTools}
          />
          <div className="dockHost" ref={boxRef}>
            <DockviewReact
              className="plxrDock"
              components={components}
              tabComponents={tabComponents}
              defaultTabComponent={PanelTab}
              watermarkComponent={MainWatermark}
              dndEdges={false}
              onReady={onReady}
            />
          </div>
        </div>
      </InlineStrip.Provider>
      {paletteOpen ? <CommandPalette commands={commands} search={searchFiles} initial={paletteText} onClose={onClosePalette} /> : null}
      {closeAsk ? (
        <Ask
          heading={tr("dock.closeLiveHead", "This session is still running")}
          detail={tr("dock.closeLiveDetail", "{name} keeps running if only the panel is closed — it stays on the board. Or terminate it now.", { name: closeAsk.name })}
          confirmLabel={tr("dock.keepRunning", "KEEP RUNNING")}
          third={{ label: tr("session.kill", "TERMINATE"), danger: true, onClick: () => closeAsk.answer("kill") }}
          onCancel={() => closeAsk.answer("cancel")}
          onConfirm={() => closeAsk.answer("keep")}
        />
      ) : null}
    </Ctx.Provider>
  );
}

/* ---------- arrangements ---------- */

/* LAYOUTS holds one builder per activity. Each opens the board in main and
   shows the tools the activity is about — each on whatever edge he has put it,
   so his placement wins over the activity's. 'focus' is the bare slate: the
   board and nothing beside it, and what a first start shows. */
const LAYOUTS: Record<Activity, (dv: DockviewApi, host: ToolHost) => void> = {
  focus(dv) {
    openBoard(dv);
  },
  code(dv, host) {
    openBoard(dv);
    host.show("files", false);
  },
  review(dv, host) {
    openBoard(dv);
    host.show("changes", false);
  },
  monitor(dv, host) {
    openBoard(dv);
    host.show("inbox", false);
    // Two tools cannot show at one edge; the usage only when it has its own.
    if (host.edgeOf("usage") !== host.edgeOf("inbox")) host.show("usage", false);
  },
};

function openBoard(dv: DockviewApi): void {
  openOrFocus(dv, "overview", "overview", VIEW_TITLES.overview ?? "overview", {});
}

/* arrange hides every edge and builds the activity, the board in front. */
function arrange(dv: DockviewApi, host: ToolHost, which: Activity): void {
  for (const edge of EDGES) host.hide(edge);
  LAYOUTS[which](dv, host);
  dv.getPanel("overview")?.api.setActive();
  hold(dv);
}

// rebuild drops everything and arranges for the activity — a reset.
function rebuild(dv: DockviewApi, host: ToolHost, which: Activity, layout: ToolLayout): void {
  dv.clear();
  host.ensure();
  host.reconcile(layout);
  arrange(dv, host, which);
}

/* loadArrangement brings a saved arrangement up — the last one, or a preset.
 *
 * What was saved before the tools had edges is made into one where they do
 * first (layoutMigrate): out of the grid, the ones that were in front named.
 * An arrangement that does not load is not half applied: the window is built
 * for the activity instead, never left blank. Then the edges are put right —
 * each one there, its tab strip hidden, drops refused — every tool is put on
 * the edge his layout says, and the tools that were in front of the old grid
 * are shown, one per edge. A grid with nothing in it gets the board. */
function loadArrangement(dv: DockviewApi, host: ToolHost, saved: unknown, layout: ToolLayout, which: Activity): void {
  const { layout: json, openTools } = migrateLayout(saved);
  let loaded = false;
  if (json) {
    try {
      dv.fromJSON(json);
      loaded = true;
    } catch {
      dv.clear();
    }
  }
  host.ensure();
  host.reconcile(layout);
  if (!loaded) {
    arrange(dv, host, which);
    return;
  }
  const front = dv.activeGroup && dv.activeGroup.api.location.type === "grid" ? dv.activeGroup : undefined;
  const pick = new Map<Edge, ToolId>();
  for (const id of openTools) {
    const edge = host.edgeOf(id);
    if (edge) pick.set(edge, id);
  }
  for (const id of pick.values()) host.show(id, false);
  if (front && pick.size) front.api.setActive();
  if (!dv.panels.some((p) => p.group.api.location.type === "grid")) openBoard(dv);
  hold(dv);
}

/* readToolLayout takes his placement of the tools out of prefs. A window that
   has none yet reads the region choices the old window kept, once, and writes
   the placement in their stead — the old key goes, so it is read never again. */
function readToolLayout(prefs: Record<string, unknown>): ToolLayout {
  const saved = prefs.toolLayout;
  if (saved && typeof saved === "object" && (saved as { v?: unknown }).v === 1) return normalizeToolLayout(saved);
  const layout = fromRegions(prefs.dockRegions);
  void api.setPrefs({ toolLayout: layout, dockRegions: null }).catch(() => undefined);
  return layout;
}

/* ---------- lengths ---------- */

/* remToPx turns a rem length into the pixels dockview measures in — the one
   place a pixel is allowed, and it is computed, not written. Resolved against
   the root's font size, the same way the terminal resolves its own. */
function remToPx(rem: string): number {
  return parseFloat(rem) * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");
}

/* cssPx reads a length the stylesheet declares and hands dockview the pixels
   it counts in. Sizes stay in the frame, in rem, like every other measurement
   — see remToPx, which this leans on. */
function cssPx(name: string, fallback: string): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return Math.round(remToPx(declared || fallback));
}

/* ---------- the tool windows' sizes, and main's floor ---------- */

/* How wide each edge was last, in pixels — the stripe not counted — so an edge
   comes back at the size it had, across a restart too. Written while an edge
   is showing, read when an edge is made. */
const sizes = new Map<Edge, number>();

function noteSizes(host: ToolHost): void {
  for (const edge of EDGES) {
    if (!host.shown(edge)) continue;
    const px = host.size(edge);
    if (px > 0) sizes.set(edge, px);
  }
}

/* readSizes takes the edge sizes back out of the settings on load. The sizes
   are pixels because dockview counts in them; one that is not a positive
   number is ignored rather than trusted. */
export function readSizes(prefs: Record<string, unknown>): void {
  const saved = prefs.dockSizes;
  if (!saved || typeof saved !== "object") return;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if ((k === "left" || k === "right" || k === "bottom") && typeof v === "number" && Number.isFinite(v) && v > 0) {
      sizes.set(k, Math.round(v));
    }
  }
}

function shownOf(host: ToolHost): ShownTools {
  return { left: host.shown("left"), right: host.shown("right"), bottom: host.shown("bottom") };
}

/* clampMain keeps main at least as wide as the frame declares, and no side
   window wider than 45% of the dock. The widest side showing gives way first,
   never below its own minimum; in a window too narrow for both, main is what
   is left. When nothing had to give, a side smaller than the width he dragged
   it to — or than the frame declares, when he never dragged it — grows back
   towards it, as far as main can spare.
 *
 * Main's floor is the declared width or what main's own groups need, whichever
 * is more: two groups side by side each keep their minimum, and a floor of one
 * group's width let the second run on under the window beside it. */
function clampMain(host: ToolHost, box: HTMLElement | null, gridMinimum: number): void {
  const shell = box?.querySelector<HTMLElement>(".dv-shell");
  const grid = box?.querySelector<HTMLElement>(".plxrDock");
  if (!shell || !grid || shell.clientWidth === 0) return;
  const sideMin = cssPx("--side-min", "11rem");
  const mainMin = Math.max(cssPx("--main-min", "16rem"), Math.ceil(gridMinimum || 0));
  const cap = Math.max(sideMin, Math.round(shell.clientWidth * 0.45));
  for (const edge of ["left", "right"] as const) {
    if (host.shown(edge) && host.size(edge) > cap) host.setSize(edge, cap);
  }
  let gave = false;
  for (let i = 0; i < 4; i++) {
    const main = grid.getBoundingClientRect().width;
    if (main >= mainMin - 1) break;
    const widest = (["left", "right"] as const)
      .filter((e) => host.shown(e) && host.size(e) > sideMin)
      .sort((a, b) => host.size(b) - host.size(a))[0];
    if (!widest) break;
    host.setSize(widest, Math.max(sideMin, Math.floor(host.size(widest) - (mainMin - main))));
    gave = true;
  }
  if (gave) return;
  for (const edge of ["left", "right"] as const) {
    const want = Math.min(cap, sizes.get(edge) ?? cssPx("--side-w", "20rem"));
    const have = host.size(edge);
    if (!host.shown(edge) || want <= have + 1) continue;
    const spare = Math.floor(grid.getBoundingClientRect().width - mainMin);
    if (spare <= 1) break;
    host.setSize(edge, have + Math.min(want - have, spare));
  }
}

/* ---------- main: documents and the work ---------- */

/* Main holds two kinds of panel: the work itself — a terminal, the folders,
 * the overview — and the documents opened from it.
 *
 * Both were tabs of one group, so clicking a file in the folders' tree put
 * the editor in front of the tree it was clicked in: "why does the tree close
 * when I open a file?". The session's own tree beside its terminal did the
 * same to the terminal. So a document never becomes a tab over the work: it
 * joins a group that holds documents only, and where there is none yet, one
 * is split off beside the work it came from. */
const isDocument = (id: string) => id.startsWith("editor:") || id.startsWith("diff:") || id.startsWith("preview:");

function holdsOnlyDocuments(g: DockviewGroupPanel): boolean {
  return g.panels.length > 0 && g.panels.every((p) => isDocument(p.id));
}

/* The group of main that was in front last, and the documents group that was:
   with a tool in front, the next panel still knows where the work was. */
let lastGrid = "";
let lastDocuments = "";

const gridGroupsOf = (dv: DockviewApi, except?: DockviewGroupPanel) =>
  dv.groups.filter((g) => g.api.location.type === "grid" && g !== except);

function lastGridGroup(dv: DockviewApi): DockviewGroupPanel | undefined {
  const grid = gridGroupsOf(dv);
  return grid.find((g) => g.id === lastGrid) ?? grid[0];
}

/* placeDocument says where a panel of main goes — every panel of main, because
 * dockview puts a panel added without a place into the group in front, and
 * with a tool clicked last that is a tool window.
 *
 * A document joins the group it was opened from when that holds documents, or
 * else the documents group looked at last; with none, it is split off to the
 * right of the work it came from — or of the work that was in front last, when
 * it came from a tool or from nowhere — so that work stays on screen beside it.
 * Work joins the work that was in front last. With no group in main at all, a
 * new one is made. */
function placeDocument(dv: DockviewApi, id: string, from?: DockviewGroupPanel, except?: DockviewGroupPanel): AddPanelPositionOptions {
  const grid = gridGroupsOf(dv, except);
  if (grid.length === 0) return { direction: "right" };
  const active = dv.activeGroup && grid.includes(dv.activeGroup) ? dv.activeGroup : undefined;
  const byId = (gid: string) => grid.find((g) => g.id === gid);
  if (isDocument(id)) {
    const origin = from && grid.includes(from) ? from : undefined;
    if (origin && holdsOnlyDocuments(origin)) return { referenceGroup: origin };
    const documents = [active, byId(lastDocuments), ...grid].find((g) => g && holdsOnlyDocuments(g));
    if (documents) return { referenceGroup: documents };
    const work = origin ?? [active, byId(lastGrid), ...grid].find((g) => g && !holdsOnlyDocuments(g)) ?? grid[0];
    return { referenceGroup: work, direction: "right" };
  }
  const work = [active, byId(lastGrid), ...grid].find((g) => g && !holdsOnlyDocuments(g));
  return { referenceGroup: work ?? active ?? byId(lastGrid) ?? grid[0] };
}

/* How big a panel split off in main opens: half of the group it splits from. */
function sizedFor(dv: DockviewApi, position: AddPanelPositionOptions) {
  const direction = position.direction;
  if (!direction || direction === "within" || !("referenceGroup" in position)) return { position };
  const ref = typeof position.referenceGroup === "string" ? dv.getGroup(position.referenceGroup) : position.referenceGroup;
  if (!ref) return { position };
  if (direction === "left" || direction === "right") return { position, initialWidth: Math.floor(ref.api.width / 2) };
  return { position, initialHeight: Math.floor(ref.api.height / 2) };
}

/* hold keeps main at its floor: no group of main narrower than the frame
   declares. The tool windows are not in the grid, so there is nothing else in
   it to hold. */
function hold(dv: DockviewApi): void {
  const floor = cssPx("--main-min", "16rem");
  for (const g of gridGroupsOf(dv)) g.api.setConstraints({ minimumWidth: floor });
}

// openOrFocus makes the panel where main says if it is not there, and brings
// it to the front. Returns whether it was made now. `from` is the group of the
// panel it was opened from, for a document to stand beside.
function openOrFocus(dv: DockviewApi, id: string, component: string, title: string, params: object, from?: DockviewGroupPanel): boolean {
  const existing = dv.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return false;
  }
  const position = placeDocument(dv, id, from);
  const made = dv.addPanel({ id, component, title, params, ...sizedFor(dv, position) });
  hold(dv);
  /* A document split off beside the work shares that work's width evenly. */
  if (isDocument(id) && "referenceGroup" in position && position.direction === "right") {
    const refId = typeof position.referenceGroup === "string" ? position.referenceGroup : position.referenceGroup.id;
    const ref = dv.groups.find((g) => g.id === refId);
    const mine = dv.groups.find((g) => g.id === made.group.id);
    if (ref && mine && mine !== ref && mine.api.location.type === "grid") shareWidth(dv, ref, mine);
  }
  return true;
}

/* shareWidth makes two groups side by side equally wide and moves nothing
   else: every other group is held at the width it has while the two are
   resized, and given its bounds back afterwards. */
function shareWidth(dv: DockviewApi, a: DockviewGroupPanel, b: DockviewGroupPanel): void {
  const others = gridGroupsOf(dv)
    .filter((g) => g !== a && g !== b)
    .map((g) => ({ g, min: g.minimumWidth, max: g.maximumWidth }));
  for (const { g } of others) g.api.setConstraints({ minimumWidth: g.api.width, maximumWidth: g.api.width });
  b.api.setSize({ width: Math.floor((a.api.width + b.api.width) / 2) });
  for (const { g, min, max } of others) g.api.setConstraints({ minimumWidth: min, maximumWidth: max });
}

/* ---------- moving panels: float, dock, split ---------- */

/* toggleMaximize puts one panel's group over the whole of main, or back where
   it was. Dockview remembers the arrangement underneath, so restoring gives
   back every group at the size it had. */
function toggleMaximize(panel: IDockviewPanel) {
  if (panel.api.isMaximized()) panel.api.exitMaximized();
  else panel.api.maximize();
}

/* floatPanel lifts a panel out of the grid into a floating group of its own —
   a window inside the window, dragged and resized by its title bar. Sized to
   a readable share of main and centred; dockview measures in pixels, so the
   rem it is declared in is converted here. */
function floatPanel(dv: DockviewApi, panel: IDockviewPanel) {
  const width = Math.min(Math.round(dv.width * 0.6), Math.round(remToPx("44rem")));
  const height = Math.min(Math.round(dv.height * 0.6), Math.round(remToPx("30rem")));
  dv.addFloatingGroup(panel, {
    width,
    height,
    x: Math.max(0, Math.round((dv.width - width) / 2)),
    y: Math.max(0, Math.round((dv.height - height) / 2)),
  });
}

/* dockPanel puts a floating panel back into main, where a new one of its kind
   would go — never into a tool window. */
function dockPanel(dv: DockviewApi, panel: IDockviewPanel) {
  moveInto(dv, panel, placeDocument(dv, panel.id, undefined, panel.group));
  hold(dv);
}

/* splitPanel puts the panel beside or below what it is in — two editors side
   by side, a diff under the file it is about. Alone in its group there is
   nothing to split off from. */
function splitPanel(dv: DockviewApi, panel: IDockviewPanel, position: Position) {
  if (panel.group.panels.length < 2) return;
  panel.api.moveTo({ group: panel.group, position });
  hold(dv);
}

// toPosition writes a placement direction the way moveTo reads it.
function toPosition(direction: AddPanelPositionOptions["direction"]): Position | undefined {
  const d = direction as string | undefined;
  if (!d || d === "within") return undefined;
  if (d === "above") return "top";
  if (d === "below") return "bottom";
  return d === "left" ? "left" : "right";
}

/* moveInto carries a panel to where placeDocument said a new one would go. A
   placement with a direction and no group to refer to is an edge of the grid
   itself: dockview makes the group there, and the panel moves into it. */
function moveInto(dv: DockviewApi, panel: IDockviewPanel, pos: AddPanelPositionOptions) {
  const refId =
    "referenceGroup" in pos
      ? typeof pos.referenceGroup === "string"
        ? pos.referenceGroup
        : pos.referenceGroup.id
      : "referencePanel" in pos
        ? typeof pos.referencePanel === "string"
          ? dv.getPanel(pos.referencePanel)?.group.id
          : pos.referencePanel.group.id
        : undefined;
  const ref = refId ? dv.groups.find((g) => g.id === refId) : undefined;
  const position = toPosition(pos.direction);
  if (ref) {
    panel.api.moveTo({ group: ref, position });
    return;
  }
  const edge = pos.direction;
  if (edge && edge !== "within") {
    const made = dv.addGroup({ direction: edge });
    panel.api.moveTo({ group: made, position: "center" });
  }
}

/* ---------- the keyboard between panels ---------- */

// stepPanel makes the previous or next panel of the active group active,
// wrapping at either end. A tool window has one panel on screen and no tabs
// to walk.
function stepPanel(dv: DockviewApi, by: -1 | 1) {
  const g = dv.activeGroup;
  if (!g || g.api.location.type === "edge") return;
  const list = g.panels;
  if (list.length < 2) return;
  const i = g.activePanel ? list.indexOf(g.activePanel) : -1;
  list[(i + by + list.length) % list.length]?.api.setActive();
}

/* stepGroup makes the previous or next group of main's grid active, in
   reading order — left to right, then top to bottom, as the groups sit on
   screen rather than in the order they were made. The tool windows are not
   groups of main and are skipped, and so is a floating window: the walk is
   through the grid he split. */
function stepGroup(dv: DockviewApi, by: -1 | 1) {
  const ordered = dv.groups
    .filter((g) => g.api.location.type === "grid")
    .map((g) => ({ g, r: g.element.getBoundingClientRect() }))
    .sort((a, b) => a.r.left - b.r.left || a.r.top - b.r.top)
    .map((x) => x.g);
  if (ordered.length < 2) return;
  const cur = dv.activeGroup;
  const i = cur ? ordered.indexOf(cur) : -1;
  const next = ordered[(i + by + ordered.length) % ordered.length];
  if (!next) return;
  if (next.activePanel) next.activePanel.api.setActive();
  else next.api.setActive();
}
