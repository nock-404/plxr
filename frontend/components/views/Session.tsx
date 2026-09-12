"use client";

import { useCallback, useEffect, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import OverflowBar from "@/components/ui/OverflowBar";
import type { SearchAddon } from "@xterm/addon-search";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import Files from "@/components/Files";
import Find from "@/components/Find";
import Marks from "@/components/Marks";
import Player from "@/components/Player";
import Queue from "@/components/Queue";
import Rules from "@/components/Rules";
import Select from "@/components/ui/Select";
import Terminal from "@/components/Terminal";
import { errText, tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { matches } from "@/lib/keymap";
import { shortPath } from "@/lib/format";
import { titleOf } from "@/lib/state";
import type { Account, Tile } from "@/lib/types";

// One open session: the terminal, and the tools that act on it.
export default function Session({
  tile,
  others,
  onBack,
  onReplaced,
  onOpenFile,
  onChanges,
}: {
  tile: Tile;
  others: Tile[];
  onBack: () => void;
  /* Called when this session has been replaced by another with a new id —
     moving to a different account does exactly that. */
  onReplaced?: (id: string) => void;
  /* A file picked in the tree. It opens as a panel beside this one — the
     terminal stays where it is — so the session itself holds no editor. */
  onOpenFile: (path: string) => void;
  /* Source control for this session's folder, as a panel beside it. */
  onChanges?: () => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  const [files, setFiles] = useState(false);
  const [pane, setPane] = useState<"none" | "rules" | "marks" | "player">("none");
  const [queueOpen, setQueueOpen] = useState(false);

  // Moving a run to another account needs a Claude session to move.
  const canSwitch = Boolean(tile.claude_session_id);

  /* Starting again happens under the same id, so nothing here navigates: the
     tile turns alive on the next snapshot and the terminal reattaches by
     itself. A refusal — the folder is not mounted, say — lands in the bar,
     once; the terminal's own panel is handed a promise that never throws, so
     the same sentence is not shown twice. */
  const restart = useCallback(() => {
    setRestarting(true);
    setRestartError("");
    return api
      .resume(tile.id)
      .catch((e) => setRestartError(errText(e)))
      .finally(() => setRestarting(false));
  }, [tile.id]);

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
      if (matches(e, "find")) {
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

  const account = accountOptions.length
    ? canSwitch
      ? (
          <Select
            value={tile.account ?? accountOptions[0].value}
            options={accountOptions}
            /* The answer is not thrown away any more.
               A switch that failed said nothing at all: the picker snapped back
               and that was the whole report. Somebody whose account had just
               run into its limit was left guessing. */
            onChange={(acct) => {
              setSwitching(true);
              setSwitchError("");
              api
                .switchAccount(tile.id, acct)
                .then((moved) => onReplaced?.(moved.id))
                .catch((e) => setSwitchError(errText(e)))
                .finally(() => setSwitching(false));
            }}
            disabled={switching}
            tip={tr("session.accountTip", "Continue under another account")}
          />
        )
      : (
          <Tooltip text={tr("session.accountBlocked", "No Claude session id is known here, so there is nothing to move.")}>
            <span className="meta">{tile.account ?? ""}</span>
          </Tooltip>
        )
    : null;

  const barItems = [
    { key: "files", node: <Button on={files} onClick={() => setFiles((f) => !f)}>{tr("session.files", "FILES")}</Button> },
    ...(onChanges
      ? [
          {
            key: "changes",
            node: (
              <Tooltip text={tr("session.changesTip", "What changed in this folder, beside the terminal")}>
                <Button onClick={onChanges}>{tr("git.open", "CHANGES")}</Button>
              </Tooltip>
            ),
          },
        ]
      : []),
    {
      key: "queue",
      node: (
        <Tooltip text={tr("queue.tip", "Line instructions up instead of sending them at once")}>
          <Button on={queueOpen} onClick={() => setQueueOpen((q) => !q)}>
            {tr("queue.open", "QUEUE")}
          </Button>
        </Tooltip>
      ),
    },
    {
      key: "rules",
      node: (
        <Button on={pane === "rules"} onClick={() => setPane((p) => (p === "rules" ? "none" : "rules"))}>
          {tr("session.rules", "RULES")}
        </Button>
      ),
    },
    {
      key: "player",
      node: (
        <Tooltip text={tr("player.tip", "Watch this session back")}>
          <Button on={pane === "player"} onClick={() => setPane((p) => (p === "player" ? "none" : "player"))}>
            {tr("player.open", "PLAYBACK")}
          </Button>
        </Tooltip>
      ),
    },
    {
      key: "marks",
      node: (
        <Button on={pane === "marks"} onClick={() => setPane((p) => (p === "marks" ? "none" : "marks"))}>
          {tr("marks.open", "MARKS")}
        </Button>
      ),
    },
    {
      key: "split",
      node: (
        <Tooltip
          text={
            others.length === 0
              ? tr("session.splitNone", "There is no second session to place alongside.")
              : tr("session.splitTip", "Put a second session next to this one")
          }
        >
          <Button
            on={Boolean(split)}
            onClick={() => setSplit((v) => (v ? null : (others[0]?.id ?? null)))}
            disabled={!split && others.length === 0}
          >
            {tr("session.split", "SPLIT")}
          </Button>
        </Tooltip>
      ),
    },
    ...(account ? [{ key: "account", node: account }] : []),
    ...(switchError ? [{ key: "switchError", node: <span className="notice warn">{switchError}</span> }] : []),
    ...(restartError ? [{ key: "restartError", node: <span className="notice warn">{restartError}</span> }] : []),
    /* A session that has ended has nothing to pause or terminate. What it has
       is a way back: the same id, the same panel, started again. */
    ...(tile.alive
      ? [
          {
            key: "pause",
            node: tile.frozen ? (
              <Button onClick={() => api.unfreeze(tile.id)}>{tr("session.resume", "RESUME")}</Button>
            ) : (
              <Button onClick={() => api.freeze(tile.id)}>{tr("session.pause", "PAUSE")}</Button>
            ),
          },
          {
            key: "kill",
            node: (
              <Button
                onClick={() => {
                  api.kill(tile.id).catch(() => undefined);
                  onBack();
                }}
              >
                {tr("session.kill", "TERMINATE")}
              </Button>
            ),
          },
        ]
      : [
          {
            key: "restart",
            node: (
              <Tooltip text={tr("session.restartTip", "Start this session again, right here, under the same id")}>
                <Button primary busy={restarting} onClick={() => void restart()}>
                  {tr("session.restart", "RESTART")}
                </Button>
              </Tooltip>
            ),
          },
        ]),
  ];

  /* The same actions under the right button on the title, so a session's
     controls are one click away even when the bar has folded them under "⋯". */
  const ctx = useContextMenu();
  const titleMenu: MenuItem[] = [
    { label: tr("session.files", "FILES"), checked: files, onClick: () => setFiles((f) => !f) },
    ...(onChanges ? [{ label: tr("git.open", "CHANGES"), onClick: onChanges }] : []),
    { label: tr("queue.open", "QUEUE"), checked: queueOpen, onClick: () => setQueueOpen((q) => !q) },
    { label: tr("session.rules", "RULES"), checked: pane === "rules", onClick: () => setPane((p) => (p === "rules" ? "none" : "rules")) },
    { label: tr("player.open", "PLAYBACK"), checked: pane === "player", onClick: () => setPane((p) => (p === "player" ? "none" : "player")) },
    { label: tr("marks.open", "MARKS"), checked: pane === "marks", onClick: () => setPane((p) => (p === "marks" ? "none" : "marks")) },
    {
      label: tr("session.split", "SPLIT"),
      checked: Boolean(split),
      disabled: !split && others.length === 0,
      onClick: () => setSplit((v) => (v ? null : (others[0]?.id ?? null))),
    },
    { separator: true },
    ...(tile.alive
      ? [
          tile.frozen
            ? { label: tr("session.resume", "RESUME"), onClick: () => void api.unfreeze(tile.id).catch(() => undefined) }
            : { label: tr("session.pause", "PAUSE"), onClick: () => void api.freeze(tile.id).catch(() => undefined) },
          {
            label: tr("session.kill", "TERMINATE"),
            danger: true,
            onClick: () => {
              api.kill(tile.id).catch(() => undefined);
              onBack();
            },
          },
        ]
      : [{ label: tr("session.restart", "RESTART"), onClick: () => void restart() }]),
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(tile.cwd).catch(() => undefined) },
  ];

  return (
    <section className="session">
      <TopStrip>
        <OverflowBar
          className="sessbar"
          moreTitle={tr("session.more", "More actions")}
          left={
            <>
              <span className="sesstitle" onContextMenu={ctx(titleMenu)}>{titleOf(tile)}</span>
              <Tooltip text={tile.cwd}>
                <span className="meta">{shortPath(tile.cwd)}</span>
              </Tooltip>
            </>
          }
          items={barItems}
        />
      </TopStrip>

      <div className="sesssplit">
        {files ? <Files rootId={tile.id} root={tile.cwd} onPick={onOpenFile} /> : null}
        <div className="panes">
          <Terminal
            id={tile.id}
            label={tile.agent_label || tr("session.terminal", "Terminal")}
            onClose={onBack}
            onSearch={takeAddon(0)}
            onFind={() => {
              setActivePane(0);
              setFind(true);
            }}
            active={activePane === 0}
            onFocus={() => setActivePane(0)}
            ended={!tile.alive}
            orphaned={Boolean(tile.orphaned)}
            exitCode={tile.exit_code}
            onRestart={restart}
          />
          {split ? (
            <Terminal
              id={split}
              label={others.find((o) => o.id === split)?.name ?? tr("session.terminal", "Terminal")}
              onClose={() => setSplit(null)}
              onSearch={takeAddon(1)}
              onFind={() => {
                setActivePane(1);
                setFind(true);
              }}
              active={activePane === 1}
              onFocus={() => setActivePane(1)}
              ended={others.some((o) => o.id === split && !o.alive)}
              orphaned={Boolean(others.find((o) => o.id === split)?.orphaned)}
              exitCode={others.find((o) => o.id === split)?.exit_code ?? 0}
              onRestart={() => api.resume(split)}
            />
          ) : null}
        </div>
        {find ? <Find addon={addons[activePane]} onClose={() => setFind(false)} /> : null}
        {pane === "rules" ? <Rules sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "marks" ? <Marks sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "player" ? <Player id={tile.id} onClose={() => setPane("none")} /> : null}
      </div>

      {queueOpen ? <Queue tile={tile} /> : null}
    </section>
  );
}
