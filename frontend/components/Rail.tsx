"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { detailOf, railLine, stateOf, titleOf, unattended } from "@/lib/state";
import type { Tile } from "@/lib/types";

// The rail always stays, even inside a session — otherwise looking into one
// loses sight of the rest of the herd.
export type View = "overview" | "inbox" | "folders" | "changes" | "review" | "search" | "ports" | "usage" | "archive" | "session";

const HOME: { view: View; glyph: string; key: string; fallback: string }[] = [
  { view: "overview", glyph: "⊞", key: "rail.overview", fallback: "Overview" },
  { view: "inbox", glyph: "◉", key: "rail.inbox", fallback: "Inbox" },
  { view: "folders", glyph: "▦", key: "rail.folders", fallback: "Folders" },
  { view: "changes", glyph: "±", key: "rail.changes", fallback: "Changes" },
  { view: "review", glyph: "⎇", key: "rail.review", fallback: "Review" },
  { view: "search", glyph: "⌕", key: "rail.search", fallback: "Search" },
  { view: "ports", glyph: "⇄", key: "rail.ports", fallback: "Ports" },
  { view: "usage", glyph: "▤", key: "rail.usage", fallback: "Usage" },
  { view: "archive", glyph: "⌸", key: "rail.archive", fallback: "Archive" },
];

export default function Rail({
  view,
  tiles,
  openId,
  counts,
  onView,
  onOpen,
}: {
  view: View;
  tiles: Tile[];
  openId: string | null;
  counts: { inbox: number; ports: number; archive: number };
  onView: (v: View) => void;
  onOpen: (id: string) => void;
}) {
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
      : []),
    { separator: true as const },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(t.cwd).catch(() => undefined) },
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
    review: undefined,
    search: undefined,
    inbox: counts.inbox || undefined,
    folders: undefined,
    ports: counts.ports || undefined,
    usage: undefined,
    archive: counts.archive || undefined,
    session: undefined,
  };

  return (
    <nav className="rail">
      {HOME.map((h) => (
        <Button
          bare
          key={h.view}
          className={`railitem railhome${view === h.view ? " active" : ""}`}
          onClick={() => onView(h.view)}
        >
          <span className="rdot">{h.glyph}</span>
          <span className="rname">{tr(h.key, h.fallback)}</span>
          {meta[h.view] ? <span className="rmeta">{meta[h.view]}</span> : null}
        </Button>
      ))}

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
