"use client";

import { useEffect, useState } from "react";
import Tile from "@/components/Tile";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { bindingOf, caption } from "@/lib/keymap";
import type { Agent, Tile as TileData } from "@/lib/types";

// The herd. Empty it explains itself rather than showing a blank field.
export default function Overview({
  tiles,
  onOpen,
  onNew,
  onNewShell,
  onTemplates,
}: {
  tiles: TileData[];
  onOpen: (id: string) => void;
  /* What the board itself can start, offered under the right button on the
     space between the tiles and on the empty board. Absent where the board
     is shown without the shell behind it. */
  onNew?: () => void;
  onNewShell?: () => void;
  onTemplates?: () => void;
}) {
  /* The CLIs this daemon actually knows, asked rather than typed out.
   *
   * This line used to be part of the translated sentence: six names written by
   * hand, which had already drifted — the daemon knows seven profiles, and a
   * name added to it would never have reached this text.
   *
   * The fallback profile is left out by what it is, not by its name: it is the
   * one with nothing to match on, which is precisely what makes it the thing
   * that catches everything else rather than a CLI somebody could start. */
  const [agents, setAgents] = useState<Agent[]>([]);
  useEffect(() => {
    api.agents()
      .then((all) => setAgents(all.filter((a) => a.match.length > 0)))
      .catch(() => setAgents([]));
  }, []);

  const ctx = useContextMenu();
  // The board's own menu: what can be started from here. Tiles have their own.
  const boardMenu: MenuItem[] = [
    ...(onNew ? [{ label: tr("palette.newSession", "New session"), hint: caption(bindingOf("newSession")), onClick: onNew }] : []),
    ...(onNewShell ? [{ label: tr("overview.menuNewShell", "New shell"), onClick: onNewShell }] : []),
    ...(onTemplates ? [{ label: tr("palette.templates", "Templates"), onClick: onTemplates }] : []),
  ];

  if (tiles.length === 0) {
    return (
      <div className="empty" onContextMenu={ctx(boardMenu)}>
        <div className="emptybox">
          <p className="emptyhead">{tr("empty.noSessions", "no sessions")}</p>
          <p>
            {tr(
              "empty.explain",
              "Use + NEW to start a CLI in a terminal of its own. It keeps running when you close this window.",
            )}
          </p>
          <ul className="emptyagents">
            {agents.map((a) => (
              <li key={a.name}>{a.label}</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <section className="grid" onContextMenu={ctx(boardMenu)}>
      {tiles.map((t) => (
        <Tile
          key={t.id}
          tile={t}
          onOpen={() => onOpen(t.id)}
          /* Started again under the same id: the tile that was stopped is the
             tile that runs, so there is nothing to tidy up here and no third
             tile to explain. */
          onResume={() => api.resume(t.id).then((s) => onOpen(s.id)).catch(() => undefined)}
          onForget={() => void api.forget(t.id).catch(() => undefined)}
        />
      ))}
    </section>
  );
}
