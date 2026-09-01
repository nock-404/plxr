"use client";

import { tr } from "@/lib/i18n";
import { agentOf, detailOf, stateOf, tileLine, titleOf, unattended } from "@/lib/state";
import type { Tile as TileData } from "@/lib/types";

// One session at a glance. Corner brackets mark it as an instrument reading.
export default function Tile({ tile, onOpen }: { tile: TileData; onOpen: () => void }) {
  const state = stateOf(tile);
  return (
    <div
      className="tile"
      data-status={state}
      data-stuck={tile.stuck ? "yes" : undefined}
      data-unattended={unattended(tile) ? "yes" : undefined}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      title={unattended(tile) ? tr("tile.unattended", "Started with its permission prompts turned off — nothing will stop it to ask") : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="thead">
        <span className={`dot ${state}`}>●</span>
        <span className="tname">{titleOf(tile)}</span>
        {/* The folder, and the branch when there is one. Left out when it only
            repeats the name, which is the usual case for a plain shell. */}
        <span className="tproj">
          {[tile.project === titleOf(tile) ? "" : tile.project, tile.branch].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="tbody">{tile.question || tile.preview}</div>
      <div className="tfoot">
        <span className="act" title={detailOf(tile) || undefined}>{tileLine(tile)}</span>
        {tile.context ? <span className="ctx">{tile.context}%</span> : null}
        {agentOf(tile) ? <span className="agent">{agentOf(tile)}</span> : null}
      </div>
    </div>
  );
}
