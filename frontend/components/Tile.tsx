"use client";

import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { shortNumber } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { sessionMenu } from "@/lib/sessionMenu";
import { agentOf, detailOf, stateOf, tileLine, titleOf, unattended } from "@/lib/state";
import type { Tile as TileData } from "@/lib/types";

// One session at a glance. Corner brackets mark it as an instrument reading.
export default function Tile({
  tile,
  onOpen,
  onResume,
  onForget,
}: {
  tile: TileData;
  onOpen: () => void;
  onResume?: () => void;
  onForget?: () => void;
}) {
  const state = stateOf(tile);
  // A session that has stopped is not rubbish: its transcript is still there,
  // and picking it up again is one command. Until now the only way to it led
  // through the archive, and came back as a third tile beside the two dead ones
  // it was meant to replace.
  const stopped = state === "dead" || state === "orphaned";

  const ctx = useContextMenu();
  // The one list every place a session is met offers — see lib/sessionMenu.
  // The board starts an ended session its own way, and opens it afterwards.
  const menu: MenuItem[] = sessionMenu(tile, onOpen, { restart: onResume, forget: onForget });

  return (
    <Tooltip text={unattended(tile) ? tr("tile.unattended", "Started with its permission prompts turned off — nothing will stop it to ask") : undefined}>
    <div
      className="tile"
      data-status={state}
      data-stuck={tile.stuck ? "yes" : undefined}
      data-unattended={unattended(tile) ? "yes" : undefined}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onContextMenu={ctx(menu)}
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
        <Tooltip text={detailOf(tile) || undefined}>
          <span className="act">{tileLine(tile)}</span>
        </Tooltip>
        {/* Tokens, not a percentage.
            The hook adds up input, output and both cache figures and puts the
            sum here; the tile hung a % on it, so a session with 388,650 tokens
            behind it reported that it was 388650% full. A share of something
            would need the model's window size, which differs per model and goes
            stale the moment one changes — the count is the honest number. */}
        {tile.context ? (
          <Tooltip text={tr("tile.contextTip", "Tokens behind this conversation")}>
            <span className="ctx">{shortNumber(tile.context)}</span>
          </Tooltip>
        ) : null}
        {agentOf(tile) ? <span className="agent">{agentOf(tile)}</span> : null}
      </div>
      {stopped && (onResume || onForget) ? (
        <div className="tactions" onClick={(e) => e.stopPropagation()}>
          {onResume ? (
            <Tooltip text={tr("session.restartTip", "Start this session again, right here, under the same id")}>
              <Button tiny data-do="resume" onClick={onResume}>
                {tr("session.restart", "RESTART")}
              </Button>
            </Tooltip>
          ) : null}
          {onForget ? (
            <Tooltip text={tr("tile.forgetTip", "Take it off the board. The transcript stays in the archive.")}>
              <Button tiny data-do="forget" onClick={onForget}>
                {tr("tile.forget", "CLEAR")}
              </Button>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
    </Tooltip>
  );
}
