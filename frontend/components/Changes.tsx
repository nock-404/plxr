"use client";

import { ago } from "@/lib/format";
import { useCallback, useEffect, useRef, useState } from "react";
import Ask from "@/components/ui/Ask";
import Button from "@/components/ui/Button";
import Tooltip from "@/components/ui/Tooltip";
import { useContextMenu, type MenuItem } from "@/components/ui/Menu";
import { api } from "@/lib/api";
import { copyText } from "@/lib/browser";
import { errText, tr, trN } from "@/lib/i18n";
import Input from "@/components/ui/Input";
import { announceFilesChanged, type LiveChanges } from "@/lib/useChanges";
import type { GitChange, GitEntry, GitStash, GitWhere } from "@/lib/types";

/* What has changed in the folder, and what the change is.
 *
 * Staged and unstaged are kept apart because git keeps them apart: a file can
 * be staged and changed again since, and a list that folds the two into one
 * word cannot show that. So a file may appear in both groups, which is not a
 * mistake — it is the state.
 *
 * The difference is drawn from git's own unified diff. A merge view would be a
 * dependency with a stylesheet of its own, fighting four skins for the colours;
 * this way every colour comes from the palette like everything else.
 *
 * The list moves by itself when it is handed the live state (`live`): the
 * service watches the folder and pushes each new state, so a file an agent
 * writes shows up here without anyone pressing anything. AGAIN stays as the
 * manual way — for a list without a live feed, or for the doubt that a
 * press settles.
 */
const WORD: Record<string, [string, string]> = {
  M: ["git.modified", "changed"],
  A: ["git.added", "added"],
  D: ["git.deleted", "deleted"],
  R: ["git.renamed", "renamed"],
  C: ["git.copied", "copied"],
  "?": ["git.untracked", "new"],
  U: ["git.conflict", "conflict"],
  T: ["git.typechange", "type changed"],
};

/* git's letter as a word. Exported because the folder overview lists the files
   of a commit with the same letters, and a second table of them would be a
   second table to fall out of step. */
export function word(letter: string): string {
  const [key, fallback] = WORD[letter] ?? ["git.changed", "changed"];
  return tr(key, fallback);
}

export default function Changes({
  rootId,
  shown,
  onShow,
  onEdit,
  live,
  onOpenFiles,
  compact = false,
}: {
  rootId: string;
  shown: { path: string; staged: boolean } | null;
  /* The difference is drawn in the wide area, not here: a line of code is
     wider than a file name, and wrapping every one of them makes a hunk
     unreadable. So this list only says which one to show. */
  onShow: (what: { path: string; staged: boolean } | null) => void;
  /* The file itself, in an editor. Absent where there is no editor to open. */
  onEdit?: (path: string) => void;
  /* The folder's state as the service pushes it. Without it the list asks
     once and on AGAIN, the way it always did. */
  live?: LiveChanges;
  /* The folder's tree, as a panel — offered in the list's own menu where a
     dock is there to hold it. */
  onOpenFiles?: () => void;
  /* Embedded in something that already says where the folder stands and what
     it has been doing lately — the folder overview. The branch line and the
     history are left out there, because printing either of them twice on one
     screen is worse than printing neither. Everything else is the same list. */
  compact?: boolean;
}) {
  const [list, setList] = useState<GitChange[] | null>(null);
  const [problem, setProblem] = useState("");
  const [where, setWhere] = useState<GitWhere | null>(null);
  const [history, setHistory] = useState<GitEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // The commit message field, so the menu's "Commit…" can put the cursor in it.
  const messageField = useRef<HTMLInputElement>(null);
  // What is put aside; null until asked, so UNSTASH is not offered blind.
  const [stashes, setStashes] = useState<GitStash[] | null>(null);
  /* A question before something that cannot be taken back: throwing changes
     away, or a message for the stash. */
  const [asking, setAsking] = useState<{ kind: "discard"; paths: string[]; name: string; group: boolean } | { kind: "stash" } | null>(null);
  const ctx = useContextMenu();

  const load = useCallback(() => {
    setProblem("");
    api
      .changes(rootId)
      .then(setList)
      .catch((e) => {
        setProblem(errText(e));
        setList([]);
      });
    api.position(rootId).then(setWhere).catch(() => setWhere(null));
    api.history(rootId, 8).then(setHistory).catch(() => setHistory([]));
    api.stashes(rootId).then(setStashes).catch(() => setStashes(null));
  }, [rootId]);

  const isLive = live !== undefined;
  const liveRev = live?.rev ?? "";
  const liveHead = live?.head ?? "";

  // Without a live feed the list is asked for once, here.
  useEffect(() => {
    if (!isLive) load();
  }, [isLive, load]);

  /* With one, every new state replaces the list. A state that arrived is
     the truth about the folder, so it also replaces whatever a stage or an
     AGAIN put here a moment before. Keyed on the rev alone: the same state
     twice is nothing to redraw. */
  useEffect(() => {
    if (!live || !liveRev) return;
    setList(live.changes);
    setWhere(live.where);
    setProblem(live.problem ? errText(live.problem) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRev]);

  // The history is not in the feed — it only changes when HEAD moves, and
  // the feed says when that is.
  useEffect(() => {
    if (!isLive) return;
    api.history(rootId, 8).then(setHistory).catch(() => setHistory([]));
  }, [isLive, liveHead, rootId]);

  // The stashes are not in the feed either; a stash or a pop moves the rev,
  // so they are asked for again with every new state.
  useEffect(() => {
    if (!isLive || !liveRev) return;
    api.stashes(rootId).then(setStashes).catch(() => setStashes(null));
  }, [isLive, liveRev, rootId]);

  async function stage(paths: string[], on: boolean) {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      setList(await api.stage(rootId, paths, on));
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  async function commit() {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      const { hash } = await api.commit(rootId, message);
      setMessage("");
      setNote(tr("git.committed", "committed as {hash}", { hash }));
      load();
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  /* Throwing working-tree changes away. The service answers with the list as
     it stands afterwards, the way a stage does, and the rest of the window —
     an open editor, the tree — is told the folder moved. */
  async function discard(paths: string[]) {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      setList(await api.discard(rootId, paths));
      setNote(trN("git.discarded", paths.length, "{n} change thrown away", "{n} changes thrown away"));
      announceFilesChanged({ rootId, rev: "", head: liveHead });
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  async function stash(message: string) {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      setStashes(await api.stashPush(rootId, message));
      setNote(tr("git.stashed", "put aside"));
      load();
      announceFilesChanged({ rootId, rev: "", head: liveHead });
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  async function unstash() {
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      setStashes(await api.stashPop(rootId));
      setNote(tr("git.unstashed", "taken back into the tree"));
      load();
      announceFilesChanged({ rootId, rev: "", head: liveHead });
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  /* One file under the right button: what its row's buttons do, at the
     pointer, the two things the row has no room for — its path to the
     clipboard, and the file where the system shows files — and the one thing
     the buttons do not: throwing the change away. That last one only for the
     working-tree groups: a staged change is taken OUT first, the way git
     keeps the two apart. */
  const rowMenu = (c: GitChange, areStaged: boolean): MenuItem[] => [
    { label: tr("git.menuDiff", "Show diff"), onClick: () => show(c.path, areStaged) },
    ...(onEdit && (areStaged ? c.index : c.work) !== "D"
      ? [{ label: tr("git.menuEdit", "Edit"), onClick: () => onEdit(c.path) }]
      : []),
    areStaged
      ? { label: tr("git.menuUnstage", "Unstage"), disabled: busy, onClick: () => void stage([c.path], false) }
      : { label: tr("git.menuStage", "Stage"), disabled: busy, onClick: () => void stage([c.path], true) },
    { separator: true },
    { label: tr("files.copy", "COPY PATH"), onClick: () => copyText(c.path) },
    { label: tr("files.reveal", "SHOW"), onClick: () => void api.revealFile(rootId, c.path).catch((e) => setProblem(errText(e))) },
    ...(areStaged
      ? []
      : [
          { separator: true as const },
          {
            label: tr("git.discard", "Discard changes"),
            danger: true,
            disabled: busy,
            onClick: () => setAsking({ kind: "discard", paths: [c.path], name: c.path, group: false }),
          },
        ]),
  ];

  /* The list's own menu, on the space between the groups: read the folder
     again, go to the commit message, or open the folder's tree beside it. */
  const listMenu = (): MenuItem[] => [
    { label: tr("git.menuRefresh", "Refresh"), onClick: load },
    {
      label: tr("git.menuCommit", "Commit…"),
      disabled: staged.length === 0,
      onClick: () => {
        messageField.current?.focus();
        messageField.current?.select();
      },
    },
    ...(onOpenFiles ? [{ separator: true as const }, { label: tr("git.menuFiles", "Open in Files"), onClick: onOpenFiles }] : []),
  ];

  const groupMenu = (rows: GitChange[], areStaged: boolean, head: string): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: areStaged ? tr("git.unstageAllTip", "Take all of these out of the next commit") : tr("git.stageAllTip", "Put all of these into the next commit"),
        disabled: busy,
        onClick: () => void stage(rows.map((r) => r.path), !areStaged),
      },
    ];
    if (!areStaged) {
      items.push({ separator: true });
      items.push({
        label: tr("git.discardAll", "Discard all in this group"),
        danger: true,
        disabled: busy,
        onClick: () => setAsking({ kind: "discard", paths: rows.map((r) => r.path), name: head, group: true }),
      });
    }
    return items;
  };

  function show(path: string, staged: boolean) {
    const same = shown?.path === path && shown.staged === staged;
    onShow(same ? null : { path, staged });
  }

  const staged = (list ?? []).filter((c) => c.index !== " " && c.index !== "?" && c.index !== "");
  const unstaged = (list ?? []).filter((c) => c.work !== " " && c.work !== "?" && c.work !== "");
  const untracked = (list ?? []).filter((c) => c.index === "?" && c.work === "?");

  const group = (head: string, rows: GitChange[], areStaged: boolean) =>
    rows.length === 0 ? null : (
      <div className="changegroup">
        <span className="uhead" onContextMenu={ctx(groupMenu(rows, areStaged, head))}>
          {head} · {rows.length}
          <Tooltip
            text={
              areStaged
                ? tr("git.unstageAllTip", "Take all of these out of the next commit")
                : tr("git.stageAllTip", "Put all of these into the next commit")
            }
          >
            <Button tiny disabled={busy} onClick={() => void stage(rows.map((r) => r.path), !areStaged)}>
              {areStaged ? tr("git.unstageAll", "ALL OUT") : tr("git.stageAll", "ALL IN")}
            </Button>
          </Tooltip>
        </span>
        {rows.map((c) => (
          <div key={`${areStaged ? "s" : "w"}:${c.path}`} className="changerow" onContextMenu={ctx(rowMenu(c, areStaged))}>
            <Tooltip text={c.renamed ? tr("git.from", "was {path}", { path: c.renamed }) : c.path}>
              <Button
                bare
                className={`changepath${shown?.path === c.path && shown.staged === areStaged ? " on" : ""}`}
                onClick={() => show(c.path, areStaged)}
              >
                {c.path}
              </Button>
            </Tooltip>
            {onEdit && (areStaged ? c.index : c.work) !== "D" ? (
              <Tooltip text={tr("git.editTip", "Open this file in the editor")}>
                <Button tiny onClick={() => onEdit(c.path)}>
                  {tr("git.edit", "EDIT")}
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip
              text={
                areStaged
                  ? tr("git.unstageTip", "Take it out of the next commit")
                  : tr("git.stageTip", "Put it into the next commit")
              }
            >
              <Button tiny disabled={busy} onClick={() => void stage([c.path], !areStaged)}>
                {areStaged ? tr("git.unstage", "OUT") : tr("git.stage", "IN")}
              </Button>
            </Tooltip>
            <span className="changeword">{word(areStaged ? c.index : c.work)}</span>
            {c.binary ? (
              <span className="changecount">{tr("git.binary", "binary")}</span>
            ) : (
              <span className="changecount">
                <span className="plus">+{areStaged ? c.staged_added : c.added}</span>{" "}
                <span className="minus">−{areStaged ? c.staged_removed : c.removed}</span>
              </span>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="changes" onContextMenu={ctx(listMenu())}>
      <div className="rowInline">
        <Button onClick={load}>{tr("git.again", "AGAIN")}</Button>
        <Tooltip text={tr("git.stashTip", "Put every change aside under a message and leave the tree clean")}>
          <Button disabled={busy || !list || list.length === 0} onClick={() => setAsking({ kind: "stash" })}>
            {tr("git.stash", "STASH…")}
          </Button>
        </Tooltip>
        <Tooltip text={tr("git.unstashTip", "Take the newest stash back into the tree")}>
          <Button disabled={busy || !stashes || stashes.length === 0} onClick={() => void unstash()}>
            {tr("git.unstash", "UNSTASH")}
            {stashes && stashes.length ? ` ${stashes.length}` : ""}
          </Button>
        </Tooltip>
        {list ? (
          <span className="hitSmall">
            {trN("git.files", list.length, "{n} file", "{n} files")}
          </span>
        ) : null}
        {live ? (
          <Tooltip text={live.connected ? tr("git.liveTip", "Follows the folder as it changes") : tr("git.liveLostTip", "The live feed dropped; reconnecting")}>
            <span className="hitSmall">{live.connected ? tr("git.live", "live") : tr("git.liveLost", "reconnecting…")}</span>
          </Tooltip>
        ) : null}
      </div>

      {problem ? <span className="notice warn">{problem}</span> : null}

      {list && list.length === 0 && !problem ? (
        <span className="notice">{tr("git.clean", "Nothing has changed in this folder.")}</span>
      ) : null}

      {where && !compact ? (
        <span className="branchline">
          {where.detached
            ? tr("git.detached", "no branch — sitting on {hash}", { hash: where.branch })
            : where.branch}
          {where.upstream ? ` · ${where.upstream}` : ""}
          {where.ahead ? ` · ${tr("git.ahead", "{n} ahead", { n: where.ahead })}` : ""}
          {where.behind ? ` · ${tr("git.behind", "{n} behind", { n: where.behind })}` : ""}
        </span>
      ) : null}

      {group(tr("git.staged", "staged"), staged, true)}
      {group(tr("git.unstaged", "not staged"), unstaged, false)}
      {group(tr("git.new", "new files"), untracked, false)}

      {staged.length ? (
        <div className="field">
          <span className="fieldName">{tr("git.message", "commit message")}</span>
          <Input
            ref={messageField}
            value={message}
            placeholder={tr("git.messagePlaceholder", "What changed, and why")}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && message.trim()) void commit();
            }}
          />
          <span className="rowInline">
            <Button primary disabled={busy || !message.trim()} onClick={() => void commit()}>
              {busy ? tr("common.working", "…") : tr("git.commit", "COMMIT")}
            </Button>
            <span className="notice">
              {trN("git.willCommit", staged.length, "{n} file goes in", "{n} files go in")}
            </span>
          </span>
        </div>
      ) : null}

      {note ? <span className="notice">{note}</span> : null}

      {asking?.kind === "discard" ? (
        <Ask
          heading={tr("git.discardHead", "throw these changes away?")}
          detail={
            asking.group
              ? trN("git.discardAllDetail", asking.paths.length, "{n} file under {name} goes back to the way it was. This cannot be undone.", "{n} files under {name} go back to the way they were. This cannot be undone.").replaceAll("{name}", asking.name)
              : tr("git.discardDetail", "{name} goes back to the way it was. This cannot be undone.", { name: asking.name })
          }
          confirmLabel={tr("git.discardConfirm", "DISCARD")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const paths = asking.paths;
            setAsking(null);
            void discard(paths);
          }}
        />
      ) : null}

      {asking?.kind === "stash" ? (
        <Ask
          heading={tr("git.stashHead", "put the changes aside?")}
          detail={tr("git.stashDetail", "Everything changed, staged and new is put aside and the tree is left clean. UNSTASH brings it back.")}
          field={tr("git.stashMessage", "message")}
          confirmLabel={tr("git.stashConfirm", "STASH")}
          onCancel={() => setAsking(null)}
          onConfirm={(message) => {
            setAsking(null);
            void stash(message.trim());
          }}
        />
      ) : null}

      {history.length && !compact ? (
        <div className="changegroup">
          <span className="uhead">{tr("git.recent", "lately")}</span>
          {history.map((h) => (
            <span key={h.hash} className="logrow">
              <span className="loghash">{h.hash}</span>
              <span className="logsubject">{h.subject}</span>
              <span className="logwhen">{ago(h.when)}</span>
            </span>
          ))}
        </div>
      ) : null}

    </div>
  );
}
