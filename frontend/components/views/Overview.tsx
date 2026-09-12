"use client";

import { useEffect, useState } from "react";
import Tile from "@/components/Tile";
import Button from "@/components/ui/Button";
import TopStrip from "@/components/ui/TopStrip";
import Tooltip from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { OVERVIEW_DENSE, PREFS_CHANGED, setDense } from "@/lib/prefsEvents";
import type { Agent, Tile as TileData } from "@/lib/types";

// The herd. Empty it explains itself rather than showing a blank field.
export default function Overview({
  tiles,
  onOpen,
}: {
  tiles: TileData[];
  onOpen: (id: string) => void;
}) {
  /* The CLIs the service actually knows, asked rather than typed out.
   *
   * This line used to be part of the translated sentence: six names written by
   * hand, which had already drifted — the service knows seven profiles, and a
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

  /* How tightly the tiles are packed.
   *
   * Comfortable is the reading view: a few sessions, each with room for its
   * last lines. Dense is the session grid — every session at a glance, more
   * columns, shorter tiles. Kept in prefs under `overviewDense`, so it is the
   * same in every window and after a restart; the MENU's "Session grid" asks
   * for dense from outside the panel through OVERVIEW_DENSE. */
  const [dense, setDenseHere] = useState(false);
  useEffect(() => {
    api
      .prefs()
      .then((p) => setDenseHere(p.overviewDense === true))
      .catch(() => undefined);
    const fromPrefs = (e: Event) => {
      const prefs = (e as CustomEvent).detail as Record<string, unknown> | undefined;
      if (prefs && "overviewDense" in prefs) setDenseHere(prefs.overviewDense === true);
    };
    const asked = (e: Event) => setDenseHere(Boolean((e as CustomEvent).detail));
    window.addEventListener(PREFS_CHANGED, fromPrefs);
    window.addEventListener(OVERVIEW_DENSE, asked);
    return () => {
      window.removeEventListener(PREFS_CHANGED, fromPrefs);
      window.removeEventListener(OVERVIEW_DENSE, asked);
    };
  }, []);

  const strip = (
    <TopStrip>
      <div className="listbar">
        <span className="prompt">{tr("overview.prompt", "sessions>")}</span>
        <span className="meta">{tiles.length}</span>
        <span className="spacer" />
        <Tooltip text={tr("overview.densityTip", "How tightly the tiles are packed: room to read, or every session at a glance")}>
          <span className="rowInline">
            <Button tiny on={!dense} data-do="comfortable" onClick={() => setDense(false)}>
              {tr("overview.comfortable", "COMFORTABLE")}
            </Button>
            <Button tiny on={dense} data-do="dense" onClick={() => setDense(true)}>
              {tr("overview.dense", "DENSE")}
            </Button>
          </span>
        </Tooltip>
      </div>
    </TopStrip>
  );

  if (tiles.length === 0) {
    return (
      <div className="overviewPanel">
        {strip}
        <div className="empty">
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
      </div>
    );
  }
  return (
    <div className="overviewPanel">
      {strip}
      <section className="grid" data-dense={dense ? "yes" : undefined}>
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
    </div>
  );
}
