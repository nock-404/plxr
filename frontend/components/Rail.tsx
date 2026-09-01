"use client";

import Button from "@/components/ui/Button";
import { tr } from "@/lib/i18n";
import { detailOf, railLine, stateOf, titleOf, unattended } from "@/lib/state";
import type { Tile } from "@/lib/types";

// The rail always stays, even inside a session — otherwise looking into one
// loses sight of the rest of the herd.
export type View = "overview" | "inbox" | "ports" | "usage" | "archive" | "session";

const HOME: { view: View; glyph: string; key: string; fallback: string }[] = [
  { view: "overview", glyph: "⊞", key: "rail.overview", fallback: "Overview" },
  { view: "inbox", glyph: "◉", key: "rail.inbox", fallback: "Inbox" },
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
  // Sessions grouped by project, the way the herd is actually read.
  const groups = new Map<string, Tile[]>();
  for (const t of tiles) {
    const g = t.project || t.name;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }

  const meta: Record<View, number | undefined> = {
    overview: undefined,
    inbox: counts.inbox || undefined,
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
            <Button
              bare
              key={t.id}
              className={`railitem${openId === t.id ? " active" : ""}`}
              data-status={stateOf(t)}
              data-unattended={unattended(t) ? "yes" : undefined}
              title={detailOf(t) || undefined}
              onClick={() => onOpen(t.id)}
            >
              <span className={`rdot dot ${stateOf(t)}`}>▣</span>
              <span className="rtext">
                <span className="rname">{titleOf(t)}</span>
                <span className="rsub">{railLine(t)}</span>
              </span>
            </Button>
          ))}
        </div>
      ))}
    </nav>
  );
}
