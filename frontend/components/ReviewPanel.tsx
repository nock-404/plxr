"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import Tooltip from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { errText, tr, trN } from "@/lib/i18n";
import { useChanges } from "@/lib/useChanges";
import type { GitReview, GitReviewFile } from "@/lib/types";

/* What changed on this branch — the whole of it, not the index.
 *
 * The changes panel reads the working tree against HEAD: what is staged and
 * what is not. This one reads the branch: everything from the point where it
 * left its base to the working tree as it stands now, committed or not, with
 * the untracked files as well. It is the list a reviewer wants before a pull
 * request, and it answers "what did this agent actually do here" in one
 * place rather than across a log.
 *
 * The base is picked at the top — main or master when there is one, else the
 * upstream, else ten commits back — and every diff is measured from the
 * merge-base of that ref and HEAD, so commits the base gained meanwhile are
 * not counted as this branch's work.
 *
 * It follows the session that was focused last, the way the changes panel
 * does, and it moves by itself: the same live signal the changes panel rides
 * on says when the folder moved, and the list is asked for again.
 */
const WORD: Record<string, [string, string]> = {
  M: ["git.modified", "changed"],
  A: ["git.added", "added"],
  D: ["git.deleted", "deleted"],
  R: ["git.renamed", "renamed"],
  C: ["git.copied", "copied"],
  T: ["git.typechange", "type changed"],
  "?": ["git.new", "new files"],
};

// The order the groups are read in: what was changed first, what is new last.
const ORDER = ["M", "A", "D", "R", "C", "T", "?"];

function word(letter: string): string {
  const [key, fallback] = WORD[letter] ?? ["git.changed", "changed"];
  return tr(key, fallback);
}

export default function ReviewPanel({
  here,
  sessionId,
  label,
  shown,
  onDiff,
  onEdit,
}: {
  here: string;
  /* The session to follow; empty until one has been active in this layout. */
  sessionId?: string;
  /* How to name what is followed, for the line at the top. */
  label?: string;
  /* The diff that is open, so its row can be lit. */
  shown: { rootId: string; path: string; staged: boolean; base?: string } | null;
  onDiff: (rootId: string, path: string, staged: boolean, title: string, base?: string) => void;
  onEdit: (rootId: string, path: string) => void;
}) {
  /* The id followed, a beat behind the signal — the changes panel's reason:
     clicking through three sessions must not open three feeds. */
  const [followed, setFollowed] = useState<string | null>(sessionId || null);
  useEffect(() => {
    const t = window.setTimeout(() => setFollowed(sessionId || null), 200);
    return () => window.clearTimeout(t);
  }, [sessionId]);

  // The fallback: the path field's folder, as a workspace — only with no session.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [folderProblem, setFolderProblem] = useState("");
  useEffect(() => {
    setFolderProblem("");
    setWorkspaceId(null);
    if (followed || !here) return;
    let gone = false;
    api
      .openWorkspace(here)
      .then((w) => !gone && setWorkspaceId(w.id))
      .catch(() => !gone && setFolderProblem(tr("changesPanel.noFolder", "This is not a folder git knows.")));
    return () => {
      gone = true;
    };
  }, [followed, here]);

  const rootId = followed ?? workspaceId;
  const live = useChanges(rootId);

  const [review, setReview] = useState<GitReview | null>(null);
  // "" is the service's default; a chosen base is remembered per panel.
  const [base, setBase] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    if (!rootId) return;
    let dropped = false;
    setProblem("");
    api
      .review(rootId, base)
      .then((r) => !dropped && setReview(r))
      .catch((e) => {
        if (dropped) return;
        setProblem(errText(e));
        setReview((r) => r ?? { base, merge_base: "", branch: "", files: [], added: 0, removed: 0, bases: [], stashes: [] });
      });
    return () => {
      dropped = true;
    };
  }, [rootId, base]);

  // A different folder is a blank slate; the same folder moving keeps its
  // list on screen until the new one is in.
  useEffect(() => {
    setReview(null);
    setNote("");
  }, [rootId]);

  // Asked on arrival, on a new base, and whenever the folder's state moved.
  const liveRev = live.rev;
  useEffect(() => load(), [load, liveRev]);

  async function unstash() {
    if (!rootId) return;
    setBusy(true);
    setProblem("");
    setNote("");
    try {
      await api.stashPop(rootId);
      setNote(tr("git.unstashed", "taken back into the tree"));
      load();
    } catch (e) {
      setProblem(errText(e));
    }
    setBusy(false);
  }

  if (!rootId) {
    if (!followed && !here && !sessionId) {
      return (
        <div className="emptyNote">
          <b>{tr("changesPanel.emptyHead", "no folder")}</b>
          {tr("review.empty", "Choose a folder in the path field, then this shows what its branch changed.")}
        </div>
      );
    }
    if (folderProblem) return <div className="emptyNote">{folderProblem}</div>;
    return <div className="emptyNote">{tr("changesPanel.loading", "reading…")}</div>;
  }
  if (live.problem.startsWith("err.git.noRepo")) {
    return <div className="emptyNote">{tr("changesPanel.noFolder", "This is not a folder git knows.")}</div>;
  }
  if (review === null || live.problem.startsWith("err.session.unknown")) {
    return <div className="emptyNote">{tr("changesPanel.loading", "reading…")}</div>;
  }

  const bases = review.bases.includes(review.base) || !review.base ? review.bases : [review.base, ...review.bases];
  const options = bases.map((b) => ({ value: b, label: b }));
  const chosen = base || review.base;

  const lit = (f: GitReviewFile) =>
    shown !== null && shown.rootId === rootId && shown.path === f.path && (shown.base ?? "") === chosen;

  const groups = ORDER.map((letter) => ({ letter, rows: review.files.filter((f) => f.status === letter) })).filter(
    (g) => g.rows.length > 0,
  );

  return (
    <div className="reviewPanel">
      {label ? (
        <Tooltip text={tr("changesPanel.followTip", "Follows the session that was focused last")}>
          <span className="notice">{tr("changesPanel.following", "following {name}", { name: label })}</span>
        </Tooltip>
      ) : null}
      <div className="review">
        <div className="rowInline">
          <span className="fieldName">{tr("review.against", "against")}</span>
          {options.length ? (
            <Select
              value={chosen}
              options={options}
              onChange={(v) => setBase(v)}
              tip={tr("review.againstTip", "The branch is measured from where it parted from this ref")}
            />
          ) : null}
          <Button onClick={load}>{tr("git.again", "AGAIN")}</Button>
        </div>

        {problem ? <span className="notice warn">{problem}</span> : null}

        <Tooltip
          text={
            review.merge_base
              ? tr("review.mergeBaseTip", "Measured from {hash}, where {branch} and {base} parted", {
                  hash: review.merge_base.slice(0, 7),
                  branch: review.branch,
                  base: review.base,
                })
              : undefined
          }
        >
          <span className="branchline">
            {review.branch}
            {review.merge_base ? ` ← ${review.base} · ${review.merge_base.slice(0, 7)}` : ""}
          </span>
        </Tooltip>

        <span className="hitSmall">
          {trN("git.files", review.files.length, "{n} file changed", "{n} files changed")}
          {review.files.length ? (
            <>
              {" · "}
              <span className="plus">+{review.added}</span> <span className="minus">−{review.removed}</span>
            </>
          ) : null}
        </span>

        {review.files.length === 0 && !problem ? (
          <span className="notice">{tr("review.clean", "This branch has changed nothing against {base}.", { base: review.base })}</span>
        ) : null}

        {groups.map((g) => (
          <div key={g.letter} className="changegroup">
            <span className="uhead">
              {word(g.letter)} · {g.rows.length}
            </span>
            {g.rows.map((f) => (
              <div key={f.path} className="changerow">
                <Tooltip text={f.renamed ? tr("git.from", "was {path}", { path: f.renamed }) : f.path}>
                  <Button
                    bare
                    className={`changepath${lit(f) ? " on" : ""}`}
                    onClick={() => onDiff(rootId, f.path, false, f.path.split("/").pop() ?? f.path, chosen)}
                  >
                    {f.path}
                  </Button>
                </Tooltip>
                {f.status !== "D" ? (
                  <Tooltip text={tr("git.editTip", "Open this file in the editor")}>
                    <Button tiny onClick={() => onEdit(rootId, f.path)}>
                      {tr("git.edit", "EDIT")}
                    </Button>
                  </Tooltip>
                ) : null}
                {f.binary ? (
                  <span className="changecount">{tr("git.binary", "binary")}</span>
                ) : (
                  <span className="changecount">
                    <span className="plus">+{f.added}</span> <span className="minus">−{f.removed}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}

        {note ? <span className="notice">{note}</span> : null}

        <div className="changegroup">
          <span className="uhead">
            {tr("git.stashes", "stashes")} · {review.stashes.length}
            {review.stashes.length ? (
              <Tooltip text={tr("git.unstashTip", "Take the newest stash back into the tree")}>
                <Button tiny disabled={busy} onClick={() => void unstash()}>
                  {tr("git.unstash", "UNSTASH")}
                </Button>
              </Tooltip>
            ) : null}
          </span>
          {review.stashes.length === 0 ? (
            <span className="notice">{tr("git.noStashes", "Nothing is put aside.")}</span>
          ) : (
            review.stashes.map((s) => (
              <span key={s.ref} className="logrow">
                <span className="loghash">{s.ref}</span>
                <Tooltip text={s.subject}>
                  <span className="logsubject">{s.subject}</span>
                </Tooltip>
                <span className="logwhen">{ago(s.when)}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
