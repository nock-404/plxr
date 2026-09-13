"use client";

import { useEffect, useState } from "react";
import FileSearch from "@/components/FileSearch";
import Tooltip from "@/components/ui/Tooltip";
import { api } from "@/lib/api";
import { tr } from "@/lib/i18n";

/* Find in files, as a panel of its own beside the terminal.
 *
 * The search itself is the one the folders view already has; what this adds
 * is a place for it that does not cost the terminal its room, and a folder to
 * search that is not chosen by hand: it follows the session you are working
 * in, the same way the changes panel does. The folder searched is the cwd of
 * the session panel that was focused last, and it moves when you click into
 * another session — not when you click into the editor a hit opened, which is
 * why the follow signal is the sticky one the dock keeps, not the active
 * panel. A session id is a search id in its own right; nothing has to be
 * opened as a workspace for it.
 *
 * Only when no session has ever been active in this layout does it fall back
 * to the folder picked at the top, opened as a workspace.
 *
 * A hit opens the file as an editor panel at that line — the editor scrolls
 * there and puts the cursor on it.
 */
export default function SearchPanel({
  here,
  sessionId,
  label,
  onOpen,
}: {
  here: string;
  /* The session to follow; empty until one has been active in this layout. */
  sessionId?: string;
  /* How to name what is followed, for the line at the top. */
  label?: string;
  onOpen: (rootId: string, path: string, line: number) => void;
}) {
  /* The id followed, a beat behind the signal, so a restore — where the
     session is unknown until the first tiles arrive — settles first. */
  const [followed, setFollowed] = useState<string | null>(sessionId || null);
  useEffect(() => {
    const t = window.setTimeout(() => setFollowed(sessionId || null), 200);
    return () => window.clearTimeout(t);
  }, [sessionId]);

  // The fallback: the picked folder, as a workspace — only with no session.
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
      .catch(() => !gone && setProblem(tr("searchPanel.noFolder", "This is not a folder that can be searched.")));
    return () => {
      gone = true;
    };
  }, [followed, here]);

  const rootId = followed ?? workspaceId;

  if (!rootId) {
    if (!followed && !here && !sessionId) {
      return (
        <div className="emptyNote">
          <b>{tr("searchPanel.emptyHead", "no folder")}</b>
          {tr("searchPanel.empty", "Open a session, or choose a project at the top, then this searches its files.")}
        </div>
      );
    }
    if (problem) return <div className="emptyNote">{problem}</div>;
    return <div className="emptyNote">{tr("searchPanel.loading", "reading…")}</div>;
  }

  return (
    <div className="searchPanel">
      {label ? (
        <Tooltip text={tr("searchPanel.followTip", "Searches the project: the session in front, or the folder picked at the top")}>
          <span className="notice">{tr("searchPanel.following", "searching {name}", { name: label })}</span>
        </Tooltip>
      ) : null}
      {/* One search per folder: the id keys it, so switching sessions starts
          a fresh box rather than showing one folder's hits over another. */}
      <FileSearch key={rootId} rootId={rootId} onOpen={(path, line) => onOpen(rootId, path, line)} />
    </div>
  );
}
