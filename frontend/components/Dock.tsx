"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
import Rail, { VIEW_GLYPHS, type View } from "@/components/Rail";
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
import Button from "@/components/ui/Button";
import Ask from "@/components/ui/Ask";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { bindingOf, caption, hasModifier, matches, type Action } from "@/lib/keymap";
import { setDense } from "@/lib/prefsEvents";
import { BELL_CHANGED, clearBell, hasBell } from "@/lib/bell";
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
   of the panel's id as well (diff:<root>:<s|u>:<path>). A range diff from the
   review panel carries its base, and is a panel of its own beside the
   staged/unstaged ones (diff:<root>:r:<base>:<path>). */
export type ShownDiff = { rootId: string; path: string; staged: boolean; base?: string } | null;

const diffId = (rootId: string, path: string, staged: boolean, base = "") =>
  base ? `diff:${rootId}:r:${base}:${path}` : `diff:${rootId}:${staged ? "s" : "u"}:${path}`;

/* What the shell can be asked for from inside a panel's own menu — the board's
   empty space, the rail's views. The same verbs the header MENU has, so a
   right-click on nothing in particular is not a dead end. */
export type ShellActions = {
  newSession: () => void;
  newShell: () => void;
  templates: () => void;
  resetLayout: () => void;
};

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
  openDiff: (rootId: string, path: string, staged: boolean, title: string, base?: string) => void;
  onDiffClosed: (rootId: string, path: string, staged: boolean, base?: string) => void;
  openPanel: (view: string) => void;
  /* The same view in a group of its own beside the active one — moved there
     when it is already open, made there when it is not. */
  openPanelFresh: (view: string) => void;
  /* The shell's own verbs, for the menus on the board and the rail. */
  shell?: ShellActions;
  /* What the settings' layouts page can do — the shell owns the dialogs
     behind it, the dock only hands it to the panel that draws it. */
  layouts: LayoutControls;
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
  /* The one way a panel is closed by hand — the tab's ✕, its menu, ⌘W: the
     guard asks first when something would be lost, and says what came of it. */
  requestClose: (panel: IDockviewPanel) => Promise<CloseResult>;
  /* Several at once, one guard after the other; a cancel stops the run. */
  closeMany: (panels: IDockviewPanel[]) => void;
  /* A plain shell in the focused session's folder, opened beside it as a
     session panel of its own — the path field's folder when no session has
     been focused yet, the home directory when there is no folder either. */
  newShell: () => void;
};

/* What a guarded close came to: the panel is gone, it stayed because its
   guard took over (a dirty editor comes to the front instead), or the user
   said no. */
export type CloseResult = "closed" | "kept" | "cancelled";

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
        onOpenFile={(path, line, rootId) => d.openEditor(rootId ?? tile.id, path, line)}
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
      onOpenFiles={(rootId) => d.openFiles(rootId, followed?.cwd ?? d.here, followed ? followed.name || followed.cwd : d.here)}
    />
  );
}

/* The review panel follows the session the changes panel follows, with the
   same tolerance for a session the service does not know yet or any more.
   A file opens as a range diff — the working tree against the branch's
   merge-base — beside the terminal. */
function ReviewDockPanel() {
  const d = useDock();
  const id = d.lastActiveSessionId;
  const followed = id ? d.tiles.find((t) => t.id === id) : undefined;
  const gone = Boolean(id) && d.connected && !followed;
  return (
    <ReviewPanel
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

/* The tab of every panel: its title, a close that asks first, and a menu.
 *
 * Dockview's own tab closes the panel outright and offers no way to be asked
 * first, so an editor with edits in it was gone on a click, edits and all, and
 * a terminal with a process in it the same. This tab hands the close to the
 * dock's guard, which asks when something would be lost. Right-click opens the
 * window's own menu with what a tab can do: close, close the others, close the
 * group, float or dock, cross to the other lane, copy the title. The middle
 * button closes, the way tabs close everywhere else. */
/* The mark a tab wears.
 *
 * A view carries the rail's own glyph, so one thing is one glyph wherever it
 * is met; a session the state square it wears on the board and in the rail; a
 * document the mark of what it is. The kind travels beside it as an
 * attribute, because the colour of a mark is the skin's business. */
const FILE_GLYPHS: Record<string, { glyph: string; kind: string }> = {
  ts: { glyph: "\u25C8", kind: "code" },
  tsx: { glyph: "\u25C8", kind: "code" },
  js: { glyph: "\u25C7", kind: "code" },
  jsx: { glyph: "\u25C7", kind: "code" },
  go: { glyph: "\u25B7", kind: "code" },
  py: { glyph: "\u25B3", kind: "code" },
  rs: { glyph: "\u25B6", kind: "code" },
  sh: { glyph: "\u276F", kind: "code" },
  css: { glyph: "\u25A7", kind: "style" },
  html: { glyph: "\u25A4", kind: "style" },
  json: { glyph: "\u2263", kind: "data" },
  yml: { glyph: "\u2263", kind: "data" },
  yaml: { glyph: "\u2263", kind: "data" },
  sql: { glyph: "\u25A6", kind: "data" },
  md: { glyph: "\u2261", kind: "text" },
  txt: { glyph: "\u2261", kind: "text" },
};

function tabMark(id: string): { glyph: string; kind: string } {
  if (id.startsWith("session:")) return { glyph: "\u25A3", kind: "session" };
  if (id.startsWith("diff:")) return { glyph: "\u00B1", kind: "diff" };
  if (id.startsWith("preview:")) return { glyph: "\u25F1", kind: "preview" };
  if (id.startsWith("files:")) return { glyph: VIEW_GLYPHS.folders, kind: "view" };
  if (id.startsWith("editor:")) {
    const ext = id.slice(id.lastIndexOf(".") + 1).toLowerCase();
    return FILE_GLYPHS[ext] ?? { glyph: "\u25A1", kind: "plain" };
  }
  return { glyph: VIEW_GLYPHS[id] ?? "\u25A1", kind: "view" };
}

function PanelTab(props: IDockviewPanelHeaderProps) {
  const d = useDock();
  const ctx = useContextMenu();
  const dv = props.containerApi;
  const id = props.api.id;
  const isRail = id === "rail";
  const title = props.api.title ?? id;
  const here = () => dv.getPanel(id);
  const bell = useBellMark(id, props.api);

  /* Built when the menu is asked for, not when the tab renders: whether the
     panel is floating or alone in its group is read at that moment. */
  const items = (): MenuItem[] => {
    const p = here();
    if (!p) return [];
    const floating = p.api.location.type === "floating";
    const others = p.group.panels.filter((o) => o.id !== id);
    const shape: MenuItem = floating
      ? { label: tr("tab.dock", "Dock"), onClick: () => dockPanel(dv, p) }
      : { label: tr("tab.float", "Float"), onClick: () => floatPanel(dv, p) };
    if (isRail) return [shape];
    return [
      { label: tr("tab.close", "Close"), onClick: () => void d.requestClose(p), hint: caption(bindingOf("closePanel")) },
      { label: tr("tab.closeOthers", "Close others in group"), onClick: () => d.closeMany(others), disabled: others.length === 0 },
      { label: tr("tab.closeGroup", "Close group"), onClick: () => d.closeMany([...p.group.panels]) },
      { separator: true },
      shape,
      { separator: true },
      /* Where it lives, as four rows with the one it is in ticked — and the
         choice sticks: a panel moved into the bottom region opens there the
         next time, because where a panel goes is his and not a rule of mine. */
      { header: true, label: tr("tab.moveTo", "Move to") },
      ...REGIONS.map((r) => ({
        label: REGION_TITLES[r](),
        checked: !floating && regionOfGroup(p.group) === r,
        disabled: floating,
        onClick: () => moveToRegion(dv, p, r),
      })),
      { separator: true },
      { label: tr("tab.splitRight", "Split to the right"), onClick: () => splitPanel(dv, p, "right"), disabled: floating || p.group.panels.length < 2 },
      { label: tr("tab.splitDown", "Split downwards"), onClick: () => splitPanel(dv, p, "bottom"), disabled: floating || p.group.panels.length < 2 },
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
      onAuxClick={(e) => {
        if (e.button !== 1 || isRail) return;
        e.preventDefault();
        const p = here();
        if (p) void d.requestClose(p);
      }}
    >
      {isRail ? null : <span className="panelTabIcon" aria-hidden="true">{mark.glyph}</span>}
      <span className="panelTabName">{title}</span>
      {/* The mark itself stays out of the title text: nothing that reads tab
          titles finds a dot appended to it. */}
      <span className="sessionTabBell" aria-hidden="true" />
      {/* The glyph is drawn by the skin (::after), not written here: a tab's
          text is its title, and everything that reads tab titles — the gates,
          the layout's own bookkeeping — must not find a ✕ appended to it. The
          rail is the way to everything else and has no close at all. */}
      {isRail ? null : (
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
          {""}
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

/* The file tree of one root, as a panel. A row opens its file as an editor
   panel beside whatever is on screen — the terminal stays where it is. */
/* The settings, as a panel. Its DONE closes the panel it is in, so the one
   button means the same thing wherever the settings are — in a floating group
   it closes the floating window, docked it closes the tab. */
function SettingsPanel(props: IDockviewPanelProps) {
  const d = useDock();
  return <Settings framed={false} layouts={d.layouts} openSession={d.openSession} onClose={() => props.api.close()} />;
}

function FilesPanel(props: IDockviewPanelProps<{ rootId: string; root: string }>) {
  const d = useDock();
  const p = props.params;
  return (
    <div className="filesPanel">
      {/* The root the tree hands back, not the one the panel was opened on:
          a tree that has walked above its folder reads files through the
          directory itself, and the editor has to ask the same root. */}
      <Files rootId={p.rootId} root={p.root} onPick={(path, rootId) => d.openEditor(rootId, path)} />
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
      onViewFresh={(v) => d.openPanelFresh(v)}
      onResetLayout={d.shell?.resetLayout}
      onOpen={d.openSession}
      onNewShell={d.newShell}
    />
  );
}

const components = {
  overview: OverviewPanel,
  preview: PreviewPanel,
  changes: ChangesDockPanel,
  review: ReviewDockPanel,
  search: SearchDockPanel,
  diff: DiffPanel,
  editor: EditorPanel,
  files: FilesPanel,
  settings: SettingsPanel,
  inbox: InboxPanel,
  folders: FoldersPanel,
  ports: PortsPanel,
  usage: UsagePanel,
  archive: ArchivePanel,
  session: SessionPanel,
  notes: NotesPanel,
};

/* What the four regions are called where he has to pick one. Built when the
   menu is opened, not once at load, so a language change reaches them. */
export const REGION_TITLES: Record<Region, () => string> = {
  main: () => tr("region.main", "Main"),
  left: () => tr("region.left", "Left"),
  right: () => tr("region.right", "Right"),
  bottom: () => tr("region.bottom", "Bottom"),
};

export const VIEW_TITLES: Record<string, string> = {
  settings: "Settings",
  overview: "Overview",
  inbox: "Inbox",
  folders: "Folders",
  ports: "Ports",
  usage: "Usage",
  archive: "Archive",
  changes: "Changes",
  search: "Search",
  notes: "Notes",
  review: "Review",
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
  | { type: "activity"; arg: Activity }
  /* Not arrangements, but asked the same way — from the MENU and the keys,
     which live in the shell while what they need (the focused session, the
     overview panel) lives in the dock. */
  | { type: "newShell" }
  | { type: "grid" };
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
}: Omit<
  DockData,
  | "openPreview"
  | "openDiff"
  | "onDiffClosed"
  | "openPanel"
  | "openPanelFresh"
  | "openEditor"
  | "openFiles"
  | "activeId"
  | "lastActiveSessionId"
  | "editorTarget"
  | "shownDiff"
  | "setDirty"
  | "isDirty"
  | "requestClose"
  | "closeMany"
  | "newShell"
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
  // The session in the active panel, for the service: a notification about
  // it is held back while this page has focus. Not the sticky last session —
  // with the editor in front, the session beside it is not being looked at.
  useEffect(() => {
    showFront(activeId.startsWith("session:") ? activeId.slice("session:".length) : "");
  }, [activeId]);

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

  const openPanel = useCallback((view: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openView(dv, view);
  }, []);

  const openPanelFresh = useCallback((view: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openFresh(dv, view, view, VIEW_TITLES[view] ?? view, {});
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

  /* The close guard.
   *
   * A session panel whose process is alive is asked about: keep it running
   * and close only the panel (it stays in the rail), terminate it, or leave
   * everything as it is. An editor with unsaved edits is not asked here — it
   * comes to the front, where its own CLOSE says what is at stake and offers
   * SAVE, DISCARD or CANCEL. The rail never closes. Anything else just goes.
   * One question at a time: the dialog holds the answer's resolver. */
  const [closeAsk, setCloseAsk] = useState<{ name: string; answer: (r: "keep" | "kill" | "cancel") => void } | null>(null);
  const requestClose = useCallback((panel: IDockviewPanel): Promise<CloseResult> => {
    const id = panel.id;
    if (id === "rail") return Promise.resolve("kept");
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
              panel.api.close();
              resolve("closed");
            },
          });
        });
      }
    }
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
     of the active group, ⌥⌘↑/↓ walk the groups. A field being typed in keeps
     its keys, and a dialog on screen has the keyboard to itself. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dv = apiRef.current;
      if (!dv) return;
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT") return;
      if (document.querySelector(".backdrop, .paletteScrim")) return;
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
      if (fire("panelPrev", () => stepPanel(dv, -1))) return;
      if (fire("panelNext", () => stepPanel(dv, 1))) return;
      if (fire("groupPrev", () => stepGroup(dv, -1))) return;
      if (fire("groupNext", () => stepGroup(dv, 1))) return;
      if (fire("toggleLeft", () => toggleRegion(dv, "left"))) return;
      if (fire("toggleRight", () => toggleRegion(dv, "right"))) return;
      if (fire("toggleBottom", () => toggleRegion(dv, "bottom"))) return;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const openEditor = useCallback((rootId: string, rawPath: string, line?: number, title?: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    const { tiles: ts, here: h } = rootDirRef.current;
    const rootDir = ts.find((t) => t.id === rootId)?.cwd ?? h;
    let path = rawPath;
    if (rootDir && (rawPath === rootDir || rawPath.startsWith(rootDir + "/"))) path = rawPath.slice(rootDir.length + 1);
    const id = `editor:${rootId}:${path}`;
    const name = title || path.split("/").pop() || path;
    const made = openOrFocus(dv, id, "editor", name, { rootId, path, line });
    // A panel that was already there keeps its frozen params; the line it is
    // asked for now goes through the context instead.
    if (!made && line) setEditorTarget((t) => ({ id, line, nonce: (t?.nonce ?? 0) + 1 }));
  }, []);

  const openFiles = useCallback((rootId: string, root: string, title: string) => {
    const dv = apiRef.current;
    if (!dv) return;
    openOrFocus(dv, `files:${rootId}`, "files", title, { rootId, root });
  }, []);

  /* New shell here.
   *
   * The folder is the focused session's — read at call time through a ref,
   * the way openEditor reads its roots, so the callback stays stable. A
   * session the service no longer knows falls through to the path field's
   * folder, and an empty folder lets the service pick the home directory. An
   * empty command is a plain login shell. The panel opens on the stage beside
   * the session it was asked from, titled the way the service names it. */
  const lastSessionRef = useRef(lastActiveSessionId);
  lastSessionRef.current = lastActiveSessionId;
  const newShell = useCallback(() => {
    const { tiles: ts, here: h } = rootDirRef.current;
    const focused = ts.find((t) => t.id === lastSessionRef.current);
    const cwd = focused?.cwd || h || "";
    void api
      .create(cwd, [], "", "")
      .then((s) => {
        const dv = apiRef.current;
        if (!dv) return;
        openOrFocus(dv, `session:${s.id}`, "session", s.name || s.cwd.split("/").pop() || s.id, { id: s.id });
      })
      .catch(() => undefined);
  }, []);

  const data = useMemo<DockData>(
    () => ({
      tiles, shown, here, connected, counts, activeId, lastActiveSessionId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openPanel, openPanelFresh, openEditor, openFiles, setDirty, isDirty, onReplaced, shell, layouts,
      requestClose, closeMany, newShell,
    }),
    [
      tiles, shown, here, connected, counts, activeId, lastActiveSessionId, editorTarget, shownDiff,
      openSession, openPreview, openDiff, onDiffClosed, openPanel, openPanelFresh, openEditor, openFiles, setDirty, isDirty, onReplaced, shell, layouts,
      requestClose, closeMany, newShell,
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
      case "newShell":
        newShell();
        break;
      case "grid":
        // The overview, packed tight: the density is announced first, so the
        // panel comes up dense rather than switching after it has drawn.
        setDense(true);
        openPanel("overview");
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
      openView(dv, focus.view);
    } else {
      openOrFocus(dv, `session:${focus.id}`, "session", focus.name || focus.id, { id: focus.id });
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
      if (p.id.startsWith("diff:")) setShownDiff((s) => (s && diffId(s.rootId, s.path, s.staged, s.base) === p.id ? null : s));
    });
    // Bring back the arrangement from last time; if there is none, or it does
    // not load, arrange for the chosen activity so the window is never blank.
    api
      .prefs()
      .then((p) => {
        readRegions(p as Record<string, unknown>);
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

    /* The frame's bounds are re-asserted whenever a group comes or goes —
       a drag that makes a new group, a column that is closed. Guarded against
       its own echo: setting a size is itself a layout change. */
    let holding = false;
    const reassert = () => {
      if (holding) return;
      holding = true;
      try {
        hold(event.api);
      } finally {
        window.setTimeout(() => {
          holding = false;
        }, 0);
      }
    };
    event.api.onDidAddGroup(reassert);
    event.api.onDidRemoveGroup(reassert);

    // Save the arrangement whenever it changes — debounced, because a drag
    // fires many times.
    let timer: number | undefined;
    event.api.onDidLayoutChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        note(event.api);
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
        {/* The menu is the window's frame, not one of its columns.
            It was a panel in the grid, so it could be tabbed into, closed,
            dragged away — and above all it took its share when a column was
            closed, which is how the menu ended up half the window. Beside the
            grid it keeps the width the frame declares and the three regions
            are the only columns there are. */}
        <div className="dockShell">
          <aside className="railHost">
            <RailPanel />
          </aside>
          <DockviewReact
            className="plxrDock"
            components={components}
            tabComponents={tabComponents}
            defaultTabComponent={PanelTab}
            onReady={onReady}
          />
        </div>
      </InlineStrip.Provider>
      {paletteOpen ? <CommandPalette commands={commands} onClose={onClosePalette} /> : null}
      {closeAsk ? (
        <Ask
          heading={tr("dock.closeLiveHead", "This session is still running")}
          detail={tr("dock.closeLiveDetail", "{name} keeps running if only the panel is closed — it stays in the rail. Or terminate it now.", { name: closeAsk.name })}
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

/* LAYOUTS holds one builder per activity. Each starts from the rail and places
   its panels explicitly: the stage — sessions and the overview — right of the
   rail, and whatever belongs beside the work in an aside lane right of that.
   'focus' is the bare slate: rail and overview, and what a first start shows. */
const LAYOUTS: Record<Activity, (dv: DockviewApi) => void> = {
  focus(dv) {
    openView(dv, "overview");
  },
  code(dv) {
    openView(dv, "overview");
    openView(dv, "folders");
    dv.getPanel("overview")?.api.setActive();
  },
  review(dv) {
    openView(dv, "overview");
    openView(dv, "changes");
    dv.getPanel("overview")?.api.setActive();
  },
  monitor(dv) {
    openView(dv, "overview");
    openView(dv, "inbox");
    addSplit(dv, "usage", "right", "below");
    dv.getPanel("overview")?.api.setActive();
  },
};

// rebuild drops everything and arranges for the activity — a reset.
function rebuild(dv: DockviewApi, which: Activity) {
  dv.clear();
  LAYOUTS[which](dv);
  hold(dv);
}

// settle is what happens after a load: whatever came back, or nothing, the
// window ends up with a rail of the right width and something on stage.
function settle(dv: DockviewApi, which: Activity) {
  stripRail(dv);
  if (dv.panels.length === 0) LAYOUTS[which](dv);
  hold(dv);
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

/* stripRail takes the menu out of an arrangement saved when it was still a
   panel in the grid. Anyone who upgrades has one in their saved layout; left
   in, it would render as an empty panel called "plxr" beside the real menu. */
function stripRail(dv: DockviewApi) {
  dv.getPanel("rail")?.api.close();
}

/* ---------- the four regions ---------- */

/* Where a panel lives.
 *
 * There used to be three lanes that grew. Any panel could invent a column, so
 * opening the inbox beside an overview made a third one and the next view
 * joined that — "why does a third column open at all instead of using the
 * second". A window manager has regions, not lanes, and this is the shape
 * every editor settles on and the one he asked for:
 *
 *     [ rail ][ left ][      main      ][ right ]
 *     [                bottom                   ]
 *
 * left, right and bottom hold the tools; main holds what is worked on — the
 * terminals, the editors, the diffs. There is never a fifth column: a region
 * that is already on screen takes the panel as a tab, and one that is not is
 * opened at its own edge. */
export type Region = "left" | "main" | "right" | "bottom";
export const REGIONS: Region[] = ["main", "left", "right", "bottom"];

const isRegion = (v: unknown): v is Region => typeof v === "string" && (REGIONS as string[]).includes(v);

/* A document or a terminal: it belongs to main whatever else is open. */
const isMainPanel = (id: string) =>
  id.startsWith("session:") ||
  id.startsWith("editor:") ||
  id.startsWith("diff:") ||
  id.startsWith("preview:") ||
  id === "overview" ||
  id === "settings" ||
  id === "folders" ||
  id === "archive" ||
  id === "notes";

/* Where each view goes when nobody has said otherwise.
 *
 * A tool region is one column wide, so only a view that is a single list
 * belongs in one: the file tree, what has changed, a search, a branch review.
 * A view that lays itself out in two columns — folders, with its tree beside
 * what the tree opens — is squeezed to nothing in a tool region, and its
 * second column came out ninety pixels wide. Those are main views, whatever
 * else they are about. What is watched rather than worked in goes right. */
const HOME_REGION: Record<string, Region> = {
  overview: "main",
  settings: "main",
  notes: "main",
  folders: "main",
  archive: "main",
  changes: "left",
  review: "left",
  search: "left",
  inbox: "right",
  usage: "right",
  ports: "right",
};

/* What he moved, kept.
 *
 * Where a panel goes was my rule and not his choice: a panel dragged into the
 * bottom region came back on the left the next time it was opened. It is kept
 * by the kind of panel rather than by the panel's id — "editor:" and not
 * "editor:abc:lib/x.ts" — so moving one file's editor moves editors, not that
 * one file for ever. */
const moved = new Map<string, Region>();

const kindKey = (id: string) => (id.includes(":") ? id.slice(0, id.indexOf(":") + 1) : id);

function regionOf(id: string): Region {
  const his = moved.get(kindKey(id));
  if (his) return his;
  if (isMainPanel(id)) return "main";
  return HOME_REGION[id] ?? "left";
}

/* readRegions takes his choices back out of the settings on load. */
export function readRegions(prefs: Record<string, unknown>): void {
  moved.clear();
  const saved = prefs.dockRegions;
  if (!saved || typeof saved !== "object") return;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    if (isRegion(v)) moved.set(k, v);
  }
}

function rememberRegion(id: string, region: Region): void {
  moved.set(kindKey(id), region);
  void api.setPrefs({ dockRegions: Object.fromEntries(moved) }).catch(() => undefined);
}

/* Which region a group is: the one most of its panels belong to, main winning
   a tie. A group holding a terminal is main whatever was tabbed over it, so
   the tool regions can never grow into the work. */
function regionOfGroup(g: DockviewGroupPanel): Region | undefined {
  const votes = new Map<Region, number>();
  for (const p of g.panels) {
    if (p.id === "rail") continue;
    const r = regionOf(p.id);
    votes.set(r, (votes.get(r) ?? 0) + 1);
  }
  let best: Region | undefined;
  let most = 0;
  for (const r of REGIONS) {
    const n = votes.get(r) ?? 0;
    if (n > most) {
      best = r;
      most = n;
    }
  }
  return best;
}

/* The group a region lives in, if it is on screen. The active group wins when
   it qualifies, so a second panel joins the one being looked at. A floating
   group is a window of its own and belongs to no region. */
function groupOfRegion(dv: DockviewApi, region: Region, except?: { id: string }): DockviewGroupPanel | undefined {
  const holds = (g: DockviewGroupPanel) =>
    g.id !== except?.id &&
    g.api.location.type === "grid" &&
    !g.panels.some((p) => p.id === "rail") &&
    regionOfGroup(g) === region;
  const active = dv.activeGroup;
  if (active && holds(active)) return active;
  return dv.groups.find(holds);
}

/* place decides where a panel of this region goes.
 *
 * A region already on screen takes it as a tab. One that is not is opened
 * against the region beside it, so the four always keep their order however
 * the window was built up — and the bottom one against the grid itself, so it
 * spans the whole width rather than the group it was split from. */
function place(dv: DockviewApi, region: Region, except?: { id: string }): AddPanelPositionOptions {
  const at = (r: Region) => groupOfRegion(dv, r, except);
  const here = at(region);
  if (here) return { referenceGroup: here };
  const main = at("main");
  const left = at("left");
  const right = at("right");
  if (region === "left") {
    if (main) return { referenceGroup: main, direction: "left" };
    if (right) return { referenceGroup: right, direction: "left" };
    return { direction: "left" };
  }
  if (region === "right") {
    if (main) return { referenceGroup: main, direction: "right" };
    if (left) return { referenceGroup: left, direction: "right" };
    return { direction: "right" };
  }
  if (region === "bottom") return { direction: "below" };
  if (left) return { referenceGroup: left, direction: "right" };
  if (right) return { referenceGroup: right, direction: "left" };
  return { direction: "right" };
}

/* cssPx reads a length the stylesheet declares and hands dockview the pixels
   it counts in. Sizes stay in the frame, in rem, like every other measurement
   — see remToPx, which this leans on. */
function cssPx(name: string, fallback: string): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return Math.round(remToPx(declared || fallback));
}

/* How big a region opens.
 *
 * A tool region opens at the width the frame declares, never more than its
 * share of the window; the bottom one at its declared height. Main is given a
 * size only when it is splitting off the rail — then it takes everything the
 * rail does not need, rather than half the window. */
function sizedFor(dv: DockviewApi, region: Region, position: AddPanelPositionOptions) {
  const direction = position.direction;
  if (!direction || direction === "within") return { position };
  if (region === "bottom") {
    return { position, initialHeight: Math.min(Math.round(dv.height * 0.45), cssPx("--bottom-h", "18rem")) };
  }
  if (region === "left" || region === "right") {
    return { position, initialWidth: Math.min(Math.round(dv.width * 0.4), cssPx("--side-w", "20rem")) };
  }
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
  if (direction === "left" || direction === "right") return { position, initialWidth: Math.floor(ref.api.width / 2) };
  return { position, initialHeight: Math.floor(ref.api.height / 2) };
}

/* hold keeps the frame's shape.
 *
 * Dockview shares a closed column's width out among the survivors in
 * proportion, which is why closing a third column made the menu half the
 * window — "why doesn't the first stay as it is and the second take the space
 * back?". So every region is given the bounds the frame declares: the rail
 * keeps its width, a tool region may never take more than its share, and main
 * has no upper bound at all. What a closed region leaves then goes to the
 * work, because main is the only one that can grow into it. */
function hold(dv: DockviewApi): void {
  const sideMin = cssPx("--side-min", "11rem");
  const sideMax = Math.max(sideMin, Math.round(dv.width * 0.45));
  const bottomMin = cssPx("--bottom-min", "5rem");
  for (const g of dv.groups) {
    if (g.api.location.type !== "grid") continue;
    const region = regionOfGroup(g);
    if (region === "left" || region === "right") {
      g.api.setConstraints({ minimumWidth: sideMin, maximumWidth: sideMax });
      const want = sizes.get(region) ?? Math.min(Math.round(dv.width * 0.3), cssPx("--side-w", "20rem"));
      if (Math.abs(g.api.width - want) > 1) g.api.setSize({ width: want });
    } else if (region === "bottom") {
      g.api.setConstraints({ minimumHeight: bottomMin });
      const want = sizes.get("bottom") ?? Math.min(Math.round(dv.height * 0.4), cssPx("--bottom-h", "18rem"));
      if (Math.abs(g.api.height - want) > 1) g.api.setSize({ height: want });
    } else {
      g.api.setConstraints({ minimumWidth: cssPx("--main-min", "16rem") });
    }
  }
}

/* What each region is currently sized to, so that a region opening or closing
   does not resize the ones that were not touched.
 *
 * Dockview shares a closed column's space out in proportion, which is how
 * closing one column made the other two take half the window each. Here the
 * side regions are put back to the size they were last at and main simply
 * takes what is left — "why doesn't the first stay as it is and the second
 * take the space back?". A drag is what changes a remembered size: note() is
 * called once the layout has settled, hold() when a group comes or goes. */
const sizes = new Map<Region, number>();

function note(dv: DockviewApi): void {
  for (const g of dv.groups) {
    if (g.api.location.type !== "grid") continue;
    const region = regionOfGroup(g);
    if (region === "left" || region === "right") sizes.set(region, g.api.width);
    else if (region === "bottom") sizes.set("bottom", g.api.height);
  }
}

/* One tool at a time in a side region.
 *
 * "It is just as annoying that a tab always opens — that is not how a menu
 * works." It is not: a menu swaps what the side shows, it does not stack a
 * tab on every click until nothing can be found again. So opening a tool in
 * left, right or bottom clears the tools that were there. Documents and
 * terminals are never thrown away by a menu click, wherever they sit, and a
 * second tool side by side is still reachable — through the tab's own menu,
 * or by dragging it there. */
function clearTools(dv: DockviewApi, region: Region, except: string): void {
  const g = groupOfRegion(dv, region);
  if (!g) return;
  for (const p of [...g.panels]) {
    if (p.id === except || p.id === "rail" || isMainPanel(p.id)) continue;
    p.api.close();
  }
}

// openOrFocus makes the panel where its region says if it is not there, and
// brings it to the front. Returns whether it was made now.
function openOrFocus(
  dv: DockviewApi,
  id: string,
  component: string,
  title: string,
  params: object,
  region?: Region,
): boolean {
  const where = region ?? regionOf(id);
  const existing = dv.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return false;
  }
  if (where !== "main") clearTools(dv, where, id);
  dv.addPanel({ id, component, title, params, ...sizedFor(dv, where, place(dv, where)) });
  hold(dv);
  return true;
}

/* addSplit puts a view into a region beside one that is already there —
   stacked, not tabbed. The arrangements use it where two tools are meant to
   be read at once; a click in the menu never does. */
function addSplit(dv: DockviewApi, view: string, region: Region, direction: "right" | "below"): void {
  const g = groupOfRegion(dv, region);
  if (!g) {
    openView(dv, view);
    return;
  }
  const position: AddPanelPositionOptions = { referenceGroup: g, direction };
  const size =
    direction === "below"
      ? { initialHeight: Math.floor(g.api.height / 2) }
      : { initialWidth: Math.floor(g.api.width / 2) };
  dv.addPanel({ id: view, component: view, title: VIEW_TITLES[view] ?? view, position, ...size });
  hold(dv);
}

/* Folding a tool region away, and bringing it back with what was in it.
 *
 * A region could only be CLOSED, one panel at a time, and what was in it was
 * gone — so clearing the sides to read a long file meant rebuilding them
 * afterwards. Every editor has one chord for this and it does not throw
 * anything away: what stood in the region is written down, the panels go, and
 * the same chord puts them back in the order they were in. Main is never
 * folded: there would be nothing left. */
const folded = new Map<Region, string[]>();

function toggleRegion(dv: DockviewApi, region: Region): void {
  if (region === "main") return;
  const g = groupOfRegion(dv, region);
  if (g) {
    const ids = g.panels.map((p) => p.id);
    folded.set(region, ids);
    for (const p of [...g.panels]) p.api.close();
    hold(dv);
    return;
  }
  const back = folded.get(region) ?? [];
  folded.delete(region);
  if (back.length === 0) {
    // Nothing was folded away: the chord still has to do something, so the
    // region opens with what belongs in it.
    const first = Object.entries(HOME_REGION).find(([, r]) => r === region)?.[0];
    if (first) openOrFocus(dv, first, first, VIEW_TITLES[first] ?? first, {}, region);
    return;
  }
  for (const id of back) {
    if (dv.getPanel(id)) continue;
    const component = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    openOrFocus(dv, id, component, VIEW_TITLES[id] ?? id, {}, region);
  }
  hold(dv);
}

/* openView is what a click in the menu does.
 *
 * A tool that is already in front goes away again — the same click that
 * opened it, the way a tool window's button works everywhere else. A tool
 * that is open but behind comes to the front. Anything in main is never
 * toggled shut: closing the terminal you are working in because you clicked
 * its name would be its own bug. */
function openView(dv: DockviewApi, view: string): void {
  const region = regionOf(view);
  const existing = dv.getPanel(view);
  if (existing && region !== "main" && dv.activePanel?.id === view) {
    existing.api.close();
    hold(dv);
    return;
  }
  openOrFocus(dv, view, view, VIEW_TITLES[view] ?? view, {}, region);
}

/* openFresh splits the panel off beside the one that is active — the way to
 * see two things at once without leaving the region. A panel already alone in
 * its group is as fresh as it can be. */
function openFresh(dv: DockviewApi, id: string, component: string, title: string, params: object): void {
  const active = dv.activeGroup;
  const where = regionOf(id);
  const beside = active && !active.panels.some((p) => p.id === "rail") ? active : groupOfRegion(dv, where);
  const existing = dv.getPanel(id);
  if (existing) {
    if (existing.group.panels.length === 1) {
      existing.api.setActive();
      return;
    }
    const from = beside && beside !== existing.group ? beside : existing.group;
    existing.api.moveTo({ group: from, position: "right" });
    existing.api.setActive();
    return;
  }
  const position: AddPanelPositionOptions = beside ? { referenceGroup: beside, direction: "right" } : { direction: "right" };
  dv.addPanel({ id, component, title, params, ...sizedFor(dv, where, position) });
  hold(dv);
}

/* ---------- moving panels: float, dock, between regions ---------- */

/* floatPanel lifts a panel out of the grid into a floating group of its own —
   a window inside the window, dragged and resized by its title bar. Sized to
   a readable share of the dock and centred; dockview measures in pixels, so
   the rem it is declared in is converted here, the way the rail's width is. */
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

/* dockPanel puts a floating panel back where it belongs — its own region, not
   whichever lane was nearest. */
function dockPanel(dv: DockviewApi, panel: IDockviewPanel) {
  moveInto(dv, panel, place(dv, regionOf(panel.id), panel.group));
  hold(dv);
}

/* moveToRegion carries a panel into one of the four and remembers that this
   is where its kind goes from now on. */
function moveToRegion(dv: DockviewApi, panel: IDockviewPanel, region: Region) {
  rememberRegion(panel.id, region);
  moveInto(dv, panel, place(dv, region, panel.group));
  hold(dv);
}

/* splitPanel puts the panel beside or below what it is in, inside the region
   it is already in — two editors side by side, a diff under the file it is
   about. Alone in its group there is nothing to split off from. */
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

/* moveInto carries a panel to where place() said a new one would go. With no
   group to refer to — the panel's own is the only one — it splits off its
   own group instead; alone in a grid group it already is a lane of its own,
   and there is nothing to do. */
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
  const own = dv.groups.find((g) => g.id === panel.group.id);
  if (own && panel.group.panels.length > 1) {
    panel.api.moveTo({ group: own, position: position ?? "right" });
    return;
  }
  // Alone in a floating group, with nothing in the grid to refer to: beside
  // whatever is there, the rail only when it is all there is.
  const grid = dv.groups.filter((g) => g.id !== panel.group.id && g.api.location.type === "grid");
  const beside = grid.find((g) => !g.panels.some((p) => p.id === "rail")) ?? grid[0];
  if (beside) panel.api.moveTo({ group: beside, position: position ?? "right" });
}

/* ---------- the keyboard between panels ---------- */

// stepPanel makes the previous or next panel of the active group active,
// wrapping at either end.
function stepPanel(dv: DockviewApi, by: -1 | 1) {
  const g = dv.activeGroup;
  if (!g) return;
  const list = g.panels;
  if (list.length < 2) return;
  const i = g.activePanel ? list.indexOf(g.activePanel) : -1;
  list[(i + by + list.length) % list.length]?.api.setActive();
}

/* stepGroup makes the previous or next group active, in reading order — left
   to right, then top to bottom, as the groups sit on screen rather than in the
   order they were made. The rail is the launcher, not a place to work, and is
   skipped; floating groups take their turn where they sit. */
function stepGroup(dv: DockviewApi, by: -1 | 1) {
  const ordered = dv.groups
    .filter((g) => !g.panels.every((p) => p.id === "rail"))
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
