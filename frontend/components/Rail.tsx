"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { bindingOf, caption, VIEW_ORDER, type Action } from "@/lib/keymap";
import { detailOf, railLine, stateOf, titleOf, unattended } from "@/lib/state";
import type { Tile } from "@/lib/types";

// The rail always stays, even inside a session — otherwise looking into one
// loses sight of the rest of the herd.
export type View = "overview" | "inbox" | "folders" | "changes" | "search" | "ports" | "usage" | "archive" | "session" | "notes";

const HOME: { view: View; glyph: string; key: string; fallback: string }[] = [
  { view: "overview", glyph: "⊞", key: "rail.overview", fallback: "Overview" },
  { view: "inbox", glyph: "◉", key: "rail.inbox", fallback: "Inbox" },
  { view: "folders", glyph: "▦", key: "rail.folders", fallback: "Folders" },
  { view: "changes", glyph: "±", key: "rail.changes", fallback: "Changes" },
  { view: "search", glyph: "⌕", key: "rail.search", fallback: "Search" },
  { view: "ports", glyph: "⇄", key: "rail.ports", fallback: "Ports" },
  { view: "usage", glyph: "▤", key: "rail.usage", fallback: "Usage" },
  { view: "archive", glyph: "⌸", key: "rail.archive", fallback: "Archive" },
  { view: "notes", glyph: "✎", key: "rail.notes", fallback: "Notes" },
];

// The chord that reaches a view, read off the keymap's own order — never a
// second copy of it here.
function viewChord(view: View): string {
  const at = (VIEW_ORDER as readonly string[]).indexOf(view);
  return at < 0 ? "" : caption(bindingOf(`view${at + 1}` as Action));
}

export default function Rail({
  view,
  tiles,
  openId,
  counts,
  onView,
  onViewFresh,
  onResetLayout,
  onOpen,
  onNewShell,
}: {
  view: View;
  tiles: Tile[];
  openId: string | null;
  counts: { inbox: number; ports: number; archive: number };
  onView: (v: View) => void;
  /* The view in a group of its own, beside whatever is active — for when it
     should not tab into the group it usually joins. */
  onViewFresh?: (v: View) => void;
  onResetLayout?: () => void;
  onOpen: (id: string) => void;
  /* A plain shell in the focused session's folder, as a new session panel —
     the one action on the rail that is not a view. */
  onNewShell?: () => void;
}) {
  /* Started again under the same id, the way the tile does it: the entry that
     was stopped is the entry that runs, so nothing here navigates. */
  const restart = (t: Tile) => void api.resume(t.id).catch(() => undefined);
  const ctx = useContextMenu();
  /* The same actions the overview tile offers under the right button, here
     on the rail entry: open it, pause or resume it, end it, copy its folder.
     The rail is where a session is reached most, so it must offer them too. */
  const railMenu = (t: Tile): MenuItem[] => [
    { label: tr("tile.menuOpen", "Open"), onClick: () => onOpen(t.id) },
    ...(t.alive
      ? [
          t.frozen
            ? { label: tr("tile.menuUnfreeze", "Resume"), onClick: () => void api.unfreeze(t.id).catch(() => undefined) }
            : { label: tr("tile.menuFreeze", "Pause"), onClick: () => void api.freeze(t.id).catch(() => undefined) },
          { separator: true as const },
          { label: tr("tile.menuTerminate", "Terminate"), danger: true, onClick: () => void api.kill(t.id).catch(() => undefined) },
        ]
      : [
          /* Ended or orphaned: the way back, and the way off the board — the
             same two the tile offers, so no session has to be found on the
             overview first to be brought back. */
          { label: tr("tile.menuRestart", "Restart"), onClick: () => restart(t) },
          { separator: true as const },
          { label: tr("tile.menuForget", "Remove from the board"), onClick: () => void api.forget(t.id).catch(() => undefined) },
        ]),
    { separator: true as const },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(t.cwd).catch(() => undefined) },
  ];

  /* A view under the right button: open it where it usually goes, open it in
     a group of its own, or put the whole arrangement back. */
  const homeMenu = (v: View): MenuItem[] => [
    { label: tr("tile.menuOpen", "Open"), hint: viewChord(v), onClick: () => onView(v) },
    ...(onViewFresh ? [{ label: tr("rail.menuNewGroup", "Open in a new group"), onClick: () => onViewFresh(v) }] : []),
    ...(onResetLayout
      ? [{ separator: true as const }, { label: tr("palette.resetLayout", "Reset the panel layout"), onClick: onResetLayout }]
      : []),
  ];

  // Sessions grouped by project, the way the herd is actually read.
  const groups = new Map<string, Tile[]>();
  for (const t of tiles) {
    const g = t.project || t.name;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }

  const meta: Record<View, number | undefined> = {
    overview: undefined,
    changes: undefined,
    search: undefined,
    inbox: counts.inbox || undefined,
    folders: undefined,
    ports: counts.ports || undefined,
    usage: undefined,
    archive: counts.archive || undefined,
    session: undefined,
    notes: undefined,
  };

  return (
    <nav className="rail">
      {HOME.map((h) => (
        <Button
          bare
          key={h.view}
          className={`railitem railhome${view === h.view ? " active" : ""}`}
          onClick={() => onView(h.view)}
          onContextMenu={ctx(homeMenu(h.view))}
        >
          <span className="rdot">{h.glyph}</span>
          <span className="rname">{tr(h.key, h.fallback)}</span>
          {meta[h.view] ? <span className="rmeta">{meta[h.view]}</span> : null}
        </Button>
      ))}
      {onNewShell ? (
        <Tooltip text={tr("rail.newShellTip", "A plain shell in the folder of the session you are working in, beside it")}>
          <Button bare className="railitem railhome" data-do="new-shell" onClick={onNewShell}>
            <span className="rdot">+</span>
            <span className="rname">{tr("rail.newShell", "New shell")}</span>
          </Button>
        </Tooltip>
      ) : null}

      {[...groups].map(([group, list]) => (
        <div key={group}>
          <div className="railgroup">{group}</div>
          {list.map((t) => (
            <Tooltip key={t.id} text={detailOf(t) || undefined}>
              <Button
                bare
                className={`railitem${openId === t.id ? " active" : ""}`}
                data-status={stateOf(t)}
                data-unattended={unattended(t) ? "yes" : undefined}
                onClick={() => onOpen(t.id)}
                onContextMenu={ctx(railMenu(t))}
              >
                <span className={`rdot dot ${stateOf(t)}`}>▣</span>
                <span className="rtext">
                  <span className="rname">{titleOf(t)}</span>
                  <span className="rsub">{railLine(t)}</span>
                </span>
              </Button>
            </Tooltip>
          ))}
        </div>
      ))}
    </nav>
  );
}
