"use client";

import { useCallback, useEffect, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import type { SearchAddon } from "@xterm/addon-search";
import Button from "@/components/ui/Button";
import Files from "@/components/Files";
import Find from "@/components/Find";
import Marks from "@/components/Marks";
import Player from "@/components/Player";
import Queue from "@/components/Queue";
import Rules from "@/components/Rules";
import Viewer from "@/components/Viewer";
import Select from "@/components/ui/Select";
import Terminal from "@/components/Terminal";
import { errText, tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { shortPath } from "@/lib/format";
import { titleOf } from "@/lib/state";
import type { Account, Tile } from "@/lib/types";

// One open session: the terminal, and the tools that act on it.
export default function Session({
  tile,
  others,
  onBack,
  onReplaced,
}: {
  tile: Tile;
  others: Tile[];
  onBack: () => void;
  /* Called when this session has been replaced by another with a new id —
     moving to a different account does exactly that. */
  onReplaced?: (id: string) => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [files, setFiles] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pane, setPane] = useState<"none" | "rules" | "marks" | "player">("none");
  const [queueOpen, setQueueOpen] = useState(false);

  // Moving a run to another account needs a Claude session to move.
  const canSwitch = Boolean(tile.claude_session_id);

  // A second pane alongside, and find in whichever pane has focus.
  const [split, setSplit] = useState<string | null>(null);
  const [activePane, setActivePane] = useState(0);
  const [find, setFind] = useState(false);
  const [addons, setAddons] = useState<(SearchAddon | null)[]>([null, null]);

  const takeAddon = useCallback(
    (index: number) => (addon: SearchAddon | null) =>
      setAddons((a) => {
        const next = [...a];
        next[index] = addon;
        return next;
      }),
    [],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    api.accounts().then((a) => setAccounts(a ?? [])).catch(() => setAccounts([]));
  }, []);

  const accountOptions = accounts.map((a) => ({
    value: a.name,
    label: tr("accounts.numbered", `account ${a.number}`, { n: a.number }),
  }));

  return (
    <section className="session">
      <TopStrip>
        <div className="sessbar">
          <span className="sesstitle">{titleOf(tile)}</span>
          <span className="meta">{shortPath(tile.cwd)}</span>
          <span className="spacer" />
          <Button on={files} onClick={() => setFiles((f) => !f)}>{tr("session.files", "FILES")}</Button>
          <Button
            on={queueOpen}
            onClick={() => setQueueOpen((q) => !q)}
            title={tr("queue.tip", "Line instructions up instead of sending them at once")}
          >
            {tr("queue.open", "QUEUE")}
          </Button>
          <Button on={pane === "rules"} onClick={() => setPane((p) => (p === "rules" ? "none" : "rules"))}>
            {tr("session.rules", "RULES")}
          </Button>
          <Button
            on={pane === "player"}
            onClick={() => setPane((p) => (p === "player" ? "none" : "player"))}
            title={tr("player.tip", "Watch this session back")}
          >
            {tr("player.open", "PLAYBACK")}
          </Button>
          <Button on={pane === "marks"} onClick={() => setPane((p) => (p === "marks" ? "none" : "marks"))}>
            {tr("marks.open", "MARKS")}
          </Button>
          <Button
            on={Boolean(split)}
            onClick={() => setSplit((v) => (v ? null : (others[0]?.id ?? null)))}
            disabled={!split && others.length === 0}
            title={
              others.length === 0
                ? tr("session.splitNone", "There is no second session to place alongside.")
                : tr("session.splitTip", "Put a second session next to this one")
            }
          >
            {tr("session.split", "SPLIT")}
          </Button>
          {accountOptions.length ? (
            canSwitch ? (
              <Select
                value={tile.account ?? accountOptions[0].value}
                options={accountOptions}
                /* The answer is not thrown away any more.
                   A switch that failed said nothing at all: the picker snapped
                   back and that was the whole report. Somebody whose account
                   had just run into its limit was left guessing. */
                onChange={(account) => {
                  setSwitching(true);
                  setSwitchError("");
                  api
                    .switchAccount(tile.id, account)
                    .then((moved) => onReplaced?.(moved.id))
                    .catch((e) => setSwitchError(errText(e)))
                    .finally(() => setSwitching(false));
                }}
                disabled={switching}
                title={tr("session.accountTip", "Continue under another account")}
              />
            ) : (
              <span
                className="meta"
                title={tr("session.accountBlocked", "No Claude session id is known here, so there is nothing to move.")}
              >
                {tile.account ?? ""}
              </span>
            )
          ) : null}
          {/* Said out loud, where the switch was made. */}
          {switchError ? <span className="notice warn">{switchError}</span> : null}
          {tile.frozen ? (
            <Button onClick={() => api.unfreeze(tile.id)}>{tr("session.resume", "RESUME")}</Button>
          ) : (
            <Button onClick={() => api.freeze(tile.id)}>{tr("session.pause", "PAUSE")}</Button>
          )}
          <Button
            onClick={() => {
              api.kill(tile.id).catch(() => undefined);
              onBack();
            }}
          >
            {tr("session.kill", "TERMINATE")}
          </Button>
        </div>
      </TopStrip>

      <div className="sesssplit" data-files={files ? "open" : undefined}>
        {files ? <Files sessionId={tile.id} root={tile.cwd} onPick={setPicked} /> : null}
        <div className="panes">
          <Terminal
            id={tile.id}
            label={tile.agent_label || tr("session.terminal", "Terminal")}
            onClose={onBack}
            onSearch={takeAddon(0)}
            active={activePane === 0}
            onFocus={() => setActivePane(0)}
          />
          {split ? (
            <Terminal
              id={split}
              label={others.find((o) => o.id === split)?.name ?? tr("session.terminal", "Terminal")}
              onClose={() => setSplit(null)}
              onSearch={takeAddon(1)}
              active={activePane === 1}
              onFocus={() => setActivePane(1)}
            />
          ) : null}
        </div>
        {find ? <Find addon={addons[activePane]} onClose={() => setFind(false)} /> : null}
        {pane === "rules" ? <Rules sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "marks" ? <Marks sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "player" ? <Player id={tile.id} onClose={() => setPane("none")} /> : null}
        {picked ? <Viewer sessionId={tile.id} path={picked} onClose={() => setPicked(null)} /> : null}
      </div>

      {queueOpen ? <Queue tile={tile} /> : null}
    </section>
  );
}
