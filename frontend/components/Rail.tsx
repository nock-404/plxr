"use client";

import Button from "@/components/ui/Button";
import Icon from "@/components/ui/Icon";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { tr } from "@/lib/i18n";
import { accountName } from "@/lib/format";
import { sessionMenu } from "@/lib/sessionMenu";
import { detailOf, railLine, stateOf, titleOf, unattended } from "@/lib/state";
import { isHot, useLimits, worst } from "@/lib/useLimits";
import type { Tile } from "@/lib/types";
import { chordOf, viewDef } from "@/lib/tools";

// The rail always stays, even inside a session — otherwise looking into one
// loses sight of the rest of the herd.
export type View = "overview" | "inbox" | "folders" | "changes" | "review" | "search" | "ports" | "usage" | "archive" | "session" | "notes";

/* The views the rail opens, in the order it shows them. What each one is
   called, the mark it wears and the chord that reaches it are read from the
   registry in lib/tools.ts — the same mark on the rail and on the tab of the
   panel it opens, so one thing is one icon wherever it is met. */
type Home = Exclude<View, "session">;
const HOME: Home[] = ["overview", "inbox", "folders", "changes", "review", "search", "ports", "usage", "archive", "notes"];

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
  const ctx = useContextMenu();
  /* The same actions the overview tile offers under the right button, here
     on the rail entry: the rail is where a session is reached most, so it
     offers them too — from the one list in lib/sessionMenu. */
  const railMenu = (t: Tile): MenuItem[] => sessionMenu(t, onOpen);

  /* A view under the right button: open it where it usually goes, open it in
     a group of its own, or put the whole arrangement back. */
  const homeMenu = (v: Home): MenuItem[] => [
    { label: tr("tile.menuOpen", "Open"), hint: chordOf(v), onClick: () => onView(v) },
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

  /* Which accounts are close to the end of a window, so USAGE on the rail
     says so before somebody starts a long run on one of them. Nothing is
     drawn before the first answer: a rail that is quiet because it has not
     asked yet looks exactly like one that has asked and found nothing. */
  const { report, at } = useLimits();
  const nearlyOut = (report?.accounts ?? []).filter((a) => isHot(a, at));
  const usageTip = nearlyOut.length
    ? tr("rail.usageHot", "{names} nearly out: {pct}% of one window used", {
        names: nearlyOut.map((a) => accountName(a)).join(", "),
        pct: Math.max(...nearlyOut.map((a) => worst(a)?.percent ?? 0)),
      })
    : "";

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
    notes: undefined,
  };

  return (
    <nav className="rail">
      {HOME.map((h) => {
        const hot = h === "usage" && nearlyOut.length > 0;
        const def = viewDef(h);
        const entry = (
          <Button
            bare
            key={h}
            className={`railitem railhome${view === h ? " active" : ""}${hot ? " railhot" : ""}`}
            data-view={h}
            data-nearly-out={hot ? "yes" : undefined}
            onClick={() => onView(h)}
            onContextMenu={ctx(homeMenu(h))}
          >
            <span className="rdot"><Icon name={def.icon} /></span>
            <span className="rname">{tr(def.key, def.fallback)}</span>
            {hot ? <span className="rmeta">{tr("rail.nearlyOut", "!")}</span> : meta[h] ? <span className="rmeta">{meta[h]}</span> : null}
          </Button>
        );
        return hot ? (
          <Tooltip key={h} text={usageTip}>
            {entry}
          </Tooltip>
        ) : (
          entry
        );
      })}
      {onNewShell ? (
        <Tooltip text={tr("rail.newShellTip", "A plain shell in the folder of the session you are working in, beside it")}>
          <Button bare className="railitem railhome" data-do="new-shell" onClick={onNewShell}>
            <span className="rdot"><Icon name="plus" /></span>
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
                <span className={`rdot dot ${stateOf(t)}`}><Icon name="terminal" /></span>
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
