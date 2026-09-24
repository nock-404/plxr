"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import TopStrip from "@/components/ui/TopStrip";
import OverflowBar from "@/components/ui/OverflowBar";
import type { SearchAddon } from "@xterm/addon-search";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, useMenu, type MenuItem } from "@/components/ui/Menu";
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
import { accountName, shortPath } from "@/lib/format";
import { agentOf, barLine, titleOf } from "@/lib/state";
import { useAccounts } from "@/lib/useAccounts";
import { isHot, useAccountLimits, worst } from "@/lib/useLimits";
import type { Tile } from "@/lib/types";

// One open session: the terminal, and the tools that act on it.
export default function Session({
  tile,
  others,
  onBack,
  onReplaced,
  onOpenFile,
  onOpenFolder,
  onChanges,
}: {
  tile: Tile;
  others: Tile[];
  onBack: () => void;
  /* Called when this session has been replaced by another with a new id —
     moving to a different account does exactly that. */
  onReplaced?: (id: string) => void;
  /* A file picked in the tree, or a path clicked in the terminal — with the
     line it named, when it named one, and with the root to read it through
     when the tree has walked above this session's folder. It opens as a panel
     beside this one — the terminal stays where it is — so the session itself
     holds no editor. */
  onOpenFile: (path: string, line?: number, rootId?: string) => void;
  /* A folder clicked in a terminal: shown as a folder rather than handed to
     the editor, which has nothing to say about one. */
  onOpenFolder?: (path: string) => void;
  /* Source control for this session's folder, as a panel beside it. */
  onChanges?: () => void;
}) {
  // The window's one list, so an account added meanwhile is offered here too.
  const accounts = useAccounts() ?? [];
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState("");
  const [askKill, setAskKill] = useState(false);
  const [killing, setKilling] = useState(false);

  /* TERMINATE does not close the panel.
     It used to: the click sent the kill and left, so the ended state — the
     last lines, the exit code, RESTART — was never seen, and a session whose
     shell ignored the polite signal ran on with nothing showing it. Now the
     panel stays; the tile turns ended on the next snapshot and the terminal
     shows it. The service escalates on its own: TERM, then HUP, then KILL. */
  const kill = useCallback(() => {
    setAskKill(false);
    setKilling(true);
    api.kill(tile.id).catch(() => undefined);
  }, [tile.id]);
  useEffect(() => {
    if (!tile.alive) setKilling(false);
  }, [tile.alive]);
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

  /* ⌘F opens the find box of THIS session only.
   *
   * Every open session listened on the document, so one ⌘F opened a find box
   * in each of them — measured: three panels, three boxes. Now the key counts
   * here only when it was pressed inside this section, or, pressed outside
   * any session at all, when this section sits in the dock's active group. */
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!matches(e, "find")) return;
      const here = root.current;
      const target = e.target as Node | null;
      const inside = Boolean(here && target && here.contains(target));
      if (!inside) {
        const el = target as Element | null;
        if (el?.closest?.(".session")) return;
        if (!here?.closest(".dv-active-group")) return;
      }
      e.preventDefault();
      setFind(true);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // What is left on each of them, shared with the stripes and the usage view.
  const { accounts: limits, at: hotAt } = useAccountLimits();

  /* The picker says which account is nearly out of a window before the
     switch, not after it. Moving a run onto an account with nothing left is
     the move that costs the run — it was the only thing anybody could do
     about a limit, and it was made blind. */
  const accountOptions = accounts.map((a) => {
    const seen = limits.get(a.name);
    const top = seen ? worst(seen) : null;
    const name = accountName(a);
    return {
      value: a.name,
      label: seen && isHot(seen, hotAt) && top
        ? tr("accounts.nearlyOut", "{name} · {pct}% used", { name, pct: top.percent })
        : name,
    };
  });

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

  const menu = useMenu();
  const viewsOwner = `views:${tile.id}`;
  /* What can stand beside the terminal, as a list instead of a row.
   *
   * Seven buttons across the top — FILES CHANGES QUEUE RULES PLAYBACK MARKS
   * SPLIT — were the widest thing in the window and the first to be folded
   * away at any narrow width. They are all the same kind of thing: something
   * that is either shown beside the session or not. One button opens them,
   * each row says which way it stands, and the same list is what the title
   * offers under the right button. */
  const viewItems = (): MenuItem[] => [
    { label: tr("session.files", "FILES"), do: "files", icon: "files", checked: files, onClick: () => setFiles((f) => !f) },
    /* CHANGES opens a tool window rather than something beside the terminal,
       so it is not a switch and carries no tick — it keeps the column all the
       same, which is the menu's business now and not this list's. */
    ...(onChanges ? [{ label: tr("git.open", "CHANGES"), do: "changes", icon: "changes" as const, onClick: onChanges }] : []),
    { label: tr("queue.open", "QUEUE"), do: "queue", icon: "templates", checked: queueOpen, onClick: () => setQueueOpen((q) => !q) },
    { label: tr("session.rules", "RULES"), do: "rules", icon: "notes", checked: pane === "rules", onClick: () => setPane((p) => (p === "rules" ? "none" : "rules")) },
    { label: tr("player.open", "PLAYBACK"), do: "player", icon: "play", checked: pane === "player", onClick: () => setPane((p) => (p === "player" ? "none" : "player")) },
    { label: tr("marks.open", "MARKS"), do: "marks", icon: "archive", checked: pane === "marks", onClick: () => setPane((p) => (p === "marks" ? "none" : "marks")) },
    {
      label: tr("session.split", "SPLIT"),
      do: "split",
      icon: "panel-right",
      checked: Boolean(split),
      disabled: !split && others.length === 0,
      onClick: () => setSplit((v) => (v ? null : (others[0]?.id ?? null))),
    },
  ];
  const anyView = files || queueOpen || pane !== "none" || Boolean(split);

  const barItems = [
    {
      key: "views",
      node: (
        <Tooltip text={tr("session.viewsTip", "What stands beside the terminal: the tree, the changes, the queue, the recording")}>
          <Button
            on={anyView}
            data-do="views"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              menu.open(Math.round(r.left), Math.round(r.bottom + 4), viewItems(), { owner: viewsOwner, anchor: e.currentTarget });
            }}
          >
            {tr("session.views", "VIEWS")}
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
              <Tooltip text={tr("session.killTip", "End this session — the recording stays")}>
                <Button danger busy={killing} onClick={() => setAskKill(true)}>
                  {killing ? tr("session.terminating", "ENDING…") : tr("session.kill", "TERMINATE")}
                </Button>
              </Tooltip>
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
          /* Beside it, the other thing an ended session is for: closing the
             panel. The tile stays on the board, restartable, for hours. */
          {
            key: "close",
            node: <Button onClick={onBack}>{tr("common.close", "CLOSE")}</Button>,
          },
        ]),
  ];

  /* The same actions under the right button on the title, so a session's
     controls are one click away even when the bar has folded them under "⋯". */
  const ctx = useContextMenu();
  const titleMenu: MenuItem[] = [
    ...viewItems(),
    { separator: true },
    ...(tile.alive
      ? [
          tile.frozen
            ? { label: tr("session.resume", "RESUME"), onClick: () => void api.unfreeze(tile.id).catch(() => undefined) }
            : { label: tr("session.pause", "PAUSE"), onClick: () => void api.freeze(tile.id).catch(() => undefined) },
          {
            label: tr("session.kill", "TERMINATE"),
            danger: true,
            disabled: killing,
            onClick: () => setAskKill(true),
          },
        ]
      : [
          { label: tr("session.restart", "RESTART"), onClick: () => void restart() },
          { label: tr("common.close", "CLOSE"), onClick: onBack },
        ]),
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => void navigator.clipboard?.writeText(tile.cwd).catch(() => undefined) },
  ];

  return (
    <section className="session" ref={root}>
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
              {/* The state, here as well as on the tile and the tab: what the
                  agent is doing, or when it ended and with what. */}
              <span className="meta">{barLine(tile)}</span>
            </>
          }
          items={barItems}
        />
      </TopStrip>

      <div className="sesssplit">
        {files ? <Files rootId={tile.id} root={tile.cwd} onPick={(path, rootId) => onOpenFile(path, undefined, rootId)} /> : null}
        <div className="panes">
          <Terminal
            id={tile.id}
            /* No name on this one. The tab carries it and the bar above
               carries it, so a third copy in capitals was the same words three
               times over one terminal. What stands there instead is the one
               thing neither of them says: what the account has left.

               No close either: the panel's tab already has one, and two ways
               to close the same thing beside each other is one too many. The
               split pane below keeps both — there the name tells the halves
               apart and the ✕ closes that half, which nothing else does. */
            label=""
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
            endedAt={tile.ended_at}
            onRestart={restart}
            cwd={tile.cwd}
            onSplit={others.length || split ? () => setSplit((v) => (v ? null : (others[0]?.id ?? null))) : undefined}
            splitOn={Boolean(split)}
            onOpenPath={onOpenFile}
            /* The session's own actions, under the right button on the
               terminal: in the terminal view its bar is not drawn, and this is
               the only place they are. */
            sessionItems={() => titleMenu}
            account={tile.account ?? ""}
            onOpenFolder={onOpenFolder}
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
              endedAt={others.find((o) => o.id === split)?.ended_at}
              onRestart={() => api.resume(split)}
              onOpenPath={onOpenFile}
              cwd={others.find((o) => o.id === split)?.cwd}
              onSplit={() => setSplit(null)}
              splitOn
              account={others.find((o) => o.id === split)?.account ?? ""}
              onOpenFolder={onOpenFolder}
            />
          ) : null}
        </div>
        {find ? <Find addon={addons[activePane]} onClose={() => setFind(false)} /> : null}
        {pane === "rules" ? <Rules sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "marks" ? <Marks sessionId={tile.id} onClose={() => setPane("none")} /> : null}
        {pane === "player" ? <Player id={tile.id} onClose={() => setPane("none")} /> : null}
      </div>

      {queueOpen ? <Queue tile={tile} /> : null}

      {askKill ? (
        <Ask
          heading={tr("session.killAsk", "Really terminate this session?")}
          detail={tr(
            "session.killDetail",
            "It gets SIGTERM, then SIGHUP, then SIGKILL — everything it started ends with it. The recording stays, and RESTART brings it back under the same id.",
          )}
          confirmLabel={tr("session.kill", "TERMINATE")}
          danger
          onCancel={() => setAskKill(false)}
          onConfirm={kill}
        />
      ) : null}
    </section>
  );
}
