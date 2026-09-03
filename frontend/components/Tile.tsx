"use client";

import { shortNumber } from "@/lib/format";
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
        {/* Tokens, not a percentage.
            The hook adds up input, output and both cache figures and puts the
            sum here; the tile hung a % on it, so a session with 388,650 tokens
            behind it reported that it was 388650% full. A share of something
            would need the model's window size, which differs per model and goes
            stale the moment one changes — the count is the honest number. */}
        {tile.context ? (
          <span className="ctx" title={tr("tile.contextTip", "Tokens behind this conversation")}>
            {shortNumber(tile.context)}
          </span>
        ) : null}
        {agentOf(tile) ? <span className="agent">{agentOf(tile)}</span> : null}
      </div>
    </div>
  );
}
