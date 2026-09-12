"use client";

import { useEffect, useState } from "react";
import Changes from "@/components/Changes";
import Tooltip from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";
import { useChanges } from "@/lib/useChanges";

/* Git source control as a panel of its own — dockable beside a terminal the
 * way an editor puts its source-control view beside the code. Clicking a
 * file opens its diff as another panel.
 *
 * It follows the session you are working in: the folder shown is the cwd of
 * the session panel that was focused last, and it moves when you click into
 * another session — not when you click into the editor or this panel, which
 * is why the follow signal is the sticky one the dock keeps, not the active
 * panel. A session id is a git id in its own right (the service resolves
 * the folder from it), so nothing has to be opened as a workspace for it.
 *
 * Only when no session has ever been active in this layout does it fall
 * back to the folder the path field points at, opened as a workspace — the
 * way it worked before it learned to follow.
 *
 * What it shows moves by itself: the service watches the folder and pushes
 * every new state, so a file an agent writes appears here without a press.
 */
export default function ChangesPanel({
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
  shown: { rootId: string; path: string; staged: boolean } | null;
  onDiff: (rootId: string, path: string, staged: boolean, title: string) => void;
  onEdit: (rootId: string, path: string) => void;
}) {
  /* The id followed, a beat behind the signal. Clicking through three
     sessions in a second would otherwise open and drop three feeds; the one
     you land on is the one that is followed. */
  const [followed, setFollowed] = useState<string | null>(sessionId || null);
  useEffect(() => {
    // Both ways, so a signal that flickers for a moment — a restore, where
    // the session is unknown until the first tiles arrive — settles first.
    const t = window.setTimeout(() => setFollowed(sessionId || null), 200);
    return () => window.clearTimeout(t);
  }, [sessionId]);

  // The fallback: the path field's folder, as a workspace — only with no session.
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    setProblem("");
    setWorkspaceId(null);
    if (followed || !here) return;
    let gone = false;
    api
      .openWorkspace(here)
      .then((w) => !gone && setWorkspaceId(w.id))
      .catch(() => !gone && setProblem(tr("changesPanel.noFolder", "This is not a folder git knows.")));
    return () => {
      gone = true;
    };
  }, [followed, here]);

  const rootId = followed ?? workspaceId;
  const live = useChanges(rootId);

  if (!rootId) {
    if (!followed && !here && !sessionId) {
      return (
        <div className="emptyNote">
          <b>{tr("changesPanel.emptyHead", "no folder")}</b>
          {tr("changesPanel.empty", "Choose a folder in the path field, then this shows what changed in it.")}
        </div>
      );
    }
    if (problem) return <div className="emptyNote">{problem}</div>;
    return <div className="emptyNote">{tr("changesPanel.loading", "reading…")}</div>;
  }

  /* A folder git does not know is said as such. A session the service does
     not know yet is the restore-before-data moment — the tiles are on their
     way — and reads as still reading, never as an error and never as blank. */
  if (live.problem.startsWith("err.git.noRepo")) {
    return <div className="emptyNote">{tr("changesPanel.noFolder", "This is not a folder git knows.")}</div>;
  }
  if (live.changes === null || live.problem.startsWith("err.session.unknown")) {
    return <div className="emptyNote">{tr("changesPanel.loading", "reading…")}</div>;
  }

  return (
    <div className="changesPanel">
      {label ? (
        <Tooltip text={tr("changesPanel.followTip", "Follows the session that was focused last")}>
          <span className="notice">{tr("changesPanel.following", "following {name}", { name: label })}</span>
        </Tooltip>
      ) : null}
      <Changes
        rootId={rootId}
        live={live}
        shown={shown && shown.rootId === rootId ? { path: shown.path, staged: shown.staged } : null}
        onShow={(what) => {
          // The lit row clicked again is not a toggle here — the diff is a
          // panel of its own, and the click brings it to the front.
          const want = what ?? (shown && shown.rootId === rootId ? { path: shown.path, staged: shown.staged } : null);
          if (want) onDiff(rootId, want.path, want.staged, want.path.split("/").pop() ?? want.path);
        }}
        onEdit={(path) => onEdit(rootId, path)}
      />
    </div>
  );
}
