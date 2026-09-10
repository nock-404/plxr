"use client";

import { ago } from "@/lib/format";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { api } from "@/lib/api";
import { errText, tr, trN } from "@/lib/i18n";
import Input from "@/components/ui/Input";
import type { GitChange, GitEntry, GitWhere } from "@/lib/types";

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

function word(letter: string): string {
  const [key, fallback] = WORD[letter] ?? ["git.changed", "changed"];
  return tr(key, fallback);
}

export default function Changes({
  rootId,
  shown,
  onShow,
}: {
  rootId: string;
  shown: { path: string; staged: boolean } | null;
  /* The difference is drawn in the wide area, not here: a line of code is
     wider than a file name, and wrapping every one of them makes a hunk
     unreadable. So this list only says which one to show. */
  onShow: (what: { path: string; staged: boolean } | null) => void;
}) {
  const [list, setList] = useState<GitChange[] | null>(null);
  const [problem, setProblem] = useState("");
  const [where, setWhere] = useState<GitWhere | null>(null);
  const [history, setHistory] = useState<GitEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

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
  }, [rootId]);

  useEffect(load, [load]);

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
        <span className="uhead">
          {head} · {rows.length}
          <Button
            tiny
            disabled={busy}
            onClick={() => void stage(rows.map((r) => r.path), !areStaged)}
            title={
              areStaged
                ? tr("git.unstageAllTip", "Take all of these out of the next commit")
                : tr("git.stageAllTip", "Put all of these into the next commit")
            }
          >
            {areStaged ? tr("git.unstageAll", "ALL OUT") : tr("git.stageAll", "ALL IN")}
          </Button>
        </span>
        {rows.map((c) => (
          <div key={`${areStaged ? "s" : "w"}:${c.path}`} className="changerow">
            <Button
              bare
              className={`changepath${shown?.path === c.path && shown.staged === areStaged ? " on" : ""}`}
              onClick={() => show(c.path, areStaged)}
              title={c.renamed ? tr("git.from", "was {path}", { path: c.renamed }) : c.path}
            >
              {c.path}
            </Button>
            <Button
              tiny
              disabled={busy}
              onClick={() => void stage([c.path], !areStaged)}
              title={
                areStaged
                  ? tr("git.unstageTip", "Take it out of the next commit")
                  : tr("git.stageTip", "Put it into the next commit")
              }
            >
              {areStaged ? tr("git.unstage", "OUT") : tr("git.stage", "IN")}
            </Button>
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
    <div className="changes">
      <div className="rowInline">
        <Button onClick={load}>{tr("git.again", "AGAIN")}</Button>
        {list ? (
          <span className="hitSmall">
            {trN("git.files", list.length, "{n} file", "{n} files")}
          </span>
        ) : null}
      </div>

      {problem ? <span className="notice warn">{problem}</span> : null}

      {list && list.length === 0 && !problem ? (
        <span className="notice">{tr("git.clean", "Nothing has changed in this folder.")}</span>
      ) : null}

      {where ? (
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

      {history.length ? (
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
